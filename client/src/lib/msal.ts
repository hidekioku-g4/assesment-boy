import { LogLevel, PublicClientApplication } from '@azure/msal-browser';

const useAltRaw = String(import.meta.env.VITE_AZURE_USE_ALT ?? '').toLowerCase();
const useAlt = useAltRaw === 'true' || useAltRaw === '1';

const clientId = (useAlt
  ? import.meta.env.VITE_AZURE_CLIENT_ID_ALT
  : import.meta.env.VITE_AZURE_CLIENT_ID
  )?.trim();
const tenantId = (useAlt
  ? import.meta.env.VITE_AZURE_TENANT_ID_ALT
  : import.meta.env.VITE_AZURE_TENANT_ID
  )?.trim();
const configuredRedirectUri = (useAlt
  ? import.meta.env.VITE_AZURE_REDIRECT_URI_ALT
  : import.meta.env.VITE_AZURE_REDIRECT_URI
  )?.trim();

// ブラウザコンテキストでは window.location.origin を優先する。
// Electron ビルドでは Node コンテキストなので window が無く、configuredRedirectUri を使う。
// これにより Cloud Run / ローカル dev のどちらでも正しい redirectUri になる（Azure AD に両方登録済み前提）
export const MSAL_REDIRECT_URI =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : (configuredRedirectUri || 'http://localhost');

export const MSAL_ENABLED = Boolean(clientId && tenantId);

export const msalInstance = MSAL_ENABLED
  ? new PublicClientApplication({
      auth: {
        clientId: clientId as string,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: MSAL_REDIRECT_URI,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Warning,
        },
      },
    })
  : null;

export const MSAL_LOGIN_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export const getMsalAccount = () =>
  msalInstance?.getActiveAccount() ?? msalInstance?.getAllAccounts()[0] ?? null;

let msalInitPromise: Promise<void> | null = null;

export const ensureMsalInitialized = async () => {
  if (!msalInstance) return;
  if (!msalInitPromise) {
    msalInitPromise = msalInstance.initialize();
  }
  await msalInitPromise;
};
