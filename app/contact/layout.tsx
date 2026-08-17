import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact | Maily",
  description: "Get in touch with the Maily team — open an issue on GitHub or reach us at @Mailycfd on X.",
  alternates: { canonical: "https://maily.dev/contact" },
  openGraph: {
    title: "Contact | Maily",
    description: "Get in touch with the Maily team — open an issue on GitHub or reach us at @Mailycfd on X.",
    url: "https://maily.dev/contact",
    images: [{ url: "/logo-maily.png", width: 1200, height: 630, alt: "Contact Maily" }],
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
