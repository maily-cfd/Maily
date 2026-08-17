import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
import { DatabaseService } from '@/lib/supabase.js';
import { logEvent } from "@/lib/logsso";

export async function GET() {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = new DatabaseService();
    const { data, error } = await db.supabase
      .from('boult_recurring_agents')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error && error.code === '42P01') return NextResponse.json({ agents: [] });
    if (error) throw error;

    return NextResponse.json({ agents: data || [] });
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = new DatabaseService();
    const body = await request.json();
    const { name, description, schedule, agent_type, prompt, skip_confirmations, schedule_freq, schedule_time, expiration_date } = body;

    // Build a cron expression from schedule_freq + schedule_time
    let cronSchedule = schedule || '';
    if (schedule_freq && schedule_time) {
      const [hour, minute] = schedule_time.split(':');
      switch (schedule_freq) {
        case 'Daily':
          cronSchedule = `${minute} ${hour} * * *`;
          break;
        case 'Weekly':
          cronSchedule = `${minute} ${hour} * * 1`; // Monday
          break;
        case 'Monthly':
          cronSchedule = `${minute} ${hour} 1 * *`; // 1st of month
          break;
        case 'No Repeat':
          cronSchedule = 'manual';
          break;
        default:
          cronSchedule = `${minute} ${hour} * * *`;
      }
    }

    // Build the human-readable schedule string for display
    const timeStr = schedule_time || '08:00';
    const freqStr = schedule_freq || 'Daily';
    const readableSchedule = `${freqStr} at ${timeStr} UTC${expiration_date ? ` (Expires ${expiration_date})` : ''}`;

    const { data, error } = await db.supabase
      .from('boult_recurring_agents')
      .insert({
        user_id: session.user.id,
        name: name || 'Scheduled Agent',
        description: description || prompt || '',
        cron_schedule: cronSchedule,
        agent_type: agent_type || 'custom',
        is_active: true,
        prompt: prompt || description || '',
        skip_confirmations: skip_confirmations || false,
        schedule_freq: freqStr,
        schedule_time: timeStr,
        expiration_date: expiration_date || null,
        readable_schedule: readableSchedule,
      })
      .select()
      .single();

    if (error) {
      // Table might not have the new columns yet — fallback to basic insert
      if (error.code === '42703' || error.message?.includes('column')) {
        const { data: fallbackData, error: fallbackError } = await db.supabase
          .from('boult_recurring_agents')
          .insert({
            user_id: session.user.id,
            name: name || 'Scheduled Agent',
            description: prompt || description || '',
            cron_schedule: cronSchedule,
            agent_type: agent_type || 'custom',
            is_active: true,
          })
          .select()
          .single();

        if (fallbackError && fallbackError.code === '42P01') {
          return NextResponse.json({
            id: `local_${Date.now()}`,
            name: name || 'Scheduled Agent',
            description: prompt || description || '',
            cron_schedule: cronSchedule,
            agent_type: agent_type || 'custom',
            is_active: true,
            prompt: prompt || '',
            skip_confirmations: skip_confirmations || false,
            schedule_freq: freqStr,
            schedule_time: timeStr,
            expiration_date: expiration_date || null,
            readable_schedule: readableSchedule,
          });
        }
        if (fallbackError) throw fallbackError;
        return NextResponse.json({ ...fallbackData, prompt, skip_confirmations, schedule_freq: freqStr, schedule_time: timeStr, readable_schedule: readableSchedule });
      }
      if (error.code === '42P01') {
        return NextResponse.json({
          id: `local_${Date.now()}`,
          name: name || 'Scheduled Agent',
          description: prompt || description || '',
          cron_schedule: cronSchedule,
          agent_type: agent_type || 'custom',
          is_active: true,
          prompt: prompt || '',
          skip_confirmations: skip_confirmations || false,
          schedule_freq: freqStr,
          schedule_time: timeStr,
          readable_schedule: readableSchedule,
        });
      }
      throw error;
    }

    return NextResponse.json(data);
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Create Agent Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = new DatabaseService();
    const body = await request.json();
    const { id, is_active } = body;

    const { data, error } = await db.supabase
      .from('boult_recurring_agents')
      .update({ is_active })
      .eq('id', id)
      .eq('user_id', session.user.id)
      .select()
      .single();

    if (error && error.code === '42P01') return NextResponse.json({ id, is_active });
    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    // @ts-ignore
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const db = new DatabaseService();
    const { error } = await db.supabase
      .from('boult_recurring_agents')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id);

    if (error && error.code !== '42P01') throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
