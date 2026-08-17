import React from "react";
import Link from "next/link";
import { BlogLayout } from "@/components/BlogLayout";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "How AI Learns to Write Exactly Like You // Maily Blog",
  description: "Generic AI drafts damage relationships. Learn how Maily's 90-day voice analysis builds a writing profile that mirrors your tone, sign-offs, and sentence patterns.",
  openGraph: {
    title: "How AI Learns to Write Exactly Like You // Maily Blog",
    description: "Generic AI drafts damage relationships. Learn how Maily's 90-day voice analysis builds a writing profile that mirrors your tone, sign-offs, and sentence patterns.",
    url: "https://maily.dev/blogs/ai-learns-your-writing-style",
    type: "article",
    publishedTime: "2026-05-22T00:00:00.000Z",
    authors: ["Maily"],
  },
  twitter: {
    card: "summary_large_image",
    title: "How AI Learns to Write Exactly Like You // Maily Blog",
    description: "Generic AI drafts damage relationships. Learn how Maily's 90-day voice analysis builds a writing profile that mirrors your tone, sign-offs, and sentence patterns.",
  },
};

const meta = {
  title: "How AI Learns to Write Exactly Like You: Inside Maily's Neural Voice Profile",
  description: "Generic AI drafts damage relationships. Learn how Maily's 90-day voice analysis builds a writing profile that mirrors your tone, sign-offs, and sentence patterns.",
  date: "May 22, 2026",
  readTime: "7 min read",
  category: "Engineering",
  slug: "ai-learns-your-writing-style",
  author: "Maily",
};

const tableOfContents = [
  { id: "generic-problem", label: "The Generic Draft Problem" },
  { id: "what-voice-captures", label: "What a Voice Profile Captures" },
  { id: "90-day-analysis", label: "The 90-Day Analysis" },
  { id: "before-after", label: "The Difference It Makes" },
  { id: "privacy-of-voice", label: "Privacy of Voice Data" },
];

const relatedPosts = [
  {
    title: "Zero-Knowledge Encryption Explained: How Maily Protects Your Email Without Reading It",
    slug: "zero-knowledge-encryption-email-privacy",
    category: "Security",
    readTime: "8 min read",
  },
  {
    title: "Why Founders Lose Deals in Their Inbox (And How to Fix It)",
    slug: "founders-lose-deals-inbox",
    category: "Productivity",
    readTime: "7 min read",
  },
];

export default function AILearnsWritingStylePage() {
  return (
    <BlogLayout meta={meta} tableOfContents={tableOfContents} relatedPosts={relatedPosts}>
      <p>
        You've probably experienced it. An AI tool drafts an email for you and the result sounds like a corporate press release — polished, professional, and completely unlike anything you would actually write. Your colleagues notice. Your clients notice. The draft ends up being more work to fix than writing from scratch.
      </p>
      <p>
        This is the fundamental failure of generic AI email drafting. It optimizes for "correct" writing when what actually matters is <em>recognizable</em> writing — replies that sound so naturally like you that the recipient can't tell the difference.
      </p>

      <hr />

      <h2 id="generic-problem">Why Generic AI Drafts Fail</h2>
      <p>
        Most AI writing tools work by predicting statistically likely text based on a prompt. When you ask them to write an email, they produce the average of all the emails they've been trained on. The result is technically competent but personally empty — a composite of thousands of writing styles that sounds like nobody in particular.
      </p>
      <p>
        The problem compounds in professional contexts. People you email regularly have an intuitive sense of how you write. They know whether you start with "Hey" or "Hi", whether you use formal closings or casual ones, whether you write in long paragraphs or short bursts. When an email from you suddenly sounds different — more verbose, more corporate, more "AI-generated" — it creates a subtle but real erosion of trust.
      </p>
      <p>
        For founders and consultants whose relationships are built on personal trust, this isn't a cosmetic issue. A reply that sounds generic signals that you didn't care enough to write it yourself. The irony is that you're using AI precisely because you <em>do</em> care — you want to respond quickly and thoughtfully — but the tool undermines the very thing you're trying to preserve.
      </p>

      <hr />

      <h2 id="what-voice-captures">What a Voice Profile Actually Captures</h2>
      <p>
        Maily's Neural Voice Profile is built by analyzing the specific patterns that make your writing yours. These aren't superficial style preferences — they're the deep structural signatures that define your communication identity.
      </p>

      <h3>Greeting Patterns</h3>
      <p>
        How you open an email says a lot about your communication style. Some people always write "Hey Sarah," while others use "Hi Sarah —" or simply start with the message. Maily tracks which greeting styles you use with different types of contacts — more formal with new connections, more casual with established ones.
      </p>

      <h3>Sentence Structure and Length</h3>
      <p>
        Some writers favor short, direct sentences. Others construct longer, more flowing paragraphs. Your average sentence length, your use of em dashes versus commas, your tendency toward active or passive voice — these are all quantifiable patterns that distinguish your writing from someone else's.
      </p>

      <h3>Tone Calibration by Relationship</h3>
      <p>
        The way you write to a potential investor is different from how you write to a close collaborator. Maily's voice analysis recognizes these contextual shifts. It measures your formality bias — the percentage of your emails that use formal language versus casual — and adjusts the generated tone based on the recipient and thread context.
      </p>

      <h3>Sign-Off Signatures</h3>
      <p>
        "Best," "Thanks," "Looking forward to it," "Cheers," or no sign-off at all. Your preferred valediction is one of the most recognizable elements of your email voice. Maily identifies your most common sign-offs and applies them contextually — matching the tone of the conversation.
      </p>

      <h3>Vocabulary Preferences</h3>
      <p>
        Everyone has words they gravitate toward and words they avoid. You might say "sync" instead of "meeting," "deck" instead of "presentation," or "loop in" instead of "include." These lexical preferences are subtle but powerful markers of personal voice.
      </p>

      <hr />

      <h2 id="90-day-analysis">The 90-Day Analysis Process</h2>
      <p>
        When you connect Gmail to Maily, the voice profiling engine reads your last <strong>90 days of sent emails</strong>. This window is deliberate — it's long enough to capture a representative sample of your writing across different contexts, but recent enough to reflect how you write <em>now</em>, not how you wrote two years ago.
      </p>
      <p>
        The analysis happens entirely in your browser. Your sent emails are processed client-side, and the resulting voice profile is stored locally using <Link href="/blogs/zero-knowledge-encryption-email-privacy">Maily's zero-knowledge encryption</Link>. The profile never reaches Maily's servers.
      </p>
      <p>
        Here's what the process extracts:
      </p>
      <ul>
        <li><strong>Average message length</strong> — measured in words per message</li>
        <li><strong>Paragraph structure</strong> — how many paragraphs per email, average paragraph length</li>
        <li><strong>Formality distribution</strong> — percentage of formal vs. casual messages</li>
        <li><strong>Greeting/sign-off catalog</strong> — ranked by frequency and context</li>
        <li><strong>Vocabulary fingerprint</strong> — distinctive words and phrases you use regularly</li>
        <li><strong>Response patterns</strong> — how your style shifts between initiating emails and replying to threads</li>
      </ul>
      <p>
        The result is a semantic fingerprint of your writing voice — a set of parameters that every <Link href="/product/boult">Boult</Link>-generated draft is filtered through before it reaches your outbox.
      </p>

      <hr />

      <h2 id="before-after">The Difference It Makes</h2>
      <p>
        To illustrate the difference, consider a common scenario: a potential client asks about your availability for a meeting next week.
      </p>

      <h3>Without Voice Profile (Generic AI)</h3>
      <blockquote>
        Thank you for reaching out! I would be happy to schedule a meeting at your earliest convenience. Please let me know your availability, and I will coordinate accordingly. Looking forward to connecting with you.
      </blockquote>

      <h3>With Maily's Voice Profile</h3>
      <blockquote>
        Hey Sarah — Tuesday at 3 PM works great on my end. I've added a calendar invite with a Meet link. Looking forward to it.
      </blockquote>

      <p>
        The first version is correct but generic. It sounds like a template. The second version reflects an actual human writing style — direct, specific, and personal. It includes concrete availability (pulled from <Link href="/product/boult">Google Calendar integration</Link>), uses the greeting style the sender actually uses, and closes with their natural sign-off.
      </p>
      <p>
        Over time, the voice profile continues to refine itself as you send more emails and provide feedback on drafts. Each correction — shortening a paragraph, changing a word, adjusting tone — feeds back into the model's understanding of your voice.
      </p>

      <hr />

      <h2 id="privacy-of-voice">Privacy of Your Voice Data</h2>
      <p>
        Your voice profile is one of the most personal data structures Maily creates. It captures not just what you say, but how you say it — your communication identity distilled into parameters. Accordingly, it receives the highest level of privacy protection in the system.
      </p>
      <p>
        The voice profile is:
      </p>
      <ul>
        <li><strong>Generated client-side</strong> — your sent emails are analyzed in your browser, not on a server</li>
        <li><strong>Encrypted locally</strong> — stored using AES-256-GCM with keys that never leave your device</li>
        <li><strong>Never transmitted</strong> — the profile exists only on your machine</li>
        <li><strong>Never used for training</strong> — Maily does not use your voice data to train any AI model</li>
      </ul>
      <p>
        This means your writing voice remains yours. It's used to serve you — to write drafts that sound like you — and for nothing else. You can read more about Maily's full privacy architecture on the <Link href="/security">security page</Link>.
      </p>

      <div className="callout-box">
        <p>
          <strong>Your voice. Your replies. AI's work.</strong> Maily drafts emails that sound like you because it learned from you.{" "}
          <a href="/auth/signup">Start free trial →</a>
        </p>
      </div>
    </BlogLayout>
  );
}
