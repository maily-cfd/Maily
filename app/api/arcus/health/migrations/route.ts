/**
 * F5 — Boult migration health check.
 *
 * GET /api/boult/health/migrations
 *
 * Probes Supabase for the existence of the tables Boult depends on. Returns
 * a structured JSON the settings card can read to show a red "memory not
 * configured" banner when a migration was never applied to the live project.
 *
 * Cheap probe: SELECT 1 with a LIMIT and head-only request — no rows read.
 * If the table is missing, the driver surfaces a 42P01 / PGRST205 error
 * which we map to `missing`.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUIRED_TABLES = [
  'boult_memories',
  'boult_agent_runs',
  'boult_agent_scratchpad',
  'boult_agents',
  'boult_delegation_rules',
] as const;

// Columns that must exist or a feature silently no-ops. The triggers migration
// (boult_agents_triggers_v1.sql) adds these — without it, every agent defaults
// to 'schedule' and event/condition/pipeline agents never fire, with no error.
const REQUIRED_COLUMNS: { table: string; column: string; feature: string }[] = [
  { table: 'boult_agents', column: 'trigger_type', feature: 'reactive/event/pipeline triggers' },
];

type TableStatus = 'ok' | 'missing' | 'error';

interface Probe {
  table: string;
  status: TableStatus;
  message?: string;
}

interface ColumnProbe {
  table: string;
  column: string;
  feature: string;
  status: TableStatus;
  message?: string;
}

async function probeTable(table: string): Promise<Probe> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .limit(1);

    if (!error) return { table, status: 'ok' };

    // PostgREST "relation does not exist" → 42P01 / PGRST205.
    const code = (error as any).code || '';
    const msg = error.message || '';
    if (
      code === '42P01' ||
      code === 'PGRST205' ||
      /does not exist|not found|schema cache/i.test(msg)
    ) {
      return { table, status: 'missing', message: msg };
    }
    return { table, status: 'error', message: msg };
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return { table, status: 'error', message: err?.message || 'probe failed' };
  }
}

async function probeColumn(table: string, column: string, feature: string): Promise<ColumnProbe> {
  try {
    const supabase = getSupabaseAdmin();
    // Selecting a single column head-only fails if the column doesn't exist.
    const { error } = await supabase.from(table).select(column, { head: true }).limit(1);
    if (!error) return { table, column, feature, status: 'ok' };
    const code = (error as any).code || '';
    const msg = error.message || '';
    if (code === '42703' || code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(msg)) {
      return { table, column, feature, status: 'missing', message: msg };
    }
    return { table, column, feature, status: 'error', message: msg };
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return { table, column, feature, status: 'error', message: err?.message || 'probe failed' };
  }
}

export async function GET() {
  const [probes, columnProbes] = await Promise.all([
    Promise.all(REQUIRED_TABLES.map(probeTable)),
    Promise.all(REQUIRED_COLUMNS.map(c => probeColumn(c.table, c.column, c.feature))),
  ]);
  const missing = probes.filter(p => p.status === 'missing').map(p => p.table);
  const errored = probes.filter(p => p.status === 'error');
  const missingColumns = columnProbes.filter(c => c.status === 'missing');
  const allOk = missing.length === 0 && errored.length === 0 && missingColumns.length === 0;

  return NextResponse.json({
    ok: allOk,
    missing,
    errored: errored.map(e => ({ table: e.table, message: e.message })),
    missingColumns: missingColumns.map(c => ({ table: c.table, column: c.column, feature: c.feature })),
    probes,
    columnProbes,
    checkedAt: new Date().toISOString(),
  }, {
    status: allOk ? 200 : 503,
  });
}
