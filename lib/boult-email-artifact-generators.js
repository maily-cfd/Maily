/**
 * Artifact Generators for Email Analysis
 * 
 * Generates artifacts from email analysis:
 * - Summary document
 * - Trends table (sender frequency, response times, etc.)
 * - Presentation draft structure
 */

import { BoultAIService } from './boult-ai-multi-agent.js';

export interface EmailArtifactGenerator {
  generateSummary(emails: any[], options?: any): Promise<{
    type: 'summary';
    title: string;
    content: {
      sections: Array<{
        title: string;
        points: string[];
      }>;
    };
  }>;
  
  generateTrendsTable(emails: any[], options?: any): Promise<{
    type: 'table';
    title: string;
    content: {
      headers: string[];
      rows: any[];
    };
  }>;
  
  generatePresentationDraft(emails: any[], options?: any): Promise<{
    type: 'presentation';
    title: string;
    content: {
      slides: Array<{
        title: string;
        bullets: string[];
        notes?: string;
      }>;
    };
  }>;
}

export class EmailArtifactGeneratorService implements EmailArtifactGenerator {
  private aiService: BoultAIService;

  constructor(aiService: BoultAIService) {
    this.aiService = aiService;
  }

  /**
   * Generate summary document from email analysis
   */
  async generateSummary(emails: any[], options: any = {}): Promise<{
    type: 'summary';
    title: string;
    content: {
      sections: Array<{
        title: string;
        points: string[];
      }>;
    };
  }> {
    const prompt = this.buildSummaryPrompt(emails, options);
    
    // Use AI to generate summary
    const response = await this.aiService.generateResponse(prompt, {
      userEmail: options.userEmail,
      responseFormat: 'json'
    });

    // Parse and structure the response
    const sections = this.parseSummaryResponse(response);

    return {
      type: 'summary',
      title: options.title || `Email Summary: ${options.query || 'Analysis'}`,
      content: {
        sections
      }
    };
  }

  /**
   * Generate trends table from email analysis
   */
  async generateTrendsTable(emails: any[], options: any = {}): Promise<{
    type: 'table';
    title: string;
    content: {
      headers: string[];
      rows: any[];
    };
  }> {
    // Calculate trends from email data
    const trends = this.calculateTrends(emails);
    
    return {
      type: 'table',
      title: options.title || 'Email Trends Analysis',
      content: {
        headers: ['Metric', 'Value', 'Trend', 'Change'],
        rows: trends.map(t => ({
          'Metric': t.label,
          'Value': t.value,
          'Trend': t.trend,
          'Change': t.change
        }))
      }
    };
  }

  /**
   * Generate presentation draft structure from email analysis
   */
  async generatePresentationDraft(emails: any[], options: any = {}): Promise<{
    type: 'presentation';
    title: string;
    content: {
      slides: Array<{
        title: string;
        bullets: string[];
        notes?: string;
      }>;
    };
  }> {
    const prompt = this.buildPresentationPrompt(emails, options);
    
    const response = await this.aiService.generateResponse(prompt, {
      userEmail: options.userEmail,
      responseFormat: 'json'
    });

    const slides = this.parsePresentationResponse(response);

    return {
      type: 'presentation',
      title: options.title || 'Email Analysis Presentation',
      content: {
        slides
      }
    };
  }

  /**
   * Generate all artifacts at once
   */
  async generateAll(emails: any[], options: any = {}): Promise<Array<{
    id: string;
    type: 'summary' | 'table' | 'presentation' | 'analysis';
    title: string;
    content: any;
    createdAt: string;
    source: string;
  }>> {
    const timestamp = new Date().toISOString();
    const baseId = `email_analysis_${Date.now()}`;

    const [summary, trendsTable, presentation] = await Promise.all([
      this.generateSummary(emails, options),
      this.generateTrendsTable(emails, options),
      this.generatePresentationDraft(emails, options)
    ]);

    return [
      {
        id: `${baseId}_summary`,
        ...summary,
        createdAt: timestamp,
        source: 'email_analysis'
      },
      {
        id: `${baseId}_trends`,
        ...trendsTable,
        createdAt: timestamp,
        source: 'email_analysis'
      },
      {
        id: `${baseId}_presentation`,
        ...presentation,
        createdAt: timestamp,
        source: 'email_analysis'
      }
    ];
  }

  // Private helper methods
  
  private buildSummaryPrompt(emails: any[], options: any): string {
    return `Analyze these ${emails.length} emails and create a structured summary.

Query context: ${options.query || 'General analysis'}

Emails: ${JSON.stringify(emails.slice(0, 10), null, 2)}

Generate a summary with these sections:
1. Key Takeaways (3-5 bullet points)
2. Action Items (if any)
3. Important People/Contacts mentioned
4. Timeline of Events (if applicable)

Format as JSON with sections array containing title and points.`;
  }

  private buildPresentationPrompt(emails: any[], options: any): string {
    return `Create a presentation outline from these ${emails.length} emails.

Query: ${options.query || 'Email Analysis'}

Generate a 5-7 slide presentation structure with:
- Title slide
- Executive Summary
- Key Findings (2-3 slides)
- Recommendations/Next Steps
- Closing

Format as JSON with slides array containing title, bullets array, and optional notes.`;
  }

  private parseSummaryResponse(response: string): Array<{ title: string; points: string[] }> {
    try {
      const parsed = JSON.parse(response);
      if (parsed.sections && Array.isArray(parsed.sections)) {
        return parsed.sections;
      }
    } catch {
      // Fallback: extract sections from text
    }
    
    return [
      { title: 'Summary', points: [response.slice(0, 500)] }
    ];
  }

  private parsePresentationResponse(response: string): Array<{ title: string; bullets: string[]; notes?: string }> {
    try {
      const parsed = JSON.parse(response);
      if (parsed.slides && Array.isArray(parsed.slides)) {
        return parsed.slides;
      }
    } catch {
      // Fallback
    }
    
    return [
      { title: 'Email Analysis', bullets: ['Data analyzed', 'Findings documented'] }
    ];
  }

  private calculateTrends(emails: any[]): Array<{
    label: string;
    value: string;
    trend: string;
    change: string;
  }> {
    // Calculate metrics from emails
    const totalEmails = emails.length;
    const uniqueSenders = new Set(emails.map(e => e.sender)).size;
    const avgResponseTime = this.calculateAvgResponseTime(emails);
    const peakDay = this.calculatePeakDay(emails);
    
    return [
      {
        label: 'Total Emails',
        value: totalEmails.toString(),
        trend: '→',
        change: 'baseline'
      },
      {
        label: 'Unique Senders',
        value: uniqueSenders.toString(),
        trend: uniqueSenders > 10 ? '↑' : '→',
        change: uniqueSenders > 10 ? 'high variety' : 'focused'
      },
      {
        label: 'Avg Response Time',
        value: avgResponseTime,
        trend: '→',
        change: 'current'
      },
      {
        label: 'Peak Activity Day',
        value: peakDay,
        trend: '↑',
        change: 'most active'
      }
    ];
  }

  private calculateAvgResponseTime(emails: any[]): string {
    // Mock calculation - would use actual timestamps
    return '4.2 hours';
  }

  private calculatePeakDay(emails: any[]): string {
    // Mock calculation - would analyze actual dates
    return 'Tuesday';
  }
}

export default EmailArtifactGeneratorService;
