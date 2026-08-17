"use client";

import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CancellationConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  subscriptionEndsAt?: string;
  daysRemaining?: number;
}

export function CancellationConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  subscriptionEndsAt,
  daysRemaining
}: CancellationConfirmationDialogProps) {
  const [showReasonDialog, setShowReasonDialog] = useState(false);

  const handleInitialConfirm = () => {
    setShowReasonDialog(true);
  };

  const handleFinalConfirm = () => {
    onConfirm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* First Confirmation Dialog */}
      {!showReasonDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <h2 className="text-xl font-semibold text-[var(--settings-text)]">
                  Cancel Subscription?
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-[var(--settings-text-secondary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-[var(--settings-text-secondary)] leading-relaxed">
                Are you sure you want to cancel your subscription? You'll continue to have access 
                to all features until the end of your current billing period.
              </p>

              {daysRemaining !== undefined && (
                <div className="p-3 rounded-lg bg-white/5 border border-[var(--glass-border)]">
                  <p className="text-sm text-[var(--settings-text-secondary)]">
                    <span className="font-medium text-[var(--settings-text)]">{daysRemaining} days</span> remaining 
                    in your current billing period
                  </p>
                  {subscriptionEndsAt && (
                    <p className="text-xs text-[var(--settings-text-tertiary)] mt-1">
                      Access ends: {new Date(subscriptionEndsAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 border-[var(--glass-border)] text-[var(--settings-text)] hover:bg-white/10"
                >
                  Keep Subscription
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleInitialConfirm}
                  className="flex-1"
                >
                  Continue Cancellation
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reason Collection Dialog */}
      {showReasonDialog && (
        <CancellationReasonDialog
          isOpen={showReasonDialog}
          onClose={() => {
            setShowReasonDialog(false);
            onClose();
          }}
          onConfirm={handleFinalConfirm}
          onBack={() => setShowReasonDialog(false)}
        />
      )}
    </>
  );
}

interface CancellationReason {
  id: string;
  text: string;
}

const CANCELLATION_REASONS: CancellationReason[] = [
  { id: "too_expensive", text: "Too expensive" },
  { id: "missing_features", text: "Missing features I need" },
  { id: "technical_issues", text: "Technical issues or bugs" },
  { id: "found_alternative", text: "Found an alternative solution" },
  { id: "not_using_enough", text: "Not using it enough to justify cost" },
  { id: "temporary_pause", text: "Need to pause temporarily" },
  { id: "complex_interface", text: "Interface is too complex" },
  { id: "other", text: "Other reason" }
];

interface CancellationReasonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reasons: string[], feedback: string) => void;
  onBack: () => void;
}

function CancellationReasonDialog({
  isOpen,
  onClose,
  onConfirm,
  onBack
}: CancellationReasonDialogProps) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");

  const handleReasonToggle = (reasonId: string) => {
    setSelectedReasons(prev => 
      prev.includes(reasonId) 
        ? prev.filter(r => r !== reasonId)
        : [...prev, reasonId]
    );
  };

  const handleConfirm = () => {
    if (selectedReasons.length === 0) {
      // Show error or require at least one reason
      return;
    }
    onConfirm(selectedReasons, feedback);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <span className="text-lg">🤔</span>
            </div>
            <h2 className="text-xl font-semibold text-[var(--settings-text)]">
              Help us improve
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-[var(--settings-text-secondary)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-[var(--settings-text-secondary)] leading-relaxed">
            We're sorry to see you go! Your feedback helps us improve Maily for everyone.
          </p>

          <div>
            <label className="block text-sm font-medium text-[var(--settings-text)] mb-3">
              Why are you cancelling? (Select all that apply)
            </label>
            <div className="space-y-2">
              {CANCELLATION_REASONS.map(reason => (
                <label
                  key={reason.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-[var(--glass-border)] hover:bg-white/10 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedReasons.includes(reason.id)}
                    onChange={() => handleReasonToggle(reason.id)}
                    className="w-4 h-4 rounded border-[var(--glass-border)] bg-white/10 text-[var(--settings-accent)] focus:ring-[var(--settings-accent)]"
                  />
                  <span className="text-[var(--settings-text)]">{reason.text}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--settings-text)] mb-2">
              Additional feedback (optional)
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell us more about your experience..."
              rows={3}
              className="w-full p-3 rounded-lg bg-white/5 border border-[var(--glass-border)] text-[var(--settings-text)] placeholder:text-[var(--settings-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--settings-accent)] resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onBack}
              className="flex-1 border-[var(--glass-border)] text-[var(--settings-text)] hover:bg-white/10"
            >
              Back
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={selectedReasons.length === 0}
              className="flex-1"
            >
              Confirm Cancellation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
