import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ErrorBoundary } from './components/error-boundary';
import './styles/globals.css';

// Global error handlers for uncaught errors
window.addEventListener('error', (event) => {
  console.error('[renderer] Uncaught error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] Unhandled rejection:', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <RouterProvider router={router} />
  </ErrorBoundary>,
);
