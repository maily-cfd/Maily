'use client';

/**
 * Canvas Block Renderers
 *
 * Three rich content blocks the LLM can author inside Canvas markdown by
 * writing fenced code blocks. The CanvasPanel MarkdownView's `code` handler
 * detects the fence language and dispatches to one of these renderers.
 *
 * Block types:
 *   ```boult-table   → BoultTable    (Clay-style typed table)
 *   ```boult-steps   → BoultSteps    (numbered process steps with status)
 *   ```boult-gallery → BoultGallery  (image grid)
 *
 * Every block accepts a JSON payload. The parser is tolerant: if JSON is
 * invalid or missing required fields, the renderer falls through to a plain
 * <pre> code block so the user sees the source instead of a broken UI.
 */

import React from 'react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// boult-table
// ─────────────────────────────────────────────────────────────────────────────

export type TableColumnType =
  | 'text'
  | 'number'
  | 'score'      // 0-100 with colored chip
  | 'badge'      // small colored pill
  | 'url'        // link with hostname
  | 'image'      // small avatar/thumbnail
  | 'date'
  | 'email';

export interface TableColumn {
  /** Display label shown in the header row. */
  label: string;
  /** Cell type — drives the renderer. Default 'text'. */
  type?: TableColumnType;
  /** Optional fixed width in px. */
  width?: number;
}

export interface BoultTableData {
  /** Title shown above the table (matches the Clay-style header card). */
  title?: string;
  /** Optional subtitle/description. */
  subtitle?: string;
  /** Column definitions in left-to-right order. */
  columns: TableColumn[];
  /** Rows — each row is an array of cell values aligned to columns. */
  rows: any[][];
  /** Optional CTA shown in the header row (right side). */
  cta?: { label: string; url?: string };
}

export function parseBoultTable(raw: string): BoultTableData | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    return parsed as BoultTableData;
  } catch {
    return null;
  }
}

function scoreColor(score: number): { bg: string; text: string } {
  if (score >= 80) return { bg: 'bg-emerald-500/15', text: 'text-emerald-400' };
  if (score >= 60) return { bg: 'bg-lime-500/15', text: 'text-lime-400' };
  if (score >= 40) return { bg: 'bg-amber-500/15', text: 'text-amber-400' };
  return { bg: 'bg-rose-500/15', text: 'text-rose-400' };
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function renderCell(value: any, col: TableColumn) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-boult-fg-muted/40">—</span>;
  }
  const type = col.type || 'text';
  switch (type) {
    case 'score': {
      const n = Number(value);
      if (isNaN(n)) return <span className="text-boult-fg-secondary">{String(value)}</span>;
      const { bg, text } = scoreColor(n);
      return (
        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11.5px] font-semibold', bg, text)}>
          <span className={cn('w-1.5 h-1.5 rounded-sm', text.replace('text-', 'bg-'))} />
          {Math.round(n)}
        </span>
      );
    }
    case 'badge':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-boult-surface text-[11px] font-medium text-boult-fg-secondary border border-boult-border">
          {String(value)}
        </span>
      );
    case 'url': {
      const url = String(value);
      return (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="text-[12.5px] text-white/80 hover:text-white underline underline-offset-2 truncate inline-block max-w-[280px]">
          {hostnameOf(url)}
        </a>
      );
    }
    case 'image': {
      const url = String(value);
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-7 h-7 rounded-md object-cover border border-boult-border" />
      );
    }
    case 'email':
      return <span className="text-[12.5px] font-mono text-boult-fg-secondary truncate inline-block max-w-[220px]">{String(value)}</span>;
    case 'date':
      return <span className="text-[12.5px] text-boult-fg-tertiary">{String(value)}</span>;
    case 'number':
      return <span className="text-[12.5px] font-mono text-boult-fg-secondary tabular-nums">{String(value)}</span>;
    case 'text':
    default:
      return <span className="text-[12.5px] text-boult-fg-secondary line-clamp-2">{String(value)}</span>;
  }
}

export function BoultTable({ data }: { data: BoultTableData }) {
  return (
    <div className="my-5 rounded-2xl border border-boult-border overflow-hidden bg-boult-surface/40">
      {(data.title || data.subtitle || data.cta) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-boult-border bg-boult-elevated/40">
          <div className="min-w-0">
            {data.title && (
              <div className="flex items-baseline gap-2">
                <h3 className="text-[14px] font-semibold text-boult-fg truncate">{data.title}</h3>
                <span className="text-[11px] text-boult-fg-tertiary">{data.columns.length} columns · {data.rows.length} rows</span>
              </div>
            )}
            {data.subtitle && <p className="text-[11.5px] text-boult-fg-muted mt-0.5 truncate">{data.subtitle}</p>}
          </div>
          {data.cta && (
            data.cta.url ? (
              <a href={data.cta.url} target="_blank" rel="noopener noreferrer"
                className="shrink-0 px-3 py-1.5 rounded-lg bg-boult-fg text-boult-fg-inverse text-[11.5px] font-semibold hover:opacity-90 transition-all">
                {data.cta.label}
              </a>
            ) : (
              <span className="shrink-0 px-3 py-1.5 rounded-lg bg-boult-raised/60 text-boult-fg-secondary text-[11.5px] font-semibold border border-boult-border">
                {data.cta.label}
              </span>
            )
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-boult-elevated/20">
              {data.columns.map((c, i) => (
                <th key={i} style={c.width ? { width: c.width } : undefined}
                  className="px-4 py-2.5 text-[10.5px] font-bold text-boult-fg-tertiary uppercase tracking-wider border-b border-boult-border whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className={cn('border-b border-boult-border/60 last:border-0 hover:bg-boult-elevated/30 transition-colors',
                ri % 2 === 1 && 'bg-boult-elevated/10')}>
                {data.columns.map((col, ci) => (
                  <td key={ci} className="px-4 py-2.5 align-middle">
                    {renderCell(row[ci], col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.rows.length === 0 && (
          <div className="py-8 text-center text-[12.5px] text-boult-fg-muted">No rows.</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// boult-steps
// ─────────────────────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BoultStep {
  label: string;
  description?: string;
  status?: StepStatus;
}

export interface BoultStepsData {
  title?: string;
  steps: BoultStep[];
}

export function parseBoultSteps(raw: string): BoultStepsData | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.steps)) return null;
    return parsed as BoultStepsData;
  } catch {
    return null;
  }
}

function statusDot(status?: StepStatus) {
  switch (status) {
    case 'completed':
      return <span className="w-[18px] h-[18px] rounded-full bg-emerald-500/20 flex items-center justify-center"><span className="w-2 h-2 rounded-full bg-emerald-400" /></span>;
    case 'running':
      return <span className="w-[18px] h-[18px] rounded-full bg-indigo-500/20 flex items-center justify-center animate-pulse"><span className="w-2 h-2 rounded-full bg-indigo-400" /></span>;
    case 'failed':
      return <span className="w-[18px] h-[18px] rounded-full bg-rose-500/20 flex items-center justify-center"><span className="w-2 h-2 rounded-full bg-rose-400" /></span>;
    case 'pending':
    default:
      return <span className="w-[18px] h-[18px] rounded-full border border-boult-border flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-boult-fg-muted" /></span>;
  }
}

export function BoultSteps({ data }: { data: BoultStepsData }) {
  return (
    <div className="my-5">
      {data.title && (
        <div className="text-[10.5px] font-bold text-boult-fg-tertiary uppercase tracking-wider mb-3">{data.title}</div>
      )}
      <ol className="list-none pl-0 space-y-3">
        {data.steps.map((step, i) => (
          <li key={i} className="relative pl-7">
            {/* Vertical connector — not on the last item */}
            {i < data.steps.length - 1 && (
              <span className="absolute left-[8.5px] top-[20px] bottom-[-12px] w-px bg-boult-border" />
            )}
            <span className="absolute left-0 top-[1px]">{statusDot(step.status)}</span>
            <div className="text-[13.5px] text-boult-fg-secondary leading-relaxed">{step.label}</div>
            {step.description && (
              <div className="text-[12.5px] text-boult-fg-muted mt-1 leading-relaxed">{step.description}</div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// boult-gallery
// ─────────────────────────────────────────────────────────────────────────────

export interface GalleryImage {
  src: string;
  alt?: string;
  caption?: string;
  url?: string;
}

export interface BoultGalleryData {
  title?: string;
  layout?: 'grid' | 'row';
  images: GalleryImage[];
}

export function parseBoultGallery(raw: string): BoultGalleryData | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.images)) return null;
    return parsed as BoultGalleryData;
  } catch {
    return null;
  }
}

export function BoultGallery({ data }: { data: BoultGalleryData }) {
  const layout = data.layout || 'grid';
  return (
    <div className="my-5">
      {data.title && (
        <div className="text-[10.5px] font-bold text-boult-fg-tertiary uppercase tracking-wider mb-3">{data.title}</div>
      )}
      <div className={cn(
        layout === 'row'
          ? 'flex gap-3 overflow-x-auto pb-2'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3',
      )}>
        {data.images.map((img, i) => {
          const inner = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt || ''}
                className={cn(
                  'rounded-xl object-cover border border-boult-border bg-boult-surface w-full',
                  layout === 'row' ? 'h-32 w-32 shrink-0' : 'aspect-square',
                )} />
              {img.caption && (
                <p className="text-[11.5px] text-boult-fg-muted mt-1.5 line-clamp-2">{img.caption}</p>
              )}
            </>
          );
          return img.url ? (
            <a key={i} href={img.url} target="_blank" rel="noopener noreferrer"
              className={cn('block group', layout === 'row' && 'shrink-0')}>
              {inner}
            </a>
          ) : (
            <div key={i} className={cn(layout === 'row' && 'shrink-0')}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
