// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AdvancedPanel } from '../../src/display/advanced/AdvancedPanel';
import type { MonitoredValues, ManoeuvreResult } from '../../src/shared/engineTypes';

describe('AdvancedPanel Component', () => {
  afterEach(() => {
    cleanup();
  });

  const mockMonitored: MonitoredValues = {
    simTimeSec: 60,
    ppeakCmH2O: 22.0,
    pmeanCmH2O: 9.5,
    peepSetCmH2O: 5.0,
    vteMl: 480,
    minuteVentLpm: 7.2,
    rrTotalBpm: 15,
    rrSpontBpm: 0,
    fio2: 0.4,
    leakLpm: null,
    hrBpm: 75,
    sbpMmHg: 120,
    dbpMmHg: 80,
    mapMmHg: 93,
    spo2Pct: 98,
    etco2MmHg: 38,
    temperatureC: 37,
    pesCmH2O: 4.5,
    plEndInspCmH2O: 14.2,
    plEndExpCmH2O: 3.1,
    p01CmH2O: 1.5,
    deltaPoccCmH2O: 6.0,
  };

  it('renders all advanced mechanics and effort tiles when expanded', () => {
    render(<AdvancedPanel monitored={mockMonitored} />);

    expect(screen.getByTestId('advanced-panel')).toBeDefined();
    expect(screen.getByTestId('tile-pes')).toBeDefined();
    expect(screen.getByTestId('tile-pl-end-insp')).toBeDefined();
    expect(screen.getByTestId('tile-pl-end-exp')).toBeDefined();
    expect(screen.getByTestId('tile-p01')).toBeDefined();
    expect(screen.getByTestId('tile-delta-pocc')).toBeDefined();

    expect(screen.getByText('4.5')).toBeDefined();
    expect(screen.getByText('14.2')).toBeDefined();
    expect(screen.getByText('3.1')).toBeDefined();
    expect(screen.getByText('1.5')).toBeDefined();
    expect(screen.getByText('6.0')).toBeDefined();
  });

  it('collapses and expands when toggle button is clicked', () => {
    render(<AdvancedPanel monitored={mockMonitored} defaultExpanded={true} />);

    expect(screen.getByTestId('tile-pes')).toBeDefined();

    // Click to collapse
    const toggleBtn = screen.getByTestId('btn-toggle-advanced');
    fireEvent.click(toggleBtn);

    expect(screen.queryByTestId('tile-pes')).toBeNull();

    // Click to expand again
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId('tile-pes')).toBeDefined();
  });

  it('formats null or undefined values as --', () => {
    const emptyMonitored: MonitoredValues = {
      ...mockMonitored,
      pesCmH2O: null,
      plEndInspCmH2O: undefined,
      plEndExpCmH2O: null,
      p01CmH2O: null,
      deltaPoccCmH2O: undefined,
    };

    render(<AdvancedPanel monitored={emptyMonitored} />);

    const dashes = screen.getAllByText('--');
    expect(dashes.length).toBeGreaterThanOrEqual(5);
  });

  it('displays high drive badge when P0.1 >= 3.5', () => {
    const highDriveMonitored: MonitoredValues = {
      ...mockMonitored,
      p01CmH2O: 4.8,
    };

    render(<AdvancedPanel monitored={highDriveMonitored} />);
    expect(screen.getByText('HIGH DRIVE')).toBeDefined();
  });

  it('displays occlusion manoeuvre diagnostic results when lastManoeuvre is present', () => {
    const occlusionResult: ManoeuvreResult = {
      kind: 'occlusion',
      deltaPoccCmH2O: 21.3,
      pmusEstimatedCmH2O: 16.0,
      deltaPlDynEstimatedCmH2O: 16.0,
      p01CmH2O: 5.3,
      valid: true,
    };

    render(<AdvancedPanel monitored={mockMonitored} lastManoeuvre={occlusionResult} />);

    expect(screen.getByTestId('manoeuvre-occlusion-result')).toBeDefined();
    expect(screen.getByTestId('tile-pmus-est')).toBeDefined();
    expect(screen.getByTestId('tile-pl-dyn-est')).toBeDefined();
    expect(screen.getByTestId('manoeuvre-validity')).toBeDefined();
    expect(screen.getByText('VALID EFFORT')).toBeDefined();
    expect(screen.getAllByText('16.0').length).toBe(2);
  });

  it('displays invalid badge if occlusion effort was sub-threshold', () => {
    const invalidOcclusion: ManoeuvreResult = {
      kind: 'occlusion',
      deltaPoccCmH2O: 0.5,
      pmusEstimatedCmH2O: 0.4,
      deltaPlDynEstimatedCmH2O: 0.4,
      p01CmH2O: 0.1,
      valid: false,
    };

    render(<AdvancedPanel monitored={mockMonitored} lastManoeuvre={invalidOcclusion} />);
    expect(screen.getByText('SUB-THRESHOLD EFFORT')).toBeDefined();
  });
});
