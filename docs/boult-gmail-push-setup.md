# Boult — Gmail real-time push setup

Real-time Gmail triggers (an event/condition agent firing seconds after an email
arrives, instead of on the reactive-poll cadence) require a one-time Google Cloud
Pub/Sub setup. **Until this is done the code is completely inert** — `isGmailPushEnabled()`
returns false everywhere and Boult keeps using the reactive poll. So shipping this
is safe; it just doesn't *activate* until the topic exists.

## What the code already does
- `lib/boult-v3/gmail-watch.ts` — `startGmailWatch` / `renewGmailWatches` / `stopGmailWatch`, all gated on `GMAIL_PUBSUB_TOPIC`.
- `POST /api/boult/v3/webhooks/gmail` — receives the Pub/Sub push, dedups, updates the history pointer, and **nudges the live event agents** (sets `agent_state.force_poll`, then kicks `/api/cron/run-agents?only=events`).
- `/api/boult/v3/cron/renew-channels` — now also renews/bootstraps Gmail watches daily (Gmail watch expires every 7 days).
- The run-agents cron honors `force_poll` by bypassing the per-agent poll debounce for one poll, then clears it.

## One-time GCP setup
1. **Create a Pub/Sub topic**, e.g. `gmail-boult`, in the same GCP project as your Gmail OAuth client.
2. **Grant Gmail permission to publish** to it: add `gmail-api-push@system.gserviceaccount.com` as a **Pub/Sub Publisher** on the topic.
3. **Create a push subscription** on that topic with the push endpoint:
   `https://<your-domain>/api/boult/v3/webhooks/gmail`
   (Optionally enable an OIDC token / set the endpoint to require auth — the webhook also self-defends: it only honors mailboxes that have a registered watch, dedups on Pub/Sub messageId, and always returns 200.)
4. **Set the env var** in Vercel:
   `GMAIL_PUBSUB_TOPIC=projects/<your-project-id>/topics/gmail-boult`
5. **Apply the migration** `supabase/migrations/boult_gmail_watch_v1.sql` (adds `boult_integrations.gmail_history_id`).
6. Ensure `NEXTAUTH_URL` (or `HOST`) and `CRON_SECRET` are set so the webhook can kick the fast event lane.

## Activation
Watches auto-start via the daily `renew-channels` cron for every mailbox that has
an `boult_integrations` row with `provider='gmail'`. Calling `startGmailWatch(userId)`
also creates/updates that row, so it's safe to call on connect.

## Scope & fallback
- Push covers mailboxes with an `boult_integrations` gmail row. Everyone else (and
  any missed/duplicate push) is still covered by the **reactive poll** — the
  permanent fallback. Push only changes *latency*, never *correctness*.
- To get near-real-time without push, point a cron-job.org entry at
  `/api/cron/run-agents?only=events` every ~2 minutes (the fast lane already exists)
  and set a low `debounce_min` on the agent's `trigger_config`.
