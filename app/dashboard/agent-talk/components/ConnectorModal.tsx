/**
 * Connector Modal Component
 * 
 * Beautiful modal for managing connections like Manus AI.
 * Shows all available connectors with their status.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Search, 
  CheckCircle2, 
  Plus, 
  Link2,
  ChevronRight
} from 'lucide-react';
import { 
  CONNECTOR_CATEGORIES,
  CONNECTOR_STATUS,
  getAllConnectors,
  getConnectedConnectors
} from '@/lib/boult-connector-registry';
import { ConnectorDetailModal } from './ConnectorDetailModal';

interface Connector {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  ui: {
    showInBanner: boolean;
    priority: number;
  };
}

interface ConnectedAccount {
  id: string;
  connectorId: string;
  status: string;
  email?: string;
  name?: string;
  connectedAt?: string;
  workspace?: string;
}

interface ConnectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectedAccounts: ConnectedAccount[];
  onConnect: (connectorId: string) => void;
  onDisconnect: (accountId: string) => void;
  onReconfigure?: (connectorId: string) => void;
  isConnecting?: string | null;
}

const categoryLabels: Record<string, string> = {
  [CONNECTOR_CATEGORIES.CALENDAR]: 'Calendar',
  [CONNECTOR_CATEGORIES.PRODUCTIVITY]: 'Productivity',
  [CONNECTOR_CATEGORIES.TASKS]: 'Tasks'
};

export function ConnectorModal({
  isOpen,
  onClose,
  connectedAccounts,
  onConnect,
  onDisconnect,
  onReconfigure,
  isConnecting
}: ConnectorModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'apps' | 'connected'>('apps');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedCategory(null);
      setSelectedConnector(null);
      setIsDetailOpen(false);
    }
  }, [isOpen]);

  // Get all connectors
  const allConnectors = getAllConnectors();

  // Get connected accounts with connector info
  const connectedWithInfo = getConnectedConnectors(connectedAccounts);

  // Filter connectors based on search and category
  const filteredConnectors = allConnectors.filter(connector => {
    const matchesSearch = 
      connector.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      connector.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = !selectedCategory || connector.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Group connectors by category
  const connectorsByCategory = filteredConnectors.reduce((acc, connector) => {
    if (!acc[connector.category]) {
      acc[connector.category] = [];
    }
    acc[connector.category].push(connector);
    return acc;
  }, {} as Record<string, Connector[]>);

  // Check if connector is connected
  const isConnected = (connectorId: string) => {
    return connectedAccounts.some(
      account => account.connectorId === connectorId && 
                 account.status === CONNECTOR_STATUS.CONNECTED
    );
  };

  // Get account for connected connector
  const getAccount = (connectorId: string) => {
    return connectedAccounts.find(
      a => a.connectorId === connectorId && 
           a.status === CONNECTOR_STATUS.CONNECTED
    );
  };

  // Handle connector click - open detail modal
  const handleConnectorClick = (connector: Connector) => {
    setSelectedConnector(connector);
    setIsDetailOpen(true);
  };

  // Handle connect from detail modal
  const handleConnect = () => {
    if (selectedConnector) {
      onConnect(selectedConnector.id);
    }
  };

  // Handle disconnect from detail modal
  const handleDisconnect = () => {
    const account = selectedConnector ? getAccount(selectedConnector.id) : null;
    if (account) {
      onDisconnect(account.id);
    }
  };

  // Handle try it out — close the modal so the user is back in the chat
  // and can immediately use the connector. (Was a console.log no-op.)
  const handleTryItOut = () => {
    onClose();
  };

  // Handle manage / configure — re-initiates the OAuth flow for the
  // selected connector so the user can grant additional scopes or refresh
  // expired tokens. (Was a console.log no-op.)
  const handleManage = () => {
    if (selectedConnector && onReconfigure) {
      onReconfigure(selectedConnector.id);
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-50"
            />

            {/* Modal */}
            <motion.div
              className="fixed inset-4 md:inset-y-10 md:inset-x-8 lg:inset-y-16 lg:inset-x-48 bg-boult-bg-elevated rounded-[2rem] z-50 
                         flex flex-col overflow-hidden shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)] border border-boult-border"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-8 pb-6 border-b border-boult-border">
                <div>
                  <h2 className="text-2xl font-semibold text-boult-fg">Connectors</h2>
                  <p className="text-boult-fg-secondary text-sm mt-1">
                    Connect your tools to enable AI-powered workflows
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-boult-surface rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-boult-fg-muted" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 p-2 px-8 border-b border-boult-border">
                <button
                  onClick={() => setActiveTab('apps')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'apps'
                      ? 'bg-boult-surface text-boult-fg'
                      : 'text-boult-fg-secondary hover:text-boult-fg hover:bg-boult-surface'
                  }`}
                >
                  Apps
                </button>
                <button
                  onClick={() => setActiveTab('connected')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    activeTab === 'connected'
                      ? 'bg-boult-surface text-boult-fg'
                      : 'text-boult-fg-secondary hover:text-boult-fg hover:bg-boult-surface'
                  }`}
                >
                  Connected
                  {connectedWithInfo.length > 0 && (
                    <span className="bg-emerald-500 text-black dark:text-white text-xs px-2 py-0.5 rounded-full">
                      {connectedWithInfo.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-hidden flex">
                {activeTab === 'apps' ? (
                  <>
                    {/* Sidebar - Categories */}
                    <div className="w-72 border-r border-boult-border p-6 overflow-y-auto hidden md:block bg-boult-bg-elevated/40">
                      <button
                        onClick={() => setSelectedCategory(null)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-1 ${
                          !selectedCategory
                            ? 'bg-boult-fg text-boult-fg-inverse font-bold shadow-lg'
                            : 'text-boult-fg-secondary hover:text-boult-fg hover:bg-boult-surface'
                        }`}
                      >
                        All Apps
                      </button>
                      
                      {Object.entries(categoryLabels).map(([key, label]) => {
                        const count = allConnectors.filter(c => c.category === key).length;
                        return (
                          <button
                            key={key}
                            onClick={() => setSelectedCategory(key)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-1 flex items-center justify-between ${
                              selectedCategory === key
                                ? 'bg-boult-fg text-boult-fg-inverse font-bold shadow-lg'
                                : 'text-boult-fg-secondary hover:text-boult-fg hover:bg-boult-surface'
                            }`}
                          >
                            <span>{label}</span>
                            <span className="text-xs text-boult-fg-muted">{count}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 relative overflow-hidden">
                      {/* Fade Overlays */}
                      <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-boult-bg-elevated to-transparent z-10 pointer-events-none" />
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-boult-bg-elevated to-transparent z-10 pointer-events-none" />
                      
                      <div className="h-full overflow-y-auto p-10 py-12 custom-scrollbar">
                      {/* Search */}
                      <div className="relative mb-6">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-boult-fg-muted" />
                        <input
                          type="text"
                          placeholder="Search connectors..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-boult-surface border border-boult-border rounded-2xl pl-12 pr-4 py-4 
                                     text-boult-fg placeholder-boult-fg-muted focus:outline-none focus:border-boult-fg-tertiary
                                     transition-all"
                        />
                      </div>

                      {/* Connectors Grid - Clickable cards */}
                      {Object.entries(connectorsByCategory).map(([category, connectors]) => (
                        <div key={category} className="mb-8">
                          <h3 className="text-sm font-medium text-boult-fg-secondary uppercase tracking-wider mb-4">
                            {categoryLabels[category] || category}
                          </h3>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {connectors.map((connector) => {
                              const connected = isConnected(connector.id);

                              return (
                                <motion.button
                                  key={connector.id}
                                  onClick={() => handleConnectorClick(connector)}
                                  whileHover={{ scale: 1.01 }}
                                  className={`bg-boult-surface/40 border rounded-[1.5rem] p-6 flex items-center gap-6 
                                             transition-all text-left w-full group ${
                                    connected
                                      ? 'border-emerald-500/30 bg-emerald-500/5'
                                      : 'border-boult-border hover:border-boult-divider hover:bg-boult-surface/80'
                                  }`}
                                >
                                  {/* Icon */}
                                  <div
                                    className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm transition-transform group-hover:scale-110"
                                    style={{ backgroundColor: `${connector.color}15` }}
                                  >
                                    <img
                                      src={connector.icon}
                                      alt={connector.name}
                                      className="w-6 h-6"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = '/connectors/placeholder.svg';
                                      }}
                                    />
                                  </div>

                                  {/* Info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h4 className="text-lg font-bold text-boult-fg truncate">
                                        {connector.name}
                                      </h4>
                                      {connected && (
                                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                      )}
                                    </div>
                                    <p className="text-boult-fg-secondary text-sm mt-1 line-clamp-2 leading-relaxed">
                                      {connector.description}
                                    </p>
                                  </div>

                                  {/* Arrow */}
                                  <ChevronRight className="w-5 h-5 text-boult-fg-muted flex-shrink-0" />
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* Empty State */}
                      {filteredConnectors.length === 0 && (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-boult-surface rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Search className="w-8 h-8 text-boult-fg-muted" />
                          </div>
                          <h3 className="text-lg font-medium text-boult-fg mb-2">
                            No connectors found
                          </h3>
                          <p className="text-boult-fg-muted">
                            Try adjusting your search or category filter
                          </p>
                        </div>
                      )}
                      </div>
                    </div>
                  </>
                ) : (
                  // Connected Tab
                  <div className="flex-1 relative overflow-hidden">
                    {/* Fade Overlays */}
                    <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-boult-bg-elevated to-transparent z-10 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-boult-bg-elevated to-transparent z-10 pointer-events-none" />
                    
                    <div className="h-full overflow-y-auto p-10 py-12 custom-scrollbar">
                    {connectedWithInfo.length > 0 ? (
                      <div className="space-y-4">
                        {connectedWithInfo.map((connection: any) => (
                          <motion.button
                            key={connection.accountId}
                            onClick={() => {
                              const connector = allConnectors.find(c => c.id === connection.connectorId);
                              if (connector) handleConnectorClick(connector);
                            }}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full bg-boult-surface/40 border border-emerald-500/30 rounded-[1.5rem] p-6 
                                       flex items-center gap-6 text-left hover:bg-boult-surface transition-all group"
                          >
                            <div
                              className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm transition-transform group-hover:scale-110"
                              style={{ backgroundColor: `${connection.color}15` }}
                            >
                              <img
                                src={connection.icon}
                                alt={connection.name}
                                className="w-6 h-6"
                              />
                            </div>
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-lg font-bold text-boult-fg">
                                  {connection.name}
                                </h4>
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                              </div>
                              {connection.email && (
                                <p className="text-boult-fg-secondary text-sm mt-1">{connection.email}</p>
                              )}
                              <p className="text-emerald-500/60 text-xs mt-1 font-medium">
                                Connected {new Date(connection.connectedAt || '').toLocaleDateString()}
                              </p>
                            </div>
                            
                            <ChevronRight className="w-5 h-5 text-boult-fg-muted" />
                          </motion.button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 bg-boult-surface rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <Link2 className="w-8 h-8 text-boult-fg-muted" />
                        </div>
                        <h3 className="text-lg font-medium text-boult-fg mb-2">
                          No connected accounts
                        </h3>
                        <p className="text-boult-fg-muted mb-6">
                          Connect your tools to enable AI-powered workflows
                        </p>
                        <button
                          onClick={() => setActiveTab('apps')}
                          className="px-6 py-3 bg-boult-fg text-boult-fg-inverse rounded-xl font-medium
                                     hover:opacity-90 transition-colors"
                        >
                          Browse Connectors
                        </button>
                      </div>
                    )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Connector Detail Modal */}
      <ConnectorDetailModal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        connector={selectedConnector}
        connectedAccount={selectedConnector ? getAccount(selectedConnector.id) : null}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onTryItOut={handleTryItOut}
        onManage={handleManage}
        isConnecting={isConnecting === selectedConnector?.id}
      />
    </>
  );
}

export default ConnectorModal;
