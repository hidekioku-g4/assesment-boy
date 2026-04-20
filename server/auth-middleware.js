// server/auth-middleware.js — Azure AD idToken 検証ミドルウェア (Web版)
// jose (ESM ネイティブ) で JWT 検証。jwks-rsa/jsonwebtoken は CJS 互換問題あり

// Node.js 18 では globalThis.crypto が不完全なので webcrypto を補完
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as jose from 'jose';

const TENANT_ID = (process.env.AZURE_TENANT_ID || process.env.VITE_AZURE_TENANT_ID || '').trim();
const CLIENT_ID = (process.env.AZURE_CLIENT_ID || process.env.VITE_AZURE_CLIENT_ID || '').trim();
const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || process.env.VITE_ALLOWED_EMAIL_DOMAIN || '').trim();
const SKIP_AUTH = process.env.SKIP_AUTH === 'true';

let jwks = null;

function getJWKS() {
  if (!jwks && (TENANT_ID || CLIENT_ID)) {
    jwks = jose.createRemoteJWKSet(
      new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'),
    );
  }
  return jwks;
}

/**
 * idToken を検証してユーザー情報を返す
 */
async function verifyToken(token) {
  const keySet = getJWKS();
  if (!keySet) throw new Error('JWKS not configured');

  const options = {};
  if (CLIENT_ID) options.audience = CLIENT_ID;
  // common authority: issuer はテナントごとに異なるため検証しない。ドメイン制限で担保

  const { payload } = await jose.jwtVerify(token, keySet, options);
  return payload;
}

/**
 * Express ミドルウェア: Authorization: Bearer {idToken} を検証
 */
export const requireAuth = async (req, res, next) => {
  if (SKIP_AUTH) return next();

  if (!TENANT_ID || !CLIENT_ID) {
    console.warn('[auth] AZURE_TENANT_ID or AZURE_CLIENT_ID not set, skipping auth');
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token' });
  }

  try {
    const token = authHeader.slice(7);
    const decoded = await verifyToken(token);

    // ドメイン制限
    const email = (decoded.preferred_username || decoded.email || '').toLowerCase();
    if (ALLOWED_DOMAIN && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      return res.status(403).json({ error: 'domain_not_allowed' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.warn('[auth] token verification failed:', err.message);
    return res.status(401).json({ error: 'invalid_token' });
  }
};

/**
 * WebSocket 接続時のトークン検証
 */
export const verifyWsToken = async (token) => {
  if (SKIP_AUTH) return { skip: true };
  if (!TENANT_ID || !CLIENT_ID) return { skip: true };
  if (!token) return null;

  try {
    const decoded = await verifyToken(token);
    const email = (decoded.preferred_username || decoded.email || '').toLowerCase();
    if (ALLOWED_DOMAIN && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      console.warn('[ws-auth] domain not allowed:', email);
      return null;
    }
    return decoded;
  } catch (err) {
    console.warn('[ws-auth] token verification failed:', err.message);
    return null;
  }
};
