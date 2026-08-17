/**
 * Notion Adapter for Boult
 * Creates pages, searches, and updates blocks in a user's Notion workspace.
 *
 * Requires NOTION_INTEGRATION_TOKEN (internal integration token)
 * or per-user OAuth tokens stored in user profile.
 *
 * Notion API Version: 2022-06-28
 * Docs: https://developers.notion.com/reference
 */

const NOTION_API_VERSION = '2022-06-28';
const NOTION_BASE_URL = 'https://api.notion.com/v1';

export class NotionAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.token - Notion integration token (internal or OAuth)
   * @param {string} [opts.defaultDatabaseId] - fallback database to write pages into
   */
  constructor({ token, defaultDatabaseId = null }) {
    this.token = token;
    this.defaultDatabaseId = defaultDatabaseId;

    if (!this.token) {
      console.warn('⚠️ NotionAdapter: No token provided — calls will fail');
    }
  }

  // ── Private helpers ────────────────────────────────────────

  async _request(path, options = {}) {
    const url = `${NOTION_BASE_URL}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Notion API ${response.status}: ${body.substring(0, 200)}`);
    }

    return response.json();
  }

  /**
   * Convert plain text into Notion rich_text block format.
   */
  _richText(text = '') {
    return [{ type: 'text', text: { content: String(text).substring(0, 2000) } }];
  }

  /**
   * Build paragraph blocks from a string (splits on double-newline).
   */
  _textToBlocks(text = '') {
    const paragraphs = String(text).split(/\n\n+/).filter(Boolean);
    return paragraphs.map(p => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: this._richText(p) }
    }));
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Create a page inside a database (or as a standalone page under a parent page).
   *
   * @param {object} opts
   * @param {string} opts.title - Page title
   * @param {string} [opts.content] - Body text (plain-text, converted to blocks)
   * @param {string} [opts.databaseId] - target database (uses default if omitted)
   * @param {string} [opts.parentPageId] - alternative: create as child of a page
   * @param {object} [opts.properties] - additional Notion properties
   * @param {string[]} [opts.tags] - optional multi-select tags
   * @returns {{ pageId: string, url: string }}
   */
  async createPage({ title, content = '', databaseId = null, parentPageId = null, properties = {}, tags = [] }) {
    const targetDb = databaseId || this.defaultDatabaseId;

    let parent;
    if (targetDb) {
      parent = { database_id: targetDb };
    } else if (parentPageId) {
      parent = { page_id: parentPageId };
    } else {
      throw new Error('NotionAdapter.createPage: either databaseId or parentPageId is required');
    }

    // Build properties — database pages require Title property
    const pageProperties = {
      ...properties
    };

    // Set title in the common "Name" or "Title" property (database schema dependent)
    // We try "Name" first (Notion default), fallback to "title"
    if (targetDb) {
      pageProperties['Name'] = {
        title: this._richText(title)
      };
      if (tags.length > 0 && !pageProperties['Tags']) {
        pageProperties['Tags'] = {
          multi_select: tags.map(t => ({ name: t }))
        };
      }
    }

    const body = {
      parent,
      properties: pageProperties,
      children: content ? this._textToBlocks(content) : []
    };

    // For page-parented pages, title goes differently
    if (parentPageId && !targetDb) {
      body.properties = {
        title: { title: this._richText(title) }
      };
    }

    const result = await this._request('/pages', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    return {
      pageId: result.id,
      url: result.url,
      title,
      createdTime: result.created_time
    };
  }

  /**
   * Search Notion for pages/databases matching a query.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.filter] - 'page' | 'database'
   * @param {number} [opts.limit] - max results (default 10)
   * @returns {Array<{ id: string, title: string, url: string, type: string }>}
   */
  async search(query, { filter = null, limit = 10 } = {}) {
    const body = {
      query,
      page_size: Math.min(limit, 100)
    };

    if (filter === 'page' || filter === 'database') {
      body.filter = { value: filter, property: 'object' };
    }

    const result = await this._request('/search', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    return (result.results || []).map(item => {
      // Extract title from different possible property locations
      let title = 'Untitled';
      if (item.properties?.Name?.title?.[0]?.plain_text) {
        title = item.properties.Name.title[0].plain_text;
      } else if (item.properties?.title?.title?.[0]?.plain_text) {
        title = item.properties.title.title[0].plain_text;
      } else if (item.title?.[0]?.plain_text) {
        title = item.title[0].plain_text;
      }

      return {
        id: item.id,
        title,
        url: item.url,
        type: item.object, // 'page' or 'database'
        lastEditedTime: item.last_edited_time
      };
    });
  }

  /**
   * Append content blocks to an existing page.
   *
   * @param {string} pageId
   * @param {string} content - plain text to append
   */
  async appendToPage(pageId, content) {
    const blocks = this._textToBlocks(content);

    await this._request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks })
    });

    return { pageId, blocksAdded: blocks.length };
  }

  /**
   * Retrieve a page by ID (metadata + properties).
   */
  async getPage(pageId) {
    const result = await this._request(`/pages/${pageId}`);

    let title = 'Untitled';
    if (result.properties?.Name?.title?.[0]?.plain_text) {
      title = result.properties.Name.title[0].plain_text;
    } else if (result.properties?.title?.title?.[0]?.plain_text) {
      title = result.properties.title.title[0].plain_text;
    }

    return {
      id: result.id,
      title,
      url: result.url,
      createdTime: result.created_time,
      lastEditedTime: result.last_edited_time,
      archived: result.archived,
      properties: result.properties
    };
  }

  /**
   * Update properties of a page.
   *
   * @param {string} pageId
   * @param {object} properties - Notion properties object to update
   */
  async updatePage(pageId, properties) {
    const formattedProperties = {};
    
    // Auto-format simple key-value pairs into rich_text/title objects if they are strings
    for (const [key, value] of Object.entries(properties)) {
       if (typeof value === 'string') {
         if (key.toLowerCase() === 'name' || key.toLowerCase() === 'title') {
           formattedProperties[key] = { title: this._richText(value) };
         } else if (key.toLowerCase() === 'status') {
           formattedProperties[key] = { status: { name: value } };
         } else {
           formattedProperties[key] = { rich_text: this._richText(value) };
         }
       } else {
         formattedProperties[key] = value;
       }
    }

    const result = await this._request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: formattedProperties })
    });

    return { pageId, url: result.url };
  }

  /**
   * Check if the token is valid by listing current user.
   */
  async checkConnection() {
    try {
      const result = await this._request('/users/me');
      return {
        connected: true,
        botId: result.id,
        name: result.name,
        type: result.type
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }
}

// Export singleton
export const notionAdapter = new NotionAdapter({});

// Add aliases for method names expected by CanvasActionHandlers
NotionAdapter.prototype.appendContent = function (opts = {}) {
    return this.appendToPage(opts.parentId || opts.pageId, opts.content, opts.type);
};

export default NotionAdapter;
