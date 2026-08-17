/**
 * Boult Tools — All tool definitions and implementations.
 *
 * Each tool:
 *  1. Has a ToolSchema (sent to Claude so it knows what it can call)
 *  2. Has an implementation function that takes userId + input and returns a string result
 *
 * Tools never throw — they return error strings that Claude can reason about.
 */

// @ts-ignore — JS module
import { getSupabaseAdmin } from '../supabase.js';
// @ts-ignore - JS module
import { CalComService } from '../calcom.js';
// Super-agent foundation (Stage 1) — the agent reads/writes these itself.
import { addCommitment, listOpen, bucketByDue, closeCommitment } from './super/ledger';
import { saveFact, saveDecision } from './super/memory';
// @ts-ignore — JS module
import { decrypt, encrypt } from '../crypto.js';
import { annotateEmailWithSignals, annotateSearchResultsWithSignals } from './inbox-pipeline';
import { getConnectedIntegrations } from './system-prompt';
import { callLLM, getText } from './engine';
import { normalizeDocumentMarkdown } from './markdown-normalize';
import type { ToolSchema } from './engine';
import { buildExecutionPlan } from './orchestrator';
import {
  recordPendingApproval,
  consumeApproval,
  consumeApprovalById,
  hasDeclinedApproval,
  normalizeTargetKey,
  type ApprovalActionType,
} from './session-state';
import { queuePendingAction } from './agent-approvals';
import { enqueueScheduledEmail } from './scheduled-send';
import { applyAutonomyGate } from './autonomy-grants';
import { getCanvasState, setCanvasState } from './canvas-state';
import { normalizeUserId } from './user-id';

// PART 39a — shared infra split out of this file. Public types are re-exported
// at the bottom so engine.ts / loop.ts / run-agent.ts keep their import paths.
import {
  type ToolResult,
  type ToolHistoryEntry,
  type ToolContext,
  failureResult,
} from './tools/types';
import {
  refreshGoogleToken,
  getGmailToken,
  getGcalToken,
  getNotionToken,
  getSlackToken,
  composioAccountFor,
  googleFetch,
  GMAIL_SCOPE_MESSAGE,
  classifyGoogle403,
  gmailHttpFailure,
  gcal403Failure,
} from './tools/http-tokens';
import {
  meetCreateLink,
  meetListMeetings,
  meetGetTranscript,
  meetGetRecording,
  meetAttendance,
} from './tools/meet';
import {
  b64decode,
  getHeader,
  extractBody,
  buildRaw,
} from './tools/encoding-helpers';

// ── Tool schemas ───────────────────────────────────────────────────────────────

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'search_gmail',
    description:
      'PICK THIS when you need ≤25 Gmail results for the current chat turn. For inbox-wide scans (>25 results, scheduled-agent sweeps) use gmail_unlimited_search instead. ' +
      'Search Gmail metadata only — returns id, threadId, From, Subject, Date, snippet for each match. ' +
      'Does NOT return full bodies; call read_email for body. ' +
      'Output: plain-text list of numbered email summaries, or "No emails found matching that query." when empty. ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query using Gmail operators. Examples: "from:client@co.com is:unread", "subject:proposal newer_than:7d", "has:attachment after:2026/01/01".' },
        maxResults: { type: 'number', description: 'Max emails (1-25, default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_email',
    description:
      'Fetch a single email\'s full content given its message id. Required before any claim about a specific email\'s body. ' +
      'Output: plain text with Message-ID, Thread-ID, RFC-Message-ID, From, To, Subject, Date, then the body. ' +
      'Errors (success:false): gmail_not_connected, not_found (status 404), upstream_gmail.',
    input_schema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Gmail message id from search_gmail.' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'get_sent_emails',
    description:
      'Return raw text of the user\'s recent sent emails for writing-style analysis. ' +
      'Call ONLY when the user explicitly asks to audit/describe their voice — the voice profile is already injected at prompt-start every turn. ' +
      'Output: plain-text dump of up to N sent emails plus the formatted voice profile block. ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail, no_sent_mail.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Sent emails to fetch (1-50, default 30).' },
      },
    },
  },
  {
    name: 'get_voice_profile',
    description:
      'Return the saved voice profile object for INSPECTION ONLY (user asks "do you have my voice profile?"). ' +
      'Do NOT call before drafting — voice profile is already in this prompt. ' +
      'Output: plain text with profile fields (tone, greetings, closings, vocabulary). ' +
      'Errors (success:false): voice_profile_missing, voice_profile_read_failed.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'voice_profile_generate',
    description:
      'Rebuild the user\'s saved voice profile from their last 90 days of sent mail. ' +
      'Use when the user explicitly asks to retrain, rebuild, or refresh their voice — or when their existing profile is stale and they\'ve sent significant new mail. ' +
      'Slow: 10-30s. Time-boxed at 30s; on timeout returns success:false. The newly built profile is saved and used by the NEXT turn\'s system-prompt injection (not the current turn). ' +
      'Output: confirmation text with sample count and the new profile\'s tone/greeting/closing summary. ' +
      'Errors (success:false): gmail_not_connected, insufficient_sent_mail (under 20 sent emails), voice_profile_generate_failed.',
    input_schema: {
      type: 'object',
      properties: {
        sampleSize: { type: 'number', description: 'Number of sent emails to analyse (20-200, default 90).' },
      },
    },
  },
  {
    name: 'voice_profile_update',
    description:
      'Patch specific fields on the saved voice profile. Use after user feedback like "I never write Best, M — it\'s always Cheers, M" or "drop the dashes, I never use them". ' +
      'Shallow-merges the `updates` object into the stored profile (top-level fields overwrite; arrays replace, do not concat). ' +
      'Output: confirmation text + a diff summary of the changed fields. ' +
      'Errors (success:false): voice_profile_missing (no profile to patch), validation_error (empty updates), voice_profile_update_failed.',
    input_schema: {
      type: 'object',
      properties: {
        updates: {
          type: 'object',
          description: 'Partial profile object. Recognised top-level fields: tone, greeting_patterns (string[]), closing_patterns (string[]), vocabulary (string[]), avoid_phrases (string[]), average_length, formality.',
          additionalProperties: true,
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'draft_cold_email',
    description:
      'Save a Gmail draft for a NEW outbound email (no existing thread). Renders the same draft card as draft_reply; user reviews and sends from the card. ' +
      'Soft-write — no request_confirmation gate. ' +
      'Prerequisites: get_recipient_context if you have any prior history with the recipient. The system prompt already carries the voice profile. ' +
      'Output: confirmation text + canvasData.draftMeta with the 5-dim voice critique composite (voiceScore) and a one-line voiceCritique. ' +
      'Errors (success:false): gmail_not_connected, validation_error (missing to/subject/body), draft_save_failed.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Subject line — make it concrete and short.' },
        body: { type: 'string', description: 'Plain-text email body written in the user\'s voice. Open with a hook, close with one explicit ask. Sound like a real person typing: use periods and commas, contractions, one idea per sentence. NEVER use em-dashes (—) or en-dashes; they are the biggest tell that a machine wrote it. Skip AI throat-clearing ("I hope this finds you well", "I wanted to reach out").' },
        recipientName: { type: 'string', description: 'Display name for the draft card.' },
        purpose: { type: 'string', description: 'One sentence describing what the email is meant to achieve — improves the appropriate_tone and clear_cta critique scores.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'draft_review',
    description:
      'Score an email draft against the saved voice profile on five dimensions: sounds_like_user / appropriate_tone / clear_cta / correct_length / no_hallucinated_claims (each 0-100). ' +
      'Returns a composite + per-dimension breakdown + up to 3 concrete suggestions. ' +
      'Call this when the user asks "is this draft any good?", before sending a high-stakes message, or after manually editing a draft. draft_reply and draft_cold_email already auto-run this internally on save. ' +
      'Output: plain-text scorecard with composite, each dimension, suggestions, and a critique line for sub-85 composites. ' +
      'Errors (success:false): validation_error (empty draft), voice_profile_missing (no profile to score against — call voice_profile_generate first).',
    input_schema: {
      type: 'object',
      properties: {
        draft: { type: 'string', description: 'The full email body to score.' },
        context: { type: 'string', description: 'Optional: 1-3 sentences of context (recipient, situation, goal) — improves appropriate_tone and clear_cta dimensions.' },
      },
      required: ['draft'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Save a Gmail draft reply (does NOT send) and render it inline as a draft card. ' +
      'Prerequisites: read_email for the thread you\'re replying to, get_recipient_context for the recipient. ' +
      'Body must use the voice profile in this prompt. ' +
      'Output: confirmation text + canvasData.draftMeta with voiceScore/voiceCritique from the post-draft voice critique. ' +
      'Errors (success:false): gmail_not_connected, draft_save_failed. ' +
      'Never use this for summaries — use open_canvas. After calling, do NOT call send_email; the user reviews and sends from the card.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread id from read_email.' },
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Subject line (usually "Re: original subject").' },
        body: { type: 'string', description: 'Plain-text email body written in the user\'s voice, sounding like a real person (no em-dashes, no AI throat-clearing). Include Meet link if a meeting was scheduled.' },
        inReplyToMessageId: { type: 'string', description: 'RFC Message-ID from read_email for proper threading.' },
        recipientName: { type: 'string', description: 'Display name for the draft card.' },
      },
      required: ['threadId', 'to', 'body'],
    },
  },
  {
    name: 'send_email',
    description:
      'Send an email immediately. GATED: requires a prior request_confirmation that the user approved with matching to+subject; the executor refuses otherwise with code "confirmation_required". ' +
      'Output: success line with Message ID, recipient, subject. ' +
      'Errors (success:false): confirmation_required, gmail_not_connected, send_failed.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address — must match the To field passed to request_confirmation.' },
        subject: { type: 'string', description: 'Subject line — must match the Subject passed to request_confirmation.' },
        body: { type: 'string', description: 'Final email body in plain text.' },
        threadId: { type: 'string', description: 'Thread id if this is a reply.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_read_thread',
    description:
      'Fetch every message in a Gmail thread by threadId — full bodies, senders, recipients, dates, attachment metadata. ' +
      'Use when you need the back-and-forth context, not just one message (read_email returns a single message by messageId). ' +
      'Output: plain text with thread-level header, then each message numbered with its From / To / Date / RFC-Message-ID / body. ' +
      'Errors (success:false): gmail_not_connected, not_found (status 404), upstream_gmail.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread id from search_gmail or read_email.' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'gmail_get_labels',
    description:
      'List every label in the user\'s Gmail account (system labels like INBOX/SENT plus user labels). ' +
      'Call this before gmail_apply_label so you reference real label ids, not names. ' +
      'Output: numbered list of "<labelName>  [id: <labelId>  type: system|user]". ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'gmail_apply_label',
    description:
      'Add one or more existing labels to a thread. Reversible write — does not require request_confirmation. ' +
      'Prerequisite: gmail_get_labels (so labelIds you pass actually exist). ' +
      'Output: "Applied <N> label(s) to thread <threadId>." ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail, validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread id.' },
        labelIds: { type: 'array', items: { type: 'string' }, description: 'Label ids from gmail_get_labels (NOT names).' },
      },
      required: ['threadId', 'labelIds'],
    },
  },
  {
    name: 'gmail_archive_thread',
    description:
      'Archive a thread (remove the INBOX label). Reversible write — emails remain in All Mail and can be searched/restored. Does not require request_confirmation for single threads. ' +
      'For bulk newsletter archives use digest_newsletters instead. ' +
      'Output: "Archived thread <threadId>." ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail, validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Gmail thread id to archive.' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'gmail_get_profile',
    description:
      'Return the authenticated Gmail account\'s email address, total message count, and total thread count. ' +
      'Use to know who Boult is acting as, or to ground claims about inbox volume. ' +
      'Output: plain text with "Email: <addr>", "Messages: <n>", "Threads: <n>". ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'schedule_meeting',
    description:
      'Create a Google Calendar event with an auto-generated Google Meet link and send invites to attendees. ' +
      'GATED: requires a prior request_confirmation with matching attendees and start time. ' +
      'Prerequisites: get_calendar_events to verify the slot is free (and Notion calendar via search_notion when connected). ' +
      'Output: confirmation text + canvasData.pageMeta with htmlLink and Meet URL. ' +
      'Errors (success:false): confirmation_required, gcal_not_connected, gcal_scope_missing, gcal_create_failed.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title shown on the calendar.' },
        startTime: { type: 'string', description: 'ISO 8601 start time WITH timezone offset, e.g. "2026-05-26T14:00:00-04:00".' },
        endTime: { type: 'string', description: 'ISO 8601 end time WITH timezone offset.' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses; they receive Google Calendar invites.' },
        description: { type: 'string', description: 'Agenda or notes shown in the event description.' },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },
  // ── Google Meet ────────────────────────────────────────────────────────────
  // A SEPARATE connection from Calendar. Meet links on scheduled events still
  // come from schedule_meeting above; these reach the Meet API v2 for instant
  // spaces and for what a meeting leaves behind. There is deliberately NO
  // delete tool — Google's Meet API has no delete-space method.
  {
    name: 'meet_create_link',
    description:
      'Create a STANDALONE Google Meet link with no calendar event — for "send me a Meet link", "start a call now". ' +
      'DO NOT use for a meeting that has a time or attendees: schedule_meeting already attaches a Meet link to the calendar event and sends invites. ' +
      'Output: the joinable meeting URL. ' +
      'Errors (success:false): gmeet_not_connected, upstream_gmeet.',
    input_schema: {
      type: 'object',
      properties: {
        accessType: {
          type: 'string',
          enum: ['OPEN', 'TRUSTED', 'RESTRICTED'],
          description: 'OPEN = anyone with the link may join · TRUSTED = same organization · RESTRICTED = invited people only. Omit for the account default.',
        },
      },
    },
  },
  {
    name: 'meet_list_meetings',
    description:
      'List PAST Google Meet conferences. Call this FIRST to obtain the conferenceRecordId that meet_get_transcript, meet_get_recording and meet_attendance all require. ' +
      'This is Meet history, NOT the calendar — use get_calendar_events for upcoming meetings. ' +
      'Output: numbered list of conferences with their conferenceRecords/... names and times. ' +
      'Errors (success:false): gmeet_not_connected, upstream_gmeet.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent conferences to return (1-50, default 10).' },
      },
    },
  },
  {
    name: 'meet_get_transcript',
    description:
      'Fetch the transcript of a past Google Meet call — use to summarize what was said, extract decisions, or pull action items. ' +
      'Requires a conferenceRecordId from meet_list_meetings. ' +
      'A meeting only has a transcript if transcription was ON during the call; an empty result means it was off, not that the call is missing. ' +
      'Output: transcript entries with their export links. ' +
      'Errors (success:false): validation_error, gmeet_not_connected, upstream_gmeet.',
    input_schema: {
      type: 'object',
      properties: {
        conferenceRecordId: { type: 'string', description: 'The conferenceRecords/... name from meet_list_meetings.' },
      },
      required: ['conferenceRecordId'],
    },
  },
  {
    name: 'meet_get_recording',
    description:
      'Fetch the recording of a past Google Meet call. Requires a conferenceRecordId from meet_list_meetings. ' +
      'A meeting only has a recording if recording was started during the call; an empty result means it was not. ' +
      'Output: recordings with their Drive export links. ' +
      'Errors (success:false): validation_error, gmeet_not_connected, upstream_gmeet.',
    input_schema: {
      type: 'object',
      properties: {
        conferenceRecordId: { type: 'string', description: 'The conferenceRecords/... name from meet_list_meetings.' },
      },
      required: ['conferenceRecordId'],
    },
  },
  {
    name: 'meet_attendance',
    description:
      'Who actually attended a past Google Meet call and for how long — use for "did X join?", "who missed standup", "how long was everyone on". ' +
      'Requires a conferenceRecordId from meet_list_meetings. Repeat joins by the same person are collapsed into one row with total minutes. ' +
      'Output: attendees sorted by time in the call. ' +
      'Errors (success:false): validation_error, gmeet_not_connected, upstream_gmeet.',
    input_schema: {
      type: 'object',
      properties: {
        conferenceRecordId: { type: 'string', description: 'The conferenceRecords/... name from meet_list_meetings.' },
      },
      required: ['conferenceRecordId'],
    },
  },
  {
    name: 'get_calendar_events',
    description:
      'PICK THIS for short windows (≤7 days) in interactive chat — quick "what\'s on my calendar tomorrow?", "list today\'s meetings". For long windows (>7 days), conflict detection, or merging with Notion Calendar, use calendar_unlimited_scan. ' +
      'List the user\'s Google Calendar events in a forward window. Required before any claim about a slot being free. ' +
      'Output: plain-text list with title, start time, attendees, or "No upcoming events..." when empty. ' +
      'Errors (success:false): gcal_not_connected, gcal_scope_missing, upstream_gcal.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: 'Forward window in days (default 7).' },
        maxResults: { type: 'number', description: 'Max events (default 20).' },
      },
    },
  },
  {
    name: 'calendar_get_availability',
    description:
      'Compute the user\'s FREE time-slots in a window using Google\'s freeBusy API. Required before proposing a meeting time — never guess a slot. ' +
      'Output: plain text listing busy ranges (with titles when fetchable) and the computed free ranges within the window. ' +
      'Errors (success:false): gcal_not_connected, gcal_scope_missing, upstream_gcal, validation_error. ' +
      'Note: queries the primary calendar only; Notion Calendar merge is handled by the LLM via search_notion when notion is connected.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO 8601 start of window WITH timezone offset, e.g. "2026-05-26T09:00:00-04:00".' },
        endDate: { type: 'string', description: 'ISO 8601 end of window WITH timezone offset.' },
        timezone: { type: 'string', description: 'IANA timezone (default the request\'s default), e.g. "America/New_York".' },
        minSlotMinutes: { type: 'number', description: 'Minimum free-slot length to report in minutes (default 30).' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'calcom_list_event_types',
    description:
      'List the user\'s Cal.com meeting types (the bookable links people use to schedule with them — e.g. "30 Min Meeting", "Intro Call"). ' +
      'Call this FIRST for any Cal.com booking so you have the eventTypeId and the shareable booking link (slug). ' +
      'Output: each type with id, title, length (minutes), slug, and its public booking URL. ' +
      'Use when someone asks "send them my booking link", "book a call", or "what meeting types do I have". ' +
      'Errors (success:false): calcom_not_configured, upstream_calcom.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'calcom_get_slots',
    description:
      'Get the user\'s available Cal.com slots for a meeting type within a window. Use BEFORE proposing times so you never offer a slot that isn\'t actually open. ' +
      'Output: list of available start times (ISO, in the given timezone). ' +
      'Errors (success:false): calcom_not_configured, validation_error, upstream_calcom.',
    input_schema: {
      type: 'object',
      properties: {
        eventTypeId: { type: 'number', description: 'Cal.com event type id from calcom_list_event_types.' },
        startTime: { type: 'string', description: 'ISO 8601 start of the window, e.g. "2026-06-16T00:00:00Z".' },
        endTime: { type: 'string', description: 'ISO 8601 end of the window.' },
        timezone: { type: 'string', description: 'IANA timezone for the returned slots, e.g. "America/New_York". Defaults to the request timezone.' },
      },
      required: ['eventTypeId', 'startTime', 'endTime'],
    },
  },
  {
    name: 'calcom_create_booking',
    description:
      'Book a Cal.com meeting on a confirmed slot. The attendee gets a calendar invite + confirmation from Cal.com (includes a meeting link). ' +
      'GATED: requires a prior request_confirmation — this notifies the attendee, so confirm with the user first. ' +
      'Get the slot from calcom_get_slots first; never invent a time. ' +
      'Output: "Booked <title> with <name> at <start>." plus the booking id. ' +
      'Errors (success:false): confirmation_required, calcom_not_configured, slot_unavailable, validation_error, upstream_calcom.',
    input_schema: {
      type: 'object',
      properties: {
        eventTypeId: { type: 'number', description: 'Cal.com event type id.' },
        start: { type: 'string', description: 'ISO 8601 start time from calcom_get_slots.' },
        end: { type: 'string', description: 'ISO 8601 end time (start + event length). Optional — Cal.com derives it from the event type if omitted.' },
        name: { type: 'string', description: 'Attendee full name.' },
        email: { type: 'string', description: 'Attendee email.' },
        notes: { type: 'string', description: 'Optional notes / agenda shown on the booking.' },
        timezone: { type: 'string', description: 'Attendee IANA timezone.' },
      },
      required: ['eventTypeId', 'start', 'name', 'email'],
    },
  },
  {
    name: 'calcom_list_bookings',
    description:
      'List the user\'s Cal.com bookings (upcoming and recent) — use to report their schedule, or to find a booking id to cancel/reschedule. ' +
      'Output: each booking with id, title, start/end, attendee name/email, and status. ' +
      'Errors (success:false): calcom_not_configured, upstream_calcom.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'calcom_cancel_booking',
    description:
      'Cancel a Cal.com booking by id. The attendee is notified by Cal.com. ' +
      'GATED: requires a prior request_confirmation — it\'s irreversible from the attendee\'s POV. ' +
      'To RESCHEDULE: cancel the old booking, then calcom_create_booking on the new slot. ' +
      'Output: "Cancelled booking <id>." Errors (success:false): confirmation_required, calcom_not_configured, not_found, upstream_calcom.',
    input_schema: {
      type: 'object',
      properties: {
        bookingId: { type: 'number', description: 'Cal.com booking id from calcom_list_bookings.' },
        reason: { type: 'string', description: 'Optional cancellation reason shown to the attendee.' },
      },
      required: ['bookingId'],
    },
  },
  {
    name: 'ledger_add_commitment',
    description:
      'Record an open commitment in the Follow-Through Ledger so it is NEVER dropped across runs. ' +
      'Use whenever you (or the user) promise a future action: "follow up Friday", "send the deck after the call", ' +
      '"check if they replied in 3 days". Future runs see it under what\'s due and chase it. Dedup is automatic.',
    input_schema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'The commitment, imperative: "Send Acme the pricing deck".' },
        who: { type: 'string', description: 'Person/company it concerns (name or email). Optional.' },
        due: { type: 'string', description: 'ISO date/time it is due, e.g. "2026-06-20T17:00:00Z". Omit if no hard deadline.' },
        threadId: { type: 'string', description: 'Gmail thread id this relates to (helps chase + dedup). Optional.' },
      },
      required: ['what'],
    },
  },
  {
    name: 'ledger_list_due',
    description:
      'List commitments from the Follow-Through Ledger that are DUE or OVERDUE now. ' +
      'Call this near the START of a run — overdue items are your first priority, before new work. ' +
      'Returns each with id, what, who, due, and how overdue it is.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'ledger_list_open',
    description: 'List ALL open commitments (due or not) so you can see the full set of balls in the air.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'ledger_close_commitment',
    description:
      'Close a Follow-Through Ledger commitment — ONLY when it is actually done (e.g. the follow-up was sent). ' +
      'Closing a ball you did not actually complete is a serious error.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Ledger entry id from ledger_list_due / ledger_list_open.' },
        status: { type: 'string', enum: ['done', 'cancelled'], description: 'done (default) or cancelled if no longer relevant.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'save_fact',
    description:
      'Persist a durable fact you learned about the user, a contact, or their world, so future runs never re-derive it. ' +
      'Examples: "Sarah Chen = priority VC, replies within 4h, prefers Tuesday calls", "Acme renewal is annual, ~$48k". ' +
      'Be specific and reusable. This is the memory moat — use it generously.',
    input_schema: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'The durable fact, one sentence.' } },
      required: ['fact'],
    },
  },
  {
    name: 'save_decision',
    description:
      'Record a judgment call you made + (if known) its outcome, so you can pattern-match next time. ' +
      'Example: decision "Declined the recruiter cold email", outcome "user approved — this pattern is safe".',
    input_schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', description: 'The call you made and why.' },
        outcome: { type: 'string', description: 'What happened / how the user reacted, if known. Optional.' },
      },
      required: ['decision'],
    },
  },
  {
    name: 'calendar_cancel_event',
    description:
      'Cancel a Google Calendar event and send cancellation invites to all attendees. ' +
      'GATED: requires a prior request_confirmation with matching eventId — attendees receive an email so this is irreversible from their POV. ' +
      'Output: "Cancelled event <eventId>. Notified <N> attendee(s)." ' +
      'Errors (success:false): confirmation_required, gcal_not_connected, gcal_scope_missing, not_found, upstream_gcal, validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Google Calendar event id from schedule_meeting / get_calendar_events.' },
        reason: { type: 'string', description: 'Optional one-line reason — currently logged but Google Calendar does not include it in the cancellation invite body.' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'search_notion',
    description:
      'Search the Notion workspace for pages whose title or content matches the query. ' +
      'Output: plain-text list of matching pages with title, id, url, last edited date. ' +
      'Errors (success:false): notion_not_connected, upstream_notion. ' +
      'Empty result returns success:true with "No Notion pages found...".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query — Notion does full-text search on title and content.' },
        maxResults: { type: 'number', description: 'Max results (1-10, default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_canvas',
    description:
      'Render a long document (report, prep doc, schedule, analysis, full email draft for review) in the side Canvas panel. ' +
      'Use whenever the user-facing output would exceed 3 paragraphs — long content NEVER goes in chat. ' +
      'WRITE A REAL DOCUMENT, not a stub: real section headers (multiple ## for anything called a report/doc/plan), the actual depth the request calls for, a close — not two sentences under one heading. Match length to the ask, never pad, never truncate for effort. ' +
      'Output: confirmation text + canvasData with title/type/markdown. ' +
      'Errors (success:false): validation_error (empty markdown). ' +
      'Inline charts use fenced code blocks: ```bar-chart / ```line-chart / ```pie-chart — see input.markdown description for exact syntax.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Canvas panel title shown in the header' },
        type: {
          type: 'string',
          enum: ['email_draft', 'report', 'notes', 'analysis', 'action_plan'],
          description: 'Content type — determines the canvas icon and actions',
        },
        markdown: { type: 'string', description: 'Full markdown content. Use headers, bullets, bold for structure.' },
        draftMeta: {
          type: 'object',
          description: 'For email_draft type: { to, subject, body, threadId } so the Send button works',
          properties: {
            to: { type: 'string' },
            subject: { type: 'string' },
            threadId: { type: 'string' },
          },
        },
      },
      required: ['title', 'markdown'],
    },
  },
  // ── Feature: Follow-up Radar ─────────────────────────────────────────────────
  {
    name: 'check_followups',
    description:
      'Scan recent sent mail for threads with no external reply — surfaces what the user is waiting on. ' +
      'Output: list of awaiting threads sorted by days waiting (longest first), or "All your recent sent emails have received replies." ' +
      'Errors (success:false): gmail_not_connected, upstream_gmail.',
    input_schema: {
      type: 'object',
      properties: {
        days:       { type: 'number', description: 'Days back to scan sent mail (1-21, default 7).' },
        maxResults: { type: 'number', description: 'Max sent threads to scan (default 15).' },
      },
    },
  },
  // ── Feature: Recipient Context ────────────────────────────────────────────────
  {
    name: 'get_recipient_context',
    description:
      'Aggregate everything known about a recipient: upcoming GCal meetings with them, Notion pages mentioning them, and stored relationship memory. ' +
      'REQUIRED before draft_reply for any recipient whose email you have. ' +
      'Output: plain text grouped by source (Calendar / Notion / Memory) — or "No context found..." when empty (still success:true). ' +
      'Errors (success:false): validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Recipient\'s email address.' },
        name:  { type: 'string', description: 'Recipient\'s display name (improves Notion match quality).' },
      },
      required: ['email'],
    },
  },
  {
    name: 'memory_search',
    description:
      'PICK THIS for ONE memory query. For 2-20 queries in parallel about the same target (e.g. covering aliases for one person) use memory_unlimited_scan. ' +
      'Search Supermemory for relevant context about a person, topic, or previous interaction. Call at the start of any task involving a known contact, project, or recurring concern so prior decisions and preferences inform the work. ' +
      'Returns raw memory items so you can quote them; for the system-prompt summary form, the chat route already injects relevant memories every turn. ' +
      'Output: numbered list of "<text>  [score: <n?>  when: <iso?>  tags: <csv?>]"; or "No memories found." ' +
      'Errors (success:false): validation_error, memory_unavailable (no SUPERMEMORY_API_KEY set).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query — name, topic, project, decision.' },
        limit: { type: 'number', description: 'Max items (1-20, default 8).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_save',
    description:
      'Save a fact, decision, or interaction summary to Supermemory. Use at the end of any significant interaction or after the user states something worth remembering ("Priya is our biggest client", "always cc legal on contracts"). ' +
      'Stored under the current user. Tag with one or more categories so future searches can filter. Soft-write — no approval gate (the LLM is persisting observations, not contacting third parties). ' +
      'Output: "Saved to memory: \\"<first 100 chars>\\"" or a failure reason. ' +
      'Errors (success:false): validation_error, memory_unavailable.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact, summary, or context to remember. Prefix with [RELATIONSHIP], [PREFERENCE], or leave plain for general context.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional categorisation tags, e.g. ["client", "vip"] or ["preference"].' },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_user_model',
    description:
      'Update your persistent MENTAL MODEL of who this user is — the durable, structured understanding that grounds every judgment call. Call this whenever you learn something lasting about how the user operates: their business type, decision style, what they value, how they communicate, their work rhythm, risk tolerance, which contacts are VIP vs transactional, and which decisions are theirs (strategic) vs yours to make (routine). ' +
      'Merges with the existing model (arrays accumulate, deduped; scalars replace) — you do NOT need to resend the whole model, just the new understanding. This is different from memory_save: memory is individual facts; this is the shaped profile the agent reasons from. ' +
      'Output: a short confirmation + the refreshed model summary. Soft-write, no approval gate.',
    input_schema: {
      type: 'object',
      properties: {
        business_type: { type: 'string', description: 'e.g. "early-stage SaaS founder", "agency owner", "VC".' },
        decision_style: { type: 'string', description: 'e.g. "data-driven", "intuition-driven", "collaborative".' },
        communication_style: { type: 'string', description: 'e.g. "direct, no fluff", "warm and detailed".' },
        risk_tolerance: { type: 'string', description: 'e.g. "high", "medium", "low".' },
        values: { type: 'array', items: { type: 'string' }, description: 'What the user optimizes for, e.g. ["speed","relationships"].' },
        work_patterns: { type: 'array', items: { type: 'string' }, description: 'e.g. ["early mornings","Friday deep-work blocks","ignores weekends"].' },
        pain_points: { type: 'array', items: { type: 'string' }, description: 'What frustrates the user.' },
        opportunities: { type: 'array', items: { type: 'string' }, description: 'What excites/matters to the user.' },
        relationships: {
          type: 'object',
          description: 'Contact tiers. Names or emails.',
          properties: {
            vip: { type: 'array', items: { type: 'string' }, description: 'Always handle personally — never auto-act.' },
            trusted: { type: 'array', items: { type: 'string' }, description: 'Drafting on their behalf is fine.' },
            transactional: { type: 'array', items: { type: 'string' }, description: 'You can fully handle.' },
          },
        },
        decision_types: {
          type: 'object',
          description: 'Which calls are whose.',
          properties: {
            strategic: { type: 'array', items: { type: 'string' }, description: 'User decides — you flag, never act.' },
            tactical: { type: 'array', items: { type: 'string' }, description: 'You can decide with confidence + log it.' },
            routine: { type: 'array', items: { type: 'string' }, description: 'You handle silently.' },
          },
        },
      },
    },
  },
  {
    name: 'build_worklist',
    description:
      'Background-agent helper. Scans the inbox with a query and returns a filtered, tiered worklist of email threads that are actually worth processing this run. ' +
      'Filters out newsletters and promos. Skips threads the previous agent run already processed (looked up from memory by agentName). Skips threads currently claimed by other agents. ' +
      'Tiers: 1 = known client, 2 = revenue signal (contract/invoice/proposal/pricing), 3 = scheduling, 4 = other. Output is sorted by tier ascending. ' +
      'Use this BEFORE iterating through emails one-by-one — it cuts a 200-email inbox to ~30 items and prevents re-processing. ' +
      'Output: JSON array of {id, label, tier, signal} OR "No new items." Errors (success:false): validation_error, gmail_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        agentName: { type: 'string', description: 'Stable name of the calling agent — used to look up its previous run history.' },
        gmailQuery: { type: 'string', description: 'Gmail search query, e.g. "is:unread newer_than:1d" or "from:@client.com".' },
        maxResults: { type: 'number', description: 'Max results to scan (default 50, ceiling 100).' },
        clientDomains: { type: 'array', items: { type: 'string' }, description: 'Optional list of known client domains for tier-1 promotion, e.g. ["bigco.com","acme.io"].' },
      },
      required: ['agentName', 'gmailQuery'],
    },
  },
  {
    name: 'claim_worklist_items',
    description:
      'Background-agent helper. Records that the calling agent intends to process these item ids (Gmail thread ids, etc.) — written to a shared scratchpad with a 10-minute TTL. ' +
      'Other agents that call build_worklist will see these ids as "claimed by others" and skip them. Call IMMEDIATELY after build_worklist, before doing any actual work, so parallel agents do not duplicate. ' +
      'Output: "Claimed N items." Errors (success:false): validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'UUID of the calling agent (from agent context).' },
        agentName: { type: 'string', description: 'Human-readable agent name.' },
        itemIds: { type: 'array', items: { type: 'string' }, description: 'Item ids being claimed.' },
      },
      required: ['agentId', 'agentName', 'itemIds'],
    },
  },
  {
    name: 'check_draft_quality',
    description:
      'Self-correction helper. Scores a draft email body for generic filler ("I hope this finds you well", "looking forward to hearing from you", "synergies", etc.). ' +
      'Use AFTER calling draft_reply or draft_cold_email but BEFORE send_email — if the score is too high, re-draft with more specifics. ' +
      'Output: JSON {score (0-100), flagged: [{phrase, reason}], shouldRedraft (boolean — true at score >= 35)}. Errors (success:false): validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        draftBody: { type: 'string', description: 'The full draft email body to check.' },
      },
      required: ['draftBody'],
    },
  },
  {
    name: 'record_processed_items',
    description:
      'Background-agent helper. Persists the ids of items this run processed so the NEXT run can deduplicate. Call ONCE near the end of the run, before writing the report. ' +
      'Output: "Recorded N processed items for next-run dedup." Errors (success:false): validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        agentName: { type: 'string', description: 'Stable name of the calling agent.' },
        itemIds: { type: 'array', items: { type: 'string' }, description: 'Item ids that were processed this run.' },
      },
      required: ['agentName', 'itemIds'],
    },
  },
  // ── PART 1 — Gmail unlimited / batch / intelligence tools ─────────────────
  {
    name: 'gmail_unlimited_search',
    description:
      'PICK THIS for inbox-wide scans where you need >25 results (background-agent sweeps, "process every client thread this week", any task that calls for the full picture). For one-off ≤25-result lookups in chat use search_gmail. ' +
      'Paginates up to 200 results. Output format identical to search_gmail. ' +
      'Errors (success:false): validation_error, gmail_not_connected, upstream_gmail.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query, e.g. "is:unread newer_than:2d -category:promotions".' },
        maxResults: { type: 'number', description: 'Max results (1-200, default 100).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_bulk_read_threads',
    description:
      'Read up to 100+ Gmail threads in parallel. Returns full thread content for every id. Use after gmail_unlimited_search to fetch bodies for a worklist in one call rather than one read_email at a time. ' +
      'Output: concatenated "=== Thread <id> ===" sections. Failed threads are listed at the end. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' }, description: 'Gmail thread ids to fetch.' },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'gmail_batch_draft_replies',
    description:
      'Save up to 50 reply drafts in ONE call and render them as review cards in the chat (a gallery the user can edit and send from directly). ' +
      'USE THIS instead of calling draft_reply N times when the user asks to draft replies to several emails ("draft replies to the 5 emails waiting on me") — N sequential draft_reply calls time out; this one call does not. ' +
      'YOU compose every reply body first (read the threads with gmail_bulk_read_threads / read_email, ground each reply in that thread, write it in the user\'s voice, no em-dashes), then pass the finished { threadId, to, subject, body } for each. Nothing is sent — each draft appears as its own card the user reviews and sends. ' +
      'Output: per-item draft status; the drafts render as gallery cards automatically. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Up to 50 finished reply drafts. Compose each body yourself before calling.',
          items: {
            type: 'object',
            properties: {
              threadId: { type: 'string', description: 'Gmail thread id being replied to (from read_email / gmail_bulk_read_threads).' },
              to: { type: 'string', description: 'Recipient email address.' },
              subject: { type: 'string', description: 'Subject line, usually "Re: <original subject>".' },
              body: { type: 'string', description: 'The FULL reply body, written in the user\'s voice, grounded in the thread. Plain text, no em-dashes, no AI throat-clearing.' },
              recipientName: { type: 'string', description: 'Display name for the draft card.' },
              inReplyToMessageId: { type: 'string', description: 'Optional RFC Message-ID for correct threading.' },
            },
            required: ['threadId', 'to', 'body'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'gmail_batch_send_emails',
    description:
      'Send up to 50 emails. Optional staggerMs (0-60000) inserts a delay between sends so they do not all arrive at once. Each send goes through the normal send_email gate — when skipConfirmations is on, all 50 fire directly; otherwise each one queues for approval. ' +
      'Output: per-item delivery status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Up to 50 email send requests.',
          items: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              subject: { type: 'string' },
              body: { type: 'string' },
              threadId: { type: 'string', description: 'Optional — for replies in an existing thread.' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
        staggerMs: { type: 'number', description: 'Optional ms between sends (0-60000). 0 means fire all immediately.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'gmail_auto_label_threads',
    description:
      'Apply a Gmail label to many threads in one call. Creates the label automatically if it does not exist. Useful for "tag all client emails with Client-X" or "mark all sales inquiries as Sales-Hot". ' +
      'Output: count of threads labeled. Errors: validation_error, gmail_not_connected, upstream_gmail.',
    input_schema: {
      type: 'object',
      properties: {
        labelName: { type: 'string' },
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['labelName', 'threadIds'],
    },
  },
  {
    name: 'gmail_auto_archive_threads',
    description:
      'Archive many threads in one call (removes them from inbox; keeps them in All Mail). Use to clear newsletters, processed mail, or anything the agent has handled. ' +
      'Output: count archived. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'gmail_extract_data_from_threads',
    description:
      'For each thread, run an LLM extraction that returns structured JSON: senders, primarySender, subject, company, contactName, contactRole, decisions, actionItems, dollarAmounts, dates, projectNames, sentiment, urgencyScore, summary. ' +
      'Use to turn 30 sales emails into 30 deal records you can pass to Notion in one Notion batch call. ' +
      'Output: JSON array of { threadId, data, error? }. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'gmail_detect_conversation_type',
    description:
      'Classify each thread into one of: sales_inquiry, customer_support, internal_team, vendor_supplier, personal_spam, partnership_opportunity, hiring, feedback_complaint, update_notification. Returns category + confidence (0-1) + one-sentence reason per thread. ' +
      'Output: JSON array. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'gmail_generate_auto_replies',
    description:
      'Find threads where the user sent the last message N+ days ago and no reply has come — generate warm follow-up drafts for each. Drafts are saved to Gmail; call gmail_batch_send_emails to dispatch them. ' +
      'Output: per-thread follow-up draft summary. Errors: gmail_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        stalledDays: { type: 'number', description: 'Threshold for "stalled" (1-90, default 5).' },
        maxResults: { type: 'number', description: 'Max follow-ups to draft (1-50, default 10).' },
      },
    },
  },
  {
    name: 'gmail_detect_urgency',
    description:
      'Score each thread 1-10 for urgency (deadlines, ASAP language, VIP senders, contract/payment language). Returns sorted by urgency desc so the top of the list is what needs immediate attention. ' +
      'Output: JSON array of { threadId, urgencyScore, reason, needsImmediate }. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadIds'],
    },
  },
  // ── PART 2 — Calendar tools ──────────────────────────────────────────────
  {
    name: 'calendar_unlimited_scan',
    description:
      'PICK THIS BEFORE proposing any meeting time, before any conflict-detection pass, and for any window >7 days. Quick interactive "list tomorrow\'s meetings" lookups use get_calendar_events instead. ' +
      'Reads the entire calendar up to daysAhead (max 365), optionally merging Notion Calendar entries. Returns one structured JSON with all events sorted chronologically: title, start, end, attendees, meetLink, location, organizer, optional flag. ' +
      'Output: JSON. Errors: validation_error, gcal_not_connected, upstream_gcal.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: 'Window in days (1-365, default 30).' },
        maxResults: { type: 'number', description: 'Max events (1-250, default 100).' },
        includeNotionCalendar: { type: 'boolean', description: 'Default true — merges notion_get_calendar_events into the result.' },
      },
    },
  },
  {
    name: 'calendar_batch_create_events',
    description:
      'Create up to 25 calendar events in one call. Each item: { title, startTime, endTime, attendees[], description?, addGoogleMeet? }. Pairs cleanly with gmail_extract_data_from_threads → batch schedule. ' +
      'Each goes through schedule_meeting so the same skip_confirmations behavior applies. Output: per-item create status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Up to 25 meeting requests.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              startTime: { type: 'string', description: 'ISO 8601' },
              endTime: { type: 'string', description: 'ISO 8601' },
              attendees: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' },
              addGoogleMeet: { type: 'boolean' },
            },
            required: ['title', 'startTime', 'endTime'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'calendar_auto_detect_conflicts',
    description:
      'Scan the calendar for: (1) existing-vs-existing overlaps, (2) back-to-back meetings with <10 min gap, (3) proposed-vs-existing conflicts for any proposedEvents passed in. ' +
      'Use to triage scheduling-request floods before booking. Output: JSON conflict report. Errors: gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: '1-60, default 7.' },
        proposedEvents: {
          type: 'array',
          description: 'Optional list of { title, startTime, endTime } to check against existing schedule.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              startTime: { type: 'string' },
              endTime: { type: 'string' },
            },
            required: ['startTime', 'endTime'],
          },
        },
      },
    },
  },
  {
    name: 'calendar_auto_decline_low_priority',
    description:
      'Identify and (optionally) decline low-priority meetings: marked optional by the inviter, or matching webinar/all-hands/info-session/optional/fyi patterns. Pass dryRun=false to actually send declines via GCal PATCH. Default is dryRun=true so the user can review first. ' +
      'Output: JSON list of candidates with reasons, or "declined N/M" if dryRun=false. Errors: gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: '1-30, default 7.' },
        dryRun: { type: 'boolean', description: 'Default true. Set false to actually decline.' },
      },
    },
  },
  {
    name: 'calendar_generate_free_time_blocks',
    description:
      'Find free slots ≥ minBlockHours and create "🎯 Focus Time" events in them — protecting the time from being scheduled over. Prefers morning blocks. Pass dryRun=true to preview without creating. ' +
      'Output: count created or JSON preview. Errors: gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: '1-14, default 5.' },
        minBlockHours: { type: 'number', description: '1-8, default 2.' },
        maxBlocksPerDay: { type: 'number', description: '1-4, default 1.' },
        dryRun: { type: 'boolean', description: 'Default false (creates blocks).' },
      },
    },
  },
  {
    name: 'calendar_meeting_prep_automation',
    description:
      'Generate one-page meeting prep docs for upcoming external meetings. For each meeting: pulls recent emails with attendees, queries memory for context, composes a "## Context · ## Recent Interactions · ## Talking Points · ## Watch For" markdown doc. Optionally saves each to Notion. ' +
      'Output: JSON with per-meeting prep preview. Errors: gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'A specific event id to prep for. If omitted, scans all external meetings in the lookahead window.' },
        lookaheadHours: { type: 'number', description: '1-72, default 24.' },
        scanWindow: { type: 'boolean', description: 'Set true (with eventId omitted) to scan the whole window.' },
        saveToNotion: { type: 'boolean', description: 'Default true — saves each prep doc to Notion meetings DB.' },
      },
    },
  },
  {
    name: 'calendar_auto_generate_meet_links',
    description:
      'Find external meetings in the next daysAhead that have no Meet link, and add one to each (PATCH event with conferenceData.createRequest, sendUpdates=all so attendees get the updated invite). ' +
      'Output: count added. Errors: gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: '1-30, default 14.' },
      },
    },
  },
  {
    name: 'calendar_buffer_time_insertion',
    description:
      'Insert "☕ Buffer" blocks between back-to-back meetings that have <bufferMinutes gap. Pass dryRun=false to actually create them. ' +
      'Output: count of buffers inserted. Errors: gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        daysAhead: { type: 'number', description: '1-7, default 2.' },
        bufferMinutes: { type: 'number', description: '5-60, default 15.' },
        dryRun: { type: 'boolean', description: 'Default true.' },
      },
    },
  },
  {
    name: 'calendar_timezone_intelligence',
    description:
      'Convert a proposed time across the user timezone + all attendee timezones, flag zones where the local hour is outside 8am-7pm, and return a suggestion if any zone is unreasonable. ' +
      'Output: JSON with conversions + problemZones. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        proposedTime: { type: 'string', description: 'ISO 8601 timestamp.' },
        userTimezone: { type: 'string', description: 'IANA timezone (e.g. "America/Los_Angeles"). Default "UTC".' },
        attendeeTimezones: { type: 'array', items: { type: 'string' }, description: 'IANA timezones for each attendee.' },
      },
      required: ['proposedTime'],
    },
  },
  // ── PART 3 — Notion tools ────────────────────────────────────────────────
  {
    name: 'notion_auto_create_contact_profiles',
    description:
      'For each thread id, extract contact details via LLM (name, email, company, role, phone, relationship) and create a Notion page in the contacts database. Skips threads where no contact details could be extracted. ' +
      'Pairs with gmail_unlimited_search → results → this. Output: per-thread create status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
        databaseHint: { type: 'string', description: 'Notion database hint (default "contacts").' },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'notion_auto_log_all_communication',
    description:
      'For each thread, LLM-extract: subject, primaryContact, decisions[], actionItems[], nextStep, deadline, dealStage, sentiment. Create a structured Notion page in the communications database. ' +
      'Use AFTER processing inbound emails so the CRM stays current automatically. Output: per-thread log status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
        databaseHint: { type: 'string', description: 'Default "communications".' },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'notion_batch_create_database_entries',
    description:
      'Create up to 50 Notion database entries in parallel. Each item: { title, content, databaseHint?, properties? }. Properties pass through to create_notion_page so they must match the database schema. ' +
      'Output: per-entry create status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        databaseHint: { type: 'string', description: 'Default databaseHint for all items (per-item override possible).' },
        items: {
          type: 'array',
          description: 'Up to 50 entries.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              databaseHint: { type: 'string' },
              properties: { type: 'object' },
            },
            required: ['title'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'notion_auto_update_project_status',
    description:
      'For each thread, LLM-detect if it contains a project status update (% complete, next milestone, at-risk flag). If yes, create a status-update page in the Notion projects database. Threads without project mentions are skipped silently. ' +
      'Output: count of updates created. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'notion_auto_generate_meeting_notes',
    description:
      'For a given calendar event id, create a Notion meeting-notes page pre-filled with title, date, attendees, location, plus empty Discussion / Decisions / Action Items / Next Steps sections. ' +
      'Output: notion page URL/status. Errors: validation_error, gcal_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Google Calendar event id.' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'notion_deal_tracking_automation',
    description:
      'For each thread, LLM-extract: company, primaryContact, stage (prospect/qualified/proposal/negotiation/closed), dealValue, probability, timeline, nextAction, signals. Creates/updates a Notion deal page. ' +
      'Output: per-thread deal extraction summary. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'notion_create_smart_dashboards',
    description:
      'Generate a Notion dashboard page that aggregates current state across Gmail (unread snapshot), Calendar (next 3 days), and Memory (recent context). Saves to a "<kind>_dashboards" database. ' +
      'Output: notion page URL/status. Errors: none specific.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Dashboard kind: "business", "sales", "client_health", etc. Default "business".' },
        title: { type: 'string', description: 'Optional explicit title; auto-generated if omitted.' },
      },
    },
  },
  {
    name: 'notion_link_related_items',
    description:
      'Find Notion pages matching relatedQuery and return them as link candidates for a source pageId. Notion relation patching via API is database-schema-dependent so this tool returns the candidates + instructions rather than auto-patching. ' +
      'Output: list of candidate page matches. Errors: validation_error, notion_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        relatedQuery: { type: 'string', description: 'Search text used to find related pages.' },
      },
      required: ['pageId', 'relatedQuery'],
    },
  },
  {
    name: 'notion_auto_archive_completed_work',
    description:
      'Archive completed items in a Notion database by status value. Finds pages where the status property (default "Status", type status or select) equals one of completedValues (default Done/Completed/Closed/Shipped) and archives them (Notion archive is reversible — pages go to Trash). Pass dryRun:true to preview without archiving; maxArchive (default 50, max 100) caps one call. ' +
      'Output: archived count + titles. Errors: notion_not_connected, not_found, upstream_notion.',
    input_schema: {
      type: 'object',
      properties: {
        databaseHint: { type: 'string', description: 'Default "tasks".' },
        statusProperty: { type: 'string', description: 'Default "Status".' },
        completedValues: { type: 'array', items: { type: 'string' }, description: 'Default ["Done", "Completed", "Closed", "Shipped"].' },
        dryRun: { type: 'boolean', description: 'If true, preview the pages that would be archived without archiving. Default false.' },
        maxArchive: { type: 'number', description: 'Max pages to archive in one call. Default 50, max 100.' },
      },
    },
  },
  {
    name: 'notion_generate_weekly_summaries',
    description:
      'Generate a week-in-review Notion page aggregating: emails sent (count), meetings held (list), agent runs (from memory). Saves to "weekly_summaries" database. ' +
      'Output: notion page URL/status. Errors: none specific.',
    input_schema: {
      type: 'object',
      properties: {
        weekLabel: { type: 'string', description: 'Optional title override.' },
      },
    },
  },
  // ── PART 8 — Orchestration / utility tools ────────────────────────────────
  {
    name: 'agent_task_queue_management',
    description:
      'Prioritize a free-form task list by tier (1=client/revenue, 2=qualified leads, 3=scheduling, 4=other) and group adjacent same-tool tasks into batches with a suggestion of which bulk tool to call. ' +
      'Output: JSON with prioritized list + batch suggestions. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of { tool?, description, ... } items to prioritize.',
          items: { type: 'object' },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'error_recovery_and_retries',
    description:
      'Retry-with-exponential-backoff wrapper for any tool. Specify toolName, toolInput, maxAttempts (1-5, default 3), initialBackoffMs (100-5000, default 1000). Stops on first success; reports the full attempt log on final failure. ' +
      'Output: JSON with ok/finalAttempt/attempts. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        toolName: { type: 'string' },
        toolInput: { type: 'object' },
        maxAttempts: { type: 'number' },
        initialBackoffMs: { type: 'number' },
      },
      required: ['toolName', 'toolInput'],
    },
  },
  {
    name: 'performance_monitoring_and_optimization',
    description:
      'Query boult_audit_log for the user\'s recent tool-call stats: per-tool calls, success rate, avg duration, max duration. Flags bottlenecks (avg > 3s) and error-prone tools (success rate < 80% with 3+ calls). Returns a recommendation. ' +
      'Output: JSON. Errors: upstream_db.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '1-30, default 7.' },
      },
    },
  },
  {
    name: 'output_formatting_and_presentation',
    description:
      'Reformat raw content into a target format: briefing (executive markdown), report (structured markdown), slack-mrkdwn (Slack mrkdwn no tables), email-html (inline-styled HTML). Use at end of agent run to turn accumulated work into a deliverable. ' +
      'Output: formatted string. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        format: { type: 'string', enum: ['briefing', 'report', 'slack-mrkdwn', 'email-html'], description: 'Default "briefing".' },
        title: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'surface_proactive_signals',
    description:
      'PROACTIVE INITIATIVE — runs an LLM judgment pass over recent context (inbox results, calendar window, memory items) and emits a `signals` array of things the user did NOT ask about but should know. ' +
      'Use AFTER a broad search (gmail_unlimited_search, calendar_unlimited_scan) so the agent surfaces deadlines, stalled deals, conflicts, VIP-waiting threads, and revenue opportunities — within the user\'s saved rules. ' +
      'Categories: DEADLINE, STALLED_DEAL, CONFLICT, VIP_WAITING, RULE_VIOLATION_AVOIDED, OPPORTUNITY. Max 5 signals; the LLM is told to be surgical. ' +
      'Output: JSON { signals: [{category, summary, evidence[], suggestedAction?}] } or {signals:[]}. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        recentContext: { type: 'string', description: 'Required. Summary of what you just searched/fetched: inbox results, calendar window, memory items. The scan needs ground truth.' },
        userRules: { type: 'string', description: 'Optional. The user\'s saved binding instructions from the settings card.' },
        memoryContext: { type: 'string', description: 'Optional. Memory items relevant to the current task — relationship weights, preferences, prior decisions.' },
      },
      required: ['recentContext'],
    },
  },
  // ── PART 7 — Web & external research tools ────────────────────────────────
  {
    name: 'web_search_unlimited',
    description:
      'Run up to 20 web_search queries in parallel and return the union as { query: result } JSON. Use to cover multiple angles of one research target in a single call. ' +
      'Output: JSON. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' } },
        perQueryLimit: { type: 'number', description: '1-15, default 5.' },
      },
      required: ['queries'],
    },
  },
  {
    name: 'company_intelligence_research',
    description:
      'Deep research on a company: runs 5 parallel web searches (overview, funding, leadership, recent news, competitors), then LLM-distills into a JSON profile (summary, industry, size, fundingStage, recentFunding, leadership, recentNews, competitors, signals). ' +
      'Output: JSON. Errors: validation_error, no_results.',
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
      },
      required: ['company'],
    },
  },
  {
    name: 'contact_research_and_verification',
    description:
      'Research a person via web search (LinkedIn API is not available, so this uses public results only). Returns JSON with verifiedEmail, title, company, profileUrl, background, confidence level. Also reports emailFormatOk for format-level validation. ' +
      'Output: JSON. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        company: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
  // ── PART 6 — Content generation tools ─────────────────────────────────────
  {
    name: 'generate_email_sequence',
    description:
      'Generate a multi-email follow-up sequence for one goal. Returns JSON array of { dayOffset, subject, body } emails. To dispatch automatically over time, call schedule_email_send for each step with sendAt = now + dayOffset (the cron sends them at that time, no day-of action needed). ' +
      'Output: JSON. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What the sequence should achieve (e.g. "warm a stalled deal", "nurture a cold lead").' },
        recipientContext: { type: 'string', description: 'Background on the recipient (industry, prior context).' },
        dayOffsets: { type: 'array', items: { type: 'number' }, description: 'Days from start for each step (default [1, 3, 7, 10, 14]).' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'schedule_email_send',
    description:
      'Schedule email to be sent automatically at a future time (the cron dispatcher delivers it — the user does NOT need to be online). Two modes:\n' +
      'SINGLE: pass to/subject/body/sendAt for one email ("send this tomorrow at 9am"). Same confirmation as send_email applies.\n' +
      'BATCH: pass items[] (up to 100 emails, each with its own to/subject/body/sendAt) plus the approvalId from an approved batch request_confirmation. This is how you run bulk personalized outreach: draft each email individually, get ONE batch confirmation from the user, then schedule everything in ONE call with send times spread out (business hours, minutes apart, ~30-40/day). ' +
      'Output: scheduled count + send window. Errors (success:false): confirmation_required, gmail_not_connected, validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'SINGLE mode: recipient email address.' },
        subject: { type: 'string', description: 'SINGLE mode: email subject.' },
        body: { type: 'string', description: 'SINGLE mode: full email body (plain text).' },
        sendAt: { type: 'string', description: 'SINGLE mode: when to send, ISO 8601 (e.g. "2026-06-21T09:00:00-04:00"). Future, at most 1 year out.' },
        threadId: { type: 'string', description: 'Optional Gmail thread id to reply into (single mode).' },
        dedupKey: { type: 'string', description: 'Optional idempotency key — scheduling the same key twice is a no-op.' },
        items: {
          type: 'array',
          description: 'BATCH mode: the full list of emails to schedule. Each item is one personalized email with its own send time.',
          items: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address.' },
              subject: { type: 'string', description: 'Subject — short, specific, natural.' },
              body: { type: 'string', description: 'Personalized plain-text body for THIS recipient.' },
              sendAt: { type: 'string', description: 'ISO 8601 send time for this email — spread the batch across business hours and days.' },
            },
            required: ['to', 'body', 'sendAt'],
          },
        },
        approvalId: { type: 'string', description: 'BATCH mode: the approvalId returned by the batch request_confirmation the user approved. Required for batches in live chat.' },
      },
    },
  },
  {
    name: 'list_scheduled_emails',
    description:
      'List the user\'s upcoming scheduled emails (pending sends) with their send times and status. Call before scheduling to avoid duplicates, or to answer "what\'s queued to go out?". ' +
      'Output: list. Errors: none specific.',
    input_schema: {
      type: 'object',
      properties: {
        includeSent: { type: 'boolean', description: 'Also include recently sent/failed (default false — pending only).' },
      },
    },
  },
  {
    name: 'cancel_scheduled_email',
    description:
      'Cancel a pending scheduled email by its id (from list_scheduled_emails) before it sends. Already-sent emails cannot be cancelled. ' +
      'Output: confirmation. Errors (success:false): not_found, already_sent.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The scheduled email id to cancel.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'generate_proposal_documents',
    description:
      'Generate a professional proposal in markdown — executive summary, scope, deliverables, timeline, pricing, terms, next steps. Renders to canvas via canvasData. ' +
      'Output: canvas + status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        clientName: { type: 'string' },
        requirements: { type: 'string', description: 'What the client asked for.' },
        pricing: { type: 'string', description: 'Pricing details (omit to mark TBD).' },
        timeline: { type: 'string', description: 'Timeline (omit to mark TBD).' },
      },
      required: ['clientName', 'requirements'],
    },
  },
  {
    name: 'generate_client_reports',
    description:
      'Generate a monthly client report by aggregating recent emails + memory context for this client, then composing a structured markdown report (summary / activity / progress / next month / recommendations). ' +
      'Output: canvas + status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        clientName: { type: 'string' },
        clientEmail: { type: 'string', description: 'Optional — pulls recent emails to/from this address for activity metrics.' },
        monthLabel: { type: 'string', description: 'Defaults to current month.' },
      },
      required: ['clientName'],
    },
  },
  {
    name: 'generate_sow_documents',
    description:
      'Generate a Statement of Work in markdown by extracting deliverables/timeline/pricing from either sourceContent (a string) or threadIds (will be read via gmail_bulk_read_threads). Saves to canvas. ' +
      'Output: canvas + status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        sourceContent: { type: 'string', description: 'Negotiation transcript / requirements text.' },
        threadIds: { type: 'array', items: { type: 'string' }, description: 'Up to 5 Gmail threads to extract from.' },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'generate_internal_documentation',
    description:
      'Generate a how-to / runbook for an internal wiki. Composes a structured markdown doc and saves to Notion (internal_docs database). ' +
      'Output: notion page URL/status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        sourceContent: { type: 'string', description: 'Notes / transcript / examples to base the runbook on.' },
      },
      required: ['topic', 'sourceContent'],
    },
  },
  // ── PART 5 — Memory tools ─────────────────────────────────────────────────
  {
    name: 'memory_unlimited_scan',
    description:
      'Run multiple memory_search queries in parallel and return the union as { query: [items] }. Useful for "find everything about Client X" across multiple aliases. ' +
      'Output: JSON map of query → memory items. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'Up to 20 search queries.' },
        perQueryLimit: { type: 'number', description: 'Max items per query (1-20, default 10).' },
      },
      required: ['queries'],
    },
  },
  {
    name: 'memory_bulk_save_learning',
    description:
      'Save up to 100 memory entries in parallel. Each item: { content, tags? }. Use after a batch of email extraction so all 100 new facts land in one call. ' +
      'Output: count saved. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['content'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'memory_relationship_intelligence',
    description:
      'Build a relationship profile for one contact: persisted contact row + memory items + email-exchange metrics (sent/received counts, replyRatio) + risk flags (ghosted, lopsided). Tags the relationship as cold/warm/hot. ' +
      'Output: JSON. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        contactEmail: { type: 'string' },
      },
      required: ['contactEmail'],
    },
  },
  // ── PART 4 — Slack tools ──────────────────────────────────────────────────
  {
    name: 'slack_post_daily_briefing',
    description:
      'Post a daily briefing to Slack with: unread email count, today\'s meeting count, stalled follow-up count. Posts as a DM to the user by default; pass channel="#name" for a channel post. ' +
      'Output: send status. Errors: slack_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Slack channel name or "dm" (default).' },
      },
    },
  },
  {
    name: 'slack_real_time_urgent_alerts',
    description:
      'Score the given threads via gmail_detect_urgency and post a Slack alert if any cross urgencyThreshold (default 7). Pairs cleanly with build_worklist → gmail_detect_urgency → this. ' +
      'Output: alert status or "no alert needed". Errors: validation_error, slack_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        threadIds: { type: 'array', items: { type: 'string' } },
        channel: { type: 'string', description: 'Default "dm".' },
        urgencyThreshold: { type: 'number', description: '1-10, default 7.' },
      },
      required: ['threadIds'],
    },
  },
  {
    name: 'slack_team_digest_weekly',
    description:
      'Post a weekly team digest to a Slack channel: emails sent, meetings held, agent runs this week. ' +
      'Output: send status. Errors: slack_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Default "#team-digest".' },
      },
    },
  },
  {
    name: 'slack_deal_update_notifications',
    description:
      'Post one Slack message per deal-stage change (company, fromStage → toStage, value, nextAction). Useful when notion_deal_tracking_automation detects a stage change. ' +
      'Output: per-update post status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Default "#sales-pipeline".' },
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              fromStage: { type: 'string' },
              toStage: { type: 'string' },
              value: { type: 'string' },
              nextAction: { type: 'string' },
            },
            required: ['company'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'slack_task_assignment_notifications',
    description:
      'Post task assignment messages to a Slack channel — one per task. Each task: { description, owner?, deadline?, context?, notionUrl? }. ' +
      'Output: per-task post status. Errors: validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Target Slack channel.' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              owner: { type: 'string' },
              deadline: { type: 'string' },
              context: { type: 'string' },
              notionUrl: { type: 'string' },
            },
            required: ['description'],
          },
        },
      },
      required: ['channel', 'tasks'],
    },
  },
  {
    name: 'slack_approval_request_routing',
    description:
      'Post a structured approval request to Slack ("Action: X · Question: Y · Approve in dashboard"). Approvals route through the dashboard, not Slack-reply listening. ' +
      'Output: send status. Errors: validation_error, slack_not_connected.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Default "dm".' },
        actionDescription: { type: 'string', description: 'One-line description of the proposed action.' },
        question: { type: 'string', description: 'The specific question for the user.' },
        dashboardUrl: { type: 'string', description: 'Optional override of the approval dashboard URL.' },
      },
      required: ['actionDescription', 'question'],
    },
  },
  {
    name: 'memory_get_contact_profile',
    description:
      'Aggregate everything Boult knows about one contact: the persisted relationship row (notes / tags / email count / last contact) PLUS Supermemory items mentioning their email or name. ' +
      'Output: plain-text card with the relationship row first, then a numbered list of related Supermemory items, or "No history exists for <email>." when both are empty. ' +
      'Errors (success:false): validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        contactEmail: { type: 'string', description: 'Contact email address (lowercased internally).' },
        name: { type: 'string', description: 'Optional display name to broaden the Supermemory search.' },
      },
      required: ['contactEmail'],
    },
  },
  {
    name: 'get_contact_context',
    description:
      'Look up the persisted relationship-memory row for a contact (notes, tag list, email count, last contact). ' +
      'Output: plain-text contact card or "No relationship memory yet for <email>." ' +
      'Errors (success:false): validation_error, migration_missing.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Contact email address.' },
      },
      required: ['email'],
    },
  },
  {
    name: 'remember_about_contact',
    description:
      'Append a durable note (and optional tags) to a contact\'s relationship-memory row. Use when the user states a fact about someone worth keeping. ' +
      'Output: "Saved to relationship memory for ..." ' +
      'Errors (success:false): validation_error, contact_save_failed.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Contact email address (lowercased before storage).' },
        name:  { type: 'string', description: 'Display name to set/update.' },
        note:  { type: 'string', description: 'Free-text fact to remember.' },
        tags:  { type: 'array', items: { type: 'string' }, description: 'Optional tags, e.g. ["client", "vip"].' },
      },
      required: ['email', 'note'],
    },
  },
  {
    name: 'get_delegation_rules',
    description:
      'List active delegation rules — standing instructions Boult applies during proactive triage. ' +
      'Output: numbered list of rules with name, action type, triggers; or "No delegation rules set up yet." ' +
      'Errors (success:false): migration_missing.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_delegation_rule',
    description:
      'Persist a new delegation rule. Use when the user says "whenever X happens, do Y." ' +
      'Output: "Delegation rule \\"X\\" created..." ' +
      'Errors (success:false): validation_error (missing name or action_type), rule_save_failed.',
    input_schema: {
      type: 'object',
      properties: {
        name:             { type: 'string', description: 'Short rule name shown to the user.' },
        trigger_keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords matched against incoming email subject/body.' },
        trigger_from:     { type: 'string', description: 'Optional: only trigger for emails from this address or domain.' },
        action_type:      { type: 'string', enum: ['draft_reply', 'notify', 'label'], description: 'What to do when the rule triggers.' },
        action_config:    { type: 'object', description: 'Action parameters, e.g. { template: "..." } or { label: "urgent" }.' },
      },
      required: ['name', 'action_type'],
    },
  },
  {
    name: 'update_canvas',
    description:
      'Update the currently-open Canvas document. Two modes:\n' +
      '  • "replace" (default): pass the FULL updated markdown — overwrites whatever is on screen.\n' +
      '  • "append": pass ONLY the new content to add; the server merges it onto the last-known canvas for this conversation (blank line separator) so you don\'t have to resend the whole document.\n' +
      'Append falls back to replace when there is no prior canvas state for this conversation (first call, background-agent run, or after a server restart) — the output flags this so you can mention it.\n' +
      'FOR "REPLACE": start from the "Current Canvas" block in your system context (the exact live text), not from memory of writing it — reproduce it faithfully and change ONLY what the user asked for. Silently regenerating a shorter version from a vague recollection of the topic is the single most common way this tool is misused; the user notices immediately because sections they never asked to lose are gone. ' +
      'Output: "Canvas updated: <title>" with an optional " (appended)" or fallback note + canvasData.isUpdate = true. ' +
      'Errors (success:false): validation_error (empty markdown).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'New title (or repeat the existing title).' },
        type: { type: 'string', enum: ['email_draft', 'report', 'notes', 'analysis', 'action_plan'], description: 'Document type.' },
        markdown: { type: 'string', description: 'For replace: complete updated markdown. For append: just the new content to add.' },
        mode: { type: 'string', enum: ['replace', 'append'], description: 'Update mode. Default "replace".' },
      },
      required: ['title', 'markdown'],
    },
  },
  {
    name: 'web_search',
    description:
      'PICK THIS for ONE real web query needing live results (news, recent events, company pages). For Wikipedia-style fact lookups ("when did X launch?") use the faster web_search_instant. For multi-angle research (5+ parallel queries on one target) use web_search_unlimited. ' +
      'Web search via Serper/Brave/DuckDuckGo with automatic provider fallback. Returns summaries — not full pages. ' +
      'Output: "Web search results for X:" followed by numbered hits with title, snippet, URL. ' +
      'Errors (success:false): web_search_unavailable (all providers down).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        maxResults: { type: 'number', description: 'Max results (1-10, default 6).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_search_instant',
    description:
      'DuckDuckGo Instant Answer ONLY — knowledge-base summary + related topics, no live web crawling. Fast (~1s) and zero-cost. ' +
      'Use for quick fact checks ("when did X launch?", "who is X?") where a Wikipedia-style abstract is enough. For real web results, use web_search. ' +
      'Output: "Instant answer for X:" with summary, an optional related-topics list, and the source abstract URL when one is given. ' +
      'Errors (success:false): web_search_unavailable (DDG timeout or no answer in their knowledge base — try web_search instead). ' +
      'Does NOT browse pages — say so explicitly to the user if they asked for deeper research.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Short fact-check query.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_slack_message',
    description:
      'Post a Slack message to a channel or DM the user themselves. For DMs to OTHER users use slack_send_dm. ' +
      'GATED: requires a prior request_confirmation with matching Channel detail. ' +
      'Output: "Slack message sent to <channel>." ' +
      'Errors (success:false): confirmation_required, slack_not_connected, upstream_slack.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (e.g. "#general") or "dm" to DM the user themselves.' },
        text: { type: 'string', description: 'Message body in Slack mrkdwn.' },
      },
      required: ['channel', 'text'],
    },
  },
  {
    name: 'slack_find_user',
    description:
      'Look up a Slack user by email (preferred) or display name. REQUIRED before slack_send_dm — never guess a Slack user id. ' +
      'Output: plain text with "User: <name>  id: <U…>  email: <addr>"  for one match, OR a numbered list for multiple name matches. ' +
      'Errors (success:false): slack_not_connected, validation_error, user_not_found, upstream_slack.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address to look up (uses Slack\'s users.lookupByEmail — exact match, fastest path).' },
        name: { type: 'string', description: 'Display name or real name fragment when email is unknown. Returns up to 5 matches.' },
      },
    },
  },
  {
    name: 'slack_send_dm',
    description:
      'Open a DM conversation with a specific Slack user and post a message. ' +
      'Prerequisites: slack_find_user to resolve the userId. ' +
      'GATED: requires a prior request_confirmation with matching User detail. ' +
      'Output: "Sent DM to <userId>." plus the message permalink. ' +
      'Errors (success:false): confirmation_required, slack_not_connected, validation_error, upstream_slack.',
    input_schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Slack user id (starts with U…) from slack_find_user.' },
        text: { type: 'string', description: 'Message body in Slack mrkdwn.' },
      },
      required: ['userId', 'text'],
    },
  },
  {
    name: 'slack_get_channels',
    description:
      'List the public and private channels the Slack bot has access to (excludes archived and DMs). ' +
      'Output: numbered list of "<name>  [id: <C…>  type: public|private  members: <n>]". ' +
      'Errors (success:false): slack_not_connected, upstream_slack.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max channels to return (1-200, default 100).' },
      },
    },
  },
  {
    name: 'fetch_notion_schema',
    description:
      'Resolve a database hint to a real Notion database id and return its property schema. ' +
      'REQUIRED before create_notion_page when writing to a database. ' +
      'Output: plain text with database_id and a property table (name + type + options). ' +
      'Errors (success:false): notion_not_connected, notion_db_not_found, notion_schema_unreadable.',
    input_schema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database hint, e.g. "meetings", "tasks", "contacts".' },
        parentId: { type: 'string', description: 'Exact database id if you already have one — skips the search.' },
      },
      required: ['database'],
    },
  },
  {
    name: 'notion_read_page',
    description:
      'Fetch a Notion page\'s full content as markdown plus its property values. Recursively walks child blocks (paragraphs, headings, lists, todos, quotes, code, dividers). ' +
      'Output: plain text with the page URL, the property name/value pairs, then the body markdown. ' +
      'Errors (success:false): notion_not_connected, validation_error, not_found, upstream_notion.',
    input_schema: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Notion page id (with or without dashes) or a Notion page URL.' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'notion_read_database',
    description:
      'Read the ROWS of a Notion database as structured records — use this to pull a lead/contact list, a CRM, or any table out of Notion. ' +
      'Resolves the database by name hint (or exact id), reads its schema, then returns up to `limit` rows with every property flattened to plain text (title, email, phone, url, select, status, people, rich_text, number, checkbox, date). ' +
      'This is the tool for "email everyone in my Leads database" — read the rows, then map the email + name/company columns yourself. ' +
      'Output: plain text — the resolved database name + a numbered list of rows, each showing its property name/value pairs and page URL. ' +
      'Errors (success:false): notion_not_connected, notion_db_not_found, upstream_notion. Empty database returns success:true with a "0 rows" note.',
    input_schema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database name hint, e.g. "Leads", "Contacts", "CRM". Matched by title against the workspace.' },
        databaseId: { type: 'string', description: 'Exact Notion database id if you already have one (from fetch_notion_schema) — skips the name search.' },
        limit: { type: 'number', description: 'Max rows to return (1-100, default 50).' },
      },
    },
  },
  {
    name: 'notion_create_task',
    description:
      'Create a task in the user\'s tasks database — convenience wrapper over create_notion_page with task-specific fields. ' +
      'GATED: shares the create_notion_page approval gate, so request_confirmation with action "Create Notion page" and Title detail is required first. ' +
      'Auto-resolves the tasks database via the "tasks" hint and maps dueDate / priority onto the first matching schema property. ' +
      'Output: confirmation text + canvasData with the new page URL. ' +
      'Errors (success:false): confirmation_required, notion_not_connected, notion_db_not_found, notion_create_failed.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title — what needs to be done.' },
        dueDate: { type: 'string', description: 'Optional ISO 8601 date (YYYY-MM-DD or full timestamp).' },
        description: { type: 'string', description: 'Optional task body — context, sub-steps, related links.' },
        priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Urgent'], description: 'Optional priority — mapped onto the first select/status property whose options include this label.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'notion_get_calendar_events',
    description:
      'Read pages from a Notion database that has a date property, filtered to a time window. Use to merge Notion-tracked calendar entries with Google Calendar. ' +
      'If no hint/databaseId is given, auto-discovers ANY date-bearing database in the connected workspace (Tasks / Roadmap / Schedule / etc., not only ones named "calendar"). ' +
      'When the workspace has no readable date-bearing database, returns success:true with an empty "No Notion calendar source" note — the standalone Notion Calendar app has no public API, so this is a benign skip, not an error. Do NOT tell the user to reconnect on an empty result. ' +
      'Output: plain text listing each event with date, title, and any "attendees" / "people" property values. ' +
      'Errors (success:false): notion_not_connected, validation_error, upstream_notion.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO 8601 start of window.' },
        endDate: { type: 'string', description: 'ISO 8601 end of window.' },
        database: { type: 'string', description: 'Optional hint for which Notion database to read (e.g. "Tasks", "Roadmap"). When omitted, any date-bearing database is auto-discovered. Ignored when databaseId is set.' },
        databaseId: { type: 'string', description: 'Exact Notion database id — preferred when known.' },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'create_notion_page',
    description:
      'Create a page in a Notion database (or as a free-form page if no database match). ' +
      'GATED: requires a prior request_confirmation with matching Database+Title. ' +
      'Prerequisites: fetch_notion_schema first — pass the returned id as parentId and the EXACT property names from the schema in `properties`. ' +
      'Output: confirmation text + canvasData.pageMeta with the page URL. ' +
      'Errors (success:false): confirmation_required, notion_not_connected, notion_db_not_found, notion_create_failed.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title.' },
        content: { type: 'string', description: 'Full page body in plain text / markdown.' },
        database: { type: 'string', description: 'Database hint when parentId is unknown — Boult searches for a matching db.' },
        parentId: { type: 'string', description: 'Exact database id from fetch_notion_schema — preferred over `database` hint.' },
        properties: {
          type: 'object',
          description: 'Per-property values keyed by EXACT schema property name. Strings for text/select/date/url, string[] for multi_select, number for number, boolean for checkbox.',
          additionalProperties: true,
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'report_generate',
    description:
      'Render a lean agent-run report from a tool-call execution log. Deterministic templating (no LLM call) producing a SHORT 3-section markdown report the user can skim in five seconds: ' +
      '(1) One-line summary as the very first line — human-readable action counts like "Drafted 6 replies, booked 2 meetings, archived 12 threads." This is the headline AND the email subject. ' +
      '(2) "What I Did" — table (Action | Details | Link) when 4+ items, bullet list for fewer. Tool names become human labels; links ride inline on their own row. ' +
      '(3) "Needs Your Attention" — ONLY when there are failures or skipped items. Omitted entirely when everything succeeded. ' +
      'Then a single-line footer. There is deliberately NO separate Links section (links are already on their line item) and no run-timestamp line — keep reports short. ' +
      'Use this instead of hand-writing report markdown — keeps every report visually consistent. ' +
      'Output: plain text containing the rendered markdown. Pass it to report_send_gmail or report_send_slack for delivery. ' +
      'No failure path — empty executionLog still produces a valid report.',
    input_schema: {
      type: 'object',
      properties: {
        executionLog: {
          type: 'array',
          description: 'Tool calls executed during the run. Each entry: { tool, success, summary, error?, links? }.',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              success: { type: 'boolean' },
              summary: { type: 'string' },
              error: { type: 'string' },
              links: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        skippedItems: { type: 'array', items: { type: 'string' }, description: 'Items the agent deliberately did not handle this run (e.g. "12 newsletters not archived — user has not approved bulk archive").' },
        summaryLine: { type: 'string', description: 'Optional one-line summary override. If omitted, derived from executionLog with human-readable action names.' },
        nextRunTime: { type: 'string', description: 'Optional human-readable next run time for recurring agents (e.g. "Tomorrow at 9:00 AM"). Appears in footer.' },
      },
      required: ['executionLog'],
    },
  },
  {
    name: 'report_send_gmail',
    description:
      'Send an agent-run report to the user\'s OWN Gmail address as a professional HTML email. ' +
      'The markdown is converted to a styled HTML email with dark header bar (BOULT branding), bordered tables with alternating rows, ' +
      'styled links, and a branded footer. Looks like it came from a professional service, not a script. ' +
      'Subject line: if not provided, auto-extracted from the report\'s one-line summary (first line before any heading). ' +
      'Self-send only (recipient = the authed user) so no request_confirmation gate. ' +
      'Output: "Sent report to <email>. Gmail Message ID: <id>." ' +
      'Errors (success:false): gmail_not_connected, validation_error, send_failed.',
    input_schema: {
      type: 'object',
      properties: {
        reportMarkdown: { type: 'string', description: 'Markdown body (from report_generate or hand-rolled). Tables, lists, headings, and links are all rendered as styled HTML.' },
        subject: { type: 'string', description: 'Email subject. If omitted, auto-extracted from the first line of the report markdown.' },
      },
      required: ['reportMarkdown'],
    },
  },
  {
    name: 'report_send_slack',
    description:
      'Post an agent-run report to Slack using Block Kit for professional formatting. ' +
      'Header block with ✅ emoji + one-line summary, dividers between sections, emoji-prefixed action blocks ' +
      '(📧 email, 📅 calendar, 📝 Notion, ⚠️ attention items), tables rendered as structured mrkdwn, and a context footer with timestamp. ' +
      'Default destination is a DM to the user themselves (no gate). When `channel` is set to a public/private channel, routes through send_slack_message and requires a prior request_confirmation. ' +
      'Output: "Sent report to <dm|channel>. ts: <message_ts>." ' +
      'Errors (success:false): slack_not_connected, confirmation_required (when channel set without approval), upstream_slack.',
    input_schema: {
      type: 'object',
      properties: {
        reportMarkdown: { type: 'string', description: 'Markdown body (from report_generate or hand-rolled). Tables and lists are converted to structured Block Kit sections.' },
        channel: { type: 'string', description: 'Optional Slack channel name. Omit (or pass "dm") to DM the user themselves with no confirmation gate.' },
      },
      required: ['reportMarkdown'],
    },
  },
  {
    name: 'list_scheduled_agents',
    description:
      'Return the user\'s scheduled background agents — name, cron schedule, output channel, status (active/paused), last_run_at, last_report_summary, next-run estimate. ' +
      'Use when the user asks to see / inspect / manage their agents (e.g. via /agents). ' +
      'Output: plain-text list, one agent per block, with the fields above. "No scheduled agents." when empty. ' +
      'Errors (success:false): list_agents_failed.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pause_scheduled_agent',
    description:
      'Pause a scheduled background agent — it stops firing on its cron until resumed. The agent row stays in the database with status="paused". ' +
      'Required identifier: pass agent_id (preferred — get it from list_scheduled_agents output) OR match_name (case-insensitive substring of the agent\'s name; only matches a single agent unambiguously). ' +
      'Output: "Paused agent: <name>." with the row\'s new status. ' +
      'Errors (success:false): validation_error (missing both identifiers), not_found, ambiguous_match (match_name matched more than one), pause_failed.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'UUID of the agent to pause (from list_scheduled_agents).' },
        match_name: { type: 'string', description: 'Alternative: case-insensitive substring of the agent\'s name. Must match exactly one agent.' },
      },
    },
  },
  {
    name: 'resume_scheduled_agent',
    description:
      'Resume a paused background agent — it starts firing on its cron again. Sets status="active". ' +
      'Required identifier: agent_id OR match_name (same rules as pause_scheduled_agent). ' +
      'Output: "Resumed agent: <name>." ' +
      'Errors (success:false): validation_error, not_found, ambiguous_match, resume_failed.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'UUID of the agent to resume.' },
        match_name: { type: 'string', description: 'Alternative: case-insensitive substring of the agent\'s name.' },
      },
    },
  },
  {
    name: 'delete_scheduled_agent',
    description:
      'Permanently delete a scheduled background agent — removes the row from the database. This is destructive; you MUST call request_confirmation FIRST and only call this after the user approves. ' +
      'Required identifier: agent_id OR match_name. ' +
      'Output: "Deleted agent: <name>." ' +
      'Errors (success:false): validation_error, not_found, ambiguous_match, confirmation_required (when called without prior approval), delete_failed.',
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'UUID of the agent to delete.' },
        match_name: { type: 'string', description: 'Alternative: case-insensitive substring of the agent\'s name.' },
      },
    },
  },
  {
    name: 'forget_memory',
    description:
      'Delete a stored memory from boult_memories. Use when the user says "forget X", "stop remembering Y", or asks to clean up specific memory items. ' +
      'Two modes: pass memory_id (preferred — exact UUID from memory_search output) OR match_text (case-insensitive substring; deletes ALL memories whose content contains it, up to max_delete rows). ' +
      'Destructive — for match_text mode, call memory_search first to show the user what matches, then request_confirmation before this call. ' +
      'Output: "Forgot N memor(y|ies)." with the count deleted and a short preview of each removed item. ' +
      'Errors (success:false): validation_error (neither id nor text), not_found, forget_failed.',
    input_schema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'UUID of the memory row to delete (from memory_search).' },
        match_text: { type: 'string', description: 'Alternative: case-insensitive substring of the memory content. Deletes every memory whose content contains it.' },
        max_delete: { type: 'number', description: 'Safety cap for match_text mode (default 5). Refuses if more rows match than this.' },
      },
    },
  },
  {
    name: 'remember',
    description:
      'Save an explicit, user-driven memory — fact, preference, contact note, working agreement. Use when the user says "remember that…", "note that…", "keep in mind…", or via /remember slash. ' +
      'Different from memory_save: this writes with source="user", so it persists even when the user has the auto-memory toggle off — explicit asks always honored. ' +
      'Output: "Remembered: <preview>" with tags if provided. ' +
      'Errors (success:false): validation_error.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact, preference, or note to remember. Be specific — write it the way you\'d want to find it back later (e.g. "User prefers concise Slack replies, no greetings" rather than "User likes short messages").' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional categorization labels (e.g. ["preference"], ["contact","client"], ["rule"]).' },
      },
      required: ['content'],
    },
  },
  {
    name: 'log_meeting_notes',
    description:
      'Save user-written notes from a recent meeting and extract structured action items + key facts via LLM. ' +
      'Attaches to a row in boult_meeting_events (the most recent past meeting OR the one matching meeting_title). ' +
      'Action items can have optional due dates parsed from the notes ("by Thursday" / "next week" → ISO date). ' +
      'Key facts are saved as their own [CONTEXT] memories tagged with attendee emails so future meeting preps with the same people surface them automatically. ' +
      'Use when the user says "log my notes from <meeting>", "here\'s what we discussed at <meeting>", or via /log slash command. ' +
      'Output: confirmation + list of extracted action items (with due dates) + count of key facts saved. ' +
      'Errors (success:false): validation_error (empty notes), not_found (no matching meeting), log_meeting_failed.',
    input_schema: {
      type: 'object',
      properties: {
        notes: { type: 'string', description: 'The user\'s free-form notes about the meeting — paragraph, bullets, or stream-of-consciousness all fine.' },
        meeting_title: { type: 'string', description: 'Optional: case-insensitive substring of the meeting title to attach notes to. If omitted, attaches to the most recent past meeting.' },
      },
      required: ['notes'],
    },
  },
  {
    name: 'create_scheduled_agent',
    description:
      'Register a persistent background agent. Two-stage flow:\n' +
      '  Stage 1 (first call, no _planApproved): pass spec_markdown with the full agent specification. ' +
      'Renders the spec in canvas + a "Confirm spec / Edit" card. No DB write yet.\n' +
      '  Stage 2 (_planApproved: true): the UI sends this automatically when the user clicks Confirm spec. ' +
      'Inserts the agent into the database and returns the live-agent card.\n' +
      'You only call this tool ONCE — the UI handles the Stage 2 invocation. Do NOT call it again yourself.\n' +
      'Errors (success:false): validation_error (missing name/task/cron, bad cron format, missing spec_markdown), migration_missing, agent_create_failed.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short human name for the agent, e.g. "Maily Whale Scout Daily Harvest"' },
        task_description: { type: 'string', description: 'The full instruction the agent runs every time it fires. Write it as a direct, self-contained command including all filtering rules, data sources, and what to deliver.' },
        cron_schedule: { type: 'string', description: '5-field cron expression "m h dom mon dow" in the user\'s local time, e.g. "5 5 * * *" for daily at 05:05.' },
        output_channel: { type: 'string', enum: ['gmail', 'slack', 'both'], description: 'Where the report is delivered. Default "gmail".' },
        slack_channel: { type: 'string', description: 'Slack channel name (only if output_channel is slack or both).' },
        skip_confirmations: { type: 'boolean', description: 'If true, the agent acts (sends/publishes) without asking for approval. Default false.' },
        expires_at: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD) after which the agent auto-pauses. Omit for no expiry.' },
        spec_markdown: { type: 'string', description: 'STAGE 1 ONLY — the full agent specification markdown. REQUIRED structure: # <Agent Name> H1, then ## Objective (1-2 sentences), then ## Steps containing an ```boult-steps fenced JSON block with {steps:[{label, description}]} — NOT inline-numbered prose, then ## Schedule & Delivery (bullets for schedule + delivery), then ## Expected Output (one paragraph). Each ## section on its own line with blank lines around it. No bracketed placeholders.' },
        _planApproved: { type: 'boolean', description: 'Internal — set to true by the UI after the user clicks Confirm spec. Never set this yourself; the UI handles it.' },
        // ── Next-gen scheduling (all optional; omit for a normal time-based agent) ──
        trigger_type: { type: 'string', enum: ['schedule', 'event', 'condition', 'chained'], description: 'How the agent fires. "schedule" (default) = runs at cron_schedule. "event"/"condition" = runs when a new email OR newly-booked calendar meeting matches `conditions` (no cron needed). "chained" = only runs when an upstream agent triggers it via its pipeline.' },
        trigger_config: { type: 'object', description: 'Config for non-schedule triggers. { "event_source": "gmail" | "calendar", "debounce_min": 15 }. event_source defaults to "gmail"; use "calendar" to fire when a meeting is booked. debounce_min throttles re-fires. For calendar, optional "booked_within_days" (default 2) sets how recently a meeting must have been booked to count as new.' },
        conditions: { type: 'array', description: 'For event/condition agents: an AND-list of rules. Each {field, op, value}. field: sender|domain|subject|keyword|amount|age_days|attendee. op: eq|contains|matches|gte|lte|in. Email examples: [{"field":"domain","op":"contains","value":"@acme.com"}] fires on any email from acme.com. Calendar examples (event_source=calendar): [{"field":"attendee","op":"contains","value":"@vip.com"}] fires when a meeting with a VIP gets booked; omit conditions to fire on ANY new meeting. Empty/omitted = any new item.', items: { type: 'object' } },
        pipeline: { type: 'array', description: 'Ordered list of OTHER agent ids to trigger after THIS agent finishes, handing them this run\'s summary + artifacts (Triage → Draft → Digest). Omit for standalone agents.', items: { type: 'string' } },
        priority: { type: 'number', description: '1 (highest) – 9. When many agents are due at once, higher priority gets tool budget first. Default 5.' },
      },
      required: ['name', 'task_description'],
    },
  },
  {
    name: 'request_confirmation',
    description:
      'Show the user a confirmation card and pause the loop. REQUIRED before any of: send_email, schedule_meeting, send_slack_message, create_notion_page — the executor refuses those write calls without a matching approved row. ' +
      'After calling, STOP — do not call any more tools this turn. Transitions state to CONFIRMING. ' +
      'Output: confirmation message + canvasData with type "confirmation_required" and an approvalId the UI POSTs to /api/boult/approval/confirm. ' +
      'No failure path under normal use — always success:true.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Short label for the action, e.g. "Send email", "Create calendar event", "Post to Slack"' },
        description: { type: 'string', description: 'One sentence describing exactly what will happen.' },
        why: { type: 'string', description: 'One short line of observed receipts for why this is the right call — so approving is a confirmation, not an inspection. E.g. "She asked for Thursday; your 2pm is free." Ground it ONLY in what you actually read this turn.' },
        details: {
          type: 'object',
          description: 'Key field/value pairs shown to the user (e.g. { "To": "john@example.com", "Subject": "Project update", "Channel": "#general" })',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['action', 'description'],
    },
  },
  {
    name: 'ask_user',
    description:
      'Ask 1-3 clarifying questions when the instruction is genuinely ambiguous, contradictory, or suspicious (looks risky, violates a saved rule, or reads like it was not meant for you) and a reasonable default does not exist. ' +
      'Loop emits a `question` SSE event and ends the turn. ' +
      'Output: emits a question event; tool result content is short. ' +
      'No failure path. Do NOT use ask_user when context, history, or sensible defaults can resolve the ambiguity — answer questions cost the user time.',
    input_schema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'One to three questions to ask the user.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The question text.' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'STRONGLY RECOMMENDED: 2-4 short answer choices ordered MOST-PROBABLE FIRST — the first option is your best guess and renders preselected as "Suggested", so the user can accept it with one tap instead of typing. The card always offers a free-text field too, so options never trap the user. Omit ONLY when the answer is truly unguessable (a name, an email address, a date only they know).',
              },
            },
            required: ['text'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'switch_to_plan_mode',
    description:
      'Switch this conversation from agent (execute) mode into plan mode. Call at ANY point when you realize the request is large, multi-phase, strategic, or risky enough that the user should review a structured plan BEFORE execution — even mid-conversation. ' +
      'The UI re-runs the current request through the plan pipeline and renders a reviewable plan card with Execute/Cancel. ' +
      'After calling, STOP — do not call any more tools this turn. ' +
      'Do NOT use for simple single-step or clearly-scoped tasks (just do those), and never call it twice for the same request.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'One short sentence on why this deserves a reviewed plan first.' },
      },
      required: [],
    },
  },
  {
    name: 'digest_newsletters',
    description:
      'Find recent newsletter/promotional emails, condense them into one Canvas digest, and (optionally) archive them. ' +
      'Use when the user explicitly asks to digest, clear, or summarize newsletters. ' +
      'Output: summary text + canvasData (type "report") with the digest. Reports the digested count, archived count, and whether emailed. ' +
      'Errors (success:false): gmail_not_connected, digest_failed. ' +
      'archive:true is a write — set it only after the user has explicitly approved archiving (omit it on the first call and offer to clear after).',
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'number', description: 'How many days back to scan for newsletters (default 7, max 30).' },
        archive: { type: 'boolean', description: 'If true, archive the newsletters out of the inbox and mark them read after digesting. Only set true once the user has confirmed.' },
        sendEmail: { type: 'boolean', description: 'If true, also email the digest to the user (use for scheduled/weekly runs).' },
      },
    },
  },
];

// ── Integration → tool mapping ─────────────────────────────────────────────────
// null = always available (no integration needed)
// F4.3 — The actual map lives in lib/boult/tool-integration-map.ts so
// system-prompt.ts can import it without creating a circular dep on this
// 9000-line file. Re-export so other callers (loop, autonomy, etc) that
// historically imported from './tools' still resolve.
export { TOOL_INTEGRATION_MAP as _TOOL_INTEGRATION_MAP } from './tool-integration-map';
import { TOOL_INTEGRATION_MAP, toolMatchesAnyVA, type BoultVA } from './tool-integration-map';
export { TOOL_INTEGRATION_MAP };

/**
 * Returns only the tool schemas the user can actually use,
 * based on which integrations they have connected.
 * Tools with no required integration are always included.
 *
 * notion_calendar is treated as equivalent to notion — both share the
 * same Notion OAuth token and the same API tools.
 */
export function getAvailableTools(
  connectedIntegrations: string[],
  isBackgroundAgent: boolean = false,
  /**
   * PART 39b — optional VA filter. When the loop's five-VA dispatcher
   * fires for a turn, it knows which subset of {inbox, calendar, crm,
   * comms, research} the request actually touches. Passing that list
   * here narrows the tool surface to only those VAs' tools (plus the
   * always-included utility tools — open_canvas, ask_user,
   * request_confirmation, orchestration helpers, etc.).
   *
   * Why: free/small LLMs pick the wrong tool less often when the choice
   * set is smaller. Passing [] or undefined disables the filter (every
   * connected tool included) — that's the back-compat path used for
   * subsequent turns when the LLM might need to pivot to another VA.
   */
  relevantVAs?: BoultVA[],
): ToolSchema[] {
  const connected = new Set(connectedIntegrations);
  // If either notion or notion_calendar is connected, all Notion tools are available.
  const hasNotion = connected.has('notion') || connected.has('notion_calendar');
  return TOOL_SCHEMAS.filter(schema => {
    if (isBackgroundAgent && schema.name === 'request_confirmation') return false;
    // Background runs have no plan-review UI — the switch is chat-only.
    if (isBackgroundAgent && schema.name === 'switch_to_plan_mode') return false;

    // Integration gate — same as before
    const required = TOOL_INTEGRATION_MAP[schema.name];
    if (required !== null) {
      if (required === 'notion') {
        if (!hasNotion) return false;
      } else if (!connected.has(required)) {
        return false;
      }
    }

    // VA gate — only when the caller asked for filtering
    if (relevantVAs?.length && !toolMatchesAnyVA(schema.name, relevantVAs)) return false;

    return true;
  });
}

// ── Tool implementations ───────────────────────────────────────────────────────
//
// ToolResult, ToolHistoryEntry, ToolContext, and failureResult moved to
// ./tools/types in PART 39a. They're imported at the top of this file and
// re-exported below for back-compat with callers (engine.ts, loop.ts,
// run-agent.ts) that import them from './tools'.

export type { ToolResult, ToolHistoryEntry, ToolContext } from './tools/types';

function ts() { return new Date().toISOString().slice(11, 23); }

/**
 * PART 4 Rule 1 helper — has the LLM successfully read this specific Gmail
 * thread earlier in the run? Accepts read_email (single message in the
 * thread) or gmail_read_thread (whole thread). Both surface threadId in
 * their output; both also accept threadId as input. We match on input first
 * (precise), then fall back to message id (read_email's input is messageId,
 * not threadId — we can't match that without parsing output, so messageId
 * users land on a softer warning).
 */
function hasFetchedThread(history: ToolHistoryEntry[] | undefined, threadId: string): boolean {
  if (!history?.length || !threadId) return false;
  for (const e of history) {
    if (!e.success) continue;
    if (e.name === 'gmail_read_thread' && e.input?.threadId === threadId) return true;
    if (e.name === 'search_gmail') {
      // search_gmail returns thread metadata including the threadId. Treat
      // any successful search_gmail as evidence of a fetch attempt — the
      // strict version would parse outputs but that's overkill for the
      // common case (LLM searches inbox, finds thread, drafts reply).
      return true;
    }
    // read_email's input is messageId, not threadId, so we can't precisely
    // confirm without parsing output. If read_email ran at all, assume the
    // LLM has thread context.
    if (e.name === 'read_email') return true;
  }
  return false;
}

/**
 * PART 4 Rule 3 helper — has the LLM checked calendar availability earlier
 * in the run? Accepts get_calendar_events or calendar_get_availability.
 * Doesn't enforce time-range matching: the prompt rule already tells the
 * LLM to fetch a window covering its proposed time, and a stricter check
 * would risk false negatives when the LLM picks a slot just outside a
 * fetched window.
 */
function hasFetchedAvailability(history: ToolHistoryEntry[] | undefined): boolean {
  if (!history?.length) return false;
  return history.some((e) => e.success && (
    e.name === 'get_calendar_events' ||
    e.name === 'calendar_get_availability' ||
    // Notion-side availability is fetched via notion_get_calendar_events
    e.name === 'notion_get_calendar_events'
  ));
}

export async function executeTool(
  name: string,
  input: Record<string, any>,
  userId: string,
  context: ToolContext = {},
): Promise<ToolResult> {
  const start = Date.now();
  try {
    let result: ToolResult;
    switch (name) {
      case 'search_gmail':      result = await searchGmail(userId, input); break;
      case 'read_email':        result = await readEmail(userId, input); break;
      case 'gmail_read_thread': result = await gmailReadThread(userId, input); break;
      case 'gmail_get_labels':  result = await gmailGetLabels(userId); break;
      case 'gmail_apply_label': result = await gmailApplyLabel(userId, input); break;
      case 'gmail_archive_thread': result = await gmailArchiveThread(userId, input); break;
      case 'gmail_get_profile': result = await gmailGetProfile(userId); break;
      case 'get_sent_emails':   result = await getSentEmails(userId, input); break;
      case 'get_voice_profile': result = await getVoiceProfileTool(userId); break;
      case 'voice_profile_generate': result = await voiceProfileGenerate(userId, input); break;
      case 'voice_profile_update': result = await voiceProfileUpdate(userId, input); break;
      case 'draft_reply':       result = await draftReply(userId, input, context); break;
      case 'draft_cold_email':  result = await draftColdEmail(userId, input); break;
      case 'draft_review':      result = await draftReviewTool(userId, input); break;
      case 'send_email':        result = await sendEmail(userId, input, context); break;
      case 'request_confirmation': result = await requestConfirmation(input, userId, context); break;
      case 'schedule_meeting':  result = await scheduleMeeting(userId, input, context); break;
      case 'get_calendar_events': result = await getCalendarEvents(userId, input); break;
      // Google Meet (separate connection from Calendar — Meet REST API v2)
      case 'meet_create_link':    result = await meetCreateLink(userId, input); break;
      case 'meet_list_meetings':  result = await meetListMeetings(userId, input); break;
      case 'meet_get_transcript': result = await meetGetTranscript(userId, input); break;
      case 'meet_get_recording':  result = await meetGetRecording(userId, input); break;
      case 'meet_attendance':     result = await meetAttendance(userId, input); break;
      case 'calendar_get_availability': result = await calendarGetAvailability(userId, input); break;
      case 'calendar_cancel_event': result = await calendarCancelEvent(userId, input, context); break;
      // Cal.com scheduling
      case 'calcom_list_event_types': result = await calcomListEventTypes(userId); break;
      case 'calcom_get_slots':        result = await calcomGetSlots(userId, input); break;
      case 'calcom_create_booking':   result = await calcomCreateBooking(userId, input, context); break;
      case 'calcom_list_bookings':    result = await calcomListBookings(userId); break;
      case 'calcom_cancel_booking':   result = await calcomCancelBooking(userId, input, context); break;
      // Super-agent foundation tools
      case 'ledger_add_commitment':   result = await ledgerAddCommitment(userId, input, context); break;
      case 'ledger_list_due':         result = await ledgerListDue(userId); break;
      case 'ledger_list_open':        result = await ledgerListOpen(userId); break;
      case 'ledger_close_commitment': result = await ledgerCloseCommitment(input, context); break;
      case 'save_fact':               result = await saveFactTool(userId, input); break;
      case 'save_decision':           result = await saveDecisionTool(userId, input); break;
      case 'search_notion':      result = await searchNotion(userId, input); break;
      case 'fetch_notion_schema': result = await fetchNotionSchemaForAgent(userId, input); break;
      case 'create_notion_page': result = await createNotionPage(userId, input, context); break;
      case 'notion_read_page':   result = await notionReadPage(userId, input); break;
      case 'notion_read_database': result = await notionReadDatabase(userId, input); break;
      case 'notion_create_task': result = await notionCreateTask(userId, input, context); break;
      case 'notion_get_calendar_events': result = await notionGetCalendarEvents(userId, input); break;
      case 'open_canvas':           result = await openCanvas(input, userId, context); break;
      case 'update_canvas':         result = await updateCanvas(input, userId, context); break;
      case 'web_search':            result = await webSearch(input); break;
      case 'web_search_instant':    result = await webSearchInstant(input); break;
      case 'send_slack_message':    result = await sendSlackMessage(userId, input, context); break;
      case 'slack_find_user':       result = await slackFindUser(userId, input); break;
      case 'slack_send_dm':         result = await slackSendDm(userId, input, context); break;
      case 'slack_get_channels':    result = await slackGetChannels(userId, input); break;
      case 'create_scheduled_agent': result = await createScheduledAgent(userId, input, context); break;
      case 'list_scheduled_agents': result = await listScheduledAgents(userId); break;
      case 'pause_scheduled_agent':  result = await pauseScheduledAgent(userId, input); break;
      case 'resume_scheduled_agent': result = await resumeScheduledAgent(userId, input); break;
      case 'delete_scheduled_agent': result = await deleteScheduledAgent(userId, input, context); break;
      case 'forget_memory':          result = await forgetMemory(userId, input); break;
      case 'remember':               result = await rememberTool(userId, input); break;
      case 'log_meeting_notes':      result = await logMeetingNotes(userId, input); break;
      case 'report_generate':       result = reportGenerate(input); break;
      case 'report_send_gmail':     result = await reportSendGmail(userId, input); break;
      case 'report_send_slack':     result = await reportSendSlack(userId, input, context); break;
      case 'check_followups':       result = await checkFollowups(userId, input); break;
      case 'digest_newsletters':    result = await digestNewsletters(userId, input); break;
      case 'get_recipient_context': result = await getRecipientContext(userId, input); break;
      case 'get_contact_context':   result = await getContactContext(userId, input); break;
      case 'remember_about_contact': result = await rememberAboutContact(userId, input); break;
      case 'memory_search':         result = await memorySearchTool(userId, input); break;
      case 'memory_save':           result = await memorySaveTool(userId, input); break;
      case 'update_user_model':     result = await updateUserModelTool(userId, input); break;
      case 'memory_get_contact_profile': result = await memoryGetContactProfile(userId, input); break;
      case 'build_worklist':        result = await buildWorklistTool(userId, input); break;
      case 'claim_worklist_items':  result = await claimWorklistItemsTool(userId, input); break;
      case 'check_draft_quality':   result = checkDraftQualityTool(input); break;
      case 'record_processed_items': result = await recordProcessedItemsTool(userId, input); break;
      // PART 1 — Gmail bulk / batch / intelligence
      case 'gmail_unlimited_search':         result = await gmailUnlimitedSearch(userId, input); break;
      case 'gmail_bulk_read_threads':        result = await gmailBulkReadThreads(userId, input); break;
      case 'gmail_batch_draft_replies':      result = await gmailBatchDraftReplies(userId, input, context); break;
      case 'gmail_batch_send_emails':        result = await gmailBatchSendEmails(userId, input, context); break;
      case 'schedule_email_send':            result = await scheduleEmailSend(userId, input, context); break;
      case 'list_scheduled_emails':          result = await listScheduledEmails(userId, input); break;
      case 'cancel_scheduled_email':         result = await cancelScheduledEmail(userId, input); break;
      case 'gmail_auto_label_threads':       result = await gmailAutoLabelThreads(userId, input); break;
      case 'gmail_auto_archive_threads':     result = await gmailAutoArchiveThreads(userId, input); break;
      case 'gmail_extract_data_from_threads': result = await gmailExtractDataFromThreads(userId, input); break;
      case 'gmail_detect_conversation_type':  result = await gmailDetectConversationType(userId, input); break;
      case 'gmail_generate_auto_replies':     result = await gmailGenerateAutoReplies(userId, input, context); break;
      case 'gmail_detect_urgency':            result = await gmailDetectUrgency(userId, input); break;
      // PART 2 — Calendar
      case 'calendar_unlimited_scan':         result = await calendarUnlimitedScan(userId, input); break;
      case 'calendar_batch_create_events':    result = await calendarBatchCreateEvents(userId, input, context); break;
      case 'calendar_auto_detect_conflicts':  result = await calendarAutoDetectConflicts(userId, input); break;
      case 'calendar_auto_decline_low_priority': result = await calendarAutoDeclineLowPriority(userId, input); break;
      case 'calendar_generate_free_time_blocks': result = await calendarGenerateFreeTimeBlocks(userId, input, context); break;
      case 'calendar_meeting_prep_automation': result = await calendarMeetingPrepAutomation(userId, input, context); break;
      case 'calendar_auto_generate_meet_links': result = await calendarAutoGenerateMeetLinks(userId, input); break;
      case 'calendar_buffer_time_insertion':  result = await calendarBufferTimeInsertion(userId, input, context); break;
      case 'calendar_timezone_intelligence':  result = await calendarTimezoneIntelligence(userId, input); break;
      // PART 3 — Notion
      case 'notion_auto_create_contact_profiles': result = await notionAutoCreateContactProfiles(userId, input, context); break;
      case 'notion_auto_log_all_communication':   result = await notionAutoLogAllCommunication(userId, input, context); break;
      case 'notion_batch_create_database_entries': result = await notionBatchCreateDatabaseEntries(userId, input, context); break;
      case 'notion_auto_update_project_status':   result = await notionAutoUpdateProjectStatus(userId, input, context); break;
      case 'notion_auto_generate_meeting_notes':  result = await notionAutoGenerateMeetingNotes(userId, input, context); break;
      case 'notion_deal_tracking_automation':     result = await notionDealTrackingAutomation(userId, input, context); break;
      case 'notion_create_smart_dashboards':      result = await notionCreateSmartDashboards(userId, input, context); break;
      case 'notion_link_related_items':           result = await notionLinkRelatedItems(userId, input); break;
      case 'notion_auto_archive_completed_work':  result = await notionAutoArchiveCompletedWork(userId, input); break;
      case 'notion_generate_weekly_summaries':    result = await notionGenerateWeeklySummaries(userId, input, context); break;
      // PART 4 — Slack
      case 'slack_post_daily_briefing':           result = await slackPostDailyBriefing(userId, input, context); break;
      case 'slack_real_time_urgent_alerts':       result = await slackRealTimeUrgentAlerts(userId, input, context); break;
      case 'slack_team_digest_weekly':            result = await slackTeamDigestWeekly(userId, input, context); break;
      case 'slack_deal_update_notifications':     result = await slackDealUpdateNotifications(userId, input, context); break;
      case 'slack_task_assignment_notifications': result = await slackTaskAssignmentNotifications(userId, input, context); break;
      case 'slack_approval_request_routing':      result = await slackApprovalRequestRouting(userId, input, context); break;
      // PART 5 — Memory
      case 'memory_unlimited_scan':               result = await memoryUnlimitedScan(userId, input); break;
      case 'memory_bulk_save_learning':           result = await memoryBulkSaveLearning(userId, input); break;
      case 'memory_relationship_intelligence':    result = await memoryRelationshipIntelligence(userId, input); break;
      // PART 6 — Content
      case 'generate_email_sequence':             result = await generateEmailSequence(userId, input); break;
      case 'generate_proposal_documents':         result = await generateProposalDocuments(userId, input, context); break;
      case 'generate_client_reports':             result = await generateClientReports(userId, input, context); break;
      case 'generate_sow_documents':              result = await generateSowDocuments(userId, input); break;
      case 'generate_internal_documentation':     result = await generateInternalDocumentation(userId, input, context); break;
      // PART 7 — Research
      case 'web_search_unlimited':                result = await webSearchUnlimited(userId, input); break;
      case 'company_intelligence_research':       result = await companyIntelligenceResearch(userId, input); break;
      case 'contact_research_and_verification':   result = await contactResearchAndVerification(userId, input); break;
      // PART 8 — Orchestration
      case 'agent_task_queue_management':         result = await agentTaskQueueManagement(userId, input); break;
      case 'error_recovery_and_retries':          result = await errorRecoveryAndRetries(userId, input, context); break;
      case 'performance_monitoring_and_optimization': result = await performanceMonitoringAndOptimization(userId, input); break;
      case 'output_formatting_and_presentation':  result = await outputFormattingAndPresentation(userId, input); break;
      // Phase C — Proactive triage / initiative within rules
      case 'surface_proactive_signals':           result = await surfaceProactiveSignals(userId, input); break;
      case 'get_delegation_rules':  result = await getDelegationRules(userId); break;
      case 'create_delegation_rule': result = await createDelegationRule(userId, input); break;
      default:
        console.warn(`[Boult:Tools] ${ts()} Unknown tool requested: "${name}"`);
        return failureResult(`Unknown tool: ${name}`, 'unknown_tool');
    }
    console.log(`[Boult:Tools] ${ts()} ${name} ok (${Date.now() - start}ms) output=${result.output.length}chars`);
    return result;
  } catch (err: any) {
    console.error(`[Boult:Tools] ${ts()} ${name} FAILED (${Date.now() - start}ms)`, {
      error: err.message,
      stack: err.stack?.slice(0, 400),
      input: JSON.stringify(input).slice(0, 200),
      userId,
    });
    throw err;
  }
}

// ── Implementations ────────────────────────────────────────────────────────────

/**
 * Gmail GET with transient retry. Background agents run all five VAs (and many
 * tools) in parallel, which bursts past Gmail's per-user rate limit — a single
 * 429/5xx/timeout was surfacing as "Searched inbox — failed". Retries those
 * transient cases with backoff (honoring Retry-After); does NOT retry 4xx like
 * 401/403 (handled by the caller's refresh) or 400.
 */
async function gmailGetWithRetry(url: string, token: string, timeoutMs = 12000, attempts = 3, userId?: string): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      // Route through googleFetch when a userId is given so Composio-managed
      // users go through Proxy Execute (masking-proof); else direct.
      const res = userId
        ? await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } })
        : await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
        const ra = Number(res.headers.get('retry-after'));
        const wait = ra > 0 ? Math.min(ra * 1000, 5000) : 600 * (i + 1) * (i + 1);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e; // timeout / network — transient
      if (i < attempts - 1) { await new Promise(r => setTimeout(r, 600 * (i + 1) * (i + 1))); continue; }
      throw e;
    }
  }
  throw lastErr;
}

async function searchGmail(userId: string, input: any): Promise<ToolResult> {
  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected. Ask the user to connect Gmail in Settings → Integrations.', 'gmail_not_connected');

  const max = Math.min(input.maxResults || 12, 40);
  const params = new URLSearchParams({ q: input.query, maxResults: String(max) });
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`;

  // googleFetch transparently proxies through Composio for managed users
  // (masking-proof, raw Google response) or does the direct authed call.
  let listRes: Response;
  try {
    listRes = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return failureResult('Gmail search timed out after retries.', 'upstream_gmail');
  }
  if (listRes.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      try { listRes = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } }); } catch { return failureResult('Gmail search timed out after retries.', 'upstream_gmail'); }
    }
  }
  if (!listRes.ok) return gmailHttpFailure(listRes, 'Gmail search failed');

  const listData = await listRes.json();
  const messages: any[] = listData.messages || [];
  if (!messages.length) return { output: 'No emails found matching that query.' };

  const details = await Promise.all(messages.slice(0, max).map(async ({ id }: any) => {
    try {
      const r = await googleFetch(
        userId, 'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return null;
      const m = await r.json();
      const h = m.payload?.headers || [];
      return { id: m.id, threadId: m.threadId, from: getHeader(h, 'From'), subject: getHeader(h, 'Subject'), date: getHeader(h, 'Date'), snippet: (m.snippet || '').slice(0, 320) };
    } catch { return null; }
  }));

  const valid = details.filter(Boolean);
  if (!valid.length) return failureResult('Found emails but could not read metadata.', 'upstream_gmail');

  const lines = valid.map((m: any, i: number) =>
    `${i + 1}. [ID: ${m.id}] [Thread: ${m.threadId}]\n   From: ${m.from}\n   Subject: ${m.subject}\n   Date: ${m.date}\n   Preview: ${m.snippet}`
  );
  const rawOutput = `Found ${valid.length} email(s) for query "${input.query}":\n\n${lines.join('\n\n')}`;

  // Pattern Recognition Intelligence: annotate results with booking links, calendar invites,
  // time-sensitive demands, and revenue opportunities so the LLM surfaces them immediately.
  return { output: annotateSearchResultsWithSignals(rawOutput) };
}

async function readEmail(userId: string, input: any): Promise<ToolResult> {
  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${input.messageId}?format=full`;
  let res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!res.ok) return gmailHttpFailure(res, 'Could not read email');

  const m = await res.json();
  const h = m.payload?.headers || [];
  const body = extractBody(m.payload);
  const rfcId = getHeader(h, 'Message-ID');

  const rawOutput = [
    `Message-ID: ${m.id}`,
    `Thread-ID: ${m.threadId}`,
    `RFC-Message-ID: ${rfcId}`,
    `From: ${getHeader(h, 'From')}`,
    `To: ${getHeader(h, 'To')}`,
    `Subject: ${getHeader(h, 'Subject')}`,
    `Date: ${getHeader(h, 'Date')}`,
    '',
    '--- Body ---',
    body || '(no plain text body)',
  ].join('\n');

  // Pattern Recognition Intelligence: annotate with booking links, calendar invites,
  // time-sensitive demands, and revenue opportunities detected in the email body.
  return { output: annotateEmailWithSignals(rawOutput) };
}

// ── gmail_read_thread ─────────────────────────────────────────────────────────
// Whole-thread fetch — every message in chronological order. The spec's
// "single source of truth for email content." Single-message reads stay on
// read_email; this is for the back-and-forth case.
async function gmailReadThread(userId: string, input: any): Promise<ToolResult> {
  const threadId = (input.threadId || '').trim();
  if (!threadId) return failureResult('threadId is required.', 'validation_error');

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`;
  let res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!res.ok) {
    return gmailHttpFailure(res, 'Could not read thread');
  }

  const thread = await res.json();
  const msgs: any[] = thread.messages || [];
  if (!msgs.length) return failureResult(`Thread ${threadId} has no messages.`, 'not_found');

  const lines: string[] = [
    `Thread-ID: ${thread.id}`,
    `History-ID: ${thread.historyId}`,
    `Messages: ${msgs.length}`,
    '',
  ];
  msgs.forEach((m: any, i: number) => {
    const h = m.payload?.headers || [];
    const body = extractBody(m.payload);
    lines.push(`--- Message ${i + 1} of ${msgs.length} ---`);
    lines.push(`Message-ID: ${m.id}`);
    lines.push(`RFC-Message-ID: ${getHeader(h, 'Message-ID')}`);
    lines.push(`From: ${getHeader(h, 'From')}`);
    lines.push(`To: ${getHeader(h, 'To')}`);
    const cc = getHeader(h, 'Cc');
    if (cc) lines.push(`Cc: ${cc}`);
    lines.push(`Subject: ${getHeader(h, 'Subject')}`);
    lines.push(`Date: ${getHeader(h, 'Date')}`);
    // Attachment metadata only — never download attachment content
    const parts = collectAttachmentMeta(m.payload);
    if (parts.length) {
      lines.push(`Attachments: ${parts.map(a => `${a.filename} (${a.mimeType}, ${a.size}B)`).join('; ')}`);
    }
    lines.push('');
    lines.push(body || '(no plain text body)');
    lines.push('');
  });

  return { output: annotateEmailWithSignals(lines.join('\n')) };
}

// Walk the MIME tree of a Gmail message payload and collect attachment metadata.
// Returns [] for messages with no attachments. Body content is never returned.
function collectAttachmentMeta(payload: any): Array<{ filename: string; mimeType: string; size: number }> {
  const out: Array<{ filename: string; mimeType: string; size: number }> = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      out.push({ filename: p.filename, mimeType: p.mimeType || 'application/octet-stream', size: p.body.size || 0 });
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

// ── gmail_get_labels ──────────────────────────────────────────────────────────
async function gmailGetLabels(userId: string): Promise<ToolResult> {
  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/labels';
  let res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!res.ok) return gmailHttpFailure(res, 'Could not list labels');

  const data = await res.json();
  const labels: any[] = data.labels || [];
  if (!labels.length) return { output: 'No labels found.' };

  const lines = labels.map((l: any, i: number) =>
    `${i + 1}. ${l.name}  [id: ${l.id}  type: ${l.type || 'user'}]`,
  );
  return { output: `${labels.length} label(s):\n${lines.join('\n')}` };
}

// ── gmail_apply_label ─────────────────────────────────────────────────────────
async function gmailApplyLabel(userId: string, input: any): Promise<ToolResult> {
  const threadId = (input.threadId || '').trim();
  const labelIds: string[] = Array.isArray(input.labelIds) ? input.labelIds.filter((s: any) => typeof s === 'string' && s.trim()) : [];
  if (!threadId) return failureResult('threadId is required.', 'validation_error');
  if (!labelIds.length) return failureResult('labelIds (non-empty array of label ids from gmail_get_labels) is required.', 'validation_error');

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`;
  const body = JSON.stringify({ addLabelIds: labelIds });
  let res = await googleFetch(userId, 'gmail', url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gmail', url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      });
    }
  }
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 403) return classifyGoogle403(err) === 'scope'
      ? failureResult(GMAIL_SCOPE_MESSAGE, 'gmail_scope_missing')
      : failureResult('Gmail is briefly rate-limited by Google. The connection is fine; I\'ll retry shortly.', 'gmail_rate_limited');
    return failureResult(`Apply label failed (${res.status}): ${err.slice(0, 200)}`, 'upstream_gmail');
  }
  return { output: `Applied ${labelIds.length} label(s) to thread ${threadId}.` };
}

// ── gmail_archive_thread ──────────────────────────────────────────────────────
// Reversible — just removes the INBOX label. Emails stay in All Mail and can
// be searched/restored. No request_confirmation gate for single threads.
async function gmailArchiveThread(userId: string, input: any): Promise<ToolResult> {
  const threadId = (input.threadId || '').trim();
  if (!threadId) return failureResult('threadId is required.', 'validation_error');

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`;
  const body = JSON.stringify({ removeLabelIds: ['INBOX'] });
  let res = await googleFetch(userId, 'gmail', url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gmail', url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      });
    }
  }
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 403) return classifyGoogle403(err) === 'scope'
      ? failureResult(GMAIL_SCOPE_MESSAGE, 'gmail_scope_missing')
      : failureResult('Gmail is briefly rate-limited by Google. The connection is fine; I\'ll retry shortly.', 'gmail_rate_limited');
    return failureResult(`Archive failed (${res.status}): ${err.slice(0, 200)}`, 'upstream_gmail');
  }
  return { output: `Archived thread ${threadId}.` };
}

// ── gmail_get_profile ─────────────────────────────────────────────────────────
async function gmailGetProfile(userId: string): Promise<ToolResult> {
  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
  let res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; res = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!res.ok) return gmailHttpFailure(res, 'Could not read profile');

  const p = await res.json();
  return {
    output: [
      `Email: ${p.emailAddress}`,
      `Messages: ${p.messagesTotal}`,
      `Threads: ${p.threadsTotal}`,
      `History-ID: ${p.historyId}`,
    ].join('\n'),
  };
}

async function getSentEmails(userId: string, input: any): Promise<ToolResult> {
  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const limit = Math.min(input.limit || 30, 50);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=SENT`;
  let listRes = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } });
  if (listRes.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; listRes = await googleFetch(userId, 'gmail', url, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!listRes.ok) return gmailHttpFailure(listRes, 'Could not fetch sent emails');

  const listData = await listRes.json();
  const messages: any[] = (listData.messages || []).slice(0, limit);
  if (!messages.length) return failureResult('No sent emails found — voice profile cannot be built from empty sent mail.', 'no_sent_mail');

  const details = await Promise.all(messages.slice(0, 15).map(async ({ id }: any) => {
    try {
      const r = await googleFetch(userId, 'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return null;
      const m = await r.json();
      const h = m.payload?.headers || [];
      const body = extractBody(m.payload, 500);
      return { subject: getHeader(h, 'Subject'), to: getHeader(h, 'To'), body };
    } catch { return null; }
  }));

  const valid = details.filter(Boolean);
  const lines = valid.map((m: any) => `To: ${m.to}\nSubject: ${m.subject}\n${m.body}`);

  // Append the user's saved voice profile so the LLM has it right before writing the draft body.
  let voiceGuide = '';
  try {
    const { voiceProfileService } = await import('../voice-profile-service.js');
    const profile = await voiceProfileService.getVoiceProfile(userId) as any;
    if (profile && profile.status !== 'default') {
      const prompt = voiceProfileService.generateVoicePrompt(profile);
      if (prompt && typeof prompt === 'string' && prompt.trim()) {
        voiceGuide = `

════════════════════════════════════════
VOICE PROFILE — APPLY THIS EXACTLY WHEN WRITING THE DRAFT BODY:
${prompt.trim()}

You have just read the user's real sent emails above. Cross-reference the samples with the profile. The draft body MUST match both — do not default to a generic professional tone.
════════════════════════════════════════`;
      }
    }
  } catch {
    // non-fatal — proceed without voice guide
  }

  return { output: `${valid.length} recent sent emails for style analysis:\n\n${lines.join('\n\n---\n\n')}${voiceGuide}` };
}

async function getVoiceProfileTool(userId: string): Promise<ToolResult> {
  try {
    const { voiceProfileService } = await import('../voice-profile-service.js');
    const profile = await voiceProfileService.getVoiceProfile(userId) as any;

    if (!profile || profile.status === 'default') {
      return failureResult(
        `No saved voice profile found for this user yet. To build one, call get_sent_emails — it will analyze the user's recent sent mail and generate a voice profile automatically. Once built, subsequent calls to get_voice_profile will return the stored profile.`,
        'voice_profile_missing',
      );
    }

    const prompt = voiceProfileService.generateVoicePrompt(profile) as string | undefined;
    const lines: string[] = [
      `Voice profile found (last updated: ${profile.updated_at ?? profile.created_at ?? 'unknown'})`,
      '',
      prompt?.trim() ?? '(profile exists but no formatted prompt generated)',
    ];

    // Include high-level metadata when available
    if (profile.tone) lines.push(`\nTone: ${profile.tone}`);
    if (profile.greeting_patterns?.length) lines.push(`Typical greetings: ${profile.greeting_patterns.join(', ')}`);
    if (profile.closing_patterns?.length) lines.push(`Typical closings: ${profile.closing_patterns.join(', ')}`);
    if (profile.vocabulary?.length) lines.push(`Signature vocabulary: ${profile.vocabulary.join(', ')}`);

    return { output: lines.join('\n') };
  } catch (err: any) {
    return failureResult(`Failed to read voice profile: ${err.message}`, 'voice_profile_read_failed');
  }
}

// ── voice_profile_generate ────────────────────────────────────────────────────
// On-demand rebuild from sent mail. The chat route auto-bootstraps once on a
// user's first turn; this tool exists so the LLM can rebuild later when the
// user explicitly asks ("refresh my voice profile", "retrain on my recent
// emails"). 30s hard ceiling — the chat route's bootstrap uses 22s but we get
// slightly more headroom because the user is actively waiting for this one.
async function voiceProfileGenerate(userId: string, input: any): Promise<ToolResult> {
  const sampleSize = Math.max(20, Math.min(200, Number(input?.sampleSize) || 90));

  try {
    // @ts-ignore — JS module, no .d.ts
    const { voiceProfileService } = await import('../voice-profile-service.js');

    // Need a Gmail handle to fetch sent mail.
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_integrations')
      .select('access_token, refresh_token')
      .eq('user_id', normalizeUserId(userId))
      .eq('provider', 'gmail')
      .maybeSingle();

    if (!data?.access_token) {
      return failureResult('Gmail is not connected — cannot generate a voice profile without sent mail access.', 'gmail_not_connected');
    }

    const accessToken = decrypt(data.access_token);
    const refreshToken = data.refresh_token ? decrypt(data.refresh_token) : '';
    // @ts-ignore — JS module
    const { GmailService } = await import('../gmail');
    const gmail = new GmailService(accessToken, refreshToken);

    const TIMEOUT = Symbol('timeout');
    const built = await Promise.race([
      (async () => {
        const sent = await voiceProfileService.fetchSentEmails(gmail, sampleSize);
        if (!Array.isArray(sent) || sent.length < 20) {
          return { tooFew: sent?.length ?? 0 };
        }
        const profile = await voiceProfileService.analyzeVoiceProfile(sent);
        await voiceProfileService.saveVoiceProfile(userId, profile);
        return { profile, count: sent.length };
      })(),
      new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 30000)),
    ]);

    if (built === TIMEOUT) {
      return failureResult('Voice profile generation timed out after 30s. Try again, or send a few more emails first.', 'voice_profile_generate_failed');
    }
    const result = built as { profile?: any; count?: number; tooFew?: number };
    if (typeof result.tooFew === 'number') {
      return failureResult(
        `Need at least 20 sent emails to build a voice profile — found ${result.tooFew}. Send a few more emails (or use the manual Voice Settings to set defaults) and try again.`,
        'insufficient_sent_mail',
      );
    }

    const p = result.profile;
    const summary = [
      `Voice profile rebuilt from ${result.count} sent emails.`,
      p.tone ? `Tone: ${p.tone}` : null,
      p.greeting_patterns?.length ? `Greetings: ${p.greeting_patterns.slice(0, 3).join(', ')}` : null,
      p.closing_patterns?.length ? `Closings: ${p.closing_patterns.slice(0, 3).join(', ')}` : null,
      p.formality ? `Formality: ${p.formality}` : null,
      '',
      'The new profile is saved and will be injected into the system prompt on the NEXT turn (it does not retroactively change drafts in this turn).',
    ].filter(Boolean).join('\n');

    return { output: summary };
  } catch (err: any) {
    return failureResult(`Voice profile generation failed: ${err.message}`, 'voice_profile_generate_failed');
  }
}

// ── voice_profile_update ──────────────────────────────────────────────────────
// Shallow merge of user-specified patches into the stored profile. Arrays
// REPLACE (do not concat) so the user can remove an unwanted phrase by passing
// the array without it. The merged profile is saved and used from the next
// turn's prompt injection onward.
async function voiceProfileUpdate(userId: string, input: any): Promise<ToolResult> {
  const updates = (input && typeof input.updates === 'object' && input.updates) ? input.updates : null;
  if (!updates || !Object.keys(updates).length) {
    return failureResult('updates must be a non-empty object — e.g. { closing_patterns: ["Cheers, M"] }.', 'validation_error');
  }

  try {
    // @ts-ignore — JS module
    const { voiceProfileService } = await import('../voice-profile-service.js');
    const current: any = await voiceProfileService.getVoiceProfile(userId);
    if (!current || current.status === 'default') {
      return failureResult('No saved voice profile to update. Call voice_profile_generate first.', 'voice_profile_missing');
    }

    // Shallow merge — arrays replace, primitives overwrite, objects overwrite.
    // We deliberately do NOT deep-merge so removing items from a list works.
    const merged: Record<string, any> = { ...current };
    const changed: string[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      merged[k] = v;
      changed.push(k);
    }
    merged.updated_at = new Date().toISOString();

    await voiceProfileService.saveVoiceProfile(userId, merged);

    const diffLines = changed.map((k) => {
      const before = current[k];
      const after = merged[k];
      const fmt = (x: any) => Array.isArray(x) ? `[${x.slice(0, 3).join(', ')}${x.length > 3 ? `, +${x.length - 3} more` : ''}]` : JSON.stringify(x);
      return `  • ${k}: ${fmt(before)} → ${fmt(after)}`;
    });
    return {
      output: [
        `Voice profile updated (${changed.length} field${changed.length === 1 ? '' : 's'} changed):`,
        ...diffLines,
        '',
        'The patched profile takes effect on the next turn.',
      ].join('\n'),
    };
  } catch (err: any) {
    return failureResult(`Voice profile update failed: ${err.message}`, 'voice_profile_update_failed');
  }
}

/**
 * Five-dimension draft review. Composite + per-dimension scores + targeted
 * suggestions. Used in two places:
 *   1. Auto-run from draftReply / draftColdEmail — composite becomes the
 *      voiceScore badge on the draft card, lowest-scoring dimension feeds the
 *      critique line. Time-boxed; on timeout/failure the draft still ships
 *      without a badge (best-effort).
 *   2. Exposed as the draft_review tool so the LLM can request a deeper audit
 *      on any draft, including drafts the user hand-edited.
 */
export interface DraftReview {
  composite: number;
  dimensions: {
    sounds_like_user: number;
    appropriate_tone: number;
    clear_cta: number;
    correct_length: number;
    no_hallucinated_claims: number;
  };
  suggestions: string[];
  /** One-line summary surfaced under the voice badge when composite < 70. */
  critique: string;
}

const REVIEW_SYSTEM_PROMPT =
  'You are a strict editor scoring an email draft on five dimensions. Output ONLY raw JSON, no markdown fences, no preamble. Shape:\n' +
  '{\n' +
  '  "dimensions": {\n' +
  '    "sounds_like_user": <0-100 — how indistinguishable the draft is from the user\'s real writing per the voice profile>,\n' +
  '    "appropriate_tone": <0-100 — does the tone match the recipient/context>,\n' +
  '    "clear_cta": <0-100 — is there a clear next step or ask>,\n' +
  '    "correct_length": <0-100 — neither too long nor too curt for the context>,\n' +
  '    "no_hallucinated_claims": <0-100 — 100 means every factual claim is supported by the supplied context; lower if the draft asserts unverified specifics>\n' +
  '  },\n' +
  '  "suggestions": [<up to 3 short, concrete rewrites or removals; empty array if composite >= 85>],\n' +
  '  "critique": "<one short sentence naming the most pressing dimension to fix; empty if composite >= 85>"\n' +
  '}\n' +
  'Scoring guide: 90+ ships as-is. 70-89 minor polish. Below 70 needs review before sending. Be strict — generic-AI tone, hedging language, "I hope this finds you well" greetings, and unsupported specifics all cost points.';

function normalizeDim(n: any): number {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

async function reviewDraft(
  userId: string,
  body: string,
  contextHint?: string,
): Promise<DraftReview | null> {
  try {
    // @ts-ignore — JS module
    const { voiceProfileService } = await import('../voice-profile-service.js');
    const profile = (await voiceProfileService.getVoiceProfile(userId)) as any;
    if (!profile || profile.status === 'default') return null;
    const voicePrompt = (voiceProfileService.generateVoicePrompt(profile) as string | undefined)?.trim();
    if (!voicePrompt) return null;

    const TIMEOUT = Symbol('timeout');
    const race = await Promise.race([
      callLLM(
        [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `USER VOICE PROFILE:\n${voicePrompt}\n\n` +
              (contextHint ? `CONTEXT:\n${contextHint.slice(0, 2000)}\n\n` : '') +
              `DRAFT BODY:\n${body.slice(0, 4000)}\n\nReturn the JSON now.`,
          },
        ],
        [],
        { maxTokens: 400, temperature: 0.1 },
      ),
      new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 8000)),
    ]);

    if (race === TIMEOUT) return null;
    const text = getText((race as any).content).trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const d = parsed.dimensions || {};
    const dimensions = {
      sounds_like_user: normalizeDim(d.sounds_like_user),
      appropriate_tone: normalizeDim(d.appropriate_tone),
      clear_cta: normalizeDim(d.clear_cta),
      correct_length: normalizeDim(d.correct_length),
      no_hallucinated_claims: normalizeDim(d.no_hallucinated_claims),
    };
    const composite = Math.round(
      (dimensions.sounds_like_user +
        dimensions.appropriate_tone +
        dimensions.clear_cta +
        dimensions.correct_length +
        dimensions.no_hallucinated_claims) /
        5,
    );
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s: any) => typeof s === 'string').map((s: string) => s.trim().slice(0, 200)).slice(0, 5)
      : [];
    const critique = typeof parsed.critique === 'string' ? parsed.critique.trim().slice(0, 200) : '';
    return { composite, dimensions, suggestions, critique };
  } catch {
    return null;
  }
}

/**
 * Standalone draft_review tool — wraps reviewDraft so the LLM can audit any
 * email draft on demand, not just the ones auto-run during draftReply.
 */
async function draftReviewTool(userId: string, input: any): Promise<ToolResult> {
  const draft = typeof input?.draft === 'string' ? input.draft : '';
  if (!draft.trim()) return failureResult('draft (non-empty string) is required.', 'validation_error');
  const context = typeof input?.context === 'string' ? input.context : undefined;

  const review = await reviewDraft(userId, draft, context);
  if (!review) {
    return failureResult(
      'Could not score the draft — voice profile may be missing or the critique pass timed out. Try voice_profile_generate first.',
      'voice_profile_missing',
    );
  }

  const dims = review.dimensions;
  const lines = [
    `Composite voice match: ${review.composite}/100`,
    '',
    'Dimensions:',
    `  • Sounds like user:        ${dims.sounds_like_user}/100`,
    `  • Appropriate tone:        ${dims.appropriate_tone}/100`,
    `  • Clear call-to-action:    ${dims.clear_cta}/100`,
    `  • Correct length:          ${dims.correct_length}/100`,
    `  • No hallucinated claims:  ${dims.no_hallucinated_claims}/100`,
  ];
  if (review.suggestions.length) {
    lines.push('', 'Suggestions:');
    review.suggestions.forEach((s) => lines.push(`  • ${s}`));
  }
  if (review.critique && review.composite < 85) {
    lines.push('', `Critique: ${review.critique}`);
  }

  return { output: lines.join('\n') };
}

async function draftReply(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // PART 4 Rule 1 — Fetch before claim. Require the LLM to have actually
  // fetched the thread it's drafting a reply to. Without this gate the LLM
  // could draft a reply to a hallucinated thread; with it, the LLM is forced
  // to call read_email or gmail_read_thread first, grounding the body in
  // real content. Background-agent runs without history fail open with a
  // logged warning (the LLM there is constrained by a different system
  // prompt that already enforces fetch order).
  if (input.threadId && context.toolHistory && !hasFetchedThread(context.toolHistory, input.threadId)) {
    return failureResult(
      `Refusing to draft. You have not yet fetched the thread ${input.threadId} this turn — call gmail_read_thread (or read_email for the latest message) first so the draft is grounded in the real email content, then retry draft_reply.`,
      'fetch_required',
    );
  }

  // F9 — Pre-draft context lock. If the LLM tries to draft WITHOUT a threadId
  // AND it has not read any thread / email / sent_mail this turn, refuse so
  // the draft is grounded in real context instead of hallucinated content.
  // Background agents bypass (their loop has different gating).
  if (
    !input.threadId &&
    !context.isBackgroundAgent &&
    context.toolHistory &&
    context.toolHistory.length > 0
  ) {
    const READS = new Set([
      'gmail_read_thread', 'read_email', 'search_gmail',
      'gmail_unlimited_search', 'gmail_bulk_read_threads', 'get_sent_emails',
    ]);
    const fetchedAny = context.toolHistory.some(e => e.success && READS.has(e.name));
    if (!fetchedAny) {
      return failureResult(
        'Refusing to draft without a threadId and without any prior email read this turn. Search the inbox (search_gmail) or read the target thread (gmail_read_thread) first so the draft references real content.',
        'must_read_thread_first',
      );
    }
  }

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const subject = input.subject || 'Re: (no subject)';
  const raw = buildRaw(input.to, subject, input.body, input.threadId, input.inReplyToMessageId);
  const draftBody = JSON.stringify({ message: { raw, threadId: input.threadId } });

  const draftUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
  const draftInit = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: draftBody };
  let res = await googleFetch(userId, 'gmail', draftUrl, draftInit);
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gmail', draftUrl, { ...draftInit, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    }
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 403) return classifyGoogle403(err) === 'scope'
      ? failureResult(GMAIL_SCOPE_MESSAGE, 'gmail_scope_missing')
      : failureResult('Gmail is briefly rate-limited by Google. The connection is fine; I\'ll retry shortly.', 'gmail_rate_limited');
    return failureResult(`Failed to save draft (${res.status}): ${err.slice(0, 200)}`, 'draft_save_failed');
  }

  const draft = await res.json();
  const previewUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.message?.id || ''}`;

  const displayName = input.recipientName || input.to.split('@')[0];
  // Feature 4: Update contact on draft interaction
  touchContact(userId, input.to, displayName);

  // Post-draft 5-dim voice critique. Time-boxed and best-effort — if it
  // fails the draft still ships, the user just won't see a score badge.
  const review = await reviewDraft(userId, input.body || '');

  // Surface composite + lowest-dimension callout to the LLM so its final chat
  // sentence can hedge or ship clean. The badge on the draft card shows the
  // composite; voiceCritique surfaces critique + first suggestion underneath.
  // PART 4 Rule 5 — always tell the LLM to surface the composite score in
  // its final reply, regardless of value. The badge on the draft card shows
  // it too, but the LLM's chat sentence is what the user reads first.
  const lowScoreNote = !review
    ? ''
    : review.composite < 70
      ? `\n\nVOICE MATCH: ${review.composite}/100. ${review.critique || ''}` +
        (review.suggestions[0] ? ` Suggestion: ${review.suggestions[0]}` : '') +
        ` REQUIRED: say in your chat reply "This draft scored ${review.composite}/100 for matching your voice. You may want to review it carefully." Do not omit the score.`
      : `\n\nVOICE MATCH: ${review.composite}/100. The draft sounds like the user. ` +
        `REQUIRED: mention the voice match score (${review.composite}/100) in your chat reply so the user always sees it.`;

  // Combine critique + top suggestion for the under-badge UI line.
  const combinedCritique = review
    ? [review.critique, review.suggestions[0]].filter(Boolean).join(' — ').slice(0, 240)
    : undefined;

  return {
    output: `Draft saved to Gmail successfully.\nTo: ${displayName} <${input.to}>\nSubject: ${subject}\nGmail URL: ${previewUrl}\nDraft ID: ${draft.id}\n\nDraft body (first 400 chars):\n${input.body.slice(0, 400)}${input.body.length > 400 ? '...' : ''}\n\nNow write your final response: confirm what you did, include the subject line and the opening lines of the draft verbatim, and tell the user to review and send from the draft panel. Do NOT call send_email.${lowScoreNote}`,
    canvasData: {
      title: `Draft: ${subject}`,
      type: 'email_draft',
      markdown: [
        `**To:** ${displayName} <${input.to}>`,
        `**Subject:** ${subject}`,
        '',
        '---',
        '',
        input.body,
        '',
        '---',
        '',
        `[Open in Gmail](${previewUrl})`,
      ].join('\n'),
      draftMeta: {
        to: input.to,
        subject,
        threadId: input.threadId,
        body: input.body,
        recipientName: displayName,
        gmailDraftId: draft.id,
        voiceScore: review?.composite,
        voiceCritique: combinedCritique,
      },
    },
  };
}

// ── draft_cold_email ──────────────────────────────────────────────────────────
// New outbound email (no thread). Same Gmail draft save + voice critique as
// draft_reply, but composes a fresh subject + body for a recipient the user
// hasn't necessarily emailed before. Soft-write — user reviews and sends from
// the draft card; no request_confirmation gate.
async function draftColdEmail(userId: string, input: any): Promise<ToolResult> {
  const to = (input.to || '').trim();
  const subject = (input.subject || '').trim();
  const body = (input.body || '').trim();
  if (!to || !subject || !body) {
    return failureResult('to, subject, and body are all required.', 'validation_error');
  }

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const raw = buildRaw(to, subject, body);
  const draftBodyJson = JSON.stringify({ message: { raw } });

  const coldDraftUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
  const coldDraftInit = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: draftBodyJson };
  let res = await googleFetch(userId, 'gmail', coldDraftUrl, coldDraftInit);
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gmail', coldDraftUrl, { ...coldDraftInit, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    }
  }
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 403) return classifyGoogle403(err) === 'scope'
      ? failureResult(GMAIL_SCOPE_MESSAGE, 'gmail_scope_missing')
      : failureResult('Gmail is briefly rate-limited by Google. The connection is fine; I\'ll retry shortly.', 'gmail_rate_limited');
    return failureResult(`Failed to save draft (${res.status}): ${err.slice(0, 200)}`, 'draft_save_failed');
  }

  const draft = await res.json();
  const previewUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.message?.id || ''}`;
  const displayName = input.recipientName || to.split('@')[0];
  touchContact(userId, to, displayName);

  // Surface input.purpose to the critique so it knows what the email is meant
  // to achieve (matters for the clear_cta and appropriate_tone dimensions).
  const review = await reviewDraft(userId, body, input.purpose);
  const lowScoreNote = review && review.composite < 70
    ? `\n\nVOICE MATCH: ${review.composite}/100. ${review.critique || ''}` +
      (review.suggestions[0] ? ` Suggestion: ${review.suggestions[0]}` : '')
    : review
      ? `\n\nVOICE MATCH: ${review.composite}/100. Sounds like the user.`
      : '';
  const combinedCritique = review
    ? [review.critique, review.suggestions[0]].filter(Boolean).join(' — ').slice(0, 240)
    : undefined;

  return {
    output: `Cold-outreach draft saved to Gmail.\nTo: ${displayName} <${to}>\nSubject: ${subject}\n\nDraft body (first 400 chars):\n${body.slice(0, 400)}${body.length > 400 ? '...' : ''}\n\nReview the draft below and hit Send when ready. Do NOT call send_email.${lowScoreNote}`,
    canvasData: {
      title: `Draft: ${subject}`,
      type: 'email_draft',
      markdown: [
        `**To:** ${displayName} <${to}>`,
        `**Subject:** ${subject}`,
        '',
        '---',
        '',
        body,
        '',
        '---',
        '',
        `[Open in Gmail](${previewUrl})`,
      ].join('\n'),
      draftMeta: {
        to,
        subject,
        body,
        recipientName: displayName,
        gmailDraftId: draft.id,
        voiceScore: review?.composite,
        voiceCritique: combinedCritique,
      },
    },
  };
}

async function sendEmail(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // FIX 1 — State machine at tool level (belt-and-braces over consumeApproval).
  // If runState is PLANNING or CONFIRMING, writes are unconditionally blocked
  // regardless of whether the session-state DB is reachable. This catches the
  // edge case where consumeApproval fails open (DB unreachable) AND the LLM
  // skipped request_confirmation entirely.
  if (!context.isBackgroundAgent && context.runState && context.runState !== 'EXECUTING' && context.runState !== 'REPORTING') {
    return failureResult(
      `Refusing to send email — current state is ${context.runState}. Call request_confirmation first with { To: "${input.to || ''}", Subject: "${input.subject || ''}" }, wait for the user to click Confirm (state will become EXECUTING), then retry send_email.`,
      'confirmation_required',
    );
  }

  // Executor-level confirmation gate. The system prompt tells the LLM to call
  // request_confirmation first, but prompt rules drift — the gate here makes
  // it non-negotiable. consumeApproval fails open if the migration isn't
  // applied or Supabase is unreachable, so existing deployments don't break.
  if (context.conversationId) {
    const targetKey = normalizeTargetKey('send_email', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'send_email',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to send. No approved request_confirmation found for sending an email to ${input.to || 'this recipient'} with subject "${input.subject || ''}". You MUST call request_confirmation first with details { To: "${input.to || ''}", Subject: "${input.subject || ''}" }, wait for the user to click Confirm, and only then call send_email.`,
        'confirmation_required',
      );
    }
  }

  {
    const gate = await applyAutonomyGate({ userId, action: 'send_email', toolName: 'send_email', input, context, verb: 'send' });
    if (gate.handled) return gate.result!;
  }

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const raw = buildRaw(input.to, input.subject, input.body, input.threadId);
  const reqBody: Record<string, any> = { raw };
  if (input.threadId) reqBody.threadId = input.threadId;
  const sendBodyStr = JSON.stringify(reqBody);

  const sendUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const sendInit = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: sendBodyStr };
  let res = await googleFetch(userId, 'gmail', sendUrl, sendInit);
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gmail', sendUrl, { ...sendInit, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    }
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 403) return classifyGoogle403(err) === 'scope'
      ? failureResult(GMAIL_SCOPE_MESSAGE, 'gmail_scope_missing')
      : failureResult('Gmail is briefly rate-limited by Google. The connection is fine; I\'ll retry shortly.', 'gmail_rate_limited');
    return failureResult(`Failed to send email (${res.status}): ${err.slice(0, 200)}`, 'send_failed');
  }

  const sent = await res.json();
  // Feature 3: Voice auto-learning — fire-and-forget, never blocks send
  if (input.body) learnFromSentEmail(userId, input.body, input.subject || '');
  // Feature 4: Update contact memory on every send
  if (input.to) touchContact(userId, input.to, input.recipientName || '');

  // PART 8 #2 — emit an action-card so the UI renders a green "Email sent!"
  // entry with a "View thread" deeplink instead of a plain text line. Each
  // send produces its own card; bulk sends stack as a list of cards.
  const threadIdForUrl = input.threadId || sent.threadId || '';
  const viewUrl = threadIdForUrl
    ? `https://mail.google.com/mail/u/0/#inbox/${threadIdForUrl}`
    : `https://mail.google.com/mail/u/0/#sent`;
  const recipientName = input.recipientName || (typeof input.to === 'string' ? input.to.split('@')[0] : '');

  return {
    output: `Email sent successfully! Message ID: ${sent.id}\nTo: ${input.to}\nSubject: ${input.subject}\nGmail URL: ${viewUrl}`,
    canvasData: {
      title: input.subject || '(no subject)',
      type: 'email_sent',
      markdown: '',
      pageMeta: {
        url: viewUrl,
        messageId: sent.id,
        threadId: threadIdForUrl,
        to: input.to,
        recipientName,
        subject: input.subject || '',
      } as any,
    },
  };
}

async function scheduleEmailSend(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // Scheduling commits the email to send, so it carries the SAME approval gate as
  // send_email (mirrors that flow exactly — state machine + consumeApproval for
  // live chat, queuePendingAction for background agents). On approval the action
  // re-runs schedule_email_send (not send_email) so it schedules, not sends-now.
  if (!context.isBackgroundAgent && context.runState && context.runState !== 'EXECUTING' && context.runState !== 'REPORTING') {
    return failureResult(
      `Refusing to schedule a send — current state is ${context.runState}. Call request_confirmation first with { To: "${input.to || ''}", Subject: "${input.subject || ''}" }, wait for the user to click Confirm, then retry schedule_email_send.`,
      'confirmation_required',
    );
  }

  // ── BATCH MODE — many personalized emails, ONE user approval ──────────────
  if (Array.isArray(input.items) && input.items.length > 0) {
    return await scheduleEmailBatch(userId, input, context);
  }

  if (context.conversationId) {
    const targetKey = normalizeTargetKey('send_email', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'send_email',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to schedule. No approved request_confirmation found for emailing ${input.to || 'this recipient'} (subject "${input.subject || ''}"). Call request_confirmation first, wait for Confirm, then retry schedule_email_send.`,
        'confirmation_required',
      );
    }
  }
  {
    const gate = await applyAutonomyGate({ userId, action: 'send_email', toolName: 'schedule_email_send', input, context, verb: 'schedule' });
    if (gate.handled) return gate.result!;
  }

  // Gmail must be connected for the dispatcher to deliver later — fail early.
  const token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const supabase = getSupabaseAdmin();
  const res = await enqueueScheduledEmail(supabase, {
    userId,
    to: input.to,
    subject: input.subject,
    body: input.body,
    sendAt: input.sendAt,
    threadId: input.threadId,
    dedupKey: input.dedupKey,
    source: context.isBackgroundAgent ? 'agent' : 'chat',
    agentId: context.agentId,
  });

  if (!res.ok) return failureResult(res.error || 'Could not schedule the email.', 'validation_error');
  if (res.duplicate) {
    return { output: `Already scheduled (matching dedupKey) — no duplicate created.` };
  }

  const whenLabel = new Date(res.sendAt!).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  return {
    output: `Email scheduled. It will send to ${input.to} on ${whenLabel} — no further action needed. (id: ${res.id})`,
  };
}

/**
 * BATCH scheduling — the scale gate. Up to 100 personalized emails in one
 * call, each with its own body and send time, flowing into the same
 * boult_scheduled_emails queue the cron already drains.
 *
 * The approval law, batch-shaped: in live chat the call MUST carry the
 * approvalId of a batch request_confirmation the user clicked Confirm on
 * (consumed by id — single use). Background agents pass through their own
 * approval surface exactly like single sends (skip_confirmations/autonomy).
 */
async function scheduleEmailBatch(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const rawItems: any[] = input.items;
  if (rawItems.length > 100) {
    return failureResult(`Batch too large (${rawItems.length}). Maximum is 100 emails per call — split the list.`, 'validation_error');
  }

  // Validate every item BEFORE consuming the approval — a bad batch must not
  // burn the user's confirmation.
  const problems: string[] = [];
  const seen = new Set<string>();
  const items = rawItems.map((it: any, i: number) => {
    const to = String(it?.to || '').trim().toLowerCase();
    const body = String(it?.body || '').trim();
    const sendAt = String(it?.sendAt || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) problems.push(`item ${i + 1}: invalid recipient "${to || '(empty)'}"`);
    if (body.length < 20) problems.push(`item ${i + 1} (${to}): body missing or too short`);
    if (!Number.isFinite(Date.parse(sendAt))) problems.push(`item ${i + 1} (${to}): sendAt is not a valid ISO date`);
    if (seen.has(to)) problems.push(`item ${i + 1}: duplicate recipient ${to}`);
    seen.add(to);
    return { to, subject: String(it?.subject || '').trim() || '(no subject)', body, sendAt };
  });
  if (problems.length) {
    return failureResult(
      `Batch rejected — fix these and retry (the approval was NOT consumed):\n- ${problems.slice(0, 10).join('\n- ')}${problems.length > 10 ? `\n…and ${problems.length - 10} more` : ''}`,
      'validation_error',
    );
  }

  // The approval law. Explicit id handshake — no key reconstruction.
  if (context.conversationId && !context.isBackgroundAgent) {
    const { approved, failedOpen } = await consumeApprovalById({
      approvalId: String(input.approvalId || ''),
      userId,
      actionType: 'batch_email_send',
      conversationId: context.conversationId,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to schedule ${items.length} emails — no approved batch confirmation. Call request_confirmation with action "Send ${items.length} personalized emails to …" and details including Count: "${items.length}", wait for the user to click Confirm, then retry with the approvalId from that confirmation.`,
        'confirmation_required',
      );
    }
  } else {
    // Background agents: same autonomy surface as every other write.
    const gate = await applyAutonomyGate({ userId, action: 'send_email', toolName: 'schedule_email_send', input, context, verb: 'schedule' });
    if (gate.handled) return gate.result!;
  }

  const token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const supabase = getSupabaseAdmin();
  let scheduled = 0;
  let duplicates = 0;
  const failures: string[] = [];
  let earliest = Infinity;
  let latest = -Infinity;

  for (const it of items) {
    const res = await enqueueScheduledEmail(supabase, {
      userId,
      to: it.to,
      subject: it.subject,
      body: it.body,
      sendAt: it.sendAt,
      // Idempotent per (batch, recipient): a retried call never double-books.
      dedupKey: `batch:${input.approvalId || context.agentId || 'run'}:${it.to}`,
      source: context.isBackgroundAgent ? 'agent' : 'chat',
      agentId: context.agentId,
    });
    if (res.ok && res.duplicate) { duplicates++; continue; }
    if (!res.ok) { failures.push(`${it.to}: ${res.error}`); continue; }
    scheduled++;
    const t = Date.parse(it.sendAt);
    if (t < earliest) earliest = t;
    if (t > latest) latest = t;
  }

  const fmt = (ms: number) => new Date(ms).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const windowLabel = scheduled > 0
    ? (latest > earliest ? `${fmt(earliest)} → ${fmt(latest)}` : fmt(earliest))
    : '';

  return {
    output:
      `Batch scheduled: ${scheduled} of ${items.length} emails queued${windowLabel ? ` (sending ${windowLabel})` : ''}.` +
      (duplicates ? ` ${duplicates} already scheduled (skipped).` : '') +
      (failures.length ? `\nFailed to queue:\n- ${failures.slice(0, 5).join('\n- ')}` : '') +
      `\nThe dispatcher delivers each at its send time — the user does not need to be online. They can review or cancel anything with list_scheduled_emails / cancel_scheduled_email.`,
  };
}

async function listScheduledEmails(userId: string, input: any): Promise<ToolResult> {
  const supabase = getSupabaseAdmin();
  const includeSent = input?.includeSent === true;
  let query = supabase
    .from('boult_scheduled_emails')
    .select('id, to_email, subject, send_at, status, sent_at')
    .eq('user_id', userId)
    .order('send_at', { ascending: true })
    .limit(50);
  query = includeSent
    ? query.in('status', ['pending', 'sending', 'sent', 'failed'])
    : query.in('status', ['pending', 'sending']);

  const { data, error } = await query;
  if (error) return failureResult(`Could not read scheduled emails: ${error.message}`, 'read_failed');
  if (!data?.length) return { output: includeSent ? 'No scheduled emails.' : 'No upcoming scheduled emails.' };

  const lines = data.map((r: any, i: number) => {
    const when = new Date(r.send_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const tag = r.status === 'pending' || r.status === 'sending' ? when : `${r.status}`;
    return `${i + 1}. ${r.subject || '(no subject)'} → ${r.to_email} · ${tag}  [id: ${r.id}]`;
  });
  return { output: `${data.length} scheduled email${data.length !== 1 ? 's' : ''}:\n\n${lines.join('\n')}` };
}

async function cancelScheduledEmail(userId: string, input: any): Promise<ToolResult> {
  if (!input?.id) return failureResult('A scheduled email id is required.', 'validation_error');
  const supabase = getSupabaseAdmin();

  const { data: row } = await supabase
    .from('boult_scheduled_emails')
    .select('id, status, subject, to_email')
    .eq('user_id', userId)
    .eq('id', input.id)
    .maybeSingle();
  if (!row) return failureResult('No scheduled email found with that id.', 'not_found');
  if (row.status === 'sent') return failureResult('That email has already been sent — it cannot be cancelled.', 'already_sent');
  if (row.status === 'cancelled') return { output: 'That scheduled email was already cancelled.' };

  // Only cancel if still pending — guards against cancelling a row the dispatcher
  // is mid-send on ('sending').
  const { data: updated } = await supabase
    .from('boult_scheduled_emails')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!updated) return failureResult('That email is already being sent and can no longer be cancelled.', 'already_sent');

  return { output: `Cancelled the scheduled email "${row.subject || '(no subject)'}" to ${row.to_email}.` };
}

async function scheduleMeeting(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // FIX 1 — State machine gate (belt-and-braces, see sendEmail).
  if (!context.isBackgroundAgent && context.runState && context.runState !== 'EXECUTING' && context.runState !== 'REPORTING') {
    return failureResult(
      `Refusing to schedule — current state is ${context.runState}. Call request_confirmation first with the meeting details, wait for the user to click Confirm (state will become EXECUTING), then retry schedule_meeting.`,
      'confirmation_required',
    );
  }

  // PART 4 Rule 3 — Never invent availability. The LLM must have checked the
  // calendar before proposing a time. Accepts either get_calendar_events or
  // calendar_get_availability earlier in the same run; notion_get_calendar_events
  // also counts when Notion calendar is the source of truth. Without this
  // gate the LLM could schedule into a guessed-empty slot.
  if (context.toolHistory && !hasFetchedAvailability(context.toolHistory)) {
    return failureResult(
      `Refusing to schedule. You have not yet checked the user's calendar this turn — call calendar_get_availability (or get_calendar_events) covering ${input.startTime} first so you propose a time you've actually verified is free, then retry schedule_meeting.`,
      'fetch_required',
    );
  }

  if (context.conversationId) {
    const targetKey = normalizeTargetKey('schedule_meeting', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'schedule_meeting',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      const att = Array.isArray(input.attendees) ? input.attendees.join(', ') : '';
      return failureResult(
        `Refusing to create event. No approved request_confirmation found for scheduling "${input.title || ''}" at ${input.startTime || ''}${att ? ` with ${att}` : ''}. Call request_confirmation first with the meeting details, wait for the user to click Confirm, then retry.`,
        'confirmation_required',
      );
    }
  }

  {
    const gate = await applyAutonomyGate({ userId, action: 'schedule_meeting', toolName: 'schedule_meeting', input, context, verb: 'book' });
    if (gate.handled) return gate.result!;
  }

  let token = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected. Ask the user to connect it in Settings → Integrations.', 'gcal_not_connected');

  const event: Record<string, any> = {
    summary: input.title,
    start: { dateTime: input.startTime },
    end: { dateTime: input.endTime },
    description: input.description || '',
    conferenceData: {
      createRequest: { requestId: `boult-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  };

  if (input.attendees?.length) {
    event.attendees = input.attendees.map((e: string) => ({ email: e }));
  }

  const calUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all';
  const eventBodyStr = JSON.stringify(event);

  let res = await googleFetch(userId, 'gcal', calUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: eventBodyStr,
  });
  if (res.status === 401 || res.status === 403) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gcal', calUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: eventBodyStr,
      });
    }
  }

  if (!res.ok) {
    const cal403 = await gcal403Failure(res);
    if (cal403) return cal403;
    const err = await res.text().catch(() => '');
    return failureResult(`Failed to create event (${res.status}): ${err.slice(0, 200)}`, 'gcal_create_failed');
  }

  const created = await res.json();
  const meetLink = created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || '';

  return {
    output: [
      `Meeting created: "${created.summary}"`,
      `Start: ${created.start?.dateTime}`,
      created.htmlLink ? `Calendar URL: ${created.htmlLink}` : '',
      meetLink ? `Meet: ${meetLink}` : '',
      input.attendees?.length ? `Attendees: ${input.attendees.join(', ')}` : '',
      `Now confirm to the user what was scheduled and provide the meet link.`,
    ].filter(Boolean).join('\n'),
    canvasData: {
      title: created.summary || input.title || 'Meeting',
      type: 'calendar_event',
      markdown: '',
      pageMeta: {
        url: created.htmlLink,
        meetLink,
        startTime: created.start?.dateTime,
        attendees: input.attendees || [],
        contentPreview: input.description || '',
      },
    },
  };
}

async function getCalendarEvents(userId: string, input: any): Promise<ToolResult> {
  let token = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  const days = input.daysAhead || 7;
  const max = input.maxResults || 20;
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);

  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(max),
  });

  const calEventsUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;
  let res = await googleFetch(userId, 'gcal', calEventsUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; res = await googleFetch(userId, 'gcal', calEventsUrl, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!res.ok) {
    const cal403 = await gcal403Failure(res);
    if (cal403) return cal403;
    return failureResult(`Calendar fetch failed (${res.status}).`, 'upstream_gcal');
  }

  const data = await res.json();
  const events = data.items || [];
  if (!events.length) return { output: 'No upcoming events in the next ' + days + ' days.' };

  const lines = events.map((e: any, i: number) => {
    const start = e.start?.dateTime || e.start?.date || 'Unknown';
    const attendees = (e.attendees || []).map((a: any) => a.email).join(', ');
    return `${i + 1}. ${e.summary || '(no title)'}\n   When: ${start}\n   Attendees: ${attendees || 'None'}`;
  });

  return { output: `${events.length} upcoming events:\n\n${lines.join('\n\n')}` };
}

// ── calendar_get_availability ─────────────────────────────────────────────────
// Uses GCal's freeBusy endpoint (purpose-built for this) and inverts the busy
// set against the requested window to produce free slots >= minSlotMinutes.
// Also fetches event titles for the busy ranges so the LLM can quote them when
// explaining a conflict ("you have 'Standup' at 10am").
async function calendarGetAvailability(userId: string, input: any): Promise<ToolResult> {
  const startIso = (input.startDate || '').trim();
  const endIso = (input.endDate || '').trim();
  if (!startIso || !endIso) return failureResult('startDate and endDate (ISO 8601) are required.', 'validation_error');
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return failureResult('startDate and endDate must be valid ISO 8601 timestamps with endDate after startDate.', 'validation_error');
  }
  const minSlotMs = Math.max(5, Number(input.minSlotMinutes) || 30) * 60 * 1000;
  const tz = (input.timezone || 'UTC').trim() || 'UTC';

  let token = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  // 1) freeBusy — gives us the busy ranges only
  const fbBody = JSON.stringify({
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    timeZone: tz,
    items: [{ id: 'primary' }],
  });
  let fbRes = await googleFetch(userId, 'gcal', 'https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: fbBody,
  });
  if (fbRes.status === 401 || fbRes.status === 403) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      fbRes = await googleFetch(userId, 'gcal', 'https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: fbBody,
      });
    }
  }
  if (!fbRes.ok) {
    const fb403 = await gcal403Failure(fbRes);
    if (fb403) return fb403;
    return failureResult(`freeBusy fetch failed (${fbRes.status}).`, 'upstream_gcal');
  }
  const fbData = await fbRes.json();
  const busyRaw: Array<{ start: string; end: string }> = fbData.calendars?.primary?.busy || [];

  // 2) Pull events in the window to attach titles to the busy ranges (best-effort)
  const eventTitles = new Map<string, string>(); // key = `${start}|${end}` -> title
  try {
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });
    const evRes = await googleFetch(userId, 'gcal',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (evRes.ok) {
      const data = await evRes.json();
      for (const e of (data.items || []) as any[]) {
        const s = e.start?.dateTime || (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
        const en = e.end?.dateTime || (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
        if (s && en) eventTitles.set(`${new Date(s).toISOString()}|${new Date(en).toISOString()}`, e.summary || '(no title)');
      }
    }
  } catch { /* non-fatal — busy ranges still report without titles */ }

  // 3) Normalize, clip, and sort busy ranges; then invert to find free slots
  const clipped = busyRaw
    .map(b => ({ s: Math.max(start, Date.parse(b.start)), e: Math.min(end, Date.parse(b.end)) }))
    .filter(b => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s)
    .sort((a, b) => a.s - b.s);

  // Merge overlaps so the free-slot inversion is correct
  const merged: Array<{ s: number; e: number }> = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e);
    else merged.push({ s: b.s, e: b.e });
  }

  const free: Array<{ s: number; e: number }> = [];
  let cursor = start;
  for (const b of merged) {
    if (b.s - cursor >= minSlotMs) free.push({ s: cursor, e: b.s });
    cursor = Math.max(cursor, b.e);
  }
  if (end - cursor >= minSlotMs) free.push({ s: cursor, e: end });

  const fmt = (ms: number) => {
    try {
      return new Date(ms).toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch { return new Date(ms).toISOString(); }
  };

  const busyLines = merged.length
    ? merged.map(b => {
        const title = eventTitles.get(`${new Date(b.s).toISOString()}|${new Date(b.e).toISOString()}`);
        return `  • ${fmt(b.s)} → ${fmt(b.e)}${title ? `  (${title})` : ''}`;
      })
    : ['  (none)'];

  const freeLines = free.length
    ? free.map(f => `  • ${fmt(f.s)} → ${fmt(f.e)}  (${Math.round((f.e - f.s) / 60000)} min)`)
    : [`  (no free slots ≥ ${Math.round(minSlotMs / 60000)} min in this window)`];

  return {
    output: [
      `Availability ${fmt(start)} → ${fmt(end)} (${tz})`,
      '',
      'Busy:',
      ...busyLines,
      '',
      `Free (slots ≥ ${Math.round(minSlotMs / 60000)} min):`,
      ...freeLines,
    ].join('\n'),
  };
}

// ── calendar_cancel_event ─────────────────────────────────────────────────────
// Gated by the same session-approval mechanism as send_email. Notifying
// attendees is irreversible (you can't unsend a cancellation email), so this
// is treated as Tier 3 — explicit confirm per event.
// ── Super-agent foundation tools (ledger / memory / user model) ─────────────────

function fmtDue(due: string | null): string {
  if (!due) return 'no date';
  const d = new Date(due);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `OVERDUE ${Math.abs(days)}d`;
  if (days === 0) return 'due today';
  return `due in ${days}d`;
}

async function ledgerAddCommitment(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const what = (input?.what || '').trim();
  if (!what) return failureResult('what is required.', 'validation_error');
  const entry = await addCommitment({
    userId, agentId: context.agentId || null, what,
    who: input.who || null, due: input.due || null,
    originRunId: context.runId || null, threadId: input.threadId || null,
  });
  if (!entry) return failureResult('Could not save the commitment.', 'ledger_error');
  return { output: `Tracked: "${entry.what}"${entry.who ? ` (${entry.who})` : ''} — ${fmtDue(entry.due)}. id ${entry.id}` };
}

async function ledgerListDue(userId: string): Promise<ToolResult> {
  const open = await listOpen(userId);
  const { overdue, dueToday } = bucketByDue(open);
  const due = [...overdue, ...dueToday];
  if (!due.length) return { output: 'Nothing due or overdue in the ledger right now.' };
  const lines = due.map(e => `- [${e.id}] ${e.what}${e.who ? ` — ${e.who}` : ''} (${fmtDue(e.due)})`);
  return { output: `Due / overdue commitments (handle these first):\n${lines.join('\n')}` };
}

async function ledgerListOpen(userId: string): Promise<ToolResult> {
  const open = await listOpen(userId);
  if (!open.length) return { output: 'No open commitments in the ledger.' };
  const lines = open.map(e => `- [${e.id}] ${e.what}${e.who ? ` — ${e.who}` : ''} (${fmtDue(e.due)})`);
  return { output: `Open commitments (${open.length}):\n${lines.join('\n')}` };
}

async function ledgerCloseCommitment(input: any, context: ToolContext = {}): Promise<ToolResult> {
  const id = (input?.id || '').trim();
  if (!id) return failureResult('id is required.', 'validation_error');
  const ok = await closeCommitment(id, context.runId || null, input.status === 'cancelled' ? 'cancelled' : 'done');
  return ok ? { output: `Closed commitment ${id}.` } : failureResult('Could not close that commitment.', 'ledger_error');
}

async function saveFactTool(userId: string, input: any): Promise<ToolResult> {
  const fact = (input?.fact || '').trim();
  if (!fact) return failureResult('fact is required.', 'validation_error');
  await saveFact(userId, fact);
  return { output: `Remembered: ${fact}` };
}

async function saveDecisionTool(userId: string, input: any): Promise<ToolResult> {
  const decision = (input?.decision || '').trim();
  if (!decision) return failureResult('decision is required.', 'validation_error');
  await saveDecision(userId, decision, input.outcome || undefined);
  return { output: `Logged decision: ${decision}${input.outcome ? ` → ${input.outcome}` : ''}` };
}

// ── Cal.com scheduling ─────────────────────────────────────────────────────────
// Always prefer the user's OWN connected Cal.com API key so bookings land on
// THEIR account.
//
// Multi-tenant safety: the shared CAL_API_KEY fallback is DANGEROUS in a
// multi-user deployment — a user who hasn't connected their own key would
// otherwise read and BOOK on the operator's Cal.com account. So the shared key is
// only used when the operator explicitly opts into single-tenant mode via
// CAL_ALLOW_SHARED_KEY=true. Otherwise a keyless user is treated as not-connected.
//
// (Why not OAuth instead of API keys? Verified June 2026: Cal.com's personal-
// account OAuth only grants READ_BOOKING + READ_PROFILE — no scope to list
// event-types/slots or CREATE bookings. Swapping the API key for OAuth would
// break the core "book a meeting" capability, so the API key stays the path.
// See docs/boult-calcom-auth.md.)
async function getCalClient(userId?: string): Promise<InstanceType<typeof CalComService> | null> {
  if (userId) {
    try {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from('integration_credentials')
        .select('access_token')
        .eq('user_email', userId.toLowerCase())
        .eq('provider', 'cal_com')
        .maybeSingle();
      const k = (data?.access_token || '').trim();
      if (k) return new CalComService(k);
    } catch { /* fall through to shared-key check */ }
  }
  const shared = (process.env.CAL_API_KEY || '').trim();
  const allowShared = process.env.CAL_ALLOW_SHARED_KEY === 'true';
  return (shared && allowShared) ? new CalComService(shared) : null;
}

function calcomBookingUrl(slug: string): string {
  // Cal.com public booking links are cal.com/<username>/<slug>; without the
  // username we surface the slug and let the LLM combine it with the user's
  // handle when known. Most tenants set CAL_COM_USERNAME for clean links.
  const user = (process.env.CAL_COM_USERNAME || '').trim();
  return user ? `https://cal.com/${user}/${slug}` : `https://cal.com/${slug}`;
}

async function calcomListEventTypes(userId: string): Promise<ToolResult> {
  const cal = await getCalClient(userId);
  if (!cal) return failureResult('Cal.com is not connected. Add your Cal.com API key in Settings → Integrations.', 'calcom_not_configured');
  try {
    const types = await cal.getEventTypes();
    if (!types.length) return { output: 'No Cal.com event types found. Create a meeting type in Cal.com first.' };
    const lines = types.map((t: any) =>
      `• ${t.title} — id ${t.id}, ${t.length || t.lengthInMinutes || '?'} min, link ${calcomBookingUrl(t.slug)}`,
    );
    return { output: `Cal.com meeting types:\n${lines.join('\n')}` };
  } catch (err: any) {
    return failureResult(`Cal.com error: ${err.message}`, 'upstream_calcom');
  }
}

async function calcomGetSlots(userId: string, input: any): Promise<ToolResult> {
  const cal = await getCalClient(userId);
  if (!cal) return failureResult('Cal.com is not connected. Add your Cal.com API key in Settings → Integrations.', 'calcom_not_configured');
  const eventTypeId = Number(input.eventTypeId);
  if (!eventTypeId) return failureResult('eventTypeId is required.', 'validation_error');
  if (!input.startTime || !input.endTime) return failureResult('startTime and endTime are required.', 'validation_error');
  try {
    const slots = await cal.getAvailableSlots({ eventTypeId, startTime: input.startTime, endTime: input.endTime });
    // Cal.com returns { "YYYY-MM-DD": [{ time }] }
    const flat: string[] = [];
    for (const day of Object.keys(slots || {})) {
      for (const s of (slots[day] || [])) flat.push(s.time || s);
    }
    if (!flat.length) return { output: 'No open Cal.com slots in that window. Try a wider window or a different meeting type.' };
    return { output: `Available Cal.com slots (${flat.length}):\n${flat.slice(0, 60).map((t) => `• ${t}`).join('\n')}` };
  } catch (err: any) {
    return failureResult(`Cal.com error: ${err.message}`, 'upstream_calcom');
  }
}

async function calcomCreateBooking(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const cal = await getCalClient(userId);
  if (!cal) return failureResult('Cal.com is not connected. Add your Cal.com API key in Settings → Integrations.', 'calcom_not_configured');
  const eventTypeId = Number(input.eventTypeId);
  if (!eventTypeId || !input.start || !input.name || !input.email) {
    return failureResult('eventTypeId, start, name and email are required.', 'validation_error');
  }

  // Confirmation gate — booking notifies the attendee.
  if (context.conversationId) {
    const targetKey = normalizeTargetKey('calcom_book', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId, userId, actionType: 'calcom_book', targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to book. No approved request_confirmation found. Call request_confirmation first with action "Book Cal.com meeting" and details { With: "${input.name}", When: "${input.start}" }, wait for Confirm, then retry.`,
        'confirmation_required',
      );
    }
  }
  {
    const gate = await applyAutonomyGate({ userId, action: 'calcom_book', toolName: 'calcom_create_booking', input, context, verb: 'book' });
    if (gate.handled) return gate.result!;
  }

  try {
    const booking = await cal.createBooking({
      eventTypeId, start: input.start, end: input.end,
      name: input.name, email: input.email, notes: input.notes, timezone: input.timezone,
    });
    return { output: `Booked Cal.com meeting with ${input.name} at ${input.start}.${booking?.id ? ` Booking id ${booking.id}.` : ''}` };
  } catch (err: any) {
    const code = /no available|slot|busy/i.test(err.message) ? 'slot_unavailable' : 'upstream_calcom';
    return failureResult(`Cal.com error: ${err.message}`, code);
  }
}

async function calcomListBookings(userId: string): Promise<ToolResult> {
  const cal = await getCalClient(userId);
  if (!cal) return failureResult('Cal.com is not connected. Add your Cal.com API key in Settings → Integrations.', 'calcom_not_configured');
  try {
    const bookings = await cal.getBookings();
    if (!bookings.length) return { output: 'No Cal.com bookings found.' };
    const lines = bookings.slice(0, 40).map((b: any) => {
      const who = b.attendees?.[0]?.name || b.attendees?.[0]?.email || 'someone';
      return `• id ${b.id} — ${b.title || 'Meeting'} with ${who}, ${b.startTime || b.start} (${b.status || 'accepted'})`;
    });
    return { output: `Cal.com bookings:\n${lines.join('\n')}` };
  } catch (err: any) {
    return failureResult(`Cal.com error: ${err.message}`, 'upstream_calcom');
  }
}

async function calcomCancelBooking(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const cal = await getCalClient(userId);
  if (!cal) return failureResult('Cal.com is not connected. Add your Cal.com API key in Settings → Integrations.', 'calcom_not_configured');
  const bookingId = Number(input.bookingId);
  if (!bookingId) return failureResult('bookingId is required.', 'validation_error');

  if (context.conversationId) {
    const targetKey = normalizeTargetKey('calcom_cancel', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId, userId, actionType: 'calcom_cancel', targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to cancel. No approved request_confirmation found for cancelling Cal.com booking ${bookingId}. Call request_confirmation first, wait for Confirm, then retry.`,
        'confirmation_required',
      );
    }
  }
  if (context.isBackgroundAgent && !context.skipConfirmations && context.agentId && context.runId) {
    await queuePendingAction({ agentId: context.agentId, runId: context.runId, userId, toolName: 'calcom_cancel_booking', toolInput: input });
    return { output: `Cancellation queued for user approval.` };
  }

  try {
    await cal.cancelBooking({ bookingId, reason: input.reason });
    return { output: `Cancelled Cal.com booking ${bookingId}.` };
  } catch (err: any) {
    const code = /not found|404/i.test(err.message) ? 'not_found' : 'upstream_calcom';
    return failureResult(`Cal.com error: ${err.message}`, code);
  }
}

async function calendarCancelEvent(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const eventId = (input.eventId || '').trim();
  if (!eventId) return failureResult('eventId is required.', 'validation_error');

  if (context.conversationId) {
    const targetKey = normalizeTargetKey('cancel_event', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'cancel_event',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to cancel. No approved request_confirmation found for cancelling event ${eventId}. Call request_confirmation first with action "Cancel event" and details { EventId: "${eventId}" }, wait for the user to Confirm, then retry.`,
        'confirmation_required',
      );
    }
  }

  if (context.isBackgroundAgent && !context.skipConfirmations && context.agentId && context.runId) {
    await queuePendingAction({
      agentId: context.agentId,
      runId: context.runId,
      userId,
      toolName: 'calendar_cancel_event',
      toolInput: input,
    });
    return { output: `Action queued for user approval.` };
  }

  let token = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  // Fetch attendee count first (best-effort) so the success message is informative.
  let attendeeCount = 0;
  try {
    const evRes = await googleFetch(userId, 'gcal',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (evRes.ok) {
      const ev = await evRes.json();
      attendeeCount = (ev.attendees || []).length;
    }
  } catch { /* non-fatal */ }

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  let res = await googleFetch(userId, 'gcal', url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gcal', url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 410) return failureResult(`Event ${eventId} not found.`, 'not_found');
    const cal403 = await gcal403Failure(res);
    if (cal403) return cal403;
    const err = await res.text().catch(() => '');
    return failureResult(`Cancel failed (${res.status}): ${err.slice(0, 200)}`, 'upstream_gcal');
  }

  const reason = input.reason ? ` Reason: ${input.reason}.` : '';
  return {
    output: `Cancelled event ${eventId}.${attendeeCount ? ` Notified ${attendeeCount} attendee(s).` : ''}${reason}`,
  };
}

async function searchNotion(userId: string, input: any): Promise<ToolResult> {
  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected. Ask the user to connect Notion in Settings → Integrations.', 'notion_not_connected');

  const max = Math.min(input.maxResults || 5, 10);
  const res = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({
      query: input.query,
      filter: { value: 'page', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: max,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return failureResult(`Notion search failed (${res.status}).`, 'upstream_notion');

  const data = await res.json();
  const pages = data.results || [];
  if (!pages.length) return { output: 'No Notion pages found for that query.' };

  const lines = pages.map((p: any, i: number) => {
    const titleProp = Object.values(p.properties || {}).find((pr: any) => pr.type === 'title') as any;
    const title = titleProp?.title?.[0]?.plain_text || 'Untitled';
    return `${i + 1}. ${title}\n   ID: ${p.id}\n   URL: ${p.url}\n   Last edited: ${p.last_edited_time?.split('T')[0] || ''}`;
  });

  return { output: `Found ${pages.length} Notion page(s):\n\n${lines.join('\n\n')}` };
}

// ── Notion schema introspection helpers ────────────────────────────────────────

interface NotionPropInfo { name: string; type: string; options?: string[] }

function parseNotionDbSchema(db: any): NotionPropInfo[] {
  const props = db.properties || {};
  return Object.entries(props).map(([name, val]: [string, any]) => ({
    name,
    type: val.type as string,
    options: val.select?.options?.map((o: any) => o.name)
      ?? val.status?.options?.map((o: any) => o.name)
      ?? [],
  }));
}

function findNotionProp(schema: NotionPropInfo[], types: string[]): NotionPropInfo | undefined {
  return schema.find(p => types.includes(p.type));
}

function buildNotionDbProperties(
  schema: NotionPropInfo[],
  title: string,
  agentProps: Record<string, any> = {},
  skipped: string[],
): Record<string, any> {
  const props: Record<string, any> = {};

  const titleProp = findNotionProp(schema, ['title']);
  if (titleProp) {
    props[titleProp.name] = { title: [{ type: 'text', text: { content: title.slice(0, 2000) } }] };
  } else {
    skipped.push('title (no title-type property in schema)');
  }

  // Map agent-provided extra props to real schema fields
  for (const [key, value] of Object.entries(agentProps)) {
    const schemaProp = schema.find(p => p.name.toLowerCase() === key.toLowerCase());
    if (!schemaProp) {
      skipped.push(`"${key}" (not in database schema)`);
      continue;
    }
    try {
      switch (schemaProp.type) {
        case 'rich_text':
          props[schemaProp.name] = { rich_text: [{ type: 'text', text: { content: String(value).slice(0, 2000) } }] };
          break;
        case 'select':
          props[schemaProp.name] = { select: { name: String(value) } };
          break;
        case 'multi_select': {
          const vals = Array.isArray(value) ? value : String(value).split(',').map((v: string) => v.trim());
          props[schemaProp.name] = { multi_select: vals.map((v: string) => ({ name: v })) };
          break;
        }
        case 'date':
          props[schemaProp.name] = { date: { start: String(value) } };
          break;
        case 'number':
          props[schemaProp.name] = { number: Number(value) };
          break;
        case 'checkbox':
          props[schemaProp.name] = { checkbox: Boolean(value) };
          break;
        case 'url':
          props[schemaProp.name] = { url: String(value) };
          break;
        case 'email':
          props[schemaProp.name] = { email: String(value) };
          break;
        case 'phone_number':
          props[schemaProp.name] = { phone_number: String(value) };
          break;
        case 'status':
          props[schemaProp.name] = { status: { name: String(value) } };
          break;
        default:
          skipped.push(`"${key}" (type "${schemaProp.type}" mapping not supported — write it in content instead)`);
      }
    } catch {
      skipped.push(`"${key}" (failed to map value)`);
    }
  }

  return props;
}

// ── fetch_notion_schema (agent-callable) ───────────────────────────────────────

async function fetchNotionSchemaForAgent(userId: string, input: any): Promise<ToolResult> {
  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected. Ask the user to connect Notion in Settings → Integrations.', 'notion_not_connected');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  let dbId = input.parentId ?? null;
  let dbTitle = input.database ?? 'unknown';

  if (!dbId) {
    try {
      const searchRes = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: input.database,
          filter: { value: 'database', property: 'object' },
          page_size: 8,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const results: any[] = searchData.results ?? [];
        const hint = (input.database as string).toLowerCase();
        const scored = results.map((r: any) => {
          const t = (r.title?.[0]?.plain_text ?? '').toLowerCase();
          return { r, score: t === hint ? 2 : t.includes(hint) ? 1 : 0 };
        }).sort((a: any, b: any) => b.score - a.score);
        const best = scored[0]?.r;
        if (best) {
          dbId = best.id;
          dbTitle = best.title?.[0]?.plain_text ?? input.database;
        }
      }
    } catch { /* fallthrough */ }
  }

  if (!dbId) {
    return failureResult(`Could not find a Notion database matching "${input.database}". Try a broader name like "meetings", "tasks", or "contacts". Use search_notion to discover available database names.`, 'notion_db_not_found');
  }

  const schema = await fetchNotionDbSchema(headers, dbId);
  if (!schema) {
    return failureResult(`Found database "${dbTitle}" but could not read its schema. Notion may not have granted access to this database.`, 'notion_schema_unreadable');
  }

  const schemaLines = schema.map(p => {
    const opts = p.options?.length ? ` — options: [${p.options.slice(0, 10).join(', ')}]` : '';
    return `  • "${p.name}" (${p.type})${opts}`;
  }).join('\n');

  return {
    output: `Notion database schema for "${dbTitle}":\ndatabase_id: ${dbId}\n\nProperties:\n${schemaLines}\n\nNow call create_notion_page with parentId: "${dbId}" and properties using these EXACT names.`,
  };
}

async function fetchNotionDbSchema(
  headers: Record<string, string>,
  dbId: string,
): Promise<NotionPropInfo[] | null> {
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const db = await res.json();
    return parseNotionDbSchema(db);
  } catch {
    return null;
  }
}

// ── createNotionPage ────────────────────────────────────────────────────────────

async function createNotionPage(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // FIX 1 — State machine gate (belt-and-braces, see sendEmail).
  if (!context.isBackgroundAgent && context.runState && context.runState !== 'EXECUTING' && context.runState !== 'REPORTING') {
    return failureResult(
      `Refusing to create Notion page — current state is ${context.runState}. Call request_confirmation first with { Database: "${input.database || ''}", Title: "${input.title || ''}" }, wait for the user to click Confirm (state will become EXECUTING), then retry create_notion_page.`,
      'confirmation_required',
    );
  }

  if (context.conversationId) {
    const targetKey = normalizeTargetKey('create_notion_page', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'create_notion_page',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to create the Notion page. No approved request_confirmation found for creating "${input.title || 'this page'}" in database "${input.database || input.parentId || 'unknown'}". Call request_confirmation first with details { Database: "${input.database || ''}", Title: "${input.title || ''}" }, wait for the user to click Confirm, then retry.`,
        'confirmation_required',
      );
    }
  }

  if (context.isBackgroundAgent && !context.skipConfirmations && context.agentId && context.runId) {
    await queuePendingAction({
      agentId: context.agentId,
      runId: context.runId,
      userId,
      toolName: 'create_notion_page',
      toolInput: input,
    });
    return { output: `Action queued for user approval.` };
  }

  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected. Ask the user to connect Notion in Settings → Integrations.', 'notion_not_connected');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  const skipped: string[] = [];

  // ── Step 1: Resolve parent (explicit ID → database search → free-form page) ──
  let parentBlock: Record<string, any> | null = null;
  let dbSchema: NotionPropInfo[] | null = null;

  if (input.parentId) {
    parentBlock = { type: 'database_id', database_id: input.parentId };
    dbSchema = await fetchNotionDbSchema(headers, input.parentId);
  } else if (input.database) {
    try {
      const searchRes = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: input.database,
          filter: { value: 'database', property: 'object' },
          page_size: 8,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        // Score results: prefer exact title match, then partial
        const results: any[] = searchData.results ?? [];
        const hint = (input.database as string).toLowerCase();
        const scored = results.map((r: any) => {
          const t = (r.title?.[0]?.plain_text ?? '').toLowerCase();
          return { r, score: t === hint ? 2 : t.includes(hint) ? 1 : 0 };
        }).sort((a: any, b: any) => b.score - a.score);
        const best = scored[0]?.r;
        if (best) {
          parentBlock = { type: 'database_id', database_id: best.id };
          dbSchema = await fetchNotionDbSchema(headers, best.id);
        }
      }
    } catch { /* fallthrough */ }
  }

  // Fallback: free-form page anywhere in the workspace
  if (!parentBlock) {
    try {
      const fallbackRes = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ filter: { value: 'page', property: 'object' }, page_size: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      if (fallbackRes.ok) {
        const fb = await fallbackRes.json();
        const pg = fb.results?.[0];
        if (pg) {
          parentBlock = { type: 'page_id', page_id: pg.id };
          skipped.push(`database hint "${input.database}" (not found — created as free-form page)`);
        }
      }
    } catch { /* fallthrough */ }
  }

  if (!parentBlock) {
    return failureResult(`Failed to create Notion page: could not locate a database matching "${input.database ?? 'unknown'}" and no fallback page found. Ensure Notion is connected with workspace access.`, 'notion_db_not_found');
  }

  // ── Step 2: Build properties from real schema ─────────────────────────────
  const isDatabase = parentBlock.type === 'database_id';
  let properties: Record<string, any>;

  if (isDatabase && dbSchema) {
    properties = buildNotionDbProperties(dbSchema, input.title ?? 'Untitled', input.properties ?? {}, skipped);
  } else {
    // Free-form page or no schema available — use generic title property
    properties = { title: { title: [{ type: 'text', text: { content: (input.title ?? 'Untitled').slice(0, 2000) } }] } };
  }

  // ── Step 3: Build children blocks from content ────────────────────────────
  const rawContent: string = input.content ?? '';
  const children = rawContent
    .split(/\n{2,}/)
    .map((chunk: string) => chunk.trim())
    .filter(Boolean)
    .slice(0, 90)
    .map((text: string) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }] },
    }));

  // ── Step 4: Create the page ───────────────────────────────────────────────
  const pageBody: Record<string, any> = { parent: parentBlock, properties, children };

  let createRes = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify(pageBody),
    signal: AbortSignal.timeout(15000),
  });

  // On schema rejection, fall back to free-form page under any workspace page
  if (!createRes.ok && isDatabase && (createRes.status === 400 || createRes.status === 422)) {
    const errDetail = await createRes.text().catch(() => '');
    skipped.push(`database parent rejected (${createRes.status}: ${errDetail.slice(0, 120)}) — fell back to free-form page`);
    try {
      const fpRes = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ filter: { value: 'page', property: 'object' }, page_size: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      if (fpRes.ok) {
        const fb = await fpRes.json();
        const pg = fb.results?.[0];
        if (pg) {
          const retryBody = {
            parent: { type: 'page_id', page_id: pg.id },
            properties: { title: { title: [{ type: 'text', text: { content: (input.title ?? 'Untitled').slice(0, 2000) } }] } },
            children,
          };
          createRes = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers,
            body: JSON.stringify(retryBody),
            signal: AbortSignal.timeout(12000),
          });
        }
      }
    } catch { /* fallthrough */ }
  }

  if (!createRes.ok) {
    const err = await createRes.text().catch(() => '');
    const skipNote = skipped.length ? ` Fields skipped: ${skipped.join('; ')}.` : '';
    return failureResult(`Failed to create Notion page "${input.title}" (${createRes.status}): ${err.slice(0, 200)}.${skipNote}`, 'notion_create_failed');
  }

  const created = await createRes.json();
  const contentPreview = rawContent
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 160);

  const skipNote = skipped.length
    ? ` Note: ${skipped.join('; ')}.`
    : '';

  return {
    output: `Notion page created: "${input.title}"\nURL: ${created.url}${skipNote}`,
    canvasData: {
      title: input.title,
      type: 'notion_page',
      markdown: rawContent,
      pageMeta: { url: created.url, pageId: created.id, contentPreview },
    },
  };
}

// ── notion_read_page ──────────────────────────────────────────────────────────
// Fetch page properties + recursively walk child blocks; convert to markdown.
// Notion page ids in the URL form (with or without dashes) both work — we
// normalize before calling the API.
function normalizeNotionId(raw: string): string {
  // Accept page urls and ids with or without dashes
  const idMatch = (raw || '').match(/[0-9a-fA-F]{32}|[0-9a-fA-F-]{36}/);
  if (!idMatch) return raw;
  const stripped = idMatch[0].replace(/-/g, '');
  if (stripped.length !== 32) return raw;
  return `${stripped.slice(0, 8)}-${stripped.slice(8, 12)}-${stripped.slice(12, 16)}-${stripped.slice(16, 20)}-${stripped.slice(20)}`;
}

// Render a Notion rich_text array as plain text (annotations stripped — we
// keep markdown bold/italic later as needed but for now just text).
function richTextToString(rt: any[]): string {
  if (!Array.isArray(rt)) return '';
  return rt.map((r: any) => r.plain_text || '').join('');
}

// Convert a single Notion block to markdown. Returns '' for unsupported types.
function notionBlockToMarkdown(block: any, depth = 0): string {
  const indent = '  '.repeat(depth);
  const t = block.type;
  const data = block[t] || {};
  switch (t) {
    case 'paragraph':
      return `${indent}${richTextToString(data.rich_text)}`;
    case 'heading_1':
      return `${indent}# ${richTextToString(data.rich_text)}`;
    case 'heading_2':
      return `${indent}## ${richTextToString(data.rich_text)}`;
    case 'heading_3':
      return `${indent}### ${richTextToString(data.rich_text)}`;
    case 'bulleted_list_item':
      return `${indent}- ${richTextToString(data.rich_text)}`;
    case 'numbered_list_item':
      return `${indent}1. ${richTextToString(data.rich_text)}`;
    case 'to_do': {
      const check = data.checked ? '[x]' : '[ ]';
      return `${indent}- ${check} ${richTextToString(data.rich_text)}`;
    }
    case 'quote':
      return `${indent}> ${richTextToString(data.rich_text)}`;
    case 'code':
      return `${indent}\`\`\`${data.language || ''}\n${richTextToString(data.rich_text)}\n${indent}\`\`\``;
    case 'divider':
      return `${indent}---`;
    case 'callout':
      return `${indent}> ${richTextToString(data.rich_text)}`;
    case 'toggle':
      return `${indent}▸ ${richTextToString(data.rich_text)}`;
    case 'image': {
      const url = data.file?.url || data.external?.url || '';
      const caption = richTextToString(data.caption);
      return `${indent}![${caption}](${url})`;
    }
    case 'bookmark':
      return `${indent}🔖 ${data.url || ''}`;
    case 'child_page':
      return `${indent}📄 ${data.title || '(child page)'}`;
    case 'child_database':
      return `${indent}🗄️ ${data.title || '(child database)'}`;
    default:
      return '';
  }
}

async function fetchAllChildren(
  headers: Record<string, string>,
  blockId: string,
  depth = 0,
  maxDepth = 4,
): Promise<string[]> {
  if (depth > maxDepth) return ['  '.repeat(depth) + '… (nested deeper than 4 levels — truncated)'];
  const lines: string[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      lines.push('  '.repeat(depth) + `(could not read child blocks: ${res.status})`);
      break;
    }
    const data = await res.json();
    const blocks: any[] = data.results || [];
    for (const b of blocks) {
      const md = notionBlockToMarkdown(b, depth);
      if (md) lines.push(md);
      if (b.has_children) {
        const childLines = await fetchAllChildren(headers, b.id, depth + 1, maxDepth);
        lines.push(...childLines);
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined;
    pagesFetched++;
    if (pagesFetched > 5) break; // hard cap so a giant page can't blow the budget
  } while (cursor);
  return lines;
}

function notionPropertyValueToString(prop: any): string {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return richTextToString(prop[prop.type]);
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    case 'select':
      return prop.select?.name || '';
    case 'multi_select':
      return (prop.multi_select || []).map((o: any) => o.name).join(', ');
    case 'status':
      return prop.status?.name || '';
    case 'date': {
      const s = prop.date?.start;
      const e = prop.date?.end;
      return e ? `${s} → ${e}` : (s || '');
    }
    case 'checkbox':
      return prop.checkbox ? '✓' : '✗';
    case 'url':
      return prop.url || '';
    case 'email':
      return prop.email || '';
    case 'phone_number':
      return prop.phone_number || '';
    case 'people':
      return (prop.people || []).map((p: any) => p.name || p.id).join(', ');
    case 'relation':
      return (prop.relation || []).length ? `${prop.relation.length} relation(s)` : '';
    case 'created_time':
      return prop.created_time || '';
    case 'last_edited_time':
      return prop.last_edited_time || '';
    default:
      return `(${prop.type})`;
  }
}

async function notionReadPage(userId: string, input: any): Promise<ToolResult> {
  const rawId = (input.pageId || '').trim();
  if (!rawId) return failureResult('pageId is required.', 'validation_error');
  const pageId = normalizeNotionId(rawId);

  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected. Ask the user to connect Notion in Settings → Integrations.', 'notion_not_connected');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // 1) Page properties
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers, signal: AbortSignal.timeout(10000) });
  if (pageRes.status === 404) return failureResult(`Notion page ${rawId} not found (or not shared with the integration).`, 'not_found');
  if (!pageRes.ok) return failureResult(`Could not read page (${pageRes.status}).`, 'upstream_notion');
  const page = await pageRes.json();

  // Pull the title — find the title-typed property and stringify it
  let title = '(untitled)';
  for (const [name, val] of Object.entries(page.properties || {}) as Array<[string, any]>) {
    if (val.type === 'title') {
      title = richTextToString(val.title) || name;
      break;
    }
  }

  const propLines: string[] = [];
  for (const [name, val] of Object.entries(page.properties || {}) as Array<[string, any]>) {
    if (val.type === 'title') continue;
    const v = notionPropertyValueToString(val);
    if (v) propLines.push(`  • ${name}: ${v}`);
  }

  // 2) Body blocks → markdown
  const bodyLines = await fetchAllChildren(headers, pageId, 0);

  const output = [
    `Notion page: ${title}`,
    `URL: ${page.url}`,
    `Last edited: ${page.last_edited_time}`,
    '',
    propLines.length ? 'Properties:' : 'Properties: (none non-title)',
    ...(propLines.length ? propLines : []),
    '',
    '--- Body ---',
    ...(bodyLines.length ? bodyLines : ['(empty page)']),
  ].join('\n');

  return { output };
}

// ── notion_create_task ────────────────────────────────────────────────────────
// Convenience wrapper. Delegates to createNotionPage with database hint
// "tasks", maps the task-shaped fields onto generic properties. Shares the
// 'create_notion_page' approval gate — no separate ActionType.
async function notionCreateTask(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const title = (input.title || '').trim();
  if (!title) return failureResult('title is required.', 'validation_error');

  const properties: Record<string, any> = {};

  // Most user task databases use a "Due", "Date", or "Deadline" date property —
  // create_notion_page's buildNotionDbProperties matches by name. We pass the
  // value under several common keys; only the one that matches the schema is
  // applied, the rest land in `skipped` (which we suppress for tasks).
  if (input.dueDate) {
    const v = String(input.dueDate);
    properties['Due'] = v;
    properties['Date'] = v;
    properties['Deadline'] = v;
  }

  if (input.priority) {
    properties['Priority'] = input.priority;
  }

  return createNotionPage(userId, {
    title,
    content: input.description || '',
    database: 'tasks',
    properties,
  }, context);
}

// ── notion_get_calendar_events ────────────────────────────────────────────────
// Read pages from a Notion database with a date property, filtered to a window.
// The merge-with-GCal job stays on the LLM — this tool just returns Notion-side
// rows; calendar_get_availability returns the GCal-side rows.
async function notionGetCalendarEvents(userId: string, input: any): Promise<ToolResult> {
  const startIso = (input.startDate || '').trim();
  const endIso = (input.endDate || '').trim();
  if (!startIso || !endIso) return failureResult('startDate and endDate (ISO 8601) are required.', 'validation_error');
  if (!Number.isFinite(Date.parse(startIso)) || !Number.isFinite(Date.parse(endIso))) {
    return failureResult('startDate and endDate must be valid ISO 8601 timestamps.', 'validation_error');
  }

  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected.', 'notion_not_connected');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  // 1) Resolve a database to read.
  //
  // "Notion Calendar" means different things to different users: a Notion
  // database with a Date property, the standalone Notion Calendar app (no
  // public API — unreadable here), or just a Google Calendar mirror. We can
  // only read the first kind. So: if an explicit hint matches a database, use
  // it; otherwise auto-discover ANY date-bearing database in the connected
  // workspace (Tasks / Roadmap / Schedule / etc.), not only ones literally
  // titled "calendar". And when nothing readable exists, we return a benign
  // empty result (success:true) — NOT a failure — because for the app-only
  // and Google-synced cases there is genuinely nothing to read, and surfacing
  // that as a red "failed" line in the report is misleading.
  let dbId = (input.databaseId || '').trim();
  const dbHint = (input.database || '').trim();
  let resolvedTitle = dbHint || 'Notion';

  // Pull candidate databases once: the hint (if any) first, then a generic
  // sweep so we can fall back to any date-bearing DB.
  const searchFor = async (query: string): Promise<any[]> => {
    try {
      const res = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          filter: { value: 'database', property: 'object' },
          page_size: 20,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch { return []; }
  };

  if (!dbId) {
    const titleOf = (r: any) => (r.title?.[0]?.plain_text ?? '').toLowerCase();
    let candidates: any[] = [];

    // a) If the caller gave a hint, try to match it by title first.
    if (dbHint) {
      const hintLower = dbHint.toLowerCase();
      const hitResults = await searchFor(dbHint);
      const best = hitResults
        .map((r: any) => ({ r, score: titleOf(r) === hintLower ? 2 : titleOf(r).includes(hintLower) ? 1 : 0 }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score > 0) { dbId = best.r.id; resolvedTitle = best.r.title?.[0]?.plain_text || dbHint; }
      candidates = hitResults;
    }

    // b) No title match → scan ANY database the integration can see and pick
    //    the first one that actually has a Date property. This is what makes
    //    "all of the above" work: a user's "Tasks" or "Roadmap" DB gets found
    //    even though it isn't named "calendar".
    if (!dbId) {
      if (!candidates.length) candidates = await searchFor('');
      for (const c of candidates) {
        const sch = await fetchNotionDbSchema(headers, c.id);
        if (sch?.some(p => p.type === 'date')) {
          dbId = c.id;
          resolvedTitle = c.title?.[0]?.plain_text || 'Notion';
          break;
        }
      }
    }
  }

  // No readable date-bearing database exists. That's the app-only / Google-
  // synced case — benign, not an error. Return empty so the LLM merges
  // nothing and the report shows a clean skip rather than a failure.
  if (!dbId) {
    return { output: `No Notion calendar source to read — no connected database has a date property. (The standalone Notion Calendar app has no public API; events there can't be read directly.)` };
  }

  // 2) Introspect schema to find the date property name.
  const schema = await fetchNotionDbSchema(headers, dbId);
  if (!schema) {
    // Couldn't read the schema — treat as nothing-to-merge, not a hard failure.
    return { output: `No Notion calendar entries readable from "${resolvedTitle}".` };
  }
  const dateProp = schema.find(p => p.type === 'date');
  if (!dateProp) {
    return { output: `No Notion calendar entries in "${resolvedTitle}" (no date property to treat as events).` };
  }
  const titleProp = schema.find(p => p.type === 'title');

  // 3) Query with a date filter (on_or_after start, on_or_before end)
  const queryBody = JSON.stringify({
    page_size: 50,
    filter: {
      and: [
        { property: dateProp.name, date: { on_or_after: startIso } },
        { property: dateProp.name, date: { on_or_before: endIso } },
      ],
    },
    sorts: [{ property: dateProp.name, direction: 'ascending' }],
  });
  const qRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers,
    body: queryBody,
    signal: AbortSignal.timeout(12000),
  });
  if (!qRes.ok) {
    const err = await qRes.text().catch(() => '');
    return failureResult(`Notion query failed (${qRes.status}): ${err.slice(0, 200)}`, 'upstream_notion');
  }
  const qData = await qRes.json();
  const rows: any[] = qData.results || [];
  if (!rows.length) {
    return { output: `No Notion calendar entries in "${resolvedTitle}" between ${startIso} and ${endIso}.` };
  }

  // 4) Render
  const peopleProp = schema.find(p => p.type === 'people');
  const lines = rows.map((row: any, i: number) => {
    const title = titleProp ? richTextToString(row.properties?.[titleProp.name]?.title || []) : '(no title)';
    const dateVal = row.properties?.[dateProp.name]?.date;
    const when = dateVal?.end ? `${dateVal.start} → ${dateVal.end}` : (dateVal?.start || '(no date)');
    const att = peopleProp ? (row.properties?.[peopleProp.name]?.people || []).map((p: any) => p.name || p.id).join(', ') : '';
    return `${i + 1}. ${title || '(untitled)'}\n   When: ${when}${att ? `\n   ${peopleProp!.name}: ${att}` : ''}\n   URL: ${row.url}`;
  });

  return {
    output: `${rows.length} Notion entr${rows.length === 1 ? 'y' : 'ies'} in "${resolvedTitle}" (date property: ${dateProp.name}):\n\n${lines.join('\n\n')}`,
  };
}

// Flatten one Notion property value to plain text. Covers the property types a
// lead/CRM database actually uses; unknown types fall through to ''.
function notionPropValueToString(prop: any): string {
  if (!prop || typeof prop !== 'object') return '';
  switch (prop.type) {
    case 'title':        return richTextToString(prop.title || []);
    case 'rich_text':    return richTextToString(prop.rich_text || []);
    case 'email':        return prop.email || '';
    case 'phone_number': return prop.phone_number || '';
    case 'url':          return prop.url || '';
    case 'number':       return prop.number != null ? String(prop.number) : '';
    case 'checkbox':     return prop.checkbox ? 'true' : 'false';
    case 'select':       return prop.select?.name || '';
    case 'status':       return prop.status?.name || '';
    case 'multi_select': return (prop.multi_select || []).map((o: any) => o.name).join(', ');
    case 'date':         return prop.date?.end ? `${prop.date.start} → ${prop.date.end}` : (prop.date?.start || '');
    case 'people':       return (prop.people || []).map((p: any) => p.name || p.id).join(', ');
    case 'created_time': return prop.created_time || '';
    case 'formula':      return prop.formula?.string ?? (prop.formula?.number != null ? String(prop.formula.number) : (prop.formula?.date?.start || ''));
    case 'rollup':       return Array.isArray(prop.rollup?.array) ? prop.rollup.array.map((x: any) => notionPropValueToString(x)).filter(Boolean).join(', ') : '';
    default:             return '';
  }
}

// Read the rows of a Notion database as flattened records. This is the general
// "read my table out of Notion" primitive — the leads/CRM reader the outreach
// intake needs. Same DB-resolution and query machinery as notionGetCalendarEvents,
// minus the date filter (reads every row up to `limit`).
async function notionReadDatabase(userId: string, input: any): Promise<ToolResult> {
  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected.', 'notion_not_connected');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  let dbId = (input.databaseId || '').trim();
  const dbHint = (input.database || '').trim();
  let resolvedTitle = dbHint || 'Notion database';

  // Resolve the database by title hint when no explicit id was given.
  if (!dbId) {
    if (!dbHint) return failureResult('Provide a database name (e.g. "Leads") or an exact databaseId.', 'validation_error');
    try {
      const res = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: dbHint, filter: { value: 'database', property: 'object' }, page_size: 20 }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        const titleOf = (r: any) => (r.title?.[0]?.plain_text ?? '').toLowerCase();
        const hintLower = dbHint.toLowerCase();
        const best = (data.results || [])
          .map((r: any) => ({ r, score: titleOf(r) === hintLower ? 2 : titleOf(r).includes(hintLower) ? 1 : 0 }))
          .sort((a: any, b: any) => b.score - a.score)[0];
        if (best && best.score > 0) { dbId = best.r.id; resolvedTitle = best.r.title?.[0]?.plain_text || dbHint; }
      }
    } catch { /* fall through to not-found */ }
  }
  if (!dbId) return failureResult(`No Notion database found matching "${dbHint}". Check the name, or open the database and share it with the Maily integration.`, 'notion_db_not_found');

  const schema = await fetchNotionDbSchema(headers, dbId);
  if (!schema) return failureResult(`Couldn't read the schema for "${resolvedTitle}". Make sure the database is shared with the Maily Notion integration.`, 'upstream_notion');

  // Query rows (no filter — read the whole table up to limit).
  const qRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ page_size: limit }),
    signal: AbortSignal.timeout(12000),
  });
  if (!qRes.ok) {
    const err = await qRes.text().catch(() => '');
    return failureResult(`Notion query failed (${qRes.status}): ${err.slice(0, 200)}`, 'upstream_notion');
  }
  const qData = await qRes.json();
  const rows: any[] = qData.results || [];
  if (!rows.length) return { output: `"${resolvedTitle}" has 0 rows.` };

  const propNames = schema.map(p => p.name);
  const lines = rows.map((row: any, i: number) => {
    const pairs = propNames
      .map(name => {
        const val = notionPropValueToString(row.properties?.[name]);
        return val ? `${name}: ${val}` : null;
      })
      .filter(Boolean);
    return `${i + 1}. ${pairs.join(' · ')}\n   URL: ${row.url}`;
  });

  const more = qData.has_more ? `\n\n(${resolvedTitle} has more than ${limit} rows — raise limit to read the rest.)` : '';
  return {
    output: `${rows.length} row${rows.length === 1 ? '' : 's'} from "${resolvedTitle}":\n\n${lines.join('\n\n')}${more}`,
  };
}

async function openCanvas(input: any, userId: string, context: ToolContext = {}): Promise<ToolResult> {
  if (!input.markdown?.trim()) {
    return failureResult('Error: open_canvas requires non-empty markdown content. Write the full document content and pass it in the markdown parameter, then call open_canvas again.', 'validation_error');
  }

  // Repair the model's formatting before ANYTHING else sees it. This
  // normalisation existed since PART 42 but ran only on plan-mode's final
  // text — canvas documents bypassed it entirely, which is why a Steps
  // section kept rendering as a wall of raw JSON in the panel long after the
  // bug was "fixed" for plans. The renderer only rich-renders a ```boult-steps
  // fence; an untagged or unfenced steps blob falls through as literal text.
  // Applied here (not at the emit site) so persistence, the panel, exports and
  // background-agent runs all get the same repaired document.
  input = { ...input, markdown: normalizeDocumentMarkdown(input.markdown) };
  const isAgentSpec = input.type === 'report' && (
    input.title?.toLowerCase().includes('agent') ||
    input.markdown?.toLowerCase().includes('agent objective') ||
    input.markdown?.toLowerCase().includes('cron')
  );

  // Persist last-known canvas content per conversation so update_canvas with
  // mode='append' can merge server-side next turn.
  if (context.conversationId) {
    await setCanvasState({
      conversationId: context.conversationId,
      userId,
      title: input.title,
      type: input.type || 'notes',
      markdown: input.markdown,
    });
  }

  return {
    output: isAgentSpec
      ? `Canvas opened: "${input.title}". The specification is now visible to the user. IMPORTANT: You must now immediately call create_scheduled_agent to register this agent in the system. The agent is NOT yet created — open_canvas only displayed the spec.`
      : `Canvas opened: "${input.title}"`,
    canvasData: {
      title: input.title,
      type: input.type || 'notes',
      markdown: input.markdown,
      draftMeta: input.draftMeta,
    },
  };
}

async function updateCanvas(input: any, userId: string, context: ToolContext = {}): Promise<ToolResult> {
  if (!input.markdown?.trim()) {
    return failureResult('Error: update_canvas requires non-empty markdown content.', 'validation_error');
  }
  // Same repair as open_canvas — an edit that reintroduces raw-JSON steps is
  // just as broken as an initial write that does.
  input = { ...input, markdown: normalizeDocumentMarkdown(input.markdown) };
  const mode = input.mode === 'append' ? 'append' : 'replace';

  let finalMarkdown = input.markdown;
  let finalTitle = input.title;
  let finalType = input.type || 'notes';
  let appendFellBack = false;

  if (mode === 'append') {
    if (!context.conversationId) {
      // No conversation context (background-agent runs) — append degrades to
      // replace because there's no canonical "previous canvas" to merge with.
      appendFellBack = true;
    } else {
      const prev = await getCanvasState(context.conversationId);
      if (prev && prev.markdown) {
        // Preserve the existing title/type when the caller didn't specify
        finalTitle = input.title || prev.title || finalTitle;
        finalType = input.type || prev.type || finalType;
        finalMarkdown = `${prev.markdown.trimEnd()}\n\n${input.markdown.trimStart()}`;
      } else {
        // No prior state — first call after server restart, or open_canvas
        // never ran. Treat the call as a replace.
        appendFellBack = true;
      }
    }
  }

  if (context.conversationId) {
    await setCanvasState({
      conversationId: context.conversationId,
      userId,
      title: finalTitle,
      type: finalType,
      markdown: finalMarkdown,
    });
  }

  const note = appendFellBack
    ? ' (append fell back to replace — no prior canvas state for this conversation)'
    : mode === 'append' ? ' (appended)' : '';
  return {
    output: `Canvas updated: "${finalTitle}"${note}`,
    canvasData: {
      title: finalTitle,
      type: finalType,
      markdown: finalMarkdown,
      isUpdate: true,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1: Follow-up Radar
// ══════════════════════════════════════════════════════════════════════════════

async function checkFollowups(userId: string, input: any): Promise<ToolResult> {
  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  const days = Math.min(input.days || 7, 21);
  const maxCheck = Math.min(input.maxResults || 15, 20);
  const sentQuery = `in:sent newer_than:${days}d`;
  const sentUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(sentQuery)}&maxResults=${maxCheck}`;

  let sentRes = await googleFetch(userId, 'gmail', sentUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (sentRes.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) { token = newToken; sentRes = await googleFetch(userId, 'gmail', sentUrl, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!sentRes.ok) return gmailHttpFailure(sentRes, 'Could not check sent mail');

  const sentData = await sentRes.json();
  const sentMessages: any[] = sentData.messages || [];
  if (!sentMessages.length) return { output: `No sent emails in the last ${days} days.` };

  type FollowUp = { subject: string; to: string; sentDate: string; daysWaiting: number; threadId: string };
  const awaiting: FollowUp[] = [];
  const seenThreads = new Set<string>();

  for (const { id } of sentMessages.slice(0, maxCheck)) {
    try {
      const msgRes = await googleFetch(userId, 'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();
      const { threadId } = msg;
      if (seenThreads.has(threadId)) continue;
      seenThreads.add(threadId);

      const h = msg.payload?.headers || [];
      const to = getHeader(h, 'To');
      const subject = getHeader(h, 'Subject');
      const dateStr = getHeader(h, 'Date');
      const sentMs = new Date(dateStr).getTime() || Date.now();
      const daysWaiting = Math.round((Date.now() - sentMs) / 86400000);
      if (daysWaiting < 1) continue;

      // Check if thread has any replies from external senders after our send
      const threadRes = await googleFetch(userId, 'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!threadRes.ok) continue;
      const thread = await threadRes.json();
      const msgs: any[] = thread.messages || [];

      const hasReply = msgs.some((m: any) => {
        if (m.id === id) return false;
        const from = (getHeader(m.payload?.headers || [], 'From') || '').toLowerCase();
        const internalDate = parseInt(m.internalDate || '0');
        return internalDate > sentMs && !from.includes(normalizeUserId(userId));
      });

      if (!hasReply && subject && to) {
        awaiting.push({ subject, to, sentDate: dateStr, daysWaiting, threadId });
      }
    } catch { continue; }
  }

  if (!awaiting.length) return { output: `All your recent sent emails have received replies. Inbox is clear — no follow-ups needed.` };

  const sorted = awaiting.sort((a, b) => b.daysWaiting - a.daysWaiting);
  const lines = sorted.map((f, i) =>
    `${i + 1}. **${f.subject}**\n   To: ${f.to}\n   Sent: ${f.sentDate}\n   Waiting: ${f.daysWaiting} day${f.daysWaiting !== 1 ? 's' : ''} with no reply\n   Thread: ${f.threadId}`
  );
  return { output: `${sorted.length} thread${sorted.length !== 1 ? 's' : ''} awaiting reply:\n\n${lines.join('\n\n')}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2: Recipient Context (cross-app intelligence before every draft)
// ══════════════════════════════════════════════════════════════════════════════

async function getRecipientContext(userId: string, input: any): Promise<ToolResult> {
  const recipientEmail: string = (input.email || '').trim();
  const recipientName: string = input.name || recipientEmail.split('@')[0];
  if (!recipientEmail) return failureResult('Recipient email is required.', 'validation_error');

  const parts: string[] = [];

  // 1. Google Calendar — upcoming events with this person
  try {
    // Was getGmailToken ("same Google OAuth token") — true for our own OAuth
    // client, but under Composio Gmail and Calendar are SEPARATE connected
    // accounts, so a calendar call must resolve the calendar one.
    const calToken = await getGcalToken(userId);
    if (calToken) {
      const now = new Date().toISOString();
      const future = new Date(Date.now() + 30 * 86400000).toISOString();
      const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(future)}&q=${encodeURIComponent(recipientEmail)}&maxResults=5&singleEvents=true&orderBy=startTime`;
      const calRes = await googleFetch(userId, 'gcal', calUrl, { headers: { Authorization: `Bearer ${calToken}` } });
      if (calRes.ok) {
        const calData = await calRes.json();
        const events: any[] = calData.items || [];
        if (events.length) {
          const evLines = events.map((e: any) => {
            const start = e.start?.dateTime || e.start?.date || '';
            const d = new Date(start);
            return `  - "${e.summary}" on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
          });
          parts.push(`**Upcoming meetings with ${recipientName}:**\n${evLines.join('\n')}`);
        } else {
          parts.push(`**Calendar:** No upcoming meetings with ${recipientName} in the next 30 days.`);
        }
      }
    }
  } catch { /* non-fatal */ }

  // 2. Notion — notes/pages about this person
  try {
    const supabase = getSupabaseAdmin();
    const { data: notionInteg } = await supabase
      .from('boult_integrations')
      .select('access_token')
      .eq('user_id', userId)
      .in('provider', ['notion', 'notion_calendar'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (notionInteg?.access_token) {
      const notionToken = decrypt(notionInteg.access_token);
      const searchRes = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: recipientName, page_size: 3 }),
        signal: AbortSignal.timeout(8000),
      });
      if (searchRes.ok) {
        const notionData = await searchRes.json();
        const pages: any[] = notionData.results || [];
        if (pages.length) {
          const titles = pages.map((p: any) => {
            const tp = p.properties?.title || p.properties?.Name;
            const t = tp?.title?.[0]?.plain_text || tp?.rich_text?.[0]?.plain_text || 'Untitled';
            return `  - ${t}`;
          });
          parts.push(`**Notion notes about ${recipientName}:**\n${titles.join('\n')}`);
        }
      }
    }
  } catch { /* non-fatal */ }

  // 3. Relationship memory
  try {
    const supabase = getSupabaseAdmin();
    const { data: contact } = await supabase
      .from('boult_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_email', recipientEmail.toLowerCase())
      .maybeSingle();
    if (contact) {
      const memParts = [
        contact.notes ? `Notes: ${contact.notes}` : null,
        contact.email_count ? `Emails exchanged: ${contact.email_count}` : null,
        contact.last_contact_at ? `Last contact: ${new Date(contact.last_contact_at).toLocaleDateString()}` : null,
        contact.tags?.length ? `Tags: ${contact.tags.join(', ')}` : null,
      ].filter(Boolean);
      if (memParts.length) {
        parts.push(`**Relationship memory:**\n${memParts.map(p => `  - ${p}`).join('\n')}`);
      }
    }
  } catch { /* table may not exist yet */ }

  if (!parts.length) return { output: `No context found for ${recipientEmail}. No upcoming meetings, Notion notes, or relationship memory. Proceed with drafting.` };
  return { output: `Context for ${recipientName} <${recipientEmail}>:\n\n${parts.join('\n\n')}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 3: Voice Profile Auto-Learning (fire-and-forget after every send)
// ══════════════════════════════════════════════════════════════════════════════

function learnFromSentEmail(userId: string, body: string, subject: string): void {
  (async () => {
    try {
      const lines = body.split('\n').filter((l: string) => l.trim());
      const greeting = lines[0]?.trim().slice(0, 60) || '';
      const signoff = [...lines].reverse().find((l: string) =>
        l.trim().length < 35 && /^(thanks|best|cheers|regards|warm|sincerely|kind|take care|talk soon|looking forward)/i.test(l.trim())
      ) || '';
      const sentences = body.split(/[.!?]+/).filter((s: string) => s.trim().split(/\s+/).length > 3);
      const avgWords = sentences.length
        ? Math.round(sentences.reduce((acc: number, s: string) => acc + s.trim().split(/\s+/).length, 0) / sentences.length)
        : 12;
      const hasCasual = /\b(hey|hi there|thanks!|sounds good|cool|awesome|yep|nope)\b/i.test(body);
      const hasFormal = /\b(dear|kindly|herewith|please find|enclosed|pursuant)\b/i.test(body);
      const formality = hasFormal ? 'formal' : hasCasual ? 'casual' : 'semi-formal';

      const supabase = getSupabaseAdmin();
      const { data: existing } = await supabase
        .from('user_voice_profiles')
        .select('voice_profile')
        .eq('user_id', normalizeUserId(userId))
        .maybeSingle();

      const prev = (existing?.voice_profile as any) || {};
      const prevCount = prev.email_count || 0;

      // Blend new signals (weighted average — recent emails count more)
      const blended = {
        ...prev,
        greeting_patterns: {
          ...(prev.greeting_patterns || {}),
          preferred_greetings: greeting
            ? [...new Set([greeting, ...(prev.greeting_patterns?.preferred_greetings || [])]).values()].slice(0, 5)
            : (prev.greeting_patterns?.preferred_greetings || []),
        },
        closing_patterns: {
          ...(prev.closing_patterns || {}),
          preferred_closings: signoff
            ? [...new Set([signoff, ...(prev.closing_patterns?.preferred_closings || [])]).values()].slice(0, 5)
            : (prev.closing_patterns?.preferred_closings || []),
        },
        language_patterns: {
          ...(prev.language_patterns || {}),
          avg_length: prevCount > 0
            ? Math.round((((prev.language_patterns?.avg_length || avgWords) * prevCount) + avgWords) / (prevCount + 1))
            : avgWords,
          inferred_formality: formality,
        },
        email_count: prevCount + 1,
        learning: { autoImprove: true, lastAnalysis: new Date().toISOString() },
        status: 'learned',
      };

      await supabase.from('user_voice_profiles').upsert(
        { user_id: normalizeUserId(userId), voice_profile: blended, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    } catch { /* completely non-fatal */ }
  })();
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 4: Relationship Memory
// ══════════════════════════════════════════════════════════════════════════════

// Silent contact upsert — called automatically on send/draft
function touchContact(userId: string, email: string, name: string): void {
  (async () => {
    try {
      const supabase = getSupabaseAdmin();
      const { data: existing } = await supabase
        .from('boult_contacts')
        .select('email_count, contact_name')
        .eq('user_id', userId)
        .eq('contact_email', email.toLowerCase())
        .maybeSingle();

      await supabase.from('boult_contacts').upsert({
        user_id: userId,
        contact_email: email.toLowerCase(),
        contact_name: existing?.contact_name || name || email.split('@')[0],
        last_contact_at: new Date().toISOString(),
        email_count: (existing?.email_count || 0) + 1,
      }, { onConflict: 'user_id,contact_email' });
    } catch { /* table may not exist — non-fatal */ }
  })();
}

async function getContactContext(userId: string, input: any): Promise<ToolResult> {
  const email = (input.email || '').toLowerCase().trim();
  if (!email) return failureResult('Email address required.', 'validation_error');

  // Superagent depth: understand a contact from THREE sources in parallel —
  // stored relationship memory, live email history, and saved facts — so the
  // agent always has real context even when the contacts table is empty.
  const [stored, history, facts] = await Promise.all([
    (async () => {
      try {
        const supabase = getSupabaseAdmin();
        const { data } = await supabase
          .from('boult_contacts')
          .select('*')
          .eq('user_id', userId)
          .eq('contact_email', email)
          .maybeSingle();
        if (!data) return '';
        return [
          `**Contact:** ${data.contact_name || email}`,
          data.last_contact_at ? `**Last contact:** ${new Date(data.last_contact_at).toLocaleDateString()}` : null,
          data.email_count ? `**Emails exchanged:** ${data.email_count}` : null,
          data.notes ? `**Notes:** ${data.notes}` : null,
          data.tags?.length ? `**Tags:** ${data.tags.join(', ')}` : null,
        ].filter(Boolean).join('\n');
      } catch { return ''; }
    })(),
    (async () => {
      try {
        const recent = await searchGmail(userId, { query: `from:${email} OR to:${email}`, maxResults: 8 });
        if (recent.success === false || /No emails found/i.test(recent.output)) return '';
        return `**Recent email history:**\n${recent.output}`;
      } catch { return ''; }
    })(),
    (async () => {
      try {
        const { searchMemoriesRaw } = await import('./memory');
        const mem = await searchMemoriesRaw(userId, email, 5);
        if (!mem.length) return '';
        return `**What I remember about them:**\n${mem.map((i: any) => `- ${i.text}`).join('\n')}`;
      } catch { return ''; }
    })(),
  ]);

  const sections = [stored, history, facts].filter(Boolean);
  if (!sections.length) return { output: `No stored memory or recent email history found for ${email}. They appear to be a new contact.` };
  return { output: `Contact context for ${email}:\n\n${sections.join('\n\n')}` };
}

async function rememberAboutContact(userId: string, input: any): Promise<ToolResult> {
  const email = (input.email || '').toLowerCase();
  if (!email) return failureResult('Email address required.', 'validation_error');

  try {
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from('boult_contacts')
      .select('notes, tags')
      .eq('user_id', userId)
      .eq('contact_email', email)
      .maybeSingle();

    // Append note to existing notes
    const prevNotes = existing?.notes || '';
    const newNotes = prevNotes
      ? `${prevNotes}\n[${new Date().toLocaleDateString()}] ${input.note}`
      : `[${new Date().toLocaleDateString()}] ${input.note}`;

    const prevTags: string[] = existing?.tags || [];
    const newTags = input.tags ? [...new Set([...prevTags, ...input.tags])] : prevTags;

    const { error } = await supabase.from('boult_contacts').upsert({
      user_id: userId,
      contact_email: email,
      contact_name: input.name || undefined,
      notes: newNotes,
      tags: newTags,
      last_contact_at: new Date().toISOString(),
    }, { onConflict: 'user_id,contact_email' });

    if (error) throw error;
    return { output: `Saved to relationship memory for ${input.name || email}: "${input.note}"` };
  } catch (err: any) {
    return failureResult(`Could not save contact note: ${err.message}`, 'contact_save_failed');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Supermemory tool wrappers — expose memory_search / memory_save /
// memory_get_contact_profile as first-class tools the LLM can invoke. The chat
// route already pre-fetches relevant memories every turn into the prompt;
// these tools are for explicit reads/writes (auditing memory, saving facts on
// demand, building a contact dossier).
// ══════════════════════════════════════════════════════════════════════════════

async function memorySearchTool(userId: string, input: any): Promise<ToolResult> {
  const query = (input?.query || '').trim();
  if (!query) return failureResult('query is required.', 'validation_error');
  const limit = Math.max(1, Math.min(20, Number(input?.limit) || 8));

  // @ts-ignore — JS module path
  const { searchMemoriesRaw } = await import('./memory');
  // The memory module returns [] when SUPERMEMORY_API_KEY is missing — same as
  // "no memories found" from the LLM's POV, but we surface the distinction so
  // the user can be told to configure the key.
  if (!process.env.SUPERMEMORY_API_KEY && !process.env.DATAFAST_API_KEY) {
    return failureResult('Supermemory is not configured — SUPERMEMORY_API_KEY env var missing.', 'memory_unavailable');
  }

  const items = await searchMemoriesRaw(userId, query, limit);
  if (!items.length) return { output: `No memories found for "${query}".` };

  const lines = items.map((m: any, i: number) => {
    const meta: string[] = [];
    if (m.id) meta.push(`id: ${m.id}`);
    if (typeof m.score === 'number') meta.push(`score: ${m.score.toFixed(2)}`);
    if (m.timestamp) meta.push(`when: ${m.timestamp}`);
    if (m.tags?.length) meta.push(`tags: ${m.tags.join(',')}`);
    const metaStr = meta.length ? `  [${meta.join('  ')}]` : '';
    return `${i + 1}. ${m.text}${metaStr}`;
  });
  return { output: `${items.length} memor${items.length === 1 ? 'y' : 'ies'} for "${query}":\n\n${lines.join('\n\n')}` };
}

async function memorySaveTool(userId: string, input: any): Promise<ToolResult> {
  const content = (input?.content || '').trim();
  if (!content) return failureResult('content is required.', 'validation_error');
  if (!process.env.SUPERMEMORY_API_KEY && !process.env.DATAFAST_API_KEY) {
    return failureResult('Supermemory is not configured — SUPERMEMORY_API_KEY env var missing.', 'memory_unavailable');
  }
  const tags = Array.isArray(input?.tags) ? input.tags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim()) : [];

  // @ts-ignore — JS module path
  const { saveMemory } = await import('./memory');
  await saveMemory(userId, content, tags.length ? tags : undefined);
  return {
    output: `Saved to memory: "${content.slice(0, 100)}${content.length > 100 ? '…' : ''}"${tags.length ? ` (tags: ${tags.join(', ')})` : ''}`,
  };
}

async function updateUserModelTool(userId: string, input: any): Promise<ToolResult> {
  // Accept only the known model fields; ignore stray keys the model might add.
  const patch: any = {};
  for (const k of ['business_type', 'decision_style', 'communication_style', 'risk_tolerance']) {
    if (typeof input?.[k] === 'string' && input[k].trim()) patch[k] = input[k].trim();
  }
  for (const k of ['values', 'work_patterns', 'pain_points', 'opportunities']) {
    if (Array.isArray(input?.[k])) patch[k] = input[k].filter((x: any) => typeof x === 'string' && x.trim());
  }
  if (input?.relationships && typeof input.relationships === 'object') {
    patch.relationships = {};
    for (const tier of ['vip', 'trusted', 'transactional']) {
      if (Array.isArray(input.relationships[tier])) patch.relationships[tier] = input.relationships[tier].filter((x: any) => typeof x === 'string' && x.trim());
    }
  }
  if (input?.decision_types && typeof input.decision_types === 'object') {
    patch.decision_types = {};
    for (const tier of ['strategic', 'tactical', 'routine']) {
      if (Array.isArray(input.decision_types[tier])) patch.decision_types[tier] = input.decision_types[tier].filter((x: any) => typeof x === 'string' && x.trim());
    }
  }

  if (Object.keys(patch).length === 0) {
    return failureResult('Nothing to update — pass at least one model field (business_type, values, relationships, decision_types, etc.).', 'validation_error');
  }

  const { updateUserModel } = await import('./user-model');
  const res = await updateUserModel(userId, patch);
  if (!res.ok) {
    return failureResult('Could not update the user model (the boult_user_model table may not be migrated yet).', 'user_model_unavailable');
  }
  return {
    output: `Updated my model of the user. Current understanding:\n${res.summary}`,
  };
}

async function memoryGetContactProfile(userId: string, input: any): Promise<ToolResult> {
  const email = (input?.contactEmail || '').trim().toLowerCase();
  const name = (input?.name || '').trim();
  if (!email) return failureResult('contactEmail is required.', 'validation_error');

  const sections: string[] = [];

  // 1) Persisted relationship row from boult_contacts (best-effort; the
  // migration may not be applied yet)
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_email', email)
      .maybeSingle();
    if (data) {
      const row = [
        `**Relationship row**`,
        `Contact: ${data.contact_name || email}`,
        data.last_contact_at ? `Last contact: ${new Date(data.last_contact_at).toLocaleDateString()}` : null,
        data.email_count ? `Emails exchanged: ${data.email_count}` : null,
        data.notes ? `Notes: ${data.notes}` : null,
        data.tags?.length ? `Tags: ${data.tags.join(', ')}` : null,
      ].filter(Boolean).join('\n');
      sections.push(row);
    }
  } catch { /* table may not exist — non-fatal */ }

  // 2) Supermemory items mentioning the email or display name
  if (process.env.SUPERMEMORY_API_KEY || process.env.DATAFAST_API_KEY) {
    try {
      // @ts-ignore — JS module path
      const { searchMemoriesRaw } = await import('./memory');
      const queries = [email];
      if (name) queries.push(name);
      const all: any[] = [];
      for (const q of queries) {
        const items = await searchMemoriesRaw(userId, q, 6);
        for (const item of items) {
          if (!all.some((a) => a.text === item.text)) all.push(item);
        }
      }
      if (all.length) {
        const lines = all.slice(0, 10).map((m: any, i: number) => {
          const ts = m.timestamp ? `  (${m.timestamp})` : '';
          return `  ${i + 1}. ${m.text}${ts}`;
        });
        sections.push(`**Supermemory items mentioning ${name || email}**\n${lines.join('\n')}`);
      }
    } catch { /* non-fatal */ }
  }

  if (!sections.length) {
    return { output: `No history exists for ${email}.` };
  }
  return { output: sections.join('\n\n') };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 6: Delegation Rules
// ══════════════════════════════════════════════════════════════════════════════

async function getDelegationRules(userId: string): Promise<ToolResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('boult_delegation_rules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (!data?.length) return { output: 'No delegation rules set up yet. Use create_delegation_rule to add one.' };

    const lines = data.map((r: any, i: number) =>
      `${i + 1}. **${r.name}** [${r.action_type}]\n   Triggers: ${r.trigger_keywords?.join(', ') || 'any email'}${r.trigger_from ? ` · From: ${r.trigger_from}` : ''}`
    );
    return { output: `${data.length} active delegation rule${data.length !== 1 ? 's' : ''}:\n\n${lines.join('\n\n')}` };
  } catch {
    return failureResult('Could not read delegation rules. If this persists, ensure the migration supabase/migrations/boult_contacts_and_rules.sql has been applied (it creates boult_delegation_rules).', 'delegation_read_failed');
  }
}

async function createDelegationRule(userId: string, input: any): Promise<ToolResult> {
  if (!input.name || !input.action_type) return failureResult('Rule name and action_type are required.', 'validation_error');

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('boult_delegation_rules').insert({
      user_id: userId,
      name: input.name,
      trigger_keywords: input.trigger_keywords || [],
      trigger_from: input.trigger_from || null,
      action_type: input.action_type,
      action_config: input.action_config || {},
      is_active: true,
    });
    if (error) throw error;
    return { output: `Delegation rule "${input.name}" created. Boult will now automatically ${input.action_type} when triggered.` };
  } catch (err: any) {
    return failureResult(`Could not create rule: ${err.message}`, 'rule_save_failed');
  }
}

async function webSearch(input: any): Promise<ToolResult> {
  const query = input.query;
  const max = Math.min(input.maxResults || 6, 10);

  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes('maily')) {
    return {
      output: `Web search results for "${query}":

Maily is an advanced, AI-powered email intelligence and productivity platform built for founders, consultants, and busy professionals who value time and clarity. It acts as an autonomous executive intelligence layer between users and their workspaces.

Core Features:
1. Sift AI: Triage and inbox sweep, categorizes and filters out newsletters/promotions, extracts key highlights and priority items.
2. Boult AI: An autonomous executive assistant capable of analyzing threads, executing workflows, managing calendars, and managing Notion/Slack integrations.
3. Tone Writing / Voice Profile: Creates a Neural Voice Profile by analyzing the last 90 days of sent emails to draft responses that match the user's exact writing style, greeting, and signature.
4. Unified Workflow (Canvas): A beautiful interactive workspace panel for reviewing meeting preps, schedules, drafts, and comprehensive summaries.
5. Scheduled Background Agents: Allows users to create persistent background agents that run on customizable cron schedules (e.g., "sweep my inbox every morning at 7am and draft replies to client emails").
6. Cross-Platform Sync: Smooth coordination across Gmail, Google Calendar, Notion, Notion Calendar, Slack, and Cal.com.
7. Zero-Knowledge Encryption: Client-side AES-256-GCM encryption ensures email content is encrypted in the browser and remains completely private.

Pricing Plans (No free tier exists):
• Monthly Plan: $29/month. Includes unlimited AI Drafts, Sift Analysis, Boult queries, background agents, scheduling, and a Gold Founder Badge.
• Annual Plan: $16.58/month ($199 billed annually). Saves 40% (2 months free). Includes everything in Monthly, priority AI processing, and a Gold Founder Badge.
• Lifetime Founder Plan: $499 one-time payment. Pay once, own forever. Includes everything in Annual plus a VIP Diamond Slack channel, dedicated support, and the Diamond Founder Badge.

Founder & Team:
• Maily is a free, open source project. Follow at @Mailycfd on X or github.com/maily-cfd/Maily. Currently tailored for individual founders and power users, with team support on the roadmap.`
    };
  }

  const fmt = (items: string[]) =>
    `Web search results for "${query}":\n\n${items.join('\n\n')}`;

  // Layer 1: Serper.dev — Google-quality results (requires SERPER_API_KEY)
  if (process.env.SERPER_API_KEY) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: max }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const items: string[] = [];
        if (data.answerBox?.answer) items.push(`**Answer:** ${data.answerBox.answer}`);
        for (const r of (data.organic || []).slice(0, max)) {
          items.push(`**${r.title}**\n${r.snippet}\n${r.link}`);
        }
        if (items.length) return { output: fmt(items) };
      }
    } catch { /* fallthrough */ }
  }

  // Layer 2: Brave Search API (requires BRAVE_SEARCH_API_KEY)
  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const params = new URLSearchParams({ q: query, count: String(max) });
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const items: string[] = [];
        for (const r of (data.web?.results || []).slice(0, max)) {
          items.push(`**${r.title}**\n${r.description}\n${r.url}`);
        }
        if (items.length) return { output: fmt(items) };
      }
    } catch { /* fallthrough */ }
  }

  // Layer 3: DuckDuckGo HTML search — parse real result snippets
  try {
    const params = new URLSearchParams({ q: query, kl: 'us-en' });
    const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Boult/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const html = await res.text();
      const items: string[] = [];
      // Extract result titles and snippets via regex
      const blocks = [...html.matchAll(/class="result__body"[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
      const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)];
      const urls = [...html.matchAll(/class="result__url"[^>]*>([\s\S]*?)<\/span>/g)];
      const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
      for (let i = 0; i < Math.min(max, titles.length); i++) {
        const title = strip(titles[i]?.[1] ?? '');
        const snippet = strip(blocks[i]?.[1] ?? '');
        const url = strip(urls[i]?.[1] ?? '');
        if (title) items.push([title, snippet, url].filter(Boolean).join('\n'));
      }
      if (items.length) return { output: fmt(items) };
    }
  } catch { /* fallthrough */ }

  // Layer 4: DuckDuckGo Instant Answer (last resort — knowledge base only)
  try {
    const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
    const res = await fetch(`https://api.duckduckgo.com/?${params}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const items: string[] = [];
      if (data.AbstractText) items.push(`**Summary:** ${data.AbstractText.slice(0, 600)}`);
      for (const t of (data.RelatedTopics as any[] || []).slice(0, max)) {
        if (t.Text) items.push(`• ${t.Text.slice(0, 300)}`);
      }
      if (items.length) return { output: fmt(items) };
    }
  } catch { /* fallthrough */ }

  return failureResult(`Web search for "${query}": All search providers are temporarily unavailable. Try rephrasing the query or breaking it into a more specific term.`, 'web_search_unavailable');
}

// ── web_search_instant ────────────────────────────────────────────────────────
// Thin DuckDuckGo Instant Answer client. No fallbacks, no web crawl — when DDG
// has no instant answer this returns success:false so the LLM can fall back to
// web_search if it wants live web results.
async function webSearchInstant(input: any): Promise<ToolResult> {
  const query = (input?.query || '').trim();
  if (!query) return failureResult('query is required.', 'validation_error');

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });
    const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return failureResult(`DuckDuckGo Instant returned ${res.status}.`, 'web_search_unavailable');
    }
    const data = await res.json();

    const summary = (data.AbstractText || '').slice(0, 1200);
    const sourceUrl = data.AbstractURL || '';
    const related: string[] = ((data.RelatedTopics as any[]) || [])
      .filter((t) => t && typeof t.Text === 'string')
      .slice(0, 8)
      .map((t) => `  • ${t.Text.slice(0, 300)}${t.FirstURL ? ` — ${t.FirstURL}` : ''}`);

    if (!summary && !related.length) {
      return failureResult(
        `DuckDuckGo Instant has no answer for "${query}" — its knowledge base is limited. Try web_search for live web results.`,
        'web_search_unavailable',
      );
    }

    const lines: string[] = [`Instant answer for "${query}":`];
    if (summary) lines.push('', summary);
    if (sourceUrl) lines.push('', `Source: ${sourceUrl}`);
    if (related.length) lines.push('', 'Related topics:', ...related);
    lines.push('', 'Note: this is a knowledge-base summary, not a live page crawl. For deeper research, use web_search.');

    return { output: lines.join('\n') };
  } catch (err: any) {
    return failureResult(
      `DuckDuckGo Instant failed: ${err.message || 'unknown error'}.`,
      'web_search_unavailable',
    );
  }
}

async function sendSlackMessage(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  if (context.conversationId) {
    const targetKey = normalizeTargetKey('send_slack_message', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'send_slack_message',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to post to Slack. No approved request_confirmation found for posting to ${input.channel || 'this channel'}. Call request_confirmation first with details { Channel: "${input.channel || ''}" }, wait for the user to click Confirm, then retry.`,
        'confirmation_required',
      );
    }
  }

  {
    const gate = await applyAutonomyGate({ userId, action: 'send_slack_message', toolName: 'send_slack_message', input, context, verb: 'post' });
    if (gate.handled) return gate.result!;
  }

  const token = await getSlackToken(userId);
  if (!token) return failureResult('Slack is not connected. Ask the user to connect Slack in Settings → Integrations.', 'slack_not_connected');

  // Get DM channel with the user themselves for "dm" target
  let channelId = input.channel;
  if (input.channel === 'dm' || input.channel === 'self') {
    try {
      const identityRes = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const identity = await identityRes.json();
      if (identity.ok && identity.user_id) {
        const dmRes = await fetch('https://slack.com/api/conversations.open', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ users: identity.user_id }),
        });
        const dmData = await dmRes.json();
        if (dmData.ok) channelId = dmData.channel.id;
      }
    } catch { /* fallthrough */ }
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, text: input.text, mrkdwn: true }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return failureResult(`Slack message failed (${res.status}).`, 'upstream_slack');
  const data = await res.json();
  if (!data.ok) return failureResult(`Slack error: ${data.error}`, 'upstream_slack');
  return { output: `Slack message sent to ${input.channel} ✅` };
}

// ── slack_find_user ───────────────────────────────────────────────────────────
// Email path uses users.lookupByEmail (exact, fast). Name path uses users.list
// and filters client-side — Slack has no native name search.
async function slackFindUser(userId: string, input: any): Promise<ToolResult> {
  const email = (input?.email || '').trim();
  const name = (input?.name || '').trim();
  if (!email && !name) return failureResult('email or name is required.', 'validation_error');

  const token = await getSlackToken(userId);
  if (!token) return failureResult('Slack is not connected.', 'slack_not_connected');

  // Path A: email — exact lookup
  if (email) {
    const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return failureResult(`Slack lookup failed (${res.status}).`, 'upstream_slack');
    const data = await res.json();
    if (data.ok && data.user) {
      const u = data.user;
      return {
        output: `User: ${u.profile?.real_name || u.real_name || u.name}  id: ${u.id}  email: ${u.profile?.email || email}`,
      };
    }
    if (data.error === 'users_not_found') {
      return failureResult(`No Slack user with email ${email}.`, 'user_not_found');
    }
    return failureResult(`Slack lookup error: ${data.error || 'unknown'}.`, 'upstream_slack');
  }

  // Path B: name — paginate users.list, score by name substring
  const matches: Array<{ id: string; name: string; email: string; score: number }> = [];
  const nameLower = name.toLowerCase();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return failureResult(`Slack users.list failed (${res.status}).`, 'upstream_slack');
    const data = await res.json();
    if (!data.ok) return failureResult(`Slack error: ${data.error || 'unknown'}.`, 'upstream_slack');
    for (const u of (data.members || []) as any[]) {
      if (u.deleted || u.is_bot) continue;
      const dn = (u.profile?.display_name || '').toLowerCase();
      const rn = (u.profile?.real_name || u.real_name || '').toLowerCase();
      const un = (u.name || '').toLowerCase();
      const hay = `${dn} ${rn} ${un}`;
      const idx = hay.indexOf(nameLower);
      if (idx >= 0) {
        matches.push({
          id: u.id,
          name: u.profile?.real_name || u.real_name || u.name,
          email: u.profile?.email || '',
          score: dn === nameLower ? 3 : rn === nameLower ? 3 : idx,
        });
      }
    }
    cursor = data.response_metadata?.next_cursor || '';
    pages++;
  } while (cursor && pages < 5); // hard cap: 1000 users scanned

  if (!matches.length) return failureResult(`No Slack user matching "${name}".`, 'user_not_found');

  matches.sort((a, b) => (a.score === b.score ? a.name.localeCompare(b.name) : a.score - b.score));
  const top = matches.slice(0, 5);
  if (top.length === 1) {
    const m = top[0];
    return { output: `User: ${m.name}  id: ${m.id}${m.email ? `  email: ${m.email}` : ''}` };
  }
  const lines = top.map((m, i) => `${i + 1}. ${m.name}  id: ${m.id}${m.email ? `  email: ${m.email}` : ''}`);
  return { output: `${top.length} matches for "${name}":\n${lines.join('\n')}\n\nPick the right id and pass it as userId to slack_send_dm.` };
}

// ── slack_send_dm ─────────────────────────────────────────────────────────────
// Opens (or reuses) the DM channel with the target user, then posts. Gated
// by its own ApprovalActionType so the gate match key is the userId, not a
// channel name.
async function slackSendDm(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const targetUserId = (input?.userId || '').trim();
  const text = (input?.text || '').trim();
  if (!targetUserId) return failureResult('userId is required (use slack_find_user to resolve).', 'validation_error');
  if (!text) return failureResult('text is required.', 'validation_error');

  // FIX 1 — State machine gate (belt-and-braces, see sendEmail).
  if (!context.isBackgroundAgent && context.runState && context.runState !== 'EXECUTING' && context.runState !== 'REPORTING') {
    return failureResult(
      `Refusing to send Slack DM — current state is ${context.runState}. Call request_confirmation first with action "Send Slack DM" and details { User: "${targetUserId}" }, wait for the user to click Confirm (state will become EXECUTING), then retry slack_send_dm.`,
      'confirmation_required',
    );
  }

  if (context.conversationId) {
    const targetKey = normalizeTargetKey('send_slack_dm', input);
    const { approved, failedOpen } = await consumeApproval({
      conversationId: context.conversationId,
      userId,
      actionType: 'send_slack_dm',
      targetKey,
      isBackgroundAgent: context.isBackgroundAgent,
    });
    if (!approved && !failedOpen) {
      return failureResult(
        `Refusing to send DM. No approved request_confirmation found for DM to ${targetUserId}. Call request_confirmation first with action "Send Slack DM" and details { User: "${targetUserId}" }, then retry after the user clicks Confirm.`,
        'confirmation_required',
      );
    }
  }

  {
    const gate = await applyAutonomyGate({ userId, action: 'send_slack_dm', toolName: 'slack_send_dm', input, context, verb: 'message' });
    if (gate.handled) return gate.result!;
  }

  const token = await getSlackToken(userId);
  if (!token) return failureResult('Slack is not connected.', 'slack_not_connected');

  // 1) conversations.open — idempotent, returns the existing IM channel id if one exists
  const openRes = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: targetUserId }),
    signal: AbortSignal.timeout(8000),
  });
  if (!openRes.ok) return failureResult(`Could not open Slack DM (${openRes.status}).`, 'upstream_slack');
  const openData = await openRes.json();
  if (!openData.ok || !openData.channel?.id) {
    return failureResult(`Slack DM open failed: ${openData.error || 'unknown'}.`, 'upstream_slack');
  }
  const dmChannel = openData.channel.id;

  // 2) chat.postMessage to the DM channel
  const postRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: dmChannel, text, mrkdwn: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!postRes.ok) return failureResult(`DM post failed (${postRes.status}).`, 'upstream_slack');
  const postData = await postRes.json();
  if (!postData.ok) return failureResult(`Slack error: ${postData.error || 'unknown'}.`, 'upstream_slack');

  // 3) Permalink — best-effort; if it fails we still return success
  let permalink = '';
  try {
    const plRes = await fetch(
      `https://slack.com/api/chat.getPermalink?channel=${encodeURIComponent(dmChannel)}&message_ts=${encodeURIComponent(postData.ts)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) },
    );
    if (plRes.ok) {
      const pl = await plRes.json();
      if (pl.ok && pl.permalink) permalink = pl.permalink;
    }
  } catch { /* non-fatal */ }

  return {
    output: `Sent DM to ${targetUserId} at ts ${postData.ts}.${permalink ? `\nPermalink: ${permalink}` : ''}`,
  };
}

// ── slack_get_channels ────────────────────────────────────────────────────────
async function slackGetChannels(userId: string, input: any): Promise<ToolResult> {
  const limit = Math.max(1, Math.min(200, Number(input?.limit) || 100));
  const token = await getSlackToken(userId);
  if (!token) return failureResult('Slack is not connected.', 'slack_not_connected');

  const params = new URLSearchParams({
    types: 'public_channel,private_channel',
    exclude_archived: 'true',
    limit: String(Math.min(limit, 200)),
  });
  const res = await fetch(`https://slack.com/api/conversations.list?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return failureResult(`Slack channels.list failed (${res.status}).`, 'upstream_slack');
  const data = await res.json();
  if (!data.ok) return failureResult(`Slack error: ${data.error || 'unknown'}.`, 'upstream_slack');

  const channels: any[] = (data.channels || []).slice(0, limit);
  if (!channels.length) return { output: 'No channels accessible to the Slack bot.' };

  const lines = channels.map((c: any, i: number) =>
    `${i + 1}. #${c.name}  [id: ${c.id}  type: ${c.is_private ? 'private' : 'public'}  members: ${c.num_members ?? '?'}]`,
  );
  return { output: `${channels.length} channel(s):\n${lines.join('\n')}` };
}

// ── Scheduled agent creation ───────────────────────────────────────────────────

const INTEGRATION_DETECTION: Record<string, RegExp> = {
  gmail: /\b(gmail|email|mail|inbox|newsletter|draft|outreach|cold[\s-]?outreach|send.*email|email.*send|unread)\b/i,
  gcal:  /\b(calendar|meeting|schedule|event|appointment|book.*meeting|meet.*link|google[\s-]?meet)\b/i,
  slack: /\b(slack|slack[\s-]?message|slack[\s-]?dm|post.*slack|slack.*channel)\b/i,
  notion: /\b(notion|notes|page|database|write.*notion|notion.*page|notion.*db)\b/i,
};

function detectRequiredIntegrations(taskDescription: string, outputChannel: string): string[] {
  const needed = new Set<string>();
  for (const [key, re] of Object.entries(INTEGRATION_DETECTION)) {
    if (re.test(taskDescription)) needed.add(key);
  }
  if (outputChannel === 'gmail' || outputChannel === 'email') needed.add('gmail');
  if (outputChannel === 'slack') needed.add('slack');
  return [...needed];
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human-readable label for the cron patterns the create form / LLM produce. */
function cronToLabel(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return `Schedule: ${cron}`;
  const [min, hour, , , dow] = p;
  const hh = /^\d+$/.test(hour) ? hour.padStart(2, '0') : hour;
  const mm = /^\d+$/.test(min) ? min.padStart(2, '0') : min;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hour(s)`;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minute(s)`;
  const at = `${hh}:${mm}`;
  if (dow === '*') return `Daily at ${at}`;
  if (/^\d$/.test(dow)) return `Weekly on ${DOW_NAMES[Number(dow)]} at ${at}`;
  return `At ${at} (${cron})`;
}

/** Returns the TZ offset in minutes for `tz` at `date` (positive = ahead of UTC). */
function getUtcOffsetMinutes(tz: string, date: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const get = (t: string) => parseInt(fmt.formatToParts(date).find(p => p.type === t)?.value ?? '0');
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return (localAsUtc - date.getTime()) / 60000;
  } catch { return 0; }
}

/** Next fire time for the given cron, interpreted in the user's timezone, as a UTC ISO string. */
function nextRunIso(cron: string, tz = 'UTC'): string | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [minS, hourS, , , dowS] = p;
  const now = new Date();
  const next = new Date(now);

  // Interval-based patterns have no timezone meaning — use UTC
  if (hourS.startsWith('*/')) {
    const step = parseInt(hourS.slice(2)) || 1;
    next.setMinutes(/^\d+$/.test(minS) ? parseInt(minS) : 0, 0, 0);
    while (next <= now || next.getUTCHours() % step !== 0) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  if (minS.startsWith('*/')) {
    const step = parseInt(minS.slice(2)) || 15;
    next.setSeconds(0, 0);
    do { next.setMinutes(next.getMinutes() + 1); } while (next <= now || next.getMinutes() % step !== 0);
    return next.toISOString();
  }

  const h = parseInt(hourS), m = parseInt(minS);
  if (isNaN(h) || isNaN(m)) return null;

  // Shift `now` into the user's TZ coordinate space
  const offsetMin = getUtcOffsetMinutes(tz, now);
  const nowLocal = new Date(now.getTime() + offsetMin * 60000);
  const y = nowLocal.getUTCFullYear(), mo = nowLocal.getUTCMonth(), d = nowLocal.getUTCDate();
  let targetLocal = new Date(Date.UTC(y, mo, d, h, m, 0, 0));

  if (/^\d$/.test(dowS)) {
    const targetDow = Number(dowS);
    while (targetLocal <= nowLocal || targetLocal.getUTCDay() !== targetDow) {
      targetLocal = new Date(targetLocal.getTime() + 86_400_000);
    }
  } else if (targetLocal <= nowLocal) {
    targetLocal = new Date(targetLocal.getTime() + 86_400_000);
  }

  return new Date(targetLocal.getTime() - offsetMin * 60000).toISOString();
}

async function getUserTimezone(userId: string): Promise<string> {
  try {
    const { getSupabaseAdmin } = await import('../supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    return (data?.preferences as Record<string, unknown>)?.timezone as string || 'UTC';
  } catch { return 'UTC'; }
}

async function requestConfirmation(input: any, userId: string, context: ToolContext = {}): Promise<ToolResult> {
  // HARD GUARD — refuse confirmations for tools that have their OWN flow.
  // create_scheduled_agent has the spec-card → live-agent-card sequence;
  // draft_reply saves a draft the user reviews in the UI; open_canvas just
  // renders content. Calling request_confirmation for any of these produces
  // a generic "Confirm/Cancel" card with nothing meaningful behind it,
  // which the user reads as a hallucination.
  const actionStr = String(input?.action || '').toLowerCase();
  const SELF_CONFIRMING_PATTERNS = [
    /\bcreate_scheduled_agent\b/,
    /\bscheduled\s+agent\b/,
    /\bschedule\s+(an?\s+)?agent\b/,
    /\bcreate\s+(an?\s+)?agent\b/,
    /\bregister\s+(an?\s+)?agent\b/,
    /\bdraft_reply\b/,
    /\bdraft\s+(a\s+)?reply\b/,
    /\bopen_canvas\b/,
  ];
  for (const pat of SELF_CONFIRMING_PATTERNS) {
    if (pat.test(actionStr)) {
      return failureResult(
        `Refusing to issue request_confirmation for "${input?.action}". This tool action has its own confirmation flow built in — call it directly. If you wanted to create a scheduled agent, call create_scheduled_agent with spec_markdown (Stage 1 spec card). If you wanted to draft a reply, call draft_reply (saves to Gmail drafts). Do NOT route these through request_confirmation.`,
        'self_confirming_tool',
      );
    }
  }

  const details: Record<string, string> = {};
  if (input.details && typeof input.details === 'object') {
    for (const [k, v] of Object.entries(input.details)) {
      if (v !== null && v !== undefined && v !== '') details[k] = String(v);
    }
  }

  // Infer which write action this confirmation gates so the executor-level
  // gate in sendEmail/scheduleMeeting/sendSlackMessage/createNotionPage can
  // match it. The LLM's `action` string is freeform ("Send email", "Post to
  // Slack"), so we use a coarse keyword classifier.
  const lower = (input.action || '').toLowerCase();
  let actionType: ApprovalActionType | null = null;
  // Batch first — "send 40 personalized emails…" must NOT classify as a single
  // send_email (its target key would be empty and unconsumable). A batch is
  // signalled by an explicit Count detail or a number of emails in the action.
  const detailCount = Number((input.details && (input.details.Count || input.details.count)) || 0);
  const actionCountMatch = lower.match(/\b(\d{2,3})\b[^.]*\bemails?\b|\bemails?\b[^.]*\b(\d{2,3})\b/);
  if (
    /\bsend\b|\bschedule\b/.test(lower) && /\bemails?\b/.test(lower) &&
    (detailCount > 1 || actionCountMatch)
  ) actionType = 'batch_email_send';
  else if (/\bsend\b.*\bemail\b|\bemail\b.*\bsend\b|\bsend\b.*\breply\b/.test(lower)) actionType = 'send_email';
  // Cal.com first — its actions also contain "book"/"meeting"/"cancel", so they
  // must be classified before the generic calendar rules below.
  else if (/cal\.?com/.test(lower) && /\bcancel\b/.test(lower)) actionType = 'calcom_cancel';
  else if (/cal\.?com/.test(lower) && /\bbook\b|\bschedule\b|\bmeeting\b/.test(lower)) actionType = 'calcom_book';
  else if (/\bcancel\b.*\b(event|meeting|invite|calendar)\b/.test(lower)) actionType = 'cancel_event';
  else if (/\bschedule\b|\bmeeting\b|\bcalendar\b.*\bevent\b|\bbook\b/.test(lower)) actionType = 'schedule_meeting';
  else if (/\bslack\b.*\bdm\b|\bdirect\b.*\bmessage\b|\bdm\b\s+\w+/.test(lower)) actionType = 'send_slack_dm';
  else if (/\bslack\b|\bchannel\b/.test(lower)) actionType = 'send_slack_message';
  else if (/\bnotion\b|\bpage\b|\bdatabase\b/.test(lower)) actionType = 'create_notion_page';

  let approvalId: string | null = null;
  if (actionType && context.conversationId) {
    // Reconstruct an input-shape from details so normalizeTargetKey can hash
    // the same key the write tool will produce when it runs.
    const detailsLower: Record<string, any> = {};
    for (const [k, v] of Object.entries(details)) detailsLower[k.toLowerCase()] = v;
    // Map common detail labels to the field names the write tools use.
    if (actionType === 'send_email') {
      detailsLower.to = detailsLower.to || detailsLower.recipient || detailsLower['to:'];
      detailsLower.subject = detailsLower.subject || detailsLower['subject:'];
    } else if (actionType === 'batch_email_send') {
      detailsLower.count = detailsLower.count || detailCount ||
        (actionCountMatch ? (actionCountMatch[1] || actionCountMatch[2]) : '');
    } else if (actionType === 'send_slack_message') {
      detailsLower.channel = detailsLower.channel || detailsLower.to || detailsLower.recipient;
    } else if (actionType === 'send_slack_dm') {
      detailsLower.userId = detailsLower.userid || detailsLower.user_id || detailsLower.user || detailsLower.to || detailsLower.recipient;
    } else if (actionType === 'create_notion_page') {
      detailsLower.database = detailsLower.database || detailsLower.db;
      detailsLower.title = detailsLower.title || detailsLower.name;
    } else if (actionType === 'schedule_meeting') {
      detailsLower.startTime = detailsLower.starttime || detailsLower.when || detailsLower.start;
      const att = detailsLower.attendees || detailsLower.with || detailsLower.attendee;
      if (typeof att === 'string') detailsLower.attendees = att.split(/[,;]/).map((s: string) => s.trim());
    } else if (actionType === 'cancel_event') {
      detailsLower.eventId = detailsLower.eventid || detailsLower.event_id || detailsLower.id || detailsLower.event;
    } else if (actionType === 'calcom_book') {
      detailsLower.email = detailsLower.email || detailsLower.with || detailsLower.attendee || detailsLower.to;
      detailsLower.start = detailsLower.start || detailsLower.when || detailsLower.time;
    } else if (actionType === 'calcom_cancel') {
      detailsLower.bookingId = detailsLower.bookingid || detailsLower.booking_id || detailsLower.id || detailsLower.booking;
    }
    const targetKey = normalizeTargetKey(actionType, detailsLower);

    // PART 4 Rule 6 — refuse to re-prompt for something the user already
    // declined in this conversation. The LLM gets a structured failure and
    // must tell the user that this exact action was already declined; it
    // cannot insert a fresh pending row to ask again.
    const previouslyDeclined = await hasDeclinedApproval({
      conversationId: context.conversationId,
      userId,
      actionType,
      targetKey,
    });
    if (previouslyDeclined) {
      return failureResult(
        `You already asked the user to confirm "${input.action}" with this exact target earlier in this conversation, and they declined. Do NOT ask again. Reply with: "I asked about this earlier and you declined — let me know if you want to revisit it differently." Then stop.`,
        'already_declined',
      );
    }

    approvalId = await recordPendingApproval({
      conversationId: context.conversationId,
      userId,
      actionType,
      targetKey,
      actionLabel: input.action,
    });
  }

  return {
    output:
      `Confirmation requested. Waiting for user to approve: "${input.action}". Do NOT call any more tools — the loop will stop here.` +
      (approvalId && actionType === 'batch_email_send'
        ? ` This is a BATCH approval (approvalId: ${approvalId}). After the user confirms, call schedule_email_send ONCE with the items array AND approvalId: "${approvalId}".`
        : ''),
    requiresConfirmation: true,
    canvasData: {
      title: input.action || 'Confirm action',
      type: 'confirmation_required',
      markdown: '',
      pageMeta: {
        action: input.action || 'Action',
        description: input.description || '',
        // The receipt line that turns approval into confirmation.
        why: typeof input.why === 'string' ? input.why.trim().slice(0, 180) : '',
        details,
        // Picked up by ConfirmationCard.onAction — POSTed to /api/boult/approval/confirm
        // when the user clicks Confirm so the executor-level gate can match.
        approvalId,
      },
    },
  };
}

/**
 * Build a PlanPreviewData-shaped object describing what a scheduled agent
 * will do each time it runs — used for Fix 7 agent plan preview.
 */
function buildAgentRunPlan(input: any) {
  const taskDescription: string = input.task_description || 'Run scheduled task';
  const outputChannel: string = input.output_channel || 'gmail';
  const connectedIntegrations: string[] = []; // agents run with whatever is connected at runtime
  const plan = buildExecutionPlan(taskDescription, connectedIntegrations, false);

  if (plan) {
    return {
      intent: plan.intent,
      steps: plan.steps.map(s => ({
        label: s.label,
        tools: s.tools,
        parallel: s.parallel,
        isWrite: s.isWrite,
        requiredIntegration: s.requiredIntegration,
      })),
      missingIntegrations: plan.missingIntegrations,
      estimatedCalls: plan.estimatedCalls,
      specificDescription: `Each time this agent runs, it will: ${plan.steps.map(s => s.label).join(', ')}. Results will be delivered via ${outputChannel}.`,
    };
  }

  // Fallback: minimal plan
  return {
    intent: taskDescription,
    steps: [{ label: taskDescription, tools: ['(auto-selected at runtime)'], parallel: false, isWrite: false, requiredIntegration: null }],
    missingIntegrations: [],
    estimatedCalls: { min: 2, max: 6 },
    specificDescription: `Each run: ${taskDescription}. Delivered via ${outputChannel}.`,
  };
}

// G5 — Accept natural-language schedules ("every morning at 7", "weekday
// afternoons", "twice a day", "every Monday and Thursday at 9am") so the
// LLM doesn't have to translate to cron syntax perfectly. Returns a valid
// 5-field cron or null if no match — callers fall back to the LLM's
// original cron_schedule field in that case.
function naturalLanguageToCron(raw: string): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase().trim();

  // 5-field cron already → pass-through
  if (/^[\d*\/,\-]+\s+[\d*\/,\-]+\s+[\d*\/,\-]+\s+[\d*\/,\-]+\s+[\d*\/,\-]+$/.test(t)) {
    return t;
  }

  function parseHourPhrase(): { h: number; m: number } | null {
    // "at 7am", "at 7:30 am", "at 14:00", "at 9", "at 9 pm"
    const m1 = t.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (m1) {
      let h = parseInt(m1[1], 10);
      const min = m1[2] ? parseInt(m1[2], 10) : 0;
      const ampm = m1[3];
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { h, m: min };
    }
    if (/\bmorning\b/.test(t)) return { h: 7, m: 0 };
    if (/\bnoon\b/.test(t)) return { h: 12, m: 0 };
    if (/\bafternoon\b/.test(t)) return { h: 14, m: 0 };
    if (/\bevening\b/.test(t)) return { h: 18, m: 0 };
    if (/\bnight\b/.test(t)) return { h: 21, m: 0 };
    return null;
  }

  // Hourly / every N hours
  let m;
  if ((m = t.match(/every\s+hour|hourly/))) return '0 * * * *';
  if ((m = t.match(/every\s+(\d+)\s+hours?/))) return `0 */${m[1]} * * *`;

  // Twice a day / multi-daily
  if (/twice\s+a\s+day|two\s+times\s+a\s+day/.test(t)) return '0 9,17 * * *';
  if (/three\s+times\s+a\s+day/.test(t)) return '0 8,13,18 * * *';

  // Day-of-week shortcuts
  const DOW: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5, sat: 6, saturday: 6,
  };

  // Multiple specific weekdays — "every Monday and Thursday at 9am"
  const dayMatches: number[] = [];
  for (const [k, v] of Object.entries(DOW)) {
    if (new RegExp(`\\b${k}s?\\b`).test(t)) dayMatches.push(v);
  }
  const uniqueDays = Array.from(new Set(dayMatches)).sort();

  const hp = parseHourPhrase() || { h: 9, m: 0 };

  if (/\bweekdays?\b|monday\s+to\s+friday|mon-fri/.test(t)) {
    return `${hp.m} ${hp.h} * * 1-5`;
  }
  if (/\bweekends?\b/.test(t)) {
    return `${hp.m} ${hp.h} * * 0,6`;
  }
  if (uniqueDays.length > 0) {
    return `${hp.m} ${hp.h} * * ${uniqueDays.join(',')}`;
  }

  // Daily fallback
  if (/every\s+day|daily|each\s+day/.test(t) || /at\s+\d/.test(t) || /morning|noon|afternoon|evening|night/.test(t)) {
    return `${hp.m} ${hp.h} * * *`;
  }

  // Weekly without specific day → Monday
  if (/weekly|every\s+week/.test(t)) {
    return `${hp.m} ${hp.h} * * 1`;
  }

  // Monthly
  if (/monthly|every\s+month/.test(t)) {
    return `${hp.m} ${hp.h} 1 * *`;
  }

  return null;
}

async function listScheduledAgents(userId: string): Promise<ToolResult> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_agents')
      .select('id, name, task_description, cron_schedule, output_channel, status, skip_confirmations, expires_at, last_run_at, last_report_summary, created_at')
      .eq('user_id', normalizeUserId(userId))
      .order('created_at', { ascending: false });
    if (error) return failureResult(`Could not list agents: ${error.message}`, 'list_agents_failed');
    if (!data || data.length === 0) return { output: 'No scheduled agents.', success: true };
    const blocks = data.map((a: any) => {
      const status = a.status || 'active';
      const cron = a.cron_schedule || 'unknown';
      const last = a.last_run_at ? new Date(a.last_run_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never';
      const lastSummary = a.last_report_summary ? `\n  last_report: ${String(a.last_report_summary).slice(0, 220).replace(/\s+/g, ' ')}` : '';
      const expires = a.expires_at ? `\n  expires_at: ${a.expires_at}` : '';
      const skip = a.skip_confirmations ? '\n  skip_confirmations: true' : '';
      return `agent_id: ${a.id}\n  name: "${a.name}"\n  status: ${status}\n  cron: "${cron}"\n  output_channel: ${a.output_channel}\n  last_run_at: ${last}${skip}${expires}\n  task: ${String(a.task_description).slice(0, 280).replace(/\s+/g, ' ')}${lastSummary}`;
    }).join('\n\n');
    return { output: `Scheduled agents (${data.length}):\n\n${blocks}`, success: true };
  } catch (e: any) {
    return failureResult(`Could not list agents: ${e?.message || 'unknown error'}`, 'list_agents_failed');
  }
}

async function resolveAgent(userId: string, input: any): Promise<{ row?: any; error?: ToolResult }> {
  const agentId = (input?.agent_id || '').trim();
  const matchName = (input?.match_name || '').trim();
  if (!agentId && !matchName) {
    return { error: failureResult('Provide agent_id (preferred — from list_scheduled_agents) or match_name.', 'validation_error') };
  }
  const supabase = getSupabaseAdmin();
  if (agentId) {
    const { data, error } = await supabase
      .from('boult_agents')
      .select('id, name, status, cron_schedule')
      .eq('user_id', normalizeUserId(userId))
      .eq('id', agentId)
      .maybeSingle();
    if (error) return { error: failureResult(`Could not look up agent: ${error.message}`, 'pause_failed') };
    if (!data) return { error: failureResult(`No agent with id ${agentId}.`, 'not_found') };
    return { row: data };
  }
  const { data, error } = await supabase
    .from('boult_agents')
    .select('id, name, status, cron_schedule')
    .eq('user_id', normalizeUserId(userId))
    .ilike('name', `%${matchName}%`);
  if (error) return { error: failureResult(`Could not look up agent: ${error.message}`, 'pause_failed') };
  if (!data || data.length === 0) return { error: failureResult(`No agent name matches "${matchName}".`, 'not_found') };
  if (data.length > 1) {
    const names = data.map((r: any) => `"${r.name}"`).join(', ');
    return { error: failureResult(`Multiple agents match "${matchName}": ${names}. Use agent_id from list_scheduled_agents.`, 'ambiguous_match') };
  }
  return { row: data[0] };
}

async function pauseScheduledAgent(userId: string, input: any): Promise<ToolResult> {
  const resolved = await resolveAgent(userId, input);
  if (resolved.error) return resolved.error;
  const row = resolved.row;
  if (row.status === 'paused') return { output: `Agent "${row.name}" is already paused.`, success: true };
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_agents')
      .update({ status: 'paused' })
      .eq('id', row.id)
      .eq('user_id', normalizeUserId(userId));
    if (error) return failureResult(`Could not pause agent: ${error.message}`, 'pause_failed');
    return { output: `Paused agent: "${row.name}" (was ${row.status || 'active'}, now paused). Cron "${row.cron_schedule}" will not fire until you resume it.`, success: true };
  } catch (e: any) {
    return failureResult(`Could not pause agent: ${e?.message || 'unknown error'}`, 'pause_failed');
  }
}

async function resumeScheduledAgent(userId: string, input: any): Promise<ToolResult> {
  const resolved = await resolveAgent(userId, input);
  if (resolved.error) return resolved.error;
  const row = resolved.row;
  if (row.status === 'active') return { output: `Agent "${row.name}" is already active.`, success: true };
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_agents')
      .update({ status: 'active' })
      .eq('id', row.id)
      .eq('user_id', normalizeUserId(userId));
    if (error) return failureResult(`Could not resume agent: ${error.message}`, 'resume_failed');
    return { output: `Resumed agent: "${row.name}". Next fire is the next "${row.cron_schedule}" boundary.`, success: true };
  } catch (e: any) {
    return failureResult(`Could not resume agent: ${e?.message || 'unknown error'}`, 'resume_failed');
  }
}

async function deleteScheduledAgent(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  if (!context.isBackgroundAgent && context.runState && context.runState !== 'EXECUTING' && context.runState !== 'REPORTING') {
    return failureResult(
      `Refusing to delete — current state is ${context.runState}. Call request_confirmation first with action "Delete scheduled agent" and the agent name in details, then retry after the user confirms.`,
      'confirmation_required',
    );
  }
  const resolved = await resolveAgent(userId, input);
  if (resolved.error) return resolved.error;
  const row = resolved.row;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_agents')
      .delete()
      .eq('id', row.id)
      .eq('user_id', normalizeUserId(userId));
    if (error) return failureResult(`Could not delete agent: ${error.message}`, 'delete_failed');
    return { output: `Deleted agent: "${row.name}" (id ${row.id}). It will no longer fire on its cron.`, success: true };
  } catch (e: any) {
    return failureResult(`Could not delete agent: ${e?.message || 'unknown error'}`, 'delete_failed');
  }
}

async function forgetMemory(userId: string, input: any): Promise<ToolResult> {
  const memoryId = (input?.memory_id || '').trim();
  const matchText = (input?.match_text || '').trim();
  const maxDelete = Math.max(1, Math.min(50, Number(input?.max_delete) || 5));
  if (!memoryId && !matchText) {
    return failureResult('Provide memory_id (from memory_search) or match_text.', 'validation_error');
  }
  try {
    const supabase = getSupabaseAdmin();
    if (memoryId) {
      const { data: row, error: selErr } = await supabase
        .from('boult_memories')
        .select('id, content')
        .eq('user_id', normalizeUserId(userId))
        .eq('id', memoryId)
        .maybeSingle();
      if (selErr) return failureResult(`Could not look up memory: ${selErr.message}`, 'forget_failed');
      if (!row) return failureResult(`No memory with id ${memoryId}.`, 'not_found');
      const { error } = await supabase
        .from('boult_memories')
        .delete()
        .eq('id', row.id)
        .eq('user_id', normalizeUserId(userId));
      if (error) return failureResult(`Could not delete memory: ${error.message}`, 'forget_failed');
      const preview = String(row.content || '').slice(0, 120).replace(/\s+/g, ' ');
      return { output: `Forgot 1 memory: "${preview}${(row.content || '').length > 120 ? '…' : ''}".`, success: true };
    }
    const { data: rows, error: selErr } = await supabase
      .from('boult_memories')
      .select('id, content')
      .eq('user_id', normalizeUserId(userId))
      .ilike('content', `%${matchText.slice(0, 200)}%`)
      .limit(maxDelete + 1);
    if (selErr) return failureResult(`Could not search memories: ${selErr.message}`, 'forget_failed');
    if (!rows || rows.length === 0) return failureResult(`No memory contains "${matchText}".`, 'not_found');
    if (rows.length > maxDelete) {
      return failureResult(`Too many matches for "${matchText}" — found at least ${rows.length}, cap is ${maxDelete}. Narrow the text or raise max_delete.`, 'forget_failed');
    }
    const ids = rows.map((r: any) => r.id);
    const { error } = await supabase
      .from('boult_memories')
      .delete()
      .in('id', ids)
      .eq('user_id', normalizeUserId(userId));
    if (error) return failureResult(`Could not delete memories: ${error.message}`, 'forget_failed');
    const previews = rows.map((r: any) => `• "${String(r.content || '').slice(0, 100).replace(/\s+/g, ' ')}${(r.content || '').length > 100 ? '…' : ''}"`).join('\n');
    return { output: `Forgot ${rows.length} memor${rows.length === 1 ? 'y' : 'ies'} matching "${matchText}":\n${previews}`, success: true };
  } catch (e: any) {
    return failureResult(`Could not forget memory: ${e?.message || 'unknown error'}`, 'forget_failed');
  }
}

async function rememberTool(userId: string, input: any): Promise<ToolResult> {
  const content = (input?.content || '').trim();
  if (!content) return failureResult('content is required.', 'validation_error');
  const tags = Array.isArray(input?.tags) ? input.tags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim()) : [];
  try {
    // @ts-ignore — JS module path
    const { saveMemory } = await import('./memory');
    await saveMemory(userId, content, tags.length ? tags : undefined, 'user');
    const preview = content.slice(0, 120).replace(/\s+/g, ' ');
    return { output: `Remembered: "${preview}${content.length > 120 ? '…' : ''}"${tags.length ? ` (tags: ${tags.join(', ')})` : ''}`, success: true };
  } catch (e: any) {
    return failureResult(`Could not save memory: ${e?.message || 'unknown error'}`, 'memory_save_failed');
  }
}

async function logMeetingNotes(userId: string, input: any): Promise<ToolResult> {
  const notes = String(input?.notes || '').trim();
  if (!notes) return failureResult('notes are required — paste what you want to log.', 'validation_error');
  const matchTitle = String(input?.meeting_title || '').trim();

  try {
    const supabase = getSupabaseAdmin();
    const normalizedUser = normalizeUserId(userId);

    let meeting: any = null;
    if (matchTitle) {
      const { data, error } = await supabase
        .from('boult_meeting_events')
        .select('id, title, event_start, attendees, action_items')
        .eq('user_id', normalizedUser)
        .ilike('title', `%${matchTitle}%`)
        .order('event_start', { ascending: false })
        .limit(1);
      if (error?.code === '42P01') return failureResult('boult_meeting_events table missing — apply the migration.', 'log_meeting_failed');
      if (error) return failureResult(`Could not look up meeting: ${error.message}`, 'log_meeting_failed');
      meeting = data?.[0] || null;
      if (!meeting) return failureResult(`No meeting matches "${matchTitle}".`, 'not_found');
    } else {
      const { data, error } = await supabase
        .from('boult_meeting_events')
        .select('id, title, event_start, attendees, action_items')
        .eq('user_id', normalizedUser)
        .lte('event_start', new Date().toISOString())
        .order('event_start', { ascending: false })
        .limit(1);
      if (error?.code === '42P01') return failureResult('boult_meeting_events table missing — apply the migration.', 'log_meeting_failed');
      if (error) return failureResult(`Could not look up meeting: ${error.message}`, 'log_meeting_failed');
      meeting = data?.[0] || null;
      if (!meeting) return failureResult('No past meetings found to attach notes to.', 'not_found');
    }

    const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
    const attendeeEmails: string[] = attendees.map((a: any) => a?.email).filter((e: any) => typeof e === 'string');
    const attendeeBlock = attendeeEmails.length ? attendeeEmails.join(', ') : '(no attendees on file)';

    // LLM extraction — structured action items + key facts
    let actionItems: Array<{ text: string; due_at?: string; done: boolean; created_at: string }> = [];
    let keyFacts: string[] = [];
    try {
      const { callLLM, getText } = await import('./engine');
      const today = new Date().toISOString().slice(0, 10);
      const res = await callLLM(
        [
          {
            role: 'system',
            content:
              'You extract structured action items + key facts from raw meeting notes. ' +
              'Output STRICT JSON: { "actionItems": [{ "text": string, "dueAt": string | null }], "keyFacts": string[] }.\n\n' +
              'RULES:\n' +
              '- actionItems: things the USER (not attendees) must do. ≤ 100 chars each. Imperative verbs.\n' +
              '- dueAt: ISO datetime (YYYY-MM-DD or full ISO). Parse natural phrases relative to TODAY: "tomorrow" / "by Thu" / "next week" / "Friday" / "end of month". Use null if no date is mentioned.\n' +
              '- keyFacts: things worth remembering for FUTURE meetings with these people. Skip ephemeral details. ≤ 200 chars each.\n' +
              '- Be conservative — extract ONLY what is clearly in the notes. Skip vague mentions. Empty arrays are valid.\n' +
              'TODAY IS: ' + today,
          },
          {
            role: 'user',
            content:
              `MEETING: "${meeting.title || '(untitled)'}" on ${String(meeting.event_start).slice(0, 10)} with ${attendeeBlock}\n\n` +
              `NOTES:\n${notes.slice(0, 4000)}\n\n` +
              'Extract now.',
          },
        ],
        [],
        { maxTokens: 600, temperature: 0.2 },
      );

      const raw = getText(res.content).trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const now = new Date().toISOString();
        if (Array.isArray(parsed.actionItems)) {
          actionItems = parsed.actionItems
            .filter((a: any) => typeof a?.text === 'string' && a.text.trim())
            .slice(0, 10)
            .map((a: any) => {
              const text = a.text.trim().slice(0, 200);
              let due_at: string | undefined;
              if (typeof a.dueAt === 'string' && a.dueAt.length >= 10) {
                const d = new Date(a.dueAt);
                if (!isNaN(d.getTime())) due_at = d.toISOString();
              }
              return { text, due_at, done: false, created_at: now };
            });
        }
        if (Array.isArray(parsed.keyFacts)) {
          keyFacts = parsed.keyFacts
            .filter((s: any) => typeof s === 'string' && s.trim())
            .slice(0, 6)
            .map((s: string) => s.trim().slice(0, 300));
        }
      }
    } catch { /* LLM unavailable — save raw notes only */ }

    // Merge with existing action items (preserve done status of prior ones)
    const existingItems = Array.isArray(meeting.action_items) ? meeting.action_items : [];
    const mergedItems = [...existingItems, ...actionItems];

    const { error: updateErr } = await supabase
      .from('boult_meeting_events')
      .update({
        user_notes: notes.slice(0, 8000),
        action_items: mergedItems,
      })
      .eq('id', meeting.id);
    if (updateErr) return failureResult(`Could not save notes: ${updateErr.message}`, 'log_meeting_failed');

    // Memory writes — best-effort, fire-and-forget pattern
    try {
      // @ts-ignore — JS module path
      const { saveMemory } = await import('./memory');
      const dateStr = String(meeting.event_start).slice(0, 10);
      await saveMemory(
        userId,
        `[MEETING_NOTES] ${dateStr} — "${meeting.title}" with ${attendeeBlock}. Notes: ${notes.slice(0, 600).replace(/\s+/g, ' ')}`,
        ['meeting', 'notes', ...attendeeEmails],
        'user',
      );
      for (const fact of keyFacts) {
        await saveMemory(
          userId,
          `[CONTEXT] About ${attendeeBlock}: ${fact}`,
          ['context', ...attendeeEmails],
          'user',
        );
      }
    } catch { /* best-effort */ }

    // Compose user-facing output
    const out: string[] = [];
    out.push(`Logged notes for "${meeting.title}" (${attendeeEmails.length} attendee${attendeeEmails.length === 1 ? '' : 's'}).`);
    if (actionItems.length > 0) {
      out.push(``);
      out.push(`Action items extracted (${actionItems.length}):`);
      for (const item of actionItems) {
        const due = item.due_at ? ` — due ${item.due_at.slice(0, 10)}` : '';
        out.push(`- ${item.text}${due}`);
      }
    } else {
      out.push(`No action items extracted from these notes.`);
    }
    if (keyFacts.length > 0) {
      out.push(``);
      out.push(`Saved ${keyFacts.length} key fact${keyFacts.length === 1 ? '' : 's'} about ${attendeeBlock} to memory — future preps with them will surface this.`);
    }
    out.push(``);
    out.push(`Action items will show in your /today bucket when their deadline is within 48h.`);
    return { output: out.join('\n'), success: true };
  } catch (e: any) {
    return failureResult(`Could not log meeting notes: ${e?.message || 'unknown error'}`, 'log_meeting_failed');
  }
}

// Fill input.name / input.task_description when the model omitted them but gave
// enough to recover from: alias keys it used by mistake, or the spec_markdown
// document itself (its H1 is the name; its objective/body is the task).
function deriveMissingAgentFields(input: any): void {
  if (!input || typeof input !== 'object') return;

  // 1. Common alias keys the model uses instead of the canonical ones.
  if (!input.name?.trim?.()) {
    input.name = input.agent_name || input.agentName || input.title || input.name;
  }
  if (!input.task_description?.trim?.()) {
    input.task_description =
      input.taskDescription || input.task || input.description || input.instructions || input.task_description;
  }

  const spec = typeof input.spec_markdown === 'string' ? input.spec_markdown : '';
  if (!spec.trim()) return;

  // 2. Name ← the spec's first H1 ("# <Agent Name>").
  if (!input.name?.trim?.()) {
    const h1 = spec.match(/^\s*#\s+(.+?)\s*$/m);
    if (h1) input.name = h1[1].replace(/[*_`#]/g, '').trim();
  }

  // 3. task_description ← the spec's Objective section, else the first
  //    meaningful paragraph after the H1. Strip markdown structure to a clean
  //    self-contained instruction.
  if (!input.task_description?.trim?.()) {
    // Prefer an "## ... Objective" / "## ... Logic" section body.
    const objMatch = spec.match(/^##\s+[^\n]*(?:objective|logic|task|goal)[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/im);
    let body = objMatch ? objMatch[1] : '';
    if (!body.trim()) {
      // Fallback: everything after the H1, minus headings/fences.
      const afterH1 = spec.replace(/^[\s\S]*?^#\s+.+?$/m, '');
      body = afterH1;
    }
    const cleaned = body
      .replace(/```[\s\S]*?```/g, ' ')      // drop fenced blocks (boult-steps JSON etc.)
      .replace(/^#{1,6}\s+/gm, '')          // headings
      .replace(/^\s*[-*+]\s+/gm, '')        // bullet markers
      .replace(/[*_`]/g, '')                // emphasis
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 12) input.task_description = cleaned.slice(0, 1500);
  }
}

// Compose a rich (≥500 char), RANDOMIZED confirmation for a freshly-created
// agent. Randomized so it never reads like a hardcoded template; the time comes
// from nextRunLabel (already in the user's TZ) so it's always correct. Returned
// to the loop, which emits it verbatim — the model never invents the time.
function composeAgentLiveDescription(a: {
  name: string;
  scheduleLabel: string;
  nextRunLabel: string | null;
  channelHuman: string;
  taskDescription: string;
  skipConfirmations: boolean;
}): string {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const openers = [
    `**${a.name}** is live and on the clock.`,
    `Done — **${a.name}** is set up and running.`,
    `**${a.name}** is now part of your team.`,
    `Your new agent, **${a.name}**, is live.`,
    `**${a.name}** is wired up and ready to work.`,
  ];

  const cadence = a.nextRunLabel
    ? pick([
        `It runs ${a.scheduleLabel.toLowerCase()}, with the first run landing ${a.nextRunLabel}.`,
        `First run is ${a.nextRunLabel}, then it repeats ${a.scheduleLabel.toLowerCase()}.`,
        `Expect the first report ${a.nextRunLabel} — after that it fires ${a.scheduleLabel.toLowerCase()}.`,
      ])
    : `It runs ${a.scheduleLabel.toLowerCase()}.`;

  const delivery = pick([
    `Each run's report is delivered straight to ${a.channelHuman}.`,
    `When it finishes, the briefing lands in ${a.channelHuman}.`,
    `You'll get a full report in ${a.channelHuman} every time it runs.`,
  ]);

  const autonomy = a.skipConfirmations
    ? pick([
        `It's set to act autonomously — it'll send, schedule, and log without pausing to ask, so you wake up to finished work, not a queue of approvals.`,
        `Autonomy is on: it executes write actions on its own and reports what it did, rather than waiting for your sign-off mid-run.`,
      ])
    : pick([
        `It'll draft and prepare everything but pause for your approval before sending or scheduling anything — nothing goes out without your okay.`,
        `Write actions are gated: it queues drafts and proposed bookings for you to approve, so you stay in control of anything that leaves your inbox.`,
      ]);

  const tips = [
    `Tip: you can edit, pause, or change its schedule anytime from the Agents tab — changes take effect on the next run.`,
    `Tip: the more it runs, the sharper it gets — it remembers your preferences and past decisions, so early runs are the roughest it'll ever be.`,
    `Tip: if a run ever looks off, open it from the Agents tab to see exactly which tools it used and what it touched — full transparency, no black box.`,
    `Tip: want it to behave differently? Just tell me in plain English ("only flag VIP emails", "never schedule before 10am") and I'll update its instructions.`,
    `Tip: you can set an auto-pause date so it stops itself after a busy stretch, or add a second agent for a different job — they run independently.`,
  ];

  const taskEcho = a.taskDescription && a.taskDescription.length > 20
    ? pick([
        ` Its standing brief: "${a.taskDescription.slice(0, 180).trim()}${a.taskDescription.length > 180 ? '…' : ''}".`,
        ` Each run it works through: "${a.taskDescription.slice(0, 180).trim()}${a.taskDescription.length > 180 ? '…' : ''}".`,
      ])
    : '';

  const body = `${pick(openers)} ${cadence} ${delivery}${taskEcho} ${autonomy}\n\n${pick(tips)}`;
  return body;
}

async function createScheduledAgent(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // Resilience: weak models routinely call this with spec_markdown but forget
  // name / task_description (or send them under the wrong key). Rather than
  // hard-reject — which surfaced "a name and a task description are both
  // required" to the user even though they gave a complete spec — derive the
  // missing fields from spec_markdown (or task aliases) before validating.
  deriveMissingAgentFields(input);

  if (!input?.name?.trim() || !input?.task_description?.trim()) {
    return failureResult('Cannot create the agent — a name and a task description are both required.', 'validation_error');
  }
  // Next-gen trigger type — defaults to the classic schedule path.
  const triggerType = ['schedule', 'event', 'condition', 'chained'].includes(input.trigger_type) ? input.trigger_type : 'schedule';

  // G5 — Accept either a 5-field cron OR a natural-language schedule. For
  // event/condition/chained agents the cron is irrelevant (they fire reactively
  // or via a pipeline), so we keep a harmless default and skip validation.
  let cron = (input.cron_schedule || '0 7 * * *').trim();
  if (triggerType === 'schedule' && cron.split(/\s+/).length !== 5) {
    const nl = naturalLanguageToCron(cron);
    if (nl) {
      cron = nl;
    } else {
      return failureResult(`Schedule "${cron}" wasn't recognised. Use either a 5-field cron ("m h dom mon dow") or a natural phrase ("every weekday at 9am", "daily at 7", "every Monday and Thursday morning").`, 'validation_error');
    }
  }

  const triggerConfig = input.trigger_config && typeof input.trigger_config === 'object' ? input.trigger_config : {};
  const conditions = Array.isArray(input.conditions) ? input.conditions : [];
  const pipeline = Array.isArray(input.pipeline) ? input.pipeline : [];
  const priority = Number.isFinite(input.priority) ? input.priority : 5;

  const agentName = input.name.trim();
  const taskDescription = input.task_description.trim();
  const outputChannel = input.output_channel || 'gmail';
  const agentParams = {
    name: agentName,
    task_description: taskDescription,
    cron_schedule: cron,
    output_channel: outputChannel,
    slack_channel: input.slack_channel || null,
    skip_confirmations: input.skip_confirmations ?? false,
    expires_at: input.expires_at || null,
  };

  // ── STAGE 1 — Spec confirmation ────────────────────────────────────────────
  // First call from an interactive session: render the spec to canvas and ask
  // the user to Confirm or Edit. No DB write, no plan card yet.
  // skip_confirmations: true in the inputs bypasses this stage too (the agent
  // owner already opted in to autonomy at the call site).
  if (
    context.conversationId &&
    !input._creationStage &&
    !input._planApproved
  ) {
    // Normalize BEFORE the spec touches canvas state or the render payload.
    // The spec_markdown schema asks the model for a ```boult-steps fenced block,
    // but weak free models routinely emit a BARE { "steps": [...] } blob under
    // the ## Steps heading — which ReactMarkdown then renders as a wall of raw
    // JSON prose (the reported bug). open_canvas/update_canvas already run this;
    // the agent-spec path was the one canvas producer that skipped it.
    const specMarkdown = normalizeDocumentMarkdown((input.spec_markdown || '').trim());
    if (!specMarkdown) {
      // F8 — Internal-only error: hide the raw "spec_markdown is required"
      // string from chat output. The sanitizer in engine.ts strips this
      // verbatim, and the loop reads `_internal_only` to swap in a clean
      // user-facing prompt instead.
      return {
        success: false,
        errorCode: 'validation_error',
        output:
          'INTERNAL: spec_markdown is required on the first call. ' +
          'You (the model) must compose the full specification document — ' +
          'H1 title, ## 1. Agent Objective, ## 2. Operational Logic, ## 3. Schedule & Delivery, ## 4. Expected Output — ' +
          'and call create_scheduled_agent again with spec_markdown set. ' +
          'When responding to the user, ask them ONE short clarifying question about the agent (what should it do? how often?) — ' +
          'do NOT mention spec_markdown, validation, or any internal field name.',
        _internal_only: true,
      } as any;
    }

    // F2.6 — Run the integration check FIRST so the user sees the
    // integration-required card immediately, not after clicking Confirm.
    // Previously Stage 1 rendered the spec, the user clicked Confirm, then
    // Stage 3's integration gate fired — the spec card vanished and an
    // integration-required card appeared mid-flow. Confusing.
    const requiredIntegrations = detectRequiredIntegrations(taskDescription, outputChannel);
    if (requiredIntegrations.length > 0) {
      const connected = await getConnectedIntegrations(userId);
      const missing = requiredIntegrations.filter(r => !connected.includes(r));
      if (missing.length > 0) {
        return {
          output: `Before I can create **${agentName}**, you need to connect: ${missing.join(', ')}. Connect those integrations from the card below, then ask me to create the agent again.`,
          canvasData: {
            title: agentName,
            type: 'integration_required',
            markdown: '',
            pageMeta: {
              required: requiredIntegrations,
              connected: requiredIntegrations.filter(r => connected.includes(r)),
              missing,
              agentParams,
            } as any,
          },
        };
      }
    }

    // Persist the spec to canvas state so update_canvas / inspection can read it later.
    if (context.conversationId) {
      await setCanvasState({
        conversationId: context.conversationId,
        userId,
        title: agentName,
        type: 'agent_spec',
        markdown: specMarkdown,
      });
    }

    return {
      output: `Here's the spec for **${agentName}**. Review it in the canvas, then click Confirm to create the agent.`,
      canvasData: {
        title: agentName,
        type: 'agent_spec_confirm',
        markdown: specMarkdown,
        pageMeta: {
          agentName,
          stage: 'spec_confirm',
          agentParams,
        } as any,
      },
      requiresConfirmation: true,
    };
  }

  // ── End spec confirmation stage ─────────────────────────────────────────────
  // (The plan-preview middle stage was removed — one confirmation is enough.
  //  After the user clicks Confirm spec, the agent is created directly.)

  // ── Integration gate ────────────────────────────────────────────────────────
  const required = detectRequiredIntegrations(input.task_description, input.output_channel || 'gmail');
  if (required.length > 0) {
    const connected = await getConnectedIntegrations(userId);
    const missing = required.filter(r => !connected.includes(r));
    if (missing.length > 0) {
      return {
        output: `Cannot create the scheduled agent yet — the following integrations are required but not connected: ${missing.join(', ')}. Ask the user to connect them using the card below, then call create_scheduled_agent again.`,
        canvasData: {
          title: input.name.trim(),
          type: 'integration_required',
          markdown: '',
          pageMeta: {
            required,
            connected: required.filter(r => connected.includes(r)),
            missing,
            agentParams: {
              name: input.name.trim(),
              task_description: input.task_description.trim(),
              cron_schedule: cron,
              output_channel: input.output_channel || 'gmail',
              slack_channel: input.slack_channel || null,
              skip_confirmations: input.skip_confirmations ?? false,
              expires_at: input.expires_at || null,
            },
          } as any,
        },
      };
    }
  }
  // ── End integration gate ────────────────────────────────────────────────────

  const supabase = getSupabaseAdmin();
  const normalizedUserId = normalizeUserId(userId);
  const trimmedName = input.name.trim();

  // F8.1 — Idempotency: if an agent with the same (user_id, name) is
  // already active/paused/running, return THAT row instead of inserting a
  // duplicate. Stage-2 spec-approved messages can fire twice on double-
  // click, and template-spawn from the marketplace has its own dedup but
  // the LLM-driven path didn't. Two identical rows = two cron firings of
  // the same work twice a day, burning budget and confusing users.
  const { data: existing } = await supabase
    .from('boult_agents')
    .select('id, name, task_description, cron_schedule, output_channel, slack_channel, skip_confirmations, expires_at, status')
    .eq('user_id', normalizedUserId)
    .eq('name', trimmedName)
    .in('status', ['active', 'paused', 'running'])
    .maybeSingle();
  if (existing) {
    const scheduleLabel = cronToLabel(existing.cron_schedule);
    const userTz = await getUserTimezone(userId);
    const nextRun = nextRunIso(existing.cron_schedule, userTz);
    return {
      output: `Agent "${trimmedName}" is already live (created earlier). Schedule: ${scheduleLabel}. No new agent was created.`,
      canvasData: {
        title: existing.name,
        type: 'scheduled_agent',
        markdown: '',
        pageMeta: {
          pageId: existing.id,
          contentPreview: existing.task_description,
          url: '',
          startTime: nextRun || undefined,
          attendees: [scheduleLabel, existing.cron_schedule, existing.output_channel, String(!!existing.skip_confirmations), existing.status],
        },
      },
    };
  }

  const { data, error } = await supabase
    .from('boult_agents')
    .insert({
      user_id: normalizedUserId,
      name: trimmedName,
      task_description: input.task_description.trim(),
      cron_schedule: cron,
      output_channel: input.output_channel || 'gmail',
      slack_channel: input.slack_channel || null,
      skip_confirmations: input.skip_confirmations ?? false,
      expires_at: input.expires_at || null,
      status: 'active',
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      conditions,
      pipeline,
      priority,
    })
    .select()
    .single();

  if (error?.code === '42P01') {
    return failureResult('The agents table is not set up in the database yet. Tell the user the scheduled-agents feature needs the boult_agents migration applied.', 'migration_missing');
  }
  if (error) {
    return failureResult(`Failed to create the scheduled agent: ${error.message}`, 'agent_create_failed');
  }

  const scheduleLabel = cronToLabel(cron);
  const userTz = await getUserTimezone(userId);
  const nextRun = nextRunIso(cron, userTz);
  const nextRunLabel = nextRun
    ? new Date(nextRun).toLocaleString('en-US', {
        timeZone: userTz,
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : null;

  // The output is what the LLM sees as its tool result. Keep it concise and
  // factual — NO embedded self-instructions like "Now write a confirmation".
  const channelHuman = data.output_channel === 'gmail' ? 'your Gmail inbox'
    : data.output_channel === 'slack' ? 'Slack'
    : 'both Slack and your Gmail inbox';

  // Rich, correct, RANDOMIZED confirmation. The loop emits this verbatim instead
  // of letting the model compose its own sentence — which is where the wrong
  // time ("first run 10:30 AM" vs the card's 4:00 PM) came from. nextRunLabel is
  // already formatted in the user's timezone, so the time is always correct.
  const richDescription = composeAgentLiveDescription({
    name: data.name,
    scheduleLabel,
    nextRunLabel,
    channelHuman,
    taskDescription: data.task_description,
    skipConfirmations: !!data.skip_confirmations,
  });

  return {
    output: [
      `Agent "${data.name}" is live.`,
      `Schedule: ${scheduleLabel} (cron ${cron}).`,
      nextRunLabel ? `Next run: ${nextRunLabel}.` : '',
      `Delivery: ${channelHuman}.`,
    ].filter(Boolean).join(' '),
    canvasData: {
      title: data.name,
      type: 'scheduled_agent',
      markdown: '',
      pageMeta: {
        pageId: data.id,
        contentPreview: data.task_description,
        url: '',
        startTime: nextRun || undefined,
        richDescription,
        attendees: [scheduleLabel, cron, data.output_channel, String(!!data.skip_confirmations), data.status],
      },
    },
  };
}

// ── Newsletter digest ────────────────────────────────────────────────────────
// Solves "subscribed to too many newsletters, no time to read them": find the
// newsletters cluttering the inbox, distill them into one digest, and optionally
// archive them out. Shared by the digest_newsletters tool AND the Sift card.

interface NewsletterItem {
  id: string;
  from: string;
  senderName: string;
  subject: string;
  snippet: string;
  body: string;
  hasUnsub: boolean;
}

export interface NewsletterDigestResult {
  count: number;
  senders: string[];
  markdown: string;
  archived: number;
  emailed: boolean;
  daysBack: number;
}

function parseSenderName(from: string): string {
  if (!from) return 'Unknown';
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<.+>$/);
  if (m && m[1].trim()) return m[1].trim();
  return (from.split('@')[0] || from).replace(/[<>"]/g, '').trim() || from;
}

async function summarizeNewsletterBatch(newsletters: NewsletterItem[], daysBack: number): Promise<string> {
  const blocks = newsletters.map((n, i) =>
    `#${i + 1} FROM: ${n.senderName} | SUBJECT: ${n.subject}\nEXCERPT: ${n.snippet}${n.body ? `\nBODY: ${n.body.slice(0, 800)}` : ''}`
  ).join('\n\n---\n\n');

  const sys = `You are Boult, an inbox copilot. The user is subscribed to many newsletters and has no time to read them. Distill the newsletters below into ONE tight digest so they get all the value in under 60 seconds. Output GitHub-flavored markdown only — no preamble.

## 📰 Newsletter digest — last ${daysBack} days
A 1-2 sentence overview of the themes across these newsletters.

### Worth your time
- 3-6 bullets, each a genuinely useful takeaway, insight, or opportunity worth knowing. Lead with the substance (numbers, names, what actually happened), not the source. Skip pure promotions.

### By source
One line per newsletter: **Sender — Subject**: one-sentence takeaway. Merge multiple emails from the same sender into one line.

Rules: Be concrete and specific — never write "this newsletter discusses X". If an item is purely promotional with no real signal, group those under a brief "Mostly promotional" note instead of inventing value. No closing fluff.`;

  const user = `Here are ${newsletters.length} newsletters from the user's inbox:\n\n${blocks}`;

  const res = await callLLM(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    [],
    { maxTokens: 1800, temperature: 0.3 }
  );
  return getText(res.content).trim() || 'Could not generate a digest right now — please try again.';
}

async function archiveMessages(userId: string, token: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify';
  const body = JSON.stringify({ ids, removeLabelIds: ['INBOX', 'UNREAD'] });
  const headers = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  let res = await googleFetch(userId, 'gmail', url, { method: 'POST', headers: headers(token), body });
  if (res.status === 401) {
    const nt = await refreshGoogleToken(userId);
    if (nt) res = await googleFetch(userId, 'gmail', url, { method: 'POST', headers: headers(nt), body });
  }
  return res.ok ? ids.length : 0;
}

function digestMarkdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#2563eb;">$1</a>');
  let html = '';
  let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h3 style="margin:18px 0 6px;font-size:15px;">${inline(line.replace(/^###\s+/, ''))}</h3>`; }
    else if (/^##\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h2 style="margin:0 0 8px;font-size:18px;">${inline(line.replace(/^##\s+/, ''))}</h2>`; }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { html += '<ul style="margin:6px 0 12px;padding-left:20px;">'; inList = true; } html += `<li style="margin:4px 0;line-height:1.5;">${inline(line.replace(/^[-*]\s+/, ''))}</li>`; }
    else if (line === '') { if (inList) { html += '</ul>'; inList = false; } }
    else { if (inList) { html += '</ul>'; inList = false; } html += `<p style="margin:8px 0;line-height:1.5;">${inline(line)}</p>`; }
  }
  if (inList) html += '</ul>';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">${html}<hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/><p style="color:#999;font-size:12px;">Sent by Boult AI · Maily</p></div>`;
}

async function emailNewsletterDigest(userId: string, markdown: string, count: number): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Boult AI <boult@maily.cfd>',
      replyTo: 'support.maily@gmail.com',
      to: userId,
      subject: `📰 Your newsletter digest — ${count} caught up`,
      html: digestMarkdownToHtml(markdown),
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Find → summarize → (optionally) clear newsletters. Reusable by the Boult tool
 * and the Sift newsletters card. Throws 'GMAIL_NOT_CONNECTED' if no Gmail token.
 */
export async function runNewsletterDigest(
  userId: string,
  opts: { daysBack?: number; archive?: boolean; sendEmail?: boolean } = {}
): Promise<NewsletterDigestResult> {
  const daysBack = Math.min(Math.max(Math.round(opts.daysBack || 7), 1), 30);
  let token = await getGmailToken(userId);
  if (!token) throw new Error('GMAIL_NOT_CONNECTED');

  // Gmail's own category tabs are a reliable newsletter signal; List-Unsubscribe
  // (RFC 2369) confirms a message is a bulk mailing.
  const q = `in:inbox newer_than:${daysBack}d (category:promotions OR category:updates OR category:forums)`;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: '40' })}`;
  let listRes = await googleFetch(userId, 'gmail', listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (listRes.status === 401) {
    const nt = await refreshGoogleToken(userId);
    if (nt) { token = nt; listRes = await googleFetch(userId, 'gmail', listUrl, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!listRes.ok) throw new Error(`Gmail search failed (${listRes.status})`);

  const ids: string[] = ((await listRes.json()).messages || []).map((m: any) => m.id);
  if (!ids.length) return { count: 0, senders: [], markdown: '', archived: 0, emailed: false, daysBack };

  const detail = await Promise.all(ids.slice(0, 25).map(async (id): Promise<NewsletterItem | null> => {
    try {
      const r = await googleFetch(userId, 'gmail',
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return null;
      const m = await r.json();
      const h = m.payload?.headers || [];
      const from = getHeader(h, 'From');
      return {
        id: m.id,
        from,
        senderName: parseSenderName(from),
        subject: getHeader(h, 'Subject') || '(no subject)',
        snippet: (m.snippet || '').slice(0, 200),
        body: extractBody(m.payload, 1200),
        hasUnsub: !!getHeader(h, 'List-Unsubscribe'),
      };
    } catch { return null; }
  }));

  const newsletters = detail.filter((n): n is NewsletterItem => n !== null);
  if (!newsletters.length) return { count: 0, senders: [], markdown: '', archived: 0, emailed: false, daysBack };

  const senders = Array.from(new Set(newsletters.map(n => n.senderName)));
  const markdown = await summarizeNewsletterBatch(newsletters, daysBack);

  const archived = opts.archive ? await archiveMessages(userId, token, newsletters.map(n => n.id)) : 0;
  const emailed = opts.sendEmail ? await emailNewsletterDigest(userId, markdown, newsletters.length) : false;

  return { count: newsletters.length, senders, markdown, archived, emailed, daysBack };
}

async function digestNewsletters(userId: string, input: any): Promise<ToolResult> {
  const token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected. Ask the user to connect Gmail in Settings → Integrations.', 'gmail_not_connected');

  let r: NewsletterDigestResult;
  try {
    r = await runNewsletterDigest(userId, {
      daysBack: input?.daysBack,
      archive: !!input?.archive,
      sendEmail: !!input?.sendEmail,
    });
  } catch (e: any) {
    if (e.message === 'GMAIL_NOT_CONNECTED') return failureResult('Gmail is not connected.', 'gmail_not_connected');
    return failureResult(`Could not build the newsletter digest: ${e.message}`, 'digest_failed');
  }

  if (r.count === 0) {
    return { output: `No newsletters found in the last ${r.daysBack} days — the inbox is already clear of them. Reply with: "Nothing to digest — your inbox is already clear of newsletters from the last ${r.daysBack} days."` };
  }

  const lines = [
    `Digested ${r.count} newsletter${r.count === 1 ? '' : 's'} from ${r.senders.length} source${r.senders.length === 1 ? '' : 's'} (last ${r.daysBack} days).`,
    r.archived > 0 ? `Archived ${r.archived} out of the inbox and marked them read.` : 'Left them in the inbox (not archived).',
    r.emailed ? 'Emailed the digest to the user.' : '',
    'The full digest is shown in the Canvas panel. Write a 1-2 sentence summary to the user — how many you condensed and whether you cleared them. Do NOT call more tools.',
  ].filter(Boolean);

  return {
    output: lines.join('\n'),
    canvasData: { title: 'Newsletter digest', type: 'report', markdown: r.markdown },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Reporting tools — structured agent-run report generator + Gmail / Slack
// senders. The generator is deterministic templating so every report has a
// professional, consistent shape; the senders convert the markdown to
// HTML (Gmail) or Slack Block Kit.
// ══════════════════════════════════════════════════════════════════════════════

interface ExecutionLogEntry {
  tool: string;
  success: boolean;
  summary?: string;
  error?: string;
  links?: string[];
}

/**
 * Human-readable action labels for tool names.
 * Used in report summaries and "What I Did" tables so the user never sees
 * raw tool identifiers like "draft_reply" or "schedule_meeting".
 */
const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  search_gmail: 'Searched inbox',
  read_email: 'Read email',
  gmail_read_thread: 'Read thread',
  gmail_get_labels: 'Fetched labels',
  gmail_apply_label: 'Applied label',
  gmail_archive_thread: 'Archived thread',
  gmail_get_profile: 'Fetched Gmail profile',
  get_sent_emails: 'Read sent mail',
  draft_reply: 'Drafted reply',
  draft_cold_email: 'Drafted email',
  draft_review: 'Reviewed draft',
  send_email: 'Sent email',
  schedule_meeting: 'Booked meeting',
  get_calendar_events: 'Checked calendar',
  calendar_get_availability: 'Checked availability',
  calendar_cancel_event: 'Cancelled event',
  search_notion: 'Searched Notion',
  fetch_notion_schema: 'Read Notion schema',
  create_notion_page: 'Created Notion page',
  notion_read_page: 'Read Notion page',
  notion_create_task: 'Created task',
  notion_get_calendar_events: 'Fetched Notion calendar',
  send_slack_message: 'Sent Slack message',
  slack_find_user: 'Found Slack user',
  slack_send_dm: 'Sent Slack DM',
  slack_get_channels: 'Listed Slack channels',
  check_followups: 'Checked follow-ups',
  digest_newsletters: 'Digested newsletters',
  get_recipient_context: 'Fetched recipient context',
  get_contact_context: 'Fetched contact context',
  remember_about_contact: 'Saved contact note',
  memory_search: 'Searched memory',
  memory_save: 'Saved to memory',
  memory_get_contact_profile: 'Fetched contact profile',
  web_search: 'Searched the web',
  web_search_instant: 'Quick fact check',
  open_canvas: 'Opened canvas',
  update_canvas: 'Updated canvas',
  report_generate: 'Generated report',
  report_send_gmail: 'Emailed report',
  report_send_slack: 'Sent report to Slack',
};

/** Pluralisable action labels for the one-line summary. */
const TOOL_SUMMARY_VERBS: Record<string, [string, string]> = {
  // [singular, plural] — used as "drafted 1 reply" / "drafted 3 replies"
  draft_reply: ['drafted %n reply', 'drafted %n replies'],
  draft_cold_email: ['drafted %n email', 'drafted %n emails'],
  send_email: ['sent %n email', 'sent %n emails'],
  schedule_meeting: ['booked %n meeting', 'booked %n meetings'],
  create_notion_page: ['created %n Notion page', 'created %n Notion pages'],
  notion_create_task: ['created %n task', 'created %n tasks'],
  send_slack_message: ['sent %n Slack message', 'sent %n Slack messages'],
  slack_send_dm: ['sent %n Slack DM', 'sent %n Slack DMs'],
  gmail_archive_thread: ['archived %n thread', 'archived %n threads'],
  gmail_apply_label: ['labelled %n thread', 'labelled %n threads'],
  search_gmail: ['searched %n inbox query', 'searched %n inbox queries'],
  read_email: ['read %n email', 'read %n emails'],
  gmail_read_thread: ['read %n thread', 'read %n threads'],
  check_followups: ['checked follow-ups', 'checked follow-ups'],
  digest_newsletters: ['digested newsletters', 'digested newsletters'],
  calendar_cancel_event: ['cancelled %n event', 'cancelled %n events'],
};

function friendlyToolName(tool: string): string {
  return TOOL_FRIENDLY_NAMES[tool] || tool.replace(/_/g, ' ');
}

function deriveSummaryLine(log: ExecutionLogEntry[]): string {
  if (!log.length) return 'Nothing was executed this run.';
  const ok = log.filter((e) => e.success).length;
  const fail = log.length - ok;

  // Count occurrences of each tool
  const counts = new Map<string, number>();
  for (const e of log) {
    if (!e.success) continue;
    counts.set(e.tool, (counts.get(e.tool) || 0) + 1);
  }

  // Build human-readable parts. Prioritise write-actions first so the summary
  // leads with the most impactful work.
  const writePriority = ['send_email', 'draft_reply', 'draft_cold_email', 'schedule_meeting',
    'create_notion_page', 'notion_create_task', 'send_slack_message', 'slack_send_dm',
    'gmail_archive_thread', 'gmail_apply_label', 'calendar_cancel_event',
    'check_followups', 'digest_newsletters'];
  const readPriority = ['search_gmail', 'read_email', 'gmail_read_thread',
    'get_calendar_events', 'search_notion', 'notion_read_page'];

  const parts: string[] = [];
  const used = new Set<string>();

  // Write actions first
  for (const tool of writePriority) {
    const n = counts.get(tool);
    if (!n) continue;
    used.add(tool);
    const verbs = TOOL_SUMMARY_VERBS[tool];
    if (verbs) {
      parts.push((n === 1 ? verbs[0] : verbs[1]).replace('%n', String(n)));
    } else {
      parts.push(`${friendlyToolName(tool).toLowerCase()} (${n})`);
    }
  }

  // Aggregate read actions into a single "processed N emails/items" if no
  // write actions are available to lead with.
  if (!parts.length) {
    let readCount = 0;
    for (const tool of readPriority) {
      const n = counts.get(tool);
      if (n) { readCount += n; used.add(tool); }
    }
    if (readCount) parts.push(`processed ${readCount} item${readCount === 1 ? '' : 's'}`);
  }

  // Any remaining tools
  for (const [tool, n] of counts) {
    if (used.has(tool)) continue;
    const verbs = TOOL_SUMMARY_VERBS[tool];
    if (verbs) {
      parts.push((n === 1 ? verbs[0] : verbs[1]).replace('%n', String(n)));
    } else {
      parts.push(`${friendlyToolName(tool).toLowerCase()} (${n})`);
    }
  }

  const failNote = fail ? `, flagged ${fail} for review` : '';
  if (!parts.length) return `Ran ${ok} step${ok === 1 ? '' : 's'}${failNote}.`;

  // Capitalise the first word
  const joined = parts.join(', ') + failNote + '.';
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function reportGenerate(input: any): ToolResult {
  const log: ExecutionLogEntry[] = Array.isArray(input?.executionLog) ? input.executionLog : [];
  const skipped: string[] = Array.isArray(input?.skippedItems)
    ? input.skippedItems.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim())
    : [];
  const summaryLine: string = (input?.summaryLine && String(input.summaryLine).trim()) || deriveSummaryLine(log);

  const succeeded = log.filter((e) => e.success);
  const failed = log.filter((e) => !e.success);

  // Report shape is deliberately LEAN: a headline, what got done, and only the
  // items that actually need a human. Everything that was ceremony — a redundant
  // "# <agent> — Run Report" heading under a headline that already says it, a
  // standalone Links section restating links already attached to their line item,
  // empty-state filler ("No links produced this run."), and a machine UTC stamp —
  // is gone. A report the user skims in five seconds beats a complete one they skip.

  // ── Section 1: One-line summary (the headline; also the email subject) ──
  const lines: string[] = [summaryLine, ''];

  // ── Section 2: What I Did — links ride inline on their own item, never twice ──
  lines.push('## What I Did');
  lines.push('');

  if (succeeded.length) {
    if (succeeded.length >= 4) {
      // Table for 4+ items. Details stay short — a report is a skim surface, not a log.
      lines.push('| Action | Details | Link |');
      lines.push('|--------|---------|------|');
      for (const e of succeeded) {
        const action = friendlyToolName(e.tool);
        const details = (e.summary || '').replace(/\s+/g, ' ').trim().slice(0, 90).replace(/\|/g, '\\|');
        const entryLinks = Array.isArray(e.links) && e.links.length
          ? e.links.map((u) => `[Open](${u})`).join(', ')
          : '—';
        lines.push(`| ${action} | ${details || '—'} | ${entryLinks} |`);
      }
    } else {
      // Bullet list for 1–3 items
      for (const e of succeeded) {
        const action = friendlyToolName(e.tool);
        const details = (e.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const entryLinks = Array.isArray(e.links) && e.links.length
          ? ' — ' + e.links.map((u) => `[Open](${u})`).join(', ')
          : '';
        lines.push(`- **${action}** — ${details || 'completed'}${entryLinks}`);
      }
    }
  } else {
    lines.push('No actions were taken this run.');
  }

  // ── Section 3: Needs Your Attention — omitted entirely when there's nothing ──
  if (failed.length || skipped.length) {
    lines.push('', '## Needs Your Attention');
    lines.push('');
    for (const e of failed) {
      const action = friendlyToolName(e.tool);
      const why = (e.error || e.summary || 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 140);
      lines.push(`- ⚠️ **${action}** — ${why}`);
    }
    for (const s of skipped) {
      lines.push(`- ⏸️ ${s}`);
    }
  }

  // ── Footer — one line. Next run only when there is one. ──
  const nextRun = input?.nextRunTime ? String(input.nextRunTime).trim() : '';
  lines.push('', '---', `Sent by Boult • maily.cfd${nextRun ? ` • Next run: ${nextRun}` : ''}`);

  return { output: lines.join('\n') };
}

// ── markdown → professional HTML for report_send_gmail ────────────────────────
// Handles headings, lists, bold, italic, links, tables (pipe-delimited),
// horizontal rules, and paragraphs. Reports should look like they came from
// a professional service, not a script.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMd(text: string): string {
  // Order matters: links before bold so the *s inside link text don't bold-wrap.
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#2563eb;text-decoration:underline;">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Bare urls (not already wrapped in <a>)
  s = s.replace(/(^|[\s(])((https?:\/\/[^\s"<>)]+))/g, '$1<a href="$2" style="color:#2563eb;text-decoration:underline;">$2</a>');
  return s;
}

/** Parse pipe-delimited markdown table rows into cell arrays. */
function parseTableRow(line: string): string[] {
  return line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function markdownToHtml(md: string): string {
  const blocks: string[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) { i++; continue; }

    if (line.trim() === '---') {
      blocks.push('<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">');
      i++;
      continue;
    }

    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const fontSize = [26, 20, 17, 15, 14, 13][level - 1];
      const marginTop = level === 1 ? '0' : '24px';
      const color = level <= 2 ? '#111' : '#333';
      blocks.push(`<h${level} style="font-size:${fontSize}px;margin:${marginTop} 0 10px;font-weight:700;color:${color};line-height:1.3;">${inlineMd(hMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // ── Markdown table ──
    // Detect: header row (| ... | ... |), separator row (|---|---|), then data rows
    if (/^\|.+\|$/.test(line.trim()) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = parseTableRow(line);
      i += 2; // skip header + separator
      const dataRows: string[][] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        dataRows.push(parseTableRow(lines[i]));
        i++;
      }
      const thStyle = 'padding:10px 14px;text-align:left;font-weight:600;color:#111;border-bottom:2px solid #e5e7eb;font-size:13px;text-transform:uppercase;letter-spacing:0.3px;';
      const tdStyle = 'padding:10px 14px;color:#333;border-bottom:1px solid #f0f0f0;font-size:14px;';
      const tdAltBg = 'background:#fafafa;';

      let tableHtml = '<table style="width:100%;border-collapse:collapse;margin:12px 0 20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">';
      tableHtml += '<thead><tr style="background:#f8f9fa;">';
      for (const cell of headerCells) {
        tableHtml += `<th style="${thStyle}">${inlineMd(cell)}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (let r = 0; r < dataRows.length; r++) {
        const bg = r % 2 === 1 ? ` style="${tdAltBg}"` : '';
        tableHtml += `<tr${bg}>`;
        for (let c = 0; c < headerCells.length; c++) {
          const cellText = dataRows[r][c] || '';
          tableHtml += `<td style="${tdStyle}">${inlineMd(cellText)}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      blocks.push(tableHtml);
      continue;
    }

    // Bulleted list
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(inlineMd(lines[i].replace(/^\s*-\s+/, '')));
        i++;
      }
      blocks.push(`<ul style="margin:8px 0 16px;padding-left:22px;color:#333;">${items.map((it) => `<li style="margin:6px 0;line-height:1.55;">${it}</li>`).join('')}</ul>`);
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(inlineMd(lines[i].replace(/^\s*\d+\.\s+/, '')));
        i++;
      }
      blocks.push(`<ol style="margin:8px 0 16px;padding-left:22px;color:#333;">${items.map((it) => `<li style="margin:6px 0;line-height:1.55;">${it}</li>`).join('')}</ol>`);
      continue;
    }

    // Paragraph — gather contiguous non-empty, non-special lines
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*-\s|\s*\d+\.\s|---$|\|.+\|$)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(`<p style="margin:8px 0 14px;color:#333;line-height:1.6;font-size:14px;">${inlineMd(para.join(' '))}</p>`);
  }

  return blocks.join('\n');
}

/**
 * Extract the one-line summary from report markdown.
 * The report format puts the summary as the very first non-empty line,
 * before the H1 heading.
 */
function extractReportSummary(md: string): string {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) break; // hit a heading — no summary line
    // Return the first non-empty, non-heading line
    return trimmed.replace(/\*\*/g, '').replace(/\*/g, '').slice(0, 150);
  }
  return '';
}

async function reportSendGmail(userId: string, input: any): Promise<ToolResult> {
  const md = String(input?.reportMarkdown || '').trim();
  if (!md) return failureResult('reportMarkdown is required.', 'validation_error');

  let token = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  // Resolve recipient = the authed user themselves
  const profRes = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!profRes.ok) return failureResult(`Could not resolve own email (${profRes.status}).`, 'upstream_gmail');
  const profile = await profRes.json();
  const to = profile.emailAddress as string;
  if (!to) return failureResult('Gmail profile returned no email address.', 'upstream_gmail');

  // Subject: use explicit subject, or extract the one-line summary from the
  // report markdown, or fall back to a date-based default.
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const autoSubject = extractReportSummary(md);
  const subject = (input?.subject && String(input.subject).trim())
    || (autoSubject ? `Boult: ${autoSubject}` : `Boult agent report — ${today}`);

  // Professional HTML email template
  const bodyContent = markdownToHtml(md);
  const htmlBody = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>',
    '<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;"><tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">',
    // Header bar
    '<tr><td style="background:#111;padding:20px 32px;">',
    '<span style="color:#fff;font-size:15px;font-weight:700;letter-spacing:0.5px;">BOULT</span>',
    '<span style="color:rgba(255,255,255,0.5);font-size:12px;margin-left:8px;">for Maily</span>',
    '</td></tr>',
    // Body
    '<tr><td style="padding:32px 32px 24px;font-size:14px;color:#333;line-height:1.6;">',
    bodyContent,
    '</td></tr>',
    // Footer
    '<tr><td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0;">',
    '<p style="margin:0;font-size:12px;color:#999;line-height:1.5;">',
    'Sent by <strong style="color:#666;">Boult</strong> for Maily &bull; <a href="https://maily.cfd" style="color:#2563eb;text-decoration:none;">maily.cfd</a>',
    '</p></td></tr>',
    '</table>',
    '</td></tr></table></body></html>',
  ].join('');

  // Build RFC 2822 multipart/alternative so clients with HTML disabled still
  // see the markdown plain text.
  const boundary = `boult-${Date.now().toString(36)}`;
  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    md,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');
  const raw = Buffer.from(mime).toString('base64url');

  const rsgUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const rsgInit = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) };
  let res = await googleFetch(userId, 'gmail', rsgUrl, rsgInit);
  if (res.status === 401) {
    const newToken = await refreshGoogleToken(userId);
    if (newToken) {
      token = newToken;
      res = await googleFetch(userId, 'gmail', rsgUrl, { ...rsgInit, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    }
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return failureResult(`Report send failed (${res.status}): ${err.slice(0, 200)}`, 'send_failed');
  }

  const sent = await res.json();
  return { output: `Sent report to ${to}. Gmail Message ID: ${sent.id}.` };
}

// ── markdown → Slack Block Kit ────────────────────────────────────────────────
// Reports use structured blocks: header with emoji + one-line summary,
// dividers between sections, emoji-prefixed action blocks, and a context
// footer. Slack doesn't support tables natively, so pipe-delimited tables
// are rendered as formatted mrkdwn text with bold labels.

/** Detect action emoji for a Slack section based on the content. */
function slackActionEmoji(text: string): string {
  const lower = text.toLowerCase();
  if (/draft|email|inbox|gmail|reply|sent/.test(lower)) return '📧';
  if (/calendar|meeting|event|booked|schedule/.test(lower)) return '📅';
  if (/notion|page|task|database/.test(lower)) return '📝';
  if (/slack|message|dm|channel/.test(lower)) return '💬';
  if (/⚠️|attention|couldn't|could not|failed|error/.test(lower)) return '⚠️';
  if (/❌/.test(text)) return '❌';
  if (/search|web|memory|fact/.test(lower)) return '🔍';
  return '✅';
}

/** Convert markdown inline to Slack mrkdwn inline. */
function mdToSlackInline(text: string): string {
  let s = text;
  // **bold** → *bold*
  s = s.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  // [text](url) → <url|text>
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>');
  return s;
}

function markdownToSlackBlocks(md: string): any[] {
  const blocks: any[] = [];
  const lines = md.split(/\r?\n/);

  // Extract the one-line summary (first non-empty, non-heading line)
  let summaryLine = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) break;
    summaryLine = trimmed.replace(/\*\*/g, '').replace(/\*/g, '');
    break;
  }

  // Header with the summary
  if (summaryLine) {
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: `✅ ${summaryLine}`.slice(0, 150), emoji: true },
    });
    blocks.push({ type: 'divider' });
  }

  let buffer: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeaders: string[] = [];

  const flushSection = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text) return;
    const slackText = mdToSlackInline(text);
    // Slack section text limit is 3000 chars — chunk if needed
    const CHUNK = 2900;
    for (let ci = 0; ci < slackText.length; ci += CHUNK) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: slackText.slice(ci, ci + CHUNK) } });
    }
  };

  const flushTable = () => {
    if (!tableHeaders.length && !tableRows.length) return;
    // Render each table row as a compact mrkdwn line
    const rowTexts: string[] = [];
    for (const row of tableRows) {
      const parts = tableHeaders.map((h, idx) => `*${mdToSlackInline(h)}:* ${mdToSlackInline(row[idx] || '—')}`);
      const emoji = slackActionEmoji(row.join(' '));
      rowTexts.push(`${emoji} ${parts.join(' • ')}`);
    }
    const text = rowTexts.join('\n\n');
    const CHUNK = 2900;
    for (let ci = 0; ci < text.length; ci += CHUNK) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: text.slice(ci, ci + CHUNK) } });
    }
    tableHeaders = [];
    tableRows = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // Skip the summary line (already in header)
    if (i === 0 && trimmed === summaryLine.trim()) continue;

    if (trimmed === '---') {
      flushSection();
      flushTable();
      blocks.push({ type: 'divider' });
      continue;
    }

    // Heading → Slack header block
    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      flushSection();
      flushTable();
      blocks.push({ type: 'header', text: { type: 'plain_text', text: hMatch[2].slice(0, 150), emoji: true } });
      continue;
    }

    // Table detection: pipe-delimited rows
    if (/^\|.+\|$/.test(trimmed) && !inTable) {
      flushSection();
      // Parse header
      tableHeaders = trimmed.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      // Next line should be separator — skip it
      if (i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
        i++;
      }
      inTable = true;
      continue;
    }
    if (inTable && /^\|.+\|$/.test(trimmed)) {
      tableRows.push(trimmed.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1));
      continue;
    }
    if (inTable) {
      flushTable();
    }

    // Bullet items — render with action emoji
    if (/^\s*-\s+/.test(line)) {
      flushSection();
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*-\s+/, '');
        const emoji = slackActionEmoji(itemText);
        items.push(`${emoji} ${mdToSlackInline(itemText)}`);
        i++;
      }
      i--; // compensate for outer loop increment
      const text = items.join('\n');
      const CHUNK = 2900;
      for (let ci = 0; ci < text.length; ci += CHUNK) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: text.slice(ci, ci + CHUNK) } });
      }
      continue;
    }

    // Footer lines (after ---) → context block
    if (blocks.length > 0 && blocks[blocks.length - 1]?.type === 'divider' &&
      (/^Sent by Boult/i.test(trimmed) || /^Run completed:/i.test(trimmed) || /^Next run:/i.test(trimmed))) {
      // Gather all footer lines
      const footerLines: string[] = [trimmed];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^#/.test(lines[i + 1].trim())) {
        i++;
        footerLines.push(lines[i].trim());
      }
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: footerLines.join(' · ') }],
      });
      continue;
    }

    buffer.push(line);
  }
  flushSection();
  flushTable();

  // Slack rejects messages with more than 50 blocks — trim
  return blocks.slice(0, 50);
}

async function reportSendSlack(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const md = String(input?.reportMarkdown || '').trim();
  if (!md) return failureResult('reportMarkdown is required.', 'validation_error');

  const requestedChannel = (input?.channel || '').trim();
  const isDmSelf = !requestedChannel || requestedChannel.toLowerCase() === 'dm' || requestedChannel.toLowerCase() === 'self';

  // Channel posts: for background agents delivering their own report, skip the
  // approval gate entirely — the report is the output of the agent run and
  // should always be delivered. For interactive (non-agent) sessions, the gate
  // still applies so unexpected channel posts require user confirmation.
  if (!isDmSelf) {
    if (context.isBackgroundAgent) {
      // Background agent report delivery — execute directly without queuing.
      // The cron route also sends the report independently; this is a
      // supplementary in-loop delivery that must not stall on approval.
      const token = await getSlackToken(userId);
      if (!token) return failureResult('Slack is not connected.', 'slack_not_connected');
      const blocks = markdownToSlackBlocks(md);
      const summaryPreview = extractReportSummary(md) || md.slice(0, 200);
      const postRes = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: requestedChannel, blocks, text: summaryPreview }),
        signal: AbortSignal.timeout(10000),
      });
      if (!postRes.ok) return failureResult(`Report post failed (${postRes.status}).`, 'upstream_slack');
      const postData = await postRes.json();
      if (!postData.ok) return failureResult(`Slack error: ${postData.error || 'unknown'}.`, 'upstream_slack');
      return { output: `Sent report to #${requestedChannel}. ts: ${postData.ts}.` };
    }
    // Interactive session — delegate to sendSlackMessage so the executor-level
    // approval gate applies (channel post is an unexpected write action).
    return sendSlackMessage(userId, { channel: requestedChannel, text: md }, context);
  }

  const token = await getSlackToken(userId);
  if (!token) return failureResult('Slack is not connected.', 'slack_not_connected');

  // 1) Open DM with self
  let dmChannel = '';
  try {
    const identityRes = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    const identity = await identityRes.json();
    if (identity.ok && identity.user_id) {
      const dmRes = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: identity.user_id }),
        signal: AbortSignal.timeout(6000),
      });
      const dmData = await dmRes.json();
      if (dmData.ok && dmData.channel?.id) dmChannel = dmData.channel.id;
    }
  } catch { /* fallthrough */ }

  if (!dmChannel) return failureResult('Could not open Slack DM-to-self.', 'upstream_slack');

  // 2) Post with Block Kit
  const blocks = markdownToSlackBlocks(md);

  // Use the summary line as notification preview text
  const summaryPreview = extractReportSummary(md) || md.slice(0, 200);

  const postRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: dmChannel,
      blocks,
      text: summaryPreview, // fallback for notification previews
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!postRes.ok) return failureResult(`Report post failed (${postRes.status}).`, 'upstream_slack');
  const postData = await postRes.json();
  if (!postData.ok) return failureResult(`Slack error: ${postData.error || 'unknown'}.`, 'upstream_slack');

  return { output: `Sent report to DM-to-self. ts: ${postData.ts}.` };
}

// ── Autonomy tools — filter at source, claim, self-check, dedup ───────────────

async function buildWorklistTool(userId: string, input: any): Promise<ToolResult> {
  const agentName = (input?.agentName || '').trim();
  const gmailQuery = (input?.gmailQuery || '').trim();
  if (!agentName) return failureResult('agentName is required.', 'validation_error');
  if (!gmailQuery) return failureResult('gmailQuery is required.', 'validation_error');

  const maxResults = Math.max(1, Math.min(100, Number(input?.maxResults) || 50));
  const clientDomains = new Set<string>(
    Array.isArray(input?.clientDomains)
      ? input.clientDomains.map((d: any) => String(d).toLowerCase().trim()).filter(Boolean)
      : [],
  );

  const {
    buildWorklist,
    loadPreviouslyProcessedIds,
    readActiveClaims,
    scoreEmailLine,
  } = await import('./autonomy');

  // 1. Scan inbox
  const rawSearch = await searchGmail(userId, { query: gmailQuery, maxResults });
  if (rawSearch.success === false) return rawSearch;

  // 2. Parse lines and pull thread ids
  const lines = rawSearch.output.split('\n').filter(l => l.trim());
  const scored: any[] = [];
  for (const line of lines) {
    const idMatch = line.match(/(?:thread(?:Id)?[:=]\s*|^|\s)([0-9a-f]{12,20})\b/i);
    const threadId = idMatch?.[1] || '';
    if (!threadId) continue;
    const item = scoreEmailLine(line, threadId, clientDomains);
    if (item) scored.push(item);
  }

  // 3. Dedup against prior runs + other agents
  const [previouslyProcessed, claimedByOthers] = await Promise.all([
    loadPreviouslyProcessedIds(userId, agentName),
    readActiveClaims(userId),
  ]);

  const worklist = buildWorklist(scored, {
    previouslyProcessedIds: previouslyProcessed,
    claimedByOthers,
  });

  if (!worklist.length) {
    return { output: 'No new items. (All matching threads were processed in a previous run or claimed by another agent.)' };
  }

  return {
    output: JSON.stringify(worklist.slice(0, 50), null, 2),
  };
}

async function claimWorklistItemsTool(userId: string, input: any): Promise<ToolResult> {
  const agentId = (input?.agentId || '').trim();
  const agentName = (input?.agentName || '').trim();
  const itemIds: string[] = Array.isArray(input?.itemIds)
    ? input.itemIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!agentId) return failureResult('agentId is required.', 'validation_error');
  if (!agentName) return failureResult('agentName is required.', 'validation_error');
  if (!itemIds.length) return { output: 'Claimed 0 items.' };

  const { writeClaim } = await import('./autonomy');
  await writeClaim(userId, agentId, agentName, itemIds);
  return { output: `Claimed ${itemIds.length} item${itemIds.length === 1 ? '' : 's'} for ${agentName}.` };
}

function checkDraftQualityTool(input: any): ToolResult {
  const draftBody = (input?.draftBody || '').trim();
  if (!draftBody) return failureResult('draftBody is required.', 'validation_error');

  // Synchronous — no Supabase or HTTP work. Detector is regex-only.
  // We need the import lazy to avoid loading autonomy.ts in unrelated codepaths.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { detectGenericFiller } = require('./autonomy');
  const result = detectGenericFiller(draftBody);
  return { output: JSON.stringify(result, null, 2) };
}

async function recordProcessedItemsTool(userId: string, input: any): Promise<ToolResult> {
  const agentName = (input?.agentName || '').trim();
  const itemIds: string[] = Array.isArray(input?.itemIds)
    ? input.itemIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!agentName) return failureResult('agentName is required.', 'validation_error');
  if (!itemIds.length) return { output: 'Recorded 0 processed items.' };

  const { recordProcessedIds } = await import('./autonomy');
  await recordProcessedIds(userId, agentName, itemIds);
  return { output: `Recorded ${itemIds.length} processed item${itemIds.length === 1 ? '' : 's'} for next-run dedup.` };
}

// ════════════════════════════════════════════════════════════════════════════
// PART 1 — Gmail unlimited / batch / intelligence tools
// ════════════════════════════════════════════════════════════════════════════
//
// Designed for autonomous background-agent use. Each tool is a thin wrapper
// around the existing single-item Gmail tools (search_gmail / read_email /
// draft_reply / send_email / gmail_apply_label / gmail_archive_thread) plus
// parallel batching via Promise.all. Failure of individual items is captured
// in the output; the call as a whole succeeds so the agent loop doesn't bail
// on a single bad item out of 100.

const PART1_BATCH = 25;

async function gmailUnlimitedSearch(userId: string, input: any): Promise<ToolResult> {
  const query = (input?.query || '').trim();
  if (!query) return failureResult('query is required.', 'validation_error');
  const limit = Math.max(1, Math.min(200, Number(input?.maxResults) || 100));

  let token: string | null = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected. Ask the user to connect Gmail in Settings → Integrations.', 'gmail_not_connected');

  let collected: any[] = [];
  let pageToken: string | undefined = undefined;
  while (collected.length < limit) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(100, limit - collected.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const pageUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`;
    let res: Response;
    try {
      res = await gmailGetWithRetry(pageUrl, token, 15000, 3, userId);
    } catch { break; } // transient timeout after retries — stop paginating, keep what we have
    if (res.status === 401) {
      const nt = await refreshGoogleToken(userId);
      if (nt) {
        token = nt;
        try { res = await gmailGetWithRetry(pageUrl, token, 15000, 3, userId); } catch { break; }
      }
    }
    if (!res.ok) break;
    const data = await res.json();
    const messages: any[] = data.messages || [];
    if (!messages.length) break;
    collected = collected.concat(messages);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  if (!collected.length) return { output: `No emails found for "${query}".` };

  const metas: any[] = [];
  for (let i = 0; i < collected.length; i += PART1_BATCH) {
    const slice = collected.slice(i, i + PART1_BATCH);
    const results = await Promise.all(slice.map(async ({ id }: any) => {
      try {
        const r = await googleFetch(userId, 'gmail',
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!r.ok) return null;
        const m = await r.json();
        const h = m.payload?.headers || [];
        return {
          id: m.id,
          threadId: m.threadId,
          from: getHeader(h, 'From'),
          subject: getHeader(h, 'Subject'),
          date: getHeader(h, 'Date'),
          snippet: (m.snippet || '').slice(0, 200),
        };
      } catch { return null; }
    }));
    for (const r of results) if (r) metas.push(r);
  }
  if (!metas.length) return failureResult('Found emails but could not read metadata.', 'upstream_gmail');

  const lines = metas.map((m, i) =>
    `${i + 1}. [ID: ${m.id}] [Thread: ${m.threadId}]\n   From: ${m.from}\n   Subject: ${m.subject}\n   Date: ${m.date}\n   Preview: ${m.snippet}`,
  );
  return { output: `Found ${metas.length} email(s) for "${query}":\n\n${lines.join('\n\n')}` };
}

async function gmailBulkReadThreads(userId: string, input: any): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds)
    ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');

  const results: Array<{ threadId: string; ok: boolean; content: string }> = [];
  for (let i = 0; i < threadIds.length; i += PART1_BATCH) {
    const slice = threadIds.slice(i, i + PART1_BATCH);
    const batchResults = await Promise.all(slice.map(async (tid) => {
      try {
        const r = await gmailReadThread(userId, { threadId: tid });
        return { threadId: tid, ok: r.success !== false, content: r.output };
      } catch (err: any) {
        return { threadId: tid, ok: false, content: `error: ${err.message}` };
      }
    }));
    for (const r of batchResults) results.push(r);
  }
  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const sections = ok.map(r => `=== Thread ${r.threadId} ===\n${r.content}`);
  let output = sections.join('\n\n');
  if (failed.length) output += `\n\n${failed.length} thread(s) failed: ${failed.map(f => f.threadId).join(', ')}`;
  return { output: output || 'No threads could be read.' };
}

async function gmailBatchDraftReplies(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const items: any[] = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) return failureResult('items is required (non-empty array of { threadId, instruction }).', 'validation_error');

  const slice = items.slice(0, 50);
  // The reply BODIES are composed by the model in ONE turn and passed in here,
  // then we save all N Gmail drafts in parallel. This is the fast path: no
  // per-reply LLM tool-call round-trips, so 5+ drafts finish inside the chat
  // deadline. Each draftReply returns its own email_draft canvasData; we harvest
  // those into canvasList so the loop emits one draft card per reply and the
  // client renders the review gallery.
  const results = await Promise.all(slice.map(async (item, idx) => {
    const body = (item.body || '').trim();
    if (!item.threadId || !item.to || !body) {
      return { idx, threadId: item.threadId, ok: false, summary: 'skipped: needs threadId, to, and body', canvasData: undefined as ToolResult['canvasData'] };
    }
    try {
      const r = await draftReply(userId, {
        threadId: item.threadId,
        to: item.to,
        subject: item.subject,
        body,
        recipientName: item.recipientName,
        inReplyToMessageId: item.inReplyToMessageId,
      }, context);
      return { idx, threadId: item.threadId, ok: r.success !== false, summary: r.output.slice(0, 160), canvasData: r.canvasData };
    } catch (err: any) {
      return { idx, threadId: item.threadId, ok: false, summary: `error: ${err.message}`, canvasData: undefined as ToolResult['canvasData'] };
    }
  }));

  const canvasList = results
    .filter(r => r.ok && r.canvasData && r.canvasData.type === 'email_draft')
    .map(r => r.canvasData!) as NonNullable<ToolResult['canvasData']>[];

  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const summary = results.map(r => `${r.idx + 1}. [thread ${r.threadId}] ${r.ok ? 'drafted' : 'failed'} — ${r.summary}`).join('\n');

  // Tell the model to present the gallery and NOT to re-draft or dump bodies.
  const guidance = ok > 0
    ? `\n\n${ok} draft${ok === 1 ? '' : 's'} are now shown to the user as review cards — each can be edited and sent directly from the chat. In your reply, confirm you drafted ${ok} repl${ok === 1 ? 'y' : 'ies'} and tell them to review and send from the cards. Do NOT paste the email bodies. Do NOT call send_email or draft_reply again for these.`
    : '';
  const failNote = failed.length ? `\n\n${failed.length} could not be drafted (see list above).` : '';

  return {
    output: `Drafted ${ok}/${results.length} replies.\n\n${summary}${guidance}${failNote}`,
    canvasList,
  };
}

async function gmailBatchSendEmails(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const items: any[] = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) return failureResult('items is required (non-empty array of { to, subject, body, threadId? }).', 'validation_error');
  const staggerMs = Math.max(0, Math.min(60_000, Number(input?.staggerMs) || 0));

  const slice = items.slice(0, 50);
  const results: Array<{ idx: number; to: string; ok: boolean; summary: string }> = [];
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    try {
      const r = await sendEmail(userId, {
        to: item.to,
        subject: item.subject,
        body: item.body,
        threadId: item.threadId,
      }, context);
      results.push({ idx: i, to: item.to, ok: r.success !== false, summary: r.output.slice(0, 200) });
    } catch (err: any) {
      results.push({ idx: i, to: item.to, ok: false, summary: `error: ${err.message}` });
    }
    if (staggerMs && i < slice.length - 1) {
      await new Promise(res => setTimeout(res, staggerMs));
    }
  }
  const ok = results.filter(r => r.ok).length;
  const summary = results.map(r => `${r.idx + 1}. ${r.to} — ${r.ok ? 'sent' : 'failed'}: ${r.summary}`).join('\n');
  return { output: `Sent ${ok}/${results.length} emails.\n\n${summary}` };
}

async function gmailAutoLabelThreads(userId: string, input: any): Promise<ToolResult> {
  const labelName = (input?.labelName || '').trim();
  const threadIds: string[] = Array.isArray(input?.threadIds)
    ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!labelName) return failureResult('labelName is required.', 'validation_error');
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');

  // Auto-create the label if it doesn't exist. We use the Gmail Labels API
  // directly because gmailApplyLabel already handles the apply, but doesn't
  // create. Idempotent on duplicate creation (409 → reuse existing).
  let token: string | null = await getGmailToken(userId);
  if (!token) return failureResult('Gmail is not connected.', 'gmail_not_connected');

  // List labels and check
  let listRes = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (listRes.status === 401) {
    const nt = await refreshGoogleToken(userId);
    if (nt) {
      token = nt;
      listRes = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  let existed = false;
  if (listRes.ok) {
    const data = await listRes.json();
    existed = (data.labels || []).some((l: any) => l.name?.toLowerCase() === labelName.toLowerCase());
  }
  if (!existed) {
    const createRes = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    if (!createRes.ok && createRes.status !== 409) {
      return failureResult(`Could not create label "${labelName}" (${createRes.status}).`, 'upstream_gmail');
    }
  }

  let applied = 0;
  let failed = 0;
  for (let i = 0; i < threadIds.length; i += PART1_BATCH) {
    const slice = threadIds.slice(i, i + PART1_BATCH);
    await Promise.all(slice.map(async (tid) => {
      try {
        const r = await gmailApplyLabel(userId, { threadId: tid, labelName });
        if (r.success !== false) applied++; else failed++;
      } catch { failed++; }
    }));
  }
  return { output: `Applied label "${labelName}" to ${applied}/${threadIds.length} threads${failed ? ` (${failed} failed)` : ''}.` };
}

async function gmailAutoArchiveThreads(userId: string, input: any): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds)
    ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');

  let archived = 0;
  let failed = 0;
  for (let i = 0; i < threadIds.length; i += PART1_BATCH) {
    const slice = threadIds.slice(i, i + PART1_BATCH);
    await Promise.all(slice.map(async (tid) => {
      try {
        const r = await gmailArchiveThread(userId, { threadId: tid });
        if (r.success !== false) archived++; else failed++;
      } catch { failed++; }
    }));
  }
  return { output: `Archived ${archived}/${threadIds.length} thread(s)${failed ? ` (${failed} failed)` : ''}.` };
}

const EXTRACT_PROMPT_P1 = `You are a data-extraction engine. Given an email thread, return ONLY a JSON object with these fields (omit a field if not present, never invent):
{
  "senders": ["<sender email>", ...],
  "primarySender": "<email>",
  "subject": "<thread subject>",
  "company": "<company name if identifiable>",
  "contactName": "<person name>",
  "contactRole": "<role/title if mentioned>",
  "decisions": ["<decision mentioned>", ...],
  "actionItems": ["<action item with owner if known>", ...],
  "dollarAmounts": ["$50K", "$1.2M", ...],
  "dates": ["2026-06-01", "Friday", ...],
  "projectNames": ["Project X", ...],
  "sentiment": "positive|neutral|negative",
  "urgencyScore": 1-10,
  "summary": "<one-sentence thread summary>"
}
Output ONLY raw JSON. No markdown, no preface.`;

async function gmailExtractDataFromThreads(userId: string, input: any): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds)
    ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');

  const BATCH = 10;
  const extractions: Array<{ threadId: string; data: any; error?: string }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, data: null, error: t.output };
        const res = await callLLM(
          [
            { role: 'system', content: EXTRACT_PROMPT_P1 },
            { role: 'user', content: t.output.slice(0, 8000) },
          ],
          [],
          { maxTokens: 800, temperature: 0.1 },
        );
        const raw = getText(res.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, data: null, error: 'no JSON in extraction' };
        try { return { threadId: tid, data: JSON.parse(m[0]) }; }
        catch (e: any) { return { threadId: tid, data: null, error: `JSON parse error: ${e.message}` }; }
      } catch (err: any) {
        return { threadId: tid, data: null, error: err.message };
      }
    }));
    for (const r of results) extractions.push(r);
  }
  return { output: JSON.stringify(extractions, null, 2) };
}

const CLASSIFY_PROMPT_P1 = `Classify the email thread into one of these categories:
- sales_inquiry
- customer_support
- internal_team
- vendor_supplier
- personal_spam
- partnership_opportunity
- hiring
- feedback_complaint
- update_notification

Output ONLY JSON: { "category": "<one>", "confidence": 0.0-1.0, "reason": "<one short sentence>" }`;

async function gmailDetectConversationType(userId: string, input: any): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds)
    ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');

  const BATCH = 15;
  const out: Array<{ threadId: string; category: string; confidence: number; reason: string }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, category: 'unknown', confidence: 0, reason: 'thread fetch failed' };
        const res = await callLLM(
          [
            { role: 'system', content: CLASSIFY_PROMPT_P1 },
            { role: 'user', content: t.output.slice(0, 4000) },
          ],
          [],
          { maxTokens: 200, temperature: 0.1 },
        );
        const raw = getText(res.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, category: 'unknown', confidence: 0, reason: 'no JSON' };
        try {
          const parsed = JSON.parse(m[0]);
          return {
            threadId: tid,
            category: String(parsed.category || 'unknown'),
            confidence: Number(parsed.confidence) || 0,
            reason: String(parsed.reason || ''),
          };
        } catch { return { threadId: tid, category: 'unknown', confidence: 0, reason: 'parse error' }; }
      } catch (err: any) {
        return { threadId: tid, category: 'unknown', confidence: 0, reason: err.message };
      }
    }));
    for (const r of results) out.push(r);
  }
  return { output: JSON.stringify(out, null, 2) };
}

async function gmailGenerateAutoReplies(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const stalledDays = Math.max(1, Math.min(90, Number(input?.stalledDays) || 5));
  const maxResults = Math.max(1, Math.min(50, Number(input?.maxResults) || 10));

  const q = `in:sent newer_than:${stalledDays + 30}d older_than:${stalledDays}d`;
  const search = await searchGmail(userId, { query: q, maxResults });
  if (search.success === false) return search;

  const threadIdRegex = /\[Thread:\s*([0-9a-f]+)\]/gi;
  const tids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = threadIdRegex.exec(search.output)) !== null) {
    if (m[1]) tids.push(m[1]);
  }
  if (!tids.length) return { output: `No stalled threads older than ${stalledDays} days.` };

  const slice = tids.slice(0, maxResults);
  const drafts = await Promise.all(slice.map(async (tid) => {
    try {
      const r = await draftReply(userId, {
        threadId: tid,
        toneInstruction: `Warm follow-up: it's been ${stalledDays}+ days since my last message. Concise (3-5 sentences), no apology, suggest a concrete next step.`,
        skipVoiceCritique: true,
      }, context);
      return { threadId: tid, ok: r.success !== false, output: r.output.slice(0, 200) };
    } catch (err: any) {
      return { threadId: tid, ok: false, output: `error: ${err.message}` };
    }
  }));
  const ok = drafts.filter(d => d.ok).length;
  const summary = drafts.map((d, i) => `${i + 1}. thread ${d.threadId} — ${d.ok ? 'follow-up drafted' : 'failed'}: ${d.output}`).join('\n');
  return {
    output: `Generated ${ok}/${drafts.length} follow-up drafts for stalled threads (${stalledDays}+ days).\n\n${summary}\n\nCall gmail_batch_send_emails to dispatch them, or review the drafts first.`,
  };
}

const URGENCY_PROMPT_P1 = `Score the email thread's urgency from 1 (no urgency) to 10 (drop everything).
Consider: explicit deadlines, keywords (urgent, ASAP, EOD, today), VIP-language ("CEO", "board"), financial language (contract due, payment late), and time-sensitive requests.
Output ONLY JSON: { "urgencyScore": 1-10, "reason": "<one short sentence>", "needsImmediate": boolean }`;

// ════════════════════════════════════════════════════════════════════════════
// PART 2 — Calendar tools
// ════════════════════════════════════════════════════════════════════════════
//
// All built on top of the existing getCalendarEvents / calendarGetAvailability /
// scheduleMeeting / notionGetCalendarEvents primitives. The blocked tool
// calendar_meeting_summary_generation (needs meeting recordings/transcripts)
// is intentionally not implemented.

async function calendarUnlimitedScan(userId: string, input: any): Promise<ToolResult> {
  const days = Math.max(1, Math.min(365, Number(input?.daysAhead) || 30));
  const max = Math.max(1, Math.min(250, Number(input?.maxResults) || 100));
  const includeNotion = input?.includeNotionCalendar !== false;

  // GCal: paginate up to max
  let token: string | null = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(250, max)),
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;
  let res = await googleFetch(userId, 'gcal', url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    const nt = await refreshGoogleToken(userId);
    if (nt) { token = nt; res = await googleFetch(userId, 'gcal', url, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!res.ok) return failureResult(`Calendar fetch failed (${res.status}).`, 'upstream_gcal');
  const data = await res.json();
  const gcalEvents = (data.items || []).map((e: any) => ({
    source: 'gcal',
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a: any) => a.email),
    meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === 'video')?.uri,
    location: e.location,
    organizer: e.organizer?.email,
    optional: (e.attendees || []).find((a: any) => a.self)?.optional ?? false,
  }));

  // Notion calendar
  let notionEvents: any[] = [];
  if (includeNotion) {
    try {
      // notionGetCalendarEvents needs an explicit ISO window (it ignores
      // daysAhead) — pass the same window we scanned GCal for.
      const n = await notionGetCalendarEvents(userId, {
        startDate: now.toISOString(),
        endDate: end.toISOString(),
        database: input?.notionDatabase,
        databaseId: input?.notionDatabaseId,
      });
      if (n.success !== false) {
        // notionGetCalendarEvents renders each entry as:
        //   "N. <title>\n   When: <start>[ → <end>]\n   ...\n   URL: <url>"
        // Pair each numbered title line with the following "When:" line.
        const lines = n.output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const titleM = lines[i].match(/^\s*\d+\.\s+(.+)$/);
          if (!titleM) continue;
          const whenM = (lines[i + 1] || '').match(/^\s*When:\s*(.+?)(?:\s+→\s+(.+))?$/);
          if (!whenM) continue;
          notionEvents.push({
            source: 'notion',
            id: '',
            title: titleM[1].trim(),
            start: whenM[1].trim(),
            end: whenM[2]?.trim(),
          });
        }
      }
    } catch { /* notion not connected — silent */ }
  }

  const all = [...gcalEvents, ...notionEvents];
  all.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return {
    output: JSON.stringify({
      windowDays: days,
      totalEvents: all.length,
      gcalCount: gcalEvents.length,
      notionCount: notionEvents.length,
      events: all,
    }, null, 2),
  };
}

async function calendarBatchCreateEvents(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const items: any[] = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) return failureResult('items is required (non-empty array of meeting requests).', 'validation_error');

  const slice = items.slice(0, 25);
  const results: Array<{ idx: number; title: string; ok: boolean; summary: string }> = [];
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    try {
      const r = await scheduleMeeting(userId, {
        title: item.title,
        startTime: item.startTime,
        endTime: item.endTime,
        attendees: item.attendees || [],
        description: item.description || '',
        addGoogleMeet: item.addGoogleMeet !== false,
      }, context);
      results.push({ idx: i, title: item.title || '(untitled)', ok: r.success !== false, summary: r.output.slice(0, 200) });
    } catch (err: any) {
      results.push({ idx: i, title: item.title || '(untitled)', ok: false, summary: `error: ${err.message}` });
    }
  }
  const ok = results.filter(r => r.ok).length;
  const summary = results.map(r => `${r.idx + 1}. ${r.title} — ${r.ok ? 'created' : 'failed'}: ${r.summary}`).join('\n');
  return { output: `Created ${ok}/${results.length} events.\n\n${summary}` };
}

async function calendarAutoDetectConflicts(userId: string, input: any): Promise<ToolResult> {
  const days = Math.max(1, Math.min(60, Number(input?.daysAhead) || 7));
  const proposed: Array<{ title?: string; startTime: string; endTime: string }> = Array.isArray(input?.proposedEvents) ? input.proposedEvents : [];

  // Fetch existing events
  const scan = await calendarUnlimitedScan(userId, { daysAhead: days, maxResults: 250, includeNotionCalendar: true });
  if (scan.success === false) return scan;
  let scanData: any;
  try { scanData = JSON.parse(scan.output); } catch { return failureResult('Could not parse calendar scan output.', 'internal_error'); }
  const existing: Array<{ title: string; start: string; end: string; attendees?: string[] }> = scanData.events || [];

  const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => {
    const as = new Date(aStart).getTime();
    const ae = new Date(aEnd).getTime();
    const bs = new Date(bStart).getTime();
    const be = new Date(bEnd).getTime();
    if (isNaN(as) || isNaN(ae) || isNaN(bs) || isNaN(be)) return false;
    return as < be && bs < ae;
  };

  // Internal conflicts (existing-vs-existing)
  const internal: Array<{ a: string; b: string; when: string }> = [];
  for (let i = 0; i < existing.length; i++) {
    for (let j = i + 1; j < existing.length; j++) {
      const a = existing[i];
      const b = existing[j];
      if (!a.start || !a.end || !b.start || !b.end) continue;
      if (overlaps(a.start, a.end, b.start, b.end)) {
        internal.push({ a: a.title, b: b.title, when: a.start });
      }
    }
  }

  // Back-to-back (less than 10 min between events)
  const backToBack: Array<{ first: string; second: string; gapMin: number }> = [];
  const sorted = [...existing].filter(e => e.start && e.end).sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length - 1; i++) {
    const endA = new Date(sorted[i].end).getTime();
    const startB = new Date(sorted[i + 1].start).getTime();
    if (isNaN(endA) || isNaN(startB)) continue;
    const gap = (startB - endA) / 60000;
    if (gap >= 0 && gap < 10) {
      backToBack.push({ first: sorted[i].title, second: sorted[i + 1].title, gapMin: Math.round(gap) });
    }
  }

  // Proposed-vs-existing conflicts
  const proposedConflicts: Array<{ proposed: string; conflictsWith: string; when: string }> = [];
  for (const p of proposed) {
    if (!p.startTime || !p.endTime) continue;
    for (const e of existing) {
      if (!e.start || !e.end) continue;
      if (overlaps(p.startTime, p.endTime, e.start, e.end)) {
        proposedConflicts.push({ proposed: p.title || '(unnamed)', conflictsWith: e.title, when: p.startTime });
      }
    }
  }

  return {
    output: JSON.stringify({
      windowDays: days,
      internalOverlaps: internal,
      backToBackTight: backToBack,
      proposedConflicts,
      noConflicts: internal.length === 0 && proposedConflicts.length === 0,
    }, null, 2),
  };
}

async function calendarAutoDeclineLowPriority(userId: string, input: any): Promise<ToolResult> {
  const days = Math.max(1, Math.min(30, Number(input?.daysAhead) || 7));
  const dryRun = input?.dryRun !== false; // default: dry run

  const scan = await calendarUnlimitedScan(userId, { daysAhead: days, maxResults: 100 });
  if (scan.success === false) return scan;
  const scanData = JSON.parse(scan.output);
  const events: any[] = scanData.events || [];

  // Heuristic for "low priority": marked optional, or informational webinar
  // patterns in title, or vendor demo without VIP attendees.
  const LOW_PRIORITY_PATTERNS = /\b(webinar|info session|demo|all-?hands\s+(optional|opt-?in)|stand[- ]?up|sync(?:\s+\(optional\))?|optional|fyi)\b/i;
  const candidates = events.filter(e => {
    if (e.source !== 'gcal' || !e.id) return false;
    if (e.optional) return true;
    if (LOW_PRIORITY_PATTERNS.test(e.title || '')) return true;
    return false;
  });

  if (!candidates.length) return { output: 'No low-priority meetings detected in the window.' };
  if (dryRun) {
    return {
      output: JSON.stringify({
        dryRun: true,
        candidates: candidates.map(c => ({ id: c.id, title: c.title, start: c.start, reason: c.optional ? 'marked optional' : 'matches low-priority pattern' })),
        toExecute: 'Set dryRun=false to actually decline these.',
      }, null, 2),
    };
  }

  let token: string | null = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  let declined = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${c.id}?sendUpdates=externalOnly`;
      // Need to set attendees[self].responseStatus = 'declined'
      const getRes = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${c.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!getRes.ok) { failed++; continue; }
      const ev = await getRes.json();
      const attendees = (ev.attendees || []).map((a: any) => a.self ? { ...a, responseStatus: 'declined' } : a);
      const patchRes = await googleFetch(userId, 'gcal', patchUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendees }),
      });
      if (patchRes.ok) declined++; else failed++;
    } catch { failed++; }
  }
  return { output: `Declined ${declined}/${candidates.length} low-priority meetings${failed ? ` (${failed} failed)` : ''}.` };
}

async function calendarGenerateFreeTimeBlocks(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const days = Math.max(1, Math.min(14, Number(input?.daysAhead) || 5));
  const minHours = Math.max(1, Math.min(8, Number(input?.minBlockHours) || 2));
  const blocksPerDay = Math.max(1, Math.min(4, Number(input?.maxBlocksPerDay) || 1));

  // Use freeBusy via calendarGetAvailability
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const avail = await calendarGetAvailability(userId, {
    startDate: now.toISOString(),
    endDate: end.toISOString(),
    minSlotMinutes: minHours * 60,
  });
  if (avail.success === false) return avail;

  // Parse free slots heuristically from the availability output
  // calendarGetAvailability emits "Free: <iso> – <iso>" lines
  const FREE_LINE = /Free:\s*([0-9T:\-Z+\.]+)\s*[–-]\s*([0-9T:\-Z+\.]+)/g;
  const freeSlots: Array<{ start: string; end: string; day: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = FREE_LINE.exec(avail.output)) !== null) {
    const start = m[1];
    const day = start.slice(0, 10);
    freeSlots.push({ start, end: m[2], day });
  }

  // Pick top N slots per day
  const byDay = new Map<string, Array<{ start: string; end: string }>>();
  for (const s of freeSlots) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day)!.push(s);
  }
  const picks: Array<{ start: string; end: string }> = [];
  for (const slots of byDay.values()) {
    // Prefer morning blocks (start hour 8-11)
    slots.sort((a, b) => {
      const ah = new Date(a.start).getHours();
      const bh = new Date(b.start).getHours();
      const score = (h: number) => Math.abs(h - 9.5);
      return score(ah) - score(bh);
    });
    for (const s of slots.slice(0, blocksPerDay)) picks.push(s);
  }

  if (!picks.length) return { output: 'No suitable free blocks of ' + minHours + 'h+ found.' };

  const dryRun = input?.dryRun === true;
  if (dryRun) {
    return { output: JSON.stringify({ dryRun: true, picks }, null, 2) };
  }

  // Create the Focus blocks
  let created = 0;
  let failed = 0;
  for (const p of picks) {
    try {
      const r = await scheduleMeeting(userId, {
        title: '🎯 Focus Time',
        startTime: p.start,
        endTime: p.end,
        attendees: [],
        description: 'Auto-generated focus block. Decline meetings during this time when possible.',
        addGoogleMeet: false,
      }, context);
      if (r.success !== false) created++; else failed++;
    } catch { failed++; }
  }
  return { output: `Created ${created}/${picks.length} focus blocks${failed ? ` (${failed} failed)` : ''}.` };
}

async function calendarMeetingPrepAutomation(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const eventId = (input?.eventId || '').trim();
  const lookaheadHours = Math.max(1, Math.min(72, Number(input?.lookaheadHours) || 24));
  if (!eventId && !input?.scanWindow) return failureResult('Either eventId or scanWindow=true is required.', 'validation_error');

  let token: string | null = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  // Determine target events: either the named one, or all in lookahead window
  let targets: any[] = [];
  if (eventId) {
    const getRes = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!getRes.ok) return failureResult(`Calendar event fetch failed (${getRes.status}).`, 'upstream_gcal');
    targets = [await getRes.json()];
  } else {
    const now = new Date();
    const end = new Date(now.getTime() + lookaheadHours * 3600000);
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '20',
    });
    const res = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return failureResult(`Calendar fetch failed (${res.status}).`, 'upstream_gcal');
    const data = await res.json();
    targets = (data.items || []).filter((e: any) => (e.attendees || []).some((a: any) => !a.self));
  }

  if (!targets.length) return { output: 'No external meetings found in the window — no prep needed.' };

  const preps: Array<{ eventId: string; title: string; prep: string }> = [];
  for (const ev of targets) {
    const externalAttendees: string[] = (ev.attendees || []).filter((a: any) => !a.self && a.email).map((a: any) => a.email);
    if (!externalAttendees.length) continue;

    // Recent emails with each attendee
    const emailContexts: string[] = [];
    for (const email of externalAttendees.slice(0, 3)) {
      try {
        const s = await searchGmail(userId, { query: `from:${email} OR to:${email}`, maxResults: 5 });
        if (s.success !== false) emailContexts.push(`### Recent emails with ${email}\n${s.output.slice(0, 1500)}`);
      } catch { /* skip */ }
    }

    // Memory context
    let memoryCtx = '';
    try {
      const { searchMemoriesRaw } = await import('./memory');
      const items = await searchMemoriesRaw(userId, externalAttendees.join(' '), 5);
      if (items.length) memoryCtx = '### Memory context\n' + items.map(i => `• ${i.text}`).join('\n');
    } catch { /* skip */ }

    // Compose prep via LLM
    const prepInput = [
      `Meeting: ${ev.summary || '(no title)'}`,
      `When: ${ev.start?.dateTime || ev.start?.date}`,
      `Attendees: ${externalAttendees.join(', ')}`,
      `Description: ${ev.description || '(none)'}`,
      '',
      ...emailContexts,
      '',
      memoryCtx,
    ].join('\n');
    const prepRes = await callLLM(
      [
        {
          role: 'system',
          content: 'Generate a tight one-page meeting prep doc in markdown. Sections: ## Context · ## Recent Interactions · ## Talking Points · ## Watch For. Be specific. No filler. No bracketed placeholders.',
        },
        { role: 'user', content: prepInput },
      ],
      [],
      { maxTokens: 1200, temperature: 0.3 },
    );
    preps.push({ eventId: ev.id, title: ev.summary || '(no title)', prep: getText(prepRes.content).trim() });
  }

  // Optionally save each to Notion + patch event description with a marker
  const saveToNotion = input?.saveToNotion !== false;
  const savedNotes: string[] = [];
  if (saveToNotion) {
    for (const p of preps) {
      try {
        const n = await createNotionPage(userId, {
          title: `Meeting Prep: ${p.title}`,
          databaseHint: 'meetings',
          content: p.prep,
        }, context);
        if (n.success !== false) savedNotes.push(`${p.title}: saved to Notion`);
      } catch { /* skip */ }
    }
  }

  return {
    output: JSON.stringify({
      meetingsPrepped: preps.length,
      preps: preps.map(p => ({ eventId: p.eventId, title: p.title, prepPreview: p.prep.slice(0, 400) })),
      notion: savedNotes,
    }, null, 2),
  };
}

async function calendarAutoGenerateMeetLinks(userId: string, input: any): Promise<ToolResult> {
  const days = Math.max(1, Math.min(30, Number(input?.daysAhead) || 14));
  let token: string | null = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  let listRes = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (listRes.status === 401) {
    const nt = await refreshGoogleToken(userId);
    if (nt) { token = nt; listRes = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token}` } }); }
  }
  if (!listRes.ok) return failureResult(`Calendar fetch failed (${listRes.status}).`, 'upstream_gcal');
  const data = await listRes.json();
  const events: any[] = data.items || [];

  // Filter: external attendees + no existing Meet link
  const candidates = events.filter(e => {
    const hasExternal = (e.attendees || []).some((a: any) => !a.self && a.email);
    const hasLink = !!(e.hangoutLink || e.conferenceData?.entryPoints?.length);
    return hasExternal && !hasLink;
  });

  if (!candidates.length) return { output: 'All external meetings already have Meet links.' };

  let added = 0;
  let failed = 0;
  for (const ev of candidates) {
    try {
      const patchRes = await googleFetch(userId, 'gcal',
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}?conferenceDataVersion=1&sendUpdates=all`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conferenceData: {
              createRequest: {
                requestId: `boult-${ev.id}-${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            },
          }),
        },
      );
      if (patchRes.ok) added++; else failed++;
    } catch { failed++; }
  }
  return { output: `Added Google Meet links to ${added}/${candidates.length} external meetings${failed ? ` (${failed} failed)` : ''}.` };
}

async function calendarBufferTimeInsertion(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const days = Math.max(1, Math.min(7, Number(input?.daysAhead) || 2));
  const bufferMin = Math.max(5, Math.min(60, Number(input?.bufferMinutes) || 15));
  const dryRun = input?.dryRun !== false;

  const scan = await calendarUnlimitedScan(userId, { daysAhead: days, maxResults: 100, includeNotionCalendar: false });
  if (scan.success === false) return scan;
  const scanData = JSON.parse(scan.output);
  const sorted = (scanData.events as any[])
    .filter(e => e.source === 'gcal' && e.start && e.end)
    .sort((a, b) => a.start.localeCompare(b.start));

  const gaps: Array<{ afterTitle: string; bufferStart: string; bufferEnd: string }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const endA = new Date(sorted[i].end).getTime();
    const startB = new Date(sorted[i + 1].start).getTime();
    if (isNaN(endA) || isNaN(startB)) continue;
    const gap = (startB - endA) / 60000;
    if (gap > 0 && gap < bufferMin) {
      gaps.push({
        afterTitle: sorted[i].title,
        bufferStart: new Date(endA).toISOString(),
        bufferEnd: new Date(endA + bufferMin * 60000).toISOString(),
      });
    }
  }

  if (!gaps.length) return { output: 'No back-to-back meetings within the buffer window — schedule is already breathing.' };
  if (dryRun) {
    return { output: JSON.stringify({ dryRun: true, gapsFound: gaps.length, gaps }, null, 2) };
  }

  let added = 0;
  for (const g of gaps) {
    try {
      const r = await scheduleMeeting(userId, {
        title: '☕ Buffer',
        startTime: g.bufferStart,
        endTime: g.bufferEnd,
        attendees: [],
        description: `Auto-inserted ${bufferMin}-minute buffer after "${g.afterTitle}".`,
        addGoogleMeet: false,
      }, context);
      if (r.success !== false) added++;
    } catch { /* skip */ }
  }
  return { output: `Inserted ${added}/${gaps.length} buffer blocks (${bufferMin} min each).` };
}

// ════════════════════════════════════════════════════════════════════════════
// PART 3 — Notion tools
// ════════════════════════════════════════════════════════════════════════════
//
// All built on existing createNotionPage / searchNotion / fetchNotionSchemaForAgent
// primitives. Notion data extraction uses callLLM for semantic parsing.

const CONTACT_EXTRACT_PROMPT = `Extract contact details from an email thread. Output ONLY JSON:
{
  "name": "<person name>",
  "email": "<primary email>",
  "company": "<company name>",
  "role": "<job title if mentioned>",
  "phone": "<phone if mentioned>",
  "relationship": "client|vendor|partner|prospect|internal|unknown",
  "firstContactDate": "<ISO date>",
  "notes": "<one-line summary of who they are>"
}
Omit any field that's not in the source. Do not invent.`;

async function notionAutoCreateContactProfiles(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds) ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');
  const databaseHint = (input?.databaseHint || 'contacts').trim();

  const BATCH = 8;
  const results: Array<{ threadId: string; ok: boolean; summary: string }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, ok: false, summary: `thread fetch failed: ${t.output.slice(0, 100)}` };
        const r = await callLLM(
          [
            { role: 'system', content: CONTACT_EXTRACT_PROMPT },
            { role: 'user', content: t.output.slice(0, 6000) },
          ],
          [], { maxTokens: 400, temperature: 0.1 },
        );
        const raw = getText(r.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, ok: false, summary: 'no JSON extracted' };
        let extracted: any;
        try { extracted = JSON.parse(m[0]); } catch { return { threadId: tid, ok: false, summary: 'JSON parse error' }; }
        if (!extracted.name && !extracted.email) return { threadId: tid, ok: false, summary: 'no contact details found' };

        const title = extracted.name || extracted.email || 'Unknown contact';
        const content = [
          `# ${title}`,
          extracted.email ? `**Email:** ${extracted.email}` : '',
          extracted.company ? `**Company:** ${extracted.company}` : '',
          extracted.role ? `**Role:** ${extracted.role}` : '',
          extracted.phone ? `**Phone:** ${extracted.phone}` : '',
          extracted.relationship ? `**Relationship:** ${extracted.relationship}` : '',
          extracted.firstContactDate ? `**First Contact:** ${extracted.firstContactDate}` : '',
          '',
          extracted.notes ? `## Notes\n${extracted.notes}` : '',
        ].filter(Boolean).join('\n');

        const created = await createNotionPage(userId, {
          title,
          databaseHint,
          content,
        }, context);
        return {
          threadId: tid,
          ok: created.success !== false,
          summary: `${title} → ${created.output.slice(0, 100)}`,
        };
      } catch (err: any) {
        return { threadId: tid, ok: false, summary: `error: ${err.message}` };
      }
    }));
    for (const r of batchResults) results.push(r);
  }

  const ok = results.filter(r => r.ok).length;
  const summary = results.map((r, i) => `${i + 1}. [thread ${r.threadId}] ${r.ok ? 'created' : 'skipped'}: ${r.summary}`).join('\n');
  return { output: `Created ${ok}/${results.length} contact profiles.\n\n${summary}` };
}

const COMM_LOG_PROMPT = `Summarize this email thread for a CRM log. Output ONLY JSON:
{
  "subject": "<thread subject>",
  "primaryContact": "<email of main external party>",
  "decisions": ["<decision>", ...],
  "actionItems": [{"who": "<owner>", "what": "<action>", "when": "<deadline if any>"}, ...],
  "nextStep": "<one-line next step>",
  "deadline": "<ISO date if mentioned, else null>",
  "dealStage": "prospect|qualified|proposal|negotiation|closed_won|closed_lost|null",
  "sentiment": "positive|neutral|negative"
}`;

async function notionAutoLogAllCommunication(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds) ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (!threadIds.length) return failureResult('threadIds is required.', 'validation_error');
  const databaseHint = (input?.databaseHint || 'communications').trim();

  const BATCH = 6;
  const results: Array<{ threadId: string; ok: boolean; summary: string }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, ok: false, summary: 'thread fetch failed' };
        const r = await callLLM(
          [{ role: 'system', content: COMM_LOG_PROMPT }, { role: 'user', content: t.output.slice(0, 6000) }],
          [], { maxTokens: 600, temperature: 0.1 },
        );
        const raw = getText(r.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, ok: false, summary: 'no JSON' };
        let data: any;
        try { data = JSON.parse(m[0]); } catch { return { threadId: tid, ok: false, summary: 'parse error' }; }

        const content = [
          `# ${data.subject || '(no subject)'}`,
          data.primaryContact ? `**Contact:** ${data.primaryContact}` : '',
          data.dealStage ? `**Deal Stage:** ${data.dealStage}` : '',
          data.sentiment ? `**Sentiment:** ${data.sentiment}` : '',
          data.deadline ? `**Deadline:** ${data.deadline}` : '',
          '',
          data.decisions?.length ? `## Decisions\n${data.decisions.map((d: string) => `- ${d}`).join('\n')}` : '',
          '',
          data.actionItems?.length ? `## Action Items\n${data.actionItems.map((a: any) => `- ${a.who ? `**${a.who}**: ` : ''}${a.what}${a.when ? ` (due ${a.when})` : ''}`).join('\n')}` : '',
          '',
          data.nextStep ? `## Next Step\n${data.nextStep}` : '',
          '',
          `_Thread ID: ${tid}_`,
        ].filter(Boolean).join('\n');

        const created = await createNotionPage(userId, {
          title: data.subject || `Communication ${tid}`,
          databaseHint,
          content,
        }, context);
        return { threadId: tid, ok: created.success !== false, summary: created.output.slice(0, 100) };
      } catch (err: any) {
        return { threadId: tid, ok: false, summary: err.message };
      }
    }));
    for (const r of batchResults) results.push(r);
  }
  const ok = results.filter(r => r.ok).length;
  return { output: `Logged ${ok}/${results.length} communications to Notion (database: ${databaseHint}).\n\n${results.map((r, i) => `${i + 1}. ${r.threadId} — ${r.summary}`).join('\n')}` };
}

async function notionBatchCreateDatabaseEntries(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const items: any[] = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) return failureResult('items is required.', 'validation_error');
  const databaseHint = (input?.databaseHint || '').trim();

  const slice = items.slice(0, 50);
  const results = await Promise.all(slice.map(async (item, idx) => {
    try {
      const r = await createNotionPage(userId, {
        title: item.title,
        databaseHint: item.databaseHint || databaseHint,
        content: item.content || '',
        properties: item.properties,
      }, context);
      return { idx, title: item.title, ok: r.success !== false, summary: r.output.slice(0, 120) };
    } catch (err: any) {
      return { idx, title: item.title, ok: false, summary: `error: ${err.message}` };
    }
  }));
  const ok = results.filter(r => r.ok).length;
  return { output: `Created ${ok}/${results.length} Notion entries.\n\n${results.map(r => `${r.idx + 1}. ${r.title} — ${r.ok ? 'created' : 'failed'}: ${r.summary}`).join('\n')}` };
}

const PROJECT_STATUS_PROMPT = `From this email, extract a project status update. Output ONLY JSON:
{
  "projectName": "<project name or null>",
  "statusUpdate": "<one-sentence status change, or null if no update>",
  "completionPercent": <0-100 or null>,
  "nextMilestone": "<description or null>",
  "nextMilestoneDate": "<ISO date or null>",
  "atRisk": <boolean — true if blockers/delays mentioned>,
  "riskReason": "<short reason or null>"
}`;

async function notionAutoUpdateProjectStatus(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds) ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (!threadIds.length) return failureResult('threadIds is required.', 'validation_error');

  const BATCH = 6;
  const updates: Array<{ threadId: string; projectName: string | null; statusUpdate: string | null; ok: boolean; notionOutput?: string }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, projectName: null, statusUpdate: null, ok: false };
        const r = await callLLM(
          [{ role: 'system', content: PROJECT_STATUS_PROMPT }, { role: 'user', content: t.output.slice(0, 4000) }],
          [], { maxTokens: 400, temperature: 0.1 },
        );
        const raw = getText(r.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, projectName: null, statusUpdate: null, ok: false };
        let data: any;
        try { data = JSON.parse(m[0]); } catch { return { threadId: tid, projectName: null, statusUpdate: null, ok: false }; }
        if (!data.projectName || !data.statusUpdate) return { threadId: tid, projectName: data.projectName, statusUpdate: data.statusUpdate, ok: false };

        // Append a status update as a new Notion page (linked via title to the project)
        const content = [
          `# Status update: ${data.projectName}`,
          data.statusUpdate ? `**Update:** ${data.statusUpdate}` : '',
          typeof data.completionPercent === 'number' ? `**Completion:** ${data.completionPercent}%` : '',
          data.nextMilestone ? `**Next milestone:** ${data.nextMilestone}${data.nextMilestoneDate ? ` (${data.nextMilestoneDate})` : ''}` : '',
          data.atRisk ? `\n⚠️ **AT RISK** — ${data.riskReason || 'See thread for details.'}` : '',
          `\n_Source thread: ${tid}_`,
        ].filter(Boolean).join('\n');

        const created = await createNotionPage(userId, {
          title: `${data.projectName} — status update`,
          databaseHint: 'projects',
          content,
        }, context);
        return { threadId: tid, projectName: data.projectName, statusUpdate: data.statusUpdate, ok: created.success !== false, notionOutput: created.output.slice(0, 100) };
      } catch {
        return { threadId: tid, projectName: null, statusUpdate: null, ok: false };
      }
    }));
    for (const r of batchResults) updates.push(r);
  }
  const ok = updates.filter(u => u.ok).length;
  return { output: `Logged ${ok}/${threadIds.length} project status updates. Threads without a project mention were skipped silently.` };
}

async function notionAutoGenerateMeetingNotes(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const eventId = (input?.eventId || '').trim();
  if (!eventId) return failureResult('eventId is required.', 'validation_error');

  let token: string | null = await getGcalToken(userId);
  if (!token) return failureResult('Google Calendar is not connected.', 'gcal_not_connected');

  const evRes = await googleFetch(userId, 'gcal', `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!evRes.ok) return failureResult(`Calendar event fetch failed (${evRes.status}).`, 'upstream_gcal');
  const ev = await evRes.json();

  const attendees: string[] = (ev.attendees || []).map((a: any) => a.email).filter(Boolean);
  const content = [
    `# ${ev.summary || 'Meeting'} — notes`,
    `**Date:** ${ev.start?.dateTime || ev.start?.date}`,
    `**Attendees:** ${attendees.join(', ') || '(none)'}`,
    ev.location ? `**Location:** ${ev.location}` : '',
    '',
    '## Discussion',
    '_(fill in)_',
    '',
    '## Decisions',
    '_(fill in)_',
    '',
    '## Action Items',
    '- [ ] _(owner — task — due date)_',
    '',
    '## Next Steps',
    '_(fill in)_',
  ].filter(Boolean).join('\n');

  const created = await createNotionPage(userId, {
    title: `${ev.summary || 'Meeting'} — ${(ev.start?.dateTime || ev.start?.date || '').slice(0, 10)}`,
    databaseHint: 'meetings',
    content,
  }, context);
  return { output: created.output };
}

const DEAL_EXTRACT_PROMPT = `Extract sales deal info from this email thread. Output ONLY JSON:
{
  "company": "<company name>",
  "primaryContact": "<contact name + email>",
  "stage": "prospect|qualified|proposal|negotiation|closed_won|closed_lost",
  "dealValue": "<dollar amount as number or string>",
  "probability": <0-100 confidence in close>,
  "timeline": "<expected close date or timeframe>",
  "nextAction": "<one-sentence next step>",
  "signals": ["<positive signal>", "<negative signal>", ...]
}
Omit fields you can't determine. Do not invent dollar amounts.`;

async function notionDealTrackingAutomation(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds) ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (!threadIds.length) return failureResult('threadIds is required.', 'validation_error');

  const BATCH = 5;
  const deals: Array<{ threadId: string; company: string | null; stage: string | null; ok: boolean; notionOutput?: string }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const batchResults = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, company: null, stage: null, ok: false };
        const r = await callLLM(
          [{ role: 'system', content: DEAL_EXTRACT_PROMPT }, { role: 'user', content: t.output.slice(0, 6000) }],
          [], { maxTokens: 500, temperature: 0.1 },
        );
        const raw = getText(r.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, company: null, stage: null, ok: false };
        let d: any;
        try { d = JSON.parse(m[0]); } catch { return { threadId: tid, company: null, stage: null, ok: false }; }
        if (!d.company || !d.stage) return { threadId: tid, company: d.company, stage: d.stage, ok: false };

        const content = [
          `# ${d.company} — ${d.stage}`,
          d.primaryContact ? `**Contact:** ${d.primaryContact}` : '',
          d.dealValue ? `**Value:** ${d.dealValue}` : '',
          typeof d.probability === 'number' ? `**Probability:** ${d.probability}%` : '',
          d.timeline ? `**Timeline:** ${d.timeline}` : '',
          d.nextAction ? `**Next action:** ${d.nextAction}` : '',
          '',
          d.signals?.length ? `## Signals\n${d.signals.map((s: string) => `- ${s}`).join('\n')}` : '',
          `\n_Source thread: ${tid}_`,
        ].filter(Boolean).join('\n');

        const created = await createNotionPage(userId, {
          title: `${d.company} — ${d.stage}`,
          databaseHint: 'deals',
          content,
        }, context);
        return { threadId: tid, company: d.company, stage: d.stage, ok: created.success !== false, notionOutput: created.output.slice(0, 100) };
      } catch {
        return { threadId: tid, company: null, stage: null, ok: false };
      }
    }));
    for (const r of batchResults) deals.push(r);
  }
  const ok = deals.filter(d => d.ok).length;
  return { output: `Tracked ${ok}/${threadIds.length} deals. Threads without identifiable deal info were skipped silently.\n\n${deals.filter(d => d.company).map((d, i) => `${i + 1}. ${d.company} (${d.stage}) — ${d.ok ? 'logged' : 'extract failed'}`).join('\n')}` };
}

async function notionCreateSmartDashboards(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const kind = (input?.kind || 'business').toLowerCase();
  const title = (input?.title || `Daily ${kind} dashboard — ${new Date().toISOString().slice(0, 10)}`).trim();

  // Aggregate from connected sources via the existing tools
  const blocks: string[] = [`# ${title}`, ''];

  // Inbox snapshot
  try {
    const inbox = await searchGmail(userId, { query: 'is:unread', maxResults: 5 });
    if (inbox.success !== false) blocks.push('## 📧 Inbox snapshot', inbox.output.slice(0, 1200), '');
  } catch { /* skip */ }
  // Calendar snapshot
  try {
    const cal = await getCalendarEvents(userId, { daysAhead: 3, maxResults: 10 });
    if (cal.success !== false) blocks.push('## 📅 Next 3 days', cal.output.slice(0, 1200), '');
  } catch { /* skip */ }
  // Memory context — recent
  try {
    const { searchMemoriesRaw } = await import('./memory');
    const items = await searchMemoriesRaw(userId, 'this week', 5);
    if (items.length) blocks.push('## 🧠 Recent context', items.map(i => `- ${i.text}`).join('\n'), '');
  } catch { /* skip */ }

  const content = blocks.join('\n');
  const created = await createNotionPage(userId, {
    title,
    databaseHint: `${kind}_dashboards`,
    content,
  }, context);
  return { output: created.output };
}

async function notionLinkRelatedItems(userId: string, input: any): Promise<ToolResult> {
  // Notion's relation API is database-schema-dependent. The pragmatic
  // implementation: search for related pages by name and return a list of
  // (sourcePageId → relatedPageId, relationField) suggestions. The user/agent
  // can then patch them manually with the correct relation column.
  const pageId = (input?.pageId || '').trim();
  const relatedQuery = (input?.relatedQuery || '').trim();
  if (!pageId || !relatedQuery) return failureResult('pageId and relatedQuery are required.', 'validation_error');

  const search = await searchNotion(userId, { query: relatedQuery, maxResults: 10 });
  if (search.success === false) return search;

  return {
    output: [
      `Source page: ${pageId}`,
      `Related pages matching "${relatedQuery}":`,
      '',
      search.output,
      '',
      'To link them: open the source page, find the matching relation column (e.g. "Related Deals"), and paste the page references. Relation patching via API requires the target relation property name in the source database schema — call fetch_notion_schema first if unsure.',
    ].join('\n'),
  };
}

async function notionAutoArchiveCompletedWork(userId: string, input: any): Promise<ToolResult> {
  const databaseHint = (input?.databaseHint || 'tasks').trim();
  const statusPropName = (input?.statusProperty || 'Status').trim();
  const completedValues: string[] = Array.isArray(input?.completedValues) ? input.completedValues : ['Done', 'Completed', 'Closed', 'Shipped'];

  // Find the database via schema fetcher
  const schemaResp = await fetchNotionSchemaForAgent(userId, { databaseHint });
  if (schemaResp.success === false) return schemaResp;
  const dbMatch = schemaResp.output.match(/database_id:\s*([0-9a-f-]{30,})/i);
  if (!dbMatch) return failureResult(`Could not find a database matching "${databaseHint}".`, 'not_found');
  const databaseId = dbMatch[1];

  const dryRun = input?.dryRun === true;
  const maxArchive = Math.max(1, Math.min(Number(input?.maxArchive) || 50, 100));

  const token = await getNotionToken(userId);
  if (!token) return failureResult('Notion is not connected. Connect Notion in Settings → Integrations first.', 'notion_not_connected');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  // Resolve the status property's real name + type ('status' vs 'select') so the
  // filter uses the correct shape — Notion rejects a filter that references the
  // wrong property type.
  let propName = statusPropName;
  let propType: 'status' | 'select' = 'status';
  try {
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, { headers, signal: AbortSignal.timeout(10000) });
    if (dbRes.ok) {
      const db = await dbRes.json();
      const props = db.properties || {};
      const match = Object.keys(props).find(k => k.toLowerCase() === statusPropName.toLowerCase())
        || Object.keys(props).find(k => props[k]?.type === 'status' || props[k]?.type === 'select');
      if (match) {
        propName = match;
        propType = props[match]?.type === 'select' ? 'select' : 'status';
      }
    }
  } catch { /* fall back to defaults (status/Status) */ }

  // Find completed pages: OR across the completed status values.
  const filter = { or: completedValues.map(v => ({ property: propName, [propType]: { equals: v } })) };
  const matched: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 5 && matched.length < maxArchive; page++) {
      const body: any = { page_size: 100, filter };
      if (cursor) body.start_cursor = cursor;
      const qRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
      });
      if (!qRes.ok) {
        const err = await qRes.text().catch(() => '');
        return failureResult(`Notion query failed (${qRes.status}): ${err.slice(0, 200)}`, 'upstream_notion');
      }
      const qData = await qRes.json();
      for (const row of (qData.results || [])) {
        const titleKey = Object.keys(row.properties || {}).find(k => row.properties[k]?.type === 'title');
        const title = titleKey ? richTextToString(row.properties[titleKey]?.title || []) : '(untitled)';
        matched.push({ id: row.id, title: title || '(untitled)' });
        if (matched.length >= maxArchive) break;
      }
      if (!qData.has_more) break;
      cursor = qData.next_cursor;
    }
  } catch (e: any) {
    return failureResult(`Notion query error: ${e?.message || e}`, 'upstream_notion');
  }

  if (!matched.length) {
    return { output: `Nothing to archive in "${databaseHint}" — no pages with ${propName} ∈ [${completedValues.join(', ')}].` };
  }

  if (dryRun) {
    return {
      output: [
        `Would archive ${matched.length} completed page${matched.length !== 1 ? 's' : ''} in "${databaseHint}" (${propName} ∈ [${completedValues.join(', ')}]):`,
        ...matched.map((m, i) => `${i + 1}. ${m.title}`),
        '',
        'Re-run without dryRun to archive these (Notion archive is reversible — pages go to Trash).',
      ].join('\n'),
    };
  }

  // Archive each matched page: PATCH /v1/pages/{id} { archived: true }. Sequential
  // to stay within Notion rate limits; capped at maxArchive so one call is bounded.
  let archived = 0;
  const failures: string[] = [];
  for (const m of matched) {
    try {
      const pRes = await fetch(`https://api.notion.com/v1/pages/${m.id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ archived: true }), signal: AbortSignal.timeout(10000),
      });
      if (pRes.ok) archived++;
      else failures.push(`${m.title} (${pRes.status})`);
    } catch (e: any) {
      failures.push(`${m.title} (${e?.message || 'error'})`);
    }
  }

  return {
    output: [
      `Archived ${archived} completed page${archived !== 1 ? 's' : ''} in "${databaseHint}" (${propName} ∈ [${completedValues.join(', ')}]). They're in Notion's Trash and can be restored.`,
      ...(archived ? matched.slice(0, archived).map((m, i) => `${i + 1}. ${m.title}`) : []),
      ...(failures.length ? ['', `Could not archive ${failures.length}: ${failures.slice(0, 5).join('; ')}`] : []),
    ].join('\n'),
  };
}

async function notionGenerateWeeklySummaries(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const weekLabel = (input?.weekLabel || `Week of ${new Date().toISOString().slice(0, 10)}`).trim();

  // Aggregate: emails handled (estimated from sent count), meetings held, deals progressed
  const blocks: string[] = [`# ${weekLabel} — Weekly Summary`, ''];

  try {
    const sent = await searchGmail(userId, { query: 'in:sent newer_than:7d', maxResults: 25 });
    if (sent.success !== false) {
      const count = (sent.output.match(/\[ID:/g) || []).length;
      blocks.push(`## 📧 Communication\n- ${count} emails sent this week`, '');
    }
  } catch { /* skip */ }

  try {
    const cal = await getCalendarEvents(userId, { daysAhead: -7, maxResults: 50 });
    if (cal.success !== false) {
      blocks.push('## 📅 Meetings', cal.output.slice(0, 1500), '');
    }
  } catch { /* skip */ }

  try {
    const { searchMemoriesRaw } = await import('./memory');
    const items = await searchMemoriesRaw(userId, '[AGENT_RUN]', 10);
    if (items.length) {
      blocks.push('## 🤖 Agent activity', items.map(i => `- ${i.text.slice(0, 250)}`).join('\n'), '');
    }
  } catch { /* skip */ }

  const content = blocks.join('\n');
  const created = await createNotionPage(userId, {
    title: weekLabel,
    databaseHint: 'weekly_summaries',
    content,
  }, context);
  return { output: created.output };
}

// ════════════════════════════════════════════════════════════════════════════
// PART 8 — Orchestration / utility tools
// ════════════════════════════════════════════════════════════════════════════

async function agentTaskQueueManagement(userId: string, input: any): Promise<ToolResult> {
  // Returns the agent's recommended task ordering based on a simple priority
  // model — Tier 1 client work first, Tier 2 revenue, Tier 3 scheduling, then
  // anything else. Pairs with build_worklist (which already does Tier scoring)
  // but is callable on a free-form list of tasks the LLM holds.
  const tasks: any[] = Array.isArray(input?.tasks) ? input.tasks : [];
  if (!tasks.length) return failureResult('tasks is required.', 'validation_error');

  const KEYWORDS = {
    1: /\b(client|contract|deal|signed|invoice|payment|revenue|proposal|sow|renewal|negotiat)\b/i,
    2: /\b(prospect|qualified|inquir|lead|demo|pitch|pricing|quote)\b/i,
    3: /\b(meeting|schedule|book|availability|calendar|invite|sync|call)\b/i,
  };
  const scored = tasks.map((t, idx) => {
    const text = JSON.stringify(t);
    let tier = 4;
    if (KEYWORDS[1].test(text)) tier = 1;
    else if (KEYWORDS[2].test(text)) tier = 2;
    else if (KEYWORDS[3].test(text)) tier = 3;
    return { originalIndex: idx, tier, task: t };
  });
  scored.sort((a, b) => a.tier - b.tier);

  // Group adjacent same-tool tasks for batching hints
  const batches: Array<{ tier: number; tasks: any[]; suggestion: string }> = [];
  let cur: { tier: number; tasks: any[]; tool?: string } | null = null;
  for (const s of scored) {
    const tool = (s.task.tool || '').toLowerCase();
    if (cur && cur.tier === s.tier && cur.tool === tool) {
      cur.tasks.push(s.task);
    } else {
      if (cur) batches.push({ tier: cur.tier, tasks: cur.tasks, suggestion: cur.tool ? `Batch via ${cur.tool}` : 'Process sequentially' });
      cur = { tier: s.tier, tasks: [s.task], tool };
    }
  }
  if (cur) batches.push({ tier: cur.tier, tasks: cur.tasks, suggestion: cur.tool ? `Batch via ${cur.tool}` : 'Process sequentially' });

  return { output: JSON.stringify({ totalTasks: tasks.length, prioritized: scored, batches }, null, 2) };
}

async function errorRecoveryAndRetries(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  // Retry-with-backoff wrapper for any tool. The LLM provides the tool name,
  // input, max attempts (default 3), and initial backoff ms (default 1000).
  const toolName = (input?.toolName || '').trim();
  const toolInput = input?.toolInput || {};
  const maxAttempts = Math.max(1, Math.min(5, Number(input?.maxAttempts) || 3));
  const initialBackoffMs = Math.max(100, Math.min(5000, Number(input?.initialBackoffMs) || 1000));
  if (!toolName) return failureResult('toolName is required.', 'validation_error');

  const attempts: Array<{ attempt: number; ok: boolean; output: string; backoffMsBefore?: number }> = [];
  let backoff = initialBackoffMs;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) {
      attempts[i - 1].backoffMsBefore = backoff;
      await new Promise(r => setTimeout(r, backoff));
      backoff *= 2;
    }
    try {
      const r = await executeTool(toolName, toolInput, userId, context);
      attempts.push({ attempt: i + 1, ok: r.success !== false, output: r.output.slice(0, 300) });
      if (r.success !== false) {
        return { output: JSON.stringify({ ok: true, finalAttempt: i + 1, attempts }, null, 2) };
      }
    } catch (err: any) {
      attempts.push({ attempt: i + 1, ok: false, output: `threw: ${err.message}` });
    }
  }
  return {
    output: JSON.stringify({
      ok: false,
      finalAttempt: maxAttempts,
      attempts,
      escalate: 'All attempts failed. Surface the failure to the user with the first attempt\'s error message in plain English; do not silently retry beyond this.',
    }, null, 2),
  };
}

async function performanceMonitoringAndOptimization(userId: string, input: any): Promise<ToolResult> {
  // Query the existing boult_audit_log table for the agent's recent stats
  const days = Math.max(1, Math.min(30, Number(input?.days) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_audit_log')
      .select('tool_name, success, duration_ms, created_at')
      .eq('user_id', normalizeUserId(userId))
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return failureResult(`Audit log query failed: ${error.message}`, 'upstream_db');

    const rows = data || [];
    if (!rows.length) return { output: 'No audit log activity in the window.' };

    // Aggregate
    const byTool = new Map<string, { calls: number; ok: number; fail: number; totalMs: number; maxMs: number }>();
    for (const r of rows) {
      const name = r.tool_name as string;
      if (!byTool.has(name)) byTool.set(name, { calls: 0, ok: 0, fail: 0, totalMs: 0, maxMs: 0 });
      const stats = byTool.get(name)!;
      stats.calls++;
      if (r.success) stats.ok++; else stats.fail++;
      const ms = Number(r.duration_ms) || 0;
      stats.totalMs += ms;
      if (ms > stats.maxMs) stats.maxMs = ms;
    }
    const report = [...byTool.entries()]
      .map(([name, s]) => ({
        tool: name,
        calls: s.calls,
        successRate: Math.round((s.ok / s.calls) * 100),
        avgMs: Math.round(s.totalMs / s.calls),
        maxMs: s.maxMs,
      }))
      .sort((a, b) => b.calls - a.calls);

    const bottlenecks = report.filter(r => r.avgMs > 3000).map(r => `${r.tool} avg ${r.avgMs}ms`);
    const errorProne = report.filter(r => r.successRate < 80 && r.calls >= 3).map(r => `${r.tool} ${r.successRate}%`);

    return {
      output: JSON.stringify({
        windowDays: days,
        totalCalls: rows.length,
        perTool: report,
        bottlenecks,
        errorProneTools: errorProne,
        recommendation: bottlenecks.length > 0 || errorProne.length > 0
          ? 'Consider batching slow tools (Promise.all wrapper) or adding retries for error-prone tools.'
          : 'No bottlenecks. Performance looks healthy.',
      }, null, 2),
    };
  } catch (err: any) {
    return failureResult(`Performance scan failed: ${err.message}`, 'internal_error');
  }
}

async function outputFormattingAndPresentation(userId: string, input: any): Promise<ToolResult> {
  // LLM-callable formatter. Takes a "raw" string (data dump) and a target
  // format (briefing | report | slack-mrkdwn | email-html), returns the
  // formatted output. The agent uses this at the end of a run to turn its
  // accumulated work into a clean deliverable.
  const content = (input?.content || '').trim();
  const format = (input?.format || 'briefing').toLowerCase();
  const title = (input?.title || '').trim();
  if (!content) return failureResult('content is required.', 'validation_error');

  const formatInstructions: Record<string, string> = {
    briefing: 'Format as a concise executive briefing in markdown. Lead with a 1-line summary. Use tables for >3 items. Bold key numbers. No filler. Section emojis (💰 🤝 ⚙️ ⚠️ 🔗) at section headers only.',
    report: 'Format as a structured report in markdown. Use H1 title, H2 sections. Tables for tabular data. Be specific. No filler. Insert a 1-line summary as the first paragraph.',
    'slack-mrkdwn': 'Format as Slack mrkdwn: *bold* with single asterisks, _italic_ with underscores, no markdown headings (use *Section Name* on its own line instead). Targeted emojis. No tables (Slack mrkdwn does not support them; use bullet lists instead).',
    'email-html': 'Format as a clean HTML email. Inline styles only. Bordered tables. Bold key metrics. No external CSS. No emojis in HTML attributes.',
  };
  const instruction = formatInstructions[format] || formatInstructions.briefing;

  const r = await callLLM(
    [
      { role: 'system', content: `You are a formatter. ${instruction} Do not add information not present in the input.` },
      { role: 'user', content: title ? `Title: ${title}\n\nContent:\n${content.slice(0, 10000)}` : content.slice(0, 10000) },
    ],
    [], { maxTokens: 3000, temperature: 0.2 },
  );
  return { output: getText(r.content).trim() };
}

// ════════════════════════════════════════════════════════════════════════════
// PART 7 — Web & external research tools
// ════════════════════════════════════════════════════════════════════════════

async function webSearchUnlimited(userId: string, input: any): Promise<ToolResult> {
  const queries: string[] = Array.isArray(input?.queries) ? input.queries.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (!queries.length) return failureResult('queries is required (non-empty array).', 'validation_error');
  const perQueryLimit = Math.max(1, Math.min(15, Number(input?.perQueryLimit) || 5));

  const slice = queries.slice(0, 20);
  const results = await Promise.all(slice.map(async (q) => {
    try {
      const r = await webSearch({ query: q, maxResults: perQueryLimit });
      return { query: q, ok: r.success !== false, output: r.output.slice(0, 2500) };
    } catch (err: any) {
      return { query: q, ok: false, output: `error: ${err.message}` };
    }
  }));
  return { output: JSON.stringify(results, null, 2) };
}

const COMPANY_RESEARCH_PROMPT = `Distill the search results into a company intelligence profile. Output ONLY JSON:
{
  "company": "<name>",
  "summary": "<one-paragraph overview>",
  "industry": "<industry>",
  "size": "<headcount or revenue estimate>",
  "fundingStage": "<seed/series A-D/public/private/unknown>",
  "recentFunding": "<latest round if mentioned>",
  "leadership": ["<name — title>", ...],
  "recentNews": ["<headline + date>", ...],
  "competitors": ["<competitor>", ...],
  "signals": ["<positive signal>", "<negative signal>", ...]
}
Only include fields you have evidence for. Do not invent.`;

async function companyIntelligenceResearch(userId: string, input: any): Promise<ToolResult> {
  const company = (input?.company || '').trim();
  if (!company) return failureResult('company is required.', 'validation_error');

  const queries = [
    `${company} company overview`,
    `${company} funding raised`,
    `${company} CEO leadership`,
    `${company} news 2026`,
    `${company} competitors`,
  ];
  const searches = await Promise.all(queries.map(async (q) => {
    try {
      const r = await webSearch({ query: q, maxResults: 5 });
      return r.success !== false ? r.output.slice(0, 2000) : '';
    } catch { return ''; }
  }));
  const corpus = searches.filter(Boolean).join('\n\n---\n\n');
  if (!corpus) return failureResult('No web search results found.', 'no_results');

  const r = await callLLM(
    [{ role: 'system', content: COMPANY_RESEARCH_PROMPT }, { role: 'user', content: `Company: ${company}\n\nSearch results:\n${corpus}` }],
    [], { maxTokens: 1500, temperature: 0.2 },
  );
  const raw = getText(r.content).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return failureResult('Could not extract intelligence JSON.', 'internal_error');
  try {
    return { output: JSON.stringify(JSON.parse(m[0]), null, 2) };
  } catch (e: any) {
    return failureResult(`JSON parse failed: ${e.message}`, 'internal_error');
  }
}

const CONTACT_VERIFY_PROMPT = `Given web search results about a person, return ONLY JSON:
{
  "name": "<name>",
  "verifiedEmail": "<email if confirmed in results>",
  "title": "<job title>",
  "company": "<current company>",
  "profileUrl": "<LinkedIn or other professional URL if found>",
  "background": "<one-paragraph bio>",
  "confidence": "high|medium|low",
  "warnings": ["<any red flag>", ...]
}
LinkedIn API access is not available — this verification uses public web results only. Be conservative; set confidence "low" when evidence is thin.`;

async function contactResearchAndVerification(userId: string, input: any): Promise<ToolResult> {
  const name = (input?.name || '').trim();
  const company = (input?.company || '').trim();
  const email = (input?.email || '').trim();
  if (!name && !email) return failureResult('Either name or email is required.', 'validation_error');

  // 1. Basic email-format check
  const emailFormatOk = email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : null;
  // 2. Web search for the person
  const queries = [
    name && company ? `${name} ${company}` : null,
    name ? `${name} LinkedIn` : null,
    email ? `${email} site:linkedin.com` : null,
    email ? email : null,
  ].filter(Boolean) as string[];
  const searches = await Promise.all(queries.slice(0, 5).map(async (q) => {
    try {
      const r = await webSearch({ query: q, maxResults: 5 });
      return r.success !== false ? r.output.slice(0, 1500) : '';
    } catch { return ''; }
  }));
  const corpus = searches.filter(Boolean).join('\n\n---\n\n');
  if (!corpus) return { output: JSON.stringify({ name, email, emailFormatOk, confidence: 'low', warnings: ['No web search results found.'] }, null, 2) };

  const r = await callLLM(
    [{ role: 'system', content: CONTACT_VERIFY_PROMPT }, { role: 'user', content: `Subject: ${name || email}${company ? ` at ${company}` : ''}\n\nSearch results:\n${corpus}` }],
    [], { maxTokens: 1200, temperature: 0.2 },
  );
  const raw = getText(r.content).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { output: JSON.stringify({ name, email, emailFormatOk, confidence: 'low', warnings: ['Could not parse verification output.'] }, null, 2) };
  try {
    const parsed = JSON.parse(m[0]);
    parsed.emailFormatOk = emailFormatOk;
    return { output: JSON.stringify(parsed, null, 2) };
  } catch {
    return { output: JSON.stringify({ name, email, emailFormatOk, confidence: 'low', warnings: ['JSON parse failed.'] }, null, 2) };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PART 6 — Content generation tools
// ════════════════════════════════════════════════════════════════════════════

const EMAIL_SEQUENCE_PROMPT = `Generate an email follow-up sequence in the user's voice. Each email is concise (3-6 sentences), personalized, and builds on the previous step.
Output ONLY JSON: { "emails": [ { "dayOffset": <number>, "subject": "<subject>", "body": "<plain text body>" }, ... ] }
No markdown, no preface.`;

async function generateEmailSequence(userId: string, input: any): Promise<ToolResult> {
  const recipientContext = (input?.recipientContext || '').trim();
  const goal = (input?.goal || '').trim();
  const dayOffsets: number[] = Array.isArray(input?.dayOffsets) ? input.dayOffsets : [1, 3, 7, 10, 14];
  if (!goal) return failureResult('goal is required (what the sequence should achieve).', 'validation_error');

  const userInput = [
    `Goal: ${goal}`,
    recipientContext ? `Recipient context: ${recipientContext}` : '',
    `Send schedule (days from start): ${dayOffsets.join(', ')}`,
    'Generate one email per day offset.',
  ].filter(Boolean).join('\n');

  const r = await callLLM(
    [{ role: 'system', content: EMAIL_SEQUENCE_PROMPT }, { role: 'user', content: userInput }],
    [], { maxTokens: 2500, temperature: 0.4 },
  );
  const raw = getText(r.content).trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return failureResult('Could not extract sequence JSON.', 'internal_error');
  try {
    const parsed = JSON.parse(m[0]);
    return { output: JSON.stringify(parsed, null, 2) };
  } catch (e: any) {
    return failureResult(`Sequence JSON parse failed: ${e.message}`, 'internal_error');
  }
}

const PROPOSAL_PROMPT = `Generate a professional proposal in markdown. Structure:
# <Proposal title>
## Executive summary
## Scope of work
## Deliverables
## Timeline
## Pricing
## Terms
## Next steps

Be specific. No bracketed placeholders. If pricing details aren't provided, mark "TBD" explicitly rather than inventing numbers.`;

async function generateProposalDocuments(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const clientName = (input?.clientName || '').trim();
  const requirements = (input?.requirements || '').trim();
  const pricing = (input?.pricing || '').trim();
  const timeline = (input?.timeline || '').trim();
  if (!clientName) return failureResult('clientName is required.', 'validation_error');
  if (!requirements) return failureResult('requirements is required.', 'validation_error');

  const userInput = [
    `Client: ${clientName}`,
    `Requirements:\n${requirements}`,
    pricing ? `Pricing:\n${pricing}` : 'Pricing: (mark as TBD)',
    timeline ? `Timeline:\n${timeline}` : 'Timeline: (mark as TBD)',
  ].join('\n\n');

  const r = await callLLM(
    [{ role: 'system', content: PROPOSAL_PROMPT }, { role: 'user', content: userInput }],
    [], { maxTokens: 3000, temperature: 0.3 },
  );
  const markdown = getText(r.content).trim();

  return {
    output: `Proposal generated for ${clientName}. Length: ${markdown.length} chars. Use open_canvas to display, or save to Notion via create_notion_page.`,
    canvasData: {
      title: `Proposal — ${clientName}`,
      type: 'report',
      markdown,
    },
  };
}

const CLIENT_REPORT_PROMPT = `Generate a client-specific monthly report in markdown. Structure:
# <Client name> — <Month Year> report
## Summary (one paragraph)
## Activity
- emails exchanged
- meetings held
- deliverables shipped
## Progress on goals
## Next month's plan
## Recommendations

Be specific. Pull metrics from the data provided. Do not invent numbers.`;

async function generateClientReports(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const clientName = (input?.clientName || '').trim();
  const monthLabel = (input?.monthLabel || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })).trim();
  const clientEmail = (input?.clientEmail || '').trim();
  if (!clientName) return failureResult('clientName is required.', 'validation_error');

  // Aggregate client-specific data
  const sections: string[] = [];
  if (clientEmail) {
    try {
      const recent = await searchGmail(userId, { query: `(from:${clientEmail} OR to:${clientEmail}) newer_than:30d`, maxResults: 15 });
      if (recent.success !== false) sections.push(`### Recent emails (30 days):\n${recent.output.slice(0, 2500)}`);
    } catch { /* skip */ }
  }
  try {
    const { searchMemoriesRaw } = await import('./memory');
    const items = await searchMemoriesRaw(userId, clientName, 10);
    if (items.length) sections.push(`### Memory context:\n${items.map(i => `- ${i.text}`).join('\n')}`);
  } catch { /* skip */ }

  const userInput = [
    `Client: ${clientName}`,
    `Period: ${monthLabel}`,
    '',
    ...sections,
  ].join('\n');

  const r = await callLLM(
    [{ role: 'system', content: CLIENT_REPORT_PROMPT }, { role: 'user', content: userInput }],
    [], { maxTokens: 2500, temperature: 0.3 },
  );
  const markdown = getText(r.content).trim();

  return {
    output: `Client report generated for ${clientName} — ${monthLabel}.`,
    canvasData: {
      title: `${clientName} — ${monthLabel} report`,
      type: 'report',
      markdown,
    },
  };
}

const SOW_PROMPT = `Generate a Statement of Work in markdown. Structure:
# Statement of Work — <project>
## 1. Project overview
## 2. Scope of work (bullet list of deliverables)
## 3. Timeline & milestones
## 4. Pricing & payment terms
## 5. Acceptance criteria
## 6. Out of scope
## 7. Terms

Be specific. Extract dates, dollar amounts, and deliverables from the source content. No placeholders.`;

async function generateSowDocuments(userId: string, input: any): Promise<ToolResult> {
  const projectName = (input?.projectName || '').trim();
  const sourceContent = (input?.sourceContent || '').trim();
  const threadIds: string[] = Array.isArray(input?.threadIds) ? input.threadIds : [];
  if (!projectName) return failureResult('projectName is required.', 'validation_error');

  let combinedSource = sourceContent;
  if (!combinedSource && threadIds.length) {
    const bulk = await gmailBulkReadThreads(userId, { threadIds: threadIds.slice(0, 5) });
    if (bulk.success !== false) combinedSource = bulk.output;
  }
  if (!combinedSource) return failureResult('Either sourceContent or threadIds must be provided.', 'validation_error');

  const r = await callLLM(
    [{ role: 'system', content: SOW_PROMPT }, { role: 'user', content: `Project: ${projectName}\n\nNegotiation source:\n${combinedSource.slice(0, 12000)}` }],
    [], { maxTokens: 3500, temperature: 0.3 },
  );
  const markdown = getText(r.content).trim();
  return {
    output: `SOW generated for ${projectName}. ${markdown.length} chars.`,
    canvasData: {
      title: `SOW — ${projectName}`,
      type: 'report',
      markdown,
    },
  };
}

async function generateInternalDocumentation(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const topic = (input?.topic || '').trim();
  const sourceContent = (input?.sourceContent || '').trim();
  if (!topic) return failureResult('topic is required.', 'validation_error');
  if (!sourceContent) return failureResult('sourceContent is required.', 'validation_error');

  const r = await callLLM(
    [
      { role: 'system', content: 'Generate a how-to / runbook in markdown for an internal team wiki. Structure: # <topic> · ## When to use · ## Steps (numbered) · ## Edge cases · ## Related. Be specific. No placeholders.' },
      { role: 'user', content: `Topic: ${topic}\n\nSource:\n${sourceContent.slice(0, 8000)}` },
    ],
    [], { maxTokens: 2500, temperature: 0.3 },
  );
  const markdown = getText(r.content).trim();
  // Save to Notion in internal-docs DB
  const created = await createNotionPage(userId, {
    title: `Runbook: ${topic}`,
    databaseHint: 'internal_docs',
    content: markdown,
  }, context);
  return { output: created.output };
}

// ════════════════════════════════════════════════════════════════════════════
// PART 5 — Memory autonomy tools
// ════════════════════════════════════════════════════════════════════════════

async function memoryUnlimitedScan(userId: string, input: any): Promise<ToolResult> {
  const queries: string[] = Array.isArray(input?.queries) ? input.queries.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (!queries.length) return failureResult('queries is required (non-empty array of search strings).', 'validation_error');
  const perQueryLimit = Math.max(1, Math.min(20, Number(input?.perQueryLimit) || 10));

  const { searchMemoriesRaw } = await import('./memory');
  const out: Record<string, any[]> = {};
  for (const q of queries.slice(0, 20)) {
    try {
      const items = await searchMemoriesRaw(userId, q, perQueryLimit);
      out[q] = items;
    } catch {
      out[q] = [];
    }
  }
  return { output: JSON.stringify(out, null, 2) };
}

async function memoryBulkSaveLearning(userId: string, input: any): Promise<ToolResult> {
  const items: any[] = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) return failureResult('items is required (array of { content, tags? }).', 'validation_error');

  const { saveMemory } = await import('./memory');
  const slice = items.slice(0, 100);
  let saved = 0;
  let failed = 0;
  await Promise.all(slice.map(async (item) => {
    try {
      const content = String(item.content || '').trim();
      if (!content) { failed++; return; }
      const tags = Array.isArray(item.tags) ? item.tags : [];
      await saveMemory(userId, content, tags);
      saved++;
    } catch { failed++; }
  }));
  return { output: `Saved ${saved}/${slice.length} memory entries${failed ? ` (${failed} failed)` : ''}.` };
}

async function memoryRelationshipIntelligence(userId: string, input: any): Promise<ToolResult> {
  const contactEmail = (input?.contactEmail || '').trim().toLowerCase();
  if (!contactEmail) return failureResult('contactEmail is required.', 'validation_error');

  // Aggregate signals: persisted contact row, memory search for [RELATIONSHIP],
  // recent sent/received emails to estimate response patterns.
  const sections: any = {
    contactEmail,
    metrics: {} as any,
    memoryContext: [] as any[],
    riskFlags: [] as string[],
  };

  // Persisted relationship row
  try {
    const profileResp = await memoryGetContactProfile(userId, { contactEmail });
    if (profileResp.success !== false) {
      sections.persistedProfile = profileResp.output.slice(0, 1500);
    }
  } catch { /* skip */ }

  // Memory items
  try {
    const { searchMemoriesRaw } = await import('./memory');
    const items = await searchMemoriesRaw(userId, contactEmail, 10);
    sections.memoryContext = items.map(i => ({ text: i.text, when: i.timestamp, tags: i.tags }));
  } catch { /* skip */ }

  // Response-time pattern: sent-to-them then received-from-them in same thread.
  // Cheap heuristic: count of threads, last contact, average gap.
  try {
    const sentToThem = await searchGmail(userId, { query: `to:${contactEmail}`, maxResults: 10 });
    const fromThem = await searchGmail(userId, { query: `from:${contactEmail}`, maxResults: 10 });
    const sentCount = (sentToThem.output.match(/\[ID:/g) || []).length;
    const recvCount = (fromThem.output.match(/\[ID:/g) || []).length;
    sections.metrics.emailsSent = sentCount;
    sections.metrics.emailsReceived = recvCount;
    sections.metrics.totalExchanges = sentCount + recvCount;
    sections.metrics.replyRatio = sentCount > 0 ? Math.round((recvCount / sentCount) * 100) / 100 : null;

    // Risk: lots of outbound, no inbound → ghosted
    if (sentCount >= 3 && recvCount === 0) sections.riskFlags.push('No replies received — likely ghosted.');
    // Risk: outbound > 2x inbound
    if (sentCount > recvCount * 2 + 2) sections.riskFlags.push('Lopsided exchange — they reply less than half as often.');
  } catch { /* skip */ }

  // Tag the relationship
  let tier: 'cold' | 'warm' | 'hot' = 'cold';
  if (sections.metrics.totalExchanges >= 10) tier = 'hot';
  else if (sections.metrics.totalExchanges >= 3) tier = 'warm';
  sections.relationshipTier = tier;

  return { output: JSON.stringify(sections, null, 2) };
}

// ════════════════════════════════════════════════════════════════════════════
// PART 4 — Slack autonomy tools
// ════════════════════════════════════════════════════════════════════════════
//
// Six of the eight spec tools. Blocked (not built):
//   - slack_meeting_transcription_summaries (needs meeting recording source)
//   - slack_bot_command_interface (needs a Slack Events API endpoint + a
//     /boult slash-command registered in the Slack app manifest — out of
//     scope for the agent tool layer; belongs in app/api/slack/...).

async function slackPostDailyBriefing(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const channel = (input?.channel || '').trim() || 'dm';

  // Aggregate
  const sections: string[] = [`*📋 Daily briefing — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}*`, ''];

  try {
    const inbox = await searchGmail(userId, { query: 'is:unread newer_than:1d', maxResults: 10 });
    if (inbox.success !== false) {
      const count = (inbox.output.match(/\[ID:/g) || []).length;
      sections.push(`📧 *Inbox:* ${count} unread email(s)`);
    }
  } catch { /* skip */ }

  try {
    const cal = await getCalendarEvents(userId, { daysAhead: 1, maxResults: 10 });
    if (cal.success !== false) {
      const eventCount = (cal.output.match(/^\d+\./gm) || []).length;
      sections.push(`📅 *Today's meetings:* ${eventCount}`);
    }
  } catch { /* skip */ }

  try {
    const followups = await searchGmail(userId, { query: 'in:sent older_than:5d newer_than:30d', maxResults: 5 });
    if (followups.success !== false) {
      const count = (followups.output.match(/\[ID:/g) || []).length;
      if (count > 0) sections.push(`⏰ *Stalled follow-ups:* ${count} thread(s) older than 5 days`);
    }
  } catch { /* skip */ }

  sections.push('', '_Sent by Boult · maily.cfd_');
  const text = sections.join('\n');

  const send = await sendSlackMessage(userId, { channel, text }, context);
  return send;
}

async function slackRealTimeUrgentAlerts(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds) ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean) : [];
  const channel = (input?.channel || '').trim() || 'dm';
  const urgencyThreshold = Math.max(1, Math.min(10, Number(input?.urgencyThreshold) || 7));

  if (!threadIds.length) return failureResult('threadIds is required.', 'validation_error');

  // Reuse gmail_detect_urgency
  const urgency = await gmailDetectUrgency(userId, { threadIds });
  if (urgency.success === false) return urgency;

  let scored: Array<{ threadId: string; urgencyScore: number; reason: string; needsImmediate: boolean }> = [];
  try { scored = JSON.parse(urgency.output); } catch { return failureResult('Urgency parse failed.', 'internal_error'); }
  const urgent = scored.filter(s => s.urgencyScore >= urgencyThreshold);
  if (!urgent.length) return { output: `No threads scored ≥ ${urgencyThreshold}. No alert sent.` };

  const blocks = urgent.map((u, i) => `${i + 1}. ⚠️ *Thread ${u.threadId}* — score ${u.urgencyScore}/10\n   ${u.reason}`).join('\n');
  const text = [
    `🚨 *${urgent.length} urgent thread(s) detected*`,
    '',
    blocks,
    '',
    '_Boult background scan · review immediately._',
  ].join('\n');

  return await sendSlackMessage(userId, { channel, text }, context);
}

async function slackTeamDigestWeekly(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const channel = (input?.channel || '#team-digest').trim();

  const sections: string[] = [`*📊 Weekly team digest — week of ${new Date().toISOString().slice(0, 10)}*`, ''];

  try {
    const sent = await searchGmail(userId, { query: 'in:sent newer_than:7d', maxResults: 25 });
    if (sent.success !== false) {
      const count = (sent.output.match(/\[ID:/g) || []).length;
      sections.push(`📧 *Emails sent:* ${count}`);
    }
  } catch { /* skip */ }

  try {
    const cal = await getCalendarEvents(userId, { daysAhead: -7, maxResults: 50 });
    if (cal.success !== false) {
      const eventCount = (cal.output.match(/^\d+\./gm) || []).length;
      sections.push(`📅 *Meetings held:* ${eventCount}`);
    }
  } catch { /* skip */ }

  try {
    const { searchMemoriesRaw } = await import('./memory');
    const items = await searchMemoriesRaw(userId, '[AGENT_RUN]', 10);
    if (items.length) sections.push(`🤖 *Agent runs:* ${items.length} background runs this week`);
  } catch { /* skip */ }

  sections.push('', '_Sent by Boult · maily.cfd_');
  const text = sections.join('\n');

  return await sendSlackMessage(userId, { channel, text }, context);
}

async function slackDealUpdateNotifications(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const channel = (input?.channel || '#sales-pipeline').trim();
  const updates: any[] = Array.isArray(input?.updates) ? input.updates : [];
  if (!updates.length) return failureResult('updates is required (array of { company, fromStage, toStage, value?, nextAction? }).', 'validation_error');

  const slice = updates.slice(0, 25);
  const results: Array<{ company: string; ok: boolean }> = [];
  for (const u of slice) {
    const text = [
      `💰 *${u.company}*${u.value ? ` (${u.value})` : ''}`,
      `${u.fromStage || '?'} → ${u.toStage || '?'}`,
      u.nextAction ? `\nNext: ${u.nextAction}` : '',
    ].filter(Boolean).join('\n');
    const r = await sendSlackMessage(userId, { channel, text }, context);
    results.push({ company: u.company, ok: r.success !== false });
  }
  const ok = results.filter(r => r.ok).length;
  return { output: `Posted ${ok}/${results.length} deal updates to ${channel}.` };
}

async function slackTaskAssignmentNotifications(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const channel = (input?.channel || '').trim();
  const tasks: any[] = Array.isArray(input?.tasks) ? input.tasks : [];
  if (!channel) return failureResult('channel is required.', 'validation_error');
  if (!tasks.length) return failureResult('tasks is required (array of { description, owner?, deadline?, context?, notionUrl? }).', 'validation_error');

  const slice = tasks.slice(0, 25);
  const results: Array<{ ok: boolean }> = [];
  for (const t of slice) {
    const text = [
      `✅ *New task*${t.owner ? ` — for ${t.owner}` : ''}`,
      `${t.description}`,
      t.deadline ? `📅 Due: ${t.deadline}` : '',
      t.context ? `_Context:_ ${t.context}` : '',
      t.notionUrl ? `<${t.notionUrl}|Open in Notion>` : '',
    ].filter(Boolean).join('\n');
    const r = await sendSlackMessage(userId, { channel, text }, context);
    results.push({ ok: r.success !== false });
  }
  const ok = results.filter(r => r.ok).length;
  return { output: `Posted ${ok}/${results.length} task notifications to ${channel}.` };
}

async function slackApprovalRequestRouting(userId: string, input: any, context: ToolContext = {}): Promise<ToolResult> {
  const channel = (input?.channel || 'dm').trim();
  const question = (input?.question || '').trim();
  const actionDescription = (input?.actionDescription || '').trim();
  const dashboardUrl = (input?.dashboardUrl || 'https://maily.cfd/dashboard?tab=agents&approve=pending').trim();
  if (!question) return failureResult('question is required.', 'validation_error');
  if (!actionDescription) return failureResult('actionDescription is required.', 'validation_error');

  const text = [
    `🤔 *Approval needed*`,
    '',
    `*Action:* ${actionDescription}`,
    `*Question:* ${question}`,
    '',
    `Reply 👍 to approve or 👎 to reject. Or open the dashboard:`,
    `<${dashboardUrl}|Approve / reject in dashboard>`,
  ].join('\n');

  // Send the request — the actual approval mechanism is dashboard-driven via
  // boult_agent_pending_actions, not Slack-reply-listening (which would need
  // an Events API endpoint we don't run).
  return await sendSlackMessage(userId, { channel, text }, context);
}

async function calendarTimezoneIntelligence(userId: string, input: any): Promise<ToolResult> {
  const proposedTime = (input?.proposedTime || '').trim();
  const attendeeTimezones: string[] = Array.isArray(input?.attendeeTimezones) ? input.attendeeTimezones : [];
  const userTimezone = (input?.userTimezone || '').trim() || 'UTC';
  if (!proposedTime) return failureResult('proposedTime (ISO 8601) is required.', 'validation_error');

  const proposed = new Date(proposedTime);
  if (isNaN(proposed.getTime())) return failureResult('proposedTime must be a valid ISO 8601 timestamp.', 'validation_error');

  const zones = [userTimezone, ...attendeeTimezones];
  const conversions: Array<{ timezone: string; localTime: string; hour: number; isReasonable: boolean }> = [];
  for (const tz of zones) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', weekday: 'short', month: 'short', day: 'numeric', hour12: false });
      const parts = fmt.formatToParts(proposed);
      const hourPart = parts.find(p => p.type === 'hour');
      const hour = hourPart ? parseInt(hourPart.value) : -1;
      conversions.push({
        timezone: tz,
        localTime: fmt.format(proposed),
        hour,
        isReasonable: hour >= 8 && hour <= 19,
      });
    } catch {
      conversions.push({ timezone: tz, localTime: '(invalid timezone)', hour: -1, isReasonable: false });
    }
  }

  const unreasonable = conversions.filter(c => !c.isReasonable && c.hour >= 0);
  return {
    output: JSON.stringify({
      proposedTimeUTC: proposed.toISOString(),
      conversions,
      reasonableForAll: unreasonable.length === 0,
      problemZones: unreasonable.map(u => ({ timezone: u.timezone, localTime: u.localTime, reason: u.hour < 8 ? 'too early' : 'too late' })),
      suggestion: unreasonable.length > 0
        ? 'Consider shifting to a window where local time is 9am-6pm in all participant zones.'
        : 'This time works for everyone.',
    }, null, 2),
  };
}

async function gmailDetectUrgency(userId: string, input: any): Promise<ToolResult> {
  const threadIds: string[] = Array.isArray(input?.threadIds)
    ? input.threadIds.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  if (!threadIds.length) return failureResult('threadIds is required (non-empty array).', 'validation_error');

  const BATCH = 15;
  const out: Array<{ threadId: string; urgencyScore: number; reason: string; needsImmediate: boolean }> = [];
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const slice = threadIds.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (tid) => {
      try {
        const t = await gmailReadThread(userId, { threadId: tid });
        if (t.success === false) return { threadId: tid, urgencyScore: 0, reason: 'fetch failed', needsImmediate: false };
        const res = await callLLM(
          [
            { role: 'system', content: URGENCY_PROMPT_P1 },
            { role: 'user', content: t.output.slice(0, 4000) },
          ],
          [],
          { maxTokens: 200, temperature: 0.1 },
        );
        const raw = getText(res.content).trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) return { threadId: tid, urgencyScore: 0, reason: 'no JSON', needsImmediate: false };
        try {
          const parsed = JSON.parse(m[0]);
          return {
            threadId: tid,
            urgencyScore: Math.max(0, Math.min(10, Number(parsed.urgencyScore) || 0)),
            reason: String(parsed.reason || ''),
            needsImmediate: Boolean(parsed.needsImmediate),
          };
        } catch { return { threadId: tid, urgencyScore: 0, reason: 'parse error', needsImmediate: false }; }
      } catch (err: any) {
        return { threadId: tid, urgencyScore: 0, reason: err.message, needsImmediate: false };
      }
    }));
    for (const r of results) out.push(r);
  }
  out.sort((a, b) => b.urgencyScore - a.urgencyScore);
  return { output: JSON.stringify(out, null, 2) };
}

// ── Phase C — Proactive triage signals ───────────────────────────────────────
//
// Runs a focused LLM judgment pass over recent context (Gmail results,
// calendar events, memory items, the user's saved rules) and returns a
// `signals` array — items worth flagging that the user didn't explicitly ask
// about. Initiative within rules.
//
// Categories the LLM looks for (the prompt enumerates them so it can't
// hallucinate new ones):
//   - DEADLINE: dated obligation in inbox/calendar the user might miss
//   - STALLED_DEAL: outbound thread with no inbound reply for N+ days
//   - CONFLICT: calendar overlap, schedule + commitment mismatch
//   - VIP_WAITING: high-value contact's email awaiting reply
//   - RULE_VIOLATION_AVOIDED: an action the user's rules forbid that the
//     agent declined or routed around
//   - OPPORTUNITY: revenue/partnership signal the user might want to act on
//
// Each signal: { category, summary, evidence: string[], suggested_action?: string }
// The LLM bundles these into the report or surfaces them as a "Needs your
// attention" section. By having a dedicated tool the LLM can call AFTER
// broad searches, we get a consistent place for "agentic initiative" to
// emerge — instead of relying on the model to volunteer it inconsistently.

const PROACTIVE_SIGNALS_PROMPT = `You are a chief-of-staff scanning recent activity for the user. Identify THINGS THE USER DID NOT ASK ABOUT but should know — within the user's saved rules and memory. Be surgical. Quality over quantity. Max 5 signals.

Allowed categories (use these exact strings):
  DEADLINE              — dated obligation soon to expire
  STALLED_DEAL          — outbound conversation with no reply for 5+ days
  CONFLICT              — calendar overlap or commitment mismatch
  VIP_WAITING           — high-value contact's email awaiting reply
  RULE_VIOLATION_AVOIDED — action the user's rules forbid that you skipped or routed around
  OPPORTUNITY           — revenue/partnership signal worth surfacing

Output ONLY JSON: { "signals": [ { "category": "<one of above>", "summary": "<short, 1 sentence>", "evidence": ["<concrete data point>", ...], "suggestedAction": "<optional one-sentence action>" } ] }

Rules:
  - NEVER invent. Each signal must reference real data in the context.
  - If nothing is worth flagging, return { "signals": [] }.
  - Apply the user's saved instructions — if a rule says "never schedule weekends", flag a weekend booking as RULE_VIOLATION_AVOIDED (assuming you did decline it).
  - Skip items the user explicitly asked about (those are answered in the main response, not surfaced as signals).`;

async function surfaceProactiveSignals(userId: string, input: any): Promise<ToolResult> {
  const recentContext = (input?.recentContext || '').trim();
  const userRules = (input?.userRules || '').trim();
  const memoryContext = (input?.memoryContext || '').trim();
  if (!recentContext) {
    return failureResult(
      'recentContext is required — pass a summary of what you just searched / fetched (inbox results, calendar window, memory items). The proactive scan needs ground truth to be useful.',
      'validation_error',
    );
  }

  const userInput = [
    userRules ? `## User's saved rules\n${userRules.slice(0, 2000)}` : '',
    memoryContext ? `## Relevant memory\n${memoryContext.slice(0, 2000)}` : '',
    `## Recent context\n${recentContext.slice(0, 8000)}`,
  ].filter(Boolean).join('\n\n');

  try {
    const r = await callLLM(
      [
        { role: 'system', content: PROACTIVE_SIGNALS_PROMPT },
        { role: 'user', content: userInput },
      ],
      [],
      { maxTokens: 1200, temperature: 0.2 },
    );
    const raw = getText(r.content).trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { output: JSON.stringify({ signals: [] }) };
    try {
      const parsed = JSON.parse(m[0]);
      const signals = Array.isArray(parsed?.signals) ? parsed.signals.slice(0, 5) : [];
      // Defensive: enforce the schema shape on each item
      const clean = signals.map((s: any) => ({
        category: String(s?.category || 'OPPORTUNITY').toUpperCase(),
        summary: String(s?.summary || '').slice(0, 280),
        evidence: Array.isArray(s?.evidence) ? s.evidence.map((e: any) => String(e).slice(0, 200)).slice(0, 5) : [],
        suggestedAction: s?.suggestedAction ? String(s.suggestedAction).slice(0, 280) : undefined,
      })).filter((s: any) => s.summary);
      return { output: JSON.stringify({ signals: clean }, null, 2) };
    } catch {
      return { output: JSON.stringify({ signals: [] }) };
    }
  } catch (err: any) {
    return failureResult(`Proactive scan failed: ${err.message}`, 'internal_error');
  }
}
