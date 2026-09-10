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
 * The desktop dashboard historically promoted WebSocket transport failures to
 * its global functional error banner. A local backend restart, a temporary PC
 * network interruption, or a browser refresh must not replace the usable
 * dashboard with a WebSocket error.
 *
 * This narrow guard applies only to /ws/monitor. It reports transport state to
 * the shell, suppresses the legacy `onerror` property handler for that socket,
 * and leaves `onclose` untouched so the existing monitoring reconnect loop can
 * still run. A Proxy is used instead of subclassing the native WebSocket for
 * broader browser compatibility.
 */
export const installMonitorSocketGuard = () => {
  if (typeof window === 'undefined') return;
  const guardedWindow = window as Window & {
    __santekMonitorSocketGuardInstalled?: boolean;
  };
  if (guardedWindow.__santekMonitorSocketGuardInstalled) return;
  guardedWindow.__santekMonitorSocketGuardInstalled = true;

  const NativeWebSocket = window.WebSocket;
  const MonitorSafeWebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const socket = Reflect.construct(Target, args, Target) as WebSocket;
      const [url] = args as [string | URL];
      if (!isMonitorSocketUrl(url)) return socket;

      socket.addEventListener('open', () => emitBackendTransport('online'));
      socket.addEventListener('message', () => emitBackendTransport('online'));
      socket.addEventListener('error', (event) => {
        emitBackendTransport('offline');
        // Registered before App.tsx assigns socket.onerror. Prevent only this
        // monitor transport error from becoming a global functional-error UI.
        // The close event still propagates normally for reconnect behavior.
        event.stopImmediatePropagation();
      });

      // Extra protection for browsers that dispatch the IDL onerror handler
      // independently from EventTarget listener ordering.
      try {
        Object.defineProperty(socket, 'onerror', {
          configurable: true,
          enumerable: true,
          get: () => null,
          set: () => undefined,
        });
      } catch {
        // stopImmediatePropagation above remains the fallback.
      }
      return socket;
    },
  });

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
