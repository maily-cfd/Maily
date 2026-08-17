/**
 * Single-VA loop runner — PART 48.
 *
 * Invokes runAgentLoop with committeeMode set to ONE VA, drains the SSE
 * stream, and produces a structured VARunResult the orchestrator's
 * aggregator can render. Each VA runs in its own Promise — failures /
 * timeouts are caught here and returned as a VARunResult with status
 * !== 'success' so the chief-of-staff briefing still includes a stub for
 * the failed lane instead of silently dropping it.
 */

import { runAgentLoop } from '../loop';
import { buildSystemPrompt, getConnectedIntegrations } from '../system-prompt';
import { searchMemories } from '../memory';
import { focusBriefFor } from './va-prompts';
import type { VAAssignment, VARunResult, ArtifactBuckets, ArtifactBucket } from './types';
import type { BoultVA } from '../tool-integration-map';

// Per-VA voice prompt fetcher — same shape as run-agent.ts's local helper.
// Duplicated here (rather than imported) so the orchestrator + cron path
// can keep evolving without coupling.
async function getVoicePromptBlock(userId: string): Promise<string> {
  try {
    // @ts-ignore — JS module
    const { voiceProfileService } = await import('../../voice-profile-service.js');
    const profile: any = await voiceProfileService.getVoiceProfile(userId);
    if (!profile || profile.status === 'default') return '';
    const prompt = voiceProfileService.generateVoicePrompt(profile);
    return typeof prompt === 'string' ? prompt.trim() : '';
  } catch {
    return '';
  }
}

async function fetchUserInstructions(userId: string): Promise<string> {
  try {
    // @ts-ignore — JS module
    const { getSupabaseAdmin } = await import('../../supabase.js');
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    const prefs = (data?.preferences as Record<string, unknown>) || {};
    if (prefs.boult_instructions_enabled === false) return '';
    const text = (prefs.boult_personality as string) || '';
    return typeof text === 'string' ? text.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Pull artifact URLs out of a VA's report markdown. Same heuristic as the
 * cron runner's extractArtifactLinks helper (PART 35) — header detection
 * for the four buckets the spec defines. Kept local so we can evolve the
 * markdown format per-VA without coupling.
 */
function extractArtifacts(body: string): ArtifactBuckets {
  if (!body) return {};
  const out: ArtifactBuckets = {};

  // Walk line-by-line, attributing markdown links to whichever bucket
  // header we most recently saw. Buckets recognised: Gmail / Calendar /
  // Notion / Slack (case-insensitive, emoji-tolerant).
  let bucket: keyof ArtifactBuckets | null = null;
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    // Bucket header detection — both H3-style ("### Gmail drafts") and
    // bold-bullet style ("**📧 Gmail drafts**") work.
    if (/^(#{1,4}\s+|[-*+]\s+\*\*|\*\*)/.test(line)) {
      if (lower.includes('gmail') || lower.includes('email')) bucket = 'gmail';
      else if (lower.includes('calendar') || lower.includes('meeting')) bucket = 'calendar';
      else if (lower.includes('notion')) bucket = 'notion';
      else if (lower.includes('slack')) bucket = 'slack';
      else bucket = null;
      continue;
    }

    if (!bucket) continue;
    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      const list: ArtifactBucket[] = out[bucket] ?? (out[bucket] = []);
      list.push({ label: m[1].slice(0, 200), url: m[2].slice(0, 500) });
    }
  }

  return out;
}

/**
 * Derive a 1-line summary of what this VA did. Pulled from the body's first
 * non-blank, non-header line — VA prompts in va-prompts.ts explicitly ask
 * the LLM to open with a one-sentence summary, so this lookup is reliable
 * when the LLM follows orders. Falls back to a generic line otherwise.
 */
function deriveSummary(va: BoultVA, body: string, toolCalls: number): string {
  const firstLine = body
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'));
  if (firstLine && firstLine.length >= 12 && firstLine.length <= 220) return firstLine;
  if (toolCalls === 0) return `${va} VA: nothing actionable this run.`;
  return `${va} VA: completed ${toolCalls} tool calls.`;
}

export async function runVA(assignment: VAAssignment): Promise<VARunResult> {
  const startedAt = Date.now();
  const { va, agent, maxToolCalls, deadlineMs } = assignment;

  try {
    // Build context in parallel — every VA needs voice + instructions +
    // memory relevant to its lane. memory query is keyed by the agent's
    // task description so research signals carry through.
    const [connectedIntegrations, voicePrompt, userInstructions, memories] = await Promise.all([
      getConnectedIntegrations(agent.user_id),
      getVoicePromptBlock(agent.user_id),
      fetchUserInstructions(agent.user_id),
      searchMemories(agent.user_id, `${va} ${agent.task_description}`, 4),
    ]);

    const systemPrompt = buildSystemPrompt({
      userName: 'User',
      userId: agent.user_id,
      connectedIntegrations,
      memories,
      personality: voicePrompt || undefined,
      userInstructions: userInstructions || undefined,
      isBackgroundAgent: true,
      skipConfirmations: agent.skip_confirmations ?? false,
      agentTaskDescription: agent.task_description,
      // PART 48 — even though this is a background agent, lock the prompt's
      // Tool inventory to just this VA's tools. Without this the prompt
      // would name every tool while getAvailableTools narrows the actual
      // schemas → mismatch + token waste.
      relevantVAs: [va],
    });

    // The user message = task description + VA-specific focus brief.
    // The loop's committee-mode block adds the sibling-VA note on top.
    const taskBody = [
      agent.task_description.trim(),
      '',
      '---',
      '',
      focusBriefFor(va).trim(),
    ].join('\n');

    const stream = runAgentLoop({
      userId: agent.user_id,
      systemPrompt,
      history: [],
      userMessage: taskBody,
      connectedIntegrations,
      isBackgroundAgent: true,
      skipConfirmations: agent.skip_confirmations ?? false,
      agentId: agent.id,
      agentRunId: assignment.agentRunId,
      maxToolCalls,
      deadlineMs,
      committeeMode: { va, siblingVAs: assignment.siblingVAs },
    });

    // Drain the SSE stream. Same parsing as run-agent.ts's runAgentTask
    // but local so per-VA event handling can diverge in future PARTs
    // (e.g. emitting per-VA progress to the agent_runs UI).
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalText = '';
    let canvasMarkdown = '';
    let currentEventType = '';
    let toolCalls = 0;
    const toolNames: string[] = [];
    const failedTools = new Set<string>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) { currentEventType = line.slice(7).trim(); continue; }

        if (line.startsWith('data: ') && currentEventType === 'message') {
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.content) finalText = data.content;
          } catch { /* ok */ }
          currentEventType = '';
        }

        if (line.startsWith('data: ') && currentEventType === 'canvas') {
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.markdown && data.type !== 'scheduled_agent') canvasMarkdown = data.markdown;
          } catch { /* ok */ }
          currentEventType = '';
        }

        if (line.startsWith('data: ') && currentEventType === 'tool_call') {
          toolCalls += 1;
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.tool) toolNames.push(String(data.tool));
          } catch { /* ok */ }
          currentEventType = '';
        }

        if (line.startsWith('data: ') && currentEventType === 'tool_result') {
          try {
            const data = JSON.parse(line.slice(6).trim());
            if (data.tool && data.success === false) failedTools.add(String(data.tool));
          } catch { /* ok */ }
          currentEventType = '';
        }
      }
    }

    let body = (canvasMarkdown || finalText || '').trim();

    if (!body && toolCalls > 0) {
      body = `Ran ${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'} but did not compose a summary. Re-run on the next scheduled tick — the work that DID happen is reflected in your Gmail / Calendar / Notion / Slack directly (this VA emitted tools but skipped its report-composition phase).`;
    }

    const status = !body ? (toolCalls > 0 ? 'success' : 'empty') : 'success';
    return {
      va,
      status,
      toolCalls,
      toolNames,
      failedTools: [...failedTools],
      artifacts: extractArtifacts(body),
      durationMs: Date.now() - startedAt,
      body,
      summary: deriveSummary(va, body, toolCalls),
    };
  } catch (err: any) {
    return {
      va,
      status: 'error',
      toolCalls: 0,
      artifacts: {},
      durationMs: Date.now() - startedAt,
      body: '',
      summary: `${va} VA failed: ${err?.message || 'unknown error'}`,
      error: err?.message || 'unknown error',
    };
  }
}
