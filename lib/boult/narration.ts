/**
 * Narrated Execution Protocol — the schema-level enforcement that gives every
 * tool call a live, first-person "what I'm doing right now" line.
 *
 * Manus-grade transparency, enforced at the PROTOCOL level instead of hoped
 * for in the prompt: every tool schema gains a leading `_narration` field the
 * model fills as part of the call itself. Models fill schema fields far more
 * reliably than they volunteer prose between tool calls — so every step in
 * the UI gets a specific human sentence even from terse models.
 *
 * The field is stripped before execution (executors never see it) and emitted
 * with the tool_call SSE event for the step tracker.
 *
 * Zero imports on purpose: this module is a pure, unit-testable seam used by
 * the shared agent loop (live chat + Ctrl+K + background agents).
 */

export const NARRATION_FIELD = '_narration';

const NARRATION_SCHEMA = {
  type: 'string',
  description:
    'ALWAYS fill this FIRST. One short first-person line shown live to the user, present tense, specific to THIS exact call — what you are doing and what it serves (e.g. "Scanning your inbox for unanswered investor threads from this week"). Plain human language: no tool names, no jargon.',
} as const;

/**
 * Return a copy of the tool list with the `_narration` field injected as the
 * FIRST property of every input schema (leading position nudges the model to
 * narrate before it fills the real arguments). Original schemas are never
 * mutated; tools without properties get a well-formed schema.
 */
export function withNarrationField<T extends { input_schema?: any }>(tools: T[]): T[] {
  return tools.map((t) => ({
    ...t,
    input_schema: {
      ...t.input_schema,
      properties: {
        [NARRATION_FIELD]: NARRATION_SCHEMA,
        ...((t.input_schema && t.input_schema.properties) || {}),
      },
    },
  }));
}

/**
 * Pull the model-written narration off each parsed tool call BEFORE anything
 * downstream reads the input: sets `tc.narration` (trimmed, capped at 220
 * chars) and deletes the field from `tc.input` so executors never see it.
 * Tolerant of missing/odd shapes — never throws.
 */
export function extractNarrations(toolCalls: any[]): void {
  for (const tc of toolCalls || []) {
    if (tc?.input && typeof tc.input === 'object' && NARRATION_FIELD in tc.input) {
      const n = tc.input[NARRATION_FIELD];
      tc.narration = typeof n === 'string' ? n.trim().slice(0, 220) : '';
      delete tc.input[NARRATION_FIELD];
    }
  }
}
