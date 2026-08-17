"use client";
import { Mail } from "lucide-react";

import React, { useState } from 'react';
import { Home, Users, User, Mail, LogOut, Settings, Search, Plus, Bookmark, MessageCircle, History, DoorOpen, Info, MoreHorizontal } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip';
import { Button } from './button';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

interface MailySidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  userAvatar?: string;
  userName?: string;
}

export const MailySidebar: React.FC<MailySidebarProps> = ({
  activeSection,
  onNavigate,
  userAvatar,
  userName
}) => {
  const router = useRouter();
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);

  // Navigation items matching Maily's existing sidebar
  const navItems = [
    { id: 'home', icon: <Mail className="w-6 h-6" />, label: 'Feed', tooltip: 'Home Feed', route: '/home-feed' },
    { id: 'boult', icon: <span className="oleo-script-regular text-2xl">A</span>, label: 'Boult', tooltip: 'AI Assistant', route: '/dashboard/agent-talk' }
  ];

  const handleLogout = async () => {
    setIsMoreOptionsOpen(false);
    await signOut({ redirect: false });
    router.push("/");
  };

  return (
    <TooltipProvider>
      <div className="fixed left-0 top-0 h-screen w-20 bg-black border-r border-[#363636] flex flex-col z-30">
        {/* Sidebar Logo */}
        <div className="flex flex-col items-center py-8">
          <div
            className="w-12 h-12 bg-black rounded-2xl border border-white/10 flex items-center justify-center cursor-pointer hover:scale-110 transition-transform duration-500 overflow-hidden shadow-2xl"
            onClick={() => router.push('/home-feed')}
          >
            <Mail className="w-full h-full p-1 text-inherit" />
          </div>
        </div>

        {/* Sidebar Icons */}
        <div className="flex flex-col items-end py-12 gap-6 pr-4">
          {/* Email Icon - Home Feed */}
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  window.location.href = '/home-feed';
                  document.title = 'Home / Maily';
                }}
                className={`p-2 hover:bg-white dark:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105 ${activeSection === 'home' ? 'bg-white dark:bg-[#1a1a1a]' : ''
                  }`}
                aria-label="Feed"
              >
                <Mail className="w-6 h-6 text-[#fafafa]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[#363636] border-[#363636]">
              <p className="text-white text-sm">Feed</p>
            </TooltipContent>
          </Tooltip>





          {/* Boult Symbol - AI Assistant */}
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  window.location.href = '/dashboard/agent-talk';
                  document.title = 'Boult / Maily';
                }}
                className={`p-2 hover:bg-white dark:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105 ${activeSection === 'boult' ? 'bg-white dark:bg-[#1a1a1a]' : ''
                  }`}
                aria-label="Boult AI Assistant"
              >
                <span className="text-[#fafafa] oleo-script-regular text-2xl">A</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[#363636] border-[#363636]">
              <p className="text-white text-sm">Boult</p>
            </TooltipContent>
          </Tooltip>



          {/* More Options Icon */}
          <div className="relative">
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
                  className="p-2 hover:bg-white dark:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105"
                  aria-label="More Options"
                >
                  <MoreHorizontal className="w-6 h-6 text-[#fafafa]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-[#363636] border-[#363636]">
                <p className="text-white text-sm">More Options</p>
              </TooltipContent>
            </Tooltip>

            {/* Dialog Box */}
            {isMoreOptionsOpen && (
              <div className="absolute left-20 top-0 z-50 bg-white dark:bg-[#1a1a1a] border border-[#363636] rounded-lg shadow-xl p-2 min-w-48 animate-fadeIn">
                <button
                  onClick={() => {
                    window.location.href = '/settings';
                    document.title = 'Settings / Maily';
                    setIsMoreOptionsOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 text-[#fafafa] hover:bg-[#2a2a2a] rounded-md transition-all duration-200"
                >
                  <div className="font-medium">Settings & Privacy</div>
                </button>
                <button
                  onClick={() => {
                    window.location.href = '/pricing';
                    document.title = 'Pricing / Maily';
                    setIsMoreOptionsOpen(false);
                  }}
                  className="w-full text-left px-4 py-3 text-[#fafafa] hover:bg-[#2a2a2a] rounded-md transition-all duration-200"
                >
                  <div className="font-medium">Upgrade Plan</div>
                </button>
                <div className="border-t border-[#363636] my-1"></div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all duration-300 group relative overflow-hidden"
                >
                  <LogOut className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                  <span className="font-medium">Log Out</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-500/20 to-red-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider >
  );
};
