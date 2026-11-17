import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { WaveformSample } from '../shared/engineTypes';
import { DISPLAY_TEST_IDS, type LoopType } from './types';

interface LoopPalette {
  bg: string;
  grid: string;
  gridStrong: string;
  text: string;
  textDim: string;
  vol: string;
  flow: string;
}

/** Canvas 2D cannot use CSS variables, so resolve them from the computed style at draw time. */
function readPalette(el: HTMLElement): LoopPalette {
  const cs = getComputedStyle(el);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    bg: v('--wave-bg', '#0b1018'),
    grid: v('--grid', 'rgba(150,165,180,0.13)'),
    gridStrong: v('--grid-strong', 'rgba(150,165,180,0.32)'),
    text: v('--text-2', '#a3aeb9'),
    textDim: v('--text-3', '#75818d'),
    vol: v('--ch-vol', '#34b6ee'),
    flow: v('--ch-flow', '#46c97e'),
  };
}

export interface LoopsProps {
  samples: WaveformSample[];
  frozen?: boolean;
  loopType?: LoopType | 'both';
  height?: number | string;
}

interface BreathLoop {
  samples: WaveformSample[];
  maxPaw: number;
  maxVol: number;
  maxFlow: number;
  minFlow: number;
}

export const Loops: React.FC<LoopsProps> = ({
  samples,
  frozen = false,
  loopType: initialLoopType = 'both',
  height = 300,
}) => {
  const [selectedLoop, setSelectedLoop] = useState<LoopType | 'both'>(initialLoopType);
  const pvCanvasRef = useRef<HTMLCanvasElement>(null);
  const fvCanvasRef = useRef<HTMLCanvasElement>(null);
  // Re-draw the canvases when the theme (data-theme on the .vt root) changes.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const root = (pvCanvasRef.current ?? fvCanvasRef.current)?.closest('.vt');
    if (!root || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => setThemeTick(t => t + 1));
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Extract completed breaths: a breath begins when phase switches to 'insp'
  const { currentBreath, prevBreath } = useMemo(() => {
    if (!samples || samples.length < 2) return { currentBreath: null, prevBreath: null };

    const breaths: WaveformSample[][] = [];
    let cur: WaveformSample[] = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const prev = i > 0 ? samples[i - 1] : null;
      if (prev && prev.phase === 'exp' && s.phase === 'insp' && cur.length > 5) {
        breaths.push(cur);
        cur = [];
      }
      cur.push(s);
    }
    if (cur.length > 0) breaths.push(cur);

    const makeLoop = (arr: WaveformSample[]): BreathLoop => {
      let maxPaw = 0, maxVol = 0, maxFlow = 0, minFlow = 0;
      for (const s of arr) {
        if (s.pawCmH2O > maxPaw) maxPaw = s.pawCmH2O;
        if (s.volumeMl > maxVol) maxVol = s.volumeMl;
        const fl = s.flowLps * 60;
        if (fl > maxFlow) maxFlow = fl;
        if (fl < minFlow) minFlow = fl;
      }
      return { samples: arr, maxPaw, maxVol, maxFlow, minFlow };
    };

    const curBreath = breaths.length ? makeLoop(breaths[breaths.length - 1]) : null;
    const previousBreath = breaths.length > 1 ? makeLoop(breaths[breaths.length - 2]) : null;

    return { currentBreath: curBreath, prevBreath: previousBreath };
  }, [samples]);

  // Render Pressure-Volume Loop
  useEffect(() => {
    const canvas = pvCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pal = readPalette(canvas);

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    const padLeft = 45, padBottom = 25, padTop = 20, padRight = 15;
    const plotW = Math.max(20, w - padLeft - padRight);
    const plotH = Math.max(20, h - padTop - padBottom);

    const maxPaw = Math.max(40, currentBreath?.maxPaw ?? 40, prevBreath?.maxPaw ?? 40);
    const maxVol = Math.max(600, currentBreath?.maxVol ?? 600, prevBreath?.maxVol ?? 600);

    const xOf = (paw: number) => padLeft + (Math.max(0, paw) / maxPaw) * plotW;
    const yOf = (vol: number) => padTop + plotH - (Math.max(0, vol) / maxVol) * plotH;

    // Grid
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let p = 10; p < maxPaw; p += 10) {
      const x = Math.round(xOf(p)) + 0.5;
      ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH);
    }
    for (let v = 200; v < maxVol; v += 200) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + plotW, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Axes
    ctx.strokeStyle = pal.gridStrong;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, padTop + plotH);
    ctx.lineTo(padLeft + plotW, padTop + plotH);
    ctx.stroke();

    // Axis Labels
    ctx.fillStyle = pal.text;
    ctx.font = '10px Bahnschrift, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('0', padLeft - 4, padTop + plotH);
    ctx.fillText(String(Math.round(maxVol)), padLeft - 4, padTop + 8);
    ctx.textAlign = 'center';
    ctx.fillText('0', padLeft, padTop + plotH + 14);
    ctx.fillText(`${Math.round(maxPaw)} cmH2O`, padLeft + plotW - 10, padTop + plotH + 14);

    ctx.textAlign = 'left';
    ctx.fillStyle = pal.vol;
    ctx.font = '600 11px "Segoe UI", sans-serif';
    ctx.fillText('P-V Loop (mL vs cmH2O)', padLeft + 6, padTop + 2);

    // 1. Previous breath (faint reference trace)
    if (prevBreath && prevBreath.samples.length > 2) {
      ctx.strokeStyle = pal.textDim;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      prevBreath.samples.forEach((s, idx) => {
        const x = xOf(s.pawCmH2O), y = yOf(s.volumeMl);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Current breath (vibrant solid trace)
    if (currentBreath && currentBreath.samples.length > 2) {
      ctx.strokeStyle = pal.vol;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      currentBreath.samples.forEach((s, idx) => {
        const x = xOf(s.pawCmH2O), y = yOf(s.volumeMl);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [currentBreath, prevBreath, selectedLoop, themeTick]);

  // Render Flow-Volume Loop
  useEffect(() => {
    const canvas = fvCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pal = readPalette(canvas);

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    const padLeft = 45, padBottom = 25, padTop = 20, padRight = 15;
    const plotW = Math.max(20, w - padLeft - padRight);
    const plotH = Math.max(20, h - padTop - padBottom);

    const maxVol = Math.max(600, currentBreath?.maxVol ?? 600, prevBreath?.maxVol ?? 600);
    const maxFlow = Math.max(60, currentBreath?.maxFlow ?? 60, prevBreath?.maxFlow ?? 60);
    const minFlow = Math.min(-60, currentBreath?.minFlow ?? -60, prevBreath?.minFlow ?? -60);
    const flowRange = maxFlow - minFlow;

    const xOf = (vol: number) => padLeft + (Math.max(0, vol) / maxVol) * plotW;
    const yOf = (fl: number) => padTop + plotH - ((fl - minFlow) / flowRange) * plotH;

    // Grid
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let v = 200; v < maxVol; v += 200) {
      const x = Math.round(xOf(v)) + 0.5;
      ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Zero flow line
    const zeroY = Math.round(yOf(0)) + 0.5;
    ctx.strokeStyle = pal.gridStrong;
    ctx.beginPath();
    ctx.moveTo(padLeft, zeroY); ctx.lineTo(padLeft + plotW, zeroY);
    ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, padTop + plotH);
    ctx.stroke();

    // Labels
    ctx.fillStyle = pal.text;
    ctx.font = '10px Bahnschrift, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(maxFlow)}`, padLeft - 4, padTop + 8);
    ctx.fillText('0', padLeft - 4, zeroY + 3);
    ctx.fillText(`${Math.round(minFlow)}`, padLeft - 4, padTop + plotH);

    ctx.textAlign = 'center';
    ctx.fillText('0', padLeft, padTop + plotH + 14);
    ctx.fillText(`${Math.round(maxVol)} mL`, padLeft + plotW - 10, padTop + plotH + 14);

    ctx.textAlign = 'left';
    ctx.fillStyle = pal.flow;
    ctx.font = '600 11px "Segoe UI", sans-serif';
    ctx.fillText('F-V Loop (L/min vs mL)', padLeft + 6, padTop + 2);

    // 1. Previous breath (faint reference trace)
    if (prevBreath && prevBreath.samples.length > 2) {
      ctx.strokeStyle = pal.textDim;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      prevBreath.samples.forEach((s, idx) => {
        const x = xOf(s.volumeMl), y = yOf(s.flowLps * 60);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Current breath (vibrant solid trace)
    if (currentBreath && currentBreath.samples.length > 2) {
      ctx.strokeStyle = pal.flow;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      currentBreath.samples.forEach((s, idx) => {
        const x = xOf(s.volumeMl), y = yOf(s.flowLps * 60);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [currentBreath, prevBreath, selectedLoop, themeTick]);

  return (
    <div className="flex flex-col w-full h-full select-none">
      {/* Loop Type Selector Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[var(--surface-2)] border-b border-[var(--line)] text-xs">
        <div className="flex items-center gap-1">
          <span className="text-[var(--text-2)] font-semibold mr-1">Loops:</span>
          <button
            type="button"
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              selectedLoop === 'both' ? 'bg-[var(--alarm-med)] text-[var(--alarm-med-ink)] font-bold' : 'bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
            onClick={() => setSelectedLoop('both')}
          >
            P-V & F-V
          </button>
          <button
            type="button"
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              selectedLoop === 'pv' ? 'bg-[var(--primary)] text-[var(--primary-ink)] font-bold' : 'bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
            onClick={() => setSelectedLoop('pv')}
          >
            P-V Only
          </button>
          <button
            type="button"
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
              selectedLoop === 'fv' ? 'bg-[var(--ok)] text-[var(--primary-ink)] font-bold' : 'bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
            onClick={() => setSelectedLoop('fv')}
          >
            F-V Only
          </button>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-2)]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-[var(--surface-3)] inline-block opacity-50 border-t border-dashed" /> Reference (prev breath)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-[var(--alarm-med)] inline-block" /> Active breath
          </span>
        </div>
      </div>

      {/* Loop Canvas Area */}
      <div className="flex-1 flex gap-2 p-2 bg-[var(--surface)] min-h-0" style={{ height }}>
        {(selectedLoop === 'both' || selectedLoop === 'pv') && (
          <div className="flex-1 relative rounded-lg overflow-hidden border border-[var(--line)] bg-[var(--surface)]">
            <canvas ref={pvCanvasRef} data-testid={DISPLAY_TEST_IDS.LOOP_PV} className="w-full h-full block" />
          </div>
        )}
        {(selectedLoop === 'both' || selectedLoop === 'fv') && (
          <div className="flex-1 relative rounded-lg overflow-hidden border border-[var(--line)] bg-[var(--surface)]">
            <canvas ref={fvCanvasRef} data-testid={DISPLAY_TEST_IDS.LOOP_FV} className="w-full h-full block" />
          </div>
        )}
      </div>
    </div>
  );
};
