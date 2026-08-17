/**
 * GET /api/boult/integrations/test?provider=<provider>
 *
 * F6.4 — Verifies a connector actually works by making a single trivial
 * API call. Returns { ok: true, latency, scope?: string[] } on success or
 * { ok: false, reason } with a user-friendly message on failure.
 *
 * Use from the settings card "Test connection" button so the user gets a
 * clear answer ("connected and working") instead of having to try a
 * dependent tool to find out.
 */

import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth as nextAuth } from '../../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

// @ts-ignore
const auth: any = nextAuth;

export const dynamic = 'force-dynamic';

interface TestResult {
  ok: boolean;
  reason?: string;
  latency?: number;
  detail?: any;
}

async function testGmail(userId: string): Promise<TestResult> {
  const t0 = Date.now();
  // @ts-ignore — JS module path
  const { getSupabaseAdmin } = await import('../../../../../lib/supabase.js');
  const { normalizeUserId } = await import('../../../../../lib/boult/user-id');
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_integrations')
    .select('access_token')
    .eq('user_id', normalizeUserId(userId))
    .eq('provider', 'gmail')
    .maybeSingle();
  if (!data?.access_token) return { ok: false, reason: 'No Gmail token stored. Click Connect.' };

  // @ts-ignore
  const { decrypt } = await import('../../../../../lib/crypto.js');
  const { googleFetch } = await import('../../../../../lib/boult/tools/http-tokens');
  const token = decrypt(data.access_token);
  try {
    // googleFetch proxies through Composio for managed users (the stored token
    // is a composio: marker, not a bearer) or does the direct probe for legacy.
    const res = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'Token expired or missing scopes. Click Reconfigure.' };
    }
    if (!res.ok) return { ok: false, reason: `Gmail API returned ${res.status}` };
    const body = await res.json();
    return { ok: true, latency: Date.now() - t0, detail: { email: body.emailAddress } };
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return { ok: false, reason: err?.message || 'Network error' };
  }
}

async function testGcal(userId: string): Promise<TestResult> {
  const t0 = Date.now();
  // @ts-ignore
  const { getSupabaseAdmin } = await import('../../../../../lib/supabase.js');
  const { normalizeUserId } = await import('../../../../../lib/boult/user-id');
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_integrations')
    .select('access_token')
    .eq('user_id', normalizeUserId(userId))
    .eq('provider', 'gcal')
    .maybeSingle();
  if (!data?.access_token) return { ok: false, reason: 'No Calendar token stored. Click Connect.' };

  // @ts-ignore
  const { decrypt } = await import('../../../../../lib/crypto.js');
  const { googleFetch } = await import('../../../../../lib/boult/tools/http-tokens');
  const token = decrypt(data.access_token);
  try {
    // googleFetch proxies through Composio for managed users (the stored token
    // is a composio: marker, not a bearer) or does the direct probe for legacy.
    const res = await googleFetch(userId, 'gcal', 'https://www.googleapis.com/calendar/v3/calendars/primary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'Token expired or missing Calendar scope. Click Reconfigure.' };
    }
    if (!res.ok) return { ok: false, reason: `Calendar API returned ${res.status}` };
    const body = await res.json();
    return { ok: true, latency: Date.now() - t0, detail: { id: body.id, timeZone: body.timeZone } };
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return { ok: false, reason: err?.message || 'Network error' };
  }
}

async function testNotion(userId: string): Promise<TestResult> {
  const t0 = Date.now();
  // @ts-ignore
  const { getSupabaseAdmin } = await import('../../../../../lib/supabase.js');
  const { normalizeUserId } = await import('../../../../../lib/boult/user-id');
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_integrations')
    .select('access_token')
    .eq('user_id', normalizeUserId(userId))
    .eq('provider', 'notion')
    .maybeSingle();
  if (!data?.access_token) return { ok: false, reason: 'No Notion token stored. Click Connect.' };

  // @ts-ignore
  const { decrypt } = await import('../../../../../lib/crypto.js');
  const token = decrypt(data.access_token);
  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 401) return { ok: false, reason: 'Notion token expired. Click Reconfigure.' };
    if (!res.ok) return { ok: false, reason: `Notion API returned ${res.status}` };
    const body = await res.json();
    return { ok: true, latency: Date.now() - t0, detail: { name: body.name, type: body.type } };
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return { ok: false, reason: err?.message || 'Network error' };
  }
}

async function testSlack(userId: string): Promise<TestResult> {
  const t0 = Date.now();
  // @ts-ignore
  const { getSupabaseAdmin } = await import('../../../../../lib/supabase.js');
  const { normalizeUserId } = await import('../../../../../lib/boult/user-id');
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('boult_integrations')
    .select('access_token')
    .eq('user_id', normalizeUserId(userId))
    .eq('provider', 'slack')
    .maybeSingle();
  if (!data?.access_token) return { ok: false, reason: 'No Slack token stored. Click Connect.' };

  // @ts-ignore
  const { decrypt } = await import('../../../../../lib/crypto.js');
  const token = decrypt(data.access_token);
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    const body = await res.json();
    if (!body.ok) return { ok: false, reason: `Slack: ${body.error || 'auth.test failed'}` };
    return { ok: true, latency: Date.now() - t0, detail: { team: body.team, user: body.user } };
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return { ok: false, reason: err?.message || 'Network error' };
  }
}

const TESTERS: Record<string, (userId: string) => Promise<TestResult>> = {
  gmail: testGmail,
  gcal: testGcal,
  'google-calendar': testGcal,
  'google_calendar': testGcal,
  notion: testNotion,
  slack: testSlack,
};

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.email;

  const provider = new URL(request.url).searchParams.get('provider') || '';
  const tester = TESTERS[provider];
  if (!tester) {
    return NextResponse.json({ ok: false, reason: `Unknown provider: ${provider}` }, { status: 400 });
  }

  try {
    const result = await tester(userId);
    return NextResponse.json(result);
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ ok: false, reason: err?.message || 'Unknown error' }, { status: 500 });
  }
}
