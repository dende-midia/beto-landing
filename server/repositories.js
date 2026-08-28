import { withTransaction } from './database.js';
import { appError } from './http.js';
import { recordAudit } from './auth.js';
import { recordBetoActivity } from './activity-service.js';
import { cents, email, enumValue, integer, optionalText, phone, requiredText } from './validation.js';

const quoteStatuses = ['draft', 'sent', 'awaiting_approval', 'approved', 'rejected'];

function paging(searchParams) {
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const perPage = Math.min(50, Math.max(5, Number(searchParams.get('perPage')) || 12));
  return { page, perPage, offset: (page - 1) * perPage };
}

function parseMetadata(rows) {
  return rows.map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }));
}

export function getDashboard(db, accountId) {
  const summary = db.prepare(`SELECT
    (SELECT COUNT(*) FROM clients WHERE account_id = ? AND status = 'active' AND deleted_at IS NULL) clients_active,
    (SELECT COUNT(*) FROM quotes WHERE account_id = ? AND status IN ('draft','sent','awaiting_approval') AND deleted_at IS NULL) quotes_open,
    (SELECT COUNT(*) FROM quotes WHERE account_id = ? AND status = 'awaiting_approval' AND deleted_at IS NULL) awaiting_approval,
    (SELECT COUNT(*) FROM receipts WHERE account_id = ? AND deleted_at IS NULL AND issued_at >= date('now','-30 days')) receipts_recent
  `).get(accountId, accountId, accountId, accountId);
  const now = db.prepare(`SELECT ba.*, c.name client_name FROM beto_activities ba
    LEFT JOIN clients c ON c.id = ba.client_id
    WHERE ba.account_id = ? ORDER BY ba.created_at DESC, ba.id DESC LIMIT 1`).get(accountId);
  const activity = parseMetadata(db.prepare(`SELECT ba.*, c.name client_name FROM beto_activities ba
    LEFT JOIN clients c ON c.id = ba.client_id
    WHERE ba.account_id = ? ORDER BY ba.created_at DESC, ba.id DESC LIMIT 8`).all(accountId));
  return { summary, now: now ? { ...now, metadata: JSON.parse(now.metadata || '{}') } : null, activity };
}

export function listClients(db, accountId, searchParams) {
  const { page, perPage, offset } = paging(searchParams);
  const search = `%${String(searchParams.get('q') ?? '').trim()}%`;
  const status = searchParams.get('status');
  const whereStatus = status === 'active' || status === 'inactive' ? 'AND c.status = ?' : '';
  const params = [accountId, search, search, search, ...(whereStatus ? [status] : [])];
  const where = `c.account_id = ? AND c.deleted_at IS NULL AND (c.name LIKE ? OR c.phone LIKE ? OR COALESCE(c.email,'') LIKE ?) ${whereStatus}`;
  const total = db.prepare(`SELECT COUNT(*) count FROM clients c WHERE ${where}`).get(...params).count;
  const items = db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM quotes q WHERE q.client_id = c.id AND q.deleted_at IS NULL) quote_count,
      (SELECT COUNT(*) FROM receipts r WHERE r.client_id = c.id AND r.deleted_at IS NULL) receipt_count,
      (SELECT MAX(created_at) FROM beto_activities b WHERE b.client_id = c.id) last_activity_at
    FROM clients c WHERE ${where} ORDER BY COALESCE(last_activity_at, c.updated_at) DESC LIMIT ? OFFSET ?`)
    .all(...params, perPage, offset);
  return { items, page, perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export function getClient(db, accountId, id) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND account_id = ? AND deleted_at IS NULL').get(id, accountId);
  if (!client) throw appError('Cliente não encontrado.', 404, 'NOT_FOUND');
  const quotes = db.prepare('SELECT * FROM quotes WHERE client_id = ? AND account_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(id, accountId);
  const receipts = db.prepare('SELECT * FROM receipts WHERE client_id = ? AND account_id = ? AND deleted_at IS NULL ORDER BY issued_at DESC').all(id, accountId);
  const activity = parseMetadata(db.prepare('SELECT * FROM beto_activities WHERE client_id = ? AND account_id = ? ORDER BY created_at DESC, id DESC').all(id, accountId));
  return { client, quotes, receipts, activity };
}

export function createClient(db, accountId, actor, body, req) {
  const data = { name: requiredText(body.name, 'Nome'), phone: phone(body.phone), email: email(body.email), city: optionalText(body.city, 120), notes: optionalText(body.notes, 2000) };
  return withTransaction(db, () => {
    const result = db.prepare(`INSERT INTO clients (account_id,name,phone,email,city,notes,created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(accountId, data.name, data.phone, data.email, data.city, data.notes, actor.id);
    recordAudit(db, { actorUserId: actor.id, actorRole: actor.role, accountId, action: 'client_created', entityType: 'client', entityId: result.lastInsertRowid, req });
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
  });
}

export function updateClient(db, accountId, actor, id, body, req) {
  getClient(db, accountId, id);
  const data = { name: requiredText(body.name, 'Nome'), phone: phone(body.phone), email: email(body.email), city: optionalText(body.city, 120), notes: optionalText(body.notes, 2000), status: enumValue(body.status ?? 'active', ['active','inactive'], 'Status') };
  db.prepare(`UPDATE clients SET name=?,phone=?,email=?,city=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?`)
    .run(data.name,data.phone,data.email,data.city,data.notes,data.status,id,accountId);
  recordAudit(db, { actorUserId: actor.id, actorRole: actor.role, accountId, action: 'client_updated', entityType: 'client', entityId: id, req });
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

export function archiveClient(db, accountId, actor, id, req) {
  const result = db.prepare(`UPDATE clients SET status='inactive',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL`).run(id, accountId);
  if (!result.changes) throw appError('Cliente não encontrado.', 404, 'NOT_FOUND');
  recordAudit(db, { actorUserId: actor.id, actorRole: actor.role, accountId, action: 'client_archived', entityType: 'client', entityId: id, req });
}

export function listQuotes(db, accountId, searchParams) {
  const { page, perPage, offset } = paging(searchParams);
  const search = `%${String(searchParams.get('q') ?? '').trim()}%`;
  const status = searchParams.get('status');
  const whereStatus = quoteStatuses.includes(status) ? 'AND q.status = ?' : '';
  const params = [accountId, search, search, ...(whereStatus ? [status] : [])];
  const where = `q.account_id=? AND q.deleted_at IS NULL AND (CAST(q.number AS TEXT) LIKE ? OR c.name LIKE ?) ${whereStatus}`;
  const total = db.prepare(`SELECT COUNT(*) count FROM quotes q JOIN clients c ON c.id=q.client_id WHERE ${where}`).get(...params).count;
  const items = db.prepare(`SELECT q.*, c.name client_name FROM quotes q JOIN clients c ON c.id=q.client_id WHERE ${where} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);
  return { items, page, perPage, total, pages: Math.max(1, Math.ceil(total/perPage)) };
}

export function getQuote(db, accountId, id) {
  const quote = db.prepare(`SELECT q.*, c.name client_name,c.phone client_phone,c.email client_email FROM quotes q JOIN clients c ON c.id=q.client_id WHERE q.id=? AND q.account_id=? AND q.deleted_at IS NULL`).get(id,accountId);
  if (!quote) throw appError('Orçamento não encontrado.',404,'NOT_FOUND');
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY sort_order,id').all(id);
  return { quote, items };
}

function normalizeQuote(db, accountId, body) {
  const clientId = integer(body.clientId,'Cliente');
  if (!db.prepare('SELECT 1 FROM clients WHERE id=? AND account_id=? AND deleted_at IS NULL').get(clientId,accountId)) throw appError('Cliente não encontrado nesta conta.',422,'VALIDATION_ERROR');
  if (!Array.isArray(body.items) || !body.items.length) throw appError('Adicione ao menos um serviço.',422,'VALIDATION_ERROR');
  const items = body.items.map((item,index) => {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw appError(`Quantidade inválida no item ${index+1}.`,422,'VALIDATION_ERROR');
    const unitPriceCents = cents(item.unitPrice,`Valor do item ${index+1}`);
    return { description: requiredText(item.description,`Descrição do item ${index+1}`,500), quantity, unit: requiredText(item.unit || 'un',`Unidade do item ${index+1}`,30), unitPriceCents, totalCents: Math.round(quantity*unitPriceCents), materialNotes: optionalText(item.materialNotes,500), sortOrder:index };
  });
  return { clientId, items, totalCents:items.reduce((sum,item)=>sum+item.totalCents,0), status:enumValue(body.status ?? 'draft',quoteStatuses,'Status'), materials:optionalText(body.materials,2000), validUntil:optionalText(body.validUntil,30), paymentTerms:optionalText(body.paymentTerms,500), deadline:optionalText(body.deadline,120), observations:optionalText(body.observations,2000) };
}

export function createQuote(db, accountId, actor, body, req) {
  const data=normalizeQuote(db,accountId,body);
  return withTransaction(db,()=>{
    const number=integer(body.number ?? nextNumber(db,'quotes',accountId,1101),'Número');
    const result=db.prepare(`INSERT INTO quotes (account_id,client_id,number,status,total_cents,materials,valid_until,payment_terms,deadline,observations,created_by_user_id,created_by_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(accountId,data.clientId,number,data.status,data.totalCents,data.materials,data.validUntil,data.paymentTerms,data.deadline,data.observations,actor.id,actor.role==='super_admin'?'admin':'professional');
    insertQuoteItems(db,result.lastInsertRowid,data.items);
    recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId,action:'quote_created',entityType:'quote',entityId:result.lastInsertRowid,metadata:{number,totalCents:data.totalCents},req});
    recordBetoActivity(db,{accountId,clientId:data.clientId,type:'quote_created',entityType:'quote',entityId:Number(result.lastInsertRowid),title:`Orçamento nº ${number} criado`,description:`R$ ${(data.totalCents/100).toLocaleString('pt-BR',{minimumFractionDigits:2})}`,metadata:{source:actor.role==='super_admin'?'admin':'professional'}});
    return getQuote(db,accountId,result.lastInsertRowid);
  });
}

export function updateQuote(db,accountId,actor,id,body,req){
  getQuote(db,accountId,id); const data=normalizeQuote(db,accountId,body);
  return withTransaction(db,()=>{
    db.prepare(`UPDATE quotes SET client_id=?,status=?,total_cents=?,materials=?,valid_until=?,payment_terms=?,deadline=?,observations=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?`).run(data.clientId,data.status,data.totalCents,data.materials,data.validUntil,data.paymentTerms,data.deadline,data.observations,id,accountId);
    db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(id); insertQuoteItems(db,id,data.items);
    recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId,action:'quote_updated',entityType:'quote',entityId:id,metadata:{totalCents:data.totalCents},req});
    return getQuote(db,accountId,id);
  });
}

export function archiveQuote(db,accountId,actor,id,req){ const result=db.prepare(`UPDATE quotes SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL`).run(id,accountId); if(!result.changes)throw appError('Orçamento não encontrado.',404,'NOT_FOUND'); recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId,action:'quote_archived',entityType:'quote',entityId:id,req}); }

function insertQuoteItems(db,quoteId,items){ const statement=db.prepare(`INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price_cents,total_cents,material_notes,sort_order) VALUES (?,?,?,?,?,?,?,?)`); for(const item of items) statement.run(quoteId,item.description,item.quantity,item.unit,item.unitPriceCents,item.totalCents,item.materialNotes,item.sortOrder); }
function nextNumber(db,table,accountId,floor){ const current=db.prepare(`SELECT MAX(number) max FROM ${table} WHERE account_id=?`).get(accountId).max; return current == null ? floor+1 : current+1; }

export function duplicateQuote(db,accountId,actor,id,req){ const existing=getQuote(db,accountId,id); return createQuote(db,accountId,actor,{...existing.quote,clientId:existing.quote.client_id,status:'draft',number:nextNumber(db,'quotes',accountId,1101),items:existing.items.map(item=>({description:item.description,quantity:item.quantity,unit:item.unit,unitPrice:item.unit_price_cents/100,materialNotes:item.material_notes}))},req); }

export function listReceipts(db,accountId,searchParams){
  const {page,perPage,offset}=paging(searchParams); const q=`%${String(searchParams.get('q')??'').trim()}%`; const kind=searchParams.get('kind'); const kindClause=kind==='linked'?'AND r.quote_id IS NOT NULL':kind==='standalone'?'AND r.quote_id IS NULL':''; const recent=kind==='recent'?"AND r.issued_at >= date('now','-30 days')":'';
  const where=`r.account_id=? AND r.deleted_at IS NULL AND (CAST(r.number AS TEXT) LIKE ? OR c.name LIKE ?) ${kindClause} ${recent}`; const params=[accountId,q,q];
  const total=db.prepare(`SELECT COUNT(*) count FROM receipts r JOIN clients c ON c.id=r.client_id WHERE ${where}`).get(...params).count;
  const items=db.prepare(`SELECT r.*,c.name client_name,q.number quote_number FROM receipts r JOIN clients c ON c.id=r.client_id LEFT JOIN quotes q ON q.id=r.quote_id WHERE ${where} ORDER BY r.issued_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...params,perPage,offset);
  return {items,page,perPage,total,pages:Math.max(1,Math.ceil(total/perPage))};
}

export function getReceipt(db,accountId,id){ const receipt=db.prepare(`SELECT r.*,c.name client_name,c.phone client_phone,q.number quote_number FROM receipts r JOIN clients c ON c.id=r.client_id LEFT JOIN quotes q ON q.id=r.quote_id WHERE r.id=? AND r.account_id=? AND r.deleted_at IS NULL`).get(id,accountId); if(!receipt) throw appError('Recibo não encontrado.',404,'NOT_FOUND'); return receipt; }

export function createReceipt(db,accountId,actor,body,req){
  const clientId=integer(body.clientId,'Cliente'); if(!db.prepare('SELECT 1 FROM clients WHERE id=? AND account_id=? AND deleted_at IS NULL').get(clientId,accountId)) throw appError('Cliente não encontrado nesta conta.',422,'VALIDATION_ERROR');
  const quoteId=integer(body.quoteId,'Orçamento',{optional:true}); if(quoteId&&!db.prepare('SELECT 1 FROM quotes WHERE id=? AND account_id=? AND deleted_at IS NULL').get(quoteId,accountId)) throw appError('Orçamento não encontrado nesta conta.',422,'VALIDATION_ERROR');
  const amountCents=cents(body.amount,'Valor'); const paymentMethod=requiredText(body.paymentMethod,'Forma de pagamento',80); const description=requiredText(body.description,'Descrição',1000); const issuedAt=requiredText(body.issuedAt,'Data',30); const number=integer(body.number??nextNumber(db,'receipts',accountId,1813),'Número');
  return withTransaction(db,()=>{ const result=db.prepare(`INSERT INTO receipts (account_id,client_id,quote_id,number,amount_cents,payment_method,description,issued_at,created_by_user_id,created_by_type) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(accountId,clientId,quoteId,number,amountCents,paymentMethod,description,issuedAt,actor.id,actor.role==='super_admin'?'admin':'professional'); recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId,action:'receipt_created',entityType:'receipt',entityId:result.lastInsertRowid,metadata:{number,amountCents},req}); recordBetoActivity(db,{accountId,clientId,type:'receipt_created',entityType:'receipt',entityId:Number(result.lastInsertRowid),title:`Recibo nº ${number} emitido`,description:`R$ ${(amountCents/100).toLocaleString('pt-BR',{minimumFractionDigits:2})}`}); return getReceipt(db,accountId,result.lastInsertRowid); });
}

export function archiveReceipt(db,accountId,actor,id,req){ const result=db.prepare(`UPDATE receipts SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=? AND deleted_at IS NULL`).run(id,accountId); if(!result.changes)throw appError('Recibo não encontrado.',404,'NOT_FOUND'); recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId,action:'receipt_archived',entityType:'receipt',entityId:id,req}); }

export function listActivities(db,accountId,searchParams){ const {page,perPage,offset}=paging(searchParams); const clientId=Number(searchParams.get('clientId'))||null; const type=String(searchParams.get('type')??''); const period=String(searchParams.get('period')??''); const periodClause=period==='today'?"AND date(ba.created_at)=date('now')":['7','30'].includes(period)?`AND ba.created_at >= datetime('now','-${period} days')`:''; const params=[accountId,...(clientId?[clientId]:[]),...(type?[type]:[])]; const where=`ba.account_id=? ${clientId?'AND ba.client_id=?':''} ${type?'AND ba.activity_type=?':''} ${periodClause}`; const total=db.prepare(`SELECT COUNT(*) count FROM beto_activities ba WHERE ${where}`).get(...params).count; const items=parseMetadata(db.prepare(`SELECT ba.*,c.name client_name FROM beto_activities ba LEFT JOIN clients c ON c.id=ba.client_id WHERE ${where} ORDER BY ba.created_at DESC,ba.id DESC LIMIT ? OFFSET ?`).all(...params,perPage,offset)); return {items,page,perPage,total,pages:Math.max(1,Math.ceil(total/perPage))}; }

export function getAccount(db,accountId){ const account=db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId); if(!account) throw appError('Conta não encontrada.',404,'NOT_FOUND'); return account; }
export function updateAccount(db,accountId,actor,body,req){ const name=requiredText(body.name,'Empresa'); const professionalName=requiredText(body.professionalName,'Nome profissional'); const whatsapp=phone(body.whatsapp); const accountEmail=email(body.email,{required:true}); const city=optionalText(body.city,120); const logoUrl=optionalText(body.logoUrl,500); const documentDetails=optionalText(body.documentDetails,2000); db.prepare(`UPDATE accounts SET name=?,professional_name=?,whatsapp=?,email=?,city=?,logo_url=?,document_details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(name,professionalName,whatsapp,accountEmail,city,logoUrl,documentDetails,accountId); recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId,action:'account_updated',entityType:'account',entityId:accountId,metadata:{logoUpdated:Boolean(logoUrl)},req}); return getAccount(db,accountId); }

export function adminDashboard(db){ return { summary:db.prepare(`SELECT (SELECT COUNT(*) FROM accounts WHERE status='active') active_accounts,(SELECT COUNT(*) FROM users WHERE role='professional' AND status='active') active_users,(SELECT COUNT(*) FROM beto_activities WHERE date(created_at)=date('now')) activities_today,(SELECT COUNT(*) FROM quotes WHERE deleted_at IS NULL) quotes_total,(SELECT COUNT(*) FROM receipts WHERE deleted_at IS NULL) receipts_total,(SELECT COUNT(*) FROM beto_activities WHERE status IN ('attention','failed')) attention`).get(), activity:parseMetadata(db.prepare(`SELECT ba.*,a.name account_name,c.name client_name FROM beto_activities ba JOIN accounts a ON a.id=ba.account_id LEFT JOIN clients c ON c.id=ba.client_id ORDER BY ba.created_at DESC,ba.id DESC LIMIT 12`).all())}; }

export function adminListUsers(db,searchParams){ const {page,perPage,offset}=paging(searchParams); const q=`%${String(searchParams.get('q')??'').trim()}%`; const status=searchParams.get('status'); const statusClause=['active','inactive','suspended'].includes(status)?'AND u.status=?':''; const params=[q,q,q,...(statusClause?[status]:[])]; const where=`u.role='professional' AND (u.name LIKE ? OR u.email LIKE ? OR a.name LIKE ?) ${statusClause}`; const total=db.prepare(`SELECT COUNT(*) count FROM users u JOIN accounts a ON a.id=u.account_id WHERE ${where}`).get(...params).count; const items=db.prepare(`SELECT u.id,u.account_id,u.name,u.email,u.status,u.last_login_at,u.created_at,a.name account_name,a.plan,a.status account_status,(SELECT MAX(created_at) FROM beto_activities WHERE account_id=a.id) last_activity_at FROM users u JOIN accounts a ON a.id=u.account_id WHERE ${where} ORDER BY COALESCE(last_activity_at,u.created_at) DESC LIMIT ? OFFSET ?`).all(...params,perPage,offset); return {items,page,perPage,total,pages:Math.max(1,Math.ceil(total/perPage))}; }

export function adminUserDetail(db,id){ const user=db.prepare(`SELECT u.id,u.account_id,u.name,u.email,u.status,u.last_login_at,u.created_at,a.name account_name,a.slug,a.plan,a.status account_status,a.whatsapp,a.city FROM users u JOIN accounts a ON a.id=u.account_id WHERE u.id=? AND u.role='professional'`).get(id); if(!user) throw appError('Usuário não encontrado.',404,'NOT_FOUND'); const counts=db.prepare(`SELECT (SELECT COUNT(*) FROM clients WHERE account_id=? AND deleted_at IS NULL) clients,(SELECT COUNT(*) FROM quotes WHERE account_id=? AND deleted_at IS NULL) quotes,(SELECT COUNT(*) FROM receipts WHERE account_id=? AND deleted_at IS NULL) receipts`).get(user.account_id,user.account_id,user.account_id); const activity=parseMetadata(db.prepare('SELECT * FROM beto_activities WHERE account_id=? ORDER BY created_at DESC LIMIT 10').all(user.account_id)); return {user,counts,activity}; }

export function adminUpdateUserStatus(db,actor,id,body,req){ const status=enumValue(body.status,['active','inactive','suspended'],'Status'); const user=db.prepare("SELECT id,account_id FROM users WHERE id=? AND role='professional'").get(id); if(!user)throw appError('Usuário não encontrado.',404,'NOT_FOUND'); db.prepare('UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,id); recordAudit(db,{actorUserId:actor.id,actorRole:actor.role,accountId:user.account_id,action:'user_status_updated',entityType:'user',entityId:id,metadata:{status},req}); return adminUserDetail(db,id); }

export function adminGlobalList(db,entity,searchParams){ const allowed={clients:['clients','name'],quotes:['quotes','number'],receipts:['receipts','number'],activities:['beto_activities','title'],audits:['audit_logs','action']}; if(!allowed[entity]) throw appError('Recurso inválido.',404,'NOT_FOUND'); const [table,searchColumn]=allowed[entity]; const {page,perPage,offset}=paging(searchParams); const q=`%${String(searchParams.get('q')??'').trim()}%`; const accountId=Number(searchParams.get('accountId'))||null; const alias='x'; const deleted=['clients','quotes','receipts'].includes(table)?'AND x.deleted_at IS NULL':''; const params=[q,...(accountId?[accountId]:[])]; const where=`CAST(x.${searchColumn} AS TEXT) LIKE ? ${accountId?'AND x.account_id=?':''} ${deleted}`; const total=db.prepare(`SELECT COUNT(*) count FROM ${table} x WHERE ${where}`).get(...params).count; const raw=db.prepare(`SELECT x.*,a.name account_name FROM ${table} x LEFT JOIN accounts a ON a.id=x.account_id WHERE ${where} ORDER BY x.created_at DESC,x.id DESC LIMIT ? OFFSET ?`).all(...params,perPage,offset); const items=['beto_activities','audit_logs'].includes(table)?parseMetadata(raw):raw; return {items,page,perPage,total,pages:Math.max(1,Math.ceil(total/perPage))}; }
