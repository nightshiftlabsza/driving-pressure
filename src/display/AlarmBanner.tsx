import React, { useEffect, useRef, useState } from 'react';
import type { ActiveAlarm, AlarmState } from '../alarms';
import { isAlarmSilenced } from '../alarms';
import {
  AlarmSounder,
  audibleAlarm,
  isAlarmSoundEnabled,
  setAlarmSoundEnabled,
  subscribeAlarmSound,
} from '../alarms/alarmSound';
import { DISPLAY_TEST_IDS } from './types';

export interface AlarmBannerProps {
  alarmState: AlarmState;
  simTimeSec: number;
  /** Starts a 2-minute silence, or ends it when one is running. */
  onSilence: () => void;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll?: () => void;
  /** False while the clock is stopped or a dialog covers the bedside: the tone waits, the visual alarm stays. Default true. */
  audible?: boolean;
  /** Test ids differ between the case screen and the shared display for historical reasons. */
  testIds?: { banner: string; message: string; silence: string; ack: string };
}

const PRIORITY_WORD = { high: 'High priority', med: 'Medium priority', low: 'Low priority' } as const;
const PRIORITY_MARK = { high: '!!!', med: '!!', low: '!' } as const;

function fmtRemaining(sec: number): string {
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

/** Remembered on/off switch for alarm tones, shared by every alarm bar on the page. */
export function useAlarmSoundEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState(isAlarmSoundEnabled);
  useEffect(() => subscribeAlarmSound(setEnabled), []);
  return [enabled, setAlarmSoundEnabled];
}

/**
 * The alarm message field. One bar, used on the case screen and in the Lab, that behaves like a ventilator's:
 * the highest-priority alarm is named in full with its priority, a tone sounds until you silence or acknowledge it,
 * and a resolved high-priority alarm stays listed until you clear it.
 */
export const AlarmBanner: React.FC<AlarmBannerProps> = ({
  alarmState,
  simTimeSec,
  onSilence,
  onAcknowledge,
  audible = true,
  testIds,
}) => {
  const ids = testIds ?? {
    banner: DISPLAY_TEST_IDS.ALARM_BANNER,
    message: DISPLAY_TEST_IDS.ALARM_MESSAGE,
    silence: DISPLAY_TEST_IDS.ALARM_SILENCE_BTN,
    ack: DISPLAY_TEST_IDS.ALARM_ACK_BTN,
  };
  const alarms = alarmState.alarms;
  // An alarm whose cause is still present always outranks one that has resolved and is only waiting to be cleared.
  const topAlarm: ActiveAlarm | undefined = alarms.find(a => a.conditionActive) ?? alarms[0];
  const silenced = isAlarmSilenced(alarmState, simTimeSec);
  const remaining = silenced && alarmState.silencedUntilSimSec
    ? Math.max(0, Math.ceil(alarmState.silencedUntilSimSec - simTimeSec))
    : 0;
  const [soundOn, setSoundOn] = useAlarmSoundEnabled();

  const toSound = audibleAlarm(alarms);
  const tone = soundOn && audible && !silenced && toSound ? toSound.priority : null;
  const sounder = useRef<AlarmSounder | null>(null);
  useEffect(() => {
    if (!sounder.current) sounder.current = new AlarmSounder();
    sounder.current.set(tone);
  }, [tone]);
  useEffect(() => () => { sounder.current?.dispose(); sounder.current = null; }, []);

  // Everything that still needs the learner: unacknowledged active alarms, and resolved alarms waiting to be cleared.
  const needAction = alarms.filter(a => !a.conditionActive || a.acknowledgedAtSimSec === undefined);
  const onlyResolvedLeft = needAction.length > 0 && needAction.every(a => !a.conditionActive);
  const resolved = !!topAlarm && !topAlarm.conditionActive;
  const acknowledged = !!topAlarm && topAlarm.conditionActive && topAlarm.acknowledgedAtSimSec !== undefined;
  const priority = topAlarm ? (resolved ? 'info' : topAlarm.priority) : 'none';

  return (
    <div
      data-testid={ids.banner}
      data-priority={priority}
      data-sounding={tone ?? 'off'}
      className="vt-alarm vt-alarm-bar"
      role={topAlarm ? 'alert' : 'status'}
    >
      <div className="vt-alarm-bar__text">
        {topAlarm ? (
          <>
            <span className="num font-bold shrink-0" aria-hidden="true">{PRIORITY_MARK[topAlarm.priority]}</span>
            <span className="sr-only">{PRIORITY_WORD[topAlarm.priority]} alarm: </span>
            <span data-testid={ids.message} className="leading-tight" style={{ overflowWrap: 'anywhere' }}>
              {topAlarm.message}
            </span>
            {resolved && <span className="vt-alarm-bar__tag">Resolved, not yet cleared</span>}
            {acknowledged && <span className="vt-alarm-bar__tag">Acknowledged</span>}
            {alarms.length > 1 && (
              <span className="vt-alarm-bar__tag" title={alarms.slice(1).map(a => a.message).join('\n')}>
                +{alarms.length - 1} more
              </span>
            )}
          </>
        ) : (
          <span data-testid={ids.message}>No active alarms</span>
        )}
      </div>

      <div className="vt-alarm-bar__actions">
        {topAlarm && !resolved && (
          <button
            type="button"
            data-testid={ids.silence}
            className="vt-alarm-bar__btn"
            aria-pressed={silenced}
            title={silenced
              ? 'The alarm tone is paused. Press to let it sound again.'
              : 'Pause the alarm tone for 2 minutes of patient time. The alarm stays on screen.'}
            onClick={onSilence}
          >
            {silenced ? `Silenced ${fmtRemaining(remaining)}` : 'Silence 2 min'}
          </button>
        )}
        {needAction.length > 0 && (
          <button
            type="button"
            data-testid={ids.ack}
            className="vt-alarm-bar__btn"
            title={onlyResolvedLeft
              ? 'The cause has gone. Clear this alarm from the screen.'
              : 'Record that you have seen this alarm and stop its tone. It stays on screen until the cause is fixed.'}
            onClick={() => { for (const a of needAction) onAcknowledge(a.id); }}
          >
            {onlyResolvedLeft ? 'Clear alarm' : 'Acknowledge'}
          </button>
        )}
        <button
          type="button"
          data-testid="alarm-sound-toggle"
          className="vt-alarm-bar__btn"
          aria-pressed={soundOn}
          aria-label={soundOn ? 'Alarm sound is on. Turn off.' : 'Alarm sound is off. Turn on.'}
          title={soundOn ? 'Alarm sound is on. Press to turn all alarm tones off.' : 'Alarm sound is off. Press to turn alarm tones on.'}
          onClick={() => setSoundOn(!soundOn)}
        >
          <SpeakerIcon on={soundOn} />
          <span>{soundOn ? 'Sound on' : 'Sound off'}</span>
        </button>
      </div>
    </div>
  );
};

const SpeakerIcon: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 6v4h2.5l3.5 3V3L5 6H2.5z" fill="currentColor" stroke="none" />
    {on
      ? <><path d="M11 5.5a3.5 3.5 0 010 5" /><path d="M12.8 3.5a6.3 6.3 0 010 9" /></>
      : <><path d="M11 6l3.5 4" /><path d="M14.5 6L11 10" /></>}
  </svg>
);
