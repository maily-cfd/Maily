/**
 * Durable Today dismissals.
 *
 *   POST   /api/home-feed/dismiss   { itemId, itemType? }  → dismiss (persist)
 *   DELETE /api/home-feed/dismiss   { itemId }             → undo a dismissal
 *
 * The Today route filters these out server-side, so a dismissed item never comes
 * back from the API — and it syncs across devices (was localStorage-only).
 */
import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
// @ts-ignore
import { getSupabaseAdmin } from '@/lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

// Archive (remove INBOX) or un-archive (add INBOX) a Gmail thread. Best-effort —
// dismissal persistence never depends on it. Reuses the same refreshing token layer
// the rest of the app uses, so it works for the live Google sign-in token.
async function modifyThreadInbox(userId: string, threadId: string, archive: boolean): Promise<void> {
  if (!threadId) return;
  try {
    const { getGmailToken, refreshGoogleToken, googleFetch } = await import('@/lib/boult/tools/http-tokens');
    let token = await getGmailToken(userId);
    if (!token) return;
    const body = JSON.stringify(archive ? { removeLabelIds: ['INBOX'] } : { addLabelIds: ['INBOX'] });
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`;
    let res = await googleFetch(userId, 'gmail', url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    if (res.status === 401) {
      const fresh = await refreshGoogleToken(userId);
      if (fresh) res = await googleFetch(userId, 'gmail', url, { method: 'POST', headers: { Authorization: `Bearer ${fresh}`, 'Content-Type': 'application/json' }, body });
    }
    if (!res.ok) console.warn('[home-feed/dismiss] thread modify failed:', res.status);
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.warn('[home-feed/dismiss] archive error:', e?.message);
  }
}

export async function POST(req: Request) {
  // @ts-ignore
  const session = await (auth as any)();
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user.email as string).toLowerCase();

  const body = await req.json().catch(() => ({}));
  const itemId = String(body.itemId || '').trim();
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  const itemType = typeof body.itemType === 'string' ? body.itemType : null;
  const threadId = typeof body.threadId === 'string' ? body.threadId : '';

  try {
    const supabase = getSupabaseAdmin();
    // Persist the dismissal AND archive the email thread (email items only) in
    // parallel. Archive = "moved out of this queue / handled", never a delete; the
    // undo path re-adds INBOX. Persistence is authoritative even if archive fails.
    const archive = (itemType === 'decide' || itemType === 'chase') && threadId
      ? modifyThreadInbox(userId, threadId, true)
      : Promise.resolve();
    await Promise.all([
      supabase.from('boult_today_dismissals').upsert({ user_id: userId, item_id: itemId, item_type: itemType }, { onConflict: 'user_id,item_id' }),
      archive,
    ]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    // Non-fatal — the client still hides it optimistically this session.
    console.warn('[home-feed/dismiss] failed:', e?.message);
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 200 });
  }
}

export async function DELETE(req: Request) {
  // @ts-ignore
  const session = await (auth as any)();
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user.email as string).toLowerCase();

  const body = await req.json().catch(() => ({}));
  const itemId = String(body.itemId || '').trim();
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  const threadId = typeof body.threadId === 'string' ? body.threadId : '';

  try {
    const supabase = getSupabaseAdmin();
    // Undo: drop the dismissal record AND move the thread back to the inbox.
    await Promise.all([
      supabase.from('boult_today_dismissals').delete().eq('user_id', userId).eq('item_id', itemId),
      threadId ? modifyThreadInbox(userId, threadId, false) : Promise.resolve(),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 200 });
  }
}
