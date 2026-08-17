"use client";

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  Check, 
  ArrowRight, 
  Copy, 
  ExternalLink, 
  Building2, 
  Mail, 
  Lock, 
  Settings,
  ChevronRight,
  CheckCircle2,
  Undo2,
  Terminal,
  Key,
  Globe
} from 'lucide-react';
import { SignInLayout } from '@/components/ui/sign-in';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "unconfigured_client_id";

function WorkspaceSetupContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams?.get('email') || '';
  const [copiedField, setCopiedField] = useState(null);

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const setupSteps = [
    {
      title: "Google Admin Console",
      description: "Access your organization's API controls to authorize Mailient. This is the foundation of your secure workspace integration.",
      icon: <Globe className="w-6 h-6" />,
      link: "https://admin.google.com/ac/owl/list?tab=configuredApps",
      linkText: "Open Console",
      accent: "bg-blue-500/10 text-blue-400"
    },
    {
      title: "Register Application",
      description: "Navigate to 'Manage Third-Party App Access' and add Mailient using our verified Client ID below.",
      copyable: CLIENT_ID,
      icon: <Terminal className="w-6 h-6" />,
      accent: "bg-purple-500/10 text-purple-400"
    },
    {
      title: "Establish Trust",
      description: "Change the access level to 'Trusted'. This bypasses restriction warnings and enables deep AI integration.",
      icon: <Shield className="w-6 h-6" />,
      accent: "bg-amber-500/10 text-amber-400"
    },
    {
      title: "Finalize Connection",
      description: "Ensure that 'mailient.xyz' has permission to access the required Gmail scopes for automated drafting.",
      icon: <Key className="w-6 h-6" />,
      accent: "bg-emerald-500/10 text-emerald-400"
    }
  ];

  return (
    <SignInLayout
      title={<>Enterprise <br/> Configuration</>}
      description="Authorize Mailient for your Google Workspace organization with high-fidelity administrative controls."
      hideHero={true}
      allowScroll={true}
      maxWidth="max-w-4xl"
      testimonials={[]}
    >
      <div className="space-y-12">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-white/[0.06]">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-white/40 text-[10px] font-bold uppercase tracking-[0.3em]">
              <Lock className="w-3 h-3" />
              <span>Security Protocol</span>
            </div>
            <h2 className="text-white text-4xl md:text-5xl font-bold tracking-tight">Admin Guidelines</h2>
            <p className="text-white/30 text-lg font-light leading-relaxed max-w-xl">
              Mailient requires high-level trust to operate within your organization. 
              {email && <span> Targeting domain: <span className="text-white/80 font-medium">{email.split('@')[1]}</span></span>}
            </p>
          </div>
          <div className="hidden lg:block p-4 bg-white/[0.02] border border-white/[0.08] rounded-2xl">
            <div className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">Status</div>
            <div className="flex items-center gap-2 text-amber-500 font-semibold text-sm">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Awaiting Authorization
            </div>
          </div>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {setupSteps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-8 bg-white/[0.02] border border-white/[0.06] rounded-[32px] group hover:bg-white/[0.04] hover:border-white/[0.12] transition-all duration-500 relative overflow-hidden"
            >
              <div className="relative z-10 space-y-6">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${step.accent} transition-transform group-hover:scale-110 duration-500`}>
                  {step.icon}
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white text-xl font-semibold tracking-tight">{step.title}</h3>
                    <span className="text-[10px] font-bold text-white/10 uppercase tracking-[0.2em]">Step {index + 1}</span>
                  </div>
                  <p className="text-white/40 text-sm leading-relaxed font-light tracking-tight">
                    {step.description}
                  </p>
                </div>

                {step.copyable && (
                  <div className="space-y-2">
                    <div className="text-[9px] font-bold text-white/20 uppercase tracking-widest ml-1">OAuth Client ID</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-white/60 bg-black/60 border border-white/[0.1] rounded-xl px-4 py-3 truncate">
                        {step.copyable}
                      </code>
                      <button 
                        onClick={() => copyToClipboard(step.copyable, 'clientid')}
                        className="shrink-0 p-3 btn-liquid-glass rounded-xl transition-all"
                      >
                        {copiedField === 'clientid' ? (
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        ) : (
                          <Copy className="w-4 h-4 text-white/40" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {step.link && (
                  <a 
                    href={step.link} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-flex items-center gap-3 px-6 py-3 btn-liquid-glass rounded-xl text-sm text-white font-medium tracking-tight group/link"
                  >
                    {step.linkText}
                    <ExternalLink className="w-4 h-4 text-white/40 group-hover/link:text-white transition-colors" />
                  </a>
                )}
              </div>
              
              {/* Subtle background decoration */}
              <div className="absolute -bottom-6 -right-6 w-32 h-32 bg-white/[0.01] rounded-full blur-3xl group-hover:bg-white/[0.03] transition-all duration-500" />
            </motion.div>
          ))}
        </div>

        {/* Footer Guidance */}
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 p-8 bg-red-500/[0.02] border border-red-500/10 rounded-[32px] space-y-4">
            <div className="flex items-center gap-2 text-red-500/60 text-[10px] font-bold uppercase tracking-[0.2em]">
              <Undo2 className="w-3.5 h-3.5" />
              <span>Revocation Protocol</span>
            </div>
            <div className="space-y-3">
              <h4 className="text-white text-lg font-semibold tracking-tight">Exiting Services</h4>
              <p className="text-white/30 text-xs leading-relaxed font-light tracking-tight max-w-md">
                To disconnect Mailient, remove the application from your Google Admin "Trusted" list. This action immediately invalidates all organization-level OAuth tokens and ceases processing.
              </p>
            </div>
          </div>

          <div className="w-full lg:w-80 flex flex-col gap-4">
            <button 
              onClick={() => router.push('/auth/signin')}
              className="w-full h-16 btn-liquid-glass rounded-2xl font-bold text-sm hover:-translate-y-1 transition-all flex items-center justify-center gap-3 shadow-2xl active:scale-[0.98]"
            >
              Verify Connection
              <ArrowRight className="w-4 h-4" />
            </button>
            <button 
              onClick={() => window.open('mailto:support.maily@gmail.com')}
              className="w-full h-16 bg-white/[0.02] border border-white/[0.06] text-white/40 rounded-2xl font-semibold text-xs hover:bg-white/[0.04] hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <Mail className="w-4 h-4" />
              Request Engineering Support
            </button>
          </div>
        </div>
      </div>
    </SignInLayout>
  );
}

export default function WorkspaceSetupPage() {
  return (
    <div className="min-h-screen bg-[#050505] satoshi-app">
      <Suspense fallback={
        <div className="h-screen flex items-center justify-center bg-[#050505]">
          <div className="w-8 h-8 border-2 border-white/10 border-t-white animate-spin rounded-full" />
        </div>
      }>
        <WorkspaceSetupContent />
      </Suspense>
    </div>
  );
}
