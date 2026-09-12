import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { getErrorMessage } from './components/Shared';
import { installDevToolsErrorShield } from './lib/devtoolsShield';
import './styles.css';

// Swallow the known Chrome DevTools Performance-panel internal crash
installDevToolsErrorShield();

// Unified PWA Service Worker registration
// This SW handles both app shell caching AND Firebase messaging
// Registering at root scope "/" ensures notifications work even when app not in recent
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // In production, register sw.js immediately for PWA installability
    // In dev, also register but with less caching for easier debugging
    const swUrl = '/sw.js';
    
    navigator.serviceWorker.register(swUrl, { scope: '/' })
      .then(registration => {
        console.debug('PWA Service Worker registered at root scope:', registration.scope);
        
        // Check for updates periodically
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000); // Check every hour

        // Handle SW updates - prompt user to reload if new version available
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available
                console.debug('New PWA version available');
                // Could show a toast here asking user to reload
                // For now, auto-activate via skipWaiting in SW
              }
            });
          }
        });
      })
      .catch(error => {
        console.debug(getErrorMessage(error, 'PWA Service Worker registration failed; continuing online.'));
        // Fallback: try firebase-messaging-sw.js at root
        navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
          .then(reg => console.debug('Fallback FCM SW registered:', reg.scope))
          .catch(err => console.debug('Fallback SW also failed:', err.message));
      });

    // Also ensure firebase-messaging-sw.js is registered for push
    // It will update the root registration with Firebase config when needed
    // This is handled by push.js getPushServiceWorker(), but we pre-register here for faster PWA
    if (import.meta.env.PROD) {
      // Small delay to let main SW register first
      setTimeout(() => {
        if (!navigator.serviceWorker.controller) {
          // No controller yet, ensure we have one
          navigator.serviceWorker.ready.catch(() => {});
        }
      }, 1000);
    }
  });

  // Handle controller change - new SW took over
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.debug('Service Worker controller changed');
  });

  // Handle messages from SW (buzzer, navigation)
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === 'MYNAAI_PLAY_BUZZER') {
      // Import buzzer dynamically to avoid circular deps
      import('./lib/buzzer.js').then(({ playBuzzer }) => {
        playBuzzer({ type: data.notificationType || 'BOOKING_REQUEST', repeats: 3 });
      }).catch(() => {});
    }
    if (data.type === 'MYNAAI_NAVIGATE' && data.target) {
      try {
        window.location.hash = data.target.replace(/^\/#/, '#');
      } catch {}
    }
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
