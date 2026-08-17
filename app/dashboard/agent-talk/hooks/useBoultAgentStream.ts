/**
 * useBoultAgentStream — SSE consumer hook for the Boult Agent Loop
 *
 * Consumes Server-Sent Events from /api/agent-talk/chat-boult-v2 and
 * translates them into React state updates that the ChatInterface can render.
 *
 * Event types handled:
 *   run_start       → initialise run state
 *   thinking        → update live thinking steps
 *   tool_call       → show which tool is being called
 *   tool_result     → show tool outcome
 *   tool_error      → show recoverable error
 *   approval_required → pause for user approval
 *   message         → final AI response text
 *   error           → fatal error
 *   done            → run complete with metrics
 */

import { useCallback, useRef } from 'react';

export interface AgentStreamEvent {
  type: 'run_start' | 'thinking' | 'tool_call' | 'tool_result' | 'tool_error' |
        'approval_required' | 'message' | 'error' | 'done';
  data: Record<string, any>;
}

export interface AgentStreamCallbacks {
  onRunStart?: (data: { runId: string; message: string }) => void;
  onThinking?: (data: { iteration: number; status: string; step: string }) => void;
  onToolCall?: (data: { tool: string; params: Record<string, any>; iteration: number }) => void;
  onToolResult?: (data: { tool: string; success: boolean; summary: string; iteration: number }) => void;
  onToolError?: (data: { tool: string; error: string; iteration: number }) => void;
  onApprovalRequired?: (data: { tool: string; params: Record<string, any>; description: string; iteration: number }) => void;
  onMessage?: (data: { content: string; iteration: number; meta?: Record<string, any> }) => void;
  onError?: (data: { message: string }) => void;
  onDone?: (data: { runId: string; totalSteps: number; durationMs: number }) => void;
}

export interface AgentStreamRequest {
  message: string;
  conversationId?: string | null;
  isNewConversation?: boolean;
  gmailAccessToken?: string | null;
  modelId?: string;
}

/**
 * Hook that provides a `sendAgentMessage` function.
 * Call it to start an SSE stream from the agent loop endpoint.
 */
export function useBoultAgentStream(callbacks: AgentStreamCallbacks) {
  const abortRef = useRef<AbortController | null>(null);

  const sendAgentMessage = useCallback(async (request: AgentStreamRequest) => {
    // Abort any previous stream
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/boult/v3/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abortRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        callbacks.onError?.({ message: errorData.message || `Request failed (${response.status})` });
        return { success: false, error: errorData };
      }

      if (!response.body) {
        callbacks.onError?.({ message: 'No response body (SSE not supported)' });
        return { success: false, error: 'No body' };
      }

      // Read the SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastMessageContent = '';
      let conversationId = response.headers.get('X-Conversation-Id') || request.conversationId || null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || !currentEventType) continue;

            try {
              const data = JSON.parse(dataStr);

              switch (currentEventType) {
                case 'run_start':
                  callbacks.onRunStart?.(data);
                  break;
                case 'thinking':
                  callbacks.onThinking?.(data);
                  break;
                case 'tool_call':
                  callbacks.onToolCall?.(data);
                  break;
                case 'tool_result':
                  callbacks.onToolResult?.(data);
                  break;
                case 'tool_error':
                  callbacks.onToolError?.(data);
                  break;
                case 'approval_required':
                  callbacks.onApprovalRequired?.(data);
                  break;
                case 'message':
                  lastMessageContent = data.content || '';
                  callbacks.onMessage?.(data);
                  break;
                case 'error':
                  callbacks.onError?.(data);
                  break;
                case 'done':
                  callbacks.onDone?.(data);
                  break;
                default:
                  console.warn('[AgentStream] Unknown event:', currentEventType);
              }
            } catch (parseErr) {
              // Skip malformed JSON chunks
            }

            currentEventType = '';
          }
        }
      }

      return {
        success: true,
        conversationId,
        lastMessage: lastMessageContent
      };

    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, aborted: true };
      }
      callbacks.onError?.({ message: err.message || 'Stream failed' });
      return { success: false, error: err.message };
    }
  }, [callbacks]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { sendAgentMessage, abort };
}
