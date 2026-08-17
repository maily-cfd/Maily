import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { logEvent } from "@/lib/logsso";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function POST(req: Request) {
    try {
        const { name, email, message, subject = 'New Contact Inquiry' } = await req.json();

        if (!name || !email || !message) {
            return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 });
        }

        if (!resend) {
            console.error('RESEND_API_KEY is missing. Contact form message:', { name, email, message });
            return NextResponse.json({ success: true, message: 'Message received (logged to console)' });
        }

        const emailContent = `
            <div style="font-family: 'Satoshi', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #111; background: #fff; border-radius: 24px; border: 1px solid #f0f0f0;">
                <h2 style="font-size: 24px; font-weight: 800; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 30px; letter-spacing: -0.04em;">Contact Inquiry: ${subject}</h2>
                
                <div style="margin-bottom: 35px;">
                    <p style="font-size: 11px; text-transform: uppercase; color: #999; font-weight: 800; margin-bottom: 8px; letter-spacing: 0.15em;">From</p>
                    <p style="font-size: 16px; font-weight: 600; color: #000; margin: 0;">${name} &lt;${email}&gt;</p>
                </div>

                <div style="margin-bottom: 40px;">
                    <p style="font-size: 11px; text-transform: uppercase; color: #999; font-weight: 800; margin-bottom: 12px; letter-spacing: 0.15em;">Message Body</p>
                    <div style="font-size: 15px; line-height: 1.7; color: #333; background: #fcfcfc; padding: 25px; border-radius: 16px; border: 1px solid #f5f5f5;">
                        ${message.replace(/\n/g, '<br/>')}
                    </div>
                </div>

                <div style="border-top: 1px solid #eee; padding-top: 25px; margin-top: 40px; font-size: 11px; color: #bbb; text-align: center; letter-spacing: 0.05em;">
                    Inquiry routed via Maily Support Gateway.<br/>
                    ID: ${Math.random().toString(36).substring(7).toUpperCase()} | ${new Date().toISOString()}
                </div>
            </div>
        `;

        const { data, error } = await resend.emails.send({
            from: 'Support <support@maily.dev>',
            to: ['support.maily@gmail.com'],
            replyTo: email,
            subject: `[Support] ${subject} from ${name}`,
            html: emailContent,
        });

        if (error) {
            console.error('Resend error:', error);
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
        console.error('Contact API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
