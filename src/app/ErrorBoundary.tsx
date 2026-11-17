import React from 'react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Called when the learner presses "Back to Home"; the boundary resets itself first. */
  onHome: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('Trainer screen crashed', error, info.componentStack);
  }

  private handleHome = () => {
    this.setState({ hasError: false });
    this.props.onHome();
  };

  private handleReload = () => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        data-testid="error-boundary-fallback"
        role="alert"
        className="m-4 p-4 border space-y-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text)' }}
      >
        <p className="text-sm font-semibold">Something went wrong on this screen. Your saved progress is safe.</p>
        <div className="flex gap-2">
          <button type="button" className="vt-btn vt-btn--primary" onClick={this.handleHome}>
            Back to Home
          </button>
          <button type="button" className="vt-btn" onClick={this.handleReload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
