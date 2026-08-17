/**
 * Boult V3 — Slack Action Handler
 * 
 * Executes Slack actions: send_message, set_status.
 * Validates required params before any API call.
 * Throws on API error with response body included.
 */

interface SlackTokens {
  accessToken: string;
}

/**
 * Execute a Slack action.
 */
export async function slackHandler(
  action: string,
  params: Record<string, unknown>,
  tokens: SlackTokens
): Promise<void> {
  const { accessToken } = tokens;

  switch (action) {
    case 'send_message':
      return sendMessage(accessToken, params);
    case 'set_status':
      return setStatus(accessToken, params);
    default:
      throw new Error(`Unknown slack action: ${action}`);
  }
}

async function sendMessage(
  token: string,
  params: Record<string, unknown>
): Promise<void> {
  const { channel, text, thread_ts } = params;

  if (!channel) throw new Error('slack.send_message requires channel');
  if (!text) throw new Error('slack.send_message requires text');

  const body: Record<string, unknown> = {
    channel,
    text,
  };

  if (thread_ts) {
    body.thread_ts = thread_ts;
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Slack postMessage failed (${response.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || 'unknown error'}`);
  }
}

async function setStatus(
  token: string,
  params: Record<string, unknown>
): Promise<void> {
  const { text, emoji, expiration } = params;

  const profile: Record<string, unknown> = {
    status_text: text || '',
    status_emoji: emoji || '',
  };

  if (expiration) {
    profile.status_expiration = Math.floor(
      new Date(expiration as string).getTime() / 1000
    );
  }

  const response = await fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ profile }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Slack setStatus failed (${response.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || 'unknown error'}`);
  }
}
