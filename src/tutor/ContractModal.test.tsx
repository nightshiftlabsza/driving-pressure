// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ContractModal } from './ContractModal';

afterEach(cleanup);

describe('ContractModal', () => {
  it('Escape calls onCancel and focus starts inside', () => {
    const onCancel = vi.fn();
    render(<ContractModal isOpen onAccept={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('Tab from last control wraps to first', () => {
    render(<ContractModal isOpen onAccept={vi.fn()} onCancel={vi.fn()} />);
    screen.getByTestId('tutor-contract-accept-btn').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('tutor-contract-cancel-btn'));
  });
  it('renders nothing when closed', () => {
    render(<ContractModal isOpen={false} onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
