# Scope — Cross-app signals for `/api/home-feed/recommendations`

**Goal:** the "Worth your time" recommendations should surface moves across **all**
of a user's connected apps (Gmail, Google Calendar, Google Meet, Cal.com, Notion,
Slack) — not just the Gmail/Calendar buckets the client passes today.

Status: **scoped, not built.**

---

## 1. Current state

`/api/home-feed/recommendations` (POST) receives the already-computed inbox-today
buckets from the **client** (`sift-today.tsx`):

```
{ decide[], chase[], actionItems[], showUp[], agentRuns[] }
```

`normalizeItems()` turns these into `InItem[]` (`kind: decide | chase | promised |
meeting`) with **numeric refs**; the LLM (nemotron-3-super, JSON mode) writes recs
referencing those refs; `validate()` drops any rec whose refs don't resolve and
**attaches server-computed stats**. So copy is AI, numbers/names are real.

**Limitation:** the only signals are Gmail (decide/chase) + Calendar (showUp) +
ledger (promised). Notion/Slack/Cal.com/Meet are invisible to the recommender.

---

## 2. Architecture decision

**Gather cross-app signals SERVER-SIDE inside the endpoint**, not from the client
(the client has no Notion/Slack data, and we don't want to ship tokens/PII around).
The endpoint already runs authenticated (`auth()` → `session.user.email`).

New flow:

```
POST /api/home-feed/recommendations
  → auth()                          (existing)
  → connected = getConnectedIntegrations(userId)   (lib/boult/system-prompt.ts)
  → signals = await gatherSignals(userId, connected, clientBuckets)  (NEW)
       • only fetch from CONNECTED apps
       • each source wrapped in its own try/catch + AbortSignal.timeout
       • run all sources in Promise.allSettled (parallel)
  → normalizeItems(signals)         (extend kinds)
  → generate() + validate()         (existing LLM + anti-hallucination pipeline — unchanged)
```

Keep the client buckets too (they're already computed, free, and freshest for
Gmail/Calendar) and **merge** them with the server-gathered signals, de-duping by
thread/event id.

---

## 3. Per-app signals (all use existing helpers — no new auth work)

Token helpers already exist in `lib/boult/tools/http-tokens.ts`:
`getGmailToken`, `getGcalToken`, `getNotionToken`, `getSlackToken`; Cal.com via
`getCalClient(userId)` (per-user API key).

| App | Signal(s) to surface | Source (existing) | New `kind` |
|-----|----------------------|-------------------|------------|
| **Gmail** | unanswered replies, stalled sent threads, **bounced sends** (mailer-daemon / DSN) | client `decide`/`chase`; bounce = new lightweight Gmail query `from:mailer-daemon newer_than:3d` | `decide`, `chase`, `bounce` |
| **Google Calendar** | meetings today/tomorrow w/ no agenda, double-bookings/conflicts, external meetings needing prep | client `showUp` + `CalendarService.listEvents` (lib/calendar.ts) | `meeting` |
| **Google Meet** | next Meet-link meeting starting soon, recurring Meet with no notes doc | facet of GCal events (`hangoutLink` / `conferenceData`) — **not a separate API** | `meeting` (flagged `hasMeet`) |
| **Cal.com** | new bookings since last visit, upcoming bookings needing prep, unconfirmed/pending | `getCalClient(userId).getBookings()` (see `calcomListBookings`, tools.ts:4020) | `booking` |
| **Notion** | recently edited pages tied to a contact, tasks due/overdue, meeting-note docs referencing a stalled thread | `searchNotion` / `notionGetCalendarEvents` / DB query (tools.ts:4283, 4786) | `notion` |
| **Slack** | DMs/mentions awaiting your reply, threads you left on read | `slackGetChannels` (conversations.list) + `conversations.history`/mentions (tools.ts:5962) | `slack` |

The real cross-app value is the **joins** the LLM can now make, e.g.:
- "Snigdha went quiet in Gmail **and** her Notion deal page hasn't moved in 9 days."
- "Your 3pm Cal.com booking with Acme has no prep doc — the last Slack thread flagged pricing."
- "Email to marynute.ca bounced (domain typo) — re-send to the address in their Notion contact."

---

## 4. Data-shape changes

- `InItem`: extend `kind` union → `decide | chase | promised | meeting | bounce |
  booking | notion | slack`. Keep numeric `ref`, `label`, `detail`, optional `metric`.
- `normalizeItems(signals)`: one normalizer per source → `InItem[]` (cap ~6 per
  source, ~24 total so the prompt stays small).
- `statFor()`: add stat templates for the new kinds (`bounce` → "bounced",
  `booking` → "to prep", `notion` → "stale", `slack` → "awaiting reply").
- System prompt: tell the model it now has multiple apps and to **prefer recs that
  connect two sources** (that's the differentiator). No change to the hard accuracy
  rules (refs must resolve; stats are server-side).

---

## 5. Accuracy & performance (the non-negotiables)

- **Accuracy:** unchanged guarantees — every referenced item is real (numeric-ref
  validation), every displayed stat is server-computed. The LLM only ranks/joins/
  phrases. Cross-app joins are still grounded because both sides are real items.
- **Latency:** server-side fan-out adds network. Mitigate:
  - `Promise.allSettled` across sources; **per-source `AbortSignal.timeout(~3.5s)`**.
  - Skip any app not in `getConnectedIntegrations`.
  - Cache the gathered **signals** per user for ~10 min (the client already caches
    the *recommendations* in sessionStorage by `generatedAt`).
  - Hard ceiling: endpoint `maxDuration` stays 20s; total signal-gather budget ~6s.
- **Cost:** prompt grows; cap items per source and total. One LLM call, unchanged.
- **Resilience:** any source that errors/times out is simply omitted — never blocks
  the others; the deterministic client fallback still covers a total failure.

---

## 6. Phasing (ship incrementally, each independently valuable)

1. **P1 — Server-side gather scaffold + Gmail bounce.** Add `gatherSignals`,
   connected-gate, merge with client buckets, add `bounce` kind. (Smallest, highest
   signal — bounce detection alone is a visible win.)
2. **P2 — Cal.com + Calendar/Meet prep.** `booking` + meeting-prep signals.
3. **P3 — Notion.** stale pages / due tasks / contact joins.
4. **P4 — Slack.** awaiting-reply DMs/mentions.
5. **P5 — Cross-source join hints** in the system prompt + a "spanned N apps" footer.

---

## 7. Risks

- **Scope/PII:** reading Slack/Notion content server-side — already done by the
  agent tools, same token scopes; no new consent. Keep only ids + short labels in
  the prompt, never full bodies.
- **Rate limits:** Slack/Notion/Google have separate limits; the per-source timeout
  + 10-min signal cache keeps call volume low (home feed loads aren't hot).
- **Token freshness:** reuse the same `get*Token` refresh path the agent uses, so
  a stale Google token self-heals (and won't false-flag "reconnect" — see
  `gmail-403-false-reconnect`).
- **Empty connected set:** falls back to today's Gmail/Calendar behavior exactly.

---

## 8. Effort

- P1: ~0.5 day. P2: ~0.5 day. P3: ~1 day (Notion shapes vary). P4: ~0.5 day.
  P5: ~0.5 day. Total ~3 days, shippable one phase at a time behind the existing
  fallback (never breaks the feed).
