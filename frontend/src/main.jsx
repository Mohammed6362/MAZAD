/**
 * نقطة بدء React؛ تركّب المظهر والجلسة والإشعارات والموجّه حول التطبيق وتحمّل التنسيقات.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { AuthProvider } from './features/auth/AuthContext.jsx';
import { NotificationsProvider } from './features/account/NotificationsContext.jsx';
import { ThemeProvider } from './features/theme/ThemeContext.jsx';
import './styles/base.css';
import './styles/workspace.css';
import './styles/theme.css';
import './styles/design.css';

// ترتيب المزودات مهم: الإشعارات تعتمد الحساب، والصفحات تعتمد الموجّه والجلسة والمظهر معًا.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AppErrorBoundary>
          <AuthProvider>
            <NotificationsProvider>
              <App />
            </NotificationsProvider>
          </AuthProvider>
        </AppErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
