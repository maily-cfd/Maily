/**
 * Boult V3 — Google Calendar Event Normalizer
 * 
 * Converts raw Google Calendar API event objects into the
 * internal BoultEvent format. This is the ONLY place where
 * raw GCal types are touched — everywhere else uses BoultEvent.
 */

import type { BoultEvent } from '../types';
import crypto from 'crypto';

interface GCalEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  htmlLink?: string;
  status?: string;
  organizer?: {
    email?: string;
    displayName?: string;
  };
  conferenceData?: {
    entryPoints?: Array<{
      uri?: string;
      entryPointType?: string;
    }>;
  };
  updated?: string;
  created?: string;
  recurringEventId?: string;
  location?: string;
}

/**
 * Normalize a single Google Calendar event to BoultEvent format.
 */
export function normalizeGCalEvent(googleEvent: GCalEvent): BoultEvent {
  const startAt = googleEvent.start?.dateTime
    ? new Date(googleEvent.start.dateTime)
    : googleEvent.start?.date
      ? new Date(googleEvent.start.date)
      : null;

  const endAt = googleEvent.end?.dateTime
    ? new Date(googleEvent.end.dateTime)
    : googleEvent.end?.date
      ? new Date(googleEvent.end.date)
      : null;

  const attendees = (googleEvent.attendees || [])
    .map(a => a.email)
    .filter((email): email is string => !!email);

  // Prefer conference link, fall back to htmlLink
  const meetLink = googleEvent.conferenceData?.entryPoints?.find(
    ep => ep.entryPointType === 'video'
  )?.uri;

  return {
    id: crypto.randomUUID(),
    source: 'gcal',
    type: 'meeting',
    title: googleEvent.summary || '(No title)',
    description: googleEvent.description || null,
    startAt,
    endAt,
    attendees,
    url: meetLink || googleEvent.htmlLink || null,
    rawPayload: googleEvent,
    detectedAt: new Date(),
  };
}

/**
 * Normalize an array of Google Calendar events.
 */
export function normalizeGCalEvents(events: GCalEvent[]): BoultEvent[] {
  return events.map(normalizeGCalEvent);
}
