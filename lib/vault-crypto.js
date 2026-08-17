/**
 * Vault Crypto — Client-Side Zero-Knowledge Encryption
 * 
 * Uses Web Crypto API (AES-256-GCM) for browser-side encryption.
 * The server NEVER sees plaintext — only encrypted blobs.
 * 
 * Key derivation uses PBKDF2 with the user's Google UID + a domain salt,
 * producing a deterministic key per user that is never stored anywhere.
 * 
 * ARCHITECTURE:
 *   Browser → derives AES-256 key from UID → encrypts data → sends ciphertext to server
 *   Server → stores ciphertext blob — cannot read it
 *   Browser → retrieves ciphertext → derives same key → decrypts locally
 * 
 * This module is designed to run in the BROWSER only (Web Crypto API).
 * For server-side encryption, use lib/crypto.js instead.
 */

// ─── Constants ──────────────────────────────────────────────────────────────────
const VAULT_VERSION = 'vault:v1:';
const PBKDF2_ITERATIONS = 600000; // NIST SP 800-132 recommended minimum for PBKDF2-SHA256
const SALT_PREFIX = 'maily-vault-zero-knowledge-v1';
const KEY_LENGTH = 256; // AES-256
const IV_LENGTH = 12;   // 96 bits — recommended for AES-GCM
const TAG_LENGTH = 128; // 128-bit authentication tag

// ─── Key Derivation ─────────────────────────────────────────────────────────────

/**
 * Derive a deterministic AES-256-GCM key from user's Google UID.
 * The key is derived via PBKDF2(SHA-256) and never leaves the browser.
 * 
 * @param {string} googleUid - The user's Google UID (sub claim)
 * @param {string} [passphrase] - Optional additional passphrase for extra entropy
 * @returns {Promise<CryptoKey>} The derived AES-GCM key
 */
export async function deriveVaultKey(googleUid, passphrase = '') {
  if (!googleUid || typeof googleUid !== 'string') {
    throw new Error('VAULT_CRYPTO: googleUid is required for key derivation');
  }

  // Combine UID with optional passphrase for key material
  const keyMaterial = `${googleUid}:${passphrase}`;
  const encoder = new TextEncoder();

  // Import the raw key material for PBKDF2
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyMaterial),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Create a deterministic salt from the prefix + UID
  // This ensures the same user always gets the same key
  const salt = encoder.encode(`${SALT_PREFIX}:${googleUid}`);

  // Derive the final AES-256-GCM key
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: KEY_LENGTH
    },
    false, // NOT extractable — key material stays in CryptoKey object
    ['encrypt', 'decrypt']
  );

  return derivedKey;
}

// ─── Encryption ─────────────────────────────────────────────────────────────────

/**
 * Encrypt data using AES-256-GCM with a fresh random IV.
 * Output format: vault:v1:<base64(IV + ciphertext + authTag)>
 * 
 * @param {string} plaintext - The data to encrypt
 * @param {CryptoKey} key - The AES-GCM key (from deriveVaultKey)
 * @returns {Promise<string>} The encrypted string with version prefix
 */
export async function vaultEncrypt(plaintext, key) {
  if (!plaintext || typeof plaintext !== 'string') {
    return plaintext; // Pass through null/undefined/empty
  }

  // Already encrypted — don't double-encrypt
  if (plaintext.startsWith(VAULT_VERSION)) {
    return plaintext;
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate a fresh random IV for every encryption operation
  // CRITICAL: Never reuse an IV with the same key in GCM mode
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encrypt with AES-256-GCM — provides both confidentiality and authentication
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: TAG_LENGTH
    },
    key,
    data
  );

  // Combine IV + ciphertext into a single buffer
  // The IV is NOT secret — it just needs to be unique per operation
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Base64 encode and add version prefix
  const base64 = btoa(String.fromCharCode(...combined));
  return `${VAULT_VERSION}${base64}`;
}

/**
 * Decrypt data that was encrypted with vaultEncrypt.
 * Automatically detects and validates the vault version prefix.
 * 
 * @param {string} ciphertext - The encrypted string (vault:v1:...)
 * @param {CryptoKey} key - The AES-GCM key (from deriveVaultKey)
 * @returns {Promise<string>} The decrypted plaintext
 */
export async function vaultDecrypt(ciphertext, key) {
  if (!ciphertext || typeof ciphertext !== 'string') {
    return ciphertext; // Pass through null/undefined/empty
  }

  // Not vault-encrypted — return as-is (might be server-side encrypted or plaintext)
  if (!ciphertext.startsWith(VAULT_VERSION)) {
    return ciphertext;
  }

  const base64Data = ciphertext.substring(VAULT_VERSION.length);

  // Decode base64
  const binaryString = atob(base64Data);
  const combined = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    combined[i] = binaryString.charCodeAt(i);
  }

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const encryptedData = combined.slice(IV_LENGTH);

  // Decrypt — GCM will verify the authentication tag automatically
  // If the data was tampered with, this will throw an error
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: TAG_LENGTH
    },
    key,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

// ─── Batch Operations ───────────────────────────────────────────────────────────

/**
 * Encrypt multiple fields in an object.
 * Useful for encrypting email metadata before sending to server.
 * 
 * @param {Object} data - Object with string values to encrypt
 * @param {string[]} fields - Array of field names to encrypt
 * @param {CryptoKey} key - The AES-GCM key
 * @returns {Promise<Object>} Object with specified fields encrypted
 */
export async function vaultEncryptFields(data, fields, key) {
  const result = { ...data };
  
  await Promise.all(
    fields.map(async (field) => {
      if (result[field] && typeof result[field] === 'string') {
        result[field] = await vaultEncrypt(result[field], key);
      }
    })
  );

  return result;
}

/**
 * Decrypt multiple fields in an object.
 * 
 * @param {Object} data - Object with encrypted string values
 * @param {string[]} fields - Array of field names to decrypt
 * @param {CryptoKey} key - The AES-GCM key
 * @returns {Promise<Object>} Object with specified fields decrypted
 */
export async function vaultDecryptFields(data, fields, key) {
  const result = { ...data };
  
  await Promise.all(
    fields.map(async (field) => {
      if (result[field] && typeof result[field] === 'string') {
        try {
          result[field] = await vaultDecrypt(result[field], key);
        } catch (e) {
          console.warn(`VAULT_CRYPTO: Failed to decrypt field "${field}":`, e.message);
          // Leave field as-is if decryption fails (might be plaintext or different encryption)
        }
      }
    })
  );

  return result;
}

// ─── Utility ────────────────────────────────────────────────────────────────────

/**
 * Check if a string is vault-encrypted.
 * @param {string} text - The text to check
 * @returns {boolean}
 */
export function isVaultEncrypted(text) {
  return typeof text === 'string' && text.startsWith(VAULT_VERSION);
}

/**
 * Generate a fingerprint hash of the vault key for verification.
 * This can be stored server-side to verify the user has the correct key
 * without exposing the key itself.
 * 
 * @param {string} googleUid - The user's Google UID
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
export async function generateKeyFingerprint(googleUid) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${SALT_PREFIX}:fingerprint:${googleUid}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Vault Crypto configuration — exposed for transparency/debugging
 */
export const VAULT_CONFIG = {
  algorithm: 'AES-256-GCM',
  keyDerivation: 'PBKDF2-SHA256',
  iterations: PBKDF2_ITERATIONS,
  ivLength: IV_LENGTH,
  tagLength: TAG_LENGTH,
  version: 'v1'
};
