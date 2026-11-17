// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  isMajorSettingsChange,
  canShowRationale,
  RATIONALE_RATE_LIMIT_SIM_SEC,
  RESCUE_COOLDOWN_SIM_SEC,
} from './rationaleLogic';
import { RationaleChip } from './RationaleChip';
import type { DeviceSettings } from '../shared/engineTypes';

afterEach(() => {
  cleanup();
});

describe('Rationale logic & detection', () => {
  const baseVC: DeviceSettings = {
    device: 'invasive',
    mode: 'VC-AC',
    fio2: 0.4,
    peep: 5,
    rrSetBpm: 14,
    vtSetMl: 450,
    inspFlowLpm: 60,
    flowPattern: 'square',
  };

  it('detects mode change as major', () => {
    const pc: DeviceSettings = {
      device: 'invasive',
      mode: 'PC-AC',
      fio2: 0.4,
      peep: 5,
      rrSetBpm: 14,
      pinspAbovePeep: 18,
      tiSec: 1.0,
      riseTimeSec: 0.1,
    };
    expect(isMajorSettingsChange(baseVC, pc)).toBe(true);
  });

  it('detects PEEP change of >= 2 as major, but < 2 as minor', () => {
    expect(isMajorSettingsChange(baseVC, { ...baseVC, peep: 7 })).toBe(true);
    expect(isMajorSettingsChange(baseVC, { ...baseVC, peep: 6 })).toBe(false);
  });

  it('detects FiO2 change of >= 0.1 as major, but < 0.1 as minor', () => {
    expect(isMajorSettingsChange(baseVC, { ...baseVC, fio2: 0.5 })).toBe(true);
    expect(isMajorSettingsChange(baseVC, { ...baseVC, fio2: 0.45 })).toBe(false);
  });

  it('detects Vt change of >= 50 mL as major, but < 50 mL as minor', () => {
    expect(isMajorSettingsChange(baseVC, { ...baseVC, vtSetMl: 500 })).toBe(true);
    expect(isMajorSettingsChange(baseVC, { ...baseVC, vtSetMl: 480 })).toBe(false);
  });

  it('enforces rate limiting and rescue cooldown', () => {
    // Fresh state
    expect(canShowRationale(100, null, null)).toBe(true);

    // Within 2 sim-minutes of previous rationale
    expect(canShowRationale(150, 100, null)).toBe(false);
    expect(canShowRationale(100 + RATIONALE_RATE_LIMIT_SIM_SEC, 100, null)).toBe(true);

    // Within 30 sim-seconds of an alarm-driven rescue
    expect(canShowRationale(120, null, 100)).toBe(false);
    expect(canShowRationale(100 + RESCUE_COOLDOWN_SIM_SEC, null, 100)).toBe(true);
  });
});

describe('RationaleChip Component', () => {
  it('renders reason chips and handles selection', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    render(<RationaleChip changeSummary="PEEP 5 -> 8" onSelectReason={onSelect} onDismiss={onDismiss} />);

    expect(screen.getByTestId('rationale-chip-container')).toBeTruthy();
    expect(screen.getByText(/Rationale \(PEEP 5 -> 8\)/)).toBeTruthy();

    const opt = screen.getByTestId('rationale-option-oxygenation');
    fireEvent.click(opt);
    expect(onSelect).toHaveBeenCalledWith('oxygenation');
  });

  it('handles dismissal', () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();

    render(<RationaleChip onSelectReason={onSelect} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByLabelText('Dismiss rationale prompt');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
