/**
 * usePlanModeBrief — Hook to fetch and manage Plan Mode daily briefs
 *
 * Fetches the latest plan_mode brief from the plans API,
 * and provides a trigger to generate a new one on demand.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BriefData } from '../components/PlanModeBrief';

interface UsePlanModeBriefReturn {
  brief: BriefData | null;
  briefDate: string | null;
  isLoading: boolean;
  error: string | null;
  generateNew: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePlanModeBrief(): UsePlanModeBriefReturn {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [briefDate, setBriefDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Fetch the latest brief
  const fetchLatestBrief = useCallback(async () => {
    try {
      const res = await fetch('/api/boult/v3/plans?mode=plan_mode&limit=1');
      if (!res.ok) {
        if (res.status === 401) return; // Not logged in
        throw new Error(`Failed: ${res.status}`);
      }

      const data = await res.json();
      const plans = data.plans || [];

      if (plans.length === 0) {
        if (isMounted.current) {
          setBrief(null);
          setBriefDate(null);
        }
        return;
      }

      const latestPlan = plans[0];
      
      // If the plan has brief data inline (from raw_llm_output), use it
      // Otherwise fetch the full plan detail which includes the brief
      let briefData: BriefData | null = null;

      if (latestPlan.brief) {
        briefData = latestPlan.brief as BriefData;
      } else {
        // Fetch full plan detail to get brief data
        const detailRes = await fetch(`/api/boult/v3/plans/${latestPlan.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          briefData = detail.brief as BriefData || null;

          // Fallback: try extracting from raw_llm_output
          if (!briefData && detail.raw_llm_output) {
            briefData = detail.raw_llm_output as BriefData;
          }
        }
      }

      if (isMounted.current) {
        setBrief(briefData);
        setBriefDate(latestPlan.created_at);
        setError(null);
      }
    } catch (err: any) {
      if (isMounted.current) {
        setError(err.message);
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchLatestBrief();
  }, [fetchLatestBrief]);

  // Generate a new brief via manual trigger
  const generateNew = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch('/api/boult/v3/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'plan_mode' }),
      });

      if (!res.ok) {
        throw new Error('Failed to trigger brief generation');
      }

      // Poll for the new brief (the queue processes async)
      // Wait a bit then start polling
      let attempts = 0;
      const maxAttempts = 20;
      const pollInterval = 3000; // 3 seconds

      const poll = async (): Promise<void> => {
        if (!isMounted.current) return;
        attempts++;

        await fetchLatestBrief();

        // Check if we got a new brief (the date should be recent)
        if (attempts < maxAttempts && isMounted.current) {
          // If the brief date is within the last 2 minutes, stop polling
          if (briefDate) {
            const briefTime = new Date(briefDate).getTime();
            const now = Date.now();
            if (now - briefTime < 2 * 60 * 1000) {
              setIsLoading(false);
              return;
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          return poll();
        }

        if (isMounted.current) {
          setIsLoading(false);
        }
      };

      // Start polling after a short delay for the queue to process
      await new Promise(resolve => setTimeout(resolve, 2000));
      await poll();

    } catch (err: any) {
      if (isMounted.current) {
        setError(err.message);
        setIsLoading(false);
      }
    }
  }, [fetchLatestBrief, briefDate]);

  return {
    brief,
    briefDate,
    isLoading,
    error,
    generateNew,
    refresh: fetchLatestBrief,
  };
}
