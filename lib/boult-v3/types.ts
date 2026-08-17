/**
 * Boult V3 — Core Type Definitions & Zod Schemas
 * 
 * Every piece of data flowing through the system is typed here.
 * LLM outputs are validated with Zod before any DB write or UI render.
 */

import { z } from 'zod';

// ─── Normalized Event Schema ────────────────────────────────────────────────────
// Every integration normalizes its raw API response into this shape.
// The LLM sees ONLY BoultEvent objects — never raw API payloads.

export type BoultEventSource = 'gcal' | 'slack' | 'notion' | 'calcom' | 'gmail';
export type BoultEventType = 'meeting' | 'message' | 'page' | 'booking' | 'task' | 'email';

export interface BoultEvent {
  id: string;
  source: BoultEventSource;
  type: BoultEventType;
  title: string;
  description: string | null;
  startAt: Date | null;
  endAt: Date | null;
  attendees: string[];
  url: string | null;
  rawPayload: unknown;
  detectedAt: Date;
}

// ─── Job Queue ──────────────────────────────────────────────────────────────────

export type BoultJobSource = 'gcal' | 'slack' | 'notion' | 'cron_plan_mode' | 'user_manual';

export interface BoultJob {
  userId: string;
  source: BoultJobSource;
  eventType: string;
  payload: unknown;
  timestamp: number;
}

// ─── Context ────────────────────────────────────────────────────────────────────

export interface BoultUserContext {
  id: string;
  timezone: string;
  preferences: Record<string, unknown>;
}

export interface BoultContext {
  user: BoultUserContext;
  currentTime: string;
  upcomingEvents: BoultEvent[];    // GCal events
  recentMessages: BoultEvent[];   // Slack messages
  notionEvents?: BoultEvent[];    // Notion pages
  recentEmails?: BoultEvent[];    // Gmail inbox
  triggeringEvent?: BoultEvent;   // absent in Plan Mode / conversational mode
  userMessage?: string;           // present only in conversational mode
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// ─── Plan Artifact ──────────────────────────────────────────────────────────────

export type PlanStatus = 'proposed' | 'approved' | 'executing' | 'completed' | 'failed' | 'dismissed';
export type PlanMode = 'agentic' | 'plan_mode';
export type Severity = 'low' | 'medium' | 'high';
export type StepStatus = 'pending' | 'executing' | 'completed' | 'failed';

export interface PlanStep {
  id: string;
  planId: string;
  position: number;
  app: string;
  action: string;
  params: Record<string, unknown>;
  humanReadable: string;
  irreversible: boolean;
  status: StepStatus;
  error: string | null;
  executedAt: Date | null;
}

export interface Plan {
  id: string;
  userId: string;
  mode: PlanMode;
  status: PlanStatus;
  severity: Severity | null;
  headline: string | null;
  rawLlmInput: unknown;
  rawLlmOutput: unknown;
  findings: Finding[];
  createdAt: Date;
  executedAt: Date | null;
  completedAt: Date | null;
  steps: PlanStep[];
}

// ─── Zod Schemas — LLM Output Validation ────────────────────────────────────────

// Step schema for execution actions
export const StepSchema = z.object({
  app: z.enum(['gcal', 'slack', 'notion', 'calcom', 'gmail']),
  action: z.string(),
  params: z.record(z.string(), z.unknown()),
  humanReadable: z.string(),
});

// Option schema — each finding has 1-3 options (a single obvious right move
// is BETTER than padding to two; forced alternatives read as mock data)
export const OptionSchema = z.object({
  label: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
  tradeoff: z.string(),
  irreversible: z.boolean(),
  steps: z.array(StepSchema),
});

// Finding schema
export const FindingSchema = z.object({
  id: z.string(),
  headline: z.string(),
  impact: z.string(),
  options: z.array(OptionSchema).min(1).max(3),
  recommended: z.number().int().min(0),
});

// Agentic Mode LLM output
export const AgenticOutputSchema = z.object({
  hasActionableInsight: z.boolean(),
  severity: z.enum(['low', 'medium', 'high']),
  findings: z.array(FindingSchema),
});

export type AgenticOutput = z.infer<typeof AgenticOutputSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type Step = z.infer<typeof StepSchema>;

// Plan Mode (daily brief) LLM output
export const CriticalPathItemSchema = z.object({
  item: z.string(),
  reason: z.string(),
});

export const RiskSchema = z.object({
  risk: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  suggestion: z.string(),
});

export const FocusBlockSchema = z.object({
  day: z.string(),
  timeRange: z.string(),
  reason: z.string(),
});

export const DropOrDelegateSchema = z.object({
  item: z.string(),
  reasoning: z.string(),
});

export const PlanModeOutputSchema = z.object({
  generatedAt: z.string(),
  criticalPath: z.array(CriticalPathItemSchema).length(3),
  risks: z.array(RiskSchema),
  suggestedFocusBlocks: z.array(FocusBlockSchema),
  oneThingToDropOrDelegate: DropOrDelegateSchema,
});

export type PlanModeOutput = z.infer<typeof PlanModeOutputSchema>;

// ─── SSE Event Types ────────────────────────────────────────────────────────────

export type SSEEventType =
  | 'step:start'
  | 'step:done'
  | 'step:failed'
  | 'plan:completed'
  | 'plan:new';

export interface SSEEvent {
  type: SSEEventType;
  planId?: string;
  stepId?: string;
  error?: string;
}

// ─── Deep Link Map ──────────────────────────────────────────────────────────────

export const DEEP_LINKS: Record<string, string> = {
  gcal: 'https://calendar.google.com',
  slack: 'https://app.slack.com',
  notion: 'https://notion.so',
  calcom: 'https://app.cal.com',
  gmail: 'https://mail.google.com',
};
