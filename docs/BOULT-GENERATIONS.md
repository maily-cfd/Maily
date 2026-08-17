# Boult — The Three Generations (map of what's live)

> **Read this before refactoring anything under `lib/boult*`.**
> Boult grew in three overlapping generations. All three are currently **live** —
> each one backs a different user-facing surface. None is dead code you can
> delete mechanically. "Consolidating" them is a *product* decision (which
> surface wins), not a safe cleanup.
>
> Verified state at time of writing (2026-06-08): `tsc --noEmit` = 0 errors,
> `next build --webpack` = exit 0. The system **builds and runs**. The problem is
> sprawl, not breakage.

---

## Generation 1 — Legacy flat JS (`lib/boult-*.js`)

~60 flat files at the root of `lib/` (e.g. `boult-ai.js`, `boult-planner.js`,
`boult-plan-engine.js`, `boult-operator-runtime*.js`, `boult-executor-engine.js`,
`boult-agent-loop.js`, `boult-multi-agent-*.js`).

**Still imported by exactly 4 routes** (everything else has moved off it):

| Route | Imports |
|-------|---------|
| `app/api/agent-talk/chat-boult-v2/route.ts` | `boult-ai.js`, `boult-agent-loop.js` |
| `app/api/boult/execute/route.ts` | `boult-executor-engine` |
| `app/api/boult/plan/route.ts` | `boult-planner` |
| `app/api/nudges/route.js` | `boult-ai.js` |

**Status:** legacy but load-bearing. Retire only after those 4 routes are
migrated or removed. Do **not** delete the modules while these imports exist.

---

## Generation 2 — `lib/boult/` (TypeScript) — **THE LIVE AGENT PATH**

This is the generation behind the scheduled "while you sleep" agents — the
product the recent PART 80–84 commits have been shipping.

**Entry → exit chain:**

```
GET /api/cron/run-agents                 (cron-job.org / Vercel cron trigger)
  └─ lib/boult/run-agent.ts              runAgentTask()
       └─ lib/boult/multi-va/orchestrator.ts   runAgentAsCommittee()  (fan out ≤5 VAs)
            └─ lib/boult/multi-va/va-runner.ts  runVA()  (one VA each, parallel)
                 └─ lib/boult/loop.ts            runAgentLoop()  (SSE agentic loop)
                      └─ lib/boult/tools.ts      executeTool() + getAvailableTools()
       └─ lib/boult/multi-va/aggregator.ts       buildCommitteeReport()
```

**Supporting modules:** `memory.ts` (dual-writes Supabase `boult_memories` +
Supermemory), `system-prompt.ts`, `orchestrator.ts` (typed `buildExecutionPlan`),
`intent-classifier.ts`, `inbox-pipeline.ts`, `agent-approvals.ts`,
`signal-density.ts`.

**Also serves** the `/api/boult/agents/*` settings + run-history routes and the
interactive `/api/boult/chat` route.

**Status:** canonical for scheduled agents. This is the path to extend when the
ask is "agents do X."

---

## Generation 3 — `lib/boult-v3/` (TypeScript) — separate product surface

A self-contained runtime with its own dispatcher/executor/handlers/normalizers
and its **own** `schema.sql`.

**Backs the entire `/api/boult/v3/*` surface + the `/boult-v3` page:**

- `app/api/boult/v3/chat`, `/trigger`, `/plans/*`, `/preferences`, `/audit`,
  `/integrations`
- `app/api/boult/v3/oauth/*` (gmail / gcal / notion / slack OAuth)
- `app/api/boult/v3/webhooks/{gcal,slack}`
- `app/api/boult/v3/cron/{plan-mode,poll-notion,renew-channels}`
- `app/boult-v3/page.tsx` + its hooks/components

**Status:** live and independent. Its OAuth + webhooks are wired separately from
Generation 2. Touching it does not affect scheduled agents and vice versa.

---

## Schema — where the tables are defined

| Table | Defined in | Notes |
|-------|-----------|-------|
| `boult_agents` | `supabase/migrations/boult_agents.sql` (canonical, added 2026-06) **and** `lib/boult-v3/schema.sql` | Previously ONLY in the v3 schema file; now also a proper migration. |
| `boult_agent_runs` | `supabase/migrations/boult_agent_runs.sql` | Base columns. |
| `boult_agent_runs.signal_score`, `.delivery_decision` | `supabase/migrations/boult_agent_runs_part60_signal.sql` (added 2026-06) | PART 60 wrote these columns before any migration created them — the write silently failed until this migration landed. |
| `boult_memories`, `boult_audit_log`, `boult_agent_pending_actions`, `boult_canvas_state`, `boult_contacts_and_rules`, `boult_gmail_scope_cache`, `boult_session_approvals`, `boult_agent_scratchpad` | `supabase/migrations/*.sql` | One file each. |
| `boult_integrations`, `boult_plans`, `boult_plan_steps`, `boult_events_queue`, `boult_briefs` | `lib/boult-v3/schema.sql` only | Generation-3 tables; not yet mirrored into `supabase/migrations/`. |

---

## If you want to actually consolidate

It's a product call, in this order of safety:

1. **Safe now:** keep all three; treat Generation 2 (`lib/boult/`) as canonical
   for new agent work; stop adding to Generations 1 and 3.
2. **Medium:** migrate the 4 legacy-`.js` routes off Generation 1, then delete
   `lib/boult-*.js`. Verify with `next build --webpack` after — webpack resolves
   dynamic `import()` at build time, so a missed reference fails the build, not tsc.
3. **Large:** decide whether `/boult-v3` (Generation 3) or the agents surface
   (Generation 2) is the future, and retire the loser. This deletes a live
   user-facing surface — needs an explicit product decision first.
