// client/src/lib/fetchWithAuth.ts — 認証付き fetch + WebSocket トークン取得
import { msalInstance, getMsalAccount, ensureMsalInitialized, MSAL_LOGIN_SCOPES } from './msal';

const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);

/**
 * MSAL から idToken を取得する（ブラウザモード用）
 * silent 取得に失敗した場合は null を返す
 */
async function getIdToken(): Promise<string | null> {
  if (isElectron || !msalInstance) return null;

  await ensureMsalInitialized();
  const account = getMsalAccount();
  if (!account) return null;

  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: MSAL_LOGIN_SCOPES,
      account,
    });
    return result?.idToken || null;
  } catch {
    return null;
  }
}

/**
 * 認証ヘッダー付き fetch（ブラウザモード時のみ Bearer トークンを付加）
 * Electron モードでは通常の fetch と同じ動作
 */
export async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const idToken = await getIdToken();

  const headers = new Headers(options?.headers);
  if (idToken) {
    headers.set('Authorization', `Bearer ${idToken}`);
  }

  return fetch(url, { ...options, headers });
}

/**
 * WebSocket 接続用のトークンパラメータを返す（ブラウザモード用）
 * Electron モードでは空文字を返す
 */
export async function getWsTokenParam(): Promise<string> {
  const idToken = await getIdToken();
  if (!idToken) return '';
  return `&token=${encodeURIComponent(idToken)}`;
}
