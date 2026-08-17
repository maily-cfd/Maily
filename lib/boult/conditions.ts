/**
 * Trigger condition evaluator — shared by event/condition agents (reactive-poll)
 * and (later) worklist filtering. A condition list is ANDed together; an empty
 * list matches everything (so "event" agents with no conditions fire on any new
 * item in their source).
 *
 * Reuses the SAME keyword vocabulary as the worklist scorer
 * (lib/boult/autonomy.ts) so "revenue"/"scheduling" mean one thing everywhere.
 */
import { REVENUE_KEYWORDS, SCHEDULING_KEYWORDS } from './autonomy';

export type ConditionField =
  | 'sender'     // full email address
  | 'domain'     // sender domain (after @)
  | 'subject'
  | 'keyword'    // matches subject+snippet+label text, or special tokens 'revenue'|'scheduling'
  | 'category'   // gmail category-ish bucket if available
  | 'amount'     // dollar amount parsed from text
  | 'age_days'   // age of the item in days
  | 'attendee';  // calendar attendee email

export type ConditionOp = 'eq' | 'contains' | 'matches' | 'gte' | 'lte' | 'in';

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | string[];
}

/**
 * A source item normalized into a comparable shape. Aligns with the inputs the
 * reactive poll produces from Gmail/Calendar reads. Everything optional so a
 * partial item still evaluates safely (missing field → that condition fails).
 */
export interface NormalizedItem {
  id: string;
  source: 'gmail' | 'calendar' | 'notion' | 'slack' | 'chain';
  sender?: string;
  domain?: string;
  subject?: string;
  snippet?: string;
  label?: string;
  category?: string;
  amount?: number;
  ageDays?: number;
  attendees?: string[];
  raw?: string;
}

export interface ConditionResult {
  match: boolean;
  matchedSignal: string; // human-readable why it matched, for the run record / report
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function textBlob(item: NormalizedItem): string {
  return [item.subject, item.snippet, item.label, item.raw].filter(Boolean).join(' ').toLowerCase();
}

/** Parse the first dollar-ish amount out of the item text (e.g. "$12,500"). */
export function parseAmount(text: string): number | undefined {
  const m = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function fieldValue(field: ConditionField, item: NormalizedItem): string | number | string[] | undefined {
  switch (field) {
    case 'sender':   return item.sender?.toLowerCase();
    case 'domain':   return item.domain?.toLowerCase();
    case 'subject':  return item.subject?.toLowerCase();
    case 'category': return item.category?.toLowerCase();
    case 'amount':   return item.amount ?? parseAmount(textBlob(item));
    case 'age_days': return item.ageDays;
    case 'attendee': return (item.attendees || []).map(a => a.toLowerCase());
    case 'keyword':  return textBlob(item); // matched specially below
    default:         return undefined;
  }
}

function evalOne(cond: Condition, item: NormalizedItem): ConditionResult {
  const fail = { match: false, matchedSignal: '' };

  // 'keyword' supports special tokens that reuse the worklist regexes.
  if (cond.field === 'keyword') {
    const blob = textBlob(item);
    const token = asString(cond.value).toLowerCase();
    if (token === 'revenue') {
      return REVENUE_KEYWORDS.test(blob) ? { match: true, matchedSignal: 'revenue keyword' } : fail;
    }
    if (token === 'scheduling') {
      return SCHEDULING_KEYWORDS.test(blob) ? { match: true, matchedSignal: 'scheduling keyword' } : fail;
    }
    // Plain keyword: substring / regex
    if (cond.op === 'matches') {
      try { if (new RegExp(token, 'i').test(blob)) return { match: true, matchedSignal: `matches /${token}/` }; } catch { /* bad regex */ }
      return fail;
    }
    return blob.includes(token) ? { match: true, matchedSignal: `keyword "${token}"` } : fail;
  }

  const actual = fieldValue(cond.field, item);
  if (actual === undefined || actual === null) return fail;

  const sig = (why: string) => ({ match: true, matchedSignal: why });

  switch (cond.op) {
    case 'eq':
      return asString(actual) === asString(cond.value) ? sig(`${cond.field} = ${cond.value}`) : fail;
    case 'contains':
      return asString(actual).includes(asString(cond.value).toLowerCase()) ? sig(`${cond.field} contains "${cond.value}"`) : fail;
    case 'matches':
      try { return new RegExp(asString(cond.value), 'i').test(asString(actual)) ? sig(`${cond.field} matches`) : fail; }
      catch { return fail; }
    case 'gte':
      return Number(actual) >= Number(cond.value) ? sig(`${cond.field} ≥ ${cond.value}`) : fail;
    case 'lte':
      return Number(actual) <= Number(cond.value) ? sig(`${cond.field} ≤ ${cond.value}`) : fail;
    case 'in': {
      const list = (Array.isArray(cond.value) ? cond.value : [cond.value]).map(v => asString(v).toLowerCase());
      const actuals = Array.isArray(actual) ? actual.map(a => asString(a)) : [asString(actual)];
      return actuals.some(a => list.includes(a)) ? sig(`${cond.field} in [${list.join(', ')}]`) : fail;
    }
    default:
      return fail;
  }
}

/**
 * Evaluate a condition list (AND) against an item. Empty list = match-all.
 * Returns the combined match + a joined human-readable signal.
 */
export function evaluateConditions(conditions: Condition[] | null | undefined, item: NormalizedItem): ConditionResult {
  if (!conditions || conditions.length === 0) return { match: true, matchedSignal: 'any new item' };
  const signals: string[] = [];
  for (const cond of conditions) {
    const r = evalOne(cond, item);
    if (!r.match) return { match: false, matchedSignal: '' };
    if (r.matchedSignal) signals.push(r.matchedSignal);
  }
  return { match: true, matchedSignal: signals.join(' + ') };
}

/** Light validation/normalization of a raw conditions array from the LLM / API. */
export function sanitizeConditions(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return [];
  const FIELDS: ConditionField[] = ['sender', 'domain', 'subject', 'keyword', 'category', 'amount', 'age_days', 'attendee'];
  const OPS: ConditionOp[] = ['eq', 'contains', 'matches', 'gte', 'lte', 'in'];
  const out: Condition[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const field = (c as any).field;
    const op = (c as any).op;
    const value = (c as any).value;
    if (!FIELDS.includes(field) || !OPS.includes(op) || value == null) continue;
    out.push({ field, op, value });
    if (out.length >= 8) break; // sanity cap
  }
  return out;
}
