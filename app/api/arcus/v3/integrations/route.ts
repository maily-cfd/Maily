/**
 * Boult V3 — Integrations API
 * GET    /api/boult/v3/integrations              — List connected
 * POST   /api/boult/v3/integrations              — Connect
 * DELETE /api/boult/v3/integrations?provider=xxx  — Disconnect
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../../lib/supabase.js';
import { encrypt } from '../../../../../lib/crypto.js';
import { auditLogger } from '../../../../../lib/audit-logger.js';
import { logEvent } from "@/lib/logsso";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();
    const supabase = getSupabaseAdmin();

    const { data } = await supabase
      .from('boult_integrations')
      .select('id, provider, scopes, created_at, channel_expiry, workspace_info')
      .eq('user_id', userId);

    // Never return tokens in the response
    return NextResponse.json({ integrations: data || [] });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();
    const body = await request.json();
    const { provider, accessToken, refreshToken, scopes, workspaceInfo } = body;

    if (!provider || !accessToken) {
      return NextResponse.json({ error: 'provider and accessToken required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('boult_integrations')
      .upsert({
        user_id: userId,
        provider,
        access_token: encrypt(accessToken),
        refresh_token: refreshToken ? encrypt(refreshToken) : null,
        scopes: scopes || [],
        workspace_info: workspaceInfo || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await auditLogger.log(userId, 'boult.integration_connected', { provider });
    return NextResponse.json({ status: 'connected', provider });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.email.toLowerCase();
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');

    if (!provider) {
      return NextResponse.json({ error: 'provider required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    await supabase
      .from('boult_integrations')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    await auditLogger.log(userId, 'boult.integration_disconnected', { provider });
    return NextResponse.json({ status: 'disconnected', provider });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
