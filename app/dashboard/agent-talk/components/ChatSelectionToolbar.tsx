'use client';

/**
 * Floating "Add to chat" button for text selected in the chat transcript.
 *
 * WHY THIS IS NOT TipTap's BubbleMenu (which the Canvas uses)
 * The canvas is an editable TipTap document, so it gets BubbleMenu for free.
 * The chat transcript is plain rendered markdown — there is no editor instance
 * to hang a bubble menu off. So this uses the native Selection API: watch for a
 * real text selection inside the transcript and float a button above it.
 *
 * Rendered through a portal to document.body because the chat column sits under
 * framer-motion transforms, and a `position: fixed` child of a transformed
 * ancestor is positioned relative to that ancestor, not the viewport — the
 * button would land in the wrong place. The portal escapes the transform.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus } from 'lucide-react';

interface Props {
  /** The scroll container whose text is eligible. Selections outside it are ignored. */
  rootRef: React.RefObject<HTMLElement | null>;
  /** Receives the selected plain text when the user clicks the button. */
  onAdd: (text: string) => void;
}

interface Anchor { text: string; x: number; y: number; }

export function ChatSelectionToolbar({ rootRef, onAdd }: Props) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const readSelection = useCallback(() => {
    const root = rootRef.current;
    if (!root) return setAnchor(null);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setAnchor(null);

    const text = sel.toString().replace(/ /g, ' ').trim();
    // A stray double-click can select a single space; require real content.
    if (text.length < 2) return setAnchor(null);

    // Both ends of the selection must live inside the transcript, so selecting
    // the composer, the sidebar, or a code block's copy button never triggers.
    // Node.contains includes text nodes, so anchorNode/focusNode work directly.
    if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) {
      return setAnchor(null);
    }

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return setAnchor(null);

    setAnchor({
      text,
      // Centered above the selection, in viewport coords (fixed positioning).
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, [rootRef]);

  useEffect(() => {
    // mouseup finalizes a drag-select; a click that collapses the selection
    // fires mouseup too, which correctly clears the button via the guard above.
    const onMouseUp = (e: MouseEvent) => {
      // Clicking our own button must not re-read (and clear) the selection.
      if (btnRef.current?.contains(e.target as Node)) return;
      // Let the browser settle the selection before we read it.
      setTimeout(readSelection, 0);
    };
    // Any new keystroke or scroll invalidates the floating position.
    const dismiss = () => setAnchor(null);

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', dismiss);
    // Capture phase so a scroll anywhere in the ancestor chain dismisses.
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [readSelection]);

  if (!mounted || !anchor) return null;

  return createPortal(
    <div
      ref={btnRef}
      style={{
        position: 'fixed',
        left: anchor.x,
        top: anchor.y - 8,
        transform: 'translate(-50%, -100%)',
        zIndex: 60,
      }}
    >
      <button
        type="button"
        // onMouseDown + preventDefault, NOT onClick: a plain click blurs the
        // document and collapses the selection before the handler runs, and the
        // global mouseup would unmount this button first — the click would never
        // land. preventDefault keeps the selection intact through the press.
        onMouseDown={(e) => {
          e.preventDefault();
          const text = anchor.text;
          setAnchor(null);
          window.getSelection()?.removeAllRanges();
          onAdd(text);
        }}
        className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-boult-border bg-boult-elevated text-boult-fg text-[12.5px] font-medium shadow-lg hover:bg-boult-surface transition-colors whitespace-nowrap"
      >
        <MessageSquarePlus className="w-3.5 h-3.5" />
        Add to chat
      </button>
    </div>,
    document.body,
  );
}
