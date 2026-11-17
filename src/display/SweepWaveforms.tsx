import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { WaveformSample } from '../shared/engineTypes';
import { DISPLAY_TEST_IDS, type CursorSample, type DisplayScaleMode } from './types';

interface Channel {
  label: string;
  unit: string;
  colour: string;
  value: (s: WaveformSample) => number;
  /** Candidate [min, max] scales, smallest first. */
  scales: readonly (readonly [number, number])[];
  fixedScale: readonly [number, number];
}

const CHANNELS: readonly Channel[] = [
  {
    label: 'Paw',
    unit: 'cmH2O',
    colour: '--ch-paw',
    value: s => s.pawCmH2O,
    scales: [[0, 30], [0, 40], [0, 60], [0, 80]],
    fixedScale: [0, 40],
  },
  {
    label: 'Flow',
    unit: 'L/min',
    colour: '--ch-flow',
    value: s => s.flowLps * 60,
    scales: [[-60, 60], [-90, 90], [-120, 120], [-180, 180]],
    fixedScale: [-60, 60],
  },
  {
    label: 'Volume',
    unit: 'mL',
    colour: '--ch-vol',
    value: s => s.volumeMl,
    scales: [[0, 600], [0, 800], [0, 1000], [0, 1500], [0, 2000]],
    fixedScale: [0, 800],
  },
];

interface Palette {
  channel: string[];
  grid: string;
  gridStrong: string;
  text: string;
  textDim: string;
  cursor: string;
  bg: string;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    channel: CHANNELS.map(c => v(c.colour, '#ccc')),
    grid: v('--grid', 'rgba(150,165,180,0.13)'),
    gridStrong: v('--grid-strong', 'rgba(150,165,180,0.32)'),
    text: v('--text-2', '#a3aeb9'),
    textDim: v('--text-3', '#75818d'),
    cursor: v('--text', '#f59e0b'),
    bg: v('--wave-bg', '#0b1018'),
  };
}

export interface SweepWaveformsProps {
  samples: WaveformSample[];
  speed?: number;
  playing?: boolean;
  frozen?: boolean;
  windowSec?: number;
  height?: number | string;
  scaleMode?: DisplayScaleMode;
  onToggleFreeze?: () => void;
  onScaleModeChange?: (mode: DisplayScaleMode) => void;
  /** Last breath(s) from before the latest setting change, already shifted to start at the change time. */
  ghost?: WaveformSample[];
}

const LAG_SEC = 0.02;
const GAP_FRACTION = 0.03;

export const SweepWaveforms: React.FC<SweepWaveformsProps> = ({
  samples,
  speed = 1,
  playing = true,
  frozen = false,
  windowSec = 10,
  height = 300,
  scaleMode = 'auto',
  onToggleFreeze,
  onScaleModeChange,
  ghost: ghostIn,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursorInfo, setCursorInfo] = useState<CursorSample | null>(null);
  const [cursorXFrac, setCursorXFrac] = useState<number | null>(null);
  // Two-point caliper: a second point on the frozen trace, with time / pressure / flow deltas.
  const [cursorBInfo, setCursorBInfo] = useState<CursorSample | null>(null);
  const [cursorBXFrac, setCursorBXFrac] = useState<number | null>(null);
  const draggingPointRef = useRef<'a' | 'b' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Channel legend toggles: tapping a channel's legend entry hides or shows that waveform.
  const [channelVisible, setChannelVisible] = useState<boolean[]>(() => CHANNELS.map(() => true));

  // A new ghost (next setting change) shows again; the learner can hide the current one.
  const [ghostHiddenFor, setGhostHiddenFor] = useState<WaveformSample[] | null>(null);
  const ghost = ghostIn && ghostIn !== ghostHiddenFor ? ghostIn : undefined;

  const isActuallyFrozen = frozen || !playing;

  const propsRef = useRef({ samples, speed, isActuallyFrozen, windowSec, scaleMode, ghost, channelVisible });
  propsRef.current = { samples, speed, isActuallyFrozen, windowSec, scaleMode, ghost, channelVisible };

  // Track freeze/unfreeze transitions to clear cursor
  useEffect(() => {
    if (!isActuallyFrozen) {
      setCursorInfo(null);
      setCursorXFrac(null);
      setCursorBInfo(null);
      setCursorBXFrac(null);
    }
  }, [isActuallyFrozen]);

  const updateCursorFromEvent = useCallback((clientX: number, point: 'a' | 'b') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const left = 40;
    const right = 10;
    const plotW = Math.max(50, rect.width - left - right);
    const relX = clientX - rect.left - left;
    const frac = Math.max(0, Math.min(1, relX / plotW));
    if (point === 'a') setCursorXFrac(frac); else setCursorBXFrac(frac);

    const buf = propsRef.current.samples;
    if (!buf || buf.length === 0) return;

    const newest = buf[buf.length - 1].tSec;
    const W = propsRef.current.windowSec;
    const tStart = newest - W;
    const targetT = tStart + frac * W;

    // Find nearest sample
    let best = buf[0];
    let minDiff = Math.abs(buf[0].tSec - targetT);
    for (let i = 1; i < buf.length; i++) {
      const diff = Math.abs(buf[i].tSec - targetT);
      if (diff < minDiff) {
        minDiff = diff;
        best = buf[i];
      }
    }

    const info: CursorSample = {
      tSec: best.tSec,
      pawCmH2O: best.pawCmH2O,
      flowLpm: best.flowLps * 60,
      volumeMl: best.volumeMl,
    };
    if (point === 'a') setCursorInfo(info); else setCursorBInfo(info);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isActuallyFrozen) return;
    // First click places point A; every further click places or moves point B.
    const point = cursorInfo === null ? 'a' : 'b';
    draggingPointRef.current = point;
    setIsDragging(true);
    updateCursorFromEvent(e.clientX, point);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isActuallyFrozen || !isDragging || draggingPointRef.current === null) return;
    updateCursorFromEvent(e.clientX, draggingPointRef.current);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    draggingPointRef.current = null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext('2d') ?? null;
    } catch {
      ctx = null;
    }
    if (!canvas || !ctx) return;
    const g = ctx;
    const scaleIdx = CHANNELS.map(() => 0);
    let playhead = NaN;
    let lastFrame = performance.now();
    let raf = 0;
    let frameNo = 0;
    let pal = readPalette(canvas);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (++frameNo % 30 === 0) pal = readPalette(canvas);
      const { samples: buf, speed: sp, isActuallyFrozen: isFrozen, windowSec: W, scaleMode: curScaleMode, ghost: ghostBuf, channelVisible: visible } = propsRef.current;
      const dt = Math.min(0.25, (now - lastFrame) / 1000);
      lastFrame = now;

      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;

      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = pal.bg;
      g.fillRect(0, 0, cssW, cssH);

      const newest = buf.length ? buf[buf.length - 1].tSec : 0;
      const target = Math.max(0, newest - LAG_SEC);

      if (!Number.isFinite(playhead) || target - playhead > 0.12 || playhead - newest > 0.05) {
        playhead = target;
      } else if (!isFrozen) {
        playhead = Math.min(newest, playhead + dt * sp + (target - playhead) * Math.min(1, dt * 10));
      }

      const tStart = isFrozen ? newest - W : playhead - W * (1 - GAP_FRACTION);

      const left = 40, right = 10;
      const plotW = Math.max(50, cssW - left - right);
      // Fixed time axis: a labelled-seconds strip is reserved under the bottom channel.
      const AXIS_H = 14;
      const rowH = (cssH - AXIS_H) / CHANNELS.length;
      const xOf = (t: number) => {
        if (isFrozen) {
          return left + Math.max(0, Math.min(1, (t - tStart) / W)) * plotW;
        }
        return left + (((t % W) + W) % W) / W * plotW;
      };

      const rows: { ch: Channel; top: number; h: number; mn: number; mx: number; colour: string; chVisible: boolean }[] = [];
      CHANNELS.forEach((ch, i) => {
        const top = i * rowH + 8, h = rowH - 16;
        const colour = pal.channel[i]!;
        const chVisible = visible[i] !== false;

        let mn: number, mx: number;
        if (curScaleMode === 'fixed') {
          [mn, mx] = ch.fixedScale;
        } else {
          let lo = Infinity, hi = -Infinity;
          for (const s of buf) {
            if (s.tSec < tStart || (!isFrozen && s.tSec > playhead)) continue;
            const v = ch.value(s);
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          const hasFullSweep = buf.length > 0 && (newest - buf[0].tSec >= W * (1 - GAP_FRACTION));
          scaleIdx[i] = chooseScale(ch.scales, scaleIdx[i]!, lo, hi, hasFullSweep);
          [mn, mx] = ch.scales[scaleIdx[i]!]!;
        }

        const yOf = (v: number) => top + h - (Math.max(mn, Math.min(mx, v)) - mn) / (mx - mn) * h;

        // Grid lines
        g.strokeStyle = pal.grid;
        g.lineWidth = 1;
        g.setLineDash([2, 3]);
        g.beginPath();
        for (let k = 1; k < 4; k++) {
          const y = Math.round(top + (h * k) / 4) + 0.5;
          g.moveTo(left, y);
          g.lineTo(left + plotW, y);
        }
        for (let s = 1; s < W; s++) {
          const x = Math.round(left + (s / W) * plotW) + 0.5;
          g.moveTo(x, top);
          g.lineTo(x, top + h);
        }
        g.stroke();
        g.setLineDash([]);

        // Baseline / zero line
        g.strokeStyle = pal.gridStrong;
        g.beginPath();
        const base = Math.round(yOf(mn < 0 && mx > 0 ? 0 : mn)) + 0.5;
        g.moveTo(left, base);
        g.lineTo(left + plotW, base);
        g.moveTo(left - 0.5, top);
        g.lineTo(left - 0.5, top + h);
        g.stroke();

        rows.push({ ch, top, h, mn, mx, colour, chVisible });

        // Ghost of the waveform from before the last setting change: faint, dashed, muted token colour
        if (chVisible && ghostBuf && ghostBuf.length) {
          g.save();
          g.globalAlpha = 0.45;
          g.strokeStyle = pal.textDim;
          g.lineWidth = 1.5;
          g.setLineDash([5, 4]);
          g.beginPath();
          let gx = -1, gs = false;
          for (const s of ghostBuf) {
            if (s.tSec < tStart || s.tSec > (isFrozen ? newest : tStart + W)) continue;
            const x = xOf(s.tSec), y = yOf(ch.value(s));
            if (!gs || (!isFrozen && x < gx)) { g.moveTo(x, y); gs = true; } else g.lineTo(x, y);
            gx = x;
          }
          g.stroke();
          g.restore();
        }

        // Waveform trace (hidden when the channel is toggled off in the legend)
        if (chVisible) {
          g.strokeStyle = colour;
          g.lineWidth = 2;
          g.lineJoin = 'round';
          g.beginPath();
          let prevX = -1, started = false;
          for (const s of buf) {
            if (s.tSec < tStart || (!isFrozen && s.tSec > playhead)) continue;
            const x = xOf(s.tSec), y = yOf(ch.value(s));
            if (!started || (!isFrozen && x < prevX)) {
              g.moveTo(x, y);
              started = true;
            } else {
              g.lineTo(x, y);
            }
            prevX = x;
          }
          g.stroke();
        }
      });

      // Erase gap during live sweep
      if (!isFrozen && buf.length) {
        const cx = xOf(playhead);
        g.fillStyle = pal.bg;
        g.fillRect(cx + 1, 0, Math.max(0, Math.min(plotW * GAP_FRACTION, left + plotW - cx - 1)), cssH);
      }

      // Draw frozen cursors on canvas if active (point A, then caliper point B)
      if (isFrozen && cursorXFrac !== null) {
        const curX = left + cursorXFrac * plotW;
        g.strokeStyle = pal.cursor;
        g.lineWidth = 1.5;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(curX, 0);
        g.lineTo(curX, cssH);
        g.stroke();
        g.setLineDash([]);
      }
      if (isFrozen && cursorBXFrac !== null) {
        const curX = left + cursorBXFrac * plotW;
        g.strokeStyle = pal.cursor;
        g.lineWidth = 1.5;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(curX, 0);
        g.lineTo(curX, cssH);
        g.stroke();
        g.setLineDash([]);
      }

      // Channel labels and scale boundaries
      for (const { ch, top, h, mn, mx, colour, chVisible } of rows) {
        g.textBaseline = 'top';
        g.textAlign = 'left';
        g.fillStyle = chVisible ? colour : pal.textDim;
        g.font = chVisible ? '600 12px "Segoe UI", system-ui, sans-serif' : '12px "Segoe UI", system-ui, sans-serif';
        g.fillText(ch.label, left + 6, top + 2);
        const lw = g.measureText(ch.label).width;
        g.fillStyle = pal.textDim;
        g.font = '11px "Segoe UI", system-ui, sans-serif';
        g.fillText(ch.unit, left + 12 + lw, top + 3);

        g.textAlign = 'right';
        g.font = '11px Bahnschrift, "DIN Alternate", "Roboto Condensed", sans-serif';
        g.fillStyle = pal.text;
        g.textBaseline = 'top';
        g.fillText(String(mx), left - 5, top - 1);
        g.textBaseline = 'bottom';
        g.fillText(String(mn), left - 5, top + h + 1);
        if (mn < 0 && mx > 0) {
          g.textBaseline = 'middle';
          g.fillText('0', left - 5, top + h - (0 - mn) / (mx - mn) * h);
        }
      }

      // Fixed time axis: relative seconds of the 10-second window, labelled under the bottom channel.
      const axisLabels = timeAxisLabels(W);
      g.textBaseline = 'top';
      g.font = '9px Bahnschrift, "DIN Alternate", "Roboto Condensed", sans-serif';
      g.fillStyle = pal.textDim;
      for (let s = 0; s <= W; s++) {
        const x = left + (s / W) * plotW;
        g.textAlign = s === 0 ? 'left' : s === W ? 'right' : 'center';
        g.fillText(axisLabels[s]!, x, cssH - AXIS_H + 2);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [cursorXFrac, isActuallyFrozen]);

  return (
    <div className="relative flex flex-col w-full h-full select-none">
      {/* Waveform Controls Toolbar */}
      <div
        className="flex items-center justify-between px-2 py-1 border-b text-xs"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text)' }}
      >
        <div className="flex items-center gap-2">
          {onToggleFreeze && (
            <button
              type="button"
              data-testid={isActuallyFrozen ? DISPLAY_TEST_IDS.BTN_UNFREEZE : DISPLAY_TEST_IDS.BTN_FREEZE}
              className={`px-3 py-1 font-semibold rounded text-xs transition-colors border ${
                isActuallyFrozen
                  ? 'bg-[var(--alarm-med)] text-[var(--alarm-med-ink)] font-bold border-[var(--warn-line)]'
                  : 'vt-btn !min-h-[24px] !px-2.5 !py-0.5 text-xs'
              }`}
              onClick={onToggleFreeze}
            >
              {isActuallyFrozen ? 'UNFREEZE' : 'FREEZE'}
            </button>
          )}
          {ghostIn && ghostIn.length > 0 && (
            <button type="button" aria-pressed={!!ghost} data-testid="ghost-toggle" className="vt-btn !min-h-[24px] !px-2 !py-0.5 text-[11px] flex items-center gap-1"
              onClick={() => setGhostHiddenFor(ghost ? ghostIn : null)} title="Show or hide the waveform from before the last setting change">
              <span aria-hidden="true" className="inline-block w-4 border-t border-dashed" style={{ borderColor: "var(--text-3)" }} />
              <span data-testid="ghost-legend">before</span>
            </button>
          )}
          {/* Channel legend: tap a label to hide or show that waveform channel. */}
          <div className="flex items-center gap-1" role="group" aria-label="Waveform channels" data-testid="waveform-legend">
            {CHANNELS.map((ch, i) => {
              const visible = channelVisible[i] !== false;
              return (
                <button
                  key={ch.label}
                  type="button"
                  aria-pressed={visible}
                  data-testid={`waveform-legend-${ch.label}`}
                  className="vt-btn !min-h-[24px] !px-2 !py-0.5 text-[11px] flex items-center gap-1"
                  style={visible ? undefined : { opacity: 0.5 }}
                  title={visible ? `Hide ${ch.label}` : `Show ${ch.label}`}
                  onClick={() => setChannelVisible(v => v.map((x, j) => (j === i ? !x : x)))}
                >
                  <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: `var(${ch.colour})` }} />
                  {ch.label}
                </button>
              );
            })}
          </div>
          {onScaleModeChange && (
            <div
              className="flex items-center rounded p-0.5 border"
              style={{ background: 'var(--surface-3)', borderColor: 'var(--line)' }}
            >
              <button
                type="button"
                data-testid={DISPLAY_TEST_IDS.BTN_SCALE_AUTO}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  scaleMode === 'auto'
                    ? 'bg-[var(--surface-2)] text-[var(--text)] font-bold shadow-xs'
                    : 'text-[var(--text-3)] hover:text-[var(--text)]'
                }`}
                onClick={() => onScaleModeChange('auto')}
              >
                Auto Scale
              </button>
              <button
                type="button"
                data-testid={DISPLAY_TEST_IDS.BTN_SCALE_FIXED}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  scaleMode === 'fixed'
                    ? 'bg-[var(--surface-2)] text-[var(--text)] font-bold shadow-xs'
                    : 'text-[var(--text-3)] hover:text-[var(--text)]'
                }`}
                onClick={() => onScaleModeChange('fixed')}
              >
                Fixed Scale
              </button>
            </div>
          )}
        </div>

        {/* Readout bar when frozen and cursor active */}
        <div className="flex flex-wrap items-center gap-2">
        {isActuallyFrozen && cursorInfo ? (
          <div
            data-testid={DISPLAY_TEST_IDS.CURSOR_READOUT}
            className="flex items-center gap-3 whitespace-nowrap font-mono text-[12px] bg-[var(--surface-3)] px-2 py-0.5 rounded border border-[var(--warn-line)] text-[var(--warn-ink)]"
          >
            {cursorBInfo && <span>A:</span>}
            <span>t: {cursorInfo.tSec.toFixed(2)}s</span>
            <span>Paw: {cursorInfo.pawCmH2O.toFixed(1)} cmH2O</span>
            <span>Flow: {cursorInfo.flowLpm.toFixed(1)} L/min</span>
            <span>Vol: {cursorInfo.volumeMl.toFixed(0)} mL</span>
          </div>
        ) : isActuallyFrozen ? (
          <span className="text-[11px] text-[var(--warn-ink)] italic">Click or drag across waveforms to inspect values</span>
        ) : null}
        {isActuallyFrozen && cursorInfo && cursorBInfo && (
          <div
            data-testid="caliper-readout"
            className="flex items-center gap-3 whitespace-nowrap font-mono text-[12px] bg-[var(--surface-3)] px-2 py-0.5 rounded border border-[var(--warn-line)] text-[var(--warn-ink)]"
          >
            <span>Δt: {Math.abs(cursorBInfo.tSec - cursorInfo.tSec).toFixed(2)} s</span>
            <span>ΔPaw: {Math.abs(cursorBInfo.pawCmH2O - cursorInfo.pawCmH2O).toFixed(1)} cmH2O</span>
            <span>ΔFlow: {Math.abs(cursorBInfo.flowLpm - cursorInfo.flowLpm).toFixed(1)} L/min</span>
          </div>
        )}
        </div>
      </div>

      {/* Canvas container */}
      <div className="relative flex-1 w-full min-h-0">
        <canvas
          ref={canvasRef}
          data-testid={DISPLAY_TEST_IDS.SWEEP_WAVEFORMS}
          className={`w-full h-full block ${isActuallyFrozen ? 'cursor-crosshair' : ''}`}
          style={{ height }}
          aria-label="Pressure, flow and volume sweep waveforms"
          role="img"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />
        {/* DOM cursor indicator for test automation */}
        {isActuallyFrozen && cursorXFrac !== null && (
          <div
            data-testid={DISPLAY_TEST_IDS.WAVEFORM_CURSOR}
            aria-hidden="true"
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `calc(40px + ${cursorXFrac} * (100% - 50px))`,
              width: '1px',
              backgroundColor: 'var(--alarm-med)',
            }}
          />
        )}
        {isActuallyFrozen && cursorBXFrac !== null && (
          <div
            data-testid="waveform-cursor-b"
            aria-hidden="true"
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `calc(40px + ${cursorBXFrac} * (100% - 50px))`,
              width: '0px',
              borderLeft: '1px dashed var(--alarm-med)',
            }}
          />
        )}
      </div>
    </div>
  );
};

/** Relative-second labels for the fixed time axis: 0..windowSec, the last one carrying the unit. */
export function timeAxisLabels(windowSec: number): string[] {
  return Array.from({ length: windowSec + 1 }, (_, s) => (s === windowSec ? `${windowSec} s` : String(s)));
}

export function chooseScale(
  scales: readonly (readonly [number, number])[],
  currentIdx: number,
  lo: number,
  hi: number,
  hasFullSweep: boolean,
): number {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return currentIdx;
  let idx = currentIdx;
  while (
    idx < scales.length - 1 &&
    (hi > scales[idx]![1] || (scales[idx + 1]![0] < scales[idx]![0] && lo < scales[idx]![0]))
  ) {
    idx++;
  }
  if (hasFullSweep) {
    while (idx > 0) {
      const [sMn, sMx] = scales[idx - 1]!;
      const fitsLo = sMn < 0 ? lo >= sMn * 0.6 : true;
      const fitsHi = hi <= sMx * 0.6;
      if (fitsLo && fitsHi) idx--;
      else break;
    }
  }
  return idx;
}
