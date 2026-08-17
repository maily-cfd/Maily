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

export default function TermsOfService() {
  const currentDate = "2 July 2026";

  const sections: Section[] = [
    {
      id: 1,
      title: "1. Binding Agreement",
      content: (
        <div className="space-y-4">
          <p>These Terms of Use ("Terms") constitute a legally binding agreement between you ("User," "you") and Maily ("Maily," "we," "us," "our"). By accessing, registering for, or using our Services, you agree to be bound by these Terms.</p>
          <p>If you do not agree, you must immediately discontinue use.</p>
          <p>We reserve the right to refuse service to anyone at our sole discretion.</p>
        </div>
      )
    },
    {
      id: 2,
      title: "2. Eligibility and Authority",
      content: (
        <div className="space-y-4">
          <p>You must be at least 13 years old to use the Services. If you are under the legal age of majority, you confirm you have parental or guardian consent.</p>
          <p>You represent and warrant that:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>You have full legal capacity to enter this agreement;</li>
            <li>You are not barred from using the Services under applicable law;</li>
            <li>All information provided is accurate and current.</li>
          </ul>
          <p>We may suspend accounts that violate eligibility requirements.</p>
        </div>
      )
    },
    {
      id: 3,
      title: "3. Account Responsibility",
      content: (
        <div className="space-y-4">
          <p>You are solely responsible for:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Maintaining account confidentiality;</li>
            <li>All activities under your account;</li>
            <li>Ensuring secure access to connected services (e.g., email providers).</li>
          </ul>
          <p>We are not liable for unauthorized access resulting from your failure to secure credentials.</p>
        </div>
      )
    },
    {
      id: 4,
      title: "4. Nature of Services",
      content: (
        <div className="space-y-4">
          <p>Maily provides AI-assisted email productivity tools, including but not limited to:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Email prioritization;</li>
            <li>Draft generation;</li>
            <li>Workflow automation;</li>
            <li>Insights and analytics.</li>
          </ul>
          <p>The Services are provided as tools only. You retain full responsibility for reviewing and approving outputs.</p>
          <p>We may modify, suspend, or discontinue any feature at any time without liability.</p>
        </div>
      )
    },
    {
      id: 5,
      title: "5. Acceptable Use and Restrictions",
      content: (
        <div className="space-y-4">
          <p>You agree NOT to:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Use the Services for unlawful, fraudulent, or harmful activities;</li>
            <li>Access or attempt to access unauthorized systems;</li>
            <li>Reverse engineer, decompile, or extract source code;</li>
            <li>Use bots, scrapers, or automated extraction tools;</li>
            <li>Interfere with system integrity or performance;</li>
            <li>Upload malicious code or harmful data;</li>
            <li>Violate intellectual property rights;</li>
            <li>Use the Services to generate spam or deceptive communications.</li>
          </ul>
          <p>Violation may result in immediate suspension or permanent ban.</p>
        </div>
      )
    },
    {
      id: 6,
      title: "6. Data Access and Permissions",
      content: (
        <div className="space-y-4">
          <p>By connecting your email or third-party accounts, you grant Maily limited permission to access and process data strictly for:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Providing core functionality;</li>
            <li>Improving Services (never to train AI models on your content);</li>
            <li>Security and abuse prevention.</li>
          </ul>
          <p>We do NOT claim ownership of your data.</p>
          <p>You acknowledge:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Data processing is necessary for service functionality;</li>
            <li>Revoking access may limit or disable features;</li>
            <li>Third-party services operate under their own terms.</li>
          </ul>
        </div>
      )
    },
    {
      id: 7,
      title: "7. User Content and License",
      content: (
        <div className="space-y-4">
          <p>You retain ownership of all content you provide ("User Content").</p>
          <p>You grant Maily a worldwide, non-exclusive, royalty-free license to:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Process, store, and display content;</li>
            <li>Modify content for functionality (for example, drafting replies in your voice);</li>
            <li>Create anonymized and aggregated insights that cannot identify you.</li>
          </ul>
          <p>This license exists strictly to operate and improve the Services for you. It is never used to train AI models on your content, and it ends when you delete the content or close your account (except for insights already anonymized).</p>
        </div>
      )
    },
    {
      id: 8,
      title: "8. AI Disclaimer (Critical Clause)",
      content: (
        <div className="space-y-4">
          <p>Maily uses artificial intelligence systems which may produce:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Inaccurate or incomplete outputs;</li>
            <li>Misleading or unintended suggestions.</li>
          </ul>
          <p>You acknowledge and agree:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>AI outputs are NOT guaranteed to be correct;</li>
            <li>Outputs are NOT professional, legal, financial, or medical advice;</li>
            <li>You MUST independently verify all outputs before relying on them.</li>
          </ul>
          <p>Maily bears NO responsibility for decisions made using AI outputs.</p>
        </div>
      )
    },
    {
      id: 9,
      title: "9. Privacy and Data Handling",
      content: (
        <div className="space-y-4">
          <p>Use of the Services is also governed by our Privacy Policy.</p>
          <p>We implement reasonable safeguards but do NOT guarantee absolute security.</p>
          <p>You acknowledge:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Internet transmissions are inherently insecure;</li>
            <li>You use the Services at your own risk;</li>
            <li>We are not liable for unauthorized access beyond our control.</li>
          </ul>
        </div>
      )
    },
    {
      id: 10,
      title: "10. Payments and Billing",
      content: (
        <div className="space-y-4">
          <p>If applicable, you agree to:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Pay all fees in full and on time;</li>
            <li>Provide accurate billing details;</li>
            <li>Accept recurring billing where applicable.</li>
          </ul>
          <p>All payments are:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Non-refundable (unless required by law);</li>
            <li>Subject to pricing changes with notice.</li>
          </ul>
          <p>Free trials convert into paid subscriptions at the end of the trial period unless cancelled before the trial ends.</p>
          <p>We may suspend Services for non-payment.</p>
        </div>
      )
    },
    {
      id: 11,
      title: "11. Intellectual Property",
      content: (
        <div className="space-y-4">
          <p>All platform components (excluding User Content) are owned by Maily, including:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Software and algorithms;</li>
            <li>Design and branding;</li>
            <li>Infrastructure and systems.</li>
          </ul>
          <p>Unauthorized use is strictly prohibited.</p>
        </div>
      )
    },
    {
      id: 12,
      title: "12. Third-Party Integrations",
      content: (
        <div className="space-y-4">
          <p>Maily integrates with third-party providers.</p>
          <p>We are NOT responsible for:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Their availability;</li>
            <li>Their data handling;</li>
            <li>Their failures or breaches.</li>
          </ul>
          <p>Use of such services is at your own risk.</p>
        </div>
      )
    },
    {
      id: 13,
      title: "13. Termination Rights",
      content: (
        <div className="space-y-4">
          <p>We may suspend or terminate access at any time, with or without cause, including for:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Violations of Terms;</li>
            <li>Security concerns;</li>
            <li>Legal compliance requirements.</li>
          </ul>
          <p>Upon termination:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Access is revoked immediately;</li>
            <li>Data may be deleted without recovery;</li>
            <li>No liability is incurred by Maily.</li>
          </ul>
        </div>
      )
    },
    {
      id: 14,
      title: "14. Disclaimer of Warranties",
      content: (
        <div className="space-y-4">
          <p>THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE."</p>
          <p>We DISCLAIM ALL WARRANTIES, INCLUDING:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>MERCHANTABILITY;</li>
            <li>FITNESS FOR A PARTICULAR PURPOSE;</li>
            <li>NON-INFRINGEMENT;</li>
            <li>ERROR-FREE OPERATION.</li>
          </ul>
          <p>We do NOT guarantee:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Continuous uptime;</li>
            <li>Accuracy of outputs;</li>
            <li>Data preservation.</li>
          </ul>
        </div>
      )
    },
    {
      id: 15,
      title: "15. Limitation of Liability (Strict)",
      content: (
        <div className="space-y-4">
          <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
          <p>Maily shall NOT be liable for:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Indirect, incidental, or consequential damages;</li>
            <li>Loss of profits, data, or business opportunities;</li>
            <li>Decisions made using AI outputs;</li>
            <li>Unauthorized access beyond reasonable control.</li>
          </ul>
          <p>TOTAL LIABILITY is strictly limited to the amount paid (if any) in the last 12 months.</p>
        </div>
      )
    },
    {
      id: 16,
      title: "16. Indemnification",
      content: (
        <div className="space-y-4">
          <p>You agree to indemnify and hold harmless Maily from any claims arising from:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Your use of the Services;</li>
            <li>Violation of these Terms;</li>
            <li>Breach of third-party rights.</li>
          </ul>
          <p>This includes legal fees and damages.</p>
        </div>
      )
    },
    {
      id: 17,
      title: "17. Security Disclaimer",
      content: (
        <div className="space-y-4">
          <p>While we follow industry practices, no system is fully secure.</p>
          <p>You accept:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Risk of cyber attacks;</li>
            <li>Risk of data exposure;</li>
            <li>Responsibility for your own security practices.</li>
          </ul>
        </div>
      )
    },
    {
      id: 18,
      title: "18. Service Availability",
      content: (
        <div className="space-y-4">
          <p>We may:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Interrupt Services for maintenance;</li>
            <li>Experience downtime;</li>
            <li>Change infrastructure without notice.</li>
          </ul>
          <p>No uptime guarantees are provided unless explicitly stated.</p>
        </div>
      )
    },
    {
      id: 19,
      title: "19. Modifications to Terms",
      content: (
        <div className="space-y-4">
          <p>We may update these Terms at any time.</p>
          <p>Continued use after updates = acceptance of revised Terms.</p>
        </div>
      )
    },
    {
      id: 20,
      title: "20. Governing Law and Jurisdiction",
      content: (
        <div className="space-y-4">
          <p>These Terms shall be governed by applicable laws.</p>
          <p>All disputes shall be subject to the exclusive jurisdiction of courts determined by Maily.</p>
        </div>
      )
    },
    {
      id: 21,
      title: "21. Dispute Resolution",
      content: (
        <div className="space-y-4">
          <p>Before legal action, parties agree to attempt resolution via:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Good-faith negotiation.</li>
          </ul>
          <p>We may require arbitration where legally enforceable.</p>
        </div>
      )
    },
    {
      id: 22,
      title: "22. Force Majeure",
      content: (
        <div className="space-y-4">
          <p>We are not liable for delays or failures caused by events beyond control, including:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>Natural disasters;</li>
            <li>Internet outages;</li>
            <li>Government actions;</li>
            <li>Cyber incidents.</li>
          </ul>
        </div>
      )
    },
    {
      id: 23,
      title: "23. Assignment",
      content: (
        <div className="space-y-4">
          <p>You may not transfer your rights.</p>
          <p>We may freely assign or transfer rights without restriction.</p>
        </div>
      )
    },
    {
      id: 24,
      title: "24. Feedback Usage",
      content: (
        <div className="space-y-4">
          <p>Any feedback provided becomes our property and may be used without compensation.</p>
        </div>
      )
    },
    {
      id: 25,
      title: "25. Entire Agreement",
      content: (
        <div className="space-y-4">
          <p>These Terms represent the entire agreement and override prior agreements.</p>
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
              Terms of Use
            </h1>
            <p className="text-sm font-semibold tracking-wide text-neutral-400 dark:text-neutral-500 uppercase">
              Last Updated: {currentDate}
            </p>
            <div className="h-px w-full bg-neutral-100 dark:bg-neutral-900 my-10" />
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

          {/* Section 26: Contact */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            className="group"
          >
            <h2 className="text-2xl font-bold text-black dark:text-white mb-6 tracking-tight">
              26. Contact
            </h2>
            <div className="text-[17px] leading-[1.7] text-neutral-600 dark:text-neutral-300 font-normal">
              <p>Email: <a href="mailto:support.maily@gmail.com" className="text-black dark:text-white font-medium underline underline-offset-4 decoration-neutral-300 dark:decoration-neutral-700 hover:decoration-black dark:hover:decoration-white transition-all">support.maily@gmail.com</a></p>
            </div>
          </motion.section>

          {/* FINAL ACKNOWLEDGMENT */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            className="pt-10 group"
          >
            <h2 className="text-2xl font-bold text-black dark:text-white mb-6 tracking-tight underline underline-offset-8 decoration-neutral-200 dark:decoration-neutral-800">
              FINAL ACKNOWLEDGMENT
            </h2>
            <div className="text-[17px] leading-[1.7] text-neutral-600 dark:text-neutral-300 font-normal space-y-4">
              <p>By using Maily, you confirm that:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>You understand these Terms;</li>
                <li>You accept all risks associated with AI systems;</li>
                <li>You agree to be legally bound.</li>
              </ul>
            </div>
          </motion.section>
        </div>

      </main>
      <Footer />

      <FloatingNavbar />

      <ProgressiveBlur position="top" backgroundColor="#000000" height="120px" blurAmount="10px" className="fixed z-40 animate-fade-in" />
      <ProgressiveBlur position="bottom" backgroundColor="#000000" height="80px" blurAmount="10px" className="fixed z-40 animate-fade-in" />
    </div>
  );
}