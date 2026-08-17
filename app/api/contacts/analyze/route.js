import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth.js';
import { GmailService } from '@/lib/gmail';
import { DatabaseService } from '@/lib/supabase.js';
import { decrypt } from '@/lib/crypto.js';
import { getModelChain } from '@/lib/ai-constants.js';
import { logEvent } from "@/lib/logsso";

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function POST(request) {
    try {
        const session = await auth();

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { email } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email address required' }, { status: 400 });
        }

        const userEmail = session.user.email;

        // Get tokens from database
        const db = new DatabaseService();
        const tokens = await db.getUserTokens(userEmail);

        if (!tokens?.access_token) {
            return NextResponse.json({ error: 'No access token' }, { status: 401 });
        }

        const accessToken = decrypt(tokens.access_token);
        const gmailService = new GmailService(accessToken);

        // Fetch last 100 emails with this contact
        const query = `from:${email} OR to:${email}`;
        const emailsResponse = await gmailService.getEmails(100, query);
        const messages = emailsResponse?.messages || [];

        if (!messages || messages.length === 0) {
            return NextResponse.json({
                analysis: {
                    relationshipScore: 50,
                    trend: 'stable',
                    sentimentHistory: Array(12).fill(50),
                    aiSuggestion: 'No recent email history with this contact.',
                    socialLinks: [],
                    recentTopics: []
                }
            });
        }

        const emailContents = [];
        const socialLinks = [];

        // Process messages to build context
        for (const msg of messages.slice(0, 30)) {
            try {
                const details = await gmailService.getEmailDetails(msg.id);
                const parsed = gmailService.parseEmailData(details);
                const isFromContact = parsed.from?.toLowerCase().includes(email.toLowerCase());

                emailContents.push({
                    subject: parsed.subject || '',
                    snippet: parsed.snippet || '',
                    date: parsed.date || (parsed.internalDate ? new Date(parseInt(parsed.internalDate)).toISOString() : new Date().toISOString()),
                    direction: isFromContact ? 'received' : 'sent',
                    body: parsed.body || ''
                });

                if (parsed.body) {
                    const linkedinMatch = parsed.body.match(/linkedin\.com\/in\/[\w-]+/gi);
                    const twitterMatch = parsed.body.match(/twitter\.com\/[\w]+/gi) || parsed.body.match(/x\.com\/[\w]+/gi);
                    if (linkedinMatch && !socialLinks.some(l => l.type === 'linkedin')) socialLinks.push({ type: 'linkedin', url: `https://${linkedinMatch[0]}` });
                    if (twitterMatch && !socialLinks.some(l => l.type === 'twitter')) socialLinks.push({ type: 'twitter', url: `https://${twitterMatch[0]}` });
                }
            } catch (e) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
                console.error('Email detail error:', e);
            }
        }

        // CHRONOLOGICAL SORTING IS KEY FOR GRAPH
        emailContents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let relationshipScore = 65;
        let trend = 'stable';
        let sentimentHistory = [];
        let aiSuggestion = '';
        let recentTopics = [];

        // Was OPENROUTERAPI_KEY2 (missing underscore) — a var that is never
        // set, so this analysis silently no-op'd. Use the canonical keys.
        const openRouterKey = process.env.OPENROUTER_API_KEY2 || process.env.OPENROUTER_API_KEY;

        if (openRouterKey && emailContents.length > 0) {
            try {
                const prompt = `Perform a chronological relationship analysis.
Output JSON:
1. "relationshipScore": (0-100)
2. "trend": "up", "down", or "stable"
3. "sentimentHistory": Array of 12 numbers (30-100) representing sentiment from OLDEST (index 0) to MOST RECENT (index 11).
4. "aiSuggestion": Normal text, no bold/italic.
5. "recentTopics": 3 themes.

Interactions (OLD TO NEW):
${emailContents.map(e => `[${e.direction.toUpperCase()}] Date: ${e.date}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`).join('\n\n')}

JSON ONLY.`;

                // Use centralized model chain
                const models = getModelChain();

                let finalAnalysis = null;

                for (const model of models) {
                    try {
                        console.log(`🚀 Attempting contact analysis via ${model}`);
                        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${openRouterKey}`,
                                'Content-Type': 'application/json',
                                'HTTP-Referer': 'https://maily.cfd',
                                'X-Title': 'Maily'
                            },
                            body: JSON.stringify({
                                model,
                                messages: [
                                    { role: 'system', content: 'You are a Relationship Intelligence AI. Build a 12-point chronological sentiment graph based on tone and frequency. Higher index = more recent. Higher values = warmer tone.' },
                                    { role: 'user', content: prompt }
                                ],
                                temperature: 0.1
                            })
                        });

                        if (response.ok) {
                            const data = await response.json();
                            const jsonMatch = (data.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                finalAnalysis = JSON.parse(jsonMatch[0]);
                                console.log(`✅ Contact analysis success with ${model}`);
                                break;
                            }
                        } else {
                            console.warn(`⚠️ Contact analysis failed for ${model}:`, response.status);
                        }
                    } catch (err) {
                    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
                        console.error(`❌ Contact analysis error with ${model}:`, err.message);
                    }
                }

                if (finalAnalysis) {
                    relationshipScore = finalAnalysis.relationshipScore || 65;
                    trend = finalAnalysis.trend || 'stable';
                    sentimentHistory = finalAnalysis.sentimentHistory || [];
                    aiSuggestion = finalAnalysis.aiSuggestion || '';
                    recentTopics = finalAnalysis.recentTopics || [];
                }
            } catch (aiError) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(aiError) });
                console.error('AI analysis error:', aiError);
            }
        }

        if (sentimentHistory.length === 0) {
            sentimentHistory = Array.from({ length: 12 }, (_, i) => 60 + (trend === 'up' ? i * 2 : trend === 'down' ? -i * 2 : 0) + (Math.random() * 15));
        }

        return NextResponse.json({
            analysis: {
                relationshipScore,
                trend,
                sentimentHistory,
                aiSuggestion,
                socialLinks: socialLinks.slice(0, 3),
                recentTopics
            }
        });

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Analyze route error:', error);
        return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
    }
}

