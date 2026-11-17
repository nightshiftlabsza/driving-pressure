import type { DrillItem, DrillSet } from '../types';
import alarmsData from './alarms.json';
import abgData from './abg.json';
import waveformsData from './waveforms.json';

export const alarmsDrillItems: DrillItem[] = alarmsData as unknown as DrillItem[];
export const abgDrillItems: DrillItem[] = abgData as unknown as DrillItem[];
export const waveformsDrillItems: DrillItem[] = waveformsData as unknown as DrillItem[];

export const alarmDrillSet: DrillSet = {
  id: 'alarms',
  title: 'Ventilator Alarms & Safety',
  description: 'Respond to high pressure, low volume, apnoea, high respiratory rate, and NIV leak alarms using bedside vignettes and Ppeak vs Pplat mechanics.',
  competencies: Array.from(new Set(alarmsDrillItems.map((item) => item.competency))),
  items: alarmsDrillItems,
};

export const abgDrillSet: DrillSet = {
  id: 'abg',
  title: 'Arterial Blood Gas Interpretation',
  description: 'Rapid ABG interpretation: primary disorder identification, compensation appropriateness (Winter\'s formula, acute vs chronic respiratory rules), and mixed acid-base disorders.',
  competencies: Array.from(new Set(abgDrillItems.map((item) => item.competency))),
  items: abgDrillItems,
};

export const waveformDrillSet: DrillSet = {
  id: 'waveforms',
  title: 'Ventilator Waveforms & Dyssynchrony',
  description: 'Interpret scalar waveforms (pressure, flow, volume) to detect dyssynchrony (flow starvation, double triggering, ineffective triggering), gas trapping, leaks, and predict the impact of ventilator adjustments.',
  competencies: Array.from(new Set(waveformsDrillItems.map((item) => item.competency))),
  items: waveformsDrillItems,
};

export const allDrillSets: DrillSet[] = [waveformDrillSet, abgDrillSet, alarmDrillSet];

export function getDrillSetById(id: 'alarms' | 'abg' | 'waveforms'): DrillSet | undefined {
  return allDrillSets.find((set) => set.id === id);
}

export function getAllDrillItems(): DrillItem[] {
  return [...alarmsDrillItems, ...abgDrillItems, ...waveformsDrillItems];
}
