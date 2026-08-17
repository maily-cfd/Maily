/**
 * Connector Service
 * 
 * Manages OAuth flows, token refresh, and API interactions for all connectors.
 * Integrates with the Connector Registry and database.
 */

import crypto from 'crypto';
import { CredentialManager } from './boult-credential-manager.js';
import {
  CONNECTOR_REGISTRY,
  CONNECTOR_STATUS,
  getConnector,
  getOAuthUrl
} from './boult-connector-registry.js';

export class ConnectorService {
  constructor({ db, supabase }) {
    this.db = db;
    this.supabase = supabase;
    this.credentialManager = new CredentialManager({ supabase });
    this.tokenRefreshIntervals = new Map();
  }

  /**
   * Initialize OAuth flow for a connector
   */
  async initiateOAuth(userId, connectorId, redirectUri) {
    const connector = getConnector(connectorId);
    if (!connector) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    // Generate state
    const state = crypto.randomBytes(32).toString('hex');

    // Create session
    const { data: session, error } = await this.supabase
      .from('connector_sessions')
      .insert({
        user_id: userId,
        connector_id: connectorId,
        provider: connector.provider,
        state: state,
        code_verifier: codeVerifier,
        pkce_code_challenge: codeChallenge,
        requested_scopes: connector.oauth.scopes,
        status: 'pending',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
      })
      .select()
      .single();

    if (error) throw error;

    // Build OAuth URL with PKCE
    const oauthUrl = getOAuthUrl(connectorId, redirectUri, state);
    if (!oauthUrl) {
      throw new Error('Failed to build OAuth URL');
    }

    // Add PKCE parameters
    const url = new URL(oauthUrl);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return {
      sessionId: session.id,
      oauthUrl: url.toString(),
      state: state
    };
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(state, code, redirectUri) {
    // Find session
    const { data: session, error: sessionError } = await this.supabase
      .from('connector_sessions')
      .select('*')
      .eq('state', state)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      throw new Error('Invalid or expired session');
    }

    const connector = getConnector(session.connector_id);
    if (!connector) {
      throw new Error('Connector not found');
    }

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(
        connector,
        code,
        redirectUri,
        session.code_verifier
      );

      // Get user info from provider
      const userInfo = await this.getUserInfo(connector, tokens.access_token);

      // Encrypt tokens before storing
      const encryptedAccessToken = this.credentialManager.encrypt(tokens.access_token);
      const encryptedRefreshToken = tokens.refresh_token 
        ? this.credentialManager.encrypt(tokens.refresh_token) 
        : null;

      // Create or update connected account with encrypted tokens
      const { data: account, error: accountError } = await this.supabase
        .from('connected_accounts')
        .upsert({
          user_id: session.user_id,
          connector_id: session.connector_id,
          provider: connector.provider,
          status: CONNECTOR_STATUS.CONNECTED,
          access_token_encrypted: encryptedAccessToken,
          refresh_token_encrypted: encryptedRefreshToken,
          token_expires_at: tokens.expires_at,
          email: userInfo.email,
          name: userInfo.name,
          profile_picture: userInfo.picture,
          external_user_id: userInfo.id,
          scopes: tokens.scopes || connector.oauth.scopes,
          connected_at: new Date().toISOString(),
          settings: {}
        }, {
          onConflict: 'user_id,connector_id,email'
        })
        .select()
        .single();

      if (accountError) throw accountError;

      // Update session
      await this.supabase
        .from('connector_sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result_account_id: account.id
        })
        .eq('id', session.id);

      // Set up token refresh
      this.scheduleTokenRefresh(account.id, connector, tokens);

      return {
        success: true,
        account: {
          id: account.id,
          connectorId: account.connector_id,
          email: account.email,
          name: account.name,
          status: account.status
        }
      };

    } catch (error) {
      // Update session with error
      await this.supabase
        .from('connector_sessions')
        .update({
          status: 'failed',
          error_message: error.message
        })
        .eq('id', session.id);

      throw error;
    }
  }

  /**
   * Exchange authorization code for access token
   * Handles provider-specific OAuth requirements (Notion uses Basic Auth)
   */
  async exchangeCodeForTokens(connector, code, redirectUri, codeVerifier) {
    const clientId = process.env[`${connector.provider.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`${connector.provider.toUpperCase()}_CLIENT_SECRET`];

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      ...(codeVerifier && { code_verifier: codeVerifier }),
      // Notion requires client_id in body even with Basic Auth
      ...(connector.provider === 'notion' && { client_id: clientId })
    });

    // Prepare headers - Notion uses Basic Auth
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    };

    // Notion requires Basic Auth with base64 encoded client_id:client_secret
    if (connector.provider === 'notion') {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await fetch(connector.oauth.tokenEndpoint, {
      method: 'POST',
      headers,
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in 
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null,
      scopes: data.scope?.split(' ') || []
    };
  }

  /**
   * Get user info from provider
   */
  async getUserInfo(connector, accessToken) {
    const endpoints = {
      google: 'https://www.googleapis.com/oauth2/v2/userinfo',
      microsoft: 'https://graph.microsoft.com/v1.0/me',
      github: 'https://api.github.com/user',
      slack: 'https://slack.com/api/users.identity',
      notion: 'https://api.notion.com/v1/users/me'
    };

    const endpoint = endpoints[connector.provider];
    if (!endpoint) {
      // Return minimal info for providers without userinfo endpoint
      return { id: 'unknown', email: null, name: null };
    }

    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const data = await response.json();

    // Normalize user info across providers
    return {
      id: data.id || data.sub,
      email: data.email || data.user?.email || data.mail,
      name: data.name || data.displayName,
      picture: data.picture || data.avatar_url || data.profile?.image_72
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(accountId) {
    const { data: account, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      throw new Error('Account not found');
    }

    const connector = getConnector(account.connector_id);
    if (!connector) {
      throw new Error('Connector not found');
    }

    if (!account.refresh_token) {
      throw new Error('No refresh token available');
    }

    const clientId = process.env[`${connector.provider.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`${connector.provider.toUpperCase()}_CLIENT_SECRET`];

    // Decrypt refresh token before using
    const decryptedRefreshToken = account.refresh_token_encrypted
      ? this.credentialManager.decrypt(account.refresh_token_encrypted)
      : null;

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decryptedRefreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });

    const response = await fetch(connector.oauth.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString()
    });

    if (!response.ok) {
      // Mark account as expired if refresh fails
      await this.supabase
        .from('connected_accounts')
        .update({
          status: CONNECTOR_STATUS.EXPIRED,
          last_error: 'Token refresh failed',
          error_count: (account.error_count || 0) + 1
        })
        .eq('id', accountId);

      throw new Error('Token refresh failed');
    }

    const data = await response.json();

    // Encrypt new tokens
    const newEncryptedAccessToken = this.credentialManager.encrypt(data.access_token);
    const newEncryptedRefreshToken = data.refresh_token 
      ? this.credentialManager.encrypt(data.refresh_token)
      : account.refresh_token_encrypted;

    // Update account with new encrypted tokens
    await this.supabase
      .from('connected_accounts')
      .update({
        access_token_encrypted: newEncryptedAccessToken,
        refresh_token_encrypted: newEncryptedRefreshToken,
        token_expires_at: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : null,
        status: CONNECTOR_STATUS.CONNECTED,
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId);

    return {
      access_token: data.access_token,
      expires_at: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null
    };
  }

  /**
   * Schedule automatic token refresh
   */
  scheduleTokenRefresh(accountId, connector, tokens) {
    // Clear existing interval
    if (this.tokenRefreshIntervals.has(accountId)) {
      clearInterval(this.tokenRefreshIntervals.get(accountId));
    }

    // Calculate refresh time (5 minutes before expiry)
    if (!tokens.expires_at) return;

    const expiresAt = new Date(tokens.expires_at).getTime();
    const refreshAt = expiresAt - 5 * 60 * 1000; // 5 minutes before
    const delay = refreshAt - Date.now();

    if (delay <= 0) {
      // Token is about to expire, refresh now
      this.refreshToken(accountId).catch(console.error);
      return;
    }

    // Schedule refresh
    const interval = setTimeout(() => {
      this.refreshToken(accountId).catch(error => {
        console.error(`Token refresh failed for account ${accountId}:`, error);
      });
    }, delay);

    this.tokenRefreshIntervals.set(accountId, interval);
  }

  /**
   * Disconnect an account
   */
  async disconnectAccount(accountId, userId) {
    // Get account info before disconnecting
    const { data: account, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (error || !account) {
      throw new Error('Account not found');
    }

    const connector = getConnector(account.connector_id);

    // Revoke token with provider (best effort)
    if (connector?.oauth.revokeEndpoint && account.access_token) {
      try {
        await fetch(connector.oauth.revokeEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            token: account.access_token,
            client_id: process.env[`${connector.provider.toUpperCase()}_CLIENT_ID`]
          }).toString()
        });
      } catch (err) {
        console.error('Token revocation failed:', err);
      }
    }

    // Clear refresh interval
    if (this.tokenRefreshIntervals.has(accountId)) {
      clearTimeout(this.tokenRefreshIntervals.get(accountId));
      this.tokenRefreshIntervals.delete(accountId);
    }

    // Use the database function to properly disconnect
    const { data: result, error: disconnectError } = await this.supabase
      .rpc('revoke_connector_access', {
        p_account_id: accountId,
        p_user_id: userId
      });

    if (disconnectError) throw disconnectError;

    return { success: true };
  }

  /**
   * Get user's connected accounts
   */
  async getUserAccounts(userId) {
    const { data: accounts, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('connected_at', { ascending: false });

    if (error) throw error;

    return accounts || [];
  }

  /**
   * Get access token for an account (with auto-refresh)
   */
  async getAccessToken(accountId, userId) {
    const { data: account, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (error || !account) {
      throw new Error('Account not found');
    }

    // Check if token needs refresh
    if (account.token_expires_at) {
      const expiresAt = new Date(account.token_expires_at).getTime();
      if (expiresAt - Date.now() < 5 * 60 * 1000) {
        // Token expires in less than 5 minutes, refresh it
        const refreshed = await this.refreshToken(accountId);
        return refreshed.access_token;
      }
    }

    // Decrypt and return access token
    if (account.access_token_encrypted) {
      return this.credentialManager.decrypt(account.access_token_encrypted);
    }

    throw new Error('No access token available');
  }

  /**
   * Log connector usage
   */
  async logUsage(accountId, action, actionType, success, metadata = {}) {
    const { data: account } = await this.supabase
      .from('connected_accounts')
      .select('user_id, connector_id')
      .eq('id', accountId)
      .single();

    await this.supabase
      .from('connector_usage_log')
      .insert({
        account_id: accountId,
        connector_id: account?.connector_id,
        user_id: account?.user_id,
        action: action,
        action_type: actionType,
        success: success,
        started_at: metadata.startedAt,
        completed_at: metadata.completedAt,
        duration_ms: metadata.duration,
        request_payload: metadata.request,
        response_payload: metadata.response,
        error_message: metadata.error,
        error_code: metadata.errorCode
      });

    // Update last_used_at on account
    await this.supabase
      .from('connected_accounts')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', accountId);
  }

  /**
   * Generate PKCE code verifier
   */
  generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge
   */
  generateCodeChallenge(verifier) {
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }
}

export default ConnectorService;
