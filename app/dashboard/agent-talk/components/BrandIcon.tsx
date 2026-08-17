/**
 * BrandIcon — monochrome SVGs for the apps Boult orchestrates.
 *
 * Each icon uses currentColor so it inherits whatever text color the parent
 * row sets — keeps the chat surface consistent (gray inline, slightly
 * stronger when the row is active). Sized at 14px to match the Lucide
 * icons used elsewhere in LiveStepTracker.
 *
 * Includes only the apps Boult has tools for today: Notion, Gmail,
 * Google Calendar, Slack. Add more as we wire integrations.
 */

interface BrandIconProps {
  className?: string;
}

const SIZE_CLASS = 'w-3.5 h-3.5';

export function NotionIcon({ className = '' }: BrandIconProps) {
  // Outlined box with a stylized "N" — the standard Notion mark.
  return (
    <svg className={`${SIZE_CLASS} ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.5 17V7l7 10V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GmailIcon({ className = '' }: BrandIconProps) {
  // Envelope with the inner M strokes that read distinctly as Gmail.
  return (
    <svg className={`${SIZE_CLASS} ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GoogleCalendarIcon({ className = '' }: BrandIconProps) {
  // Calendar with date-strip + spine — the recognizable Google Calendar card.
  return (
    <svg className={`${SIZE_CLASS} ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="14.5" r="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function SlackIcon({ className = '' }: BrandIconProps) {
  // Slack's four-square hash arrangement — a monochrome interpretation of
  // the multicolored mark.
  return (
    <svg className={`${SIZE_CLASS} ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="9"  width="6" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="14.5" y="12" width="6" height="3" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9"   y="3.5" width="3" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="12"  y="14.5" width="3" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export type BrandSlug = 'notion' | 'gmail' | 'gcal' | 'slack';

export function BrandIcon({ brand, className }: { brand: BrandSlug; className?: string }) {
  switch (brand) {
    case 'notion': return <NotionIcon className={className} />;
    case 'gmail':  return <GmailIcon className={className} />;
    case 'gcal':   return <GoogleCalendarIcon className={className} />;
    case 'slack':  return <SlackIcon className={className} />;
  }
}
