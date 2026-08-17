import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Drafts — replies that sound like you | Maily",
  description:
    "It learns how you write from your last 90 days of sent mail and leaves ready-to-send replies in your Gmail drafts. You review and approve — nothing sends on its own.",
  alternates: { canonical: "https://maily.cfd/product/drafts" },
  openGraph: {
    title: "Drafts — replies that sound like you | Maily",
    description:
      "Replies learned from your own sent mail, waiting in your Gmail drafts. Approve in one click.",
    url: "https://maily.cfd/product/drafts",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Drafts — replies that sound like you" }],
  },
};

export default function DraftsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
