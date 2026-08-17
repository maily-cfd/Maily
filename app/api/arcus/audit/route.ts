import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { auth as nextAuth } from '../../../../lib/auth.js';
const auth: any = nextAuth;
import { getSupabaseAdmin } from '../../../../lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export const maxDuration = 10;

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userEmail = session?.user?.email?.toLowerCase();
    if (!userEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100'), 200);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_audit_log')
      .select('*')
      .eq('user_id', userEmail)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ entries: data ?? [] });
  } catch (err: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
