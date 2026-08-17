import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { subscriptionService } from '@/lib/subscription-service';
import { Resend } from 'resend';
import { logEvent } from "@/lib/logsso";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * POST - Cancel user's subscription
 * Integrates with Polar API for proper cancellation and collects feedback
 */
export async function POST(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = session.user.email;
        const userName = session.user.name || userId;
        const body = await request.json();
        const { reasons = [], feedback = "" } = body;

        // Check if user has an active subscription
        const isActive = await subscriptionService.isSubscriptionActive(userId);
        if (!isActive) {
            return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
        }

        // Get current subscription details
        const subscription = await subscriptionService.getUserSubscription(userId);
        if (!subscription) {
            return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
        }

        // Initialize Polar API key
        const polarApiKey = process.env.POLAR_ACCESS_TOKEN || process.env.POLAR_API_KEY;

        let providerCancellationResult = null;
        let cancellationError = null;

        const subscriptionId = subscription.whop_membership_id;

        if (subscriptionId && polarApiKey) {
            try {
                console.log('🔄 Cancelling Polar subscription:', subscriptionId);

                // Polar API: PATCH /v1/subscriptions/{id} with cancel_at_period_end: true
                const response = await fetch(`https://api.polar.sh/v1/subscriptions/${subscriptionId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${polarApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        cancel_at_period_end: true
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || errorData.error || `Polar API error (${response.status})`);
                }

                providerCancellationResult = await response.json();
                console.log('✅ Polar subscription set to cancel at period end:', subscriptionId);
            } catch (polarError) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(polarError) });
                console.error('❌ Error cancelling Polar subscription:', polarError);
                cancellationError = polarError.message || 'Failed to cancel with Polar';
            }
        }

        // Always update local subscription status
        const cancelledSubscription = await subscriptionService.cancelSubscription(userId);

        if (!cancelledSubscription) {
            return NextResponse.json({ error: 'Failed to cancel subscription locally' }, { status: 500 });
        }

        // Send feedback email via Resend
        if (resend) {
            try {
                await resend.emails.send({
                from: 'Maily <onboarding@resend.dev>',
                to: 'support.maily@gmail.com',
                subject: `📉 Subscription Cancelled: ${userName}`,
                html: `
                    <div style="font-family: sans-serif; padding: 20px; color: #333;">
                        <h2 style="color: #e53e3e;">Subscription Cancelled</h2>
                        <p><strong>User:</strong> ${userName} (${userId})</p>
                        <p><strong>Plan:</strong> ${subscription.plan_type}</p>
                        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                        
                        <h3 style="margin-top: 30px;">Reasons:</h3>
                        <ul style="background: #f7fafc; padding: 15px; border-radius: 8px; list-style: none;">
                            ${reasons.length > 0 ? reasons.map(r => `<li>• ${r}</li>`).join('') : '<li>No specific reasons selected</li>'}
                        </ul>
                        
                        <h3 style="margin-top: 30px;">Feedback:</h3>
                        <div style="background: #f7fafc; padding: 15px; border-radius: 8px; white-space: pre-wrap;">
                            ${feedback || 'No detailed feedback provided'}
                        </div>
                    </div>
                `
            });
            console.log('📧 Feedback email sent to support.maily@gmail.com');
        } catch (emailError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(emailError) });
            console.error('❌ Failed to send feedback email:', emailError);
        }
        }

        return NextResponse.json({
            success: true,
            message: 'Subscription cancelled successfully.',
            subscription: {
                status: cancelledSubscription.status,
                subscriptionEndsAt: cancelledSubscription.subscription_ends_at,
                daysRemaining: subscriptionService.getDaysRemaining(cancelledSubscription.subscription_ends_at)
            }
        });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error cancelling subscription:', error);
        return NextResponse.json({
            error: 'Failed to cancel subscription',
            details: error.message
        }, { status: 500 });
    }
}

