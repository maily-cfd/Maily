import React from "react";
import Link from "next/link";
import { BlogLayout } from "@/components/BlogLayout";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zero-Knowledge Encryption Explained // Maily Blog",
  description: "Most AI email tools need to read your data to work. Maily doesn't. A deep dive into the architecture that keeps your inbox private.",
  openGraph: {
    title: "Zero-Knowledge Encryption Explained // Maily Blog",
    description: "Most AI email tools need to read your data to work. Maily doesn't. A deep dive into the architecture that keeps your inbox private.",
    url: "https://maily.dev/blogs/zero-knowledge-encryption-email-privacy",
    type: "article",
    publishedTime: "2026-05-23T00:00:00.000Z",
    authors: ["Maily"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Zero-Knowledge Encryption Explained // Maily Blog",
    description: "Most AI email tools need to read your data to work. Maily doesn't. A deep dive into the architecture that keeps your inbox private.",
  },
};

const meta = {
  title: "Zero-Knowledge Encryption Explained: How Maily Protects Your Email Without Reading It",
  description: "Most AI email tools need to read your data to work. Maily doesn't. A deep dive into the architecture that keeps your inbox private.",
  date: "May 23, 2026",
  readTime: "8 min read",
  category: "Security",
  slug: "zero-knowledge-encryption-email-privacy",
  author: "Maily",
};

const tableOfContents = [
  { id: "trust-problem", label: "The Trust Problem" },
  { id: "what-zero-knowledge-means", label: "What Zero-Knowledge Means" },
  { id: "maily-architecture", label: "Maily's Architecture" },
  { id: "what-server-never-sees", label: "What the Server Never Sees" },
  { id: "competitor-comparison", label: "How This Compares" },
  { id: "privacy-as-architecture", label: "Privacy as Architecture" },
];

const relatedPosts = [
  {
    title: "How AI Learns to Write Exactly Like You: Inside Maily's Neural Voice Profile",
    slug: "ai-learns-your-writing-style",
    category: "Engineering",
    readTime: "7 min read",
  },
  {
    title: "AI Email Agent vs. AI Email Assistant: What Actually Matters in 2026",
    slug: "ai-email-agent-vs-assistant",
    category: "Industry",
    readTime: "8 min read",
  },
];

export default function ZeroKnowledgeEncryptionPage() {
  return (
    <BlogLayout meta={meta} tableOfContents={tableOfContents} relatedPosts={relatedPosts}>
      <p>
        When you connect an AI tool to your email, you're handing it access to the most sensitive corpus of data in your professional life — contracts, financial discussions, legal negotiations, medical information, personal conversations. Every AI email tool asks for this access. Very few explain what they do with it once they have it.
      </p>
      <p>
        Maily is built on a different premise: <strong>the server should never be able to read your emails</strong>. Not as a policy choice. As an architectural constraint. Here's how it works and why it matters.
      </p>

      <hr />

      <h2 id="trust-problem">The Trust Problem with AI Email Tools</h2>
      <p>
        Most AI email products follow a straightforward pattern: your emails are sent to their servers, processed by their AI models, and the results are sent back to you. The encryption in transit (TLS) protects your data from third parties during transmission. But once your email arrives at the provider's server, it exists in plaintext — readable by the company, their employees, their AI training pipelines, and anyone who compromises their infrastructure.
      </p>
      <p>
        This is not a theoretical concern. In 2026, AI-powered phishing attacks have become sophisticated enough to bypass traditional email security. Data breaches at cloud providers expose millions of records every quarter. And the regulatory landscape is tightening — the EU, UK, and US are all pushing stricter requirements for how companies handle personal data.
      </p>
      <p>
        The core tension is this: <strong>AI email tools need access to your email content to provide useful features, but that access creates a trust dependency</strong>. You're trusting that the company won't misuse your data, won't get breached, won't sell your information, and won't use your emails to train their models. That's a lot of trust.
      </p>

      <hr />

      <h2 id="what-zero-knowledge-means">What "Zero-Knowledge" Actually Means</h2>
      <p>
        "Zero-knowledge" is a term borrowed from cryptography that describes a system where the service provider has zero knowledge of your data. Not "we choose not to look at it" — <strong>"we are structurally incapable of reading it."</strong>
      </p>
      <p>
        In a zero-knowledge architecture:
      </p>
      <ul>
        <li>Data is encrypted on your device <em>before</em> it reaches the server</li>
        <li>The encryption keys never leave your device</li>
        <li>The server stores only encrypted blobs that it cannot decrypt</li>
        <li>Even if the server is compromised, the attacker gets only encrypted data</li>
        <li>Even if served with a court order, the provider has no readable content to hand over</li>
      </ul>
      <p>
        This is fundamentally different from "encrypted at rest" — a phrase many companies use that simply means the data is encrypted on the server's hard drive. In that model, the company holds the decryption keys. They can decrypt your data whenever they choose. Zero-knowledge removes this option entirely.
      </p>

      <hr />

      <h2 id="maily-architecture">Maily's Client-Side Encryption Architecture</h2>
      <p>
        Maily implements zero-knowledge protection using <strong>AES-256-GCM encryption performed entirely in your browser</strong>. Here's the technical flow:
      </p>

      <h3>1. Email Processing Happens Locally</h3>
      <p>
        When you connect your Gmail account, Maily's processing engine runs inside your browser. Your emails are fetched via Google's OAuth API and processed client-side. The AI features — triage, draft generation, voice profiling — all operate on plaintext data that exists only in your browser's memory.
      </p>

      <h3>2. PII Sanitization Before AI Processing</h3>
      <p>
        Before any data is sent to AI models for processing, Maily strips personally identifiable information (PII) from the content. Names, email addresses, phone numbers, and other sensitive identifiers are replaced with anonymized tokens. The AI model processes the semantics of your email — the intent, tone, and context — without ever seeing the personal details.
      </p>

      <h3>3. AES-256-GCM Encryption for Local Cache</h3>
      <p>
        Any data that Maily stores locally (for performance and offline access) is encrypted using AES-256-GCM — the same encryption standard used by governments and financial institutions. GCM (Galois/Counter Mode) provides both confidentiality and integrity verification, meaning the data cannot be read <em>or</em> tampered with without the correct key.
      </p>

      <h3>4. Keys Stay With You</h3>
      <p>
        The encryption keys are derived from your session and never transmitted to Maily's servers. When your session ends, the keys are destroyed. There is no master key, no recovery key, no backdoor. If Maily's servers were compromised tomorrow, your email data would remain encrypted and unreadable.
      </p>

      <hr />

      <h2 id="what-server-never-sees">What the Server Never Sees</h2>
      <p>
        To be concrete about what Maily's server infrastructure does and does not have access to:
      </p>

      <div className="callout-box">
        <p><strong>The server never sees:</strong></p>
        <ul>
          <li>Your email content (subject lines, body text, attachments)</li>
          <li>Your contact information or address book</li>
          <li>Your calendar events or scheduling details</li>
          <li>Your Neural Voice Profile data</li>
          <li>Your AI-generated drafts</li>
        </ul>
      </div>

      <div className="callout-box">
        <p><strong>The server does handle:</strong></p>
        <ul>
          <li>Authentication (OAuth tokens for Google sign-in)</li>
          <li>Subscription and billing management</li>
          <li>Anonymized, aggregated usage metrics</li>
          <li>Application delivery (serving the web app itself)</li>
        </ul>
      </div>

      <p>
        This distinction matters because it defines the blast radius of any potential security incident. Even in the worst case — a complete server compromise — your email data remains protected because it was never there in the first place.
      </p>

      <hr />

      <h2 id="competitor-comparison">How This Compares to Other Email Tools</h2>
      <p>
        Most AI email tools fall into one of three categories when it comes to data handling:
      </p>

      <h3>Category 1: Full Server-Side Processing</h3>
      <p>
        Tools like Superhuman, Shortwave, and most AI email assistants process your email data entirely on their servers. Your emails exist in plaintext (or encrypted-at-rest, which is effectively the same from a trust perspective) on their infrastructure. This gives them maximum flexibility for AI features but requires maximum trust from the user.
      </p>

      <h3>Category 2: Privacy-First, No AI</h3>
      <p>
        Services like Proton Mail and Tuta Mail offer strong zero-knowledge encryption but intentionally limit AI features to preserve their privacy guarantees. If your primary concern is security and you don't need AI assistance, these are excellent choices.
      </p>

      <h3>Category 3: Client-Side AI with Zero-Knowledge Storage</h3>
      <p>
        This is where Maily operates. By running AI processing in the browser and encrypting any stored data client-side, Maily provides AI-powered email management without requiring the server to ever access your data. It's a harder engineering challenge — client-side processing is more constrained than server-side — but it eliminates the trust dependency entirely.
      </p>

      <hr />

      <h2 id="privacy-as-architecture">Privacy as Architecture, Not Policy</h2>
      <p>
        The core philosophical difference is this: <strong>privacy policies are promises; privacy architecture is mathematics</strong>.
      </p>
      <p>
        A privacy policy says "we won't read your data." A zero-knowledge architecture says "we <em>can't</em> read your data." The former depends on the company's continued good behavior, their employees' compliance, and their legal team's interpretation of edge cases. The latter is enforced by encryption that doesn't care about any of those variables.
      </p>
      <p>
        For professionals handling sensitive communications — founders discussing term sheets, lawyers exchanging privileged correspondence, consultants managing confidential client data — the difference between a promise and a proof is the difference between acceptable risk and unnecessary risk.
      </p>
      <p>
        Maily's <Link href="/security">security architecture</Link> is designed so that your trust in the product is based on verifiable technical constraints, not on believing a company's marketing copy. You can read more about the full security standard on our <Link href="/security">dedicated security page</Link>.
      </p>

      <div className="callout-box">
        <p>
          <strong>Your emails are your business.</strong> Maily is built to keep it that way.{" "}
          <a href="/auth/signup">Start free trial →</a>
        </p>
      </div>
    </BlogLayout>
  );
}
