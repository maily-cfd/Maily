'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import { 
  Sparkles, 
  User2, 
  Check, 
  Copy, 
  Share2, 
  LogIn,
  Layers,
  ArrowRight,
  Eye,
  Trash2,
  ExternalLink,
  Bot
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { AgentExecutionTimeline } from '@/app/dashboard/agent-talk/components/AgentExecutionTimeline';
import { BoultLogo } from "@/components/ui/boult-logo";

// ─── Custom Message Content with premium Markdown rendering ──────────────────
const MessageContent = ({ content, isUser }: { content: any, isUser: boolean }) => {
  const text = typeof content === 'string' ? content : content.text;
  const list = typeof content === 'string' ? [] : (content.list || []);

  if (isUser) {
    return <div className="text-[14px] leading-relaxed tracking-tight text-white whitespace-pre-wrap font-sans">{text}</div>;
  }

  // Render assistant messages as formatted Markdown
  return (
    <div className="text-[14px] leading-relaxed tracking-tight text-black dark:text-white">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-[18px] font-bold text-white leading-tight mb-4 mt-2 tracking-tight">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[16px] font-semibold text-white leading-snug mb-3 mt-4 tracking-tight">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[14px] font-semibold text-white leading-snug mb-2.5 mt-3">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-[14.5px] text-white leading-[1.65] mb-3">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 space-y-1.5 list-none pl-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 space-y-1.5 pl-5 list-decimal marker:text-white">{children}</ol>
          ),
          li: ({ children, ...props }: any) => (
            props.ordered
              ? <li className="text-[13.5px] text-white leading-relaxed pl-1">{children}</li>
              : <li className="flex items-start gap-2 text-[13.5px] text-white leading-relaxed list-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/60 mt-[7px] shrink-0" />
                  <span className="flex-1">{children}</span>
                </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-white">{children}</em>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-white/20 pl-4 my-3 text-[13.5px] text-white italic leading-relaxed">
              {children}
            </blockquote>
          ),
          code: ({ inline, children }: any) =>
            inline ? (
              <code className="px-1.5 py-0.5 rounded bg-white/10 text-[12px] font-mono text-white border border-white/10">
                {children}
              </code>
            ) : (
              <pre className="my-3 rounded-lg bg-black/40 border border-white/[0.05] overflow-x-auto p-3.5">
                <code className="block text-[12px] font-mono text-white leading-relaxed">{children}</code>
              </pre>
            ),
          hr: () => <hr className="my-4 border-white/[0.06]" />,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>

      {list.length > 0 && (
        <ul className="mt-3 space-y-2 list-none">
          {list.map((item: string, idx: number) => (
            <li key={idx} className="flex gap-2 items-start">
              <span className="w-1 h-1 rounded-full bg-blue-500 mt-2 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default function SharePage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();
  
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Custom Analytics and Ownership states
  const [title, setTitle] = useState("Shared Conversation");
  const [views, setViews] = useState(0);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [originalConvoId, setOriginalConvoId] = useState<string | null>(null);
  
  // Button Loading Actions
  const [cloning, setCloning] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  useEffect(() => {
    const fetchSharedData = async () => {
      try {
        const res = await fetch(`/api/agent-talk/share/${id}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("Conversation not found");
          throw new Error("Failed to load shared conversation");
        }
        const data = await res.json();
        setMessages(data.messages || []);
        setTitle(data.title || "Shared Conversation");
        setViews(data.views || 0);
        setOwnerEmail(data.ownerEmail || null);
        setOriginalConvoId(data.originalConvoId || null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchSharedData();
  }, [id]);

  // Derived computed check: Is the current logged-in user the owner of the shared chat?
  const isOwner = session?.user?.email && ownerEmail && 
                  session.user.email.toLowerCase() === ownerEmail.toLowerCase();

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleClone = async () => {
    if (authStatus === 'unauthenticated') {
      const callbackUrl = window.location.href;
      signIn('google', { callbackUrl });
      return;
    }

    setCloning(true);
    try {
      const res = await fetch('/api/agent-talk/share/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId: id })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to clone chat");

      toast.success("Chat cloned successfully! Opening workspace...");
      router.push(data.redirectUrl);
    } catch (err: any) {
      toast.error(err.message);
      setCloning(false);
    }
  };

  const handleRevokeShare = async () => {
    setShowRevokeConfirm(false);
    setRevoking(true);
    try {
      const res = await fetch(`/api/agent-talk/share/${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke share link");

      toast.success("Share link revoked successfully!");
      // Redirect owner back to their normal agent-talk interface
      router.push(originalConvoId ? `/dashboard/agent-talk/${originalConvoId}` : '/dashboard/agent-talk');
    } catch (err: any) {
      toast.error(err.message);
      setRevoking(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col font-sans">
        {/* Header Skeleton */}
        <nav className="h-16 border-b border-white/[0.04] bg-black/60 backdrop-blur-2xl flex items-center justify-between px-6 lg:px-12 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/30 border border-white/40 animate-pulse shrink-0" />
            <div className="h-4 w-24 bg-white/35 rounded-full animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-16 bg-white/25 rounded-full animate-pulse" />
            <div className="h-6 w-20 bg-white/25 rounded-full animate-pulse" />
          </div>
        </nav>

        {/* Content Chat Skeleton */}
        <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-8 overflow-y-auto space-y-8 mt-16">
          {/* User Message Skeleton */}
          <div className="flex flex-col items-end space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-4 w-12 bg-white/25 rounded-full animate-pulse" />
              <div className="w-8 h-8 rounded-full bg-white/35 border border-white/40 animate-pulse" />
            </div>
            <div className="w-64 h-12 bg-white/20 border border-white/30 rounded-[20px] animate-pulse" />
          </div>

          {/* Bot Message Skeleton 1 */}
          <div className="flex flex-col items-start space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/35 border border-white/40 animate-pulse" />
              <div className="h-4 w-16 bg-white/25 rounded-full animate-pulse" />
            </div>
            <div className="w-full space-y-2.5 pl-11">
              <div className="h-4 w-[90%] bg-white/30 rounded-md animate-pulse" />
              <div className="h-4 w-[95%] bg-white/30 rounded-md animate-pulse" />
              <div className="h-4 w-[60%] bg-white/30 rounded-md animate-pulse" />
            </div>
          </div>

          {/* User Message Skeleton 2 */}
          <div className="flex flex-col items-end space-y-2 pt-4">
            <div className="flex items-center gap-3">
              <div className="h-4 w-16 bg-white/25 rounded-full animate-pulse" />
              <div className="w-8 h-8 rounded-full bg-white/35 border border-white/40 animate-pulse" />
            </div>
            <div className="w-80 h-10 bg-white/20 border border-white/30 rounded-[20px] animate-pulse" />
          </div>

          {/* Bot Message Skeleton 2 */}
          <div className="flex flex-col items-start space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/35 border border-white/40 animate-pulse" />
              <div className="h-4 w-14 bg-white/25 rounded-full animate-pulse" />
            </div>
            <div className="w-full space-y-2.5 pl-11">
              <div className="h-4 w-[95%] bg-white/30 rounded-md animate-pulse" />
              <div className="h-4 w-[85%] bg-white/30 rounded-md animate-pulse" />
              <div className="h-4 w-[40%] bg-white/30 rounded-md animate-pulse" />
            </div>
          </div>
        </div>

        {/* Footer Skeleton */}
        <footer className="h-20 border-t border-white/[0.04] bg-black/60 backdrop-blur-2xl flex items-center justify-center px-6 shrink-0">
          <div className="w-48 h-9 rounded-full bg-white/30 border border-white/40 animate-pulse" />
        </footer>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
            <Share2 className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Link Expired or Revoked</h1>
          <p className="text-white/40 text-[14px] leading-relaxed">
            The shared conversation link you are trying to access has been unshared by the owner or does not exist anymore.
          </p>
          <button 
            onClick={() => router.push('/dashboard/agent-talk')}
            className="px-6 py-3 bg-white text-black font-bold rounded-2xl hover:bg-white/90 active:scale-95 transition-all"
          >
            Go to Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white/20">
      {/* Premium Glassmorphic Header */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-white/[0.04] bg-black/60 backdrop-blur-2xl flex items-center justify-between px-6 lg:px-12">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center shrink-0">
            <BoultLogo size={32} />
          </div>
          <h1 className="text-[14px] font-bold tracking-tight text-white truncate max-w-[180px] sm:max-w-[280px]">
            {title}
          </h1>

          {/* Premium Analytics Views Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-white/85 text-[11px] font-semibold shrink-0">
            <Eye className="w-3.5 h-3.5 text-white" />
            <span>{views} {views === 1 ? 'view' : 'views'}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Copy link option in top-right */}
          <button 
            onClick={handleCopyLink}
            className="px-3.5 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.1] text-white/95 text-[11.5px] font-semibold transition-colors active:scale-95"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400 inline mr-1" /> : null}
            <span>{copiedLink ? "Copied" : "Copy Link"}</span>
          </button>

          {/* Revoke share button ONLY visible to the creator/owner */}
          {isOwner && (
            <button
              onClick={() => setShowRevokeConfirm(true)}
              disabled={revoking}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/25 hover:bg-red-500/20 hover:border-red-500/40 text-red-400 text-[11.5px] font-bold transition-all active:scale-95 disabled:opacity-50"
              title="Unshare Link"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Unshare Link</span>
            </button>
          )}

          {/* Sign In Header Button for Guests */}
          {authStatus === 'unauthenticated' && (
            <button 
              onClick={() => signIn('google')}
              className="px-4 py-1.5 bg-white text-black text-[12px] font-bold rounded-full hover:bg-neutral-200 transition-all active:scale-95 shadow-md shadow-white/5"
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* Revoke confirmation modal (replaces native confirm) */}
      {showRevokeConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setShowRevokeConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0c0c0c] border border-white/10 p-6 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 className="text-[17px] font-bold text-white tracking-tight">Revoke this shared link?</h2>
            </div>
            <p className="text-[13.5px] leading-relaxed text-neutral-400 mb-6">
              Anyone with the link will immediately see a “link expired” screen. This can’t be undone — you’d need to share the conversation again to create a new link.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => setShowRevokeConfirm(false)}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-neutral-300 hover:text-white hover:bg-white/[0.06] transition-all active:scale-95"
              >
                Keep link
              </button>
              <button
                onClick={handleRevokeShare}
                disabled={revoking}
                className="px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 text-red-300 text-[13px] font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                {revoking ? 'Revoking…' : 'Revoke link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Conversation Stream */}
      <main className="max-w-4xl mx-auto pt-28 pb-44 px-6">
        <div className="space-y-12">
          {messages.map((msg, idx) => (
            <div 
              key={msg.id || idx} 
              className={cn(
                "flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700",
                msg.role === 'user' ? "items-end" : "items-start"
              )}
            >
              <div className={cn(
                "flex gap-4 max-w-[92%] sm:max-w-[82%] items-start",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}>
                {/* Avatar */}
                <div className={cn(
                  "w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center border overflow-hidden bg-[#161618] border-white/[0.08]"
                )}>
                  {msg.role === 'user' ? (
                    <User2 className="w-4 h-4 text-white/50" />
                  ) : (
                    <Bot className="w-4 h-4 text-white" />
                  )}
                </div>

                {/* Message Bubble Container */}
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className={cn(
                    "relative px-5 py-4.5 rounded-[24px] shadow-lg transition-all",
                    msg.role === 'user' 
                      ? "bg-[#111] border border-white/[0.08] text-white rounded-tr-none" 
                      : "bg-[#0d0d0e]/60 border border-white/[0.06] text-white rounded-tl-none"
                  )}>
                    <MessageContent content={msg.content} isUser={msg.role === 'user'} />
                    
                    {/* Render execution steps if they exist in the assistant message */}
                    {msg.role === 'assistant' && msg.meta?.agentSteps && (
                      <div className="mt-6 pt-5 border-t border-white/[0.06]">
                        <AgentExecutionTimeline 
                          steps={msg.meta.agentSteps} 
                          isActive={false} 
                        />
                      </div>
                    )}
                  </div>
                  
                  {/* Timestamp */}
                  {msg.time && (
                    <span className={cn(
                       "text-[10px] tracking-tight text-white/20 px-1 font-medium",
                      msg.role === 'user' ? "text-right" : "text-left"
                    )}>
                      {msg.time}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Premium Curvy Continue Button */}
      <footer className="fixed bottom-8 left-0 right-0 z-50 px-6 flex justify-center">
        {authStatus === 'unauthenticated' ? (
          <button 
            onClick={() => signIn('google')}
            className="px-6 py-2.5 bg-white text-black font-bold text-[13.5px] rounded-full hover:bg-neutral-200 active:scale-95 transition-all shadow-xl shadow-black/40 font-satoshi flex items-center gap-2 border border-white"
            style={{ 
              fontFamily: "Satoshi, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              letterSpacing: "-0.01em"
            }}
          >
            <LogIn className="w-4 h-4 text-black" />
            <span>Continue Conversation</span>
          </button>
        ) : isOwner ? (
          <button 
            onClick={() => router.push(`/dashboard/agent-talk/${originalConvoId}`)}
            className="px-6 py-2.5 bg-white text-black font-bold text-[13.5px] rounded-full hover:bg-neutral-200 active:scale-95 transition-all shadow-xl shadow-black/40 font-satoshi flex items-center gap-2 border border-white"
            style={{ 
              fontFamily: "Satoshi, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              letterSpacing: "-0.01em"
            }}
          >
            <ExternalLink className="w-4 h-4 text-black" />
            <span>Continue Conversation</span>
          </button>
        ) : (
          <button 
            onClick={handleClone}
            disabled={cloning}
            className="px-6 py-2.5 bg-white text-black font-bold text-[13.5px] rounded-full hover:bg-neutral-200 active:scale-95 transition-all shadow-xl shadow-black/40 font-satoshi flex items-center gap-2 border border-white disabled:opacity-50"
            style={{ 
              fontFamily: "Satoshi, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              letterSpacing: "-0.01em"
            }}
          >
            {cloning ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                <span>Cloning...</span>
              </>
            ) : (
              <>
                <Layers className="w-4 h-4 text-black" />
                <span>Continue Conversation</span>
              </>
            )}
          </button>
        )}
      </footer>
    </div>
  );
}
