import { NextResponse } from 'next/server';
// @ts-ignore
import { auth } from '@/lib/auth.js';
// @ts-ignore
import { GmailService } from '@/lib/gmail';
// @ts-ignore
import { DatabaseService } from '@/lib/supabase.js';
// @ts-ignore
import { decrypt } from '@/lib/crypto.js';
// @ts-ignore
import { subscriptionService } from '@/lib/subscription-service.js';
// @ts-ignore
import { getModelChain } from '@/lib/ai-constants.js';
import { logEvent } from "@/lib/logsso";

// Force dynamic rendering
export const dynamic = 'force-dynamic';

interface ContactDetail {
    email: string;
    name: string;
    phone?: string;
    company?: string;
    position?: string;
    address?: string;
    firstContact: string;
    lastContact: string;
    totalEmails: number;
    sentEmails: number;
    receivedEmails: number;
    frequency: 'daily' | 'weekly' | 'monthly' | 'rare';
    relationshipScore: number;
    sentimentHistory: {
        date: string;
        score: number;
    }[];
    aiSuggestion?: string;
    recentSubjects: string[];
}

/**
 * Individual Contact Profile API
 * GET: Fetch detailed profile for a specific contact
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ email: string }> }
) {
    try {
        // @ts-ignore
        const session = await auth();

        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userEmail = session.user.email.toLowerCase();

        // 🔒 SECURITY: Check access before allowing contact access
        const hasAccess = await subscriptionService.checkAccess(userEmail);
        if (!hasAccess) {
            return NextResponse.json({
                error: 'subscription_required',
                message: 'Access required.',
                upgradeUrl: '/pricing'
            }, { status: 403 });
        }

        // Get tokens
        let accessToken = session.accessToken;
        let refreshToken = session.refreshToken;

        const db = new DatabaseService();
        if (!accessToken || !refreshToken) {
            try {
                const userTokens = await db.getUserTokens(userEmail);
                if (userTokens) {
                    if (userTokens.encrypted_access_token) accessToken = decrypt(userTokens.encrypted_access_token);
                    if (userTokens.encrypted_refresh_token) refreshToken = decrypt(userTokens.encrypted_refresh_token);
                }
            } catch (dbError) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(dbError) });
                console.error('Database error getting tokens:', dbError);
            }
        }

        if (!accessToken) {
            return NextResponse.json({ error: 'Gmail not connected' }, { status: 401 });
        }

        const resolvedParams = await params;
        const contactEmail = decodeURIComponent(resolvedParams.email).toLowerCase();

        // Initialize Gmail service
        const gmailService = new GmailService(accessToken, refreshToken || '');
        gmailService.setUserEmail(userEmail);

        // Fetch emails with this contact
        const response = await gmailService.getEmails(100, `from:${contactEmail} OR to:${contactEmail}`);
        const messages = response.messages || [];

        let contactDetail: ContactDetail = {
            email: contactEmail,
            name: '',
            firstContact: new Date().toISOString(),
            lastContact: new Date().toISOString(),
            totalEmails: messages.length,
            sentEmails: 0,
            receivedEmails: 0,
            frequency: 'rare',
            relationshipScore: 50,
            sentimentHistory: [],
            recentSubjects: []
        };

        const sentimentScores: { date: string; score: number }[] = [];

        // Process messages
        const messagesToProcess = messages.slice(0, 20); // Limit to 20 for speed

        for (const message of messagesToProcess) {
            try {
                const msgDetails = await gmailService.getEmailDetails(message.id);
                const parsed = gmailService.parseEmailData(msgDetails);

                const fromHeader = parsed.from;
                const toHeader = parsed.to;
                const dateHeader = parsed.date;
                const subject = parsed.subject;

                const emailDate = new Date(dateHeader);
                if (isNaN(emailDate.getTime())) continue;

                // Update contact name if not set
                if (!contactDetail.name && fromHeader.toLowerCase().includes(contactEmail)) {
                    const match = fromHeader.match(/(?:"?([^"]*)"?\s)?<?([^<>\s]+@[^<>\s]+)>?/);
                    if (match && match[1]) contactDetail.name = match[1].trim();
                }

                // Track sent/received
                if (fromHeader.toLowerCase().includes(contactEmail)) {
                    contactDetail.receivedEmails++;
                } else if (toHeader.toLowerCase().includes(contactEmail)) {
                    contactDetail.sentEmails++;
                }

                // Update dates
                if (emailDate < new Date(contactDetail.firstContact)) contactDetail.firstContact = emailDate.toISOString();
                if (emailDate > new Date(contactDetail.lastContact)) contactDetail.lastContact = emailDate.toISOString();

                // Store recent subjects
                if (subject && !contactDetail.recentSubjects.includes(subject)) {
                    contactDetail.recentSubjects.push(subject);
                }

                // Sentiment simulation/calculation
                let score = 50;
                const text = (parsed.subject + ' ' + parsed.snippet).toLowerCase();
                if (text.match(/thanks?|great|good|awesome|perfect|appreciate/)) score += 10;
                if (text.match(/urgent|asap|important|prio/)) score += 5;
                if (text.match(/sorry|apologize|delay|issue|problem/)) score -= 5;

                sentimentScores.push({ date: emailDate.toISOString(), score: Math.min(100, Math.max(0, score)) });
            } catch (err) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
                console.error('Error processing contact message:', err);
            }
        }

        // Limit recent subjects
        contactDetail.recentSubjects = contactDetail.recentSubjects.slice(0, 5);

        // Calculate metrics
        const daysSinceFirst = Math.ceil(
            (new Date().getTime() - new Date(contactDetail.firstContact).getTime()) / (1000 * 60 * 60 * 24)
        ) || 1;
        const emailsPerDay = contactDetail.totalEmails / daysSinceFirst;
        if (emailsPerDay >= 0.5) contactDetail.frequency = 'daily';
        else if (emailsPerDay >= 0.1) contactDetail.frequency = 'weekly';
        else if (emailsPerDay >= 0.03) contactDetail.frequency = 'monthly';
        else contactDetail.frequency = 'rare';

        // Relationship Score Calculation
        const sentBalance = contactDetail.sentEmails / (contactDetail.totalEmails || 1);
        const balancedEmails = sentBalance > 0.3 && sentBalance < 0.7 ? 20 : 10;
        const frequencyScore = contactDetail.frequency === 'daily' ? 40 : contactDetail.frequency === 'weekly' ? 30 : 15;
        const recencyValue = (new Date().getTime() - new Date(contactDetail.lastContact).getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = recencyValue < 7 ? 40 : recencyValue < 30 ? 20 : 5;
        contactDetail.relationshipScore = Math.min(100, balancedEmails + frequencyScore + recencyScore);

        // Prep sentiment history
        contactDetail.sentimentHistory = sentimentScores
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(-10);

        // Generate AI suggestion using OpenRouter API
        try {
            const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY2 || '';

            if (apiKey) {
                const relationshipContext = `
                    Contact: ${contactDetail.name || contactEmail}
                    Total Emails: ${contactDetail.totalEmails}
                    Sent: ${contactDetail.sentEmails}, Received: ${contactDetail.receivedEmails}
                    Frequency: ${contactDetail.frequency}
                    Relationship Score: ${contactDetail.relationshipScore}/100
                    Recent Subjects: ${contactDetail.recentSubjects.join(', ')}
                    Days since first contact: ${daysSinceFirst}
                `;

                const models = getModelChain();

                for (const model of models) {
                    try {
                        console.log(`🚀 Attempting profile suggestion via ${model}`);
                        const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`,
                                'HTTP-Referer': process.env.HOST || 'https://maily.cfd',
                                'X-Title': 'Maily'
                            },
                            body: JSON.stringify({
                                model,
                                messages: [
                                    { role: 'system', content: 'You are an AI that provides one-line suggestions for email relationships. Under 15 words, professional.' },
                                    { role: 'user', content: `One-liner suggestion for this relationship:\n${relationshipContext}` }
                                ],
                                max_tokens: 50,
                                temperature: 0.3
                            })
                        });

                        if (aiResp.ok) {
                            const data = await aiResp.json();
                            contactDetail.aiSuggestion = data.choices?.[0]?.message?.content?.trim();
                            if (contactDetail.aiSuggestion) {
                                console.log(`✅ Profile suggestion success with ${model}`);
                                break;
                            }
                        }
                    } catch (err) {
                    logEvent({ channel: "failures", event: "❌ API Error", description: String(err) });
                        console.error(`❌ Profile suggestion error with ${model}:`, err);
                    }
                }
                
                if (!contactDetail.aiSuggestion) {
                    contactDetail.aiSuggestion = 'Maintain consistency in communication.';
                }
            }
        } catch (aiErr) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(aiErr) });
            console.error('AI error:', aiErr);
        }

        return NextResponse.json({ success: true, contact: contactDetail, timestamp: new Date().toISOString() });

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Contact Profile API error:', error);
        return NextResponse.json({ error: 'Failed to fetch contact details' }, { status: 500 });
    }
}
