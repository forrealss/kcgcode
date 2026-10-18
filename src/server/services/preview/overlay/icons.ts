/** Ikon SVG (garis, gaya Lucide) — string agar bisa dipasang lewat `innerHTML`. */
export const ICON = {
  logo: `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M14 74V44c0-8 2-15 6-21L31 9l8 15c3.5-1.2 7.2-2 11-2s7.5.8 11 2l8-15 11 14c4 6 6 13 6 21v18c0 14-10 24-24 24H38c-11 0-19-5-22-12" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34" cy="52" r="6" fill="currentColor"/><circle cx="66" cy="52" r="6" fill="currentColor"/></svg>`,
  desktop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>`,
  select: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.03 12.68a.5.5 0 0 1 .65-.65l9 3.5a.5.5 0 0 1-.03.94l-3.45 1.07a1 1 0 0 0-.66.66l-1.07 3.44a.5.5 0 0 1-.94.03z"/><path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M5 21a2 2 0 0 1-2-2M9 3h1M9 21h2M14 3h1M3 9v1M21 9v2M3 14v1"/></svg>`,
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`,
  code: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/></svg>`,
  image: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
} as const;
