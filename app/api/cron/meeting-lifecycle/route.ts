/**
 * Boult Meeting Lifecycle — Vercel Cron
 * GET /api/cron/meeting-lifecycle
 *
 * Runs every 5 minutes. Two stages per user per tick:
 *   • PRE  — scans the next lead_minutes (default 25) of calendar events.
 *           For meetings with external attendees not yet prepped, composes
 *           a briefing and emails it.
 *   • POST — scans events that ENDED 30-90 min ago. For meetings not yet
 *           followed up, generates a draft reply (LLM-composed, matches
 *           voice profile) + suggested action items, and emails the user.
 *           Both stages mark their row in boult_meeting_events so they
 *           can't double-fire.
 *
 * Required env vars:
 *   RESEND_API_KEY          — Resend API key
 *   RESEND_FROM_EMAIL       — Verified sender
 *
 *   CRON_SECRET             — REQUIRED. cron-job.org sends this as
 *                             `Authorization: Bearer <CRON_SECRET>` on every
 *                             trigger. Configure in cron-job.org → job →
 *                             Headers, AND in Vercel env vars with the same
 *                             value.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module path
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
// @ts-ignore — JS module path
import { decrypt } from '../../../../lib/crypto.js';
import { CalendarService } from '../../../../lib/calendar';
import { composeMeetingPrep } from '../../../../lib/boult/meeting-prep';
import { composeMeetingFollowUp } from '../../../../lib/boult/meeting-followup';
// @ts-ignore — JS module path
import { saveMemory } from '../../../../lib/boult/memory';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';
// Vercel Pro allows up to 300s. Meeting prep + follow-up compose LLM drafts
// per attendee. Vercel Hobby caps at 60s — 300 would be ignored and the
// function killed at 60s mid-compose. Capped at 60; the route should process
// fewer items per tick and rely on the next tick for the rest. (On Pro: 300.)
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET || 'boult-cron-secret';
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'Boult AI <boult@maily.dev>';
const DEFAULT_LEAD_MINUTES = 25;
const LOOKAHEAD_PAD_MINUTES = 6;          // pre-stage: catches meetings between ticks
const FOLLOWUP_MIN_MINUTES_AGO = 30;      // wait this long after meeting end
const FOLLOWUP_MAX_MINUTES_AGO = 90;      // ignore meetings that ended longer ago
const POST_LOOKBACK_MINUTES = 240;        // fetch a wide window, filter by end time

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const isCronJobOrg =
    authHeader === `Bearer ${CRON_SECRET}` ||
    request.headers.get('x-boult-cron-secret') === CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isCronJobOrg && !isVercelCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Pull every user with Gmail tokens stored. Decryption happens inside the
  // per-user loop so a single bad token can't kill the whole batch.
  const { data: tokenRows, error: tokenErr } = await supabase
    .from('user_tokens')
    .select('user_id, google_email, encrypted_access_token, encrypted_refresh_token');
  if (tokenErr?.code === '42P01') {
    return NextResponse.json({ message: 'user_tokens table missing — nothing to do.' });
  }
  if (tokenErr) return NextResponse.json({ error: tokenErr.message }, { status: 500 });
  if (!tokenRows?.length) return NextResponse.json({ message: 'No users with Gmail.', prepped: 0 });

  // Pre-fetch all user profiles so we can read preferences in one query.
  const userIds = Array.from(new Set(tokenRows.map((r: any) => (r.google_email || r.user_id || '').toLowerCase()).filter(Boolean)));
  const profileMap = new Map<string, any>();
  try {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, preferences')
      .in('user_id', userIds);
    for (const p of (profiles || [])) profileMap.set(String(p.user_id).toLowerCase(), p.preferences || {});
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* missing preferences is fine — defaults apply */ }

  const results: string[] = [];
  let prepped = 0;
  let followedUp = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of tokenRows) {
    const userId = String(row.google_email || row.user_id || '').toLowerCase();
    if (!userId) { skipped++; continue; }

    const prefs = profileMap.get(userId) || {};
    const prepEnabled = prefs.boult_meeting_prep_enabled !== false;
    const followupEnabled = prefs.boult_meeting_followup_enabled !== false;
    if (!prepEnabled && !followupEnabled) { skipped++; continue; }

    const leadMinutes = Math.max(5, Math.min(120,
      Number(prefs.boult_meeting_prep_lead_minutes) || DEFAULT_LEAD_MINUTES,
    ));
    const userTz = (prefs.timezone as string) || 'UTC';

    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    try {
      accessToken = row.encrypted_access_token ? decrypt(row.encrypted_access_token) : null;
      refreshToken = row.encrypted_refresh_token ? decrypt(row.encrypted_refresh_token) : null;
    } catch (e: any) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.warn(`[MeetingLifecycle] decrypt failed for ${userId}: ${e?.message}`);
      errors++;
      continue;
    }
    if (!accessToken) { skipped++; continue; }

    // Voice profile fetched once per user, reused across all follow-up drafts
    // this tick (typically 0-1 meetings). Cheap if cached server-side; the
    // composeMeetingFollowUp wrapper accepts null gracefully.
    let voiceProfilePrompt: string | null = null;
    if (followupEnabled) {
      try {
        // @ts-ignore — JS module path
        const { voiceProfileService } = await import('../../../../lib/voice-profile-service.js');
        const profile = await voiceProfileService.getVoiceProfile(userId);
        if (profile && typeof voiceProfileService.generateVoicePrompt === 'function') {
          voiceProfilePrompt = voiceProfileService.generateVoicePrompt(profile);
        }
      } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* voice profile unavailable — fall back to default tone */ }
    }

    // ── PRE-MEETING stage ────────────────────────────────────────────────────
    if (prepEnabled) {
    let events: any[] = [];
    try {
      const cal = new CalendarService(accessToken, refreshToken || '');
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(now.getTime() + (leadMinutes + LOOKAHEAD_PAD_MINUTES) * 60_000).toISOString();
      events = await cal.listEvents({ timeMin, timeMax, maxResults: 25 });
    } catch (e: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.warn(`[MeetingLifecycle] calendar fetch failed for ${userId}: ${e?.message}`);
      errors++;
      events = [];
    }

    for (const event of events) {
      if (!event?.id) continue;
      // Skip all-day events — start.date without dateTime
      if (!event.start?.dateTime) continue;

      let existing: { id: string; prep_sent_at: string | null } | null = null;
      try {
        const { data } = await supabase
          .from('boult_meeting_events')
          .select('id, prep_sent_at')
          .eq('user_id', userId)
          .eq('gcal_event_id', event.id)
          .maybeSingle();
        existing = data as any;
      } catch (e: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        // Table might not exist — fail closed on this run, the user can apply the migration
        if (e?.code === '42P01') {
          return NextResponse.json({ error: 'boult_meeting_events table missing — apply the migration.', code: '42P01' }, { status: 500 });
        }
      }
      if (existing?.prep_sent_at) continue; // already prepped — idempotent

      let prep;
      try {
        prep = await composeMeetingPrep({
          userId,
          userTimezone: userTz,
          event,
          accessToken,
          refreshToken: refreshToken || '',
        });
      } catch (e: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        console.warn(`[MeetingLifecycle] prep compose failed: ${e?.message}`);
        errors++;
        continue;
      }
      if (!prep) { skipped++; continue; }

      const delivered = await sendPrepEmail(userId, prep);
      if (!delivered) { errors++; continue; }

      try {
        if (existing) {
          await supabase
            .from('boult_meeting_events')
            .update({ prep_sent_at: new Date().toISOString(), attendees: prep.attendeesExternal, title: event.summary || null })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('boult_meeting_events')
            .insert({
              user_id: userId,
              gcal_event_id: event.id,
              event_start: prep.startsAtIso,
              event_end: event.end?.dateTime || event.end?.date || null,
              title: event.summary || null,
              attendees: prep.attendeesExternal,
              prep_sent_at: new Date().toISOString(),
            });
        }
      } catch (e: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        console.warn(`[MeetingLifecycle] table write failed: ${e?.message}`);
      }

      // Feature #4 seed — every prep saves a memory tagged with attendees so
      // the NEXT meeting with the same people automatically surfaces this.
      try {
        const attendeeList = prep.attendeesExternal.map((a) => a.name || a.email).join(', ');
        await saveMemory(
          userId,
          `[MEETING] ${new Date(prep.startsAtIso).toISOString().slice(0, 10)} — "${event.summary || 'meeting'}" with ${attendeeList}.`,
          ['meeting', ...prep.attendeesExternal.map((a) => a.email)],
          'agent_run',
        );
      } catch {
        logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* memory write best-effort */ }

      prepped++;
      results.push(`prepped: ${userId} → "${event.summary}" (${prep.attendeesExternal.length} ext)`);
    }
    } // close prepEnabled

    // ── POST-MEETING stage ───────────────────────────────────────────────────
    // Find meetings that ENDED 30-90 min ago and haven't been followed up.
    // Lookback window covers up to 4h to catch long meetings that started
    // well before they ended.
    if (followupEnabled) {
      let pastEvents: any[] = [];
      try {
        const cal = new CalendarService(accessToken, refreshToken || '');
        const now = new Date();
        const timeMin = new Date(now.getTime() - POST_LOOKBACK_MINUTES * 60_000).toISOString();
        const timeMax = now.toISOString();
        pastEvents = await cal.listEvents({ timeMin, timeMax, maxResults: 40 });
      } catch (e: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
        console.warn(`[MeetingLifecycle] post-calendar fetch failed for ${userId}: ${e?.message}`);
        errors++;
        pastEvents = [];
      }

      const nowMs = Date.now();
      const minEndedMs = nowMs - FOLLOWUP_MAX_MINUTES_AGO * 60_000;
      const maxEndedMs = nowMs - FOLLOWUP_MIN_MINUTES_AGO * 60_000;

      for (const event of pastEvents) {
        if (!event?.id) continue;
        if (!event.start?.dateTime) continue; // skip all-day
        const endIso = event.end?.dateTime || event.end?.date;
        if (!endIso) continue;
        const endMs = new Date(endIso).getTime();
        if (isNaN(endMs)) continue;
        // Must have ended within the follow-up window
        if (endMs < minEndedMs || endMs > maxEndedMs) continue;

        let existing: { id: string; followup_sent_at: string | null } | null = null;
        try {
          const { data } = await supabase
            .from('boult_meeting_events')
            .select('id, followup_sent_at')
            .eq('user_id', userId)
            .eq('gcal_event_id', event.id)
            .maybeSingle();
          existing = data as any;
        } catch (e: any) {
          logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
          if (e?.code === '42P01') {
            return NextResponse.json({ error: 'boult_meeting_events table missing.', code: '42P01' }, { status: 500 });
          }
        }
        if (existing?.followup_sent_at) continue; // already sent — idempotent

        let followup;
        try {
          followup = await composeMeetingFollowUp({
            userId,
            userTimezone: userTz,
            event,
            accessToken,
            refreshToken: refreshToken || '',
            voiceProfile: voiceProfilePrompt,
          });
        } catch (e: any) {
          logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
          console.warn(`[MeetingLifecycle] followup compose failed: ${e?.message}`);
          errors++;
          continue;
        }
        if (!followup) { skipped++; continue; }

        const delivered = await sendFollowupEmail(userId, followup);
        if (!delivered) { errors++; continue; }

        try {
          if (existing) {
            await supabase
              .from('boult_meeting_events')
              .update({
                followup_sent_at: new Date().toISOString(),
                action_items: followup.actionItems,
                attendees: followup.attendeesExternal,
                title: event.summary || null,
              })
              .eq('id', existing.id);
          } else {
            await supabase
              .from('boult_meeting_events')
              .insert({
                user_id: userId,
                gcal_event_id: event.id,
                event_start: event.start?.dateTime || event.start?.date,
                event_end: endIso,
                title: event.summary || null,
                attendees: followup.attendeesExternal,
                followup_sent_at: new Date().toISOString(),
                action_items: followup.actionItems,
              });
          }
        } catch (e: any) {
          logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
          console.warn(`[MeetingLifecycle] post table write failed: ${e?.message}`);
        }

        // Feature #4 enrichment — post-meeting memory is richer than the
        // prep-time seed: it includes the draft snippet (gist of what was
        // discussed) so future preps with the same people show "last time
        // you met you discussed X" instead of just "you met."
        try {
          const attendeeList = followup.attendeesExternal.map((a) => a.name || a.email).join(', ');
          const draftPreview = followup.draftBody.replace(/\s+/g, ' ').slice(0, 220);
          await saveMemory(
            userId,
            `[MEETING_RECAP] ${new Date(endIso).toISOString().slice(0, 10)} — "${event.summary || 'meeting'}" with ${attendeeList}. Draft sent: "${draftPreview}". Action items: ${followup.actionItems.join(' | ') || 'none'}.`,
            ['meeting', 'recap', ...followup.attendeesExternal.map((a) => a.email)],
            'agent_run',
          );
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* best-effort */ }

        followedUp++;
        results.push(`followed up: ${userId} → "${event.summary}" (${followup.actionItems.length} action items)`);
      }
    }
  }

  return NextResponse.json({ message: `Prepped ${prepped}, followed up ${followedUp}.`, prepped, followedUp, skipped, errors, results });
}

async function sendPrepEmail(toEmail: string, prep: { markdown: string; subject: string }): Promise<boolean> {
  return sendBoultEmail(toEmail, prep.subject, prep.markdown, 'Boult · meeting prep');
}

async function sendFollowupEmail(toEmail: string, followup: { markdown: string; subject: string }): Promise<boolean> {
  return sendBoultEmail(toEmail, followup.subject, followup.markdown, 'Boult · meeting follow-up');
}

async function sendBoultEmail(toEmail: string, subject: string, markdown: string, headerPill: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[MeetingLifecycle] RESEND_API_KEY not set — skipping email.');
    return false;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const html = wrapHtml(subject, markdownToHtml(markdown), headerPill);
    const { error } = await resend.emails.send({
      from: RESEND_FROM,
      replyTo: "support.maily@gmail.com",
      to: toEmail,
      subject,
      html,
    });
    if (error) {
      console.error('[MeetingLifecycle] resend error:', error);
      return false;
    }
    return true;
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.error('[MeetingLifecycle] sendPrepEmail failed:', e?.message);
    return false;
  }
}

// ─── Minimal markdown → HTML ────────────────────────────────────────────────
// Trimmed-down vs the agent-report renderer because prep briefs are short
// and the structure is predictable (a few headings, bullets, one link).

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFmt(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0066cc;text-decoration:underline">$1</a>');
}

function markdownToHtml(md: string): string {
  const out: string[] = [];
  let inUl = false;
  let inCode = false;
  const codeBuf: string[] = [];
  const closeUl = () => { if (inUl) { out.push('</ul>'); inUl = false; } };
  const flushCode = () => {
    if (!inCode) return;
    out.push(`<pre style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px 16px;margin:10px 0 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;color:#222;white-space:pre-wrap;overflow-x:auto">${escapeHtml(codeBuf.join('\n'))}</pre>`);
    codeBuf.length = 0;
    inCode = false;
  };

  for (const raw of md.split('\n')) {
    const line = raw;
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
      } else {
        closeUl();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const h = line.match(/^(#{1,6})\s+(.+)/);
    if (h) {
      closeUl();
      const n = h[1].length;
      const styles: Record<number, string> = {
        1: 'font-size:22px;font-weight:700;color:#111;margin:0 0 12px;letter-spacing:-0.02em',
        2: 'font-size:13px;font-weight:600;color:#555;margin:24px 0 8px;text-transform:uppercase;letter-spacing:0.08em',
        3: 'font-size:14px;font-weight:600;color:#333;margin:16px 0 6px',
      };
      out.push(`<h${n} style="${styles[n] || styles[3]}">${inlineFmt(h[2])}</h${n}>`);
      continue;
    }
    const li = line.match(/^\s*-\s+(.+)/);
    if (li) {
      if (!inUl) { out.push('<ul style="margin:6px 0 12px 0;padding-left:20px">'); inUl = true; }
      out.push(`<li style="margin:4px 0;color:#333;line-height:1.6">${inlineFmt(li[1])}</li>`);
      continue;
    }
    closeUl();
    if (line.trim() === '') { out.push('<div style="height:4px"></div>'); continue; }
    out.push(`<p style="margin:6px 0;color:#333;line-height:1.65;font-size:14px">${inlineFmt(line)}</p>`);
  }
  flushCode();
  closeUl();
  return out.join('\n');
}

function wrapHtml(title: string, body: string, headerPill: string = 'Boult'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #f0f0f0;border-radius:20px;padding:32px 28px;box-shadow:0 2px 14px rgba(0,0,0,0.03)">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#888;font-weight:600;margin-bottom:18px">${escapeHtml(headerPill)}</div>
    ${body}
    <div style="border-top:1px solid #f0f0f0;margin-top:32px;padding-top:18px;font-size:11px;color:#999;line-height:1.5">
      Quiet notice from Boult. Reply to silence these, or tune them in <a href="https://maily.dev/dashboard" style="color:#666;text-decoration:underline">settings</a>.
    </div>
  </div>
</body>
</html>`;
}
