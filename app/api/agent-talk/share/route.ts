import { NextResponse } from 'next/server';
// @ts-ignore
const { auth } = require('@/lib/auth.js');
import { DatabaseService } from '@/lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { conversationId, messages, title } = body;
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array is required and cannot be empty' }, { status: 400 });
    }

    const db = new DatabaseService();
    const userId = session.user.email.toLowerCase();

    // Call the database helper to save the shared chat snapshot
    const sharedConvo = await db.createSharedConversation(userId, conversationId, messages, title);
    if (!sharedConvo) {
      return NextResponse.json({ error: 'Failed to create share record' }, { status: 500 });
    }

    // Build the share url using the host header or host config
    const host = request.headers.get('host') || 'maily.dev';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const shareUrl = `${protocol}://${host}/share/${sharedConvo.id}`;

    return NextResponse.json({
      success: true,
      shareId: sharedConvo.id,
      shareUrl,
      title: sharedConvo.title,
    });
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Error generating share link:', error);
    return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
  }
}
