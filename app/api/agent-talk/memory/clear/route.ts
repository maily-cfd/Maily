import { NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

const SUPERMEMORY_BASE = 'https://api.supermemory.ai';

function getSupermemoryKey(): string | null {
  return process.env.SUPERMEMORY_API_KEY || process.env.DATAFAST_API_KEY || null;
}

/**
 * POST /api/agent-talk/memory/clear
 *
 * Wipes ALL memories for the authenticated user from:
 *   1. boult_memories (Supabase) — the source of truth
 *   2. Supermemory (if configured) — best-effort mirror cleanup
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  let supabaseCount = 0;
  try {
    const { getSupabaseAdmin } = await import('../../../../../lib/supabase.js');
    const supabase = getSupabaseAdmin();
    const { count } = await supabase
      .from('boult_memories')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    supabaseCount = count || 0;
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Memory Clear] Supabase error:', err.message);
  }

  // Best-effort Supermemory cleanup (won't fail the response if missing)
  const key = getSupermemoryKey();
  if (key) {
    try {
      await fetch(`${SUPERMEMORY_BASE}/v3/memories/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { userId } }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* silent */ }
  }

  return NextResponse.json({ success: true, cleared: supabaseCount });
}
