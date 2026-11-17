import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

/** Wait before the first repeat, then the gap between repeats. The gap shortens the longer the button is held. */
export const HOLD_START_MS = 350;
export const HOLD_REPEAT_MS = 80;

/** Gap before repeat number n (0 is the first repeat): 80 ms, then 50 ms after 8 repeats, then 30 ms after 20. */
export function holdIntervalMs(n: number): number {
  if (n >= 20) return 30;
  if (n >= 8) return 50;
  return HOLD_REPEAT_MS;
}

/**
 * Press-and-hold for a step button. A press steps once at once; holding repeats and speeds up. Shift held at
 * press time asks for the coarse step. A click that was not started by a pointer (keyboard Enter or Space, or a
 * scripted click) steps once, so a pointer press never steps twice.
 * For pointerType === 'touch': do not step on pointer-down (step once on click; repeat only after 350 ms hold).
 * Releasing outside the button cancels without swallowing the next keyboard click.
 */
export function useHoldRepeat(step: (coarse: boolean) => void) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viaPointer = useRef(false);
  const isTouchRef = useRef(false);
  const hasRepeated = useRef(false);
  const targetEl = useRef<EventTarget | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const cancelPointer = useCallback(() => {
    stop();
    viaPointer.current = false;
    isTouchRef.current = false;
    hasRepeated.current = false;
    targetEl.current = null;
  }, [stop]);

  useEffect(() => {
    const onGlobalPointerUp = (e: PointerEvent) => {
      if (viaPointer.current || isTouchRef.current) {
        const currentTarget = targetEl.current;
        if (!currentTarget || (currentTarget instanceof Element && !currentTarget.contains(e.target as Node))) {
          cancelPointer();
        }
      }
    };
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerUp);
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerUp);
      window.removeEventListener('pointercancel', onGlobalPointerUp);
    };
  }, [cancelPointer]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.button ?? 0) !== 0) return;
    targetEl.current = e.currentTarget;
    const isTouch = e.pointerType === 'touch' || (e.nativeEvent as PointerEvent)?.pointerType === 'touch';
    isTouchRef.current = isTouch;
    hasRepeated.current = false;
    viaPointer.current = true;
    const coarse = e.shiftKey;
    stop();

    if (!isTouch) {
      stepRef.current(coarse);
    }

    let n = 0;
    const tick = () => {
      hasRepeated.current = true;
      stepRef.current(coarse);
      timer.current = setTimeout(tick, holdIntervalMs(n++));
    };
    timer.current = setTimeout(tick, HOLD_START_MS);
  }, [stop]);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (isTouchRef.current) {
      isTouchRef.current = false;
      viaPointer.current = false;
      targetEl.current = null;
      if (hasRepeated.current) {
        hasRepeated.current = false;
        return;
      }
      stepRef.current(e.shiftKey);
      return;
    }
    if (viaPointer.current) {
      viaPointer.current = false;
      targetEl.current = null;
      return;
    }
    stepRef.current(e.shiftKey);
  }, []);

  return { onPointerDown, onPointerUp: stop, onPointerLeave: cancelPointer, onPointerCancel: cancelPointer, onClick };
}
