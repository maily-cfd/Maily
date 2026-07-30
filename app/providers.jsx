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

/** App chrome that must not ship on marketing pages (unused JS + main-thread). */
const APP_ONLY_PREFIXES = [
  "/home-feed",
  "/dashboard",
  "/onboarding",
  "/settings",
  "/arcus",
  "/inbox",
  "/compose",
];

function isAppRoute(pathname) {
  if (!pathname) return false;
  return APP_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export default function Providers({ children }) {
  const pathname = usePathname();
  const loadAppChrome = isAppRoute(pathname);

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
