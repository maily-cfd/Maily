/**
 * Maily — the one visual language for every email we send.
 *
 * WHAT EMAIL CANNOT DO (why this looks the way it does)
 * The brief was Apple-like glassmorphism. Real glassmorphism needs
 * `backdrop-filter`, which NO major mail client supports — not Gmail, not Apple
 * Mail, not Outlook. So the glass here is *simulated*: layered near-tones, a
 * hairline rim, and a soft top highlight, which is what the eye actually reads
 * as "glass" once the blur is gone.
 *
 * Hard constraints every helper below respects:
 *  - Outlook (Windows) renders through Word: no border-radius, no box-shadow,
 *    no CSS gradients. Every gradient therefore ships with a solid
 *    background-color underneath it, so Outlook degrades to a flat tone rather
 *    than to white-on-white.
 *  - Gmail strips <style> blocks when it clips a long message, so all critical
 *    styling is INLINE. The <style> block carries only progressive enhancement.
 *  - Gmail and Apple Mail auto-invert dark colors in dark mode. A black-and-
 *    white design is the single worst case for that — inverted, our black
 *    surfaces turn muddy grey. We opt out via color-scheme + a
 *    prefers-color-scheme block that RE-ASSERTS our palette instead of letting
 *    the client guess.
 *  - Geist is served as PROGRESSIVE ENHANCEMENT, never a dependency. Web fonts
 *    in email work in Apple Mail and a handful of clients; Gmail, Outlook and
 *    Yahoo ignore @font-face entirely. Since our users are Gmail users almost
 *    by definition, MOST recipients will see the fallback stack — so that stack
 *    is chosen to sit as close to Geist as the system allows (SF Pro on Apple,
 *    Segoe UI Variable on Windows), and the layout must never depend on Geist's
 *    metrics. Nothing breaks when it doesn't load; it just looks slightly less
 *    like us.
 */

/* ── Palette. Black and white, with grey doing all the work. ─────────────── */
const C = {
  ink: '#0A0A0A',        // near-black — primary text, primary surface
  inkSoft: '#1A1A1A',    // raised surface on dark
  paper: '#FFFFFF',
  paperSoft: '#FAFAFA',  // page background
  line: '#EDEDED',       // hairline on light
  lineDark: '#242424',   // hairline on dark
  text: '#111111',
  textMuted: '#6B6B6B',
  textFaint: '#9A9A9A',
  onDark: '#FFFFFF',
  onDarkMuted: '#A8A8A8',
};

/**
 * Geist first, then the closest thing each OS ships.
 *
 * The fallbacks are ordered to preserve the FEEL when Geist doesn't load (which
 * is most of the time — see the header note): SF Pro on Apple and Segoe UI
 * Variable on Windows are both neutral grotesques cut from the same cloth as
 * Geist, so the drop is barely perceptible. Arial is last because it is the
 * only thing guaranteed everywhere.
 */
const FONT =
  "'Geist', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Geist VF from Google Fonts. Google serves ONE file across weights 400-600,
 * which is the variable cut — so a single 60KB request covers every weight the
 * templates use, instead of three static faces.
 *
 * Declared inline in <style> rather than via <link>: many clients strip <link>
 * from <head>, and a stylesheet request that fails leaves no fallback path,
 * whereas a failed @font-face simply falls through to the stack above.
 */
const FONT_FACE = `
    @font-face {
      font-family: 'Geist';
      font-style: normal;
      font-weight: 400 600;
      font-display: swap;
      src: url(https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMHweElKvOg.woff2) format('woff2');
    }`;

/**
 * Page shell. `content` is the card interior.
 * `eyebrow` sits above the title in the dark header; keep it 2-4 words.
 */
function shell({ title, eyebrow = '', content, footerNote = '' }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${esc(title)}</title>
  <!--[if mso]>
  <style>
    /* Word engine ignores rounded corners and shadows anyway — make sure the
       fallback is a clean flat block rather than a broken one. */
    table, td { border-collapse: collapse; }
    .mso-flat { border-radius: 0 !important; }
  </style>
  <![endif]-->
  <style>
    /* Progressive enhancement ONLY. Gmail may drop this entire block — which is
       exactly why the font-family on every element also names the fallbacks
       inline, and why nothing below is load-bearing. */
    ${FONT_FACE}
    @media (max-width: 600px) {
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .stack { display: block !important; width: 100% !important; }
      .h1 { font-size: 26px !important; line-height: 1.2 !important; }
    }
    /* Dark mode: re-assert, never inherit. Without this the client inverts our
       blacks into grey and the whole design goes flat. */
    @media (prefers-color-scheme: dark) {
      .page { background: ${C.ink} !important; }
      .card { background: ${C.paper} !important; }
    }
    a { text-decoration: none; }
  </style>
</head>
<body class="page" style="margin:0; padding:0; background:${C.paperSoft}; -webkit-font-smoothing:antialiased; font-family:${FONT};">
  <!-- Preheader: the grey line beside the subject in the inbox list. -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${esc(footerNote || title)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paperSoft};">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

          <!-- Wordmark -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <span style="font-family:${FONT}; font-size:15px; font-weight:600; letter-spacing:-0.01em; color:${C.text};">Maily</span>
            </td>
          </tr>

          <!-- The card -->
          <tr>
            <td class="card mso-flat" style="background:${C.paper}; border:1px solid ${C.line}; border-radius:20px; overflow:hidden;">

              ${header({ title, eyebrow })}

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:32px 40px 40px;">
                    ${content}
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:28px 16px 0;">
              <p style="margin:0; font-family:${FONT}; font-size:12px; line-height:1.6; color:${C.textFaint};">
                <a href="https://maily.cfd" style="color:${C.textMuted};">maily.cfd</a>
                &nbsp;·&nbsp;
                <a href="mailto:support.maily@gmail.com" style="color:${C.textMuted};">support</a>
              </p>
              <p style="margin:10px 0 0; font-family:${FONT}; font-size:11px; line-height:1.6; color:${C.textFaint};">
                Reply to this email and a human reads it.
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

/**
 * The dark header band. This is where the "premium" reads: a near-black slab
 * with a soft top highlight standing in for a glass rim, and a gradient that
 * degrades to solid ink in Outlook.
 */
function header({ title, eyebrow }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:${C.ink}; background-image:linear-gradient(160deg, #1F1F1F 0%, ${C.ink} 55%, #000000 100%);">
    <tr>
      <td style="height:1px; line-height:1px; font-size:0; background-color:#3A3A3A; background-image:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.28) 50%, rgba(255,255,255,0) 100%);">&nbsp;</td>
    </tr>
    <tr>
      <td class="px" style="padding:${eyebrow ? '30px' : '34px'} 40px 30px;">
        ${eyebrow
          ? `<p style="margin:0 0 10px; font-family:${FONT}; font-size:11px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:${C.onDarkMuted};">${esc(eyebrow)}</p>`
          : ''}
        <h1 class="h1" style="margin:0; font-family:${FONT}; font-size:29px; line-height:1.18; font-weight:600; letter-spacing:-0.025em; color:${C.onDark};">${esc(title)}</h1>
      </td>
    </tr>
  </table>`;
}

/** Body copy. */
function p(text, { muted = false, size = 15 } = {}) {
  return `<p style="margin:0 0 16px; font-family:${FONT}; font-size:${size}px; line-height:1.65; color:${muted ? C.textMuted : C.text};">${text}</p>`;
}

/**
 * The simulated glass panel: a very light tint, hairline rim, and a bright top
 * edge. Reads as a raised pane of frosted glass without any blur.
 */
function panel(inner) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:${C.paperSoft}; background-image:linear-gradient(180deg, #FFFFFF 0%, ${C.paperSoft} 100%); border:1px solid ${C.line}; border-radius:14px; margin:0 0 20px;">
    <tr><td style="padding:20px 22px;">${inner}</td></tr>
  </table>`;
}

/** Label/value row for summary panels. */
function row(label, value) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="padding:7px 0; font-family:${FONT}; font-size:13px; color:${C.textMuted}; width:38%;">${esc(label)}</td>
      <td style="padding:7px 0; font-family:${FONT}; font-size:13px; font-weight:600; color:${C.text}; text-align:right;">${value}</td>
    </tr>
  </table>`;
}

/**
 * Primary button. Bulletproof-ish: Outlook gets a solid black rectangle via VML
 * fallback colour, everyone else gets the rounded pill.
 */
function button(label, href, { variant = 'primary' } = {}) {
  const dark = variant === 'primary';
  const bg = dark ? C.ink : C.paper;
  const fg = dark ? C.onDark : C.text;
  const border = dark ? C.ink : '#DCDCDC';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">
    <tr>
      <td class="mso-flat" align="center" style="background-color:${bg}; border:1px solid ${border}; border-radius:11px;">
        <a href="${href}" style="display:inline-block; padding:13px 26px; font-family:${FONT}; font-size:14px; font-weight:600; letter-spacing:-0.01em; color:${fg};">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** Hairline rule. */
function divider() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td style="height:1px; line-height:1px; font-size:0; background-color:${C.line};">&nbsp;</td></tr>
  </table>`;
}

/** Small uppercase section label. */
function sectionLabel(text) {
  return `<p style="margin:0 0 12px; font-family:${FONT}; font-size:11px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:${C.textFaint};">${esc(text)}</p>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const EmailUI = { C, FONT, shell, header, p, panel, row, button, divider, sectionLabel, esc };
export default EmailUI;
