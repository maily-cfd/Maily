/**
 * Boult V3 — Conversation Memory
 *
 * Persists conversation turns to Supabase so Boult remembers context
 * across sessions. Falls back gracefully if the table doesn't exist.
 *
 * Table: boult_conversations
 *   user_id       text
 *   conversation_id text
 *   role          text ('user' | 'assistant')
 *   content       text
 *   created_at    timestamptz default now()
 */

import { getSupabaseAdmin } from '../supabase.js';

export interface MemoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Store a single message turn. Silently swallows errors (missing table, etc.).
 */
export async function storeMessage(
  userId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  if (!content?.trim()) return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('boult_conversations').insert({
      user_id: userId,
      conversation_id: conversationId,
      role,
      content: content.slice(0, 8000),
    });
  } catch {
    // Table may not exist — non-fatal
  }
}

/**
 * Retrieve the last N messages from a conversation.
 * Returns [] on any error.
 */
export async function getConversationHistory(
  userId: string,
  conversationId: string,
  limit = 20
): Promise<MemoryMessage[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('boult_conversations')
      .select('role, content')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error || !data) return [];
    return data.map(row => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
    }));
  } catch {
    return [];
  }
}
