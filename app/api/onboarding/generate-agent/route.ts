import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth';
import { AIConfig } from '@/lib/ai-config';
import { logEvent } from "@/lib/logsso";

/**
 * POST /api/onboarding/generate-agent
 *
 * Turns a user's natural-language description into a REAL agent spec that maps
 * 1:1 onto the `boult_agents` table (name, task_description, cron_schedule,
 * output_channel). Used during onboarding "Describe your agent" → the returned
 * spec is what /api/boult/agents/create actually inserts. Nothing here is
 * decorative — every field is consumed downstream.
 */

type Channel = 'gmail' | 'slack' | 'both';
type Integration = 'gmail' | 'gcal' | 'notion' | 'slack';

interface AgentSpec {
  name: string;
  summary: string;
  task_description: string;
  cron_schedule: string;
  scheduleLabel: string;
  output_channel: Channel;
  required_integrations: Integration[];
  steps: string[];
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human label for a 5-field cron. Mirrors the helper in /api/boult/agents/create. */
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
  if (/^\d-\d$/.test(dow)) return `Weekdays at ${at}`;
  return `At ${at} (${cron})`;
}

function isValidCron(cron: unknown): cron is string {
  return typeof cron === 'string' && cron.trim().split(/\s+/).length === 5;
}

const VALID_CHANNELS: Channel[] = ['gmail', 'slack', 'both'];
const VALID_INTEGRATIONS: Integration[] = ['gmail', 'gcal', 'notion', 'slack'];

/**
 * Deterministic fallback used when the AI is unavailable or returns something
 * unmappable. Derives a sensible, REAL spec from the prompt keywords + selected
 * goals. Always returns a valid 5-field cron and a name that fits boult_agents.
 */
function synthesizeSpec(prompt: string, goals: string[]): AgentSpec {
  const text = `${prompt} ${goals.join(' ')}`.toLowerCase();
  const has = (...words: string[]) => words.some(w => text.includes(w));

  const wantsScheduling = has('schedule', 'meeting', 'calendar', 'book', 'availability');
  const wantsFollowup = has('follow', 'unanswered', 'nudge', 'chase', 'reminder');
  const wantsBriefing = has('brief', 'digest', 'summary', 'report', 'recap');
  const wantsNotion = has('notion', 'log', 'crm', 'database', 'pipeline', 'deal');
  const wantsSlack = has('slack');

  let base: AgentSpec;

  if (wantsScheduling) {
    base = {
      name: 'Meeting Scheduler',
      summary: 'Turns email meeting requests into calendar events and keeps you in the loop.',
      task_description: [
        'Handle meeting scheduling from my inbox. Every run:',
        '1. Search Gmail for unread threads requesting a meeting, call, or time to talk.',
        '2. Read each thread and check my Google Calendar for open slots that fit.',
        '3. Draft a reply in my voice proposing 2–3 specific times (do not send without my approval).',
        '4. When a time is agreed, create the calendar event with a Meet link and invite the attendees.',
        '5. Report what was scheduled and what is still awaiting a reply.',
      ].join('\n'),
      cron_schedule: '0 9 * * *',
      output_channel: 'gmail',
      required_integrations: ['gmail', 'gcal'],
      steps: [
        'Scan inbox for meeting requests',
        'Check calendar availability',
        'Draft replies proposing times',
        'Create events once confirmed',
      ],
      scheduleLabel: '',
    };
  } else if (wantsFollowup) {
    base = {
      name: 'Follow-Up Tracker',
      summary: 'Tracks threads awaiting a reply and drafts timely nudges.',
      task_description: [
        'Track my follow-ups. Every run:',
        '1. Search Gmail for threads I sent that have had no reply in 3+ days.',
        '2. Read each one to confirm a follow-up is actually warranted.',
        '3. Draft a short, polite nudge in my voice for each (leave as a draft for my approval).',
        '4. Report which threads are waiting and how long they have been silent.',
      ].join('\n'),
      cron_schedule: '0 9 * * 1-5',
      output_channel: 'gmail',
      required_integrations: ['gmail'],
      steps: [
        'Find sent threads with no reply',
        'Confirm a follow-up is warranted',
        'Draft polite nudges for approval',
        'Report what is still pending',
      ],
      scheduleLabel: '',
    };
  } else if (wantsBriefing) {
    base = {
      name: 'Daily Briefing',
      summary: 'A morning digest of what actually needs your attention.',
      task_description: [
        'Produce my daily briefing. Every run:',
        '1. Read unread email from the last 24 hours and rank by importance.',
        '2. Pull today\'s calendar.',
        wantsNotion ? '3. Note any items worth logging to Notion.' : '3. Flag anything urgent.',
        '4. Compose a concise briefing: what needs a reply, what is urgent, and today\'s schedule.',
      ].join('\n'),
      cron_schedule: '0 8 * * *',
      output_channel: wantsSlack ? 'both' : 'gmail',
      required_integrations: wantsNotion ? ['gmail', 'gcal', 'notion'] : ['gmail', 'gcal'],
      steps: [
        'Rank the last 24h of email',
        'Pull today\'s calendar',
        'Flag what is urgent',
        'Send a concise briefing',
      ],
      scheduleLabel: '',
    };
  } else {
    // Generic inbox triage — the safe, useful default.
    base = {
      name: 'Inbox Triage',
      summary: 'Triages your inbox and drafts replies in your voice each morning.',
      task_description: [
        (prompt.trim() ? `Goal: ${prompt.trim()}` : 'Triage and organize my inbox.'),
        'Every run:',
        '1. Read unread email from the last 24 hours.',
        '2. Categorize by priority and label accordingly.',
        '3. Draft replies in my voice for anything that needs one (leave as drafts for approval).',
        '4. Archive newsletters and low-priority promotions.',
        wantsNotion ? '5. Log important conversations to Notion.' : '5. Report what was handled and what needs me.',
      ].join('\n'),
      cron_schedule: '0 8 * * *',
      output_channel: wantsSlack ? 'both' : 'gmail',
      required_integrations: wantsNotion ? ['gmail', 'notion'] : ['gmail'],
      steps: [
        'Read the last 24h of unread mail',
        'Label by priority',
        'Draft replies for approval',
        'Archive the noise',
      ],
      scheduleLabel: '',
    };
  }

  base.scheduleLabel = cronToLabel(base.cron_schedule);
  return base;
}

/** Coerce a raw (possibly AI-produced) object into a safe, valid AgentSpec. */
function sanitizeSpec(raw: any, prompt: string, goals: string[]): AgentSpec {
  const fallback = synthesizeSpec(prompt, goals);
  if (!raw || typeof raw !== 'object') return fallback;

  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim().slice(0, 60)
    : fallback.name;

  const task_description = typeof raw.task_description === 'string' && raw.task_description.trim().length > 20
    ? raw.task_description.trim()
    : fallback.task_description;

  const cron_schedule = isValidCron(raw.cron_schedule) ? raw.cron_schedule.trim() : fallback.cron_schedule;

  const output_channel: Channel = VALID_CHANNELS.includes(raw.output_channel)
    ? raw.output_channel
    : fallback.output_channel;

  let required_integrations: Integration[] = Array.isArray(raw.required_integrations)
    ? raw.required_integrations.filter((i: any): i is Integration => VALID_INTEGRATIONS.includes(i))
    : fallback.required_integrations;
  if (!required_integrations.includes('gmail')) required_integrations = ['gmail', ...required_integrations];
  required_integrations = Array.from(new Set(required_integrations));

  const steps: string[] = Array.isArray(raw.steps) && raw.steps.length
    ? raw.steps.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim()).slice(0, 6)
    : fallback.steps;

  const summary = typeof raw.summary === 'string' && raw.summary.trim()
    ? raw.summary.trim().slice(0, 140)
    : fallback.summary;

  return {
    name,
    summary,
    task_description,
    cron_schedule,
    scheduleLabel: cronToLabel(cron_schedule),
    output_channel,
    required_integrations,
    steps,
  };
}

export async function POST(request: Request) {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, goals } = await request.json();

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const goalList: string[] = Array.isArray(goals) ? goals : [];

    // ── AI path ──────────────────────────────────────────────────────────────
    try {
      const aiService = new AIConfig();
      if (aiService.hasAIConfigured()) {
        const systemPrompt = `You are an agent planner for Maily, an autonomous email operator.
Convert the user's description into ONE scheduled background agent and return ONLY valid JSON — no prose, no markdown fences — with EXACTLY this shape:

{
  "name": "2-4 word agent name",
  "summary": "one sentence, under 140 chars, plain language",
  "task_description": "the standing instruction the agent runs every time it fires. Write it as numbered steps in the first person ('my inbox', 'my calendar'). Be specific about Gmail/Calendar/Notion/Slack actions. Drafts must be left for the user's approval, never auto-sent.",
  "cron_schedule": "valid 5-field cron in the user's local time (e.g. '0 8 * * *' daily 8am, '0 9 * * 1-5' weekdays 9am, '0 16 * * 5' Friday 4pm, '*/30 * * * *' every 30 min)",
  "output_channel": "gmail" | "slack" | "both",
  "required_integrations": ["gmail", ...subset of "gmail"|"gcal"|"notion"|"slack"],
  "steps": ["4-6 short human-readable workflow steps for a preview card"]
}

Rules:
- "gmail" is ALWAYS in required_integrations.
- Only include "gcal" if the agent touches the calendar; "notion" only if it logs/reads Notion; "slack" only if it posts to Slack.
- output_channel "slack"/"both" requires "slack" in required_integrations.
- Pick a sensible default schedule if the user didn't specify one (most email agents run once each morning, "0 8 * * *").

User's selected goals: ${goalList.join(', ') || '(none)'}
User's description: ${prompt}`;

        const response = await aiService.generateChatResponse(systemPrompt, prompt, null, false);

        const jsonMatch = typeof response === 'string' ? response.match(/\{[\s\S]*\}/) : null;
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const spec = sanitizeSpec(parsed, prompt, goalList);
          return NextResponse.json({ success: true, agent: spec });
        }
      }
    } catch (aiError) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(aiError) });
      console.warn('⚠️ [Onboarding] AI agent generation failed, using synthetic fallback:', aiError);
    }

    // ── Deterministic fallback — always returns a valid, mappable spec ────────
    return NextResponse.json({ success: true, agent: synthesizeSpec(prompt, goalList) });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('❌ [Onboarding] Error generating agent:', error);
    return NextResponse.json({ error: 'Failed to generate agent plan' }, { status: 500 });
  }
}
