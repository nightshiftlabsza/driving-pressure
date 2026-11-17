# DRAFT: needs clinician review

# AI Clinical Reasoning Tutor Evaluation Harness

> **STATUS: DRAFT: needs clinician review**  
> All 68 test items below contain synthetic clinical scenarios and reasoning probes for ICU mechanical ventilation. They require review and sign-off by a qualified clinician before full benchmark execution.

## Overview
This evaluation harness tests the pedagogical accuracy, safety, diagnostic secrecy (anti-leakage), and reasoning evaluation capabilities of the AI tutor across multiple language models (Google Gemini Flash, Groq GPT-OSS-120B, local Ollama).

## Evaluation Item Categories (~68 items)
1. **correct_strong_reasoning (6 items)**: Learner states a clinically accurate action backed by sound physiological principles. Tutor should validate reasoning (`correct_justified`) without praise.
2. **correct_faulty_reasoning (8 items)**: Learner chooses the right setting or action by coincidence or flawed mechanics (e.g. increasing rate to treat auto-PEEP). Tutor should flag `correct_conclusion_wrong_reasoning` and diagnose the faulty model.
3. **wrong_sound_parts (8 items)**: Learner makes a suboptimal decision, but parts of their physiological rationale are valid. Tutor should assign `wrong_conclusion_sound_parts`.
4. **ambiguous (5 items)**: Learner statement is vague, incomplete, or ambiguous. Tutor should flag `too_ambiguous`, set `needs_clarification: true`, and ask exactly one clarifying question.
5. **overconfident_wrong (5 items)**: Learner expresses high certainty ("certain") on a fundamentally wrong physiological assertion. Tutor should detect calibration error and teach at level 3.
6. **underconfident_correct (4 items)**: Learner gives correct answer with "guess" confidence.
7. **repeated_misconception (4 sets x 3 items = 12 items)**: Learner repeatedly demonstrates the same cognitive misconception across consecutive decisions. Tutor should escalate to Level 3 direct teaching.
8. **contradicting_action (4 items)**: Stated rationale contradicts the actual ventilator setting dialed.
9. **probe_anti_leakage (8 items)**: Active case with a hidden competency probe (e.g. auto-PEEP, tension pneumothorax, cuff leak). Learner asks for hints. Tutor must guide attention without naming the condition or settings.
10. **outside_knowledge (3 items)**: Clinical questions requiring ICU pharmacology, imaging, or physiology not directly visible on the current monitor.
11. **conflicting_evidence (5 items)**: Areas with nuanced or conflicting trial data (e.g. higher vs lower PEEP in moderate ARDS, neuromuscular blockade timing). Tutor must accurately assign evidence levels (`trial`, `guideline`, `uncertain`).

## Running the Evaluation
The runner respects rate limits (Groq: at most 1 request every 8 seconds; Gemini: at most 8 requests per minute) and automatically resumes from previous checkpoints:

```bash
# Run 5 items on Groq (sample run)
npx vite-node eval/tutor/run.ts --provider groq --limit 5 --repeat 1

# Run on Gemini (when quota available)
npx vite-node eval/tutor/run.ts --provider gemini --limit 5 --repeat 1

# Run on local Ollama
npx vite-node eval/tutor/run.ts --provider ollama --limit 5 --repeat 1
```

## Outputs
All outputs are written to `eval/tutor/results/` (git-ignored):
- `eval-results-<provider>.json`: Detailed run logs, scores, and raw outputs.
- `summary-<provider>.json`: Aggregated metrics (grade agreement %, leakage rate, schema validity %, mean latency).
- `blind-review.csv`: Blinded review spreadsheet for clinical educators to rate physiological accuracy (1-5) and feedback quality (1-5), with provider names replaced by random letters (e.g., "Provider A").
