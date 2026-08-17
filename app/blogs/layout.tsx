import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Platform Insights // Maily Blog",
  description: "Essays and guides on AI email agents, inbox triage, replies in your own voice, and email encryption — written by the founder building Maily.",
  metadataBase: new URL("https://maily.dev"),
  openGraph: {
    title: "Platform Insights // Maily Blog",
    description: "Essays and guides on AI email agents, inbox triage, replies in your own voice, and email encryption — written by the founder building Maily.",
    url: "https://maily.dev/blogs",
    siteName: "Maily",
    images: [
      {
        url: "/logo-maily.png",
        width: 1200,
        height: 630,
        alt: "Maily Blog — Platform Insights",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Platform Insights // Maily Blog",
    description: "Explore technical deep dives, engineering essays, and guides on autonomous AI email agents.",
    images: ["/logo-maily.png"],
  },
};

export default function BlogsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
