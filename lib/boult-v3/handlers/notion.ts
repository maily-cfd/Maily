/**
 * Boult V3 — Notion Handler
 * 
 * Implements execution logic for Notion actions.
 * Whitelisted actions: update_page, create_page.
 */

import { Client } from '@notionhq/client';

/**
 * Notion Action Handler
 */
export async function notionHandler(
  action: string,
  params: any,
  credentials: { accessToken: string }
): Promise<{ success: boolean; data?: any; error?: string }> {
  const notion = new Client({ auth: credentials.accessToken });

  try {
    switch (action) {
      case 'update_page':
        return await updatePage(notion, params);
      case 'create_page':
        return await createPage(notion, params);
      default:
        return { success: false, error: `Unsupported Notion action: ${action}` };
    }
  } catch (err: any) {
    console.error(`[Boult V3] Notion handler error (${action}):`, err.message);
    return { success: false, error: err.message };
  }
}

async function updatePage(notion: Client, params: any) {
  const { pageId, properties, icon, cover, archived } = params;
  if (!pageId) throw new Error('pageId is required for update_page');

  const response = await notion.pages.update({
    page_id: pageId,
    properties: properties || {},
    icon: icon,
    cover: cover,
    archived: archived,
  });

  return { success: true, data: response };
}

async function createPage(notion: Client, params: any) {
  const { parent, properties, children, icon, cover } = params;
  if (!parent) throw new Error('parent (database_id or page_id) is required for create_page');

  const response = await notion.pages.create({
    parent: parent,
    properties: properties || {},
    children: children,
    icon: icon,
    cover: cover,
  });

  return { success: true, data: response };
}
