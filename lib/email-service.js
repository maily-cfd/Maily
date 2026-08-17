/**
 * Maily Email Service — powered by Resend
 * Sends transactional plan emails:
 *   - pro (monthly)   → celebration + features
 *   - annual          → celebration + features + savings highlight
 *   - lifetime        → celebration + features + premium welcome (elite)
 */

import { Resend } from 'resend';
import { EmailUI } from './email-design.js';

/**
 * Lazily constructed. `new Resend(undefined)` THROWS, and at module scope that
 * throw happens on IMPORT — taking down every route that imports this file and
 * bypassing all the graceful `if (!RESEND_API_KEY)` guards below, which never
 * get a chance to run. Build the client only when we are actually about to send.
 */
let _resend = null;
function client() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const resend = {
  emails: {
    send: (...args) => client().emails.send(...args),
  },
};

const FROM_ADDRESS = 'Maily <onboarding@maily.dev>';
// maily.dev has no MX record — a reply to the FROM address would bounce.
// Every user-facing send must carry this replyTo so "just hit reply" works.
const REPLY_TO = 'support.maily@gmail.com';
const FEEDBACK_EMAIL = 'support.maily@gmail.com';
const TWITTER_HANDLE = 'https://x.com/Mailycfd';
const MONTHLY_CHECKOUT = 'https://buy.polar.sh/polar_cl_iFCJ2Mq7UbVBQTIiMGwI3STQZTvGfT1EBLyiM1HM5ca';
const SITE = process.env.NEXTAUTH_URL || 'https://maily.dev';

/* ─────────────────────────── helpers ─────────────────────────── */

function baseWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Maily</title>
  <style>
    @font-face {
      font-family: 'Satoshi';
      src: url('https://api.fontshare.com/v2/css?f[]=satoshi@700,500,400&display=swap');
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Satoshi', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #fcfcfc;
      color: #1a1a1a;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; text-decoration: none; }
    .glass-card {
      background: #ffffff;
      border: 1px solid #eeeeee;
      border-radius: 24px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.04);
    }
    .footer-link {
      color: #888888;
      text-decoration: none;
    }
    .footer-link:hover {
      color: #1a1a1a;
    }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fcfcfc; min-height:100vh; padding:60px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%;">

          <!-- LOGO -->
          <tr>
            <td style="padding-bottom:48px; text-align:center;">
              <span style="font-size:22px; font-weight:700; letter-spacing:-0.5px; color:#000000; font-family:'Satoshi', sans-serif;">
                ✦ Maily
              </span>
            </td>
          </tr>

          <!-- CONTENT CARD -->
          <tr>
            <td class="glass-card" style="padding:48px;">
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding-top:48px; text-align:center;">
              <p style="font-size:12px; color:#999999; line-height:1.6; font-family:'Satoshi', sans-serif;">
                Maily — AI-powered email intelligence<br/>
                <a href="https://maily.dev" class="footer-link">maily.dev</a>
                &nbsp;·&nbsp;
                <a href="${TWITTER_HANDLE}" class="footer-link">@maily</a>
                &nbsp;·&nbsp;
                <a href="mailto:${FEEDBACK_EMAIL}" class="footer-link">support</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ─────────────────── WELCOME EMAIL (No Plan) ─────────────────── */

function buildWelcomeEmail(name) {
  const displayName = name ? name.split(' ')[0] : 'there';
  const content = `
    <h1 style="font-size:32px; font-weight:700; color:#000000; letter-spacing:-0.8px; margin-bottom:16px; font-family:'Satoshi', sans-serif;">
      Welcome to the future of email, ${displayName}.
    </h1>
    <p style="font-size:16px; color:#555555; line-height:1.6; margin-bottom:40px;">
      You're one step away from transforming your productivity. Subscribe to Maily to unlock the full power of AI-driven email intelligence.
    </p>

    <div style="border-top: 1px solid #f0f0f0; border-bottom: 1px solid #f0f0f0; padding: 32px 0; margin-bottom: 40px;">
      <p style="font-size:11px; font-weight:700; color:#999999; letter-spacing:1px; text-transform:uppercase; margin-bottom:20px;">
        Unlock with any plan
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${featureRow('Sift AI', 'Unlimited')}
        ${featureRow('Boult AI', 'Unlimited')}
        ${featureRow('Email Summaries', 'Unlimited')}
        ${featureRow('Draft Replies', 'Unlimited')}
      </table>
    </div>

    <div style="background:#f9f9f9; border-radius:20px; padding:32px;">
      <h2 style="font-size:18px; font-weight:700; color:#000000; margin-bottom:12px;">Get started from $29/mo</h2>
      <p style="font-size:14px; color:#666666; line-height:1.6; margin-bottom:24px;">
        Monthly, Annual ($16.58/mo), or Lifetime Founder ($499) — choose the plan that fits your workflow.
      </p>
      <a href="${MONTHLY_CHECKOUT}" style="display:inline-block; padding:12px 32px; background:#000000; color:#ffffff; font-weight:600; font-size:14px; border-radius:12px;">
        Subscribe Now
      </a>
    </div>

    <p style="font-size:14px; color:#999999; line-height:1.6; margin-top:40px;">
      Best,<br/>
      The Team at Maily
    </p>
  `;
  return baseWrapper(content);
}

/* ─────────── TRIAL NUDGE — signed in, never started a trial ───────────
 *
 * "Smart" here means it only says things we can actually prove from the user's
 * own account. A nudge that invents value ("you're missing out on 10 hours a
 * week!") reads as spam; one that says "your inbox has 214 unread and Boult
 * already knows which 6 matter" reads as a colleague. Every dynamic line below
 * is omitted entirely when we don't have the number — never guessed, never
 * defaulted to a stock figure.
 */
export function buildTrialNudgeEmail(name, signals = {}) {
  const UI = EmailUI;
  const first = name ? String(name).split(' ')[0] : null;
  const { gmailConnected, unreadCount, hoursPerWeek, daysSinceSignup } = signals;

  // Opening adapts to how far they actually got. Someone who never connected
  // Gmail has a different blocker than someone who connected and stalled.
  const opening = gmailConnected
    ? `Your Gmail is connected and Boult has already read the room. What it hasn't done yet is act on it — that starts with your trial.`
    : `You signed in, but Boult never got to see an inbox. It takes one click, and the first briefing lands the next morning.`;

  const proof = [];
  if (typeof unreadCount === 'number' && unreadCount > 0) {
    proof.push(UI.row('Unread in your inbox', String(unreadCount)));
  }
  if (typeof hoursPerWeek === 'number' && hoursPerWeek > 0) {
    proof.push(UI.row('Time Boult can take back', `~${hoursPerWeek}h / week`));
  }
  proof.push(UI.row('Cost to start', '$0 — 3 days free'));

  const content = `
    ${UI.p(first ? `${first},` : `Hey,`)}
    ${UI.p(opening)}
    ${UI.panel(`${UI.sectionLabel('Where you stand')}${proof.join('')}`)}
    ${UI.p(`The trial is the whole product — the agent that runs on a schedule, replies in your voice, and leaves one briefing instead of an inbox. Nothing is charged today, and cancelling takes one click.`, { muted: true, size: 14 })}
    ${UI.button('Start the 3-day trial', `${SITE}/onboarding?step=13`)}
    ${UI.divider()}
    ${UI.p(`Not the right time? Reply and tell me what stopped you — I read every one.`, { muted: true, size: 13 })}
  `;

  return EmailUI.shell({
    title: gmailConnected ? 'Your inbox is ready. Boult isn’t running yet.' : 'One click and Boult starts reading.',
    eyebrow: 'Your trial is waiting',
    content,
    footerNote: 'Three days free. No charge today.',
  });
}

/* ─────────────── TRIAL WELCOME — the trial just started ───────────────
 *
 * Sent the moment a trial begins. The job of this email is NOT celebration —
 * it is to set the one expectation that determines whether they stay: the
 * agent runs on a schedule, and the first briefing arrives tomorrow morning.
 * A user who doesn't know that thinks nothing happened and churns on day two.
 */
export function buildTrialWelcomeEmail(name, details = {}) {
  const UI = EmailUI;
  const first = name ? String(name).split(' ')[0] : null;
  const { trialEndsLabel, briefTimeLabel, agentName } = details;

  const facts = [
    agentName ? UI.row('Your agent', UI.esc(agentName)) : '',
    briefTimeLabel ? UI.row('First briefing', UI.esc(briefTimeLabel)) : '',
    trialEndsLabel ? UI.row('Trial ends', UI.esc(trialEndsLabel)) : '',
    UI.row('Charged today', '$0'),
  ].filter(Boolean).join('');

  const content = `
    ${UI.p(first ? `${first} — you're in.` : `You're in.`)}
    ${UI.p(`Boult is on duty. It runs on its own schedule from here: it reads what lands, handles the noise, and leaves you one briefing instead of an inbox. Anything that sends on your behalf waits for your approval first.`)}
    ${UI.panel(`${UI.sectionLabel('What happens next')}${facts}`)}
    ${UI.p(`<strong style="color:#111111;">Tomorrow morning is the moment to judge it.</strong> That's when the first briefing arrives — the whole product in one email.`, { size: 14 })}
    ${UI.button('Open Maily', `${SITE}/home-feed`)}
    ${UI.divider()}
    ${UI.p(`If the first briefing misses something you cared about, reply to it and say so — that feedback is what tunes the agent to you.`, { muted: true, size: 13 })}
  `;

  return EmailUI.shell({
    title: 'Boult is on duty.',
    eyebrow: 'Trial started',
    content,
    footerNote: 'Your first briefing arrives tomorrow morning.',
  });
}

/* ─────────────── MONTHLY PLAN EMAIL ─────────────── */

function buildMonthlyEmail(name) {
  const displayName = name ? name.split(' ')[0] : 'there';
  const content = `
    <h1 style="font-size:32px; font-weight:700; color:#000000; letter-spacing:-0.8px; margin-bottom:16px; font-family:'Satoshi', sans-serif;">
      You're in, ${displayName}.
    </h1>
    <p style="font-size:16px; color:#555555; line-height:1.6; margin-bottom:40px;">
      Welcome to Maily. Your workspace has been upgraded, and all AI limits have been removed. It is time to work at the speed of thought.
    </p>

    <div style="border-top: 1px solid #f0f0f0; border-bottom: 1px solid #f0f0f0; padding: 32px 0; margin-bottom: 40px;">
      <p style="font-size:11px; font-weight:700; color:#999999; letter-spacing:1px; text-transform:uppercase; margin-bottom:20px;">
        Your Workspace
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${featureRow('Sift AI', 'Unlimited')}
        ${featureRow('Boult AI', 'Unlimited')}
        ${featureRow('Summaries', 'Unlimited')}
        ${featureRow('Drafts', 'Unlimited')}
        ${featureRow('Scheduling', 'Unlimited')}
      </table>
    </div>

    <div style="background:#000000; border-radius:20px; padding:32px;">
      <h2 style="font-size:18px; font-weight:700; color:#ffffff; margin-bottom:12px;">Get Started</h2>
      <p style="font-size:14px; color:#888888; line-height:1.6; margin-bottom:24px;">
        Head over to your home feed to see your newly unlocked intelligence in action.
      </p>
      <a href="https://maily.dev/home-feed" style="display:inline-block; padding:12px 32px; background:#ffffff; color:#000000; font-weight:600; font-size:14px; border-radius:12px;">
        Open maily.dev
      </a>
    </div>

    <p style="font-size:14px; color:#999999; line-height:1.6; margin-top:40px;">
      Thank you for being part of our journey.<br/>
      The Team at Maily
    </p>
  `;
  return baseWrapper(content);
}

/* ─────────────── PRO PLAN EMAIL ─────────────── */

function buildProEmail(name) {
  const displayName = name ? name.split(' ')[0] : 'there';
  const content = `
    <div style="text-align:center; margin-bottom:40px;">
      <span style="display:inline-block; padding:4px 12px; background:#f0f0f0; border-radius:100px; font-size:10px; font-weight:700; letter-spacing:1px; color:#000000; margin-bottom:16px; text-transform:uppercase;">Maily Pro</span>
      <h1 style="font-size:36px; font-weight:700; color:#000000; letter-spacing:-1px; margin-bottom:16px; font-family:'Satoshi', sans-serif;">
        Elite Status, ${displayName}.
      </h1>
      <p style="font-size:18px; color:#555555; line-height:1.6;">
        You are now on the Pro plan. Every boundary has been removed. All AI features are now truly unlimited.
      </p>
    </div>

    <div style="border: 1px solid #1a1a1a; border-radius: 24px; padding: 40px; margin-bottom: 40px;">
      <table cellpadding="0" cellspacing="0" width="100%">
        ${proFeatureRow('Sift AI', 'Unlimited')}
        ${proFeatureRow('Boult AI', 'Unlimited')}
        ${proFeatureRow('Summaries', 'Unlimited')}
        ${proFeatureRow('Drafts', 'Unlimited')}
        ${proFeatureRow('Intelligence', 'Unlimited')}
      </table>
    </div>

    <a href="https://maily.dev/home-feed" style="display:block; text-align:center; padding:18px; background:#000000; color:#ffffff; font-weight:700; font-size:16px; border-radius:16px;">
      Enter the Pro Dashboard
    </a>

    <p style="font-size:14px; color:#999999; line-height:1.6; margin-top:40px; text-align:center;">
      You have our full support. Reach out anytime.<br/>
      Team Maily
    </p>
  `;
  return baseWrapper(content);
}

function featureRow(title, value) {
  return `
    <tr>
      <td style="padding:12px 0; font-size:14px; font-weight:500; color:#1a1a1a; font-family:'Satoshi', sans-serif;">${title}</td>
      <td style="padding:12px 0; font-size:14px; color:#999999; text-align:right; font-family:'Satoshi', sans-serif;">${value}</td>
    </tr>
  `;
}

function proFeatureRow(title, value) {
  return `
    <tr>
      <td style="padding:16px 0; font-size:16px; font-weight:700; color:#000000; font-family:'Satoshi', sans-serif;">${title}</td>
      <td style="padding:16px 0; font-size:15px; font-weight:500; color:#000000; text-align:right; font-family:'Satoshi', sans-serif;">${value}</td>
    </tr>
  `;
}

/* ─────────────── PAYMENT RECEIPT + INVOICE EMAIL ─────────────── */

function buildReceiptEmail(name, { planLabel, amountLabel, dateLabel, invoiceUrl }) {
  const displayName = name ? name.split(' ')[0] : 'there';
  const content = `
    <h1 style="font-size:32px; font-weight:700; color:#000000; letter-spacing:-0.8px; margin-bottom:16px; font-family:'Satoshi', sans-serif;">
      Payment received, ${displayName}.
    </h1>
    <p style="font-size:16px; color:#555555; line-height:1.6; margin-bottom:40px;">
      Thanks for your payment. Here's your receipt${invoiceUrl ? ' — your full invoice is below' : ''}. Keep it for your records.
    </p>

    <div style="border-top: 1px solid #f0f0f0; border-bottom: 1px solid #f0f0f0; padding: 32px 0; margin-bottom: 40px;">
      <p style="font-size:11px; font-weight:700; color:#999999; letter-spacing:1px; text-transform:uppercase; margin-bottom:20px;">
        Receipt
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${proFeatureRow('Plan', planLabel || 'Maily')}
        ${amountLabel ? proFeatureRow('Amount', amountLabel) : ''}
        ${dateLabel ? proFeatureRow('Date', dateLabel) : ''}
      </table>
    </div>

    ${invoiceUrl ? `
    <div style="background:#000000; border-radius:20px; padding:32px; margin-bottom:40px;">
      <h2 style="font-size:18px; font-weight:700; color:#ffffff; margin-bottom:12px;">Your invoice</h2>
      <p style="font-size:14px; color:#888888; line-height:1.6; margin-bottom:24px;">
        Download the official invoice for this payment as a PDF.
      </p>
      <a href="${invoiceUrl}" style="display:inline-block; padding:12px 32px; background:#ffffff; color:#000000; font-weight:600; font-size:14px; border-radius:12px;">
        Download invoice (PDF)
      </a>
    </div>` : `
    <div style="background:#f9f9f9; border-radius:20px; padding:24px; margin-bottom:40px;">
      <p style="font-size:14px; color:#666666; line-height:1.6;">
        Your itemized invoice is being prepared and will be available shortly in your billing portal.
      </p>
    </div>`}

    <p style="font-size:14px; color:#999999; line-height:1.6;">
      Questions about this charge? Reply to this email or reach us at
      <a href="mailto:${FEEDBACK_EMAIL}" style="color:#666666;">${FEEDBACK_EMAIL}</a>.
    </p>
  `;
  return baseWrapper(content);
}

/**
 * Send a payment receipt + invoice email. Fired on a real charge (order.paid),
 * separate from the "subscription active" welcome email so trials (no charge) don't
 * get a receipt. invoiceUrl is optional — the email adapts if it isn't ready yet.
 */
export async function sendReceiptEmail({ toEmail, toName, planLabel, amountLabel, dateLabel, invoiceUrl }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set — skipping receipt email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!toEmail) return { success: false, error: 'No recipient email provided' };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
      replyTo: REPLY_TO,
      subject: '✦ Your Maily payment receipt',
      html: buildReceiptEmail(toName, { planLabel, amountLabel, dateLabel, invoiceUrl }),
    });
    if (error) {
      console.error('❌ Resend error (receipt):', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('❌ Failed to send receipt email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Nudge a user who signed in but never started a trial.
 *
 * `signals` are OPTIONAL and each one is dropped from the email when absent —
 * see buildTrialNudgeEmail. Pass only what you can prove from their account:
 *   { gmailConnected, unreadCount, hoursPerWeek, daysSinceSignup }
 *
 * This is marketing mail to a real person. It is deliberately NOT wired to any
 * automatic trigger — the caller decides who receives it and when.
 */
export async function sendTrialNudgeEmail({ toEmail, toName, signals = {} }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set — skipping trial nudge email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!toEmail) return { success: false, error: 'No recipient email provided' };

  const subject = signals.gmailConnected
    ? 'Boult has read your inbox — it just isn’t running yet'
    : 'Your Boult agent is one click from starting';

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
      replyTo: REPLY_TO,
      subject,
      html: buildTrialNudgeEmail(toName, signals),
    });
    if (error) {
      console.error('❌ Resend error (trial nudge):', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('❌ Failed to send trial nudge email:', err);
    return { success: false, error: err.message };
  }
}

/* ─────────────── LANDING HOOK — opt-in capture on maily.dev ───────────────
 *
 * Sent ONCE, immediately, to someone who typed their own email into the capture
 * field on the marketing site. This is the closest legitimate version of "email
 * my visitors": it only ever reaches people who opted in, never an anonymous
 * pageview (a pageview carries no address, and we do not de-anonymise anyone).
 *
 * The hook is the product's real thesis, verbatim from the landing manifesto —
 * no invented lead magnet, nothing promised that the email doesn't deliver.
 */
export function buildLandingHookEmail() {
  const UI = EmailUI;
  const content = `
    ${UI.p(`Every founder has lost money to an email they saw too late. You have too — you just can't name which one.`)}
    ${UI.p(`Gmail sorts the mail you read. Superhuman makes you faster at the mail you read. None of them watch the email you <strong>never opened</strong>. That's where the money leaks.`)}
    ${UI.p(`Maily reads the inbox overnight, drafts the replies in your voice, books the calls, and leaves you one briefing in the morning. Nothing sends without your approval.`)}
    ${UI.button('Watch it handle a real inbox', `${SITE}/#demos`)}
    ${UI.divider()}
    ${UI.p(`Not for you? Ignore this and you won't hear from me again — or just hit reply, it reaches me directly.`, { muted: true, size: 13 })}
  `;
  return EmailUI.shell({
    title: 'The most expensive email in your inbox is the one you never opened.',
    eyebrow: 'From the founder',
    content,
    // CAN-SPAM: state plainly why they received this. It is also true.
    footerNote: 'You left your email on maily.dev — that is the only reason this reached you.',
  });
}

export async function sendLandingHookEmail({ toEmail }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set — skipping landing hook email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!toEmail) return { success: false, error: 'No recipient email provided' };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
      replyTo: REPLY_TO,
      subject: 'The most expensive email in your inbox is the one you never opened',
      html: buildLandingHookEmail(),
    });
    if (error) {
      console.error('❌ Resend error (landing hook):', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('❌ Failed to send landing hook email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Welcome a user whose trial just started. Transactional — fire it from the
 * subscription webhook the moment a trial begins.
 *
 * `details` are optional: { trialEndsLabel, briefTimeLabel, agentName }.
 * Each is omitted from the email when not known.
 */
export async function sendTrialWelcomeEmail({ toEmail, toName, details = {} }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set — skipping trial welcome email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!toEmail) return { success: false, error: 'No recipient email provided' };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
      replyTo: REPLY_TO,
      subject: '✦ Boult is on duty — your trial has started',
      html: buildTrialWelcomeEmail(toName, details),
    });
    if (error) {
      console.error('❌ Resend error (trial welcome):', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('❌ Failed to send trial welcome email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * "You just earned a free month." Fired when a friend a user referred converts
 * to a paying customer.
 *
 * This email is the engine of the whole referral loop. Someone who shares a link
 * and hears NOTHING back assumes it didn't work and never shares again; someone
 * who gets told the moment it pays out shares the next one. It is the only
 * moment where the reward stops being a promise.
 */
export async function sendReferralEarnedEmail({ toEmail, toName, freeUntilLabel, totalMonths }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set — skipping referral earned email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!toEmail) return { success: false, error: 'No recipient email provided' };

  const UI = EmailUI;
  const first = toName ? String(toName).split(' ')[0] : null;

  const facts = [
    UI.row('You earned', '1 free month'),
    freeUntilLabel ? UI.row('Your Pro runs through', UI.esc(freeUntilLabel)) : '',
    typeof totalMonths === 'number' && totalMonths > 1 ? UI.row('Months earned so far', String(totalMonths)) : '',
  ].filter(Boolean).join('');

  const content = `
    ${UI.p(first ? `${first} — someone you invited just became a customer.` : `Someone you invited just became a customer.`)}
    ${UI.p(`That's a free month on us, added to your account automatically. Nothing to claim.`)}
    ${UI.panel(`${UI.sectionLabel('Your reward')}${facts}`)}
    ${UI.p(`Every friend who sticks around adds another month. Twelve of them and your year is covered.`, { muted: true, size: 14 })}
    ${UI.button('Share your link again', `${SITE}/referrals`)}
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
      replyTo: REPLY_TO,
      subject: '✦ You just earned a free month',
      html: EmailUI.shell({
        title: 'A friend joined. That’s a month on us.',
        eyebrow: 'Referral paid out',
        content,
        footerNote: 'One free month has been added to your account.',
      }),
    });
    if (error) {
      console.error('❌ Resend error (referral earned):', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data.id };
  } catch (err) {
    console.error('❌ Failed to send referral earned email:', err);
    return { success: false, error: err.message };
  }
}

/* ─────────────────────── PUBLIC API ─────────────────────── */

export async function sendPlanEmail({ toEmail, toName, plan }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set — skipping plan email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  if (!toEmail) {
    return { success: false, error: 'No recipient email provided' };
  }

  let subject, htmlBody;

  switch (plan) {
    case 'free':
    case 'welcome':
      subject = '✦ Welcome to Maily';
      htmlBody = buildWelcomeEmail(toName);
      break;
    case 'pro':
    case 'monthly':
    case 'starter': // Legacy alias
      subject = '✦ Your Maily Subscription is Active';
      htmlBody = buildMonthlyEmail(toName);
      break;
    case 'annual':
      subject = '✦ Your Annual Plan is Active — Welcome to Maily';
      htmlBody = buildMonthlyEmail(toName); // Same template, different subject
      break;
    case 'lifetime':
      subject = '✦ Welcome to Maily Pro — Lifetime Founder';
      htmlBody = buildProEmail(toName);
      break;
    default:
      return { success: false, error: `Unknown plan type: ${plan}` };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [toEmail],
      replyTo: REPLY_TO,
      subject,
      html: htmlBody,
    });

    if (error) {
      console.error('❌ Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data.id };
  } catch (err) {
    console.error('❌ Failed to send plan email:', err);
    return { success: false, error: err.message };
  }
}
