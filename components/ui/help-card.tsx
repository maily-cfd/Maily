'use client';
import { Mail } from "lucide-react";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, HelpCircle, BookOpen, Heart, MessageSquare, Send } from 'lucide-react';
import FAQs from './text-reveal-faqs';
import { toast } from 'sonner';

interface HelpCardProps {
    onClose: () => void;
}

export function HelpCard({ onClose }: HelpCardProps) {
    const [activeSection, setActiveSection] = useState<'faq' | 'guide' | 'founder' | 'feedback'>('faq');
    const [feedback, setFeedback] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSendFeedback = async () => {
        if (!feedback.trim()) {
            toast.error('Please enter your feedback');
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedback }),
            });

            if (response.ok) {
                toast.success('Feedback sent! Founder will reach out soon.');
                setFeedback('');
            } else {
                toast.error('Failed to send feedback');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    const sections = [
        { id: 'faq', label: 'FAQs', icon: HelpCircle },
        { id: 'guide', label: 'Pro Tips', icon: BookOpen },
        { id: 'founder', label: 'Founder', icon: Heart },
        { id: 'feedback', label: 'Feedback', icon: MessageSquare },
    ];

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 bg-black/80 backdrop-blur-md overflow-y-auto"
            onClick={onClose}
        >
            <motion.div 
                initial={{ scale: 0.98, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.98, opacity: 0, y: 10 }}
                className="w-full max-w-5xl h-[85vh] bg-white dark:bg-[#191919] rounded-[16px] shadow-[0_32px_128px_-16px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col md:flex-row border border-neutral-200 dark:border-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Sidebar */}
                <div className="w-full md:w-64 bg-neutral-50 dark:bg-[#292929] border-r border-neutral-100 dark:border-white/5 p-8 flex flex-col">
                    <div className="flex items-center gap-3 mb-12">
                        <div className="w-8 h-8 bg-black dark:bg-white rounded flex items-center justify-center">
                            <HelpCircle className="w-4 h-4 text-white dark:text-black" />
                        </div>
                        <h2 className="text-lg font-bold text-black dark:text-white uppercase tracking-tighter">Help Center</h2>
                    </div>

                    <nav className="flex-1 space-y-1">
                        {sections.map((section) => (
                            <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id as any)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 ${
                                    activeSection === section.id 
                                    ? 'bg-black text-white dark:bg-white dark:text-black shadow-lg font-bold' 
                                    : 'text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white hover:bg-black/5 dark:bg-white/5'
                                }`}
                            >
                                <section.icon className="w-4 h-4" />
                                <span className="text-sm">{section.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#191919]">
                    <header className="h-20 border-b border-neutral-100 dark:border-white/5 flex items-center justify-between px-10">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
                            {sections.find(s => s.id === activeSection)?.label}
                        </h3>
                        <button 
                            onClick={onClose}
                            className="p-2 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-full transition-colors"
                        >
                            <X className="w-5 h-5 text-neutral-600 hover:text-black dark:text-neutral-400 dark:hover:text-white" />
                        </button>
                    </header>

                    <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
                        <AnimatePresence mode="wait">
                            {activeSection === 'faq' && (
                                <motion.div 
                                    key="faq"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="w-full"
                                >
                                    <FAQs />
                                </motion.div>
                            )}

                            {activeSection === 'guide' && (
                                <motion.div 
                                    key="guide"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-12"
                                >
                                    <div>
                                        <h4 className="text-3xl font-bold text-black dark:text-white tracking-tighter mb-3">Power User Playbook.</h4>
                                        <p className="text-neutral-600 dark:text-neutral-500 text-base leading-relaxed max-w-xl">Advanced strategies and hidden shortcuts to maximize your daily output with Maily.</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-12 pb-12">
                                        {[
                                            { title: "Jump to Boult", desc: "Press ⌘K (Ctrl+K) from anywhere to focus the Boult chat input and start typing instantly." },
                                            { title: "Voice Profile", desc: "Boult analyzes your sent mail to match your tone and sign-offs — and keeps learning from the edits you make to its drafts." },
                                            { title: "Scheduled Agents", desc: "Set up background agents that run on their own schedule — like a morning inbox sweep — and report back to you." },
                                            { title: "Calendar Scheduling", desc: "Ask Boult to find open slots from your connected Google Calendar and draft a reply proposing times." },
                                            { title: "Drafts, Never Auto-Sent", desc: "Every reply Boult writes lands in your Gmail Drafts for approval. Nothing sends without you." },
                                            { title: "Sift Today", desc: "Sift surfaces the threads that actually need you on your home feed — and shows the reasoning behind each one." },
                                            { title: "Tone & Length", desc: "Tune Boult in Settings: tone (Direct / Balanced / Warm) and length (Brief / Normal / Detailed)." },
                                            { title: "Custom Instructions", desc: "Add standing instructions in Settings and Boult follows them on every task it runs." },

                                            { title: "Session Memory", desc: "Boult remembers context across a conversation, so follow-ups stay sharp without re-explaining." },
                                            { title: "Connected Tools", desc: "Link Google Calendar, Notion, and Slack so your agents can act and report across all of them." },
                                            { title: "Reads Attachments", desc: "Attach or paste text files and Boult reads them inline before it responds." },
                                            { title: "Thread Summaries", desc: "Ask Boult to condense a long thread — or several related ones — into a single brief." }
                                        ].map((tip, i) => (
                                            <div key={i} className="group">
                                                <div className="flex items-center gap-4 mb-3">
                                                    <span className="text-[11px] font-mono text-neutral-300 dark:text-neutral-700 font-bold tracking-widest uppercase">Tip {i + 1}</span>
                                                    <div className="h-[1px] flex-1 bg-neutral-100 dark:bg-white/5" />
                                                </div>
                                                <h5 className="font-bold text-base text-black dark:text-white mb-2 tracking-tight transition-colors">{tip.title}</h5>
                                                <p className="text-[14px] text-neutral-600 dark:text-neutral-500 leading-relaxed font-medium">{tip.desc}</p>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                            {activeSection === 'founder' && (
                                <motion.div 
                                    key="founder"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="max-w-2xl py-4"
                                >
                                    <div className="space-y-10 text-neutral-800 dark:text-neutral-300">
                                        <h4 className="text-5xl font-bold text-black dark:text-white tracking-tighter leading-none mb-12">The vision for Maily.</h4>
                                        
                                        <p className="text-xl leading-relaxed font-semibold dark:text-neutral-100 border-l-2 border-black dark:border-white pl-8 italic">
                                            &quot;I built Maily because I was tired of fighting my own inbox. It felt like every morning I was drowning in noise, missing opportunities that actually mattered.&quot;
                                        </p>
                                        
                                        <div className="space-y-8 text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
                                            <p>
                                                We built this app to be your second brain. Not another tool that demands your attention, but a partner that clears the path so you can focus on the work that truly moves the needle. Maily is about reclaiming your time and your sanity.
                                            </p>
                                            <p>
                                                The truth is, email was never designed for the scale of business we do today. It&apos;s a legacy system that we&apos;re trying to fix with modern intelligence. Every feature you see in Maily—from the way Boult drafts replies to how Sift identifies hot leads—is something I personally needed.
                                            </p>
                                            <p>
                                                We&apos;re just getting started. Every feature, every pixel, and every AI model we train is designed with one goal: making your life simpler. Thanks for joining us on this journey. It means the world to me.
                                            </p>
                                        </div>
                                        
                                        <div className="pt-12 flex items-center gap-8">
                                            <div className="w-20 h-20 rounded-full overflow-hidden grayscale border border-neutral-200 dark:border-white/10">
                                                <Mail className="w-full h-full p-1 text-inherit" />
                                            </div>
                                            <div>
                                                <div className="text-2xl font-bold dark:text-white tracking-tight">Maily Team</div>
                                                <div className="text-sm text-neutral-600 dark:text-neutral-500 font-mono tracking-widest uppercase mt-1">Founding Engineer & CEO</div>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {activeSection === 'feedback' && (
                                <motion.div 
                                    key="feedback"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-16 max-w-3xl"
                                >
                                    <div className="space-y-6">
                                        <h4 className="text-5xl font-bold text-black dark:text-white tracking-tighter leading-none">Help us build the future of intelligence.</h4>
                                        <p className="text-neutral-500 dark:text-neutral-400 text-xl leading-relaxed max-w-xl">
                                            Your feedback matters the most for us. Please input your valuable feedback on this. We&apos;ll try our whole heart to reach out to you as soon as possible.
                                        </p>
                                    </div>

                                    <div className="space-y-12 pb-12">
                                        <textarea
                                            value={feedback}
                                            onChange={(e) => setFeedback(e.target.value)}
                                            placeholder="Tell us what's on your mind... be brutally honest."
                                            className="w-full h-80 bg-transparent border-b border-neutral-100 dark:border-white/5 p-0 text-2xl text-black dark:text-white focus:outline-none focus:border-black dark:focus:border-white transition-all placeholder:text-neutral-200 dark:placeholder:text-neutral-800 font-bold resize-none leading-tight"
                                        />
                                        <button 
                                            onClick={handleSendFeedback}
                                            disabled={isSubmitting}
                                            className="w-full h-20 bg-black dark:bg-white text-white dark:text-black rounded-lg font-bold flex items-center justify-center gap-4 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-2xl"
                                        >
                                            {isSubmitting ? (
                                                <div className="w-8 h-8 border-3 border-white/30 border-t-white dark:border-t-black rounded-full animate-spin" />
                                            ) : (
                                                <>
                                                    <span className="text-2xl tracking-tighter">Submit Feedback</span>
                                                    <Send className="w-6 h-6 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
