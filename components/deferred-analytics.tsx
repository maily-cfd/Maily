"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-M03D6M49N8";

/**
 * Loads gtag only after the page is idle — keeps ~180KB off the landing
 * critical path (PSI unused-JS). Marketing routes wait longer than app routes.
 */
export function DeferredAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const isMarketing =
      pathname === "/" ||
      pathname === "/pricing" ||
      pathname === "/security" ||
      pathname === "/changelog" ||
      pathname === "/contact" ||
      pathname === "/privacy-policy" ||
      pathname === "/terms-of-service" ||
      pathname === "/blogs" ||
      pathname?.startsWith("/product/") ||
      pathname?.startsWith("/blogs/");

    const inject = () => {
      if (cancelled || typeof window === "undefined") return;
      if (document.getElementById("ga-gtag")) return;

      window.dataLayer = window.dataLayer || [];
      function gtag(...args: unknown[]) {
        window.dataLayer.push(args);
      }
      window.gtag = gtag;
      gtag("consent", "default", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      });
      gtag("js", new Date());
      gtag("config", GA_ID);

      const s = document.createElement("script");
      s.id = "ga-gtag";
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
      document.head.appendChild(s);
    };

    const delayMs = isMarketing ? 6000 : 2500;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => {
        timeoutId = setTimeout(inject, delayMs);
      }, { timeout: delayMs + 2000 });
    } else {
      timeoutId = setTimeout(inject, delayMs);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [pathname]);

  return null;
}

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}
