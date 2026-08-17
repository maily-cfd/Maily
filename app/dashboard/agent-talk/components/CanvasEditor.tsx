'use client';

/**
 * Canvas rich-text editor.
 *
 * WHY MARKDOWN IN / MARKDOWN OUT
 * Everything upstream and downstream of this component speaks markdown: the
 * model writes it, ReactMarkdown renders it in read mode, and the .docx / PDF
 * exporters parse it. So the editor serialises back to markdown rather than
 * keeping HTML — a WYSIWYG that stored HTML would need lossy conversion at
 * BOTH ends, and every round-trip through the model would degrade the document.
 * tiptap-markdown gives us a real WYSIWYG surface over that same markdown.
 *
 * The old editor was a bare <textarea> of raw markdown: the user edited
 * asterisks and hash marks by hand, with no way to see what they were making
 * until they stopped typing.
 */

import { useEffect } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import {
  Undo2, Redo2, Bold, Italic, Strikethrough, Code2,
  List, ListOrdered, Quote, Minus, Heading1, Heading2, Heading3,
  MessageSquarePlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CanvasEditorProps {
  /** Markdown source. */
  value: string;
  /** Fires with markdown on every change. */
  onChange: (markdown: string) => void;
  /**
   * Fires when the user clicks "Add to chat" on a text selection. Receives the
   * selected text as MARKDOWN (not plain text) so formatting the user can see
   * — bold, list structure, headings — survives into the prompt. Omit to hide
   * the affordance entirely rather than render a button that does nothing.
   */
  onAddSelectionToChat?: (selectedMarkdown: string) => void;
}

export function CanvasEditor({ value, onChange, onAddSelectionToChat }: CanvasEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // The doc supplies its own H1 as the title; allowing H4-H6 in a
        // two-page brief just creates levels nobody can tell apart.
        heading: { levels: [1, 2, 3] },
      }),
      Markdown.configure({
        html: false,          // never let raw HTML into a doc we re-serialise
        breaks: true,         // a single newline is a line break, as users expect
        transformPastedText: true,  // pasting markdown produces formatting, not literal asterisks
      }),
    ],
    content: value || '',
    // REQUIRED in Next.js: without it TipTap renders during SSR and the
    // client hydration mismatches, which blanks the editor on first paint.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // Typography matches the read-mode renderer exactly, so toggling edit
        // doesn't reflow the document under the user's cursor.
        class: 'canvas-prose focus:outline-none min-h-[300px]',
      },
    },
    onUpdate: ({ editor }) => {
      onChange((editor.storage as any).markdown.getMarkdown());
    },
  });

  // Adopt external changes (a re-generated doc) WITHOUT stomping the user's
  // in-progress edit: only reset when the incoming markdown actually differs
  // from what the editor already holds.
  useEffect(() => {
    if (!editor) return;
    const current = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
    if (value !== current) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) {
    return <div className="h-[300px] animate-pulse rounded-xl bg-boult-surface" />;
  }

  return (
    <div className="flex flex-col min-h-0">
      <Toolbar editor={editor} />

      {/* Selection → chat. Only mounted when the parent supplied a handler, so
          there is never a visible button that silently does nothing. */}
      {onAddSelectionToChat && (
        <BubbleMenu
          editor={editor}
          // Empty selections fire this too (a plain cursor click). Without the
          // emptiness guard the bubble would flash on every click in the doc.
          shouldShow={({ editor, from, to }) => from !== to && !editor.state.selection.empty}
          options={{ placement: 'top', offset: 8 }}
        >
          <button
            type="button"
            // Same reason as the toolbar buttons: a plain onClick blurs the
            // editor first and collapses the selection, so by the time the
            // handler ran there would be nothing left to extract.
            onMouseDown={(e) => {
              e.preventDefault();
              const { from, to } = editor.state.selection;
              if (from === to) return;

              // Serialise the SLICE as markdown rather than using
              // state.doc.textBetween (plain text). A selected bullet list
              // arrives as a real list, bold stays bold — which matters
              // because the model is being asked to reason about this text
              // and formatting often carries the meaning.
              let selected = '';
              try {
                const slice = editor.state.selection.content();
                selected = (editor.storage as any).markdown.serializer
                  .serialize(slice.content)
                  .trim();
              } catch {
                // Serializer can throw on an unusual partial-node slice.
                // Plain text is a lossy but correct fallback — better than
                // dropping the interaction on the floor.
                selected = editor.state.doc.textBetween(from, to, '\n').trim();
              }
              if (!selected) return;
              onAddSelectionToChat(selected);
            }}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-boult-border bg-boult-elevated text-boult-fg text-[12.5px] font-medium shadow-lg hover:bg-boult-surface transition-colors whitespace-nowrap"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            Add to chat
          </button>
        </BubbleMenu>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    // Breaks out of the content's px-7/py-6 so it sits flush under the header,
    // edge to edge, and sticks there while the document scrolls. Wraps to a
    // second row on a narrow panel rather than clipping buttons off the end.
    <div className="sticky -top-6 z-10 -mx-7 -mt-6 mb-7 flex flex-wrap items-center gap-0.5 px-5 py-2.5 bg-boult-bg/95 backdrop-blur border-b border-boult-border">
      <Btn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} label="Undo"><Undo2 className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} label="Redo"><Redo2 className="w-4 h-4" /></Btn>

      <Sep />

      {([1, 2, 3] as const).map(level => (
        <Btn
          key={level}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          active={editor.isActive('heading', { level })}
          label={`Heading ${level}`}
        >
          {level === 1 ? <Heading1 className="w-4 h-4" /> : level === 2 ? <Heading2 className="w-4 h-4" /> : <Heading3 className="w-4 h-4" />}
        </Btn>
      ))}

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} label="Bold"><Bold className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} label="Italic"><Italic className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} label="Strikethrough"><Strikethrough className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} label="Inline code"><Code2 className="w-4 h-4" /></Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} label="Bullet list"><List className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} label="Numbered list"><ListOrdered className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} label="Quote"><Quote className="w-4 h-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} label="Divider"><Minus className="w-4 h-4" /></Btn>
    </div>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-boult-border mx-1.5 shrink-0" />;
}

function Btn({
  onClick, children, active = false, disabled = false, label,
}: {
  onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      // onMouseDown + preventDefault: a plain onClick moves focus out of the
      // editor first, which collapses the selection — so "select a word, press
      // Bold" would bold nothing.
      onMouseDown={(e) => { e.preventDefault(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0',
        active
          ? 'bg-boult-fg text-boult-fg-inverse'
          : 'text-boult-fg-tertiary hover:text-boult-fg hover:bg-boult-surface',
        disabled && 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-boult-fg-tertiary'
      )}
    >
      {children}
    </button>
  );
}
