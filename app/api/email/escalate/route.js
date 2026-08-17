import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { GmailService } from '@/lib/gmail';
import { decrypt } from '@/lib/crypto';
import { DatabaseService } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

export async function POST(request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const escalationData = await request.json();
        
        // Validate required fields
        const requiredFields = ['emailId', 'subject', 'sender', 'userEmail'];
        for (const field of requiredFields) {
            if (!escalationData[field]) {
                return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 });
            }
        }

        // Send notification email to support team
        try {
            // Get admin access token for sending emails
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

            if (accessToken) {
                const gmailService = new GmailService(accessToken, refreshToken);
                
                // Send notification to support team
                const notificationEmail = {
                    to: 'support.maily@gmail.com',
                    subject: `🚨 URGENT: Escalated Message from ${session.user.email}`,
                    body: `A user has escalated an urgent message that requires immediate attention.

Details:
- User: ${session.user.email}
- Original Sender: ${escalationData.senderName} (${escalationData.sender})
- Subject: ${escalationData.subject}
- Category: ${escalationData.category}
- Urgency: ${escalationData.urgencyLevel}
- Email ID: ${escalationData.emailId}
- Received: ${escalationData.receivedAt}

Message snippet:
${escalationData.snippet}

Please review and take appropriate action immediately.`
                };

                await gmailService.sendEmail(notificationEmail);
                
                return NextResponse.json({
                    success: true,
                    message: 'Message escalated successfully. Support team notified via email.',
                    escalationId: escalationData.emailId,
                    status: 'notified'
                });
            } else {
                // If we can't send email, still return success but with a warning
                console.warn('Could not send escalation email - no Gmail access token available');
                
                return NextResponse.json({
                    success: true,
                    message: 'Message escalated. Support team notification pending email access.',
                    escalationId: escalationData.emailId,
                    status: 'pending_notification'
                });
            }
        } catch (emailError) {
        logEvent({ channel: "failures", event: "❌ API Error", description: String(emailError) });
            console.error('Failed to send escalation notification email:', emailError);
            
            // Still return success since the escalation was processed, just notification failed
            return NextResponse.json({
                success: true,
                message: 'Message escalated. Support team notification failed but escalation was recorded.',
                escalationId: escalationData.emailId,
                status: 'notification_failed',
                notificationError: emailError.message
            });
        }

    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Error escalating message:', error);
        return NextResponse.json({
            error: error.message,
            success: false
        }, { status: 500 });
    }
}
