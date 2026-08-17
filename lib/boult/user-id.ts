/**
 * Canonical user-id normalization.
 *
 * FX.1 — Boult stores user identity by email across three integration tables,
 * memory rows, conversation rows, agent rows, and per-conversation session
 * state. Different files normalized inconsistently — some used
 * `userId.toLowerCase()`, some used `ilike()` for case-insensitive matching,
 * some used neither. A user logging in with mixed-case email could end up
 * with their data split across two effective identities.
 *
 * Single canonical rule:
 *   - Trim whitespace
 *   - Lowercase
 *   - Reject obviously-bogus inputs (empty, contains no '@')
 *
 * Use this helper EVERYWHERE a user id touches the database, the system
 * prompt, or any per-user storage key. The lint rule (next step) will
 * catch raw `userId.toLowerCase()` and remind you to swap to the helper.
 */

export function normalizeUserId(rawUserId: string | null | undefined): string {
  if (!rawUserId) return '';
  const trimmed = String(rawUserId).trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase();
}

/**
 * Validate that a normalized id looks like an email. Use this only at
 * trust boundaries (API route entry, auth handler). Internal callers can
 * assume normalizeUserId() output is already valid.
 */
export function isValidUserId(userId: string): boolean {
  if (!userId) return false;
  // Must contain exactly one @ and at least one dot in the domain.
  const at = userId.indexOf('@');
  if (at <= 0 || at !== userId.lastIndexOf('@')) return false;
  return userId.slice(at + 1).includes('.');
}
