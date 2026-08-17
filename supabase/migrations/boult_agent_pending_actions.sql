-- Migration: arcus_agent_pending_actions
-- Stores write actions that a background agent wanted to execute, but were
-- intercepted because skip_confirmations was false.

CREATE TABLE IF NOT EXISTS public.arcus_agent_pending_actions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id uuid NOT NULL REFERENCES public.arcus_agents(id) ON DELETE CASCADE,
    run_id text NOT NULL,
    user_id text NOT NULL,
    tool_name text NOT NULL,
    tool_input jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    resolved_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS arcus_agent_pending_actions_run_id_idx ON public.arcus_agent_pending_actions(run_id);
CREATE INDEX IF NOT EXISTS arcus_agent_pending_actions_user_id_idx ON public.arcus_agent_pending_actions(user_id);
CREATE INDEX IF NOT EXISTS arcus_agent_pending_actions_agent_id_idx ON public.arcus_agent_pending_actions(agent_id);

ALTER TABLE public.arcus_agent_pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own pending actions"
    ON public.arcus_agent_pending_actions FOR SELECT
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can update their own pending actions"
    ON public.arcus_agent_pending_actions FOR UPDATE
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');
