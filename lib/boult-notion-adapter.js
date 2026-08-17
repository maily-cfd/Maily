/**
 * Notion Adapter
 * 
 * Phase 4: Production-grade adapter for Notion integration
 * Supports: create page, update page, query database, create database item, search
 */

const { BaseIntegrationAdapter, buildConnectCTA, formatExternalRefs, INTEGRATION_ERROR_CATEGORIES } = require('./boult-integration-adapter-contract');

class NotionAdapter extends BaseIntegrationAdapter {
  constructor(db) {
    super(db);
    this.provider = 'notion';
    this.displayName = 'Notion';
    this.icon = 'notion';
    this.requiredCapabilities = [
      'read_content',
      'insert_content',
      'update_content',
      'read_comment',
      'insert_comment'
    ];
    this.capabilities = {
      read: true,
      write: true,
      create: true,
      update: true,
      delete: false,
      search: true,
      createPage: true,
      createDatabase: true
    };
    this.baseUrl = 'https://api.notion.com/v1';
  }

  /**
   * Build OAuth authorization URL
   */
  buildAuthUrl(state, baseUrl) {
    const clientId = process.env.NOTION_CLIENT_ID || process.env.NEXT_PUBLIC_NOTION_CLIENT_ID;
    if (!clientId) {
      console.error('[NotionAdapter] ERROR: NOTION_CLIENT_ID is not defined in environment variables.');
      console.log('[NotionAdapter] Current process.env keys:', Object.keys(process.env).filter(k => k.includes('NOTION')));
      throw new Error(`Notion integration is misconfigured: Missing Client ID in environment.`);
    }

    const redirectUri = `${this.getBaseUrl(baseUrl)}/api/integrations/notion/callback`;
    console.log(`[NotionAdapter] Building auth URL with Client ID: ${clientId} and redirect URI: ${redirectUri}`);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      owner: 'user',
      state: state || ''
    });
    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange code for tokens
   */
  async exchangeCode(code, baseUrl) {
    const clientId = (process.env.NOTION_CLIENT_ID || process.env.NEXT_PUBLIC_NOTION_CLIENT_ID || '').trim();
    const clientSecret = (process.env.NOTION_CLIENT_SECRET || '').trim();

    if (!clientId || !clientSecret) {
      console.error('[NotionAdapter] ERROR: Missing Notion credentials for token exchange.', { hasClientId: !!clientId, hasSecret: !!clientSecret });
      throw new Error('Notion integration is misconfigured: Missing credentials');
    }

    const redirectUri = `${this.getBaseUrl(baseUrl)}/api/integrations/notion/callback`;
    console.log(`[NotionAdapter] Exchanging code with redirect URI: ${redirectUri}`);
    
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[NotionAdapter] Token exchange failed:', response.status, errorData);
      throw new Error(`Token exchange failed: ${response.status} ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    
    return {
      accessToken: data.access_token,
      refreshToken: null, // Notion tokens don't expire
      expiresAt: undefined,
      scopes: this.requiredCapabilities
    };
  }

  /**
   * Validate connection and token health
   */
  async validateConnection(userEmail) {
    try {
      let credentials = await this.getCredentials(userEmail);
      
      // Auto-connect if internal secret is provided and no credentials exist yet
      if (!credentials && process.env.NOTION_INTERNAL_SECRET) {
        console.log(`[NotionAdapter] Auto-connecting user ${userEmail} using internal secret`);
        credentials = {
          accessToken: process.env.NOTION_INTERNAL_SECRET,
          refreshToken: null,
          expiresAt: undefined,
          scopes: this.requiredCapabilities
        };
        // Store it so it's persisted in the DB like a normal connection
        await this.storeCredentials(userEmail, credentials);
      }

      if (!credentials) {
        return {
          connected: false,
          provider: this.provider,
          capabilities: this.capabilities,
          tokenHealth: { valid: false, reauthRequired: true },
          scopes: [],
          missingScopes: this.requiredCapabilities
        };
      }

      // Validate token by making a test API call
      const response = await fetch(`${this.baseUrl}/users/me`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Notion-Version': '2022-06-28'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            connected: false,
            provider: this.provider,
            capabilities: this.capabilities,
            tokenHealth: { valid: false, reauthRequired: true },
            scopes: [],
            missingScopes: this.requiredCapabilities
          };
        }
        throw new Error(`API validation failed: ${response.status}`);
      }

      const userData = await response.json();

      // Check workspace capabilities
      const workspaceResponse = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 1 })
      });

      const canRead = workspaceResponse.ok;
      const canWrite = canRead; // Notion doesn't give separate scopes, assume full access if connected

      const actualCapabilities = {
        read: canRead,
        write: canWrite,
        create: canWrite,
        update: canWrite,
        delete: false, // Notion doesn't support delete via API
        search: canRead,
        createPage: canWrite,
        createDatabase: canWrite
      };

      return {
        connected: true,
        provider: this.provider,
        capabilities: actualCapabilities,
        tokenHealth: { valid: true, reauthRequired: false },
        scopes: this.requiredCapabilities,
        userInfo: {
          name: userData.name,
          id: userData.id
        }
      };
    } catch (error) {
      return {
        connected: false,
        provider: this.provider,
        capabilities: this.capabilities,
        tokenHealth: { valid: false, reauthRequired: true },
        scopes: [],
        error: this.mapError(error, 'validate')
      };
    }
  }

  /**
   * Execute Notion actions
   */
  async executeAction(userEmail, payload) {
    try {
      const credentials = await this.getCredentials(userEmail);
      if (!credentials) {
        return {
          success: false,
          error: {
            code: 'NOT_CONNECTED',
            message: 'Notion not connected',
            category: INTEGRATION_ERROR_CATEGORIES.AUTH_REVOKED,
            retryable: false,
            recoveryHint: buildConnectCTA(this.provider)
          }
        };
      }

      const headers = {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      };

      switch (payload.action) {
        case 'create_page':
          return await this.createPage(headers, payload.params);
        case 'update_page':
          return await this.updatePage(headers, payload.params);
        case 'query_database':
          return await this.queryDatabase(headers, payload.params);
        case 'create_database_item':
          return await this.createDatabaseItem(headers, payload.params);
        case 'search':
          return await this.search(headers, payload.params);
        case 'get_page':
          return await this.getPage(headers, payload.params);
        case 'append_blocks':
          return await this.appendBlocks(headers, payload.params);
        default:
          return {
            success: false,
            error: {
              code: 'UNKNOWN_ACTION',
              message: `Unknown action: ${payload.action}`,
              category: INTEGRATION_ERROR_CATEGORIES.INVALID_PAYLOAD,
              retryable: false
            }
          };
      }
    } catch (error) {
      return {
        success: false,
        error: this.mapError(error, payload.action)
      };
    }
  }

  /**
   * Create a new page
   */
  async createPage(headers, params) {
    const { parent, title, content = [], icon, cover } = params;

    const page = {
      parent: parent || { page_id: params.parentPageId },
      icon: icon ? { emoji: icon } : undefined,
      cover: cover ? { external: { url: cover } } : undefined,
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      },
      children: this.formatContentBlocks(content)
    };

    const response = await fetch(`${this.baseUrl}/pages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(page)
    });

    if (!response.ok) {
      throw new Error(`Page creation failed: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeResult('create_page', data);
  }

  /**
   * Update an existing page
   */
  async updatePage(headers, params) {
    const { pageId, title, icon, archived } = params;

    const update = {};
    if (title !== undefined) {
      update.properties = {
        title: {
          title: [{ text: { content: title } }]
        }
      };
    }
    if (icon) update.icon = { emoji: icon };
    if (archived !== undefined) update.archived = archived;

    const response = await fetch(`${this.baseUrl}/pages/${pageId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(update)
    });

    if (!response.ok) {
      throw new Error(`Page update failed: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeResult('update_page', data);
  }

  /**
   * Query a database
   */
  async queryDatabase(headers, params) {
    const { databaseId, filter, sorts, maxResults = 10 } = params;

    const response = await fetch(`${this.baseUrl}/databases/${databaseId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filter,
        sorts,
        page_size: maxResults
      })
    });

    if (!response.ok) {
      throw new Error(`Database query failed: ${response.status}`);
    }

    const data = await response.json();

    return this.buildSuccessResult({
      results: data.results.map(item => ({
        id: item.id,
        url: item.url,
        createdTime: item.created_time,
        lastEditedTime: item.last_edited_time,
        properties: item.properties
      })),
      hasMore: data.has_more,
      nextCursor: data.next_cursor
    });
  }

  /**
   * Create a database item
   */
  async createDatabaseItem(headers, params) {
    const { databaseId, properties } = params;

    const response = await fetch(`${this.baseUrl}/pages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: this.formatDatabaseProperties(properties)
      })
    });

    if (!response.ok) {
      throw new Error(`Database item creation failed: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeResult('create_database_item', data);
  }

  /**
   * Search Notion
   */
  async search(headers, params) {
    const { query, filter, maxResults = 10 } = params;

    const response = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        filter,
        page_size: maxResults
      })
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const data = await response.json();

    return this.buildSuccessResult({
      results: data.results.map(item => ({
        id: item.id,
        type: item.object,
        url: item.url,
        title: this.extractTitle(item),
        createdTime: item.created_time,
        lastEditedTime: item.last_edited_time
      })),
      hasMore: data.has_more,
      nextCursor: data.next_cursor
    });
  }

  /**
   * Get a page
   */
  async getPage(headers, params) {
    const { pageId } = params;

    const response = await fetch(`${this.baseUrl}/pages/${pageId}`, {
      headers
    });

    if (!response.ok) {
      throw new Error(`Get page failed: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeResult('get_page', data);
  }

  /**
   * Append blocks to a page
   */
  async appendBlocks(headers, params) {
    const { pageId, blocks } = params;

    const response = await fetch(`${this.baseUrl}/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        children: this.formatContentBlocks(blocks)
      })
    });

    if (!response.ok) {
      throw new Error(`Append blocks failed: ${response.status}`);
    }

    const data = await response.json();
    return this.buildSuccessResult({ appended: true, blockCount: data.results?.length || 0 });
  }

  /**
   * Format content blocks for Notion API
   */
  formatContentBlocks(content) {
    if (!content || !Array.isArray(content)) return [];

    return content.map(block => {
      switch (block.type) {
        case 'paragraph':
          return {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: block.text } }]
            }
          };
        case 'heading_1':
          return {
            object: 'block',
            type: 'heading_1',
            heading_1: {
              rich_text: [{ text: { content: block.text } }]
            }
          };
        case 'heading_2':
          return {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ text: { content: block.text } }]
            }
          };
        case 'bulleted_list_item':
          return {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ text: { content: block.text } }]
            }
          };
        case 'numbered_list_item':
          return {
            object: 'block',
            type: 'numbered_list_item',
            numbered_list_item: {
              rich_text: [{ text: { content: block.text } }]
            }
          };
        case 'to_do':
          return {
            object: 'block',
            type: 'to_do',
            to_do: {
              rich_text: [{ text: { content: block.text } }],
              checked: block.checked || false
            }
          };
        default:
          return {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: block.text || '' } }]
            }
          };
      }
    });
  }

  /**
   * Format database properties
   */
  formatDatabaseProperties(properties) {
    const formatted = {};
    
    for (const [key, value] of Object.entries(properties)) {
      if (typeof value === 'string') {
        formatted[key] = {
          title: [{ text: { content: value } }]
        };
      } else if (typeof value === 'boolean') {
        formatted[key] = {
          checkbox: value
        };
      } else if (typeof value === 'number') {
        formatted[key] = {
          number: value
        };
      } else if (Array.isArray(value)) {
        formatted[key] = {
          multi_select: value.map(v => ({ name: v }))
        };
      } else if (value && value.type) {
        // Pre-formatted property
        formatted[key] = value;
      }
    }

    return formatted;
  }

  /**
   * Extract title from Notion object
   */
  extractTitle(item) {
    if (item.object === 'page' && item.properties?.title) {
      return item.properties.title.title?.[0]?.text?.content || 'Untitled';
    }
    if (item.object === 'database') {
      return item.title?.[0]?.text?.content || 'Untitled Database';
    }
    return 'Untitled';
  }

  /**
   * Normalize result to canonical format
   */
  normalizeResult(action, rawResult) {
    const externalRefs = formatExternalRefs({
      pageId: rawResult.id,
      pageUrl: rawResult.url,
      parentId: rawResult.parent?.page_id || rawResult.parent?.database_id
    });

    return this.buildSuccessResult({
      id: rawResult.id,
      object: rawResult.object,
      url: rawResult.url,
      createdTime: rawResult.created_time,
      lastEditedTime: rawResult.last_edited_time,
      icon: rawResult.icon,
      cover: rawResult.cover,
      properties: rawResult.properties,
      parent: rawResult.parent
    }, externalRefs);
  }

  /**
   * Map Notion errors to canonical format
   */
  mapError(error, action) {
    const code = error.status || error.code;
    const message = error.message || 'Unknown error';

    if (code === 401 || message.includes('unauthorized')) {
      return {
        code: 'AUTH_EXPIRED',
        message: 'Your Notion connection has expired. Please reconnect.',
        category: INTEGRATION_ERROR_CATEGORIES.AUTH_EXPIRED,
        retryable: false,
        recoveryHint: buildConnectCTA(this.provider)
      };
    }

    if (code === 403) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'Permission denied. Check your Notion workspace access.',
        category: INTEGRATION_ERROR_CATEGORIES.PERMISSION_DENIED,
        retryable: false
      };
    }

    if (code === 404 || message.includes('object_not_found')) {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested page or database was not found',
        category: INTEGRATION_ERROR_CATEGORIES.RESOURCE_NOT_FOUND,
        retryable: false
      };
    }

    if (code === 400 && message.includes('validation_error')) {
      return {
        code: 'INVALID_PAYLOAD',
        message: 'Invalid data format. Please check your input.',
        category: INTEGRATION_ERROR_CATEGORIES.INVALID_PAYLOAD,
        retryable: false,
        recoveryHint: {
          userMessage: 'The data format is not valid for Notion. Please revise your input.',
          recoveryAction: 'revise_input',
          requiresUserAction: true,
          autoRetry: false
        }
      };
    }

    if (code === 429) {
      return {
        code: 'RATE_LIMITED',
        message: 'Notion rate limit reached. Please try again.',
        category: INTEGRATION_ERROR_CATEGORIES.RATE_LIMITED,
        retryable: true,
        recoveryHint: {
          userMessage: 'Rate limit reached. Will retry automatically.',
          recoveryAction: 'retry',
          requiresUserAction: false,
          autoRetry: true
        }
      };
    }

    if (code >= 500) {
      return {
        code: 'PROVIDER_ERROR',
        message: 'Notion service error. Please try again.',
        category: INTEGRATION_ERROR_CATEGORIES.PROVIDER_ERROR,
        retryable: true
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: `Notion error: ${message}`,
      category: INTEGRATION_ERROR_CATEGORIES.UNKNOWN,
      retryable: false
    };
  }
}

module.exports = { NotionAdapter };
