import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@supabase/supabase-js', 'resend', 'svix'],
  transpilePackages: ['recharts', 'd3-array', 'd3-scale', 'victory-vendor'],
  // Tree-shake icon/motion barrels — cuts unused JS on the landing critical path.
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      '@radix-ui/react-icons',
    ],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'maily.cfd',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'xubohuah.github.io',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // PostHog reverse proxy configuration
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  
  // Security headers for Vault-Grade protection
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com https://*.vercel-scripts.com https://*.posthog.com https://*.google.com https://*.googleapis.com https://*.stripe.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://datafa.st https://*.cal.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' data: https: https://*.googleusercontent.com https://*.githubusercontent.com https://*.posthog.com https://*.cloudinary.com https://*.google-analytics.com; font-src 'self' https://fonts.gstatic.com data: https://api.fontshare.com https://cdn.fontshare.com; connect-src 'self' https://va.vercel-scripts.com https://*.vercel-scripts.com https://*.supabase.co https://*.openai.com https://*.openrouter.ai https://*.posthog.com https://*.stripe.com https://*.cal.com https://*.google-analytics.com https://*.analytics.google.com https://*.google.com https://*.datafa.st https://datafa.st; frame-src 'self' https://*.stripe.com https://*.google.com https://cap.so https://*.cal.com; worker-src 'self' blob:; base-uri 'self'; form-action 'self' https://*.google.com https://*.stripe.com;"
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=(), interest-cohort=(), browsing-topics=(), payment=(self), usb=(), magnetometer=(), accelerometer=(), gyroscope=()'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'X-Download-Options',
            value: 'noopen'
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none'
          }
        ],
      },
    ];
  },
};

export default nextConfig;
