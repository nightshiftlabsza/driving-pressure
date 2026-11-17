# Driving Pressure

**An active-learning ICU ventilation trainer, where AI plays a demanding consultant rather than an answer machine. Ten to fifteen minutes a day of deliberate practice on simulated ventilated patients.**

> [!WARNING]
> **Work in progress.** This is a personal project under active development, not a finished product.
> Expect rough edges in the layout, cases that still need tuning, and features behind flags.
> The physiology is a simplified teaching model that has **not been clinically validated**.
> It is **not a medical device** and must never be used for decisions about real patients.

Built by **Zakariyya Gardee**, a South African medical doctor with a passion for clinical reasoning and for building medical education tools that promote active learning.
It is based on the open-source [Open Vent Sim](https://github.com/fedebarra/open-vent-sim) by Federico Lorenzo Barra (MIT licence; see [Credits](#credits)).

![A ventilated ARDS patient: live waveforms, ventilator readings, the patient monitor, orders and the case clock](docs/images/case-running.png)

---

## The idea: AI that makes you think harder, not less

### Start with the problem

AI is very good at giving answers, and that is exactly the danger for anyone learning medicine.

If you ask a chatbot "what should I set the PEEP to?", you get a confident, well-written answer in seconds. You also skip the part that actually builds a clinician: noticing what matters on the screen, forming a hypothesis, committing to it, being wrong, and working out why. Used like this, AI becomes a shortcut around thinking. The learner feels fluent, but the reasoning was never theirs. Early research points the same way: in a large randomised study of high-school maths students, those who practised with unrestricted GPT-4 did better during practice but *worse* once the AI was taken away, while a version built to give hints rather than answers did not cause that harm ([Bastani *et al.*, PNAS 2025](https://doi.org/10.1073/pnas.2422633122)).

Medicine has its own versions of this risk. Over-reliance on a fluent assistant can wear down clinical reasoning, flatter overconfidence, and teach a learner to accept a plausible explanation rather than test it. At the bedside, those habits are dangerous.

### What AI should do instead

The best teachers I have had did not give me the answer. They let me commit to a plan, let me stumble, and then asked one uncomfortable question that showed me where my thinking broke. They were kind, but they did not let flawed reasoning slide, and they never praised a right answer reached for the wrong reason.

That is the role AI plays in Driving Pressure: **a friendly but demanding consultant, not an answer machine.**

- **You think first.** The consultant will not help until you have written what you see and what you think is causing it. Attempts to skip that step ("just tell me") are detected and turned back.
- **It lets you make mistakes.** The simulated patient responds to what you actually do. The consultant does not step in to save you from a wrong decision. Being wrong safely is the point.
- **It goes after the reasoning, not just the result.** A right setting chosen for the wrong reason is flagged as such. A confident wrong answer is treated as a calibration problem worth discussing.
- **It never gives the game away.** It points your attention ("look at the end of the expiratory flow trace") without naming the diagnosis or the setting. It is told never to say how close you are.
- **No flattery.** No "great job", no empty encouragement. If something in your reasoning was right, it says exactly what and why. Otherwise it asks the next question.
- **It knows when to stop asking.** Productive struggle is good, but endless struggle is not. If you keep making the same mistake, the app moves from questions to direct teaching.
- **AI never decides the physiology.** Every number, waveform and outcome comes from a deterministic engine. The app decides how much help a case allows, and the AI only phrases the question. That way it cannot invent a fact about the patient.

The consultant is still experimental and is off by default. The rest of the app, including predictions, cases, debriefs and spaced review, works fully offline without it.

### The practice itself

Most of us learn the ventilator by standing next to one on a busy shift. We copy settings someone else chose, see a handful of patients, and rarely find out what would have happened if we had chosen differently. Driving Pressure gives you short, repeated, safe practice instead:

- You take over a **simulated patient**: ARDS, COPD on NIV, pneumonia on high-flow oxygen, severe asthma, DKA, weaning trials, high-pressure alarms and more.
- Before you touch anything, you **predict** what will happen. Then you act, and the physiology engine shows the result breath by breath.
- A **guided debrief** takes you back through the decisions that mattered, and asks for your reflection before it shows the answer.
- A **learner model** tracks the competencies you have shown, and what is due for review today.

The target is a habit, not a course: about **10 to 15 minutes a day**, building real bedside reasoning over weeks.

## The active-learning philosophy

Every part of the app is built on one rule: **the learner does the thinking.** The AI consultant is one way of making that happen. The rest of the design follows from the same rule:

1. **Predict before you see.** Each key step asks you to commit to a number or a direction, and how sure you are, *before* the answer appears. Producing an answer and being corrected teaches far more than watching the right answer appear.
2. **Struggle is allowed.** Cases run in simulated time. Changes take effect on the next breath, blood gases come back after a delay, and patients get better or worse depending on what you do. The rhythm is *assess, act, reassess*, as at the bedside, and nobody rescues you mid-case.
3. **Justify, do not just choose.** Being right is not enough. The consultant and the debrief both ask *why*, because a correct setting backed by a wrong mental model will fail on the next patient.
4. **Reflect before you are told.** The debrief asks you to explain in your own words what went wrong before it shows the takeaway. Then it shows the moments that mattered on a timeline, against a reference run.
5. **Calibration matters.** Confident-and-wrong predictions are tracked separately from wrong guesses. In the ICU, certainty you have not earned is a safety problem.
6. **Space it and mix it.** Competencies come back for review on a schedule ("due today"). Disguised variants of each case, such as the same ARDS physiology in a different patient, test whether you can transfer the idea rather than memorise the case.
7. **Mastery before progression.** A four-level pathway (ventilator literacy, then mechanics and gas exchange, then non-invasive support, then ICU decisions) unlocks as you show competence, not as you click through.
8. **No fake physiology.** Waveforms, numbers and alarms come from the engine, never from a script. Cases can change the patient (compliance, resistance, shunt, effort), but they can never set SpO2 or PaCO2 directly.

![Predict before you see: the case pauses and asks for a committed answer and a confidence level](docs/images/predict-first.png)

## What exists today

| Area | Status |
|---|---|
| Physiology engine | Equation of motion with a two-compartment recruitable lung option, expiratory flow limitation and auto-PEEP, CO2 and O2 kinetics, acid-base, patient effort, and mechanistic dyssynchrony (double triggering, early and late cycling, flow starvation). Details: [`docs/ENGINE.md`](docs/ENGINE.md), [`docs/MODEL_CARD.md`](docs/MODEL_CARD.md) |
| Modes | Volume control, pressure control, SIMV, pressure support/CPAP, APRV, NIV (S/T and CPAP), high-flow nasal oxygen |
| Cases | 11 core cases plus 24 disguised variants, each with prediction points, timed events, a rubric and guideline-referenced teaching points |
| Physiology lab | 13 "change one thing and watch" experiments (compliance, resistance, time constants, auto-PEEP, dead space, shunt, recruitment, HFNC, heart-lung interaction) |
| Drills | Blood-gas interpretation, alarm troubleshooting, waveform recognition |
| Learner model | 38 competencies in 8 domains, event-sourced and confidence-weighted, with spaced review and "due today" |
| Debrief | Guided steps: reflection first, then decisions that mattered, course charts, and certain-but-wrong predictions |
| AI consultant | Experimental, off by default. It requires your reasoning first, detects attempts to skip that, never names the answer, uses no flattery, and moves to direct teaching when you keep repeating a mistake. Works offline with a local model or with free-tier API keys |
| Tests | 1,060 automated unit, engine and case tests (Vitest), plus browser end-to-end checks (Playwright), including a rendered "text stays inside its box" check at five screen sizes up to 3440×1440 |

### Known gaps (honest list)

- The layout is still being reworked, especially on very wide and very short screens.
- Some engine behaviours are simplified or rule-based, such as the circulation response to severe hypoxia and recruitment in the single-compartment model. These are flagged as such in the lab and in the model card.
- A few clinical thresholds are teaching rules rather than published cut-offs, and they are marked "unverified" in the code until checked.
- The practice-question bank was written from copyrighted textbooks and course material, so it is **not** included here. The Practice screen is empty in a fresh clone.
- Independent clinical review has not happened yet.

## Screenshots

**Curriculum pathway.** It tells you what to do next and why, and later levels unlock with mastery.

![Home screen with the recommended next activity and the four-level curriculum](docs/images/pathway.png)

**Guided debrief.** You write your reflection before you see the answer, then review the decisions that mattered against target lines.

![Debrief with a reflection prompt, the decisions that mattered and course charts for SpO2, plateau and driving pressure](docs/images/debrief.png)

**Physiology lab.** Single-variable experiments. The rule-based parts of the model are labelled.

![Grid of 13 physiology lab experiments](docs/images/lab.png)

## Running it locally

Needs [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm run dev -- --port 3100
# then open http://localhost:3100/#/trainer
```

Everything runs in the browser and works offline. Progress is stored locally (IndexedDB) and can be exported or reset from the Progress screen. There are no accounts and no telemetry.

Checks:

```bash
npm run typecheck
npm test               # unit, engine and case tests
npx playwright test    # browser end-to-end tests
npm run case:check     # case schema and trajectory checks
```

On Windows you can also double-click `start-trainer.bat`, which builds once and serves the offline version.

## Project structure

```
src/engine/     physiology (equation of motion, gas exchange, dyssynchrony)
src/cases/      case library, variants and expected trajectories
src/runtime/    case clock, events, scoring
src/learner/    competency model and evidence
src/practice/   spaced review and due-today scheduling
src/screens/    home, cases, debrief, progress
src/lab/        physiology experiments with "why" traces
src/tutor/      optional AI consultant (off by default)
tests/          engine benchmarks, case tests, end-to-end checks
docs/           engine description, model card, case authoring guide
```

More detail is in [`ABOUT.md`](ABOUT.md), and the case authoring guide is [`docs/AUTHORING.md`](docs/AUTHORING.md).

## How it was built

I directed the clinical design, the teaching approach and the review of every clinical rule. Much of the code was written with AI coding assistants under that direction. Each physiology rule and threshold is meant to trace back to a named guideline, trial or textbook, and anything I could not verify is labelled "unverified".

## Credits

- **[Open Vent Sim](https://github.com/fedebarra/open-vent-sim)** by Federico Lorenzo Barra (ARTID, Università del Piemonte Orientale), MIT licence. This project started from Open Vent Sim's ventilator interface and grew from there. Please cite the upstream paper if you use the original simulator: [Barra *et al.*, *Advances in Simulation* 2026](https://doi.org/10.1186/s41077-026-00467-2). See [`NOTICE.md`](NOTICE.md).
- Clinical targets cite published guidance by name, for example ESICM ARDS 2023, ERS high-flow 2022, ERS/ATS NIV 2017, GOLD and GINA, and ATS/ACCP liberation 2017. No copyrighted text is reproduced.
- Hamilton Medical and Mindray are trademarks of their owners. Not affiliated.

## Licence

MIT. See [`LICENSE`](LICENSE). Educational use only. Not for clinical decision-making.
