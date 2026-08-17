import { NextResponse } from 'next/server';
import { auth as getSession } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { supabase } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

const db = {
  async storeIntegrationCredentials(userEmail, provider, credentials) {
    await supabase.from('integration_credentials').upsert({
      user_email: userEmail,
      provider,
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
      expires_at: credentials.expiresAt,
      scopes: credentials.scopes,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_email,provider' });
  }
};

const integrationManager = new BoultIntegrationManager(db);

export async function GET(request) {
  try {
    const session = await getSession();
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const state = Buffer.from(JSON.stringify({ 
      user: session.user.email,
      provider: 'notion'
    })).toString('base64');

    const { origin } = new URL(request.url);
    
    // Debug environment variables
    console.log('[Notion Auth Route] Checking environment:', {
      hasClientId: !!process.env.NOTION_CLIENT_ID,
      hasSecret: !!process.env.NOTION_CLIENT_SECRET,
      notionKeys: Object.keys(process.env).filter(k => k.includes('NOTION')),
      cwd: process.cwd()
    });

    const authUrl = integrationManager.getAuthUrl('notion', state, origin);
    console.log('[Notion Auth] Generated Auth URL:', authUrl);
    return NextResponse.json({ url: authUrl });
  } catch (err) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
