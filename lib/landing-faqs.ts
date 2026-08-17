// Landing-page FAQs — single source of truth.
// Rendered by the landing accordion (client) AND serialized into FAQPage
// JSON-LD on the homepage (server), so copy edits update both.
export const landingFaqs: Array<{ q: string; a: string }> = [
  {
    q: "Is Maily free?",
    a: "Yes — Maily is completely free and open source. You can self-host it for free forever, or use the hosted version at no cost. The full product is available to everyone with no feature gating, no paid tiers, and no trial required.",
  },
  {
    q: "How is Maily different from Claude or ChatGPT connectors?",
    a: "Claude and ChatGPT connectors help when you open a chat and ask. Maily is an always-on inbox employee: it reads overnight, drafts in your voice, books meetings, and brings you one morning briefing — without you prompting it. Connectors are tools inside a conversation. Maily is the hire that runs while you sleep.",
  },
  {
    q: "Does Maily replace Gmail?",
    a: "No. Maily works on top of your existing Gmail account through a secure OAuth connection. Your emails still live in Gmail. Maily makes them intelligent. You can use both side by side or live entirely inside Maily — your choice."
  },
  {
    q: "How does Maily learn my writing style?",
    a: "When you connect Gmail, Maily reads your last 90 days of sent emails and learns how you write — your tone, your greeting style, your typical sign-off, how formal you are with different types of people. Every draft it writes sounds like you. It improves the more you use it."
  },
  {
    q: "Is my email data private?",
    a: "Yes — and not just as a policy. Your emails are encrypted inside your own browser using AES-256-GCM before they ever reach Maily's servers. Personal data is stripped before the AI processes anything. We cannot read your emails. That is an architecture decision, not a promise."
  },
  {
    q: "Can I self-host Maily?",
    a: "Absolutely. Maily is fully open source (github.com/maily-cfd/Maily) and designed to be self-hostable. Clone the repo, add your own API keys, and deploy to any server or platform that runs Next.js. Full setup instructions are in the README."
  },
  {
    q: "How long does setup take?",
    a: "About two minutes. Sign in with Google, connect Gmail, and you're in. Calendar, Slack, and Notion can be connected later from the app whenever you're ready — they're not required to begin."
  },
  {
    q: "Does Maily work for teams?",
    a: "Maily currently works best for individual founders and power users — one account, one Gmail. Multi-seat support is on the roadmap. If you need it sooner, reach out to us on X at @Mailycfd or open a GitHub discussion."
  },
  {
    q: "Who built Maily?",
    a: "Maily is a community-driven open source project. You can follow updates at @Mailycfd on X, star the repo at github.com/maily-cfd/Maily, or open an issue to contribute. The product exists because email overload is a real problem — and we're solving it together."
  }
];
