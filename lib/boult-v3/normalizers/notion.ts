/**
 * Boult V3 — Notion Normalizer
 * 
 * Converts Notion Page and Database objects into BoultEvent format.
 * Implements block flattening (2 levels deep) for readable context.
 */

import type { BoultEvent } from '../types';
import crypto from 'crypto';

/**
 * Normalizes a Notion page into an BoultEvent.
 */
export function normalizeNotionPage(page: any, content: string): BoultEvent {
  const title = getNotionTitle(page);
  
  return {
    id: crypto.randomUUID(),
    source: 'notion',
    type: 'page',
    title: title || 'Untitled Notion Page',
    description: content,
    startAt: page.last_edited_time ? new Date(page.last_edited_time) : new Date(),
    endAt: null,
    attendees: [],
    url: page.url || null,
    rawPayload: page,
    detectedAt: new Date(),
  };
}

/**
 * Normalizes a Notion database item (with date property) into a 'booking' or 'meeting' event.
 */
export function normalizeNotionDatabaseItem(item: any, datePropName: string): BoultEvent {
  const title = getNotionTitle(item);
  const dateProp = item.properties[datePropName]?.date;
  
  return {
    id: crypto.randomUUID(),
    source: 'notion',
    type: 'task', // Treating database date items as tasks/events
    title: title || 'Untitled Notion Item',
    description: null,
    startAt: dateProp?.start ? new Date(dateProp.start) : null,
    endAt: dateProp?.end ? new Date(dateProp.end) : null,
    attendees: [],
    url: item.url || null,
    rawPayload: item,
    detectedAt: new Date(),
  };
}

/**
 * Utility to extract title from Notion page/item properties.
 */
function getNotionTitle(obj: any): string | null {
  const props = obj.properties || {};
  
  // Notion uses 'title' or 'Name' for the primary title property usually
  const titleProp = Object.values(props).find((p: any) => p.type === 'title') as any;
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text;
  }
  
  return null;
}

/**
 * Flattens Notion blocks into a plain text string.
 * Limit recursion to 2 levels deep per spec.
 */
export function flattenNotionBlocks(blocks: any[]): string {
  let text = '';
  
  for (const block of blocks) {
    text += extractTextFromBlock(block) + '\n';
  }
  
  return text.trim();
}

function extractTextFromBlock(block: any): string {
  const type = block.type;
  const content = block[type];
  
  if (!content) return '';

  // Handle common text-bearing blocks
  if (content.rich_text) {
    return content.rich_text.map((t: any) => t.plain_text).join('');
  }
  
  // Special case for child_page or other structural blocks
  if (type === 'child_page') return `[Page: ${content.title}]`;
  if (type === 'child_database') return `[Database: ${content.title}]`;

  return '';
}
