export {};

declare global {
  interface Window {
    electronAPI?: {
      login: () => Promise<{ account: any | null }>;
      logout: () => Promise<{ ok: boolean }>;
      getAccount: () => Promise<{ account: any | null }>;
      zoomIn: () => Promise<{ ok: boolean }>;
      zoomOut: () => Promise<{ ok: boolean }>;
      zoomReset: () => Promise<{ ok: boolean }>;
    };
  }
}
