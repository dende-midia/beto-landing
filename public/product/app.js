import {api,setCsrf} from './api.js?v=2';
import {errorState,loading,toast} from './components.js?v=2';
import {icon} from './icons.js?v=2';
import {renderProfessional} from './views-professional.js?v=2';
import {renderAdmin} from './views-admin.js?v=2';

const root=document.querySelector('#app');
let me;
let pageVersion=0;

async function boot(){
  try{me=await api('/api/auth/me');setCsrf(me.csrfToken);buildShell();await renderRoute();}
  catch(error){root.innerHTML=errorState(error.message);}
}

function buildShell(){
  const admin=location.pathname.startsWith('/admin');
  const nav=admin?[
    ['/admin','home','Visão geral'],['/admin/usuarios','users','Usuários'],['/admin/clientes','account','Clientes'],['/admin/orcamentos','quote','Orçamentos'],['/admin/recibos','receipt','Recibos'],['/admin/beto','beto','Atividade do BETO'],['/admin/auditoria','audit','Auditoria'],['/admin/configuracoes','settings','Configurações']
  ]:[
    ['/app','home','Início'],['/app/clientes','users','Clientes'],['/app/orcamentos','quote','Orçamentos'],['/app/recibos','receipt','Recibos'],['/app/beto','beto','Atividade do BETO'],['/app/conta','account','Minha conta']
  ];
  root.innerHTML=`<div class="app-layout ${admin?'admin-layout':''}">${me.impersonating?`<div class="impersonation-bar">${icon('eye')}<span>Você está visualizando a conta <b>${escapeText(me.accountName)}</b> como administrador.</span><button data-stop-impersonation>Sair da visualização</button></div>`:''}<aside class="sidebar"><div class="sidebar-head"><a href="${admin?'/admin':'/app'}" data-link class="app-brand"><img src="/Logo%20Beto%20Obraf%C3%A1cil.png" alt="BETO ObraFácil"></a><button class="sidebar-close" aria-label="Fechar menu">${icon('close')}</button></div><div class="sidebar-context"><small>${admin?'ADMINISTRAÇÃO':'CONTA PROFISSIONAL'}</small><strong>${escapeText(admin?'Ecossistema BETO':me.accountName||me.user.name)}</strong></div><nav class="app-nav">${nav.map(([href,iconName,label])=>`<a data-link href="${href}" data-nav="${href}">${icon(iconName)}<span>${label}</span></a>`).join('')}</nav><div class="sidebar-foot"><div class="user-compact"><span>${initials(me.user.name)}</span><div><b>${escapeText(me.user.name)}</b><small>${me.user.role==='super_admin'?'Administrador':'Profissional'}</small></div></div><button data-logout aria-label="Sair">${icon('logout')}</button></div></aside><div class="sidebar-overlay"></div><div class="app-body"><header class="topbar"><button class="menu-button" aria-label="Abrir menu">${icon('menu')}</button><div class="topbar-context"><span class="online-dot"></span><span>BETO online</span></div><div class="topbar-actions"><a data-link href="${admin?'/admin/auditoria':'/app/beto'}" class="topbar-icon" aria-label="Atividade">${icon('beto')}</a><span class="topbar-user">${initials(me.user.name)}</span></div></header><main id="page" tabindex="-1"></main><nav class="bottom-nav">${nav.slice(0,4).map(([href,iconName,label])=>`<a data-link href="${href}" data-nav="${href}">${icon(iconName)}<span>${label}</span></a>`).join('')}<button class="more-menu">${icon('menu')}<span>Mais</span></button></nav></div></div>`;
  bindShell();
}

function bindShell(){
  root.addEventListener('click',async event=>{
    const link=event.target.closest('a[data-link]');
    if(link){event.preventDefault();navigate(link.pathname+link.search);return;}
    if(event.target.closest('[data-logout]')){try{await api('/api/auth/logout',{method:'POST',body:{}});}finally{location.assign('/login');}}
    if(event.target.closest('[data-stop-impersonation]')){try{await api('/api/admin/impersonation/stop',{method:'POST',body:{}});location.assign('/admin');}catch(error){toast(error.message,'error');}}
    const pageButton=event.target.closest('[data-page]');if(pageButton&&!pageButton.disabled){const query=new URLSearchParams(location.search);query.set('page',pageButton.dataset.page);navigate(`${location.pathname}?${query}`);}
    const filter=event.target.closest('[data-filter]');if(filter){const query=new URLSearchParams(location.search);if(filter.dataset.value)query.set(filter.dataset.filter,filter.dataset.value);else query.delete(filter.dataset.filter);query.delete('page');navigate(`${location.pathname}${query.size?`?${query}`:''}`);}
    if(event.target.closest('[data-reload]'))renderRoute();
  });
  let searchTimer;root.addEventListener('input',event=>{if(!event.target.matches('[data-search]'))return;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const query=new URLSearchParams(location.search);if(event.target.value.trim())query.set('q',event.target.value.trim());else query.delete('q');query.delete('page');navigate(`${location.pathname}${query.size?`?${query}`:''}`);},350);});
  const openMenu=()=>document.body.classList.add('sidebar-open');const closeMenu=()=>document.body.classList.remove('sidebar-open');document.querySelector('.menu-button').onclick=openMenu;document.querySelector('.more-menu').onclick=openMenu;document.querySelector('.sidebar-close').onclick=closeMenu;document.querySelector('.sidebar-overlay').onclick=closeMenu;
}

async function renderRoute(){
  const version=++pageVersion;
  const page=document.querySelector('#page');
  page.innerHTML=loading();
  updateActiveNav();
  try{
    const context={me,navigate,refresh:renderRoute};
    const view=location.pathname.startsWith('/admin')?await renderAdmin(location.pathname,context):await renderProfessional(location.pathname,context);
    if(version!==pageVersion)return;
    page.innerHTML=view.html;
    page.focus({preventScroll:true});
    if(view.mount)view.mount();
    hydrateControls();
    document.body.classList.remove('sidebar-open');
    window.scrollTo({top:0,behavior:'instant'});
  }catch(error){if(version===pageVersion)page.innerHTML=errorState(error.message);}
}

function hydrateControls(){
  const query=new URLSearchParams(location.search);
  const search=document.querySelector('[data-search]');if(search)search.value=query.get('q')||'';
  document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',(query.get(button.dataset.filter)||'')===button.dataset.value));
}

function updateActiveNav(){document.querySelectorAll('[data-nav]').forEach(link=>{const href=link.dataset.nav;const active=href==='/app'||href==='/admin'?location.pathname===href||location.pathname===`${href}/`:location.pathname.startsWith(href);link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});}

function navigate(target){if(target===location.pathname+location.search)return;history.pushState({},'',target);renderRoute();}
window.addEventListener('popstate',renderRoute);
function escapeText(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
function initials(name){return escapeText(name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase());}

boot();
