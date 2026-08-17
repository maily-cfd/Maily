/**
 * Boult V3 — Google Calendar Action Handler
 * 
 * Executes GCal actions: update_event, create_event, delete_event.
 * Validates required params before any API call.
 * Throws on API error with response body included.
 */



interface GCalTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Execute a Google Calendar action.
 */
export async function gcalHandler(
  action: string,
  params: Record<string, unknown>,
  tokens: GCalTokens
): Promise<void> {
  const { accessToken } = tokens;

  switch (action) {
    case 'update_event':
      return updateEvent(accessToken, params);
    case 'create_event':
      return createEvent(accessToken, params);
    case 'delete_event':
      return deleteEvent(accessToken, params);
    case 'create_meet_link':
      return createMeetLink(accessToken, params);
    default:
      throw new Error(`Unknown gcal action: ${action}`);
  }
}

async function updateEvent(
  token: string,
  params: Record<string, unknown>
): Promise<void> {
  const { eventId, calendarId, ...updateFields } = params;

  if (!eventId) throw new Error('gcal.update_event requires eventId');

  const calendar = (calendarId as string) || 'primary';
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${eventId}`;

  // First fetch the existing event to merge changes
  const getResponse = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!getResponse.ok) {
    const errorText = await getResponse.text();
    throw new Error(`GCal GET failed (${getResponse.status}): ${errorText.substring(0, 200)}`);
  }

  const existingEvent = await getResponse.json();

  // Merge updates
  const updatedEvent = { ...existingEvent, ...buildEventBody(updateFields) };

  const patchResponse = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updatedEvent),
    signal: AbortSignal.timeout(8000),
  });

  if (!patchResponse.ok) {
    const errorText = await patchResponse.text();
    throw new Error(`GCal PATCH failed (${patchResponse.status}): ${errorText.substring(0, 200)}`);
  }
}

async function createEvent(
  token: string,
  params: Record<string, unknown>
): Promise<void> {
  const calendarId = (params.calendarId as string) || 'primary';
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  const eventBody = buildEventBody(params);

  if (!eventBody.summary) {
    throw new Error('gcal.create_event requires a title (summary)');
  }

  // If meet link requested, we need conferenceDataVersion=1
  const createUrl = params.createMeetLink ? `${url}?conferenceDataVersion=1` : url;

  const response = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GCal POST failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
}

async function deleteEvent(
  token: string,
  params: Record<string, unknown>
): Promise<void> {
  const { eventId, calendarId } = params;
  if (!eventId) throw new Error('gcal.delete_event requires eventId');

  const calendar = (calendarId as string) || 'primary';
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${eventId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });

  // 204 = success, 410 = already deleted (both are OK)
  if (!response.ok && response.status !== 204 && response.status !== 410) {
    const errorText = await response.text();
    throw new Error(`GCal DELETE failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
}

async function createMeetLink(
  token: string,
  params: Record<string, unknown>
): Promise<void> {
  const { eventId, calendarId } = params;
  if (!eventId) throw new Error('gcal.create_meet_link requires eventId');

  const calendar = (calendarId as string) || 'primary';
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${eventId}?conferenceDataVersion=1`;

  const patchBody = {
    conferenceData: {
      createRequest: {
        requestId: `boult-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patchBody),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GCal createMeetLink failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
}


/**
 * Build a Google Calendar event body from Boult step params.
 */
function buildEventBody(params: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (params.title || params.summary) {
    body.summary = params.title || params.summary;
  }
  if (params.description) {
    body.description = params.description;
  }
  if (params.location) {
    body.location = params.location;
  }
  if (params.startTime) {
    body.start = {
      dateTime: new Date(params.startTime as string).toISOString(),
      timeZone: (params.timeZone as string) || 'UTC',
    };
  }
  if (params.endTime) {
    body.end = {
      dateTime: new Date(params.endTime as string).toISOString(),
      timeZone: (params.timeZone as string) || 'UTC',
    };
  }
  if (params.attendees && Array.isArray(params.attendees)) {
    body.attendees = (params.attendees as string[]).map(email => ({ email }));
  }
  if (params.status) {
    body.status = params.status;
  }
  if (params.createMeetLink) {
    (body as any).conferenceData = {
      createRequest: {
        requestId: `boult-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  return body;
}
