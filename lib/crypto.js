/**
 * Server-Side Encryption Module — Maily Vault
 * 
 * v1: AES-256-CBC with fixed IV (legacy, read-only support)
 * v2: AES-256-CBC with random IV (current)
 * v3: AES-256-GCM with random IV + authentication tag (military-grade)
 * 
 * New encryptions use v3 (GCM). Decryption supports all versions
 * for backward compatibility. GCM provides authenticated encryption,
 * meaning tampered ciphertext is automatically detected and rejected.
 */

import crypto from 'crypto';

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const PREFIX_V3 = 'enc:v3:';     // AES-256-GCM (new default)
const PREFIX_V2 = 'enc:v2:';     // AES-256-CBC with random IV
const OLD_PREFIX = 'enc:';       // AES-256-CBC with fixed IV (legacy)
const GCM_IV_LENGTH = 12;        // 96 bits recommended for GCM
const GCM_AUTH_TAG_LENGTH = 16;  // 128-bit auth tag

function getKey() {
  const secret = process.env.ENCRYPTION_KEY || 'default-maily-secure-key-2025';
  return crypto.scryptSync(secret, 'maily-salt-v1', 32);
}

/**
 * Encrypt text using AES-256-GCM (v3).
 * Provides both confidentiality and integrity/authentication.
 */
export function encrypt(text) {
  if (text === null || text === undefined) return text;
  if (typeof text !== 'string') text = String(text);
  if (text.startsWith(PREFIX_V3) || text.startsWith(PREFIX_V2)) return text;

  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, getKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: enc:v3:IV_HEX:AUTH_TAG_HEX:ENCRYPTED_HEX
  return `${PREFIX_V3}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt text — supports v3 (GCM), v2 (CBC+random IV), v1 (CBC+fixed IV).
 */
export function decrypt(text) {
  if (!text || typeof text !== 'string') return text;
  
  // v3: AES-256-GCM (authenticated encryption)
  if (text.startsWith(PREFIX_V3)) {
    try {
      const parts = text.substring(PREFIX_V3.length).split(':');
      if (parts.length !== 3) return text;
      
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      
      const decipher = crypto.createDecipheriv(GCM_ALGORITHM, getKey(), iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption v3 (GCM) failed:', error.message);
      return text;
    }
  }

  // v2: AES-256-CBC with random IV
  if (text.startsWith(PREFIX_V2)) {
    try {
      const parts = text.substring(PREFIX_V2.length).split(':');
      if (parts.length !== 2) return text;
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv(CBC_ALGORITHM, getKey(), iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption v2 failed:', error.message);
      return text;
    }
  }

  // v1: AES-256-CBC with fixed IV (legacy)
  if (text.startsWith(OLD_PREFIX)) {
    try {
      const fixedIv = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
      const encrypted = text.substring(OLD_PREFIX.length);
      const decipher = crypto.createDecipheriv(CBC_ALGORITHM, getKey(), fixedIv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Decryption v1 failed:', error.message);
      return text;
    }
  }

  return text;
}

/**
 * Check if text is encrypted (any version).
 */
export function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  return text.startsWith(PREFIX_V3) || text.startsWith(PREFIX_V2) || text.startsWith(OLD_PREFIX);
}

/**
 * Get the encryption version of a string.
 */
export function getEncryptionVersion(text) {
  if (!text || typeof text !== 'string') return null;
  if (text.startsWith(PREFIX_V3)) return 'v3';
  if (text.startsWith(PREFIX_V2)) return 'v2';
  if (text.startsWith(OLD_PREFIX)) return 'v1';
  return null;
}
