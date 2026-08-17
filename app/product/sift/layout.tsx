import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sift — only the emails that deserve your attention | Maily",
  description:
    "Maily reads everything and surfaces the deals, decisions, and real requests. Newsletters and noise never reach you. You read almost nothing.",
  alternates: { canonical: "https://maily.cfd/product/sift" },
  openGraph: {
    title: "Sift — only the emails that deserve your attention | Maily",
    description:
      "It reads everything. You read almost nothing. Deals, decisions, and real requests surface; noise disappears.",
    url: "https://maily.cfd/product/sift",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Sift — only what needs you" }],
  },
};

export default function SiftLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
