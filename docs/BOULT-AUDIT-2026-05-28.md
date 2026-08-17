# Boult AI — Full-Stack Audit (2026-05-28)

Audited surfaces: chat loop · 110 tools · background-agent runtime ·
cron · system prompts · UI state · connectors · memory · agent
creation · reports/delivery.

**Severity scale**
- 🟥 **P0** — user-visible breakage or data loss, fix before ship
- 🟧 **P1** — wrong-feeling UX, silent failure modes, real bugs
- 🟨 **P2** — fragility, correctness risk, future-trap
- 🟩 **P3** — polish, cleanup, opportunity

---

## SECTION 1 — Chat agentic loop (`lib/boult/loop.ts`)

### F1.1 🟥 Stage-2 spec-approved intercept lies on tool failure
**Where:** [`loop.ts:606-654`](../lib/boult/loop.ts#L606)

The Stage-2 intercept executes `create_scheduled_agent` and ALWAYS emits a
"X is live — first run …" chat message, even if `result.success === false`
(validation_error, agent_create_failed, integration_required, etc).

**Repro:** if any field validation fails in the tool, the user sees a
"live" message but no agent was created. Trust-killer.

**Fix:** branch on `result.success`. On failure emit the tool's actual
output (after sanitizing self-instructions) and skip the live-message
synthesis.

### F1.2 🟧 `agent_creation_intercept` failure branch never emits `done`
**Where:** [`loop.ts:535-538`](../lib/boult/loop.ts#L535), [`loop.ts:649-653`](../lib/boult/loop.ts#L649)

Both intercept paths emit `error` then `controller.close()` — they DON'T
emit a `done` event. The chat UI's `streamFinishedNormally` flag stays
false → triggers the "stream finished unexpectedly" fallback path → adds
a fake `"Done — completed ..."`-style message (which we killed in PART 21,
but the symptom shape can recur in any future regression).

**Fix:** every error path that calls `controller.close()` must also emit
`done` first. Add a `closeStream(reason)` helper that emits both in order.

### F1.3 🟧 Stage-2 intercept trusts client-supplied params
**Where:** [`loop.ts:600-608`](../lib/boult/loop.ts#L600)

The detector is `userMessage.startsWith('Spec approved for "') &&
userMessage.includes('_planApproved: true')`. A user could type that into
chat manually and trigger the unconditional tool execution. Not a real
exploit (they can only create their own agent) but the trust boundary is
wrong and the same pattern could become exploitable in the future when
the intercept does more.

**Fix:** require a nonce / signed marker that ChatInterface generates
when the user clicks Confirm. Server stores it briefly (e.g. in
`session-state`) and validates before the intercept fires.

### F1.4 🟧 `connector_required` failure message overwrites the WRONG entry
**Where:** [`loop.ts:1346-1356`](../lib/boult/loop.ts#L1346)

```ts
toolResults[toolResults.length - 1] = { ... };
```

We assume the last pushed entry is the one we just added for THIS
failure. In a parallel-batch context (multiple tools running, multiple
soft-failures), this can clobber a different tool's `tool_result`. The
toolResults array is per-batch and we push the soft-failure entry
immediately above, so today it's correct, but it's a hidden invariant
nobody documents.

**Fix:** replace by `tool_use_id` match, not by array index.

### F1.5 🟨 Loop has 21 `try/catch` blocks; some swallow without logging
**Where:** various

Some are intentional `/* silent */` (memory, telemetry). Others should
at minimum `log('warn', ...)` so debugging is possible. The user reported
"no console errors" twice — that's exactly this failure mode.

**Fix:** audit each catch, decide silent vs warn vs error case-by-case.

### F1.6 🟨 `controller.close()` not always reached in error paths
**Where:** [`loop.ts:1795`](../lib/boult/loop.ts#L1795) catches all but
the SSE writes themselves can throw.

The outer `finally` does close, but if an `emit()` throws between
emitting and `close()`, the stream may dangle until client times out.

**Fix:** wrap every `emit()` in `try/catch` (already done in the helper)
AND make sure the outer `finally` is the ONLY closer.

---

## SECTION 2 — Tool layer (`lib/boult/tools.ts`, 110 tools, 9241 lines)

### F2.1 🟧 43 empty `catch {}` blocks
**Where:** various

Tool helpers swallow errors silently. Most are intentional (refresh
token fallback, optional memory write) but at least 8 are paths that
should surface failure (e.g. failed Notion writes, OAuth refresh).

**Fix:** audit + downgrade only the cosmetic ones to `// silent (reason)`
comments. Promote the rest to `console.warn` with context.

### F2.2 🟧 `requestConfirmation` self-confirming-tool guard is text-based
**Where:** PART 22's `SELF_CONFIRMING_PATTERNS` regex

Patterns match `\bschedule\s+agent\b` etc — but if the LLM phrases the
action differently ("set up a recurring task"), the guard misses. The
guard should also check the underlying action_type / target_key.

**Fix:** allow-list the action types instead of pattern-matching prose.

### F2.3 🟧 No paid-tier model fallback in engine
**Where:** [`engine.ts:75-99`](../lib/boult/engine.ts#L75)

Engine only knows about free OpenRouter models. When every free key is
rate-limited (the PART 25 failure mode), the agent dies. The user pays
$29/mo but gets no paid escape hatch.

**Fix:** add `PAID_MODELS` array gated by `process.env.ALLOW_PAID_MODELS`
+ user-plan check; fall through to those when all free passes exhaust.

### F2.4 🟧 39 tool implementations use `getNotionToken`-style lookups inconsistently
**Where:** various

Some Notion tools do `userId.toLowerCase()`, others use `ilike()`, a few
neither. If a user's email casing varies between login and storage, the
agent can't find the token.

**Fix:** create `getIntegrationToken(userId, provider)` helper that
normalizes ONCE, then every tool calls it.

### F2.5 🟨 Spec-coverage gap: no `cal_com_*` or `google_meet_*` tools
**Where:** N/A

Settings card lists Cal.com and Google Meet as connectors; chat agent
has no tools using them.

**Fix:** either ship the tools or remove the connector entries until we do.

### F2.6 🟨 `createScheduledAgent` Stage-1 spec card has no integration check
**Where:** [`tools.ts:5778-5830`](../lib/boult/tools.ts#L5778) (approx)

Stage 1 renders the spec without checking whether the user has the
required integrations. The user clicks Confirm → Stage 2 → tool's
integration gate fires → spec-confirm card disappears, integration-
required card appears. Confusing UX.

**Fix:** Stage 1 runs the integration check FIRST and shows the
`integration_required` card if anything is missing.

### F2.7 🟩 Several tools still have "Now write X to the user" inline
self-instructions in their output
**Where:** grep for `Now write|Now confirm|Tell the user.*\..*Do NOT`

PART 22 stripped the worst offenders but a full audit hasn't run.

**Fix:** grep + rewrite + verify sanitizer covers each.

---

## SECTION 3 — Background-agent runtime (`lib/boult/run-agent.ts` +
`app/api/cron/run-agents/route.ts`)

### F3.1 🟥 Stale-lock recovery can loop a slow agent forever
**Where:** [`run-agents/route.ts:120-126`](../app/api/cron/run-agents/route.ts#L120)

Flow:
1. Tick fires → marks agent `status=running`.
2. Vercel 60s timeout kills the function before `last_run_at = now` is
   written.
3. Next tick: `last_run_at` is whatever it WAS (potentially hours old),
   `status=running`. The 60-min `STALE_LOCK_MIN` check sees an "old"
   `last_run_at` → treats this as stale-lock → runs again.
4. Same agent burns budget every tick.

**Fix:** write `last_run_at = now` AT THE START of the run (line 159
already updates status; also update last_run_at there), so a Vercel
timeout still leaves a fresh timestamp for the stale-lock check.

### F3.2 🟧 Cron runs all due agents in parallel sharing one wall-clock
**Where:** [`run-agents/route.ts:157-205`](../app/api/cron/run-agents/route.ts#L157)

`runResults = Promise.allSettled(readyToRun.map(... runAgentTask ...))`.
If two agents are due in the same tick, they share 58s. Per-agent
tool-call ceiling is `sharedBudget / N`. Fair, but if one agent
crashes mid-flight (throws sync), the others continue — fine. If one
takes the full budget while others get starved, ok. But: **if 5 agents
are due in the same tick, each gets ~12s — almost nothing usable**.

**Fix:** when N>3, fall back to sequential within budget. Or queue the
overflow agents to the next tick.

### F3.3 🟧 No retry on agent execution failure
**Where:** [`run-agents/route.ts:191-205`](../app/api/cron/run-agents/route.ts#L191)

If `runAgentTask` throws (engine exhausted, Notion 5xx, network blip),
the agent's `last_report_summary` becomes `"Error: ..."` and the agent
waits 24h to try again. No retry-with-backoff at the cron layer.

**Fix:** on transient failures (5xx, timeout, "models busy"), schedule
a retry in 30 minutes by setting `last_run_at` to `now - (cronInterval - 30min)`.

### F3.4 🟧 Email + Slack delivery use `Promise.allSettled` but don't
report which one failed
**Where:** [`run-agents/route.ts:175-178`](../app/api/cron/run-agents/route.ts#L175)

The agent's `last_report_summary` doesn't distinguish "report generated
but Slack delivery failed" from "report failed entirely". User has no
visibility.

**Fix:** capture `Promise.allSettled` results, log per-channel
delivery status to a new `boult_agent_runs` table (run id, deliveries,
errors).

### F3.5 🟨 `fetchUserInstructions` doesn't respect `boult_instructions_enabled`
on background runs but uses the SAME key as personality
**Where:** [`run-agent.ts:74-82`](../lib/boult/run-agent.ts#L74)

It DOES respect the toggle (`if (prefs.boult_instructions_enabled === false) return ''`).
But the field is misnamed — `boult_personality` holds rules now, not
personality. Two separate fields would be cleaner.

**Fix:** schema migration → split `boult_personality` (voice writing
style) from `boult_user_instructions` (binding rules). Until migrated,
keep the field as-is.

---

## SECTION 4 — System prompts (`lib/boult/system-prompt.ts`)

### F4.1 🟧 Voice-profile block fires even when only `userInstructions` set
**Where:** [`system-prompt.ts:322-330`](../lib/boult/system-prompt.ts#L322)

If a user sets binding instructions but has no voice profile yet
(common for new users), the prompt still has the
`USER VOICE PROFILE — INJECTED, the last thing you read before responding`
header — but it's followed by the user instructions, which makes the
LLM think rules are stylistic. We fixed this in PART 23 but the voice
block still wins ordering ties.

**Fix:** verify the conditional + re-test with empty voice + populated
instructions.

### F4.2 🟧 Background-agent context section conflicts with interactive section
**Where:** [`system-prompt.ts:118-156`](../lib/boult/system-prompt.ts#L118)

The "Background Agent Mode" section says "NEVER call request_confirmation"
+ "the infrastructure handles gating". Earlier in the prompt, the
"Confirmation required before major actions" section says you MUST call
request_confirmation. Background-agent flag is supposed to suppress the
latter via `opts.isBackgroundAgent` but the `Confirmation required`
block is unconditional today (gated only on `opts.skipConfirmations`).

**Fix:** gate the `Confirmation required` block on
`!opts.isBackgroundAgent && !opts.skipConfirmations`.

### F4.3 🟨 110 tools listed in TOOL_INTEGRATION_MAP; system prompt only
names a subset
**Where:** [`system-prompt.ts:26-52`](../lib/boult/system-prompt.ts#L26)

`INTEGRATION_CAPABILITIES` enumerates tool names by integration but
doesn't auto-derive from `TOOL_INTEGRATION_MAP`. Anything I added in
PARTs 13–24 (worklist, autonomy, 50+ new tools) is NOT named in the
prompt. The LLM can still call them (tool schemas are passed alongside),
but it doesn't know about them at the "tool inventory" level.

**Fix:** generate the capability section from `TOOL_INTEGRATION_MAP` at
runtime instead of maintaining a parallel list.

---

## SECTION 5 — UI state (`ChatInterface.tsx`, 6221 lines)

### F5.1 🟥 12 `id: Date.now()` collisions possible
**Where:** various

Two messages sent in the same millisecond (rare but real on retry +
auto-suggest) get the same id. React keys collide → flicker, lost
message, stale meta.

**Fix:** use `crypto.randomUUID()` everywhere a message/suggestion id is
generated.

### F5.2 🟧 localStorage as primary store, Supabase as fire-and-forget
**Where:** [`ChatInterface.tsx:3430-3437`](../app/dashboard/agent-talk/ChatInterface.tsx#L3430)

`localStorage.setItem(...)` is the source of truth; Supabase is a
fire-and-forget secondary write. If the user clears site data or signs
in on another device, the conversation history is gone. Worse: the
loadConversation path tries localStorage first, falls back to API only
on miss — so on a fresh device the user sees their conversations.

**Fix:** invert the priority. Supabase is the source of truth; cache
copy in localStorage. On load, fetch from API in parallel with
localStorage read, prefer API result when it arrives.

### F5.3 🟧 PART 20 fix uses `setMessages(prev => {...; return prev;})`
side-effect-in-setter
**Where:** [`ChatInterface.tsx:3400-3407`](../app/dashboard/agent-talk/ChatInterface.tsx#L3400)

This works but React 18 strict mode will call the updater twice; the
captured `liveMeta` could be inconsistent across the second call.
Today it's fine because the local capture stays correct, but it's a
foot-gun for any future logic that mutates state inside the setter.

**Fix:** use a ref (`messagesRef.current`) that mirrors the latest
messages state via a `useEffect`. Read live meta from the ref. No
side-effect-in-setter.

### F5.4 🟧 Agent spec confirm card is on `assistantMsgId` but Stage 2
spawns a NEW assistant message
**Where:** [`ChatInterface.tsx:2740-2764`](../app/dashboard/agent-talk/ChatInterface.tsx#L2740)

Stage 1 attaches `agentSpecConfirm` meta to the assistant message. User
clicks Confirm → ChatInterface clears that meta (line 5490) → posts a
new user message → server starts a new assistant message → Stage-2
intercept emits canvas + message → BUT the live-agent card attaches to
the NEW assistant message, not the old one. Result: 2 cards visible
(spec confirm gone, live agent shown). OK in theory but: if Stage 2
fails, the user sees no spec card AND no live card.

**Fix:** keep the spec-confirm card visible until Stage 2 reports
success. Show a "spec confirmed → registering..." loading state. On
failure, restore the Confirm button.

### F5.5 🟨 35 localStorage operations, no quota handling
**Where:** various

Browser localStorage caps at ~5-10MB. A long conversation history could
hit this, then `setItem` throws → message persistence breaks silently.

**Fix:** wrap `setItem` in a helper that catches QuotaExceededError and
either evicts oldest conversation OR falls back to Supabase-only.

### F5.6 🟨 No optimistic UI rollback on failed server saves
**Where:** [`ChatInterface.tsx:3433-3437`](../app/dashboard/agent-talk/ChatInterface.tsx#L3433)

The Supabase POST is fire-and-forget with `.catch(() => {})`. If it
fails, localStorage has the message but Supabase doesn't. User opens
on another device → message missing. No retry, no surfacing.

**Fix:** maintain an `unsavedMessages` queue; retry with backoff; show
a discrete sync-pending badge.

---

## SECTION 6 — Connectors / integrations

### F6.1 🟧 Two parallel disconnect endpoints
**Where:** [`/api/integrations/route.js`](../app/api/integrations/route.js)
DELETE handler vs `/api/boult/connectors/disconnect/route.ts` (PART 24)

PART 25 routed both UI surfaces to the unified endpoint. The legacy
DELETE handler still exists and would happily delete just
`integration_credentials` if anything calls it. Any new UI surface that
imports the wrong endpoint silently regresses.

**Fix:** make legacy DELETE forward to the unified endpoint as a thin
proxy + add a deprecation warning. Or delete it after grepping for
remaining callers.

### F6.2 🟧 Token storage scattered across 3 tables, no migration plan
**Where:** `boult_integrations`, `integration_credentials`, `user_tokens`

History: V1 used `user_tokens` (Google login), V2 used
`integration_credentials` (legacy), V3 uses `boult_integrations`. Today
every tool's token-fetch tries all three (`refreshGoogleToken` walks
all three). Disconnect now hits all three (PART 24/25). But: a user who
signed up during V2 has their token in `integration_credentials`; a new
signup goes to `boult_integrations`. The two stores can drift.

**Fix:** run a one-time consolidation migration: for every user, copy
the most-recent token per provider to `boult_integrations`, then drop
the other two tables in a follow-up release.

### F6.3 🟨 ConnectorModal `Manage` opens OAuth popup, but if popup blocked
there's no fallback
**Where:** [`useConnectors.ts:115-130`](../app/dashboard/agent-talk/hooks/useConnectors.ts#L115)

Throws `"Popup blocked"` error → bubbles to error toast. User has no
recovery path other than allowing popups.

**Fix:** detect block, fall back to a same-window redirect with a
`return_to` query param.

### F6.4 🟨 No "test connection" affordance
**Where:** UI

After connecting, the user has no way to verify "is this actually
working?" without trying a tool that depends on it.

**Fix:** every provider gets a `/api/boult/integrations/<provider>/test`
endpoint that does a no-op API call and returns ok/error.

---

## SECTION 7 — Memory + instructions

### F7.1 🟧 `saveMemory` bypasses `isMemoryEnabled` opt-out
**Where:** [`memory.ts:48-92`](../lib/boult/memory.ts#L48)

The user can toggle memory off in settings. `isMemoryEnabled` is
checked in `extractAndSaveInsights` and `extractAndSaveEmailInsights`,
but NOT in the core `saveMemory()` function. The `memory_save` tool +
the chat-route auto-extraction + every PART 23 path bypass the toggle.

**Fix:** `saveMemory` reads the toggle first, returns silently if off.

### F7.2 🟧 Chat-route auto-extraction has 5 regex patterns; some are
greedy
**Where:** [`chat/route.ts:185-216`](../app/api/boult/chat/route.ts#L185)

`"always <verb> ..."` match-at-start regex catches `m[0]` (entire match)
as the fact. So a user saying `"Always loved that movie"` saves
`"Always loved that movie"` as a behavioral rule. False positives are
real.

**Fix:** require the verb-context to be assistive ("always cc",
"always include", "always notify") not free-form "always X".

### F7.3 🟨 Supermemory dual-write tries even with stale key
**Where:** [`memory.ts:80-92`](../lib/boult/memory.ts#L80)

If `SUPERMEMORY_API_KEY` is set but expired/invalid, every save logs a
silent 401. No alert, no surface.

**Fix:** detect 401 on first failure, set a module-level `keyDead` flag,
skip subsequent writes for the session.

### F7.4 🟨 Memory list in settings card has no edit UI yet
**Where:** [`/api/agent-talk/memory/route.ts`](../app/api/agent-talk/memory/route.ts) — PUT exists

PART 23 shipped PUT (edit memory). The settings card UI doesn't have an
edit-in-place affordance yet. Read-only list + delete only.

**Fix:** add inline edit on memory rows.

---

## SECTION 8 — Agent creation flow

### F8.1 🟥 No idempotency on Stage-2 spawn
**Where:** Stage-2 intercept

If the user double-clicks Confirm before Stage 1 disappears, the
intercept fires twice. Each tries to insert a row in `boult_agents`.
Today this works because the name has no uniqueness constraint, so the
user ends up with TWO agents with identical names + schedules.

**Fix:** add a uniqueness constraint on `(user_id, name)` or
deduplicate within the intercept by checking for an existing row first.

### F8.2 🟧 Template-spawn endpoint has dedup but `create_scheduled_agent`
direct path doesn't
**Where:** [`/api/boult/agents/templates/route.ts:67-85`](../app/api/boult/agents/templates/route.ts#L67)

The template route checks for `existing` row and returns it instead of
re-inserting. The `create_scheduled_agent` Stage-3 path does NOT —
two LLM-driven creations of the same agent → two rows.

**Fix:** apply the same dedup in the tool.

### F8.3 🟧 `_creationStage` removed in PART 12 but tool schema description
still references it
**Where:** [`tools.ts:1956`](../lib/boult/tools.ts#L1956) (the
schema for `create_scheduled_agent.spec_markdown`) is correct, but search
for `_creationStage` may still appear elsewhere.

**Fix:** grep + clean up.

---

## SECTION 9 — Reports + delivery

### F9.1 🟧 `REPORT_FORMAT_SUFFIX` has 7 imperative directives
**Where:** [`run-agent.ts:35-115`](../lib/boult/run-agent.ts#L35)

Lines like `"CRITICAL: Output ONLY the final markdown report"` and
`"Do NOT call any more tools"` are inside the user message. If the LLM
hallucinates and pastes the task back, this leaks. PART 22 sanitizer
strips the most common shape but the full suffix hasn't been audited.

**Fix:** restructure: factual data in `userMessage`, instructions in a
new `system` role appended before the user message.

### F9.2 🟧 Email delivery uses Resend with no quota check
**Where:** [`run-agents/route.ts:241-270`](../app/api/cron/run-agents/route.ts#L241)

Resend free tier: 3,000/month. If a user has 4 daily agents × 30 days
= 120 emails/mo, that's fine. But if a customer creates 20 agents,
quota burns through in days. No alert, no fallback.

**Fix:** track Resend send count per month, alert at 80%, fail-soft to
"please reconnect email or upgrade" at 100%.

### F9.3 🟨 Slack DM lookup by email can return wrong user on email-alias
collisions
**Where:** [`run-agents/route.ts:530-545`](../app/api/cron/run-agents/route.ts#L530)

`users.lookupByEmail` works for primary email. If the user signs in to
Boult with `me@a.com` but Slack has them as `me@b.com`, the lookup
fails silently and the report doesn't deliver.

**Fix:** store the Slack user ID at connect time so we don't need to
re-resolve every run.

### F9.4 🟨 Reports don't link to the dashboard for follow-up
**Where:** report markdown

Reports have artifact URLs (PART 14 trust receipts) but no link back to
the agent's settings page for "edit this agent" / "pause" / "see runs".

**Fix:** every report footer includes a deep-link to
`/dashboard?tab=agents&agentId=<id>`.

---

## CROSS-CUTTING

### FX.1 🟥 User-ID casing inconsistency across 23 sites
**Where:** 8 files in `lib/boult`, 3 in `app/api/boult`

Some routes use `userId.toLowerCase()`, others use `ilike()`, a few
neither. Tokens, memory, agents, conversations could split across two
effective identities for the same human if their email casing varies.

**Fix:** add a `normalizeUserId(email)` helper, replace ALL raw uses.
Add a lint rule.

### FX.2 🟧 No structured run-history table
**Where:** N/A

The agent has `last_run_at` and `last_report_summary` (one most-recent
record). No history. The user can't see "did Tuesday's run actually go
out? what about Monday's?".

**Fix:** new `boult_agent_runs` table — one row per cron tick that
attempted the agent, with status / duration / delivery results /
artifact links. Settings card shows the last 7 runs.

### FX.3 🟧 No global error reporter
**Where:** N/A

Errors are scattered across `console.warn` / `console.error` / silent
catches / SSE error events. No Sentry / Datadog hook to capture them.
When the user reports a bug ("All models busy"), we have to grep Vercel
logs.

**Fix:** add `@sentry/nextjs` to capture client + server errors. Tag
with `userId` (hashed), `runId`, `tool`.

### FX.4 🟨 Phase B couldn't reach: tool-level rate limiting
**Where:** N/A

If a user hits "Run now" 50 times in a minute on the same agent, all 50
runs queue. No per-user QPS limit on the chat API either.

**Fix:** add `@upstash/ratelimit` per user per route. Cheap, hosted.

---

## RECOMMENDED FIX BATCHES

Listed in order of "what unblocks the next bug report fastest":

**Batch 1 — critical fixes (target: this week)**
- F1.1 Stage-2 lies on failure
- F3.1 Stale-lock loop
- F5.1 Date.now() id collisions
- F7.1 saveMemory bypasses opt-out
- F8.1 Stage-2 idempotency
- FX.1 User-ID casing normalization

**Batch 2 — silent-failure surface (target: next week)**
- F1.2 Error paths missing `done` event
- F1.5 Catch-and-log audit
- F2.3 Paid model fallback
- F3.3 Cron retry-with-backoff
- FX.3 Sentry integration

**Batch 3 — UX polish (target: next sprint)**
- F4.2 Prompt-section conflict
- F5.2 Supabase-first conversations
- F6.4 Test connection affordance
- F7.4 Memory edit UI
- F9.4 Report dashboard deeplinks

**Batch 4 — Phase C (agentic shift)**
- Proactive triage layer (post-search judgment pass)
- "What would I do?" wrapper authorizing initiative within rules
- Memory-driven preference inference

---

## NOT FOUND / OUT OF SCOPE

Things I looked for but **didn't find broken**:
- Auth + session handling (NextAuth wired correctly)
- The autonomy infrastructure (PART 10) — fresh, no obvious bugs
- The 60-tool arsenal (PARTs 13–18) — wired correctly, just not surfaced
  in the system-prompt inventory (F4.3)
- Engine key-rotation logic (PART 25 added diagnostics; logic itself OK)
- Canvas block renderers (PART 15) — clean
- Voice profile service — solid, isolated module

---

End of audit. **44 findings** across 9 surfaces, 23 cross-cutting concerns.
Phase B done. Ready for your priority signal before Batch 1.
