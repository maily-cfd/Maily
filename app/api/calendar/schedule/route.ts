import { NextResponse } from 'next/server';
import { logEvent } from "@/lib/logsso";

// @ts-ignore
const { auth } = require('../../../../lib/auth');
// @ts-ignore
const { CalendarService } = require('../../../../lib/calendar');
// @ts-ignore
const { DatabaseService } = require('../../../../lib/supabase');
// @ts-ignore
const { decrypt } = require('../../../../lib/crypto');
// @ts-ignore
const { GmailService } = require('../../../../lib/gmail');

export async function POST(request: Request) {
    try {
        const session = await (auth as any)();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body;
        try {
            body = await request.json();
        } catch (e) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(e) });
            return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const { summary, description, startTime, endTime, attendees, notifySender, emailId } = body;

        if (!startTime || !endTime) {
            return NextResponse.json({ error: 'Start and end times are required' }, { status: 400 });
        }

        // Get tokens
        let accessToken = session?.accessToken;
        let refreshToken = session?.refreshToken;

        if (!accessToken) {
            const db = new DatabaseService();
            const userTokens = await db.getUserTokens(session.user.email);
            if (userTokens?.encrypted_access_token) {
                accessToken = decrypt(userTokens.encrypted_access_token);
                refreshToken = userTokens.encrypted_refresh_token ? decrypt(userTokens.encrypted_refresh_token) : '';
            }
        }

        if (!accessToken) {
            return NextResponse.json({ error: 'Google account not connected' }, { status: 403 });
        }

        const calendarService = new CalendarService(accessToken, refreshToken);

        // Create the event
        const event = await calendarService.createMeeting({
            summary: summary || 'Meeting with Maily User',
            description: description || 'Scheduled via Maily',
            startTime,
            endTime,
            attendees: attendees || []
        });

        // Notify the sender if requested
        if (notifySender && emailId) {
            try {
                const gmailService = new GmailService(accessToken, refreshToken);
                const emailDetails = await gmailService.getEmailDetails(emailId);
                const parsedEmail = gmailService.parseEmailData(emailDetails);

                // Better sender email extraction
                let senderEmail = parsedEmail.from;
                const match = senderEmail.match(/<(.+?)>|(\S+@\S+)/);
                if (match) {
                    senderEmail = match[1] || match[2];
                }

                if (senderEmail) {
                    const meetLink = (event as any).hangoutLink || 'Google Meet link will be in the invitation';
                    const notificationBody = `
Hi there,

I've scheduled a meeting with you on ${new Date(startTime).toLocaleString()}.

Topic: ${summary}
Join here: ${meetLink}

Looking forward to it!

Best regards,
${session.user.name || 'Maily User'}
`.trim();

                    await gmailService.sendEmail({
                        to: senderEmail,
                        subject: `Confirmed Meeting: ${summary}`,
                        body: notificationBody
                    });
                }
            } catch (notifyErr) {
            logEvent({ channel: "failures", event: "❌ API Error", description: String(notifyErr) });
                console.warn('⚠️ Could not send notification email:', notifyErr);
                // Don't fail the whole request just because email notification failed
            }
        }

        return NextResponse.json({ success: true, event });

    } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('❌ Scheduling error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
