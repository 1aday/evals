// Evaluation types matching the Avultor structured output schema

export interface Evidence {
  answer: 'A' | 'B';
  impact: 'favorable' | 'unfavorable';
  quote: string;
  rationale: string;
}

export interface CriteriaScore {
  score: number;
  justification: string;
  evidence: Evidence[];
}

export interface CriterionPair {
  A: CriteriaScore;
  B: CriteriaScore;
}

export interface OverallResult {
  weighted_total_score: number;
  summary: string;
}

export interface EvaluationResult {
  criteria_scores: {
    task_understanding: CriterionPair;
    correctness_reasoning: CriterionPair;
    depth_coverage_usefulness: CriterionPair;
    actionability_specificity: CriterionPair;
    clarity_structure: CriterionPair;
    constraints_tradeoffs_uncertainty: CriterionPair;
    insight_originality: CriterionPair;
  };
  overall: {
    A: OverallResult;
    B: OverallResult;
  };
  winner: 'A' | 'B' | 'tie';
  winner_rationale: string;
  web_search_used?: boolean;
}

export interface EvaluationApiResponse {
  evaluation: EvaluationResult;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
  };
}

// Criteria display configuration
export const CRITERIA_CONFIG: Record<keyof EvaluationResult['criteria_scores'], {
  name: string;
  shortName: string;
  description: string;
  weight: number;
  icon: string;
}> = {
  task_understanding: {
    name: 'Task Understanding & Goal Fit',
    shortName: 'Task Fit',
    description: 'Addresses the actual question, respects constraints, stays on topic',
    weight: 1.0,
    icon: '🎯',
  },
  correctness_reasoning: {
    name: 'Correctness & Reasoning Quality',
    shortName: 'Reasoning',
    description: 'Logical correctness, factual soundness, reasoning transparency',
    weight: 2.0,
    icon: '🧠',
  },
  depth_coverage_usefulness: {
    name: 'Depth, Coverage & Usefulness',
    shortName: 'Depth',
    description: 'Covers key aspects, goes beyond surface level, prioritizes well',
    weight: 1.5,
    icon: '📊',
  },
  actionability_specificity: {
    name: 'Actionability & Specificity',
    shortName: 'Actionable',
    description: 'Concrete guidance, specific details, implementable advice',
    weight: 1.5,
    icon: '⚡',
  },
  clarity_structure: {
    name: 'Clarity, Structure & Organization',
    shortName: 'Clarity',
    description: 'Logical organization, easy to follow, minimal filler',
    weight: 1.0,
    icon: '✨',
  },
  constraints_tradeoffs_uncertainty: {
    name: 'Constraints, Tradeoffs & Uncertainty',
    shortName: 'Tradeoffs',
    description: 'Handles limits intelligently, shows awareness of tradeoffs',
    weight: 0.5,
    icon: '⚖️',
  },
  insight_originality: {
    name: 'Insight & Originality',
    shortName: 'Insight',
    description: 'Non-trivial angles, avoids generic answers, smart ideas',
    weight: 0.5,
    icon: '💡',
  },
};

// Get score color based on value
export function getScoreColor(score: number): string {
  if (score >= 9) return 'text-emerald-600';
  if (score >= 7) return 'text-green-600';
  if (score >= 5) return 'text-amber-600';
  if (score >= 3) return 'text-orange-600';
  return 'text-red-600';
}

export function getScoreBgColor(score: number): string {
  if (score >= 9) return 'bg-emerald-500';
  if (score >= 7) return 'bg-green-500';
  if (score >= 5) return 'bg-amber-500';
  if (score >= 3) return 'bg-orange-500';
  return 'bg-red-500';
}

export function getScoreGradient(score: number): string {
  if (score >= 9) return 'from-emerald-400 to-emerald-600';
  if (score >= 7) return 'from-green-400 to-green-600';
  if (score >= 5) return 'from-amber-400 to-amber-600';
  if (score >= 3) return 'from-orange-400 to-orange-600';
  return 'from-red-400 to-red-600';
}

export function getScoreLabel(score: number): string {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Average';
  if (score >= 3) return 'Below Average';
  return 'Poor';
}
