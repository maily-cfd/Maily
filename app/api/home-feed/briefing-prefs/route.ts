/**
 * GET/POST /api/home-feed/briefing-prefs
 * Read + persist how the user wants their daily briefing shaped. Thin wrapper —
 * all shape/validation/storage lives in lib/boult/briefing-prefs.ts so the
 * recommendations endpoint reads the exact same source of truth.
 */
import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore — JS module
import { auth } from '@/lib/auth.js';
import { coerceBriefingPrefs, getBriefingPrefs, saveBriefingPrefs, DEFAULT_BRIEFING_PREFS } from '@/lib/boult/briefing-prefs';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

export async function GET() {
  // @ts-ignore
  const session = await (auth as any)();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const prefs = await getBriefingPrefs(session.user.email);
  return NextResponse.json({ prefs });
}

export async function POST(request: NextRequest) {
  // @ts-ignore
  const session = await (auth as any)();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const incoming = coerceBriefingPrefs(body?.prefs ?? body);
  try {
    await saveBriefingPrefs(session.user.email, incoming);
    return NextResponse.json({ success: true, prefs: incoming });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err?.message || 'save failed', prefs: DEFAULT_BRIEFING_PREFS }, { status: 500 });
  }
}
