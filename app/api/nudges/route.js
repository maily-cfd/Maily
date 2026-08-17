import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth.js';
import { DatabaseService } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { GmailService } from '@/lib/gmail.ts';
import { BoultAIService } from '@/lib/boult-ai.js';
import { subscriptionService } from '@/lib/subscription-service.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request) {
  try {
    const session = await auth();
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = new DatabaseService();
    const userTokens = await db.getUserTokens(session.user.email);
    
    if (!userTokens || !userTokens.encrypted_access_token) {
      return NextResponse.json({ nudges: [], status: 'no_gmail_connected' });
    }

    const accessToken = decrypt(userTokens.encrypted_access_token);
    const refreshToken = userTokens.encrypted_refresh_token ? decrypt(userTokens.encrypted_refresh_token) : '';
    
    const gmailService = new GmailService(accessToken, refreshToken);
    const boultAI = new BoultAIService();

    // 1. Search for unreplied incoming emails older than 1 day but within 30 days
    // We search for emails in inbox that aren't from 'me' and haven't been replied to.
    let query = 'is:inbox -from:me -is:answered older_than:1d newer_than:30d';
    let emailList = await gmailService.getEmails(8, query);

    // Fail-safe: if no emails in that window, try a slightly broader one
    if (!emailList.messages || emailList.messages.length === 0) {
      console.log('🔄 [Nudges API] No results for 1-30d, trying a broader search...');
      query = 'is:inbox -from:me -is:answered newer_than:60d';
      emailList = await gmailService.getEmails(5, query);
    }

    console.log('🔍 [Nudges API] Found ' + (emailList.messages?.length || 0) + ' potential emails');

    if (!emailList.messages || emailList.messages.length === 0) {
      console.log('✅ [Nudges API] No unreplied emails found.');
      return NextResponse.json({ nudges: [] });
    }

    // 2. Fetch details for these emails (using lightweight metadata format)
    console.log('📡 [Nudges API] Fetching metadata for ' + emailList.messages.length + ' emails...');
    const emailDetails = await Promise.all(
      emailList.messages.map(msg => gmailService.getEmailDetails(msg.id, 'metadata'))
    );

    const parsedEmails = emailDetails.map(details => gmailService.parseEmailData(details));
    
    // 3. AI Usage Check (Boult Engine)
    // Smart Nudges consume "boult_ai" credits
    const canUse = await subscriptionService.canUseFeature(session.user.email, 'boult_ai');
    
    if (!canUse) {
      console.log('⚠️ [Nudges API] User has exhausted Boult AI credits');
      return NextResponse.json({ 
        nudges: [], 
        status: 'limit_reached',
        error: 'AI usage limit reached. Upgrade to Pro for unlimited nudges.' 
      }, { status: 403 });
    }

    console.log('🤖 [Nudges API] Analyzing emails with Boult AI...');

    // 4. Use AI to detect which ones actually need a nudge
    const nudges = await boultAI.analyzeNeedsNudge(parsedEmails);
    console.log('✅ [Nudges API] AI returned ' + (nudges?.length || 0) + ' nudges');

    // 5. Track successful usage
    if (nudges && nudges.length > 0) {
      await subscriptionService.incrementFeatureUsage(session.user.email, 'boult_ai');
    }

    // 6. Return nudges with some metadata
    return NextResponse.json({ 
      nudges: (nudges || []).map(n => ({
        ...n,
        fullEmail: parsedEmails.find(e => e.id === n.id)
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('💥 [Nudges API] Error:', error);
    return NextResponse.json({ 
      nudges: [], 
      error: error.message,
      status: 'error'
    }, { status: 500 });
  }
}
