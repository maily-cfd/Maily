/**
 * Boult Engine — OpenRouter caller using OpenAI-compatible API format.
 *
 * Concurrency design: race all API keys for ONE model at a time (max N_keys concurrent).
 * Firing all (model × key) pairs simultaneously hammers OpenRouter and triggers
 * IP-level rate limits on every call.
 *
 * Strategy:
 *   1. openrouter/auto — OR picks the best available model internally
 *   2. Sequential free model fallbacks, racing all keys per model
 *   3. Emergency text-only (strip tool schemas, try openrouter/auto + top 2 models)
 */

// ── Logger ─────────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().slice(11, 23); }

function log(level: 'info' | 'warn' | 'error', module: string, msg: string, extra?: Record<string, unknown>) {
  const prefix = `[Boult:${module}] ${ts()}`;
  const line = extra ? `${prefix} ${msg} ${JSON.stringify(extra)}` : `${prefix} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// ── Per-model rate limit cooldown tracker (module-level, survives requests) ────
// When a model returns 429, we mark it as cooling for Retry-After seconds
// (capped at 90s) so subsequent calls skip it until it's available again.
// This prevents hammering a rate-limited model across parallel tool results.
const modelCooldownUntil = new Map<string, number>();
let paidDisabledUntil = 0;

function isModelCooling(model: string): boolean {
  const until = modelCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) { modelCooldownUntil.delete(model); return false; }
  return true;
}

function markModelRateLimited(model: string, retryAfterSec: number, opts?: { dailyResetMs?: number }) {
  // Daily-quota exhaustion ("free-models-per-day") doesn't recover for hours —
  // cool the model until its real reset timestamp so we stop retrying it on every
  // call. A short cooldown here is what made a quota-dead account waste ~5s per
  // request grinding through 10 models that will 429 again instantly.
  let cooldownMs: number;
  if (opts?.dailyResetMs && opts.dailyResetMs > Date.now()) {
    cooldownMs = opts.dailyResetMs - Date.now();
  } else {
    cooldownMs = Math.min(retryAfterSec, 90) * 1000;
  }
  const prev = modelCooldownUntil.get(model) ?? 0;
  // Don't shorten an existing cooldown
  modelCooldownUntil.set(model, Math.max(prev, Date.now() + cooldownMs));
  const mins = Math.round(cooldownMs / 60000);
  log('warn', 'Engine', `Model rate-limited — cooling ${mins >= 1 ? mins + 'm' : Math.round(cooldownMs / 1000) + 's'}`, { model, daily: !!opts?.dailyResetMs });
}

// Parse OpenRouter's 429 body to distinguish a per-day quota wall (recovers at
// midnight UTC) from a transient per-minute rate limit (recovers in seconds).
function parseRateLimit(body: any): { daily: boolean; resetMs?: number; retryAfterSec: number } {
  const msg = String(body?.error?.message ?? '').toLowerCase();
  const daily = msg.includes('per-day') || msg.includes('per day') || msg.includes('free-models-per-day');
  const resetRaw = body?.error?.metadata?.headers?.['X-RateLimit-Reset'];
  const resetMs = resetRaw != null ? Number(resetRaw) : undefined;
  return { daily, resetMs: Number.isFinite(resetMs) ? resetMs : undefined, retryAfterSec: 30 };
}

// ── Model lists ────────────────────────────────────────────────────────────────

/**
 * Free tool-capable models, verified live 2026-05-19 against OpenRouter.
 * Ordered: confirmed-responding first, then ones that were rate-limited
 * at probe time but may recover. NOTE: openrouter/auto is NOT usable —
 * these accounts have zero credits and auto only routes to paid models.
 */
const TOOL_CAPABLE_MODELS = [
  // PRIMARY — nvidia/nemotron-3-ultra-550b-a55b:free (per product decision). The
  // strongest free model available: 1M context, native tool/function-calling.
  // LIVE-TEST CAVEAT (2026-07): ultra is intermittently unhealthy on the free
  // tier — it returns HTTP 400 "Provider returned error" (fails fast, ~0.7s) or
  // times out, and 429s once the daily quota is spent. So the confirmed-healthy
  // models below sit IMMEDIATELY after it as fast fallback and carry runs whenever
  // ultra is erroring; ultra becomes the real server once it recovers / the
  // account has credit. Leading with it is cheap because its errors return fast.
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  // Confirmed-healthy fallbacks — LIVE-VERIFIED 2026-07-22 by direct API probe
  // (chat.completions with real keys, checked for non-empty content AND
  // response_format:json_object support, not just an HTTP 200 — nemotron
  // reasoners can 200 with an empty body when reasoning eats the token budget).
  // qwen/qwen3-next-80b-a3b-instruct:free, meta-llama/llama-3.3-70b-instruct:free,
  // and qwen/qwen3-coder:free were REMOVED here — OpenRouter has retired all
  // three from the free tier (confirmed 404 "unavailable for free" on every
  // key, not a transient rate limit). They were silently eating every
  // failover attempt whenever the first model errored, which is what made
  // "AI doesn't work at all" reproducible: once nemotron-3-ultra or gemma-4-26b
  // hit a rate limit, the ENTIRE remaining chain was dead model ids.
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  // Removed (verified 404 / dead on OpenRouter): openai/gpt-oss-120b,
  // openai/gpt-oss-20b (now requires reasoning that can't be disabled — a
  // different failure mode, still unsuitable here), z-ai/glm-4.5-air,
  // deepseek/deepseek-v4-flash, arcee-ai/trinity-large-thinking, qwen3-coder,
  // qwen3-next-80b-a3b-instruct, llama-3.3-70b-instruct.
];

const FALLBACK_MODELS: string[] = [];

const ALL_FREE_MODELS = [
  ...TOOL_CAPABLE_MODELS,
  ...FALLBACK_MODELS,
];

// FAST models — small, non-reasoning, fast-first-token. Used for the fast
// conversational path (options.fastFirst): smalltalk/identity/capability
// replies must land in ~2s, so we lead with the smallest healthy models and
// NEVER the 550B reasoning model (which thinks for 20s). gemma-4-26b first —
// it's the quickest to first token. All three live-verified 2026-07-22 (real
// keys, non-empty content, ~300-500ms to first token in testing).
const FAST_MODELS = [
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

// F2.3 — Paid escape hatch. Activated only when ALL_FREE_MODELS exhaust AND
// PAID_MODELS is non-empty (paidEnabled below is `PAID_MODELS.length && ...`).
//
// EMPTIED 2026-07-19 on explicit user directive: "remove every paid model from
// our list, it is too much costing us money. you'll add when i tell." This is
// deliberate, not a bug — when every free model is rate-limited, there is now
// NO paid fallback; requests will fail/EMPTY_RUN instead of spending money.
// Do NOT re-add any model here (gemma-4-26b-a4b-it paid, gemini-2.5-flash-lite,
// claude-haiku-4.5, gemini-2.5-flash, or any other) without the user naming it
// first — that was explicit and specific ("you'll add when i tell, which model").
const PAID_MODELS: string[] = [];


function getKeys(): string[] {
  return [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY2,
    process.env.OPENROUTER_API_KEY3,
    process.env.OPENROUTER_API_KEY4,
    process.env.OPENROUTER_API_KEY5,
  ].filter(Boolean) as string[];
}

// ── Internal types ─────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  // F12 — Vision content block. Passed through to OpenAI-style vision API
  // (gemini-2.5-flash, gpt-4o-mini, claude-haiku-5 all accept this shape).
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMResponse {
  role: 'assistant';
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
}

// ── Format converters ──────────────────────────────────────────────────────────

function toOpenAITools(tools: ToolSchema[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function toOpenAIMessages(messages: LLMMessage[]): any[] {
  const out: any[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      // Prompt caching: the large, stable system prompt is re-sent on every LLM
      // call in a run (6-12 calls). Marking it cacheable lets providers reuse it
      // (Anthropic/Gemini via OpenRouter cache_control; OpenAI auto-caches and
      // ignores the hint), cutting input cost ~90% on repeated calls within a
      // run. Only worth it above the provider min (~1k tokens), so gate on size.
      if (msg.role === 'system' && msg.content.length > 4000) {
        out.push({
          role: 'system',
          content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
        });
      } else {
        out.push({ role: msg.role, content: msg.content });
      }
      continue;
    }

    const blocks = msg.content as ContentBlock[];

    const toolResults = blocks.filter(b => b.type === 'tool_result') as Array<{
      type: 'tool_result'; tool_use_id: string; content: string;
    }>;
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
        });
      }
      // Any TEXT alongside the tool results must survive. This used to
      // `continue` straight past it, silently discarding every non-tool_result
      // block — which is where the loop's [STATE:]/[TOOL BUDGET]/working-memory
      // steer went to die, since that steer is appended to exactly these
      // messages. A `tool` message cannot carry it (it is bound to a
      // tool_call_id), so it goes out as its own user turn, which is valid
      // immediately after tool results in this format.
      const trailingText = (blocks.filter(b => b.type === 'text') as Array<{ type: 'text'; text: string }>)
        .map(b => b.text)
        .filter(t => typeof t === 'string' && t.trim())
        .join('\n\n');
      if (trailingText) {
        out.push({ role: 'user', content: trailingText });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const textBlocks = blocks.filter(b => b.type === 'text') as Array<{ type: 'text'; text: string }>;
      const toolUseBlocks = blocks.filter(b => b.type === 'tool_use') as Array<{
        type: 'tool_use'; id: string; name: string; input: Record<string, any>;
      }>;

      const assistantMsg: any = {
        role: 'assistant',
        content: textBlocks.map(b => b.text).join('\n').trim() || null,
      };
      if (toolUseBlocks.length > 0) {
        assistantMsg.tool_calls = toolUseBlocks.map(b => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      }
      out.push(assistantMsg);
      continue;
    }

    // F12 — User message with images: forward as multi-part content
    // ({type:'text',text:...} + {type:'image_url',image_url:{url:...}}).
    const imageBlocks = blocks.filter(b => b.type === 'image_url') as Array<{
      type: 'image_url'; image_url: { url: string };
    }>;
    if (msg.role === 'user' && imageBlocks.length > 0) {
      const textParts = blocks
        .filter(b => b.type === 'text')
        .map(b => ({ type: 'text', text: (b as any).text }));
      const imgParts = imageBlocks.map(b => ({
        type: 'image_url',
        image_url: b.image_url,
      }));
      out.push({ role: 'user', content: [...textParts, ...imgParts] });
      continue;
    }

    const text = blocks
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('\n');
    out.push({ role: msg.role, content: text });
  }

  return out;
}

// ── Response parser ────────────────────────────────────────────────────────────

function parseOpenAIResponse(data: any): LLMResponse | null {
  const choice = data.choices?.[0];
  if (!choice) return null;

  const content: ContentBlock[] = [];
  const rawContent = choice.message?.content;

  if (typeof rawContent === 'string' && rawContent.trim()) {
    content.push({ type: 'text', text: rawContent });
  } else if (Array.isArray(rawContent)) {
    for (const block of rawContent) {
      if (block.type === 'text' && block.text) {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input || {} });
      }
    }
  }

  const toolCalls = choice.message?.tool_calls;
  if (toolCalls?.length) {
    for (const tc of toolCalls) {
      let parsedInput: Record<string, any> = {};
      try { parsedInput = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ok */ }
      content.push({
        type: 'tool_use',
        id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: tc.function?.name || '',
        input: parsedInput,
      });
    }
  }

  if (content.length === 0) return null;

  const stop_reason =
    choice.finish_reason === 'tool_calls' ? 'tool_use'
    : choice.finish_reason === 'stop' ? 'end_turn'
    : (choice.finish_reason || 'end_turn');

  return { role: 'assistant', content, stop_reason };
}

// ── LLM caller ─────────────────────────────────────────────────────────────────

export async function callLLM(
  messages: LLMMessage[],
  tools: ToolSchema[],
  options: { maxTokens?: number; temperature?: number; forceToolCall?: boolean; deadlineAt?: number; fastFirst?: boolean } = {}
): Promise<LLMResponse> {
  const keys = getKeys();
  if (!keys.length) {
    log('error', 'Engine', 'No OpenRouter API keys configured — set OPENROUTER_API_KEY in .env');
    throw new Error('No OpenRouter API keys configured.');
  }

  const openAIMessages = toOpenAIMessages(messages);
  const openAITools = tools.length ? toOpenAITools(tools) : undefined;
  const hasTools = !!openAITools;

  const baseBody: Record<string, any> = {
    messages: openAIMessages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.3,
  };
  if (openAITools) {
    baseBody.tools = openAITools;
    // When forceToolCall is true, require the model to call a tool rather than
    // narrating what it intends to do. This is essential for the nudge system.
    baseBody.tool_choice = options.forceToolCall ? 'required' : 'auto';
  }

  const deadKeys = new Set<string>();

  function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
  function jitter(maxMs: number) { return Math.floor(Math.random() * maxMs); }

  async function tryOne(key: string, model: string, body: Record<string, any>, timeoutMs = 20000): Promise<LLMResponse | null> {
    if (deadKeys.has(key)) return null;
    // Out of wall-clock budget — don't start a call we can't finish in time.
    if (timeoutMs <= 0) return null;
    // Nemotron models are REASONERS: left on default they spend the entire
    // max_tokens budget thinking — small-budget calls come back as an empty
    // 200 (the "super-120b returns empty 200" mystery) and bigger ones add
    // 10-30s of latency per call. OpenRouter's unified `reasoning` param
    // disables it; live-verified 2026-07-14: ultra answers in ~1s with real
    // content AND still emits tool_calls. Non-reasoning models ignore the
    // param, but we gate to nemotron anyway to keep the blast radius zero.
    const finalBody: Record<string, any> = { ...body, model };
    if (/nemotron/i.test(model)) finalBody.reasoning = { enabled: false };
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://maily.dev',
          'X-Title': 'Boult AI',
        },
        body: JSON.stringify(finalBody),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        // 429 — respect Retry-After and mark model as cooling down.
        // This prevents hammering a rate-limited model across parallel calls.
        if (res.status === 429) {
          const errBody = await res.json().catch(() => null);
          const { daily, resetMs } = parseRateLimit(errBody);
          const retryAfterRaw = res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset-requests');
          const retryAfterSec = retryAfterRaw ? parseFloat(retryAfterRaw) : 30;
          markModelRateLimited(model, isNaN(retryAfterSec) ? 30 : retryAfterSec, daily && resetMs ? { dailyResetMs: resetMs } : undefined);
          return null;
        }
        const txt = await res.text().catch(() => '');
        if (res.status === 402) {
          paidDisabledUntil = Date.now() + 30 * 60 * 1000;
          log('warn', 'Engine', 'Account has no OpenRouter credit (402) — pausing paid fallback 30m', { model });
        } else if (res.status === 401 || res.status === 403) {
          deadKeys.add(key);
          log('error', 'Engine', `Key dead`, { key: `…${key.slice(-4)}`, status: res.status });
        } else {
          log('warn', 'Engine', `HTTP ${res.status}`, { model, key: `…${key.slice(-4)}`, resp: txt.slice(0, 200) });
          // Every key belongs to the SAME account, so a model-level HTTP error
          // (400 "provider returned error", 5xx) will repeat identically on the
          // remaining keys. Cool the model briefly so this call and the next
          // few skip it instead of proving the same failure 4 more times.
          markModelRateLimited(model, 20);
        }
        return null;
      }

      const data = await res.json();
      if (data.error) {
        // OpenRouter sometimes embeds 429 errors in a 200 body
        const errCode = data.error?.code ?? data.error?.status;
        if (errCode === 429 || String(data.error?.message ?? '').toLowerCase().includes('rate limit')) {
          const { daily, resetMs } = parseRateLimit(data);
          markModelRateLimited(model, 30, daily && resetMs ? { dailyResetMs: resetMs } : undefined);
          return null;
        }
        log('warn', 'Engine', `OR error`, {
          model, key: `…${key.slice(-4)}`,
          code: errCode,
          msg: String(data.error?.message ?? data.error ?? '').slice(0, 200),
        });
        // Embedded upstream errors ("ResourceExhausted: worker limit reached",
        // provider 5xx inside a 200) are model/provider-level — identical on
        // every key of this account. Cool the model instead of re-proving it.
        markModelRateLimited(model, 30);
        return null;
      }

      const parsed = parseOpenAIResponse(data);
      if (!parsed) {
        log('warn', 'Engine', `Empty response`, { model, finish: data.choices?.[0]?.finish_reason });
        // An empty 200 is model behaviour (e.g. a reasoner that spent the whole
        // token budget thinking), not key behaviour — retrying the same model
        // on 3 more keys just burns quota and seconds. Cool it for a minute.
        markModelRateLimited(model, 60);
        return null;
      }

      log('info', 'Engine', `OK`, { model: data.model ?? model, key: `…${key.slice(-4)}`, stop: parsed.stop_reason });
      return parsed;

    } catch (err: any) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      log('warn', 'Engine', isTimeout ? `Timeout` : `Fetch error`, {
        model, key: `…${key.slice(-4)}`, ms: timeoutMs, ...(isTimeout ? {} : { err: err.message }),
      });
      return null;
    }
  }

  // Try each active key SEQUENTIALLY for a single model — first success wins,
  // and we only touch key N+1 if key N actually failed.
  //
  // This used to race all keys with Promise.any. That was actively harmful:
  // every key belongs to the SAME OpenRouter account, and the free-model daily
  // request quota is metered per-ACCOUNT, not per-key. Racing 5 keys meant one
  // logical LLM call burned up to 5 requests from the same daily bucket (the 4
  // losers still reach OpenRouter and still count), so the daily cap was hit ~5x
  // faster than it should be. It also made keys 2-5 look "unused" on the
  // dashboard, because Promise.any resolved on key 1 and abandoned the rest
  // in-flight. Sequential = 1 request per call, and the extra keys become a real
  // failover reserve instead of a quota bonfire.
  async function tryModel(model: string, body: Record<string, any>, timeoutMs = 20000): Promise<LLMResponse | null> {
    if (isModelCooling(model)) {
      log('info', 'Engine', `Skip cooling model`, { model });
      return null;
    }
    const active = keys.filter(k => !deadKeys.has(k));
    if (!active.length) return null;
    log('info', 'Engine', `Trying`, { model, keys: active.length });

    for (let i = 0; i < active.length; i++) {
      // Re-derive the budget before EVERY key attempt. timeoutMs was computed
      // once before key 1 — with several keys and a HANGING provider, the
      // stale value let a single model burn keys × 32s, blowing straight
      // through a background run's wall-clock deadline. Vercel then killed
      // the function mid-run and the reaper wrote the daily "Run was cut
      // short by the serverless time limit" errors. The deadline must bound
      // the SUM of attempts, not each one independently.
      const perAttempt = Math.min(timeoutMs, effectiveTimeout());
      if (perAttempt <= 0) return null;
      // Small jitter before retrying on the NEXT key so concurrent callers don't
      // all stampede the same key at the same ms. No delay on the first attempt.
      if (i > 0) await sleep(jitter(150));

      const r = await tryOne(active[i], model, body, perAttempt);
      if (r) return r;

      // A per-day quota wall (or a cooldown set by a parallel caller) applies to
      // the whole ACCOUNT, so every remaining key would 429 identically. Bail out
      // to the next model instead of burning the rest of the keys to prove it.
      if (isModelCooling(model)) {
        log('info', 'Engine', `Model cooling — skipping remaining keys`, { model, skipped: active.length - i - 1 });
        return null;
      }
    }
    return null;
  }

  // Was 32000 — tuned specifically for gpt-oss-120b's slow reasoning on tool
  // calls (per the Pass-1 comment below). gpt-oss-120b is gone from every model
  // list (retired/dead, 2026-06/07-22 sweeps) so that justification no longer
  // applies. LIVE-TESTED 2026-07-23 (real tool-calling run, not a synthetic
  // ping): nemotron-3-ultra can genuinely HANG for the full timeout rather than
  // fast-failing — a real run burned 32s on ONE key of ONE model, which alone
  // consumed nearly the entire 28s home-feed triage deadline and left the next
  // three fallback models with almost no budget each, producing a total
  // failure ("all passes exhausted") even though several of those models are
  // healthy and fast (typically 1-8s) when they actually get a fair shot. This
  // is the mechanical reason "AI doesn't work" reproduced even after the dead
  // model ids were fixed. 12s comfortably covers every current model's
  // observed real latency with margin, while capping a hang's cost to a third
  // of what it was.
  const MODEL_TIMEOUT = 12000;

  // Deadline-aware per-call timeout. When the caller passes a wall-clock deadline
  // (background agent runs do — the function is killed at maxDuration), every model
  // attempt is capped at the time REMAINING (minus a small reserve), not a flat
  // 32s. Otherwise one step cycling through several slow models could overshoot the
  // function limit and get hard-killed mid-call → a run stuck forever in 'running'.
  // Returns <=0 when out of time, which makes tryOne a no-op so the chain unwinds
  // fast and throws the "busy" error the loop catches to finalize its report.
  const DEADLINE_RESERVE_MS = 1500;
  const effectiveTimeout = (): number => {
    if (options.deadlineAt == null) return MODEL_TIMEOUT;
    return Math.min(MODEL_TIMEOUT, options.deadlineAt - Date.now() - DEADLINE_RESERVE_MS);
  };

  // ORDER POLICY: free models ALWAYS go first; paid models are tried ONLY after
  // every free model has been rate-limited/exhausted (Pass 4 below). There is no
  // premium-first pass — paid is a pure fallback, never the opening move, so we
  // never spend money while a free model could have answered.

  // Pass 1: sequential free models, all keys race each.
  // Small fixed jitter between models to avoid thundering-herd without adding
  // meaningful latency (100ms flat vs. old 400-1200ms ramp).
  // Timeout must exceed the slowest healthy free model's real response time.
  // gpt-oss-120b (our most reliable free model) reasons for ~12s on simple
  // prompts and longer for tool calls — an 11s cap was killing the ONE model
  // that still works once the daily free quota is exhausted. Quota-dead models
  // 429 in ~0.5s regardless, so a longer cap only helps the working model.
  // fastFirst (conversational path) leads with small fast models so a "hi"
  // never waits on the 550B reasoner. Only applies without tools.
  const list = hasTools
    ? TOOL_CAPABLE_MODELS
    : (options.fastFirst ? FAST_MODELS : ALL_FREE_MODELS);
  log('info', 'Engine', 'Pass 1 — free models', { count: list.length, keys: keys.length, hasTools, fastFirst: !!options.fastFirst });
  for (let i = 0; i < list.length; i++) {
    if (i > 0) await sleep(100);
    const result = await tryModel(list[i], baseBody, effectiveTimeout());
    if (result) return result;
  }

  // Pass 2: brief pause then retry any models whose cooldowns may have expired.
  log('warn', 'Engine', 'Pass 1 failed — 800ms pause then retrying top models');
  await sleep(800);
  for (const model of TOOL_CAPABLE_MODELS.slice(0, 6)) {
    const result = await tryModel(model, baseBody, effectiveTimeout());
    if (result) return result;
    await sleep(200);
  }

  const noToolsBody: Record<string, any> = { ...baseBody };
  delete noToolsBody.tools;
  delete noToolsBody.tool_choice;

  const paidEnabled = PAID_MODELS.length && process.env.DISABLE_PAID_FALLBACK !== 'true' && Date.now() >= paidDisabledUntil;

  // Paid-with-tools fallback. Fires once every free model is rate-limited. For a
  // tool-driven request (e.g. a background agent), this MUST run before the
  // tool-stripping emergency below — stripping tools makes a tool-needing agent
  // return useless text with zero tool calls (the "no tools were called" empty
  // report). Paid models can actually call the tools, so try them with tools first.
  const tryPaidWithTools = async (): Promise<LLMResponse | undefined> => {
    if (!paidEnabled) return undefined;
    log('warn', 'Engine', 'Free models exhausted — paid fallback (with tools)', { models: PAID_MODELS });
    await sleep(300);
    for (const model of PAID_MODELS) {
      const r = await tryModel(model, baseBody, effectiveTimeout());
      if (r) { log('info', 'Engine', 'Paid fallback succeeded', { model }); return r; }
      await sleep(150);
    }
    return undefined;
  };

  // When the request needs tools, reach paid models (which can execute them)
  // BEFORE degrading to a tool-less text answer.
  if (hasTools) {
    const paid = await tryPaidWithTools();
    if (paid) return paid;
  }

  // Pass 3: emergency — strip tool schemas, try top free models for a text answer.
  log('warn', 'Engine', 'Pass 2 failed — emergency text-only round');
  await sleep(500);
  for (const model of TOOL_CAPABLE_MODELS.slice(0, 4)) {
    const r = await tryModel(model, noToolsBody, effectiveTimeout());
    if (r) return r;
    await sleep(200);
  }

  // For a no-tools request, the paid fallback comes here (after the free text
  // round) — same spend behaviour as before for plain chat.
  if (!hasTools) {
    const paid = await tryPaidWithTools();
    if (paid) return paid;
  }

  // Final emergency: paid + no tools (some paid models may refuse tools).
  if (paidEnabled) {
    for (const model of PAID_MODELS.slice(0, 2)) {
      const r = await tryModel(model, noToolsBody, effectiveTimeout());
      if (r) { log('info', 'Engine', 'Paid no-tools fallback succeeded', { model }); return r; }
    }
  }

  // PART 25 — better diagnostics when every pass fails. The browser-side
  // catch reads err.message to decide whether to auto-retry vs show hard
  // failure. Keep the canonical "models are currently busy" prefix so the
  // classifier still matches, but append diagnostics so the server log is
  // actually useful for debugging WHY (no keys, all dead, all rate-limited).
  const totalKeys = keys.length;
  const deadCount = deadKeys.size;
  const aliveCount = totalKeys - deadCount;
  const diag = totalKeys === 0
    ? 'no OpenRouter API keys configured'
    : aliveCount === 0
      ? `all ${totalKeys} API key(s) marked dead`
      : `${aliveCount}/${totalKeys} key(s) alive but every model returned null (rate-limited / cooling / empty)`;
  log('error', 'Engine', 'All passes exhausted', {
    keys: totalKeys, alive: aliveCount, dead: deadCount,
    deadKeys: [...deadKeys].map(k => `…${k.slice(-4)}`),
    diag,
  });
  // Also surface as a console.error so client-side diagnostics catch it
  // when the engine is being called inside the browser path.
  console.error('[Boult:Engine] All passes exhausted:', diag);
  throw new Error(`All models are currently busy. Please try again in a moment. (${diag})`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Strip internal model XML tags from text.
 * Free models emit <thinking>, <tool>, <tool_call> etc.
 */
export function sanitizeModelText(text: string): string {
  if (!text) return '';

  const CONTENT_TAGS = [
    'thinking', 'thought', 'tool', 'tool_call', 'tool_use', 'tool_result',
    'reasoning', 'reflection', 'scratchpad',
    'system', 'context', 'instruction', 'plan', 'step',
  ];
  const UNWRAP_TAGS = ['answer', 'output', 'result', 'response', 'final', 'message', 'reply'];

  let clean = text;

  for (const tag of CONTENT_TAGS) {
    clean = clean.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  for (const tag of [...CONTENT_TAGS, ...UNWRAP_TAGS]) {
    clean = clean.replace(new RegExp(`<\\/?${tag}[^>]*>`, 'gi'), '');
  }

  clean = clean.replace(/^<[^>]{0,30}$/gm, '');

  clean = clean.replace(/<[a-z_]+[^>]*>/gi, m =>
    /^<(br|strong|em|b|i|u|p|div|span|h[1-6]|ul|ol|li|a|code|pre)\b/i.test(m) ? m : '');
  clean = clean.replace(/<\/[a-z_]+>/gi, m =>
    /^<\/(br|strong|em|b|i|u|p|div|span|h[1-6]|ul|ol|li|a|code|pre)>/i.test(m) ? m : '');

  // Strip self-instructions that leaked from tool-result text into the chat
  // message. Shape: a paragraph addressed to the LLM ("do not call X again",
  // "wait for the user to click", "the UI will send the next message"). Never
  // something a real assistant would say to the user. Targets paragraphs
  // starting with IMPORTANT: / NOTE TO ASSISTANT: / INTERNAL: / SYSTEM: /
  // REMINDER TO YOU: / TO THE AGENT: AND containing telltale self-talk.
  const SELF_INSTRUCTION_PARAGRAPH =
    /(?:^|\n)\s*(?:IMPORTANT|NOTE TO (?:THE )?ASSISTANT|INTERNAL|SYSTEM|REMINDER TO (?:YOU|SELF)|TO THE (?:AGENT|MODEL|LLM))\s*[:\-—][^\n]*(?:do\s+not\s+(?:call|emit|write|use|continue)|wait\s+for\s+the\s+user|the\s+ui\s+will|next\s+turn|on the next call|stop\s+(?:and|here)|never\s+(?:call|emit))[^\n]*(?:\n(?!\s*$)[^\n]*)*/gi;
  clean = clean.replace(SELF_INSTRUCTION_PARAGRAPH, '');

  // Second shape: imperative-mood self-talk addressed to the LLM that uses no
  // header keyword. Pattern: "Now write/call/do X to the user ... Do NOT [verb]
  // more/any (tools|calls)." This catches tool-output tails like
  // "Now write a short confirmation to the user telling them the agent is
  // live ... Do NOT call any more tools."
  const IMPERATIVE_SELF_INSTRUCTION =
    /(?:\s|^)Now\s+(?:write|call|tell|reply|compose|confirm|provide|respond|give|do|inform|notify)\s+[^.\n]{0,200}?(?:the\s+user|to\s+the\s+user|in\s+chat|in\s+your\s+response)[^.\n]{0,200}?\.[^\n]{0,200}?(?:Do\s+NOT|Don'?t)\s+call\s+(?:any\s+more|more)\s+tools?\.?/gi;
  clean = clean.replace(IMPERATIVE_SELF_INSTRUCTION, '');

  // Third shape: bare "Do NOT call any more tools." sentence anywhere — that's
  // never something to say to a user.
  clean = clean.replace(/\s*Do\s+NOT\s+call\s+(?:any\s+more|more)\s+tools?\.?/gi, '');

  // Fourth shape: "Now write/confirm ..." tail when the rest of the strip
  // didn't trigger. Conservative — only at end of text and only when it
  // explicitly addresses the user.
  clean = clean.replace(/\s*Now\s+(?:write|call|tell|reply|compose|confirm)\s+[^.\n]*?(?:to\s+the\s+user|the\s+user)[^.\n]*?\.\s*$/gi, '');

  // F7.1: strip the "[Cached — you already called X ...]" prefix that leaks
  // when the LLM pastes its own tool-result envelope into chat. Match the
  // whole paragraph it lives in so we don't leave dangling fragments.
  clean = clean.replace(/\[\s*Cached\s*[—\-:]\s*[^\]\n]*\]\s*/gi, '');
  clean = clean.replace(/^\s*\[?\s*Cached\b[^\n]*\n?/gim, '');

  // F7.2: strip raw JSON paragraphs the LLM pastes from tool results.
  // Match a paragraph that is JUST {…} or […] on its own — never something
  // a user wants to see. Multiline-safe.
  clean = clean.replace(/(^|\n\n)\s*[\{\[][\s\S]{0,4000}?[\}\]]\s*(?=\n\n|$)/g, (m, sep) => {
    const body = m.trim();
    // Heuristic: only strip if it actually parses as JSON.
    try {
      JSON.parse(body);
      return sep || '';
    } catch {
      return m;
    }
  });

  // F7.3: strip tool-error envelopes the LLM mirrors verbatim. These are
  // INTERNAL failure strings ("Cannot show the agent spec — spec_markdown is
  // required …", "must_read_thread_first", "gmail_scope_missing"). They are
  // structured for the LLM, not the user.
  const TOOL_ERROR_PATTERNS = [
    /Cannot show the agent spec[^\n]*\n?/gi,
    /spec_markdown is required[^\n]*\n?/gi,
    /must_read_thread_first[^\n]*\n?/gi,
    /\b[a-z]+_(?:scope_missing|not_connected|token_expired|rate_limited|quota_exceeded)\b[^\n]*\n?/gi,
    /\b_internal_only\b[^\n]*\n?/gi,
    /Tool result[^\n]*?(?:success|failure)\s*:[^\n]*\n?/gi,
  ];
  for (const re of TOOL_ERROR_PATTERNS) {
    clean = clean.replace(re, '');
  }

  // PART 67 — Strip raw tool-call source the LLM emits as text instead of a
  // proper tool_use block. Some free models on OpenRouter literally type out
  // `request_confirmation({ "message": "..." })` as a chat message. Match a
  // line that is JUST a snake_case identifier followed by parens around a
  // JSON-looking blob. Multiline-safe because the JSON often spans lines.
  // Conservative on identifier (must end in _confirmation / _user / _email /
  // etc. — known tool-name suffixes) so we don't accidentally strip user
  // code snippets.
  const KNOWN_TOOL_NAMES = [
    'request_confirmation', 'ask_user', 'send_email', 'schedule_meeting',
    'search_gmail', 'search_inbox', 'read_email', 'draft_reply', 'save_draft',
    'send_slack_message', 'slack_send_dm', 'search_notion', 'create_notion_page',
    'notion_create_task', 'open_canvas', 'update_canvas', 'web_search',
    'create_scheduled_agent', 'list_scheduled_agents', 'pause_scheduled_agent',
    'resume_scheduled_agent', 'delete_scheduled_agent', 'forget_memory',
    'remember', 'log_meeting_notes', 'memory_search', 'memory_save',
    'get_calendar_events', 'calendar_get_availability', 'calendar_cancel_event',
    'check_followups', 'digest_newsletters', 'voice_profile_generate',
    'get_voice_profile', 'report_generate', 'report_send_gmail', 'report_send_slack',
    'switch_to_plan_mode',
  ];
  const TOOL_CALL_RE = new RegExp(
    `(^|\\n)\\s*(?:${KNOWN_TOOL_NAMES.join('|')})\\s*\\(\\s*\\{[\\s\\S]*?\\}\\s*\\)\\s*(?=\\n|$)`,
    'g',
  );
  clean = clean.replace(TOOL_CALL_RE, (m, sep) => sep || '');

  // Catch-all: any standalone `snake_case_identifier({...})` line. More
  // permissive than the explicit list but still requires the underscore +
  // JSON-shaped body, so it doesn't hit normal prose.
  clean = clean.replace(
    /(^|\n)\s*[a-z][a-z0-9_]*_[a-z][a-z0-9_]*\s*\(\s*\{[\s\S]{1,2000}?\}\s*\)\s*(?=\n|$)/g,
    (m, sep) => sep || '',
  );

  // PART 67 — Strip residual "Tell the user:" / "Tell user:" / "Inform the user:"
  // prefixes wherever they survived from older tool messages. The phrase is
  // an internal instruction template; the user-facing version reads cleaner
  // when we just remove the prefix and keep the quoted content.
  clean = clean.replace(
    /\b(?:Tell|Inform|Notify|Let)\s+(?:the\s+)?user\s*[:\-—]\s*["']?/gi,
    '',
  );
  // Closing quote left dangling after the prefix strip
  clean = clean.replace(/^(\s*[^"'\n]*[.!?])\s*["']\s*$/gm, '$1');

  // Strip lines that are ONLY a leaked programming literal ("False", "True",
  // "None", "null", "undefined"). Free models emit these as stray text
  // around tool calls and they rendered verbatim in the chat bubble.
  clean = clean.replace(/^\s*(?:true|false|none|null|undefined)\s*[.!]?\s*$/gim, '');

  // PART 67 — Strip the LLM's meta-commentary about its own output. Pattern
  // seen in the wild: "The message appears to garbled." / "My output looks
  // corrupted." / "It seems my response was cut off." These are leaked
  // self-corrections that should never reach the user.
  const META_COMMENTARY = [
    /(?:^|\n)\s*(?:The (?:message|response|output|reply) (?:appears to be|seems|looks) (?:garbled|corrupted|cut[- ]off|broken)\.?)/gi,
    /(?:^|\n)\s*(?:It (?:seems|appears|looks like) my (?:response|output|reply|message) (?:was|got|is) (?:cut[- ]off|garbled|corrupted|broken)\.?)/gi,
    /(?:^|\n)\s*(?:Apologies (?:for )?(?:the|my) (?:garbled|corrupted|broken|messy) (?:output|response|reply)\.?)/gi,
    /(?:^|\n)\s*(?:Sorry,?\s+let me (?:try again|restart|retry)\.?)\s*$/gi,
  ];
  for (const re of META_COMMENTARY) clean = clean.replace(re, '');

  // G1/G2 — Rewrite blunt refusal openings into action-first phrasing. The
  // system prompt already tells the LLM to never say "I can't" / "I'm
  // unable to" / "Unfortunately, …", but defence-in-depth: if it slips
  // through anyway, rewrite at the boundary. We rewrite ONLY the opening
  // clause so the rest of the LLM's plan survives.
  const REFUSAL_REWRITES: Array<{ re: RegExp; replacement: string }> = [
    { re: /^\s*I\s+can(?:no|')t\b/i,                replacement: "Here's how I'll handle it:" },
    { re: /^\s*I'?m\s+(?:not\s+able|unable)\s+to\b/i, replacement: "Here's how I'll handle it:" },
    { re: /^\s*Sorry,?\s+(?:but\s+)?I\s+can(?:no|')t\b/i, replacement: "Here's how I'll handle it:" },
    { re: /^\s*Unfortunately,?\s+/i,                replacement: "" },
    { re: /^\s*I\s+don'?t\s+have\s+(?:the\s+)?(?:ability|permission|access)\s+to\b/i, replacement: "Here's how I'll handle it:" },
    { re: /^\s*That'?s\s+beyond\s+my\s+capabilities\b/i, replacement: "Here's how I'll handle it:" },
  ];
  for (const { re, replacement } of REFUSAL_REWRITES) {
    clean = clean.replace(re, replacement);
  }

  return clean.replace(/\n{3,}/g, '\n\n').trim();
}

export function getRawText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

export function getText(content: ContentBlock[]): string {
  return sanitizeModelText(getRawText(content));
}

export function getToolCalls(
  content: ContentBlock[]
): Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, any> }> {
  return content.filter(
    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, any> } =>
      b.type === 'tool_use'
  );
}
