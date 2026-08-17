/**
 * AI Transparency API — Shows users what data was sent to AI
 * GET: Retrieve AI usage transparency logs
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLogger, AUDIT_EVENTS } from '@/lib/audit-logger';
import { logEvent } from "@/lib/logsso";

export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Only fetch AI-related events
    const aiEventTypes = [
      AUDIT_EVENTS.AI_DRAFT_GENERATED,
      AUDIT_EVENTS.AI_SUMMARY_GENERATED,
      AUDIT_EVENTS.AI_SIFT_ANALYSIS,
      AUDIT_EVENTS.AI_BOULT_CHAT,
      AUDIT_EVENTS.AI_PII_STRIPPED,
    ];

    // Fetch all AI events using the general query with type filter
    const allResults = [];
    for (const eventType of aiEventTypes) {
      const result = await auditLogger.getUserLogs(session.user.email, {
        limit: 10, offset: 0, eventType
      });
      allResults.push(...result.data);
    }

    // Sort by date and apply pagination
    allResults.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const paginated = allResults.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      logs: paginated,
      total: allResults.length,
      transparency: {
        aiProvider: 'OpenRouter (routes to various models)',
        dataPolicy: 'API calls are not used for model training',
        piiStripping: 'Names, emails, phones are replaced with placeholders before AI processing',
        dataRetention: 'AI providers do not retain your data beyond the API call'
      }
    });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('🔍 [AI Transparency API] Error:', error.message);
    return NextResponse.json({ error: 'Failed to retrieve AI transparency logs' }, { status: 500 });
  }
}
