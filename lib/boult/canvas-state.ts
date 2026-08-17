/**
 * Boult canvas state — server-side last-known canvas content per conversation.
 *
 * Backs update_canvas mode='append' so the LLM does not have to resend the
 * entire markdown payload to add a paragraph. open_canvas and update_canvas
 * both upsert the latest content here.
 *
 * Fails open: any DB error (missing migration, network blip) is logged and the
 * tool falls back to plain replace behaviour. The migration is in
 * supabase/migrations/boult_canvas_state.sql.
 */

// @ts-ignore — JS module, no .d.ts
import { getSupabaseAdmin } from '../supabase.js';
import { normalizeUserId } from './user-id';

const TABLE = 'boult_canvas_state';

export interface CanvasState {
  conversationId: string;
  title?: string | null;
  type?: string | null;
  markdown: string;
  updatedAt?: string;
}

/**
 * Read the last canvas state for this conversation, or null if none / DB error.
 */
export async function getCanvasState(conversationId: string): Promise<CanvasState | null> {
  if (!conversationId) return null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(TABLE)
      .select('title, type, markdown, updated_at')
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      conversationId,
      title: data.title,
      type: data.type,
      markdown: data.markdown || '',
      updatedAt: data.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Upsert the canvas state. Used by open_canvas (replace) and update_canvas
 * (after the append/replace merge has been computed).
 */
export async function setCanvasState(params: {
  conversationId: string;
  userId: string;
  title?: string;
  type?: string;
  markdown: string;
}): Promise<void> {
  if (!params.conversationId) return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from(TABLE).upsert({
      conversation_id: params.conversationId,
      user_id: normalizeUserId(params.userId),
      title: params.title ?? null,
      type: params.type ?? null,
      markdown: params.markdown ?? '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id' });
  } catch (err: any) {
    // Non-fatal — the canvas still renders for the user; we just lose
    // server-side append support for the next turn.
    console.warn('[Boult:CanvasState] setCanvasState failed:', err.message);
  }
}
