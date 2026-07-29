import Script from "next/script";
import "./globals.css";
import Providers from "./providers";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "Mailient — Runs your inbox while you build your company",
  description:
    "AI inbox employee for solo founders. Reads, prioritizes, drafts in your voice, books meetings — wake up to one morning briefing. 3-day free trial.",
  metadataBase: new URL('https://mailient.xyz'),
  alternates: { canonical: 'https://mailient.xyz' },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.png?v=10", type: "image/png" },
    ],
    shortcut: "/favicon.png?v=10",
    apple: "/apple-touch-icon.png?v=10",
  },
  openGraph: {
    title: "Mailient — Runs your inbox while you build your company",
    description:
      "AI inbox employee for solo founders. Reads, prioritizes, drafts in your voice, books meetings — wake up to one morning briefing. 3-day free trial.",
    url: "https://mailient.xyz",
    siteName: "Mailient",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Mailient — runs your inbox while you build your company.",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mailient — Runs your inbox while you build your company",
    description:
      "AI inbox employee for solo founders. Reads, prioritizes, drafts in your voice, books meetings — wake up to one morning briefing. 3-day free trial.",
    images: ["/og-image.png"],
  },
};


// Site-wide structured data. Only verifiable facts — no fabricated ratings
// or review counts. Prices must stay in sync with lib/subscription-service.js
// PLANS and the pricing page.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Mailient",
  url: "https://mailient.xyz",
  logo: "https://mailient.xyz/mailient-logo-v3.png",
  founder: { "@type": "Person", name: "Maulik", url: "https://x.com/maulik_5" },
  contactPoint: {
    "@type": "ContactPoint",
    email: "mailient.xyz@gmail.com",
    contactType: "customer support",
  },
  sameAs: ["https://x.com/maulik_5", "https://github.com/Maulik-gpt"],
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Mailient",
  url: "https://mailient.xyz",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI inbox employee for solo founders. Reads, prioritizes, drafts replies in your voice, books meetings — wake up to one morning briefing. 3-day free trial.",
  offers: [
    {
      "@type": "Offer",
      name: "Monthly",
      price: "29",
      priceCurrency: "USD",
      description: "3-day free trial, then $29/month. Cancel anytime.",
    },
    { "@type": "Offer", name: "Annual", price: "199", priceCurrency: "USD" },
    { "@type": "Offer", name: "Lifetime Founder", price: "499", priceCurrency: "USD" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
        />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var theme = localStorage.getItem('theme') || 'dark';
              var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
              if (isDark) {
                document.documentElement.classList.add('dark');
                document.documentElement.style.colorScheme = 'dark';
                document.documentElement.style.backgroundColor = '#000000';
              } else {
                document.documentElement.classList.remove('dark');
                document.documentElement.style.colorScheme = 'light';
                document.documentElement.style.backgroundColor = '#f7f8f8';
              }
            } catch(e) {}
          })();
        ` }} />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            window.addEventListener('error', function(e) {
              const target = e.target;
              if (target && target.tagName === 'SCRIPT' && target.src && (target.src.indexOf('/_next/static/') !== -1 || target.src.indexOf('/chunks/') !== -1)) {
                console.warn('Chunk loading failed:', target.src);
                window.location.reload();
              }
              if (e.message && (e.message.indexOf('ChunkLoadError') !== -1 || e.message.indexOf('loading chunk') !== -1)) {
                console.warn('ChunkLoadError caught:', e.message);
                window.location.reload();
              }
            }, true);
            window.addEventListener('unhandledrejection', function(e) {
              if (e.reason && (e.reason.name === 'ChunkLoadError' || (e.reason.message && (e.reason.message.indexOf('ChunkLoadError') !== -1 || e.reason.message.indexOf('loading chunk') !== -1)))) {
                console.warn('Unhandled ChunkLoadError caught:', e.reason);
                window.location.reload();
              }
            });
          })();
        ` }} />
        <Script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID || 'G-M03D6M49N8'}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            // Consent Mode v2 — default DENIED before config, so GA4 never sets
            // tracking cookies without opt-in. It still sends cookieless,
            // aggregated pings. If a consent banner is added later, call
            // gtag('consent','update',{...granted}) on accept.
            gtag('consent', 'default', {
              ad_storage: 'denied',
              ad_user_data: 'denied',
              ad_personalization: 'denied',
              analytics_storage: 'denied'
            });
            gtag('js', new Date());

            gtag('config', '${process.env.NEXT_PUBLIC_GA_ID || 'G-M03D6M49N8'}');
          `}
        </Script>
        <Script
          defer
          data-website-id="dfid_CFPVRrMW5ckOyKogWqzo9"
          data-domain="mailient.xyz"
          src="https://datafa.st/js/script.js"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@900,700,500,400,300,200,100&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Strichpunkt+Sans:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased satoshi-app bg-background text-foreground" data-new-gr-c-s-check-loaded="14.1258.0" data-gr-ext-installed="">
        {/* Launchit Badge for SEO Authority — must live in <body>: an <a> inside
            <head> is invalid HTML, gets hoisted by the browser, and the resulting
            hydration mismatch made React re-render the whole page on every load */}
        <a href="https://www.launchit.site/project/mailient" target="_blank" className="hidden" aria-hidden="true">
          <img src="/badges/featured-dark.svg" alt="Launched on Launchit" width="1" height="1" />
        </a>
        <Providers>
          {children}
          <Analytics />
        </Providers>
      </body>
    </html>
  );
}
