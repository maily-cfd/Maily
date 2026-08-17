/**
 * OAuth Callback Handler
 * 
 * Handles the OAuth callback from providers and completes the connection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ConnectorService } from '@/lib/boult-connector-service';
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
 * GET /api/connectors/callback
 * Handle OAuth callback from providers
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Handle OAuth errors
    if (error) {
      console.error('[OAuth Callback] Provider error:', error, errorDescription);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/connectors/error?error=${encodeURIComponent(error)}&description=${encodeURIComponent(errorDescription || '')}`
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/connectors/error?error=invalid_request&description=Missing code or state`
      );
    }

    // Process the callback
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/connectors/callback`;
    
    const result = await getConnectorService().handleCallback(state, code, redirectUri);

    if (result.success) {
      // Redirect to success page with account info
      const params = new URLSearchParams({
        connector: result.account.connectorId,
        email: result.account.email || ''
      });
      
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/connectors/success?${params.toString()}`
      );
    } else {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/connectors/error?error=connection_failed`
      );
    }

  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[OAuth Callback] Error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/connectors/error?error=server_error&description=${encodeURIComponent(error.message || '')}`
    );
  }
}

/**
 * POST /api/connectors/callback
 * Alternative callback method for providers that use POST
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, state } = body;

    if (!code || !state) {
      return NextResponse.json(
        { error: 'Missing code or state' },
        { status: 400 }
      );
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/connectors/callback`;
    const result = await getConnectorService().handleCallback(state, code, redirectUri);

    return NextResponse.json(result);

  } catch (error: any) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[OAuth Callback POST] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
