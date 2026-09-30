import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { LanguageProvider } from './context/LanguageContext';
import { AccessibilityProvider } from './context/AccessibilityContext';
import { SystemSettingsProvider } from './context/SystemSettingsContext';
import { AuthProvider } from './context/AuthContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AccessibilityProvider>
          <SystemSettingsProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </SystemSettingsProvider>
        </AccessibilityProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);
