import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { SystemEvaluationResult } from '@/types/evaluation';
import { TranscriptMessage } from '@/types/transcript';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Re-export the type for API consumers
export type SystemEvaluationResponse = SystemEvaluationResult;

// Default weights for system evaluation criteria
const DEFAULT_WEIGHTS = {
  goal_alignment: 2.0,
  technical_accuracy: 2.0,
  problem_decomposition: 1.5,
  idea_exploration: 1.5,
  debate_progression: 1.0,
  moderator_effectiveness: 1.5,
  critique_quality: 1.5,
  final_output_quality: 2.0,
  actionability: 1.5,
  efficiency: 0.5,
};

const SYSTEM_EVALUATOR_PROMPT = `You are a **System Evaluator** that assesses how well an AI multi-agent debate system performed.

You will be given:
- The original user goal/task
- The complete debate transcript between agents
- The final output/document produced
- Optional context

Your job: Evaluate the **system's performance** on 10 criteria.

IMPORTANT:
- Evaluate the SYSTEM as a whole, not individual agents.
- Focus purely on technical quality, correctness, and usefulness.
- Judge based on evidence from the transcript.
- Be harsh on real problems, generous on genuine strengths.

---

EVALUATION CRITERIA (10 total)

Score each on a 1-10 scale:
- 1-3 = Poor (major failures)
- 4-6 = Mixed/Average
- 7-8 = Good
- 9-10 = Excellent

---

## OUTCOME CRITERIA (What was produced)

1) GOAL ALIGNMENT (goal_alignment) — Weight: 2.0
   Did the system understand and address what the user actually asked for?
   
   - Correctly interpreted the user's intent
   - Respected explicit constraints (scope, format, requirements)
   - Covered all parts of the request
   - Stayed focused on the actual problem

2) TECHNICAL ACCURACY (technical_accuracy) — Weight: 2.0
   Are the facts, logic, and technical claims correct?
   
   - Factual correctness of claims
   - Sound logical reasoning (no contradictions)
   - Correct calculations or estimates
   - Technically sound recommendations

3) FINAL OUTPUT QUALITY (final_output_quality) — Weight: 2.0
   How good is the final deliverable?
   
   - Well-organized and clearly written
   - Appropriate depth for the task
   - Complete coverage of key points
   - Professional quality

4) ACTIONABILITY (actionability) — Weight: 1.5
   Can the user actually use this output?
   
   - Concrete steps and recommendations
   - Specific details (not vague hand-waving)
   - Implementable without major gaps
   - Clear next actions

---

## PROCESS CRITERIA (How they got there)

5) PROBLEM DECOMPOSITION (problem_decomposition) — Weight: 1.5
   Did they break down the problem effectively?
   
   - Identified key subproblems
   - Structured approach to the task
   - Surfaced hidden requirements
   - Clarified scope and constraints

6) IDEA EXPLORATION (idea_exploration) — Weight: 1.5
   Did they explore the solution space adequately?
   
   - Considered multiple approaches
   - Evaluated alternatives before choosing
   - Went deep on promising directions
   - Didn't lock into first idea too fast

7) DEBATE PROGRESSION (debate_progression) — Weight: 1.0
   Did the conversation build productively over time?
   
   - Logical flow from analysis to solution
   - Ideas got refined and deepened
   - Built on previous points
   - Converged toward conclusions

8) MODERATOR EFFECTIVENESS (moderator_effectiveness) — Weight: 1.5
   Did the moderator guide things well?
   
   - Set clear direction and phases
   - Kept discussion on track
   - Synthesized key points
   - Pushed toward decisions

9) CRITIQUE QUALITY (critique_quality) — Weight: 1.5
   Did agents challenge and improve each other's ideas?
   
   - Caught errors and weak points
   - Specific, useful critiques (not generic)
   - Led to actual improvements
   - Avoided obvious reasoning errors

10) EFFICIENCY (efficiency) — Weight: 0.5
    Was the discussion efficient?
    
    - High signal-to-noise ratio
    - Minimal repetition and filler
    - Appropriate length for task complexity
    - Got to the point

---

SCORING RULES

1. Score each criterion independently.
2. Use the FULL 1-10 range. Don't cluster at 6-7.
3. A 10 means genuinely exceptional performance.
4. A 1-3 means significant failures that hurt the outcome.
5. Provide specific evidence for each score.

AGGREGATE SCORES

Calculate:
- process_score: Average of criteria 5-10 (problem_decomposition, idea_exploration, debate_progression, moderator_effectiveness, critique_quality, efficiency)
- outcome_score: Average of criteria 1-4 (goal_alignment, technical_accuracy, final_output_quality, actionability)
- weighted_overall_score: Sum(score_i × weight_i) / Sum(weight_i)

---

EVIDENCE REQUIREMENTS

For EACH criterion, provide:
1. positive_evidence: 1-3 quotes showing good performance
2. negative_evidence: 1-3 quotes showing problems (can be empty array if none)
3. justification: Concrete explanation of the score

Each evidence quote needs: speaker name, exact quote (5-30 words), and rationale.`;

// JSON Schema for structured output
const evidenceSchema = {
  type: 'object',
  properties: {
    quote: { type: 'string' },
    speaker: { type: 'string' },
    impact: { type: 'string', enum: ['positive', 'negative'] },
    rationale: { type: 'string' },
  },
  required: ['quote', 'speaker', 'impact', 'rationale'],
  additionalProperties: false,
};

const criteriaScoreSchema = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    justification: { type: 'string' },
    positive_evidence: {
      type: 'array',
      items: evidenceSchema,
    },
    negative_evidence: {
      type: 'array',
      items: evidenceSchema,
    },
  },
  required: ['score', 'justification', 'positive_evidence', 'negative_evidence'],
  additionalProperties: false,
};

const systemEvaluationSchema = {
  type: 'object',
  properties: {
    criteria_scores: {
      type: 'object',
      properties: {
        goal_alignment: criteriaScoreSchema,
        technical_accuracy: criteriaScoreSchema,
        problem_decomposition: criteriaScoreSchema,
        idea_exploration: criteriaScoreSchema,
        debate_progression: criteriaScoreSchema,
        moderator_effectiveness: criteriaScoreSchema,
        critique_quality: criteriaScoreSchema,
        final_output_quality: criteriaScoreSchema,
        actionability: criteriaScoreSchema,
        efficiency: criteriaScoreSchema,
      },
      required: [
        'goal_alignment',
        'technical_accuracy',
        'problem_decomposition',
        'idea_exploration',
        'debate_progression',
        'moderator_effectiveness',
        'critique_quality',
        'final_output_quality',
        'actionability',
        'efficiency',
      ],
      additionalProperties: false,
    },
    process_score: { type: 'number' },
    outcome_score: { type: 'number' },
    weighted_overall_score: { type: 'number' },
    key_strengths: {
      type: 'array',
      items: { type: 'string' },
    },
    key_weaknesses: {
      type: 'array',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
  },
  required: [
    'criteria_scores',
    'process_score',
    'outcome_score',
    'weighted_overall_score',
    'key_strengths',
    'key_weaknesses',
    'summary',
  ],
  additionalProperties: false,
};

// Helper to format transcript for evaluation
function formatTranscript(messages: TranscriptMessage[]): string {
  return messages.map((msg, idx) => {
    const speaker = msg.role === 'moderator' ? 'Maude (Moderator)' 
      : msg.role === 'claude' ? 'Catherine (Claude)'
      : msg.role === 'gpt' ? 'Gordon (GPT)'
      : 'User';
    
    // Truncate very long messages
    const content = msg.content.length > 2000 
      ? msg.content.substring(0, 2000) + '...[truncated]'
      : msg.content;
    
    return `[Turn ${idx + 1}] ${speaker}:\n${content}`;
  }).join('\n\n---\n\n');
}

// Helper to extract final output from transcript
function extractFinalOutput(messages: TranscriptMessage[]): string {
  // Look for the last message that appears to be a final document/output
  // Usually marked by isGeneratedDocument in metadata or is the last moderator message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.metadata?.isGeneratedDocument) {
      return msg.content;
    }
  }
  
  // Fall back to last moderator message if no explicit document
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'moderator' && msg.content.length > 500) {
      return msg.content;
    }
  }
  
  // Fall back to last message
  return messages[messages.length - 1]?.content || '';
}

// Helper to extract user goal from transcript
function extractUserGoal(messages: TranscriptMessage[]): string {
  // Find the first user message
  const userMessage = messages.find(msg => msg.role === 'user');
  return userMessage?.content || 'No explicit user goal found';
}

export async function POST(req: NextRequest) {
  try {
    const { 
      userGoal, 
      transcript, 
      finalOutput,
      context,
      weights = DEFAULT_WEIGHTS 
    } = await req.json();

    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
      return NextResponse.json(
        { error: 'transcript is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    // Auto-extract if not provided
    const resolvedUserGoal = userGoal || extractUserGoal(transcript);
    const resolvedFinalOutput = finalOutput || extractFinalOutput(transcript);
    const formattedTranscript = formatTranscript(transcript);

    // Build the evaluation prompt
    const userPrompt = `
USER GOAL:
${resolvedUserGoal}

${context ? `ADDITIONAL CONTEXT:\n${context}\n` : ''}

DEBATE TRANSCRIPT:
${formattedTranscript}

FINAL OUTPUT:
${resolvedFinalOutput}

WEIGHTS:
${JSON.stringify(weights, null, 2)}

Please evaluate this debate system according to the criteria. Provide specific evidence quotes from the transcript for each criterion. Calculate the process_score, outcome_score, and weighted_overall_score. Identify key strengths and weaknesses.`;

    // Use OpenAI Responses API with GPT-5.1 model
    const response = await openai.responses.create({
      model: 'gpt-5.1',
      input: [
        { role: 'developer', content: SYSTEM_EVALUATOR_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      reasoning: {
        effort: 'high',
      },
      text: {
        format: {
          type: 'json_schema',
          name: 'system_evaluation_result',
          strict: true,
          schema: systemEvaluationSchema,
        },
      },
    });

    // Extract the text output from the response
    let evaluationContent: string | null = null;

    // Handle response output items
    for (const item of response.output) {
      if (item.type === 'message') {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            evaluationContent = content.text;
          }
        }
      }
    }

    if (!evaluationContent) {
      return NextResponse.json(
        { error: 'No evaluation content received' },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let evaluation: SystemEvaluationResponse;
    try {
      evaluation = JSON.parse(evaluationContent);
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
    console.error('System Evaluation API error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to evaluate system', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

