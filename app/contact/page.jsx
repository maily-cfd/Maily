"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FloatingNavbar } from '@/components/FloatingNavbar';
import {
  Send,
  Mail,
  MessageSquare,
  User,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  HelpCircle,
  FileText,
  Zap,
  Shield,
  Clock,
  Youtube
} from 'lucide-react';

// Custom X (Twitter) Icon
const XIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);


const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

const supportOptions = [
  {
    icon: MessageSquare,
    title: "Send a message",
    description: "Can't find what you need? Message us directly.",
    href: "#contact-form",
    color: "from-gray-500/15 to-gray-400/10"
  },
  {
    icon: HelpCircle,
    title: "FAQs",
    description: "Find quick answers to common questions.",
    href: "#",
    color: "from-gray-500/15 to-gray-400/10"
  },
  {
    icon: Zap,
    title: "Feature Requests",
    description: "Suggest new features or vote on existing ideas.",
    href: "#",
    color: "from-gray-500/15 to-gray-400/10"
  },
  {
    icon: Shield,
    title: "Security",
    description: "Report security concerns or vulnerabilities.",
    href: "#",
    color: "from-gray-500/15 to-gray-400/10"
  }
];

const contactMethods = [
  {
    icon: Mail,
    label: "Email us",
    value: "support.maily@gmail.com",
    description: "We reply within 24 hours",
    href: "mailto:support.maily@gmail.com"
  },
  {
    icon: Clock,
    label: "Live chat",
    value: "Replies within 24-48 business hours",
    description: "Connect with our team",
    href: "#"
  }
];

const socialLinks = [
  { icon: XIcon, href: "https://x.com/Mailycfd", label: "X" }
];

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setError('');

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        setStatus('success');
        setFormData({ name: '', email: '', subject: '', message: '' });
      } else {
        setStatus('error');
        setError(data.error || 'Failed to send message');
      }
    } catch (err) {
      setStatus('error');
      setError('An unexpected error occurred. Please try again.');
    }
  };

  return (
    <main className="min-h-screen bg-black text-white overflow-hidden strichpunkt-theme">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gray-800/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gray-700/5 rounded-full blur-[150px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gray-600/[0.02] rounded-full blur-[180px]" />
      </div>

      <div className="relative z-10">
        {/* Header Section */}
        <section className="pt-24 pb-12 px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-4xl mx-auto text-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.08] backdrop-blur-sm mb-8"
            >
              <Sparkles className="w-4 h-4 text-white/60" />
              <span className="text-sm text-white/60">We&apos;re here to help</span>
            </motion.div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight mb-6">
              <span className="bg-gradient-to-b from-white via-white/90 to-white/60 bg-clip-text text-transparent">
                Get in touch
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-white/40 max-w-2xl mx-auto leading-relaxed">
              Have a question about Mailient? Our team is ready to help you 
              streamline your email workflow and never miss a deal again.
            </p>
          </motion.div>
        </section>

        {/* Support Options Grid */}
        <section className="py-12 px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {supportOptions.map((option, index) => (
              <motion.a
                key={option.title}
                href={option.href}
                variants={fadeInUp}
                transition={{ delay: index * 0.1 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                className="group relative p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] backdrop-blur-sm transition-all duration-300"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${option.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <option.icon className="w-6 h-6 text-white/80" />
                </div>
                <h3 className="text-lg font-medium text-white mb-2">{option.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{option.description}</p>
              </motion.a>
            ))}
          </motion.div>
        </section>

        {/* Main Content: Form + Contact Methods */}
        <section className="py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
            {/* Contact Form */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="lg:col-span-3"
            >
              <div className="relative p-8 sm:p-10 rounded-3xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-sm">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                
                <div className="relative">
                  <AnimatePresence mode="wait">
                    {status === 'success' ? (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="text-center py-12"
                      >
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", duration: 0.5 }}
                          className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center"
                        >
                          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                        </motion.div>
                        <h3 className="text-2xl font-semibold text-white mb-3">Message Sent</h3>
                        <p className="text-white/40 max-w-sm mx-auto mb-8">
                          Thank you for reaching out. We&apos;ll get back to you within 24 hours.
                        </p>
                        <button
                          onClick={() => setStatus('idle')}
                          className="px-6 py-3 rounded-xl bg-white/[0.05] border border-white/[0.1] text-white/80 hover:bg-white/[0.08] hover:border-white/[0.15] transition-all duration-300"
                        >
                          Send another message
                        </button>
                      </motion.div>
                    ) : (
                      <motion.form
                        key="form"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onSubmit={handleSubmit}
                        className="space-y-6"
                      >
                        <div className="flex items-center gap-3 mb-8">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-500/15 to-gray-400/10 flex items-center justify-center">
                            <MessageSquare className="w-5 h-5 text-white/70" />
                          </div>
                          <div>
                            <h2 className="text-xl font-medium text-white">Send us a message</h2>
                            <p className="text-sm text-white/40">We&apos;ll respond as soon as possible</p>
                          </div>
                        </div>

                        {status === 'error' && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 flex items-center gap-3"
                          >
                            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                            <p className="text-sm text-red-200/70">{error}</p>
                          </motion.div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Name</label>
                            <input
                              type="text"
                              required
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              placeholder="John Doe"
                              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-white/20 focus:border-white/[0.2] focus:bg-white/[0.05] transition-all duration-300 outline-none"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Email</label>
                            <input
                              type="email"
                              required
                              value={formData.email}
                              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                              placeholder="john@company.com"
                              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-white/20 focus:border-white/[0.2] focus:bg-white/[0.05] transition-all duration-300 outline-none"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Subject</label>
                          <input
                            type="text"
                            required
                            value={formData.subject}
                            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                            placeholder="How can we help?"
                            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-white/20 focus:border-white/[0.2] focus:bg-white/[0.05] transition-all duration-300 outline-none"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium text-white/50 uppercase tracking-wider">Message</label>
                          <textarea
                            required
                            rows={5}
                            value={formData.message}
                            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                            placeholder="Tell us more about your inquiry..."
                            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-white/20 focus:border-white/[0.2] focus:bg-white/[0.05] transition-all duration-300 outline-none resize-none"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={status === 'loading'}
                          className="w-full py-4 rounded-xl bg-white text-black font-medium hover:bg-white/90 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {status === 'loading' ? (
                            <div className="w-5 h-5 border-2 border-black/20 border-t-black animate-spin rounded-full" />
                          ) : (
                            <>
                              <span>Send Message</span>
                              <Send className="w-4 h-4" />
                            </>
                          )}
                        </button>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>

            {/* Contact Methods Sidebar */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="lg:col-span-2 space-y-6"
            >
              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider mb-6">Contact us directly</h3>
                <div className="space-y-4">
                  {contactMethods.map((method, index) => (
                    <motion.a
                      key={method.label}
                      href={method.href}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + index * 0.1 }}
                      className="group flex items-start gap-4 p-4 rounded-xl hover:bg-white/[0.03] transition-all duration-300"
                    >
                      <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0 group-hover:bg-white/[0.08] transition-colors">
                        <method.icon className="w-5 h-5 text-white/60" />
                      </div>
                      <div>
                        <p className="text-xs text-white/40 mb-1">{method.label}</p>
                        <p className="text-sm font-medium text-white mb-1">{method.value}</p>
                        <p className="text-xs text-white/30">{method.description}</p>
                      </div>
                    </motion.a>
                  ))}
                </div>
              </div>

              {/* Social Links */}
              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <h3 className="text-sm font-medium text-white/60 capitalize tracking-wider mb-4">Join us</h3>
                <div className="flex gap-3">
                  {socialLinks.map((social) => (
                    <a
                      key={social.label}
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center hover:bg-white/[0.1] hover:scale-110 transition-all duration-300"
                      aria-label={social.label}
                    >
                      <social.icon className="w-5 h-5 text-white/60" />
                    </a>
                  ))}
                </div>
              </div>

            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-20 px-6 border-t border-zinc-900 z-10 relative bg-zinc-950">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-white rounded flex items-center justify-center">
                <Mail className="w-4 h-4 text-black" />
              </div>
              <span className="font-bold tracking-tight text-white">Mailient</span>
            </div>
            <div className="flex gap-8 text-sm font-bold text-zinc-400 uppercase tracking-widest">
              <a href="https://x.com/Mailycfd" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Twitter</a>
              <a href="/privacy-policy" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="/terms-of-service" className="hover:text-white transition-colors">Terms of Service</a>
            </div>

          </div>
          <div className="flex justify-center pt-10 text-zinc-500 text-xs text-center max-w-2xl mx-auto">
            <p>
              Maily is a free, open source project. All claims and features are based on real product functionality. View source at github.com/maily-cfd/Maily.
            </p>
          </div>
          <div className="pt-20 -mb-20 flex justify-center opacity-[0.03] select-none pointer-events-none w-full overflow-hidden">
            <span className="text-[15vw] md:text-[22vw] font-black uppercase tracking-tighter leading-none text-white whitespace-nowrap">
              mailient
            </span>
          </div>
        </footer>
      </div>
      <FloatingNavbar />
    </main>
  );
}
