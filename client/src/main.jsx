import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { ConfirmProvider } from './components/ConfirmModal.jsx';
import './styles/globals.css';
import './styles/theme.css';
import './styles/v3.css';
import i18n from './i18n/index.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Маркер целостности бандла для boot-self-heal в index.html: если бандл
// оборвался на мобильной сети и не досчитался до этой строки, сторож в
// index.html перезагрузит страницу один раз. См. index.html, блок 1.
window.__DW_BOOT_OK = true;
