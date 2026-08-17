/**
 * NextAuth configuration for Google OAuth with Gmail integration
 * Handles authentication, token storage, session management,
 * and military-grade session binding (IP + User-Agent fingerprinting)
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DatabaseService } from "./supabase.js";
import { encrypt } from "./crypto.js";
import { OAuth2Client } from "google-auth-library";
import { generateSessionFingerprint, generateRotationId } from "./session-guard.js";
import { auditLogger, AUDIT_EVENTS } from "./audit-logger.js";
import { logEvent } from "./logsso";

// Environment validation
if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.NODE_ENV === 'production') {
  const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    console.error(`❌ AUTH ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

// Google OAuth configuration
// NOTE: This app requests Gmail access which requires Google verification
// For development, add test users in Google Cloud Console OAuth consent screen
// For production, submit app for Google verification to remove security warnings
// SCOPE STRATEGY — the 100-user test cap lives on THIS client, and it's the
// Gmail (restricted) scopes that force verification/cap. When Composio carries
// the Gmail grant (COMPOSIO_GMAIL_AUTH_CONFIG_ID set — see lib/boult/composio.ts),
// the account LOGIN requests ONLY identity scopes (openid/email/profile — NON-
// sensitive, NO user cap even in Testing). Gmail is then connected separately
// via Composio's verified client, so no user ever consents to restricted scopes
// on our capped client. Absent the flag, login keeps the full Gmail scopes
// exactly as before — zero change for the current own-client setup.
const COMPOSIO_GMAIL = !!process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID;
const LOGIN_SCOPE = COMPOSIO_GMAIL
  ? "openid email profile"
  : "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify";

const googleProvider = Google({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  authorization: {
    params: {
      access_type: "offline",
      response_type: "code",
      prompt: "consent",
      include_granted_scopes: "false",
      scope: LOGIN_SCOPE
    }
  }
});

// Cookie configuration based on environment
const isProduction = process.env.NODE_ENV === 'production';
const cookiePrefix = isProduction ? '__Secure-' : '';

const cookieConfig = {
  sessionToken: {
    name: `${cookiePrefix}next-auth.session-token`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProduction,
    }
  },
  callbackUrl: {
    name: `${cookiePrefix}next-auth.callback-url`,
    options: {
      sameSite: "lax",
      path: "/",
      secure: isProduction,
    }
  },
  csrfToken: {
    name: `${cookiePrefix}next-auth.csrf-token`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProduction,
    }
  },
  pkceCodeVerifier: {
    name: `${cookiePrefix}next-auth.pkce.code_verifier`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProduction,
      maxAge: 900, // 15 minutes
    }
  },
  state: {
    name: `${cookiePrefix}next-auth.state`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProduction,
      maxAge: 900, // 15 minutes
    }
  }
};

import { cookies } from "next/headers";

/**
 * Persist user tokens and profile to database
 * @param {string} email - User email
 * @param {object} account - OAuth account data
 * @param {object} user - User profile data
 */
async function persistUserData(email, account, user) {
  const db = new DatabaseService();
  const lowerEmail = email.toLowerCase();

  // Get referral from cookie if present
  let referralCode = null;
  try {
    const cookieStore = await cookies();
    referralCode = cookieStore.get('maily_referral')?.value;
  } catch (e) {
    console.log('Referral cookie not accessible in this context');
  }

  try {
    const tokenData = {
      access_token: encrypt(account.access_token),
      expires_in: account.expires_in,
      token_type: account.token_type,
      scopes: account.scope,
      google_email: lowerEmail
    };

    // ONLY store refresh token if it's provided (Google only sends it on first login or if prompted)
    if (account.refresh_token) {
      tokenData.refresh_token = encrypt(account.refresh_token);
    }

    const { data: profile } = await db.supabase
      .from('user_profiles')
      .select('name, picture, avatar_url')
      .eq('user_id', lowerEmail)
      .maybeSingle();

    if (!profile) {
      logEvent({
        channel: 'signups',
        event: '✅ New Signup',
        description: `New user signed up: ${lowerEmail}`,
        user_id: lowerEmail,
        tags: { referralCode }
      });
    }

    // Identity-only logins (One Tap, Composio-login) carry no Google
    // access_token — persist the PROFILE but skip the token row so we never
    // write an encrypt(undefined) into user_tokens. Gmail for these users is
    // resolved through the Composio marker row, not user_tokens.
    const persistOps = [
      db.storeUserProfile(lowerEmail, {
        email: lowerEmail,
        name: profile?.name || user.name,
        picture: profile?.avatar_url || profile?.picture || user.image
      }, referralCode)
    ];
    if (account.access_token) {
      persistOps.push(db.storeUserTokens(lowerEmail, tokenData));
    }
    await Promise.all(persistOps);

    // Record HOW they connected Gmail, straight onto user_profiles, so
    // "signed via Composio" is countable from the users table itself
    // (SELECT gmail_provider, count(*) ... GROUP BY gmail_provider) instead of
    // only being inferable from the encrypted composio: marker in
    // boult_integrations. 'composio-login' is the credentials provider id used
    // by the Composio sign-in; 'google' is our direct OAuth client.
    //
    // Best-effort and NON-FATAL on purpose: it runs after the profile row
    // exists (so it's a plain UPDATE, not a create — new-signup detection in
    // storeUserProfile already ran), and it needs the gmail_provider column
    // (migration user_profiles_gmail_provider.sql). Until that column exists
    // this update just errors and is swallowed — it must never block a login.
    const gmailProvider =
      account?.provider === 'composio-login' ? 'composio' :
      account?.provider === 'google' ? 'google' : null;
    if (gmailProvider) {
      try {
        const { error: gpErr } = await db.supabase
          .from('user_profiles')
          .update({ gmail_provider: gmailProvider })
          .eq('user_id', lowerEmail);
        if (gpErr) console.warn('[auth] gmail_provider stamp skipped:', gpErr.message);
      } catch (e) {
        console.warn('[auth] gmail_provider stamp threw:', e?.message);
      }
    }

    // Referral attribution. Runs AFTER the profile exists, because it writes the
    // friend's free month onto that profile. Deliberately awaited but never
    // allowed to throw: a referral problem must never block a sign-in.
    if (referralCode) {
      try {
        const { attributeSignup } = await import('./referrals');
        const result = await attributeSignup(lowerEmail, referralCode);
        if (result.ok) {
          console.log(`🎁 Referral attributed: ${referralCode} → ${lowerEmail} (free month granted)`);
        } else {
          // Expected outcomes, not errors: self-referral, an unknown code, or a
          // returning user who was already referred once.
          console.log(`[referrals] not attributed (${result.reason}) for ${lowerEmail}`);
        }
      } catch (refErr) {
        console.error('[referrals] attribution threw (sign-in unaffected):', refErr?.message);
      }
    }

    console.log('✅ Auth DB storage complete for:', lowerEmail, referralCode ? `(Ref: ${referralCode})` : '');
    
    // Background task: Generate initial voice profile if they don't have one.
    // Skip when Composio carries Gmail — the login token then has NO Gmail
    // scope, so this fetch would 403. The voice profile is instead generated
    // on-demand after the user connects Gmail via Composio (get_sent_emails /
    // voice_profile_generate through the tool layer's resolved token).
    if (account.access_token && !COMPOSIO_GMAIL) {
      triggerBackgroundVoiceProfile(lowerEmail, account.access_token, account.refresh_token).catch(e => {
        console.error('Background voice profile task failed:', e.message);
      });
    }
  } catch (error) {
    console.error('❌ Auth DB storage error:', error.message);
    // Don't throw - auth should succeed even if DB fails
  }
}

/**
 * Automatically analyze emails to create a voice profile for new users
 */
async function triggerBackgroundVoiceProfile(email, accessToken, refreshToken) {
  try {
    const { voiceProfileService } = await import('./voice-profile-service');
    const { GmailService } = await import('./gmail');

    // Check if they already have a customized profile
    const existing = await voiceProfileService.getVoiceProfile(email);
    if (existing && existing.status !== 'default') {
      return; // Already has a profile
    }

    console.log(`🚀 [Background Task] Starting initial voice profile generation for ${email}`);
    const gmailService = new GmailService(accessToken, refreshToken);
    const sentEmails = await voiceProfileService.fetchSentEmails(gmailService, 40);
    
    if (sentEmails.length >= 3) {
      const profile = await voiceProfileService.analyzeVoiceProfile(sentEmails);
      await voiceProfileService.saveVoiceProfile(email, profile);
      console.log(`✅ [Background Task] Voice profile generated successfully for ${email}`);
    } else {
      console.log(`⚠️ [Background Task] Not enough sent emails to generate profile for ${email}`);
    }
  } catch (e) {
    console.error(`❌ [Background Task] Voice profile generation failed for ${email}:`, e);
  }
}

// NextAuth configuration
console.log('🔐 NextAuth secret check:', {
  AUTH_SECRET: process.env.AUTH_SECRET ? 'set' : 'not set',
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'set' : 'not set',
  NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'not set'
});

console.log('🔐 NextAuth config starting...');
console.log('🔐 Google Provider Config:', {
  clientId: process.env.GOOGLE_CLIENT_ID ? (process.env.GOOGLE_CLIENT_ID.substring(0, 15) + '...') : 'MISSING/UNDEFINED',
  hasSecret: !!process.env.GOOGLE_CLIENT_SECRET
});

let handlers, auth, signIn, signOut;

try {
  const result = NextAuth({
    providers: [
      googleProvider,
      Credentials({
        id: "google-one-tap",
        name: "Google One Tap",
        credentials: {
          credential: { label: "Credential Token", type: "text" },
        },
        async authorize(credentials) {
          if (!credentials?.credential) return null;

          try {
            const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
            const ticket = await client.verifyIdToken({
              idToken: credentials.credential,
              audience: process.env.GOOGLE_CLIENT_ID,
            });

            const payload = ticket.getPayload();
            if (!payload || !payload.email) return null;

            // Normalize user data to match Google provider
            const user = {
              id: payload.sub,
              name: payload.name,
              email: payload.email,
              image: payload.picture,
            };

            // Note: One Tap doesn't provide a refresh_token or access_token for Gmail
            // We only use this for identity. The persistence logic will handle it as a login.
            console.log('🔄 One Tap auth verified for:', user.email);

            return user;
          } catch (error) {
            console.error('❌ One Tap verification failed:', error);
            return null;
          }
        },
      }),
      // COMPOSIO-AS-LOGIN — when Composio is the sole Google touchpoint, the
      // user connects Gmail on Composio's verified client FIRST (no cap, our
      // OAuth client never fires), then the callback route hands us the
      // Composio connected-account id here. We resolve the verified Google
      // identity (userinfo via the connection's access token) and mint the
      // session — same shape as the Google provider, no Gmail token stored
      // locally (the tool layer resolves Gmail through the Composio marker row
      // the callback already wrote).
      Credentials({
        id: "composio-login",
        name: "Composio",
        credentials: {
          accountId: { label: "Composio Account Id", type: "text" },
        },
        async authorize(credentials) {
          const accountId = credentials?.accountId;
          if (!accountId) return null;
          try {
            const { getComposioIdentity } = await import('./boult/composio');
            const identity = await getComposioIdentity(String(accountId));
            if (!identity?.email) return null;
            console.log('🔄 Composio login verified for:', identity.email);
            return {
              id: identity.sub || identity.email,
              name: identity.name || null,
              email: identity.email,
              image: identity.picture || null,
            };
          } catch (error) {
            console.error('❌ Composio login verification failed:', error);
            return null;
          }
        },
      }),
    ],

    session: {
      strategy: 'jwt', // Use JWT for session management
    },

    trustHost: true, // Required for localhost development

    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'build-time-secret-placeholder',

    // Custom pages configuration
    pages: {
      signIn: '/auth/signin',
      error: '/auth/signin', // Redirect to signin on error
    },

    callbacks: {
      /**
       * Redirect callback - control where users go after sign-in
       */
      async redirect({ url, baseUrl }) {
        console.log('🔀 Redirect callback:', { url, baseUrl });

        // Always redirect to /onboarding after sign-in
        // The onboarding page will check if already completed and redirect to /home-feed
        if (url.startsWith(baseUrl)) {
          // If it's our domain, check if it's the root or signin page
          if (url === baseUrl || url === `${baseUrl}/` || url.includes('/auth/')) {
            console.log('🚀 Redirecting to /onboarding');
            return `${baseUrl}/onboarding`;
          }
          // If explicitly going somewhere else (like /onboarding), allow it
          return url;
        }

        // Default to onboarding for any other case
        return `${baseUrl}/onboarding`;
      },

      /**
       * JWT callback - handle token storage and user data persistence
       */
      async jwt({ token, account, user, trigger, session: newSession }) {
        if (account && user?.email) {
          const lowerEmail = user.email.toLowerCase();
          console.log('🚀 GOOGLE AUTH SUCCESS:', lowerEmail);
          console.log('📋 Account data:', {
            provider: account.provider,
            type: account.type,
            access_token: account.access_token ? 'present' : 'missing',
            refresh_token: account.refresh_token ? 'present' : 'missing',
            expires_in: account.expires_in
          });
          
          // Store tokens in JWT
          token.accessToken = account.access_token;
          token.refreshToken = account.refresh_token;
          token.email = lowerEmail; // Normalize email in token

          // Session binding — store fingerprint and token metadata
          token.accessTokenIssuedAt = Date.now();
          token.rotationId = generateRotationId();
          token.sessionCreatedAt = new Date().toISOString();

          // Persist to database asynchronously
          persistUserData(lowerEmail, account, user);

          // Audit log: login event (non-blocking)
          auditLogger.log(lowerEmail, AUDIT_EVENTS.AUTH_LOGIN, {
            provider: account.provider,
            type: account.type
          }).catch(() => {});
        }

        // IMPORTANT: Always fetch latest name/picture from DB to ensure UI sync
        // especially after updates in SettingsCard
        if (token.email) {
          try {
            const db = new DatabaseService();
            const { data: profile } = await db.supabase
              .from('user_profiles')
              .select('name, username, avatar_url, picture')
              .eq('user_id', String(token.email).toLowerCase())
              .maybeSingle();
            
            if (profile) {
              token.name = profile.name || token.name;
              token.picture = profile.avatar_url || profile.picture || token.picture;
              token.username = profile.username;
            }
          } catch (e) {
            console.error('Error fetching profile in JWT:', e);
          }
        }

        return token;
      },

      /**
       * Session callback - expose tokens to client session
       */
      async session({ session, token }) {
        if (token) {
          session.accessToken = token.accessToken;
          session.refreshToken = token.refreshToken;
          if (token.name) {
            session.user.name = token.name;
          }
          if (token.picture) {
            session.user.image = token.picture;
          }
          if (token.username) {
            session.user.username = token.username;
          }
        }
        return session;
      },
    },

    cookies: cookieConfig,
  });

  ({ handlers, auth, signIn, signOut } = result);
} catch (error) {
  console.error('❌ NextAuth config error:', error);
  throw error;
}

const authOptions = {
  providers: [googleProvider],
  callbacks: {
    jwt: async ({ token, account, user }) => token,
    session: async ({ session, token }) => session,
  }
};

export { handlers, auth, signIn, signOut, authOptions };