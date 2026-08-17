/**
 * GET /api/gmail/drafts/for-thread?threadId=...
 *
 * "Does this thread already have a draft?" — used by the home-feed's Needs a
 * Reply CTA so it never sends a person straight to Boult when a reply has
 * already been drafted (by the user, or a prior Boult pass). If one exists,
 * the client opens the Inbox tab's existing draft-reply box with this content
 * instead of prefilling a new Boult prompt.
 *
 * Fail-soft by design: any error, missing session, or no match returns
 * { exists: false } with a 200 — the caller's fallback (send to Boult) is
 * always safe, so this endpoint must never be the reason a click does nothing.
 */
import { NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '@/lib/auth.js';
import { GmailService } from '@/lib/gmail';
import { logEvent } from '@/lib/logsso';

const auth: any = nextAuth;
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// Bounded pagination — a few hundred drafts covers virtually every real inbox;
// capping pages keeps a single click from stalling on a huge Drafts folder.
const MAX_PAGES = 3;
const PAGE_SIZE = 100;

export async function GET(req: Request) {
  try {
    const session: any = await auth();
    const accessToken = session?.accessToken;
    const threadId = new URL(req.url).searchParams.get('threadId');
    if (!accessToken || !threadId) {
      return NextResponse.json({ exists: false });
    }

    const gmailService: any = new GmailService(accessToken, session?.refreshToken || '');
    if (session?.user?.email) gmailService.setUserEmail(session.user.email);

    let pageToken: string | null = null;
    let match: any = null;
    for (let page = 0; page < MAX_PAGES && !match; page++) {
      const res: any = await gmailService.listDrafts(PAGE_SIZE, pageToken);
      const items: any[] = Array.isArray(res?.drafts) ? res.drafts : [];
      match = items.find((d) => d?.message?.threadId === threadId) || null;
      pageToken = res?.nextPageToken || null;
      if (!pageToken) break;
    }

    if (!match) {
      return NextResponse.json({ exists: false });
    }

    const full = await gmailService.getDraft(match.id);
    const parsed = gmailService.parseEmailData(full.message);
    return NextResponse.json({
      exists: true,
      draftId: match.id,
      to: parsed.to,
      subject: parsed.subject,
      body: parsed.body,
      isHtml: parsed.isHtml,
    });
  } catch (err: any) {
    logEvent({ channel: 'failures', event: '❌ API Error', description: String(err?.message || err) });
    return NextResponse.json({ exists: false });
  }
}
