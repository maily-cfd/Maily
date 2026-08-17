'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Copy, Check, Edit3, FileText, Mail, Sparkles,
  BarChart3, Zap, Globe, Calendar, ArrowRight, Send,
  Download, ChevronLeft, ChevronRight, Loader2,
  AlertTriangle, CheckCircle2, Clock, ListTodo, Target,
  HelpCircle, Shield, Play, Printer,
  ChevronDown, Maximize2, Minimize2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { CanvasEditor } from './CanvasEditor';
import { normalizeDocumentMarkdown } from '@/lib/boult/markdown-normalize';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BoultTable, parseBoultTable,
  BoultSteps, parseBoultSteps,
  BoultGallery, parseBoultGallery,
} from './CanvasBlocks';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanvasType =
  | 'email_draft' | 'summary' | 'research' | 'action_plan' | 'reply'
  | 'notes' | 'meeting_schedule' | 'analytics' | 'workflow' | 'execution'
  | 'artifacts' | 'action_outputs' | 'next_actions' | 'none'
  | 'report' | 'analysis';

export interface CanvasData {
  type: CanvasType;
  title?: string;
  content: any;
  sections?: any[];
  actions?: { actionType: string; label?: string; requiresApproval?: boolean }[];
  approvalTokens?: Record<string, string>;
  raw?: string;
  error?: string;
  isUpdate?: boolean;
}

interface CanvasPanelProps {
  isOpen: boolean;
  onClose: () => void;
  canvasData: CanvasData | null;
  onExecute: (action: string, data: unknown) => void;
  isExecuting?: boolean;
  isSidebarCollapsed?: boolean;
  onSendToChat?: (message: string) => void;
  /**
   * Fires when the user selects text in the document and clicks "Add to chat".
   * Receives the selection as markdown plus the document title, so the chat
   * composer can show a labelled chip ("selection from <title>") and the model
   * can be told exactly which document the quote came from.
   */
  onAddSelectionToChat?: (selection: { text: string; docTitle: string }) => void;
}

// ─── Type config ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, {
  label: string;
  Icon: any;
  accent: string;
  badge: string;
  badgeText: string;
}> = {
  email_draft:     { label: 'Email Draft',   Icon: Mail,      accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  reply:           { label: 'Reply',          Icon: Mail,      accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  report:          { label: 'Report',         Icon: FileText,  accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  notes:           { label: 'Notes',          Icon: Edit3,     accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  analysis:        { label: 'Analysis',       Icon: BarChart3, accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  analytics:       { label: 'Analytics',      Icon: BarChart3, accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  action_plan:     { label: 'Action Plan',    Icon: Zap,       accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  research:        { label: 'Research',       Icon: Globe,     accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  summary:         { label: 'Summary',        Icon: FileText,  accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  meeting_schedule:{ label: 'Schedule',       Icon: Calendar,  accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  workflow:        { label: 'Workflow',        Icon: Sparkles,  accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  execution:       { label: 'Execution',       Icon: Play,      accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  artifacts:       { label: 'Files',           Icon: FileText,  accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  action_outputs:  { label: 'Results',         Icon: CheckCircle2, accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  next_actions:    { label: 'Next Steps',      Icon: ArrowRight, accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
  none:            { label: 'Document',        Icon: Sparkles,  accent: '#ffffff', badge: 'bg-boult-elevated border-boult-border', badgeText: 'text-boult-fg-secondary' },
};

/**
 * Which canvas types are DOCUMENTS the user authors, versus RESULTS the agent
 * reports. Only documents get the always-on editor.
 *
 * Everything non-email already rendered as markdown, so this changes no
 * output — but an "execution" or "action_outputs" canvas is a readout of what
 * happened, and putting a cursor and a formatting bar on it would invite the
 * user to rewrite history that nothing will persist.
 */
const EDITABLE_DOC_TYPES = new Set([
  'report', 'notes', 'analysis', 'analytics', 'action_plan',
  'research', 'summary', 'workflow', 'none',
]);

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? TYPE_CONFIG.none;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function CanvasPanel({
  isOpen, onClose, canvasData, onExecute, isExecuting, isSidebarCollapsed, onAddSelectionToChat,
}: CanvasPanelProps) {
  const [editMode, setEditMode]           = useState(false);
  const [editedBody, setEditedBody]       = useState('');
  const [copied, setCopied]               = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [width, setWidth]                 = useState(540);
  const [isResizing, setIsResizing]       = useState(false);
  // Expand-to-fill. A 540px column is fine for an email draft and cramped for a
  // real document — the reference gives the doc the whole surface on demand.
  const [expanded, setExpanded]           = useState(false);
  const [downloadMenu, setDownloadMenu]   = useState(false);
  const [isClient, setIsClient]           = useState(false);
  // Displayed data lags behind prop during update transitions
  const [displayedData, setDisplayedData] = useState<CanvasData | null>(canvasData);
  const [isBlurring, setIsBlurring]       = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setIsClient(true); }, []);

  // Blur-fade transition when canvas content is updated by the agent
  useEffect(() => {
    if (!canvasData) { setDisplayedData(null); return; }
    if (canvasData.isUpdate && displayedData) {
      setIsBlurring(true);
      const t = setTimeout(() => {
        setDisplayedData(canvasData);
        setIsBlurring(false);
      }, 280);
      return () => clearTimeout(t);
    } else {
      setDisplayedData(canvasData);
    }
  }, [canvasData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tracks the exact text we last seeded the editor from, so we can tell a
  // genuinely NEW document apart from a re-render of the same one.
  const seededFrom = useRef<string | null>(null);

  useEffect(() => {
    if (!displayedData) return;

    const isEmailDoc = displayedData.type === 'email_draft' || displayedData.type === 'reply';
    const incoming = isEmailDoc
      ? (displayedData.content?.body || extractEmailBody(displayedData.raw || ''))
      : (displayedData.raw || (typeof displayedData.content === 'string' ? displayedData.content : '') || '');

    // This effect used to setEditedBody + setEditMode(false) on EVERY
    // displayedData change. Any re-render while the user was typing threw them
    // out of edit mode and replaced their text with the original — losing work
    // with no warning. Re-seed only when the incoming document is actually
    // different from the one we seeded from.
    if (seededFrom.current === incoming) return;

    seededFrom.current = incoming;
    setEditedBody(incoming);
    // Leave edit mode only when the document underneath genuinely changed —
    // otherwise the agent streaming an unrelated update yanks the cursor out.
    setEditMode(false);
  }, [displayedData]);

  // ── Resize ───────────────────────────────────────────────────────────────────
  const startResizing = useCallback((e: React.MouseEvent) => { e.preventDefault(); setIsResizing(true); }, []);
  const stopResizing  = useCallback(() => { setIsResizing(false); }, []);
  const handleResize  = useCallback((e: MouseEvent) => {
    if (!isResizing || window.innerWidth < 768) return;
    const sidebarW = isSidebarCollapsed ? 80 : 256;
    const max = window.innerWidth - sidebarW - 500 - 48;
    const next = window.innerWidth - e.clientX;
    setWidth(Math.max(380, Math.min(next, max)));
  }, [isResizing, isSidebarCollapsed]);

  useEffect(() => {
    // Only listen WHILE dragging. These were attached permanently, so every
    // mouse move anywhere in the app ran a handler that immediately returned —
    // and because handleResize is rebuilt on each render, the pair was being
    // torn down and re-added on every render of the panel.
    if (!isResizing) return;
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResizing);
    // Kills text selection while dragging the divider — without it the whole
    // document highlights as you drag.
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.userSelect = prevSelect;
    };
  }, [isResizing, handleResize, stopResizing]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  /**
   * THE document as it currently stands — the single source of truth for copy,
   * download, PDF and the word count.
   *
   * This used to return displayedData.raw, i.e. the ORIGINAL text, ignoring
   * `editedBody` entirely. So every edit the user made existed only as pixels:
   * you could rewrite a document, hit Download, and get the version you started
   * with — silently, with no indication anything had been dropped. Copy, PDF
   * and the word count all had the same bug because they all call this.
   *
   * editedBody is seeded from the document whenever canvas data arrives and is
   * updated live by the editor, so once populated it IS the document.
   */
  const getTextContent = () => {
    if (!displayedData) return '';
    const isEmailDoc = displayedData.type === 'email_draft' || displayedData.type === 'reply';

    if (isEmailDoc) {
      // For email, editedBody is the BODY only — re-attach the headers so a
      // downloaded .txt is a complete email rather than a naked paragraph.
      const body = editedBody || displayedData.content?.body || extractEmailBody(displayedData.raw || '');
      const to = displayedData.content?.to || '';
      const subject = displayedData.content?.subject || '';
      const header = [to && `To: ${to}`, subject && `Subject: ${subject}`].filter(Boolean).join('\n');
      return header ? `${header}\n\n${body}` : body;
    }

    if (editedBody) return editedBody;
    if (displayedData.raw) return displayedData.raw;
    if (typeof displayedData.content === 'string') return displayedData.content;
    if (displayedData.content?.body) return displayedData.content.body;
    return JSON.stringify(displayedData.content, null, 2);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getTextContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadDocx = async () => {
    if (downloadingDocx) return;
    const text = getTextContent();
    if (!text) return;
    const isEmail = displayedData?.type === 'email_draft' || displayedData?.type === 'reply';
    const safeName = (displayedData?.title || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '_');

    if (isEmail) {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }

    setDownloadingDocx(true);
    try {
      const { markdownToDocxBlob, triggerDocxDownload } = await import('@/lib/boult/docx-export');
      const blob = await markdownToDocxBlob(text, canvasData?.title || 'document');
      triggerDocxDownload(blob, safeName);
    } catch {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloadingDocx(false);
    }
  };

  // Export the current document as a PDF via the browser's print engine.
  // Dependency-free and produces a clean, properly typeset page.
  const handleExportPdf = () => {
    const text = getTextContent();
    if (!text) return;
    const title = displayedData?.title || 'Document';
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) return;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        @page { margin: 22mm 20mm; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
               color: #111; line-height: 1.7; font-size: 12.5pt; max-width: 720px; margin: 0 auto; padding: 24px; }
        h1 { font-size: 22pt; margin: 0 0 14px; letter-spacing: -0.01em; }
        h2 { font-size: 15pt; margin: 26px 0 8px; }
        h3 { font-size: 13pt; margin: 20px 0 6px; }
        p, li { font-size: 12.5pt; }
        hr { border: none; border-top: 1px solid #ddd; margin: 22px 0; }
        pre { white-space: pre-wrap; }
      </style></head><body><pre style="white-space:pre-wrap;font-family:inherit;border:none;margin:0">${esc(text)}</pre>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);}<\/script>
      </body></html>`);
    win.document.close();
  };

  const handleSend = () => {
    // Was `editMode ? editedBody : content.body`, which sent the ORIGINAL any
    // time the user pressed "Done editing" before Send — i.e. the exact,
    // deliberate sequence a careful person follows. Their edits went out the
    // window silently. editedBody is seeded from content.body on load, so it is
    // always the right value to send once populated.
    const body = editedBody || displayedData?.content?.body || '';
    const payload = displayedData?.content?.threadId
      ? { ...displayedData.content, body }
      : { ...(displayedData?.content || {}), body };
    onExecute('send_email', payload);
  };

  if (!isOpen || !displayedData) return null;

  const cfg = getConfig(displayedData.type);
  const isEmail = displayedData.type === 'email_draft' || displayedData.type === 'reply';
  const isMobile = isClient && window.innerWidth < 768;
  // Expanded caps at 1100px rather than going truly full-bleed: past roughly
  // 90 characters a line becomes hard to track, so a wider panel would make the
  // document worse, not better.
  const panelWidth = isMobile
    ? 'calc(100vw - 16px)'
    : expanded ? 'min(1100px, calc(100vw - 340px))' : `${width}px`;

  // "Document · 2.5 KB" — measured from the LIVE document, so it tracks edits.
  // The first version read displayedData.body (a field that does not exist) and
  // fell back to .content, which is an object for emails — Blob size of a
  // non-string is 0, so the label simply never appeared.
  const docSizeLabel = (() => {
    const text = getTextContent();
    const bytes = text ? new Blob([text]).size : 0;
    if (!bytes) return '';
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  })();

  return (
    <motion.div
      initial={isMobile ? { opacity: 0, y: 40 } : { opacity: 0, x: 40, scale: 0.985 }}
      animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'flex flex-col flex-shrink-0 relative',
        'bg-boult-elevated border border-boult-border shadow-[0_12px_48px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_32px_80px_-8px_rgba(0,0,0,0.8)]',
        'overflow-hidden select-text',
        isMobile
          ? 'fixed inset-x-2 bottom-2 top-auto rounded-[24px] z-[200]'
          : 'h-[calc(100vh-32px)] rounded-[24px] m-3',
        isResizing ? 'cursor-ew-resize' : '',
      )}
      style={{ width: isMobile ? 'calc(100vw - 16px)' : panelWidth, maxHeight: isMobile ? '80vh' : undefined }}
    >
      {/* Accent glow at top */}
      <div
        className="absolute inset-x-0 top-0 h-[1px] opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${cfg.accent}, transparent)` }}
      />

      {/* Resize handle */}
      <div
        onMouseDown={startResizing}
        className="hidden md:block absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-boult-surface-hover transition-colors"
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.03] bg-boult-elevated">
        {/* Identity block: icon TILE, then title over a metadata line. The old
            header put a coloured type-badge beside the title on one row, which
            spent the most valuable space in the panel on a label the user
            already knows (they just asked for a doc) and left no room to say
            anything true about the file. */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border',
            cfg.badge, cfg.badgeText
          )}>
            <cfg.Icon className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-boult-fg truncate leading-tight">
              {displayedData.title || 'Document'}
            </h2>
            <p className="text-[11.5px] text-boult-fg-tertiary leading-tight mt-0.5">
              {cfg.label}
              {docSizeLabel ? <> · {docSizeLabel}</> : null}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Download is the PRIMARY action and looks like it. Format choice
              lives in its menu rather than as three separate icon buttons —
              copy/PDF/docx were visually equal to Close, so nothing read as the
              thing you actually came to do. */}
          <div className="relative">
            <button
              onClick={() => setDownloadMenu(v => !v)}
              // Primary = inverse fill (black on light, white on dark). The
              // reference uses a blue pill, but this design system is
              // monochrome — importing an accent colour for one button would
              // make it the only coloured thing in the product.
              className="flex items-center gap-1.5 h-8 pl-3 pr-2.5 rounded-full bg-boult-fg text-boult-fg-inverse text-[12.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              {downloadingDocx
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />}
              Download
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', downloadMenu && 'rotate-180')} />
            </button>

            {downloadMenu && (
              <>
                {/* Click-away. A menu that only closes on re-click strands the
                    user behind an invisible layer if they reach elsewhere. */}
                <div className="fixed inset-0 z-40" onClick={() => setDownloadMenu(false)} />
                <div className="absolute right-0 top-9 z-50 w-44 py-1 rounded-xl border border-boult-border bg-boult-elevated shadow-xl">
                  <button
                    onClick={() => { setDownloadMenu(false); handleDownloadDocx(); }}
                    className="w-full text-left px-3 py-2 text-[12.5px] text-boult-fg-secondary hover:bg-boult-surface transition-colors"
                  >
                    {isEmail ? 'Plain text (.txt)' : 'Word (.docx)'}
                  </button>
                  <button
                    onClick={() => { setDownloadMenu(false); handleExportPdf(); }}
                    className="w-full text-left px-3 py-2 text-[12.5px] text-boult-fg-secondary hover:bg-boult-surface transition-colors"
                  >
                    PDF
                  </button>
                  <button
                    onClick={() => { setDownloadMenu(false); handleCopy(); }}
                    className="w-full text-left px-3 py-2 text-[12.5px] text-boult-fg-secondary hover:bg-boult-surface transition-colors"
                  >
                    {copied ? 'Copied' : 'Copy as Markdown'}
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setExpanded(v => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
            className="hidden md:flex w-8 h-8 items-center justify-center rounded-lg hover:bg-boult-surface text-boult-fg-tertiary hover:text-boult-fg-secondary transition-all"
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          {isEmail && (
            <button
              onClick={handleSend}
              title="Send as Email"
              disabled={isExecuting}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-boult-surface text-boult-fg-tertiary hover:text-emerald-600 dark:hover:text-emerald-400 transition-all disabled:opacity-40"
            >
              {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          )}
          <div className="w-px h-4 bg-boult-border mx-1" />
          <button
            onClick={onClose}
            title="Close"
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-boult-surface text-boult-fg-tertiary hover:text-boult-fg-secondary transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Email metadata strip ────────────────────────────────────────────── */}
      {isEmail && (
        <div className="shrink-0 border-b border-black/[0.05] dark:border-white/[0.03] bg-boult-elevated/60">
          <EmailField label="To"      value={displayedData.content?.to      || ''} />
          <EmailField label="Subject" value={displayedData.content?.subject || ''} last />
        </div>
      )}

      {/* ── Content — wrapped in blur/fade transition for canvas updates ─────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto canvas-scroll">
        <div
          className="px-7 py-6 transition-all duration-[280ms] ease-in-out"
          style={{
            opacity: isBlurring ? 0 : 1,
            filter: isBlurring ? 'blur(6px)' : 'blur(0px)',
          }}
        >
          <AnimatePresence mode="wait">
            {isEmail ? (
              <motion.div key="email" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <MetaInsights type={displayedData.type} content={getTextContent()} />
                {editMode ? (
                  // Email stays a PLAIN textarea by design, not by neglect: the
                  // markdown editor would serialise bold as **bold**, and a
                  // plain-text email sends those asterisks literally. Only the
                  // type scale is brought up to match the rest of the panel.
                  <textarea
                    value={editedBody}
                    onChange={e => setEditedBody(e.target.value)}
                    className="w-full min-h-[360px] bg-transparent text-[15.5px] text-boult-fg leading-[1.75] resize-none focus:outline-none font-sans"
                    autoFocus
                    placeholder="Email body…"
                  />
                ) : (
                  <div className="prose-canvas text-[14px] text-boult-fg-secondary leading-relaxed whitespace-pre-wrap font-sans">
                    {displayedData.content?.body || extractEmailBody(displayedData.raw || '')}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div key="doc" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {/* ALWAYS EDITABLE — no view/edit toggle. The document is the
                    document; you click into it and type, and the formatting bar
                    is always there. The old model made the user find an "Edit"
                    button in a footer before they could change a word, and
                    swapped the renderer underneath them when they did — which
                    is also what made every edit-state bug possible, because
                    there were two representations of the same text.
                    Read and edit typography are identical, so there is nothing
                    to reflow. Result-type canvases stay read-only — see
                    EDITABLE_DOC_TYPES. */}
                {EDITABLE_DOC_TYPES.has(displayedData.type) ? (
                  <CanvasEditor
                    value={editedBody}
                    onChange={setEditedBody}
                    onAddSelectionToChat={
                      onAddSelectionToChat
                        ? (text) => onAddSelectionToChat({
                            text,
                            docTitle: displayedData.title || 'Document',
                          })
                        : undefined
                    }
                  />
                ) : (
                  <MarkdownView content={editedBody || displayedData.raw || (typeof displayedData.content === 'string' ? displayedData.content : '')} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="shrink-0 border-t border-black/[0.05] dark:border-white/[0.03] bg-boult-elevated px-5 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-boult-fg-muted tabular-nums">
            {wordCount(getTextContent())} words
          </span>
          {isEmail && (
            <>
              <span className="w-px h-3 bg-boult-border" />
              <span className="text-[11px] text-boult-fg-muted tabular-nums">
                {(editMode ? editedBody : (displayedData.content?.body || extractEmailBody(displayedData.raw || ''))).length} characters
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isEmail ? (
            <>
              {editMode ? (
                <FooterButton onClick={() => setEditMode(false)} variant="ghost">Done editing</FooterButton>
              ) : (
                <FooterButton onClick={() => setEditMode(true)} variant="ghost" icon={<Edit3 className="w-3.5 h-3.5" />}>Edit</FooterButton>
              )}
              <FooterButton
                onClick={handleSend}
                variant="primary"
                icon={<Send className="w-3.5 h-3.5" />}
                loading={isExecuting}
              >
                Send Email
              </FooterButton>
            </>
          ) : (
            // Documents are always editable now, so "Edit"/"Done editing" would
            // toggle nothing, and Download already lives in the header as the
            // primary action. Duplicating it here just gave the same command two
            // homes with different weights. The doc footer is now status only.
            <span className="text-[11px] text-boult-fg-muted">
              Saved to this conversation
            </span>
          )}
        </div>
      </footer>

    </motion.div>
  );
}

// ─── Email field row ────────────────────────────────────────────────────────────

function EmailField({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn('flex items-start gap-3 px-6 py-2.5', !last && 'border-b border-black/[0.05] dark:border-white/[0.03]')}>
      <span className="text-[11px] font-semibold text-boult-fg-muted uppercase tracking-widest w-[42px] shrink-0 pt-[1px]">{label}</span>
      <span className="text-[13px] text-boult-fg-secondary leading-snug">{value || '—'}</span>
    </div>
  );
}

// ─── Footer button ──────────────────────────────────────────────────────────────

function FooterButton({
  children, onClick, variant, icon, loading,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant: 'primary' | 'ghost';
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 px-3.5 h-8 rounded-xl text-[12px] font-semibold transition-all active:scale-95 disabled:opacity-50',
        variant === 'primary'
          ? 'bg-boult-fg text-boult-fg-inverse hover:opacity-90'
          : 'text-boult-fg-tertiary hover:text-boult-fg-secondary hover:bg-boult-surface',
      )}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─── Meta Insights Component ──────────────────────────────────────────────────

function MetaInsights({ type, content }: { type: string; content: string }) {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const minRead = Math.max(1, Math.ceil(words / 200));

  const getTags = () => {
    const tags = [`${minRead} min read`];
    const lower = content.toLowerCase();
    
    if (type === 'email_draft' || type === 'reply') {
      tags.push('Style-Matched');
      tags.push('Draft Reply');
    } else if (type === 'report') {
      tags.push('Weekly Digest');
      tags.push('Inbox Analysis');
    } else if (type === 'analysis' || type === 'analytics') {
      tags.push('Statistical');
      tags.push('AI Audit');
    } else if (type === 'action_plan') {
      tags.push('Actionable');
      tags.push('CRM Tasks');
    } else {
      tags.push('AI Memo');
    }

    if (lower.includes('urgent') || lower.includes('alert') || lower.includes('security')) {
      tags.push('High Priority');
    }
    
    if (lower.includes('revenue') || lower.includes('deal') || lower.includes('$')) {
      tags.push('Revenue Deal');
    }

    return tags;
  };

  const tags = getTags();

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 p-3 px-4 rounded-xl bg-boult-elevated border border-boult-border backdrop-blur-md">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-boult-fg-muted uppercase tracking-widest mr-2 shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-boult-fg-secondary" />
        Meta Insights
      </div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, idx) => (
          <span 
            key={idx} 
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-all duration-200",
              tag === 'High Priority' 
                ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white animate-pulse"
                : tag === 'Revenue Deal'
                ? "bg-black/80 text-white border-black dark:bg-white/80 dark:text-black dark:border-white"
                : "bg-boult-elevated border-boult-border text-boult-fg-secondary"
            )}
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── YAML/Text Chart Parser ────────────────────────────────────────────────────

interface ChartData {
  type: 'bar' | 'line' | 'pie';
  title?: string;
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

function parseChartContent(content: string, typeHint?: 'bar' | 'line' | 'pie'): ChartData | null {
  try {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const data: Partial<ChartData> = {
      type: typeHint || 'bar',
      labels: [],
      datasets: []
    };

    let currentDataset: any = null;

    for (const line of lines) {
      if (line.toLowerCase().startsWith('type:')) {
        const t = line.split(':')[1].trim().toLowerCase();
        if (t === 'bar' || t === 'line' || t === 'pie') {
          data.type = t;
        }
      } else if (line.toLowerCase().startsWith('title:')) {
        data.title = line.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
      } else if (line.toLowerCase().startsWith('labels:')) {
        const val = line.split(':').slice(1).join(':').trim();
        try {
          data.labels = JSON.parse(val);
        } catch {
          data.labels = val.replace(/[\[\]"']/g, '').split(',').map(s => s.trim());
        }
      } else if (line.startsWith('-') || line.startsWith('dataset:')) {
        // Ignored
      } else if (line.toLowerCase().startsWith('label:')) {
        currentDataset = { label: line.split(':')[1].trim().replace(/^['"]|['"]$/g, ''), data: [] };
        data.datasets!.push(currentDataset);
      } else if (line.toLowerCase().startsWith('values:') || line.toLowerCase().startsWith('data:')) {
        const val = line.split(':').slice(1).join(':').trim();
        let nums: number[] = [];
        try {
          nums = JSON.parse(val);
        } catch {
          nums = val.replace(/[\[\]"']/g, '').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
        }
        if (currentDataset) {
          currentDataset.data = nums;
        } else {
          if (data.datasets!.length === 0) {
            data.datasets!.push({ label: 'Value', data: nums });
          } else {
            data.datasets![0].data = nums;
          }
        }
      } else if (line.includes(':')) {
        const parts = line.split(':');
        const k = parts[0].trim().replace(/^[-* ]+/, '');
        const v = parseFloat(parts[1].trim());
        if (!isNaN(v)) {
          data.labels!.push(k);
          if (data.datasets!.length === 0) {
            data.datasets!.push({ label: 'Value', data: [] });
          }
          data.datasets![0].data.push(v);
        }
      }
    }

    if (data.labels!.length && data.datasets!.length) {
      return data as ChartData;
    }
  } catch (e) {
    console.error('Failed to parse chart', e);
  }
  return null;
}

// ─── Dynamic SVG Interactive Charts ────────────────────────────────────────────

function InteractiveChart({ data }: { data: ChartData }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.type === 'pie') {
    const values = data.datasets[0]?.data || [];
    const total = values.reduce((sum, v) => sum + v, 0);
    const colors = [
      '#ffffff',               // Pure white
      'rgba(255,255,255,0.85)', // High opacity white
      'rgba(255,255,255,0.7)',  // Medium-high opacity white
      'rgba(255,255,255,0.5)',  // Medium opacity white
      'rgba(255,255,255,0.3)',  // Medium-low opacity white
      'rgba(255,255,255,0.15)', // Low opacity white
    ];

    let accumulatedAngle = 0;
    const radius = 70;
    const strokeWidth = 24;
    const center = 100;
    const circumference = 2 * Math.PI * radius;

    return (
      <div className="my-6 p-6 rounded-2xl bg-boult-elevated border border-boult-border flex flex-col sm:flex-row items-center gap-8 backdrop-blur-md">
        <div className="relative w-[180px] h-[180px] flex-shrink-0">
          <svg viewBox="0 0 200 200" className="w-full h-full transform -rotate-90">
            {values.map((v, idx) => {
              const percentage = total > 0 ? v / total : 0;
              const strokeDasharray = `${percentage * circumference} ${circumference}`;
              const strokeDashoffset = -accumulatedAngle * circumference;
              accumulatedAngle += percentage;

              const isHovered = hoveredIdx === idx;

              return (
                <circle
                  key={idx}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="transparent"
                  stroke={colors[idx % colors.length]}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-300 cursor-pointer origin-center hover:scale-[1.02]"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] text-boult-fg-muted font-semibold uppercase tracking-wider">Total</span>
            <span className="text-[20px] font-bold text-boult-fg tracking-tight">{total}</span>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-3 w-full">
          {data.title && <h4 className="text-[13px] font-bold text-boult-fg mb-1">{data.title}</h4>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.labels.map((label, idx) => {
              const val = values[idx] || 0;
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              const isHovered = hoveredIdx === idx;

              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-xl border transition-all duration-200 cursor-pointer",
                    isHovered
                      ? "bg-boult-surface border-boult-divider scale-[1.02]"
                      : "bg-boult-elevated border-transparent"
                  )}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colors[idx % colors.length] }} />
                    <span className="text-[12px] font-medium text-boult-fg-secondary truncate">{label}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[12px] font-semibold text-boult-fg">{val}</span>
                    <span className="text-[10px] text-boult-fg-tertiary font-mono">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const labels = data.labels;
  const datasets = data.datasets;
  const colors = [
    '#ffffff',               // Pure white
    'rgba(255,255,255,0.7)',  // White 70%
    'rgba(255,255,255,0.4)',  // White 40%
    'rgba(255,255,255,0.2)',  // White 20%
  ];

  const allValues = datasets.flatMap(d => d.data);
  const maxVal = Math.max(...allValues, 1);
  const minVal = 0;
  const range = maxVal - minVal;
  const padding = range * 0.1;
  const gridMax = Math.ceil((maxVal + padding) / 5) * 5;

  const chartHeight = 160;
  const chartWidth = 380;
  const paddingX = 40;
  const paddingY = 20;

  const getX = (index: number) => paddingX + (index * (chartWidth - paddingX * 2)) / Math.max(labels.length - 1, 1);
  const getY = (value: number) => chartHeight - paddingY - ((value - minVal) * (chartHeight - paddingY * 2)) / gridMax;

  return (
    <div className="my-6 p-6 rounded-2xl bg-boult-elevated border border-boult-border flex flex-col gap-4 backdrop-blur-md">
      {data.title && (
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-bold text-boult-fg">{data.title}</h4>
          <div className="flex items-center gap-3">
            {datasets.map((d, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors[idx % colors.length] }} />
                <span className="text-[10px] text-boult-fg-tertiary font-medium">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative w-full h-[180px]">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
          {[0, 1, 2, 3, 4].map(i => {
            const val = (gridMax / 4) * i;
            const y = getY(val);
            return (
              <g key={i} className="opacity-25">
                <line x1={paddingX} y1={y} x2={chartWidth - paddingX} y2={y} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} strokeDasharray="3 3" />
                <text x={paddingX - 8} y={y + 3} fill="rgba(255,255,255,0.4)" fontSize={8} textAnchor="end" className="font-mono">{Math.round(val)}</text>
              </g>
            );
          })}

          {data.type === 'bar' && datasets.map((d, dIdx) => {
            const barWidth = Math.max(2, (chartWidth - paddingX * 2) / (labels.length * 3));
            const groupOffset = (dIdx - (datasets.length - 1) / 2) * (barWidth + 2);

            return d.data.map((val, idx) => {
              const x = getX(idx) + groupOffset;
              const y = getY(val);
              const height = chartHeight - paddingY - y;
              const isHovered = hoveredIdx === idx;

              return (
                <rect
                  key={`${dIdx}-${idx}`}
                  x={x - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={Math.max(2, height)}
                  rx={2}
                  fill={colors[dIdx % colors.length]}
                  fillOpacity={isHovered ? 0.95 : 0.75}
                  className="transition-all duration-200 cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            });
          })}

          {data.type === 'line' && datasets.map((d, dIdx) => {
            let pathData = '';
            d.data.forEach((val, idx) => {
              const x = getX(idx);
              const y = getY(val);
              if (idx === 0) pathData += `M ${x} ${y}`;
              else pathData += ` L ${x} ${y}`;
            });

            return (
              <g key={dIdx}>
                <path
                  d={`${pathData} L ${getX(labels.length - 1)} ${chartHeight - paddingY} L ${getX(0)} ${chartHeight - paddingY} Z`}
                  fill={`url(#gradient-${dIdx})`}
                  className="opacity-10"
                />
                <defs>
                  <linearGradient id={`gradient-${dIdx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[dIdx % colors.length]} />
                    <stop offset="100%" stopColor="transparent" />
                  </linearGradient>
                </defs>

                <path
                  d={pathData}
                  fill="transparent"
                  stroke={colors[dIdx % colors.length]}
                  strokeWidth={2}
                  strokeLinecap="round"
                />

                {d.data.map((val, idx) => {
                  const x = getX(idx);
                  const y = getY(val);
                  const isHovered = hoveredIdx === idx;

                  return (
                    <circle
                      key={idx}
                      cx={x}
                      cy={y}
                      r={isHovered ? 4.5 : 3}
                      fill={colors[dIdx % colors.length]}
                      stroke="#0A0A0A"
                      strokeWidth={1.5}
                      className="transition-all duration-150 cursor-pointer"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  );
                })}
              </g>
            );
          })}

          {labels.map((label, idx) => {
            const x = getX(idx);
            const isHovered = hoveredIdx === idx;
            return (
              <text
                key={idx}
                x={x}
                y={chartHeight - 4}
                fill={isHovered ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'}
                fontSize={8}
                textAnchor="middle"
                className="font-medium transition-colors duration-150"
              >
                {label}
              </text>
            );
          })}
        </svg>

        {hoveredIdx !== null && (
          <div 
            className="absolute z-10 px-2.5 py-1.5 rounded-lg bg-boult-bg/90 border border-boult-divider text-[10px] text-boult-fg flex flex-col gap-1 pointer-events-none shadow-lg"
            style={{
              left: `${Math.min(getX(hoveredIdx) * 0.9, 240)}px`,
              top: '10px'
            }}
          >
            <span className="font-bold text-boult-fg-tertiary uppercase">{labels[hoveredIdx]}</span>
            {datasets.map((d, dIdx) => (
              <div key={dIdx} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: colors[dIdx % colors.length] }} />
                <span>{d.label}: <strong>{d.data[hoveredIdx]}</strong></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Beautiful markdown renderer ────────────────────────────────────────────────

/**
 * Defensive normalizer for LLM-authored markdown.
 *
 * Catches the most common rendering-breaker: numbered prose like
 *   "1. **First** - desc 2. **Second** - desc 3. **Third** - desc"
 * (all on one line) and reflows it into a real ordered list so ReactMarkdown
 * + GFM render it as line items instead of one giant paragraph.
 *
 * Trigger: a single line that contains 3+ matches of `N. **Title**` or
 * `N. Title:` where N >= 2. We split on those boundaries and emit one
 * numbered line each. Conservative — runs only when the heuristic is sure.
 */
function normalizeInlineEnumeration(md: string): string {
  if (!md) return md;
  const lines = md.split('\n');
  const out: string[] = [];
  // Match boundaries like " 2. **Title**" or " 3. Title:" mid-line
  const BOUNDARY = /\s+(\d+)\.\s+(?=\*\*|[A-Z][a-zA-Z ]{2,40}\s+[-—:])/g;
  for (const raw of lines) {
    // Only target lines that start with "1." or "1)" and contain 2+ later N.
    if (!/^\s*1[.)]\s/.test(raw)) { out.push(raw); continue; }
    const laterMatches = (raw.match(/\s+(\d+)\.\s+/g) || []).filter(m => {
      const n = parseInt(m.trim());
      return n >= 2;
    });
    if (laterMatches.length < 2) { out.push(raw); continue; }
    // Split on the boundary while keeping the digits. Use a placeholder to
    // simplify splitting without losing the leading "1." prefix.
    const reflowed = raw.replace(BOUNDARY, '\n$1. ');
    for (const piece of reflowed.split('\n')) out.push(piece);
  }
  return out.join('\n');
}

function MarkdownView({ content }: { content: string }) {
  if (!content) return (
    <div className="flex flex-col items-center justify-center py-20 opacity-30">
      <Sparkles className="w-8 h-8 text-boult-fg-muted mb-3" />
      <p className="text-[13px] text-boult-fg-tertiary">No content</p>
    </div>
  );
  // Defensive normalization before ReactMarkdown. normalizeDocumentMarkdown is
  // the SAME repair the server runs — applied again here as the single
  // client-side choke point so that NO canvas document, from any tool
  // (open_canvas, the agent-spec card, a report, a reloaded cached doc, or a
  // future producer), can ever render a bare { "steps": [...] } blob as a wall
  // of raw JSON. It is idempotent, so re-running on already-fenced content is a
  // no-op. normalizeInlineEnumeration stays for the inline "1. .. 2. .." case it
  // uniquely handles.
  const normalized = normalizeInlineEnumeration(normalizeDocumentMarkdown(content));

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Editorial scale, not report scale. The old sizes (h1 22 / h2 17 /
        // body 14) plus a rule under every heading made a document read like a
        // filled-in form — the headings barely outranked the body, and the
        // borders chopped the page into boxes. Real documents get their
        // structure from SIZE and SPACE, so the rules are gone and the steps
        // between levels are wide enough to see at a glance.
        h1: ({ children }) => (
          <h1 className="text-[30px] font-bold text-boult-fg leading-[1.15] tracking-[-0.02em] mb-5 mt-1">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-[21px] font-bold text-boult-fg leading-snug tracking-[-0.015em] mt-9 mb-3">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[16px] font-semibold text-boult-fg leading-snug mt-6 mb-2.5">{children}</h3>
        ),
        // Body sits at full foreground contrast. It was fg-secondary, which is
        // correct for chat chrome and wrong for the thing the user came to read.
        p: ({ children }) => (
          <p className="text-[15.5px] text-boult-fg leading-[1.75] mb-4">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="mb-4 space-y-1.5 list-none pl-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-4 space-y-1.5 pl-5 list-decimal marker:text-boult-fg-muted">{children}</ol>
        ),
        li: ({ children, ...props }: any) => (
          props.ordered
            ? <li className="text-[15px] text-boult-fg leading-[1.7] pl-1">{children}</li>
            : <li className="flex items-start gap-2.5 text-[15px] text-boult-fg leading-[1.7] list-none">
                <span className="w-1.5 h-1.5 rounded-full bg-boult-fg-muted mt-[9px] shrink-0" />
                <span className="flex-1">{children}</span>
              </li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-boult-fg">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-boult-fg-secondary">{children}</em>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-boult-fg-muted pl-4 my-4 text-[13.5px] text-boult-fg-tertiary italic leading-relaxed">
            {children}
          </blockquote>
        ),
        code: ({ inline, children, ...props }: any) => {
          const rawText = String(children);
          const lang = props.className || '';

          if (!inline && (lang.includes('chart') || lang.includes('graph') || lang.includes('piechart') || lang.includes('pie-chart'))) {
            const parsed = parseChartContent(rawText, lang.includes('pie') ? 'pie' : lang.includes('line') ? 'line' : 'bar');
            if (parsed) {
              return <InteractiveChart data={parsed} />;
            }
          }

          // ── Boult rich blocks ────────────────────────────────────────────
          if (!inline && lang.includes('boult-table')) {
            const parsed = parseBoultTable(rawText);
            if (parsed) return <BoultTable data={parsed} />;
          }
          if (!inline && lang.includes('boult-steps')) {
            const parsed = parseBoultSteps(rawText);
            if (parsed) return <BoultSteps data={parsed} />;
          }
          if (!inline && lang.includes('boult-gallery')) {
            const parsed = parseBoultGallery(rawText);
            if (parsed) return <BoultGallery data={parsed} />;
          }

          return inline ? (
            <code className="px-1.5 py-0.5 rounded-md bg-boult-surface text-[12.5px] font-mono text-boult-fg-secondary border border-boult-divider">
              {children}
            </code>
          ) : (
            <pre className="my-4 rounded-xl bg-boult-surface border border-boult-border overflow-x-auto">
              <code className="block p-4 text-[12.5px] font-mono text-boult-fg-secondary leading-relaxed">{children}</code>
            </pre>
          );
        },
        hr: () => <hr className="my-6 border-boult-border" />,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-boult-fg underline underline-offset-2 hover:opacity-80 transition-opacity">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-5 overflow-x-auto rounded-xl border border-boult-border">
            <table className="w-full text-[13px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-boult-elevated border-b border-boult-border">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-boult-border">{children}</tbody>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-boult-fg-tertiary uppercase tracking-wider">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-3 text-boult-fg-secondary">{children}</td>
        ),
      }}
    >
      {normalized.replace(/<br\s*\/?>/gi, '\n')}
    </ReactMarkdown>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractEmailBody(markdown: string): string {
  const parts = markdown.split('---');
  if (parts.length >= 2) return parts.slice(1).join('---').replace(/^\s+/, '').split('✅')[0].trim();
  return markdown;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
