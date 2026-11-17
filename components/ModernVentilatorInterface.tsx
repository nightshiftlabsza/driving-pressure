import React, { useState, useEffect, useRef } from 'react';
import { GraphsPanel } from './GraphsPanel';
import { VentilationMode, AnestheticGasType, ParameterKey, AllParameters, OperatingMode, ICUSubMode, PatientSettings, AlarmSettings, HumidifierSettings, AlarmParameterKey, ActiveManeuver, ManeuverResultsPackage, AgentLevels, ThemeName, HighFlowInterfaceType, SweepSpeedValue, VentilatorData } from '../types';
import { THEME_CONFIG, PARAMETER_DEFINITIONS, VENT_MODES_CONFIG } from '../constants';
import { useLanguage } from '../src/contexts/LanguageContext';
import { useEngineVentilator } from '../src/bedside/useEngineVentilator';
import { BEDSIDE_TEST_IDS, PatientPresetKey } from '../src/bedside/types';
import { VentControls } from '../src/app/vent/VentControls';
import { AlarmBanner } from '../src/display/AlarmBanner';
import { evaluateAlarms, defaultLimitsFor, silenceAlarms, acknowledgeAlarm, type AlarmState, type Limits } from '../src/alarms';
import { predictedBodyWeightKg } from '../src/shared/engineTypes';
import '../src/app/vent/vent.css';

export interface ModernVentilatorInterfaceProps {
  currentTime: Date;
  currentMode: VentilationMode;
  operatingMode: OperatingMode | null;
  icuSubMode: ICUSubMode | null;
  currentTheme: ThemeName;
  isSimulatorOn: boolean;
  isVentilationActive: boolean;
  isWarmingUpHF: boolean;
  isRecordingActive?: boolean; 
  isModeSelectorOpen: boolean;
  isAnesthesiaActive: boolean;
  selectedAnestheticGases: AnestheticGasType[];
  agentLevels: AgentLevels;
  parameters: AllParameters;
  ventilatorData: VentilatorData | null;
  patientSettings: PatientSettings;
  alarmSettings: AlarmSettings;
  activeAlarms: Partial<Record<AlarmParameterKey, boolean>>;
  hasActiveAlarms: boolean; 
  isAlarmSnoozed: boolean; 
  snoozeCountdownDisplay: number | null;
  onToggleAlarmSnooze: () => void; 
  humidifierSettings: HumidifierSettings;
  isModeChanging: boolean;
  areWaveformsFrozen: boolean;
  activeManeuver: ActiveManeuver | null;
  maneuverResultsPackage: ManeuverResultsPackage | null;
  onClearManeuverResults: () => void;
  hasInspHold?: boolean;
  hasExpHold?: boolean;
  isO2FlushActive: boolean;
  o2FlushTimerEnd: number | null; 
  isMechanicalVentilation: boolean;
  currentSweepSpeedValue: SweepSpeedValue;
  scanlinePixelRate: number;
  onChangeSweepSpeed: () => void;
  onPowerOff: () => void;
  onToggleVentilation: () => void;
  onToggleAnesthesia: () => void;
  onSelectAnestheticGas: (gas: AnestheticGasType) => void;
  onRefillSelectedAgents: () => void; 
  onReplaceSodaLime: () => void;    
  isRefillingAgents: AnestheticGasType[]; 
  isReplacingSodaLime: boolean;       
  onToggleModeSelector: () => void;
  onSelectVentilationMode: (mode: VentilationMode) => void;
  onOpenParameterModal: (paramKey: ParameterKey, label: string, currentValue: string | number, unit: string) => void;
  onTogglePatientSettingsModal: () => void;
  onToggleAlarmSettingsModal: () => void;
  onToggleAlarmLogsModal: () => void;
  onToggleHumidifierPower: () => void; 
  onToggleFreezeWaveforms: () => void;
  onStartInspiratoryHold: () => void;
  onStartExpiratoryHold: () => void;
  onO2Flush: () => void;
  onSetMechanicalVentilationMode: (isMechanical: boolean) => void;
  onBackToICUSubModeSelection: () => void;
  onOpenManualModal: () => void; 
  onOpenLivePatientSettingsModal: () => void;
  onSetHumidifierLevel?: (level: number) => void;
}

export const ModernVentilatorInterface: React.FC<ModernVentilatorInterfaceProps> = (props) => {
  const { t } = useLanguage();
  const themeColors = THEME_CONFIG[props.currentTheme];
  const accent = themeColors.accent === 'amber-500' ? '#f59e0b' : '#36c2c8';
  const headerTitle = props.icuSubMode === 'invasive' ? t.invasiveVentilationHeader : t.nonInvasiveVentilationHeader;

  const engineVent = useEngineVentilator({
    isPaused: !props.isVentilationActive,
  });

  const [theme, setTheme] = useState<'light' | 'dark' | 'hybrid'>(() => {
    try {
      const t = localStorage.getItem('vt-theme');
      if (t === 'light' || t === 'dark' || t === 'hybrid') return t;
    } catch {}
    return 'light'; // Clinical Daylight default
  });
  useEffect(() => {
    try { localStorage.setItem('vt-theme', theme); } catch {}
  }, [theme]);

  const [currentPreset, setCurrentPreset] = useState<PatientPresetKey>('Normal');
  const [activeEngineMode, setActiveEngineMode] = useState<string>('VC-AC');

  const [alarmLimits, setAlarmLimits] = useState<Limits>(() => defaultLimitsFor(engineVent.state.device));
  const [alarmState, setAlarmState] = useState<AlarmState>({ alarms: [] });

  useEffect(() => {
    setAlarmLimits(defaultLimitsFor(engineVent.state.device));
  }, [engineVent.state.device]);

  useEffect(() => {
    if (!props.isVentilationActive) {
      setAlarmState({ alarms: [] });
      return;
    }
    setAlarmState(prev =>
      evaluateAlarms(
        engineVent.state.monitored,
        engineVent.lastBreath,
        engineVent.state.device,
        alarmLimits,
        prev
      )
    );
  }, [engineVent.state.monitored, engineVent.lastBreath, engineVent.state.device, alarmLimits, props.isVentilationActive]);

  const handleSilence = () => {
    setAlarmState(prev => silenceAlarms(prev, engineVent.state.monitored.simTimeSec));
    props.onToggleAlarmSnooze?.();
  };

  const handleAcknowledge = (id: string) => {
    setAlarmState(prev => acknowledgeAlarm(prev, id, engineVent.state.monitored.simTimeSec));
  };

  // Input states for controls
  const [peepInput, setPeepInput] = useState<string>('5');
  const [vtInput, setVtInput] = useState<string>('450');
  const [rrInput, setRrInput] = useState<string>('12');
  const [fio2Input, setFio2Input] = useState<string>('40');
  const [pinspInput, setPinspInput] = useState<string>('15');
  const [psInput, setPsInput] = useState<string>('10');

  const controlsRef = useRef({
    mode: 'VC-AC',
    peep: '5',
    vt: '450',
    rr: '12',
    fio2: '40',
    pinsp: '15',
    ps: '10',
  });

  useEffect(() => {
    const dev = engineVent.state.device as any;
    if (dev.peep !== undefined) { setPeepInput(String(dev.peep)); controlsRef.current.peep = String(dev.peep); }
    if (dev.vtSetMl !== undefined) { setVtInput(String(dev.vtSetMl)); controlsRef.current.vt = String(dev.vtSetMl); }
    if (dev.rrSetBpm !== undefined) { setRrInput(String(dev.rrSetBpm)); controlsRef.current.rr = String(dev.rrSetBpm); }
    if (dev.fio2 !== undefined) { const f = String(Math.round(dev.fio2 * 100)); setFio2Input(f); controlsRef.current.fio2 = f; }
    if (dev.pinspAbovePeep !== undefined) { setPinspInput(String(dev.pinspAbovePeep)); controlsRef.current.pinsp = String(dev.pinspAbovePeep); }
    if (dev.psAbovePeep !== undefined) { setPsInput(String(dev.psAbovePeep)); controlsRef.current.ps = String(dev.psAbovePeep); }
    if (dev.mode !== undefined) { setActiveEngineMode(dev.mode); controlsRef.current.mode = dev.mode; }
  }, []);

  const handleApplyControls = () => {
    const p = parseFloat(controlsRef.current.peep);
    const vt = parseFloat(controlsRef.current.vt);
    const rr = parseFloat(controlsRef.current.rr);
    const f = parseFloat(controlsRef.current.fio2);
    const pinsp = parseFloat(controlsRef.current.pinsp);
    const ps = parseFloat(controlsRef.current.ps);

    const dev = { ...engineVent.state.device } as any;
    dev.mode = controlsRef.current.mode;
    if (!isNaN(p)) dev.peep = p;
    if (!isNaN(vt)) dev.vtSetMl = vt;
    if (!isNaN(rr)) dev.rrSetBpm = rr;
    if (!isNaN(f)) dev.fio2 = f > 1 ? f / 100 : f;
    if (!isNaN(pinsp)) dev.pinspAbovePeep = pinsp;
    if (!isNaN(ps)) dev.psAbovePeep = ps;
    engineVent.setDevice(dev);
  };

  const handleModeChange = (modeStr: string) => {
    controlsRef.current.mode = modeStr;
    setActiveEngineMode(modeStr);
    const dev = { ...engineVent.state.device } as any;
    dev.mode = modeStr;
    if (modeStr === 'VC-AC') {
      dev.vtSetMl = parseFloat(controlsRef.current.vt) || 450;
      dev.rrSetBpm = parseFloat(controlsRef.current.rr) || 12;
    } else if (modeStr === 'PC-AC') {
      dev.pinspAbovePeep = parseFloat(controlsRef.current.pinsp) || 15;
      dev.rrSetBpm = parseFloat(controlsRef.current.rr) || 12;
      dev.tiSec = 1.0;
    } else if (modeStr === 'PSV') {
      dev.psAbovePeep = parseFloat(controlsRef.current.ps) || 10;
    } else if (modeStr === 'CPAP') {
      dev.psAbovePeep = 0;
    } else if (modeStr === 'SIMV-VC') {
      dev.vtSetMl = parseFloat(controlsRef.current.vt) || 450;
      dev.rrSetBpm = parseFloat(controlsRef.current.rr) || 12;
      dev.psAbovePeep = parseFloat(controlsRef.current.ps) || 10;
    }
    engineVent.setDevice(dev);
  };

  const handlePresetChange = (presetKey: PatientPresetKey) => {
    setCurrentPreset(presetKey);
    engineVent.setPatientPreset(presetKey);
  };

  const handleInspHold = () => {
    engineVent.startHold('insp-hold', 3);
    props.onStartInspiratoryHold?.();
  };

  const handleExpHold = () => {
    engineVent.startHold('exp-hold', 0.8);
    props.onStartExpiratoryHold?.();
  };

  const [drawer, setDrawer] = useState<'none'|'standby'|'mode'|'maneuvers'|'humid'>('none');
  const [pendingMode, setPendingMode] = useState<VentilationMode>(props.currentMode);

  const openDrawer = (n: 'standby'|'mode'|'maneuvers'|'humid') => {
    setDrawer(drawer === n ? 'none' : n);
    setPendingMode(props.currentMode);
  };
  const closeDrawer = () => setDrawer('none');

  const confirmMode = () => {
    props.onSelectVentilationMode(pendingMode);
    setDrawer('none');
  };

  const padZero = (n: number) => n.toString().padStart(2, '0');
  const timeString = `${padZero(props.currentTime.getHours())}:${padZero(props.currentTime.getMinutes())}`;

  // Mode settings dynamically based on ICU submode / operating mode
  let modes: VentilationMode[] = [];
  if (props.operatingMode === 'icu') {
    if (props.icuSubMode === 'invasive') {
      modes = [VentilationMode.VC, VentilationMode.PC, VentilationMode.SIMV, VentilationMode.PS];
    } else if (props.icuSubMode === 'non-invasive') {
      modes = [VentilationMode.CPAP, VentilationMode.PS];
    }
  } else if (props.operatingMode === 'anesthesia') {
    modes = [VentilationMode.VC, VentilationMode.PC, VentilationMode.PS];
  } else {
    modes = [VentilationMode.VC, VentilationMode.PC, VentilationMode.SIMV, VentilationMode.PS];
  }

  const modeData = modes.map(m => {
    const config = VENT_MODES_CONFIG[m];
    const acronymLabel = config ? t[config.acronymKey] : String(m);
    return {
      m,
      label: acronymLabel,
      sel: () => setPendingMode(m),
      bg: pendingMode === m ? accent : '#121a28',
      fg: pendingMode === m ? '#ffffff' : '#9aa6ba',
    };
  });

  // Helper to format param
  const getParamInfo = (key: ParameterKey) => {
    const meta = PARAMETER_DEFINITIONS[key];
    const val = props.parameters[key];
    let displayVal = String(val);
    if (val !== undefined && val !== null && val !== '') {
      const numVal = Number(val);
      if (!isNaN(numVal)) {
        displayVal = numVal % 1 !== 0 ? numVal.toFixed(1) : String(numVal);
      }
    }
    return {
      label: meta.labelKey ? t[meta.labelKey] : '',
      short: meta.labelKey ? t[meta.labelKey].substring(0, 5) : '', // Approximation for short
      unit: meta.unitKey ? t[meta.unitKey] : '',
      display: displayVal,
      alarm: false,
    };
  };

  // Determine tiles on bottom bar for current active mode
  let tileKeys: ParameterKey[] = [];
  if (props.currentMode === 'VC' || props.currentMode as any === 'VCV') tileKeys = ['volume', 'frequency', 'peep', 'fio2', 'ratio', 'inspiratoryPausePercent', 'triggerFlow'];
  else if (props.currentMode === 'PC' || props.currentMode as any === 'PCV') tileKeys = ['pressureTarget', 'frequency', 'peep', 'fio2', 'ratio', 'inspiratoryRiseTimeSeconds', 'triggerFlow'];
  else if (props.currentMode === 'SIMV') tileKeys = ['volume', 'frequency', 'peep', 'fio2', 'psLevel', 'inspiratoryPausePercent', 'triggerFlow'];
  else if (props.currentMode === 'PS' || props.currentMode as any === 'PSV') tileKeys = ['psLevel', 'peep', 'fio2', 'triggerFlow', 'inspiratoryRiseTimeSeconds', 'flowCycleOffPercent'];
  else if (props.currentMode as any === 'CPAP') tileKeys = ['peep', 'fio2'];
  
  if (tileKeys.length === 0) tileKeys = ['volume', 'frequency', 'peep', 'fio2', 'ratio', 'inspiratoryPausePercent', 'triggerFlow'];

  const bottomTiles = tileKeys.map(k => {
    const info = getParamInfo(k);
    return {
       ...info,
       active: false,
       open: () => props.onOpenParameterModal(k, info.label, props.parameters[k] ?? '', info.unit),
       inc: () => {}, // Handled by Modal
       dec: () => {}
    };
  });

  // Extract variables for layout
  const venting = props.isVentilationActive;
  const statusText = venting ? t.ventilationActiveStatus || 'VENTILAZIONE: ATTIVA' : t.ventilationStandbyStatus || 'VENTILAZIONE: STANDBY';
  const statusColor = venting ? '#7fe0a6' : '#f5c451';
  const statusDot = venting ? '#46c97e' : '#f5b942';
  const statusBg = venting ? 'rgba(70,201,126,.12)' : 'rgba(245,185,66,.12)';

  const humidOn = props.humidifierSettings.isOn;

  return (
    <div
      className="vt"
      data-theme={theme === 'dark' ? 'dark' : 'light'}
      data-scope={theme === 'hybrid' || theme === 'dark' ? 'dark' : 'light'}
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-sans)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* TOP HEADER */}
      <div
        style={{
          flex: '0 0 auto',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 12px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
          minWidth: 0,
        }}
      >
        <button
          onClick={props.onBackToICUSubModeSelection}
          className="vt-btn !min-h-[32px] !min-w-[32px] !p-0"
          style={{ borderRadius: 'var(--radius-sm)' }}
          title="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="14 6 8 12 14 18"></polyline></svg>
        </button>
        <span className="text-sm font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: 'var(--text)' }}>{headerTitle}</span>

        {/* Patient Preset Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '4px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 600 }}>PRESET:</span>
          <select
            data-testid="patient-preset"
            value={currentPreset}
            onChange={(e) => handlePresetChange(e.target.value as PatientPresetKey)}
            className="vt-select !min-h-[28px] !py-0 !px-2 !text-xs font-semibold"
          >
            <option value="Normal">Normal</option>
            <option value="ARDS">ARDS</option>
            <option value="COPD">COPD</option>
            <option value="Obesity">Obesity</option>
            <option value="COVID">COVID</option>
            <option value="Anaphylaxis">Anaphylaxis</option>
            <option value="PulmonaryEdema">PulmonaryEdema</option>
            <option value="Pneumonia">Pneumonia</option>
          </select>
        </div>

        {/* Hold Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '4px', flexShrink: 0 }}>
          <button
            data-testid="btn-insp-hold"
            onClick={handleInspHold}
            className="vt-btn !min-h-[28px] !px-2.5 !text-xs font-semibold"
          >
            Insp. Hold
          </button>
          <button
            data-testid="btn-exp-hold"
            onClick={handleExpHold}
            className="vt-btn !min-h-[28px] !px-2.5 !text-xs font-semibold"
          >
            Exp. Hold
          </button>
        </div>

        <div style={{ flex: 1, minWidth: '4px' }}></div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            padding: '4px 10px',
            background: venting ? 'var(--status-normal-bg)' : 'var(--status-caution-bg)',
            border: `1px solid ${venting ? 'var(--status-normal-border)' : 'var(--status-caution-border)'}`,
            borderRadius: 'var(--radius-sm)',
            flexShrink: 0,
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: venting ? 'var(--ok)' : 'var(--act)' }}></span>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', color: venting ? 'var(--status-normal-text)' : 'var(--status-caution-text)', whiteSpace: 'nowrap' }}>
            {statusText}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: '4px' }}></div>

        {/* Theme Selector */}
        <div className="flex items-center gap-0.5 mr-2" role="group" aria-label="Display theme">
          <button type="button" className="vt-btn !min-h-[26px] !px-2 !text-xs" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Daylight</button>
          <button type="button" className="vt-btn !min-h-[26px] !px-2 !text-xs" aria-pressed={theme === 'hybrid'} onClick={() => setTheme('hybrid')}>Hybrid</button>
          <button type="button" className="vt-btn !min-h-[26px] !px-2 !text-xs" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Low-Lux</button>
        </div>

        {/* Settings button opens live patient settings as requested */}
        <button
          onClick={props.onOpenLivePatientSettingsModal}
          className="vt-btn !min-h-[30px] !min-w-[30px] !p-0"
          style={{ borderRadius: 'var(--radius-sm)' }}
          title={t.livePatientSettingsTitle}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="8" x2="20" y2="8"></line><line x1="4" y1="16" x2="20" y2="16"></line><circle cx="15" cy="8" r="2.7"></circle><circle cx="9" cy="16" r="2.7"></circle></svg>
        </button>
        <button 
          onClick={props.onToggleAlarmLogsModal} 
          className={`vt-btn !min-h-[30px] !min-w-[30px] !p-0 ${props.hasActiveAlarms && !props.isAlarmSnoozed ? 'vt-btn--danger animate-pulse' : ''}`}
          style={{ borderRadius: 'var(--radius-sm)' }}
          title={t.alarmLogsDrawerLabel || 'Alarm Logs'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill={props.hasActiveAlarms && !props.isAlarmSnoozed ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"></path><path d="M10.3 20a2 2 0 0 0 3.4 0"></path></svg>
        </button>
        <span className="num" style={{ fontSize: '13px', color: 'var(--text-2)', marginLeft: '2px', flexShrink: 0 }}>{timeString}</span>
      </div>

      <AlarmBanner
        alarmState={alarmState}
        simTimeSec={engineVent.state.monitored.simTimeSec}
        onSilence={handleSilence}
        onAcknowledge={handleAcknowledge}
      />

      <div style={{ flex:1, position:'relative', display:'flex', minHeight:0 }}>
        {/* LEFT HANDLES (non-overlapping flex column) */}
        <div style={{ flex:'0 0 42px', zIndex:5, display:'flex', flexDirection:'column', justifyContent:'center', gap:'6px', padding:'4px 0' }}>
          {[
            { 
              id: 'standby',
              label: t.genericStandbyButtonText || 'STANDBY', 
              icon: <><path d="M12 3 v8"/><path d="M6.8 6.6 a7.5 7.5 0 1 0 10.4 0"/></>, 
              onClick: () => openDrawer('standby'),
              active: props.isVentilationActive,
              activeColor: '#46c97e',
              activeBg: 'rgba(70,201,126,.15)'
            },
            { 
              id: 'mode',
              label: t.modeLabel || 'MODALITÀ', 
              icon: <><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="15" cy="8" r="2.6" fill="#141d2c"/><circle cx="9" cy="16" r="2.6" fill="#141d2c"/></>, 
              onClick: () => openDrawer('mode'),
              active: false,
              activeColor: '#46c97e',
              activeBg: 'rgba(70,201,126,.15)'
            },
            ...(props.operatingMode === 'icu' && props.icuSubMode === 'non-invasive' ? [] : [
              { 
                id: 'maneuvers',
                label: t.maneuversLabel || 'MANOVRE', 
                icon: <><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></>, 
                onClick: () => openDrawer('maneuvers'),
                active: props.activeManeuver !== null,
                activeColor: '#34b6ee',
                activeBg: 'rgba(52,182,238,.15)'
              }
            ]),
            { 
              id: 'humid',
              label: t.humidifierLabel || 'UMIDIF.', 
              icon: <><path d="M12 3 C12 3 6 10 6 14 a6 6 0 0 0 12 0 C18 10 12 3 12 3 Z"/></>, 
              onClick: () => openDrawer('humid'),
              active: props.humidifierSettings.isOn,
              activeColor: '#46c97e',
              activeBg: 'rgba(70,201,126,.15)'
            },
            {
              id: 'alarm_settings',
              label: (t.alarmSettingsDrawerLabel || 'ALLARMI').toUpperCase(),
              icon: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"></path><path d="M10.3 20a2 2 0 0 0 3.4 0"></path></>,
              onClick: () => {
                closeDrawer();
                props.onToggleAlarmSettingsModal();
              },
              active: false,
              activeColor: '#f59e0b',
              activeBg: 'rgba(245,158,11,.15)'
            },
          ].map((h) => {
            const isSelfOpen = drawer === h.id;
            const bg = isSelfOpen 
              ? accent 
              : h.active 
                ? h.activeBg 
                : '#141d2c';
            const fg = isSelfOpen 
              ? '#ffffff' 
              : h.active 
                ? h.activeColor 
                : '#aeb8c8';
            const borderStyle = h.active ? `3px solid ${h.activeColor}` : '0px solid transparent';
            return (
              <button key={h.id} data-testid="left-handle-btn" onClick={h.onClick} style={{ 
                display:'flex', 
                flexDirection:'column', 
                alignItems:'center', 
                gap:'4px', 
                padding:'7px 5px', 
                background: bg, 
                border:'none', 
                borderLeft: borderStyle,
                borderRadius:'0 10px 10px 0', 
                color: fg, 
                cursor:'pointer', 
                boxShadow:'3px 0 12px rgba(0,0,0,.35)',
                transition:'all .2s',
                minHeight:0
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">{h.icon}</svg>
                <span style={{ writingMode:'vertical-rl', fontSize:'10px', letterSpacing:'1px', fontWeight:700 }}>{h.label}</span>
              </button>
            );
          })}
        </div>

        {/* GRAPHS PANEL */}
        <GraphsPanel
          {...props}
          engineSamples={engineVent.samples}
          isModernTheme={true}
          isHighFlowMode={props.operatingMode === 'icu' && props.icuSubMode === 'high-flow'}
          onOpenModeDrawer={() => openDrawer('mode')}
        />

        {/* MONITORING PANEL */}
        <div data-testid="vent-numerics" style={{ flex:'0 0 clamp(256px, 26vw, 336px)', background:'var(--surface)', borderLeft:'1px solid var(--line)', display:'flex', flexDirection:'column', minHeight:0 }}>
          <div style={{ flex:'0 0 auto', padding:'10px 14px 4px' }}>
            <span style={{ fontSize:'13px', fontWeight:600, letterSpacing:'.4px', color:'var(--text)' }}>{t.panelMonitoring || 'Monitoraggio'}</span>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'0 14px 12px' }}>
            {(() => {
              const ventingActive = props.isVentilationActive;
              const formatMon = (val: any, decimals: number = 0) => {
                if (!ventingActive) return '-';
                if (val === undefined || val === null || val === '') return '-';
                if (typeof val === 'string' && isNaN(Number(val))) return val;
                const num = Number(val);
                return isNaN(num) ? '-' : num.toFixed(decimals);
              };

              const mon = engineVent.state.monitored;
              const dev = engineVent.state.device as any;
              const pplatManoeuvre = engineVent.lastManoeuvre?.pplatCmH2O ?? engineVent.state.lastManoeuvre?.pplatCmH2O;
              const pbw = predictedBodyWeightKg(engineVent.state.patient.sex, engineVent.state.patient.heightCm);

              const activePpeak = mon.ppeakCmH2O;
              const activePmean = mon.pmeanCmH2O;
              const activePplat = pplatManoeuvre !== null && pplatManoeuvre !== undefined ? pplatManoeuvre : null;
              const activePeep = dev.peep ?? dev.epap ?? mon.peepSetCmH2O ?? 5;
              const activeRr = mon.rrTotalBpm ?? dev.rrSetBpm ?? 12;
              const activeMv = mon.minuteVentLpm ?? null;
              const activeVte = mon.vteMl ?? null;
              const activeVti = (engineVent.lastBreath?.vtiMl ?? mon.vteMl) ?? null;
              const activeVtKg = activeVte !== null && pbw > 0 ? Number(activeVte) / pbw : null;
              const activeFio2 = Math.round((dev.fio2 ?? 0.4) * 100);
              const activeSpo2 = Math.round(mon.spo2Pct ?? 98);

              const monGroup = [
                { title: t.panelPressures?.toUpperCase() || 'PRESSIONI', color:'#f2a23c', tiles:[
                  { testId: 'vent-ppeak', label:'Ppeak', value: formatMon(activePpeak, 1), unit:'cmH₂O', alarm:false },
                  { testId: 'vent-pmean', label:'Pmean', value: formatMon(activePmean, 1), unit:'cmH₂O', alarm:false },
                  { testId: 'vent-pplat', label:'Pplat', value: activePplat !== null && activePplat !== undefined ? (typeof activePplat === 'number' ? activePplat.toFixed(1) : String(activePplat)) : '-', unit:'cmH₂O', alarm:false },
                  { testId: 'vent-peep', label:'PEEP', value: formatMon(activePeep, 0), unit:'cmH₂O', alarm:false },
                ]},
                { title: t.icuModeLabel?.toUpperCase() || 'VENTILAZIONE', color:'#46c97e', tiles:[
                  { testId: 'vent-rr', label:'RR', value: formatMon(activeRr, 0), unit:'/min', alarm:false },
                  { testId: 'vent-mv', label:'MVe', value: formatMon(activeMv, 1), unit:'L/min', alarm:false },
                  { testId: 'vent-ie', label:'I:E', value: ventingActive ? String(props.parameters.ratio || '-') : '-', unit:'', alarm:false },
                  { testId: 'vent-titot', label:'Ti/Ttot', value: formatMon(props.parameters.tiTtot, 2), unit:'', alarm:false },
                ]},
                { title: t.panelVolumes?.toUpperCase() || 'VOLUMI', color:'#34b6ee', tiles:[
                  { testId: 'vent-vti', label:'VTi', value: formatMon(activeVti, 0), unit:'ml', alarm:false },
                  { testId: 'vent-vte', label:'VTe', value: formatMon(activeVte, 0), unit:'ml', alarm:false },
                  { testId: 'vent-vtkg', label:'VT/kg', value: formatMon(activeVtKg, 1), unit:'ml/kg', alarm:false },
                ]},
                { title: t.panelMechanics?.toUpperCase() || 'MECCANICA', color:'#e9eef6', tiles:[
                  { testId: 'vent-cdyn', label:'Cdyn', value: ventingActive ? String(engineVent.state.patient.complianceMlPerCmH2O || '-') : '-', unit:'ml/cmH₂O', alarm:false },
                  { testId: 'vent-fio2', label:'FiO₂', value: formatMon(activeFio2, 0), unit:'%', alarm:false },
                  { testId: 'vent-spo2', label:'SpO₂', value: formatMon(activeSpo2, 0), unit:'%', alarm:false },
                ]},
              ];

              return monGroup.map((g, i) => (
                <React.Fragment key={i}>
                  <div style={{ fontSize:'9.5px', letterSpacing:'1px', color:'#6f7c90', fontWeight:600, margin:'5px 0 3px' }}>{g.title}</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px' }}>
                    {g.tiles.map((tItem, j) => (
                      <div key={j} className="bedside-mon-tile" style={{ background:'var(--surface-2)', border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'4px 8px', display:'flex', flexDirection:'column', gap:'1px', minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'4px', minHeight:'12px' }}>
                          {tItem.alarm && <svg width="10" height="10" viewBox="0 0 24 24" fill="#f5b942"><path d="M12 2a2 2 0 0 0-2 2v.4A7 7 0 0 0 5 11v4l-2 3v1h18v-1l-2-3v-4a7 7 0 0 0-5-6.6V4a2 2 0 0 0-2-2zM9.5 20a2.5 2.5 0 0 0 5 0z"></path></svg>}
                          <span style={{ fontSize:'10px', color:'#8a97ad', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tItem.label}</span>
                        </div>
                        <div style={{ display:'flex', alignItems:'baseline', gap:'4px', minWidth:0 }}>
                          <span data-testid={tItem.testId} style={{ fontFamily:'monospace', fontSize:'17px', fontWeight:600, lineHeight:1, color:g.color }}>{tItem.value}</span>
                          <span style={{ fontSize:'9.5px', color:'#6f7c90', whiteSpace:'nowrap' }}>{tItem.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </React.Fragment>
              ));
            })()}
          </div>
        </div>
      </div>

      {/* BOTTOM CONTROL STRIP: Shared VentControls */}
      <div style={{ flex: '0 0 auto', padding: '8px 16px', background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
        <VentControls
          active={engineVent.state.device}
          canChangeSettings={true}
          canChangeDevice={true}
          allowInvasiveSwitch={true}
          pbwKg={predictedBodyWeightKg(engineVent.state.patient.sex, engineVent.state.patient.heightCm)}
          onApply={(next) => {
            engineVent.setDevice(next);
            setActiveEngineMode(next.device === 'invasive' ? next.mode : next.device);
          }}
        />
      </div>

      {/* SCRIM */}
      {drawer !== 'none' && <div onClick={closeDrawer} style={{ position:'absolute', inset:0, background:'rgba(4,7,12,.55)', zIndex:40 }}></div>}

      {/* STANDBY DRAWER */}
      <div style={{ position:'absolute', top:0, left:0, bottom:0, width:'360px', background:'#0e1521', zIndex:50, display:'flex', flexDirection:'column', boxShadow:'22px 0 60px rgba(0,0,0,.45)', transition:'transform .32s cubic-bezier(.4,0,.2,1)', transform: drawer==='standby' ? 'translateX(0)' : 'translateX(-105%)' }}>
        <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 22px 14px' }}>
          <span style={{ fontSize:'17px', fontWeight:600 }}>{t.ventilationLabel || 'Ventilazione'}</span>
          <button onClick={closeDrawer} style={{ width:'34px', height:'34px', borderRadius:'50%', background:'rgba(255,255,255,.06)', border:'none', color:'#aeb8c8', fontSize:'18px', cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'6px 22px 26px', display:'flex', flexDirection:'column', gap:'18px' }}>
          <div style={{ background:'#121a28', borderRadius:'14px', padding:'18px', display:'flex', alignItems:'center', gap:'14px' }}>
            <span style={{ width:'12px', height:'12px', borderRadius:'50%', background:statusDot, boxShadow:`0 0 10px ${statusDot}` }}></span>
            <div>
              <div style={{ fontSize:'11px', letterSpacing:'1px', color:'#6f7c90', fontWeight:600 }}>{t.statusLabel || 'STATO'}</div>
              <div style={{ fontSize:'18px', fontWeight:600, color:statusColor, marginTop:'2px' }}>{venting ? t.ventilationActiveStatus || 'Ventilazione attiva' : t.ventilationStandbyStatus || 'In standby'}</div>
            </div>
          </div>
          <button onClick={props.onToggleVentilation} style={{ width:'100%', padding:'26px 0', background: venting ? 'linear-gradient(180deg,#f4b740,#e7a316)' : 'linear-gradient(180deg,#46c97e,#2fa564)', color: venting ? '#1a1205' : '#06150d', border:'none', borderRadius:'16px', fontSize:'17px', fontWeight:700, letterSpacing:'.5px', cursor:'pointer', boxShadow:'0 8px 24px rgba(0,0,0,.3)' }}>
            {venting ? t.standbyVentilationButton || 'METTI IN STANDBY' : t.startVentilationButton || 'AVVIA VENTILAZIONE'}
          </button>
          <div style={{ fontSize:'12.5px', color:'#6f7c90', lineHeight:1.5 }}>{t.ventilationStandbyMsg || 'In standby le erogazioni si interrompono ma i parametri impostati vengono mantenuti.'}</div>
        </div>
      </div>

      {/* MODALITÀ DRAWER */}
      <div style={{ position:'absolute', top:0, left:0, bottom:0, width:'404px', background:'#0e1521', zIndex:50, display:'flex', flexDirection:'column', boxShadow:'22px 0 60px rgba(0,0,0,.45)', transition:'transform .32s cubic-bezier(.4,0,.2,1)', transform: drawer==='mode' ? 'translateX(0)' : 'translateX(-105%)' }}>
        <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 22px 12px' }}>
          <span style={{ fontSize:'17px', fontWeight:600 }}>{t.modesDrawerTitle || 'Ventilation Mode'}</span>
          <button onClick={closeDrawer} style={{ width:'34px', height:'34px', borderRadius:'50%', background:'rgba(255,255,255,.06)', border:'none', color:'#aeb8c8', fontSize:'18px', cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'2px 22px 16px' }}>
          {(() => {
            const currentModeConfig = VENT_MODES_CONFIG[props.currentMode];
            const currentModeLabel = currentModeConfig ? t[currentModeConfig.acronymKey] : String(props.currentMode);
            return (
              <div style={{ fontSize:'12px', color:'#6f7c90', marginBottom:'10px' }}>
                {t.modesDrawerActiveLabel || 'Active:'} <span style={{ color:'#e9eef6', fontWeight:600 }}>{currentModeLabel}</span>
              </div>
            );
          })()}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
            {modeData.map((m, i) => (
              <button key={i} onClick={m.sel} style={{ padding:'14px 0', border:'none', borderRadius:'11px', fontSize:'15px', fontWeight:700, cursor:'pointer', background:m.bg, color:m.fg }}>{m.label}</button>
            ))}
          </div>
          {(() => {
            const pendingModeConfig = VENT_MODES_CONFIG[pendingMode];
            const pendingModeLabel = pendingModeConfig ? t[pendingModeConfig.acronymKey] : String(pendingMode);
            return (
              <div style={{ fontSize:'11px', letterSpacing:'1.3px', color:'#6f7c90', fontWeight:600, margin:'22px 0 4px' }}>
                {t.modesDrawerParamsTitle || 'PARAMETERS'} · {pendingModeLabel}
              </div>
            );
          })()}
          {(() => {
              // Same mapping
              let pKeys: ParameterKey[] = [];
              if (pendingMode === 'VC' || pendingMode as any === 'VCV') pKeys = ['volume', 'frequency', 'peep', 'fio2', 'ratio', 'inspiratoryPausePercent'];
              else if (pendingMode === 'PC' || pendingMode as any === 'PCV') pKeys = ['pressureTarget', 'frequency', 'peep', 'fio2', 'ratio', 'inspiratoryRiseTimeSeconds'];
              else if (pendingMode === 'SIMV') pKeys = ['volume', 'frequency', 'peep', 'fio2', 'psLevel', 'inspiratoryPausePercent'];
              else if (pendingMode === 'PS' || pendingMode as any === 'PSV') pKeys = ['psLevel', 'peep', 'fio2', 'triggerFlow', 'inspiratoryRiseTimeSeconds'];
              else if (pendingMode as any === 'CPAP') pKeys = ['peep', 'fio2'];
              else pKeys = ['volume', 'frequency', 'peep', 'fio2'];

              return pKeys.map((pk) => {
                  const info = getParamInfo(pk);
                  return (
                      <div key={pk} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'9px 2px', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
                        <span style={{ fontSize:'13.5px', color:'#9aa6ba' }}>{info.label}</span>
                        <div style={{ display:'flex', alignItems:'center', gap:'11px' }}>
                            <button onClick={() => props.onOpenParameterModal(pk, info.label, props.parameters[pk] ?? '', info.unit)} style={{ padding:'6px 12px', background:'rgba(255,255,255,.08)', border:'none', borderRadius:'8px', color:'#e9eef6', cursor:'pointer' }}>{t.modalEditTitlePrefix?.trim() || 'Set'}</button>
                            <div style={{ minWidth:'74px', textAlign:'center' }}><span style={{ fontFamily:'monospace', fontSize:'15px', color:'#e9eef6', fontWeight:600 }}>{info.display}</span> <span style={{ fontSize:'11px', color:'#6f7c90' }}>{info.unit}</span></div>
                        </div>
                      </div>
                  )
              });
          })()}
        </div>
        <div style={{ flex:'0 0 auto', padding:'14px 22px 20px', borderTop:'1px solid rgba(255,255,255,.05)' }}>
          {(() => {
            const pendingModeConfig = VENT_MODES_CONFIG[pendingMode];
            const pendingModeLabel = pendingModeConfig ? t[pendingModeConfig.acronymKey] : String(pendingMode);
            return (
              <button onClick={confirmMode} style={{ width:'100%', padding:'16px 0', background:accent, color:'#fff', border:'none', borderRadius:'13px', fontSize:'14.5px', fontWeight:700, letterSpacing:'.4px', cursor:'pointer' }}>
                {t.modesConfirmAndStartButton || 'CONFIRM AND START'} · {pendingModeLabel}
              </button>
            );
          })()}
        </div>
      </div>

      {/* MANOVRE DRAWER */}
      <div style={{ position:'absolute', top:0, left:0, bottom:0, width:'392px', background:'#0e1521', zIndex:50, display:'flex', flexDirection:'column', boxShadow:'22px 0 60px rgba(0,0,0,.45)', transition:'transform .32s cubic-bezier(.4,0,.2,1)', transform: drawer==='maneuvers' ? 'translateX(0)' : 'translateX(-105%)' }}>
        <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 22px 14px' }}>
          <span style={{ fontSize:'17px', fontWeight:600 }}>{t.maneuversDrawerTitle || 'Respiratory Maneuvers'}</span>
          <button onClick={closeDrawer} style={{ width:'34px', height:'34px', borderRadius:'50%', background:'rgba(255,255,255,.06)', border:'none', color:'#aeb8c8', fontSize:'18px', cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'4px 22px 26px' }}>
          <div style={{ display:'flex', gap:'10px' }}>
            <button onClick={props.onStartInspiratoryHold} style={{ flex:1, padding:'16px 0', borderRadius:'12px', background: props.activeManeuver === 'insp_hold' ? 'rgba(70,201,126,.25)' : 'rgba(47,155,245,.14)', color: props.activeManeuver === 'insp_hold'  ? '#7fe0a6' : '#7ec0ff', fontSize:'14px', fontWeight:600, cursor:'pointer', border: props.activeManeuver === 'insp_hold' ? '1px solid #46c97e' : 'none' }}>{t.inspiratoryHoldButton || 'Insp. Hold'}</button>
            <button onClick={props.onStartExpiratoryHold} style={{ flex:1, padding:'16px 0', borderRadius:'12px', background: props.activeManeuver === 'exp_hold' ? 'rgba(70,201,126,.25)' : 'rgba(47,155,245,.14)', color: props.activeManeuver === 'exp_hold'  ? '#7fe0a6' : '#7ec0ff', fontSize:'14px', fontWeight:600, cursor:'pointer', border: props.activeManeuver === 'exp_hold' ? '1px solid #46c97e' : 'none' }}>{t.expiratoryHoldButton || 'Exp. Hold'}</button>
          </div>
          
          {props.activeManeuver && (
            <div style={{ marginTop:'14px', padding:'12px', background:'rgba(70,201,126,.1)', border:'1px solid rgba(70,201,126,.2)', borderRadius:'10px', display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#46c97e' }}></span>
              <span style={{ fontSize:'12.5px', color:'#7fe0a6', fontWeight:500 }}>{t.maneuversDrawerMeasuring || 'Measurement in progress...'}</span>
            </div>
          )}

          {!props.maneuverResultsPackage && !props.activeManeuver && (
            <div style={{ marginTop:'14px', display:'flex', flexDirection:'column', gap:'8px' }}>
              {(!props.hasInspHold && !props.hasExpHold) && (
                <div style={{ fontSize:'12.5px', color:'#6f7c90', lineHeight:1.45 }}>
                  {t.maneuversDrawerReportHeading || "Perform both holds."}
                </div>
              )}
              {props.hasInspHold && !props.hasExpHold && (
                <div style={{ padding:'12px', background:'rgba(70,201,126,0.06)', border:'1px dashed rgba(70,201,126,0.3)', borderRadius:'10px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', color:'#46c97e', fontSize:'13px', fontWeight:600 }}>
                    <span>✓</span> {t.maneuversDrawerInspHoldSuccess || "Inspiratory Hold completed!"}
                  </div>
                  <div style={{ fontSize:'12px', color:'#8a97ad', marginTop:'4px', lineHeight:1.4 }}>
                    {t.maneuversDrawerInspHoldTip || "Now perform Expiratory Hold."}
                  </div>
                </div>
              )}
              {props.hasExpHold && !props.hasInspHold && (
                <div style={{ padding:'12px', background:'rgba(70,201,126,0.06)', border:'1px dashed rgba(70,201,126,0.3)', borderRadius:'10px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', color:'#46c97e', fontSize:'13px', fontWeight:600 }}>
                    <span>✓</span> {t.maneuversDrawerExpHoldSuccess || "Expiratory Hold completed!"}
                  </div>
                  <div style={{ fontSize:'12px', color:'#8a97ad', marginTop:'4px', lineHeight:1.4 }}>
                    {t.maneuversDrawerExpHoldTip || "Now perform Inspiratory Hold."}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {props.maneuverResultsPackage && (
            <div style={{ marginTop:'14px', background:'#121a28', borderRadius:'13px', padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
                <span style={{ fontSize:'11.5px', fontWeight:600, letterSpacing:'.4px', color:accent }}>{t[props.maneuverResultsPackage.titleKey] || 'RISULTATI MANOVRE'}</span>
                <button onClick={props.onClearManeuverResults} style={{ width:'26px', height:'26px', borderRadius:'50%', background:'rgba(255,255,255,.06)', border:'none', color:'#aeb8c8', fontSize:'14px', cursor:'pointer', lineHeight:1 }}>✕</button>
              </div>
              {props.maneuverResultsPackage.parameters.map((p, index) => {
                const labelText = t[p.labelKey] || p.labelKey;
                const unitText = t[p.result.unitKey] || p.result.unitKey;
                return (
                  <div key={index} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
                    <span style={{ fontSize:'13px', color:'#9aa6ba' }}>{labelText}</span>
                    <div style={{ display:'flex', alignItems:'baseline', gap:'10px' }}>
                      <span style={{ fontFamily:'monospace', fontSize:'15px', color:'#e9eef6', fontWeight:600, width:'55px', textAlign:'right' }}>{p.result.value}</span>
                      <span style={{ fontSize:'10px', color:'#6f7c90', fontWeight:400, width:'85px', textAlign:'left' }}>{unitText}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* UMIDIFICATORE DRAWER */}
      <div style={{ position:'absolute', top:0, left:0, bottom:0, width:'360px', background:'#0e1521', zIndex:50, display:'flex', flexDirection:'column', boxShadow:'22px 0 60px rgba(0,0,0,.45)', transition:'transform .32s cubic-bezier(.4,0,.2,1)', transform: drawer==='humid' ? 'translateX(0)' : 'translateX(-105%)' }}>
        <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 22px 14px' }}>
          <span style={{ fontSize:'17px', fontWeight:600 }}>{t.humidifierLabel || "UMIDIFICATORE"}</span>
          <button onClick={closeDrawer} style={{ width:'34px', height:'34px', borderRadius:'50%', background:'rgba(255,255,255,.06)', border:'none', color:'#aeb8c8', fontSize:'18px', cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'4px 22px 26px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'15px 16px', background:'#121a28', borderRadius:'13px' }}>
            <span style={{ fontSize:'14px', color:'#e9eef6', fontWeight:500 }}>{t.humidifierDrawerStatusLabel || 'Status'} · {humidOn ? (t.humidifierStatusOn || 'ON') : (t.humidifierStatusOff || 'OFF')}</span>
            <button onClick={props.onToggleHumidifierPower} style={{ position:'relative', width:'54px', height:'30px', borderRadius:'999px', border:'none', cursor:'pointer', background: humidOn ? accent : 'rgba(255,255,255,.15)', transition:'background .2s' }}>
              <span style={{ position:'absolute', top:'3px', left: humidOn ? '27px' : '3px', width:'24px', height:'24px', borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.4)' }}></span>
            </button>
          </div>
          {humidOn && (
            <div style={{ marginTop:'16px' }}>
              <div style={{ fontSize:'11px', letterSpacing:'1.3px', color:'#6f7c90', fontWeight:600, margin:'0 0 4px' }}>{t.humidifierDrawerSettingHeading || 'TEMPERATURE REGULATION'}</div>
              {[
                { key: 'humidifierTemperature', label: t.humidifierDrawerTempLabel || 'Circuit temperature', display: props.humidifierSettings.temperature.toString(), unit: '°C' }
              ].map((p, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'12px 2px', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
                  <span style={{ fontSize:'13.5px', color:'#9aa6ba' }}>{p.label}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'11px' }}>
                    <button onClick={() => props.onOpenParameterModal(p.key as ParameterKey, p.label, p.display, p.unit)} style={{ padding:'6px 12px', background:'rgba(255,255,255,.08)', border:'none', borderRadius:'8px', color:'#e9eef6', cursor:'pointer' }}>{t.modalEditTitlePrefix?.trim() || 'Set'}</button>
                    <div style={{ minWidth:'64px', textAlign:'center' }}><span style={{ fontFamily:'monospace', fontSize:'15px', color:'#e9eef6', fontWeight:600 }}>{p.display}</span> <span style={{ fontSize:'11px', color:'#6f7c90' }}>{p.unit}</span></div>
                  </div>
                </div>
              ))}

              <div style={{ marginTop:'22px' }}>
                <div style={{ fontSize:'11px', letterSpacing:'1.3px', color:'#6f7c90', fontWeight:600, margin:'0 0 10px' }}>{t.humidifierDrawerLevelHeading || 'HUMIDIFICATION LEVEL (1 - 5)'}</div>
                <div style={{ display:'flex', gap:'8px' }}>
                  {[1, 2, 3, 4, 5].map((lvl) => {
                    const isSelected = (props.humidifierSettings.level || 3) === lvl;
                    return (
                      <button 
                        key={lvl} 
                        onClick={() => props.onSetHumidifierLevel?.(lvl)}
                        style={{ 
                          flex:1, 
                          padding:'11px 0', 
                          border:'none', 
                          borderRadius:'10px', 
                          fontWeight:isSelected ? 700 : 500, 
                          fontSize:'15px', 
                          cursor:'pointer', 
                          background: isSelected ? accent : 'rgba(255,255,255,.07)', 
                          color: isSelected ? '#ffffff' : '#aeb8c8',
                          boxShadow: isSelected ? `0 4px 12px ${accent}40` : 'none',
                          transition:'all .15s'
                        }}
                      >
                        {lvl}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize:'11.5px', color:'#6f7c90', marginTop:'12px', lineHeight:1.45 }}>
                  {t.humidifierDrawerLevelDescription || 'Set ideal level.'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
