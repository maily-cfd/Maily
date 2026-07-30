"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../components/ui/theme-provider";
import { OfflineToast } from "../components/offline-toast";
import { Toaster } from "../components/ui/sonner";
import { DashboardSettingsProvider } from "../lib/DashboardSettingsContext";
import { ArcusCommandPalette } from "../components/ui/arcus-command-palette";
import { SoundSystem } from "../components/ui/sound-system";
import { LenisProvider } from "../components/providers/LenisProvider";

const queryClient = new QueryClient();

export default function Providers({ children }) {
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
            <SoundSystem />
            <ArcusCommandPalette />
            <OfflineToast />
            <Toaster position="top-center" theme="dark" closeButton />
          </DashboardSettingsProvider>
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
