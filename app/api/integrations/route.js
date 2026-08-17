/**
 * Integration Status API
 * 
 * Phase 4: API routes for integration management
 * GET /api/integrations/status - Get all integration statuses
 * GET /api/integrations/:provider/status - Get specific integration status
 * POST /api/integrations/:provider/execute - Execute integration action
 * GET /api/integrations/:provider/auth - Get OAuth URL
 * POST /api/integrations/:provider/callback - OAuth callback
 * DELETE /api/integrations/:provider - Disconnect integration
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BoultIntegrationManager } from '@/lib/boult-integration-manager';
import { supabase } from '@/lib/supabase';
import { logEvent } from "@/lib/logsso";

// Database wrapper for integration manager
const db = {
  async storeIntegrationCredentials(userEmail, provider, credentials) {
    const { error } = await supabase
      .from('integration_credentials')
      .upsert({
        user_email: userEmail,
        provider,
        access_token: credentials.accessToken,
        refresh_token: credentials.refreshToken,
        expires_at: credentials.expiresAt,
        scopes: credentials.scopes,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_email,provider'
      });
    
    if (error) throw error;
  },

  async getIntegrationCredentials(userEmail, provider) {
    const { data, error } = await supabase
      .from('integration_credentials')
      .select('*')
      .eq('user_email', userEmail)
      .eq('provider', provider)
      .single();
    
    if (error || !data) return null;
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      scopes: data.scopes || []
    };
  },

  async deleteIntegrationCredentials(userEmail, provider) {
    const { error } = await supabase
      .from('integration_credentials')
      .delete()
      .eq('user_email', userEmail)
      .eq('provider', provider);
    
    if (error) throw error;
  },

  async logIntegrationEvent(userEmail, provider, event, metadata = {}) {
    await supabase
      .from('integration_events')
      .insert({
        user_email: userEmail,
        provider,
        event,
        metadata,
        created_at: new Date().toISOString()
      });
  },
 
  async logIntegrationEvent(userEmail, provider, event, metadata = {}) {
    const { error } = await supabase
      .from('integration_events')
      .insert({
        user_email: userEmail,
        provider,
        event,
        metadata,
        created_at: new Date().toISOString()
      });
    
    if (error) console.error('Failed to log integration event:', error);
  }
};

// Initialize integration manager
const integrationManager = new BoultIntegrationManager(db);

/**
 * GET /api/integrations/status
 * Get all integration statuses for current user
 */
export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userEmail = session.user.email;
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');

    // Get specific provider status
    if (provider) {
      const status = await integrationManager.getIntegrationStatus(userEmail, provider);
      return NextResponse.json({ 
        provider,
        ...status,
        actions: integrationManager.getProviderActions(provider)
      });
    }

    // Get all integration statuses
    const statuses = await integrationManager.getAllIntegrationStatuses(userEmail);
    
    // Add available actions for each integration
    const integrationsWithActions = Object.entries(statuses.integrations).map(([key, status]) => ({
      ...status,
      actions: integrationManager.getProviderActions(key)?.actions || []
    }));

    return NextResponse.json({
      ...statuses,
      integrations: integrationsWithActions
    });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Integrations API] Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch integration status',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/execute
 * Execute an integration action
 */
export async function POST(request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { provider, action, params, runId, executionId } = body;

    if (!provider || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, action' },
        { status: 400 }
      );
    }

    const userEmail = session.user.email;

    // Execute the action
    const result = await integrationManager.executeAction(
      userEmail,
      provider,
      action,
      params || {},
      { runId, executionId, userEmail }
    );

    // Log the execution
    await db.logIntegrationEvent(userEmail, provider, 'action_executed', {
      action,
      success: result.success,
      errorCode: result.error?.code
    });

    return NextResponse.json(result);
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Integrations API] Execute error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: error.message,
          category: 'internal_error',
          retryable: false
        }
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations - Disconnect integration
 */
// F6.1 — DEPRECATED. This handler used to only delete from
// integration_credentials, leaving boult_integrations and user_tokens
// rows orphaned — the chat layer kept seeing connectors as connected
// after the user disconnected. PART 24 introduced a unified endpoint at
// /api/boult/connectors/disconnect that deletes from all three stores
// with the conditional safeguard for shared Google tokens.
//
// This handler now proxies to that endpoint so any old call site keeps
// working but goes through the correct cleanup path. Log a deprecation
// warning so we can find and migrate callers, then delete this handler
// in a follow-up.
export async function DELETE(request) {
  console.warn('[DEPRECATED] DELETE /api/integrations — use POST /api/boult/connectors/disconnect instead.');
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 });
    }

    // Proxy to the unified endpoint with the same cookie/session.
    const origin = new URL(request.url).origin;
    const proxied = await fetch(`${origin}/api/boult/connectors/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward the session cookie so the unified endpoint's auth() succeeds.
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ provider }),
    });
    const body = await proxied.json().catch(() => ({}));
    if (!proxied.ok) {
      return NextResponse.json(
        { error: body.error || `Disconnect failed (${proxied.status})` },
        { status: proxied.status },
      );
    }
    return NextResponse.json({ success: true, message: `Disconnected ${provider}`, ...body });
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Integrations API] Disconnect error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect integration', details: error.message },
      { status: 500 }
    );
  }
}
