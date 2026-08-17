# Maily — 5-Day Launch Checklist

**Launch target: ~2026-06-16.** Today: 2026-06-11.

Honest framing: code is in good shape after this session's sweep. The real risk
now is **not code** — it's the unbuilt launch surface (demos, landing polish,
marketing, Product Hunt) compressed into 5 days. This plan front-loads the
things that block everything else and flags what to **cut** if you fall behind.

The hard truth on sequencing: **you cannot record demos until the product works
end-to-end, and you cannot do Product Hunt without demos + a live landing page.**
So the order is: ship-stable → demos → landing → marketing assets → PH launch.

---

## ⚠️ DO THIS FIRST (blocks everything) — Day 1 morning

These gate every demo and screenshot. Nothing else matters until they're green.

- [ ] **Apply ALL Supabase migrations** (SQL editor — no runner in repo). Verify each table exists after:
  - [ ] `boult_agents.sql`
  - [ ] `boult_agent_runs.sql` + `boult_agent_runs_part60_signal.sql` + `boult_agent_runs_plan.sql`
  - [ ] `boult_audit_log.sql`
  - [ ] `boult_user_model.sql`  ← new this session (HomeFeed run-detail + agent thinking depend on it)
  - [ ] all other `supabase/migrations/*.sql` (memories, contacts, canvas, etc.)
- [ ] **Set `ALLOW_PAID_MODELS=true`** in Vercel env (lifts the free-model quality ceiling — this is the single biggest quality jump). To make paid PRIMARY, reorder the 3 model lists: `lib/boult/engine.ts` PAID_MODELS, `lib/openrouter-ai.js` FREE_MODELS/DEFAULT_MODEL, `lib/ai-constants.js` DEFAULT_AI_MODELS.
- [ ] **Verify env vars in Vercel**: OPENROUTER_API_KEY(1-5), SUPABASE_URL + SERVICE_ROLE_KEY, RESEND_API_KEY + RESEND_FROM_EMAIL, **CRON_SECRET (set a real one — defaults to 'boult-cron-secret')**, Polar checkout URLs, NEXTAUTH config.
- [ ] **Confirm cron-job.org** hits `/api/cron/run-agents` with `Authorization: Bearer <CRON_SECRET>`, timeout ≥60s.
- [ ] **Deploy current main to production** and confirm the build is live (all this session's fixes only take effect after deploy; reports only render the new format on the NEXT scheduled run).

---

## Day 1 (afternoon) — Make the golden path bulletproof

Demos live or die on these flows. Walk each one as a real user on production:

- [ ] **Sign up → connect Gmail OAuth** (the #1 drop-off point — must be smooth)
- [ ] **Create a scheduled agent** (the agent-creation flow — fixed in PART 101/106, verify the rich confirmation + correct timing show)
- [ ] **Draft a reply** (confirm voice-cloning is on, blur-fade streaming works, Voice Profile button is visible)
- [ ] **Run an agent → check the report lands** (email + Slack; confirm no emojis, has Tools Used + Next Actions)
- [ ] **HomeFeed "While you were away"** shows the agent run + expands to plan/tools/links
- [ ] **Checkout** (Polar) completes and returns the user onboarded — NOT charged-but-stuck (fixed PART 94)
- [ ] Log every bug you hit here. Fix blockers only; defer cosmetic issues to a post-launch list.

---

## Day 2 — Record the demos

You can't market without these. Keep them SHORT and real (no narration polish needed for v1).

- [ ] **Hero demo (60-90s):** the "founder wakes up" story — open Maily, see HomeFeed "While you were away," expand a run, see what the agent did overnight. This IS the product.
- [ ] **Agent creation demo (30-45s):** type a goal in plain English → agent spec → confirm → live agent. Shows the "describe once, it runs" promise.
- [ ] **Draft-in-your-voice demo (20-30s):** click a thread → watch it draft a reply that sounds like you (the blur-fade stream looks great on video).
- [ ] Record at 1440p+, clean browser (no bookmarks bar, incognito, hide personal data).
- [ ] Export: one 60-90s hero clip (for PH + Twitter), 2-3 GIFs (for landing page + tweets).

**Cut line:** if time-pressed, the hero demo alone is enough to launch. The other two are nice-to-have.

---

## Day 3 — Landing page finalize + Product Hunt assets

You already HAVE a landing page (`LinearLanding.tsx`, `app/page.tsx`, product pages). This is polish, not build-from-zero.

Landing:
- [ ] Above the fold: one-line value prop ("Your AI chief of staff that works while you sleep"), the hero demo GIF/video, one clear CTA.
- [ ] Swap any placeholder copy/images for the real demo GIFs from Day 2.
- [ ] Pricing page: confirm plans + Polar checkout links are correct and live.
- [ ] Mobile check — most PH/Twitter traffic is mobile. Test the landing on a phone.
- [ ] Meta tags / OG image (the preview card when the link is shared — matters a LOT for click-through).

Product Hunt assets:
- [ ] **Thumbnail/logo** (240x240).
- [ ] **Gallery: 3-5 images** (hero shot + the key screens — HomeFeed, agent report, draft).
- [ ] **Tagline** (60 chars): e.g. "AI chief of staff that handles your inbox while you sleep."
- [ ] **Description** (260 chars) + the full first comment (your maker story — why you built it).
- [ ] **First comment drafted** (the maker comment is what converts on PH).

---

## Day 4 — Marketing assets + warm-up

- [ ] **Schedule the Product Hunt launch** for a Tuesday-Thursday, 12:01am PT (PH resets midnight PT; early = full day of votes). If launch is the 16th, confirm it's a good weekday.
- [ ] **Line up your first ~10 supporters** — DM friends/network the night before asking them to comment (not just upvote — comments rank higher) at launch.
- [ ] **Twitter/X launch thread** drafted: hook + hero demo + 3-4 tweets walking through the "while you slept" story + CTA. Schedule for launch morning.
- [ ] **Founder communities**: draft posts for relevant ones (Indie Hackers, relevant subreddits, founder Slacks/Discords you're in). Don't spam — genuine "I built this, here's why" posts.
- [ ] **Email your waitlist** (if you have one) the morning of launch with the PH link.
- [ ] Set up basic analytics so you can see launch-day traffic (PostHog is already integrable — there's a skill for it).

---

## Day 5 — Launch day

- [ ] **00:01 PT** — PH listing goes live. Post your maker first-comment immediately.
- [ ] Fire the Twitter thread + community posts + waitlist email.
- [ ] Ping your warmed-up supporters.
- [ ] **Be at your desk all day** — respond to every PH comment and tweet within minutes. Engagement velocity is the whole game on PH.
- [ ] Watch error logs (Vercel + Supabase) — a surge of real signups WILL surface bugs the smoke test didn't. Have a hotfix path ready.
- [ ] Keep a "things to fix post-launch" list. Don't fix non-blockers during the launch — just respond to users.

---

## If you fall behind (cut in this order)

1. **Cut** the secondary demos (keep only the hero demo).
2. **Cut** community posts beyond PH + Twitter.
3. **Cut** the paid-model reorder — just `ALLOW_PAID_MODELS=true` as fallback is acceptable for launch.
4. **Do NOT cut**: migrations, env vars, the golden-path smoke test, the hero demo, the landing page OG image, the PH first comment. Those are load-bearing.

## What is NOT a blocker (defer to post-launch)
- The phased "todo panel" UI feature (flagged earlier — it's polish, not launch-critical).
- The 3-generation Boult consolidation.
- Any "feels mediocre" cosmetic item that isn't on the golden path.
- Perfect free-model behavior (paid models fix most of it).

---

## The one-sentence priority
**Ship-stable → hero demo → landing live → PH first comment.** Everything else is
optional. If those four are done, you can launch.
