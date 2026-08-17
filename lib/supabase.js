import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from './crypto.js';
import fs from 'fs';
import path from 'path';

// Helper to get environment variables with proper fallbacks
// Also checks for NEXT_PUBLIC_ prefixed versions for backwards compatibility
const getEnvVar = (key, fallback) => {
  // First try the exact key
  let value = process.env[key];

  // If not found and key doesn't start with NEXT_PUBLIC_, try with prefix
  if ((!value || value.trim() === '' || value === 'undefined') && !key.startsWith('NEXT_PUBLIC_')) {
    value = process.env[`NEXT_PUBLIC_${key}`];
  }

  if (!value || value.trim() === '' || value === 'undefined') {
    return fallback;
  }
  return value.trim();
};

// Factory functions for Supabase clients with enhanced build-time safety
export function getSupabase() {
  const supabaseUrl = getEnvVar('SUPABASE_URL', null);
  const supabaseAnonKey = getEnvVar('SUPABASE_ANON_KEY', null);

  // If missing URL or during build phase, return a safe mock to satisfy static analysis
  if (!supabaseUrl || !supabaseAnonKey || process.env.NEXT_PHASE === 'phase-production-build') {
    if (!supabaseUrl && process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ SUPABASE_URL is not configured. Please set SUPABASE_URL in your environment.');
    }
    if (!supabaseAnonKey && process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ SUPABASE_ANON_KEY is not configured. Please set SUPABASE_ANON_KEY in your environment.');
    }
    return createClient(
      supabaseUrl || 'https://placeholder-url-for-build.supabase.co',
      supabaseAnonKey || 'placeholder-key'
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

export function getSupabaseAdmin() {
  const supabaseUrl = getEnvVar('SUPABASE_URL', null);
  const supabaseServiceKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY', null);

  // If missing URL or during build phase, return a safe mock to satisfy static analysis
  if (!supabaseUrl || !supabaseServiceKey || process.env.NEXT_PHASE === 'phase-production-build') {
    if (!supabaseUrl && process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ SUPABASE_URL is not configured. Please set SUPABASE_URL in your environment.');
    }
    if (!supabaseServiceKey && process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY is not configured. This is required for server-side operations.');
    }
    return createClient(
      supabaseUrl || 'https://placeholder-url-for-build.supabase.co',
      supabaseServiceKey || 'placeholder-key'
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

// Deprecated: Use getSupabase() or getSupabaseAdmin() instead
// These are kept for backward compatibility but will trigger build-time evaluation if imported
export const supabase = null;
export const supabaseAdmin = null;

export class DatabaseService {
  constructor(isAdmin = true) {
    this._isAdmin = isAdmin;
    this._supabase = null;
  }

  get supabase() {
    if (!this._supabase) {
      this._supabase = this._isAdmin ? getSupabaseAdmin() : getSupabase();
    }
    return this._supabase;
  }

  // Store user tokens securely
  async storeUserTokens(userId, tokens) {
    userId = userId?.toLowerCase();
    try {
      console.log('StoreUserTokens called:', {
        userId,
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
      });

      const { data, error } = await this.supabase
        .from('user_tokens')
        .upsert({
          user_id: userId,
          google_email: tokens.google_email?.toLowerCase() || userId,
          encrypted_access_token: encrypt(tokens.access_token), // Encrypting before storage
          encrypted_refresh_token: encrypt(tokens.refresh_token), // Encrypting before storage
          access_token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
          token_type: tokens.token_type,
          scopes: tokens.scopes || '',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'google_email',
          ignoreDuplicates: false
        });

      if (error) {
        // If table doesn't exist, log and continue (tokens will be stored in session only)
        if (error.code === '42P01') {
          console.warn('user_tokens table does not exist, tokens stored in session only');
          return null;
        }

        // Check for specific table constraint issues
        if (error.code === '23505') {
          console.log('Duplicate key issue, trying update instead');
          const { data: updateData, error: updateError } = await this.supabase
            .from('user_tokens')
            .update({
              encrypted_access_token: encrypt(tokens.access_token),
              encrypted_refresh_token: encrypt(tokens.refresh_token),
              access_token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
              token_type: tokens.token_type,
              scopes: tokens.scopes || '',
              updated_at: new Date().toISOString()
            })
            .eq('google_email', userId);

          if (updateError) {
            console.error('Update failed:', updateError);
            throw updateError;
          }
          console.log('Token update successful');
          return updateData;
        }

        console.error('Database error storing tokens:', error);
        throw error;
      }

      console.log('Token storage successful:', !!data);
      return data;
    } catch (error) {
      console.error('Error storing user tokens:', error);
      // Don't throw error, just return null so app can continue with session tokens
      return null;
    }
  }

  // Get user tokens
  async getUserTokens(userId) {
    userId = userId?.toLowerCase();
    try {
      console.log('DatabaseService.getUserTokens called for userId:', userId);
      const { data, error } = await this.supabase
        .from('user_tokens')
        .select('*')
        .or(`user_id.ilike."${userId}",google_email.ilike."${userId}"`)
        .maybeSingle();

      console.log('Supabase query result:', { hasData: !!data, error: error?.message, errorCode: error?.code, dataKeys: data ? Object.keys(data) : null });

      if (error) {
        // PGRST116 = no rows found, which is fine
        // 42P01 = table doesn't exist
        if (error.code === 'PGRST116' || error.code === '42P01') {
          console.log('No tokens found or table missing, returning null');
          return null;
        }
        console.error('Unexpected database error:', error);
        throw error;
      }
      if (data) {
        // Decrypt values before returning
        data.encrypted_access_token = decrypt(data.encrypted_access_token);
        data.encrypted_refresh_token = decrypt(data.encrypted_refresh_token);
      }
      
      console.log('Tokens retrieved successfully');
      return data;
    } catch (error) {
      console.error('Error getting user tokens:', error);
      throw error;
    }
  }

  // Store user profile with referral support
  async storeUserProfile(userId, profile, referralCode = null) {
    userId = userId?.toLowerCase();
    try {
      // Check if user already exists to determine if this is a first-time signup
      const { data: existingUser } = await this.supabase
        .from('user_profiles')
        .select('user_id, invited_by, username')
        .eq('user_id', userId)
        .maybeSingle();

      const profileData = {
        user_id: userId,
        email: profile.email?.toLowerCase(),
        name: profile.name,
        picture: profile.picture,
        last_synced_at: profile.last_synced_at || new Date().toISOString(),
        integrations: profile.integrations || {},
        updated_at: new Date().toISOString()
      };
      
      // Auto-populate username if missing
      if (!existingUser?.username) {
        profileData.username = profile.username || userId.split('@')[0];
      }

      // Set referral and founding member badge if new user
      if (!existingUser) {
        if (referralCode) {
          profileData.invited_by = referralCode;
        }

        try {
          // Check if there are less than 10 founding members in the system
          const { count: foundingCount, error: countError } = await this.supabase
            .from('user_profiles')
            .select('user_id', { count: 'exact', head: true })
            .contains('earned_badges', ['founding_member']);

          if (!countError && (foundingCount || 0) < 10) {
            profileData.earned_badges = ['founding_member'];
            console.log(`⭐ Awarded Founding Member badge to new user: ${userId}`);
          }
        } catch (badgeErr) {
          console.error('Error checking founding member count:', badgeErr);
        }
      }

      const { data, error } = await this.supabase
        .from('user_profiles')
        .upsert(profileData);

      if (error) throw error;

      // Handle referral logic for NEW signups
      if (!existingUser) {
        console.log(`🎁 New user detected: ${userId}. Applying welcome bonus.`);
        
        const welcomeAmount = referralCode ? 20 : 10; // Extra credits for being referred
        
        let userPrefs = {};
        const { data: currentUser } = await this.supabase
          .from('user_profiles')
          .select('preferences')
          .eq('user_id', userId)
          .maybeSingle();
          
        if (currentUser) {
          userPrefs = currentUser.preferences || {};
          const userBonus = userPrefs.bonus_credits || {};
          userBonus.boult_ai = (userBonus.boult_ai || 0) + welcomeAmount;
          userPrefs.bonus_credits = userBonus;
          
          await this.supabase
            .from('user_profiles')
            .update({ preferences: userPrefs })
            .eq('user_id', userId);
          
          console.log(`🎁 Welcome bonus of ${welcomeAmount} credits applied to ${userId}`);
        }

        // Process referral for inviter
        if (referralCode) {
          console.log(`🎁 Processing referral: ${referralCode} invited ${userId}`);

          // Build search for inviter - Username OR email prefix
          const { data: inviter } = await this.supabase
            .from('user_profiles')
            .select('user_id, invite_count, earned_badges, preferences')
            .or(`username.ilike.${referralCode},user_id.ilike.${referralCode}@%`)
            .maybeSingle();

          if (inviter) {
            const currentCount = inviter.invite_count || 0;
            const newCount = currentCount + 1;
            const userBadges = inviter.earned_badges || [];
            const inviterPrefs = inviter.preferences || {};
            
            const inviterBonus = inviterPrefs.bonus_credits || {};
            inviterBonus.boult_ai = (inviterBonus.boult_ai || 0) + 50;
            inviterPrefs.bonus_credits = inviterBonus;

            const updateData = {
              invite_count: newCount,
              preferences: inviterPrefs,
              updated_at: new Date().toISOString()
            };

            // Badge logic...
            const REFERRAL_MILESTONES = [{ invites: 5, badgeId: "recruiter" }, { invites: 25, badgeId: "ambassador" }, { invites: 50, badgeId: "founding_partner" }, { invites: 100, badgeId: "influencer" }, { invites: 250, badgeId: "stakeholder" }];
            let newBadges = [];
            REFERRAL_MILESTONES.forEach(m => { if (newCount >= m.invites && !userBadges.includes(m.badgeId)) newBadges.push(m.badgeId); });

            if (newBadges.length > 0) updateData.earned_badges = [...userBadges, ...newBadges];

            await this.supabase.from('user_profiles').update(updateData).eq('user_id', inviter.user_id);

            await this.supabase.from('pending_connections').insert({
              inviter_id: inviter.user_id,
              invited_id: userId,
              status: 'accepted',
              invited_by: referralCode,
              created_at: new Date().toISOString()
            });

            console.log(`✅ Referral system: Credited 50 to ${referralCode} for inviting ${userId}`);
          }
        }
      }

      return data;
    } catch (error) {
      console.error('Error storing user profile:', error);
      throw error;
    }
  }

  // Get global leaderboard (Top 10 inviters)
  async getLeaderboard(limit = 10) {
    try {
      const { data, error } = await this.supabase
        .from('user_profiles')
        .select('username, name, picture, invite_count')
        .not('invite_count', 'is', null)
        .gt('invite_count', 0)
        .order('invite_count', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      return [];
    }
  }

  // Get user profile
  async getUserProfile(userId) {
    userId = userId?.toLowerCase();
    try {
      const { data, error } = await this.supabase
        .from('user_profiles')
        .select('*')
        .ilike('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('Error getting user profile:', error);
      throw error;
    }
  }

  // Update integration status
  async updateIntegrationStatus(userId, integrationId, enabled) {
    try {
      // First get current profile
      const profile = await this.getUserProfile(userId);
      const integrations = profile?.integrations || {};

      integrations[integrationId] = enabled;

      const { data, error } = await this.supabase
        .from('user_profiles')
        .update({
          integrations: integrations,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating integration status:', error);
      throw error;
    }
  }

  // Store emails
  async storeEmails(userId, emails) {
    try {
      // Check if user has advanced encryption enabled
      const profile = await this.getUserProfile(userId);
      const isAdvancedEncryption = profile?.preferences?.advanced_security === 'active';

      if (isAdvancedEncryption) {
        console.log('🔐 Advanced Encryption is ACTIVE: Encrypting emails for storage.');
      }

      const emailData = emails.map(email => {
        // Parse and format the date properly for PostgreSQL
        let formattedDate;
        try {
          // Handle different date formats from Gmail API
          if (email.date) {
            // Parse RFC 2822 format (e.g., "Sat, 18 Oct 2025 03:45:54 +0000")
            const parsedDate = new Date(email.date);
            if (!isNaN(parsedDate.getTime())) {
              formattedDate = parsedDate.toISOString();
            } else {
              // Fallback to current date if parsing fails
              console.warn(`Invalid date format for email ${email.id}: ${email.date}, using current date`);
              formattedDate = new Date().toISOString();
            }
          } else {
            formattedDate = new Date().toISOString();
          }
        } catch (dateError) {
          console.warn(`Date parsing error for email ${email.id}:`, dateError.message);
          formattedDate = new Date().toISOString();
        }

        // Encrypt sensitive fields if advanced encryption is on
        const subject = isAdvancedEncryption ? encrypt(email.subject) : (email.subject || '');
        const fromEmail = isAdvancedEncryption ? encrypt(email.from) : (email.from || '');
        const toEmail = isAdvancedEncryption ? encrypt(email.to) : (email.to || '');
        const snippet = isAdvancedEncryption ? encrypt(email.snippet) : (email.snippet || '');

        return {
          user_id: userId,
          email_id: email.id,
          thread_id: email.threadId,
          subject,
          from_email: fromEmail,
          to_email: toEmail,
          date: formattedDate,
          snippet,
          labels: JSON.stringify(email.labels || []),
          created_at: new Date().toISOString()
        };
      });

      // Process emails in smaller batches to avoid database timeouts
      const batchSize = 50;
      const results = [];

      for (let i = 0; i < emailData.length; i += batchSize) {
        const batch = emailData.slice(i, i + batchSize);

        const { data, error } = await this.supabase
          .from('user_emails')
          .upsert(batch, { onConflict: 'user_id,email_id' });

        if (error) {
          // If table doesn't exist, log and skip
          if (error.code === '42P01') {
            console.warn('user_emails table does not exist, skipping email storage');
            return null;
          }
          console.error('Batch storage error:', error);
          // Continue with next batch instead of failing completely
          continue;
        }

        if (data) {
          results.push(...data);
        }

        // Small delay between batches to avoid overwhelming the database
        if (i + batchSize < emailData.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return results;
    } catch (error) {
      console.error('Error storing emails:', error);
      throw error;
    }
  }

  // Get user emails
  async getUserEmails(userId, limit = 50, offset = 0) {
    try {
      const { data, error } = await this.supabase
        .from('user_emails')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Decrypt fields if they are encrypted
      return data.map(email => ({
        ...email,
        subject: decrypt(email.subject),
        from_email: decrypt(email.from_email),
        to_email: decrypt(email.to_email),
        snippet: decrypt(email.snippet)
      }));
    } catch (error) {
      console.error('Error getting user emails:', error);
      throw error;
    }
  }

  // Update email labels
  async updateEmailLabels(userId, emailId, labels) {
    try {
      const { data, error } = await this.supabase
        .from('user_emails')
        .update({
          labels: JSON.stringify(labels),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('email_id', emailId);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating email labels:', error);
      throw error;
    }
  }

  // Delete user data completely
  async deleteUserData(userId) {
    try {
      console.log(`🧹 Wiping all data for user: ${userId}`);

      // Delete in order to respect potential foreign key constraints (though many columns are just TEXT user_id)
      const tables = [
        'agent_chat_history',
        'search_history',
        'saved_searches',
        'unsubscribed_emails',
        'search_index',
        'search_performance',
        'notes',
        'user_emails',
        'user_tokens',
        'user_profiles'
      ];

      for (const table of tables) {
        try {
          const { error } = await this.supabase
            .from(table)
            .delete()
            .eq('user_id', userId);

          if (error) {
            // Some tables might use google_email instead of user_id
            if (table === 'user_tokens') {
              await this.supabase.from(table).delete().eq('google_email', userId);
            } else {
              console.warn(`⚠️ Error deleting from ${table}:`, error.message);
            }
          }
        } catch (tableError) {
          console.warn(`❌ Failed to delete from ${table}:`, tableError.message);
        }
      }

      console.log(`✅ Data wipe complete for ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('💥 Error in master delete sequence:', error);
      throw error;
    }
  }

  // Store a single agent chat message pair
  async storeAgentChatMessage(userId, userMessage, agentResponse, conversationId, messageOrder = 1, isInitialMessage = false) {
    try {
      // Check for advanced encryption
      const profile = await this.getUserProfile(userId);
      const isAdvancedEncryption = profile?.preferences?.advanced_security === 'active';

      const { data, error } = await this.supabase
        .from('agent_chat_history')
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          user_message: isAdvancedEncryption ? encrypt(userMessage) : (userMessage || ''),
          agent_response: isAdvancedEncryption ? encrypt(agentResponse) : (agentResponse || ''),
          message_order: messageOrder,
          is_initial_message: isInitialMessage,
        });

      if (error) {
        if (error.code === '42P01') {
          console.warn('agent_chat_history table does not exist, skipping chat storage.');
          return null;
        }
        // If new columns don't exist, throw error to trigger fallback
        if (error.message.includes('conversation_id') || error.message.includes('message_order') || error.message.includes('is_initial_message')) {
          throw new Error('NEW_SCHEMA_COLUMNS_MISSING');
        }
        throw error;
      }
      return data;
    } catch (error) {
      if (error.message === 'NEW_SCHEMA_COLUMNS_MISSING') {
        throw error; // Re-throw to trigger fallback in API route
      }
      console.error('Error storing agent chat message:', error);
      throw error;
    }
  }

  // Get all agent chat history for a user
  async getAgentChatHistory(userId) {
    try {
      const { data, error } = await this.supabase
        .from('agent_chat_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Decrypt messages if they are encrypted
      return (data || []).map(msg => ({
        ...msg,
        user_message: decrypt(msg.user_message),
        agent_response: decrypt(msg.agent_response)
      }));
    } catch (error) {
      console.error('Error getting agent chat history:', error);
      throw error;
    }
  }

  // Get agent chat history with pagination
  async getAgentChatHistoryWithPagination(userId, limit = 50, offset = 0) {
    try {
      // First check if the table exists
      const { data: tableCheck, error: tableError } = await this.supabase
        .from('agent_chat_history')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (tableError) {
        if (tableError.code === '42P01') {
          console.log('agent_chat_history table does not exist');
          return [];
        }
        throw tableError;
      }

      const { data, error } = await this.supabase
        .from('agent_chat_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Decrypt messages if they are encrypted
      return (data || []).map(msg => ({
        ...msg,
        user_message: decrypt(msg.user_message),
        agent_response: decrypt(msg.agent_response)
      }));
    } catch (error) {
      console.error('Error getting agent chat history with pagination:', error);
      throw error;
    }
  }

  // Get conversation thread by conversation ID
  async getConversationThread(userId, conversationId) {
    try {
      const { data, error } = await this.supabase
        .from('agent_chat_history')
        .select('*')
        .eq('user_id', userId)
        .eq('conversation_id', conversationId)
        .order('message_order', { ascending: true });

      if (error) {
        // If conversation_id column doesn't exist, try to get by message ID for backward compatibility
        if (error.message.includes('conversation_id')) {
          console.log('conversation_id column not available, trying to get by message ID');
          const { data: fallbackData, error: fallbackError } = await this.supabase
            .from('agent_chat_history')
            .select('*')
            .eq('id', conversationId)
            .eq('user_id', userId);

          if (fallbackError) throw fallbackError;
          return (fallbackData || []).map(msg => ({
            ...msg,
            user_message: decrypt(msg.user_message),
            agent_response: decrypt(msg.agent_response)
          }));
        }
        throw error;
      }
      return (data || []).map(msg => ({
        ...msg,
        user_message: decrypt(msg.user_message),
        agent_response: decrypt(msg.agent_response)
      }));
    } catch (error) {
      console.error('Error getting conversation thread:', error);
      throw error;
    }
  }

  // Get all conversations for a user (grouped by conversation_id)
  async getUserConversations(userId) {
    try {
      // First check if the table exists
      const { data: tableCheck, error: tableError } = await this.supabase
        .from('agent_chat_history')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

      if (tableError) {
        if (tableError.code === '42P01') {
          console.log('agent_chat_history table does not exist');
          return [];
        }
        throw tableError;
      }

      const { data, error } = await this.supabase
        .from('agent_chat_history')
        .select('*')
        .eq('user_id', userId)
        .eq('is_initial_message', true)
        .order('created_at', { ascending: false });

      if (error) {
        // If the new column doesn't exist, fall back to getting all messages
        if (error.message.includes('is_initial_message')) {
          console.log('is_initial_message column not available, falling back to all messages');
          const { data: fallbackData, error: fallbackError } = await this.supabase
            .from('agent_chat_history')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

          if (fallbackError) throw fallbackError;
          return fallbackData || [];
        }
        throw error;
      }
      return data || [];
    } catch (error) {
      console.error('Error getting user conversations:', error);
      throw error;
    }
  }

  // Get conversation message count
  async getConversationMessageCount(userId, conversationId) {
    try {
      const { count, error } = await this.supabase
        .from('agent_chat_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('conversation_id', conversationId);

      if (error) {
        // If conversation_id column doesn't exist, return 1 for single message
        if (error.message.includes('conversation_id')) {
          console.log('conversation_id column not available, returning count of 1');
          return 1;
        }
        throw error;
      }
      return count || 0;
    } catch (error) {
      console.error('Error getting conversation message count:', error);
      throw error;
    }
  }

  // Generate a unique conversation ID
  generateConversationId() {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substr(2, 9);
    return `conv_${timestamp}_${randomStr}`;
  }

  // ===== Boult Missions: persistence layer =====

  async createMission(userId, mission) {
    try {
      const { data, error } = await this.supabase
        .from('agent_missions')
        .insert({
          user_id: userId,
          mission_id: mission.id,
          goal: mission.goal,
          status: mission.status,
          linked_thread_ids: mission.linkedThreadIds,
          steps: mission.steps,
          plan_cards: mission.planCards,
          audit_trail: mission.auditTrail,
          conversation_id: mission.conversationId,
          max_nudges: mission.maxNudges ?? null,
          nudge_count: mission.nudgeCount ?? 0,
          created_at: mission.createdAt,
          updated_at: mission.updatedAt
        })
        .select('*')
        .maybeSingle();

      if (error) {
        // 42P01 => table does not exist; fail gracefully for now
        if (error.code === '42P01') {
          console.warn('agent_missions table does not exist, skipping mission persistence');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error creating mission:', error);
      return null;
    }
  }

  async updateMission(userId, mission) {
    try {
      const { data, error } = await this.supabase
        .from('agent_missions')
        .update({
          goal: mission.goal,
          status: mission.status,
          linked_thread_ids: mission.linkedThreadIds,
          steps: mission.steps,
          plan_cards: mission.planCards,
          audit_trail: mission.auditTrail,
          conversation_id: mission.conversationId,
          max_nudges: mission.maxNudges ?? null,
          nudge_count: mission.nudgeCount ?? 0,
          updated_at: mission.updatedAt
        })
        .eq('user_id', userId)
        .eq('mission_id', mission.id)
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('agent_missions table does not exist, skipping mission update');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error updating mission:', error);
      return null;
    }
  }

  async getMissionById(userId, missionId) {
    try {
      const { data, error } = await this.supabase
        .from('agent_missions')
        .select('*')
        .eq('user_id', userId)
        .eq('mission_id', missionId)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('agent_missions table does not exist, cannot load mission');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error getting mission by id:', error);
      return null;
    }
  }

  async getActiveMissionsForConversation(userId, conversationId) {
    try {
      const { data, error } = await this.supabase
        .from('agent_missions')
        .select('*')
        .eq('user_id', userId)
        .eq('conversation_id', conversationId)
        .in('status', ['draft', 'waiting_on_user', 'waiting_on_other']);

      if (error) {
        if (error.code === '42P01') {
          console.warn('agent_missions table does not exist, no active missions available');
          return [];
        }
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error getting active missions:', error);
      return [];
    }
  }

  async appendMissionAuditEntry(userId, missionId, entry) {
    try {
      const { data, error } = await this.supabase
        .from('agent_mission_audit')
        .insert({
          user_id: userId,
          mission_id: missionId,
          timestamp: entry.timestamp,
          action_type: entry.actionType,
          target_thread_id: entry.targetThreadId ?? null,
          target_event_id: entry.targetEventId ?? null,
          inputs: entry.inputs ?? {},
          outputs: entry.outputs ?? {},
          approved_by: entry.approvedBy
        })
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('agent_mission_audit table does not exist, skipping audit persistence');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error appending mission audit entry:', error);
      return null;
    }
  }

  // ===== Boult Operator Runtime: persistence layer =====

  async createOperatorRun(userId, run) {
    try {
      const { data, error } = await this.supabase
        .from('boult_runs')
        .insert({
          user_id: userId,
          run_id: run.runId,
          conversation_id: run.conversationId || null,
          mission_id: run.missionId || null,
          status: run.status || 'running',
          phase: run.phase || 'thinking',
          intent: run.intent || 'general',
          complexity: run.complexity || 'simple',
          plan_snapshot: run.planSnapshot || [],
          memory: run.memory || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_runs table does not exist, skipping run persistence');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error creating operator run:', error);
      return null;
    }
  }

  async updateOperatorRun(userId, runId, patch = {}) {
    try {
      const updatePayload = { ...patch, updated_at: new Date().toISOString() };
      const { data, error } = await this.supabase
        .from('boult_runs')
        .update(updatePayload)
        .eq('user_id', userId)
        .eq('run_id', runId)
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_runs table does not exist, skipping run update');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error updating operator run:', error);
      return null;
    }
  }

  async getOperatorRunById(userId, runId) {
    try {
      const { data, error } = await this.supabase
        .from('boult_runs')
        .select('*')
        .eq('user_id', userId)
        .eq('run_id', runId)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_runs table does not exist, cannot load run');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error getting operator run:', error);
      return null;
    }
  }


  async getOperatorRunStepById(userId, runId, stepId) {
    try {
      const { data, error } = await this.supabase
        .from('boult_run_steps')
        .select('*')
        .eq('user_id', userId)
        .eq('run_id', runId)
        .eq('step_id', stepId)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_run_steps table does not exist, cannot load run step');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error getting operator run step:', error);
      return null;
    }
  }  async upsertOperatorRunStep(userId, runId, step) {
    try {
      const { data, error } = await this.supabase
        .from('boult_run_steps')
        .upsert({
          user_id: userId,
          run_id: runId,
          step_id: step.id,
          step_order: step.order || 1,
          kind: step.kind || 'think',
          status: step.status || 'pending',
          label: step.label || '',
          detail: step.detail || '',
          evidence: step.evidence || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'run_id,step_id' })
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_run_steps table does not exist, skipping step persistence');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error upserting operator run step:', error);
      return null;
    }
  }

  async updateOperatorRunStepStatus(userId, runId, stepId, status, detail = null, evidence = null) {
    try {
      const updatePayload = {
        status,
        updated_at: new Date().toISOString()
      };
      if (detail !== null) updatePayload.detail = detail;
      if (evidence !== null) updatePayload.evidence = evidence;
      if (status === 'active') updatePayload.started_at = new Date().toISOString();
      if (status === 'completed' || status === 'error' || status === 'blocked_approval') {
        updatePayload.completed_at = new Date().toISOString();
      }

      const { data, error } = await this.supabase
        .from('boult_run_steps')
        .update(updatePayload)
        .eq('user_id', userId)
        .eq('run_id', runId)
        .eq('step_id', stepId)
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_run_steps table does not exist, skipping step status update');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error updating operator run step status:', error);
      return null;
    }
  }

  async getOperatorRunSteps(userId, runId) {
    try {
      const { data, error } = await this.supabase
        .from('boult_run_steps')
        .select('*')
        .eq('user_id', userId)
        .eq('run_id', runId)
        .order('step_order', { ascending: true });

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_run_steps table does not exist, cannot load run steps');
          return [];
        }
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error getting operator run steps:', error);
      return [];
    }
  }

  async appendOperatorRunEvent(userId, runId, event) {
    try {
      const { data, error } = await this.supabase
        .from('boult_run_events')
        .insert({
          user_id: userId,
          run_id: runId,
          event_type: event.type || 'run_event',
          phase: event.phase || 'thinking',
          payload: event.payload || {},
          created_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_run_events table does not exist, skipping run event persistence');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error appending operator run event:', error);
      return null;
    }
  }

  async getOperatorRunEvents(userId, runId, limit = 100) {
    try {
      const { data, error } = await this.supabase
        .from('boult_run_events')
        .select('*')
        .eq('user_id', userId)
        .eq('run_id', runId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_run_events table does not exist, cannot load run events');
          return [];
        }
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error getting operator run events:', error);
      return [];
    }
  }

  async createOperatorJob(userId, job) {
    try {
      const { data, error } = await this.supabase
        .from('boult_jobs')
        .insert({
          user_id: userId,
          run_id: job.runId,
          job_type: job.jobType,
          payload: job.payload || {},
          status: job.status || 'queued',
          attempt_count: 0,
          max_attempts: job.maxAttempts || 3,
          available_at: job.availableAt || new Date().toISOString(),
          lease_expires_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_jobs table does not exist, skipping job enqueue');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error creating operator job:', error);
      return null;
    }
  }

  async claimOperatorJobs(maxJobs = 10, workerId = 'worker') {
    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await this.supabase
        .from('boult_jobs')
        .select('*')
        .in('status', ['queued', 'retry'])
        .lte('available_at', nowIso)
        .order('available_at', { ascending: true })
        .limit(maxJobs);

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_jobs table does not exist, no jobs to claim');
          return [];
        }
        throw error;
      }

      const jobs = data || [];
      const claimed = [];
      for (const job of jobs) {
        const leaseExpires = new Date(Date.now() + 45 * 1000).toISOString();
        const { data: updated } = await this.supabase
          .from('boult_jobs')
          .update({
            status: 'processing',
            worker_id: workerId,
            lease_expires_at: leaseExpires,
            attempt_count: (job.attempt_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id)
          .in('status', ['queued', 'retry'])
          .select('*')
          .maybeSingle();
        if (updated) claimed.push(updated);
      }

      return claimed;
    } catch (error) {
      console.error('Error claiming operator jobs:', error);
      return [];
    }
  }

  async completeOperatorJob(jobId, status = 'completed', errorMessage = null) {
    try {
      const updatePayload = {
        status,
        lease_expires_at: null,
        updated_at: new Date().toISOString()
      };
      if (status === 'completed') updatePayload.completed_at = new Date().toISOString();
      if (errorMessage) updatePayload.error_message = errorMessage;

      const { data, error } = await this.supabase
        .from('boult_jobs')
        .update(updatePayload)
        .eq('id', jobId)
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_jobs table does not exist, skipping job completion update');
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error completing operator job:', error);
      return null;
    }
  }

  // Create user connection (Orbit)
  async createUserConnection(connectionData) {
    try {
      const { data, error } = await this.supabase
        .from('user_connections')
        .insert(connectionData);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating user connection:', error);
      throw error;
    }
  }

  // Get user's connections
  async getUserConnections(userId) {
    try {
      const { data, error } = await this.supabase
        .from('user_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'accepted')
        .order('connected_at', { ascending: false });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting user connections:', error);
      throw error;
    }
  }

  // Log email action (analytics/history)
  async logEmailAction(userId, actionType, details) {
    try {
      const { data, error } = await this.supabase
        .from('email_actions_log')
        .insert({
          user_id: userId,
          action_type: actionType,
          details: details,
          created_at: new Date().toISOString()
        });

      if (error) {
        if (error.code === '42P01') {
          console.warn('email_actions_log table does not exist, skipping log.');
          return null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error logging email action:', error);
      return null;
    }
  }

  // ===== Sharing Conversations =====
  // Local filesystem database helpers for zero-downtime fallback when shared_chats table is not yet provisioned in Supabase
  _getLocalDbPath() {
    const dir = path.resolve(process.cwd(), 'scratch');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'shared_chats_db.json');
  }

  _readLocalDb() {
    try {
      const p = this._getLocalDbPath();
      if (!fs.existsSync(p)) return {};
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.error('Error reading local fallback DB:', e);
      return {};
    }
  }

  _writeLocalDb(data) {
    try {
      const p = this._getLocalDbPath();
      fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Error writing local fallback DB:', e);
      return false;
    }
  }

  async createSharedConversation(userId, conversationId, messages, title) {
    const shareId = `share_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newRecord = {
      id: shareId,
      original_convo_id: conversationId,
      owner_email: userId?.toLowerCase() || 'unknown',
      messages: messages || [], // Full snapshot of messages
      title: title || 'Shared Conversation',
      views: 0,
      is_unshared: false,
      created_at: new Date().toISOString()
    };

    try {
      const { data, error } = await this.supabase
        .from('shared_chats')
        .insert(newRecord)
        .select('*')
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('⚠️ Supabase shared_chats table does not exist. Saving to local fallback database.');
          const localDb = this._readLocalDb();
          localDb[shareId] = newRecord;
          this._writeLocalDb(localDb);
          return newRecord;
        }
        throw error;
      }
      return data || newRecord;
    } catch (error) {
      console.error('Error creating shared conversation in Supabase, attempting local fallback:', error);
      try {
        const localDb = this._readLocalDb();
        localDb[shareId] = newRecord;
        this._writeLocalDb(localDb);
        return newRecord;
      } catch (fallbackError) {
        console.error('Local fallback creation failed:', fallbackError);
        return null;
      }
    }
  }

  async getSharedConversation(shareId) {
    try {
      const { data, error } = await this.supabase
        .from('shared_chats')
        .select('*')
        .eq('id', shareId)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          console.warn('⚠️ Supabase shared_chats table does not exist. Reading from local fallback database.');
          const localDb = this._readLocalDb();
          return localDb[shareId] || null;
        }
        throw error;
      }
      return data;
    } catch (error) {
      console.error('Error getting shared conversation from Supabase, attempting local fallback:', error);
      try {
        const localDb = this._readLocalDb();
        return localDb[shareId] || null;
      } catch (fallbackError) {
        console.error('Local fallback retrieval failed:', fallbackError);
        return null;
      }
    }
  }

  async incrementSharedConversationViews(shareId, currentViews) {
    try {
      const { error } = await this.supabase
        .from('shared_chats')
        .update({ views: currentViews + 1 })
        .eq('id', shareId);

      if (error) {
        if (error.code === '42P01') {
          const localDb = this._readLocalDb();
          if (localDb[shareId]) {
            localDb[shareId].views = (localDb[shareId].views || 0) + 1;
            this._writeLocalDb(localDb);
          }
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error('Error incrementing views in Supabase, attempting local fallback:', error);
      try {
        const localDb = this._readLocalDb();
        if (localDb[shareId]) {
          localDb[shareId].views = (localDb[shareId].views || 0) + 1;
          this._writeLocalDb(localDb);
        }
      } catch (fallbackError) {
        console.error('Local fallback increment failed:', fallbackError);
      }
    }
  }

  async revokeSharedConversation(shareId) {
    try {
      const { error } = await this.supabase
        .from('shared_chats')
        .update({ is_unshared: true })
        .eq('id', shareId);

      if (error) {
        if (error.code === '42P01') {
          const localDb = this._readLocalDb();
          if (localDb[shareId]) {
            localDb[shareId].is_unshared = true;
            this._writeLocalDb(localDb);
            return { success: true };
          }
          return { success: false, error: 'Shared conversation not found' };
        }
        throw error;
      }
      return { success: true };
    } catch (error) {
      console.error('Error revoking share in Supabase, attempting local fallback:', error);
      try {
        const localDb = this._readLocalDb();
        if (localDb[shareId]) {
          localDb[shareId].is_unshared = true;
          this._writeLocalDb(localDb);
          return { success: true };
        }
        return { success: false, error: 'Shared conversation not found' };
      } catch (fallbackError) {
        console.error('Local fallback revocation failed:', fallbackError);
        return { success: false, error: fallbackError.message };
      }
    }
  }

  // ── Boult chat session persistence ──────────────────────────────────────────

  /**
   * Upsert a full Boult conversation snapshot.
   * Table: boult_chat_sessions (id text PK, user_id text, messages jsonb, title text, updated_at timestamptz)
   * The table is auto-created if missing (run the migration separately via Supabase dashboard).
   */
  async saveBoultChatSession(userId, conversationId, messages, title) {
    try {
      const { error } = await this.supabase
        .from('boult_chat_sessions')
        .upsert({
          id: conversationId,
          user_id: userId.toLowerCase(),
          messages: messages,
          title: title || conversationId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) {
        if (error.code === '42P01') {
          console.warn('boult_chat_sessions table missing — skipping DB save. Run migration to enable persistence.');
          return null;
        }
        throw error;
      }
      return { success: true };
    } catch (err) {
      console.error('[saveBoultChatSession]', err.message);
      return null;
    }
  }

  async loadBoultChatSession(userId, conversationId) {
    try {
      const { data, error } = await this.supabase
        .from('boult_chat_sessions')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', userId.toLowerCase())
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') return null;
        throw error;
      }
      return data;
    } catch (err) {
      console.error('[loadBoultChatSession]', err.message);
      return null;
    }
  }

  async listBoultChatSessions(userId, limit = 50) {
    try {
      const { data, error } = await this.supabase
        .from('boult_chat_sessions')
        .select('id, title, updated_at, messages')
        .eq('user_id', userId.toLowerCase())
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (error) {
        if (error.code === '42P01') return [];
        throw error;
      }
      return data || [];
    } catch (err) {
      console.error('[listBoultChatSessions]', err.message);
      return [];
    }
  }
}

