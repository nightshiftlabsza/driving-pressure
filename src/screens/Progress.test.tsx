// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Progress } from './Progress';
import { FakeLearner, createDefaultCompetencyStates } from './FakeLearner';
import competenciesJson from '../shared/competencies.json';

afterEach(() => {
  cleanup();
});

describe('Progress Component', () => {
  it('renders all 8 domains and 38 competencies', async () => {
    const fakeLearner = new FakeLearner();

    render(<Progress learner={fakeLearner} />);

    // Check all 8 domains are present
    expect(competenciesJson.domains).toHaveLength(8);
    for (const d of competenciesJson.domains) {
      expect(screen.getByText(d.name)).toBeTruthy();
    }

    // Check all 38 competencies are present
    const allComps = competenciesJson.domains.flatMap(d => d.competencies);
    expect(allComps).toHaveLength(38);
    for (const c of allComps) {
      expect(screen.getByText(c.id)).toBeTruthy();
    }
  });

  it('guidance override change calls setGuidanceOverride', async () => {
    const fakeLearner = new FakeLearner();
    render(<Progress learner={fakeLearner} />);

    // Find the override select for mech.auto-peep
    const autoPeepDef = competenciesJson.domains
      .find(d => d.id === 'mech')
      ?.competencies.find(c => c.id === 'mech.auto-peep');
    expect(autoPeepDef).toBeDefined();

    const select = screen.getByLabelText(`Guidance override for ${autoPeepDef!.name}`);
    expect(select).toBeTruthy();

    // Change to 'prompted'
    fireEvent.change(select, { target: { value: 'prompted' } });

    await waitFor(() => {
      expect(fakeLearner.setGuidanceOverrideCalls).toContainEqual({
        competency: 'mech.auto-peep',
        level: 'prompted',
      });
    });

    // Change to 'auto' (which sets override to null)
    fireEvent.change(select, { target: { value: 'auto' } });

    await waitFor(() => {
      expect(fakeLearner.setGuidanceOverrideCalls).toContainEqual({
        competency: 'mech.auto-peep',
        level: null,
      });
    });
  });

  it('Reset requires typing RESET', async () => {
    const fakeLearner = new FakeLearner();
    render(<Progress learner={fakeLearner} />);

    const resetBtn = screen.getByRole('button', { name: /Reset Progress/i });
    const resetInput = screen.getByPlaceholderText(/Type RESET/i);

    // Initially button should be disabled
    expect((resetBtn as HTMLButtonElement).disabled).toBe(true);

    // Typing something other than RESET leaves button disabled
    fireEvent.change(resetInput, { target: { value: 'reset' } });
    expect((resetBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(resetInput, { target: { value: 'NO' } });
    expect((resetBtn as HTMLButtonElement).disabled).toBe(true);
    expect(fakeLearner.resetCallCount).toBe(0);

    // Typing exact "RESET" enables the button
    fireEvent.change(resetInput, { target: { value: 'RESET' } });
    expect((resetBtn as HTMLButtonElement).disabled).toBe(false);

    // Clicking calls resetAll
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(fakeLearner.resetCallCount).toBe(1);
    });
  });

  it('Import asks for confirmation before calling importJson', async () => {
    const fakeLearner = new FakeLearner();
    const { container } = render(<Progress learner={fakeLearner} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const mockBackupJson = JSON.stringify({
      format: 'ovs-learner',
      version: 1,
      events: [],
      states: createDefaultCompetencyStates(),
    });

    const file = new File([mockBackupJson], 'backup.json', { type: 'application/json' });

    // Select file
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Before confirming, importJson MUST NOT be called!
    expect(fakeLearner.importedJson).toBeNull();

    // Confirmation banner must be displayed
    await waitFor(() => {
      expect(screen.getByText(/Confirm Progress Import/i)).toBeTruthy();
      expect(screen.getByText(/will replace all current competency progress/i)).toBeTruthy();
    });

    // Clicking Cancel dismisses without importing
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText(/Confirm Progress Import/i)).toBeNull();
    expect(fakeLearner.importedJson).toBeNull();

    // Select file again and confirm
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Confirm Import/i })).toBeTruthy();
    });

    const confirmBtn = screen.getByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fakeLearner.importedJson).toBe(mockBackupJson);
    });
  });

  it('renders calibration stats with visible numbers', async () => {
    const initialStates = createDefaultCompetencyStates();
    // Give one competency some calibration data
    initialStates[0]!.calibration = {
      byConfidence: {
        certain: { answered: 10, correct: 8 },
        fairly_sure: { answered: 6, correct: 3 },
        guess: { answered: 4, correct: 1 },
      },
    };

    const fakeLearner = new FakeLearner(initialStates);
    render(<Progress learner={fakeLearner} />);

    await waitFor(() => {
      expect(screen.getByText(/8 \/ 10 correct \(80%\)/i)).toBeTruthy();
      expect(screen.getByText(/3 \/ 6 correct \(50%\)/i)).toBeTruthy();
      expect(screen.getByText(/1 \/ 4 correct \(25%\)/i)).toBeTruthy();
    });
  });

  it('renders recurring mistakes with taxonomy name and response', async () => {
    const initialStates = createDefaultCompetencyStates();
    initialStates[0]!.topMistakes = [
      { mistake: 'unsafe_action', count: 3 },
      { mistake: 'premature_closure', count: 2 },
    ];

    const fakeLearner = new FakeLearner(initialStates);
    render(<Progress learner={fakeLearner} />);

    await waitFor(() => {
      expect(screen.getByText('Unsafe action')).toBeTruthy();
      expect(screen.getByText(/3 times/i)).toBeTruthy();
      expect(screen.getByText(/Always shown in debrief, regardless of outcome/i)).toBeTruthy();

      expect(screen.getByText('Premature closure')).toBeTruthy();
      expect(screen.getByText(/Case with a misleading first impression/i)).toBeTruthy();
    });
  });

  it('handles learner error gracefully', async () => {
    const fakeLearner = new FakeLearner();
    vi.spyOn(fakeLearner, 'getCompetencyStates').mockRejectedValue(new Error('IndexedDB failure'));

    render(<Progress learner={fakeLearner} />);

    await waitFor(() => {
      expect(screen.getByText(/Learner unavailable/i)).toBeTruthy();
      expect(screen.getByText(/IndexedDB failure/i)).toBeTruthy();
    });
  });

  it('exports progress by calling learner.exportJson', async () => {
    const fakeLearner = new FakeLearner();
    const exportSpy = vi.spyOn(fakeLearner, 'exportJson');

    render(<Progress learner={fakeLearner} />);

    const exportBtn = screen.getByRole('button', { name: /Export JSON/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Progress successfully exported to JSON/i)).toBeTruthy();
    });
  });

  it('rejects invalid JSON backup files without showing the confirmation modal', async () => {
    const fakeLearner = new FakeLearner();
    const { container } = render(<Progress learner={fakeLearner} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const corruptFile = new File(['not valid json {{{'], 'corrupt.json', { type: 'application/json' });

    fireEvent.change(fileInput, { target: { files: [corruptFile] } });

    await waitFor(() => {
      expect(screen.getByText(/Invalid backup file: file content is not valid JSON/i)).toBeTruthy();
      expect(screen.queryByText(/Confirm Progress Import/i)).toBeNull();
    });
  });

  it('displays honest empty state when no simulation runs have been recorded', async () => {
    const fakeLearner = new FakeLearner(createDefaultCompetencyStates());
    render(<Progress learner={fakeLearner} />);

    await waitFor(() => {
      expect(screen.getByText(/No simulation runs yet/i)).toBeTruthy();
      expect(screen.getByText(/No predictions recorded yet/i)).toBeTruthy();
    });
  });

  it('handles invalid dueAt date string gracefully without displaying NaN', async () => {
    const initialStates = createDefaultCompetencyStates();
    initialStates[0]!.dueAt = 'invalid-timestamp-xyz';

    const fakeLearner = new FakeLearner(initialStates);
    const { container } = render(<Progress learner={fakeLearner} />);

    await waitFor(() => {
      expect(screen.getAllByText('Not scheduled').length).toBeGreaterThan(0);
      expect(container.innerHTML).not.toContain('NaN');
    });
  });

  it('allows Reset submission via Enter key when RESET is typed', async () => {
    const fakeLearner = new FakeLearner();
    render(<Progress learner={fakeLearner} />);

    const resetInput = screen.getByPlaceholderText(/Type RESET/i);

    // Type "RESET" and press Enter
    fireEvent.change(resetInput, { target: { value: 'RESET' } });
    fireEvent.keyDown(resetInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(fakeLearner.resetCallCount).toBe(1);
    });
  });

  it('displays compact Section 10.1 N-of-1 learning metrics card without NaN', async () => {
    const fakeLearner = new FakeLearner();
    const { container } = render(<Progress learner={fakeLearner} />);

    await waitFor(() => {
      const card = screen.getByTestId('progress-learning-metrics');
      expect(card.textContent).toContain('Unaided Trend');
      expect(card.textContent).toContain('Delayed Retention');
      expect(card.textContent).toContain('Far-Transfer');
      expect(card.textContent).toContain('Tutor Dependence');
      expect(card.textContent).toContain('Maneuver-First');
      expect(card.textContent).toContain('Calibration Brier');
      expect(card.textContent).toContain('Blinded Explanation Quality');
      expect(container.innerHTML).not.toContain('NaN');
    });
  });
});
