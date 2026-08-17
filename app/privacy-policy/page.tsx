"use client";

import React from "react";
import { motion } from "framer-motion";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { FloatingNavbar } from "@/components/FloatingNavbar";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { Footer } from "@/components/Footer";

interface Section {
  id: number;
  title: string;
  content: string | React.ReactNode;
}

export default function PrivacyPolicy() {
  const lastUpdated = "July 2, 2026";

  const sections: Section[] = [
    {
      id: 1,
      title: "1. Who we are",
      content: (
        <div className="space-y-4">
          <p>Maily is a free, open source AI email intelligence platform. Our service connects to your Gmail or Google Workspace account (with your explicit permission) to help you triage, summarize, draft, and manage email communications more efficiently.</p>
          <p>Contact: For all privacy-related inquiries, please reach out to us at <a href="mailto:support.maily@gmail.com" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">support.maily@gmail.com</a>.</p>
        </div>
      )
    },
    {
      id: 2,
      title: "2. Scope of this policy",
      content: (
        <div className="space-y-4">
          <p>This policy applies to:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>All users of the Maily website and web application at maily.dev</li>
            <li>Users who connect their Google or Google Workspace accounts to Maily</li>
            <li>Users of both the hosted and self-hosted versions of Maily</li>
            <li>Visitors who browse maily.dev without creating an account</li>
          </ul>
          <p>This policy does not apply to third-party websites, services, or applications that may be linked from our platform.</p>
        </div>
      )
    },
    {
      id: 3,
      title: "3. Information we collect",
      content: (
        <div className="space-y-6">
          <div>
            <h4 className="font-bold text-black dark:text-white mb-2">3.1 Account and identity information</h4>
            <p>When you sign up or log in via Google OAuth 2.0, we receive from Google: your full name, email address, and profile picture. We never receive or store your Google account password. Authentication is handled entirely and securely by Google's identity infrastructure.</p>
          </div>
          <div>
            <h4 className="font-bold text-black dark:text-white mb-2">3.2 Email data</h4>
            <p>To provide AI-powered inbox analysis, Maily accesses your Gmail data through the official Gmail API, using the scopes you explicitly grant during OAuth. This may include: email subject lines, sender and recipient addresses, timestamps, email body content (for analysis and drafting), and thread metadata. This data is processed in real time or near-real time to deliver features such as Maily Sift analysis, Boult AI queries, smart drafts, and email summaries.</p>
          </div>
          <div>
            <h4 className="font-bold text-black dark:text-white mb-2">3.3 Usage and analytics data</h4>
            <p>We collect anonymized usage data to improve our service. This includes: features used, frequency of use, session duration, error logs, and browser or device type. This data does not contain email content and cannot be linked back to specific emails.</p>
          </div>
          <div>
            <h4 className="font-bold text-black dark:text-white mb-2">3.4 Notes and user-generated content</h4>
            <p>If you use the Notes feature, the content of notes you create is stored to enable access across sessions. Notes may be shared in text or image format as you initiate.</p>
          </div>
          <div>
            <h4 className="font-bold text-black dark:text-white mb-2">3.5 Usage data</h4>
            <p>We may retain anonymized usage information to improve the product. No email content is included.</p>
          </div>
        </div>
      )
    },
    {
      id: 4,
      title: "4. How we use your information",
      content: (
        <div className="space-y-4">
          <p>We use the information we collect for the following purposes:</p>
          <div className="space-y-4">
            <div>
              <p className="font-bold text-black dark:text-white">Service delivery</p>
              <p>Powering AI inbox analysis, drafting, summaries, and smart triage via Sift and Boult.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white">Personalization</p>
              <p>Building your voice profile and relationship context so drafts and prioritization match how you actually write and who matters to you.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white">Product improvement</p>
              <p>Analyzing anonymized usage patterns to improve AI accuracy, feature quality, and reliability.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white">Security & compliance</p>
              <p>Detecting and preventing abuse, fraud, unauthorized access, and policy violations.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white">Support & communication</p>
              <p>Responding to support requests, sending essential service notifications, and providing updates.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white">Billing & subscriptions</p>
              <p>Managing your plan tier, usage limits, and processing subscription renewals or upgrades.</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 5,
      title: "5. What we do not do with your data",
      content: (
        <div className="space-y-6">
          <div className="flex gap-4 items-start pl-6">
            <div className="text-red-500 font-bold">✕</div>
            <p>We do not sell your personal data — ever. Your email content and identity information are not sold to advertisers, data brokers, or any third party.</p>
          </div>
          <div className="flex gap-4 items-start pl-6">
            <div className="text-red-500 font-bold">✕</div>
            <p>We do not use your data to train AI models — your email content is never used to train or improve any AI model: not ours, not our AI providers', not anyone's.</p>
          </div>
          <div className="flex gap-4 items-start pl-6">
            <div className="text-red-500 font-bold">✕</div>
            <p>We do not send emails on your behalf by default — every message requires your review and approval before it is sent. The only exception is a background agent that you have explicitly switched into autonomous mode; that is a per-agent choice you make deliberately, never a default.</p>
          </div>
          <div className="flex gap-4 items-start pl-6">
            <div className="text-red-500 font-bold">✕</div>
            <p>We do not store your passwords — authentication is handled entirely through Google OAuth 2.0; we never see or store your Google credentials.</p>
          </div>
          <div className="flex gap-4 items-start pl-6">
            <div className="text-red-500 font-bold">✕</div>
            <p>We do not serve advertisements — Maily is a subscription product and is not supported by advertising. We do not allow advertisers to target you based on your email content.</p>
          </div>
        </div>
      )
    },
    {
      id: 6,
      title: "6. Data security and encryption",
      content: (
        <div className="space-y-4">
          <p>We take the security of your data extremely seriously and have implemented multiple layers of protection:</p>
          <ul className="list-disc pl-5 space-y-4">
            <li><strong>AES-256 encryption:</strong> Sensitive metadata and stored data is encrypted using AES-256, a military-grade encryption standard. Your decryption keys reside in your browser and never transmit to our servers.</li>
            <li><strong>Zero-knowledge architecture:</strong> We store only encrypted blobs which we cannot read. Sensitive metadata is encrypted client-side before reaching our servers.</li>
            <li><strong>Google OAuth 2.0:</strong> We authenticate users via enterprise-grade Google OAuth 2.0. Access tokens are scoped, time-limited, and can be revoked by you at any time via your Google account settings.</li>
            <li><strong>Secure transmission:</strong> All data transmitted between your browser and our servers is encrypted via TLS (Transport Layer Security).</li>
            <li><strong>Access controls:</strong> Internal access to user data is strictly limited to systems that require it to deliver the service. No human team member routinely accesses your email content.</li>
            <li><strong>Breach notification:</strong> In the event of a data breach that affects your personal data, we will notify you and relevant regulatory authorities within the timeframes required by applicable law.</li>
          </ul>
        </div>
      )
    },
    {
      id: 7,
      title: "7. Google API services disclosure",
      content: (
        <div className="space-y-4">
          <p>Maily's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. This means:</p>
          <ul className="list-disc pl-5 space-y-3">
            <li>We only request the minimum permissions necessary to provide the features you use.</li>
            <li>Gmail data is used solely to deliver and improve Maily's core email features.</li>
            <li>We do not transfer Gmail data to third parties except as necessary to provide the service, or as required by law.</li>
            <li>We do not use Gmail data for serving advertisements or for any purpose other than providing and improving the Maily service.</li>
            <li>Humans at Maily do not read your Gmail messages unless you explicitly share them for support purposes or as required by law.</li>
            <li>You can revoke Maily's access to your Google account at any time by visiting <a href="https://myaccount.google.com/permissions" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">myaccount.google.com/permissions</a>.</li>
          </ul>
        </div>
      )
    },
    {
      id: 8,
      title: "8. Data retention",
      content: (
        <div className="space-y-4">
          <p>We retain your data only for as long as necessary to provide our service or as required by law:</p>
          <ul className="list-disc pl-5 space-y-3">
            <li>Email content and metadata accessed via the Gmail API is processed transiently and is not permanently stored on our servers beyond what is needed for the immediate analysis.</li>
            <li>Account information (name, email address) is retained for as long as your account is active.</li>
            <li>Notes you create are retained until you delete them or close your account.</li>
            <li>Usage analytics (anonymized) may be retained for up to 24 months for product development purposes.</li>
            <li>Billing records may be retained for up to 7 years as required by financial and tax regulations.</li>
            <li>Upon account deletion, we will delete or anonymize your personal data within 30 days, except where retention is required by law.</li>
          </ul>
        </div>
      )
    },
    {
      id: 9,
      title: "9. Sharing of information",
      content: (
        <div className="space-y-4">
          <p>We do not sell your personal data. We may share limited information only in the following circumstances:</p>
          <ul className="list-disc pl-5 space-y-4">
            <li><strong>Service providers:</strong> We may engage trusted third-party vendors (e.g., cloud hosting, payment processors, analytics tools) who process data on our behalf under contractual data processing agreements and are not permitted to use the data for their own purposes.</li>
            <li><strong>Legal compliance:</strong> We may disclose information if required to do so by applicable law, court order, or regulatory authority, or to protect the rights, property, or safety of Maily, our users, or the public.</li>
            <li><strong>Business transfers:</strong> In the event of a merger, acquisition, or sale of assets, your data may be transferred. We will notify you before your data is transferred and becomes subject to a different privacy policy.</li>
          </ul>
          <p>We never share your Gmail data or email content with third parties for advertising, profiling, or any commercial purpose beyond service delivery.</p>
        </div>
      )
    },
    {
      id: 10,
      title: "10. Your rights and choices",
      content: (
        <div className="space-y-6">
          <p>Regardless of where you are located, you have the following rights regarding your personal data:</p>
          <div className="space-y-4">
            <div>
              <p className="font-bold text-black dark:text-white tracking-tight">Access</p>
              <p>Request a copy of the personal data we hold about you.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white tracking-tight">Correction</p>
              <p>Request correction of inaccurate or incomplete information.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white tracking-tight">Deletion</p>
              <p>Request deletion of your personal data (right to be forgotten).</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white tracking-tight">Portability</p>
              <p>Receive your data in a structured, machine-readable format.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white tracking-tight">Objection</p>
              <p>Object to certain types of processing, including profiling.</p>
            </div>
            <div>
              <p className="font-bold text-black dark:text-white tracking-tight">Revocation of consent</p>
              <p>Withdraw access permissions granted to Maily at any time.</p>
            </div>
          </div>
          <p>To exercise any of these rights, contact us at <a href="mailto:support.maily@gmail.com" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">support.maily@gmail.com</a>. We will respond within 30 days. You may also revoke Google access permissions at any time via your Google account settings at <a href="https://myaccount.google.com/permissions" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">myaccount.google.com/permissions</a>.</p>
        </div>
      )
    },
    {
      id: 11,
      title: "11. Cookies and tracking technologies",
      content: (
        <div className="space-y-4">
          <p>Maily uses minimal cookies and similar technologies to operate the service:</p>
          <ul className="list-disc pl-5 space-y-3">
            <li><strong>Essential cookies:</strong> Required to maintain your login session and ensure the application functions correctly. These cannot be disabled without breaking the service.</li>
            <li><strong>Cookieless analytics:</strong> We use anonymized, aggregated analytics (e.g., page views, feature usage) to understand how Maily is used — configured to run without setting tracking cookies or storing tracking identifiers in your browser. No email content is included in these analytics.</li>
          </ul>
          <p>We do not set advertising cookies, cross-site tracking cookies, or analytics tracking cookies, and we do not use third-party behavioral tracking technologies.</p>
          <p>You can manage or delete cookies via your browser settings. Disabling essential cookies will prevent you from using the application.</p>
        </div>
      )
    },
    {
      id: 12,
      title: "12. International data transfers",
      content: (
        <div className="space-y-4">
          <p>Maily is operated globally and your data may be processed in countries other than your country of residence. We ensure that any international transfer of personal data is subject to appropriate safeguards in accordance with applicable data protection laws, including standard contractual clauses or equivalent measures where required. By using Maily, you acknowledge that your data may be transferred to and processed in countries with different data protection standards than your own.</p>
        </div>
      )
    },
    {
      id: 13,
      title: "13. Third-party services and integrations",
      content: (
        <div className="space-y-4">
          <p>Maily integrates with or relies on the following categories of third-party services:</p>
          <ul className="list-disc pl-5 space-y-4">
            <li><strong>Google (Gmail API & OAuth):</strong> Core to our service. Google's privacy policy governs their data handling at <a href="https://policies.google.com/privacy" className="hover:text-black dark:hover:text-white transition-colors">policies.google.com/privacy</a>.</li>
            <li><strong>Payment processors:</strong> Used to handle subscription payments. They do not receive your email content.</li>
            <li><strong>Cloud infrastructure providers:</strong> Used to host and operate our service securely.</li>
            <li><strong>AI model providers:</strong> We may use AI APIs to power features such as drafting and summarization. Any data sent is subject to data processing agreements and is not used for model training on our users' data.</li>
          </ul>
          <p>We carefully vet all third-party processors and ensure they operate under data processing agreements consistent with this Privacy Policy.</p>
        </div>
      )
    },
    {
      id: 14,
      title: "14. Changes to this policy",
      content: (
        <div className="space-y-4">
          <p>We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make material changes, we will:</p>
          <ul className="list-disc pl-5 space-y-3">
            <li>Update the "Last Updated" date at the top of this policy</li>
            <li>Notify you by email or in-app notification for significant changes</li>
            <li>Where required by law, seek your renewed consent before the changes take effect</li>
          </ul>
          <p>We encourage you to review this policy periodically. Continued use of Maily after changes are posted constitutes your acceptance of the updated policy.</p>
        </div>
      )
    },
    {
      id: 15,
      title: "15. Contact us",
      content: (
        <div className="space-y-2">
          <p className="font-bold text-black dark:text-white">Maily Intelligence</p>
          <p>Email: <a href="mailto:support.maily@gmail.com" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">support.maily@gmail.com</a></p>
          <p>Website: <a href="https://maily.dev" className="hover:text-black dark:hover:text-white transition-colors">maily.dev</a></p>
          <p>X / Twitter: <a href="https://x.com/Mailycfd" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">@Mailycfd on X</a></p>
          <p>GitHub: <a href="https://github.com/maily-cfd/Maily" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">github.com/maily-cfd/Maily</a></p>
        </div>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-[#1a1a1a] dark:text-[#fafafa] font-sans strichpunkt-theme selection:bg-neutral-200 dark:selection:bg-neutral-800 transition-colors duration-500">
      
      {/* Top Header with Theme Toggle */}
      <div className="fixed top-8 right-8 z-50">
        <AnimatedThemeToggler className="bg-white/80 dark:bg-black/80 backdrop-blur-md shadow-sm border border-neutral-200 dark:border-neutral-800" />
      </div>

      <main className="max-w-[720px] mx-auto pt-40 pb-48 px-6">
        
        <header className="mb-20">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-black dark:text-white mb-6">
              Privacy Policy
            </h1>
            <p className="text-sm font-semibold tracking-wide text-neutral-400 dark:text-neutral-500 uppercase">
              Last Updated: {lastUpdated}
            </p>
            <div className="h-px w-full bg-neutral-100 dark:bg-neutral-900 my-10" />
            <p className="text-[17px] leading-[1.7] text-neutral-600 dark:text-neutral-400">
                This Privacy Policy describes how Maily Intelligence ("Maily," "we," "us," or "our") collects, uses, stores, and protects your personal information when you use our email intelligence platform at maily.dev. By using Maily, you agree to the practices described in this policy.
            </p>
          </motion.div>
        </header>

        <div className="space-y-20">
          {sections.map((section) => (
            <motion.section
              key={section.id}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              className="group"
            >
              <h2 className="text-2xl font-bold text-black dark:text-white mb-6 tracking-tight">
                {section.title}
              </h2>
              <div className="text-[17px] leading-[1.7] text-neutral-600 dark:text-neutral-300 font-normal">
                {section.content}
              </div>
            </motion.section>
          ))}
        </div>

      </main>
      <Footer />

      <FloatingNavbar />

      <ProgressiveBlur position="top" backgroundColor="#000000" height="120px" blurAmount="10px" className="fixed z-40 animate-fade-in" />
      <ProgressiveBlur position="bottom" backgroundColor="#000000" height="80px" blurAmount="10px" className="fixed z-40 animate-fade-in" />
    </div>
  );
}
