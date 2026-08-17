"use client";

import { X, Search, Plus, ListFilter, History, FileText, BarChart3, Calendar, PenTool, Sparkles, Trash2, Edit3, ArrowLeft } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  title: string;
  updated_at: string;
  source?: 'remote' | 'local';
}

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationSelect?: (conversationId: string) => void;
  onConversationDelete?: (conversationId: string) => void;
  onNewMission?: () => void;
}

function capitalizeTitle(str: string): string {
  if (!str) return '';
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function ChatHistoryModal({ isOpen, onClose, onConversationSelect, onConversationDelete, onNewMission }: ChatHistoryModalProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);

  useEffect(() => {
    if (isOpen) fetchSessions();
  }, [isOpen]);

  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      // Primary: Supabase via our API
      const res = await fetch('/api/boult/conversation');
      const remoteSessions: Session[] = [];
      const remoteIds = new Set<string>();

      if (res.ok) {
        const data = await res.json();
        const raw: any[] = data.sessions || [];
        raw.forEach(s => {
          remoteSessions.push({ id: s.id, title: s.title || 'Untitled', updated_at: s.updated_at, source: 'remote' });
          remoteIds.add(s.id);
        });
      }

      // Fallback: any localStorage sessions not yet synced
      const local: Session[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('conversation_')) continue;
        try {
          const d = JSON.parse(localStorage.getItem(key) || '{}');
          if (!d.id || !d.messages?.length) continue;
          if (remoteIds.has(d.id)) continue; // already in Supabase

          const firstUser = d.messages.find((m: any) => m.role === 'user' || m.type === 'user');
          const preview = typeof firstUser?.content === 'string'
            ? firstUser.content
            : firstUser?.content?.text || '';
          local.push({
            id: d.id,
            title: d.title || preview.split(' ').slice(0, 6).join(' ') || 'Untitled',
            updated_at: d.lastUpdated || new Date().toISOString(),
            source: 'local',
          });
        } catch { /* ignore corrupt entries */ }
      }

      const merged = [...remoteSessions, ...local].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setSessions(merged);
    } catch (err) {
      console.error('[ChatHistoryModal] fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(s => s.title.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const handleRename = async (id: string, newTitle: string) => {
    const trimmed = capitalizeTitle(newTitle);
    setEditingId(null);
    if (!trimmed) return;

    // Optimistic update
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: trimmed } : s));

    // Update Supabase
    fetch(`/api/boult/conversation/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    }).catch(console.error);

    // Update localStorage
    const raw = localStorage.getItem(`conversation_${id}`);
    if (raw) {
      try {
        const d = JSON.parse(raw);
        d.title = trimmed;
        localStorage.setItem(`conversation_${id}`, JSON.stringify(d));
      } catch { /* ignore */ }
    }
    localStorage.setItem(`conv_${id}_title`, trimmed);
  };

  const handleDelete = async (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));

    // Delete from Supabase
    fetch(`/api/boult/conversation/${id}`, { method: 'DELETE' }).catch(console.error);

    // Delete from localStorage
    localStorage.removeItem(`conversation_${id}`);
    localStorage.removeItem(`conv_${id}_title`);

    onConversationDelete?.(id);
  };

  const handleSendFeedback = async () => {
    if (!feedbackText.trim() || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackText }),
      });
      if (res.ok) {
        setIsSent(true);
        setFeedbackText('');
        setTimeout(() => { setIsSent(false); setIsFeedbackOpen(false); }, 2000);
      }
    } catch { /* ignore */ } finally {
      setIsSending(false);
    }
  };

  const formatRelativeDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Group sessions by date bucket
  const grouped = useMemo(() => {
    const today: Session[] = [];
    const yesterday: Session[] = [];
    const older: Session[] = [];
    const now = Date.now();
    filteredSessions.forEach(s => {
      const diffDays = Math.floor((now - new Date(s.updated_at).getTime()) / 86400000);
      if (diffDays === 0) today.push(s);
      else if (diffDays === 1) yesterday.push(s);
      else older.push(s);
    });
    return { today, yesterday, older };
  }, [filteredSessions]);

  return (
    <div className="h-full flex flex-col bg-boult-bg dark:bg-boult-bg-elevated text-boult-fg overflow-hidden font-sans" onClick={e => e.stopPropagation()}>

      {/* Header */}
      <AnimatePresence mode="wait">
        {isSearchVisible ? (
          <motion.div key="search" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="p-4 flex items-center gap-3 border-b border-boult-border"
          >
            <button onClick={() => { setIsSearchVisible(false); setSearchQuery(''); }} className="text-boult-fg-muted hover:text-boult-fg transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <input
              autoFocus type="text" placeholder="Search chats..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-[14px] text-boult-fg placeholder:text-boult-fg-muted"
            />
          </motion.div>
        ) : (
          <motion.div key="header" className="p-4 space-y-1">
            <button
              onClick={onNewMission}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-boult-surface hover:bg-boult-surface-hover border border-boult-border transition-all group"
            >
              <div className="w-5 h-5 flex items-center justify-center">
                <Edit3 className="w-4 h-4 text-boult-fg-muted group-hover:text-boult-fg transition-colors" />
              </div>
              <span className="text-[14px] font-medium text-boult-fg">New mission</span>
            </button>
            <div className="pt-1">
              <button onClick={() => setIsSearchVisible(true)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-boult-surface-hover transition-all group"
              >
                <Search className="w-4 h-4 text-boult-fg-muted group-hover:text-boult-fg-secondary transition-colors" />
                <span className="text-[14px] font-medium text-boult-fg-secondary group-hover:text-boult-fg transition-colors">Search</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar">
        {isLoading ? (
          <div className="py-10 flex justify-center opacity-20">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="py-10 text-center px-4">
            <p className="text-[13px] text-neutral-400 dark:text-neutral-500 italic">No chats yet</p>
          </div>
        ) : (
          <>
            {[
              { label: 'Today', items: grouped.today },
              { label: 'Yesterday', items: grouped.yesterday },
              { label: 'Earlier', items: grouped.older },
            ].map(group => group.items.length > 0 && (
              <div key={group.label} className="mb-4">
                <p className="text-[11px] font-bold tracking-wider uppercase text-boult-fg-tertiary px-2.5 mb-1.5 mt-4 first:mt-0">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map(session => (
                    <div key={session.id} className="group relative">
                      <div
                        onClick={() => { onConversationSelect?.(session.id); onClose(); }}
                        className="flex items-center gap-3 p-2.5 rounded-xl transition-all cursor-pointer hover:bg-boult-surface-hover"
                      >
                        <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                          {getSessionIcon(session.title)}
                        </div>

                        {editingId === session.id ? (
                          <input
                            autoFocus
                            className="flex-1 bg-transparent border-none outline-none text-[14px] font-medium text-boult-fg"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => handleRename(session.id, editValue)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename(session.id, editValue);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span className="flex-1 text-[14px] font-medium text-boult-fg-secondary group-hover:text-boult-fg transition-colors truncate">
                            {capitalizeTitle(session.title)}
                          </span>
                        )}

                        {!editingId && (
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity flex-shrink-0">
                            <button
                              onClick={e => { e.stopPropagation(); setEditingId(session.id); setEditValue(session.title); }}
                              className="p-1 hover:text-boult-fg text-boult-fg-muted"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(session.id); }}
                              className="p-1 hover:text-red-400 text-boult-fg-muted"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Feedback footer */}
      <div className="p-4 border-t border-boult-border bg-boult-surface">
        <AnimatePresence mode="wait">
          {!isFeedbackOpen ? (
            <motion.button key="fb-prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsFeedbackOpen(true)}
              className="w-full py-3 px-4 rounded-xl border border-dashed border-boult-border hover:border-boult-fg-muted hover:bg-boult-surface-hover transition-all text-left group"
            >
              <span className="text-[12px] font-medium text-boult-fg-muted group-hover:text-boult-fg-secondary">
                Have Feedback? <span className="text-boult-fg/60">Write here!</span>
              </span>
            </motion.button>
          ) : (
            <motion.div key="fb-form" initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="w-full bg-boult-surface border border-boult-border rounded-2xl p-4 shadow-2xl"
            >
              <textarea
                autoFocus placeholder="Share your feedback..."
                value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendFeedback();
                  if (e.key === 'Escape') setIsFeedbackOpen(false);
                }}
                className="w-full bg-boult-bg dark:bg-[#0A0A0A] border border-boult-border rounded-xl p-3 text-[13px] text-boult-fg placeholder:text-boult-fg-muted resize-none min-h-[100px] outline-none focus:border-boult-fg-tertiary dark:focus:border-white/20 transition-all mb-4"
              />
              <div className="flex items-center justify-between">
                <button onClick={() => window.open('mailto:support.maily@gmail.com')} className="text-[12px] text-boult-fg-muted hover:text-boult-fg transition-colors">
                  Need help? <span className="underline decoration-white/20">Contact us</span>
                </button>
                <button
                  onClick={handleSendFeedback}
                  disabled={!feedbackText.trim() || isSending || isSent}
                  className={cn(
                    'flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-bold transition-all border-none shadow-lg',
                    isSent ? 'bg-emerald-500 text-white' : 'bg-boult-fg dark:bg-white text-boult-fg-inverse dark:text-black hover:bg-boult-fg/90 dark:hover:bg-neutral-100'
                  )}
                >
                  {isSent ? 'Sent!' : isSending ? 'Sending...' : 'Send'}
                  {!isSending && !isSent && (
                    <div className="flex items-center gap-0.5 opacity-40 ml-1">
                      <span className="text-[10px]">⌘</span>
                      <span className="text-[10px]">↵</span>
                    </div>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function getSessionIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes('summary') || t.includes('catch up') || t.includes('brief')) return <FileText className="w-4 h-4 text-neutral-400 dark:text-neutral-500 group-hover:text-black dark:group-hover:text-white transition-colors" />;
  if (t.includes('analytics') || t.includes('chart') || t.includes('report')) return <BarChart3 className="w-4 h-4 text-neutral-400 dark:text-neutral-500 group-hover:text-black dark:group-hover:text-white transition-colors" />;
  if (t.includes('schedule') || t.includes('calendar') || t.includes('meeting')) return <Calendar className="w-4 h-4 text-neutral-400 dark:text-neutral-500 group-hover:text-black dark:group-hover:text-white transition-colors" />;
  if (t.includes('write') || t.includes('reply') || t.includes('draft') || t.includes('email')) return <PenTool className="w-4 h-4 text-neutral-400 dark:text-neutral-500 group-hover:text-black dark:group-hover:text-white transition-colors" />;
  if (t.includes('search') || t.includes('find') || t.includes('web')) return <History className="w-4 h-4 text-neutral-400 dark:text-neutral-500 group-hover:text-black dark:group-hover:text-white transition-colors" />;
  return <Sparkles className="w-4 h-4 text-neutral-300 dark:text-neutral-600 group-hover:text-neutral-500 dark:group-hover:text-neutral-400 transition-colors" />;
}
