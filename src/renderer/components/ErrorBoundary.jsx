/**
 * ErrorBoundary — the renderer's last line of defence.
 *
 * A render-phase exception used to take the whole React tree down silently:
 * the window went black, and nothing worked and nothing could be seen. The
 * boundary turns that into a readable screen — what failed, the stack, and a
 * reload button — so a bug becomes a report instead of a blank window.
 *
 * The fallback is a function component inside the boundary so it can use the
 * i18n hook; the errors the boundary catches are far unlikelier to come from
 * that context than from the app screen itself.
 *
 * @module components/ErrorBoundary
 */

import { Component } from 'react';
import { useI18n } from '../i18n/index.js';

/**
 * The readable fallback screen.
 * @param {{ error: unknown }} props
 */
function CrashScreen({ error }) {
  const { t } = useI18n();
  const err = error instanceof Error ? error : new Error(String(error));
  return (
    <div className="crash-screen">
      <div className="crash-card">
        <p className="crash-title">{t('crash.title')}</p>
        <p className="crash-message">{err.message || String(error)}</p>
        <pre className="crash-stack">{err.stack || ''}</pre>
        <button
          type="button"
          className="crash-reload"
          onClick={() => window.location.reload()}
        >
          {t('crash.reload')}
        </button>
      </div>
    </div>
  );
}

/**
 * @param {{ children: React.ReactNode }} props
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Also land in the devtools console, with the component stack, so a
    // browser window that cannot paint the fallback still tells the story.
    console.error('[tfr] the renderer crashed:', error, '\n', info && info.componentStack);
  }

  render() {
    if (this.state.error) return <CrashScreen error={this.state.error} />;
    return this.props.children;
  }
}
