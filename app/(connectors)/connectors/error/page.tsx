/**
 * Connector Error Page
 * 
 * Shown when OAuth connection fails
 */

'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

function ConnectorErrorContent() {
  const searchParams = useSearchParams();
  
  const error = searchParams.get('error');
  const description = searchParams.get('description');

  const errorMessages: Record<string, string> = {
    'access_denied': 'You declined to authorize the connection',
    'invalid_request': 'Invalid OAuth request',
    'invalid_grant': 'Authorization code expired or invalid',
    'server_error': 'An error occurred on the provider server',
    'connection_failed': 'Failed to complete the connection',
    'invalid_state': 'Invalid session state',
    'popup_blocked': 'Popup was blocked by your browser'
  };

  const displayError = errorMessages[error || ''] || 'An unexpected error occurred';
  const displayDescription = description || 'Please try again or contact support if the issue persists';

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full text-center"
      >
        {/* Error Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring' }}
          className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <AlertCircle className="w-12 h-12 text-red-500" />
        </motion.div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-white mb-2">
          Connection Failed
        </h1>

        {/* Error Details */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6"
        >
          <p className="text-red-400 font-medium mb-1">{displayError}</p>
          <p className="text-gray-400 text-sm">{displayDescription}</p>
          {error && (
            <p className="text-gray-500 text-xs mt-2 font-mono">Error code: {error}</p>
          )}
        </motion.div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/dashboard/agent-talk"
            onClick={() => window.close()}
            className="flex items-center gap-2 px-6 py-3 bg-gray-800 text-white rounded-xl
                       font-medium hover:bg-gray-700 transition-colors w-full sm:w-auto"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </Link>
          
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl
                       font-medium hover:bg-gray-200 transition-colors w-full sm:w-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>

        {/* Help Text */}
        <p className="text-gray-500 text-sm mt-8">
          Need help?{' '}
          <a href="mailto:support@boult.com" className="text-blue-400 hover:underline">
            Contact Support
          </a>
        </p>
      </motion.div>
    </div>
  );
}

export default function ConnectorErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4"><p className="text-white">Loading...</p></div>}>
      <ConnectorErrorContent />
    </Suspense>
  );
}
