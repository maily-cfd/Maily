import { NextResponse } from 'next/server';

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const ref = request.nextUrl.searchParams.get('ref');

  // Redirect authenticated users away from the landing page to the app.
  // The session JWT carries Gmail tokens, so it often exceeds 4KB and gets
  // SPLIT into chunked cookies (`…session-token.0`, `.1`). Matching the exact
  // name missed those, leaving signed-in users stranded on the landing and the
  // "Sign in" button looping. Match the base name with an optional `.N` chunk.
  if (pathname === '/') {
    const sessionToken = request.cookies.getAll().some(
      (c) => /^(__Secure-)?next-auth\.session-token(\.\d+)?$/.test(c.name) && !!c.value,
    );

    if (sessionToken) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      const response = NextResponse.redirect(url);
      if (ref) response.cookies.set('mailient_referral', ref, { maxAge: 60 * 60 * 24 * 30, path: '/' });
      addSecurityHeaders(response);
      return response;
    }
  }

  // Skip middleware for auth routes, API routes, static files, and onboarding
  // Authentication and onboarding checks are handled at the page level
  // to avoid Edge runtime limitations with Node.js modules like crypto
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/request-access') ||
    pathname === '/'
  ) {
    if (ref) {
      const response = NextResponse.next();
      response.cookies.set('mailient_referral', ref, { maxAge: 60 * 60 * 24 * 30, path: '/' }); // 30 days
      addSecurityHeaders(response);
      return response;
    }
    const response = NextResponse.next();
    addSecurityHeaders(response);
    return response;
  }

  if (ref) {
    const response = NextResponse.next();
    response.cookies.set('mailient_referral', ref, { maxAge: 60 * 60 * 24 * 30, path: '/' });
    addSecurityHeaders(response);
    return response;
  }

  // All other routes pass through - auth checks happen at page level
  const response = NextResponse.next();
  addSecurityHeaders(response);
  return response;
}

/**
 * Add military-grade security headers to every response.
 * These headers are visible in browser dev tools and security scanners.
 */
function addSecurityHeaders(response) {
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');

  // Prevent MIME-type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Permissions Policy — restrict browser features
  response.headers.set('Permissions-Policy',
    'camera=(), microphone=(self), geolocation=(), interest-cohort=(), ' +
    'browsing-topics=(), payment=(self), usb=(), magnetometer=(), ' +
    'accelerometer=(), gyroscope=()'
  );

  // Cross-domain policy
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  // Download options (IE)
  response.headers.set('X-Download-Options', 'noopen');

  // Referrer Policy — don't leak full URL to third parties
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Cache control for sensitive pages
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  response.headers.set('Pragma', 'no-cache');

  return response;
}

// Configure which routes to run middleware on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
