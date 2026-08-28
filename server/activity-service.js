import { safeJson } from './security.js';

export function recordBetoActivity(db, { accountId, clientId = null, type, entityType = null, entityId = null, title, description = null, metadata = {}, status = 'completed' }) {
  if (!accountId || !type || !title) throw new Error('accountId, type e title são obrigatórios.');
  return db.prepare(`INSERT INTO beto_activities
    (account_id, client_id, entity_type, entity_id, activity_type, title, description, metadata, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(accountId, clientId, entityType, entityId, type, title, description, safeJson(metadata), status);
}
