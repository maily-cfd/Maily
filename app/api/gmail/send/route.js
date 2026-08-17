import { GmailService } from '@/lib/gmail';
import { auth } from '@/lib/auth.js';
import { DatabaseService, getSupabaseAdmin } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { logEvent } from "@/lib/logsso";

export const maxDuration = 60; // Increase to 60s for large attachments

export async function POST(request) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return Response.json({ error: 'No valid session found' }, { status: 401 });
    }

    const userEmail = session.user.email;
    let accessToken = session.accessToken;
    let refreshToken = session.refreshToken;

    // Fallback: fetch tokens from DB (handles One Tap logins and expired JWTs)
    if (!accessToken || !refreshToken) {
      try {
        const db = new DatabaseService();
        const userTokens = await db.getUserTokens(userEmail);
        if (userTokens) {
          if (userTokens.encrypted_access_token) {
            accessToken = decrypt(userTokens.encrypted_access_token);
          }
          if (userTokens.encrypted_refresh_token) {
            refreshToken = decrypt(userTokens.encrypted_refresh_token);
          }
        }
      } catch (dbError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(dbError) });
        console.error('[send] DB token fallback error:', dbError);
      }
    }

    if (!accessToken) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        accessToken = authHeader.replace('Bearer ', '');
      }
    }

    // Final fallback: check boult_integrations (Gmail connected via integrations page)
    if (!accessToken) {
      try {
        const supabase = getSupabaseAdmin();
        const { data: integData } = await supabase
          .from('boult_integrations')
          .select('access_token')
          .eq('user_id', userEmail.toLowerCase())
          .eq('provider', 'gmail')
          .maybeSingle();
        if (integData?.access_token) {
          accessToken = decrypt(integData.access_token);
        }
      } catch (integError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(integError) });
        console.error('[send] boult_integrations fallback error:', integError);
      }
    }

    if (!accessToken) {
      return Response.json({ error: 'No valid session found' }, { status: 401 });
    }

    const emailData = await request.json();
    const { to, subject, body, isHtml = false, threadId = null, attachments = [] } = emailData;

    if (!to || !subject || !body) {
      return Response.json({ error: 'Missing required fields: to, subject, body' }, { status: 400 });
    }

    const gmailService = new GmailService(accessToken, refreshToken);
    gmailService.setUserEmail(userEmail);
    const result = await gmailService.sendEmail({ to, subject, body, isHtml, threadId, attachments });

    // INCREMENTAL VOICE PROFILING: Learn from this new sent email
    if (result && !result.error) {
      try {
        const { voiceProfileService } = await import('@/lib/voice-profile-service');
        const cleanBody = isHtml ? body.replace(/<[^>]*>?/gm, '').trim() : body;
        voiceProfileService.addToProfile(userEmail, cleanBody);
      } catch (profileError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(profileError) });
        console.warn('⚠️ Failed to incrementally update voice profile:', profileError.message);
      }
    }

    return Response.json(result);
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('Error sending email:', error);
    return Response.json(
      { error: 'Failed to send email', details: error.message },
      { status: 500 }
    );
  }
}


