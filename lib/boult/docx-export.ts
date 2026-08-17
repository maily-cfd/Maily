/**
 * Converts Markdown → a premium .docx Blob (Google Docs-compatible).
 * Clean white document: proper heading hierarchy, light-blue table headers,
 * alternating rows, page header/footer, 1-inch margins.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  convertInchesToTwip,
  LevelFormat,
  Header,
  Footer,
  PageNumberElement,
} from 'docx';

// ─── Colours (document-safe: dark text on white) ──────────────────────────────
const C = {
  black:       '111111',
  body:        '333333',
  h1:          '111111',
  h2:          '1F2937',
  h3:          '374151',
  h4:          '4B5563',
  h5:          '6B7280',
  h6:          '9CA3AF',
  tableHead:   'E8F0FE', // Google Docs–style light-blue header row
  tableAlt:    'F8F9FA', // light grey alternate row
  tableWhite:  'FFFFFF',
  tableBorder: 'C9D1D9',
  code:        'F1F3F4', // light-grey code background
  codeText:    '37474F',
  blockquote:  'E8EAED',
  bqText:      '5F6368',
  link:        '1967D2', // Google Docs link blue
  hr:          'E0E0E0',
  headerText:  '9AA0A6',
};

// ─── Inline parser ────────────────────────────────────────────────────────────

interface Span {
  text: string;
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
  link?: string;
}

function parseInline(raw: string): TextRun[] {
  // Strip inline HTML escapes from our html converter (shouldn't appear in raw MD)
  const text = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  const tokens = text.split(
    /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|__[^_]+__|_[^_]+_|\[([^\]]+)\]\(([^)]+)\))/,
  );

  const runs: TextRun[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;

    if (/^\*\*\*/.test(t)) {
      runs.push(new TextRun({ text: t.slice(3, -3), bold: true, italics: true, font: 'Calibri', color: C.body }));
    } else if (/^\*\*|^__/.test(t)) {
      const inner = /^\*\*/.test(t) ? t.slice(2, -2) : t.slice(2, -2);
      runs.push(new TextRun({ text: inner, bold: true, font: 'Calibri', color: C.black }));
    } else if (/^\*|^_/.test(t)) {
      runs.push(new TextRun({ text: t.slice(1, -1), italics: true, font: 'Calibri', color: C.body }));
    } else if (/^`/.test(t)) {
      runs.push(new TextRun({
        text: t.slice(1, -1),
        font: 'Courier New',
        size: 19,
        color: C.codeText,
        shading: { type: ShadingType.SOLID, fill: C.code, color: C.code },
      }));
    } else if (/^\[/.test(t)) {
      // Link — extract text from the next captured group
      const linkMatch = t.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        runs.push(new TextRun({
          text: linkMatch[1],
          color: C.link,
          underline: { type: 'single' as any },
          font: 'Calibri',
        }));
        i += 2; // skip the two capture groups
      } else {
        runs.push(new TextRun({ text: t, font: 'Calibri', color: C.body }));
      }
    } else {
      runs.push(new TextRun({ text: t, font: 'Calibri', color: C.body }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: '', font: 'Calibri' })];
}

// ─── Block parser ─────────────────────────────────────────────────────────────

const HEADING_MAP: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function tableCell(text: string, isHeader: boolean, colCount: number, rowIdx: number): TableCell {
  const fill = isHeader
    ? C.tableHead
    : rowIdx % 2 === 1 ? C.tableAlt : C.tableWhite;

  return new TableCell({
    shading: { fill, type: ShadingType.SOLID, color: fill },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: C.tableBorder },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: C.tableBorder },
      left:   { style: BorderStyle.SINGLE, size: 4, color: C.tableBorder },
      right:  { style: BorderStyle.SINGLE, size: 4, color: C.tableBorder },
    },
    width: { size: Math.floor(9072 / colCount), type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: isHeader
          ? [new TextRun({ text: text.trim(), bold: true, font: 'Calibri', size: 20, color: C.black })]
          : parseInline(text),
        spacing: { before: 0, after: 0 },
      }),
    ],
  });
}

function buildDocxChildren(markdown: string): (Paragraph | Table)[] {
  const lines = markdown.split('\n');
  const children: (Paragraph | Table)[] = [];
  let tableRows: string[][] = [];
  let tableHasHeader = false;
  let bodyRowIdx = 0;

  const flushTable = () => {
    if (!tableRows.length) return;
    const colCount = Math.max(...tableRows.map(r => r.length));
    bodyRowIdx = 0;

    const rows = tableRows.map((cells, rowIdx) => {
      const isHeader = rowIdx === 0 && tableHasHeader;
      if (!isHeader) bodyRowIdx++;
      return new TableRow({
        tableHeader: isHeader,
        children: cells.map(cell => tableCell(cell, isHeader, colCount, bodyRowIdx)),
      });
    });

    children.push(
      new Table({
        rows,
        width: { size: 9072, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }),
      new Paragraph({ text: '', spacing: { before: 80, after: 80 } }),
    );
    tableRows = [];
    tableHasHeader = false;
    bodyRowIdx = 0;
  };

  for (const line of lines) {
    // ── Tables ────────────────────────────────────────────────────────────────
    if (line.startsWith('|')) {
      const cells = line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1);
      if (cells.every(c => /^[-:\s]+$/.test(c))) {
        tableHasHeader = tableRows.length > 0;
        continue;
      }
      tableRows.push(cells);
      continue;
    } else {
      flushTable();
    }

    // ── Headings ──────────────────────────────────────────────────────────────
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      const n = hm[1].length;
      const headingColors = [C.h1, C.h2, C.h3, C.h4, C.h5, C.h6];
      const headingSizes  = [56, 42, 32, 26, 22, 20]; // half-points (28pt, 21pt, 16pt…)
      children.push(
        new Paragraph({
          heading: HEADING_MAP[n],
          children: [new TextRun({
            text: hm[2].replace(/[*_`]/g, ''), // strip markdown syntax from headings
            bold: n <= 4,
            italics: n >= 5,
            font: 'Calibri',
            color: headingColors[n - 1],
            size: headingSizes[n - 1],
          })],
          spacing: {
            before: [400, 320, 240, 200, 160, 120][n - 1],
            after:  [120, 100,  80,  60,  40,  40][n - 1],
          },
          ...(n === 1 ? {
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.hr } },
          } : {}),
        }),
      );
      continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      children.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.hr } },
          spacing: { before: 120, after: 120 },
          children: [],
        }),
      );
      continue;
    }

    // ── Bullet list ───────────────────────────────────────────────────────────
    const ulm = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulm) {
      children.push(
        new Paragraph({
          numbering: { reference: 'bullet-list', level: 0 },
          children: parseInline(ulm[2]),
          spacing: { before: 40, after: 40, line: 300 },
        }),
      );
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────────────
    const olm = line.match(/^\d+\.\s+(.+)/);
    if (olm) {
      children.push(
        new Paragraph({
          numbering: { reference: 'numbered-list', level: 0 },
          children: parseInline(olm[1]),
          spacing: { before: 40, after: 40, line: 300 },
        }),
      );
      continue;
    }

    // ── Blockquote ────────────────────────────────────────────────────────────
    const bqm = line.match(/^>\s*(.+)/);
    if (bqm) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: bqm[1], italics: true, font: 'Calibri', color: C.bqText })],
          indent: { left: convertInchesToTwip(0.35) },
          border: { left: { style: BorderStyle.SINGLE, size: 16, color: C.blockquote } },
          spacing: { before: 80, after: 80, line: 300 },
        }),
      );
      continue;
    }

    // ── Empty line ────────────────────────────────────────────────────────────
    if (line.trim() === '') {
      children.push(new Paragraph({ text: '', spacing: { before: 0, after: 100 } }));
      continue;
    }

    // ── Paragraph ────────────────────────────────────────────────────────────
    children.push(
      new Paragraph({
        children: parseInline(line),
        spacing: { before: 40, after: 80, line: 320 },
      }),
    );
  }

  flushTable();
  return children;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function markdownToDocxBlob(markdown: string, title: string): Promise<Blob> {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const doc = new Document({
    title,
    description: `Generated by Boult AI · ${dateStr}`,

    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              run: { font: 'Symbol', color: C.body },
              paragraph: {
                indent: { left: convertInchesToTwip(0.375), hanging: convertInchesToTwip(0.25) },
              },
            },
          }],
        },
        {
          reference: 'numbered-list',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              run: { font: 'Calibri', color: C.body },
              paragraph: {
                indent: { left: convertInchesToTwip(0.375), hanging: convertInchesToTwip(0.25) },
              },
            },
          }],
        },
      ],
    },

    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: C.body },       // 11pt body
          paragraph: { spacing: { line: 320, lineRule: 'auto' as any } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 56, bold: true, color: C.h1, font: 'Calibri' },
          paragraph: { spacing: { before: 400, after: 120 } },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 42, bold: true, color: C.h2, font: 'Calibri' },
          paragraph: { spacing: { before: 320, after: 100 } },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, color: C.h3, font: 'Calibri' },
          paragraph: { spacing: { before: 240, after: 80 } },
        },
        {
          id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, color: C.h4, font: 'Calibri' },
          paragraph: { spacing: { before: 200, after: 60 } },
        },
        {
          id: 'Heading5', name: 'Heading 5', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, italics: true, color: C.h5, font: 'Calibri' },
          paragraph: { spacing: { before: 160, after: 40 } },
        },
        {
          id: 'Heading6', name: 'Heading 6', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 20, italics: true, color: C.h6, font: 'Calibri' },
          paragraph: { spacing: { before: 120, after: 40 } },
        },
      ],
    },

    sections: [
      {
        properties: {
          page: {
            margin: {
              top:    convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left:   convertInchesToTwip(1),
              right:  convertInchesToTwip(1),
              header: convertInchesToTwip(0.5),
              footer: convertInchesToTwip(0.5),
            },
          },
        },

        // ── Page header: title on left, date on right ────────────────────────
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: title, font: 'Calibri', size: 16, color: C.headerText }),
                  new TextRun({ text: '\t', font: 'Calibri', size: 16 }),
                  new TextRun({ text: dateStr, font: 'Calibri', size: 16, color: C.headerText }),
                ],
                tabStops: [{ type: 'right' as any, position: 9072 }],
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.hr } },
                spacing: { after: 0 },
              }),
            ],
          }),
        },

        // ── Page footer: "Generated by Boult AI" + page number ──────────────
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: 'Generated by Boult AI  ·  Page ', font: 'Calibri', size: 16, color: C.headerText }),
                  new PageNumberElement(),
                  new TextRun({ text: '', font: 'Calibri', size: 16, color: C.headerText }),
                ],
                alignment: AlignmentType.CENTER,
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.hr } },
                spacing: { before: 80 },
              }),
            ],
          }),
        },

        children: buildDocxChildren(markdown),
      },
    ],
  });

  return Packer.toBlob(doc);
}

export function triggerDocxDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
