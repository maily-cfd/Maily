'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { ChatInputProps, Email } from '../types/chat';
import { SlashCommandMenu } from './SlashCommandMenu';
import { findSlashCommand, filterSlashCommands } from '@/lib/boult/skills';
import { IntegrationsModal } from '@/components/ui/integrations-modal';
import { EmailSelectionModal } from '@/components/ui/email-selection-modal';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Mic, Mail, Plus, Send, Mail as EmailIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

type RecordingState = 'idle' | 'recording' | 'paused';

// Extend Window interface for Speech Recognition API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// Recording Manager for MediaRecorder functionality
class MediaRecordingManager {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private state: RecordingState = 'idle';
  private onStateChange: ((state: RecordingState) => void) | null = null;
  private onDataAvailable: ((data: Blob) => void) | null = null;
  private onRecordingComplete: ((blob: Blob, chunks: Blob[]) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;

  async initializeRecording(constraints = { audio: true, video: false }, options = { mimeType: 'audio/webm' }) {
    try {
      console.log('MediaRecordingManager: Checking getUserMedia support...', {
        hasNavigator: !!navigator,
        hasMediaDevices: !!navigator?.mediaDevices,
        hasGetUserMedia: !!navigator?.mediaDevices?.getUserMedia,
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        constraints,
        timestamp: new Date().toISOString()
      });

      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia not supported in this browser');
      }

      console.log('MediaRecordingManager: Requesting user media...', constraints);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('MediaRecordingManager: User media granted successfully', {
        streamActive: this.stream.active,
        tracks: this.stream.getTracks().map(track => ({
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState
        }))
      });

      this.mediaRecorder = new MediaRecorder(this.stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
          if (this.onDataAvailable) {
            this.onDataAvailable(event.data);
          }
        }
      };

      this.mediaRecorder.onstop = () => {
        this.state = 'idle';
        this.onStateChange?.(this.state);
        if (this.onRecordingComplete) {
          const blob = new Blob(this.recordedChunks, { type: options.mimeType || 'audio/webm' });
          this.onRecordingComplete(blob, this.recordedChunks);
        }
        this.cleanup();
      };

      this.mediaRecorder.onerror = (event) => {
        this.state = 'idle';
        this.onStateChange?.(this.state);
        if (this.onError) {
          this.onError(new Error(event.error?.message || 'Recording error'));
        }
        this.cleanup();
      };

      return true;
    } catch (error) {
      console.error('MediaRecordingManager: Failed to initialize MediaRecorder:', {
        error: error instanceof Error ? error.message : error,
        errorName: error instanceof Error ? error.name : 'Unknown',
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        userAgent: navigator.userAgent,
        constraints,
        options,
        timestamp: new Date().toISOString()
      });
      if (this.onError) {
        this.onError(error as Error);
      }
      return false;
    }
  }

  startRecording() {
    if (!this.mediaRecorder || this.state !== 'idle') {
      return false;
    }

    try {
      this.recordedChunks = [];
      this.mediaRecorder.start(100);
      this.state = 'recording';
      this.onStateChange?.(this.state);
      return true;
    } catch (error) {
      console.error('Failed to start MediaRecorder:', error);
      if (this.onError) {
        this.onError(error as Error);
      }
      return false;
    }
  }

  pauseRecording() {
    if (this.mediaRecorder && this.state === 'recording') {
      this.mediaRecorder.pause();
      this.state = 'paused';
      this.onStateChange?.(this.state);
      return true;
    }
    return false;
  }

  resumeRecording() {
    if (this.mediaRecorder && this.state === 'paused') {
      this.mediaRecorder.resume();
      this.state = 'recording';
      this.onStateChange?.(this.state);
      return true;
    }
    return false;
  }

  stopRecording() {
    if (this.mediaRecorder && this.state !== 'idle') {
      this.mediaRecorder.stop();
      return true;
    }
    return false;
  }

  getState() {
    return {
      state: this.state,
      isRecording: this.state === 'recording',
      isPaused: this.state === 'paused',
      isIdle: this.state === 'idle'
    };
  }

  setStateChangeCallback(callback: (state: RecordingState) => void) {
    this.onStateChange = callback;
  }

  setDataAvailableCallback(callback: (data: Blob) => void) {
    this.onDataAvailable = callback;
  }

  setRecordingCompleteCallback(callback: (blob: Blob, chunks: Blob[]) => void) {
    this.onRecordingComplete = callback;
  }

  setErrorCallback(callback: (error: Error) => void) {
    this.onError = callback;
  }

  cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
  }

  getRecordedBlob() {
    if (this.recordedChunks.length === 0) return null;
    return new Blob(this.recordedChunks, { type: 'audio/webm' });
  }

  static isSupported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined');
  }
}

export function ChatInput({ onSendMessage, disabled, placeholder, onModalStateChange, onEmailModalStateChange, selectedEmails = [], onEmailSelect, onEmailRemove, onSlashClientCommand }: ChatInputProps) {
  const [message, setMessage] = useState('');
  // PART 46 — slash-command menu state. Menu is "open" whenever the input
  // text starts with "/" and the user hasn't dismissed it via Esc.
  // `slashFocusedIndex` tracks the currently keyboard-focused command in the
  // filtered list so ↑/↓/Tab/Enter can act on it.
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashFocusedIndex, setSlashFocusedIndex] = useState(0);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [volumeData, setVolumeData] = useState<number[]>([]);
  const [isSilent, setIsSilent] = useState(false);
  const [placeholderText, setPlaceholderText] = useState(placeholder || "Ask anything about your emails");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecordingManager | null>(null);
  const recordedBlobRef = useRef<Blob | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showResumeButton, setShowResumeButton] = useState(false);
  const [mediaRecorderState, setMediaRecorderState] = useState<RecordingState>('idle');

  const handleSubmit = () => {
    if ((message.trim() || selectedEmails.length > 0) && !disabled) {
      const trimmed = message.trim();

      // PART 46 — client-kind slash commands never hit the network. If the
      // first token matches a registered command and that command's kind is
      // 'client', short-circuit to the local handler the parent provided.
      // Server-kind commands fall through to onSendMessage and the chat
      // route expands them server-side (see lib/boult/skills.ts).
      if (trimmed.startsWith('/')) {
        const firstWhitespace = trimmed.search(/\s/);
        const cmdToken = firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace);
        const cmd = findSlashCommand(cmdToken);
        if (cmd && cmd.kind === 'client' && cmd.clientHandler) {
          onSlashClientCommand?.(cmd.clientHandler);
          setMessage('');
          setSlashDismissed(false);
          setSlashFocusedIndex(0);
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
          return;
        }
      }

      const emailTexts = selectedEmails.map(e => `[Email: ${e.subject} from ${e.from}]`).join(' ');
      const fullMessage = `${emailTexts} ${trimmed}`.trim();
      onSendMessage(fullMessage);
      setMessage('');
      setSlashDismissed(false);
      setSlashFocusedIndex(0);
      if (onEmailSelect) {
        onEmailSelect([]);
      }

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const removeSelectedEmail = (id: string) => {
    if (onEmailRemove) {
      onEmailRemove(id);
    }
  };

  // PART 46 — derived state for the slash menu. Open whenever the input
  // text starts with "/" AND the user hasn't pressed Esc to dismiss. Filter
  // is everything after the leading "/" up to the first whitespace.
  const slashOpen = !slashDismissed && message.startsWith('/') && !message.includes(' ');
  const slashFilter = slashOpen ? message.slice(1) : '';
  const slashFiltered = slashOpen ? filterSlashCommands(slashFilter) : [];

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // PART 46 — menu keyboard handling takes priority over text editing.
    if (slashOpen && slashFiltered.length > 0) {
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
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // PART 46 — fill the input with the picked command name + trailing space,
  // ready for the user to add args (v2) or hit Enter to fire. Re-focus the
  // textarea so they can keep typing without grabbing the mouse.
  const selectSlashCommand = (cmdName: string) => {
    setMessage(`/${cmdName} `);
    setSlashDismissed(false);
    setSlashFocusedIndex(0);
    setTimeout(() => {
      textareaRef.current?.focus();
      // Push cursor to the end.
      const el = textareaRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }, 0);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setMessage(next);

    // PART 46 — reset menu state when the user clears the input or stops
    // typing a slash command. Re-arm dismissal so a fresh "/" reopens the
    // menu after Esc.
    if (!next.startsWith('/')) {
      setSlashDismissed(false);
      setSlashFocusedIndex(0);
    } else {
      // Keep focused index in range as the filter narrows.
      const matches = filterSlashCommands(next.slice(1)).length;
      if (matches > 0 && slashFocusedIndex >= matches) setSlashFocusedIndex(0);
    }

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = 128; // 8rem in pixels (max-h-32)
      const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  };

  // Initialize MediaRecorder manager
  useEffect(() => {
    if (typeof window !== 'undefined' && MediaRecordingManager.isSupported()) {
      console.log('Initializing MediaRecorder manager...');
      mediaRecorderRef.current = new MediaRecordingManager();

      // Set up MediaRecorder callbacks
      mediaRecorderRef.current.setStateChangeCallback((state) => {
        setMediaRecorderState(state);
        console.log('MediaRecorder state changed to:', state);
      });

      mediaRecorderRef.current.setRecordingCompleteCallback((blob, chunks) => {
        recordedBlobRef.current = blob;
        console.log('MediaRecorder recording completed:', blob.size, 'bytes');
        // Here you could save the audio blob or send it to your backend
      });

      mediaRecorderRef.current.setErrorCallback((error) => {
        console.error('MediaRecorder error:', error);
        setMediaRecorderState('idle');
      });
    } else {
      console.log('MediaRecorder not supported in this browser');
    }

    return () => {
      // Cleanup function - called when component unmounts
      console.log('Component unmounting - cleaning up recording resources...');

      // Stop any active recording
      if (mediaRecorderRef.current) {
        const mediaState = mediaRecorderRef.current.getState();
        if (mediaState.isRecording || mediaState.isPaused) {
          try {
            mediaRecorderRef.current.stopRecording();
            console.log('MediaRecorder stopped during cleanup');
          } catch (error) {
            console.error('Error stopping MediaRecorder during cleanup:', error);
          }
        }
        mediaRecorderRef.current.cleanup();
        console.log('MediaRecorder cleanup completed');
      }

      // Stop speech recognition
      if (recognitionRef.current) {
        try {
          console.log('Aborting speech recognition during component cleanup', {
            timestamp: new Date().toISOString(),
            currentState: recordingState,
            isListening: isListening,
            hasMessage: !!message.trim()
          });
          recognitionRef.current.abort();
          console.log('Speech recognition aborted during cleanup successfully');
        } catch (e) {
          console.error('Error aborting speech recognition during cleanup:', e, {
            timestamp: new Date().toISOString(),
            currentState: recordingState
          });
        }
        recognitionRef.current = null;
      }

      // Reset states
      setRecordingState('idle');
      setMediaRecorderState('idle');
      setIsListening(false);
      setShowResumeButton(false);
      setPlaceholderText(placeholder || "Ask anything about your emails");

      // Clear recorded blob
      recordedBlobRef.current = null;
    };
  }, []);

  const createNewRecognition = () => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        // Clean up existing instance
        if (recognitionRef.current) {
          try {
            console.log('Cleaning up existing recognition instance in createNewRecognition', {
              timestamp: new Date().toISOString(),
              currentState: recordingState,
              isListening: isListening
            });
            recognitionRef.current.abort();
            console.log('Existing recognition instance aborted successfully');
          } catch (e) {
            console.error('Error aborting existing recognition during cleanup:', e, {
              timestamp: new Date().toISOString()
            });
          }
          recognitionRef.current = null;
        }

        // Create new instance
        const recognition = new SpeechRecognition();
        recognition.continuous = false; // Changed to false for better control
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          console.log('Speech recognition result received:', {
            resultIndex: event.resultIndex,
            resultsLength: event.results.length,
            timestamp: new Date().toISOString()
          });

          let finalTranscript = '';
          let interimTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          const newMessage = finalTranscript + interimTranscript;
          console.log('Setting message from speech:', {
            finalTranscript,
            interimTranscript,
            combinedLength: newMessage.length,
            previousMessage: message
          });

          setMessage(newMessage);
        };

        recognition.onerror = (event: any) => {
          // Suppress abort errors as they are intentional stops, not actual errors
          if (event.error === 'aborted') {
            // Silent handling for intentional aborts - just cleanup
            recognitionRef.current = null;
            return;
          }

          // Log only non-abort errors
          console.error('Speech recognition error:', event.error, {
            currentRecordingState: recordingState,
            isListening: isListening,
            timestamp: new Date().toISOString(),
            errorType: event.error,
            errorMessage: event.message || 'No message',
            stackTrace: new Error().stack // Add stack trace to see call origin
          });

          // Reset states for actual errors
          setRecordingState('idle');
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognition.onend = () => {
          console.log('Speech recognition ended, current state:', recordingState, {
            timestamp: new Date().toISOString(),
            wasAborted: recognitionRef.current === null,
            mediaRecorderState: mediaRecorderState,
            currentMessage: message,
            messageLength: message.length
          });
          setIsListening(false);

          // Keep recording state active - user can continue speaking
          // Don't reset to idle unless explicitly stopped
          if (recordingState === 'recording') {
            console.log('Recording session still active - ready for more speech');
            // Keep showResumeButton true so user can pause/resume/stop
            // The session remains active for continued speaking
          }

          recognitionRef.current = null;
        };

        recognition.onstart = () => {
          console.log('Speech recognition started');
          setIsListening(true);
        };

        recognition.onaudiostart = () => {
          console.log('Audio capture started');
        };

        recognition.onsoundstart = () => {
          console.log('Sound detected - speaking...');
        };

        recognition.onsoundend = () => {
          console.log('Sound ended - stopped speaking');
        };

        recognition.onaudioend = () => {
          console.log('Audio capture ended');
        };

        recognitionRef.current = recognition;
        return recognition;
      }
    }
    return null;
  };

  const startRecording = async () => {
    if (!disabled) {
      console.log('Start recording clicked, current state:', recordingState);

      // Check if MediaRecorder is supported
      if (!MediaRecordingManager.isSupported()) {
        console.warn('MediaRecorder not supported, falling back to Speech Recognition');
        setPlaceholderText('');
        return startSpeechRecognition();
      }

      try {
        // Ensure MediaRecorder manager exists (should be initialized in useEffect)
        if (!mediaRecorderRef.current) {
          console.error('MediaRecorder manager not available');
          return;
        }

        // Initialize MediaRecorder with audio constraints
        const initialized = await mediaRecorderRef.current.initializeRecording(
          { audio: true, video: false },
          { mimeType: 'audio/webm' }
        );

        if (initialized) {
          const started = mediaRecorderRef.current.startRecording();
          if (started) {
            setRecordingState('recording');
            setIsListening(true);
            setPlaceholderText('Recording your audio...');
            console.log('MediaRecorder started successfully');
          } else {
            console.error('Failed to start MediaRecorder');
            setRecordingState('idle');
            setIsListening(false);
            setPlaceholderText(placeholder || "Ask anything about your emails");
          }
        } else {
          console.error('Failed to initialize MediaRecorder');
          setRecordingState('idle');
          setIsListening(false);
          setPlaceholderText(placeholder || "Ask anything about your emails");
        }
      } catch (error) {
        console.error('MediaRecorder error:', error);
        toast.error('Audio recording failed', { description: 'Check your microphone permissions and try again.' });
        setRecordingState('idle');
        setIsListening(false);
        setShowResumeButton(false);
        setPlaceholderText(placeholder || "Ask anything about your emails");
      }
    }
  };

  const startSpeechRecognition = async () => {
    try {
      console.log('startSpeechRecognition: Creating recognition instance...');

      const recognition = createNewRecognition();
      if (recognition) {
        console.log('startSpeechRecognition: Starting speech recognition...');
        recognition.start();
        setPlaceholderText('Recording your audio...');
      } else {
        console.error('startSpeechRecognition: Failed to create recognition instance');
        setPlaceholderText(placeholder || "Ask anything about your emails");
      }
    } catch (error) {
      console.error('startSpeechRecognition: Error during speech recognition setup:', {
        error: error instanceof Error ? error.message : error,
        errorName: error instanceof Error ? error.name : 'Unknown',
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      });
      setPlaceholderText(placeholder || "Ask anything about your emails");
    }
  };

  const pauseRecording = () => {
    console.log('Pause button clicked, current state:', recordingState, {
      timestamp: new Date().toISOString(),
      hasRecognition: !!recognitionRef.current,
      mediaRecorderState: mediaRecorderRef.current?.getState()
    });

    // Pause MediaRecorder if available and recording
    if (mediaRecorderRef.current) {
      const mediaState = mediaRecorderRef.current.getState();
      if (mediaState.isRecording) {
        const paused = mediaRecorderRef.current.pauseRecording();
        if (paused) {
          console.log('MediaRecorder paused successfully');
        } else {
          console.warn('MediaRecorder pause failed');
        }
      } else {
        console.log('MediaRecorder not in recording state, current state:', mediaState.state);
      }
    }

    // Also pause speech recognition
    if (recognitionRef.current && recordingState === 'recording') {
      try {
        console.log('Pausing speech recognition - calling stop()', {
          timestamp: new Date().toISOString(),
          currentState: recordingState,
          isListening: isListening,
          hasMessage: !!message.trim()
        });
        recognitionRef.current.stop();
        console.log('Speech recognition stop requested successfully');
      } catch (error) {
        console.error('Error stopping speech recognition:', error, {
          timestamp: new Date().toISOString(),
          currentState: recordingState
        });
      }
      setRecordingState('paused');
      setIsListening(false);
      console.log('Speech recognition paused - states updated');
    } else {
      console.log('Speech recognition not active or not in recording state', {
        hasRecognition: !!recognitionRef.current,
        recordingState: recordingState,
        isListening: isListening
      });
    }
  };

  const resumeRecording = async () => {
    if (recordingState === 'paused' && !disabled) {
      console.log('Resume button clicked, resuming recording...');

      // Resume MediaRecorder if available and paused
      if (mediaRecorderRef.current) {
        const mediaState = mediaRecorderRef.current.getState();
        if (mediaState.isPaused) {
          const resumed = mediaRecorderRef.current.resumeRecording();
          if (resumed) {
            console.log('MediaRecorder resumed successfully');
          } else {
            console.warn('MediaRecorder resume failed');
          }
        } else {
          console.log('MediaRecorder not in paused state, current state:', mediaState.state);
        }
      }

      // Resume speech recognition
      try {
        const recognition = createNewRecognition();
        if (recognition) {
          setRecordingState('recording');
          setIsListening(true);
          recognition.start();
          setPlaceholderText('Recording your audio...');
          console.log('Speech recognition resumed');
        } else {
          console.error('Failed to create recognition instance for resume');
          setRecordingState('idle');
          setIsListening(false);
          setPlaceholderText(placeholder || "Ask anything about your emails");
        }
      } catch (error) {
        console.error('Error resuming speech recognition:', error);
        setRecordingState('idle');
        setIsListening(false);
        setPlaceholderText(placeholder || "Ask anything about your emails");
      }
    } else {
      console.log('Resume ignored - state:', recordingState, 'disabled:', disabled);
    }
  };

  const stopRecording = () => {
    console.log('Stop button clicked, stopping recording completely...', {
      timestamp: new Date().toISOString(),
      currentRecordingState: recordingState,
      hasRecognition: !!recognitionRef.current,
      mediaRecorderState: mediaRecorderRef.current?.getState(),
      currentMessage: message
    });

    // Stop MediaRecorder if available and actively recording
    if (mediaRecorderRef.current) {
      const mediaState = mediaRecorderRef.current.getState();
      if (mediaState.isRecording || mediaState.isPaused) {
        mediaRecorderRef.current.stopRecording();
        console.log('MediaRecorder stopped');
      }
    }

    // Stop speech recognition - use abort to force immediate stop
    if (recognitionRef.current) {
      try {
        console.log('Aborting speech recognition via stopRecording()', {
          timestamp: new Date().toISOString(),
          currentState: recordingState,
          isListening: isListening,
          hasMessage: !!message.trim()
        });
        recognitionRef.current.abort();
        console.log('Speech recognition aborted successfully');
      } catch (error) {
        console.error('Error aborting speech recognition:', error, {
          timestamp: new Date().toISOString(),
          currentState: recordingState
        });
      }
      recognitionRef.current = null;
    }

    // Force cleanup of any remaining media streams
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.cleanup();
      console.log('MediaRecorder cleanup completed');
    }

    // Reset all states immediately
    setRecordingState('idle');
    setMediaRecorderState('idle');
    setIsListening(false);
    setShowResumeButton(false);
    setPlaceholderText(placeholder || "Ask anything about your emails");

    console.log('Recording stopped completely - all states reset, message preserved:', message);
  };

  const cancelRecording = () => {
    console.log('Cancel recording clicked - deleting all recorded data...', {
      timestamp: new Date().toISOString(),
      currentRecordingState: recordingState,
      hasRecognition: !!recognitionRef.current,
      mediaRecorderState: mediaRecorderRef.current?.getState(),
      currentMessage: message
    });

    // Stop MediaRecorder if available and actively recording
    if (mediaRecorderRef.current) {
      const mediaState = mediaRecorderRef.current.getState();
      if (mediaState.isRecording || mediaState.isPaused) {
        mediaRecorderRef.current.stopRecording();
        console.log('MediaRecorder stopped for cancellation');
      }
    }

    // Stop speech recognition - use abort to force immediate stop
    if (recognitionRef.current) {
      try {
        console.log('Aborting speech recognition via cancelRecording()', {
          timestamp: new Date().toISOString(),
          currentState: recordingState,
          isListening: isListening,
          hasMessage: !!message.trim()
        });
        recognitionRef.current.abort();
        console.log('Speech recognition aborted successfully');
      } catch (error) {
        console.error('Error aborting speech recognition:', error, {
          timestamp: new Date().toISOString(),
          currentState: recordingState
        });
      }
      recognitionRef.current = null;
    }

    // Force cleanup of any remaining media streams
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.cleanup();
      console.log('MediaRecorder cleanup completed');
    }

    // Clear the transcribed message and reset all states
    setMessage('');
    setRecordingState('idle');
    setMediaRecorderState('idle');
    setIsListening(false);
    setShowResumeButton(false);
    setPlaceholderText(placeholder || "Ask anything about your emails");

    // Clear recorded blob
    recordedBlobRef.current = null;

    console.log('Recording cancelled completely - all data cleared and states reset');
  };

  const confirmRecording = async () => {
    setIsTranscribing(true);
    console.log('Confirm recording clicked - processing speech-to-text...', {
      timestamp: new Date().toISOString(),
      currentRecordingState: recordingState,
      hasRecognition: !!recognitionRef.current,
      mediaRecorderState: mediaRecorderRef.current?.getState(),
      currentMessage: message,
      messageLength: message.length
    });

    // Stop MediaRecorder if available and actively recording
    if (mediaRecorderRef.current) {
      const mediaState = mediaRecorderRef.current.getState();
      if (mediaState.isRecording || mediaState.isPaused) {
        mediaRecorderRef.current.stopRecording();
        console.log('MediaRecorder stopped for confirmation');
      }
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
        console.log('Speech recognition aborted successfully');
      } catch (error) {
        console.error('Error aborting speech recognition:', error);
      }
      recognitionRef.current = null;
    }

    // Wait for MediaRecorder to complete and set the blob
    await new Promise(resolve => setTimeout(resolve, 500));

    const blob = recordedBlobRef.current;
    console.log('Confirm recording - blob available:', !!blob, blob?.size);

    if (blob) {
      console.log('Sending audio blob to Assembly AI for transcription:', blob.size, 'bytes');

      try {
        const formData = new FormData();
        formData.append('audio', blob);

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        console.log('Transcription API response:', data);

        if (data.transcription) {
          console.log('Transcription received:', data.transcription);
          setMessage(data.transcription);
        } else {
          console.error('No transcription received:', data);
        }
      } catch (error) {
        console.error('Error transcribing audio:', error);
        // Fallback to existing message if transcription fails
      }
    } else {
      console.error('No audio blob available for transcription');
    }

    // Force cleanup of any remaining media streams
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.cleanup();
      console.log('MediaRecorder cleanup completed');
    }

    // Reset recording states
    setRecordingState('idle');
    setMediaRecorderState('idle');
    setIsListening(false);
    setShowResumeButton(false);
    setPlaceholderText(placeholder || "Ask anything about your emails");

    // Clear recorded blob
    recordedBlobRef.current = null;

    console.log('Recording confirmed - transcription completed, message ready for sending:', message);

    // Auto-submit the transcribed message if we have content
    if (message.trim()) {
      console.log('Auto-submitting transcribed message:', message.trim());
      setTimeout(() => {
        handleSubmit();
      }, 100);
    }

    setIsTranscribing(false);
  };





  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="relative group transition-all duration-700">
        {/* PART 46 — slash-command autocomplete. Mounted as a sibling to the
            input bar so it floats ABOVE via absolute positioning (bottom-full)
            inside this relative wrapper. */}
        <SlashCommandMenu
          isOpen={slashOpen}
          filter={slashFilter}
          focusedIndex={slashFocusedIndex}
          onFocusIndex={setSlashFocusedIndex}
          onSelect={(cmd) => selectSlashCommand(cmd.name)}
        />

        <div className="relative flex flex-col bg-[#0b0b0c] border border-white/[0.08] hover:border-white/[0.14] rounded-[24px] shadow-2xl px-6 py-3.5 transition-all duration-500 focus-within:bg-[#060607] focus-within:border-white/[0.18]">

          {/* Recording Status Indicator */}
          <AnimatePresence>
            {(recordingState === 'recording' || recordingState === 'paused') && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute -top-9 left-6 px-3 py-1.5 bg-[#0a0a0b] border border-white/10 rounded-xl flex items-center gap-2.5 backdrop-blur-xl z-20"
              >
                <div className="relative flex items-center justify-center w-2 h-2">
                  <div className={`absolute inset-0 rounded-full blur-[2px] ${recordingState === 'recording' ? 'bg-white/50 animate-pulse' : 'bg-white/20'}`} />
                  <div className={`w-2 h-2 rounded-full ${recordingState === 'recording' ? 'bg-white animate-pulse' : 'bg-white/40'}`} />
                </div>
                <span className="text-[10px] uppercase tracking-widest text-white font-semibold">
                  {recordingState === 'recording' ? 'Voice active' : 'Voice paused'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selected Emails Section */}
          {selectedEmails.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2 pt-1">
              {selectedEmails.map((email) => (
                <div
                  key={email.id}
                  className="flex items-center bg-white/[0.08] rounded-xl px-3 py-2 text-[11px] border border-white/20 transition-all group/item"
                >
                  <Mail className="w-3.5 h-3.5 mr-2 text-white" />
                  <span className="text-white truncate max-w-[150px] font-medium" title={email.subject}>
                    {email.subject}
                  </span>
                  <button
                    onClick={() => removeSelectedEmail(email.id)}
                    className="ml-2.5 p-1 hover:bg-white/10 rounded-lg text-white transition-all"
                  >
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3 min-h-[48px]">
            {/* Action Bar (Left) */}
            <div className="flex items-center gap-1 mb-1.5 flex-shrink-0">
              <TooltipProvider>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onModalStateChange?.(true)}
                      className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-xl transition-all outline-none border-none"
                    >
                      <Plus className="w-4.5 h-4.5 text-white" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-[#0f0f10] border border-white/10">
                    <span className="text-[10px] uppercase tracking-widest text-white font-semibold">Integrations</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onEmailModalStateChange?.(true)}
                      className="w-9 h-9 flex items-center justify-center text-white hover:bg-white/10 rounded-xl transition-all relative outline-none border-none"
                    >
                      <EmailIcon className="w-4 h-4 text-white" />
                      <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-white rounded-full blur-[1px]"></div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-[#0f0f10] border border-white/10">
                    <span className="text-[10px] uppercase tracking-widest text-white font-semibold">Attach email</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Input Surface */}
            <div className="flex-1 relative min-w-0 py-3">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholderText}
                disabled={disabled}
                className="w-full resize-none bg-transparent text-white placeholder:text-white/50 focus:outline-none border-none p-0 min-h-[24px] max-h-40 text-[14px] leading-relaxed selection:bg-white selection:text-black font-medium"
                rows={1}
              />
            </div>

            {/* Controls (Right) */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-shrink-0">
              {recordingState !== 'idle' ? (
                <div className="flex items-center gap-1 bg-white/10 rounded-2xl p-1">
                  <button
                    onClick={cancelRecording}
                    className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/20 rounded-xl transition-all"
                  >
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { setIsTranscribing(true); confirmRecording(); }}
                    className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/20 rounded-xl transition-all"
                    disabled={isTranscribing}
                  >
                    {isTranscribing ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </div>
              ) : (
                <TooltipProvider>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={startRecording}
                        disabled={disabled}
                        className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all outline-none border-none ${isListening ? 'text-white bg-white/20' : 'text-white/80 hover:text-white hover:bg-white/10'}`}
                      >
                        {isListening ? (
                          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        ) : (
                          <Mic className="w-4 h-4 text-white" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-[#0f0f10] border border-white/10">
                      <span className="text-[10px] uppercase tracking-widest text-white font-semibold">Voice input</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <button
                onClick={handleSubmit}
                disabled={!message.trim() || disabled}
                className={`w-9 h-9 flex items-center justify-center transition-all duration-500 rounded-xl outline-none border-none ${message.trim() ? 'bg-white text-black hover:scale-105' : 'bg-white/[0.08] text-white/40'}`}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 text-center text-[11px] text-white font-medium tracking-wide">
        AI is training. Please do not upload any personal, confidential, or sensitive information
      </div>
      <style jsx>{`
        textarea:focus, textarea:active, textarea:focus-visible {
          outline: none !important;
          box-shadow: none !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
}
