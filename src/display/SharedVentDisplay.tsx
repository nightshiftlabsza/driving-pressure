import React, { useState } from 'react';
import type { DeviceSettings, EngineState, WaveformSample } from '../shared/engineTypes';
import type { AlarmState, Limits } from '../alarms';
import { SweepWaveforms } from './SweepWaveforms';
import { Loops } from './Loops';
import { VentNumerics, MonitorStrip } from './Numerics';
import { AlarmBanner } from './AlarmBanner';
import { DISPLAY_TEST_IDS, type DisplayScaleMode } from './types';

export interface SharedVentDisplayProps {
  engineState: EngineState;
  samples: WaveformSample[];
  alarmState: AlarmState;
  limits: Limits;
  speed?: number;
  isPaused?: boolean;
  onSilenceAlarms: () => void;
  onAcknowledgeAlarm: (id: string) => void;
  onToggleFreeze?: () => void;
  onOpenLimits?: () => void;
}

export const SharedVentDisplay: React.FC<SharedVentDisplayProps> = ({
  engineState,
  samples,
  alarmState,
  limits,
  speed = 1,
  isPaused = false,
  onSilenceAlarms,
  onAcknowledgeAlarm,
  onToggleFreeze,
  onOpenLimits,
}) => {
  const [activeTab, setActiveTab] = useState<'waveforms' | 'loops'>('waveforms');
  const [scaleMode, setScaleMode] = useState<DisplayScaleMode>('auto');
  const [isFrozenInternal, setIsFrozenInternal] = useState(false);

  const effectiveFrozen = isPaused || isFrozenInternal;

  const handleToggleFreeze = () => {
    if (onToggleFreeze) {
      onToggleFreeze();
    } else {
      setIsFrozenInternal(prev => !prev);
    }
  };

  const m = engineState.monitored;
  const dev = engineState.device;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* 1. Alarm Banner */}
      <AlarmBanner
        alarmState={alarmState}
        simTimeSec={m.simTimeSec}
        onSilence={onSilenceAlarms}
        onAcknowledge={onAcknowledgeAlarm}
        audible={!isPaused}
      />

      {/* 2. Top Nav (Waveforms vs Loops tabs & settings) */}
      <div className="flex items-center justify-between px-3 py-1 border-b text-xs" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid={DISPLAY_TEST_IDS.TAB_WAVEFORMS}
            className={`px-3 py-1 font-semibold rounded-xs text-xs transition-colors border ${
              activeTab === 'waveforms'
                ? 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)] shadow-xs'
                : 'text-[var(--text-2)] hover:text-[var(--text)] border-transparent hover:bg-[var(--surface-3)]'
            }`}
            onClick={() => setActiveTab('waveforms')}
          >
            Waveforms (Paw / Flow / Vol)
          </button>
          <button
            type="button"
            data-testid={DISPLAY_TEST_IDS.TAB_LOOPS}
            className={`px-3 py-1 font-semibold rounded-xs text-xs transition-colors border ${
              activeTab === 'loops'
                ? 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)] shadow-xs'
                : 'text-[var(--text-2)] hover:text-[var(--text)] border-transparent hover:bg-[var(--surface-3)]'
            }`}
            onClick={() => setActiveTab('loops')}
          >
            Loops (P-V / F-V)
          </button>
        </div>

        <div className="flex items-center gap-2">
          {onOpenLimits && (
            <button
              type="button"
              className="vt-btn vt-btn--quiet !text-xs !min-h-[26px] !px-2"
              onClick={onOpenLimits}
            >
              Alarm Limits
            </button>
          )}
        </div>
      </div>

      {/* 3. Main Center Display: Graphical Waveforms/Loops + Side Numerics Panel */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Graphical curves / loops */}
        <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--wave-bg)' }}>
          {activeTab === 'waveforms' ? (
            <div className="relative flex-1 min-h-[300px]"><div className="absolute inset-0 flex flex-col">
            <SweepWaveforms
              height="100%"
              samples={samples}
              speed={speed}
              playing={!effectiveFrozen}
              frozen={effectiveFrozen}
              scaleMode={scaleMode}
              onToggleFreeze={handleToggleFreeze}
              onScaleModeChange={setScaleMode}
            />
            </div></div>
          ) : (
            <Loops
              samples={samples}
              frozen={effectiveFrozen}
            />
          )}
        </div>

        {/* Numerics Panel */}
        <div className="w-full lg:w-80 flex-none border-t lg:border-t-0 lg:border-l p-2 overflow-y-auto flex flex-col gap-2" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
          <div className="flex items-center justify-between text-xs font-semibold border-b pb-1" style={{ color: 'var(--text-2)', borderColor: 'var(--line)' }}>
            <span>VENTILATOR VALUES</span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>SIM {m.simTimeSec.toFixed(0)}s</span>
          </div>
          <VentNumerics
            m={m}
            device={dev}
            alarms={alarmState.alarms}
            limits={limits}
            lastManoeuvre={engineState.lastManoeuvre}
            holdTiles={false}
            onLimits={onOpenLimits}
          />

          <div className="flex items-center justify-between text-xs font-semibold border-b pb-1 pt-1 mt-1" style={{ color: 'var(--text-2)', borderColor: 'var(--line)' }}>
            <span>PATIENT MONITOR</span>
          </div>
          <MonitorStrip
            m={m}
            alarms={alarmState.alarms}
            limits={limits}
          />
        </div>
      </div>
    </div>
  );
};
