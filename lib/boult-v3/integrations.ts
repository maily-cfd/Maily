import { getSupabaseAdmin } from '../supabase.js';
import { decrypt, encrypt } from '../crypto.js';

/**
 * Resolves all connected integrations for a user, combining:
 * 1. boult_integrations (V3 OAuth flows)
 * 2. integration_credentials (legacy V2 OAuth flows)
 * 3. user_tokens (Google login/NextAuth flow)
 *
 * All access tokens and refresh tokens are normalized and returned in the V3 schema format.
 */
export async function getV3Integrations(userId: string): Promise<any[]> {
  try {
    const supabase = getSupabaseAdmin();
    const uid = userId.toLowerCase();

    // 1. Fetch from boult_integrations (modern flow)
    const { data: boultData } = await supabase
      .from('boult_integrations')
      .select('*')
      .eq('user_id', uid);

    const integrations: any[] = boultData ? [...boultData] : [];

    const hasProvider = (p: string) => integrations.some(i => i.provider === p);

    // 2. Fetch from integration_credentials (legacy flow)
    const { data: legacyData } = await supabase
      .from('integration_credentials')
      .select('*')
      .eq('user_id', uid);

    if (legacyData) {
      for (const row of legacyData) {
        const rawProvider = row.provider as string;
        let mappedProviders: string[] = [];

        if (rawProvider === 'google') {
          mappedProviders = ['gmail', 'gcal'];
        } else if (rawProvider === 'google_calendar') {
          mappedProviders = ['gcal'];
        } else {
          mappedProviders = [rawProvider];
        }

        for (const provider of mappedProviders) {
          if (!hasProvider(provider)) {
            // Reconstruct access/refresh tokens.
            // Use existing encrypted values if present; fallback to raw (encrypted on-the-fly) if needed.
            let accessToken = row.encrypted_access_token;
            if (!accessToken && row.access_token) {
              accessToken = encrypt(row.access_token);
            }

            let refreshToken = row.encrypted_refresh_token;
            if (!refreshToken && row.refresh_token) {
              refreshToken = encrypt(row.refresh_token);
            }

            if (accessToken) {
              integrations.push({
                user_id: uid,
                provider,
                access_token: accessToken,
                refresh_token: refreshToken,
                scopes: row.scopes || [],
                expires_at: row.expires_at || null,
                workspace_info: row.workspace_info || {},
                updated_at: row.updated_at || new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    // 3. Fetch from user_tokens (Google NextAuth login credentials)
    const { data: ut } = await supabase
      .from('user_tokens')
      .select('*')
      .or(`user_id.ilike."${uid}",google_email.ilike."${uid}"`)
      .maybeSingle();

    if (ut) {
      const providers = ['gmail', 'gcal'];
      for (const provider of providers) {
        if (!hasProvider(provider)) {
          const accessToken = ut.encrypted_access_token;
          const refreshToken = ut.encrypted_refresh_token;

          if (accessToken) {
            integrations.push({
              user_id: uid,
              provider,
              access_token: accessToken,
              refresh_token: refreshToken,
              scopes: ut.scopes || [],
              expires_at: ut.access_token_expires_at || null,
              workspace_info: {},
              updated_at: ut.updated_at || new Date().toISOString(),
            });
          }
        }
      }
    }

    return integrations;
  } catch (error) {
    console.error('[Boult V3] Error fetching combined integrations:', error);
    return [];
  }
}

/**
 * Resolves a single decrypted access token for a user and provider.
 */
export async function getToken(userId: string, provider: string): Promise<string | null> {
  try {
    const integrations = await getV3Integrations(userId);
    const integration = integrations.find(i => i.provider === provider);
    if (!integration?.access_token) return null;
    return decrypt(integration.access_token);
  } catch {
    return null;
  }
}

/**
 * Resolves decrypted access and refresh token pair for a user and provider.
 */
export async function getTokenPair(
  userId: string,
  provider: string
): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  try {
    const integrations = await getV3Integrations(userId);
    const integration = integrations.find(i => i.provider === provider);
    if (!integration?.access_token) return null;
    return {
      accessToken: decrypt(integration.access_token),
      refreshToken: integration.refresh_token ? decrypt(integration.refresh_token) : null,
    };
  } catch {
    return null;
  }
}
