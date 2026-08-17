/**
 * Boult V3 — Slack Message Normalizer
 * 
 * Converts raw Slack Event API payloads into the internal
 * BoultEvent format. This is the ONLY place where raw Slack
 * types are touched.
 */

import type { BoultEvent } from '../types';
import crypto from 'crypto';

interface SlackMessage {
  type?: string;
  subtype?: string;
  text?: string;
  user?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
  blocks?: unknown[];
  files?: Array<{
    name?: string;
    url_private?: string;
  }>;
  // For bot messages
  bot_id?: string;
  username?: string;
}

interface SlackEventPayload {
  event?: SlackMessage;
  team_id?: string;
  event_id?: string;
  event_time?: number;
  // Channel info (if fetched separately)
  channel_name?: string;
  channel_id?: string;
}

/**
 * Normalize a single Slack message event to BoultEvent format.
 */
export function normalizeSlackMessage(payload: SlackEventPayload): BoultEvent {
  const event = payload.event || {};

  // Slack timestamps are Unix epoch with microseconds (e.g., "1695929400.123456")
  const timestamp = event.ts ? new Date(parseFloat(event.ts) * 1000) : new Date();

  // Build a deep link to the message in Slack
  const channelId = event.channel || payload.channel_id || '';
  const messageTs = event.ts?.replace('.', '') || '';
  const teamId = event.team || payload.team_id || '';
  const slackUrl = teamId && channelId && messageTs
    ? `https://app.slack.com/client/${teamId}/${channelId}/thread/${channelId}-${messageTs}`
    : `https://app.slack.com`;

  return {
    id: crypto.randomUUID(),
    source: 'slack',
    type: 'message',
    title: truncateText(event.text || '(empty message)', 100),
    description: event.text || null,
    startAt: timestamp,
    endAt: null,
    attendees: event.user ? [event.user] : [],
    url: slackUrl,
    rawPayload: payload,
    detectedAt: new Date(),
  };
}

/**
 * Normalize a Slack conversations.history response into BoultEvent[].
 */
export function normalizeSlackHistory(
  messages: SlackMessage[],
  channelName?: string,
  teamId?: string
): BoultEvent[] {
  return messages
    .filter(msg => !msg.subtype || msg.subtype === 'bot_message') // Skip join/leave/etc
    .map(msg => {
      const timestamp = msg.ts ? new Date(parseFloat(msg.ts) * 1000) : new Date();
      const channelId = msg.channel || '';
      const messageTs = msg.ts?.replace('.', '') || '';

      return {
        id: crypto.randomUUID(),
        source: 'slack' as const,
        type: 'message' as const,
        title: channelName
          ? `#${channelName}: ${truncateText(msg.text || '', 80)}`
          : truncateText(msg.text || '(empty message)', 100),
        description: msg.text || null,
        startAt: timestamp,
        endAt: null,
        attendees: msg.user ? [msg.user] : [],
        url: teamId && channelId && messageTs
          ? `https://app.slack.com/client/${teamId}/${channelId}/thread/${channelId}-${messageTs}`
          : 'https://app.slack.com',
        rawPayload: msg,
        detectedAt: new Date(),
      };
    });
}

/**
 * Truncate text to maxLength, adding ellipsis if truncated.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '…';
}
