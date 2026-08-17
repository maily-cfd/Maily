import { NextResponse } from 'next/server';
import { auth as getSession } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { getSupabaseAdmin } from '@/lib/supabase';
import { encrypt } from '@/lib/crypto';
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
    // notion_calendar auth also lands here — decode state to determine the UI provider
    const rawState = searchParams.get('state') || '';
    const userEmail = session.user.email;

    if (!code) return NextResponse.redirect(new URL('/dashboard/agent-talk?error=missing_code', baseUrl));

    let uiProvider = 'notion';
    try {
      const decoded = JSON.parse(Buffer.from(rawState, 'base64').toString('utf8'));
      if (decoded.provider === 'notion_calendar') uiProvider = 'notion_calendar';
    } catch (_) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(_) }); /* state not JSON — default to notion */ }

    // Exchange code using the notion adapter regardless of which UI provider triggered it
    const credentials = await integrationManager.exchangeCode('notion', code, baseUrl);
    await integrationManager.storeCredentials(userEmail, 'notion', credentials);
    if (uiProvider === 'notion_calendar') {
      await integrationManager.storeCredentials(userEmail, 'notion_calendar', credentials);
    }
    await db.logIntegrationEvent(userEmail, uiProvider, 'connected', { scopes: credentials.scopes });

    // Write encrypted token to boult_integrations so the v3 agent can use it
    const supabase = getSupabaseAdmin();
    await supabase.from('boult_integrations').upsert({
      user_id: userEmail.toLowerCase(),
      provider: 'notion',
      access_token: encrypt(credentials.accessToken),
      refresh_token: null,
      scopes: credentials.scopes || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    return NextResponse.redirect(new URL(`/dashboard/agent-talk?success=connected&provider=${uiProvider}`, baseUrl));
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.redirect(new URL(`/dashboard/agent-talk?error=exchange_failed&message=${encodeURIComponent(err.message)}`, baseUrl));
  }
}
