import { NextResponse } from 'next/server';
import { subscriptionService, PLANS } from '@/lib/subscription-service';
import { sendPlanEmail, sendReceiptEmail, sendTrialWelcomeEmail } from '@/lib/email-service';
import { getPolarInvoiceUrl, formatPolarAmount } from '@/lib/polar-invoice';
import crypto from 'crypto';
import { logEvent } from "@/lib/logsso";

/**
 * Webhook Handler
 * Handles subscription events from payment gateway (Polar)
 * 
 * Polar uses Standard Webhooks specification for signing
 * https://docs.polar.sh/integrate/webhooks
 */

/**
 * Validate Polar webhook signature using Standard Webhooks spec
 */
function validatePolarWebhook(payload, headers, secret) {
    try {
        if (!secret) {
            console.warn('⚠️ POLAR_WEBHOOK_SECRET not set, skipping validation');
            return true; // Allow in development - REMOVE IN PRODUCTION
        }

        const webhookId = headers['webhook-id'];
        const webhookTimestamp = headers['webhook-timestamp'];
        const webhookSignature = headers['webhook-signature'];

        if (!webhookId || !webhookTimestamp || !webhookSignature) {
            console.error('❌ Missing webhook headers:', { webhookId, webhookTimestamp, webhookSignature });
            return false;
        }

        // Check timestamp is within 5 minutes
        const ts = Number(webhookTimestamp);
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSeconds - ts) > 300) {
            console.error('❌ Webhook timestamp too old');
            return false;
        }

        // Polar's HMAC key is the FULL secret string (incl. the `polar_whs_` prefix)
        // taken as raw UTF-8 bytes — NOT prefix-stripped, NOT base64-decoded. This
        // mirrors Polar's own SDK exactly: it does `new Webhook(base64(secret))`, and
        // the standardwebhooks lib then base64-DECODES that back to the raw secret
        // bytes and uses them as the HMAC key. The previous code stripped the prefix
        // and base64-decoded the remainder → a wrong key → 401 on EVERY event, which
        // is what got the endpoint auto-disabled. Verified against polarsource/polar-js.
        const keyBytes = Buffer.from(secret.trim(), 'utf-8');

        // Create signature
        const toSign = `${webhookId}.${webhookTimestamp}.${payload}`;
        const expected = crypto.createHmac('sha256', keyBytes).update(toSign).digest('base64');

        // Check against all signature candidates
        const candidates = webhookSignature.split(' ').map(s => s.trim()).filter(Boolean);
        for (const candidate of candidates) {
            const [version, sig] = candidate.split(',', 2);
            if (version !== 'v1' || !sig) continue;

            if (sig === expected) return true;
        }

        console.error('❌ Signature mismatch');
        return false;
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('❌ Webhook validation error:', error);
        return false;
    }
}



export async function POST(request) {
    try {
        const rawBody = await request.text();
        let body;

        try {
            body = rawBody ? JSON.parse(rawBody) : {};
        } catch (e) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
            console.error('❌ Failed to parse Polar webhook payload:', e);
            return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 });
        }

        console.log('🔔 Polar Webhook received:', JSON.stringify(body, null, 2));

        // Get headers for validation
        const headers = {};
        request.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });

        // Validate webhook signature. In production a missing secret is FATAL —
        // processing unsigned webhooks would let anyone POST a forged 'order.paid'
        // with any email and self-grant Pro. Only allow unsigned in non-production
        // (local dev) where Polar can't reach us anyway.
        const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
        if (!webhookSecret) {
            if (process.env.NODE_ENV === 'production') {
                console.error('❌ POLAR_WEBHOOK_SECRET not configured in production — refusing unsigned webhook');
                return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
            }
            console.warn('⚠️ POLAR_WEBHOOK_SECRET not set (non-production) — processing without validation');
        } else {
            const isValid = validatePolarWebhook(rawBody, headers, webhookSecret);
            if (!isValid) {
                console.warn('❌ Invalid Polar webhook signature');
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
            }
        }

        // Test Supabase connection
        const connectionOk = await subscriptionService.testConnection();
        if (!connectionOk) {
            console.error('❌ CRITICAL: Supabase connection failed!');
            return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
        }

        // Extract event type and data
        const eventType = body.type || body.event;
        const data = body.data || body;

        console.log(`📬 Processing Polar event: ${eventType}`);

        // Handle different Polar webhook events
        switch (eventType) {
            case 'subscription.updated':   // renewals / plan changes on an existing paid sub
            case 'subscription.active':    // Polar validated the sub's payment method
            case 'order.paid': {           // money actually received
                // NOTE: 'order.created', 'checkout.completed' AND 'subscription.created'
                // were removed as activation triggers — Polar emits all three BEFORE
                // payment is captured (checkout.completed fires when the user finishes
                // the checkout *form*; subscription.created fires for a trial before any
                // charge), so activating on them granted access to unpaid/abandoned
                // checkouts and cardless trials. The only trustworthy "access now"
                // signals are order.paid + subscription.active, both implying a real
                // payment commitment. The cardless-trial guard below is the backstop.
                // Get user email from various possible locations (exhaustive search)
                let userEmail = data.customer?.email ||
                    data.user?.email ||
                    data.email ||
                    data.customer_email ||
                    data.metadata?.email ||
                    data.customer?.metadata?.email ||
                    (data.customer?.id && !data.customer.email ? null : data.customer?.email);

                if (!userEmail) {
                    console.error('❌ No user email found in webhook data');
                    console.log('Available data keys:', Object.keys(data));
                    return NextResponse.json({ error: 'No user email in payload' }, { status: 400 });
                }

                userEmail = userEmail.trim().toLowerCase();

                const planType = subscriptionService.determinePlanType(data);
                const subscriptionId = data.id || data.subscription_id || data.order_id;

                // Get dates from Polar
                const polarDates = {
                    createdAt: data.created_at ? new Date(data.created_at).getTime() / 1000 : null,
                    validUntil: data.current_period_end ? new Date(data.current_period_end).getTime() / 1000 : null,
                    expiresAt: data.cancel_at ? new Date(data.cancel_at).getTime() / 1000 : null,
                    isRenewal: eventType === 'subscription.updated',
                    // Free-trial subs come from Polar as status 'trialing'.
                    isTrialing: data.status === 'trialing',
                };

                // Extract payment method details from Polar webhook data
                // Polar can include payment method info in various locations depending on event type
                const paymentMethod = data.payment_method 
                    || data.customer?.payment_method
                    || data.subscription?.payment_method
                    || data.order?.payment_method
                    || null;

                const paymentMethodLast4 = paymentMethod?.last4 
                    || paymentMethod?.card?.last4
                    || data.payment_method_last4
                    || data.card_last4
                    || null;

                const paymentMethodBrand = paymentMethod?.brand
                    || paymentMethod?.card?.brand 
                    || data.payment_method_brand
                    || data.card_brand
                    || null;

                // CARDLESS-TRIAL GUARD. A free trial must be backed by a real payment
                // commitment — otherwise a user who merely opened the Polar checkout and
                // closed it (no card) ends up with an active Pro trial. We only grant a
                // 'trialing' subscription when a payment method is on file. (Configure
                // the Polar product to REQUIRE a payment method for the trial so every
                // legitimate trial carries one — see docs/boult-calcom-auth.md style note.)
                const hasPaymentMethod = !!(
                    paymentMethodLast4 ||
                    paymentMethod ||
                    data.payment_method_id ||
                    data.customer?.default_payment_method_id
                );
                // BLOCK (not just warn): a trial with no payment method on file is a
                // cardless trial — exactly the abandoned-checkout case that leaks Pro
                // access without payment. Do NOT activate. A real trial that required a
                // card will carry payment method info and pass through.
                if (polarDates.isTrialing && !hasPaymentMethod) {
                    console.warn(`🚫 BLOCKED cardless trial for ${userEmail} (no payment method). Event: ${eventType}`);
                    return NextResponse.json({ ok: true, skipped: 'cardless_trial' });
                }

                console.log(`✅ Activating ${planType} plan for ${userEmail}`);
                console.log('📅 Polar dates:', polarDates);
                console.log('🆔 Subscription ID:', subscriptionId);
                console.log('💳 Payment method:', { last4: paymentMethodLast4, brand: paymentMethodBrand });

                // Activate subscription with payment method info
                const activated = await subscriptionService.activateSubscription(
                    userEmail,
                    planType,
                    subscriptionId,
                    polarDates,
                    { last4: paymentMethodLast4, brand: paymentMethodBrand }
                );

                console.log(`✅ Subscription activation result:`, !!activated);
                
                if (activated) {
                    logEvent({
                        channel: 'revenue',
                        event: '✅ Subscription Started',
                        description: `Activated ${planType} plan.`,
                        user_id: userEmail,
                        tags: { plan: planType, subscriptionId }
                    });
                }

                // Send welcome email only on brand-new subscriptions (not monthly renewals)
                const isRenewal = eventType === 'subscription.updated';
                if (activated && !isRenewal && (planType === 'starter' || planType === 'pro' || planType === 'weekly')) {
                    const customerName = data.customer?.name || data.user?.name || null;

                    // A TRIAL is a different moment from a paid subscription, so it
                    // gets its own email. The paid welcome congratulates a purchase;
                    // a trialist has paid nothing and needs one thing instead — to
                    // know the first briefing lands tomorrow morning. Without that,
                    // day two feels like nothing happened and they churn.
                    const send = polarDates.isTrialing
                        ? sendTrialWelcomeEmail({
                            toEmail: userEmail,
                            toName: customerName,
                            details: {
                                trialEndsLabel: polarDates.validUntil
                                    ? new Date(polarDates.validUntil * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
                                    : null,
                            },
                          })
                        : sendPlanEmail({ toEmail: userEmail, toName: customerName, plan: planType });

                    const label = polarDates.isTrialing ? 'trial welcome' : `${planType} welcome`;
                    send
                        .then(result => {
                            if (result.success) console.log(`📧 ${label} email sent → ${userEmail}`);
                            else console.warn(`⚠️ ${label} email failed for ${userEmail}:`, result.error);
                        })
                        .catch(err => console.error('❌ Email send threw unexpectedly:', err));
                }

                // Payment receipt + Polar invoice — gated strictly on 'order.paid'
                // (the canonical "money received" event) so a single purchase can't
                // double-send when Polar also emits order.created. Trials start at
                // $0 and emit no paid order, so they get the welcome email above but
                // no receipt here, which is correct.
                const chargedMinor = Number(
                    data.amount ?? data.total_amount ?? data.net_amount ?? data.amount_total ?? 0,
                );
                if (eventType === 'order.paid' && chargedMinor > 0 && data.id) {
                    const orderId = data.id;
                    const customerName = data.customer?.name || data.user?.name || null;
                    const amountLabel = formatPolarAmount(chargedMinor, data.currency || 'USD');
                    
                    logEvent({
                        channel: 'revenue',
                        event: '💰 Payment Received',
                        description: `Payment of ${amountLabel} received.`,
                        user_id: userEmail,
                        tags: { amount_minor: chargedMinor, orderId }
                    });
                    const planLabel = (PLANS[planType] && PLANS[planType].name) || 'Maily';
                    const dateLabel = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                    // Generate + fetch the invoice PDF (best-effort), then email the
                    // receipt. Done inline so the webhook stays warm long enough for
                    // the serverless function to complete the send.
                    try {
                        const invoiceUrl = await getPolarInvoiceUrl(orderId);
                        const r = await sendReceiptEmail({ toEmail: userEmail, toName: customerName, planLabel, amountLabel, dateLabel, invoiceUrl });
                        console.log(`🧾 Receipt email ${r.success ? 'sent' : 'failed'} for order ${orderId} → ${userEmail}${invoiceUrl ? ' (with invoice)' : ' (invoice pending)'}`);
                    } catch (err) {
                    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
                        console.error('❌ Receipt/invoice send failed:', err?.message || err);
                    }
                }
                break;
            }

            case 'subscription.canceled':
            case 'subscription.cancelled':
            case 'subscription.revoked':
            case 'subscription.deleted': {
                const cancelEmail = data.customer?.email || data.user?.email || data.email;
                if (cancelEmail) {
                    console.log(`❌ Cancelling subscription for: ${cancelEmail}`);
                    await subscriptionService.cancelSubscription(cancelEmail);
                }
                break;
            }

            default:
                console.log(`ℹ️ Unhandled Polar event type: ${eventType}`);
        }

        return NextResponse.json({ success: true });

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('❌ Polar webhook error:', error);
        return NextResponse.json({ error: 'Webhook processing failed', details: error.message }, { status: 500 });
    }
}

/**
 * GET handler to verify webhook endpoint is working
 */
export async function GET() {
    let supabaseStatus = 'unknown';

    try {
        const connectionOk = await subscriptionService.testConnection();
        supabaseStatus = connectionOk ? 'connected' : 'error';
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        supabaseStatus = 'error';
    }

    return NextResponse.json({
        status: 'active',
        message: 'Webhook endpoint is ready',
        database: supabaseStatus,
        environment: {
            hasWebhookSecret: !!process.env.POLAR_WEBHOOK_SECRET,
            hasSupabaseUrl: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
            hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            hasResendKey: !!process.env.RESEND_API_KEY
        },
        supported_events: [
            'subscription.created',
            'subscription.updated',
            'subscription.active',
            'subscription.canceled',
            'subscription.revoked',
            'checkout.completed',
            'order.created'
        ]
    });
}
