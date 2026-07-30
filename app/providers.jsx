"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { ThemeProvider } from "../components/ui/theme-provider";
import { OfflineToast } from "../components/offline-toast";
import { Toaster } from "../components/ui/sonner";
import { DashboardSettingsProvider } from "../lib/DashboardSettingsContext";
import { LenisProvider } from "../components/providers/LenisProvider";

const ArcusCommandPalette = dynamic(
  () => import("../components/ui/arcus-command-palette").then((m) => m.ArcusCommandPalette),
  { ssr: false }
);
const SoundSystem = dynamic(
  () => import("../components/ui/sound-system").then((m) => m.SoundSystem),
  { ssr: false }
);

const queryClient = new QueryClient();

const APP_ONLY_PREFIXES = [
  "/home-feed",
  "/dashboard",
  "/onboarding",
  "/settings",
  "/arcus",
  "/inbox",
  "/compose",
];

/** Public marketing routes — strip auth/query/settings chrome from the JS path. */
const MARKETING_EXACT = new Set([
  "/",
  "/pricing",
  "/security",
  "/changelog",
  "/contact",
  "/privacy-policy",
  "/terms-of-service",
  "/blogs",
]);

function isAppRoute(pathname) {
  if (!pathname) return false;
  return APP_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function isMarketingRoute(pathname) {
  if (!pathname) return false;
  if (MARKETING_EXACT.has(pathname)) return true;
  return pathname.startsWith("/product/") || pathname.startsWith("/blogs/");
}

export default function Providers({ children }) {
  const pathname = usePathname();
  const loadAppChrome = isAppRoute(pathname);
  const marketing = isMarketingRoute(pathname);

  // Landing / marketing: Theme only. No SessionProvider, React Query, or
  // dashboard settings — those were ~100KB+ of unused JS on mobile Lighthouse.
  if (marketing && !loadAppChrome) {
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <SessionProvider>
          <DashboardSettingsProvider>
            <LenisProvider>
              {children}
            </LenisProvider>
            {loadAppChrome && <SoundSystem />}
            {loadAppChrome && <ArcusCommandPalette />}
            <OfflineToast />
            <Toaster position="top-center" theme="dark" closeButton />
          </DashboardSettingsProvider>
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
