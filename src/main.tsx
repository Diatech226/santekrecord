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

installMonitorSocketGuard();

function BackendConnectivityNotice() {
  const [state, setState] = useState<BackendTransportState>('connecting');

  useEffect(() => {
    const handleTransport = (event: Event) => {
      const next = (event as CustomEvent<BackendTransportState>).detail;
      if (next) setState(next);
    };
    const probe = () => { void probeLocalBackend(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') probe();
    };

    // Important: do not use navigator.onLine or the browser online/offline
    // events here. SantekRecord is designed to run fully offline on one PC;
    // only the local FastAPI backend on port 8000 determines availability.
    window.addEventListener(BACKEND_TRANSPORT_EVENT, handleTransport as EventListener);
    window.addEventListener('focus', probe);
    document.addEventListener('visibilitychange', handleVisibility);

    probe();
    const timer = window.setInterval(probe, 5000);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(BACKEND_TRANSPORT_EVENT, handleTransport as EventListener);
      window.removeEventListener('focus', probe);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (state !== 'offline') return null;

  return (
    <div
      id="backend-connectivity-notice"
      role="status"
      aria-live="polite"
      className="fixed z-[100] bottom-4 right-4 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-amber-500/40 bg-[#151619]/95 p-3 shadow-xl backdrop-blur font-mono text-xs text-amber-400"
    >
      <div className="font-bold uppercase">Service audio local indisponible</div>
      <div className="mt-1 text-[10px] text-[#A0A0A0]">
        Aucune connexion Internet n’est nécessaire. Vérifie seulement que le backend local SantekRecord est lancé sur le port 8000 ; le tableau de bord le reteste automatiquement.
      </div>
      <button
        type="button"
        className="mt-2 rounded border border-amber-500/40 px-2.5 py-1 text-[10px] uppercase hover:bg-amber-500/10"
        onClick={() => {
          setState('connecting');
          void probeLocalBackend();
        }}
      >
        Retester le backend local
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
