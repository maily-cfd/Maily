/**
 * Boult tool layer — shared types.
 *
 * Pulled out of the 9500-line tools.ts in PART 39a so per-domain executor
 * files (gmail.ts, calendar.ts, …) can share the same shape without circular
 * imports back into the registry. tools.ts re-exports these for back-compat
 * with existing call sites (engine.ts, loop.ts, run-agent.ts).
 */

export interface ToolResult {
  output: string;
  /**
   * False on any soft-failure path the tool handled gracefully (missing
   * integration, upstream 4xx/5xx, empty result with no useful data, validation
   * error). Undefined or true means the tool produced usable data.
   *
   * The agentic loop reads this directly — it is what the LLM uses to decide
   * whether to surface a failure to the user or proceed. Without it, the loop
   * trusts the LLM's narration of a "success" string and confabulates next
   * steps as if the tool returned real data.
   */
  success?: boolean;
  /**
   * Stable short identifier for the failure class — e.g. `gmail_not_connected`,
   * `upstream_4xx`, `not_found`, `validation_error`, `confirmation_required`.
   * Surfaced to the LLM in the failure-acknowledgement bridge so it can pick
   * the right recovery path (reconnect prompt vs. retry vs. alternative tool).
   */
  errorCode?: string;
  requiresConfirmation?: boolean;
  canvasData?: {
    title: string;
    type: string;
    markdown: string;
    draftMeta?: {
      to?: string;
      subject?: string;
      threadId?: string;
      body?: string;
      recipientName?: string;
      gmailDraftId?: string;
      /**
       * 0-100 score from the post-draft voice-profile critique. Surfaced on
       * the draft card so the user knows when a draft drifted from their
       * voice (typically when < 70). Computed inside draftReply via a
       * second LLM pass against the injected voice profile.
       */
      voiceScore?: number;
      /** Short reason behind a low score; surfaced under the score badge. */
      voiceCritique?: string;
    };
    pageMeta?: { url?: string; pageId?: string; contentPreview?: string; meetLink?: string; startTime?: string; attendees?: string[]; [key: string]: any };
    isUpdate?: boolean;
  };
  /**
   * Multiple canvases from a SINGLE tool call. Used by batch tools that produce
   * several draft cards at once (gmail_batch_draft_replies) so the loop can emit
   * one `canvas` event per draft — the client accumulates them into the draft
   * gallery. Each entry has the same shape as `canvasData`. When present, the
   * loop emits every entry; `canvasData` (if also set) is emitted too.
   */
  canvasList?: NonNullable<ToolResult['canvasData']>[];
}

export interface ToolHistoryEntry {
  name: string;
  /** Tool input — used for prerequisite matching (e.g. threadId on read_email). */
  input: Record<string, any>;
  /** True iff result.success !== false. Prerequisites only count succeeded calls. */
  success: boolean;
}

export interface ToolContext {
  /**
   * Stable conversation identifier — used to scope session approval lookups
   * for write tools (send_email, schedule_meeting, send_slack_message,
   * create_notion_page). Omitted on background-agent runs, in which case the
   * approval gate fails open.
   */
  conversationId?: string;
  /**
   * Tool calls already executed earlier in this run, in order. The loop
   * pushes each successful tool result here so prerequisite checks (PART 4
   * Rules 1 + 3) can verify the LLM actually fetched ground truth before
   * acting. Background-agent runs may omit; the prerequisite checks then
   * fail open with a warning logged.
   */
  toolHistory?: ToolHistoryEntry[];

  isBackgroundAgent?: boolean;
  skipConfirmations?: boolean;
  runId?: string;
  agentId?: string;

  /**
   * FIX 1 — State machine at tool level.
   * The loop passes the current run phase so write tools can enforce
   * "no writes without prior approval" even when the session-state DB is
   * unreachable (the consumeApproval gate fails-open in that scenario).
   * PLANNING  → read-only; writes always blocked.
   * CONFIRMING → waiting on user; writes still blocked.
   * EXECUTING  → user approved; writes allowed.
   * REPORTING  → writes blocked (run is wrapping up).
   * Omitted for background-agent runs (they use skipConfirmations instead).
   */
  runState?: 'PLANNING' | 'CONFIRMING' | 'EXECUTING' | 'REPORTING';
}

/**
 * Build a structured soft-failure result. The loop reads `success: false` and
 * injects a hard failure-acknowledgement message back to the LLM so it cannot
 * continue as if the call succeeded. `message` lands in the tool result the
 * LLM sees; `code` is for branch logic and telemetry.
 */
export function failureResult(message: string, code: string): ToolResult {
  return { success: false, errorCode: code, output: message };
}
