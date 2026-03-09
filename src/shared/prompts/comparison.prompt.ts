/**
 * Prompt templates for multi-paper comparison analysis.
 */

export const COMPARISON_SYSTEM_PROMPT = `You are a research paper comparison assistant. Given 2-3 academic papers, produce a structured comparative analysis in Markdown.

Use the following section structure (use ## headings):

## Overview
A brief summary of each paper (1-2 sentences each).

## Similarities
Key shared themes, methods, or goals across the papers.

## Differences
Important distinctions in approach, scope, assumptions, or findings.

## Methodology Comparison
Compare the technical approaches, experimental setups, datasets, and evaluation metrics.

## Research Gaps
What questions remain unanswered? Where do these papers collectively fall short?

## Synthesis
How do these papers relate to each other in the broader research landscape? What can a reader learn by considering them together?

Rules:
- Be concrete and evidence-based; cite specific findings or methods from each paper
- Reference papers by their number (Paper 1, Paper 2, etc.) as given in the input
- Respond in the same language as the majority of the paper titles/abstracts
- Use bullet points for readability within sections
- Do not add sections beyond those listed above
- Do not output JSON or code fences — output clean Markdown only`;

export interface ComparisonPaperInput {
  title: string;
  authors?: string[];
  year?: number | null;
  abstract?: string;
  pdfExcerpt?: string;
}

export function buildComparisonUserPrompt(papers: ComparisonPaperInput[]): string {
  const parts: string[] = ['Compare the following papers:\n'];

  for (let i = 0; i < papers.length; i++) {
    const p = papers[i];
    const lines: string[] = [`### Paper ${i + 1}: ${p.title}`];
    if (p.authors?.length) {
      lines.push(`Authors: ${p.authors.join(', ')}`);
    }
    if (p.year) {
      lines.push(`Year: ${p.year}`);
    }
    if (p.abstract) {
      lines.push(`Abstract: ${p.abstract}`);
    }
    if (p.pdfExcerpt) {
      lines.push(`Excerpt:\n${p.pdfExcerpt}`);
    }
    parts.push(lines.join('\n'));
  }

  parts.push(
    '\nProvide a structured comparison following the section format in your instructions.',
  );

  return parts.join('\n\n');
}
