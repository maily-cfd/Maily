/**
 * Connector Icons for Prompt Box
 * 
 * Shows connected app icons next to the "Agent" or "Plan" dropdown
 * When connections exist. Displays horizontally as a row of icons.
 */

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { 
  CONNECTOR_REGISTRY,
  getConnectedConnectors 
} from '@/lib/boult-connector-registry';

interface ConnectedAccount {
  id: string;
  connectorId: string;
  status: string;
  email?: string;
  connectedAt?: string;
}

interface PromptBoxConnectorIconsProps {
  connectedAccounts: ConnectedAccount[];
  onOpenConnectors: () => void;
  maxVisible?: number;
}

export function PromptBoxConnectorIcons({ 
  connectedAccounts,
  onOpenConnectors,
  maxVisible = 5
}: PromptBoxConnectorIconsProps) {
  // Get connected connectors with full info
  const connected = getConnectedConnectors(connectedAccounts);
  
  // Sort by priority
  const sorted = [...connected].sort((a, b) => 
    (a.ui?.priority || 999) - (b.ui?.priority || 999)
  );

  // Limit visible icons
  const visible = sorted.slice(0, maxVisible);
  const remaining = sorted.length - maxVisible;

  if (connected.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {visible.map((connector, index) => (
        <motion.div
          key={connector.id}
          initial={{ opacity: 0, scale: 0.8, x: -10 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          whileHover={{ scale: 1.1 }}
          className="relative group"
        >
          {/* Icon Button */}
          <button
            onClick={onOpenConnectors}
            className="w-8 h-8 rounded-lg flex items-center justify-center 
                       transition-all hover:ring-2 hover:ring-offset-2 hover:ring-offset-[#1a1a1a]"
            style={{ 
              backgroundColor: `${connector.color}15`,
              '--hover-ring-color': connector.color
            } as React.CSSProperties}
          >
            <img
              src={connector.icon}
              alt={connector.name}
              className="w-4 h-4"
              onError={(e) => {
                // Fallback
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </button>

          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 
                          opacity-0 group-hover:opacity-100 transition-opacity
                          pointer-events-none z-50">
            <div className="bg-neutral-100 dark:bg-gray-800 text-black dark:text-white text-xs px-2 py-1 rounded-lg
                            whitespace-nowrap shadow-lg border border-gray-700">
              {connector.name}
              {connector.email && (
                <span className="block text-neutral-600 dark:text-gray-400">{connector.email}</span>
              )}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 
                            border-4 border-transparent border-t-gray-800" />
          </div>
        </motion.div>
      ))}

      {/* Show remaining count */}
      {remaining > 0 && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={onOpenConnectors}
          className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-gray-800 flex items-center justify-center
                     text-xs font-medium text-neutral-600 dark:text-gray-400 hover:bg-gray-700
                     transition-colors"
        >
          +{remaining}
        </motion.button>
      )}

      {/* Add More Button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={onOpenConnectors}
        className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-gray-800 flex items-center justify-center
                   text-neutral-600 dark:text-gray-400 hover:bg-gray-700 hover:text-black dark:text-white
                   transition-all ml-1"
        title="Manage connections"
      >
        <Plus className="w-4 h-4" />
      </motion.button>
    </div>
  );
}

/**
 * Compact version for smaller spaces
 */
export function PromptBoxConnectorIconsCompact({
  connectedAccounts,
  onOpenConnectors
}: PromptBoxConnectorIconsProps) {
  const connected = getConnectedConnectors(connectedAccounts);

  if (connected.length === 0) {
    return (
      <button
        onClick={onOpenConnectors}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                   bg-neutral-100 dark:bg-gray-800/50 text-neutral-600 dark:text-gray-400 hover:bg-neutral-100 dark:bg-gray-800 hover:text-black dark:text-white
                   transition-colors text-sm"
      >
        <Plus className="w-4 h-4" />
        Connect
      </button>
    );
  }

  // Show just first 2 icons + count
  const firstTwo = connected.slice(0, 2);
  const remaining = connected.length - 2;

  return (
    <button
      onClick={onOpenConnectors}
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg
                 bg-neutral-100 dark:bg-gray-800/50 hover:bg-neutral-100 dark:bg-gray-800 transition-colors"
    >
      {firstTwo.map((connector: { id: string; icon: string; name: string; color: string }) => (
        <motion.div
          key={connector.id}
          title={connector.name}
          whileHover={{ scale: 1.25, y: -2 }}
          whileTap={{ scale: 1.1 }}
          className="w-5 h-5 rounded flex items-center justify-center cursor-pointer transition-shadow hover:shadow-md"
          style={{ backgroundColor: `${connector.color}20` }}
        >
          <img
            src={connector.icon}
            alt={connector.name}
            className="w-3 h-3"
          />
        </motion.div>
      ))}
      {remaining > 0 && (
        <span className="text-xs text-neutral-600 dark:text-gray-400 font-medium">
          +{remaining}
        </span>
      )}
    </button>
  );
}

export default PromptBoxConnectorIcons;
