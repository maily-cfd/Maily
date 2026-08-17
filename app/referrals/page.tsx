/**
 * /referrals — the share screen.
 *
 * DESIGN INTENT
 * The old system's failure wasn't the payout, it was that nobody could FIND
 * their link, and the reward was credits in a product with no free tier. Two
 * things fix that, and this page is built around them:
 *
 *  1. Lead with what the FRIEND gets, not what you get. "Give a free month"
 *     is a gift you're passing on; "earn rewards" is you selling to your family.
 *     Only one of those gets sent in a group chat.
 *
 *  2. Remove every step between intent and sent. Pre-written message, one tap
 *     per channel, native share sheet on mobile. Nobody composes their own copy.
 */

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
// @ts-ignore — JS module
import { auth as nextAuth } from '@/lib/auth.js';
import { getReferralStats } from '@/lib/referrals';
import ReferralShare from './ReferralShare';

const auth: any = nextAuth;
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Give a free month · Maily',
  description: 'Give a friend a free month of Maily. Get a free month when they stay.',
};

export default async function ReferralsPage() {
  const session = await auth();
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/referrals');

  const origin = process.env.NEXTAUTH_URL || 'https://maily.dev';
  const stats = await getReferralStats(session.user.email, origin);

  return (
    <Suspense>
      <ReferralShare stats={stats} firstName={(session.user.name || '').split(' ')[0] || null} />
    </Suspense>
  );
}
