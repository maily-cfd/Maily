/**
 * Intent Classifier (F1)
 *
 * Classifies the incoming user message into one of seven intent buckets so the
 * loop can decide whether to invoke the 5-VA dispatch reflex (tools) or just
 * answer conversationally. This kills the "Who are you?" → calendar tool
 * dispatch bug.
 *
 * Implementation: regex-based heuristic — zero LLM cost, sub-millisecond, and
 * fully deterministic. The plan called for a 50ms LLM hop but for these
 * obvious cases a regex catches them with higher reliability and no API cost.
 *
 * The intent string is also surfaced in the system prompt as `[INTENT: …]`
 * so the LLM can lean on it when planning.
 */

export type Intent =
  | 'smalltalk'
  | 'identity'
  | 'capability'
  | 'query'
  | 'command'
  | 'agent_creation'
  | 'follow_up'
  | 'outreach_kickoff';

const IDENTITY_PATTERNS: RegExp[] = [
  /^\s*who\s+(?:are|r)\s+(?:you|u)\s*\??\s*$/i,
  /^\s*what\s+(?:are|r)\s+(?:you|u)\s*\??\s*$/i,
  /^\s*(?:are|r)\s+(?:you|u)\s+(?:an?\s+)?(?:ai|bot|human|chatgpt|claude|gpt|robot)\s*\??\s*$/i,
  /^\s*(?:what'?s|whats)\s+your\s+name\s*\??\s*$/i,
  /^\s*introduce\s+yourself\s*\.?\s*$/i,
  /^\s*tell\s+me\s+about\s+yourself\s*\.?\s*$/i,
];

const SMALLTALK_PATTERNS: RegExp[] = [
  /^\s*(?:hi|hey|hello|yo|sup|hiya|howdy|gm|good\s+morning|good\s+afternoon|good\s+evening|good\s+night)[\s!.,?]*$/i,
  /^\s*(?:how\s+are\s+you|how'?s\s+it\s+going|how\s+goes\s+it|hru|wassup|what'?s\s+up)\s*\??\s*$/i,
  /^\s*(?:thanks|thank\s+you|thx|ty|cheers|appreciated)[\s!.,?]*$/i,
  /^\s*(?:bye|goodbye|cya|see\s+you|later|gn|good\s+night)[\s!.,?]*$/i,
  /^\s*(?:cool|nice|great|awesome|ok|okay|got\s+it|alright|sounds\s+good|sure|yes|yep|yeah|no|nope)[\s!.,?]*$/i,
  /^\s*(?:lol|haha|hehe|lmao|rofl|omg|wow)[\s!.,?]*$/i,
];

const CAPABILITY_PATTERNS: RegExp[] = [
  /\bwhat\s+can\s+you\s+do\b/i,
  /\bwhat\s+do\s+you\s+do\b/i,
  /\bhow\s+(?:can|do)\s+you\s+(?:help|work)\b/i,
  /\b(?:what|which)\s+(?:tools|integrations|apps|features|skills|capabilities)\s+(?:do\s+you\s+have|are\s+(?:there|available))\b/i,
  /\b(?:can|could)\s+you\s+(?:also|even)?\s*(?:do|handle|manage)\b.{0,40}\?/i,
  /\bdo\s+you\s+(?:support|integrate\s+with|have\s+access\s+to)\b/i,
  /\bwhat\s+are\s+your\s+(?:capabilities|features|skills)\b/i,
];

// Outreach kickoff: the user wants to START a cold-outreach job but has NOT
// yet given the list or the pitch. Boult must respond by ASKING for them — a
// fast conversational turn, zero tools (there's nothing to act on yet). This
// exists so the "Start outreach" pill can't trigger a full tool loop that
// spins for 40s on an empty job and dies on the deadline. The marker phrase is
// deterministic (emitted only by the pill), plus a couple of natural forms.
const OUTREACH_KICKOFF_PATTERNS: RegExp[] = [
  /\[?outreach[_\s-]?kickoff\]?/i,
  /\b(?:help\s+me\s+)?(?:run|start|do|set\s*up)\s+(?:some\s+)?(?:cold\s+)?outreach\b(?![^.?!]*\b(?:list|csv|these|attached|following|below|pasted)\b)/i,
  /\bi\s+want\s+to\s+(?:run|do|start)\s+(?:cold\s+)?outreach\b/i,
];

const AGENT_CREATION_PATTERNS: RegExp[] = [
  /\b(?:create|set\s*up|setup|build|make|register|schedule|configure)\b.{0,40}\b(?:agent|bot|automation|cron|job|background|recurring|daily|hourly|weekly)\b/i,
  /\b(?:agent|automation|bot)\b.{0,30}\b(?:every\s+day|each\s+morning|daily|hourly|weekly|on\s+a\s+schedule)\b/i,
  /\b(?:run|do|check|process)\b.{0,30}\b(?:every|each)\s+(?:morning|day|hour|week|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:set\s*up|setup|build)\s+(?:a|an)\s+(?:daily|hourly|weekly|morning|evening|nightly)\b/i,
];

const COMMAND_PATTERNS: RegExp[] = [
  /^\s*(?:draft|send|reply|respond|write|compose|create|schedule|book|cancel|delete|archive|label|post|dm|message|forward|search|find|look\s*up|fetch|get|read|show|list|summarize|summarise|analyze|analyse|prepare|generate|build|make|update|edit)\b/i,
  /\bplease\s+(?:draft|send|reply|respond|write|compose|create|schedule|book|cancel|delete|archive|label|post|dm|message|forward|search|find|look\s*up|fetch|get|read|show|list|summarize|summarise)\b/i,
  /\bcan\s+you\s+(?:draft|send|reply|respond|write|compose|create|schedule|book|cancel|delete|archive|label|post|dm|message|forward|search|find|look\s*up|fetch|get|read|show|list|summarize|summarise)\b/i,
];

const FOLLOW_UP_PATTERNS: RegExp[] = [
  /^\s*(?:yes|yep|yeah|yup|sure|ok|okay|go\s+ahead|do\s+it|sounds\s+good|confirm|confirmed|approve|approved|proceed|continue)[\s!.,?]*$/i,
  /^\s*(?:no|nope|cancel|stop|abort|nevermind|never\s+mind|skip)[\s!.,?]*$/i,
  /^\s*(?:and|also|then)\b.{0,80}$/i,
];

const QUERY_PATTERNS: RegExp[] = [
  /^\s*(?:what|when|where|who|how|why|which|whose)\b/i,
  /\?$/,
  /\b(?:any|got|have)\s+(?:emails|meetings|messages|tasks|deals|updates)\b/i,
  /\b(?:what'?s|whats)\s+(?:on|in|going)\b/i,
];

/**
 * Classify a user message into one intent bucket.
 *
 * Order matters: more specific patterns checked first. Default falls through
 * to `command` because if a message isn't smalltalk/identity/capability/
 * query/follow_up and contains substantive text, treat it as an actionable
 * order (the safer side for a productivity agent).
 */
export function classifyUserIntent(message: string, hasOpenConfirmation = false): Intent {
  const trimmed = (message || '').trim();
  if (!trimmed) return 'smalltalk';

  // Very short messages while a confirmation is pending → follow_up.
  if (hasOpenConfirmation && trimmed.length < 30) {
    return 'follow_up';
  }

  if (IDENTITY_PATTERNS.some(re => re.test(trimmed))) return 'identity';
  if (CAPABILITY_PATTERNS.some(re => re.test(trimmed))) return 'capability';
  // Outreach kickoff BEFORE agent_creation/command — "start outreach" with no
  // list yet must ask, not act. If a list/CSV/"these people" is present, the
  // negative lookahead lets it fall through to command (real work to do).
  if (OUTREACH_KICKOFF_PATTERNS.some(re => re.test(trimmed))) return 'outreach_kickoff';
  if (AGENT_CREATION_PATTERNS.some(re => re.test(trimmed))) return 'agent_creation';
  if (SMALLTALK_PATTERNS.some(re => re.test(trimmed))) return 'smalltalk';
  if (FOLLOW_UP_PATTERNS.some(re => re.test(trimmed)) && trimmed.length < 60) return 'follow_up';
  if (COMMAND_PATTERNS.some(re => re.test(trimmed))) return 'command';
  if (QUERY_PATTERNS.some(re => re.test(trimmed))) return 'query';

  return 'command';
}

/**
 * Intents that should bypass the tool layer entirely — the LLM answers
 * conversationally with zero tool dispatch. Stops "Who are you?" from
 * triggering a calendar tool call.
 */
export function shouldSuppressTools(intent: Intent): boolean {
  return intent === 'smalltalk' || intent === 'identity' || intent === 'capability' || intent === 'outreach_kickoff';
}

/**
 * One-line context hint injected into the system prompt so the LLM reads
 * the classification on every turn.
 */
export function intentSystemHint(intent: Intent): string {
  const hints: Record<Intent, string> = {
    smalltalk: 'User is making small talk — just chatting. Reply like a sharp colleague texting back: warm, a little energy, 1-2 sentences, and keep the conversation moving (a light question or hook back is great). Match their vibe. No corporate stiffness, no "How can I assist you today?", no tools, no capability lists.',
    identity: 'User is asking who/what you are. Warm and confident, ~2 sentences: you\'re Boult, their AI chief of staff — you actually run their inbox across Gmail, Calendar, Notion and Slack (read, draft, schedule, follow up) so email stops being their job. A touch of personality, then invite them in ("What\'s on your plate — want me to take a look?"). No tools.',
    capability: 'User is asking what you can do. Lead with the outcome, warmly, not a feature dump: you take email off their plate — read and triage everything, draft replies in their voice, book meetings, chase follow-ups, and run on a schedule in the background. 2-3 lively sentences, then a concrete offer ("Want me to sweep your inbox right now?"). No tools — this is a question, not an order.',
    query: 'User is asking a question that likely needs data. Use the dispatch reflex — fetch from the relevant VAs in parallel.',
    command: 'User gave a direct order. Execute it directly with the right tool. Do NOT ask "should I proceed?" — they already told you to.',
    agent_creation: 'User wants to create a scheduled/background agent. Use the create_scheduled_agent two-stage flow. Do NOT execute the agent\'s work yourself.',
    follow_up: 'User is replying to your previous turn — likely confirming, cancelling, or adding detail. Read the prior context before acting.',
    outreach_kickoff: 'User wants to START cold outreach but has NOT given the list or the pitch yet. Do NOT call any tools — there is nothing to act on. Respond in 2-3 warm, confident sentences that (1) say you\'ll run the whole thing end to end, (2) ask them to give you the list (paste it, attach a CSV, or name their Notion leads database) AND tell you the pitch (what to offer, why these people, what a good reply looks like), and (3) reassure them nothing sends until they approve. Keep it human, no bullet dump. Once they reply with the list + pitch, THAT turn is when you actually run intake/research/draft per the outreach playbook.',
  };
  return `[INTENT: ${intent}] ${hints[intent]}`;
}
