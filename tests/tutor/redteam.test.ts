import { describe, it, expect } from 'vitest';
import { runStratifiedRedTeamBattery } from '../../eval/tutor/redteam';

describe('Tutor v2 Stratified Red-Team Battery (Tracks 1-3)', () => {
  it('passes all 68 draft item checks, 15 jailbreaks, 20 sycophancy/jargon traps, and 15 numeric stress-tests', async () => {
    const report = await runStratifiedRedTeamBattery();
    expect(report.draftItemsCount).toBe(68);
    expect(report.adversarialPromptsTested).toBe(50);
    expect(report.tracks).toHaveLength(3);
    for (const tr of report.tracks) {
      expect(tr.failures).toEqual([]);
      expect(tr.passedChecks).toBe(tr.totalChecks);
    }
    expect(report.allPassed).toBe(true);
  });
});
