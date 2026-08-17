import { NextResponse } from 'next/server';
import { auth as getSession } from '@/lib/auth';
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
 * GET /api/integrations/cal_com/callback
 * Handles the OAuth callback from Cal.com
 */
export async function GET(request) {
  const baseUrl = new URL(request.url).origin;

  try {
    const session = await getSession();
    if (!session?.user?.email) {
      return NextResponse.redirect(
        new URL('/dashboard/agent-talk?error=unauthorized', baseUrl)
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    console.log('[Cal.com Callback] Code received:', !!code, 'Error:', error);

    const provider = 'cal_com';
    const userEmail = session.user.email;

    // Handle OAuth error
    if (error) {
      console.error(`[Cal.com Callback] error:`, error, errorDescription);
      return NextResponse.redirect(
        new URL(`/dashboard/agent-talk?error=oauth_failed&provider=${provider}&message=${encodeURIComponent(errorDescription || error)}`, baseUrl)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/dashboard/agent-talk?error=missing_code', baseUrl)
      );
    }

    // Exchange code for tokens
    const credentials = await integrationManager.exchangeCode(provider, code, baseUrl);

    // Store credentials
    await integrationManager.storeCredentials(userEmail, provider, credentials);

    // Log success
    await db.logIntegrationEvent(userEmail, provider, 'connected', {
      scopes: credentials.scopes
    });

    // Redirect back to chat with success
    return NextResponse.redirect(
      new URL(`/dashboard/agent-talk?success=connected&provider=${provider}`, baseUrl)
    );
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Cal.com Callback] Error:', err);
    return NextResponse.redirect(
      new URL(`/dashboard/agent-talk?error=exchange_failed&message=${encodeURIComponent(err.message)}`, baseUrl)
    );
  }
}
