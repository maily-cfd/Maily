import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

/**
 * /invite/<code> — the link people actually paste into WhatsApp.
 *
 * Two things changed from the original:
 *
 * 1. It used to redirect to `/`. Someone who clicked a friend's invite landed on
 *    the marketing homepage and had to find the signup button themselves — the
 *    highest-intent moment in the whole funnel, spent on a scroll. It now goes
 *    straight to signup with the offer carried through.
 *
 * 2. The cookie was httpOnly:false, so any page script could set its own
 *    referral code before signing up. Attribution is read server-side in the
 *    auth callback, so the browser never needs to see it.
 *
 * The code is deliberately NOT validated against the database here: a lookup on
 * every click turns this route into a free oracle for guessing valid codes. An
 * unknown code simply fails attribution later, silently, which is correct.
 */
export async function GET(request, { params }) {
  let code = '';
  try {
    const { id } = await params;
    // New codes are 6 chars from a fixed alphabet, but LEGACY links are
    // /invite/<username-or-email-prefix> and can contain dots, plus and
    // hyphens ("maily.cfd"). A strict [A-Z0-9] test silently dropped every
    // one of those before the cookie was even set. Case is preserved here —
    // resolveCode uppercases for the code table and lowercases for the legacy
    // lookup, so normalising either way at this layer would break the other.
    code = String(id || '').trim().slice(0, 64);
    if (!/^[A-Za-z0-9._+-]{2,64}$/.test(code)) code = '';

    if (code) {
      const cookieStore = await cookies();
      cookieStore.set('maily_referral', code, {
        maxAge: 30 * 24 * 60 * 60, // 30 days — a friend rarely signs up the same hour
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        httpOnly: true,
      });
    }
  } catch (error) {
    console.error('[invite] failed to set referral cookie:', error?.message);
  }

  // redirect() throws internally, so it must sit OUTSIDE the try above —
  // inside, the catch would swallow it and the route would return nothing.
  redirect(code ? `/auth/signup?ref=${encodeURIComponent(code)}` : '/auth/signup');
}
