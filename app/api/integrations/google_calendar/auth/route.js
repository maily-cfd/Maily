import { NextResponse } from 'next/server';
import { auth as getSession } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { supabase } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

// Database wrapper for integration manager (reuse logic from main integrations/route.js)
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

  async getIntegrationCredentials(userEmail, provider) {
    const { data, error } = await supabase
      .from('integration_credentials')
      .select('*')
      .eq('user_email', userEmail)
      .eq('provider', provider)
      .single();
    
    if (error || !data) return null;
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      scopes: data.scopes || []
    };
  }
};

const integrationManager = new BoultIntegrationManager(db);

/**
 * GET /api/integrations/google_calendar/auth
 * Initiates the Google Calendar OAuth flow with specific calendar scopes
 */
export async function GET(request) {
  try {
    const session = await getSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The user's requirement: redirect directly to Google with specific scopes for this tool only
    // We encode the user email or provider-specific state to verify on callback
    const state = Buffer.from(JSON.stringify({ 
      user: session.user.email,
      provider: 'google_calendar'
    })).toString('base64');

    const { origin } = new URL(request.url);
    const authUrl = integrationManager.getAuthUrl('google_calendar', state, origin);
    console.log('[Google Calendar Auth] Generated Auth URL:', authUrl);

    return NextResponse.json({ url: authUrl });
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[Google Calendar Auth] Error:', err);
    return NextResponse.json({ error: 'Failed to generate auth URL' }, { status: 500 });
  }
}
