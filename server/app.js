import fs from 'node:fs';
import path from 'node:path';
import { authenticate, login, logout, requireAuth, requireCsrf, requireProfessionalContext, requireRole, startImpersonation, stopImpersonation } from './auth.js';
import { getConfig } from './config.js';
import { openDatabase } from './database.js';
import { appError, json, readBody, redirect, sendFile, text } from './http.js';
import { seedDevelopment } from './seed.js';
import * as repo from './repositories.js';

const mutating = new Set(['POST','PUT','PATCH','DELETE']);
const publicExtensions = new Set(['.css','.js','.png','.jpg','.jpeg','.webp','.svg','.pdf','.ico']);

function match(pathname, pattern) {
  const keys=[];
  const regex=new RegExp(`^${pattern.replace(/:[^/]+/g,token=>{keys.push(token.slice(1));return '([^/]+)'})}$`);
  const result=pathname.match(regex);
  return result ? Object.fromEntries(keys.map((key,index)=>[key,decodeURIComponent(result[index+1])])) : null;
}

function route(method, pathname, expectedMethod, pattern) {
  if (method !== expectedMethod) return null;
  return match(pathname, pattern);
}

function unauthorizedPage(res, message='Você não tem permissão para acessar esta área.') {
  const body=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Acesso restrito · BETO</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#061d31;color:#fff;font:16px Inter,system-ui}.box{max-width:520px;padding:48px;text-align:center}.box a{display:inline-block;margin-top:20px;padding:14px 24px;border-radius:10px;background:#ff6500;color:#fff;text-decoration:none;font-weight:800}</style><div class="box"><h1>Acesso restrito</h1><p>${message}</p><a href="/app">Voltar</a></div></html>`;
  res.writeHead(403,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); res.end(body);
}

export function createApplication(overrides={}) {
  const config=getConfig(overrides);
  const db=overrides.db ?? openDatabase(config.databasePath);
  if (overrides.seed === true && !config.isProduction) seedDevelopment(db,{rootDir:config.rootDir,env:overrides.env ?? process.env,writeCredentials:overrides.writeCredentials ?? false});
  const loginAttempts=new Map();

  async function handler(req,res){
    const url=new URL(req.url,`http://${req.headers.host ?? 'localhost'}`);
    const pathname=decodeURIComponent(url.pathname).replace(/\/{2,}/g,'/');
    const auth=authenticate(db,req);
    try {
      if(pathname.startsWith('/api/')) return await api(req,res,url,auth);
      if(pathname==='/health') return json(res,200,{ok:true});
      if(pathname==='/') return void sendFile(res,path.join(config.rootDir,'index.html'));
      if(pathname==='/login'){
        if(auth) return redirect(res,auth.user.role==='super_admin'&&!auth.impersonating?'/admin':'/app');
        return void sendFile(res,path.join(config.rootDir,'public','product','login.html'));
      }
      if(pathname==='/logout') return redirect(res,'/login');
      if(pathname.startsWith('/app')){
        if(!auth) return redirect(res,`/login?next=${encodeURIComponent(pathname)}`);
        if(auth.user.role==='super_admin'&&!auth.impersonating) return redirect(res,'/admin');
        return void sendFile(res,path.join(config.rootDir,'public','product','app.html'));
      }
      if(pathname.startsWith('/admin')){
        if(!auth) return redirect(res,`/login?next=${encodeURIComponent(pathname)}`);
        if(auth.user.role!=='super_admin') return unauthorizedPage(res);
        return void sendFile(res,path.join(config.rootDir,'public','product','app.html'));
      }
      const quoteDoc=match(pathname,'/documents/orcamentos/:id');
      if(quoteDoc){ requireProfessionalContext(auth); return renderQuoteDocument(res,repo.getQuote(db,auth.accountId,Number(quoteDoc.id)),repo.getAccount(db,auth.accountId)); }
      const receiptDoc=match(pathname,'/documents/recibos/:id');
      if(receiptDoc){ requireProfessionalContext(auth); return renderReceiptDocument(res,repo.getReceipt(db,auth.accountId,Number(receiptDoc.id)),repo.getAccount(db,auth.accountId)); }
      if(pathname.startsWith('/product/')){
        const relative=pathname.slice('/product/'.length);
        const safe=path.resolve(config.rootDir,'public','product',relative);
        if(safe.startsWith(path.resolve(config.rootDir,'public','product'))&&sendFile(res,safe)) return;
      }
      if(pathname.split('/').length===2&&publicExtensions.has(path.extname(pathname).toLowerCase())){
        const safe=path.join(config.rootDir,path.basename(pathname));
        if(sendFile(res,safe,{cache:true})) return;
      }
      text(res,404,'Página não encontrada.');
    } catch(error){
      const status=error.status ?? 500;
      if(status>=500) console.error(error);
      if(pathname.startsWith('/api/')) return json(res,status,{error:{code:error.code ?? 'INTERNAL_ERROR',message:status>=500?'Não foi possível concluir esta ação.':error.message}});
      if(status===401) return redirect(res,`/login?next=${encodeURIComponent(pathname)}`);
      text(res,status,status>=500?'Não foi possível concluir esta ação.':error.message);
    }
  }

  async function api(req,res,url,auth){
    const {pathname,searchParams}=url;
    if(pathname==='/api/auth/login'&&req.method==='POST'){
      const key=String(req.socket.remoteAddress ?? 'local'); const attempt=loginAttempts.get(key)??{count:0,reset:Date.now()+60_000}; if(Date.now()>attempt.reset){attempt.count=0;attempt.reset=Date.now()+60_000;} if(attempt.count>=8) throw appError('Muitas tentativas. Aguarde um minuto.',429,'RATE_LIMITED'); attempt.count++; loginAttempts.set(key,attempt);
      const body=await readBody(req); const result=login(db,{email:body.email,password:body.password,req,sessionTtlHours:config.sessionTtlHours,isProduction:config.isProduction}); loginAttempts.delete(key); return json(res,200,{user:result.user,redirectTo:result.user.role==='super_admin'?'/admin':'/app'},{'set-cookie':result.cookie});
    }
    if(pathname==='/api/auth/me'&&req.method==='GET'){ requireAuth(auth); return json(res,200,{user:auth.user,accountId:auth.accountId,accountName:auth.accountName,accountProfessionalName:auth.accountProfessionalName,impersonating:auth.impersonating,csrfToken:auth.csrfToken}); }
    if(pathname==='/api/auth/logout'&&req.method==='POST'){ if(auth) requireCsrf(req,auth); const cookie=logout(db,auth,req,config.isProduction); return json(res,200,{ok:true},{'set-cookie':cookie}); }
    requireAuth(auth);
    if(mutating.has(req.method)) requireCsrf(req,auth);

    let params;
    if(pathname==='/api/dashboard'&&req.method==='GET'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.getDashboard(db,accountId)); }
    if(pathname==='/api/clients'&&req.method==='GET'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.listClients(db,accountId,searchParams)); }
    if(pathname==='/api/clients'&&req.method==='POST'){ const accountId=requireProfessionalContext(auth); return json(res,201,repo.createClient(db,accountId,auth.user,await readBody(req),req)); }
    if((params=route(req.method,pathname,'GET','/api/clients/:id'))){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.getClient(db,accountId,Number(params.id))); }
    if((params=route(req.method,pathname,'PATCH','/api/clients/:id'))){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.updateClient(db,accountId,auth.user,Number(params.id),await readBody(req),req)); }
    if((params=route(req.method,pathname,'DELETE','/api/clients/:id'))){ const accountId=requireProfessionalContext(auth); repo.archiveClient(db,accountId,auth.user,Number(params.id),req); return json(res,200,{ok:true}); }

    if(pathname==='/api/quotes'&&req.method==='GET'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.listQuotes(db,accountId,searchParams)); }
    if(pathname==='/api/quotes'&&req.method==='POST'){ const accountId=requireProfessionalContext(auth); return json(res,201,repo.createQuote(db,accountId,auth.user,await readBody(req),req)); }
    if((params=route(req.method,pathname,'GET','/api/quotes/:id'))){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.getQuote(db,accountId,Number(params.id))); }
    if((params=route(req.method,pathname,'PATCH','/api/quotes/:id'))){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.updateQuote(db,accountId,auth.user,Number(params.id),await readBody(req),req)); }
    if((params=route(req.method,pathname,'DELETE','/api/quotes/:id'))){ const accountId=requireProfessionalContext(auth); repo.archiveQuote(db,accountId,auth.user,Number(params.id),req); return json(res,200,{ok:true}); }
    if((params=route(req.method,pathname,'POST','/api/quotes/:id/duplicate'))){ const accountId=requireProfessionalContext(auth); return json(res,201,repo.duplicateQuote(db,accountId,auth.user,Number(params.id),req)); }

    if(pathname==='/api/receipts'&&req.method==='GET'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.listReceipts(db,accountId,searchParams)); }
    if(pathname==='/api/receipts'&&req.method==='POST'){ const accountId=requireProfessionalContext(auth); return json(res,201,repo.createReceipt(db,accountId,auth.user,await readBody(req),req)); }
    if((params=route(req.method,pathname,'GET','/api/receipts/:id'))){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.getReceipt(db,accountId,Number(params.id))); }
    if((params=route(req.method,pathname,'DELETE','/api/receipts/:id'))){ const accountId=requireProfessionalContext(auth); repo.archiveReceipt(db,accountId,auth.user,Number(params.id),req); return json(res,200,{ok:true}); }
    if(pathname==='/api/activities'&&req.method==='GET'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.listActivities(db,accountId,searchParams)); }
    if(pathname==='/api/account'&&req.method==='GET'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.getAccount(db,accountId)); }
    if(pathname==='/api/account'&&req.method==='PATCH'){ const accountId=requireProfessionalContext(auth); return json(res,200,repo.updateAccount(db,accountId,auth.user,await readBody(req),req)); }

    if(pathname==='/api/admin/dashboard'&&req.method==='GET'){ requireRole(auth,'super_admin'); return json(res,200,repo.adminDashboard(db)); }
    if(pathname==='/api/admin/users'&&req.method==='GET'){ requireRole(auth,'super_admin'); return json(res,200,repo.adminListUsers(db,searchParams)); }
    if((params=route(req.method,pathname,'GET','/api/admin/users/:id'))){ requireRole(auth,'super_admin'); return json(res,200,repo.adminUserDetail(db,Number(params.id))); }
    if((params=route(req.method,pathname,'PATCH','/api/admin/users/:id'))){ requireRole(auth,'super_admin'); return json(res,200,repo.adminUpdateUserStatus(db,auth.user,Number(params.id),await readBody(req),req)); }
    if((params=route(req.method,pathname,'POST','/api/admin/accounts/:id/impersonate'))){ requireRole(auth,'super_admin'); const account=startImpersonation(db,auth,Number(params.id),req); return json(res,200,{account,redirectTo:'/app'}); }
    if(pathname==='/api/admin/impersonation/stop'&&req.method==='POST'){ requireRole(auth,'super_admin'); stopImpersonation(db,auth,req); return json(res,200,{ok:true,redirectTo:'/admin'}); }
    if((params=route(req.method,pathname,'GET','/api/admin/global/:entity'))){ requireRole(auth,'super_admin'); return json(res,200,repo.adminGlobalList(db,params.entity,searchParams)); }
    throw appError('Rota não encontrada.',404,'NOT_FOUND');
  }

  return {handler,db,config,close(){db.close();}};
}

function escapeHtml(value){ return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function money(cents){ return (Number(cents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function documentShell(title,content){ return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · BETO</title><style>body{font:15px Inter,Arial;color:#061d31;margin:0;background:#f4efe7}.toolbar{padding:16px;text-align:center}.toolbar button{background:#ff6500;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-weight:700}.page{width:760px;min-height:980px;margin:0 auto 40px;background:#fff;padding:56px;box-sizing:border-box;box-shadow:0 12px 40px #061d3120}.head{display:flex;justify-content:space-between;border-bottom:3px solid #061d31;padding-bottom:24px}.brand{font-weight:900;font-size:26px}.brand em{color:#ff6500;font-style:normal}.meta{text-align:right}.title{text-align:center;margin:44px 0 32px;font-size:26px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.label{font-size:11px;color:#687383;text-transform:uppercase}.value{font-weight:700;margin-top:4px}.items{width:100%;border-collapse:collapse;margin:30px 0}.items th,.items td{padding:13px;border-bottom:1px solid #dfe3e7;text-align:left}.total{text-align:right;font-size:28px;font-weight:900}.notes{margin-top:32px;padding:20px;background:#f7f5f1}.footer{margin-top:80px;border-top:1px solid #dfe3e7;padding-top:18px;font-size:12px;color:#687383}@media(max-width:820px){.page{width:100%;min-height:100vh;padding:28px}.grid{grid-template-columns:1fr}}@media print{body{background:#fff}.toolbar{display:none}.page{box-shadow:none;margin:0;width:100%}}</style></head><body><div class="toolbar"><button onclick="print()">Salvar como PDF / imprimir</button></div><main class="page">${content}</main></body></html>`; }
function renderQuoteDocument(res,data,account){ const q=data.quote; const rows=data.items.map(item=>`<tr><td>${escapeHtml(item.description)}</td><td>${item.quantity} ${escapeHtml(item.unit)}</td><td>${money(item.unit_price_cents)}</td><td>${money(item.total_cents)}</td></tr>`).join(''); const html=documentShell(`Orçamento nº ${q.number}`,`<header class="head"><div class="brand">BETO <em>ObraFácil</em><br><small>${escapeHtml(account.name)}</small></div><div class="meta"><b>nº ${q.number}</b><br>${escapeHtml(q.created_at.slice(0,10))}</div></header><h1 class="title">ORÇAMENTO</h1><section class="grid"><div><div class="label">Cliente</div><div class="value">${escapeHtml(q.client_name)}</div></div><div><div class="label">Validade</div><div class="value">${escapeHtml(q.valid_until||'A combinar')}</div></div></section><table class="items"><thead><tr><th>Serviço</th><th>Quantidade</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="total">${money(q.total_cents)}</div><div class="notes"><b>Condições</b><p>${escapeHtml(q.payment_terms||'A combinar')}</p><b>Observações</b><p>${escapeHtml(q.observations||'—')}</p></div><footer class="footer">Documento organizado pelo BETO para ${escapeHtml(account.name)}.</footer>`); res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); res.end(html); }
function renderReceiptDocument(res,r,account){ const html=documentShell(`Recibo nº ${r.number}`,`<header class="head"><div class="brand">BETO <em>ObraFácil</em><br><small>${escapeHtml(account.name)}</small></div><div class="meta"><b>nº ${r.number}</b><br>${escapeHtml(r.issued_at)}</div></header><h1 class="title">RECIBO</h1><p style="text-align:center;margin-top:70px">Recebemos de <b>${escapeHtml(r.client_name)}</b> a importância de</p><div class="total" style="text-align:center;font-size:42px;margin:30px">${money(r.amount_cents)}</div><p style="text-align:center;line-height:1.7">${escapeHtml(r.description)}</p><section class="grid" style="margin-top:70px"><div><div class="label">Pagamento</div><div class="value">${escapeHtml(r.payment_method)}</div></div><div><div class="label">Orçamento relacionado</div><div class="value">${r.quote_number?`nº ${r.quote_number}`:'Recibo avulso'}</div></div></section><footer class="footer">Recibo emitido por ${escapeHtml(account.name)} com organização do BETO.</footer>`); res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}); res.end(html); }
