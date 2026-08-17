/**
 * Agent chaining / pipelines (Phase 1).
 *
 * A pipeline is an ordered list of child agent ids on the parent
 * (boult_agents.pipeline). When a parent run succeeds, each child is handed off
 * via a row in boult_events_queue with source='chain' — the parent's summary +
 * artifact links become the child's chain_input. The v1 cron (run-agents) is the
 * SOLE consumer; it drains these rows next tick. We INSERT directly (not via
 * enqueueEvent) so we never invoke the separate v3 reasoning pipeline.
 *
 * Loop safety: MAX_CHAIN_DEPTH caps how deep a pipeline can go, and a `visited`
 * set of agent ids prevents A→B→A cycles.
 */

const MAX_CHAIN_DEPTH = 4;

export interface ChainPayload {
  childId: string;
  parentAgentId: string;
  parentRunId: string | null;
  chainDepth: number;
  visited: string[];
  summary: string;
  artifactLinks: any;
}

export interface DrainedChild {
  agentId: string;
  queueRowId: string;
  chainInput: { summary: string; artifactLinks: any; parentAgentId: string };
  parentRunId: string | null;
  chainDepth: number;
  visited: string[];
}

/**
 * Enqueue one chain hand-off from a finished parent run to a child agent.
 * Returns false (silently) when the depth cap is hit or a cycle is detected.
 */
export async function enqueueChainHandoff(
  supabase: any,
  userId: string,
  payload: ChainPayload,
): Promise<boolean> {
  if (payload.chainDepth >= MAX_CHAIN_DEPTH) {
    console.warn(`[chain] depth cap hit (${payload.chainDepth}); not enqueuing ${payload.childId}`);
    return false;
  }
  if (payload.visited.includes(payload.childId)) {
    console.warn(`[chain] cycle detected; ${payload.childId} already visited`);
    return false;
  }

  // Dedup so the same parent_run → child isn't enqueued twice in one tick.
  const dedupKey = `chain:${payload.parentRunId || payload.parentAgentId}:${payload.childId}`;
  try {
    const { data: existing } = await supabase
      .from('boult_dedup_cache')
      .select('dedup_key')
      .eq('dedup_key', dedupKey)
      .maybeSingle();
    if (existing) return false;
    await supabase.from('boult_dedup_cache').insert({
      dedup_key: dedupKey,
      expires_at: new Date(Date.now() + 3600_000).toISOString(), // 1h TTL
    });
  } catch { /* dedup is best-effort; continue */ }

  const { error } = await supabase.from('boult_events_queue').insert({
    user_id: userId,
    source: 'chain',
    event_type: 'handoff',
    payload,
    status: 'pending',
  });
  if (error) {
    console.error('[chain] enqueue failed:', error.message);
    return false;
  }
  return true;
}

/**
 * Drain pending chain hand-offs. Marks each row 'completed' (claiming it so a
 * concurrent tick can't double-run it) and returns the child agents to run with
 * their chain input. Does NOT load the child rows — the caller does that against
 * its own paid/expiry/status gate.
 */
export async function drainChainQueue(supabase: any): Promise<DrainedChild[]> {
  try {
    const { data: rows } = await supabase
      .from('boult_events_queue')
      .select('id, user_id, payload')
      .eq('source', 'chain')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(25);

    if (!rows?.length) return [];

    const out: DrainedChild[] = [];
    for (const row of rows) {
      // Claim the row up front so a parallel tick won't pick it up.
      const { error: claimErr } = await supabase
        .from('boult_events_queue')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'pending');
      if (claimErr) continue;

      const p = row.payload || {};
      if (!p.childId) continue;
      out.push({
        agentId: p.childId,
        queueRowId: row.id,
        chainInput: { summary: p.summary || '', artifactLinks: p.artifactLinks || null, parentAgentId: p.parentAgentId || '' },
        parentRunId: p.parentRunId || null,
        chainDepth: Number(p.chainDepth) || 0,
        visited: Array.isArray(p.visited) ? p.visited : [],
      });
    }
    return out;
  } catch (err: any) {
    console.error('[chain] drain failed:', err?.message);
    return [];
  }
}

export { MAX_CHAIN_DEPTH };
