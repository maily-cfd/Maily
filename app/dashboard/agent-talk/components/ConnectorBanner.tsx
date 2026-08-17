/**
 * Connector Banner
 * 
 * Shows "Connect your tools to Mailent" banner at the bottom of the prompt box
 * when no connections are made, similar to Manus AI.
 */

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { X, Link2, Sparkles } from 'lucide-react';
import { 
  getBannerConnectors,
  hasConnectedAccounts 
} from '@/lib/boult-connector-registry';

interface ConnectedAccount {
  id: string;
  connectorId: string;
  status: string;
}

interface ConnectorBannerProps {
  connectedAccounts: ConnectedAccount[];
  onOpenConnectors: () => void;
  onDismiss?: () => void;
  dismissed?: boolean;
}

export function ConnectorBanner({ 
  connectedAccounts,
  onOpenConnectors,
  onDismiss,
  dismissed = false
}: ConnectorBannerProps) {
  // Don't show if dismissed or if there are connected accounts
  const hasConnections = hasConnectedAccounts(connectedAccounts);
  
  if (dismissed || hasConnections) {
    return null;
  }

  // Get connectors to feature in banner
  const featuredConnectors = getBannerConnectors().slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="absolute -bottom-16 left-0 right-0 mx-4"
    >
      <div className="bg-[#0b0b0c] border border-white/[0.08] rounded-xl p-3.5
                      flex items-center justify-between
                      shadow-2xl shadow-black/40">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className="w-10 h-10 rounded-lg bg-white/[0.06]
                          flex items-center justify-center flex-shrink-0">
            <Link2 className="w-5 h-5 text-white" />
          </div>

          {/* Text */}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white text-sm">
                Connectors are now available.
              </span>
              <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
            </div>
            <p className="text-white text-xs mt-0.5">
              Connectors allow Boult to interact with apps directly in conversations.
            </p>
          </div>

          {/* Connector Icons Preview */}
          <div className="hidden sm:flex items-center -space-x-2 ml-4">
            {featuredConnectors.map((connector, index) => (
              <motion.div
                key={connector.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                // Hover: pop the icon forward (scale + lift + raise z-index) with a
                // brighter ring, so the cluster feels alive and you can pick one out.
                whileHover={{ scale: 1.22, y: -4, zIndex: 50 }}
                whileTap={{ scale: 1.1 }}
                title={connector.name}
                className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer
                           ring-2 ring-[#0b0b0c] bg-white/[0.08]
                           hover:bg-white/[0.16] hover:ring-white/25
                           transition-[background-color,box-shadow,ring-color] duration-200"
                style={{ zIndex: featuredConnectors.length - index }}
              >
                <img
                  src={connector.icon}
                  alt={connector.name}
                  className="w-4 h-4"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </motion.div>
            ))}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center
                           ring-2 ring-[#0b0b0c] bg-white/[0.08] text-xs text-white font-semibold">
              +
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-white hover:text-white/80 text-sm font-semibold transition-colors"
            >
              Dismiss
            </button>
          )}
          
          <button
            onClick={onOpenConnectors}
            className="px-5 py-2 bg-white text-black rounded-full text-sm font-bold
                       hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            Connect
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Compact banner for smaller spaces
 */
export function ConnectorBannerCompact({
  connectedAccounts,
  onOpenConnectors,
  onDismiss
}: ConnectorBannerProps) {
  const hasConnections = hasConnectedAccounts(connectedAccounts);
  
  if (hasConnections) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between gap-4 p-3 
                 bg-gradient-to-r from-gray-900 to-gray-800 
                 border border-gray-700/50 rounded-xl"
    >
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-blue-400" />
        <span className="text-sm text-neutral-900 dark:text-gray-300">
          Connect your tools for AI workflows
        </span>
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenConnectors}
          className="px-3 py-1.5 bg-white text-black rounded-lg text-sm font-medium
                     hover:bg-gray-200 transition-colors"
        >
          Connect
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1.5 text-neutral-600 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:bg-gray-800
                       rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Inline connector prompt (for use in empty states)
 */
export function ConnectorInlinePrompt({
  onOpenConnectors
}: { onOpenConnectors: () => void }) {
  const featuredConnectors = getBannerConnectors().slice(0, 4);

  return (
    <div className="text-center py-8">
      <div className="inline-flex items-center gap-2 p-1 bg-neutral-100 dark:bg-gray-800/50 rounded-2xl mb-4">
        {featuredConnectors.map((connector, index) => (
          <div
            key={connector.id}
            className="w-10 h-10 rounded-xl flex items-center justify-center
                       bg-neutral-100 dark:bg-gray-800 ring-2 ring-[#1a1a1a]"
          >
            <img
              src={connector.icon}
              alt={connector.name}
              className="w-5 h-5"
            />
          </div>
        ))}
      </div>
      
      <h3 className="text-lg font-medium text-black dark:text-white mb-2">
        Connect your tools
      </h3>
      <p className="text-neutral-600 dark:text-gray-400 text-sm mb-4 max-w-sm mx-auto">
        Link Gmail, Calendar, Notion, GitHub, and more to enable AI-powered workflows
      </p>
      
      <button
        onClick={onOpenConnectors}
        className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black
                   rounded-xl font-medium hover:bg-gray-200 transition-colors"
      >
        <Link2 className="w-5 h-5" />
        Connect Tools
      </button>
    </div>
  );
}

export default ConnectorBanner;
