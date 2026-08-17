"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Copy, Mail, Linkedin, Check } from 'lucide-react';
import { toast } from 'sonner';
import { triggerMiniConfetti } from '@/lib/confetti';

// Simple logo components
const XLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const WhatsAppLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488" />
  </svg>
);

const GmailLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-.904.732-1.636 1.636-1.636h3.819v-.273L12 9.18l6.545-4.727V3.82h3.819c.904 0 1.636.733 1.636 1.637z" />
  </svg>
);

const LinkedInLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

interface InviteShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
}

export function InviteShareModal({ open, onOpenChange, username }: InviteShareModalProps) {
  const [copied, setCopied] = useState(false);
  const invitationLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/signup?ref=${encodeURIComponent(username)}`;

  // Generate platform-specific messages
  const getMessage = (platform: string) => {
    const baseMessage = `Hey!\n\n${username} has invited you to join Maily`;

    switch (platform) {
      case 'x-dm':
        return `${baseMessage} - a powerful email intelligence platform. Check it out: ${invitationLink}`;
      case 'x-post':
        return `${baseMessage}! 🚀 Join me on Maily and transform how you manage your emails. ${invitationLink}`;
      case 'whatsapp':
        return `${baseMessage}! 🎉 It's an amazing email intelligence platform that helps you stay organized and productive. Join me here: ${invitationLink}`;
      case 'gmail':
        return `Hey!\n\n${username} has invited you to join Maily, a powerful email intelligence platform that helps you stay organized and productive.\n\nJoin here: ${invitationLink}\n\nLooking forward to connecting with you on Maily!\n\nBest regards`;
      case 'linkedin':
        return `Hi there,\n\n${username} has invited you to join Maily, a professional email intelligence platform designed to help you manage your communications more effectively.\n\nI think you'd find it valuable for your workflow. You can join here: ${invitationLink}\n\nLooking forward to connecting with you on the platform!\n\nBest regards`;
      default:
        return `${baseMessage}. Join here: ${invitationLink}`;
    }
  };

  const shareOptions = [
    {
      name: 'X (DM)',
      icon: XLogo,
      color: 'text-white',
      action: () => {
        const message = getMessage('x-dm');
        const url = `https://twitter.com/messages/compose?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
    {
      name: 'X (Post)',
      icon: XLogo,
      color: 'text-white',
      action: () => {
        const message = getMessage('x-post');
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
    {
      name: 'WhatsApp',
      icon: WhatsAppLogo,
      color: 'text-[#25D366]',
      action: () => {
        const message = getMessage('whatsapp');
        const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
    {
      name: 'Gmail',
      icon: GmailLogo,
      color: 'text-[#EA4335]',
      action: () => {
        const subject = `${username} has invited you to join Maily`;
        const body = getMessage('gmail');
        const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
    {
      name: 'LinkedIn',
      icon: LinkedInLogo,
      color: 'text-[#0077B5]',
      action: () => {
        const message = getMessage('linkedin');
        // LinkedIn share URL - opens share dialog
        const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(invitationLink)}&summary=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    },
  ];

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(invitationLink);
      setCopied(true);
      toast.success('Invitation link copied to clipboard!');
      triggerMiniConfetti(); // Quick dopamine hit
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-[#000000] border-[#2f3336] text-white backdrop-blur-md bg-opacity-90 [&_[data-radix-dialog-backdrop]]:bg-black/60 [&_[data-radix-dialog-backdrop]]:backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="text-white text-xl font-bold">Invite Friends to Maily</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Invitation Link */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#8b98a5]">Invitation Link</label>
            <div className="flex space-x-2">
              <input
                value={invitationLink}
                readOnly
                onClick={() => window.open(invitationLink, '_blank')}
                className="flex-1 px-3 py-2 bg-[#16181c] border border-[#2f3336] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1d9bf0] focus:border-transparent cursor-pointer hover:border-[#1d9bf0] transition-colors"
                title="Click to open link"
              />
              <button
                onClick={handleCopyLink}
                className="px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                style={{ backgroundColor: '#fafafa', color: '#000' }}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="text-sm">{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Share Options */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-[#8b98a5]">Share via</label>
            <div className="flex justify-center gap-4">
              {shareOptions.map((option) => {
                const Icon = option.icon;
                const isXPlatform = option.name.includes('X');

                return (
                  <button
                    key={option.name}
                    onClick={option.action}
                    className="flex flex-col items-center gap-2 p-3 hover:bg-[#16181c] rounded-lg transition-all duration-200"
                  >
                    <div className="w-12 h-12 rounded-full bg-[#2f3336] flex items-center justify-center hover:bg-[#3a3f44] transition-colors">
                      <Icon className={`w-6 h-6 ${option.color || 'text-white'}`} />
                    </div>
                    {isXPlatform && (
                      <span className="text-xs text-[#8b98a5] font-medium text-center leading-tight">
                        {option.name}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Copy Link Button (Prominent) */}
          <button
            onClick={handleCopyLink}
            className="w-full py-3 px-4 rounded-full font-bold text-[15px] transition-colors flex items-center justify-center gap-2"
            style={{ backgroundColor: '#fafafa', color: '#000' }}
          >
            {copied ? (
              <>
                <Check className="w-5 h-5" />
                <span>Link Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" />
                <span>Copy Invitation Link</span>
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

