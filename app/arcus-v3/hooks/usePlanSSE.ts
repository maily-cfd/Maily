'use client';
/**
 * Boult V3 — SSE Hook
 * Connects to the plan execution SSE stream.
 */
import { useEffect, useCallback, useRef } from 'react';

export interface SSEEvent {
  type: string;
  planId?: string;
  stepId?: string;
  error?: string;
  deepLink?: string;
  severity?: string;
  headline?: string;
  mode?: string;
}

export function usePlanSSE(planId: string | null, onEvent: (e: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!planId) return;

    const es = new EventSource(`/api/boult/v3/plans/${planId}/stream`, {
      withCredentials: true,
    });

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;
        onEventRef.current(event);
      } catch {
        // Ignore parse errors (heartbeats)
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [planId]);
}

/**
 * Hook for listening to global Boult feed events (new plans).
 */
export function useBoultFeedSSE(onEvent: (e: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    // For feed-level notifications, we use a global stream
    const es = new EventSource(`/api/boult/v3/plans/feed/stream`, {
      withCredentials: true,
    });

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SSEEvent;
        onEventRef.current(event);
      } catch {
        // Ignore
      }
    };

    es.onerror = () => {
      // Reconnect after 5 seconds
      setTimeout(() => {
        es.close();
      }, 5000);
    };

    return () => es.close();
  }, []);
}
