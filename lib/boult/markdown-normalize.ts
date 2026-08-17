/**
 * Document markdown normalisation — shared by plan mode AND canvas documents.
 *
 * WHY THIS IS ITS OWN MODULE
 * This logic used to live inside loop.ts and was called on exactly one path:
 * plan-mode's final text. Canvas documents (open_canvas / update_canvas) never
 * touched it, so the single most visible failure — a Steps section rendering as
 * a wall of raw JSON — was "fixed" for plans while still shipping in every
 * document written to the canvas.
 *
 * It cannot simply be exported from loop.ts and imported by tools.ts: loop.ts
 * already imports tools.ts, so that would be a circular import. Hence a leaf
 * module both can depend on.
 *
 * Free models routinely violate the formatting rules: numbered steps collapse
 * into one paragraph, headings run inline with surrounding prose, steps-JSON
 * arrives unfenced or fenced as ```json instead of ```boult-steps. None of the
 * rewrites below change the MEANING of the model's output — they only fix
 * presentation so the renderer can do its job.
 */

export function normalizeDocumentMarkdown(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return s;

  // 1. Params-dump pattern: ≥3 lines of bare `key: "value"` with no markdown
  // structure — the model dumped tool params instead of writing a document.
  // Wrap it so the user sees readable text rather than a JSON-ish mess.
  const paramLineRe = /^\s*[a-z_]+:\s*("[^"\n]*"|true|false|\d+|-?\d+(?:\.\d+)?)\s*$/i;
  const paramDumpLineCount = s.split(/\r?\n/).filter(l => paramLineRe.test(l)).length;
  const totalNonBlank = s.split(/\r?\n/).filter(l => l.trim()).length;
  if (paramDumpLineCount >= 3 && paramDumpLineCount / Math.max(1, totalNonBlank) > 0.5) {
    const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const narrativeBits = lines
      .filter(l => paramLineRe.test(l))
      .map(l => {
        const m = l.match(/^([a-z_]+):\s*(.+)$/i);
        if (!m) return null;
        const key = m[1].replace(/_/g, ' ');
        const val = m[2].replace(/^"|"$/g, '');
        return `${key}: ${val}`;
      })
      .filter(Boolean) as string[];
    s = [
      `# Plan`,
      '',
      `## Configuration`,
      '',
      ...narrativeBits.map(b => `- ${b}`),
      '',
      `## Note`,
      '',
      `_The model returned configuration values instead of a structured plan. The settings above are what would be applied — review them and re-prompt if you want a fuller breakdown._`,
    ].join('\n');
  }

  // 2. Retag steps-JSON fences the model left untagged (``` or ```json instead
  // of ```boult-steps). The renderer only rich-renders the boult-steps tag —
  // untagged blobs display as raw JSON, which IS the "gibberish steps" bug.
  s = s.replace(/```(?:json|javascript|js)?[ \t]*\n(\s*\{\s*"(?:title"\s*:\s*"[^"\n]*"\s*,\s*")?steps"\s*:)/g, '```boult-steps\n$1');

  // 3. Fence a completely bare steps-JSON blob (no ``` at all). The leading
  // `[ \t]*` matters: the model commonly indents the blob under its heading,
  // and without it an indented `{ "steps": …` never matches after \n.
  if (!/```boult-steps/.test(s)) {
    s = s.replace(
      /(^|\n)[ \t]*(\{\s*"steps"\s*:\s*\[[\s\S]*?\]\s*\})[ \t]*(\n|$)/,
      '$1```boult-steps\n$2\n```$3',
    );
  }

  // 4. Split inline-numbered list items: "1. Foo. 2. Bar" → one per line. Only
  // fires after sentence-end punctuation or 2+ spaces, never mid-prose.
  s = s.replace(/([.!?:;]\s+|\s{2,})(\d{1,2}\.\s+)/g, '$1\n$2');

  // 5. Ensure ## / ### headings have a blank line before them when not at the
  // very start — "... text. ## Heading" otherwise renders as a paragraph.
  s = s.replace(/(\S)(\n)(#{1,6}\s+)/g, '$1\n\n$3');

  // 6. Ensure --- separators have blank lines around them.
  s = s.replace(/([^\n])\n(---+)\n([^\n])/g, '$1\n\n$2\n\n$3');

  // 7. Collapse runs of 3+ newlines so we don't end up with monster gaps.
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}
