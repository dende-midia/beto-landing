const paths={
  home:'<path d="M4 14 16 4l12 10v14H19v-8h-6v8H4z"/>',
  users:'<path d="M20 27v-3a6 6 0 0 0-6-6H8a6 6 0 0 0-6 6v3M11 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10M22 12a4 4 0 0 0 0-8M30 27v-3a6 6 0 0 0-5-5.7"/>',
  quote:'<path d="M6 3h15l6 6v20H6zM21 3v7h6M11 15h11M11 20h11M11 25h6"/>',
  receipt:'<path d="M6 3h20v26l-5-3-5 3-5-3-5 3zM11 10h10M11 15h10M11 20h6"/>',
  beto:'<path d="M5 7h22v16H15l-7 5v-5H5zM11 13h10M11 18h6"/>',
  account:'<circle cx="16" cy="10" r="6"/><path d="M4 29a12 12 0 0 1 24 0"/>',
  admin:'<path d="M16 3 27 7v8c0 7-4 11-11 14C9 26 5 22 5 15V7zM11 16l3 3 7-8"/>',
  settings:'<circle cx="16" cy="16" r="4"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M7 7l3 3M22 22l3 3M25 7l-3 3M10 22l-3 3"/>',
  audit:'<path d="M7 4h18v25H7zM11 10h10M11 16h10M11 22h6"/><circle cx="24" cy="23" r="5"/><path d="m27.5 27.5 3 3"/>',
  search:'<circle cx="14" cy="14" r="9"/><path d="m21 21 8 8"/>',
  plus:'<path d="M16 5v22M5 16h22"/>',
  arrow:'<path d="M6 16h20M19 9l7 7-7 7"/>',
  chevron:'<path d="m10 13 6 6 6-6"/>',
  edit:'<path d="m21 5 6 6L12 26l-7 1 1-7zM18 8l6 6"/>',
  eye:'<path d="M2 16s5-9 14-9 14 9 14 9-5 9-14 9S2 16 2 16z"/><circle cx="16" cy="16" r="4"/>',
  download:'<path d="M16 4v17M9 15l7 7 7-7M5 28h22"/>',
  send:'<path d="m3 15 26-11-9 25-5-10zM15 19 29 4"/>',
  copy:'<rect x="10" y="9" width="17" height="20" rx="2"/><path d="M22 9V4H5v20h5"/>',
  calendar:'<rect x="4" y="7" width="24" height="21" rx="3"/><path d="M10 3v8M22 3v8M4 13h24"/>',
  clock:'<circle cx="16" cy="16" r="13"/><path d="M16 8v9l6 3"/>',
  check:'<path d="m5 17 7 7L27 8"/>',
  warning:'<path d="m16 3 14 26H2zM16 11v8M16 24h.01"/>',
  menu:'<path d="M4 8h24M4 16h24M4 24h24"/>',
  close:'<path d="m7 7 18 18M25 7 7 25"/>',
  logout:'<path d="M13 5H5v22h8M20 9l7 7-7 7M10 16h17"/>',
  building:'<path d="M5 29V5h14v24M19 12h8v17M10 10h4M10 16h4M10 22h4M23 17h1M23 22h1M3 29h27"/>',
  filter:'<path d="M4 6h24L19 17v9l-6 3V17z"/>',
  whatsapp:'<path d="M16 3a13 13 0 0 0-11 20L3 29l6-2a13 13 0 1 0 7-24z"/><path d="M11 10c1 5 4 8 9 10l2-3"/>'
};

export function icon(name,className=''){
  return `<svg class="icon ${className}" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.warning}</svg>`;
}
