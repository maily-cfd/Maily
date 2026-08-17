/**
 * Canvas Artifacts Component
 * 
 * Displays generated artifacts in the canvas:
 * - Summary documents
 * - Sheet-style table data
 * - Presentation outlines
 * - Email analysis outputs
 */

'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileText, 
  Table2, 
  Presentation,
  Download,
  ChevronDown,
  ChevronRight,
  Copy,
  CheckCircle2
} from 'lucide-react';

type ArtifactType = 'summary' | 'table' | 'presentation' | 'analysis';

interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  description?: string;
  content: any;
  createdAt: string;
  source?: string; // e.g., 'email_analysis', 'calendar_analysis'
}

interface CanvasArtifactsProps {
  artifacts: Artifact[];
  onDownload?: (artifact: Artifact) => void;
}

export function CanvasArtifacts({ artifacts, onDownload }: CanvasArtifactsProps) {
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-black/60 dark:text-white/60 uppercase tracking-wider">
          Generated Artifacts
        </h4>
        <span className="text-xs text-neutral-600 dark:text-boult-fg-muted">{artifacts.length} items</span>
      </div>
      
      <div className="grid gap-3">
        {artifacts.map((artifact, index) => (
          <ArtifactCard 
            key={artifact.id} 
            artifact={artifact} 
            index={index}
            onDownload={onDownload}
          />
        ))}
      </div>
    </div>
  );
}

function ArtifactCard({ 
  artifact, 
  index,
  onDownload 
}: { 
  artifact: Artifact; 
  index: number;
  onDownload?: (artifact: Artifact) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const config = {
    summary: { icon: FileText, label: 'Summary', color: 'bg-blue-500/20 text-blue-400' },
    table: { icon: Table2, label: 'Data Table', color: 'bg-green-500/20 text-green-400' },
    presentation: { icon: Presentation, label: 'Presentation', color: 'bg-purple-500/20 text-purple-400' },
    analysis: { icon: FileText, label: 'Analysis', color: 'bg-amber-500/20 text-amber-400' }
  }[artifact.type];

  const Icon = config.icon;

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(artifact.content, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="bg-boult-surface-hover border border-neutral-200 dark:border-boult-border rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div 
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-neutral-100 dark:hover:bg-boult-raised/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.color}`}>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h5 className="font-medium text-black dark:text-white truncate">{artifact.title}</h5>
            <span className={`text-xs px-2 py-0.5 rounded-full ${config.color}`}>
              {config.label}
            </span>
          </div>
          {artifact.description && (
            <p className="text-sm text-neutral-600 dark:text-boult-fg-secondary truncate">{artifact.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className="p-2 hover:bg-neutral-100 dark:bg-boult-raised rounded-lg transition-colors"
            title="Copy content"
          >
            {copied ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-neutral-600 dark:text-boult-fg-secondary" />
            )}
          </button>
          
          {onDownload && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload(artifact);
              }}
              className="p-2 hover:bg-neutral-100 dark:bg-boult-raised rounded-lg transition-colors"
              title="Download"
            >
              <Download className="w-4 h-4 text-neutral-600 dark:text-boult-fg-secondary" />
            </button>
          )}
          
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-neutral-600 dark:text-boult-fg-secondary" />
          ) : (
            <ChevronRight className="w-5 h-5 text-neutral-600 dark:text-boult-fg-secondary" />
          )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-neutral-200 dark:border-boult-border"
          >
            <div className="p-4">
              {artifact.type === 'table' && <TableView data={artifact.content} />}
              {artifact.type === 'summary' && <SummaryView content={artifact.content} />}
              {artifact.type === 'presentation' && <PresentationView content={artifact.content} />}
              {artifact.type === 'analysis' && <AnalysisView content={artifact.content} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Table View Component
function TableView({ data }: { data: { headers: string[]; rows: any[] } }) {
  if (!data?.headers || !data?.rows) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-boult-divider">
            {data.headers.map((header, i) => (
              <th key={i} className="text-left py-2 px-3 text-neutral-600 dark:text-boult-fg-secondary font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-b border-neutral-200 dark:border-boult-border/50 last:border-0">
              {data.headers.map((header, j) => (
                <td key={j} className="py-2 px-3 text-black dark:text-white">
                  {row[header] || row[j] || '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Summary View Component
function SummaryView({ content }: { content: { sections: Array<{ title: string; points: string[] }> } }) {
  return (
    <div className="space-y-4">
      {content.sections?.map((section, i) => (
        <div key={i}>
          <h6 className="text-sm font-medium text-black/80 dark:text-white/80 mb-2">{section.title}</h6>
          <ul className="space-y-1">
            {section.points?.map((point, j) => (
              <li key={j} className="text-sm text-neutral-600 dark:text-boult-fg-secondary flex items-start gap-2">
                <span className="text-gray-600 mt-1">•</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Presentation View Component
function PresentationView({ content }: { content: { slides: Array<{ title: string; bullets: string[]; notes?: string }> } }) {
  return (
    <div className="space-y-4">
      {content.slides?.map((slide, i) => (
        <div key={i} className="bg-neutral-50 dark:bg-boult-surface/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-neutral-600 dark:text-boult-fg-muted font-mono">Slide {i + 1}</span>
            <h6 className="text-sm font-medium text-black dark:text-white">{slide.title}</h6>
          </div>
          <ul className="space-y-1">
            {slide.bullets?.map((bullet, j) => (
              <li key={j} className="text-sm text-neutral-600 dark:text-boult-fg-secondary flex items-start gap-2">
                <span className="text-gray-600">→</span>
                {bullet}
              </li>
            ))}
          </ul>
          {slide.notes && (
            <p className="text-xs text-neutral-600 dark:text-boult-fg-muted mt-3 italic">{slide.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// Analysis View Component
function AnalysisView({ content }: { content: { metrics: Array<{ label: string; value: string; change?: string }>; insights: string[] } }) {
  return (
    <div className="space-y-4">
      {/* Metrics */}
      {content.metrics && (
        <div className="grid grid-cols-3 gap-3">
          {content.metrics.map((metric, i) => (
            <div key={i} className="bg-neutral-50 dark:bg-boult-surface/50 rounded-lg p-3">
              <p className="text-xs text-neutral-600 dark:text-boult-fg-muted">{metric.label}</p>
              <p className="text-lg font-semibold text-black dark:text-white">{metric.value}</p>
              {metric.change && (
                <p className={`text-xs ${metric.change.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                  {metric.change}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Insights */}
      {content.insights && (
        <div>
          <h6 className="text-sm font-medium text-black/80 dark:text-white/80 mb-2">Key Insights</h6>
          <ul className="space-y-1">
            {content.insights.map((insight, i) => (
              <li key={i} className="text-sm text-neutral-600 dark:text-boult-fg-secondary flex items-start gap-2">
                <span className="text-amber-400">💡</span>
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CanvasArtifacts;
