import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth.js';
import { DatabaseService } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { logEvent } from "@/lib/logsso";

// Read-only email fetcher for Boult dashboard actions
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
      // allow empty body with defaults
    }

    const {
      query = 'newer_than:7d',
      limit = 5,
      includeBody = true,
      sort = 'internalDate desc',
    } = body;

    const db = new DatabaseService();
    const tokens = await db.getUserTokens(session.user.email);

    if (!tokens?.encrypted_access_token) {
      return NextResponse.json(
        { error: 'Gmail not connected. Please sign in with Google.' },
        { status: 400 }
      );
    }

    const accessToken = decrypt(tokens.encrypted_access_token);
    const refreshToken = tokens.encrypted_refresh_token ? decrypt(tokens.encrypted_refresh_token) : '';
    const { GmailService } = await import('@/lib/gmail.ts');
    const gmailService = new GmailService(accessToken, refreshToken);

    const emailsResponse = await gmailService.getEmails(limit, query, null, sort);
    const messages = emailsResponse?.messages || [];

    const emails = [];
    for (const message of messages.slice(0, limit)) {
      try {
        const details = await gmailService.getEmailDetails(message.id);
        const parsed = gmailService.parseEmailData(details);
        const bodyContent = includeBody
          ? (parsed.body?.substring(0, 2000) || parsed.snippet || '')
          : undefined;

        emails.push({
          id: message.id,
          threadId: parsed.threadId || '',
          subject: parsed.subject || '(No Subject)',
          from: parsed.from || 'Unknown Sender',
          to: parsed.to || '',
          date: parsed.date || '',
          snippet: parsed.snippet || '',
          labels: parsed.labels || [],
          isUnread: parsed.labels?.includes('UNREAD') || false,
          isImportant: parsed.labels?.includes('IMPORTANT') || false,
          body: bodyContent,
        });
      } catch (error) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.log('Error processing email for read-only endpoint:', error.message);
      }
    }

    return NextResponse.json({
      success: true,
      query,
      count: emails.length,
      emails,
    });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Read-only endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails', details: error.message },
      { status: 500 }
    );
  }
}

