/**
 * Composio managed-auth self-test.
 *
 *   node scripts/composio-selftest.mjs
 *
 * Verifies the OPERATIONAL setup is correct BEFORE any user connects:
 *   1. env vars present
 *   2. API key valid (auth configs are reachable)
 *   3. the Gmail/GCal auth config ids exist
 *   4. "Mask Connected Account Secrets" is OFF (the one toggle people forget)
 *
 * It does NOT create a connection — that's the live consent-screen test you
 * run in a browser (a normal "Composio" consent screen = green light; a
 * "Google hasn't verified this app" wall = stop, the thesis fails).
 *
 * Reads .env.local so it matches what the app sees locally.
 */
import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on real env */ }
}
loadEnv();

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m!\x1b[0m ${s}`;

const apiKey = process.env.COMPOSIO_API_KEY;
const gmailCfg = process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID;
const gcalCfg = process.env.COMPOSIO_GCAL_AUTH_CONFIG_ID;

let failures = 0;
const fail = (m) => { console.log(bad(m)); failures++; };

console.log('\n── Composio managed-auth self-test ──\n');

if (!apiKey) fail('COMPOSIO_API_KEY missing'); else console.log(ok('COMPOSIO_API_KEY present'));
if (!gmailCfg) fail('COMPOSIO_GMAIL_AUTH_CONFIG_ID missing'); else console.log(ok(`Gmail auth config: ${gmailCfg}`));
if (!gcalCfg) console.log(warn('COMPOSIO_GCAL_AUTH_CONFIG_ID missing (Calendar via Composio will be off)')); else console.log(ok(`GCal auth config: ${gcalCfg}`));
if (process.env.NEXT_PUBLIC_COMPOSIO_GMAIL !== '1') console.log(warn('NEXT_PUBLIC_COMPOSIO_GMAIL != 1 — onboarding will use the legacy single-signIn flow'));

if (!apiKey) { console.log('\nCannot continue without an API key.\n'); process.exit(1); }

try {
  const { Composio } = await import('@composio/core');
  const composio = new Composio({ apiKey });

  // 1. API key valid + auth configs reachable
  for (const [label, id] of [['Gmail', gmailCfg], ['GCal', gcalCfg]]) {
    if (!id) continue;
    try {
      const cfg = await composio.authConfigs.get(id);
      console.log(ok(`${label} auth config reachable (toolkit: ${cfg?.toolkit?.slug ?? cfg?.toolkit ?? 'unknown'})`));
    } catch (e) {
      fail(`${label} auth config ${id} not reachable: ${e?.message || e}`);
    }
  }

  // 2. LIVE END-TO-END: pass a real connected-account id as the 1st CLI arg
  //    (node scripts/composio-selftest.mjs <accountId>) after connecting one
  //    Google account through the app. This resolves the token EXACTLY as the
  //    Boult tool layer does, then hits Google's tokeninfo to PROVE the token
  //    is a real, unmasked, Gmail-scoped bearer Google accepts. This is the
  //    definitive "does Boult reach the user's Gmail via Composio" check.
  const testAccountId = process.argv[2];
  if (testAccountId) {
    try {
      const account = await composio.connectedAccounts.get(testAccountId);
      console.log(ok(`Connected account status: ${account.status}`));
      const tok = account?.state?.val?.access_token;
      if (!tok) fail('No access_token in state.val — is the auth scheme OAUTH2 and the account ACTIVE?');
      else if (tok.length < 20 || tok.includes('...')) fail('access_token is MASKED — turn OFF "Mask Connected Account Secrets" in the dashboard.');
      else {
        const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tok)}`);
        const j = await info.json();
        if (!info.ok || j.error) fail(`Google rejected the token: ${j.error_description || j.error || info.status}`);
        else {
          const scopes = String(j.scope || '');
          const hasGmail = /mail\.google\.com|gmail\./.test(scopes);
          console.log(ok(`Google ACCEPTS the token. Scopes: ${scopes}`));
          console.log(hasGmail ? ok('Gmail scope present — Boult tools will work against this account.')
                               : warn('No Gmail scope on this token — check the auth config scopes.'));
        }
      }
    } catch (e) {
      fail(`Live account test failed: ${e?.message || e}`);
    }
  } else {
    console.log(warn('Tip: after connecting one Google account, re-run with its id — `node scripts/composio-selftest.mjs <accountId>` — to PROVE Google accepts the token end-to-end.'));
  }

  console.log(warn('Manual check: Composio dashboard → Settings → Project Configuration → "Mask Connected Account Secrets" must be OFF, or tokens come back masked and every connection fails.'));
} catch (e) {
  fail(`SDK error: ${e?.message || e}`);
}

console.log('');
if (failures) { console.log(bad(`${failures} problem(s) — fix before enabling Composio in production.\n`)); process.exit(1); }
console.log(ok('Config looks good. Now run the LIVE consent test in a browser (the real go/no-go).\n'));
