/**
 * Boult V3 — Step Dispatcher
 * 
 * Routes plan steps to the correct integration handler.
 * Fetches and decrypts tokens before dispatching.
 */

import { getSupabaseAdmin } from '../supabase.js';
import { getTokenPair } from './integrations';
import { gcalHandler } from './handlers/gcal';
import { slackHandler } from './handlers/slack';
import { notionHandler } from './handlers/notion';
import { calcomHandler } from './handlers/calcom';
import { executeGmailAction } from './handlers/gmail';

/**
 * Execute a single step by dispatching to the appropriate handler.
 * Fetches decrypted tokens for the given app + user.
 */
export async function executeStep(
  step: { app: string; action: string; params: Record<string, unknown> },
  userId: string
): Promise<any> {
  const tokens = await getDecryptedTokens(userId, step.app);

  switch (step.app) {
    case 'gcal':
      return gcalHandler(step.action, step.params, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    case 'slack':
      return slackHandler(step.action, step.params, {
        accessToken: tokens.accessToken,
      });
    case 'notion':
      return notionHandler(step.action, step.params, {
        accessToken: tokens.accessToken,
      });
    case 'calcom':
      return calcomHandler(tokens.accessToken, step.action, step.params);
    case 'gmail':
      return executeGmailAction(userId, tokens.accessToken, step.action, step.params) as any;
    default:
      throw new Error(`Unknown app: ${step.app}`);
  }
}

/**
 * Fetch and decrypt OAuth tokens for a given user + provider.
 * Always scoped to userId — never fetches by ID alone.
 */
async function getDecryptedTokens(
  userId: string,
  provider: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  const tokens = await getTokenPair(userId, provider);

  if (!tokens) {
    throw new Error(`No ${provider} integration found for user. Connect ${provider} first.`);
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || undefined,
  };
}
