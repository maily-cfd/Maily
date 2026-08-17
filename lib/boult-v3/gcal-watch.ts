/**
 * Boult V3 — GCal Watch API Renewal & Management
 * 
 * Google Calendar Watch channels expire after 7 days max.
 * This module provides renewal and cleanup functions.
 * Call renewExpiredChannels() from a daily cron or scheduled task.
 */

import { getSupabaseAdmin } from '../supabase.js';
import { decrypt } from '../crypto.js';
import { googleFetch } from '../boult/tools/http-tokens';
import crypto from 'crypto';

/**
 * Renew GCal Watch channels that expire within the next 24 hours.
 * Should be called daily via cron or scheduled function.
 */
export async function renewExpiredChannels(): Promise<{ renewed: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Find channels expiring within 24 hours
  const { data: integrations } = await supabase
    .from('boult_integrations')
    .select('*')
    .eq('provider', 'gcal')
    .lt('channel_expiry', tomorrow)
    .not('channel_id', 'is', null);

  if (!integrations || integrations.length === 0) {
    return { renewed: 0, failed: 0 };
  }

  let renewed = 0;
  let failed = 0;

  for (const integration of integrations) {
    try {
      const accessToken = decrypt(integration.access_token);
      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const webhookUrl = `${baseUrl}/api/boult/v3/webhooks/gcal`;

      // 1. Stop the old channel first (best effort)
      if (integration.channel_id) {
        try {
          await googleFetch(integration.user_id, 'gcal', 'https://www.googleapis.com/calendar/v3/channels/stop', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: integration.channel_id,
              resourceId: integration.channel_id,
            }),
          });
        } catch {
          // Old channel may already be expired — continue
        }
      }

      // 2. Create a new channel
      const newChannelId = crypto.randomUUID();
      const newToken = crypto.randomBytes(32).toString('hex');

      const watchResponse = await googleFetch(integration.user_id, 'gcal',
        'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: newChannelId,
            type: 'web_hook',
            address: webhookUrl,
            token: newToken,
            params: { ttl: String(7 * 24 * 60 * 60) },
          }),
        }
      );

      if (!watchResponse.ok) {
        const err = await watchResponse.text();
        console.error(`[Boult V3] Watch renewal failed for ${integration.user_id}:`, err);
        failed++;
        continue;
      }

      const watchData = await watchResponse.json();
      const newExpiry = watchData.expiration
        ? new Date(parseInt(watchData.expiration, 10)).toISOString()
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // 3. Update the integration with new channel info
      await supabase
        .from('boult_integrations')
        .update({
          channel_id: newChannelId,
          channel_token: newToken,
          channel_expiry: newExpiry,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integration.id);

      renewed++;
      console.log(`[Boult V3] Watch renewed for ${integration.user_id}, expires: ${newExpiry}`);

    } catch (err) {
      console.error(`[Boult V3] Watch renewal error for ${integration.user_id}:`, (err as Error).message);
      failed++;
    }
  }

  return { renewed, failed };
}

/**
 * Stop a GCal Watch channel (used when disconnecting).
 */
export async function stopWatchChannel(
  accessToken: string,
  channelId: string,
  resourceId?: string
): Promise<boolean> {
  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: channelId,
        resourceId: resourceId || channelId,
      }),
      signal: AbortSignal.timeout(5000),
    });

    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
