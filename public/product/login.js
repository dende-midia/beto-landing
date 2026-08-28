const form=document.querySelector('#login-form');
const errorBox=document.querySelector('#form-error');
const submit=form.querySelector('button[type="submit"]');
const password=form.elements.password;

document.querySelector('#toggle-password').addEventListener('click',event=>{
  const visible=password.type==='text';
  password.type=visible?'password':'text';
  event.currentTarget.textContent=visible?'Mostrar':'Ocultar';
  event.currentTarget.setAttribute('aria-label',visible?'Mostrar senha':'Ocultar senha');
});

document.querySelector('#forgot').addEventListener('click',()=>{
  errorBox.textContent='A recuperação automática será habilitada na integração de e-mail. Fale com o suporte BETO para recuperar o acesso.';
  errorBox.hidden=false;
});

form.addEventListener('submit',async event=>{
  event.preventDefault();
  errorBox.hidden=true;
  if(!form.checkValidity()) return form.reportValidity();
  submit.disabled=true; submit.classList.add('loading');
  try{
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    const payload=await response.json();
    if(!response.ok) throw new Error(payload.error?.message||'Não foi possível entrar.');
    location.assign(payload.redirectTo);
  }catch(error){ errorBox.textContent=error.message; errorBox.hidden=false; submit.disabled=false; submit.classList.remove('loading'); }
});
