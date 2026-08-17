/**
 * Boult — Google Meet tools.
 *
 * WHY THIS IS SEPARATE FROM CALENDAR
 * Putting a Meet link on a scheduled meeting is Calendar's job — schedule_meeting
 * creates it via conferenceData on the event, and that path is unchanged. This
 * module is the Meet REST API v2, which reaches things Calendar cannot see:
 * standalone meeting spaces, and the artifacts a meeting LEAVES BEHIND —
 * transcripts, recordings, and who actually attended.
 *
 * WHY composioExecute AND NOT googleFetch
 * The rest of our Google surface goes through Proxy Execute because we already
 * had hand-written REST calls whose URL-building and response parsing we did not
 * want to rewrite. Meet is new code with no such legacy, and Composio ships
 * first-class GOOGLEMEET_* tools with real argument schemas — so we call those
 * directly. Fewer moving parts, and Composio owns the endpoint shapes (exactly
 * the class of detail that broke Calendar: its proxy base URL already contains
 * /calendar/v3, so a hand-built path got doubled and 404'd).
 *
 * NO DELETE EXISTS. Google's Meet API v2 has no "delete space" method — spaces
 * expire on their own — and Composio exposes no delete/end tool. Any request to
 * "delete this Meet link" cannot be honored; say so rather than pretending.
 */

import { composioAccountFor } from './http-tokens';
import { composioExecute } from '../composio';
import type { ToolResult } from './types';

function failure(message: string, errorCode: string): ToolResult {
  return { success: false, output: message, errorCode };
}

const NOT_CONNECTED = failure(
  'Google Meet is not connected. Ask the user to connect it in Settings → Integrations.',
  'gmeet_not_connected',
);

/**
 * Resolve the user's Meet connection and run one GOOGLEMEET_* tool.
 * Returns a discriminated result so callers never have to unwrap Composio's shape.
 */
async function meetExec(
  userId: string,
  slug: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true; data: any } | { ok: false; result: ToolResult }> {
  const accountId = await composioAccountFor(userId, 'gmeet');
  if (!accountId) return { ok: false, result: NOT_CONNECTED };

  const res = await composioExecute(accountId, slug, args);
  if (!res.ok) {
    // Never surface Composio's raw error text to the user — it leaks slugs and
    // internal ids. Log-worthy detail stays in errorCode.
    return {
      ok: false,
      result: failure(
        'Google Meet did not accept that request. The connection may need reconnecting.',
        'upstream_gmeet',
      ),
    };
  }
  return { ok: true, data: res.data };
}

/** A conference record name looks like "conferenceRecords/abc123". Accept either form. */
function normalizeConferenceRecord(id: string): string {
  const v = id.trim();
  return v.startsWith('conferenceRecords/') ? v : `conferenceRecords/${v}`;
}

// ── meet_create_link ──────────────────────────────────────────────────────────
// An INSTANT meeting space with no calendar event attached. For "send me a link
// right now". Anything with a time and invitees belongs on schedule_meeting.
export async function meetCreateLink(userId: string, input: any = {}): Promise<ToolResult> {
  const accessType = typeof input?.accessType === 'string' ? input.accessType.toUpperCase() : undefined;
  const args: Record<string, unknown> = {};
  // OPEN = anyone with the link · TRUSTED = same org · RESTRICTED = invited only
  if (accessType && ['OPEN', 'TRUSTED', 'RESTRICTED'].includes(accessType)) {
    args.access_type = accessType;
  }

  const r = await meetExec(userId, 'GOOGLEMEET_CREATE_MEET', args);
  if (!r.ok) return r.result;

  const space = r.data?.response_data ?? r.data ?? {};
  const uri = space.meetingUri || space.meeting_uri || '';
  const code = space.meetingCode || space.meeting_code || '';
  if (!uri) return failure('Meet created the space but returned no joinable link.', 'upstream_gmeet');

  return {
    success: true,
    output: `Meet link ready: ${uri}${code ? ` (code ${code})` : ''}`,
  };
}

// ── meet_list_meetings ────────────────────────────────────────────────────────
// Past conferences. This is how the model finds the conferenceRecord id that the
// transcript / recording / attendance tools all require.
export async function meetListMeetings(userId: string, input: any = {}): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(input?.limit) || 10, 1), 50);
  const r = await meetExec(userId, 'GOOGLEMEET_LIST_CONFERENCE_RECORDS', { page_size: limit });
  if (!r.ok) return r.result;

  const payload = r.data?.response_data ?? r.data ?? {};
  const records: any[] = payload.conferenceRecords || payload.conference_records || [];
  if (!records.length) return { success: true, output: 'No past Meet conferences found.' };

  const lines = records.slice(0, limit).map((c: any, i: number) => {
    const start = c.startTime || c.start_time || '';
    const end = c.endTime || c.end_time || '';
    const when = start ? new Date(start).toLocaleString() : 'unknown time';
    return `${i + 1}. ${c.name || '(unnamed)'} — started ${when}${end ? ` · ended ${new Date(end).toLocaleString()}` : ' · still running'}`;
  });

  return {
    success: true,
    output: `${records.length} recent Meet conference(s):\n${lines.join('\n')}\n\nUse the conferenceRecords/... name with meet_get_transcript, meet_get_recording or meet_attendance.`,
  };
}

// ── meet_get_transcript ───────────────────────────────────────────────────────
export async function meetGetTranscript(userId: string, input: any = {}): Promise<ToolResult> {
  const raw = (input?.conferenceRecordId || '').toString().trim();
  if (!raw) return failure('conferenceRecordId is required — get it from meet_list_meetings.', 'validation_error');

  // Param is `conferenceRecord_id` — camelCase+underscore, NOT the
  // conference_record_id you would guess. Verified against Composio's schema.
  const r = await meetExec(userId, 'GOOGLEMEET_GET_TRANSCRIPTS_BY_CONFERENCE_RECORD_ID', {
    conferenceRecord_id: normalizeConferenceRecord(raw),
  });
  if (!r.ok) return r.result;

  const payload = r.data?.response_data ?? r.data ?? {};
  const transcripts: any[] = payload.transcripts || [];
  if (!transcripts.length) {
    // A real, common state — transcription is off by default in Meet. Say the
    // actionable thing instead of "not found".
    return {
      success: true,
      output: 'No transcript for that meeting. Meet only produces one when transcription was turned on during the call.',
    };
  }

  const lines = transcripts.map((t: any) => {
    const state = t.state || 'UNKNOWN';
    const uri = t.docsDestination?.exportUri || t.docs_destination?.export_uri || '';
    return `- ${t.name || 'transcript'} · ${state}${uri ? `\n  ${uri}` : ''}`;
  });

  return {
    success: true,
    output: `${transcripts.length} transcript(s):\n${lines.join('\n')}`,
  };
}

// ── meet_get_recording ────────────────────────────────────────────────────────
export async function meetGetRecording(userId: string, input: any = {}): Promise<ToolResult> {
  const raw = (input?.conferenceRecordId || '').toString().trim();
  if (!raw) return failure('conferenceRecordId is required — get it from meet_list_meetings.', 'validation_error');

  const r = await meetExec(userId, 'GOOGLEMEET_GET_RECORDINGS_BY_CONFERENCE_RECORD_ID', {
    conferenceRecord_id: normalizeConferenceRecord(raw),
  });
  if (!r.ok) return r.result;

  const payload = r.data?.response_data ?? r.data ?? {};
  const recordings: any[] = payload.recordings || [];
  if (!recordings.length) {
    return {
      success: true,
      output: 'No recording for that meeting. Meet only keeps one if recording was started during the call.',
    };
  }

  const lines = recordings.map((rec: any) => {
    const uri = rec.driveDestination?.exportUri || rec.drive_destination?.export_uri || '';
    return `- ${rec.name || 'recording'} · ${rec.state || 'UNKNOWN'}${uri ? `\n  ${uri}` : ''}`;
  });

  return {
    success: true,
    output: `${recordings.length} recording(s):\n${lines.join('\n')}`,
  };
}

// ── meet_attendance ───────────────────────────────────────────────────────────
// Who actually showed up, and for how long. Meet reports one session PER JOIN,
// so a participant who drops and rejoins appears multiple times — we collapse to
// one row per person with summed minutes, which is what a human means by
// "who attended and for how long".
export async function meetAttendance(userId: string, input: any = {}): Promise<ToolResult> {
  const raw = (input?.conferenceRecordId || '').toString().trim();
  if (!raw) return failure('conferenceRecordId is required — get it from meet_list_meetings.', 'validation_error');

  // This one takes `parent` (the conferenceRecords/{id} path), NOT a
  // conferenceRecord_id like its sibling tools. Verified against the schema.
  const r = await meetExec(userId, 'GOOGLEMEET_LIST_PARTICIPANT_SESSIONS', {
    parent: normalizeConferenceRecord(raw),
  });
  if (!r.ok) return r.result;

  const payload = r.data?.response_data ?? r.data ?? {};
  const sessions: any[] = payload.participantSessions || payload.participant_sessions || [];
  if (!sessions.length) return { success: true, output: 'No attendance data recorded for that meeting.' };

  const byPerson = new Map<string, { joins: number; minutes: number }>();
  for (const s of sessions) {
    const who = s.name || s.participant || 'unknown participant';
    const start = s.startTime || s.start_time;
    const end = s.endTime || s.end_time;
    const mins = start && end
      ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
      : 0;
    const prev = byPerson.get(who) || { joins: 0, minutes: 0 };
    byPerson.set(who, { joins: prev.joins + 1, minutes: prev.minutes + mins });
  }

  const lines = [...byPerson.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([who, v]) => `- ${who} — ${v.minutes} min${v.joins > 1 ? ` (${v.joins} joins)` : ''}`);

  return {
    success: true,
    output: `${byPerson.size} attendee(s):\n${lines.join('\n')}`,
  };
}
