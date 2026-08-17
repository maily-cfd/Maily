"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, ChevronRight, ChevronLeft, MessageSquare, ShieldAlert } from "lucide-react";
import { Button } from "./button";
import { toast } from "sonner";

interface CancellationFlowProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reasons: string[], feedback: string) => Promise<void>;
  subscriptionEndsAt?: string;
}

const STEPS = [
  { id: "reasons", title: "Why are you leaving?" },
  { id: "feedback", title: "How can we improve?" },
  { id: "confirm", title: "Final Confirmation" },
];

const REASONS = [
  { id: "price", label: "Too expensive", icon: "💰" },
  { id: "features", label: "Missing features", icon: "✨" },
  { id: "bugs", label: "Too many bugs", icon: "🐛" },
  { id: "complexity", label: "Too complex", icon: "🧩" },
  { id: "other", label: "Found alternative", icon: "🔄" },
  { id: "none", label: "No longer need it", icon: "🛑" },
];

export function CancellationFlow({
  isOpen,
  onClose,
  onConfirm,
  subscriptionEndsAt,
}: CancellationFlowProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [revocationText, setRevocationText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReasonToggle = (id: string) => {
    setSelectedReasons((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFinalConfirm = async () => {
    if (revocationText !== "Revoke plan") {
      toast.error('Please type "Revoke plan" exactly to proceed');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(selectedReasons, feedback);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-[500px] bg-white dark:bg-boult-surface-hover border border-neutral-200 dark:border-boult-border rounded-[32px] overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              currentStep === 2 ? 'bg-red-500/20 text-red-500' : 'bg-black/5 dark:bg-white/5 text-neutral-500 dark:text-neutral-400'
            }`}>
              {currentStep + 1}
            </div>
            <h2 className="text-xl font-serif text-black dark:text-white">{STEPS[currentStep].title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-black/5 dark:bg-white/5 text-neutral-600 dark:text-neutral-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-8 pb-8">
          <AnimatePresence mode="wait">
            {currentStep === 0 && (
              <motion.div
                key="step-reasons"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6 pt-4"
              >
                <p className="text-neutral-500 dark:text-neutral-400 text-[15px]">
                  Select the reasons that influenced your decision to cancel.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {REASONS.map((reason) => (
                    <button
                      key={reason.id}
                      onClick={() => handleReasonToggle(reason.id)}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border transition-all duration-300 gap-2 ${
                        selectedReasons.includes(reason.id)
                          ? "bg-black/10 dark:bg-white/10 border-white/20 text-black dark:text-white shadow-lg scale-[1.02]"
                          : "bg-black/5 dark:bg-white/5 border-transparent text-neutral-600 dark:text-neutral-500 hover:bg-black/[0.08] dark:hover:bg-white/[0.08]"
                      }`}
                    >
                      <span className="text-2xl">{reason.icon}</span>
                      <span className="text-sm font-medium">{reason.label}</span>
                    </button>
                  ))}
                </div>
                <Button
                  onClick={handleNext}
                  disabled={selectedReasons.length === 0}
                  className="w-full bg-white text-black hover:bg-neutral-200 h-12 rounded-2xl font-bold mt-4"
                >
                  Continue
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </motion.div>
            )}

            {currentStep === 1 && (
              <motion.div
                key="step-feedback"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6 pt-4"
              >
                <div className="flex items-center gap-3 text-amber-500 bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                  <MessageSquare className="w-5 h-5 shrink-0" />
                  <p className="text-sm">
                    Your feedback will be sent directly to our founders to help us improve.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-900 dark:text-neutral-300">
                    Tell us more (Optional)
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What could we have done better?"
                    className="w-full bg-black/5 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-2xl p-4 text-black dark:text-white min-h-[150px] focus:ring-2 focus:ring-white/20 transition-all outline-none resize-none"
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="ghost"
                    onClick={handleBack}
                    className="flex-1 text-neutral-600 hover:text-black dark:text-white hover:bg-black/5 dark:bg-white/5 h-12 rounded-2xl"
                  >
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <Button
                    onClick={handleNext}
                    className="flex-1 bg-white text-black hover:bg-neutral-200 h-12 rounded-2xl font-bold"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="step-confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6 pt-4"
              >
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-3 text-red-500">
                    <ShieldAlert className="w-6 h-6" />
                    <h4 className="font-bold">Subscription Revocation</h4>
                  </div>
                  <p className="text-[13px] text-red-100/70 leading-relaxed">
                    By proceeding, your access to <span className="font-bold text-black dark:text-white">Unlimited AI Compute</span>, <span className="font-bold text-black dark:text-white">Priority Processing</span>, and <span className="font-bold text-black dark:text-white">Style Mimicking</span> will be scheduled for revocation.
                  </p>
                </div>

                <div className="space-y-4">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
                    Type <span className="text-black dark:text-white font-mono font-bold">Revoke plan</span> below to confirm.
                  </p>
                  <input
                    type="text"
                    value={revocationText}
                    onChange={(e) => setRevocationText(e.target.value)}
                    placeholder="Revoke plan"
                    className="w-full bg-red-500/5 border border-red-500/20 rounded-2xl px-4 py-3 text-center text-black dark:text-white placeholder:text-neutral-700 focus:ring-2 focus:ring-red-500/50 transition-all outline-none font-mono"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    onClick={handleFinalConfirm}
                    disabled={revocationText !== "Revoke plan" || isSubmitting}
                    className="w-full bg-red-500 hover:bg-red-600 text-black dark:text-white font-bold h-12 rounded-2xl shadow-lg shadow-red-500/20 disabled:opacity-50"
                  >
                    {isSubmitting ? "Processing..." : "Confirm & Revoke"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={onClose}
                    className="w-full text-neutral-600 hover:text-black dark:text-white h-10"
                  >
                    I changed my mind
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
