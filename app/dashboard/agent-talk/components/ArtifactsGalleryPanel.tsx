'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X, FileText, Download, Sparkles,
  Search, ArrowRight, Loader2, Library
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { type CanvasData, type CanvasType } from './CanvasPanel';

interface ArtifactsGalleryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectArtifact: (data: CanvasData) => void;
  isSidebarCollapsed?: boolean;
  messages?: any[];
}

interface DynamicArtifactItem {
  id: string;
  type: CanvasType;
  tag: string;
  title: string;
  subtitle: string;
  time: string;
  content: any;
  raw: string;
}

export function ArtifactsGalleryPanel({
  isOpen,
  onClose,
  onSelectArtifact,
  messages = []
}: ArtifactsGalleryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const isDarkActive = document.documentElement.classList.contains('dark') || 
                           document.body.classList.contains('dark') ||
                           !!document.querySelector('.dark');
      setIsDark(isDarkActive);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Don't lock body scroll - allow modal content to scroll properly
  useEffect(() => {
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsLoadingAll(true);
      fetch('/api/boult/conversation')
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.sessions)) setAllSessions(data.sessions);
        })
        .catch(err => console.error('Error fetching conversations for library:', err))
        .finally(() => setIsLoadingAll(false));
    }
  }, [isOpen]);

  // ─── Artifact extraction ───────────────────────────────────────────────────────
  const dynamicArtifacts: DynamicArtifactItem[] = [];
  const processedMessageIds = new Set<string>();

  const extractFromMessages = (msgs: any[], chatTitle?: string) => {
    if (!Array.isArray(msgs)) return;
    msgs.forEach((msg, index) => {
      const msgKey = msg.id || `${chatTitle || 'chat'}-${index}`;
      if (processedMessageIds.has(msgKey)) return;
      processedMessageIds.add(msgKey);

      if (msg.role === 'assistant' && msg.meta) {
        const planSource = msg.meta.planCard || msg.meta._planForDocs || msg.meta.planArtifact;
        if (planSource) {
          const plan = planSource;
          const rawMarkdown = plan.markdown
            || `# ${plan.title || 'Strategic Mission Plan'}\n\nObjective: ${plan.objective || ''}\n\n${plan.steps?.map((s: any, idx: number) => `### Step ${idx + 1}: ${s.action}\n${s.description || s.human_readable || ''}\n`).join('\n') || ''}`;
          dynamicArtifacts.push({
            id: `dyn-plan-${msgKey}`,
            type: 'action_plan',
            tag: 'Plan · MD',
            title: plan.title || 'Strategic Mission Plan',
            subtitle: chatTitle ? `From: ${chatTitle}` : 'Created from chat',
            time: msg.time || 'Just now',
            content: { type: 'action_plan', title: plan.title, markdown: rawMarkdown },
            raw: rawMarkdown,
          });
        }

        if (msg.meta.canvasApproval?.canvasData) {
          const cv = msg.meta.canvasApproval.canvasData;
          dynamicArtifacts.push({
            id: `dyn-appr-${msgKey}`,
            type: cv.type || 'workflow',
            tag: 'Mission Spec · JSON',
            title: msg.meta.canvasApproval.title || 'Canvas Workflow Specification',
            subtitle: chatTitle ? `From: ${chatTitle}` : 'Extracted from chat',
            time: msg.time || 'Just now',
            content: cv.content,
            raw: cv.raw || JSON.stringify(cv.content, null, 2),
          });
        }

        if (msg.meta.result?.canvasData) {
          const cv = msg.meta.result.canvasData;
          let fileTag = 'Result · MD';
          if (cv.type === 'analytics') fileTag = 'Analytics · MD';
          else if (cv.type === 'email_draft' || cv.type === 'reply') fileTag = 'Email Draft · MD';
          else if (cv.type === 'notes') fileTag = 'Document · MD';
          dynamicArtifacts.push({
            id: `dyn-res-${msgKey}`,
            type: cv.type || 'notes',
            tag: fileTag,
            title: msg.meta.result.title || 'Action Results Summary',
            subtitle: chatTitle ? `From: ${chatTitle}` : 'Extracted from chat',
            time: msg.time || 'Just now',
            content: cv.content,
            raw: cv.raw || (typeof cv.content === 'string' ? cv.content : JSON.stringify(cv.content, null, 2)),
          });
        }
      }
    });
  };

  extractFromMessages(messages, 'Active Session');
  allSessions.forEach(session => extractFromMessages(session.messages, session.title));

  const filteredArtifacts = dynamicArtifacts.filter(art =>
    art.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    art.tag.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownload = async (e: React.MouseEvent, art: DynamicArtifactItem) => {
    e.stopPropagation();
    if (downloadingId === art.id) return;
    setDownloadingId(art.id);
    const safeName = art.title.replace(/\s+/g, '_').toLowerCase();
    try {
      const { markdownToDocxBlob, triggerDocxDownload } = await import('@/lib/boult/docx-export');
      const blob = await markdownToDocxBlob(art.raw, art.title);
      triggerDocxDownload(blob, safeName);
      toast.success(`Downloaded "${art.title}"`);
    } catch {
      try {
        const blob = new Blob([art.raw], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeName}.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('Downloaded as markdown');
      } catch {
        toast.error('Could not download file');
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleSelect = (art: DynamicArtifactItem) => {
    const data: CanvasData = { type: art.type, title: art.title, content: art.content, raw: art.raw };
    onSelectArtifact(data);
    toast.success(`Opening "${art.title}" in Canvas`);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Precise Graphite theme inline styles for 100% exact color palette match */}
          <style dangerouslySetInnerHTML={{__html: `
            .dark-graphite-modal {
              background-color: #1A1A1A !important;
              border-color: #232323 !important;
            }
            .dark-graphite-header {
              border-bottom-color: #2A2A2A !important;
            }
            .dark-graphite-icon-wrapper {
              background-color: #232323 !important;
              border-color: #2A2A2A !important;
            }
            .dark-graphite-item {
              background-color: #232323 !important;
              border-color: #2A2A2A !important;
              transition: all 0.15s ease-in-out !important;
            }
            .dark-graphite-item:hover {
              background-color: #2A2A2A !important;
              border-color: #363636 !important;
            }
            .dark-graphite-tag {
              background-color: #1A1A1A !important;
              border-color: #2A2A2A !important;
              color: #737373 !important;
            }
            .dark-graphite-divider {
              border-top-color: #2A2A2A !important;
            }
            .dark-graphite-search-input {
              background-color: #232323 !important;
              border-color: #2A2A2A !important;
              color: #E2E8F0 !important;
            }
            .dark-graphite-search-input:focus {
              border-color: #363636 !important;
            }
            .dark-graphite-close-btn:hover {
              background-color: #2A2A2A !important;
              color: #FFFFFF !important;
            }
          `}} />

          {/* Blurred backdrop */}
          <motion.div
            key="library-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className={cn(
              "fixed inset-0 z-[200] backdrop-blur-sm transition-all duration-300",
              isDark ? "bg-black/60" : "bg-black/30"
            )}
          />

          {/* Modal card */}
          <motion.div
            key="library-modal"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'fixed z-[201] inset-0 m-auto',
              'w-[min(800px,calc(100vw-32px))] h-[min(720px,calc(100vh-80px))]',
              'flex flex-col rounded-[28px] overflow-hidden shadow-2xl transition-colors duration-300 border',
              isDark ? 'dark-graphite-modal text-white' : 'bg-[#EAEAEA] border-black/10 text-black',
            )}
            onClick={e => e.stopPropagation()}
          >
            {/* Subtle noise texture */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.025] bg-[url('/noise.svg')] z-0" />

            {/* Header */}
            <div className={cn(
              "px-6 py-5 border-b flex items-center justify-between shrink-0 relative z-10",
              isDark ? "dark-graphite-header" : "border-black/10"
            )}>
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-xl border flex items-center justify-center",
                  isDark ? "dark-graphite-icon-wrapper" : "bg-black/5 border-black/10"
                )}>
                  <Library className={cn("w-4 h-4", isDark ? "text-[#737373]" : "text-black/60")} />
                </div>
                <div>
                  <h3 className={cn("text-[14px] font-bold tracking-tight lowercase", isDark ? "text-white" : "text-black/90")}>Library</h3>
                  {isLoadingAll ? (
                    <p className={cn("text-[10px] tracking-tight uppercase flex items-center gap-1.5", isDark ? "text-[#737373]" : "text-black/40")}>
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Syncing conversations…
                    </p>
                  ) : (
                    <p className={cn("text-[10px] tracking-tight uppercase", isDark ? "text-[#737373]" : "text-black/40")}>
                      {filteredArtifacts.length} document{filteredArtifacts.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={onClose}
                className={cn(
                  "p-2 rounded-xl transition-all",
                  isDark 
                    ? "dark-graphite-close-btn text-[#737373]" 
                    : "text-black/40 hover:text-black/70 hover:bg-black/8"
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            {dynamicArtifacts.length > 0 && (
              <div className={cn(
                "px-6 py-4 border-b shrink-0 relative z-10",
                isDark ? "dark-graphite-header" : "border-black/10"
              )}>
                <div className="relative">
                  <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4", isDark ? "text-[#737373]" : "text-black/30")} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search library…"
                    className={cn(
                      "w-full pl-9 pr-4 py-2.5 rounded-xl text-[13px] transition-all font-medium focus:outline-none border",
                      isDark 
                        ? "dark-graphite-search-input placeholder:text-[#525252]" 
                        : "bg-black/5 border border-black/10 text-black/80 placeholder:text-black/30 focus:border-black/20"
                    )}
                  />
                </div>
              </div>
            )}

            {/* Content */}
            <div className={cn(
              "flex-1 overflow-y-auto px-6 py-5 relative z-10 select-none",
              isDark ? "boult-scrollbar" : "scrollbar-thin scrollbar-thumb-black/20 scrollbar-track-transparent"
            )}>
              {dynamicArtifacts.length > 0 ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h4 className={cn("text-[10px] font-bold uppercase tracking-wider", isDark ? "text-[#737373]" : "text-black/40")}>All Documents</h4>
                    <span className={cn("text-[10px] font-mono", isDark ? "text-[#525252]" : "text-black/30")}>{filteredArtifacts.length} total</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredArtifacts.map(art => {
                      const snippet = art.raw
                        .replace(/^#{1,6}\s+/gm, '')
                        .replace(/[*_`~]/g, '')
                        .replace(/\n+/g, ' ')
                        .trim()
                        .slice(0, 120);
                      const isDownloading = downloadingId === art.id;
                      return (
                        <div
                          key={art.id}
                          onClick={() => handleSelect(art)}
                          className={cn(
                            "group p-4 rounded-2xl transition-all duration-150 cursor-pointer border flex flex-col justify-between",
                            isDark 
                              ? "dark-graphite-item" 
                              : "bg-black/5 hover:bg-black/8 border-black/8 hover:border-black/15"
                          )}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2.5">
                              <span className={cn(
                                "px-2 py-0.5 rounded-full text-[9px] font-mono tracking-wide border",
                                isDark 
                                  ? "dark-graphite-tag" 
                                  : "bg-black/6 border-black/8 text-black/50"
                              )}>
                                {art.tag}
                              </span>
                              <button
                                onClick={e => handleDownload(e, art)}
                                className={cn(
                                  "p-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100",
                                  isDark 
                                    ? "hover:bg-[#363636] text-[#737373] hover:text-white" 
                                    : "hover:bg-black/8 text-black/30 hover:text-black/60"
                                )}
                                title="Download .docx"
                              >
                                {isDownloading
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Download className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            <h5 className={cn("text-[13px] font-semibold leading-snug tracking-tight mb-1.5", isDark ? "text-white" : "text-black/85")}>
                              {art.title}
                            </h5>

                            {snippet && (
                              <p className={cn("text-[12px] leading-relaxed line-clamp-2 mb-3", isDark ? "text-[#737373]" : "text-black/45")}>
                                {snippet}{snippet.length === 120 ? '…' : ''}
                              </p>
                            )}
                          </div>

                          <div className={cn(
                            "flex items-center justify-between pt-2.5 border-t text-[10px] font-mono mt-auto",
                            isDark ? "dark-graphite-divider" : "border-black/8"
                          )}>
                            <span className={cn("truncate max-w-[50%]", isDark ? "text-[#737373]" : "text-black/35")}>{art.subtitle}</span>
                            <span className={cn(
                              "flex items-center gap-1 transition-colors shrink-0",
                              isDark 
                                ? "text-[#737373] group-hover:text-white" 
                                : "text-black/35 group-hover:text-black/55"
                            )}>
                              Open in Canvas <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {filteredArtifacts.length === 0 && (
                      <div className="py-12 flex flex-col items-center justify-center text-center col-span-2">
                        <FileText className={cn("w-8 h-8 mb-3", isDark ? "text-[#737373]/30" : "text-black/20")} />
                        <p className={cn("text-[12px] font-medium", isDark ? "text-[#737373]" : "text-black/35")}>No results for "{searchQuery}"</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                  <div className={cn(
                    "w-16 h-16 rounded-2xl border flex items-center justify-center mb-6",
                    isDark ? "dark-graphite-icon-wrapper" : "bg-black/5 border-black/8"
                  )}>
                    <Sparkles className={cn("w-6 h-6 animate-pulse", isDark ? "text-[#737373]" : "text-black/25")} />
                  </div>
                  <h4 className={cn("text-[15px] font-bold tracking-tight mb-2", isDark ? "text-[#737373]" : "text-black/70")}>
                    Your library is empty
                  </h4>
                  <p className={cn("text-[12px] leading-relaxed max-w-[260px]", isDark ? "text-[#737373]" : "text-black/40")}>
                    Documents, plans, and drafts created by Boult across all your conversations will appear here — searchable and downloadable as .docx.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
