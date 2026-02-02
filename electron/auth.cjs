const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const { shell } = require('electron');
const { PublicClientApplication } = require('@azure/msal-node');

const getClientConfig = () => {
  const clientId = (process.env.VITE_AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID || '').trim();
  const tenantId = (process.env.VITE_AZURE_TENANT_ID || process.env.AZURE_TENANT_ID || '').trim();
  return {
    clientId,
    authority: tenantId
      ? `https://login.microsoftonline.com/${tenantId}`
      : 'https://login.microsoftonline.com/organizations',
  };
};

const getSubjectTokenPath = () => {
  const raw = (process.env.GCP_WIF_SUBJECT_TOKEN_FILE || process.env.WIF_SUBJECT_TOKEN_FILE || '').trim();
  const fallback = 'config/ms-id-token.txt';
  const target = raw || fallback;
  return path.isAbsolute(target) ? target : path.join(process.cwd(), target);
};

const persistSubjectToken = async (idToken) => {
  if (!idToken || typeof idToken !== 'string') return false;
  const filePath = getSubjectTokenPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, idToken, 'utf8');
  return true;
};

const clearSubjectToken = async () => {
  const filePath = getSubjectTokenPath();
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing token file
  }
};

const { clientId, authority } = getClientConfig();
const pca = new PublicClientApplication({
  auth: {
    clientId,
    authority,
  },
});

const base64UrlEncode = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const createPkcePair = () => {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

const accountToPayload = (account) => {
  if (!account) return null;
  return {
    homeAccountId: account.homeAccountId,
    username: account.username,
    name: account.name,
    localAccountId: account.localAccountId,
    tenantId: account.tenantId,
  };
};

const acquireTokenInteractive = async (scopes) => {
  const { clientId: currentClientId } = getClientConfig();
  if (!currentClientId) {
    throw new Error('Azure clientId is missing');
  }

  const server = http.createServer();
  const port = Number(process.env.ELECTRON_AUTH_PORT || 43121);
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const redirectUri = `http://localhost:${port}/redirect`;
  const pkce = createPkcePair();

  const authUrl = await pca.getAuthCodeUrl({
    scopes,
    redirectUri,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: 'S256',
  });

  await shell.openExternal(authUrl);

  const authCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('login_timeout'));
      server.close();
    }, 180000);

    server.on('request', (req, res) => {
      if (!req.url || !req.url.startsWith('/redirect')) return;
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body>ログイン完了。アプリに戻ってください。</body></html>');
      clearTimeout(timeout);
      server.close();
      if (error) {
        reject(new Error(`auth_error:${error}`));
        return;
      }
      resolve(code);
    });
  });

  const tokenResponse = await pca.acquireTokenByCode({
    code: authCode,
    scopes,
    redirectUri,
    codeVerifier: pkce.verifier,
  });

  try {
    await persistSubjectToken(tokenResponse?.idToken);
  } catch (error) {
    console.warn('[auth] failed to persist subject token', error);
  }

  return tokenResponse;
};

const clearAccount = async (account) => {
  if (!account) return;
  const cache = pca.getTokenCache();
  await cache.removeAccount(account);
  await clearSubjectToken();
};

const getCachedAccounts = async () => {
  const cache = pca.getTokenCache();
  return cache.getAllAccounts();
};

module.exports = {
  acquireTokenInteractive,
  accountToPayload,
  clearAccount,
  getCachedAccounts,
  pca,
};
