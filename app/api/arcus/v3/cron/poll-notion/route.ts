/**
 * Boult V3 — Notion Polling Cron
 * GET /api/boult/v3/cron/poll-notion
 *
 * Runs every 5 minutes. Finds all users with a Notion integration,
 * checks for recently modified pages, and enqueues a processing job
 * if changes are detected.
 *
 * Security: protected by CRON_SECRET header check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../../lib/supabase.js';
import { decrypt } from '../../../../../../lib/crypto.js';
import { Client } from '@notionhq/client';
import { enqueueEvent } from '../../../../../../lib/boult-v3/queue';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 1. Verify cron secret
  const cronSecret = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET || process.env.AUTH_SECRET;

  if (!expectedSecret || cronSecret !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  try {
    // 2. Find all Notion integrations
    const { data: integrations, error } = await supabase
      .from('boult_integrations')
      .select('*')
      .eq('provider', 'notion');

    if (error) throw error;
    if (!integrations || integrations.length === 0) {
      return NextResponse.json({ status: 'ok', processed: 0 });
    }

    let processed = 0;
    let eventsEnqueued = 0;

    // 3. Poll each workspace
    for (const integration of integrations) {
      try {
        const notion = new Client({ auth: decrypt(integration.access_token) });
        const lastChecked = integration.last_checked 
          ? new Date(integration.last_checked) 
          : new Date(Date.now() - 5 * 60 * 1000);

        // Search for pages modified since lastChecked
        const { results } = await notion.search({
          filter: { property: 'object', value: 'page' },
          sort: { timestamp: 'last_edited_time', direction: 'descending' },
          page_size: 10,
        });

        const newPages = results.filter((p: any) => 
          new Date(p.last_edited_time) > lastChecked
        );

        if (newPages.length > 0) {
          // Enqueue a job for this user
          // We pass the full payload of changes
          await enqueueEvent({
            userId: integration.user_id,
            source: 'notion',
            eventType: 'pages-changed',
            timestamp: Date.now(),
            payload: { pages: newPages },
          });
          eventsEnqueued++;
        }

        // Update last_checked timestamp
        await supabase
          .from('boult_integrations')
          .update({ last_checked: new Date().toISOString() })
          .eq('id', integration.id);

        processed++;
      } catch (err: any) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
        console.error(`[Boult V3] Notion poll error for ${integration.user_id}:`, err.message);
      }
    }

    return NextResponse.json({ status: 'ok', processed, eventsEnqueued });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Notion poll cron error:', (error as Error).message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
