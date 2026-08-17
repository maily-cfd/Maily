import { NextResponse } from 'next/server';
// @ts-ignore
const { auth } = require('@/lib/auth.js');
import { DatabaseService } from '@/lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

/** POST /api/boult/conversation — upsert a full conversation snapshot */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { conversationId, messages, title } = body;

    if (!conversationId || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'conversationId and messages are required' }, { status: 400 });
    }

    const db = new DatabaseService();
    const result = await db.saveBoultChatSession(
      session.user.email,
      conversationId,
      messages,
      title || '',
    );

    return NextResponse.json({ success: true, saved: !!result });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[POST /api/boult/conversation]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** GET /api/boult/conversation — list conversations for the current user */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = new DatabaseService();
    const sessions = await db.listBoultChatSessions(session.user.email);
    return NextResponse.json({ sessions });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[GET /api/boult/conversation]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
