# System Evaluation - 10 Criteria

Evaluates how well a multi-agent debate system performed.

---

## Scoring Scale

**1-10 for each criterion:**
- 1-3 = Poor (major failures)
- 4-6 = Mixed/Average
- 7-8 = Good
- 9-10 = Excellent

---

## OUTCOME CRITERIA (What was produced)

### 1. Goal Alignment — Weight: 2.0

Did the system understand and address what the user actually asked for?

- Correctly interpreted the user's intent
- Respected explicit constraints (scope, format, requirements)
- Covered all parts of the request
- Stayed focused on the actual problem

**Scoring:**
- 9-10: Fully addresses goal, respects all constraints, comprehensive
- 5-6: Gets main point but misses aspects or constraints
- 1-3: Misunderstands goal or goes off-track

---

### 2. Technical Accuracy — Weight: 2.0

Are the facts, logic, and technical claims correct?

- Factual correctness of claims
- Sound logical reasoning (no contradictions)
- Correct calculations or estimates
- Technically sound recommendations

**Scoring:**
- 9-10: All claims verifiable, logic airtight
- 5-6: Mostly correct with some errors
- 1-3: Major factual errors or flawed logic

---

### 3. Final Output Quality — Weight: 2.0

How good is the final deliverable?

- Well-organized and clearly written
- Appropriate depth for the task
- Complete coverage of key points
- Professional quality

**Scoring:**
- 9-10: Publication-ready, comprehensive, well-structured
- 5-6: Usable but has gaps or organization issues
- 1-3: Incomplete, disorganized, or low quality

---

### 4. Actionability — Weight: 1.5

Can the user actually use this output?

- Concrete steps and recommendations
- Specific details (not vague hand-waving)
- Implementable without major gaps
- Clear next actions

**Scoring:**
- 9-10: User can execute immediately with clear path forward
- 5-6: Useful direction but requires filling gaps
- 1-3: Too vague or abstract to act on

---

## PROCESS CRITERIA (How they got there)

### 5. Problem Decomposition — Weight: 1.5

Did they break down the problem effectively?

- Identified key subproblems
- Structured approach to the task
- Surfaced hidden requirements
- Clarified scope and constraints

**Scoring:**
- 9-10: Excellent breakdown, found hidden complexity
- 5-6: Basic breakdown, missed some aspects
- 1-3: Jumped to solutions without analysis

---

### 6. Idea Exploration — Weight: 1.5

Did they explore the solution space adequately?

- Considered multiple approaches
- Evaluated alternatives before choosing
- Went deep on promising directions
- Didn't lock into first idea too fast

**Scoring:**
- 9-10: Thorough exploration, smart convergence
- 5-6: Some alternatives considered
- 1-3: First idea accepted without alternatives

---

### 7. Debate Progression — Weight: 1.0

Did the conversation build productively over time?

- Logical flow from analysis to solution
- Ideas got refined and deepened
- Built on previous points
- Converged toward conclusions

**Scoring:**
- 9-10: Clear intellectual progress throughout
- 5-6: Some building but also tangents/loops
- 1-3: Circular, repetitive, or disjointed

---

### 8. Moderator Effectiveness — Weight: 1.5

Did the moderator guide things well?

- Set clear direction and phases
- Kept discussion on track
- Synthesized key points
- Pushed toward decisions

**Scoring:**
- 9-10: Strong guidance, great synthesis
- 5-6: Adequate direction with some drift
- 1-3: Lost control or added no value

---

### 9. Critique Quality — Weight: 1.5

Did agents challenge and improve each other's ideas?

- Caught errors and weak points
- Specific, useful critiques (not generic)
- Led to actual improvements
- Avoided obvious reasoning errors

**Scoring:**
- 9-10: Sharp critiques that improved output
- 5-6: Some useful feedback
- 1-3: No real critique or just agreement

---

### 10. Efficiency — Weight: 0.5

Was the discussion efficient?

- High signal-to-noise ratio
- Minimal repetition and filler
- Appropriate length for task complexity
- Got to the point

**Scoring:**
- 9-10: Every turn added value
- 5-6: Some waste but reasonable
- 1-3: Lots of repetition and filler

---

## Aggregate Scores

- **Outcome Score**: Average of criteria 1-4
- **Process Score**: Average of criteria 5-10
- **Weighted Overall**: Sum(score × weight) / Sum(weights)

---

## Evidence Requirements

For each criterion, provide:

1. **Positive evidence**: 1-3 quotes showing good performance
2. **Negative evidence**: 1-3 quotes showing problems
3. **Justification**: Why this score

Quote format:
- Speaker name
- Exact quote (5-30 words)
- Why it matters

---

## Output

Also provide:
- **Key Strengths**: Top 3 things done well
- **Key Weaknesses**: Top 3 areas for improvement
- **Summary**: 2-3 sentence overall assessment
