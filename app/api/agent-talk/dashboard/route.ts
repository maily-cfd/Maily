import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
import { DatabaseService } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request: Request) {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = new DatabaseService();
    const userEmail = session.user.email;
    const tokens = await db.getUserTokens(userEmail);
    const hasGmail = !!tokens?.encrypted_access_token;

    // 1. Fetch Email Stats (mocked or from Sift results)
    let emailStats = { total: 0, drafted: 0, archived: 0, flagged: 0 };
    if (hasGmail) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: siftData } = await db.supabase
        .from('sift_results')
        .select('*')
        .eq('user_email', userEmail)
        .gte('created_at', today.toISOString());
      
      if (siftData && siftData.length > 0) {
        emailStats.total = siftData.length;
        emailStats.drafted = siftData.filter(d => d.action === 'reply').length;
        emailStats.archived = siftData.filter(d => d.action === 'archive' || d.category === 'Newsletter').length;
        emailStats.flagged = siftData.filter(d => d.urgency === 'high' || d.action === 'review').length;
      }
    }

    // 2. Fetch Meetings (Google Calendar via CalendarService or mock fallback)
    let meetings = [];
    if (hasGmail) {
       try {
         const { CalendarService } = await import('@/lib/calendar.js');
         const cal = new CalendarService(decrypt(tokens.encrypted_access_token));
         const now = new Date();
         const eod = new Date(); eod.setHours(23, 59, 59, 999);
         const events = await (cal as any).listEvents({ timeMin: now.toISOString(), timeMax: eod.toISOString(), maxResults: 5 });
         meetings = (events || []).map((e: any) => ({
           id: e.id,
           title: e.summary,
           time: new Date(e.start.dateTime || e.start.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
           attendees: (e.attendees || []).map((a: any) => a.displayName || a.email?.split('@')[0] || 'Guest'),
           type: e.summary?.toLowerCase().includes('sync') ? 'internal' : 'discovery'
         }));
       } catch (err) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
         console.error('Calendar fetch error', err);
       }
    }

    // 3. Fetch Action Items
    const actionItems: any[] = [];

    let agents: any[] = [];
    try {
      const { data: dbAgents, error: agentsError } = await db.supabase
        .from('boult_recurring_agents')
        .select('*')
        .eq('user_id', session.user.id);
        
      if (!agentsError && dbAgents) {
        agents = dbAgents.map(a => ({
          id: a.id,
          name: a.name,
          description: a.prompt || a.description,
          schedule: a.readable_schedule || a.cron_schedule,
          type: a.agent_type,
          status: a.is_active ? 'active' : 'paused',
          createdAt: a.created_at,
          prompt: a.prompt || a.description,
          skipConfirmations: a.skip_confirmations || false,
          scheduleFreq: a.schedule_freq || 'Daily',
          scheduleTime: a.schedule_time || '08:00',
          expirationDate: a.expiration_date || null,
        }));
      }
    } catch (e) {
      logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
      console.error('Failed to fetch agents:', e);
    }

    return NextResponse.json({
      userName: session.user.name || session.user.email.split('@')[0],
      emailStats,
      meetings,
      actionItems,
      agents
    });
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Dashboard Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
