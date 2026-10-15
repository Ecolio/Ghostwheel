import { reportDiagnostic } from './diagnostics';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

window.addEventListener('error', (event) =>
  reportDiagnostic(
    'error',
    'erreur JavaScript non interceptée',
    event.error ?? new Error(event.message),
  ),
);
window.addEventListener('unhandledrejection', (event) =>
  reportDiagnostic('error', 'promesse rejetée non interceptée', event.reason),
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
