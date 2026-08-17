/**
 * Autonomy API — the trust-ladder control surface.
 *
 *   GET  /api/boult/autonomy   → { settings, grants, suggestions, pendingActions }
 *   POST /api/boult/autonomy   → one of:
 *      { op: 'settings', enabled?, bufferMinutes?, allowInstant? }
 *      { op: 'setGrant', action, targetKey, level, delayMode?, scope?, label? }
 *      { op: 'acceptSuggestion', action, targetKey, delayMode? }   // → level 'auto'
 *      { op: 'dismissSuggestion', action, targetKey }
 *      { op: 'stopAction', id }                                    // cancel a pending auto action
 *
 * Paid-only (assertPaidAccess).
 */

import { NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '../../../../lib/auth.js';
import { assertPaidAccess } from '../../../../lib/subscription-protection.js';
import {
  getSettings, updateSettings, listGrants, listSuggestions, listAutonomyActions,
  setGrant, dismissSuggestion, stopAutonomyAction,
  type GrantAction, type GrantLevel, type DelayMode,
} from '../../../../lib/boult/autonomy-grants';
import { logEvent } from "@/lib/logsso";

const auth: any = nextAuth;
export const dynamic = 'force-dynamic';

const VALID_ACTIONS: GrantAction[] = ['send_email', 'schedule_meeting', 'send_slack_message', 'send_slack_dm', 'calcom_book'];
const VALID_LEVELS: GrantLevel[] = ['inherit', 'hold', 'auto', 'never'];

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email?.toLowerCase();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const gate = await assertPaidAccess(userId);
  if (!gate.ok) return NextResponse.json({ error: gate.error, upgradeUrl: gate.upgradeUrl }, { status: gate.status });

  const [settings, grants, suggestions, pendingActions] = await Promise.all([
    getSettings(userId),
    listGrants(userId),
    listSuggestions(userId),
    listAutonomyActions(userId, { includeDone: true }),
  ]);
  return NextResponse.json({ settings, grants, suggestions, pendingActions });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.email?.toLowerCase();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const gate = await assertPaidAccess(userId);
  if (!gate.ok) return NextResponse.json({ error: gate.error, upgradeUrl: gate.upgradeUrl }, { status: gate.status });

  let body: any;
  try { body = await request.json(); } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const op = body?.op;

  try {
    switch (op) {
      case 'settings': {
        await updateSettings(userId, {
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          bufferMinutes: typeof body.bufferMinutes === 'number' ? body.bufferMinutes : undefined,
          allowInstant: typeof body.allowInstant === 'boolean' ? body.allowInstant : undefined,
        });
        return NextResponse.json({ ok: true, settings: await getSettings(userId) });
      }
      case 'setGrant':
      case 'acceptSuggestion': {
        if (!VALID_ACTIONS.includes(body.action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 });
        if (!body.targetKey) return NextResponse.json({ error: 'targetKey required' }, { status: 400 });
        const level: GrantLevel = op === 'acceptSuggestion' ? 'auto' : body.level;
        if (!VALID_LEVELS.includes(level)) return NextResponse.json({ error: 'invalid level' }, { status: 400 });
        const delayMode: DelayMode = body.delayMode === 'instant' ? 'instant' : 'buffer';
        await setGrant({
          userId,
          action: body.action,
          targetKey: String(body.targetKey).toLowerCase(),
          level,
          delayMode,
          scope: body.scope === 'domain' ? 'domain' : 'contact',
          label: body.label || body.targetKey,
        });
        return NextResponse.json({ ok: true });
      }
      case 'dismissSuggestion': {
        if (!VALID_ACTIONS.includes(body.action) || !body.targetKey) return NextResponse.json({ error: 'action + targetKey required' }, { status: 400 });
        await dismissSuggestion(userId, body.action, String(body.targetKey).toLowerCase());
        return NextResponse.json({ ok: true });
      }
      case 'stopAction': {
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const stopped = await stopAutonomyAction(userId, body.id);
        return NextResponse.json({ ok: stopped });
      }
      default:
        return NextResponse.json({ error: 'unknown op' }, { status: 400 });
    }
  } catch (e: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
    console.error('[autonomy API]', e?.message || e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
