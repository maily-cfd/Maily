import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog | Maily",
  description: "What shipped in Maily — new capabilities, fixes, and improvements to your inbox employee.",
  alternates: { canonical: "https://maily.cfd/changelog" },
  openGraph: {
    title: "Changelog | Maily",
    description: "What shipped in Maily — new capabilities, fixes, and improvements.",
    url: "https://maily.cfd/changelog",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Maily changelog" }],
  },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
