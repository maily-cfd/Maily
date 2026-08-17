/**
 * Audit Logger — Immutable Append-Only Activity Logging
 * 
 * Logs all security-relevant actions to Supabase.
 * The application can WRITE to the audit log but not DELETE from it.
 * Supabase RLS policies should enforce write-only access.
 */

import { getSupabaseAdmin } from './supabase.js';
import crypto from 'crypto';

// ─── Event Types ────────────────────────────────────────────────────────────────

export const AUDIT_EVENTS = {
  // Auth events
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_TOKEN_REFRESH: 'auth.token_refresh',
  AUTH_SESSION_CREATED: 'auth.session_created',
  AUTH_REAUTH_FORCED: 'auth.reauth_forced',
  AUTH_FINGERPRINT_MISMATCH: 'auth.fingerprint_mismatch',

  // Email events
  EMAIL_ACCESSED: 'email.accessed',
  EMAIL_LIST_VIEWED: 'email.list_viewed',
  EMAIL_SENT: 'email.sent',
  EMAIL_DRAFT_CREATED: 'email.draft_created',

  // AI events
  AI_DRAFT_GENERATED: 'ai.draft_generated',
  AI_SUMMARY_GENERATED: 'ai.summary_generated',
  AI_SIFT_ANALYSIS: 'ai.sift_analysis',
  AI_BOULT_CHAT: 'ai.boult_chat',
  AI_PII_STRIPPED: 'ai.pii_stripped',

  // Settings events
  SETTINGS_CHANGED: 'settings.changed',
  SECURITY_ENCRYPTION_TOGGLED: 'settings.encryption_toggled',
  PROFILE_UPDATED: 'settings.profile_updated',

  // Data events
  DATA_EXPORTED: 'data.exported',
  DATA_DELETED: 'data.deleted',
  DATA_ENCRYPTED: 'data.encrypted',
  DATA_DECRYPTED: 'data.decrypted',

  // Security events
  SECURITY_ALERT: 'security.alert',
  VAULT_KEY_DERIVED: 'security.vault_key_derived',
};

// ─── Audit Logger Class ─────────────────────────────────────────────────────────

class AuditLogger {
  constructor() {
    this._supabase = null;
  }

  get supabase() {
    if (!this._supabase) {
      this._supabase = getSupabaseAdmin();
    }
    return this._supabase;
  }

  /**
   * Log an audit event. This is append-only — no updates or deletes.
   * 
   * @param {string} userId - The user who performed the action
   * @param {string} eventType - One of AUDIT_EVENTS
   * @param {Object} [details] - Additional event details
   * @param {Object} [meta] - Metadata (IP, user-agent, etc.)
   * @returns {Promise<{success: boolean, eventId?: string}>}
   */
  async log(userId, eventType, details = {}, meta = {}) {
    try {
      const eventId = `evt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

      const logEntry = {
        event_id: eventId,
        user_id: userId?.toLowerCase(),
        event_type: eventType,
        details: JSON.stringify(details),
        client_ip: meta.ip || 'unknown',
        user_agent: meta.userAgent ? meta.userAgent.substring(0, 255) : 'unknown',
        created_at: new Date().toISOString(),
        integrity_hash: this._generateIntegrityHash(eventId, userId, eventType, details)
      };

      const { error } = await this.supabase
        .from('audit_logs')
        .insert(logEntry);

      if (error) {
        // If table doesn't exist, log to console and continue
        if (error.code === '42P01') {
          console.log(`📋 [AuditLog] Table not created yet. Event: ${eventType} for ${userId}`);
          return { success: false, reason: 'table_not_found' };
        }
        console.error('📋 [AuditLog] Storage error:', error.message);
        return { success: false, reason: error.message };
      }

      return { success: true, eventId };
    } catch (error) {
      // Never throw — audit logging should not break the application
      console.error('📋 [AuditLog] Exception:', error.message);
      return { success: false, reason: error.message };
    }
  }

  /**
   * Get audit logs for a specific user (for "My Activity" page).
   * 
   * @param {string} userId - The user whose logs to retrieve
   * @param {Object} [options] - Query options
   * @param {number} [options.limit=50] - Max entries to return
   * @param {number} [options.offset=0] - Pagination offset
   * @param {string} [options.eventType] - Filter by event type
   * @param {string} [options.startDate] - Filter from date (ISO string)
   * @param {string} [options.endDate] - Filter to date (ISO string)
   * @returns {Promise<{data: Array, total: number}>}
   */
  async getUserLogs(userId, options = {}) {
    try {
      const { limit = 50, offset = 0, eventType, startDate, endDate } = options;

      let query = this.supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .eq('user_id', userId?.toLowerCase())
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventType) query = query.eq('event_type', eventType);
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);

      const { data, error, count } = await query;

      if (error) {
        if (error.code === '42P01') return { data: [], total: 0 };
        throw error;
      }

      // Parse details JSON for each log entry
      const parsed = (data || []).map(log => ({
        ...log,
        details: this._safeParseJSON(log.details)
      }));

      return { data: parsed, total: count || 0 };
    } catch (error) {
      console.error('📋 [AuditLog] Get logs error:', error.message);
      return { data: [], total: 0 };
    }
  }

  /**
   * Generate an integrity hash for tamper detection.
   * If someone modifies a log entry, the hash won't match.
   */
  _generateIntegrityHash(eventId, userId, eventType, details) {
    const payload = `${eventId}|${userId}|${eventType}|${JSON.stringify(details)}`;
    const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET || 'audit-integrity-key';
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  _safeParseJSON(str) {
    try {
      return typeof str === 'string' ? JSON.parse(str) : str;
    } catch {
      return str;
    }
  }
}

// Singleton export
export const auditLogger = new AuditLogger();
export { AuditLogger };
