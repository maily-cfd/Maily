/**
 * OAuth Callback Handlers for Integrations
 * 
 * Phase 4: Handle OAuth callbacks for all 5 integrations:
 * - Google Calendar
 * - Cal.com
 * - Notion
 * - Google Tasks
 * - Gmail (already exists but included for completeness)
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { supabase } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

// Database wrapper
const db = {
  async storeIntegrationCredentials(userEmail, provider, credentials) {
    const { error } = await supabase
      .from('integration_credentials')
      .upsert({
        user_email: userEmail,
        provider,
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        expires_at: credentials.expiresAt,
        scopes: credentials.scopes,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_email,provider'
      });
    
    if (error) throw error;
  },

  async logIntegrationEvent(userEmail, provider, event, metadata = {}) {
    await supabase
      .from('integration_events')
      .insert({
        user_email: userEmail,
        provider,
        event,
        metadata,
        created_at: new Date().toISOString()
      });
  }
};

const integrationManager = new BoultIntegrationManager(db);

/**
 * Handle OAuth callback for any provider
 * GET /api/integrations/auth/callback?provider=&code=&state=
 */
export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(
        `/dashboard/agent-talk?error=unauthorized`
      );
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Handle OAuth error from provider
    if (error) {
      console.error(`[OAuth Callback] ${provider} error:`, error, errorDescription);
      return NextResponse.redirect(
        `/dashboard/agent-talk?error=oauth_failed&provider=${provider}&message=${encodeURIComponent(errorDescription || error)}`
      );
    }

    if (!provider || !code) {
      return NextResponse.redirect(
        `/dashboard/agent-talk?error=missing_params`
      );
    }

    const userEmail = session.user.email;

    // Exchange code for tokens
    const credentials = await integrationManager.exchangeCode(provider, code);

    // Store credentials
    await integrationManager.storeCredentials(userEmail, provider, credentials);

    // Log success
    await db.logIntegrationEvent(userEmail, provider, 'connected', {
      scopes: credentials.scopes
    });

    // Redirect back to chat with success
    return NextResponse.redirect(
      `/dashboard/agent-talk?success=connected&provider=${provider}`
    );
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[OAuth Callback] Error:', error);
    return NextResponse.redirect(
      `/dashboard/agent-talk?error=exchange_failed&message=${encodeURIComponent(error.message)}`
    );
  }
}


