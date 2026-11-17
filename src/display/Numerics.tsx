import React, { useEffect, useRef, useState } from 'react';
import type { MonitoredValues, DeviceSettings, ManoeuvreResult } from '../shared/engineTypes';
import { alarmFor, type ActiveAlarm, type Limits, type MetricId } from '../alarms';
import { DISPLAY_TEST_IDS } from './types';

function f(v: number | null | undefined, d = 0) {
  return v === null || v === undefined || !Number.isFinite(v) ? '--' : v.toFixed(d);
}

export interface NumericProps {
  wide?: boolean;
  name: string;
  unit?: string;
  value: string;
  colour: string;
  limits?: { high: number | null; low: number | null };
  alarm?: 'high' | 'med' | 'low';
  big?: boolean;
  testId?: string;
  sublabel?: string;
}

/** One numeric tile: name and unit on top, value in channel colour, alarm limits at right. */
export const Numeric: React.FC<NumericProps> = ({
  name,
  unit,
  value,
  colour,
  limits,
  alarm,
  big,
  wide,
  testId,
  sublabel,
}) => (
  <div
    className={`vt-numeric ${big ? 'vt-numeric--big' : ''} ${wide ? 'col-span-2' : ''}`}
    data-alarm={alarm}
    data-testid={testId}
    role="group"
    aria-label={`${name} ${value}${unit ? ` ${unit}` : ''}${alarm ? `, alarm ${alarm}` : ''}`}
  >
    <div className="col-span-2 flex items-baseline justify-between w-full">
      <span className="vt-numeric__name" style={{ color: colour }}>{name}</span>
      {unit && <span className="vt-numeric__unit">{unit}</span>}
    </div>
    <span className="vt-numeric__value num" style={alarm ? undefined : { color: colour }}>
      {value}
    </span>
    <span className="vt-numeric__limits num" aria-hidden={!limits}>
      {limits && (
        <>
          <span>{limits.high ?? ''}</span>
          <span>{limits.low ?? ''}</span>
        </>
      )}
    </span>
    {sublabel && (
      <span className="col-span-2 text-[10px] text-[var(--text-2)] font-medium leading-tight">{sublabel}</span>
    )}
  </div>
);

export interface VentNumericsProps {
  m: MonitoredValues;
  device: DeviceSettings;
  alarms: ActiveAlarm[];
  limits: Limits;
  lastManoeuvre?: ManoeuvreResult | null;
  /** Show the hold-gated Pplat / PEEPtot / Auto-PEEP tiles. Off where the learner cannot perform holds (the Lab). */
  holdTiles?: boolean;
  onLimits?: () => void;
}

export const VentNumerics: React.FC<VentNumericsProps> = ({ m, device, alarms, limits, lastManoeuvre, holdTiles = true }) => {
  const vent = device.device === 'invasive' || device.device === 'niv';
  const lim = (id: MetricId) => limits[id];
  const al = (id: MetricId) => alarmFor(alarms, id);

  // Hold-gated readings (Pplat, total PEEP, auto-PEEP): the tiles read "Hold" until the learner
  // performs the matching hold, then show the measured value until the settings change.
  // Settings are compared by value, and a completed manoeuvre is stamped with the settings epoch.
  const deviceJson = JSON.stringify(device);
  const deviceJsonRef = useRef(deviceJson);
  const [holdEpoch, setHoldEpoch] = useState(1);
  // Last result of each hold kind, stamped with the settings epoch it was measured in, so doing the
  // other hold does not blank a tile that is still valid.
  const [measured, setMeasured] = useState<Partial<Record<ManoeuvreResult['kind'], { mm: ManoeuvreResult; epoch: number }>>>({});
  const holdEpochRef = useRef(holdEpoch);
  holdEpochRef.current = holdEpoch;
  const prevManoeuvreKindRef = useRef<ManoeuvreResult['kind'] | null>(null);

  useEffect(() => {
    if (deviceJsonRef.current !== deviceJson) {
      deviceJsonRef.current = deviceJson;
      setHoldEpoch(e => e + 1);
    }
  }, [deviceJson]);

  useEffect(() => {
    const kind = lastManoeuvre?.kind ?? null;
    const was = prevManoeuvreKindRef.current;
    prevManoeuvreKindRef.current = kind;
    if (lastManoeuvre && was !== lastManoeuvre.kind) {
      const entry = { mm: lastManoeuvre, epoch: holdEpochRef.current };
      setMeasured(prev => ({ ...prev, [lastManoeuvre.kind]: entry }));
    }
  }, [lastManoeuvre?.kind, lastManoeuvre?.valid]);

  const holdValue = (kind: ManoeuvreResult['kind'], pick: (mm: ManoeuvreResult) => number | undefined): string | null => {
    const entry = measured[kind];
    if (!entry || entry.epoch !== holdEpoch || !entry.mm.valid) return null;
    const mm = entry.mm;
    const v = pick(mm);
    return v !== undefined && Number.isFinite(v) ? v.toFixed(1) : null;
  };

  if (device.device === 'hfnc') {
    return (
      <div className="grid grid-cols-2 gap-1.5" data-testid={DISPLAY_TEST_IDS.VENT_NUMERICS}>
        <Numeric
          name="Airway Pressure"
          unit="cmH2O"
          value={f(m.hfncPressureCmH2O, 1)}
          colour="var(--ch-paw)"
          sublabel="estimated, mouth open"
          testId={DISPLAY_TEST_IDS.TILE_HFNC_PRESSURE}
          big
        />
        <Numeric
          name="Flow"
          unit="L/min"
          value={f(device.flowLpm)}
          colour="var(--ch-flow)"
          big
        />
        <Numeric
          name="FiO2 del."
          unit="%"
          value={f(m.fio2 * 100)}
          colour="var(--text)"
          testId={DISPLAY_TEST_IDS.TILE_FIO2}
          big
        />
        <Numeric
          name="ftotal"
          unit="b/min"
          value={f(m.rrTotalBpm)}
          colour="var(--text)"
          limits={lim('ftotal')}
          alarm={al('ftotal')}
          testId={DISPLAY_TEST_IDS.TILE_RR}
          big
        />
        {m.aprv && (
        <>
          <Numeric name="Vrel" unit="mL" value={f(m.aprv.releaseVolumeMl, 0)} colour="var(--ch-vol)" />
          <Numeric name="Rel rate" unit="/min" value={f(m.aprv.releaseRatePerMin, 1)} colour="var(--text)" />
          <Numeric name="End-rel flow" unit="% peak" value={f(m.aprv.endReleaseFlowPctOfPeak, 0)} colour="var(--ch-flow)" />
          {m.aprv.autoPeepCmH2O !== null && (
            <Numeric name="Auto-PEEP" unit="cmH2O" value={f(m.aprv.autoPeepCmH2O, 1)} colour="var(--ch-paw)" />
          )}
        </>
      )}
      {m.etco2MmHg !== null && (
          <Numeric
            name="EtCO2"
            unit="mmHg"
            value={f(m.etco2MmHg)}
            colour="var(--ch-co2)"
            limits={lim('etco2')}
            alarm={al('etco2')}
          />
        )}
      </div>
    );
  }

  if (!vent) {
    return (
      <div className="grid grid-cols-2 gap-1.5" data-testid={DISPLAY_TEST_IDS.VENT_NUMERICS}>
        <Numeric
          name="ftotal"
          unit="b/min"
          value={f(m.rrTotalBpm)}
          colour="var(--text)"
          limits={lim('ftotal')}
          alarm={al('ftotal')}
          testId={DISPLAY_TEST_IDS.TILE_RR}
          big
        />
        <Numeric
          name="FiO2 del."
          unit="%"
          value={f(m.fio2 * 100)}
          colour="var(--text)"
          testId={DISPLAY_TEST_IDS.TILE_FIO2}
          big
        />
        {m.etco2MmHg !== null && (
          <Numeric
            name="EtCO2"
            unit="mmHg"
            value={f(m.etco2MmHg)}
            colour="var(--ch-co2)"
            limits={lim('etco2')}
            alarm={al('etco2')}
          />
        )}
      </div>
    );
  }

  const peepVal = device.device === 'invasive' ? device.peep : device.device === 'niv' ? device.epap : m.peepSetCmH2O;

  // Numeric hierarchy: Ppeak, PEEP, VTe, RR (ftotal) and MV are large (big); others are small.
  return (
    <div className="grid grid-cols-2 gap-1.5" data-testid={DISPLAY_TEST_IDS.VENT_NUMERICS}>
      <Numeric
        name="Ppeak"
        unit="cmH2O"
        value={f(m.ppeakCmH2O, 1)}
        colour="var(--ch-paw)"
        limits={lim('ppeak')}
        alarm={al('ppeak')}
        testId={DISPLAY_TEST_IDS.TILE_PPEAK}
        big
      />
      <Numeric
        name="PEEP"
        unit="cmH2O"
        value={f(peepVal, 0)}
        colour="var(--ch-paw)"
        limits={lim('peep')}
        alarm={al('peep')}
        testId={DISPLAY_TEST_IDS.TILE_PEEP}
        big
      />
      <Numeric
        name="VTe"
        unit="mL"
        value={f(m.vteMl, 0)}
        colour="var(--ch-vol)"
        limits={lim('vte')}
        alarm={al('vte')}
        testId={DISPLAY_TEST_IDS.TILE_VTE}
        big
      />
      <Numeric
        name="RR"
        unit="b/min"
        value={f(m.rrTotalBpm, 0)}
        colour="var(--text)"
        limits={lim('ftotal')}
        alarm={al('ftotal') ?? (alarms.some(a => a.id === 'apnea' || a.id === 'apnoea') ? 'high' : undefined)}
        testId={DISPLAY_TEST_IDS.TILE_RR}
        big
      />
      <Numeric
        name="MVe"
        unit="L/min"
        value={f(m.minuteVentLpm, 1)}
        colour="var(--ch-vol)"
        limits={lim('mv')}
        alarm={al('mv')}
        testId={DISPLAY_TEST_IDS.TILE_MV}
        big
      />
      <Numeric
        name="Pmean"
        unit="cmH2O"
        value={f(m.pmeanCmH2O, 1)}
        colour="var(--ch-paw)"
        testId={DISPLAY_TEST_IDS.TILE_PMEAN}
      />
      {device.device === 'invasive' && holdTiles && (
        <>
          <HoldNumeric name="Pplat" testId={DISPLAY_TEST_IDS.TILE_PPLAT} measured={holdValue('insp-hold', mm => mm.pplatCmH2O)} />
          <HoldNumeric name="PEEPtot" testId="vent-peep-tot" measured={holdValue('exp-hold', mm => mm.totalPeepCmH2O)} />
          <HoldNumeric name="Auto-PEEP" testId="vent-auto-peep" measured={holdValue('exp-hold', mm => mm.autoPeepCmH2O)} />
        </>
      )}
      <Numeric
        name="FiO2"
        unit="%"
        value={f(m.fio2 * 100, 0)}
        colour="var(--text)"
        testId={DISPLAY_TEST_IDS.TILE_FIO2}
      />
      <Numeric
        name="fspont"
        unit="b/min"
        value={f(m.rrSpontBpm, 0)}
        colour="var(--text)"
      />
      {m.etco2MmHg !== null && (
        <Numeric
          name="EtCO2"
          unit="mmHg"
          value={f(m.etco2MmHg, 0)}
          colour="var(--ch-co2)"
          limits={lim('etco2')}
          alarm={al('etco2')}
        />
      )}
      {device.device === 'niv' && (
        <Numeric
          name="Leak"
          unit="L/min"
          value={f(m.leakLpm, 0)}
          colour="var(--text)"
          limits={lim('leak')}
          alarm={al('leak')}
        />
      )}
    </div>
  );
};

/** Hold-gated tile: dimmed "Hold" until the matching manoeuvre has been measured in the current settings epoch. */
const HoldNumeric: React.FC<{ name: string; testId?: string; measured: string | null }> = ({ name, testId, measured }) => (
  <Numeric
    name={name}
    unit="cmH2O"
    value={measured ?? 'Hold'}
    colour={measured ? 'var(--ch-paw)' : 'var(--text-3)'}
    testId={testId}
  />
);

export const MonitorStrip: React.FC<{ m: MonitoredValues; alarms: ActiveAlarm[]; limits: Limits }> = ({
  m,
  alarms,
  limits,
}) => (
  <div className="grid grid-cols-2 gap-1.5" data-testid={DISPLAY_TEST_IDS.MONITOR_STRIP}>
    <Numeric
      name="HR"
      unit="/min"
      value={f(m.hrBpm, 0)}
      colour="var(--mon-hr)"
      limits={limits.hr}
      alarm={alarmFor(alarms, 'hr')}
      big
    />
    <Numeric
      name="SpO2"
      unit="%"
      value={f(m.spo2Pct, 0)}
      colour="var(--mon-spo2)"
      limits={limits.spo2}
      alarm={alarmFor(alarms, 'spo2')}
      testId={DISPLAY_TEST_IDS.TILE_SPO2}
      big
    />
    <Numeric
      name="ABP"
      unit="mmHg"
      value={`${f(m.sbpMmHg, 0)}/${f(m.dbpMmHg, 0)} (${f(m.mapMmHg, 0)})`}
      colour="var(--mon-bp)"
      limits={limits.map}
      alarm={alarmFor(alarms, 'map')}
      wide
    />
    <Numeric
      name="Temp"
      unit="°C"
      value={f(m.temperatureC, 1)}
      colour="var(--mon-temp)"
    />
  </div>
);
