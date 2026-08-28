const header = document.querySelector('.site-header');
const toggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');
const form = document.querySelector('#lead-form');
const captureMode = new URLSearchParams(window.location.search).has('capture');

if (captureMode) {
  document.documentElement.classList.add('capture-mode');
}

if (!captureMode && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('hero-motion-ready');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.add('hero-intro-play');
    window.setTimeout(() => document.documentElement.classList.add('hero-intro-complete'), 1800);
  }));
}

window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 24), { passive: true });

const stickyCta = document.querySelector('.mobile-sticky');
const supportCta = document.querySelector('.whatsapp-support');
const hero = document.querySelector('.hero');
const trial = document.querySelector('#teste');
const updateStickyCta = () => {
  const afterHero = window.scrollY > (hero?.offsetHeight || 700) * .78;
  const beforeConversion = !trial || trial.getBoundingClientRect().top > window.innerHeight * .55;
  stickyCta?.classList.toggle('visible', window.innerWidth <= 1000 && afterHero && beforeConversion);

  const supportAfterHero = window.scrollY > (hero?.offsetHeight || 700) * .52;
  supportCta?.classList.toggle('visible', window.innerWidth > 600 || supportAfterHero);
};
window.addEventListener('scroll', updateStickyCta, { passive: true });
updateStickyCta();

const setMenuState = open => {
  if (!toggle || !mobileMenu) return;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  mobileMenu.classList.toggle('open', open);
  document.body.classList.toggle('menu-open', open);
};

toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  setMenuState(!open);
});

mobileMenu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  setMenuState(false);
}));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
    setMenuState(false);
    toggle.focus();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 1000) setMenuState(false);
  updateStickyCta();
});

document.querySelectorAll('details').forEach(item => item.addEventListener('toggle', () => {
  if (!item.open) return;
  document.querySelectorAll('details[open]').forEach(other => { if (other !== item) other.open = false; });
}));

form?.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.checkValidity()) return form.reportValidity();
  const name = new FormData(form).get('nome').trim().split(' ')[0];
  document.querySelector('#success-name').textContent = name || 'profissional';
  form.querySelectorAll(':scope > .form-fields, :scope > button, :scope > small').forEach(el => el.hidden = true);
  form.querySelector('.form-success').hidden = false;
});

const phone = document.querySelector('#telefone');
phone?.addEventListener('input', () => {
  const digits = phone.value.replace(/\D/g, '').slice(0, 11);
  if (!digits) return void (phone.value = '');
  if (digits.length <= 2) return void (phone.value = `(${digits}`);
  if (digits.length <= 6) return void (phone.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`);
  if (digits.length <= 10) return void (phone.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`);
  phone.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
});

const revealElements = [...document.querySelectorAll('.reveal')];
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    observer.unobserve(entry.target);
  }), { threshold: .1, rootMargin: '0px 0px -48px' });
  revealElements.forEach(el => observer.observe(el));
  document.documentElement.classList.add('motion-ready');
} else {
  revealElements.forEach(el => el.classList.add('visible'));
}

const navLinks = [...document.querySelectorAll('.desktop-nav a[href^="#"]')];
const navTargets = navLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
const navSections = [document.querySelector('#inicio'), ...navTargets].filter(Boolean);
if ('IntersectionObserver' in window && navSections.length) {
  const navObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    navLinks.forEach(link => {
      const active = entry.target.id !== 'inicio' && link.getAttribute('href') === `#${entry.target.id}`;
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }), { rootMargin: '-32% 0px -58%', threshold: 0 });
  navSections.forEach(section => navObserver.observe(section));
}
document.querySelector('#year').textContent = new Date().getFullYear();
