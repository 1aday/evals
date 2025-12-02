# System Evaluator - AI Debate System Evaluation

Evaluates how well a multi-agent debate system performed on 10 technical criteria.

---

## System Prompt

```
You are a **System Evaluator** that assesses how well an AI multi-agent debate system performed.

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
```

---

## 10 Evaluation Criteria

### OUTCOME CRITERIA (What was produced)

| # | Criterion | Weight | Description |
|---|-----------|--------|-------------|
| 1 | **Goal Alignment** | 2.0 | Did the system understand and address what the user actually asked for? |
| 2 | **Technical Accuracy** | 2.0 | Are the facts, logic, and technical claims correct? |
| 3 | **Final Output Quality** | 2.0 | How good is the final deliverable? |
| 4 | **Actionability** | 1.5 | Can the user actually use this output? |

### PROCESS CRITERIA (How they got there)

| # | Criterion | Weight | Description |
|---|-----------|--------|-------------|
| 5 | **Problem Decomposition** | 1.5 | Did they break down the problem effectively? |
| 6 | **Idea Exploration** | 1.5 | Did they explore the solution space adequately? |
| 7 | **Debate Progression** | 1.0 | Did the conversation build productively over time? |
| 8 | **Moderator Effectiveness** | 1.5 | Did the moderator guide things well? |
| 9 | **Critique Quality** | 1.5 | Did agents challenge and improve each other's ideas? |
| 10 | **Efficiency** | 0.5 | Was the discussion efficient? |

---

## Detailed Criteria

### 1. Goal Alignment (goal_alignment) — Weight: 2.0

Did the system understand and address what the user actually asked for?

- Correctly interpreted the user's intent
- Respected explicit constraints (scope, format, requirements)
- Covered all parts of the request
- Stayed focused on the actual problem

---

### 2. Technical Accuracy (technical_accuracy) — Weight: 2.0

Are the facts, logic, and technical claims correct?

- Factual correctness of claims
- Sound logical reasoning (no contradictions)
- Correct calculations or estimates
- Technically sound recommendations

---

### 3. Final Output Quality (final_output_quality) — Weight: 2.0

How good is the final deliverable?

- Well-organized and clearly written
- Appropriate depth for the task
- Complete coverage of key points
- Professional quality

---

### 4. Actionability (actionability) — Weight: 1.5

Can the user actually use this output?

- Concrete steps and recommendations
- Specific details (not vague hand-waving)
- Implementable without major gaps
- Clear next actions

---

### 5. Problem Decomposition (problem_decomposition) — Weight: 1.5

Did they break down the problem effectively?

- Identified key subproblems
- Structured approach to the task
- Surfaced hidden requirements
- Clarified scope and constraints

---

### 6. Idea Exploration (idea_exploration) — Weight: 1.5

Did they explore the solution space adequately?

- Considered multiple approaches
- Evaluated alternatives before choosing
- Went deep on promising directions
- Didn't lock into first idea too fast

---

### 7. Debate Progression (debate_progression) — Weight: 1.0

Did the conversation build productively over time?

- Logical flow from analysis to solution
- Ideas got refined and deepened
- Built on previous points
- Converged toward conclusions

---

### 8. Moderator Effectiveness (moderator_effectiveness) — Weight: 1.5

Did the moderator guide things well?

- Set clear direction and phases
- Kept discussion on track
- Synthesized key points
- Pushed toward decisions

---

### 9. Critique Quality (critique_quality) — Weight: 1.5

Did agents challenge and improve each other's ideas?

- Caught errors and weak points
- Specific, useful critiques (not generic)
- Led to actual improvements
- Avoided obvious reasoning errors

---

### 10. Efficiency (efficiency) — Weight: 0.5

Was the discussion efficient?

- High signal-to-noise ratio
- Minimal repetition and filler
- Appropriate length for task complexity
- Got to the point

---

## Scoring

**Scale: 1-10**
- 1-3 = Poor (major failures)
- 4-6 = Mixed/Average
- 7-8 = Good
- 9-10 = Excellent

**Aggregate Scores:**
- `outcome_score`: Average of criteria 1-4
- `process_score`: Average of criteria 5-10
- `weighted_overall_score`: Sum(score × weight) / Sum(weights)

---

## Usage

```json
POST /api/system-evaluate
{
  "transcript": [...],
  "userGoal": "...",
  "finalOutput": "...",
  "weights": {
    "goal_alignment": 2.0,
    "technical_accuracy": 2.0,
    "problem_decomposition": 1.5,
    "idea_exploration": 1.5,
    "debate_progression": 1.0,
    "moderator_effectiveness": 1.5,
    "critique_quality": 1.5,
    "final_output_quality": 2.0,
    "actionability": 1.5,
    "efficiency": 0.5
  }
}
```
