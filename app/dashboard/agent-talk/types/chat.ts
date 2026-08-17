export interface Email {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isTyping?: boolean;
}

export interface ConversationState {
  isLoading: boolean;
  error: string | null;
  isTyping: boolean;
}

export interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onModalStateChange?: (isOpen: boolean) => void;
  onEmailModalStateChange?: (isOpen: boolean) => void;
  selectedEmails?: Email[];
  onEmailSelect?: (emails: Email[]) => void;
  onEmailRemove?: (id: string) => void;
  /**
   * PART 46 — fired when the user submits a slash command whose `kind` is
   * 'client'. The handler name comes from the registry in lib/boult/skills.ts
   * (e.g. 'openAgents', 'showHelp'). ChatInterface wires it to the real
   * client-side action — opening a modal, clearing state, etc. Server-kind
   * commands ('/brief', '/inbox', etc.) bypass this callback and go through
   * onSendMessage normally so the route can expand them server-side.
   */
  onSlashClientCommand?: (
    handlerName: 'openAgents' | 'openMemorySettings' | 'openSettings' | 'clearConversation' | 'showHelp',
  ) => void;
}

export interface MessageListProps {
  messages: Message[];
  isTyping?: boolean;
}

export interface MessageBubbleProps {
  message: Message;
}
