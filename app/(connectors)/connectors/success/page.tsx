/**
 * Connector Success Page
 * 
 * Shown after successful OAuth connection
 */

'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, Sparkles } from 'lucide-react';
import { getConnector } from '@/lib/boult-connector-registry';

function ConnectorSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  const connectorId = searchParams.get('connector');
  const email = searchParams.get('email');
  
  const connector = connectorId ? getConnector(connectorId) : null;

  // Auto-redirect countdown
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      // Redirect to agent-talk
      window.close(); // Close popup if opened as popup
      router.push('/dashboard/agent-talk');
    }
  }, [countdown, router]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full text-center"
      >
        {/* Success Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring' }}
          className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        </motion.div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-white mb-2">
          Successfully Connected!
        </h1>

        {/* Connector Info */}
        {connector && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-3 mb-4"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${connector.color}20` }}
            >
              <img
                src={connector.icon}
                alt={connector.name}
                className="w-5 h-5"
              />
            </div>
            <span className="text-white font-medium">{connector.name}</span>
          </motion.div>
        )}

        {email && (
          <p className="text-gray-400 mb-6">{email}</p>
        )}

        {/* What You Can Do */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 mb-6"
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-medium text-gray-300">AI-Powered Actions</span>
          </div>
          <ul className="text-left text-sm text-gray-400 space-y-2">
            {connector?.actions.slice(0, 4).map((action: string, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                {action.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Countdown / Close Button */}
        <div className="flex flex-col items-center gap-4">
          <p className="text-gray-500 text-sm">
            This window will close in {countdown} seconds
          </p>
          
          <button
            onClick={() => {
              window.close();
              router.push('/dashboard/agent-talk');
            }}
            className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl
                       font-medium hover:bg-gray-200 transition-colors"
          >
            Continue to Boult
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function ConnectorSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 text-white">Loading...</div>}>
      <ConnectorSuccessContent />
    </Suspense>
  );
}
