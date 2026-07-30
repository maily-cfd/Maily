import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth';
// @ts-ignore
import { GmailService } from '@/lib/gmail';
import { getGmailToken } from '@/lib/arcus/tools/http-tokens';
import { logEvent } from "@/lib/logsso";

/**
 * POST /api/onboarding/scan
 *
 * Reads the user's REAL inbox and returns EXACT counts for the First Scan /
 * Scan Results screens. Uses the same Gmail token resolution as Arcus
 * (arcus_integrations / Composio / user_tokens) — not session-only tokens.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE = 500;
const MAX_PAGES = 12;

/** Count messages matching `query` by paginating ids. */
async function countExact(
  accessToken: string,
  userId: string,
  query: string,
  maxPages = MAX_PAGES,
): Promise<{ count: number; capped: boolean }> {
  const gmail: any = new GmailService(accessToken, '');
  gmail.setUserEmail?.(userId);

  let count = 0;
  let pageToken: string | null = null;
  let pages = 0;

  do {
    const res: any = await gmail.getEmails(PAGE, query, pageToken);
    const msgs = Array.isArray(res?.messages) ? res.messages : [];
    count += msgs.length;
    pageToken = res?.nextPageToken || null;
    pages++;
    if (pages >= maxPages && pageToken) {
      return { count, capped: true };
    }
  } while (pageToken);

  return { count, capped: false };
}

export async function POST() {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();

    const accessToken = await getGmailToken(userId);
    if (!accessToken) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 403 });
    }

    const WINDOW = 30;

    const queries = {
      received: 'newer_than:30d -in:sent -in:chats -in:drafts -in:trash -in:spam',
      unanswered: 'in:inbox is:unread newer_than:30d -category:promotions -category:social -category:updates -category:forums',
      automated: 'newer_than:30d (category:promotions OR category:social OR category:updates OR category:forums)',
    };

    const [recvR, unansR, autoR] = await Promise.allSettled([
      countExact(accessToken, userId, queries.received),
      countExact(accessToken, userId, queries.unanswered, 8),
      countExact(accessToken, userId, queries.automated),
    ]);

    const pick = (r: PromiseSettledResult<{ count: number; capped: boolean }>) =>
      r.status === 'fulfilled' ? r.value : null;

    const received = pick(recvR);
    const unanswered = pick(unansR);
    const automated = pick(autoR);

    if (!received || !unanswered || !automated) {
      const failed = {
        received: received == null,
        unanswered: unanswered == null,
        automated: automated == null,
      };
      logEvent({
        channel: 'failures',
        event: 'onboarding_scan_partial',
        description: JSON.stringify(failed),
      });
      return NextResponse.json(
        { error: 'Inbox scan failed', failed },
        { status: 502 },
      );
    }

    const recvN = received.count;
    const unansN = unanswered.count;
    const minutes = recvN * 0.5 + unansN * 4;
    const hoursPerWeek = Math.round((minutes / 60 / 4.3) * 10) / 10;

    return NextResponse.json({
      success: true,
      scannedAt: Date.now(),
      windowDays: WINDOW,
      received: recvN,
      receivedCapped: received.capped,
      unanswered: unansN,
      unansweredCapped: unanswered.capped,
      automated: automated.count,
      automatedCapped: automated.capped,
      hoursPerWeek,
    });
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('❌ [Onboarding] Scan failed:', error);
    return NextResponse.json({ error: 'Inbox scan failed' }, { status: 500 });
  }
}
