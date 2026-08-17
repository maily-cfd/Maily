/**
 * Boult V3 — Context Builder
 * 
 * Called once per job before the LLM call. Fetches all data the LLM
 * needs to reason and packages it into a single BoultContext object.
 * 
 * Fetch operations run in parallel via Promise.all where independent.
 */

import type { BoultContext, BoultEvent, BoultJob, BoultUserContext } from './types';
import { getSupabaseAdmin } from '../supabase.js';
import { decrypt } from '../crypto.js';
import { getV3Integrations } from './integrations';
import { googleFetch } from '../boult/tools/http-tokens';
import { normalizeGCalEvents } from './normalizers/gcal';
import { normalizeSlackHistory } from './normalizers/slack';
import { normalizeGmailMessages } from './normalizers/gmail';
import { Client } from '@notionhq/client';
import { normalizeNotionPage, normalizeNotionDatabaseItem, flattenNotionBlocks } from './normalizers/notion';

/**
 * Build the complete context for LLM reasoning.
 * 
 * @param userId - The user whose context to build
 * @param mode - 'agentic' (48hr events) or 'plan_mode' (7-day events)
 * @param triggeringEvent - The event that caused this job (null for Plan Mode)
 */
export async function buildContext(
  userId: string,
  mode: 'agentic' | 'plan_mode',
  triggeringEvent?: BoultEvent
): Promise<BoultContext> {
  const supabase = getSupabaseAdmin();

  // 1. Fetch user profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, preferences')
    .ilike('user_id', userId)
    .maybeSingle();

  const userContext: BoultUserContext = {
    id: userId,
    timezone: (profile?.preferences as Record<string, unknown>)?.timezone as string || 'UTC',
    preferences: (profile?.preferences as Record<string, unknown>) || {},
  };

  // 2. Fetch integrations (for API tokens)
  const integrations = await getV3Integrations(userId);

  const gcalIntegration = integrations?.find(i => i.provider === 'gcal');
  const slackIntegration = integrations?.find(i => i.provider === 'slack');
  const notionIntegration = integrations?.find(i => i.provider === 'notion_calendar') || integrations?.find(i => i.provider === 'notion');
  const gmailIntegration = integrations?.find(i => i.provider === 'gmail');

  // 3. Fetch data in parallel
  const eventWindow = mode === 'plan_mode' ? 7 : 2; // days
  const [upcomingEvents, recentMessages, notionEvents, recentEmails] = await Promise.all([
    gcalIntegration
      ? fetchGCalEvents(userId, gcalIntegration, eventWindow)
      : Promise.resolve([]),
    slackIntegration
      ? fetchSlackMessages(slackIntegration)
      : Promise.resolve([]),
    notionIntegration
      ? fetchNotionEvents(notionIntegration, eventWindow)
      : Promise.resolve([]),
    gmailIntegration
      ? fetchGmailEmails(userId, gmailIntegration)
      : Promise.resolve([]),
  ]);

  // 4. Build timezone-aware current time
  const now = new Date();
  const currentTime = now.toISOString();

  return {
    user: userContext,
    currentTime,
    upcomingEvents,
    recentMessages,
    notionEvents,
    recentEmails,
    triggeringEvent,
  };
}

/**
 * Fetch upcoming Google Calendar events.
 */
async function fetchGCalEvents(
  userId: string,
  integration: Record<string, unknown>,
  daysAhead: number
): Promise<BoultEvent[]> {
  try {
    const accessToken = decrypt(integration.access_token as string);
    const refreshToken = integration.refresh_token
      ? decrypt(integration.refresh_token as string)
      : null;

    const now = new Date();
    const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    // Use Google Calendar API via fetch (no googleapis dependency needed)
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const response = await googleFetch(userId, 'gcal',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      // If 401, the token might be expired — try refresh
      if (response.status === 401 && refreshToken) {
        const newToken = await refreshGCalToken(refreshToken);
        if (newToken) {
          // Retry with new token
          const retryResponse = await googleFetch(userId, 'gcal',
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            {
              headers: { Authorization: `Bearer ${newToken}` },
            }
          );
          if (retryResponse.ok) {
            const data = await retryResponse.json();
            return normalizeGCalEvents(data.items || []);
          }
        }
      }
      console.error(`[Boult V3] GCal API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return normalizeGCalEvents(data.items || []);
  } catch (error) {
    console.error('[Boult V3] GCal fetch error:', (error as Error).message);
    return [];
  }
}

/**
 * Fetch recent Slack messages (last 48 hours, up to 100 per channel).
 */
async function fetchSlackMessages(
  integration: Record<string, unknown>
): Promise<BoultEvent[]> {
  try {
    const accessToken = decrypt(integration.access_token as string);
    const workspaceInfo = integration.workspace_info as Record<string, unknown> || {};
    const teamId = workspaceInfo.team_id as string || '';

    // 1. Get channels the user is a member of
    const channelsResponse = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=50',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!channelsResponse.ok) {
      console.error('[Boult V3] Slack channels error:', channelsResponse.status);
      return [];
    }

    const channelsData = await channelsResponse.json();
    if (!channelsData.ok) {
      console.error('[Boult V3] Slack channels API error:', channelsData.error);
      return [];
    }

    const channels = (channelsData.channels || [])
      .filter((ch: Record<string, unknown>) => ch.is_member)
      .slice(0, 20); // Cap at 20 channels per spec

    // 2. Fetch history from each channel (48 hours, 100 messages max)
    const oldest = String(Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000));
    const allMessages: BoultEvent[] = [];

    // Batch fetches — max 50 requests/min for Slack Tier 3
    const batchSize = 5;
    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (channel: Record<string, unknown>) => {
          try {
            const histResponse = await fetch(
              `https://slack.com/api/conversations.history?channel=${channel.id}&oldest=${oldest}&limit=100`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(8000),
              }
            );
            if (!histResponse.ok) return [];
            const histData = await histResponse.json();
            if (!histData.ok) return [];
            return normalizeSlackHistory(
              histData.messages || [],
              channel.name as string,
              teamId
            );
          } catch {
            return [];
          }
        })
      );
      allMessages.push(...results.flat());

      // Small delay between batches to respect rate limits
      if (i + batchSize < channels.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return allMessages;
  } catch (error) {
    console.error('[Boult V3] Slack fetch error:', (error as Error).message);
    return [];
  }
}

/**
 * Refresh a Google OAuth token.
 */
async function refreshGCalToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Fetch Notion pages and database items.
 */
async function fetchNotionEvents(
  integration: Record<string, unknown>,
  daysAhead: number
): Promise<BoultEvent[]> {
  try {
    const accessToken = decrypt(integration.access_token as string);
    const notion = new Client({ auth: accessToken });
    const lookbackHours = 48; // Standard lookback for recent edits
    const lookbackDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

    // 1. Search for recently modified pages
    const { results: pages } = await notion.search({
      filter: { property: 'object', value: 'page' },
      sort: { timestamp: 'last_edited_time', direction: 'descending' },
      page_size: 20,
    });

    const recentPages = pages.filter((p: any) => p.last_edited_time > lookbackDate);
    const normalizedEvents: BoultEvent[] = [];

    // 2. Fetch content for recent pages (max 5 to avoid timeouts)
    for (const page of recentPages.slice(0, 5)) {
      try {
        const { results: blocks } = await notion.blocks.children.list({ block_id: page.id, page_size: 50 });
        const content = flattenNotionBlocks(blocks);
        normalizedEvents.push(normalizeNotionPage(page, content));
      } catch (e) {
        // Skip individual failures
      }
    }

    return normalizedEvents;
  } catch (err) {
    console.error('[Boult V3] Notion fetch error:', (err as Error).message);
    return [];
  }
}

/**
 * Fetch recent Gmail messages from the inbox (last 50, up to 48h).
 * Uses gmail.readonly scope — only reads, never writes.
 */
async function fetchGmailEmails(
  userId: string,
  integration: Record<string, unknown>
): Promise<BoultEvent[]> {
  try {
    const accessToken = decrypt(integration.access_token as string);

    // 1. List inbox message IDs (last 50). googleFetch proxies through Composio for
    // managed users (access_token is a composio: marker, not a bearer) or does the
    // direct authed call for legacy Google sign-in.
    const listRes = await googleFetch(userId, 'gmail',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&labelIds=INBOX&q=newer_than:2d',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!listRes.ok) {
      console.error('[Boult V3] Gmail list error:', listRes.status);
      return [];
    }

    const listData = await listRes.json();
    const messageIds: string[] = (listData.messages || []).map((m: { id: string }) => m.id);
    if (!messageIds.length) return [];

    // 2. Batch fetch message metadata (first 20 to avoid timeouts)
    const fetched = await Promise.all(
      messageIds.slice(0, 20).map(async (id) => {
        try {
          const res = await googleFetch(userId, 'gmail',
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })
    );

    const messages = fetched.filter(Boolean);
    return normalizeGmailMessages(messages);
  } catch (err) {
    console.error('[Boult V3] Gmail fetch error:', (err as Error).message);
    return [];
  }
}

