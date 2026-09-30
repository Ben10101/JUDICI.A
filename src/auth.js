import { promisify } from 'node:util';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { query, queryJson, sqlValue } from './postgres.js';

const scrypt = promisify(scryptCallback);
const passwordKeyLength = 64;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const validRoles = new Set(['solicitante', 'tic', 'gestor']);
const dummySalt = 'judicia-login-timing-salt-v1';

export function ensureAuthSchema() {
  query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      display_name text NOT NULL,
      role text NOT NULL CHECK(role IN ('solicitante','tic','gestor')),
      password_salt text NOT NULL,
      password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      csrf_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS app_sessions_user_expiry_idx ON app_sessions(user_id,expires_at);
    ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_users(id);
  `);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function safeEqualHex(expectedHex, actualHex) {
  if (!/^[a-f0-9]+$/i.test(expectedHex) || !/^[a-f0-9]+$/i.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function derivePassword(password, salt) {
  return (await scrypt(password, salt, passwordKeyLength, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })).toString('hex');
}

export async function createUser({ email, displayName, role, password }) {
  ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);
  const name = String(displayName || '').trim();
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
    throw new Error('Informe um endereço de e-mail válido.');
  if (!name || name.length > 100) throw new Error('O nome deve ter entre 1 e 100 caracteres.');
  if (!validRoles.has(normalizedRole))
    throw new Error('Perfil inválido. Use solicitante, tic ou gestor.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new Error('A senha deve ter entre 12 e 128 caracteres.');

  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await derivePassword(password, salt);
  try {
    const created = queryJson(
      `INSERT INTO app_users(id,email,display_name,role,password_salt,password_hash) VALUES(${sqlValue(id)}::uuid,${sqlValue(normalizedEmail)},${sqlValue(name)},${sqlValue(normalizedRole)},${sqlValue(salt)},${sqlValue(passwordHash)}) RETURNING json_build_object('id',id,'email',email,'displayName',display_name,'role',role)`,
      null,
    );
    return created;
  } catch (error) {
    if (/unique|duplicate/i.test(error.message)) throw new Error('Já existe uma conta com esse e-mail.');
    throw error;
  }
}

export async function resetUserPassword(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new Error('A senha deve ter entre 12 e 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await derivePassword(password, salt);
  const changed = query(
    `UPDATE app_users SET password_salt=${sqlValue(salt)},password_hash=${sqlValue(passwordHash)} WHERE email=${sqlValue(normalizedEmail)} AND active=true RETURNING email`,
  );
  if (!changed) throw new Error('Conta ativa não encontrada.');
  query(
    `DELETE FROM app_sessions WHERE user_id=(SELECT id FROM app_users WHERE email=${sqlValue(normalizedEmail)})`,
  );
}

export function updateUserRole(email, role) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!validRoles.has(normalizedRole))
    throw new Error('Perfil inválido. Use solicitante, tic ou gestor.');
  const changed = query(
    `UPDATE app_users SET role=${sqlValue(normalizedRole)} WHERE email=${sqlValue(normalizedEmail)} AND active=true RETURNING email`,
  );
  if (!changed) throw new Error('Conta ativa não encontrada.');
  query(
    `DELETE FROM app_sessions WHERE user_id=(SELECT id FROM app_users WHERE email=${sqlValue(normalizedEmail)})`,
  );
}

export async function verifyUserCredentials(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const user = queryJson(
    `SELECT json_build_object('id',id,'email',email,'displayName',display_name,'role',role,'salt',password_salt,'passwordHash',password_hash) FROM app_users WHERE email=${sqlValue(normalizedEmail)} AND active=true LIMIT 1`,
    null,
  );
  const passwordIsValid = typeof password === 'string' && password.length >= 12 && password.length <= 128;
  const safePassword = passwordIsValid ? password : '';
  if (!user) {
    await derivePassword(safePassword, dummySalt);
    return null;
  }
  const candidate = await derivePassword(safePassword, user.salt);
  if (!passwordIsValid || !safeEqualHex(user.passwordHash, candidate)) return null;
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId) {
  ensureAuthSchema();
  query(`DELETE FROM app_sessions WHERE expires_at <= now()`);
  const sessionToken = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  const tokenHash = hashToken(sessionToken);
  query(
    `INSERT INTO app_sessions(token_hash,user_id,csrf_hash,expires_at) VALUES(${sqlValue(tokenHash)},${sqlValue(userId)}::uuid,${sqlValue(hashToken(csrfToken))},${sqlValue(expiresAt)}::timestamptz)`,
  );
  return { sessionToken, csrfToken, tokenHash, expiresAt };
}

function requestCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

export function getSession(req) {
  const token = requestCookie(req, 'judicia_session');
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  return queryJson(
    `SELECT json_build_object('tokenHash',s.token_hash,'csrfHash',s.csrf_hash,'user',json_build_object('id',u.id,'email',u.email,'displayName',u.display_name,'role',u.role)) FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=${sqlValue(hashToken(token))} AND s.expires_at>now() AND u.active=true LIMIT 1`,
    null,
  );
}

export function rotateCsrfToken(session) {
  const token = randomBytes(32).toString('base64url');
  query(
    `UPDATE app_sessions SET csrf_hash=${sqlValue(hashToken(token))} WHERE token_hash=${sqlValue(session.tokenHash)} AND expires_at>now()`,
  );
  return token;
}

export function csrfTokenForRequest(req, session) {
  const existing = requestCookie(req, 'judicia_csrf');
  if (existing && verifyCsrfToken(session, existing)) return existing;
  return rotateCsrfToken(session);
}

export function verifyCsrfToken(session, suppliedToken) {
  if (typeof suppliedToken !== 'string' || suppliedToken.length > 100) return false;
  return safeEqualHex(session.csrfHash, hashToken(suppliedToken));
}

export function revokeSession(session) {
  if (session?.tokenHash)
    query(`DELETE FROM app_sessions WHERE token_hash=${sqlValue(session.tokenHash)}`);
}

export function sessionCookie(token, req) {
  const secure = req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === 'true';
  return `judicia_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function csrfCookie(token, req) {
  const secure = req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === 'true';
  return `judicia_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function expiredSessionCookie(req) {
  const secure = req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === 'true';
  return [
    `judicia_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`,
    `judicia_csrf=; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`,
  ];
}

export const allowedAuthRoles = [...validRoles];
