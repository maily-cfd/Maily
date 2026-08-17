import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

async function getSupabase() {
  const { getSupabaseAdmin } = await import('../../../../lib/supabase.js');
  return getSupabaseAdmin();
}

// ── Supermemory secondary-store helpers ──────────────────────────────────────
//
// boult_memories (Supabase) is the SOURCE OF TRUTH. Supermemory mirrors
// writes/deletes when configured so semantic recall stays in sync. The UI
// reads from Supabase; the AI's mid-turn searchMemoriesRaw reads from both
// (Supabase first, Supermemory for semantic fuzz-match).

const SUPERMEMORY_BASE = 'https://api.supermemory.ai';

function getSupermemoryKey(): string | null {
  return process.env.SUPERMEMORY_API_KEY || process.env.DATAFAST_API_KEY || null;
}

async function supermemoryWrite(userId: string, content: string, tags?: string[]): Promise<void> {
  const key = getSupermemoryKey();
  if (!key) return;
  try {
    await fetch(`${SUPERMEMORY_BASE}/v3/memories`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content.slice(0, 2000),
        metadata: { userId, tags: tags ?? [] },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* secondary store — never fail the primary write on this */ }
}

// ── GET /api/agent-talk/memory — list memories from Supabase ────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  try {
    const supabase = await getSupabase();

    // Memory-enabled flag from user_profiles.preferences (unchanged behavior)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    const prefs = (profile?.preferences as Record<string, unknown>) || {};
    const memoryEnabled = prefs.boult_memory_enabled !== false;

    // Memories — durable, paginated
    const { data: rows } = await supabase
      .from('boult_memories')
      .select('id, content, tags, source, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);

    const memories = (rows || []).map((r: any) => ({
      id: r.id,
      content: r.content,
      tags: Array.isArray(r.tags) ? r.tags : [],
      source: r.source || 'ai',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    // The human portrait — "What Maily knows about you" (VIPs, your style,
    // what you delegate). The rich, felt understanding vs the raw memory log.
    // Fail-soft to '' so the memory list still renders if the model read fails.
    let founderModel = '';
    try {
      const { getUserModelSummary } = await import('../../../../lib/boult/user-model');
      founderModel = await getUserModelSummary(userId);
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* portrait is best-effort */ }

    return NextResponse.json({ memories, memoryEnabled, founderModel });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Memory API] GET error:', err.message);
    return NextResponse.json({ memories: [], memoryEnabled: true });
  }
}

// ── POST /api/agent-talk/memory ─────────────────────────────────────────────
//
// Two modes:
//   { memoryEnabled: boolean }          → toggle memory on/off
//   { content: string, tags?: string[] } → add a new memory manually

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  let body: any;
  try { body = await request.json(); }
  catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const supabase = await getSupabase();

  // Mode 1 — toggle flag
  if (typeof body.memoryEnabled === 'boolean') {
    const memoryEnabled = body.memoryEnabled;
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    const existingPrefs = (existing?.preferences as Record<string, unknown>) || {};
    const updatedPrefs = { ...existingPrefs, boult_memory_enabled: memoryEnabled };
    if (existing) {
      await supabase.from('user_profiles').update({ preferences: updatedPrefs }).ilike('user_id', userId);
    } else {
      await supabase.from('user_profiles').insert({ user_id: userId, preferences: updatedPrefs });
    }
    return NextResponse.json({ success: true, memoryEnabled });
  }

  // Mode 2 — manual add
  const content = (body.content || '').trim();
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: any) => typeof t === 'string').slice(0, 10) : [];

  const { data: inserted, error } = await supabase
    .from('boult_memories')
    .insert({
      user_id: userId,
      content: content.slice(0, 2000),
      tags,
      source: 'user',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mirror to Supermemory if configured (best-effort)
  supermemoryWrite(userId, content, tags).catch(() => {});

  return NextResponse.json({
    success: true,
    memory: {
      id: inserted.id,
      content: inserted.content,
      tags: inserted.tags,
      source: inserted.source,
      createdAt: inserted.created_at,
      updatedAt: inserted.updated_at,
    },
  });
}

// ── PUT /api/agent-talk/memory — edit a memory ──────────────────────────────

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  let body: any;
  try { body = await request.json(); }
  catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const memoryId = body.memoryId;
  const content = typeof body.content === 'string' ? body.content.trim() : null;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t: any) => typeof t === 'string').slice(0, 10) : null;

  if (!memoryId) return NextResponse.json({ error: 'memoryId required' }, { status: 400 });
  if (content === null && tags === null) {
    return NextResponse.json({ error: 'Provide content and/or tags to update' }, { status: 400 });
  }

  const supabase = await getSupabase();
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (content !== null) update.content = content.slice(0, 2000);
  if (tags !== null) update.tags = tags;

  const { data, error } = await supabase
    .from('boult_memories')
    .update(update)
    .eq('id', memoryId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Memory not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    memory: {
      id: data.id,
      content: data.content,
      tags: data.tags,
      source: data.source,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

// ── DELETE /api/agent-talk/memory — delete one memory ───────────────────────

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email.toLowerCase();

  let body: any;
  try { body = await request.json(); }
  catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const memoryId = body.memoryId;
  if (!memoryId) return NextResponse.json({ error: 'memoryId required' }, { status: 400 });

  const supabase = await getSupabase();
  const { error } = await supabase
    .from('boult_memories')
    .delete()
    .eq('id', memoryId)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
