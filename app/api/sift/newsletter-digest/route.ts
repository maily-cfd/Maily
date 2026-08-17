import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
import { runNewsletterDigest } from '@/lib/boult/tools';
import { logEvent } from "@/lib/logsso";

export const maxDuration = 60;

/**
 * Sift newsletter digest — find the newsletters cluttering the inbox, condense
 * them into one digest, and (optionally) archive them out so the user's mind is
 * clear. Reuses the same engine as the Boult `digest_newsletters` tool.
 */
export async function POST(request: Request) {
  try {
    // @ts-ignore
    const session = await (auth as any)();
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const daysBack = typeof body?.daysBack === 'number' ? body.daysBack : 7;
    const archive = !!body?.archive;
    const sendEmail = !!body?.sendEmail;

    const result = await runNewsletterDigest(session.user.email, { daysBack, archive, sendEmail });

    return NextResponse.json({
      success: true,
      count: result.count,
      senders: result.senders,
      archived: result.archived,
      emailed: result.emailed,
      daysBack: result.daysBack,
      markdown: result.markdown,
    });
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    if (error?.message === 'GMAIL_NOT_CONNECTED') {
      return NextResponse.json({ success: false, error: 'Gmail is not connected.' }, { status: 400 });
    }
    console.error('💥 Newsletter digest failed:', error?.message || error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to build newsletter digest' },
      { status: 500 }
    );
  }
}
