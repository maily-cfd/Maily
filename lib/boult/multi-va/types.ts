/**
 * Multi-VA committee — shared types.
 *
 * PART 48 introduces a real parallel-VA architecture for background runs:
 * instead of one monolithic LLM stream pretending to be 5 VAs, we literally
 * fan out to up to 5 concurrent runAgentLoop instances, each with its own
 * focused prompt + narrowed tool surface, then aggregate at the end.
 */

import type { BoultVA } from '../tool-integration-map';

/** Per-VA artifact buckets, mirroring the chat-route extraction shape. */
export interface ArtifactBucket {
  label: string;
  url: string;
}

export interface ArtifactBuckets {
  gmail?: ArtifactBucket[];
  calendar?: ArtifactBucket[];
  notion?: ArtifactBucket[];
  slack?: ArtifactBucket[];
}

/**
 * What the orchestrator hands to each VA runner. Built once per run by
 * runAgentAsCommittee — every VA in the committee gets the same agent +
 * task; the per-VA system prompt + tool filter does the rest.
 */
export interface VAAssignment {
  va: BoultVA;
  /** The other VAs running in parallel right now (drives the in-prompt sibling note). */
  siblingVAs: BoultVA[];
  agent: {
    user_id: string;
    task_description: string;
    skip_confirmations?: boolean;
    name?: string;
    id?: string;
  };
  /** Per-VA tool-call cap. Sum across VAs should ≤ overall budget. */
  maxToolCalls: number;
  /** Per-VA wall-clock deadline (ms from start). Slowest VA defines run length. */
  deadlineMs: number;
  /** The boult_agent_runs.id; shared by all VAs so audit logs join to one run. */
  agentRunId?: string;
}

/**
 * What each VA returns to the chief-of-staff aggregator.
 * Wrapped in a discriminated `status` so a failed/timed-out VA still has a
 * shape the aggregator can render — its section just says "VA failed" or
 * "VA timed out" instead of silently disappearing from the report.
 */
export interface VARunResult {
  va: BoultVA;
  status: 'success' | 'error' | 'timeout' | 'empty';
  /** Tool calls observed via the tool_call SSE event count. */
  toolCalls: number;
  /** Tool names in execution order (for the report's "Tools Used" section). */
  toolNames?: string[];
  /** Tool names that returned success:false this run. */
  failedTools?: string[];
  /** Artifact links the VA touched this run, keyed by integration. */
  artifacts: ArtifactBuckets;
  /** Wall-clock duration of this VA's loop in ms. */
  durationMs: number;
  /**
   * The full markdown the VA's loop produced — used as the body of this
   * VA's section in the final committee report. May be empty if the VA
   * had no work to do or hit an early failure.
   */
  body: string;
  /** Short one-line summary derived from the VA's body. */
  summary: string;
  /** When status !== 'success' — what went wrong, in plain English. */
  error?: string;
}

/**
 * The chief-of-staff's final output. The cron runner reads `report` (the
 * full markdown) for delivery + `toolCalls` for boult_agent_runs.tool_calls
 * + `artifactLinks` for boult_agent_runs.artifact_links — same shape the
 * single-LLM `runAgentTask` used to return, so the cron runner doesn't
 * have to change.
 */
export interface CommitteeReport {
  report: string;
  toolCalls: number;
  artifactLinks: ArtifactBuckets;
  /** Per-VA breakdown — useful for telemetry + the agent_runs UI someday. */
  vaResults: VARunResult[];
  /** Was committee mode used, or did we fall back to legacy single-LLM? */
  modeUsed: 'committee' | 'legacy';
}
