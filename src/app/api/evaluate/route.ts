import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { EvaluationResult } from '@/types/evaluation';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Re-export the type for API consumers
export type EvaluationResponse = EvaluationResult;

// Default weights for evaluation criteria
const DEFAULT_WEIGHTS = {
  task_understanding: 1.0,
  correctness_reasoning: 2.0,
  depth_coverage_usefulness: 1.5,
  actionability_specificity: 1.5,
  clarity_structure: 1.0,
  constraints_tradeoffs_uncertainty: 0.5,
  insight_originality: 0.5,
};

const AVULTOR_SYSTEM_PROMPT = `You are **Avultor**, an expert judge that compares two AI-generated answers.

You will be given:
- The original user task.
- Optional extra context.
- Two candidate answers: "Response A" and "Response B".
- A list of evaluation criteria with numeric weights.

Your job:
1. Evaluate each response separately on each criterion, using a 1–10 scale.
2. Justify each score with a short, concrete explanation.
3. Provide evidence quotes from each response that support your scoring.
4. Compute a weighted total score for each response.
5. Decide which response is better overall (or declare a genuine tie).
6. Explain briefly **why** one response is better.

Important:
- You are **blind** to where the answers came from. Do NOT speculate about how they were produced.
- Focus entirely on **quality of the answers themselves**, not on style, politics, or "politeness", except where that directly affects clarity or usefulness.
- It is OK for answers to be blunt or opinionated. Only penalize content if it makes the answer **less accurate, less clear, or less useful** for solving the user's task.
- Use web search to verify factual claims when relevant.

EVALUATION CRITERIA
Use these criteria and sub-criteria. All scores are on a 1–10 scale where:
- 1–3 = poor
- 4–6 = mixed/average
- 7–8 = good
- 9–10 = excellent

You will also receive weights for each criterion and must use them when computing the overall score.

1) TASK UNDERSTANDING & GOAL FIT
   - Does the response clearly address the actual question or task?
   - Does it respect any explicit constraints (scope, format, role, etc.)?
   - Does it focus on what matters most, rather than going off-topic?

2) CORRECTNESS & REASONING QUALITY
   - Logical correctness: Are the arguments and steps coherent and non-contradictory?
   - Factual soundness: For claims that can be checked from the prompt/context, are they consistent?
   - Reasoning transparency: Does the answer show enough reasoning that a smart reader can follow the logic?

3) DEPTH, COVERAGE & USEFULNESS
   - Coverage: Does it hit the key aspects a competent person would consider for this task?
   - Depth: Does it go beyond superficial "obvious" points where appropriate?
   - Prioritization: Does it spend more effort on high-impact / important parts rather than trivia?

4) ACTIONABILITY & SPECIFICITY
   - Concrete guidance: Does it give clear steps, examples, checklists, or pseudo-code where relevant?
   - Specificity: Does it avoid vague phrases like "just optimize it" without saying how?
   - Implementability: Could a reasonably skilled user execute the advice without needing to fill in big gaps?

5) CLARITY, STRUCTURE & ORGANIZATION
   - Structure: Is the response logically organized (sections, bullets, ordering that makes sense)?
   - Clarity: Are the explanations easy to follow on a first read?
   - Signal-to-noise: Does it avoid unnecessary rambling and filler?

6) HANDLING OF CONSTRAINTS, TRADEOFFS & UNCERTAINTY
   - Constraints: Does it handle given limits (time, budget, tools, tech stack, etc.) intelligently?
   - Tradeoffs: Does it show awareness of relevant tradeoffs where they matter (e.g., speed vs. accuracy, simplicity vs. flexibility)?
   - Uncertainty: When something is speculative or depends on assumptions, does it flag that instead of pretending to know?

7) INSIGHT & ORIGINALITY (OPTIONAL / LOW-WEIGHT)
   - Insightfulness: Does it introduce non-trivial angles, reframings, or heuristics that improve the solution?
   - Originality: Does it avoid being a generic template answer when the task calls for deeper thinking?
   - Leverage: Do the "smart" ideas actually improve the user's ability to solve their problem?

SCORING RULES
- Score **each criterion independently** for Response A and Response B.
- A high score requires both:
  - meeting the basic expectations for that criterion, and
  - doing it noticeably better than a typical average answer.
- Use the full 1–10 range when appropriate; don't cluster everything at 7–8.
- It is allowed for both answers to score high or both low on a criterion if they deserve it.

Overall score:
- For each response:
  - Multiply each criterion's score by its weight.
  - Sum these to get the **weighted_total_score**.
- The "winner" is the response with the higher weighted_total_score, unless the difference is very small (e.g. < 0.5 on a 1–10-like scale), in which case you may answer "tie" if that feels more accurate.

INFLUENTIAL TEXT HIGHLIGHTING (CRITICAL)
When explaining your scores, you MUST highlight specific parts of each answer that affected the scoring, both favorably and unfavorably, compared to the other answer.

For each criterion, provide evidence quotes:
- Quote short spans of text (5–25 words) from Answer A and Answer B that were important for your decision.
- For each quoted span, mark:
  - which answer it came from (A or B)
  - whether it affected the score favorably or unfavorably relative to the other answer
  - a brief rationale explaining why

Focus on the differences that explain why one answer scored higher or lower on that criterion, not on quoting everything.

When writing justifications:
- Be concrete. Refer to specific parts of the responses (paraphrase, don't quote verbatim if long).
- Mention both strengths and weaknesses for each criterion where relevant.
- Avoid generic phrases like "good reasoning" without saying *what* made it good.`;

// JSON Schema for structured output - evidence schema definition
const evidenceSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string', enum: ['A', 'B'] },
    impact: { type: 'string', enum: ['favorable', 'unfavorable'] },
    quote: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['answer', 'impact', 'quote', 'rationale'],
  additionalProperties: false,
};

const criteriaScoreSchema = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    justification: { type: 'string' },
    evidence: {
      type: 'array',
      items: evidenceSchema,
    },
  },
  required: ['score', 'justification', 'evidence'],
  additionalProperties: false,
};

const criterionPairSchema = {
  type: 'object',
  properties: {
    A: criteriaScoreSchema,
    B: criteriaScoreSchema,
  },
  required: ['A', 'B'],
  additionalProperties: false,
};

const overallResultSchema = {
  type: 'object',
  properties: {
    weighted_total_score: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['weighted_total_score', 'summary'],
  additionalProperties: false,
};

const evaluationSchema = {
  type: 'object',
  properties: {
    criteria_scores: {
      type: 'object',
      properties: {
        task_understanding: criterionPairSchema,
        correctness_reasoning: criterionPairSchema,
        depth_coverage_usefulness: criterionPairSchema,
        actionability_specificity: criterionPairSchema,
        clarity_structure: criterionPairSchema,
        constraints_tradeoffs_uncertainty: criterionPairSchema,
        insight_originality: criterionPairSchema,
      },
      required: [
        'task_understanding',
        'correctness_reasoning',
        'depth_coverage_usefulness',
        'actionability_specificity',
        'clarity_structure',
        'constraints_tradeoffs_uncertainty',
        'insight_originality',
      ],
      additionalProperties: false,
    },
    overall: {
      type: 'object',
      properties: {
        A: overallResultSchema,
        B: overallResultSchema,
      },
      required: ['A', 'B'],
      additionalProperties: false,
    },
    winner: { type: 'string', enum: ['A', 'B', 'tie'] },
    winner_rationale: { type: 'string' },
  },
  required: ['criteria_scores', 'overall', 'winner', 'winner_rationale'],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  try {
    const { 
      userTask, 
      responseA, 
      responseB, 
      context,
      weights = DEFAULT_WEIGHTS 
    } = await req.json();

    if (!responseA || !responseB) {
      return NextResponse.json(
        { error: 'Both responseA and responseB are required' },
        { status: 400 }
      );
    }

    // Build the evaluation prompt
    const userPrompt = `
USER TASK:
${userTask || 'Provide a helpful and accurate response to the given context/question.'}

${context ? `EXTRA CONTEXT:\n${context}\n` : ''}

RESPONSE A:
${responseA}

RESPONSE B:
${responseB}

WEIGHTS:
${JSON.stringify(weights, null, 2)}

Please evaluate both responses according to the criteria and weights provided. Remember to include evidence quotes for each criterion.`;

    // Use OpenAI Responses API with GPT-5.1 model
    const response = await openai.responses.create({
      model: 'gpt-5.1',
      input: [
        { role: 'developer', content: AVULTOR_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      reasoning: {
        effort: 'high',
      },
      text: {
        format: {
          type: 'json_schema',
          name: 'evaluation_result',
          strict: true,
          schema: evaluationSchema,
        },
      },
      tools: [
        { type: 'web_search' },
      ],
    });

    // Extract the text output from the response
    let evaluationContent: string | null = null;
    let webSearchUsed = false;

    // Handle response output items
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            evaluationContent = content.text;
          }
        }
      }
      if (item.type === 'web_search_call') {
        webSearchUsed = true;
      }
    }

    if (!evaluationContent) {
      return NextResponse.json(
        { error: 'No evaluation content received' },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let evaluation: EvaluationResponse;
    try {
      evaluation = JSON.parse(evaluationContent);
      // Add web search flag
      evaluation.web_search_used = webSearchUsed;
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse evaluation response', content: evaluationContent },
        { status: 500 }
      );
    }

    // Return the parsed evaluation with usage info
    return NextResponse.json({
      evaluation,
      usage: response.usage ? {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
        reasoning_tokens: response.usage.output_tokens_details?.reasoning_tokens,
      } : undefined,
    });
  } catch (error) {
    console.error('Evaluation API error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to evaluate responses', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}
