let csrfToken='';
export function setCsrf(value){csrfToken=value||'';}
export async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...(options.body?{'content-type':'application/json'}:{}),...(csrfToken?{'x-csrf-token':csrfToken}:{}),...options.headers},body:options.body&&typeof options.body!=='string'?JSON.stringify(options.body):options.body});
  const type=response.headers.get('content-type')||'';
  const payload=type.includes('application/json')?await response.json():await response.text();
  if(response.status===401){location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);throw new Error('Sessão encerrada.');}
  if(!response.ok) throw new Error(payload?.error?.message||payload||'Não foi possível concluir esta ação.');
  return payload;
}
