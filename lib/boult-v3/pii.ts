/**
 * Boult V3 — PII Stripping for LLM Context
 * 
 * Before passing attendee emails and names to the LLM, replaces them
 * with anonymous placeholders. Maintains a bidirectional mapping so
 * we can substitute back after the LLM responds.
 * 
 * This is separate from lib/pii-sanitizer.js which handles broader
 * PII patterns. This module is specifically for the Boult reasoning
 * layer's attendee anonymization.
 */

export interface PIIMapping {
  toPlaceholder: Map<string, string>;
  fromPlaceholder: Map<string, string>;
}

/**
 * Strip PII from BoultEvent attendees and text fields.
 * Returns the sanitized data and a mapping for rehydration.
 */
export function stripPII(data: unknown): { sanitized: unknown; mapping: PIIMapping } {
  const mapping: PIIMapping = {
    toPlaceholder: new Map(),
    fromPlaceholder: new Map(),
  };

  let counter = 1;

  function getPlaceholder(original: string): string {
    if (mapping.toPlaceholder.has(original)) {
      return mapping.toPlaceholder.get(original)!;
    }
    const placeholder = `[Person ${counter}]`;
    counter++;
    mapping.toPlaceholder.set(original, placeholder);
    mapping.fromPlaceholder.set(placeholder, original);
    return placeholder;
  }

  // Email pattern
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  function sanitizeString(str: string): string {
    return str.replace(emailRegex, (match) => getPlaceholder(match));
  }

  function sanitizeValue(val: unknown): unknown {
    if (typeof val === 'string') {
      return sanitizeString(val);
    }
    if (Array.isArray(val)) {
      return val.map(item => sanitizeValue(item));
    }
    if (val !== null && typeof val === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
        // Skip rawPayload — don't sanitize stored audit data
        if (key === 'rawPayload') {
          result[key] = value;
          continue;
        }
        result[key] = sanitizeValue(value);
      }
      return result;
    }
    return val;
  }

  const sanitized = sanitizeValue(data);
  return { sanitized, mapping };
}

/**
 * Rehydrate PII placeholders back to original values after LLM response.
 */
export function rehydratePII(text: string, mapping: PIIMapping): string {
  let result = text;
  for (const [placeholder, original] of mapping.fromPlaceholder.entries()) {
    // Use global replace to catch all occurrences
    result = result.split(placeholder).join(original);
  }
  return result;
}

/**
 * Rehydrate PII in a structured object (e.g., plan steps).
 */
export function rehydratePIIObject(data: unknown, mapping: PIIMapping): unknown {
  if (typeof data === 'string') {
    return rehydratePII(data, mapping);
  }
  if (Array.isArray(data)) {
    return data.map(item => rehydratePIIObject(item, mapping));
  }
  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = rehydratePIIObject(value, mapping);
    }
    return result;
  }
  return data;
}
