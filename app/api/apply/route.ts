import { Mail } from "lucide-react";
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { logEvent } from "@/lib/logsso";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(req: Request) {
    try {
        const { email, type } = await req.json();

        if (!email || !type) {
            return NextResponse.json({ error: 'Email and application type are required' }, { status: 400 });
        }

        if (type !== 'creator' && type !== 'affiliate') {
            return NextResponse.json({ error: 'Invalid application type' }, { status: 400 });
        }

        const typeLabel = type === 'creator' ? 'Apply for Creator' : 'Apply for Affiliate';
        const description = type === 'creator'
            ? 'Design and publish autonomous email workflow agents to Boult Marketplace for a 70% revenue share.'
            : 'Promote Maily and earn a massive 30% recurring lifetime commission on referrals.';

        console.log(`[Partner Application] New ${type} application:`, { email, type, date: new Date().toISOString() });

        // If Resend is not configured, we log and return success
        if (!resend) {
            console.warn('RESEND_API_KEY is missing. Partner application logged to console.');
            return NextResponse.json({ 
                success: true, 
                message: 'Application received and logged. (Resend configuration is missing in environment)' 
            });
        }

        // Send notification email to the admin
        const trackingId = Math.random().toString(36).substring(7).toUpperCase();
        const emailContent = `
            <div style="font-family: 'Satoshi', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #111; background: #fff; border-radius: 24px; border: 1px solid #f0f0f0;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <Mail className="w-full h-full p-1 text-inherit" />
                </div>
                
                <h2 style="font-size: 22px; font-weight: 800; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 30px; letter-spacing: -0.03em; text-align: center; color: #000;">
                    New Partner Application Received
                </h2>
                
                <div style="margin-bottom: 25px; background: #fcfcfc; padding: 20px; border-radius: 16px; border: 1px solid #f5f5f5;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                            <td style="padding: 6px 0; color: #666; font-weight: 500; width: 120px;">Role Type:</td>
                            <td style="padding: 6px 0; color: #000; font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.05em;">
                                ${type === 'creator' ? '✦ CREATOR (AI Agent Developer)' : '⚡ AFFILIATE (Sales/Promoter)'}
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #666; font-weight: 500;">Applicant:</td>
                            <td style="padding: 6px 0; color: #000; font-weight: 700; font-family: monospace;">
                                <a href="mailto:${email}" style="color: #0066cc; text-decoration: none;">${email}</a>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #666; font-weight: 500;">Details:</td>
                            <td style="padding: 6px 0; color: #555; font-size: 13px;">${description}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #666; font-weight: 500;">Submitted At:</td>
                            <td style="padding: 6px 0; color: #000;">${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} (IST)</td>
                        </tr>
                    </table>
                </div>

                <div style="text-align: center; margin-top: 35px;">
                    <a href="mailto:${email}?subject=Maily Partner Application - Next Steps" 
                       style="background: #000; color: #fff; text-decoration: none; padding: 12px 25px; border-radius: 12px; font-weight: 700; font-size: 13px; display: inline-block;">
                        Onboard Applicant
                    </a>
                </div>

                <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 40px; font-size: 10px; color: #aaa; text-align: center; font-family: monospace; letter-spacing: 0.05em;">
                    PARTNER LOOP GATEWAY // ID: ${trackingId} // SECURE
                </div>
            </div>
        `;

        const { data, error } = await resend.emails.send({
            from: 'Maily Onboarding <support@maily.cfd>',
            to: ['support.maily@gmail.com'],
            replyTo: email,
            subject: `[Partner Loop] New ${type === 'creator' ? 'Creator' : 'Affiliate'} Application from ${email}`,
            html: emailContent,
        });

        if (error) {
            console.error('[Partner Apply API] Resend error:', error);
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('[Partner Apply API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
