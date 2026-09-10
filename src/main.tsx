import {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { ThemeProvider } from './theme/ThemeContext';
import {
  BACKEND_TRANSPORT_EVENT,
  BackendTransportState,
  installMonitorSocketGuard,
  probeLocalBackend,
} from './services/monitorSocketGuard';
import './index.css';

// Install before React effects create /ws/monitor. The guard is deliberately
// limited to the monitor socket and does not alter other WebSocket consumers.
installMonitorSocketGuard();

function BackendConnectivityNotice() {
  const [state, setState] = useState<BackendTransportState>('connecting');

  useEffect(() => {
    const handleTransport = (event: Event) => {
      const next = (event as CustomEvent<BackendTransportState>).detail;
      if (next) setState(next);
    };
    const probe = () => { void probeLocalBackend(); };
    const handleOffline = () => setState('offline');
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') probe();
    };

    window.addEventListener(BACKEND_TRANSPORT_EVENT, handleTransport as EventListener);
    window.addEventListener('online', probe);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    probe();
    const timer = window.setInterval(probe, 5000);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(BACKEND_TRANSPORT_EVENT, handleTransport as EventListener);
      window.removeEventListener('online', probe);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (state !== 'offline') return null;

  return (
    <div
      id="backend-connectivity-notice"
      role="status"
      aria-live="polite"
      className="fixed z-[100] bottom-4 left-4 right-4 sm:left-auto sm:max-w-md rounded-lg border border-amber-500/40 bg-[#151619]/95 p-3 shadow-xl backdrop-blur font-mono text-xs text-amber-400"
    >
      <div className="font-bold uppercase">Backend local temporairement indisponible</div>
      <div className="mt-1 text-[10px] text-[#A0A0A0]">
        L’interface reste utilisable. La reconnexion se fait automatiquement sans afficher une erreur WebSocket bloquante.
      </div>
      <button
        type="button"
        className="mt-2 rounded border border-amber-500/40 px-2.5 py-1 text-[10px] uppercase hover:bg-amber-500/10"
        onClick={() => {
          setState('connecting');
          void probeLocalBackend();
        }}
      >
        Réessayer maintenant
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <App />
        <BackendConnectivityNotice />
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>,
);
