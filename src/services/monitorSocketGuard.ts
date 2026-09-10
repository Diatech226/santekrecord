export type BackendTransportState = 'connecting' | 'online' | 'offline';

export const BACKEND_TRANSPORT_EVENT = 'santek:backend-transport';

const emitBackendTransport = (state: BackendTransportState) => {
  window.dispatchEvent(new CustomEvent<BackendTransportState>(BACKEND_TRANSPORT_EVENT, {
    detail: state,
  }));
};

const isMonitorSocketUrl = (url: string | URL) => {
  try {
    const parsed = new URL(String(url), window.location.href);
    return parsed.pathname === '/ws/monitor';
  } catch {
    return String(url).includes('/ws/monitor');
  }
};

/**
 * The dashboard historically promoted WebSocket transport failures to its
 * global functional error banner. A local backend restart, a phone losing its
 * LAN connection, or a browser refresh should not replace the usable UI with a
 * scary WebSocket error.
 *
 * This narrow guard applies only to /ws/monitor. It reports transport state to
 * the shell, suppresses the legacy `onerror` property handler for that socket,
 * and leaves `onclose` untouched so the existing monitoring reconnect loop can
 * still run.
 */
export const installMonitorSocketGuard = () => {
  if (typeof window === 'undefined') return;
  const marker = '__santekMonitorSocketGuardInstalled';
  const guardedWindow = window as Window & Record<string, unknown>;
  if (guardedWindow[marker]) return;
  guardedWindow[marker] = true;

  const NativeWebSocket = window.WebSocket;

  class MonitorSafeWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols as string | string[] | undefined);
      if (!isMonitorSocketUrl(url)) return;

      this.addEventListener('open', () => emitBackendTransport('online'));
      this.addEventListener('message', () => emitBackendTransport('online'));
      this.addEventListener('error', () => emitBackendTransport('offline'));

      // App.tsx currently assigns socket.onerror only to display a red transport
      // error. Keep native addEventListener('error', ...) available, but swallow
      // this one legacy property assignment for the monitor socket.
      try {
        Object.defineProperty(this, 'onerror', {
          configurable: true,
          enumerable: true,
          get: () => null,
          set: () => undefined,
        });
      } catch {
        // If a browser does not allow shadowing the IDL property, the transport
        // state still works and the CSS pull-to-refresh fix remains effective.
      }
    }
  }

  window.WebSocket = MonitorSafeWebSocket as typeof WebSocket;
};

export const probeLocalBackend = async (timeoutMs = 1800): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const origin = `${window.location.protocol}//${window.location.hostname}:8000`;
    const response = await fetch(`${origin}/api/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const online = response.ok;
    emitBackendTransport(online ? 'online' : 'offline');
    return online;
  } catch {
    emitBackendTransport('offline');
    return false;
  } finally {
    window.clearTimeout(timer);
  }
};
