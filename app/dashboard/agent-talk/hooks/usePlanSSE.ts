/**
 * usePlanSSE — Real-time plan execution updates via Server-Sent Events
 *
 * Connects to /api/boult/v3/plans/:planId/stream and dispatches
 * step-level state transitions to the UI.
 *
 * Events:
 *   step:start     → step is now executing
 *   step:done      → step completed successfully
 *   step:failed    → step failed with error
 *   plan:completed → all steps finished
 */

import { useEffect, useRef, useCallback } from 'react';

export type SSEEvent =
  | { type: 'step:start';     stepId: string }
  | { type: 'step:done';      stepId: string }
  | { type: 'step:failed';    stepId: string; error: string }
  | { type: 'plan:completed'; planId: string };

interface UsePlanSSEOptions {
  /** Plan ID to subscribe to */
  planId: string | null;
  /** Whether SSE connection should be active */
  enabled: boolean;
  /** Called for each SSE event */
  onEvent: (event: SSEEvent) => void;
  /** Called when connection drops */
  onError?: (error: Event) => void;
}

export function usePlanSSE({ planId, enabled, onEvent, onError }: UsePlanSSEOptions) {
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || !planId) return;

    const url = `/api/boult/v3/plans/${planId}/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent;
        onEventRef.current(data);
      } catch {
        // Skip malformed JSON
      }
    };

    eventSource.onerror = (e) => {
      onErrorRef.current?.(e);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [planId, enabled]);
}

export default usePlanSSE;
