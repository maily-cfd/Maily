"use client";
import { useState, useEffect } from "react";
import { Mail, RefreshCw, LogOut, Search, Star, TrendingUp, Clock, MessageSquare, Menu, ChevronRight, RotateCcw, User, DoorOpen, Mail as EmailIcon, MoreHorizontal } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { ThemeToggle } from "../../components/ui/theme-toggle";
import ProfileBubble from "../../components/ui/profile-bubble";
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import EmailList from "./components/email-list";
import EmailPreviewPane from "./components/email-preview-pane";
import ComposeDialog from "./components/compose-dialog";
import CustomSidebar from "./components/custom-sidebar";
import { EmailLoadingOverlay } from "../../components/ui/email-loading-overlay";
import { IntegrationsModal } from "../../components/ui/integrations-modal";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import "./dashboard.css";

// Client-side dashboard component (requires server-side auth check in parent)
export default function DashboardClient() {
  // Client-side authentication check
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") {
    // Loading state
    const style = `
      .letter {
        animation: slideIn 0.8s ease-out forwards;
        opacity: 0;
        transform: translateX(100%);
        display: inline-block;
      }
      @keyframes slideIn {
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;

    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-white text-4xl font-bold flex overflow-hidden">
          <span className="letter" style={{ animationDelay: '0s' }}>M</span>
          <span className="letter" style={{ animationDelay: '0.1s' }}>a</span>
          <span className="letter" style={{ animationDelay: '0.2s' }}>i</span>
          <span className="letter" style={{ animationDelay: '0.3s' }}>l</span>
          <span className="letter" style={{ animationDelay: '0.4s' }}>i</span>
          <span className="letter" style={{ animationDelay: '0.5s' }}>e</span>
          <span className="letter" style={{ animationDelay: '0.6s' }}>n</span>
          <span className="letter" style={{ animationDelay: '0.7s' }}>t</span>
        </div>
        <style dangerouslySetInnerHTML={{ __html: style }} />
      </div>
    );
  }

  if (status === "unauthenticated") {
    // Redirect to home page if not authenticated
    signIn('google', { redirectTo: '/dashboard' });
    return null;
  }

  // Set page title
  useEffect(() => {
    document.title = 'Dashboard / Maily';
  }, []);

  // Dashboard is accessible only to authenticated users
  return (
    <div className="min-h-screen bg-gray-900 text-white flex" style={{ fontFamily: 'Satoshi, sans-serif' }}>
      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-4xl font-bold mb-4">Dashboard</h1>
        <p className="text-gray-400 mb-8">Welcome to your Maily dashboard!</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl">
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Email Management</h3>
            <p className="text-gray-400 mb-4">Manage your emails with AI-powered insights</p>
            <Button onClick={() => window.location.href = '/dashboard/agent-talk'}>
              Go to Agent Talk
            </Button>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Account</h3>
            <p className="text-gray-400 mb-4">Manage your profile and settings</p>
            <Button disabled className="opacity-50 cursor-not-allowed">
              Available in Home Feed
            </Button>
          </div>
        </div>
        <div className="mt-8">
          <Button onClick={() => signOut()} variant="outline">
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
