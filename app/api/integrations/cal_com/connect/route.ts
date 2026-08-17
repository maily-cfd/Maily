import { NextResponse } from 'next/server';
// @ts-ignore - JS module
import { auth as getSession } from '@/lib/auth';
// @ts-ignore - JS module
import { getSupabaseAdmin } from '@/lib/supabase';
// @ts-ignore - JS module
import { CalComService } from '@/lib/calcom';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/cal_com/connect
 *
 * Cal.com cloud authenticates with an API key, not OAuth — so the user pastes
 * their own key (cal.com → Settings → Developer → API keys). We validate it,
 * then store it as their cal_com credential. Boult's Cal.com tools then book on
 * the user's own account (falling back to the app's shared CAL_API_KEY only if a
 * user hasn't connected one).
 */
export async function POST(request: Request) {
  // @ts-ignore
  const session = await getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userEmail = session.user.email.toLowerCase();

  let apiKey = '';
  try {
    const body = await request.json();
    apiKey = (body?.apiKey || '').trim();
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'Paste your Cal.com API key to connect.' }, { status: 400 });
  }

  // Validate the key against the real API before storing it.
  try {
    const cal = new CalComService(apiKey);
    await cal.getEventTypes();
  } catch {
    logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
    return NextResponse.json(
      { error: 'That key didn’t work. Get one from cal.com → Settings → Developer → API keys, then paste it here.' },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('integration_credentials').upsert(
      {
        user_email: userEmail,
        provider: 'cal_com',
        access_token: apiKey,
        refresh_token: null,
        scopes: [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email,provider' },
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err?.message || 'Could not save the key.' }, { status: 500 });
  }
}
