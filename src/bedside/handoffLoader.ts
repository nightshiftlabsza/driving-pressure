import type { CaseFile } from '../shared/caseSchema';
import apoCpap01 from './handoff/apo-cpap-01.json';
import ardsVent01 from './handoff/ards-vent-01.json';
import asthmaVent01 from './handoff/asthma-vent-01.json';
import copdNiv01 from './handoff/copd-niv-01.json';
import copdPsvTrigger01 from './handoff/copd-psv-trigger-01.json';
import dkaIntubated01 from './handoff/dka-intubated-01.json';
import dyssynchrony01 from './handoff/dyssynchrony-01.json';
import pneumoniaHfnc01 from './handoff/pneumonia-hfnc-01.json';
import sbtFail01 from './handoff/sbt-fail-01.json';
import sbtPass01 from './handoff/sbt-pass-01.json';
import ventHighPressure01 from './handoff/vent-high-pressure-01.json';

export interface HandoffRecord {
  caseId: string;
  patientName: string;
  location?: string;
  who: string;
  whyAdmitted: string;
  whatHasBeenDone: string;
  currentSupport: string;
  theWorry: string;
  background?: string;
}

const HANDOFF_MAP: Record<string, HandoffRecord> = {
  'apo-cpap-01': apoCpap01,
  'ards-vent-01': ardsVent01,
  'asthma-vent-01': asthmaVent01,
  'copd-niv-01': copdNiv01,
  'copd-psv-trigger-01': copdPsvTrigger01,
  'dka-intubated-01': dkaIntubated01,
  'dyssynchrony-01': dyssynchrony01,
  'pneumonia-hfnc-01': pneumoniaHfnc01,
  'sbt-fail-01': sbtFail01,
  'sbt-pass-01': sbtPass01,
  'vent-high-pressure-01': ventHighPressure01,
};

export function getHandoff(caseId: string, caseFile?: CaseFile): HandoffRecord | null {
  const baseId = caseId.split('--')[0];
  const baseHandoff = HANDOFF_MAP[caseId] ?? HANDOFF_MAP[baseId] ?? null;
  if (!baseHandoff) return null;

  if (caseFile && caseId.includes('--')) {
    const p = caseFile.patient;
    const sexDesc = p.params.sex === 'M' ? 'male' : p.params.sex === 'F' ? 'female' : 'patient';
    return {
      ...baseHandoff,
      caseId,
      patientName: p.displayName || baseHandoff.patientName,
      who: `${p.params.ageYears}yo ${sexDesc}, ${p.params.heightCm} cm, ${p.params.actualWeightKg} kg`,
      whyAdmitted: p.presentingStory || baseHandoff.whyAdmitted,
      background: p.history || baseHandoff.background,
    };
  }

  return baseHandoff;
}
