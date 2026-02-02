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

export const MSAL_REDIRECT_URI =
  configuredRedirectUri ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

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
