import { Component, type ReactNode } from 'react';

// A failed optional chunk must not take down the document editor.
export class PreviewBoundary extends Component<
  { children: ReactNode; message: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="tio-code-notice">
        {this.props.message}
      </div>
    ) : (
      this.props.children
    );
  }
}
