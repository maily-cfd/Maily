import { NextResponse } from 'next/server';
import { auth } from '../../../../lib/auth.js';
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { decrypt } from '../../../../lib/crypto.js';
import { logEvent } from "@/lib/logsso";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.email.toLowerCase();
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('boult_integrations')
      .select('access_token, expires_at')
      .eq('user_id', userId)
      .eq('provider', 'gmail')
      .maybeSingle();

    if (error || !data?.access_token) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 404 });
    }

    const accessToken = decrypt(data.access_token);
    if (!accessToken) {
      return NextResponse.json({ error: 'Token decryption failed' }, { status: 500 });
    }

    return NextResponse.json({
      accessToken,
      expiresAt: data.expires_at ?? null,
      source: 'boult_integrations',
    });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    console.error('[agent-talk/gmail-token]', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
