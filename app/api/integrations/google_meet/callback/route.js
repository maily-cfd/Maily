import { NextResponse } from 'next/server';
import { auth as getSession } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

const db = {
  async storeIntegrationCredentials(userEmail, provider, credentials) {
    const supabase = getSupabaseAdmin();
    await supabase.from('integration_credentials').upsert({
      user_email: userEmail,
      provider,
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
      expires_at: credentials.expiresAt,
      scopes: credentials.scopes,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_email,provider' });
  },

  async logIntegrationEvent(userEmail, provider, event, metadata = {}) {
    const supabase = getSupabaseAdmin();
    await supabase.from('integration_events').insert({
      user_email: userEmail,
      provider,
      event,
      metadata,
      created_at: new Date().toISOString()
    });
  }
};

const integrationManager = new BoultIntegrationManager(db);

export async function GET(request) {
  const baseUrl = new URL(request.url).origin;

  try {
    const session = await getSession();
    if (!session?.user?.email) return NextResponse.redirect(new URL('/dashboard/agent-talk?error=unauthorized', baseUrl));

    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const userEmail = session.user.email;
    const provider = 'google_meet';

    if (!code) return NextResponse.redirect(new URL('/dashboard/agent-talk?error=missing_code', baseUrl));

    const credentials = await integrationManager.exchangeCode(provider, code, baseUrl);
    await integrationManager.storeCredentials(userEmail, provider, credentials);
    await db.logIntegrationEvent(userEmail, provider, 'connected', { scopes: credentials.scopes });

    return NextResponse.redirect(new URL(`/dashboard/agent-talk?success=connected&provider=${provider}`, baseUrl));
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.redirect(new URL(`/dashboard/agent-talk?error=exchange_failed&message=${encodeURIComponent(err.message)}`, baseUrl));
  }
}
