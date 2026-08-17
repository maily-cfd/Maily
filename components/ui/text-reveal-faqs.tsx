'use client'

import React from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import Link from 'next/link'
import { motion } from "framer-motion";

export default function FAQs() {
  const faqItems = [
    {
      id: 'item-1',
      question: 'What exactly is Maily?',
      answer: 'Maily is an AI-first email intelligence platform that works directly within your Gmail. It scans your inbox in real-time to identify high-value opportunities, pending tasks, and critical shifts in your business conversations.',
    },
    {
      id: 'item-2',
      question: 'How does Sift AI differ from standard search?',
      answer: "Standard search looks for keywords. Sift understands intent. It knows if a lead is 'cooling off', if a client is 'negotiating', or if a follow-up is 'overdue', even if those exact words aren't in the email.",
    },
    {
      id: 'item-3',
      question: 'What is Boult AI?',
      answer: 'Boult is your deep-thinking assistant. It can summarize complex threads, draft responses in your specific voice, and even coordinate your calendar to find open slots for meetings.',
    },
    {
      id: 'item-4',
      question: 'Is my email data secure?',
      answer: 'Security is a core priority. Maily connects to Gmail with scoped access you grant — and can revoke anytime. Email content is processed only when you trigger an AI action or run an agent, and your emails are never used to train models.',
    },
    {
      id: 'item-5',
      question: 'What is the "Mimic My Style" feature?',
      answer: 'Our AI analyzes your previously sent emails to adopt your tone, vocabulary, sign-offs, and even your use of emojis. This ensures that every AI-generated draft feels authentically like you.',
    },
    {
      id: 'item-6',
      question: 'How do I get Boult to schedule a meeting?',
      answer: 'Connect your Google Calendar, then just ask Boult in chat (e.g. “find a 30-min slot next week and draft a reply proposing times”). It reads your calendar and writes the reply for your approval — it never sends without you.',
    },

    {
      id: 'item-8',
      question: 'How much can I use on a paid plan?',
      answer: 'Paid plans (Monthly, Annual, and Lifetime) are unlimited — unlimited Boult runs, drafts, Sift analysis, summaries, and scheduled agents. There are no per-task credits to track.',
    },
    {
      id: 'item-9',
      question: 'Where do the replies Boult writes go?',
      answer: 'Every reply is saved straight to your Gmail “Drafts” folder for you to review, edit, and send. Maily never sends mail on your behalf without your approval.',
    },
    {
      id: 'item-10',
      question: 'Can I control Boult’s tone and length?',
      answer: 'Yes. In Boult Settings you can set the tone (Direct, Balanced, or Warm) and the length (Brief, Normal, or Detailed), and add standing custom instructions Boult follows on every task.',
    },
    {
      id: 'item-11',
      question: 'What do I get without a plan?',
      answer: 'Without an active plan, AI features (Boult, drafting, Sift, summaries, agents) are paused — you can still read and reply manually. Subscribe to unlock everything, unlimited.',
    },
    {
      id: 'item-12',
      question: 'Does Maily replace my Gmail app?',
      answer: "No, Maily enhances it. We provide a powerful overlay and intelligence layer, but your emails always live in Gmail. Any draft we create appears in your Gmail 'Drafts' folder.",
    },
    {
      id: 'item-13',
      question: 'How accurate is Sift’s detection?',
      answer: 'Sift reads context to flag what likely needs you, and it shows its reasoning so you can judge each call. It’s a strong first pass, not a replacement for your judgment — a quick human check is always worth it on anything important.',
    },
    {
      id: 'item-14',
      question: 'How do I manage my subscription?',
      answer: 'You can view, upgrade, or cancel your plan at any time through the Subscription tab in the Account Settings menu.',
    },
    {
      id: 'item-15',
      question: 'How can I get faster support?',
      answer: 'Pro users get priority access. For any issues, use the Feedback tab in this Help card or email our founder directly at support.maily@gmail.com.',
    },
  ];

  return (
    <section className="py-2">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-8 md:grid-cols-5 md:gap-12">
          <div className="md:col-span-2">
            <h2 className="text-foreground text-3xl font-bold dark:text-white">Product Help</h2>
            <p className="text-muted-foreground mt-4 text-balance text-sm leading-relaxed">
              Everything you need to know about navigating the Maily ecosystem.
            </p>
            <p className="text-neutral-600 dark:text-neutral-500 mt-6 hidden md:block text-xs uppercase tracking-widest font-bold">
               Expert Guidance
            </p>
          </div>

          <div className="md:col-span-3">
            <Accordion
              type="single"
              collapsible
              className="w-full"
            >
              {faqItems.map((item) => (
                <AccordionItem
                  key={item.id}
                  value={item.id}
                  className="border-b border-neutral-100 dark:border-white/5 py-1"
                >
                  <AccordionTrigger className="cursor-pointer text-sm font-semibold hover:no-underline dark:text-neutral-300 py-4">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-neutral-500 dark:text-neutral-400">
                    <BlurredStagger text={item.answer} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  )
}

export const BlurredStagger = ({
  text,
}: {
  text: string;
}) => {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.005,
      },
    },
  };
 
  const letterAnimation = {
    hidden: {
      opacity: 0,
      filter: "blur(4px)",
      y: 2
    },
    show: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0
    },
  };
 
  return (
    <div className="w-full">
      <motion.p
        variants={container}
        initial="hidden"
        animate="show"
        className="text-sm leading-relaxed break-words whitespace-normal text-neutral-500 dark:text-neutral-400"
      >
        {text.split("").map((char, index) => (
          <motion.span
            key={index}
            variants={letterAnimation}
            transition={{ duration: 0.2 }}
            className="inline-block"
          >
            {char === " " ? "\u00A0" : char}
          </motion.span>
        ))}
      </motion.p>
    </div>
  );
};
