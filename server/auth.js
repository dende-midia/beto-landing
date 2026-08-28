import { randomBytes } from 'node:crypto';
import { clientIp, appError, parseCookies } from './http.js';
import { createSessionToken, hashToken, safeJson, verifyPassword } from './security.js';

const SESSION_COOKIE = 'beto_session';

export function authenticate(db, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.id session_id, s.csrf_token, s.impersonated_account_id, s.impersonation_started_at,
           u.id user_id, u.account_id user_account_id, u.name user_name, u.email, u.role, u.status,
           a.name account_name, a.professional_name account_professional_name, a.status account_status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN accounts a ON a.id = COALESCE(s.impersonated_account_id, u.account_id)
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).get(hashToken(token));
  if (!row || row.status !== 'active') return null;
  if (row.role === 'professional' && row.account_status !== 'active') return null;
  db.prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.session_id);
  const accountId = row.role === 'super_admin' ? row.impersonated_account_id : row.user_account_id;
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    accountId,
    impersonating: Boolean(row.impersonated_account_id),
    impersonationStartedAt: row.impersonation_started_at,
    accountName: row.account_name,
    accountProfessionalName: row.account_professional_name,
    user: { id: row.user_id, accountId: row.user_account_id, name: row.user_name, email: row.email, role: row.role }
  };
}

export function login(db, { email, password, req, sessionTtlHours = 12, isProduction = false }) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email ?? '').trim());
  if (!user || user.status !== 'active' || !verifyPassword(String(password ?? ''), user.password_salt, user.password_hash)) {
    throw appError('E-mail ou senha incorretos.', 401, 'INVALID_CREDENTIALS');
  }
  if (user.role === 'professional') {
    const account = db.prepare('SELECT status FROM accounts WHERE id = ?').get(user.account_id);
    if (!account || account.status !== 'active') throw appError('Esta conta não está ativa.', 403, 'ACCOUNT_INACTIVE');
  }
  const token = createSessionToken();
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionTtlHours * 3_600_000).toISOString();
  const result = db.prepare(`INSERT INTO sessions
    (token_hash, csrf_token, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(hashToken(token), csrfToken, user.id, expiresAt, clientIp(req), String(req.headers['user-agent'] ?? '').slice(0, 300));
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  recordAudit(db, { actorUserId: user.id, actorRole: user.role, accountId: user.account_id, action: 'login', entityType: 'session', entityId: result.lastInsertRowid, req });
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionTtlHours * 3600}${isProduction ? '; Secure' : ''}`;
  return { cookie, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
}

export function logout(db, auth, req, isProduction = false) {
  if (auth) {
    recordAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.role, accountId: auth.accountId ?? auth.user.accountId, action: 'logout', entityType: 'session', entityId: auth.sessionId, req });
    db.prepare('DELETE FROM sessions WHERE id = ?').run(auth.sessionId);
  }
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProduction ? '; Secure' : ''}`;
}

export function requireAuth(auth) {
  if (!auth) throw appError('Faça login para continuar.', 401, 'AUTH_REQUIRED');
  return auth;
}

export function requireRole(auth, role) {
  requireAuth(auth);
  if (auth.user.role !== role) throw appError('Você não tem permissão para acessar esta área.', 403, 'FORBIDDEN');
  return auth;
}

export function requireProfessionalContext(auth) {
  requireAuth(auth);
  if (!auth.accountId) throw appError('Selecione uma conta para visualizar.', 403, 'ACCOUNT_CONTEXT_REQUIRED');
  return auth.accountId;
}

export function requireCsrf(req, auth) {
  requireAuth(auth);
  if (!auth.csrfToken || req.headers['x-csrf-token'] !== auth.csrfToken) {
    throw appError('Sessão inválida. Atualize a página e tente novamente.', 403, 'CSRF_INVALID');
  }
}

export function recordAudit(db, { actorUserId, actorRole, accountId = null, action, entityType = null, entityId = null, metadata = {}, req = null }) {
  return db.prepare(`INSERT INTO audit_logs
    (actor_user_id, actor_role, account_id, action, entity_type, entity_id, metadata, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(actorUserId ?? null, actorRole ?? null, accountId, action, entityType, entityId, safeJson(metadata), req ? clientIp(req) : null);
}

export function startImpersonation(db, auth, accountId, req) {
  requireRole(auth, 'super_admin');
  const account = db.prepare('SELECT id, name, status FROM accounts WHERE id = ?').get(accountId);
  if (!account || account.status !== 'active') throw appError('Conta não encontrada ou inativa.', 404, 'ACCOUNT_NOT_FOUND');
  db.prepare('UPDATE sessions SET impersonated_account_id = ?, impersonation_started_at = CURRENT_TIMESTAMP WHERE id = ?').run(account.id, auth.sessionId);
  recordAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.role, accountId: account.id, action: 'impersonation_started', entityType: 'account', entityId: account.id, metadata: { accountName: account.name }, req });
  return account;
}

export function stopImpersonation(db, auth, req) {
  requireRole(auth, 'super_admin');
  if (auth.impersonating) {
    recordAudit(db, { actorUserId: auth.user.id, actorRole: auth.user.role, accountId: auth.accountId, action: 'impersonation_ended', entityType: 'account', entityId: auth.accountId, metadata: { startedAt: auth.impersonationStartedAt }, req });
  }
  db.prepare('UPDATE sessions SET impersonated_account_id = NULL, impersonation_started_at = NULL WHERE id = ?').run(auth.sessionId);
}
