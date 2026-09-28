export type BackendTransportState = 'connecting' | 'online' | 'offline';

export const BACKEND_TRANSPORT_EVENT = 'santek:backend-transport';

export const emitBackendTransport = (state: BackendTransportState) => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<BackendTransportState>(BACKEND_TRANSPORT_EVENT, {
      detail: state,
    }));
  } catch {
    // Ignore event dispatch failure
  }
};

export const isMonitorSocketUrl = (url: string | URL) => {
  try {
    const parsed = new URL(String(url), window.location.href);
    return parsed.pathname === '/ws/monitor';
  } catch {
    return String(url).includes('/ws/monitor');
  }
};

export const wrapMonitorSocket = (socket: WebSocket): WebSocket => {
  try {
    socket.addEventListener('open', () => emitBackendTransport('online'));
    socket.addEventListener('message', () => emitBackendTransport('online'));
    socket.addEventListener('error', (event) => {
      emitBackendTransport('offline');
      try {
        event.stopImmediatePropagation();
      } catch {
        // Ignore
      }
    });

    try {
      Object.defineProperty(socket, 'onerror', {
        configurable: true,
        enumerable: true,
        get: () => null,
        set: () => undefined,
      });
    } catch {
      // EventTarget suppression above remains the fallback.
    }
  } catch {
    // Safe fallback
  }
  return socket;
};

export const createMonitorWebSocket = (url: string | URL): WebSocket => {
  const socket = new WebSocket(url);
  return wrapMonitorSocket(socket);
};

/**
 * Desktop resilience for the local monitoring WebSocket.
 *
 * Internet connectivity is intentionally irrelevant: SantekRecord is designed
 * to run fully offline on one PC. This guard only tracks reachability of the
 * local /ws/monitor endpoint and prevents a transport failure from becoming a
 * global red functional-error banner.
 */
export const installMonitorSocketGuard = () => {
  if (typeof window === 'undefined') return;
  const guardedWindow = window as Window & {
    __santekMonitorSocketGuardInstalled?: boolean;
  };
  if (guardedWindow.__santekMonitorSocketGuardInstalled) return;
  guardedWindow.__santekMonitorSocketGuardInstalled = true;

  try {
    const NativeWebSocket = window.WebSocket;
    if (!NativeWebSocket) return;

    const MonitorSafeWebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        const socket = Reflect.construct(Target, args, Target) as WebSocket;
        const [url] = args as [string | URL];
        if (!isMonitorSocketUrl(url)) return socket;
        return wrapMonitorSocket(socket);
      },
    });

    try {
      window.WebSocket = MonitorSafeWebSocket as typeof WebSocket;
    } catch {
      try {
        Object.defineProperty(window, 'WebSocket', {
          value: MonitorSafeWebSocket,
          writable: true,
          configurable: true,
        });
      } catch {
        // window.WebSocket is protected or non-configurable in this environment
      }
    }
  } catch {
    // Safe fallback: will not throw in any environment
  }
};

export const probeLocalBackend = async (timeoutMs = 1800): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Deliberately probes only the service running on this PC/LAN host. This
    // fetch continues to work when the machine has no Internet connection.
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
