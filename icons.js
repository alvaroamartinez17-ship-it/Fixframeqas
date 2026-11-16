/* ============================================================================================================
   icons.js
   What it does:    The little line drawings on buttons (play, scissors, camera, QR …), each as a tiny SVG drawing.
   Change here:     Add or redraw an icon. Each icon is one line: name: s('…drawing…').
   Edit with care: change texts and values, not the structure.
   ============================================================================================================ */
const ICONS = (() => {
  const s = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  const t = (txt, y, fs) => `<text x="12" y="${y}" text-anchor="middle" font-size="${fs}" font-weight="800" font-family="system-ui,-apple-system,Roboto,sans-serif" fill="currentColor" stroke="none">${txt}</text>`;
  const page = '<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/>';
  return {
    back: s('<path d="M15 18l-6-6 6-6"/>'),
    settings: s('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    x: s('<path d="M6 6l12 12M18 6L6 18"/>'),
    check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    lock: s('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>'),
    play: s('<path d="M8 5.6v12.8a.7.7 0 0 0 1.06.6l10.2-6.4a.7.7 0 0 0 0-1.2L9.06 5a.7.7 0 0 0-1.06.6z" fill="currentColor" stroke="none"/>'),
    pause: s('<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>'),
    prevf: s('<path d="M7 6v12"/><path d="M17.5 6.6L10.5 12l7 5.4z" fill="currentColor"/>'),
    nextf: s('<path d="M17 6v12"/><path d="M6.5 6.6l7 5.4-7 5.4z" fill="currentColor"/>'),
    back1: s('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V9h4.5"/>' + t('1', 15.6, 8)),
    fwd1: s('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V9h-4.5"/>' + t('1', 15.6, 8)),
    split: s('<circle cx="6" cy="6.5" r="2.7"/><circle cx="6" cy="17.5" r="2.7"/><path d="M8.3 8L20 18.5M8.3 16L20 5.5"/>'),
    setstart: s('<path d="M9 4H5.5v16H9"/><path d="M12.5 12H20M16.5 8.5L20 12l-3.5 3.5"/>'),
    setend: s('<path d="M15 4h3.5v16H15"/><path d="M4 12h7.5M8 8.5l3.5 3.5L8 15.5"/>'),
    camera: s('<path d="M3.5 8.8A2.3 2.3 0 0 1 5.8 6.5h1.9l1.6-2.2h5.4l1.6 2.2h1.9a2.3 2.3 0 0 1 2.3 2.3v8.9a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3z"/><circle cx="12" cy="13" r="3.6"/>'),
    share: s('<path d="M12 3.5v11.5"/><path d="M7.8 7.7L12 3.5l4.2 4.2"/><path d="M5 11.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7.5"/>'),
    download: s('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>'),
    undo: s('<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10.5a5 5 0 0 1 0 10H11"/>'),
    redo: s('<path d="M15 14.5l5-5-5-5"/><path d="M20 9.5H9.5a5 5 0 0 0 0 10H13"/>'),
    trash: s('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.2A1.5 1.5 0 0 0 9 20.5h6a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/><path d="M10 11v5.5M14 11v5.5"/>'),
    up: s('<path d="M12 19V5.5"/><path d="M6.5 11L12 5.5 17.5 11"/>'),
    down: s('<path d="M12 5v13.5"/><path d="M6.5 13L12 18.5 17.5 13"/>'),
    select: s('<path d="M6 3.5l12 7-5.3 1.6-2.4 5.4z" fill="currentColor" fill-opacity=".2"/><path d="M12.7 12.1l4.8 6.1"/>'),
    arrow: s('<path d="M5 19L18.5 5.5"/><path d="M9.5 5.5h9v9"/>'),
    box: s('<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M8 16.5L7 20.5l5-4"/><path d="M7 9h10M7 12.2h6"/>'),
    ellipse: s('<ellipse cx="12" cy="12" rx="8.5" ry="6.8"/>'),
    rect: s('<rect x="3.5" y="6" width="17" height="12" rx="2"/>'),
    num: s('<circle cx="12" cy="12" r="8.5"/>' + t('1', 15.8, 10)),
    edit: s('<path d="M4 20h4.2L19 9.2 14.8 5 4 15.8z"/><path d="M12.8 7l4.2 4.2"/>'),
    zoomin: s('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8M7.5 10.5h6M10.5 7.5v6"/>'),
    zoomout: s('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8M7.5 10.5h6"/>'),
    film: s('<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 4v16M16.5 4v16M3.5 8.5h4M3.5 12h4M3.5 15.5h4M16.5 8.5h4M16.5 12h4M16.5 15.5h4"/>'),
    pdf: s(page + t('PDF', 17.4, 5.4)),
    word: s(page + t('W', 17.6, 6.6)),
    html: s('<path d="M8 7.5L3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.6 5.5l-3.2 13"/>'),
    more: s('<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
    qr: s('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18v2M17.5 17.5h2.5v2.5"/>'),
    editfile: s(page + '<path d="M9 12.6h6M13.3 10.8l1.8 1.8-1.8 1.8"/><path d="M15 16.8H9M10.7 15L8.9 16.8l1.8 1.8"/>'),
    info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/>'),
    caution: s('<path d="M12 3.8L2.8 19.8h18.4z"/><path d="M12 10v4.5M12 17v.3"/>'),
    refresh: s('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v5h-5"/>'),
    image: s('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8"/>'),
  };
})();
