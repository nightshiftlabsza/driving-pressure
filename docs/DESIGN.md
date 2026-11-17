# OpenVentSim Design System: Calm Precision Clinical Instrument

## 1. Aesthetic Rationale & Philosophy

OpenVentSim is a specialized critical care training simulator designed for intensivists, pulmonologists, and ICU trainees. It operates in two physical contexts:
1. **Bedside Simulation**: Rapid interaction in high-acuity environments where legibility at arm's length (2–3 feet) and authentic ventilator response are paramount.
2. **Nighttime / Solitary Study**: Focused clinical reasoning, spaced repetition retrieval, and waveform analysis during quiet shifts or evening study.

To serve both without cognitive fatigue, the design system rejects the cliches of generic modern web software:
- **No generic AI-generated aesthetic**: No decorative purple/violet gradients, no oversaturated SaaS cards, no generic dashboard templates, no floating emojis as UI icons.
- **Instrument-grade aesthetic**: Restrained, purposeful surfaces inspired by high-end medical instrumentation (Hamilton Medical, Mindray, Maquet Servo-u), Dieter Rams' Braun audio equipment, and aerospace telemetry displays.
- **Absolute separation of concern**: The ventilator waveform canvas remains strictly true to physical bedside monitors (deep black or high-contrast daylight, exact waveform traces), while the surrounding interface acts as a refined, distraction-free clinical desk.

---

## 2. Design Tokens

### A. Color Palette & Semantics

The palette is engineered with strict WCAG AA contrast (minimum 4.5:1 for body copy, 3:1 for large numerals and graphical indicators).

| Token | Dark Mode (Default) | Light Mode (Daylight) | Semantic Role |
| --- | --- | --- | --- |
| `--bg` | `#080b0e` | `#eef2f6` | Application canvas background |
| `--surface` | `#11161d` | `#ffffff` | Elevated primary cards & containers |
| `--surface-2` | `#161e27` | `#f4f7fa` | Interactive elements, table headers, sub-panels |
| `--surface-3` | `#1e2835` | `#e5ecf2` | Hover highlights, inactive pills, borders |
| `--line` | `#232d3b` | `#d5dee7` | Structural borders and dividers |
| `--line-strong` | `#334153` | `#b8c5d3` | Active boundaries, focus guides |
| `--text` | `#f0f4f8` | `#0f172a` | Primary headings, values, and body text |
| `--text-2` | `#94a3b8` | `#475569` | Secondary metadata, labels, and explanations |
| `--text-3` | `#64748b` | `#64748b` | Tertiary indicators, units, disabled text |
| `--act` | `#f59e0b` / `#00b4d8` | `#d97706` / `#007799` | Interaction active state (Hamilton Amber / Mindray Cyan) |
| `--act-ink` | `#0f0b00` | `#ffffff` | Text on active state |
| `--focus` | `#38bdf8` | `#0284c7` | High-visibility accessible keyboard focus ring |

#### Clinical Waveform & Parameter Semantics
- **Airway Pressure ($P_{aw}$)**: `#ffd43b` (Dark) / `#b45309` (Light) — Standard international yellow/gold.
- **Flow**: `#4be08a` (Dark) / `#047857` (Light) — High-visibility clinical emerald.
- **Volume**: `#38bdf8` (Dark) / `#0369a1` (Light) — Clear atmospheric blue.
- **Capnography ($EtCO_2$)**: `#e2e8f0` (Dark) / `#334155` (Light) — Neutral high-clarity white/slate.

#### Alarm & Safety Tones
- **High Priority Alarm**: `#ef4444` (Dark) / `#dc2626` (Light) — Urgent clinical red.
- **Medium Priority Alarm**: `#f59e0b` (Dark) / `#d97706` (Light) — Warning amber.
- **Success / Protective Target**: `#10b981` (Dark) / `#059669` (Light) — Verified safe state.

---

## 3. Typography Scale & Hierarchies

### Type Families
- **Interface & Prose**: `"Inter", "Segoe UI", -apple-system, system-ui, sans-serif` — Crisp, legible letterforms with distinct open counters.
- **Clinical Numerals**: `Bahnschrift, "DIN Alternate", "DIN 2014", "Roboto Condensed", sans-serif` with `font-variant-numeric: tabular-nums` and `font-stretch: semi-condensed` — Prevents jitter during live waveform streaming.
- **Monospace Parameters**: `"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace` — Exact alignment for ABG tables and ventilation formulas.

### Modular Scale
- **`text-micro` (10–11px)**: Metadata tags, unit labels ($cmH_2O$, $mL$, $bpm$), status stamps.
- **`text-caption` (12px)**: Card subtitles, secondary notes, table headers.
- **`text-body` (13–14px)**: Clinical scenarios, rationale, interactive options.
- **`text-subhead` (16px)**: Section headers, patient names, modal titles.
- **`text-title` (20–22px)**: Main screen titles, debrief summary headers.
- **`text-num-md` (24–28px)**: Secondary monitoring parameters ($RR$, $V_e$, $RSBI$).
- **`text-num-lg` (34–40px)**: Primary bedside metrics ($P_{peak}$, $P_{plat}$, $V_T$, $SpO_2$).

---

## 4. Spacing, Radii, and Elevation

### Strict 4px/8px Modular Rhythm
- `space-1`: 4px — Micro gap between value and unit.
- `space-2`: 8px — Compact padding inside buttons, list item gap.
- `space-3`: 12px — Standard button padding, badge spacing.
- `space-4`: 16px — Container padding, card interior margins.
- `space-6`: 24px — Section spacing, screen gutter.
- `space-8`: 32px — Major visual block dividers.

### Radii & Borders
- **Corners**: Subtle, disciplined radius (`rounded-md`: 6px for cards, `rounded-sm`: 4px for buttons, `rounded-xs`: 2px for instrument keys). Never giant bubbly pill cards.
- **Borders**: Sharp 1px hairline rules (`var(--line)`). No heavy drop shadows.
- **Elevation**: Flat surfaces with subtle ambient occlusion (`box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25)` in dark; `box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08)` in light).

---

## 5. Motion and Accessibility

- **Durations**: Fast and functional (100ms–150ms ease-out). No slow decorative animations.
- **Accessibility**:
  - Focus rings: 2px solid `var(--focus)` with 2px offset on all keyboard tab stops.
  - Motion reduction: When `@media (prefers-reduced-motion: reduce)` is active, transitions and non-essential CSS transforms are strictly disabled.
  - Touch & Pointer targets: Minimum 36px $\times$ 36px interactive area on all buttons and sliders.
