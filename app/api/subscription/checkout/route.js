import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { PLANS } from '@/lib/subscription-service';

/**
 * POST /api/subscription/checkout  { plan: 'weekly'|'monthly'|'annual'|'lifetime' }
 *
 * Creates a Polar checkout SESSION server-side and returns its URL, replacing
 * the hardcoded buy.polar.sh/polar_cl_… links the onboarding used to redirect to.
 *
 * WHY THIS EXISTS — 21 checkouts started, 0 completed. Static links fail in ways
 * a session does not:
 *   • the link may belong to a different Polar org / sandbox than the one this
 *     app's POLAR_ACCESS_TOKEN talks to → the checkout leads nowhere real and
 *     nothing shows in the dashboard. A session created WITH that token is always
 *     in the right org and mode.
 *   • the buyer types whatever email they like on Polar's page, so the webhook
 *     (which maps order→user by customer_email) can't reliably match the account.
 *     Here customer_email is pre-set to the signed-in user, and user_id rides in
 *     metadata as a second anchor.
 *   • no reliable return. success_url sends them straight back to onboarding
 *     step 15 (?paid=1) to finish.
 *
 * The client falls back to the old static link if this returns non-OK, so it can
 * only ever help, never regress. The error detail is returned so a Polar API
 * shape/mode problem is visible instead of silent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE = process.env.NEXTAUTH_URL || 'https://maily.cfd';

// Onboarding's plan ids -> PLANS keys. Onboarding calls the $29 tier 'monthly';
// in PLANS it's keyed 'pro'. The others match 1:1.
const PLAN_KEY = { weekly: 'weekly', monthly: 'pro', annual: 'annual', lifetime: 'lifetime' };

export async function POST(request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = session.user.email.toLowerCase();

  let body = {};
  try { body = await request.json(); } catch { /* empty body handled below */ }

  const planChoice = String(body?.plan || '').toLowerCase();
  const planKey = PLAN_KEY[planChoice];
  const plan = planKey ? PLANS[planKey] : null;
  const productId = plan?.polarProductId;
  if (!productId) {
    return NextResponse.json({ error: 'Unknown plan', plan: planChoice }, { status: 400 });
  }

  const token = process.env.POLAR_ACCESS_TOKEN || process.env.POLAR_API_KEY;
  if (!token) {
    return NextResponse.json({ error: 'Checkout not configured (no POLAR_ACCESS_TOKEN)' }, { status: 503 });
  }

  try {
    const res = await fetch('https://api.polar.sh/v1/checkouts/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products: [productId],
        success_url: `${SITE}/onboarding?step=15&paid=1`,
        customer_email: email,
        metadata: { user_id: email, plan: planChoice },
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.url) {
      // Surface the exact Polar error so a shape/mode/product problem is
      // diagnosable rather than silent. The client will fall back to the static
      // link, so a failure here is not user-visible as a dead end.
      console.error('[checkout] Polar session create failed:', res.status, JSON.stringify(data).slice(0, 400));
      return NextResponse.json(
        { error: 'checkout_create_failed', status: res.status, detail: data },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: data.url });
  } catch (e) {
    console.error('[checkout] threw:', e?.message);
    return NextResponse.json({ error: 'checkout_exception', message: e?.message }, { status: 500 });
  }
}
