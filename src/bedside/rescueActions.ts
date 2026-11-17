import type { OrderType } from '../shared/caseSchema';
import type { DeviceSettings } from '../shared/engineTypes';

/**
 * Rescue actions are emergency interventions that can NEVER be gated or delayed.
 * Reference: 02-product-architecture.md ("Rescue action: FiO2 1.0, disconnect/bag, suction, call senior, emergency orders.")
 */
export const RESCUE_ORDERS: readonly OrderType[] = [
  'disconnect-ventilator',
  'suction',
  'call-senior',
  'needle-decompression',
] as const;

export function isRescueOrder(order: OrderType): boolean {
  return RESCUE_ORDERS.includes(order);
}

/**
 * Checks whether a device setting change represents an emergency rescue action.
 * Setting FiO2 to 100% (1.0) is the immediate bedside reflex for severe acute desaturation.
 */
export function isRescueSettingsChange(nextSettings: DeviceSettings): boolean {
  if ('fio2' in nextSettings && typeof nextSettings.fio2 === 'number') {
    return nextSettings.fio2 >= 0.999;
  }
  return false;
}

/**
 * Determines whether an intended action is a rescue action.
 * If true, the action must proceed immediately without gating by the commit sheet.
 */
export function isRescueAction(
  action: { type: 'order'; order: OrderType; detail?: unknown } | { type: 'settings'; next: DeviceSettings }
): boolean {
  if (action.type === 'order') {
    return isRescueOrder(action.order);
  }
  if (action.type === 'settings') {
    return isRescueSettingsChange(action.next);
  }
  return false;
}
