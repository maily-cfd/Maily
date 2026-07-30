"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ArrowRight, AlertCircle, Copy, ArrowLeft, Shield, ExternalLink, Building2, UserCog, CheckCircle2 } from 'lucide-react';
import { SignInLayout, GlassInputWrapper } from '@/components/ui/sign-in';

const PERSONAL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in',
  'outlook.com', 'hotmail.com', 'live.com', 'aol.com',
  'icloud.com', 'me.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'mail.com', 'yandex.com', 'gmx.com',
  'fastmail.com', 'tutanota.com', 'hey.com'
];

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

const ADMIN_EMAIL_TEMPLATE = `Subject: Approve Mailient for Google Workspace

Hi [Admin Name],

I'd like to use Mailient — an AI email assistant — with our Google Workspace.

It requires admin approval to connect. Here's what's needed:

1. Go to Google Admin → Security → API Controls
2. Select "Manage Third-Party App Access"
3. Add Mailient using Client ID: ${CLIENT_ID}
4. Set access to "Trusted"

It takes about 2 minutes. Mailient only requests read and send access to Gmail — no data is stored externally.

Thanks!`;

function SignUpContent() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [isWorkspace, setIsWorkspace] = useState(null);
  const [isGmail, setIsGmail] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);
  const emailInputRef = useRef(null);

  const onEmailChange = (value) => {
    setEmail(value);
    const trimmed = value.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setIsGmail(false);
      setIsWorkspace(null);
      setEmailDomain('');
      return;
    }
    const domain = trimmed.split('@')[1] || '';
    setEmailDomain(domain);
    setIsGmail(domain === 'gmail.com' || domain === 'googlemail.com');
    setIsWorkspace(!PERSONAL_DOMAINS.includes(domain));
  };

  const handleGoogleSignUp = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // COMPOSIO-AS-LOGIN: our own Google client never fires. The user
      // authenticates AND connects Gmail in one consent on Composio's verified
      // client; the callback mints the session and lands on onboarding.
      if (process.env.NEXT_PUBLIC_COMPOSIO_LOGIN === '1') {
        window.location.href = '/api/auth/composio-login/start';
        return;
      }
      // With Composio carrying only Gmail (not login), login is identity-only
      // and the Gmail grant is the next onboarding step.
      const composioGmail = process.env.NEXT_PUBLIC_COMPOSIO_GMAIL === '1';
      const hint = email.trim().toLowerCase();
      const signInOptions = {
        callbackUrl: composioGmail ? '/onboarding?step=2' : '/onboarding',
      };
      if (hint && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) {
        signInOptions.login_hint = hint;
      }
      const result = await signIn('google', signInOptions);
      if (result?.error) {
        handleAuthError(result.error);
        setIsLoading(false);
      }
    } catch (error) {
      setError("A connection error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  const handleAuthError = (errorType) => {
    switch (errorType) {
      case 'OAuthAccountNotLinked':
        setError("This email is already associated with an account.");
        break;
      case 'AccessDenied':
        setError("Access denied. Please grant permissions to continue.");
        break;
      default:
        setError("An authentication error occurred.");
    }
  };

  const copyToClipboard = (text, field) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2500);
    } catch (err) {
      setError("Failed to copy to clipboard.");
    }
  };

  const backToStep1 = () => {
    setStep(1);
    setError(null);
    setIsWorkspace(null);
    setIsGmail(false);
    setEmailDomain('');
    setShowAdminModal(false);
  };

  const StepIndicator = ({ currentStep }) => (
    <div className="flex items-center gap-2 mb-10">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div className={`
            w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium transition-all duration-500
            ${s < currentStep ? 'bg-zinc-900 text-white dark:bg-white dark:text-black' :
              s === currentStep ? 'bg-zinc-100 text-zinc-900 border border-zinc-200 dark:bg-white/10 dark:text-white dark:border-white/20' :
                'bg-zinc-50 text-zinc-400 border border-zinc-200 dark:bg-white/[0.03] dark:text-white/20 dark:border-white/[0.06]'}
          `}>
            {s < currentStep ? <Check className="w-3 h-3" strokeWidth={2.5} /> : s}
          </div>
          {s < 3 && (
            <div className={`w-8 h-px transition-all duration-500 ${s < currentStep ? 'bg-zinc-300 dark:bg-white/30' : 'bg-zinc-200 dark:bg-white/[0.06]'}`} />
          )}
        </div>
      ))}
    </div>
  );

  const GmailWarning = () => (
    <div className="p-4 bg-amber-500/[0.08] dark:bg-amber-500/[0.12] border border-amber-500/30 dark:border-amber-500/40 rounded-2xl mb-6">
      <div className="flex gap-3">
        <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" strokeWidth={2} />
        <div className="space-y-1">
          <h4 className="text-[12px] font-medium text-amber-700 dark:text-amber-300">Gmail notice</h4>
          <p className="text-[11px] text-amber-900/70 dark:text-amber-100/60 block leading-relaxed font-light tracking-tight">
            Mailient is optimized for <span className="text-zinc-900 dark:text-white font-semibold">Google Workspace</span>. 
            Personal accounts may experience limited functionality or security warnings.
          </p>
        </div>
      </div>
    </div>
  );

  const PremiumGoogleButton = () => (
    <button
      onClick={handleGoogleSignUp}
      disabled={isLoading}
      className="w-full h-14 bg-white text-black border border-zinc-200 dark:border-transparent rounded-2xl font-bold text-sm hover:bg-[#F5F5F5] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 shadow-sm dark:shadow-[0_20px_40px_rgba(255,255,255,0.1)] disabled:opacity-50 active:scale-[0.98]"
    >
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-black/20 border-t-black animate-spin rounded-full" />
      ) : (
        <>
          <div className="w-6 h-6 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          </div>
          <span>Continue with Google</span>
        </>
      )}
    </button>
  );

  const testimonials = [
    {
      avatarSrc: "/testimonials/john-oliver.png",
      name: "John Oliver",
      handle: "@joms0993",
      text: "I checked out your tool and it looks great. I think people would find a lot of value in it. The pricing is also very competitive compared to similar tools, which could make an easy choice for users."
    },
    // Honest pre-launch cards: product promises framed as artifacts, not
    // invented people. Swap in real founder quotes as they come in.
    {
      avatarSrc: "/mailient-logo-v3.png",
      name: "The Morning Brief",
      handle: "every day · 7:00 AM",
      text: "213 emails processed. 12 drafts in your voice. 3 meetings booked. 1 investor email needs you. Time returned: 2h 14m."
    },
    {
      avatarSrc: "/mailient-logo-v3.png",
      name: "What you're hiring",
      handle: "$29/mo — not $80k/yr",
      text: "An employee that reads every thread overnight, never misses a follow-up, and waits for your approval before anything sends."
    },
  ];

  return (
    <SignInLayout
      title="Create your account"
      description="Start your 3-day free trial. Mailient removes email from your to-do list — replies in your voice, meetings booked, follow-ups sent while you sleep."
      heroImageSrc="https://images.unsplash.com/photo-1642615835477-d303d7dc9ee9?w=2160&q=80"
      testimonials={testimonials}
    >
      <div className="w-full">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.4 }} className="space-y-6">
              <StepIndicator currentStep={1} />
              <div className="mb-6">
                <h2 className="text-foreground text-lg font-medium tracking-tight mb-2">Create account</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Continue with Google to start your <span className="text-foreground font-medium">3-day free trial</span>. Mailient needs Gmail access — there is no email/password signup.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-3 bg-red-500/5 border border-red-500/20 rounded-xl flex gap-3 items-center">
                  <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" strokeWidth={1.5} />
                  <p className="text-[11px] text-red-750 dark:text-red-200/60 font-medium tracking-tight">{error}</p>
                </div>
              )}

              {isGmail && email.includes('@') && <GmailWarning />}

              <PremiumGoogleButton />

              <p className="text-[11px] text-muted-foreground leading-relaxed text-center px-1">
                Next: pick your Google account, then approve Gmail for Mailient.
                Google may show a trusted partner screen (Composio) — that&apos;s expected and secure. Card required for the trial; you won&apos;t be charged for 3 days and can cancel anytime.
              </p>

              <div className="pt-2 space-y-2">
                <label className="text-[12px] text-zinc-500 dark:text-white/35 block">Optional — help Google pick the right account</label>
                <GlassInputWrapper>
                  <input
                    ref={emailInputRef}
                    type="email"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    placeholder="you@company.com (hint only)"
                    className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-foreground placeholder:text-zinc-400 dark:placeholder:text-white/10 font-medium"
                  />
                </GlassInputWrapper>
                <p className="text-[10px] text-zinc-500 dark:text-white/30 leading-relaxed">
                  This field does not sign you up. It only pre-fills which Google account to open.
                </p>
              </div>

              <div className="text-[12px] pt-2">
                <button type="button" onClick={() => router.push('/auth/signin')} className="text-zinc-400 hover:text-foreground transition-colors">
                  Already registered? <span className="text-zinc-500 dark:text-white/40 border-b border-zinc-300 dark:border-white/10 ml-1">Sign in</span>
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.4 }} className="space-y-6">
              <StepIndicator currentStep={3} />
              <button onClick={() => setStep(1)} className="flex items-center gap-2 text-zinc-400 hover:text-foreground dark:text-white/30 dark:hover:text-white transition-colors text-xs font-light mb-8 group w-fit">
                <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                Back to sign up
              </button>
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-50 border border-zinc-200 dark:bg-white/[0.06] dark:border-white/[0.1] flex items-center justify-center"><UserCog className="w-4 h-4 text-zinc-550 dark:text-white/60" /></div>
                  <h2 className="text-foreground text-base font-semibold tracking-tight">Admin Setup</h2>
                </div>
                <p className="text-muted-foreground text-[11px] font-light leading-relaxed tracking-tight">Approve Mailient for your workspace.</p>
              </div>

              <div className="space-y-4 mb-10">
                {[
                  { step: '1', title: 'Open Google Admin Console', desc: 'Navigate to Security → API Controls', link: 'https://admin.google.com/ac/owl/list?tab=configuredApps', linkText: 'Open Console' },
                  { step: '2', title: 'Add Mailient', desc: 'Search by Client ID:', copyable: CLIENT_ID },
                  { step: '3', title: 'Set to Trusted', desc: 'Select app and set to "Trusted".' }
                ].map((item, i) => (
                  <div key={i} className="p-4 bg-zinc-50 border border-zinc-200 dark:bg-white/[0.02] dark:border-white/[0.06] rounded-xl space-y-3 group hover:bg-zinc-100 dark:hover:bg-white/[0.04] transition-all">
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5 border border-zinc-200 dark:border-white/5"><span className="text-[9px] font-bold text-zinc-500 dark:text-white/50">{item.step}</span></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground text-[11px] font-semibold tracking-tight mb-1">{item.title}</p>
                        <p className="text-muted-foreground text-[10px] leading-relaxed font-light tracking-tight">{item.desc}</p>
                        {item.copyable && (
                          <div className="mt-3 flex items-center gap-2">
                            <code className="flex-1 text-[9px] font-mono text-zinc-650 dark:text-white/60 bg-zinc-100 dark:bg-black/40 border border-zinc-200 dark:border-white/[0.08] rounded-lg px-3 py-2 truncate">{item.copyable || 'unconfigured'}</code>
                            <button onClick={() => copyToClipboard(item.copyable, `step${item.step}`)} className="shrink-0 p-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-zinc-200 dark:border-white/[0.08] rounded-lg transition-all">
                              {copiedField === `step${item.step}` ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-white/60" /> : <Copy className="w-3.5 h-3.5 text-zinc-400 dark:text-white/40" />}
                            </button>
                          </div>
                        )}
                        {item.link && (
                          <a href={item.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[10px] text-zinc-550 hover:text-foreground dark:text-white/40 dark:hover:text-white transition-colors font-medium tracking-tight"><ExternalLink className="w-3 h-3" />{item.linkText}</a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={handleGoogleSignUp} disabled={isLoading} className="w-full h-14 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-2xl font-bold text-sm hover:bg-zinc-800 dark:hover:bg-[#F5F5F5] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-3 shadow-sm dark:shadow-[0_20px_40px_rgba(255,255,255,0.1)] disabled:opacity-50 active:scale-[0.98]">
                {isLoading ? <div className="w-5 h-5 border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black animate-spin rounded-full" /> : <><CheckCircle2 className="w-5 h-5" />I&apos;ve approved — Connect</>}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Admin Modal */}
        <AnimatePresence>
          {showAdminModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 dark:bg-black/90 backdrop-blur-md">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-lg bg-background border border-border rounded-[20px] shadow-2xl overflow-hidden">
                <div className="p-10 sm:p-12 space-y-8">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-100 border border-zinc-200 dark:bg-white/[0.04] dark:border-white/[0.08] flex items-center justify-center"><Shield className="w-6 h-6 text-zinc-500 dark:text-white/50" /></div>
                      <div>
                        <h2 className="text-xl text-foreground font-semibold tracking-tight">Approval Required</h2>
                        <p className="text-muted-foreground text-xs font-light mt-1">Your workspace admin must authorize Mailient.</p>
                      </div>
                    </div>
                    <button onClick={() => setShowAdminModal(false)} className="text-muted-foreground hover:text-foreground transition-colors"><ArrowRight className="w-5 h-5 rotate-[-45deg]" /></button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Email Template</span><button onClick={() => copyToClipboard(ADMIN_EMAIL_TEMPLATE, 'template')} className="text-[10px] font-bold text-zinc-500 hover:text-foreground dark:text-white/40 dark:hover:text-white transition-colors flex items-center gap-2">{copiedField === 'template' ? 'copied' : 'copy template'}</button></div>
                    <div className="text-[11px] font-mono text-muted-foreground bg-zinc-50 dark:bg-white/[0.02] p-5 border border-zinc-200 dark:border-white/[0.06] rounded-xl max-h-[160px] overflow-y-auto whitespace-pre-wrap">{ADMIN_EMAIL_TEMPLATE}</div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowAdminModal(false)} className="flex-1 h-11 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-white/[0.04] dark:text-white/60 dark:hover:bg-white/[0.08] rounded-[14px] font-medium text-sm border border-zinc-200 dark:border-white/[0.06]">Close</button>
                    <button onClick={() => { setShowAdminModal(false); setStep(3); }} className="flex-1 h-11 bg-zinc-900 text-white dark:bg-white dark:text-black rounded-[14px] font-bold text-sm hover:bg-zinc-850 dark:hover:bg-[#F5F5F5] transition-all flex items-center justify-center gap-2"><UserCog className="w-4 h-4" />I am Admin</button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </SignInLayout>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505] flex items-center justify-center"><div className="w-4 h-4 border border-white/20 border-t-white animate-spin rounded-full" /></div>}>
      <SignUpContent />
    </Suspense>
  );
}
