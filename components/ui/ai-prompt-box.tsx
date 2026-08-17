import React, { forwardRef, useState, useEffect, useRef, useCallback, createContext, useContext, TextareaHTMLAttributes, ElementRef, ComponentPropsWithoutRef } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUp, Paperclip, Square, X, StopCircle, Mic, BrainCog, Monitor, FileText, Film, Music, Globe, Mail, Search, Infinity as InfinityIcon, Workflow, Bug, MessageSquare, Check, Lock, ChevronDown, Plus, Plug, Database, Calendar, Layout, Sparkles, Hand, FastForward } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ConnectorsModal } from './connectors-modal';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './dropdown-menu';
import { toast } from 'sonner';
// PART 46 — slash commands.
import { SlashCommandMenu } from '@/app/dashboard/agent-talk/components/SlashCommandMenu';
import { findSlashCommand, filterSlashCommands } from '@/lib/boult/skills';

// Utility function for className merging
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ");

// Embedded CSS for minimal custom styles
const styles = `
  *:focus-visible {
    outline-offset: 0 !important;
    --ring-offset: 0 !important;
  }
  textarea::-webkit-scrollbar {
    width: 6px;
  }
  textarea::-webkit-scrollbar-track {
    background: transparent;
  }
  textarea::-webkit-scrollbar-thumb {
    background-color: #444444;
    border-radius: 3px;
  }
  textarea::-webkit-scrollbar-thumb:hover {
    background-color: #555555;
  }
`;

// Inject styles into document (with check for SSR/re-renders)
if (typeof document !== 'undefined' && !document.getElementById('ai-prompt-box-styles')) {
  const styleSheet = document.createElement("style");
  styleSheet.id = 'ai-prompt-box-styles';
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

// Textarea Component
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex w-full rounded-md border-none bg-transparent px-3 py-3 text-base text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-none scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent hover:scrollbar-thumb-gray-500",
      className
    )}
    ref={ref}
    rows={props.rows || 2}
    {...props}
  />
));
Textarea.displayName = "Textarea";

// Tooltip Components
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-boult-border bg-boult-surface px-3 py-1.5 text-sm text-boult-fg shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// Dialog Components
const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-[90vw] md:max-w-[800px] translate-x-[-50%] translate-y-[-50%] gap-4 border border-boult-border bg-boult-surface p-0 shadow-xl duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-2xl",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-boult-bg/80 p-2 hover:bg-boult-bg-elevated transition-all">
        <X className="h-5 w-5 text-boult-fg-secondary hover:text-boult-fg" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-boult-fg", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// Button Component
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantClasses = {
      default: "bg-boult-fg hover:bg-boult-fg/90 text-boult-fg-inverse",
      outline: "border border-boult-border bg-transparent hover:bg-boult-surface-hover/30",
      ghost: "bg-transparent hover:bg-boult-surface-hover/30",
    };
    const sizeClasses = {
      default: "h-10 px-4 py-2",
      sm: "h-8 px-3 text-sm",
      lg: "h-12 px-6",
      icon: "h-8 w-8 rounded-full aspect-[1/1]",
    };
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// VoiceRecorder Component
interface VoiceRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: (duration: number) => void;
  visualizerBars?: number;
}
const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  visualizerBars = 32,
}) => {
  const [time, setTime] = React.useState(0);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (isRecording) {
      onStartRecording();
      timerRef.current = setInterval(() => setTime((t) => t + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      onStopRecording(time);
      setTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, onStartRecording, onStopRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center w-full transition-all duration-300 py-3",
        isRecording ? "opacity-100" : "opacity-0 h-0"
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="font-mono text-sm text-black/80 dark:text-white/80">{formatTime(time)}</span>
      </div>
      <div className="w-full h-10 flex items-center justify-center gap-0.5 px-4">
        {[...Array(visualizerBars)].map((_, i) => (
          <div
            key={i}
            className="w-0.5 rounded-full bg-black/[0.05] dark:bg-white/50 animate-pulse"
            style={{
              height: `${Math.max(15, Math.random() * 100)}%`,
              animationDelay: `${i * 0.05}s`,
              animationDuration: `${0.5 + Math.random() * 0.5}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

// ImageViewDialog Component
interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}
const ImageViewDialog: React.FC<ImageViewDialogProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none bg-transparent shadow-none max-w-[90vw] md:max-w-[800px]">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative bg-black rounded-2xl overflow-hidden shadow-2xl"
        >
          <img
            src={imageUrl}
            alt="Full preview"
            className="w-full max-h-[80vh] object-contain rounded-2xl"
          />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

// PromptInput Context and Components
interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}
const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: "",
  setValue: () => { },
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
});
function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) throw new Error("usePromptInput must be used within a PromptInput");
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  hideShadow?: boolean;
}
const PromptInput = forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      className,
      isLoading = false,
      maxHeight = 240,
      value,
      onValueChange,
      onSubmit,
      children,
      disabled = false,
      onDragOver,
      onDragLeave,
      onDrop,
       onFocus,
       onBlur,
       hideShadow = false,
     },
     ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(value || "");
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value ?? internalValue,
            setValue: onValueChange ?? handleChange,
            maxHeight,
            onSubmit,
            disabled,
          }}
        >
          <div
            ref={ref}
            onFocus={onFocus}
            onBlur={onBlur}
            className={cn(
              "rounded-[32px] bg-white/70 dark:bg-white/[0.08] backdrop-blur-2xl p-2 transition-all duration-300 relative",
              "border border-black/[0.08] dark:border-white/[0.12] shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
              !hideShadow && "shadow-[0_20px_60px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]",
              isLoading && "border-black/[0.12] dark:border-white/[0.16] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_20px_60px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.5)]",
              className
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <motion.div 
              className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] via-transparent to-transparent pointer-events-none"
              animate={{ opacity: [0.2, 0.4, 0.2] }}
              transition={{ repeat: Number.POSITIVE_INFINITY, duration: 8, ease: "easeInOut" }}
            />
            <div className="relative z-10">
              {children}
            </div>
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  }
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}
const PromptInputTextarea: React.FC<PromptInputTextareaProps & React.ComponentProps<typeof Textarea>> = ({
  className,
  onKeyDown,
  disableAutosize = false,
  placeholder,
  ...props
}) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height =
      typeof maxHeight === "number"
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // PART 46 — give the parent's onKeyDown first crack at the event so
    // slash-menu navigation (↑/↓/Tab/Enter/Esc) can preventDefault to stop
    // the built-in Enter→submit. Without this flip, hitting Enter while the
    // slash autocomplete is open would always submit instead of selecting
    // the focused command.
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn("text-base", className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

interface PromptInputActionsProps {
  children: React.ReactNode;
  className?: string;
}
const PromptInputActions: React.FC<PromptInputActionsProps> = ({ children, className }) => (
  <div className={cn("flex items-center gap-2", className)}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}
const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  className,
  side = "top",
  ...props
}) => {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

// Custom Divider Component
const CustomDivider: React.FC = () => (
  <div className="relative h-6 w-[1px] mx-0.5">
    <div className="absolute inset-0 bg-white/10 rounded-full" />
  </div>
);

// Helper for file size
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Main PromptInputBox Component
interface PromptInputBoxProps {
  onSend?: (message: string, files?: File[], options?: { isDeepThinking?: boolean; isCanvas?: boolean; isSearch?: boolean; isPlanMode?: boolean; modelId?: string; actionMode?: ActionMode }) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  onSearchClick?: () => void;
  onAttachEmailClick?: () => void;
  onPersonalityClick?: () => void;
  selectedEmailsCount?: number;
  /**
   * Passages the user pinned from the Canvas document via "Add to chat".
   * Rendered as removable chips above the input so the attached context is
   * visible before sending — the alternative (silently attaching it) means the
   * user can't tell what the model is about to receive.
   */
  canvasSelections?: Array<{ id: number; text: string; docTitle: string }>;
  onRemoveCanvasSelection?: (id: number) => void;
  suggestionInput?: { text: string; id: number };
  activeMode?: 'agent' | 'plan';
  onModeChange?: (mode: 'agent' | 'plan') => void;
  showConnectBanner?: boolean;
  onConnectClick?: () => void;
  currentPlan?: 'free' | 'starter' | 'pro' | 'none';
  onUpgradeClick?: () => void;
  hideShadow?: boolean;
  /**
   * PART 46 — fired when the user submits a slash command whose `kind` is
   * 'client'. The handler name comes from the registry in lib/boult/skills.ts
   * (e.g. 'openAgents', 'showHelp'). ChatInterface wires it to the real
   * client-side action — opening a modal, clearing state, etc. Server-kind
   * commands (/brief, /inbox, etc.) bypass this callback and go through
   * onSend normally so the chat route can expand them server-side.
   */
  onSlashClientCommand?: (
    handlerName: 'openAgents' | 'openMemorySettings' | 'openSettings' | 'clearConversation' | 'showHelp',
  ) => void;
  /**
   * PART 47 — current write-action mode + change handler. The chat input
   * displays a dropdown ("Ask" / "Auto") matching Claude Code's style; on
   * change, the parent persists to user_profiles.preferences and threads
   * the value into onSend's options so the chat route can pass
   * skipConfirmations to runAgentLoop. Defaults to 'ask' for safety.
   */
  actionMode?: ActionMode;
  onActionModeChange?: (mode: ActionMode) => void;
}

const MODES = [
  { id: 'agent', label: 'Agent', icon: InfinityIcon, description: 'Autonomous agent for complex workflows' },
  { id: 'plan', label: 'Plan', icon: Workflow, description: 'Create detailed plans for accomplishing tasks' },
] as const;

// PART 47 — write-action confirmation mode. Matches Claude Code's "Ask
// before acting" / "Act without asking" toggle. Default 'ask' (safer).
// Effect: 'auto' sets skipConfirmations=true on every chat call →
// the existing CORE DOCTRINE skip-confirmations block fires → the LLM
// executes writes (send_email, schedule_meeting, send_slack_message,
// create_notion_page) directly without inline previews or request_confirmation.
const ACTION_MODES = [
  { id: 'ask',  label: 'Ask',  icon: Hand,        description: 'Boult pauses so you can approve each send / schedule / post.' },
  { id: 'auto', label: 'Auto', icon: FastForward, description: 'Boult executes writes without pausing for approval. Use with trust.' },
] as const;

export type ActionMode = typeof ACTION_MODES[number]['id'];

// --- Custom Model Logos ---
const AnthropicLogo = ({ className }: { className?: string }) => (
  <div className={cn("w-5 h-5 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-white/10", className)}>
    <img src="/brand/claude.png" className="w-full h-full object-contain p-0.5" alt="Claude" />
  </div>
);

const GoogleGeminiLogo = ({ className }: { className?: string }) => (
  <div className={cn("w-5 h-5 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-white/10", className)}>
    <img src="/brand/gemini.png" className="w-full h-full object-contain p-0.5" alt="Gemini" />
  </div>
);

const OpenAILogo = ({ className }: { className?: string }) => (
  <div className={cn("w-5 h-5 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-white/10", className)}>
    <img src="/brand/gpt.png" className="w-full h-full object-contain p-0.5" alt="GPT" />
  </div>
);

const KimiLogo = ({ className }: { className?: string }) => (
  <div className={cn("w-5 h-5 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-white/5", className)}>
    <div className="w-full h-full bg-gradient-to-br from-blue-500 to-emerald-500" />
  </div>
);

const AutoLogo = ({ className }: { className?: string }) => (
  <svg className={cn("w-4 h-4", className)} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L13.5 8.5H20L14.75 12.25L16.25 18.75L11 15L5.75 18.75L7.25 12.25L2 8.5H8.5L10 2H12Z" fill="currentColor" opacity="0.8" />
  </svg>
);

export const AI_MODELS = [
  { id: 'auto', name: 'Auto', tier: 'free', icon: AutoLogo },
  // Starter Tier — available for Starter ($7.99/mo) and Pro users
  { id: 'anthropic/claude-sonnet-4.6', name: 'Sonnet 4.6', tier: 'starter', icon: AnthropicLogo },
  { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tier: 'starter', icon: GoogleGeminiLogo },
  { id: 'openai/gpt-5.4', name: 'GPT 5.4', tier: 'starter', icon: OpenAILogo },
  // Pro Tier — available only for Pro ($29.99/mo) users
  { id: 'anthropic/claude-opus-4.6', name: 'Opus 4.6', tier: 'pro', icon: AnthropicLogo, isFlagship: true },
  { id: 'openai/gpt-5.5', name: 'GPT 5.5', tier: 'pro', icon: OpenAILogo, isFlagship: true },
];

type AgentMode = typeof MODES[number]['id'];

export const PromptInputBox = forwardRef<HTMLDivElement, PromptInputBoxProps>((props, ref) => {
  const {
    onSend = () => { },
    onStop,
    isLoading = false,
    placeholder = "Assign a task or ask anything",
    className,
    onSearchClick,
    onAttachEmailClick,
    onPersonalityClick,
    selectedEmailsCount = 0,
    canvasSelections = [],
    onRemoveCanvasSelection,
  } = props;

  const [input, setInput] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePreviews, setFilePreviews] = React.useState<{ [key: string]: string }>({});
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const [activeMode, setActiveMode] = React.useState<AgentMode>(props.activeMode || 'agent');
  const [isModeMenuOpen, setIsModeMenuOpen] = React.useState(false);
  const [activeModelId, setActiveModelId] = React.useState<string>(AI_MODELS[0].id);
  const [isModelMenuOpen, setIsModelMenuOpen] = React.useState(false);
  const [isDismissedConnectBanner, setIsDismissedConnectBanner] = React.useState(false);
  const [integrationStatuses, setIntegrationStatuses] = React.useState<Record<string, boolean>>({});
  // PART 46 — slash-command menu state. Menu opens whenever input starts
  // with "/" and the user hasn't pressed Esc; closes when the user types a
  // space (committing to a command) or clears the input.
  const [slashDismissed, setSlashDismissed] = React.useState(false);
  const [slashFocusedIndex, setSlashFocusedIndex] = React.useState(0);
  // PART 47 — write-action mode (Ask / Auto). Initial value comes from the
  // parent (loaded from user_profiles.preferences); local state lets the
  // dropdown switch instantly while the parent debounces the persistence.
  const [actionMode, setActionMode] = React.useState<ActionMode>(props.actionMode ?? 'ask');
  const [isActionMenuOpen, setIsActionMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (props.actionMode && props.actionMode !== actionMode) {
      setActionMode(props.actionMode);
    }
    // Only sync FROM parent; user-driven changes flow OUT via onActionModeChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.actionMode]);

  const handleActionModeChange = (mode: ActionMode) => {
    setActionMode(mode);
    props.onActionModeChange?.(mode);
    setIsActionMenuOpen(false);
  };

  React.useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/integrations/status');
        if (res.ok) {
          const data = await res.json();
          const statuses: Record<string, boolean> = {};
          Object.entries(data.integrations).forEach(([key, val]: [string, any]) => {
            statuses[key] = (val as any).connected;
          });
          setIntegrationStatuses(statuses);
        }
      } catch (err) {
        console.error('Failed to fetch integration status:', err);
      }
    };
    fetchStatus();
  }, []);
  const recognitionRef = React.useRef<any>(null);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (props.suggestionInput) {
      setInput(props.suggestionInput.text);
    }
  }, [props.suggestionInput]);

  const handleModeChange = (mode: AgentMode) => {
    setActiveMode(mode);
    props.onModeChange?.(mode);
    setIsModeMenuOpen(false);
  };

  const isImageFile = (file: File) => file.type.startsWith("image/");

  const getFileIcon = (file: File) => {
    const type = file.type;
    if (type.includes('pdf')) return <FileText className="w-8 h-8 text-red-400" />;
    if (type.includes('video')) return <Film className="w-8 h-8 text-blue-400" />;
    if (type.includes('audio')) return <Music className="w-8 h-8 text-green-400" />;
    return <FileText className="w-8 h-8 text-neutral-600 dark:text-gray-400" />;
  };

  const processFile = (file: File) => {
    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      return;
    }

    setFiles(prev => [...prev, file]);

    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreviews(prev => ({ ...prev, [file.name]: e.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = Array.from(e.dataTransfer.files);
    droppedFiles.forEach(processFile);
  }, []);

  const handleRemoveFile = (index: number) => {
    const fileToRemove = files[index];
    if (fileToRemove && filePreviews[fileToRemove.name]) {
      const newPreviews = { ...filePreviews };
      delete newPreviews[fileToRemove.name];
      setFilePreviews(newPreviews);
    }
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const openImageModal = (imageUrl: string) => setSelectedImage(imageUrl);

  const handlePaste = React.useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1 || items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
        }
      }
    }
  }, []);

  React.useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleSubmit = () => {
    // A pinned canvas selection is real content. Without it in this condition,
    // pinning a passage and pressing Enter with an empty textarea did nothing
    // at all — the chip just sat there looking attached.
    if (input.trim() || files.length > 0 || canvasSelections.length > 0) {
      const trimmed = input.trim();

      // PART 46 — client-kind slash commands never hit the network. If the
      // first token matches a registered command and its kind is 'client',
      // short-circuit to the local handler the parent provided. Server-kind
      // commands fall through to onSend; the chat route expands them.
      if (trimmed.startsWith('/')) {
        const firstWhitespace = trimmed.search(/\s/);
        const cmdToken = firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace);
        const cmd = findSlashCommand(cmdToken);
        if (cmd && cmd.kind === 'client' && cmd.clientHandler) {
          props.onSlashClientCommand?.(cmd.clientHandler);
          setInput("");
          setSlashDismissed(false);
          setSlashFocusedIndex(0);
          return;
        }
      }

      onSend(input, files, {
        isDeepThinking: activeMode === 'plan',
        isCanvas: activeMode === 'agent', // Canvas is Agent-mode only; Plan uses PlanCanvas artifact
        isSearch: activeMode === 'agent',
        isPlanMode: activeMode === 'plan',
        modelId: activeModelId,
        // PART 47 — pass the user's chosen confirmation mode so the chat
        // route can translate it into skipConfirmations for runAgentLoop.
        actionMode,
      });
      setInput("");
      setFiles([]);
      setFilePreviews({});
      setSlashDismissed(false);
      setSlashFocusedIndex(0);
    }
  };

  // PART 46 — derived state for the slash autocomplete menu. Open whenever
  // the input starts with "/" AND has no whitespace yet (the user is still
  // picking a command, not typing args) AND the user hasn't dismissed via Esc.
  const slashOpen = !slashDismissed && input.startsWith('/') && !input.includes(' ');
  const slashFilter = slashOpen ? input.slice(1) : '';
  const slashFiltered = React.useMemo(
    () => (slashOpen ? filterSlashCommands(slashFilter) : []),
    [slashOpen, slashFilter],
  );

  const selectSlashCommand = (cmdName: string) => {
    setInput(`/${cmdName} `);
    setSlashDismissed(false);
    setSlashFocusedIndex(0);
  };

  const handleSlashKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!slashOpen || slashFiltered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSlashFocusedIndex(i => (i + 1) % slashFiltered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSlashFocusedIndex(i => (i - 1 + slashFiltered.length) % slashFiltered.length);
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      const picked = slashFiltered[Math.max(0, Math.min(slashFocusedIndex, slashFiltered.length - 1))];
      if (picked) selectSlashCommand(picked.name);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setSlashDismissed(true);
    }
  };

  // Re-arm dismissal when the user clears the "/" — keeps the menu from
  // staying suppressed across separate slash invocations.
  React.useEffect(() => {
    if (!input.startsWith('/')) {
      if (slashDismissed) setSlashDismissed(false);
      if (slashFocusedIndex !== 0) setSlashFocusedIndex(0);
    } else if (slashFiltered.length > 0 && slashFocusedIndex >= slashFiltered.length) {
      setSlashFocusedIndex(0);
    }
  }, [input, slashDismissed, slashFocusedIndex, slashFiltered.length]);

  const handleStartRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Speech recognition unavailable', { description: "This browser doesn't support voice input. Try Chrome or Edge." });
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput(prev => prev + (prev.endsWith(' ') || !prev ? '' : ' ') + finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleStopRecording = (duration: number) => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  };

  const hasContent = input.trim() !== "" || files.length > 0 || canvasSelections.length > 0;

  return (
    <>
      {/* PART 46 — wrap the input in a relative container so the
          slash-command autocomplete can position itself ABOVE via
          absolute bottom-full without disrupting layout below. */}
      <div className="relative w-full">
        <SlashCommandMenu
          isOpen={slashOpen}
          filter={slashFilter}
          focusedIndex={slashFocusedIndex}
          onFocusIndex={setSlashFocusedIndex}
          onSelect={(cmd) => selectSlashCommand(cmd.name)}
        />

      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        disabled={isLoading || isRecording}
        ref={(node) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          (promptBoxRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={cn(
          "w-full bg-white/70 dark:bg-white/[0.08] backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.12] transition-all duration-300 ease-in-out focus:ring-0 focus:outline-none focus-within:ring-0 focus-within:outline-none",
          "shadow-[0_8px_32px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
          !props.hideShadow && "shadow-[0_20px_60px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]",
          isRecording && "ring-1 ring-black/10 dark:ring-white/20",
          className
        )}
      >
        <AnimatePresence>
          {canvasSelections.length > 0 && !isRecording && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="flex flex-wrap gap-1.5 p-2 pb-0"
            >
              {canvasSelections.map((sel) => (
                <motion.div
                  key={sel.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border border-boult-border bg-black/[0.03] dark:bg-white/[0.06] max-w-[240px]"
                  // The full passage on hover — the chip label alone can't show
                  // which part of a long document was pinned.
                  title={sel.text}
                >
                  <FileText className="w-3 h-3 shrink-0 text-black/50 dark:text-white/50" />
                  <span className="text-[11.5px] text-black/70 dark:text-white/70 truncate">
                    selection from {sel.docTitle}
                  </span>
                  {onRemoveCanvasSelection && (
                    <button
                      type="button"
                      onClick={() => onRemoveCanvasSelection(sel.id)}
                      aria-label="Remove selection"
                      className="w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.12] transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {files.length > 0 && !isRecording && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex flex-wrap gap-2 p-2 pb-1 transition-all duration-300"
            >
              {files.map((file, index) => (
                <motion.div
                  key={`${file.name}-${index}`}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative group"
                >
                  <div className="bg-neutral-50 dark:bg-boult-surface-hover border border-boult-border rounded-xl overflow-hidden p-1 flex items-center gap-2 pr-3 min-w-[120px] max-w-[200px]">
                    {isImageFile(file) && filePreviews[file.name] ? (
                      <div
                        className="w-10 h-10 rounded-lg overflow-hidden cursor-pointer"
                        onClick={() => openImageModal(filePreviews[file.name])}
                      >
                        <img
                          src={filePreviews[file.name]}
                          alt={file.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 bg-black/[0.05] dark:bg-white/50 rounded-lg flex items-center justify-center">
                        {getFileIcon(file)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-black/70 dark:text-white/70 truncate font-medium">{file.name}</p>
                      <p className="text-[9px] text-black/50 dark:text-white/30 font-mono">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(index);
                      }}
                      className="rounded-full bg-black/40 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={cn(
            "transition-all duration-300",
            isRecording ? "h-0 overflow-hidden opacity-0" : "opacity-100"
          )}
        >
          <PromptInputTextarea
            placeholder={
              activeMode === 'plan'
                ? "Describe the goal for your plan...  ·  type / for commands"
                : activeMode === 'agent'
                  ? "Describe a mission for the agent...  ·  type / for commands"
                  : `${placeholder}  ·  type / for commands`
            }
            className="text-base"
            onKeyDown={handleSlashKeyDown}
          />
        </div>

        {isRecording && (
          <VoiceRecorder
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
          />
        )}

        <PromptInputActions className="flex items-center justify-between gap-1 p-0 pt-2 border-t border-boult-border/60 mt-1 relative z-10">
          <div
            className={cn(
              "flex items-center gap-2 transition-opacity duration-300",
              isRecording ? "opacity-0 invisible h-0" : "opacity-100 visible"
            )}
          >
            {/* Mode Selector Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsModeMenuOpen(!isModeMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-black/[0.05] dark:bg-white/5 border border-black/5 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10 hover:border-black/10 dark:hover:border-white/20 transition-all text-black dark:text-white font-bold"
              >
                {React.createElement(MODES.find(m => m.id === activeMode)?.icon || Workflow, { className: "w-3.5 h-3.5" })}
                <span className="text-[12px] tracking-tight capitalize">{activeMode}</span>
                <ChevronDown className={cn("w-3 h-3 transition-transform", isModeMenuOpen && "rotate-180")} />
              </button>

              <AnimatePresence>
                {isModeMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setIsModeMenuOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full left-0 mb-2 w-64 bg-boult-surface backdrop-blur-xl border border-boult-border rounded-2xl shadow-2xl z-[70] overflow-hidden p-1.5"
                    >
                      {MODES.map((mode) => (
                        <div key={mode.id} className="relative group">
                          <button
                            type="button"
                            onClick={() => handleModeChange(mode.id)}
                            className={cn(
                              "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                              activeMode === mode.id
                                ? "bg-boult-surface-hover text-boult-fg"
                                : "hover:bg-boult-surface-hover/50 text-boult-fg-secondary hover:text-boult-fg"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <mode.icon className={cn("w-4 h-4", activeMode === mode.id ? "text-black dark:text-white" : "text-inherit")} />
                              <span className="text-[13px] font-bold">{mode.label}</span>
                            </div>
                            {activeMode === mode.id && <Check className="w-3.5 h-3.5 text-black dark:text-white" />}
                          </button>

                          {/* Tooltip / Description for each mode on hover */}
                          <div className="absolute left-full ml-2 top-0 invisible group-hover:visible w-48 bg-boult-surface border border-boult-border rounded-xl p-3 shadow-xl z-[80]">
                            <p className="text-[11px] text-boult-fg-secondary leading-relaxed">
                              {mode.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* PART 47 — Action mode (Ask / Auto) — Claude-Code-style toggle.
                When 'Auto' is selected the chat route passes skipConfirmations
                to runAgentLoop, the system-prompt overlay tells the LLM to
                execute writes directly, and the executor-level approval gate
                is bypassed. Default 'Ask' keeps the inline-preview flow. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsActionMenuOpen(v => !v)}
                aria-label="Action mode"
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all font-bold",
                  actionMode === 'auto'
                    ? "bg-black dark:bg-white border-transparent text-white dark:text-black hover:opacity-90"
                    : "bg-black/[0.05] dark:bg-white/5 border-black/5 dark:border-white/10 text-boult-fg-secondary hover:bg-black/10 dark:hover:bg-white/10 hover:border-black/10 dark:hover:border-white/20",
                )}
              >
                {React.createElement(ACTION_MODES.find(m => m.id === actionMode)?.icon || Hand, { className: "w-3.5 h-3.5" })}
                <span className="text-[12px] tracking-tight capitalize">{actionMode}</span>
                <ChevronDown className={cn("w-3 h-3 transition-transform", isActionMenuOpen && "rotate-180")} />
              </button>

              <AnimatePresence>
                {isActionMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setIsActionMenuOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full left-0 mb-2 w-80 bg-boult-surface backdrop-blur-xl border border-boult-border rounded-2xl shadow-2xl z-[70] overflow-hidden p-1.5"
                    >
                      {ACTION_MODES.map((mode) => {
                        const isActive = actionMode === mode.id;
                        const accent = 'text-black dark:text-white';
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => handleActionModeChange(mode.id)}
                            className={cn(
                              "w-full flex items-start justify-between gap-3 px-3 py-3 rounded-xl transition-all text-left",
                              isActive
                                ? "bg-boult-surface-hover text-boult-fg"
                                : "hover:bg-boult-surface-hover/50 text-boult-fg-secondary hover:text-boult-fg",
                            )}
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <mode.icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", isActive ? accent : "text-inherit")} />
                              <div className="min-w-0">
                                <div className="text-[13px] font-bold">{mode.label === 'Ask' ? 'Ask before acting' : 'Act without asking'}</div>
                                <div className="text-[11px] text-boult-fg-muted leading-snug mt-0.5">{mode.description}</div>
                              </div>
                            </div>
                            {isActive && <Check className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", accent)} />}
                          </button>
                        );
                      })}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <div className="h-4 w-[1px] bg-white/10 mx-1" />

            {/* Brand Integration Dock */}
            <div className="flex items-center -space-x-2 ml-1 opacity-40 hover:opacity-100 transition-all cursor-pointer" onClick={() => props.onConnectClick?.()}>
              {/* Google Calendar */}
              <div className="w-5 h-5 rounded-full bg-black/[0.05] dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-center backdrop-blur-md overflow-hidden shadow-sm">
                <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 192 192"><path fill="#bbe2ff" d="M32 36.8C32 20.894 44.894 8 60.8 8h70.4C147.106 8 160 20.894 160 36.8v30.4c0 15.906-12.894 28.8-28.8 28.8H60.8C44.894 96 32 83.106 32 67.2z"/><path fill="#3c90ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/><mask id="dock-gc-a" width="154" height="152" x="19" y="20" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}><path fill="#3c90ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/></mask><g mask="url(#dock-gc-a)"><path fill="url(#dock-gc-b)" d="M0 0h166v76H0z" transform="matrix(1 0 0 -1 13 172)"/></g><mask id="dock-gc-c" width="154" height="152" x="19" y="20" maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}><path fill="#3186ff" d="M19.867 49.392C17.818 33.82 29.94 20 45.645 20h100.71c15.706 0 27.827 13.82 25.778 29.392L166 96l6.133 46.608C174.182 158.18 162.061 172 146.355 172H45.645c-15.706 0-27.827-13.82-25.778-29.392L26 96z"/></mask><g mask="url(#dock-gc-c)"><path fill="url(#dock-gc-d)" d="M32 27.2C32 16.596 40.596 8 51.2 8h89.6c10.604 0 19.2 8.596 19.2 19.2V96H32z" filter="url(#dock-gc-e)"/></g><path fill="#fff" d="M75.353 133.336q-6.282 0-10.777-2.043t-7.61-5.465q-3.065-3.474-4.342-6.793T51.603 115a2.07 2.07 0 0 1 1.021-1.124l5.67-2.247q.714-.357 1.43-.102.714.204 1.685 2.349 1.022 2.145 2.86 4.546a14.3 14.3 0 0 0 4.495 3.728q2.606 1.328 6.435 1.328 6.18 0 9.807-3.575 3.677-3.575 3.677-9.091 0-5.976-3.882-9.194-3.881-3.269-10.266-3.269h-5.362a1.9 1.9 0 0 1-1.328-.51q-.51-.562-.511-1.277v-5.465q0-.767.51-1.277a1.82 1.82 0 0 1 1.329-.562h4.647q5.721 0 9.194-3.116t3.473-8.07q0-4.902-3.116-7.916t-8.58-3.014q-3.065 0-5.312 1.022a11.5 11.5 0 0 0-3.882 2.86 22.7 22.7 0 0 0-2.809 3.78q-1.174 1.941-1.89 2.145-.714.153-1.379-.255l-5.363-2.605q-.664-.358-.868-1.124t1.226-3.575q1.481-2.86 4.494-5.823a21 21 0 0 1 7.049-4.597q4.035-1.635 9.398-1.634 9.96 0 15.782 5.26 5.823 5.21 5.823 13.791 0 5.925-2.86 10.266-2.81 4.34-7.968 6.13v.204q6.231 1.838 9.806 6.741 3.627 4.853 3.626 11.594 0 9.654-6.742 15.834-6.74 6.18-17.57 6.18zm51.25-1.175q-.868 0-1.533-.664a2.25 2.25 0 0 1-.612-1.583V73.118l-11.492 8.274q-.614.46-1.431.307a1.96 1.96 0 0 1-1.225-.766l-3.32-4.7a1.98 1.98 0 0 1-.358-1.43q.153-.816.817-1.276l20.379-14.557q.256-.204.562-.306.307-.153.715-.153h4.291q.868 0 1.379.613.562.56.562 1.43v69.36q0 .92-.664 1.583a2 2 0 0 1-1.533.664z"/><defs><linearGradient id="dock-gc-b" x1="83" x2="83" y1="76" gradientUnits="userSpaceOnUse"><stop stopColor="#4fa0ff"/><stop offset="1" stopColor="#3186ff"/></linearGradient><linearGradient id="dock-gc-d" x1="89.06" x2="89.06" y1="21.75" y2="96.39" gradientUnits="userSpaceOnUse"><stop stopColor="#a9a8ff"/><stop offset=".8" stopColor="#3c90ff"/></linearGradient><filter id="dock-gc-e" width="152" height="112" x="20" y="-4" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse"><feFlood floodOpacity="0" result="BackgroundImageFix"/><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur result="effect1_foregroundBlur_37330_7673" stdDeviation="6"/></filter></defs></svg>
              </div>
              {/* Notion (Light Theme) */}
              <div className="w-5 h-5 rounded-full bg-white border border-black/10 dark:border-white/10 flex items-center justify-center backdrop-blur-md overflow-hidden shadow-sm">
                <svg className="w-2.5 h-2.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="#000" fillRule="evenodd" d="m5.2,47.56s8,10.37,8.48,10.83c1.16,1.11,2.73,1.69,4.33,1.6,8.37-.42,27.54-1.38,35.57-1.78,3.11-.16,5.55-2.72,5.56-5.83l.1-35.5c0-1.99-1.03-3.83-2.72-4.87t0,0c-2.99-1.84-8.91-5.49-10.7-6.68-1.46-.97-3.2-1.43-4.96-1.32-5.96.38-23.45,1.51-30.85,1.98-2.96.19-5.24,2.62-5.24,5.54v34.78c0,.45.15.89.43,1.24h0Zm50.01-28.91v.02l-.1,33.7c0,.97-.77,1.77-1.74,1.82l-35.57,1.78c-.5.03-.99-.16-1.35-.5-.36-.34-.57-.82-.57-1.32V20.71c0-.97.75-1.77,1.72-1.82l35.67-2.06c.5-.03.99.15,1.36.5.36.34.57.82.57,1.32h0Zm-11.98,21.42v-13.72c-.63-.72-1.63-.67-3.07-1.11-.1-.03-.19-.11-.23-.21-.04-.1-.03-.22.03-.31,1.72-2.53,6.63-.95,9.83-1.96.09-.03.2-.02.28.05.08.07.11.17.09.27-.31,1.39-1.4,2.1-2.95,2.4v22.57c0,.75-.45,1.44-1.15,1.72-.64.26-1.31.54-1.31.54-1.54.8-3.43.29-4.37-1.17l-11.46-17.87v16.27c.62.72,1.63.67,3.07,1.11.1.03.19.11.23.21.04.1.03.22-.03.31-1.73,2.53-6.63.95-9.83,1.96-.09.04-.2.02-.28-.05-.08-.06-.11-.17-.09-.27.31-1.39,1.4-2.1,2.95-2.4v-21.31l-3.02-.29s.21-2.45,3.09-2.73c1.42-.14,5.13-.3,6.47-.36.3-.01.59.13.77.38l10.99,15.95h0ZM15.03,14.28c.55.42,1.24.63,1.93.59,5.09-.29,26.82-1.53,32.21-1.84.17-.01.31-.13.35-.29.04-.16-.03-.33-.17-.42-2.39-1.49-4.74-2.95-5.76-3.63-.73-.48-1.6-.71-2.48-.66,0,0-24.7,1.36-29.78,1.91-.64.07-.78.3-.8.39-.09.31.02.54.27.74,1.02.78,3.07,2.33,4.23,3.21h0Z"/></svg>
              </div>
              {/* Slack */}
              <div className="w-5 h-5 rounded-full bg-black/[0.05] dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-center backdrop-blur-md overflow-hidden shadow-sm">
                <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317zm0 0" fill="#de1c59"/><path d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317zm0 0" fill="#35c5f0"/><path d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33 5.987-13.317 13.317-13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317zm0 0" fill="#2eb57d"/><path d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317zm0 0" fill="#ebb02e"/></svg>
              </div>
            </div>

            <div className="h-4 w-[1px] bg-white/10 mx-1" />

            <PromptInputAction tooltip="Upload files">
              <div className="flex items-center gap-1.5 p-1 bg-white/[0.03] border border-white/10 rounded-full mr-1">
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex h-6 w-6 text-black/40 dark:text-white/40 cursor-pointer items-center justify-center rounded-full transition-all hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white"
                  disabled={isRecording}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) {
                        Array.from(e.target.files).forEach(processFile);
                      }
                      if (e.target) e.target.value = "";
                    }}
                  />
                </button>
              </div>
            </PromptInputAction>

          </div>

          <div className="flex items-center gap-2">
            {/* Redesigned Model Selector */}
            <PromptInputAction tooltip="Change the Model">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="bg-white dark:bg-boult-surface hover:bg-black/5 dark:hover:bg-boult-surface-hover border border-black/10 dark:border-boult-border px-4 py-1.5 rounded-full h-8 min-w-[70px] flex items-center justify-center transition-all duration-300 outline-none shadow-sm dark:shadow-none">
                    <div className="flex items-center gap-1.5">
                      {activeModelId !== 'auto' && React.createElement(AI_MODELS.find(m => m.id === activeModelId)?.icon || AutoLogo, { className: "w-3.5 h-3.5 text-black dark:text-white" })}
                      <span className="text-[13px] font-semibold text-black dark:text-boult-fg">
                        {activeModelId === 'auto' ? 'Auto' : AI_MODELS.find(m => m.id === activeModelId)?.name}
                      </span>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="w-56 bg-boult-surface backdrop-blur-xl border border-boult-border text-boult-fg">
                  {AI_MODELS.map(model => {
                    const isLocked = 
                      (model.tier !== 'free' && (props.currentPlan === 'free' || props.currentPlan === 'none' || !props.currentPlan)) || 
                      (model.tier === 'pro' && props.currentPlan === 'starter');
                    
                    return (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => {
                          if (isLocked) {
                            toast('Unlock Premium Models', {
                              description: 'Upgrade your plan to access premium AI models.',
                              action: {
                                label: 'Upgrade',
                                onClick: () => window.location.href = '/pricing'
                              }
                            });
                          } else {
                            setActiveModelId(model.id);
                          }
                        }}
                        className={cn(
                          "flex items-center justify-between gap-2 px-3 py-2 cursor-pointer",
                          activeModelId === model.id && "bg-boult-surface-hover",
                          isLocked && "hover:bg-transparent"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <model.icon className={cn("w-4 h-4", isLocked ? "opacity-20" : "opacity-60")} />
                          <div className="flex flex-col">
                            <span className={cn("text-sm font-medium", isLocked ? "opacity-30" : "opacity-90")}>
                              {model.name}
                            </span>
                            {isLocked && (
                              <span className="text-[9px] text-amber-500/80 font-bold uppercase tracking-wider">
                                {model.tier === 'pro' ? 'Pro Plan' : 'Starter Plan'}
                              </span>
                            )}
                          </div>
                        </div>
                        {isLocked ? (
                          <Lock className="w-3.5 h-3.5 opacity-20" />
                        ) : (
                          activeModelId === model.id && <Check className="w-3.5 h-3.5 text-blue-500" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </PromptInputAction>

            <PromptInputAction
              tooltip={
                isLoading
                  ? "Stop generation"
                  : isRecording
                    ? "Stop recording"
                    : hasContent
                      ? "Send message"
                      : "Voice message"
              }
            >
              <button
                type="button"
                className={cn(
                  "inline-flex items-center justify-center font-medium h-8 w-8 rounded-full transition-all duration-200 outline-none",
                  isRecording
                    ? "bg-transparent hover:bg-black/[0.05] dark:bg-white/5 text-red-500 hover:text-red-400"
                    : "bg-black dark:bg-white hover:bg-black/80 dark:hover:bg-white/90 text-white dark:text-black shadow-lg"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isLoading && onStop) onStop();
                  else if (isRecording) setIsRecording(false);
                  else if (hasContent) handleSubmit();
                  else setIsRecording(true);
                }}
                disabled={isLoading && !onStop}
              >
                {isLoading ? (
                  <Square className="h-4 w-4 fill-current text-current animate-pulse" />
                ) : isRecording ? (
                  <StopCircle className="h-5 w-5 text-red-500" />
                ) : hasContent ? (
                  <ArrowUp className="h-4 w-4 text-current stroke-[3px]" />
                ) : (
                  <Mic className="h-5 w-5 text-current transition-colors" />
                )}
              </button>
            </PromptInputAction>
          </div>
        </PromptInputActions>


      </PromptInput>
      </div>

      <ImageViewDialog imageUrl={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
});

PromptInputBox.displayName = "PromptInputBox";
