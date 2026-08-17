/**
 * Boult Credential Manager
 * 
 * Secure API key and token management:
 * - AES-256-GCM encryption for tokens at rest
 * - Key rotation support
 * - Secure retrieval with access logging
 * - Automatic token refresh scheduling
 * - Credential validation
 */

import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class CredentialManager {
  constructor(options = {}) {
    // Master encryption key from environment
    this.masterKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!this.masterKey) {
      console.warn('[CredentialManager] No encryption key set - credentials will not be encrypted!');
    }
    
    this.db = options.db;
    this.supabase = options.supabase;
  }

  /**
   * Derive encryption key from master key
   */
  deriveKey(salt) {
    if (!this.masterKey) {
      throw new Error('No master encryption key configured');
    }
    
    return crypto.pbkdf2Sync(
      this.masterKey,
      salt,
      100000, // iterations
      KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Encrypt a credential value
   */
  encrypt(plaintext) {
    if (!this.masterKey) {
      // Fallback: return plaintext with marker (NOT for production)
      return `UNENCRYPTED:${plaintext}`;
    }

    try {
      // Generate salt and IV
      const salt = crypto.randomBytes(IV_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);
      
      // Derive key
      const key = this.deriveKey(salt);
      
      // Create cipher
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
      
      // Encrypt
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get auth tag
      const authTag = cipher.getAuthTag();
      
      // Combine: salt + iv + authTag + encrypted
      const combined = Buffer.concat([
        salt,
        iv,
        authTag,
        Buffer.from(encrypted, 'hex')
      ]);
      
      return combined.toString('base64');
    } catch (error) {
      console.error('[CredentialManager] Encryption failed:', error);
      throw new Error('Failed to encrypt credential');
    }
  }

  /**
   * Decrypt a credential value
   */
  decrypt(ciphertext) {
    if (!this.masterKey) {
      // Check if unencrypted marker
      if (ciphertext.startsWith('UNENCRYPTED:')) {
        return ciphertext.slice('UNENCRYPTED:'.length);
      }
      throw new Error('No master encryption key configured');
    }

    try {
      // Decode from base64
      const combined = Buffer.from(ciphertext, 'base64');
      
      // Extract components
      const salt = combined.slice(0, IV_LENGTH);
      const iv = combined.slice(IV_LENGTH, IV_LENGTH * 2);
      const authTag = combined.slice(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH);
      const encrypted = combined.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH);
      
      // Derive key
      const key = this.deriveKey(salt);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      console.error('[CredentialManager] Decryption failed:', error);
      throw new Error('Failed to decrypt credential - invalid key or corrupted data');
    }
  }

  /**
   * Store encrypted credentials for a connected account
   */
  async storeCredentials(accountId, credentials) {
    const { accessToken, refreshToken, ...metadata } = credentials;
    
    // Encrypt tokens
    const encryptedAccessToken = accessToken ? this.encrypt(accessToken) : null;
    const encryptedRefreshToken = refreshToken ? this.encrypt(refreshToken) : null;
    
    // Store in database
    const { error } = await this.supabase
      .from('connected_accounts')
      .update({
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: metadata.expiresAt,
        scopes: metadata.scopes || [],
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId);
    
    if (error) {
      console.error('[CredentialManager] Failed to store credentials:', error);
      throw new Error('Failed to store credentials');
    }
    
    // Log audit
    await this.logCredentialAction(accountId, 'store', null);
    
    return { success: true };
  }

  /**
   * Retrieve and decrypt credentials
   */
  async retrieveCredentials(accountId, userId) {
    // Fetch from database
    const { data: account, error } = await this.supabase
      .from('connected_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();
    
    if (error || !account) {
      throw new Error('Account not found');
    }
    
    // Decrypt tokens
    let accessToken = null;
    let refreshToken = null;
    
    try {
      if (account.access_token_encrypted) {
        accessToken = this.decrypt(account.access_token_encrypted);
      }
      if (account.refresh_token_encrypted) {
        refreshToken = this.decrypt(account.refresh_token_encrypted);
      }
    } catch (error) {
      console.error('[CredentialManager] Failed to decrypt credentials:', error);
      throw new Error('Failed to decrypt credentials');
    }
    
    // Log access
    await this.logCredentialAction(accountId, 'retrieve', null);
    
    return {
      accountId: account.id,
      connectorId: account.connector_id,
      provider: account.provider,
      accessToken,
      refreshToken,
      expiresAt: account.token_expires_at,
      scopes: account.scopes,
      email: account.email
    };
  }

  /**
   * Validate credentials (check if access token is valid)
   */
  async validateCredentials(accountId, userId) {
    try {
      const credentials = await this.retrieveCredentials(accountId, userId);
      
      // Check if expired
      if (credentials.expiresAt && new Date(credentials.expiresAt) < new Date()) {
        return { valid: false, reason: 'expired', needsRefresh: true };
      }
      
      // Check if token exists
      if (!credentials.accessToken) {
        return { valid: false, reason: 'missing_token', needsRefresh: !!credentials.refreshToken };
      }
      
      // Validate with provider (provider-specific)
      const isValid = await this.validateWithProvider(
        credentials.provider,
        credentials.accessToken
      );
      
      if (!isValid) {
        return { valid: false, reason: 'invalid_token', needsRefresh: !!credentials.refreshToken };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Validate token with provider
   */
  async validateWithProvider(provider, accessToken) {
    // Provider-specific validation
    const validationEndpoints = {
      google: 'https://oauth2.googleapis.com/tokeninfo',
      calcom: 'https://api.cal.com/v2/me',
      notion: 'https://api.notion.com/v1/users/me'
    };
    
    const endpoint = validationEndpoints[provider];
    if (!endpoint) {
      // For unknown providers, assume valid
      return true;
    }
    
    try {
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Rotate encryption key for an account
   */
  async rotateKey(accountId, userId) {
    // Retrieve with old key
    const credentials = await this.retrieveCredentials(accountId, userId);
    
    // Re-encrypt with new key (master key may have changed)
    await this.storeCredentials(accountId, {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
      scopes: credentials.scopes
    });
    
    await this.logCredentialAction(accountId, 'rotate', null);
    
    return { success: true };
  }

  /**
   * Log credential action for audit
   */
  async logCredentialAction(accountId, action, metadata) {
    try {
      await this.supabase
        .from('audit_log')
        .insert({
          event_type: 'credential_action',
          event_category: action,
          payload: {
            account_id: accountId,
            ...metadata
          }
        });
    } catch (error) {
      console.error('[CredentialManager] Failed to log action:', error);
    }
  }

  /**
   * Cleanup expired credentials
   */
  async cleanupExpiredCredentials(beforeDate) {
    const { data, error } = await this.supabase
      .from('connected_accounts')
      .update({
        status: 'expired',
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        updated_at: new Date().toISOString()
      })
      .lt('token_expires_at', beforeDate.toISOString())
      .eq('status', 'connected')
      .select('id');
    
    if (error) {
      console.error('[CredentialManager] Cleanup failed:', error);
      return 0;
    }
    
    return data?.length || 0;
  }
}

export default CredentialManager;
