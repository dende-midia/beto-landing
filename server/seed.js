import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './security.js';
import { recordBetoActivity } from './activity-service.js';

function generatedPassword() {
  return `${randomBytes(9).toString('base64url')}A7!`;
}

function addUser(db, { accountId = null, name, email, password, role }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
  const { salt, hash } = hashPassword(password);
  if (existing) {
    db.prepare('UPDATE users SET password_hash=?,password_salt=?,status=\'active\',updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hash,salt,existing.id);
    return existing.id;
  }
  return Number(db.prepare(`INSERT INTO users (account_id,name,email,password_hash,password_salt,role) VALUES (?,?,?,?,?,?)`)
    .run(accountId,name,email,hash,salt,role).lastInsertRowid);
}

export function seedDevelopment(db, { rootDir, env = process.env, writeCredentials = true } = {}) {
  if ((env.NODE_ENV ?? 'development') === 'production') throw new Error('Seed de demonstração bloqueado em produção.');
  let account = db.prepare("SELECT * FROM accounts WHERE slug='jl-pinturas'").get();
  if (!account) {
    const id = Number(db.prepare(`INSERT INTO accounts (name,slug,professional_name,whatsapp,email,city,document_details,plan) VALUES (?,?,?,?,?,?,?,?)`)
      .run('JL Pinturas','jl-pinturas','João Luís','(11) 99999-1102','joao@jlpinturas.local','São Paulo','JL Pinturas · serviços de pintura e acabamento','annual').lastInsertRowid);
    account = db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  }
  let second = db.prepare("SELECT * FROM accounts WHERE slug='carlos-eletrica'").get();
  if (!second) {
    const id = Number(db.prepare(`INSERT INTO accounts (name,slug,professional_name,whatsapp,email,city,plan) VALUES (?,?,?,?,?,?,?)`)
      .run('Carlos Elétrica','carlos-eletrica','Carlos Mendes','(21) 98888-2200','carlos@eletrica.local','Rio de Janeiro','monthly').lastInsertRowid);
    second = db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  }
  const proEmail = env.DEV_PRO_EMAIL || 'joao@beto.local';
  const adminEmail = env.DEV_ADMIN_EMAIL || 'admin@beto.local';
  const proPassword = env.DEV_PRO_PASSWORD || generatedPassword();
  const adminPassword = env.DEV_ADMIN_PASSWORD || generatedPassword();
  const proId = addUser(db,{accountId:account.id,name:'João Luís',email:proEmail,password:proPassword,role:'professional'});
  addUser(db,{accountId:second.id,name:'Carlos Mendes',email:'carlos@beto.local',password:generatedPassword(),role:'professional'});
  const adminId = addUser(db,{name:'Administração BETO',email:adminEmail,password:adminPassword,role:'super_admin'});

  let client = db.prepare('SELECT * FROM clients WHERE account_id=? AND phone=?').get(account.id,'(11) 97777-3344');
  if (!client) {
    const id=Number(db.prepare(`INSERT INTO clients (account_id,name,phone,email,city,notes,created_by) VALUES (?,?,?,?,?,?,?)`).run(account.id,'Gabriel da Silva','(11) 97777-3344','gabriel@example.com','São Paulo','Cliente de demonstração da landing.',proId).lastInsertRowid);
    client=db.prepare('SELECT * FROM clients WHERE id=?').get(id);
  }
  let quote=db.prepare('SELECT * FROM quotes WHERE account_id=? AND number=1102').get(account.id);
  if(!quote){ const id=Number(db.prepare(`INSERT INTO quotes (account_id,client_id,number,status,total_cents,materials,valid_until,payment_terms,deadline,observations,created_by_type,pdf_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(account.id,client.id,1102,'approved',450000,'Tintas e materiais conforme documento.',new Date(Date.now()+15*86400000).toISOString().slice(0,10),'50% na aprovação e 50% na entrega','2 a 3 dias','Orçamento real preservado da landing.','beto','/Orcamento%201102%20-%20Cliente%20Gabriel%20-%20JL%20Pinturas.pdf').lastInsertRowid); db.prepare(`INSERT INTO quote_items (quote_id,description,quantity,unit,unit_price_cents,total_cents,sort_order) VALUES (?,?,?,?,?,?,?)`).run(id,'Pintura interna do salão comercial',1,'serviço',450000,450000,0); quote=db.prepare('SELECT * FROM quotes WHERE id=?').get(id); }
  let receipt=db.prepare('SELECT * FROM receipts WHERE account_id=? AND number=1814').get(account.id);
  if(!receipt){ const id=Number(db.prepare(`INSERT INTO receipts (account_id,client_id,quote_id,number,amount_cents,payment_method,description,issued_at,created_by_type,pdf_path) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(account.id,client.id,quote.id,1814,225000,'PIX','Pagamento de 50% referente ao orçamento nº 1102',new Date().toISOString().slice(0,10),'beto','/Recibo%201814%20-%20Cliente%20Gabriel%20-%20JL%20Pinturas.pdf').lastInsertRowid); receipt=db.prepare('SELECT * FROM receipts WHERE id=?').get(id); }
  if(!db.prepare('SELECT 1 FROM beto_activities WHERE account_id=?').get(account.id)){
    recordBetoActivity(db,{accountId:account.id,clientId:client.id,type:'client_message_received',title:'Gabriel chamou no WhatsApp',description:'Preciso de um orçamento para pintura.',status:'completed'});
    recordBetoActivity(db,{accountId:account.id,clientId:client.id,type:'information_collected',title:'BETO organizou as informações',description:'Serviço, medidas e prazo reunidos.',status:'completed'});
    recordBetoActivity(db,{accountId:account.id,clientId:client.id,type:'quote_created',entityType:'quote',entityId:quote.id,title:'Orçamento nº 1102 criado',description:'R$ 4.500,00',status:'completed'});
    recordBetoActivity(db,{accountId:account.id,clientId:client.id,type:'receipt_created',entityType:'receipt',entityId:receipt.id,title:'Recibo nº 1814 emitido',description:'R$ 2.250,00',status:'completed'});
  }
  const credentials = { professional:{email:proEmail,password:proPassword}, superAdmin:{email:adminEmail,password:adminPassword} };
  if(writeCredentials){ const target=path.join(rootDir,'data','dev-credentials.txt'); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,`CREDENCIAIS LOCAIS DE DESENVOLVIMENTO — NÃO PUBLICAR\n\nProfissional\nE-mail: ${proEmail}\nSenha: ${proPassword}\n\nSuperadmin\nE-mail: ${adminEmail}\nSenha: ${adminPassword}\n`,'utf8'); }
  return {accountId:account.id,secondAccountId:second.id,proId,adminId,credentials};
}
