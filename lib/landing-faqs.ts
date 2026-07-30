// Landing-page FAQs — single source of truth.
// Rendered by the landing accordion (client) AND serialized into FAQPage
// JSON-LD on the homepage (server), so copy edits update both.
export const landingFaqs: Array<{ q: string; a: string }> = [
  {
    q: "Is there a free trial?",
    a: "Yes. The monthly plan starts with a 3-day free trial via Polar. A card is required to start checkout, but you are not charged during the trial. Cancel anytime before day 3 and you pay $0. After the trial it’s $29/month. Annual ($199/year) and Lifetime Founder ($499 once) skip the trial and bill immediately. Every plan includes the full product — no feature gating.",
  },
  {
    q: "How is Mailient different from Claude or ChatGPT connectors?",
    a: "Claude and ChatGPT connectors help when you open a chat and ask. Mailient is an always-on inbox employee: it reads overnight, drafts in your voice, books meetings, and brings you one morning briefing — without you prompting it. Connectors are tools inside a conversation. Mailient is the hire that runs while you sleep.",
  },
  {
    q: "Does Mailient replace Gmail?",
    a: "No. Mailient works on top of your existing Gmail account through a secure OAuth connection. Your emails still live in Gmail. Mailient makes them intelligent. You can use both side by side or live entirely inside Mailient — your choice."
  },
  {
    q: "How does Mailient learn my writing style?",
    a: "When you connect Gmail, Mailient reads your last 90 days of sent emails and learns how you write — your tone, your greeting style, your typical sign-off, how formal you are with different types of people. Every draft it writes sounds like you. It improves the more you use it."
  },
  {
    q: "Is my email data private?",
    a: "Yes — and not just as a policy. Your emails are encrypted inside your own browser using AES-256-GCM before they ever reach Mailient's servers. Personal data is stripped before the AI processes anything. We cannot read your emails. That is an architecture decision, not a promise."
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel during the 3-day trial and you won’t be charged. Monthly plan cancels at the end of your billing period. Annual plan can be cancelled anytime — you keep full access for the year you paid for. No retention calls. No dark patterns. One click in settings."
  },
  {
    q: "How long does setup take?",
    a: "About two minutes. Sign in with Google, connect Gmail, see a live scan of your inbox, then start the 3-day trial. Calendar, Slack, and Notion can be connected later from the app whenever you’re ready — they’re not required to begin."
  },
  {
    q: "Does Mailient work for teams?",
    a: "Mailient is built for solo founders — one founder, one Gmail, no team seats. Multi-seat support is on the roadmap. If you need it sooner, email Maulik directly at mailient.xyz@gmail.com."
  },
  {
    q: "Who built Mailient?",
    a: "Maulik — a 14-year-old founder who built Mailient because he watched smart people lose deals, miss opportunities, and burn hours on email every single day. The product exists because the problem is real. You can talk to him directly at @maulik_5 on X or mailient.xyz@gmail.com."
  }
];
