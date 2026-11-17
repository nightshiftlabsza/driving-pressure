import { LabExperimentSchema, type LabExperiment } from './schema';

import exp01 from './experiments/01-rc-time-constant-exhalation.json';
import exp02 from './experiments/02-vc-vs-pc-compliance.json';
import exp03 from './experiments/03-peep-vs-pplat.json';
import exp04 from './experiments/04-rr-vs-auto-peep.json';
import exp05 from './experiments/05-insp-flow-vs-auto-peep.json';
import exp06 from './experiments/06-dead-space-vs-paco2.json';
import exp07 from './experiments/07-vt-vs-rr-minute-ventilation.json';
import exp08 from './experiments/08-fio2-vs-pao2-high-shunt.json';
import exp09 from './experiments/09-peep-vs-shunt-recruitment.json';
import exp10 from './experiments/10-ps-level-vs-vt-rr.json';
import exp11 from './experiments/11-trigger-sensitivity-missed-triggers.json';
import exp12 from './experiments/12-hfnc-flow-vs-fio2-high-demand.json';
import exp13 from './experiments/13-ppv-vs-bp-preload-dependent.json';

const rawExperiments: unknown[] = [
  exp01,
  exp02,
  exp03,
  exp04,
  exp05,
  exp06,
  exp07,
  exp08,
  exp09,
  exp10,
  exp11,
  exp12,
  exp13,
];

export const ALL_LAB_EXPERIMENTS: LabExperiment[] = rawExperiments
  .map((raw) => LabExperimentSchema.parse(raw))
  .sort((a, b) => a.number - b.number);

export function loadLabExperiments(): LabExperiment[] {
  return ALL_LAB_EXPERIMENTS;
}

export * from './schema';
export * from './runner';
export {
  WhyView,
  type WhyViewProps,
  type WhySnapshot,
  type CausalNode,
  WHY_FIELD_METADATA,
  WHY_FIELD_NOISE_BANDS,
  formatTraceValue,
  computeDirection,
  isFieldRuleBased,
  getWhyTemplateText,
  captureWhySnapshot,
  buildCausalChain,
} from './why';
export * from './ui';
