import { NextResponse } from 'next/server';
import { auth as getSession } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { getSupabaseAdmin } from '@/lib/supabase';
import { encrypt } from '@/lib/crypto';
import { logEvent } from "@/lib/logsso";

// Database wrapper
const db = {
  async storeIntegrationCredentials(userEmail, provider, credentials) {
    const supabase = getSupabaseAdmin();
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
    const supabase = getSupabaseAdmin();
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
 * GET /api/integrations/google_calendar/callback
 * Handles the OAuth callback from Google specifically for Calendar
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

    console.log('[Google Calendar Callback] Code received:', !!code, 'Error:', error);

    const provider = 'google_calendar';
    const userEmail = session.user.email;

    // Handle OAuth error from Google
    if (error) {
      console.error(`[Google Calendar Callback] error:`, error, errorDescription);
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

    // Write encrypted tokens to boult_integrations so the v3 agent dispatcher can use them
    const supabase = getSupabaseAdmin();
    await supabase.from('boult_integrations').upsert({
      user_id: userEmail.toLowerCase(),
      provider: 'gcal',
      access_token: encrypt(credentials.accessToken),
      refresh_token: credentials.refreshToken ? encrypt(credentials.refreshToken) : null,
      scopes: credentials.scopes || [],
      expires_at: credentials.expiresAt || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    // Redirect back to chat with success
    return NextResponse.redirect(
      new URL(`/dashboard/agent-talk?success=connected&provider=${provider}`, baseUrl)
    );
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Google Calendar Callback] Error:', err);
    return NextResponse.redirect(
      new URL(`/dashboard/agent-talk?error=exchange_failed&message=${encodeURIComponent(err.message)}`, baseUrl)
    );
  }
}
