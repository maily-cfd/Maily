# Boult AI — Known Gaps & Imperfections Spec

> **Purpose:** An honest, evidence-backed inventory of what Boult AI **still cannot do**, what is **broken or partially wired**, and what is **not yet 100% perfect** — as of 2026-06-20.
> **Method:** Static audit of the live code paths (`lib/boult/`, `app/api/cron/run-agents`, `app/api/boult/*`, `app/api/email/*`, `lib/subscription-service.js`, `lib/calcom.js`, `lib/boult-v3/`). Every claim cites a file/line. No runtime/DB state was inspected — items that depend on deploy config or applied migrations are flagged as **VERIFY**.
> **Scope note:** Three Boult generations coexist; **only `lib/boult/` + `app/api/cron/run-agents` is the live background path.** `lib/boult-v3/` is a separate, non-live runtime (see §5.1).

---
## Resolution log (updated 2026-06-20)
- ✅ **§1.1 Premium models** — confirmed ON in production (`ALLOW_PAID_MODELS=true`). Not an issue.
- ✅ **§1.2 Cron scheduler** — confirmed external via **cron-job.org** hitting `/api/cron/run-agents`. Not an issue. (Optional: still worth declaring a backup in `vercel.json`.)
- ✅ **§1.3 Server-side paywall** — FIXED. `assertPaidAccess()` added to `chat`/`execute`/`triage`/`plan` (commit `paywall leak`). §1.4 neutralized as a result.
- ✅ **§2.1 Delegation "missing migration"** — FALSE ALARM + FIXED. Table ships in `boult_contacts_and_rules.sql`; corrected the misleading error message.
- ✅ **§2.3 Notion archive** — FIXED. Now performs a real `archived:true` PATCH loop (reversible), with `dryRun`/`maxArchive`.
- ✅ **§3.2 Trigger-column health probe** — FIXED. `/api/boult/health/migrations` now flags a missing `boult_agents.trigger_type` (silent-no-op detector).
- ✅ **§5.3 Dead inline tool map** — FIXED. Deleted.
- ✅ **§2.4 Scheduled-send** — BUILT. boult_scheduled_emails + atomic-claim cron dispatcher + schedule/list/cancel tools. Requires applying the migration.
- ✅ **§3.1 Real-time Gmail push** — BUILT (gated on GMAIL_PUBSUB_TOPIC, fails open to poll). Gmail watch + Pub/Sub webhook → nudges live event agents. Needs the GCP topic to activate; see docs/boult-gmail-push-setup.md.
- ✅ **§2.2 Cal.com** — INVESTIGATED + fixed the real bug. OAuth verified read-only (READ_BOOKING/READ_PROFILE, no booking scope) → would regress booking, so API key stays. Closed the shared-key multi-tenant leak instead (CAL_ALLOW_SHARED_KEY gate). See docs/boult-calcom-auth.md.
- ⏭️ Remaining: §2.5 (transcript summaries) is a non-goal (no data source). §3.3/§3.4 are polish.
---

## Severity legend
- 🔴 **P0 — Launch-critical:** silently breaks the core promise (agents don't run / quality collapses / paywall leaks). Fix before relying on it.
- 🟠 **P1 — Broken/dead feature:** a tool or capability that fails or no-ops today.
- 🟡 **P2 — Not 100%:** works but degraded — latency, quality variance, partial coverage.
- ⚪ **P3 — Tech debt:** no user-facing break, but a maintenance/confusion risk.

---

## 1. 🔴 P0 — Launch-critical (config & integrity)

### 1.1 🔴 Premium model quality is OFF unless an env var is set
**What:** The entire "senior chief-of-staff" quality of Boult is gated behind a single env flag. With it unset, every agent and chat runs on **free** OpenRouter models, which (per the code's own comments) are "terse, skip steps, and 'claim' actions they never executed."
**Evidence:** [lib/boult/engine.ts:434](lib/boult/engine.ts#L434) — `premiumOn = process.env.BOULT_PREMIUM_MODE === 'true' || process.env.ALLOW_PAID_MODELS === 'true'`. Pass 0 (premium-first) only runs when `premiumOn`. Same gate in [lib/openrouter-ai.js](lib/openrouter-ai.js) `premiumModels()`.
**Impact:** This is the "feels like a junior VA" root cause. Prompt + architecture are senior-grade; the *model tier is the ceiling*.
**Fix:** Set `ALLOW_PAID_MODELS=true` (and optionally `BOULT_PREMIUM_MODELS=anthropic/claude-sonnet-4.5,...`) in Vercel. **VERIFY it is actually set in the production env** — code change alone is dormant.

### 1.2 🔴 No cron scheduler is configured in-repo — agents may never fire
**What:** Background agents run only when something pings `POST /api/cron/run-agents` with `Authorization: Bearer $CRON_SECRET`. **`vercel.json` is empty (`{}`)** — no `crons` array — and there is **no `.github/workflows`** triggering it.
**Evidence:** `vercel.json` = `{}`; `find .github` returns nothing; cron auth at `app/api/cron/run-agents/route.ts` expects `CRON_SECRET`.
**Impact:** If no external scheduler (Vercel Cron dashboard entry, cron-job.org, etc.) is hitting that endpoint on a schedule, **no background agent ever runs** regardless of how well it's configured. "Handles your inbox while you sleep" silently does nothing.
**Fix:** **VERIFY** a scheduler exists. If relying on Vercel Cron, it must be declared in `vercel.json` (`"crons": [{ "path": "/api/cron/run-agents", "schedule": "*/15 * * * *" }]`) — it currently is not.

### 1.3 🔴 Server-side paywall is inconsistent — some endpoints don't block
**What:** The strict paid-only gate is enforced **client-side** (the home-feed redirect we just shipped) and on **two** API routes, but the main Boult endpoints only *track* usage, they don't *block* it.
**Evidence:**
- Enforced (free plan limit = 0 → `canUseFeature` false → 403): `app/api/email/draft-reply/route.js:100`, `app/api/nudges/route.js:58-66`, free limits all `0` at [lib/subscription-service.js:76-82](lib/subscription-service.js#L76).
- **NOT enforced** (only `incrementFeatureUsage`, no block): `app/api/boult/chat/route.ts:514`, and `app/api/boult/execute`, `/triage`, `/plan` (no `canUseFeature`/plan check at all).
**Impact:** A logged-in unpaid user (or anyone replaying a request) can call `/api/boult/chat`, `/execute`, `/triage`, `/plan` directly and get full agent compute without paying. The client redirect is cosmetic for these.
**Fix:** Add a shared `requirePaid(userId)` guard (plan ∈ paid/trial, or `OWNER_EMAILS`) to those four routes, returning 402/403 for free/none.

### 1.4 🟡 First-load free users can briefly see the app
**What:** The new optimistic home-feed render (no "Checking access" flash) means a brand-new free user's **first** load renders the feed for ~1 fetch before the background check redirects them. Subsequent reloads redirect instantly (cached deny flag).
**Evidence:** [app/home-feed/page.tsx:30](app/home-feed/page.tsx#L30) optimistic `accessGranted` init; redirect fires after the status fetch resolves.
**Impact:** Cosmetic-only **if** §1.3 is fixed (APIs would reject anyway). Without §1.3, it's a real leak window.
**Fix:** Ship §1.3 — server-side enforcement makes the brief render harmless.

---

## 2. 🟠 P1 — Broken / dead features

### 2.1 🟠 Delegation rules are dead — migration doesn't exist
**What:** Delegation tools fail at runtime because their table was never migrated.
**Evidence:** [lib/boult/tools.ts:5473](lib/boult/tools.ts#L5473) — `'Delegation rules not yet set up (run migration: supabase/migrations/boult_delegation_rules.sql).'`; that file is **absent** from `supabase/migrations/`.
**Impact:** Any agent action routed through delegation rules returns `migration_missing`.
**Fix:** Author + apply `boult_delegation_rules.sql`, or remove the tool from the surfaced set until it's real.

### 2.2 🟠 Cal.com is API-key only — no OAuth, manual paste required
**What:** Cal.com auth uses the **v1 REST API with an API key** appended as a query param. There is no OAuth; users must generate and paste an API key during the guided connect.
**Evidence:** [lib/boult-v3/handlers/calcom.ts:16](lib/boult-v3/handlers/calcom.ts#L16) `baseUrl = 'https://api.cal.com/v1'`; [lib/calcom.js:8](lib/calcom.js#L8) `?apiKey=${this.apiKey}`; key sourced per-user from `integration_credentials` or falls back to global `CAL_API_KEY` ([lib/boult/tools.ts:3853-3863](lib/boult/tools.ts#L3853)).
**Impact:** Higher connect friction and a global-key fallback that conflates users if per-user key is missing. OAuth (v2 Bearer) is a post-launch fast-follow requiring a full `CalComService` rewrite.
**Fix:** Planned v1→v2-Bearer rewrite (deferred). For now, ensure the per-user key path is the default and the shared `CAL_API_KEY` fallback isn't silently mixing accounts.

### 2.3 🟠 Notion "archive" only reports — it doesn't archive
**What:** The Notion cleanup tool identifies what *would* be archived but does not perform the write.
**Evidence:** [lib/boult/tools.ts:1156](lib/boult/tools.ts#L1156) — "The actual archive call requires verified database write permissions — call this for triage; archive in UI for now."
**Impact:** Users are told items are "cleaned up" but must manually archive in Notion. Action ≠ outcome.
**Fix:** Implement the archive write once Notion write scope is verified, or relabel the tool as triage-only in its user-facing copy.

### 2.4 🟠 No scheduled email send — sequences are draft-only
**What:** Multi-email follow-up sequences are generated, but there's no scheduled-send infrastructure, so the user must send each one manually on the day.
**Evidence:** [lib/boult/tools.ts:1303](lib/boult/tools.ts#L1303) — "scheduled-send infra is not yet present, so user reviews drafts day-of."
**Impact:** "Set up a 3-touch follow-up cadence" produces drafts, not an automated cadence. Breaks the autonomy promise for sequences.
**Fix:** Add a scheduled-send queue (store drafts + send-at; a cron dispatches), or set expectations in the tool's output copy.

### 2.5 🟠 Meeting summary from recordings/transcripts — intentionally absent
**What:** `calendar_meeting_summary_generation` is not implemented (no access to meeting recordings/transcripts).
**Evidence:** [lib/boult/tools.ts:8496-8498](lib/boult/tools.ts#L8496) — "is intentionally not implemented."
**Impact:** Boult can prep *for* meetings and follow up, but cannot summarize what was *said* in one.
**Fix:** Out of scope without a recording/transcription source (e.g., Meet/Zoom transcript API). Document as a non-goal.

---

## 3. 🟡 P2 — Works but not 100%

### 3.1 🟡 Reactive triggers exist, but latency is up to 15 minutes
**What:** Phase 1 event/condition/chain triggers **are wired into the live cron** (good), but there is **no real-time Gmail push and no fast event-drain cron**. Everything piggybacks on the 15-min `run-agents` tick.
**Evidence:** Wiring present — `run-agents/route.ts:35-36` imports `checkEventAgents`, `drainChainQueue`; selection at `:179-250`. **Absent** — no `lib/boult-v3/gmail-watch.ts`, no `app/api/boult/v3/cron/drain-events`.
**Impact:** "Email from a client arrives → agent fires" can lag up to ~15 minutes. Acceptable for digests, weak for truly time-sensitive triggers.
**Fix:** Phase 2 — Gmail Pub/Sub watch + a 1–5 min drain cron (reactive poll stays as fallback).

### 3.2 🟡 Trigger columns must be migrated or event/chain/pipeline silently no-op
**What:** The cron reads `agent.trigger_type || 'schedule'`, so if `boult_agents_triggers_v1.sql` isn't applied in production, every agent **gracefully defaults to schedule** — meaning event/condition/pipeline agents **silently never fire** (no error, no log).
**Evidence:** Migration file exists (`supabase/migrations/boult_agents_triggers_v1.sql`) and cron consumes the columns (`run-agents/route.ts:179`, `:418`), but applied-state is runtime.
**Impact:** Silent feature death — the worst kind, because nothing errors.
**Fix:** **VERIFY** the migration is applied (and mirrored into `lib/boult-v3/schema.sql`). Add a startup/health assertion that the columns exist.

### 3.3 🟡 Free-model fallback makes quality non-deterministic
**What:** Even with premium on (§1.1), if the premium pass fails/times out, the chain falls through to free models (Pass 1–4), whose availability depends on daily OpenRouter quota. Output quality varies run-to-run.
**Evidence:** [lib/boult/engine.ts:450-485](lib/boult/engine.ts#L450) — Pass 1 free chain, Pass 2 retry, Pass 3 tool-stripped emergency, Pass 4 paid escape hatch.
**Impact:** A user can get a frontier-quality run one hour and a terse free-model run the next, with no visible explanation.
**Fix:** Surface the model tier used per run in the audit trail; consider failing loud (rather than degrading silently) for paid users when premium is unavailable.

### 3.4 🟡 Placeholder/empty-output guardrails are heuristic
**What:** Empty-reply and bracketed-placeholder suppression rely on regex heuristics + nudge loops, not a guarantee.
**Evidence:** [lib/boult/loop.ts:185-202](lib/boult/loop.ts#L185) `PLACEHOLDER_PATTERN`/`ACTION_PLACEHOLDER_PATTERN`; nudge cap `MAX_NUDGES` at `:1948`.
**Impact:** A novel placeholder phrasing the regex doesn't catch can still ship; the nudge cap can let a stubborn model terminate with thin output.
**Fix:** Keep tightening patterns; treat as defense-in-depth, not a guarantee. (Note: this layer has already caused two prior empty-bubble regressions — verify changes live, not just in build.)

---

## 4. Integration coverage matrix (live `lib/boult/` path)

| Integration | Auth | Read | Write/Act | Real-time | Notes |
|---|---|---|---|---|---|
| Gmail | Google sign-in (tokens in `user_tokens`) | ✅ | ✅ draft/send | ❌ poll ≤15m | Connected-state derived from scopes ([app/api/integrations/status/route.js:54-60](app/api/integrations/status/route.js#L54)) |
| Google Calendar | Google sign-in scopes | ✅ | ✅ schedule | ❌ (gcal-watch exists in v3, not live path) | Primary calendar only; Notion-cal merge is LLM-side |
| Notion | OAuth (v3) / API | ✅ | ⚠️ create yes, **archive no** (§2.3) | poll-notion cron | |
| Slack | `BOULT_SLACK_BOT_TOKEN` (platform) or user token | ✅ | ✅ | webhook (v3) | Platform bot token takes priority |
| Cal.com | **API key only** (§2.2) | ✅ | ✅ booking | n/a | No OAuth |
| Meet recordings/transcripts | — | ❌ | ❌ | — | Not implemented (§2.5) |

---

## 5. ⚪ P3 — Tech debt / confusion risk

### 5.1 ⚪ Three coexisting Boult generations; v3 OAuth is not the live path
**What:** `lib/boult-v3/` has a fuller stack (OAuth for gmail/gcal/notion/slack, a reasoning/queue pipeline) but is **not** what the cron runs. The live path uses primary Google sign-in tokens + API keys. v3 OAuth routes (`app/api/boult/v3/oauth/*`) exist and can mislead.
**Risk:** Future edits land in the wrong generation; "it's implemented in v3" ≠ "it's live."
**Fix:** Document the live path boundary prominently; consider quarantining or deleting dead v3 routes.

### 5.2 ⚪ `enqueueEvent` auto-runs the non-live v3 pipeline
**What:** `lib/boult-v3/queue.ts` `enqueueEvent()` auto-calls `processNextJob` (v3 reasoning), a different path. Chain/event hand-offs must **INSERT into `boult_events_queue` directly** and let the v1 cron be the sole consumer.
**Risk:** Calling `enqueueEvent` from new trigger code would silently fork execution into the wrong runtime.
**Fix:** Keep the direct-insert convention (already followed in `triggers/chain.ts`); add a lint note/comment.

### 5.3 ⚪ Dead legacy tool map retained
**Evidence:** [lib/boult/tools.ts:2105-2106](lib/boult/tools.ts#L2105) — "Legacy inline map kept temporarily… UNUSED. TODO: delete in a follow-up sweep."
**Fix:** Delete once the extracted map is confirmed live.

### 5.4 ⚪ Web search depends on external keys, fails closed
**Evidence:** [lib/boult/tools.ts:5611](lib/boult/tools.ts#L5611) — all providers unavailable → graceful failure. Keys: `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`.
**Impact:** If neither key is set, `web_search` is a no-op. **VERIFY** at least one is configured.

---

## 6. Required env vars (verify all are set in production)
`ALLOW_PAID_MODELS` (§1.1) · `CRON_SECRET` (§1.2) · `OPENROUTER_API_KEY` · `GOOGLE_CLIENT_ID/SECRET` · `CAL_API_KEY` (fallback, §2.2) · `BOULT_SLACK_BOT_TOKEN` · `BRAVE_SEARCH_API_KEY`/`SERPER_API_KEY` (§5.4) · `RESEND_API_KEY`/`RESEND_FROM_EMAIL` · `SUPERMEMORY_API_KEY` · Optional: `BOULT_PREMIUM_MODE`, `BOULT_PREMIUM_MODELS`, `BOULT_USE_COMMITTEE`.

## 7. Priority fix order (highest leverage first)
1. **§1.2** Confirm/declare the cron scheduler — *without this, nothing else matters.*
2. **§1.1** Set `ALLOW_PAID_MODELS=true` in prod — flips Boult from junior→senior.
3. **§1.3** Add `requirePaid` to `chat`/`execute`/`triage`/`plan` — closes the paywall leak (also neutralizes §1.4).
4. **§3.2** Verify the triggers migration is applied — or event/chain/pipeline agents are silently dead.
5. **§2.1 / §2.3** Either implement or relabel delegation + Notion-archive so "done" means done.
6. **§3.1** Phase 2 real-time triggers for time-sensitive use cases.

---
*Generated from a static code audit. Items marked **VERIFY** depend on production env/DB state not visible to the audit and must be confirmed against the live deployment.*
