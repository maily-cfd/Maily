/**
 * React Hook for Connectors
 * 
 * Manages connector state, OAuth flows, and UI integration.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  CONNECTOR_STATUS,
  hasConnectedAccounts,
  getConnectedConnectors 
} from '@/lib/boult-connector-registry';

interface ConnectedAccount {
  id: string;
  connectorId: string;
  status: string;
  email?: string;
  name?: string;
  connectedAt?: string;
  provider?: string;
}

interface UseConnectorsOptions {
  userId: string;
  supabase: any;
  onConnect?: (connectorId: string) => void;
  onDisconnect?: (accountId: string) => void;
  onError?: (error: Error) => void;
}

// UI connector id → real session-authed OAuth route segment
// (/api/integrations/{seg}/auth). The old /api/connectors/oauth route never
// existed and used Supabase bearer auth the NextAuth app doesn't have.
const PROVIDER_AUTH: Record<string, string> = {
  gcal: 'google_calendar',
  google_calendar: 'google_calendar',
  calendar: 'google_calendar',
  google_meet: 'google_meet',
  notion: 'notion',
  notion_calendar: 'notion_calendar',
  slack: 'slack',
  calcom: 'cal_com',
  cal_com: 'cal_com',
};

export function useConnectors(options: UseConnectorsOptions) {
  // `supabase` is still accepted in options for call-site compatibility, but
  // connector flows now use the NextAuth-session integrations endpoints.
  const { userId } = options;
  
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Load connected accounts
  const loadAccounts = useCallback(async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      setError(null);

      // Use the session-authed integrations status (NextAuth cookie) — the old
      // /api/connectors GET required a Supabase bearer token this app never has.
      const response = await fetch('/api/integrations/status');

      if (!response.ok) {
        throw new Error('Failed to load connectors');
      }

      const data = await response.json();
      const accounts: ConnectedAccount[] = (data.integrations || [])
        .filter((i: any) => i.connected)
        .map((i: any) => ({
          id: i.provider,
          connectorId: i.provider,
          provider: i.provider,
          status: 'connected',
        }));
      setConnectedAccounts(accounts);

    } catch (err) {
      setError(err as Error);
      options.onError?.(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, options]);

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Connect a connector via the real session-authed OAuth route. Opens the
  // popup synchronously (so it isn't blocked), points it at the provider's
  // auth URL, then polls status and auto-closes the popup once connected.
  const connect = useCallback(async (connectorId: string) => {
    if (!userId) return;

    const provider = PROVIDER_AUTH[connectorId];
    if (!provider) {
      const e = new Error(`Can't connect "${connectorId}" here yet.`);
      setError(e);
      options.onError?.(e);
      return;
    }

    // Cal.com cloud has NO OAuth app flow — it authenticates with a pasted API
    // key, so /api/integrations/cal_com/auth builds a client_id-less OAuth URL
    // that dead-ends on Cal.com's error page. Never open the popup for it; the
    // API-key panel (connectors-modal / integrations-modal) is the real path.
    if (provider === 'cal_com') {
      const e = new Error('Cal.com connects with an API key — open the connectors panel to paste it.');
      setError(e);
      options.onError?.(e);
      return;
    }

    setIsConnecting(connectorId);
    setError(null);

    const width = 500, height = 640;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open('about:blank', 'Connect Account', `width=${width},height=${height},left=${left},top=${top}`);
    if (!popup) {
      const e = new Error('Popup blocked. Please allow popups and try again.');
      setError(e);
      setIsConnecting(null);
      options.onError?.(e);
      return;
    }

    const isConnected = async (): Promise<boolean> => {
      try {
        const r = await fetch('/api/integrations/status');
        const j = r.ok ? await r.json() : { integrations: [] };
        return (j.integrations || []).some((i: any) => i.provider === provider && i.connected);
      } catch { return false; }
    };

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      setIsConnecting(null);
      loadAccounts();
      if (ok) options.onConnect?.(connectorId);
    };

    const poll = setInterval(async () => {
      if (await isConnected()) {
        try { if (!popup.closed) popup.close(); } catch { /* cross-origin */ }
        finish(true);
      } else if (popup.closed) {
        finish(await isConnected());
      }
    }, 1000);
    const timeout = setTimeout(() => finish(false), 180_000);

    try {
      const res = await fetch(`/api/integrations/${provider}/auth`);
      if (!res.ok) throw new Error('start failed');
      const { url } = await res.json();
      if (!url) throw new Error('no url');
      popup.location.href = url;
    } catch (err) {
      try { popup.close(); } catch { /* */ }
      setError(err as Error);
      options.onError?.(err as Error);
      finish(false);
    }
  }, [userId, loadAccounts, options]);

  // Disconnect an account (now: by connectorId, not accountId — so we can
  // hit the unified Boult disconnect endpoint which clears every store).
  // The legacy /api/connectors/{accountId} DELETE only touched one table,
  // so disconnecting Gmail from the UI left the row in integration_credentials
  // and user_tokens orphaned — the next chat turn would still think Gmail
  // was connected. Now we POST a provider to the new endpoint and it deletes
  // from boult_integrations + integration_credentials + (conditionally)
  // user_tokens, plus invalidates the scope-probe cache.
  const disconnect = useCallback(async (accountIdOrConnectorId: string) => {
    if (!userId) return;

    // Dynamic-import the toast so the hook stays UI-agnostic but the user
    // still gets visible feedback on success/failure. PART 68 — without a
    // toast the disconnect button was silently failing in some cases and
    // the user couldn't tell whether to click again or wait.
    const toastApi = await import('sonner').then(m => m.toast).catch(() => null);

    try {
      setError(null);

      // Resolve to a connectorId — the new endpoint takes provider, not
      // boult account id. The local state stores both, so we accept either.
      const account = connectedAccounts.find(
        a => a.id === accountIdOrConnectorId || a.connectorId === accountIdOrConnectorId,
      );
      const provider = account?.connectorId || accountIdOrConnectorId;
      const displayName = account?.name || provider;

      const response = await fetch('/api/boult/connectors/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody.error || `Failed to disconnect (status ${response.status})`;
        toastApi?.error(msg);
        throw new Error(msg);
      }

      // PART 68 — verify the delete actually freed the row. The server
      // returns deleted counts per table; a 200 with totalRows=0 means the
      // row wasn't under this user's key shape (legacy email vs Supabase
      // uuid). Surface that so the user knows to try a different path.
      const body = await response.json().catch(() => ({} as any));
      const totalRows = body.totalRows ?? 0;
      if (totalRows === 0) {
        toastApi?.warning(
          `Couldn't find a ${displayName} row to remove. The integration may already be cleared — refreshing the list now.`,
        );
      } else {
        toastApi?.success(`Disconnected ${displayName}.`);
      }

      // Local state — drop ANY account whose connectorId matches the provider.
      setConnectedAccounts(prev => prev.filter(a => a.connectorId !== provider));
      options.onDisconnect?.(accountIdOrConnectorId);
      // Refresh from server so anything we missed (other parallel rows) syncs.
      loadAccounts();
    } catch (err) {
      setError(err as Error);
      options.onError?.(err as Error);
      toastApi?.error(`Couldn't disconnect: ${(err as Error).message}`);
    }
  }, [userId, options, connectedAccounts, loadAccounts]);

  // Reconfigure / "Manage" — re-initiates OAuth for an already-connected
  // provider. Used when a connector's scopes expired or the user wants to
  // re-authorize. Same flow as connect() but the OAuth screen will show
  // the user the existing app permissions and let them grant any missing
  // scope (e.g. add Calendar after only granting Gmail).
  const reconfigure = useCallback(async (connectorId: string) => {
    return connect(connectorId);
  }, [connect]);

  // Dismiss banner
  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
    // Persist to localStorage
    localStorage.setItem('connectorBannerDismissed', 'true');
  }, []);

  // Check if banner was previously dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem('connectorBannerDismissed') === 'true';
    setBannerDismissed(dismissed);
  }, []);

  // Computed values
  const hasConnections = hasConnectedAccounts(connectedAccounts);
  const connectedWithInfo = getConnectedConnectors(connectedAccounts);

  return {
    // State
    connectedAccounts,
    isLoading,
    isConnecting,
    error,
    bannerDismissed,
    
    // Computed
    hasConnections,
    connectedWithInfo,
    connectedCount: connectedAccounts.filter(
      a => a.status === CONNECTOR_STATUS.CONNECTED
    ).length,
    
    // Actions
    connect,
    disconnect,
    reconfigure,
    dismissBanner,
    refresh: loadAccounts
  };
}

export default useConnectors;
