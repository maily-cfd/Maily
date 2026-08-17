/**
 * Distill a stored agent-run report (which is the first ~450 chars of the full
 * markdown briefing) into a clean one-line preview for compact UI cards.
 *
 * Without this, cards render the raw markdown — "# Nightly Inbox Scan —
 * Executive Briefing --- ## Run details - 📧 Inbox VA: ran · 1 tool call..." —
 * which is what the user sees as "garbled" in the Recent-runs list.
 *
 * Strategy: the committee aggregator (lib/boult/multi-va/aggregator.ts) writes a
 * plain headline sentence as the very first line, BEFORE the "# <agent> —
 * Executive Briefing" heading. When present, that headline is the best preview.
 * Otherwise we flatten the markdown structure to plain prose so it never shows
 * raw "#", "---", "**", or bullet markers.
 */
export function cleanRunSummary(raw: string | null | undefined, maxLen = 240): string {
  if (!raw) return '';

  // Prefer the aggregator's leading headline sentence (first non-empty line that
  // isn't itself a heading / rule / bullet).
  const firstLine = raw.split('\n').map(l => l.trim()).find(Boolean) || '';
  if (
    firstLine
    && !firstLine.startsWith('#')
    && !firstLine.startsWith('-')
    && !firstLine.startsWith('_')
    && firstLine.length >= 12
  ) {
    return firstLine.replace(/\*\*/g, '').replace(/[*_`]/g, '').slice(0, maxLen);
  }

  // Fallback: flatten the whole report to prose.
  return raw
    .replace(/^#{1,6}\s+/gm, '')        // heading markers
    .replace(/^\s*[-*•]\s+/gm, '')      // bullet markers
    .replace(/^\s*[-=]{3,}\s*$/gm, '')  // horizontal rules
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
    .replace(/[*_`#]/g, '')             // stray markup
    .replace(/\s*\n\s*/g, ' · ')        // newlines → middots
    .replace(/(\s·\s){2,}/g, ' · ')     // collapse repeated separators
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}
