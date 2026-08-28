import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApplication } from '../server/app.js';
import { seedDevelopment } from '../server/seed.js';

let app;
let server;
let origin;
let seed;
let professional;
let admin;
let otherClientId;

async function request(pathname,{method='GET',body,cookie,csrf,redirect='manual'}={}){
  return fetch(`${origin}${pathname}`,{method,redirect,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});
}

async function signIn(email,password){
  const response=await request('/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const meResponse=await request('/api/auth/me',{cookie});
  const me=await meResponse.json();
  return {cookie,csrf:me.csrfToken,me};
}

before(async()=>{
  const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'beto-tests-'));
  app=createApplication({databasePath:path.join(tempDir,'test.sqlite')});
  seed=seedDevelopment(app.db,{rootDir:tempDir,writeCredentials:false,env:{NODE_ENV:'test',DEV_PRO_EMAIL:'pro@test.local',DEV_PRO_PASSWORD:'Profissional#123',DEV_ADMIN_EMAIL:'admin@test.local',DEV_ADMIN_PASSWORD:'Administrador#123'}});
  const carlos=app.db.prepare("SELECT id FROM users WHERE email='carlos@beto.local'").get();
  app.db.prepare("UPDATE users SET password_hash=(SELECT password_hash FROM users WHERE id=?),password_salt=(SELECT password_salt FROM users WHERE id=?) WHERE id=?").run(seed.proId,seed.proId,carlos.id);
  otherClientId=Number(app.db.prepare(`INSERT INTO clients (account_id,name,phone,status,created_by) VALUES (?,?,?,?,?)`).run(seed.secondAccountId,'Cliente de outra conta','(21) 99999-0000','active',carlos.id).lastInsertRowid);
  server=http.createServer(app.handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  professional=await signIn(seed.credentials.professional.email,seed.credentials.professional.password);
  admin=await signIn(seed.credentials.superAdmin.email,seed.credentials.superAdmin.password);
});

after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  app.close();
});

test('rotas autenticadas redirecionam visitante para login',async()=>{
  const response=await request('/app/clientes');
  assert.equal(response.status,302);
  assert.match(response.headers.get('location'),/^\/login/);
});

test('professional não acessa área nem API administrativa',async()=>{
  const page=await request('/admin',{cookie:professional.cookie});
  assert.equal(page.status,403);
  const api=await request('/api/admin/dashboard',{cookie:professional.cookie});
  assert.equal(api.status,403);
});

test('isolamento impede professional A de acessar cliente da conta B',async()=>{
  const response=await request(`/api/clients/${otherClientId}`,{cookie:professional.cookie});
  assert.equal(response.status,404);
});

test('professional cria cliente, orçamento e recibo persistentes',async()=>{
  const clientResponse=await request('/api/clients',{method:'POST',cookie:professional.cookie,csrf:professional.csrf,body:{name:'Ana Souza',phone:'(11) 98888-7777',email:'ana@example.com',city:'São Paulo'}});
  assert.equal(clientResponse.status,201);
  const client=await clientResponse.json();
  const quoteResponse=await request('/api/quotes',{method:'POST',cookie:professional.cookie,csrf:professional.csrf,body:{clientId:client.id,status:'awaiting_approval',items:[{description:'Reforma do banheiro',quantity:20,unit:'m²',unitPrice:120}],validUntil:'2026-09-30',paymentTerms:'50% de entrada'}});
  assert.equal(quoteResponse.status,201);
  const quote=await quoteResponse.json();
  assert.equal(quote.quote.total_cents,240000);
  const receiptResponse=await request('/api/receipts',{method:'POST',cookie:professional.cookie,csrf:professional.csrf,body:{clientId:client.id,quoteId:quote.quote.id,amount:1200,paymentMethod:'PIX',description:'Entrada do orçamento',issuedAt:'2026-08-28'}});
  assert.equal(receiptResponse.status,201);
  const receipt=await receiptResponse.json();
  assert.equal(receipt.amount_cents,120000);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM clients WHERE id=?').get(client.id).n,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM quotes WHERE id=?').get(quote.quote.id).n,1);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM receipts WHERE id=?').get(receipt.id).n,1);
});

test('criação de orçamento e recibo persiste atividade do BETO',()=>{
  const types=app.db.prepare(`SELECT activity_type FROM beto_activities WHERE account_id=? AND activity_type IN ('quote_created','receipt_created')`).all(seed.accountId).map(row=>row.activity_type);
  assert.ok(types.includes('quote_created'));
  assert.ok(types.includes('receipt_created'));
});

test('superadmin consulta dados globais com identificação da conta',async()=>{
  const response=await request('/api/admin/global/clients',{cookie:admin.cookie});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.ok(payload.items.some(item=>item.id===otherClientId&&item.account_name==='Carlos Elétrica'));
  assert.ok(payload.items.some(item=>item.account_name==='JL Pinturas'));
});

test('impersonation é explícita, funcional e auditada no início e fim',async()=>{
  const start=await request(`/api/admin/accounts/${seed.accountId}/impersonate`,{method:'POST',cookie:admin.cookie,csrf:admin.csrf,body:{}});
  assert.equal(start.status,200);
  const meAfterStart=await (await request('/api/auth/me',{cookie:admin.cookie})).json();
  assert.equal(meAfterStart.impersonating,true);
  assert.equal(meAfterStart.accountName,'JL Pinturas');
  const stop=await request('/api/admin/impersonation/stop',{method:'POST',cookie:admin.cookie,csrf:admin.csrf,body:{}});
  assert.equal(stop.status,200);
  const actions=app.db.prepare("SELECT action FROM audit_logs WHERE actor_user_id=? AND action LIKE 'impersonation_%' ORDER BY id").all(seed.adminId).map(row=>row.action);
  assert.deepEqual(actions.slice(-2),['impersonation_started','impersonation_ended']);
});

test('mutações rejeitam ausência de CSRF',async()=>{
  const response=await request('/api/clients',{method:'POST',cookie:professional.cookie,body:{name:'Invasão',phone:'11999999999'}});
  assert.equal(response.status,403);
});
