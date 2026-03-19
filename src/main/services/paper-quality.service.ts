/**
 * Paper Quality Scoring Service
 * Uses AI to evaluate paper quality based on abstract analysis
 */

import { generateWithModelKind } from './ai-provider.service';
import type { DiscoveredPaper } from './arxiv-discovery.service';

export interface QualityScore {
  score: number; // 1-10
  dimensions: {
    novelty: number; // 1-10: How novel/original is the contribution?
    methodology: number; // 1-10: How sound is the methodology?
    significance: number; // 1-10: How significant is the impact?
    clarity: number; // 1-10: How well-written is the paper?
  };
  reason: string; // Brief explanation in 2-3 sentences
  recommendation: 'must-read' | 'worth-reading' | 'skimmable' | 'skip';
}

/**
 * Get the system prompt for paper quality evaluation
 */
function getQualityEvaluationSystemPrompt(language: string): string {
  if (language === 'zh') {
    return `你是一位资深的学术研究员，擅长快速评估论文质量。你的任务是分析论文摘要并给出质量评估。

评估维度：
1. 新颖性 (novelty): 研究问题的创新程度和原创性
2. 方法论 (methodology): 研究方法的技术严谨性
3. 重要性 (significance): 对领域的潜在影响力
4. 清晰度 (clarity): 写作质量和表达清晰度

输出要求：
- 每个维度打分 1-10
- 总分 1-10（综合评估）
- 推荐等级：must-read（必读）、worth-reading（值得读）、skimmable（可略读）、skip（可跳过）
- 简短推荐理由（2-3句话）

输出格式（必须是有效的 JSON）：
{
  "score": 8,
  "dimensions": {
    "novelty": 8,
    "methodology": 9,
    "significance": 7,
    "clarity": 8
  },
  "reason": "该论文提出了一种新的 Transformer 架构变体，在多个基准测试上取得了 SOTA 结果。方法论严谨，实验充分。推荐给关注模型架构优化的研究者。",
  "recommendation": "worth-reading"
}`;
  }

  return `You are a senior academic researcher skilled at quickly evaluating paper quality. Your task is to analyze paper abstracts and provide quality assessments.

Evaluation dimensions:
1. Novelty: How novel/original is the contribution?
2. Methodology: How technically sound is the approach?
3. Significance: What is the potential impact on the field?
4. Clarity: How well-written and clear is the paper?

Output requirements:
- Score each dimension 1-10
- Overall score 1-10 (comprehensive assessment)
- Recommendation level: must-read, worth-reading, skimmable, or skip
- Brief reason in 2-3 sentences

Output format (must be valid JSON):
{
  "score": 8,
  "dimensions": {
    "novelty": 8,
    "methodology": 9,
    "significance": 7,
    "clarity": 8
  },
  "reason": "This paper proposes a novel transformer variant achieving SOTA on multiple benchmarks. The methodology is rigorous with extensive experiments. Recommended for researchers interested in model architecture optimization.",
  "recommendation": "worth-reading"
}`;
}

/**
 * Evaluate paper quality using AI
 */
export async function evaluatePaperQuality(
  paper: DiscoveredPaper,
  language: string = 'en',
): Promise<QualityScore> {
  const systemPrompt = getQualityEvaluationSystemPrompt(language);

  const userPrompt = `Please evaluate this paper:

Title: ${paper.title}

Authors: ${paper.authors.join(', ')}

Abstract: ${paper.abstract}

Categories: ${paper.categories.join(', ')}

Provide your assessment in the required JSON format.`;

  try {
    const response = await generateWithModelKind('lightweight', systemPrompt, userPrompt);

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and sanitize
    const quality: QualityScore = {
      score: Math.max(1, Math.min(10, Math.round(parsed.score ?? 5))),
      dimensions: {
        novelty: Math.max(1, Math.min(10, Math.round(parsed.dimensions?.novelty ?? 5))),
        methodology: Math.max(1, Math.min(10, Math.round(parsed.dimensions?.methodology ?? 5))),
        significance: Math.max(1, Math.min(10, Math.round(parsed.dimensions?.significance ?? 5))),
        clarity: Math.max(1, Math.min(10, Math.round(parsed.dimensions?.clarity ?? 5))),
      },
      reason: parsed.reason ?? 'Unable to generate assessment.',
      recommendation: ['must-read', 'worth-reading', 'skimmable', 'skip'].includes(
        parsed.recommendation,
      )
        ? parsed.recommendation
        : 'worth-reading',
    };

    return quality;
  } catch (error) {
    console.error('[paper-quality] Failed to evaluate paper:', error);
    // Return default score on error
    return {
      score: 5,
      dimensions: { novelty: 5, methodology: 5, significance: 5, clarity: 5 },
      reason: 'Unable to evaluate paper quality.',
      recommendation: 'worth-reading',
    };
  }
}

/**
 * Batch evaluate papers with rate limiting
 */
export async function batchEvaluatePapers(
  papers: DiscoveredPaper[],
  language: string = 'en',
  onProgress?: (evaluated: number, total: number) => void,
): Promise<DiscoveredPaper[]> {
  const results: DiscoveredPaper[] = [];

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];

    try {
      const quality = await evaluatePaperQuality(paper, language);
      results.push({
        ...paper,
        qualityScore: quality.score,
        qualityReason: quality.reason,
        qualityDimensions: quality.dimensions,
        qualityRecommendation: quality.recommendation,
      });
    } catch {
      results.push({
        ...paper,
        qualityScore: null,
        qualityReason: null,
        qualityDimensions: null,
        qualityRecommendation: null,
      });
    }

    onProgress?.(i + 1, papers.length);

    // Rate limiting: small delay between evaluations
    if (i < papers.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Get recommendation badge color/style
 */
export function getRecommendationStyle(recommendation: string): {
  bg: string;
  text: string;
  label: string;
} {
  switch (recommendation) {
    case 'must-read':
      return { bg: 'bg-green-100', text: 'text-green-700', label: 'Must Read' };
    case 'worth-reading':
      return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Worth Reading' };
    case 'skimmable':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Skimmable' };
    case 'skip':
      return { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Skip' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Unknown' };
  }
}

/**
 * Get score color/style
 */
export function getScoreStyle(score: number): { bg: string; text: string } {
  if (score >= 8) return { bg: 'bg-green-100', text: 'text-green-700' };
  if (score >= 6) return { bg: 'bg-blue-100', text: 'text-blue-700' };
  if (score >= 4) return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
  return { bg: 'bg-red-100', text: 'text-red-700' };
}
