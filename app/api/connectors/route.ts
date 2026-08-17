/**
 * Connector API Routes
 * 
 * Handles OAuth initiation, callbacks, account management, and token refresh.
 * All real integrations (no Custom API or Custom MCP).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ConnectorService } from '@/lib/boult-connector-service';
import { 
  CONNECTOR_REGISTRY,
  CONNECTOR_STATUS,
  getAllConnectors,
  hasConnectedAccounts 
} from '@/lib/boult-connector-registry';
import { logEvent } from "@/lib/logsso";

// Lazy initialization - only create client when needed
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  
  return createClient(url, key);
}

function getConnectorService() {
  const supabase = getSupabaseClient();
  return new ConnectorService({ 
    db: supabase,
    supabase 
  });
}

/**
 * GET /api/connectors
 * List all available connectors and user's connected accounts
 */
export async function GET(request: NextRequest) {
  try {
    // Get user from auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const supabaseClient = getSupabaseClient();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get user's connected accounts
    const accounts = await getConnectorService().getUserAccounts(user.id);

    // Get all available connectors with connection status
    const allConnectors = getAllConnectors().map((connector: { id: string }) => {
      const connectedAccount = accounts.find((a: { connector_id: string }) => a.connector_id === connector.id);
      return {
        ...connector,
        connected: !!connectedAccount,
        accountId: connectedAccount?.id,
        status: connectedAccount?.status || 'disconnected',
        connectedEmail: connectedAccount?.email
      };
    });

    return NextResponse.json({
      connectors: allConnectors,
      connectedAccounts: accounts,
      hasConnections: hasConnectedAccounts(accounts)
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Connectors API] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/connectors/oauth
 * Initiate OAuth flow for a connector
 */
export async function POST(request: NextRequest) {
  try {
    // Get user from auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const supabaseClient = getSupabaseClient();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { connectorId, redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/connectors/callback` } = body;

    if (!connectorId || !(connectorId in CONNECTOR_REGISTRY)) {
      return NextResponse.json(
        { error: 'Invalid or missing connectorId' },
        { status: 400 }
      );
    }

    // Initiate OAuth
    const authUrl = await getConnectorService().initiateOAuth(connectorId, user.id, redirectUri);

    return NextResponse.json({
      success: true,
      oauthUrl: authUrl.oauthUrl,
      sessionId: authUrl.sessionId,
      state: authUrl.state
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Connectors API] OAuth initiation error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to initiate OAuth' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/connectors/:accountId
 * Disconnect a connected account
 */
export async function DELETE(request: NextRequest) {
  try {
    // Get user from auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];
    const supabaseClient = getSupabaseClient();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get accountId from URL
    const url = new URL(request.url);
    const accountId = url.pathname.split('/').pop();

    if (!accountId) {
      return NextResponse.json(
        { error: 'Missing accountId' },
        { status: 400 }
      );
    }

    // Disconnect account
    await getConnectorService().disconnectAccount(accountId, user.id);

    return NextResponse.json({
      success: true,
      message: 'Account disconnected successfully'
    });

  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Connectors API] Disconnect error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to disconnect account' },
      { status: 500 }
    );
  }
}
