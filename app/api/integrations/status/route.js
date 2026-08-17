import { DatabaseService } from '@/lib/supabase.js';
import { auth } from '@/lib/auth.js';
import { logEvent } from "@/lib/logsso";

export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: 'No session' }, { status: 401 });
    }

    const { integrationId, enabled } = await request.json();

    if (!integrationId) {
      return Response.json({ error: 'Missing integrationId' }, { status: 400 });
    }

    const db = new DatabaseService();
    await db.updateIntegrationStatus(session.user.email, integrationId, enabled);

    return Response.json({ success: true });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Error updating integration status:', error);
    return Response.json({ error: 'Failed to update status' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return Response.json({ error: 'No session' }, { status: 401 });
    }
    const userEmail = session.user.email.toLowerCase();

    const db = new DatabaseService();
    // Check both tables: legacy integration_credentials and V3 boult_integrations
    const [{ data: legacyRows }, { data: v3Rows }] = await Promise.all([
      db.supabase.from('integration_credentials').select('provider').eq('user_email', userEmail),
      db.supabase.from('boult_integrations').select('provider').eq('user_id', userEmail),
    ]);

    const connected = new Set([
      ...(legacyRows || []).map(r => r.provider),
      // Map V3 provider names to UI names
      ...(v3Rows || []).map(r =>
        r.provider === 'gcal' ? 'google_calendar'
        : r.provider === 'gmeet' ? 'google_meet'
        : r.provider),
    ]);

    // Gmail (and Calendar) are connected via the primary Google sign-in, whose
    // tokens live in `user_tokens` — NOT integration_credentials. So derive their
    // connected state from the granted Google scopes: if the user has a token row
    // whose scopes include gmail/calendar, that integration was actually granted.
    // This is why "I reconnected Gmail but it still shows disconnected" happened.
    try {
      const tokens = await db.getUserTokens(userEmail);
      const scopes = String(tokens?.scopes || tokens?.scope || '');
      const hasToken = !!(tokens?.access_token || tokens?.encrypted_access_token);
      if (hasToken && /gmail/i.test(scopes)) connected.add('gmail');
      if (hasToken && /calendar/i.test(scopes)) connected.add('google_calendar');
    } catch {
      logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" }); /* token table optional — fall back to the integration rows */ }

    // Derived connections
    if (connected.has('notion')) connected.add('notion_calendar');
    // Google Meet is NO LONGER derived from Calendar. It used to be, because the
    // only "Meet" feature was a link on a calendar event (Calendar's own
    // conferenceData — still true, still works via schedule_meeting). Meet now
    // has its OWN connection for the Meet API v2 (transcripts, recordings,
    // attendance), so deriving it here would show a green badge while every
    // meet_* tool returns gmeet_not_connected — the exact connected-but-broken
    // state we hit before with Gmail.

    const PROVIDERS = ['gmail', 'google_calendar', 'google_meet', 'notion', 'notion_calendar', 'slack', 'cal_com'];
    const integrations = PROVIDERS.map(provider => ({
      provider,
      connected: connected.has(provider),
    }));

    return Response.json({ integrations });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Error getting integration status:', error);
    return Response.json({ error: 'Failed to get status' }, { status: 500 });
  }
}
