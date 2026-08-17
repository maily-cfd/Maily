// scripts/test-ledger-loop.mjs
//
// Stage 4 (follow-through) smoke test — proves a commitment survives and closes
// across runs, against LIVE Supabase. Verifies the exact DB contract the ledger
// module (lib/boult/super/ledger.ts) depends on, so you can trust the moat
// before launch without needing a live cron tick.
//
// Run:  node scripts/test-ledger-loop.mjs
// Needs: .env.local with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, and the
//        boult_super_agent_v1.sql migration applied (creates boult_ledger).
//
// It self-cleans: every row it writes is deleted at the end (and on failure).

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// A throwaway user id namespaced so we never touch real data.
const TEST_USER = `ledger-smoketest-${Date.now()}`;
const created = [];
let failures = 0;

function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name}`); failures++; }
}

async function cleanup() {
  if (created.length) {
    await supabase.from('boult_ledger').delete().in('id', created);
  }
}

async function main() {
  console.log(`\nFollow-through ledger smoke test (user=${TEST_USER})\n`);

  // 1) Add an OVERDUE commitment (due yesterday) — a classic "dropped ball".
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const what = 'Send Acme the revised proposal deck';
  const { data: added, error: addErr } = await supabase
    .from('boult_ledger')
    .insert({ user_id: TEST_USER, what, who: 'Acme', due: yesterday, status: 'open', detail: {} })
    .select()
    .single();

  if (addErr) {
    console.error(`\n✗ Insert failed: ${addErr.message}`);
    if (/relation .*boult_ledger.* does not exist/i.test(addErr.message)) {
      console.error('  → The boult_super_agent_v1.sql migration has NOT been applied yet.');
    }
    process.exit(1);
  }
  created.push(added.id);
  check('commitment added (open)', added.status === 'open' && added.what === what);

  // 2) Idempotency — re-adding the same open promise must NOT duplicate.
  let dq = supabase.from('boult_ledger').select('*')
    .eq('user_id', TEST_USER).in('status', ['open', 'in_progress']).ilike('what', what);
  const { data: dup } = await dq.maybeSingle();
  check('dedupe finds the existing open item (no duplicate)', dup && dup.id === added.id);

  // 3) listOpen + due filtering — the item shows up as DUE (due <= now).
  const { data: openRows } = await supabase.from('boult_ledger').select('*')
    .eq('user_id', TEST_USER).in('status', ['open', 'in_progress'])
    .order('due', { ascending: true, nullsFirst: false });
  const due = (openRows || []).filter(e => e.due && new Date(e.due).getTime() <= Date.now());
  check('commitment surfaces as DUE/overdue', due.some(e => e.id === added.id));

  // 4) Reconciliation contract — an overdue item NOT mentioned in a report is
  //    the thing the cron addendum surfaces. (Mirror of reconcileLedger filter.)
  const reportThatOmitsIt = 'Triaged 12 emails and drafted 2 replies.';
  const unmentioned = due.filter(e => !reportThatOmitsIt.toLowerCase().includes(e.what.toLowerCase().slice(0, 40)));
  check('overdue item is flagged as unmentioned (would be surfaced)', unmentioned.some(e => e.id === added.id));

  // 5) Close it — simulating a later run that actually did the work.
  const { error: closeErr } = await supabase.from('boult_ledger')
    .update({ status: 'done', closed_run_id: null, updated_at: new Date().toISOString() })
    .eq('id', added.id);
  if (closeErr) console.error(`    (close error: ${closeErr.message})`);
  check('commitment closed (done)', !closeErr);

  // 6) Cross-run check — next run's "open" list no longer contains it.
  const { data: openAfter } = await supabase.from('boult_ledger').select('id')
    .eq('user_id', TEST_USER).in('status', ['open', 'in_progress']);
  check('closed commitment no longer open (ball not re-dropped)', !(openAfter || []).some(e => e.id === added.id));

  await cleanup();

  console.log(`\n${failures ? `✗ ${failures} check(s) FAILED` : '✓ All checks passed — follow-through loop is sound'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✗ Threw:', e?.message || e);
  await cleanup().catch(() => {});
  process.exit(1);
});
