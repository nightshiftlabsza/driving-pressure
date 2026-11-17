// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): React.ReactElement {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders the fallback when a child throws and calls onHome from Back to Home', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onHome = vi.fn();
    render(
      <ErrorBoundary onHome={onHome}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong on this screen. Your saved progress is safe.')).toBeTruthy();
    expect(screen.getByText('Reload')).toBeTruthy();
    fireEvent.click(screen.getByText('Back to Home'));
    expect(onHome).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
