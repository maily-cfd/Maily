import { NextResponse } from 'next/server';
// @ts-ignore
import { auth as nextAuth } from '@/lib/auth.js';
import { Resend } from 'resend';
import { DatabaseService } from '@/lib/supabase.js';
import { logEvent } from "@/lib/logsso";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// @ts-ignore
const auth: any = nextAuth;

function getCompanyFromEmail(email: string): string {
    if (!email) return 'Personal';
    const parts = email.split('@');
    if (parts.length < 2) return 'Personal';
    const domain = parts[1].toLowerCase();
    const genericDomains = [
        'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 
        'icloud.com', 'mail.com', 'aol.com', 'zoho.com', 'protonmail.com', 
        'proton.me', 'gmx.com', 'yandex.com', 'maily.dev'
    ];
    if (genericDomains.includes(domain)) {
        return 'Personal';
    }
    const domainParts = domain.split('.');
    if (domainParts.length > 0) {
        const name = domainParts[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return 'Personal';
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { feedback, source, connectorId } = await req.json();

        if (!feedback) {
            return NextResponse.json({ error: 'Feedback is required' }, { status: 400 });
        }

        if (!resend) {
            console.error('RESEND_API_KEY is missing. Feedback received:', feedback);
            return NextResponse.json({ success: true, message: 'Feedback received (logged to console)' });
        }

        const userEmail = session.user.email;
        const userName = session.user.name || 'Anonymous';

        // 1. Fetch user's company information from DB
        let company = 'Personal';
        try {
            const db = new DatabaseService();
            const { data: profile } = await db.supabase
                .from('user_profiles')
                .select('work_status, preferences')
                .eq('user_id', userEmail.toLowerCase())
                .maybeSingle();

            if (profile?.work_status) {
                company = profile.work_status;
            } else if (profile?.preferences?.company) {
                company = profile.preferences.company;
            } else {
                company = getCompanyFromEmail(userEmail);
            }
        } catch (dbError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(dbError) });
            console.error('Error fetching user profile for feedback email:', dbError);
            company = getCompanyFromEmail(userEmail);
        }

        // 2. Format custom date: "Friday, May 29, 2026 at 05:30 AM"
        const dateObj = new Date();
        const dateStr = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        const timeStr = dateObj.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        const formattedDate = `${dateStr} at ${timeStr}`;

        // 3. Format category pill based on feedback source
        let category = 'General Feedback';
        if (source) {
            if (source.toLowerCase().startsWith('integration:')) {
                category = source.replace(/^[Ii]ntegration:?\s*/, '') + ' Integration';
            } else {
                category = source;
            }
        }

        const displaySource = source || 'General Intelligence';

        const emailContent = `
            <div style="background-color: #F8FAFC; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-height: 100vh;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);">
                    
                    <!-- Metadata Header Grid -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                        <tr>
                            <!-- User Column -->
                            <td style="padding: 8px 0; width: 50%; vertical-align: middle; font-size: 14px; color: #475569;">
                                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                    <tr>
                                        <td style="vertical-align: middle; padding-right: 8px;">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; vertical-align: middle;">
                                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                                <circle cx="12" cy="7" r="4"></circle>
                                            </svg>
                                        </td>
                                        <td style="vertical-align: middle; line-height: 1.2;">
                                            User: <strong style="color: #0F172A; font-weight: 600;">${userName}</strong>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                            <!-- Company Column -->
                            <td style="padding: 8px 0; width: 50%; vertical-align: middle; font-size: 14px; color: #475569;">
                                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                    <tr>
                                        <td style="vertical-align: middle; padding-right: 8px;">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; vertical-align: middle;">
                                                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                                                <line x1="9" y1="22" x2="9" y2="16"></line>
                                                <line x1="15" y1="22" x2="15" y2="16"></line>
                                                <line x1="9" y1="16" x2="15" y2="16"></line>
                                                <path d="M8 6h.01"></path>
                                                <path d="M16 6h.01"></path>
                                                <path d="M8 10h.01"></path>
                                                <path d="M16 10h.01"></path>
                                                <path d="M12 6h.01"></path>
                                                <path d="M12 10h.01"></path>
                                                <path d="M8 14h.01"></path>
                                                <path d="M16 14h.01"></path>
                                                <path d="M12 14h.01"></path>
                                            </svg>
                                        </td>
                                        <td style="vertical-align: middle; line-height: 1.2;">
                                            Company: <strong style="color: #0F172A; font-weight: 600;">${company}</strong>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <!-- Email Column -->
                            <td style="padding: 8px 0; vertical-align: middle; font-size: 14px; color: #475569;">
                                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                    <tr>
                                        <td style="vertical-align: middle; padding-right: 8px;">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; vertical-align: middle;">
                                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                                <polyline points="22,6 12,13 2,6"></polyline>
                                            </svg>
                                        </td>
                                        <td style="vertical-align: middle; line-height: 1.2;">
                                            Email: <a href="mailto:${userEmail}" style="color: #0F172A; text-decoration: none; font-weight: 600;">${userEmail}</a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                            <!-- Category Column -->
                            <td style="padding: 8px 0; vertical-align: middle; font-size: 14px; color: #475569;">
                                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                    <tr>
                                        <td style="vertical-align: middle; padding-right: 8px;">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; vertical-align: middle;">
                                                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                                                <line x1="7" y1="7" x2="7.01" y2="7"></line>
                                            </svg>
                                        </td>
                                        <td style="vertical-align: middle; line-height: 1.2;">
                                            Category: <span style="background-color: #F1F5F9; color: #334155; font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 9999px; display: inline-block; vertical-align: middle; margin-left: 2px;">${category}</span>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <!-- Date Column (Spans full width) -->
                            <td colspan="2" style="padding: 8px 0; vertical-align: middle; font-size: 14px; color: #475569;">
                                <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                    <tr>
                                        <td style="vertical-align: middle; padding-right: 8px;">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; vertical-align: middle;">
                                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                                <line x1="3" y1="10" x2="21" y2="10"></line>
                                            </svg>
                                        </td>
                                        <td style="vertical-align: middle; line-height: 1.2;">
                                            Date: <strong style="color: #0F172A; font-weight: 600;">${formattedDate}</strong>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>

                    <!-- Feedback Content Section -->
                    <p style="font-size: 15px; font-weight: 700; color: #0F172A; margin: 24px 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Feedback Content</p>
                    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 24px;">
                        <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #334155; white-space: pre-wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${feedback}</p>
                    </div>

                    <!-- Footer line -->
                    ${connectorId ? `
                    <div style="margin-top: 24px; font-size: 11px; color: #94A3B8; font-family: monospace; border-top: 1px dashed #E2E8F0; padding-top: 12px;">
                        Connector ID: ${connectorId}
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        const { data, error } = await resend.emails.send({
            from: 'Feedback <feedback@maily.dev>',
            to: ['support.maily@gmail.com'],
            subject: `Feedback: ${displaySource}`,
            html: emailContent,
        });

        if (error) {
            console.error('Resend error:', error);
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Feedback API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
