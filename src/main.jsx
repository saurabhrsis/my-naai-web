import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { getErrorMessage } from './components/Shared';
import { installDevToolsErrorShield } from './lib/devtoolsShield';
import { registerPushServiceWorker } from './lib/push';
import './styles.css';

// Swallow the known Chrome DevTools Performance-panel internal crash
installDevToolsErrorShield();

// ONE service worker for the whole app, registered at root scope "/" (see
// src/lib/push.js). /firebase-messaging-sw.js is the unified worker: app-shell
// caching (installable PWA) + Firebase Cloud Messaging, including the Accept /
// Reject / Delay notification actions when the app is closed.
//
// Registering /sw.js here as well used to replace this registration on every
// load — two scripts competing for the same scope — which is exactly what makes
// push subscriptions go stale and token generation fail with "no active service
// worker". Push registration therefore lives in exactly one place.
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    // The dev preview must never run the PWA worker. A worker left behind by
    // an earlier load (especially across a dev-server restart) can serve a
    // cached app shell and blank the page — the exact failure the worker's
    // fetch handler was written to guard against. Unregister anything present
    // and clear the shell caches so every dev load comes straight from Vite.
    navigator.serviceWorker
      .getRegistrations?.()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
      .catch(() => {});
    (typeof caches !== 'undefined' ? caches.keys() : Promise.resolve([]))
      .then(keys => Promise.all(keys.filter(key => key.startsWith('mynaai')).map(key => caches.delete(key))))
      .catch(() => {});
  } else {
    window.addEventListener('load', () => {
    registerPushServiceWorker().then(registration => {
      if (!registration) {
        console.debug('Service worker registration did not complete; the app keeps working online.');
        return;
      }
      // Check for updates periodically so a fixed worker reaches installed apps.
      setInterval(() => {
        registration.update?.().catch(() => {});
      }, 60 * 60 * 1000);
    }).catch(error => {
      console.debug(getErrorMessage(error, 'PWA Service Worker registration failed; continuing online.'));
    });
  });

  // Handle controller change - new SW took over
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.debug('Service Worker controller changed');
  });

  // Handle messages from SW (navigation). The buzzer listens for
  // MYNAAI_PLAY_BUZZER itself — src/lib/buzzer.js owns that message so one push
  // can never play the alarm twice.
  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === 'MYNAAI_NAVIGATE' && data.target) {
      try {
        window.history.pushState({}, '', data.target.startsWith('#') ? data.target.replace(/^#+/, '') : data.target);
        window.dispatchEvent(new Event('popstate'));
      } catch {}
    }
  });
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
