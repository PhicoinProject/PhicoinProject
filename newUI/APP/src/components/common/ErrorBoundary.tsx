import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const defaultFallback = (
  <div className="flex min-h-[200px] items-center justify-center p-8">
    <div className="text-center">
      <div className="mb-2 text-2xl font-semibold text-gray-800 dark:text-gray-200">
        Something went wrong
      </div>
      <button
        className="rounded bg-phi-purple px-4 py-2 text-white hover:bg-phi-purple/90"
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  </div>
);

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? defaultFallback;
    }
    return this.props.children;
  }
}
