/**
 * Entry point for the React renderer.
 */

import { createRoot } from 'react-dom/client';
import './lib/bridge-capacitor.js';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

import './styles/theme.css';
import './styles/app.css';
import './styles/toolbar.css';
import './styles/menu.css';
import './styles/editor.css';
import './styles/preview.css';

// Errors outside a component render land here — promise rejections the
// dialogs catch but every other loose one still tells the story, so a hang or
// a break leaves a line in the devtools console instead of a silent dead end.
window.addEventListener('error', (event) => {
  console.error('[tfr] uncaught error:', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[tfr] unhandled rejection:', event.reason);
});

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
