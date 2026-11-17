import React, { useState } from 'react';
import { HighFlowAnimation } from './HighFlowAnimation';
import { THEME_CONFIG } from '../constants';
import {
  VentilationMode,
  AllParameters,
  OperatingMode,
  ICUSubMode,
  ActiveManeuver,
  ThemeName,
  SweepSpeedValue,
  VentilatorData,
} from '../types';
import { useLanguage } from '../src/contexts/LanguageContext';
import type { WaveformSample } from '../src/shared/engineTypes';
import { SweepWaveforms, Loops, DISPLAY_TEST_IDS, type DisplayScaleMode } from '../src/display';

interface GraphsPanelProps {
  isSimulatorOn: boolean;
  isVentilationActive: boolean;
  isWarmingUpHF: boolean;
  isMechanicalVentilation: boolean;
  isHighFlowMode: boolean;
  operatingMode: OperatingMode | null;
  icuSubMode: ICUSubMode | null;
  currentMode: VentilationMode;
  currentTheme: ThemeName;
  parameters: AllParameters;
  ventilatorData: VentilatorData | null;
  areWaveformsFrozen: boolean;
  activeManeuver: ActiveManeuver | null;
  onToggleFreezeWaveforms: () => void;
  currentSweepSpeedValue: SweepSpeedValue;
  scanlinePixelRate: number;
  onChangeSweepSpeed: () => void;
  isModernTheme?: boolean;
  onOpenModeDrawer?: () => void;
  onToggleVentilation?: () => void;
  engineSamples?: WaveformSample[];
}

export const GraphsPanel: React.FC<GraphsPanelProps> = ({
  isVentilationActive,
  isWarmingUpHF,
  isHighFlowMode,
  operatingMode,
  icuSubMode,
  currentMode,
  currentTheme,
  parameters,
  ventilatorData,
  areWaveformsFrozen,
  activeManeuver,
  onToggleFreezeWaveforms,
  currentSweepSpeedValue,
  onChangeSweepSpeed,
  onOpenModeDrawer,
  onToggleVentilation,
  engineSamples,
}) => {
  const { t } = useLanguage();
  const themeColors = THEME_CONFIG[currentTheme] ?? THEME_CONFIG.icu;
  const actuallyIsHighFlow = isHighFlowMode || (operatingMode === 'icu' && icuSubMode === 'high-flow');

  const [activeTab, setActiveTab] = useState<'waveforms' | 'loops'>('waveforms');
  const [scaleMode, setScaleMode] = useState<DisplayScaleMode>('auto');

  if (actuallyIsHighFlow) {
    return (
      <div className="bg-gray-900 p-4 flex flex-col justify-start items-center overflow-hidden h-full">
        <div className="text-lg font-bold mb-4 text-white border-b-2 border-gray-700 pb-1 self-stretch text-center">
          {t.highFlowAnimationTitle}
        </div>
        {isVentilationActive ? (
          <HighFlowAnimation
            fgfValue={Number(parameters.fgf) || 0}
            currentTheme={currentTheme}
            isVentilationActive={isVentilationActive}
          />
        ) : (
          <div className="flex-grow flex justify-center items-center text-2xl text-gray-400">
            {isWarmingUpHF ? t.status_warming_up : t.oxygenationStandbyStatus}
          </div>
        )}
      </div>
    );
  }

  const samples = engineSamples ?? [];
  const windowSec = currentSweepSpeedValue === 50 ? 6 : currentSweepSpeedValue === 10 ? 16 : 10;

  return (
    <div data-testid="waveform-plot" className="flex-1 flex flex-col gap-2 py-2 px-3 min-w-0 min-h-0 relative" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {!isVentilationActive && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-[3px] transition-all duration-300" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="p-6 max-w-sm rounded border flex flex-col items-center text-center gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--line-strong)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold animate-pulse" style={{ background: 'var(--act-soft)', color: 'var(--act)' }}>
              ⚠️
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text)' }}>{t.ventilationStandbyStatus?.toUpperCase() || 'VENTILAZIONE IN STANDBY'}</h3>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>{t.ventilationStandbyMsg || 'In standby le erogazioni si interrompono ma i parametri impostati vengono mantenuti.'}</p>
            </div>
            <button onClick={onToggleVentilation || onOpenModeDrawer} className="mt-1 px-4 py-2 vt-btn vt-btn--confirm text-xs font-bold rounded cursor-pointer">
              {t.startVentilationButton || 'AVVIA VENTILAZIONE'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-none flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {onOpenModeDrawer && (
            <button onClick={onOpenModeDrawer} className="flex items-center gap-2 px-3 py-1 border rounded cursor-pointer" style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text)' }}>
              <span className="text-[11px] tracking-widest font-semibold" style={{ color: 'var(--text-3)' }}>{t.modeLabel || 'MODALITÀ'}</span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--act)' }}>{currentMode}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
            </button>
          )}
          <div className="flex items-center rounded p-0.5 border" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}>
            <button
              type="button"
              data-testid={DISPLAY_TEST_IDS.TAB_WAVEFORMS}
              onClick={() => setActiveTab('waveforms')}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                activeTab === 'waveforms' ? 'bg-[var(--sel)] text-white font-bold' : 'text-[var(--text-2)] hover:text-[var(--text)]'
              }`}
            >
              Waveforms
            </button>
            <button
              type="button"
              data-testid={DISPLAY_TEST_IDS.TAB_LOOPS}
              onClick={() => setActiveTab('loops')}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors cursor-pointer ${
                activeTab === 'loops' ? 'bg-[var(--sel)] text-white font-bold' : 'text-[var(--text-2)] hover:text-[var(--text)]'
              }`}
            >
              Loops
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onChangeSweepSpeed} className="px-2.5 py-1 text-xs font-medium border rounded cursor-pointer font-mono whitespace-nowrap vt-btn !min-h-[26px]" style={{ color: 'var(--text-2)' }}>
            {t.sweepSpeedButtonPrefix || 'Velocità'} · {currentSweepSpeedValue} mm/s
          </button>
          <button
            onClick={onToggleFreezeWaveforms}
            disabled={activeManeuver !== null}
            className={`px-3 py-1 text-xs font-semibold border rounded cursor-pointer transition-colors vt-btn !min-h-[26px] ${areWaveformsFrozen ? 'vt-btn--primary' : ''}`}
          >
            {areWaveformsFrozen ? (t.unfreezeWaveformsButton || 'Sblocca') : (t.freezeWaveformsButton || 'Blocca')}
          </button>
        </div>
      </div>

      {/* SHARED DISPLAY FROM src/display */}
      <div className="flex-1 relative rounded overflow-hidden min-h-0" style={{ background: 'var(--wave-bg)', border: '1px solid var(--line)' }}>
        {activeTab === 'waveforms' ? (
          <SweepWaveforms
            samples={samples}
            speed={1}
            windowSec={windowSec}
            playing={isVentilationActive && !areWaveformsFrozen}
            frozen={areWaveformsFrozen}
            scaleMode={scaleMode}
            onToggleFreeze={onToggleFreezeWaveforms}
            onScaleModeChange={setScaleMode}
            height="100%"
          />
        ) : (
          <Loops
            samples={samples}
            frozen={areWaveformsFrozen}
            height="100%"
          />
        )}
      </div>
    </div>
  );
};
