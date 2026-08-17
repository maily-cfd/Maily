import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

/**
 * Server-side access gate — ALL USERS HAVE FULL ACCESS.
 * Subscription/paywall removed. Only check is authentication.
 */
export async function requirePaidSubscription() {
  let session: any;
  try {
    // @ts-ignore — auth() is the NextAuth v5 server helper
    session = await auth();
  } catch {
    redirect('/auth/signin');
  }

  if (!session?.user?.email) {
    redirect('/auth/signin');
  }

  // All authenticated users have full access — no subscription check.
  return true;
}
