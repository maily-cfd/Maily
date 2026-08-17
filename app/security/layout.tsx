import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security — we can't read your email | Maily",
  description:
    "Your emails are encrypted in your browser before they leave it (AES-256). Personal data is stripped before any AI sees it. Never used to train models. Architecture, not a promise.",
  alternates: { canonical: "https://maily.cfd/security" },
  openGraph: {
    title: "Security — we can't read your email | Maily",
    description:
      "Encrypted in your browser. Stripped before AI sees it. Never used for training. Architecture, not a promise.",
    url: "https://maily.cfd/security",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Maily security" }],
  },
};

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
