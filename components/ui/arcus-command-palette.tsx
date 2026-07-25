'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowUpRight, Loader2 } from 'lucide-react';
import { useDashboardSettings } from '@/lib/DashboardSettingsContext';
import { useSession } from 'next-auth/react';

interface Suggestion {
    label: string;
    prompt: string;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Build default prompts from the user's REAL connected integrations and name.
 * No mock data — each suggestion maps to something Arcus can actually do for
 * this specific user given what they have connected.
 */
function buildSuggestions(connected: Record<string, boolean>, firstName: string): Suggestion[] {
    const has = (k: string) => !!connected[k];
    const out: Suggestion[] = [];

    if (has('gmail')) {
        out.push({ label: 'Summarize my unread emails', prompt: 'Summarize my unread emails and tell me what needs my attention.' });
        out.push({ label: "Draft replies to everyone I'm holding up", prompt: "Find emails where people are waiting on a reply from me and draft responses in my voice." });
    }
    if (has('google_calendar')) {
        out.push({ label: 'What does my day look like?', prompt: "Give me a rundown of today's calendar and flag any conflicts." });
    }
    if (has('cal_com')) {
        out.push({ label: 'Find time for a 30-min call this week', prompt: 'Find open 30-minute slots in my schedule this week I can offer for a call.' });
    }
    if (has('notion')) {
        out.push({ label: "Log today's action items to Notion", prompt: "Pull the action items from today's emails and log them to my Notion workspace." });
    }
    if (has('slack')) {
        out.push({ label: 'Catch me up on Slack', prompt: 'Summarize my unread Slack mentions and threads I was tagged in.' });
    }

    out.push({ label: 'Digest my newsletters', prompt: 'I am subscribed to too many newsletters and have no time to read them. Digest my newsletters from the last 7 days into one clean summary of what matters.' });

    if (out.length <= 1) {
        return [
            { label: 'What can you do for me?', prompt: 'What can you do for me, and what should I connect to get the most out of you?' },
            { label: 'Help me get to inbox zero', prompt: 'Walk me through getting to inbox zero — triage what matters and handle the rest.' },
            { label: 'Digest my newsletters', prompt: 'I am subscribed to too many newsletters and have no time to read them. Digest my newsletters from the last 7 days into one clean summary of what matters.' },
        ];
    }

    if (firstName) {
        out.unshift({ label: `What needs ${firstName}'s attention right now?`, prompt: 'Scan my inbox and calendar and tell me the most important things that need my attention right now.' });
    }

    return out.slice(0, 6);
}

// Strip the model's internal reasoning tags so only the answer shows inline.
function stripThinking(text: string): string {
    return text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<\/?(thinking|thought|tool_call|tool_use|tool_result|scratchpad)[^>]*>/gi, '')
        .trim();
}

// Structured, safe markdown → HTML for the inline answer. Renders the
// components a clean answer is made of: quiet section headers, hairline
// dividers, custom bullet & numbered lists, blockquote callout boxes, inline
// bold/code/links — and promotes a `**Label:** …` summary paragraph (the
// model's "Bottom line:") into a boxed takeaway card so the one thing that
// matters reads at a glance instead of drowning in prose.
function renderAnswer(md: string): string {
    md = md.replace(/<br\s*\/?>/gi, '\n');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s: string) => esc(s)
        .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded-md bg-arcus-surface text-[12.5px] font-mono text-arcus-fg">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline">$1</a>');

    let html = '';
    let list: 'ul' | 'ol' | null = null;
    let quote: string[] = [];

    const closeList = () => { if (list) { html += list === 'ul' ? '</ul>' : '</ol>'; list = null; } };
    const flushQuote = () => {
        if (!quote.length) return;
        html += `<div class="my-2.5 rounded-xl border border-arcus-border bg-arcus-surface px-3.5 py-2.5">${quote.map((q) => `<p class="my-0.5 leading-relaxed">${inline(q)}</p>`).join('')}</div>`;
        quote = [];
    };

    for (const raw of md.split('\n')) {
        const line = raw.trimEnd();

        // Blockquotes group into one callout box.
        const q = line.match(/^>\s?(.*)$/);
        if (q) { closeList(); quote.push(q[1]); continue; }
        flushQuote();

        // Horizontal rule → hairline divider.
        if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) { closeList(); html += '<div class="my-3 h-px w-full bg-arcus-divider"></div>'; continue; }

        // Headers → quiet uppercase section labels (palette answers are small;
        // full-size headings would shout).
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) { closeList(); html += `<p class="mt-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-arcus-fg-tertiary">${inline(h[2])}</p>`; continue; }

        // Bulleted list with a tidy custom dot.
        if (/^[-*]\s+/.test(line)) {
            if (list !== 'ul') { closeList(); html += '<ul class="my-1.5 space-y-1 pl-1">'; list = 'ul'; }
            html += `<li class="flex gap-2.5 leading-relaxed"><span class="mt-[9px] w-1 h-1 rounded-full bg-arcus-fg-muted shrink-0"></span><span class="min-w-0">${inline(line.replace(/^[-*]\s+/, ''))}</span></li>`;
            continue;
        }

        // Numbered list.
        const n = line.match(/^(\d+)[.)]\s+(.*)$/);
        if (n) {
            if (list !== 'ol') { closeList(); html += '<ol class="my-1.5 space-y-1 pl-1">'; list = 'ol'; }
            html += `<li class="flex gap-2.5 leading-relaxed"><span class="w-4 shrink-0 text-right text-[12.5px] tabular-nums font-medium text-arcus-fg-tertiary mt-[1px]">${n[1]}.</span><span class="min-w-0">${inline(n[2])}</span></li>`;
            continue;
        }

        closeList();
        if (line === '') continue;

        // Full-line italic (_…_) → muted footnote (the palette's own notes use this).
        const it = line.match(/^_(.+)_$/);
        if (it) { html += `<p class="my-1.5 text-[13px] italic text-arcus-fg-tertiary leading-relaxed">${inline(it[1])}</p>`; continue; }

        // `**Label:** rest` → boxed takeaway card ("Bottom line:", "Next step:").
        const label = line.match(/^\*\*([^*]{2,40}):\*\*\s*(.+)$/);
        if (label) {
            html += `<div class="mt-3 rounded-xl border border-arcus-border bg-arcus-surface px-3.5 py-3"><p class="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-arcus-fg-tertiary">${inline(label[1])}</p><p class="leading-relaxed text-arcus-fg">${inline(label[2])}</p></div>`;
            continue;
        }

        html += `<p class="my-1.5 leading-relaxed">${inline(line)}</p>`;
    }
    closeList();
    flushQuote();
    return html;
}

export function ArcusCommandPalette() {
    const { isArcusOpen, setIsArcusOpen, playSystemSound } = useDashboardSettings();
    const { data: session } = useSession();

    const [query, setQuery] = useState('');
    const [integrationStatuses, setIntegrationStatuses] = useState<Record<string, boolean>>({ gmail: true });
    const [activeIndex, setActiveIndex] = useState(0);

    // Inline conversation state
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [status, setStatus] = useState('');
    const [liveAnswer, setLiveAnswer] = useState('');

    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const conversationIdRef = useRef<string | null>(null);

    const firstName = useMemo(() => (session?.user?.name || '').trim().split(' ')[0] || '', [session?.user?.name]);
    const suggestions = useMemo(() => buildSuggestions(integrationStatuses, firstName), [integrationStatuses, firstName]);
    const inConversation = messages.length > 0 || streaming;

    useEffect(() => {
        if (!isArcusOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/integrations/status');
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled || !Array.isArray(data?.integrations)) return;
                const statuses: Record<string, boolean> = { gmail: true };
                data.integrations.forEach((item: { provider?: string; connected?: boolean }) => {
                    if (item?.provider) statuses[item.provider] = !!item.connected;
                });
                statuses.gmail = true;
                setIntegrationStatuses(statuses);
            } catch { /* keep fallback suggestions */ }
        })();
        return () => { cancelled = true; };
    }, [isArcusOpen]);

    // Focus on open; full reset on close.
    useEffect(() => {
        if (isArcusOpen) {
            setActiveIndex(0);
            setTimeout(() => inputRef.current?.focus(), 80);
        } else {
            abortRef.current?.abort();
            setQuery('');
            setMessages([]);
            setStreaming(false);
            setStatus('');
            setLiveAnswer('');
            conversationIdRef.current = null; // next open starts a fresh thread
        }
    }, [isArcusOpen]);

    // Keep the conversation scrolled to the latest content.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, liveAnswer, status]);

    // Persist the popup exchange into the SAME store the full agent-talk app uses,
    // so it shows up in chat history and "Open full Arcus" continues this thread.
    const persistConversation = useCallback((msgs: ChatMessage[]) => {
        if (!msgs.length) return;
        if (!conversationIdRef.current) {
            conversationIdRef.current = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        }
        const id = conversationIdRef.current;
        const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const formatted = msgs.map((m, i) => m.role === 'user'
            ? { id: Date.now() + i, type: 'user', role: 'user', content: m.content, time }
            : { id: Date.now() + i, type: 'agent', role: 'assistant', content: { text: m.content, list: [], footer: '' }, time });
        const title = (msgs.find(m => m.role === 'user')?.content || 'Arcus chat').slice(0, 60);
        try {
            localStorage.setItem(`conversation_${id}`, JSON.stringify({
                id, messages: formatted, title, lastUpdated: new Date().toISOString(), messageCount: formatted.length,
            }));
            localStorage.setItem(`conv_${id}_title`, title);
        } catch { /* storage full — server copy below still persists */ }
        fetch('/api/arcus/conversation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: id, messages: formatted, title }),
        }).catch(() => { /* non-critical */ });
    }, []);

    const streamReply = useCallback(async (text: string, history: ChatMessage[], baseMessages: ChatMessage[]) => {
        setStreaming(true);
        setStatus('Thinking…');
        setLiveAnswer('');
        const controller = new AbortController();
        abortRef.current = controller;

        let answer = '';
        let canvasMd = '';
        let gotFinal = false;
        try {
            const res = await fetch('/api/arcus/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history }),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) throw new Error(`Arcus is unavailable (${res.status}).`);

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let eventType = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) { eventType = line.slice(7).trim(); continue; }
                    if (!line.startsWith('data: ') || !eventType) continue;
                    let data: any;
                    try { data = JSON.parse(line.slice(6).trim()); } catch { continue; }

                    if (eventType === 'thinking') {
                        if (data.status) setStatus(data.status);
                    } else if (eventType === 'tool_call') {
                        setStatus(`Using ${String(data.tool || 'a tool').replace(/_/g, ' ')}…`);
                    } else if (eventType === 'narrative' || eventType === 'plan_text') {
                        if (data.text || data.content) { answer = stripThinking(data.text || data.content); setLiveAnswer(answer); }
                    } else if (eventType === 'message') {
                        answer = stripThinking(data.content || '');
                        setLiveAnswer(answer);
                        if (data.canvasContent?.markdown) canvasMd = data.canvasContent.markdown;
                        gotFinal = true;
                    } else if (eventType === 'canvas') {
                        if (data?.markdown) { canvasMd = data.markdown; gotFinal = true; }
                    } else if (eventType === 'question') {
                        const qs = (data.questions || []).map((q: any) => q.text || q).filter(Boolean);
                        if (qs.length) { answer = qs.join('\n\n'); setLiveAnswer(answer); gotFinal = true; }
                    } else if (eventType === 'error') {
                        throw new Error(data.message || data.error || 'Something went wrong.');
                    }
                }
            }

            // Prefer the substantive canvas output (digest/report) when the chat
            // text is just a short hand-off line.
            let finalText = canvasMd && canvasMd.length > answer.length ? canvasMd : answer;
            if (!gotFinal) {
                // Stream ended (often the serverless 60s cap) before a final answer —
                // keep whatever streamed and point the user to the full run.
                finalText = (finalText ? finalText + '\n\n' : '') +
                    "_Arcus didn't finish here — it's still working or the free model is busy. Open full Arcus to see the complete run._";
            } else if (!finalText) {
                finalText = 'Done.';
            }
            const finalMessages: ChatMessage[] = [...baseMessages, { role: 'assistant', content: finalText }];
            setMessages(finalMessages);
            persistConversation(finalMessages);
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                const finalMessages: ChatMessage[] = [...baseMessages, { role: 'assistant', content: `⚠️ ${err?.message || 'Arcus could not reply. Try again.'}` }];
                setMessages(finalMessages);
                persistConversation(finalMessages);
            }
        } finally {
            setStreaming(false);
            setStatus('');
            setLiveAnswer('');
            abortRef.current = null;
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, []);

    const submit = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed || streaming) return;
        playSystemSound('click');
        const history = messages.slice(-10);
        const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
        setMessages(next);
        setQuery('');
        streamReply(trimmed, history, next);
    }, [streaming, messages, streamReply, playSystemSound]);

    const openFullArcus = useCallback(() => {
        setIsArcusOpen(false);
        // Deep-link to the saved thread so the full app continues this exact
        // conversation (it loads from localStorage / the conversation API).
        window.location.href = conversationIdRef.current
            ? `/dashboard/agent-talk/${conversationIdRef.current}`
            : '/dashboard/agent-talk';
    }, [setIsArcusOpen]);

    // One-click handoff from anywhere in the app (the home feed's "Handle it"):
    // open this panel AND send the prompt in a single action — no redirect, no
    // manual send. Fired as window CustomEvent('arcus:submit', {detail:{prompt}}).
    useEffect(() => {
        const onExternalSubmit = (e: Event) => {
            const prompt = (e as CustomEvent).detail?.prompt;
            if (typeof prompt !== 'string' || !prompt.trim() || streaming) return;
            setIsArcusOpen(true);
            // Open first, then send — so the panel is visibly up as Arcus starts.
            setTimeout(() => submit(prompt), 80);
        };
        window.addEventListener('arcus:submit', onExternalSubmit as EventListener);
        return () => window.removeEventListener('arcus:submit', onExternalSubmit as EventListener);
    }, [submit, streaming, setIsArcusOpen]);

    // Keyboard: Esc closes; arrows/Enter drive suggestions only before a conversation starts.
    useEffect(() => {
        if (!isArcusOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setIsArcusOpen(false); return; }
            if (inConversation) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (query.trim()) submit(query); }
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (query.trim()) submit(query);
                else if (suggestions[activeIndex]) submit(suggestions[activeIndex].prompt);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isArcusOpen, suggestions, activeIndex, query, submit, setIsArcusOpen, inConversation]);

    if (!isArcusOpen) return null;

    return (
        <AnimatePresence>
            {isArcusOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    className="fixed inset-0 z-[9999] flex items-start justify-center pt-[14vh]"
                    onClick={() => setIsArcusOpen(false)}
                >
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-[6px]" />

                    <motion.div
                        initial={{ opacity: 0, y: -12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -12, scale: 0.98 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-[640px] mx-4 bg-arcus-elevated rounded-[20px] border border-arcus-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] overflow-hidden flex flex-col max-h-[70vh]"
                    >
                        {/* Header / input row */}
                        <div className="flex items-center gap-3 px-5 py-4 shrink-0">
                            {streaming
                                ? <Loader2 className="w-5 h-5 text-arcus-fg-tertiary shrink-0 animate-spin" />
                                : <Sparkles className="w-5 h-5 text-arcus-fg-tertiary shrink-0" strokeWidth={1.75} />}
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={inConversation ? 'Ask a follow-up…' : 'Tell Arcus what to do…'}
                                className="flex-1 bg-transparent border-0 outline-none text-[18px] text-arcus-fg placeholder:text-arcus-fg-muted font-normal tracking-tight"
                            />
                            <button
                                onClick={() => setIsArcusOpen(false)}
                                className="shrink-0 text-[12px] font-medium text-arcus-fg-tertiary bg-arcus-surface border border-arcus-border rounded-md px-2.5 py-1 hover:bg-arcus-surface-hover transition-colors"
                            >
                                Esc
                            </button>
                        </div>

                        <div className="h-px w-full bg-arcus-divider shrink-0" />

                        {/* Suggestions (launcher) OR inline conversation */}
                        {!inConversation ? (
                            <div className="py-2 overflow-y-auto">
                                {suggestions.map((s, i) => (
                                    <button
                                        key={s.label}
                                        onClick={() => submit(s.prompt)}
                                        onMouseEnter={() => setActiveIndex(i)}
                                        className={`w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors ${activeIndex === i ? 'bg-arcus-surface-hover' : 'bg-transparent'}`}
                                    >
                                        <Sparkles className="w-[18px] h-[18px] text-arcus-fg-tertiary shrink-0" strokeWidth={1.75} />
                                        <span className="text-[15px] text-arcus-fg font-normal tracking-tight">{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <>
                                <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                                    {messages.map((m, i) => (
                                        m.role === 'user' ? (
                                            <div key={i} className="flex justify-end">
                                                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-arcus-surface px-4 py-2.5 text-[14px] text-arcus-fg">
                                                    {m.content}
                                                </div>
                                            </div>
                                        ) : (
                                            <div
                                                key={i}
                                                className="text-[14px] text-arcus-fg-secondary [&_strong]:text-arcus-fg [&_a]:text-arcus-fg"
                                                dangerouslySetInnerHTML={{ __html: renderAnswer(m.content) }}
                                            />
                                        )
                                    ))}

                                    {streaming && (
                                        <div className="text-[14px] text-arcus-fg-secondary">
                                            {liveAnswer
                                                ? <div className="[&_strong]:text-arcus-fg [&_a]:text-arcus-fg" dangerouslySetInnerHTML={{ __html: renderAnswer(liveAnswer) }} />
                                                : <div className="flex items-center gap-2 text-arcus-fg-tertiary"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{status || 'Thinking…'}</span></div>}
                                        </div>
                                    )}
                                </div>

                                <div className="h-px w-full bg-arcus-divider shrink-0" />
                                <button
                                    onClick={openFullArcus}
                                    className="shrink-0 flex items-center justify-center gap-1.5 px-5 py-2.5 text-[12px] text-arcus-fg-tertiary hover:text-arcus-fg hover:bg-arcus-surface-hover transition-colors"
                                >
                                    Open full Arcus
                                    <ArrowUpRight className="w-3.5 h-3.5" />
                                </button>
                            </>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
