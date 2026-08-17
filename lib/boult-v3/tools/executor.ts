/**
 * Boult V3 — Tool Executor
 *
 * Implements each tool defined in definitions.ts. All functions are
 * scoped to a single userId and fetch their own tokens from Supabase.
 *
 * Cross-app behavior baked in here (not the LLM's job):
 * - schedule_meeting auto-mirrors to Notion Calendar after GCal create succeeds.
 * - create_notion_page introspects the target DB's schema and maps semantic
 *   fields to real property names, instead of guessing.
 */

import { getSupabaseAdmin } from '../../supabase.js';
import { SupermemoryClient } from '../../supermemory-client.js';
import { isMemoryEnabled, extractAndSaveEmailInsights } from '../../boult/memory';
import { getToken, getTokenPair } from '../integrations';
import { googleFetch } from '../../boult/tools/http-tokens';

// ── Gmail helpers ──────────────────────────────────────────────────────────────

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBody(payload: any): string {
  if (!payload) return '';

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).slice(0, 2000);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data).slice(0, 2000);
      }
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return '';
}

function encodeRfc822(to: string, subject: string, body: string, _threadId?: string, inReplyToId?: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8',
  ];
  if (inReplyToId) {
    lines.push(`In-Reply-To: ${inReplyToId}`);
    lines.push(`References: ${inReplyToId}`);
  }
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

// ── Gmail tools ────────────────────────────────────────────────────────────────

export async function searchGmail(
  userId: string,
  input: { query: string; maxResults?: number }
): Promise<string> {
  const token = await getToken(userId, 'gmail');
  if (!token) return 'Gmail is not connected. Please connect Gmail in Integrations.';

  const max = Math.min(input.maxResults || 10, 20);
  const params = new URLSearchParams({
    q: input.query,
    maxResults: String(max),
    labelIds: 'INBOX',
  });

  const res = await googleFetch(userId, 'gmail',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return `Gmail search failed (${res.status}). Token may be expired.`;

  const data = await res.json();
  const messages: any[] = data.messages || [];
  if (!messages.length) return 'No emails found matching that query.';

  const details = await Promise.all(
    messages.slice(0, max).map(async ({ id }: { id: string }) => {
      try {
        const msgRes = await googleFetch(userId, 'gmail',
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) return null;
        const msg = await msgRes.json();
        const headers = msg.payload?.headers || [];
        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader(headers, 'From'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          snippet: msg.snippet?.slice(0, 150) || '',
        };
      } catch {
        return null;
      }
    })
  );

  const valid = details.filter(Boolean);
  if (!valid.length) return 'Found emails but could not read metadata.';

  const lines = valid.map((m: any, i: number) =>
    `${i + 1}. ID: ${m.id} | ThreadID: ${m.threadId}\n   From: ${m.from}\n   Subject: ${m.subject}\n   Date: ${m.date}\n   Preview: ${m.snippet}`
  );

  return `Found ${valid.length} email(s):\n\n${lines.join('\n\n')}`;
}

export async function readEmail(
  userId: string,
  input: { messageId: string }
): Promise<string> {
  const token = await getToken(userId, 'gmail');
  if (!token) return 'Gmail is not connected. Please connect Gmail in Integrations.';

  const res = await googleFetch(userId, 'gmail',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${input.messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return `Could not read email (${res.status}).`;

  const msg = await res.json();
  const headers = msg.payload?.headers || [];
  const from = getHeader(headers, 'From');
  const to = getHeader(headers, 'To');
  const subject = getHeader(headers, 'Subject');
  const date = getHeader(headers, 'Date');
  const messageId = getHeader(headers, 'Message-ID');
  const body = extractBody(msg.payload);

  const out = [
    `Message-ID: ${msg.id}`,
    `Thread-ID: ${msg.threadId}`,
    `RFC-Message-ID: ${messageId}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    '',
    '--- Body ---',
    body || '(no plain text body)',
  ].join('\n');

  // Asynchronously extract insights from the body so Boult remembers this context
  if (body) {
    extractAndSaveEmailInsights(userId, body).catch(err => {
      console.error('[Memory] Error extracting email insights:', err);
    });
  }

  return out;
}

export async function readThread(
  userId: string,
  input: { threadId: string }
): Promise<string> {
  const token = await getToken(userId, 'gmail');
  if (!token) return 'Gmail is not connected.';

  const res = await googleFetch(userId, 'gmail',
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${input.threadId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return `Could not read thread (${res.status}).`;

  const thread = await res.json();
  const messages: any[] = thread.messages || [];
  if (!messages.length) return 'Thread has no messages.';

  const formatted = messages.map((msg: any, i: number) => {
    const headers = msg.payload?.headers || [];
    const from = getHeader(headers, 'From');
    const date = getHeader(headers, 'Date');
    const subject = getHeader(headers, 'Subject');
    const body = extractBody(msg.payload).slice(0, 1500);
    return `--- Message ${i + 1} ---\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${body || '(no plain text)'}`;
  });



  const out = `Thread ${input.threadId} — ${messages.length} message(s):\n\n${formatted.join('\n\n')}`;

  // Asynchronously extract insights from the combined thread body
  const combinedBody = messages.map((m: any) => extractBody(m.payload)).join('\n');
  if (combinedBody) {
    extractAndSaveEmailInsights(userId, combinedBody).catch(err => {
      console.error('[Memory] Error extracting thread insights:', err);
    });
  }

  return out;
}

export async function draftReply(
  userId: string,
  input: { threadId: string; to: string; subject?: string; body: string; inReplyToMessageId?: string }
): Promise<string> {
  const token = await getToken(userId, 'gmail');
  if (!token) return 'Gmail is not connected. Please connect Gmail in Integrations.';

  const subject = input.subject || 'Re: (no subject)';
  const raw = encodeRfc822(input.to, subject, input.body, input.threadId, input.inReplyToMessageId);

  const res = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw,
        threadId: input.threadId,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return `Failed to create draft (${res.status}): ${err.slice(0, 200)}`;
  }

  const draft = await res.json();
  return JSON.stringify({
    success: true,
    draftId: draft.id,
    threadId: input.threadId,
    to: input.to,
    subject,
    body: input.body,
    previewUrl: `https://mail.google.com/mail/u/0/#drafts/${draft.message?.id || ''}`,
  });
}

export async function sendEmail(
  userId: string,
  input: { to: string; subject: string; body: string; threadId?: string; inReplyToMessageId?: string }
): Promise<string> {
  const token = await getToken(userId, 'gmail');
  if (!token) return 'Gmail is not connected.';

  const raw = encodeRfc822(input.to, input.subject, input.body, input.threadId, input.inReplyToMessageId);

  const res = await googleFetch(userId, 'gmail', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.threadId ? { raw, threadId: input.threadId } : { raw }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return `Failed to send email (${res.status}): ${err.slice(0, 200)}`;
  }

  const sent = await res.json();
  return JSON.stringify({
    success: true,
    messageId: sent.id,
    threadId: sent.threadId,
    to: input.to,
    subject: input.subject,
  });
}

// ── Notion helpers ─────────────────────────────────────────────────────────────

interface NotionPropSchema {
  name: string;
  type: string;
  options?: string[];
}

interface NotionDbSchema {
  id: string;
  title: string;
  url?: string;
  properties: NotionPropSchema[];
  titlePropName: string;
}

async function notionFetch(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Notion ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

function extractTitle(page: any): string {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === 'title' && Array.isArray(p.title)) {
      return p.title.map((t: any) => t.plain_text || '').join('') || 'Untitled';
    }
  }
  return 'Untitled';
}

async function findNotionDatabase(token: string, hint: string): Promise<NotionDbSchema | null> {
  // Search for databases. Notion's search is fuzzy — pass the hint as a query.
  const searchRes = await notionFetch(token, '/search', {
    method: 'POST',
    body: JSON.stringify({
      query: hint,
      filter: { value: 'database', property: 'object' },
      page_size: 10,
    }),
  });

  const dbs: any[] = searchRes.results || [];
  if (!dbs.length) return null;

  // Rank: title containing the hint word ranks higher.
  const lowerHint = hint.toLowerCase();
  const scored = dbs.map((db: any) => {
    const title = (db.title || []).map((t: any) => t.plain_text || '').join('').toLowerCase();
    let score = 0;
    if (title === lowerHint) score += 100;
    if (title.includes(lowerHint)) score += 50;
    if (lowerHint.split(/\s+/).some(w => w.length > 2 && title.includes(w))) score += 20;
    return { db, score, title };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) {
    // Fallback: just take the first result.
    return parseDbSchema(dbs[0]);
  }
  return parseDbSchema(top.db);
}

function parseDbSchema(db: any): NotionDbSchema {
  const props = db.properties || {};
  let titleProp = 'Name';
  const propList: NotionPropSchema[] = [];

  for (const [name, def] of Object.entries(props)) {
    const d = def as any;
    if (d?.type === 'title') titleProp = name;
    const entry: NotionPropSchema = { name, type: d?.type || 'unknown' };
    if (d?.type === 'select' && d.select?.options) {
      entry.options = d.select.options.map((o: any) => o.name).filter(Boolean);
    }
    if (d?.type === 'status' && d.status?.options) {
      entry.options = d.status.options.map((o: any) => o.name).filter(Boolean);
    }
    if (d?.type === 'multi_select' && d.multi_select?.options) {
      entry.options = d.multi_select.options.map((o: any) => o.name).filter(Boolean);
    }
    propList.push(entry);
  }

  return {
    id: db.id,
    title: (db.title || []).map((t: any) => t.plain_text || '').join('') || 'Untitled DB',
    url: db.url,
    properties: propList,
    titlePropName: titleProp,
  };
}

function findPropByTypes(schema: NotionDbSchema, types: string[]): NotionPropSchema | null {
  for (const t of types) {
    const p = schema.properties.find(p => p.type === t);
    if (p) return p;
  }
  return null;
}

function buildNotionProperties(
  schema: NotionDbSchema,
  fields: { title: string; date?: string; notes?: string; status?: string; url?: string }
): { properties: Record<string, any>; warnings: string[] } {
  const properties: Record<string, any> = {};
  const warnings: string[] = [];

  properties[schema.titlePropName] = {
    title: [{ type: 'text', text: { content: fields.title.slice(0, 2000) } }],
  };

  if (fields.date) {
    const dateProp = findPropByTypes(schema, ['date']);
    if (dateProp) {
      properties[dateProp.name] = { date: { start: fields.date } };
    } else {
      warnings.push("date field skipped — database has no date property");
    }
  }

  if (fields.notes) {
    const notesProp = findPropByTypes(schema, ['rich_text']);
    if (notesProp) {
      properties[notesProp.name] = {
        rich_text: [{ type: 'text', text: { content: fields.notes.slice(0, 2000) } }],
      };
    } else {
      warnings.push("notes field skipped — database has no rich-text property (added to page body instead)");
    }
  }

  if (fields.status) {
    const statusProp = findPropByTypes(schema, ['status', 'select']);
    if (statusProp && statusProp.options) {
      const match = statusProp.options.find(o => o.toLowerCase() === fields.status!.toLowerCase());
      if (match) {
        properties[statusProp.name] = statusProp.type === 'status'
          ? { status: { name: match } }
          : { select: { name: match } };
      } else {
        warnings.push(`status "${fields.status}" skipped — not in DB options (${statusProp.options.join(', ')})`);
      }
    } else {
      warnings.push("status field skipped — database has no status/select property");
    }
  }

  if (fields.url) {
    const urlProp = findPropByTypes(schema, ['url']);
    if (urlProp) {
      properties[urlProp.name] = { url: fields.url };
    }
  }

  return { properties, warnings };
}

function buildNotionChildren(notes: string | undefined, actionItems: string[] | undefined): any[] {
  const children: any[] = [];

  if (notes) {
    // If notes had no DB rich-text prop to land in, render as a paragraph block.
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: notes.slice(0, 2000) } }],
      },
    });
  }

  if (actionItems?.length) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: [{ type: 'text', text: { content: 'Action items' } }] },
    });
    for (const item of actionItems.slice(0, 20)) {
      children.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: item.slice(0, 500) } }],
          checked: false,
        },
      });
    }
  }

  return children;
}

// ── Notion tools ───────────────────────────────────────────────────────────────

export async function readNotion(
  userId: string,
  input: { query: string; maxResults?: number }
): Promise<string> {
  const token = await getToken(userId, 'notion');
  if (!token) return 'Notion is not connected. Please connect Notion in Integrations.';

  const max = Math.min(input.maxResults || 5, 10);

  try {
    const data = await notionFetch(token, '/search', {
      method: 'POST',
      body: JSON.stringify({
        query: input.query,
        filter: { value: 'page', property: 'object' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: max,
      }),
    });

    const pages: any[] = data.results || [];
    if (!pages.length) return 'No Notion pages found matching that query.';

    const summaries = pages.map((page: any, i: number) => {
      const title = extractTitle(page);
      const edited = page.last_edited_time?.split('T')[0] || '';
      const url = page.url || '';
      return `${i + 1}. ${title}\n   Last edited: ${edited}\n   URL: ${url}\n   ID: ${page.id}`;
    });

    return `Found ${pages.length} Notion page(s):\n\n${summaries.join('\n\n')}`;
  } catch (err: any) {
    return `Notion search failed: ${err.message}`;
  }
}

export async function createNotionPage(
  userId: string,
  input: {
    databaseHint: string;
    title: string;
    date?: string;
    notes?: string;
    status?: string;
    url?: string;
    actionItems?: string[];
  }
): Promise<string> {
  const token = await getToken(userId, 'notion');
  if (!token) return 'Notion is not connected.';

  try {
    const schema = await findNotionDatabase(token, input.databaseHint);
    if (!schema) {
      return `No Notion database found matching "${input.databaseHint}". The user has no matching database — tell them which database name to use, or ask them to create one.`;
    }

    const { properties, warnings } = buildNotionProperties(schema, {
      title: input.title,
      date: input.date,
      notes: input.notes,
      status: input.status,
      url: input.url,
    });

    // If notes had a target rich-text property, don't duplicate them in body.
    const notesLandedInProperty = warnings.every(w => !w.startsWith('notes field skipped')) && !!input.notes;
    const children = buildNotionChildren(
      notesLandedInProperty ? undefined : input.notes,
      input.actionItems
    );

    const page = await notionFetch(token, '/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: schema.id },
        properties,
        ...(children.length ? { children } : {}),
      }),
    });

    return JSON.stringify({
      success: true,
      pageId: page.id,
      url: page.url,
      database: schema.title,
      databaseId: schema.id,
      warnings,
    });
  } catch (err: any) {
    return `Failed to create Notion page: ${err.message}`;
  }
}

export async function createNotionTask(
  userId: string,
  input: { title: string; dueDate?: string; notes?: string; status?: string }
): Promise<string> {
  return createNotionPage(userId, {
    databaseHint: 'tasks',
    title: input.title,
    date: input.dueDate,
    notes: input.notes,
    status: input.status,
  });
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

async function listGcalEvents(
  userId: string,
  accessToken: string,
  rangeStart: string,
  rangeEnd: string
): Promise<any[]> {
  const params = new URLSearchParams({
    timeMin: new Date(rangeStart).toISOString(),
    timeMax: new Date(rangeEnd).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const res = await googleFetch(userId, 'gcal',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.items || [];
}

async function listNotionCalendarEvents(
  token: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Array<{ title: string; date: string; url: string; database: string }>> {
  // Find databases that have a date property — those are calendar-like.
  const searchRes = await notionFetch(token, '/search', {
    method: 'POST',
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      page_size: 20,
    }),
  });

  const dbs: any[] = searchRes.results || [];
  const calendarDbs: Array<{ id: string; title: string; dateProp: string }> = [];

  for (const db of dbs) {
    const schema = parseDbSchema(db);
    const dateProp = findPropByTypes(schema, ['date']);
    if (dateProp) {
      calendarDbs.push({ id: schema.id, title: schema.title, dateProp: dateProp.name });
    }
  }

  // Query up to 3 calendar DBs in parallel; more would be slow.
  const queries = calendarDbs.slice(0, 3).map(async cdb => {
    try {
      const data = await notionFetch(token, `/databases/${cdb.id}/query`, {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            and: [
              { property: cdb.dateProp, date: { on_or_after: rangeStart.split('T')[0] } },
              { property: cdb.dateProp, date: { on_or_before: rangeEnd.split('T')[0] } },
            ],
          },
          page_size: 25,
        }),
      });
      return (data.results || []).map((page: any) => ({
        title: extractTitle(page),
        date: page.properties?.[cdb.dateProp]?.date?.start || '',
        url: page.url || '',
        database: cdb.title,
      }));
    } catch {
      return [];
    }
  });

  const results = await Promise.all(queries);
  return results.flat();
}

// ── Calendar tools ────────────────────────────────────────────────────────────

export async function readCombinedCalendar(
  userId: string,
  input: { rangeStart: string; rangeEnd: string }
): Promise<string> {
  const gcalTokens = await getTokenPair(userId, 'gcal');
  const notionToken = await getToken(userId, 'notion_calendar') || await getToken(userId, 'notion');

  if (!gcalTokens && !notionToken) {
    return 'Neither Google Calendar nor Notion is connected. Connect at least one in Integrations.';
  }

  const [gcalEvents, notionEvents] = await Promise.all([
    gcalTokens
      ? listGcalEvents(userId, gcalTokens.accessToken, input.rangeStart, input.rangeEnd).catch(() => [])
      : Promise.resolve([]),
    notionToken
      ? listNotionCalendarEvents(notionToken, input.rangeStart, input.rangeEnd).catch(() => [])
      : Promise.resolve([]),
  ]);

  const merged = [
    ...gcalEvents.map((e: any) => ({
      source: 'gcal' as const,
      title: e.summary || '(no title)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      attendees: (e.attendees || []).map((a: any) => a.email).filter(Boolean),
      url: e.htmlLink || '',
      id: e.id,
    })),
    ...notionEvents.map(e => ({
      source: 'notion' as const,
      title: e.title,
      start: e.date,
      end: '',
      attendees: [] as string[],
      url: e.url,
      id: '',
      database: e.database,
    })),
  ];

  merged.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  if (!merged.length) {
    return `No events found between ${input.rangeStart} and ${input.rangeEnd}.`;
  }

  // Detect potential conflicts (same time slot in both sources).
  const conflicts: string[] = [];
  for (const g of merged.filter(m => m.source === 'gcal')) {
    const matchInNotion = merged.find(
      m => m.source === 'notion' && m.start.startsWith(g.start.slice(0, 10)) &&
        m.title.toLowerCase() !== g.title.toLowerCase()
    );
    if (matchInNotion) {
      conflicts.push(`Mismatch on ${g.start.slice(0, 10)}: GCal "${g.title}" vs Notion "${matchInNotion.title}"`);
    }
  }

  const lines = merged.map((e, i) =>
    `${i + 1}. [${e.source}] ${e.title}\n   ${e.start}${e.end ? ' → ' + e.end : ''}${e.attendees.length ? '\n   With: ' + e.attendees.join(', ') : ''}`
  );

  let out = `Combined schedule (${merged.length} item(s)):\n\n${lines.join('\n\n')}`;
  if (conflicts.length) {
    out += `\n\nPotential conflicts between calendars:\n${conflicts.map(c => '- ' + c).join('\n')}`;
  }
  return out;
}

// ── Slack helpers ─────────────────────────────────────────────────────────────

async function slackFetch(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://slack.com/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack: ${data.error || 'unknown error'}`);
  return data;
}

export async function findSlackUser(
  userId: string,
  input: { email?: string; name?: string }
): Promise<string> {
  const token = await getToken(userId, 'slack');
  if (!token) return 'Slack is not connected.';

  try {
    if (input.email) {
      const params = new URLSearchParams({ email: input.email });
      const data = await slackFetch(token, `/users.lookupByEmail?${params}`);
      const u = data.user;
      return JSON.stringify({
        success: true,
        userId: u.id,
        name: u.real_name || u.name,
        email: u.profile?.email || input.email,
      });
    }

    if (input.name) {
      const data = await slackFetch(token, '/users.list?limit=200');
      const lower = input.name.toLowerCase();
      const match = (data.members || []).find((u: any) =>
        !u.deleted &&
        ((u.real_name || '').toLowerCase().includes(lower) ||
          (u.name || '').toLowerCase().includes(lower) ||
          (u.profile?.display_name || '').toLowerCase().includes(lower))
      );
      if (!match) return `No Slack user found matching "${input.name}".`;
      return JSON.stringify({
        success: true,
        userId: match.id,
        name: match.real_name || match.name,
      });
    }

    return 'find_slack_user requires either email or name.';
  } catch (err: any) {
    return `Slack user lookup failed: ${err.message}`;
  }
}

export async function sendSlackMessage(
  userId: string,
  input: { channel: string; text: string; thread_ts?: string }
): Promise<string> {
  const token = await getToken(userId, 'slack');
  if (!token) return 'Slack is not connected.';

  let channel = input.channel;

  // If channel is a user ID (starts with U), open a DM channel first.
  if (channel.startsWith('U')) {
    try {
      const opened = await slackFetch(token, '/conversations.open', {
        method: 'POST',
        body: JSON.stringify({ users: channel }),
      });
      channel = opened.channel?.id || channel;
    } catch (err: any) {
      return `Could not open DM with ${channel}: ${err.message}`;
    }
  }

  try {
    const body: Record<string, unknown> = { channel, text: input.text };
    if (input.thread_ts) body.thread_ts = input.thread_ts;

    const data = await slackFetch(token, '/chat.postMessage', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return JSON.stringify({
      success: true,
      channel: data.channel,
      ts: data.ts,
      text: input.text.slice(0, 200),
    });
  } catch (err: any) {
    return `Failed to send Slack message: ${err.message}`;
  }
}

// ── Schedule meeting (with Notion Calendar auto-mirror) ───────────────────────

async function mirrorToNotionCalendar(
  userId: string,
  meeting: { title: string; startTime: string; endTime: string; description?: string; attendees?: string[] }
): Promise<{ mirrored: boolean; note: string }> {
  const token = await getToken(userId, 'notion');
  if (!token) return { mirrored: false, note: 'Notion not connected — only Google Calendar updated.' };

  try {
    // Prefer a DB literally called "calendar"; fall back to any DB with a date property.
    let schema = await findNotionDatabase(token, 'calendar');
    if (!schema || !findPropByTypes(schema, ['date'])) {
      // No calendar-named DB — pick any DB with a date property.
      const searchRes = await notionFetch(token, '/search', {
        method: 'POST',
        body: JSON.stringify({
          filter: { value: 'database', property: 'object' },
          page_size: 20,
        }),
      });
      const dbs: any[] = searchRes.results || [];
      for (const db of dbs) {
        const s = parseDbSchema(db);
        if (findPropByTypes(s, ['date'])) {
          schema = s;
          break;
        }
      }
    }

    if (!schema) {
      return { mirrored: false, note: 'No Notion database with a date property found — Notion Calendar not updated.' };
    }

    const attendeeLine = meeting.attendees?.length ? `With: ${meeting.attendees.join(', ')}` : '';
    const notes = [meeting.description, attendeeLine].filter(Boolean).join('\n\n');

    const { properties } = buildNotionProperties(schema, {
      title: meeting.title,
      date: meeting.startTime,
      notes,
    });

    // Notion date property supports start+end — patch the start property to include both.
    const dateProp = findPropByTypes(schema, ['date']);
    if (dateProp) {
      properties[dateProp.name] = { date: { start: meeting.startTime, end: meeting.endTime } };
    }

    const page = await notionFetch(token, '/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: schema.id },
        properties,
      }),
    });

    return {
      mirrored: true,
      note: `Mirrored to Notion database "${schema.title}" (page ${page.id}).`,
    };
  } catch (err: any) {
    return { mirrored: false, note: `Notion mirror failed: ${err.message}` };
  }
}

export async function scheduleMeeting(
  userId: string,
  input: {
    title: string;
    startTime: string;
    endTime: string;
    attendees?: string[];
    description?: string;
    createMeetLink?: boolean;
  }
): Promise<string> {
  const tokens = await getTokenPair(userId, 'gcal');
  if (!tokens) return 'Google Calendar is not connected.';

  const event: Record<string, any> = {
    summary: input.title,
    start: { dateTime: input.startTime },
    end: { dateTime: input.endTime },
    description: input.description || '',
  };

  if (input.attendees?.length) {
    event.attendees = input.attendees.map(email => ({ email }));
  }

  const createMeet = input.createMeetLink !== false;
  const url = createMeet
    ? 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1'
    : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  if (createMeet) {
    event.conferenceData = {
      createRequest: {
        requestId: `boult-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return `Failed to create calendar event (${res.status}): ${err.slice(0, 200)}`;
  }

  const created = await res.json();
  const meetLink = created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || '';

  // Auto-mirror to Notion Calendar. Partial failure here is non-fatal —
  // the user gets a clear note in the result.
  const mirror = await mirrorToNotionCalendar(userId, {
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime,
    description: input.description,
    attendees: input.attendees,
  });

  return JSON.stringify({
    success: true,
    eventId: created.id,
    title: created.summary,
    start: created.start?.dateTime,
    end: created.end?.dateTime,
    htmlLink: created.htmlLink,
    meetLink,
    notionMirror: mirror,
  });
}

// ── Memory ────────────────────────────────────────────────────────────────────

const supermemory = new SupermemoryClient();

export async function searchMemory(
  userId: string,
  input: { query: string; limit?: number }
): Promise<string> {
  // Check if user has memory enabled
  const enabled = await isMemoryEnabled(userId);
  if (!enabled) return 'Memory is disabled. The user has turned off memory in their Boult settings.';

  const results = await supermemory.getMemories(userId, input.query, input.limit || 5);
  if (!results.length) return 'No memories found for that query.';

  const lines = results.map((r: any, i: number) => {
    const text = r.text || r.content || JSON.stringify(r).slice(0, 200);
    return `${i + 1}. ${text.slice(0, 300)}`;
  });
  return `Recalled ${results.length} relevant memory item(s):\n\n${lines.join('\n\n')}`;
}

export async function addMemory(
  userId: string,
  input: { content: string; category?: string }
): Promise<string> {
  // Check if user has memory enabled
  const enabled = await isMemoryEnabled(userId);
  if (!enabled) return 'Memory is disabled. The user has turned off memory in their Boult settings.';

  const result = await supermemory.addMemory(userId, input.content, {
    category: input.category || 'context',
    source: 'boult_chat',
  });
  if (!result) return 'Memory not saved (Supermemory unavailable).';
  return `Memory saved: "${input.content.slice(0, 120)}"`;
}

// ── Scheduled background agents ────────────────────────────────────────────────
//
// The executor here writes a real row to the boult_agents table that the cron
// runner at /api/cron/run-agents picks up. The canvas payload it returns is
// the same shape the legacy ChatInterface card consumer in
// app/dashboard/agent-talk/ChatInterface.tsx (~line 2149) expects so the
// inline ScheduledAgentCard renders with real data — not mocks.

const CRON_DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function cronToHumanLabel(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return `Schedule: ${cron}`;
  const [min, hour, , , dow] = p;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)} hour(s)`;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minute(s)`;
  const hh = /^\d+$/.test(hour) ? hour.padStart(2, '0') : hour;
  const mm = /^\d+$/.test(min) ? min.padStart(2, '0') : min;
  const at = `${hh}:${mm}`;
  if (dow === '*') return `Daily at ${at}`;
  if (/^\d$/.test(dow)) return `Weekly on ${CRON_DOW_NAMES[Number(dow)]} at ${at}`;
  if (/^\d-\d$/.test(dow)) return `${dow === '1-5' ? 'Weekdays' : `Days ${dow}`} at ${at}`;
  return `At ${at} (${cron})`;
}

function getUtcOffsetMinutes(tz: string, date: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const get = (t: string) => parseInt(fmt.formatToParts(date).find((p: any) => p.type === t)?.value ?? '0');
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return (localAsUtc - date.getTime()) / 60000;
  } catch { return 0; }
}

function computeNextRunIso(cron: string, tz = 'UTC'): string | null {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [minS, hourS, , , dowS] = p;
  const now = new Date();
  const next = new Date(now);

  if (hourS.startsWith('*/')) {
    const step = parseInt(hourS.slice(2)) || 1;
    next.setMinutes(/^\d+$/.test(minS) ? parseInt(minS) : 0, 0, 0);
    while (next <= now || next.getUTCHours() % step !== 0) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  if (minS.startsWith('*/')) {
    const step = parseInt(minS.slice(2)) || 15;
    next.setSeconds(0, 0);
    do { next.setMinutes(next.getMinutes() + 1); } while (next <= now || next.getMinutes() % step !== 0);
    return next.toISOString();
  }

  const h = parseInt(hourS), m = parseInt(minS);
  if (isNaN(h) || isNaN(m)) return null;

  const offsetMin = getUtcOffsetMinutes(tz, now);
  const nowLocal = new Date(now.getTime() + offsetMin * 60000);
  const y = nowLocal.getUTCFullYear(), mo = nowLocal.getUTCMonth(), d = nowLocal.getUTCDate();
  let targetLocal = new Date(Date.UTC(y, mo, d, h, m, 0, 0));

  if (/^\d$/.test(dowS)) {
    const targetDow = Number(dowS);
    while (targetLocal <= nowLocal || targetLocal.getUTCDay() !== targetDow) {
      targetLocal = new Date(targetLocal.getTime() + 86_400_000);
    }
  } else if (targetLocal <= nowLocal) {
    targetLocal = new Date(targetLocal.getTime() + 86_400_000);
  }

  return new Date(targetLocal.getTime() - offsetMin * 60000).toISOString();
}

async function getUserTimezone(userId: string): Promise<string> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('user_profiles')
      .select('preferences')
      .ilike('user_id', userId)
      .maybeSingle();
    return (data?.preferences as Record<string, unknown>)?.timezone as string || 'UTC';
  } catch { return 'UTC'; }
}

export async function createScheduledAgent(
  userId: string,
  input: {
    name: string;
    task_description: string;
    cron_schedule: string;
    output_channel?: 'gmail' | 'slack' | 'both';
    slack_channel?: string;
    skip_confirmations?: boolean;
    expires_at?: string;
  }
): Promise<ToolResult> {
  // Resilience (mirrors lib/boult/tools.ts): recover name/task_description from
  // alias keys or a spec field the model used instead of failing outright.
  const anyInput = input as any;
  if (!anyInput.name?.trim?.()) {
    anyInput.name = anyInput.agent_name || anyInput.agentName || anyInput.title || anyInput.name;
  }
  if (!anyInput.task_description?.trim?.()) {
    anyInput.task_description =
      anyInput.taskDescription || anyInput.task || anyInput.description || anyInput.instructions || anyInput.task_description;
  }
  const specText = typeof anyInput.spec_markdown === 'string' ? anyInput.spec_markdown : '';
  if (specText.trim()) {
    if (!anyInput.name?.trim?.()) {
      const h1 = specText.match(/^\s*#\s+(.+?)\s*$/m);
      if (h1) anyInput.name = h1[1].replace(/[*_`#]/g, '').trim();
    }
    if (!anyInput.task_description?.trim?.()) {
      const obj = specText.match(/^##\s+[^\n]*(?:objective|logic|task|goal)[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/im);
      const body = obj ? obj[1] : specText.replace(/^[\s\S]*?^#\s+.+?$/m, '');
      const cleaned = body.replace(/```[\s\S]*?```/g, ' ').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 12) anyInput.task_description = cleaned.slice(0, 1500);
    }
  }

  if (!input?.name?.trim() || !input?.task_description?.trim()) {
    return { output: 'Cannot create the agent — both a name and a task description are required. Ask the user what to name the agent and what it should do each run.' };
  }

  const cron = (input.cron_schedule || '0 7 * * *').trim();
  if (cron.split(/\s+/).length !== 5) {
    return { output: `Invalid cron schedule "${cron}". Must be 5 space-separated fields (m h dom mon dow). Ask the user to clarify when the agent should run.` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('boult_agents')
    .insert({
      user_id: userId.toLowerCase(),
      name: input.name.trim(),
      task_description: input.task_description.trim(),
      cron_schedule: cron,
      output_channel: input.output_channel || 'gmail',
      slack_channel: input.slack_channel || null,
      skip_confirmations: input.skip_confirmations ?? false,
      expires_at: input.expires_at || null,
      status: 'active',
    })
    .select()
    .single();

  if (error?.code === '42P01') {
    return { output: 'The boult_agents table is not set up. Tell the user the scheduling-agent feature needs the database migration applied first.' };
  }
  if (error) {
    return { output: `Failed to create scheduled agent: ${error.message}` };
  }

  const scheduleLabel = cronToHumanLabel(cron);
  const userTz = await getUserTimezone(userId);
  const nextRun = computeNextRunIso(cron, userTz);
  const nextRunLabel = nextRun
    ? new Date(nextRun).toLocaleString('en-US', {
        timeZone: userTz,
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : null;

  return {
    output: [
      `Scheduled agent "${data.name}" is LIVE (id ${data.id}).`,
      `Schedule: ${scheduleLabel} (cron: ${cron}, timezone: ${userTz})`,
      nextRunLabel ? `Next run: ${nextRunLabel}` : '',
      `Delivery: ${data.output_channel}${data.slack_channel ? ` (Slack: ${data.slack_channel})` : ''}`,
      `Skip confirmations: ${data.skip_confirmations ? 'YES — agent will send/post directly' : 'NO — agent will only draft and report'}`,
      '',
      `Now write a short confirmation in chat telling the user the agent is live, when it next runs, and how the report arrives. The card with full details is already rendered. Do NOT call any more tools.`,
    ].filter(Boolean).join('\n'),
    canvasData: {
      title: data.name,
      // The dashboard's ChatInterface card consumer keys on this exact type
      // and reads pageMeta.attendees as a tuple of [scheduleLabel, cron,
      // channel, skipConfirmations, status]. Don't change this shape without
      // also updating ChatInterface.tsx around line 2149.
      type: 'scheduled_agent',
      markdown: '',
      meta: {
        pageId: data.id,
        contentPreview: data.task_description,
        startTime: nextRun || undefined,
        attendees: [
          scheduleLabel,
          cron,
          data.output_channel,
          String(!!data.skip_confirmations),
          data.status,
        ],
      },
    },
  };
}

// ── Web Search ────────────────────────────────────────────────────────────────

async function webSearch(input: { query: string; maxResults?: number }): Promise<string> {
  const query = input.query;
  const max = input.maxResults || 5;

  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes('maily')) {
    return `Web search results for "${query}":

Maily is an advanced, AI-powered email intelligence and productivity platform built for founders, consultants, and busy professionals who value time and clarity. It acts as an autonomous executive intelligence layer between users and their workspaces.

Core Features:
1. Sift AI: Triage and inbox sweep, categorizes and filters out newsletters/promotions, extracts key highlights and priority items.
2. Boult AI: An autonomous executive assistant capable of analyzing threads, executing workflows, managing calendars, and managing Notion/Slack integrations.
3. Tone Writing / Voice Profile: Creates a Neural Voice Profile by analyzing the last 90 days of sent emails to draft responses that match the user's exact writing style, greeting, and signature.
4. Unified Workflow (Canvas): A beautiful interactive workspace panel for reviewing meeting preps, schedules, drafts, and comprehensive summaries.
5. Scheduled Background Agents: Allows users to create persistent background agents that run on customizable cron schedules (e.g., "sweep my inbox every morning at 7am and draft replies to client emails").
6. Cross-Platform Sync: Smooth coordination across Gmail, Google Calendar, Notion, Notion Calendar, Slack, and Cal.com.
7. Zero-Knowledge Encryption: Client-side AES-256-GCM encryption ensures email content is encrypted in the browser and remains completely private.

Pricing Plans (No free tier exists):
• Monthly Plan: $29/month. Includes unlimited AI Drafts, Sift Analysis, Boult queries, background agents, scheduling, and a Gold Founder Badge.
• Annual Plan: $16.58/month ($199 billed annually). Saves 40% (2 months free). Includes everything in Monthly, priority AI processing, and a Gold Founder Badge.
• Lifetime Founder Plan: $499 one-time payment. Pay once, own forever. Includes everything in Annual plus a VIP Diamond Slack channel, dedicated support, and the Diamond Founder Badge.

Founder & Team:
• Maily is a free, open source project. Follow at @Mailycfd on X or github.com/maily-cfd/Maily. Currently tailored for individual founders and power users, with team support on the roadmap.`;
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });
    const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const results: string[] = [];

      if (data.AbstractText) {
        results.push(`**Summary:** ${data.AbstractText.slice(0, 600)}`);
        if (data.AbstractURL) results.push(`Source: ${data.AbstractURL}`);
      }

      if (data.Answer) {
        results.push(`**Answer:** ${data.Answer}`);
      }

      if (data.RelatedTopics?.length) {
        const topics = (data.RelatedTopics as any[])
          .filter((t: any) => t.Text)
          .slice(0, max);
        for (const t of topics) {
          results.push(`• ${t.Text.slice(0, 300)}${t.FirstURL ? `\n  ${t.FirstURL}` : ''}`);
        }
      }

      if (results.length) {
        return `Web search results for "${query}":\n\n${results.join('\n\n')}`;
      }
    }
  } catch {
    // fallthrough to error message
  }

  return `Web search for "${query}": Could not retrieve live results at this time.`;
}

// ── Canvas + Approval (no API calls — they signal the stream) ─────────────────

export function openCanvas(input: { title: string; type?: string; markdown: string }) {
  return {
    title: input.title,
    type: (input.type as 'document' | 'report' | 'sequence' | 'summary') || 'document',
    markdown: input.markdown,
  };
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export interface ToolResult {
  output: string;
  canvasData?: { title: string; type: string; markdown: string; meta?: Record<string, any> };
  approvalRequest?: { summary: string; actions: string[] };
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: string
): Promise<ToolResult> {
  switch (toolName) {
    case 'search_gmail':
      return { output: await searchGmail(userId, toolInput as any) };

    case 'read_email':
      return { output: await readEmail(userId, toolInput as any) };

    case 'read_thread':
      return { output: await readThread(userId, toolInput as any) };

    case 'draft_reply': {
      const result = await draftReply(userId, toolInput as any);
      try {
        const parsed = JSON.parse(result);
        if (parsed.success) {
          return {
            output: result,
            canvasData: {
              title: `Draft: ${parsed.subject}`,
              type: 'email_draft',
              markdown: parsed.body,
              meta: { to: parsed.to, subject: parsed.subject, body: parsed.body, draftId: parsed.draftId, previewUrl: parsed.previewUrl },
            },
          };
        }
      } catch {
        // fall through
      }
      return { output: result };
    }

    case 'send_email':
      return { output: await sendEmail(userId, toolInput as any) };

    case 'read_notion':
      return { output: await readNotion(userId, toolInput as any) };

    case 'create_notion_page':
      return { output: await createNotionPage(userId, toolInput as any) };

    case 'create_notion_task':
      return { output: await createNotionTask(userId, toolInput as any) };

    case 'read_combined_calendar': {
      const out = await readCombinedCalendar(userId, toolInput as any);
      // Substantial output — render to canvas as well as returning to LLM.
      return {
        output: out,
        canvasData: {
          title: 'Combined schedule',
          type: 'summary',
          markdown: out,
        },
      };
    }

    case 'schedule_meeting':
      return { output: await scheduleMeeting(userId, toolInput as any) };

    case 'find_slack_user':
      return { output: await findSlackUser(userId, toolInput as any) };

    case 'send_slack_message':
      return { output: await sendSlackMessage(userId, toolInput as any) };

    case 'search_memory':
      return { output: await searchMemory(userId, toolInput as any) };

    case 'add_memory':
      return { output: await addMemory(userId, toolInput as any) };

    case 'create_scheduled_agent':
      return await createScheduledAgent(userId, toolInput as any);

    case 'web_search':
      return { output: await webSearch(toolInput as any) };

    case 'open_canvas': {
      const canvas = openCanvas(toolInput as any);
      return {
        output: `Canvas opened with title: "${canvas.title}"`,
        canvasData: {
          title: canvas.title,
          type: 'notes',
          markdown: canvas.markdown,
        },
      };
    }

    case 'request_approval': {
      const summary = String(toolInput.summary || '');
      const actions: string[] = Array.isArray(toolInput.actions) ? toolInput.actions : [];
      return {
        output:
          `APPROVAL_REQUESTED. You have stated your plan. STOP NOW — do not call any more tools. ` +
          `End your turn with a chat message that contains: (1) the plan in one sentence, ` +
          `(2) the bullet list of steps if useful, (3) ending with "OK to proceed?" or similar. ` +
          `Wait for the user's reply on the next turn before executing.`,
        approvalRequest: { summary, actions },
      };
    }

    default:
      return { output: `Unknown tool: ${toolName}` };
  }
}
