/**
 * F5.5 — Safe localStorage wrapper.
 *
 * Browser localStorage caps at ~5-10MB depending on browser. ChatInterface
 * persists 35+ items including conversation message arrays — a long
 * conversation could throw QuotaExceededError on setItem, breaking message
 * persistence silently.
 *
 * This wrapper:
 *   - Catches QuotaExceededError
 *   - Evicts the oldest conversation_* entry on overflow
 *   - Retries the write once
 *   - Falls back to a no-op + console.warn if still failing
 *
 * Drop-in replacements for window.localStorage.setItem / getItem.
 */

const CONVERSATION_PREFIX = 'conversation_';

function isQuotaError(err: any): boolean {
  if (!err) return false;
  return (
    err.code === 22 ||
    err.code === 1014 || // Firefox
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
    /quota/i.test(String(err.message || ''))
  );
}

/**
 * Evict the oldest conversation_* entry by lastUpdated timestamp.
 * Returns true if an eviction happened.
 */
function evictOldestConversation(): boolean {
  try {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CONVERSATION_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const t = parsed?.lastUpdated ? Date.parse(parsed.lastUpdated) : 0;
        if (t < oldestTime) {
          oldestTime = t;
          oldestKey = key;
        }
      } catch { /* skip unparseable */ }
    }
    if (oldestKey) {
      localStorage.removeItem(oldestKey);
      console.warn(`[Boult:Quota] Evicted oldest conversation: ${oldestKey}`);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn('[Boult:Storage] setItem failed (non-quota):', err);
      return false;
    }
    // Quota exceeded — try evicting oldest conversation and retry once.
    const evicted = evictOldestConversation();
    if (!evicted) {
      console.warn('[Boult:Storage] Quota exceeded, no conversation to evict');
      return false;
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (retryErr) {
      console.warn('[Boult:Storage] Retry after eviction also failed:', retryErr);
      return false;
    }
  }
}

export function safeGetItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn('[Boult:Storage] getItem failed:', err);
    return null;
  }
}

export function safeRemoveItem(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
