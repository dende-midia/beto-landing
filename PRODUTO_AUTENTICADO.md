# BETO / ObraFácil — produto autenticado

## Arquitetura

O projeto original permanece como landing pública estática em `/`. A camada autenticada foi adicionada sem substituir os ativos, o CSS, o JavaScript ou os PDFs existentes.

- servidor: Node.js 24, sem dependências externas;
- banco: SQLite via `node:sqlite`;
- migrações: SQL versionado em `migrations/`;
- autenticação: senha derivada com `scrypt`, sessão opaca persistida no servidor e cookie `HttpOnly`, `SameSite=Lax`;
- autorização: RBAC no servidor (`professional` e `super_admin`);
- tenancy: o `account_id` efetivo sempre vem da sessão autenticada;
- frontend autenticado: módulos ES, rotas reais servidas pelo backend e API JSON;
- documentos: PDFs originais preservados e documentos novos com visualização profissional pronta para imprimir/salvar como PDF.

## Execução local

Requer Node.js 24 ou superior.

```text
npm run migrate
npm run seed
npm start
```

O seed só funciona fora de produção. Ele grava credenciais aleatórias em `data/dev-credentials.txt`, arquivo ignorado no versionamento.

## Rotas

Públicas: `/`, `/login`.

Profissional: `/app`, `/app/clientes`, `/app/clientes/:id`, `/app/orcamentos`, `/app/orcamentos/novo`, `/app/orcamentos/:id`, `/app/orcamentos/:id/editar`, `/app/recibos`, `/app/recibos/novo`, `/app/recibos/:id`, `/app/beto`, `/app/conta`.

Administração: `/admin`, `/admin/usuarios`, `/admin/usuarios/:id`, `/admin/clientes`, `/admin/orcamentos`, `/admin/recibos`, `/admin/beto`, `/admin/auditoria`, `/admin/configuracoes`.

## Segurança e isolamento

- `/app/*` e `/admin/*` são protegidas no servidor antes do HTML ser entregue.
- Todas as mutações autenticadas exigem token CSRF vinculado à sessão.
- Um profissional nunca escolhe o próprio `account_id` em uma requisição.
- Repositórios de cliente, orçamento, recibo e atividade recebem o tenant validado pelo servidor e incluem o filtro em todas as consultas.
- Superadmin usa endpoints globais separados.
- Impersonação altera somente o contexto da sessão do admin, mostra uma faixa fixa e registra início e fim em `audit_logs`.
- Exclusões de registros críticos são arquivamentos lógicos e permanecem auditáveis.

## Validação

```text
npm test
npm run check
```

Os testes cobrem proteção de rota, bloqueio administrativo, isolamento entre duas contas, criação persistente de cliente/orçamento/recibo, atividade do BETO, visão global, impersonação auditada e CSRF.
