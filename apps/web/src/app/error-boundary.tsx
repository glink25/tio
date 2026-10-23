import { t } from '@tio/i18n';
import { Button } from '@tio/ui';
import { Component, type ReactNode, type ErrorInfo } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tio render error', error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <main className="mx-auto max-w-lg p-12">
          <h1 className="mb-4 text-2xl">{t('errors.crash')}</h1>
          <p className="mb-5 text-sm text-muted">{this.state.error.message}</p>
          <Button variant="primary" onClick={() => location.reload()}>
            {t('errors.reload')}
          </Button>
        </main>
      );
    return this.props.children;
  }
}
