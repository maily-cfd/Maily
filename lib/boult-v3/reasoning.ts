/**
 * Boult V3 — Reasoning Layer
 * 
 * Makes the LLM call with the constructed prompt, validates
 * the response with Zod, and returns structured output.
 * 
 * Uses OpenRouter (already configured in the Maily stack)
 * instead of the Anthropic SDK.
 */

import type { BoultContext, BoultEvent, AgenticOutput, PlanModeOutput } from './types';
import { AgenticOutputSchema, PlanModeOutputSchema } from './types';
import { buildAgenticPrompt } from './prompts/agentic';
import { buildPlanModePrompt } from './prompts/plan-mode';
import { stripPII, rehydratePIIObject, type PIIMapping } from './pii';

/**
 * Run agentic reasoning — called when a webhook event triggers processing.
 * Returns a validated AgenticOutput or a safe fallback.
 */
export async function runAgenticReasoning(
  context: BoultContext
): Promise<{ output: AgenticOutput; rawInput: unknown; rawOutput: unknown }> {
  // 1. Strip PII from context before sending to LLM
  const { sanitized: sanitizedContext, mapping } = stripPII(context);

  // 2. Build prompt
  const prompt = buildAgenticPrompt(sanitizedContext as BoultContext);

  // 3. Make LLM call
  const rawOutput = await callLLM(prompt.system, prompt.user, 2000);

  // 4. Parse and validate
  const parsed = parseJSON(rawOutput);
  if (!parsed) {
    console.error('[Boult V3] LLM output is not valid JSON', { raw: rawOutput });
    return {
      output: { hasActionableInsight: false, severity: 'low', findings: [] },
      rawInput: prompt,
      rawOutput,
    };
  }

  const result = AgenticOutputSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[Boult V3] LLM output failed Zod validation', {
      raw: rawOutput,
      errors: result.error.issues,
    });
    return {
      output: { hasActionableInsight: false, severity: 'low', findings: [] },
      rawInput: prompt,
      rawOutput,
    };
  }

  // 5. Rehydrate PII in the validated output
  const rehydrated = rehydratePIIObject(result.data, mapping) as AgenticOutput;

  return {
    output: rehydrated,
    rawInput: prompt,
    rawOutput: parsed,
  };
}

/**
 * Run Plan Mode reasoning — called for the daily brief.
 * Returns a validated PlanModeOutput or null.
 */
export async function runPlanModeReasoning(
  context: BoultContext
): Promise<{ output: PlanModeOutput | null; rawInput: unknown; rawOutput: unknown }> {
  // 1. Strip PII
  const { sanitized: sanitizedContext, mapping } = stripPII(context);

  // 2. Build prompt (plan mode — larger token budget)
  const prompt = buildPlanModePrompt(sanitizedContext as BoultContext);

  // 3. Make LLM call with higher token budget
  const rawOutput = await callLLM(prompt.system, prompt.user, 4000);

  // 4. Parse and validate
  const parsed = parseJSON(rawOutput);
  if (!parsed) {
    console.error('[Boult V3] Plan Mode output is not valid JSON', { raw: rawOutput });
    return { output: null, rawInput: prompt, rawOutput };
  }

  const result = PlanModeOutputSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[Boult V3] Plan Mode output failed validation', {
      errors: result.error.issues,
    });
    return { output: null, rawInput: prompt, rawOutput };
  }

  // 5. Rehydrate PII
  const rehydrated = rehydratePIIObject(result.data, mapping) as PlanModeOutput;

  return {
    output: rehydrated,
    rawInput: prompt,
    rawOutput: parsed,
  };
}

/**
 * Make an LLM call via OpenRouter.
 * Temperature 0 for deterministic JSON output.
 */
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<string> {
  const apiKeys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY2,
    process.env.OPENROUTER_API_KEY3,
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    throw new Error('[Boult V3] No OpenRouter API keys configured');
  }

  // Try keys in order
  let lastError: Error | null = null;

  for (const apiKey of apiKeys) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://maily.cfd',
          'X-Title': 'Boult V3',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // nemotron-3-super-120b:free REMOVED 2026-07-19 (user report: not working).
          // gemma-4-26b confirmed to support response_format json_object (this path's
          // hard requirement — ultra's API doesn't support it, super used to but no
          // longer works; verified via OpenRouter's live /api/v1/models).
          model: 'google/gemma-4-26b-a4b-it:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0,
          max_tokens: maxTokens,
          stream: false,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000), // 30s timeout for reasoning
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`OpenRouter ${response.status}: ${errorText.substring(0, 200)}`);
        console.warn(`[Boult V3] LLM call failed with key ${apiKey?.substring(0, 10)}...: ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data.error) {
        lastError = new Error(data.error.message || 'OpenRouter API error');
        continue;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastError = new Error('Empty LLM response');
        continue;
      }

      return content;
    } catch (error) {
      lastError = error as Error;
      console.warn(`[Boult V3] LLM call exception:`, (error as Error).message);
      continue;
    }
  }

  throw lastError || new Error('All LLM calls failed');
}

/**
 * Safely parse JSON from LLM output.
 * Handles markdown code fences and whitespace.
 */
function parseJSON(raw: string): unknown | null {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    return JSON.parse(cleaned);
  } catch {
    // Try extracting JSON object from the string
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
