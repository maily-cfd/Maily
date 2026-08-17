'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Send, Loader2, Bot, User, BrainCircuit, Zap, FileText, ListTodo, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isDraft?: boolean;
  draftData?: {
    content: string;
    subject: string;
    recipientEmail: string;
  };
}

interface BoultQuickChatProps {
  isOpen: boolean;
  onClose: () => void;
  context: { emailId?: string; subject?: string } | null;
}

export const BoultQuickChat: React.FC<BoultQuickChatProps> = ({ isOpen, onClose, context }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [conversationId] = useState(() => `conv_quick_${Date.now()}`);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  // Initial message when context changes
  useEffect(() => {
    if (isOpen && context && messages.length === 0) {
      setInput('What is this email about?');
    }
  }, [isOpen, context]);

  const [currentStep, setCurrentStep] = useState<string>('');
  const [pendingApproval, setPendingApproval] = useState<{
    tool: string;
    params: any;
    message: string;
  } | null>(null);

  const handleSend = async (forcedInput?: string) => {
    const text = forcedInput || input;
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setIsThinking(true);
    setPendingApproval(null);
    setCurrentStep('Initializing Boult...');

    try {
      const response = await fetch('/api/agent-talk/chat-boult-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          selectedEmailId: context?.emailId,
          conversationId: conversationId,
          isNewConversation: messages.length === 0,
        })
      });

      if (!response.ok) throw new Error('Failed to fetch');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let hasAddedAssistantMessage = false;

      while (true) {
        const { done, value } = await reader?.read() || { done: true };
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        let currentEventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.replace('event: ', '').trim();
            if (currentEventType === 'thinking' || currentEventType === 'tool_call') {
              setIsThinking(true);
            }
            continue;
          }
          
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.replace('data: ', '').trim());
              
              // Handle reasoning/thoughts
              if (data.step) {
                setCurrentStep(data.step);
              }
              
              // Handle tool calls
              if (data.tool) {
                const toolName = data.tool.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
                setCurrentStep(`Boult: ${toolName}...`);
              }

              // Handle approvals
              if (currentEventType === 'approval_required' && data.message) {
                 setPendingApproval({
                   tool: data.tool,
                   params: data.params,
                   message: data.message
                 });
                 setIsThinking(false);
              }

              // Only handle assistant messages from 'message' events
              if (currentEventType === 'message' && (data.content || data.message)) {
                setIsThinking(false);
                const content = data.content || data.message;
                const isDraft = data.meta?.isDraft || false;
                const draftData = data.meta?.draftData || null;
                const isStreaming = data.meta?.isStreaming || false;
                
                if (isStreaming) {
                  assistantContent += content;
                } else {
                  // Final message replaces accumulated chunks with cleaned content
                  assistantContent = content;
                }
                
                if (!hasAddedAssistantMessage) {
                  setMessages(prev => [...prev, { 
                    role: 'assistant', 
                    content: assistantContent,
                    isDraft,
                    draftData
                  }]);
                  hasAddedAssistantMessage = true;
                } else {
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    newMessages[newMessages.length - 1] = { 
                      role: 'assistant', 
                      content: assistantContent,
                      isDraft: isDraft || lastMessage.isDraft,
                      draftData: draftData || lastMessage.draftData
                    };
                    return newMessages;
                  });
                }
              }
            } catch (e) {
              // Ignore partial JSON
            }
            // Do NOT reset currentEventType here if you expect data to follow event
          }
        }
      }
      
      setIsLoading(false);
      setIsThinking(false);
      setCurrentStep('');

    } catch (error) {
      console.error('Quick Chat Error:', error);
      setIsThinking(false);
      setIsLoading(false);
      setCurrentStep('');
      toast.error('AI was unable to process this request.');
    }
  };

  const handleApprove = async () => {
    if (!pendingApproval) return;
    
    setIsLoading(true);
    setIsThinking(true);
    setCurrentStep(`Executing ${pendingApproval.tool}...`);
    
    try {
      // For now, we simulate the approval execution by sending a follow-up message to Boult
      // In a full implementation, we'd call a dedicated 'approve-tool' endpoint
      const approvalMsg = `APPROVED: ${pendingApproval.tool}. Go ahead.`;
      setPendingApproval(null);
      await handleSend(approvalMsg);
    } catch (error) {
      toast.error('Failed to execute action.');
      setIsLoading(false);
      setIsThinking(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 20, scale: 0.98, filter: 'blur(10px)' }}
          transition={{ 
            type: "spring", 
            damping: 25, 
            stiffness: 200,
            opacity: { duration: 0.3 },
            scale: { duration: 0.4, ease: [0.16, 1, 0.3, 1] }
          }}
          className="fixed bottom-6 right-6 z-[3000] w-[450px] h-[80vh] flex flex-col origin-bottom-right"
        >
          {/* Main Card */}
          <div className="relative group bg-[#0A0A0C]/85 backdrop-blur-2xl border border-white/10 rounded-[2rem] shadow-[0_30px_70px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col ring-1 ring-white/10 h-full">
            
            {/* Header */}
            <div className="px-6 py-5 border-b border-boult-border flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
                  <BrainCircuit className="w-5 h-5 text-white/80" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] leading-tight">Boult Intelligence</span>
                  <span className="text-sm font-semibold text-white/90 truncate max-w-[220px]">
                    {context?.subject || 'Email Analysis'}
                  </span>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-all text-white/20 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-gradient-to-b from-transparent to-white/[0.01]"
            >
              {messages.length === 0 && !isThinking && (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-50">
                  <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center border border-white/10">
                    <Sparkles className="w-6 h-6 text-white/30" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-white font-medium">Ready to analyze</h3>
                    <p className="text-xs text-white/40 font-light max-w-[200px]">
                      Ask me any specific detail about this email conversation.
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex gap-4",
                    msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  <div className={cn(
                    "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center border transition-all duration-500",
                    msg.role === 'user' 
                      ? "bg-white/5 border-white/10" 
                      : "bg-white/10 border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                  )}>
                    {msg.role === 'user' ? <User className="w-5 h-5 text-white/40" /> : <Bot className="w-5 h-5 text-white/80" />}
                  </div>
                  <div className={cn(
                    "max-w-[88%] rounded-[1.8rem] px-6 py-4 text-[15px] leading-relaxed shadow-xl",
                    msg.role === 'user'
                      ? "bg-white/5 text-white/90 rounded-tr-none border border-white/5"
                      : "bg-white/[0.08] text-white border border-white/10 rounded-tl-none font-light prose prose-invert prose-sm max-w-none"
                  )}>
                    {msg.role === 'user' ? (
                      msg.content
                    ) : (
                      <div className="space-y-4">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({node, ...props}) => <h1 className="text-lg font-bold text-white mb-3 mt-1 tracking-tight" {...props} />,
                            h2: ({node, ...props}) => <h2 className="text-base font-bold text-white/90 mb-2 mt-4 tracking-tight border-b border-white/5 pb-1" {...props} />,
                            h3: ({node, ...props}) => <h3 className="text-sm font-bold text-white/80 mb-2 mt-3" {...props} />,
                            p: ({node, ...props}) => <p className="mb-4 last:mb-0 text-white/80 leading-relaxed" {...props} />,
                            ul: ({node, ...props}) => <ul className="list-none space-y-2 mb-4 pl-1" {...props} />,
                            li: ({node, ...props}) => (
                              <li className="flex gap-2 text-white/70">
                                <span className="text-white/30 mt-1.5 shrink-0">◆</span>
                                <span>{props.children}</span>
                              </li>
                            ),
                            ol: ({node, ...props}) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-white/70" {...props} />,
                            table: ({node, ...props}) => (
                              <div className="my-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                                <table className="w-full text-sm text-left border-collapse" {...props} />
                              </div>
                            ),
                            thead: ({node, ...props}) => <thead className="bg-white/5 text-white font-medium" {...props} />,
                            th: ({node, ...props}) => <th className="px-4 py-3 border-b border-white/10" {...props} />,
                            td: ({node, ...props}) => <td className="px-4 py-3 border-b border-white/[0.05] text-white/60" {...props} />,
                            code: ({node, className, children, ...props}) => (
                              <code className="bg-white/10 px-1.5 py-0.5 rounded-md text-[13px] text-white/90 font-mono" {...props}>
                                {children}
                              </code>
                            ),
                            blockquote: ({node, ...props}) => (
                              <blockquote className="border-l-2 border-white/20 pl-4 py-1 italic text-white/50 my-4" {...props} />
                            ),
                            strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
                            hr: ({node, ...props}) => <hr className="my-6 border-white/10" {...props} />
                          }}
                        >
                          {msg.content.replace(/<br\s*\/?>/gi, '\n')}
                        </ReactMarkdown>

                        {msg.isDraft && msg.draftData && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mt-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-widest font-bold">
                                <FileText className="w-3 h-3" />
                                Ready to Send
                              </div>
                              <div className="text-[10px] text-blue-400 font-bold px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                                AI Draft
                              </div>
                            </div>
                            
                            <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-white/60 line-clamp-3 font-light italic">
                              {msg.draftData.content.substring(0, 150)}...
                            </div>

                            <button
                              onClick={async () => {
                                if (!msg.draftData) return;
                                setIsLoading(true);
                                try {
                                  const res = await fetch('/api/gmail/send', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      to: msg.draftData.recipientEmail || '',
                                      subject: msg.draftData.subject || 'Re: Message',
                                      body: msg.draftData.content,
                                      threadId: context?.emailId
                                    })
                                  });
                                  if (res.ok) {
                                    toast.success('Email sent successfully!');
                                    setMessages(prev => [...prev, { role: 'assistant', content: '✅ Email sent successfully.' }]);
                                  } else {
                                    throw new Error('Failed to send');
                                  }
                                } catch (err) {
                                  toast.error('Failed to send email.');
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              className="w-full py-3 rounded-xl bg-white text-black text-xs font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors shadow-lg"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Send this Reply
                            </button>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              {isThinking && (
                <div className="flex gap-4">
                  <div className="shrink-0 w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.05)]">
                    <Bot className="w-5 h-5 text-white animate-pulse" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="bg-white/[0.04] border border-white/10 rounded-3xl rounded-tl-none px-6 py-4 space-y-3 w-[180px] shadow-2xl">
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden relative">
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                          animate={{ x: ['-100%', '100%'] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                      <div className="h-1.5 w-3/4 bg-white/5 rounded-full overflow-hidden relative">
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                          animate={{ x: ['-100%', '100%'] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear", delay: 0.2 }}
                        />
                      </div>
                    </div>
                    <span className="text-[10px] text-white/30 font-medium ml-2 animate-pulse tracking-wider uppercase">
                      {currentStep || 'Thinking...'}
                    </span>
                  </div>
                </div>
              )}

              {pendingApproval && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="ml-13 mr-4 p-5 rounded-[2rem] bg-white/[0.03] border border-white/10 shadow-2xl space-y-4"
                >
                  <div className="flex items-center gap-3 text-white/90">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-semibold tracking-tight">Execution Approval Required</span>
                  </div>
                  
                  <div className="text-[13px] text-white/50 leading-relaxed font-light bg-white/[0.02] p-4 rounded-2xl border border-white/5 italic">
                    {pendingApproval.message}
                  </div>

                  <button
                    onClick={handleApprove}
                    disabled={isLoading}
                    className="w-full py-3 rounded-2xl bg-white text-black text-sm font-bold flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_25px_rgba(255,255,255,0.2)]"
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <>
                        Execute Action
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </motion.div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-6 bg-white/[0.02] border-t border-boult-border mt-auto">
              <div className="relative flex items-center gap-2 bg-white/[0.05] border border-boult-divider rounded-[1.5rem] p-1.5 focus-within:border-white/40 transition-all shadow-inner">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Message Boult..."
                  className="flex-1 bg-transparent border-none outline-none text-sm px-4 py-2.5 text-white/90 placeholder:text-white/20"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    "p-2.5 rounded-2xl transition-all",
                    input.trim() && !isLoading
                      ? "bg-white text-black hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                      : "bg-white/5 text-white/20"
                  )}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
              
              {/* Quick Actions */}
              <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                 {[
                   { label: 'Summarize', icon: FileText, query: 'Summarize this email conversation' },
                   { label: 'Key Points', icon: ListTodo, query: 'What are the key points in this email?' },
                   { label: 'Action Items', icon: Zap, query: 'Are there any action items for me?' },
                   { label: 'Draft Reply', icon: Send, query: 'Draft a professional reply to this email' }
                 ].map((action) => (
                   <button 
                     key={action.label}
                     onClick={() => handleSend(action.query)}
                     className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[11px] text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                   >
                     <action.icon className="w-3 h-3" />
                     {action.label}
                   </button>
                 ))}
              </div>
            </div>
          </div>

          {/* Decorative subtle glow behind */}
          <div className="absolute inset-0 -z-10 bg-white/[0.02] blur-[100px] rounded-full opacity-30" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
