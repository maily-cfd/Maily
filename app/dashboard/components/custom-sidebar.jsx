"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Send, Archive, Trash2, Star, Settings, Plus, ChevronRight, User, MessageCircle, Clock , Mail} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ProfileBubble from "@/components/ui/profile-bubble";

const CustomSidebar = ({ currentLabel, onLabelChange, labelCounts = {}, onCompose, onIntegrationsClick }) => {
  const [aiFeaturesExpanded, setAiFeaturesExpanded] = useState(false);
  const router = useRouter();

  const mainLabels = [
    { id: 'INBOX', name: 'Inbox', icon: Mail, count: labelCounts.INBOX || 12 },
    { id: 'CHATS', name: 'Chat', icon: MessageCircle, count: 0, isRoute: true, route: '/dashboard/chats' },
    { id: 'SCHEDULED', name: 'Scheduled', icon: Clock, count: 0, isRoute: true, route: '/dashboard/agents' },
    { id: 'SENT', name: 'Sent', icon: Send, count: 0 },
    { id: 'ARCHIVE', name: 'Archive', icon: Archive, count: 0 },
    { id: 'TRASH', name: 'Trash', icon: Trash2, count: 3 },
  ];

  const handleLabelClick = (labelId) => {
    const label = mainLabels.find(l => l.id === labelId);
    if (label?.isRoute && label?.route) {
      router.push(label.route);
    } else if (onLabelChange) {
       onLabelChange(labelId);
     }
   };

  const handleATalkClick = () => {
    router.push('/dashboard/agent-talk');
  };

  return (
    <div className="h-full bg-black flex flex-col">
      {/* Header with Logo and Profile */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="w-full h-full p-1 text-inherit" />
            <span className="text-white font-semibold text-lg">Mailient</span>
          </div>
          <ProfileBubble />
        </div>
      </div>

      {/* Compose Button */}
      <div className="p-3 border-b border-gray-700">
        <Button
          onClick={onCompose}
          className="w-full bg-white hover:bg-gray-200 text-black font-medium py-2 px-4 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Compose
        </Button>
      </div>

      {/* A Symbol with cool font */}
      <div className="p-3 border-b border-gray-700">
        <button
          onClick={handleATalkClick}
          className="w-full flex items-center justify-center p-4 text-white hover:bg-gradient-to-r hover:from-blue-600 hover:to-purple-600 hover:text-white rounded-xl transition-all duration-300 transform hover:scale-105 group relative overflow-hidden"
          style={{
            fontFamily: "'Satoshi', sans-serif",
            fontWeight: '900',
            fontSize: '1.75rem',
            textShadow: '0 0 20px rgba(59, 130, 246, 0.8), 0 0 40px rgba(59, 130, 246, 0.4)',
            letterSpacing: '0.15em',
            background: 'linear-gradient(45deg, #1e40af, #7c3aed, #1e40af)',
            backgroundSize: '200% 200%',
            animation: 'gradientShift 3s ease-in-out infinite'
          }}
        >
          <span className="relative z-10">A</span>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        </button>
        
        <style jsx>{`
          @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          
          .group:hover .relative span {
            text-shadow: 0 0 25px rgba(255, 255, 255, 0.9), 0 0 50px rgba(59, 130, 246, 0.7);
          }
        `}</style>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 space-y-1">
          {mainLabels.map((label) => {
            const Icon = label.icon;
            const isActive = currentLabel === label.id;

            return (
              <button
                key={label.id}
                onClick={() => handleLabelClick(label.id)}
                className={`flex items-center justify-between w-full p-2 text-sm rounded-lg transition-colors ${
                  isActive
                    ? 'bg-white text-black'
                    : 'text-gray-300 hover:text-white hover:bg-gray-800'
                }`}
              >
                <div className="flex items-center">
                  <Icon className="w-4 h-4 mr-3" />
                  <span className="font-medium">{label.name}</span>
                </div>
                {label.count > 0 && (
                  <Badge className="text-xs bg-gray-700 text-gray-200 hover:bg-gray-600">
                    {label.count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* AI Features Section */}
        <div className="px-3 mt-6">
          <button
            onClick={() => setAiFeaturesExpanded(!aiFeaturesExpanded)}
            className="flex items-center justify-between w-full p-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-white transition-colors"
          >
            <span>AI FEATURES</span>
            <ChevronRight className={`w-3 h-3 transition-transform ${aiFeaturesExpanded ? 'rotate-90' : ''}`} />
          </button>

          {aiFeaturesExpanded && (
            <div className="mt-2 space-y-1">
              <button
                className="flex items-center w-full p-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                <MessageCircle className="w-4 h-4 mr-3" />
                <span className="font-medium">Reply Assistant</span>
              </button>
              <button
                className="flex items-center w-full p-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                <MessageCircle className="w-4 h-4 mr-3" />
                <span className="font-medium">Context Memory</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 space-y-1">
        <button className="flex items-center w-full p-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
          <Settings className="w-4 h-4 mr-3" />
          <span>Settings</span>
        </button>
        <button onClick={onIntegrationsClick} className="flex items-center w-full p-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
          <Settings className="w-4 h-4 mr-3" />
          <span>Integrations</span>
        </button>
      </div>
    </div>
  );
};

export default CustomSidebar;