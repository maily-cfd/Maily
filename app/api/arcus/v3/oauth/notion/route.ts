/**
 * Boult V3 — Notion OAuth Flow
 * 
 * Initiates the Notion OAuth 2.0 flow.
 * Flow:
 *   1. GET /api/boult/v3/oauth/notion → Redirects to Notion consent screen
 *   2. Notion redirects back to /api/boult/v3/oauth/notion/callback
 *   3. We exchange code for access token, encrypt, and store.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '../../../../../../lib/auth.js';
import { logEvent } from "@/lib/logsso";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Determine callback URL based on environment
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const redirectUri = `${baseUrl}/api/boult/v3/oauth/notion/callback`;

    // Build Notion OAuth URL
    const params = new URLSearchParams({
      client_id: process.env.NOTION_CLIENT_ID || '',
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
      state,
    });

    const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?${params}`;

    // Store state in a cookie for validation on callback
    const response = NextResponse.redirect(notionAuthUrl);
    response.cookies.set('boult_notion_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });

    return response;
  } catch (error) {
    logEvent({ channel: "failures", event: "❌ API Error", description: String(error) });
    console.error('[Boult V3] Notion OAuth init error:', (error as Error).message);
    return NextResponse.redirect(new URL('/dashboard/agent-talk?error=oauth_init', request.url));
  }
}
