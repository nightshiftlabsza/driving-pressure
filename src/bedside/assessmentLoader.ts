import assessmentsJson from './assessments.json';
import apoCpap01Key from './keys/apo-cpap-01.json';
import ardsVent01Key from './keys/ards-vent-01.json';
import asthmaVent01Key from './keys/asthma-vent-01.json';
import copdNiv01Key from './keys/copd-niv-01.json';
import copdPsvTrigger01Key from './keys/copd-psv-trigger-01.json';
import dkaIntubated01Key from './keys/dka-intubated-01.json';
import dyssynchrony01Key from './keys/dyssynchrony-01.json';
import pneumoniaHfnc01Key from './keys/pneumonia-hfnc-01.json';
import sbtFail01Key from './keys/sbt-fail-01.json';
import sbtPass01Key from './keys/sbt-pass-01.json';
import ventHighPressure01Key from './keys/vent-high-pressure-01.json';

export interface AssessmentOption {
  id: string;
  label: string;
  description: string;
  source: string;
}

export interface AssessmentKey {
  caseId: string;
  acceptedAssessments: string[];
  explanation: string;
  source: string;
}

export const GENERIC_ASSESSMENTS: AssessmentOption[] = assessmentsJson as AssessmentOption[];

const ASSESSMENT_KEYS: Record<string, AssessmentKey> = {
  'apo-cpap-01': apoCpap01Key,
  'ards-vent-01': ardsVent01Key,
  'asthma-vent-01': asthmaVent01Key,
  'copd-niv-01': copdNiv01Key,
  'copd-psv-trigger-01': copdPsvTrigger01Key,
  'dka-intubated-01': dkaIntubated01Key,
  'dyssynchrony-01': dyssynchrony01Key,
  'pneumonia-hfnc-01': pneumoniaHfnc01Key,
  'sbt-fail-01': sbtFail01Key,
  'sbt-pass-01': sbtPass01Key,
  'vent-high-pressure-01': ventHighPressure01Key,
};

export function getAssessmentKey(caseId: string): AssessmentKey | null {
  if (ASSESSMENT_KEYS[caseId]) return ASSESSMENT_KEYS[caseId];
  const baseId = caseId.split('--')[0];
  return baseId ? (ASSESSMENT_KEYS[baseId] ?? null) : null;
}
