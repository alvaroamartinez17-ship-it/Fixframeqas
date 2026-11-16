/* ============================================================================================================
   FIXFRAME SETTINGS — the file to change first.
   ------------------------------------------------------------------------------------------------------------
   Everything here is plain values: texts in 'quotes', numbers, lists in [square brackets], groups in {curly brackets}.
   Change the value, keep the quotes, commas and brackets as they are. Lines starting with // are notes for people;
   the app ignores them. After a change: also change the version (see the first value), then upload the file.
   If something goes wrong, the app usually shows an empty screen: undo the last change (GitHub keeps every old version).
   ============================================================================================================ */

/* ---- Version ---------------------------------------------------------------------------------------------------
   Shown in Settings. Raise it with every change you publish, AND write the same number in sw.js (line 2),
   otherwise phones and laptops will not see the change when you tap "Check for updates". */
const APP_VERSION = '1.8.1';

/* ---- Fixed texts -----------------------------------------------------------------------------------------------
   privacy:  shown on the start screen and under Settings → Privacy. Keep it true: it describes what the app does.
   editFile: explains the edit file (export screen, guide info, and inside the file itself). */
const TEXTS = {
  privacy: "Your videos and project data are processed locally in this browser. Fixframe does not upload them to its server. Files leave the app only when you choose to save, download, export or share them.",
  editFile: "It does not contain the full video. It contains project information and a small preview image for each source video.",
};

/* ---- Speeds a step can have -------------------------------------------------------------------------------------
   0.5 = half speed (slow motion), 1 = normal, 2 = twice as fast … Shown as buttons on each step. */
const SPEEDS = [0.5, 1, 2, 4, 8, 16];

/* ---- How long a brand picture is shown (brand intro, safety picture, closing), in seconds ----------------------- */
const PICTURE_SHOW_SECONDS = [3, 5, 8, 10];

/* ---- Edit data as QR code ---------------------------------------------------------------------------------------
   bytesPerCode:   how much data goes into one code. Smaller = more codes but each easier to scan.
                   220 keeps a code at 61 × 61 squares. Do not go above 400.
   secondsPerCode: how long each code is shown before the next one. */
const QR_SETTINGS = {
  bytesPerCode: 220,
  secondsPerCode: 0.9,
};

/* ---- Export formats ----------------------------------------------------------------------------------------------
   The formats on the export screen, in this order. id must stay as it is; name and desc are the texts shown. */
const FORMATS = [
  { id: 'mp4', name: 'Video (MP4)', icon: 'film', desc: 'Title cards, step captions and speed-ups' },
  { id: 'pdf', name: 'PDF', icon: 'pdf', desc: 'Printable guide' },
  { id: 'docx', name: 'Word', icon: 'word', desc: 'Editable .docx' },
  { id: 'edit', name: 'Edit file', icon: 'editfile', desc: 'Hand over to continue editing. Goes with the video, not instead of it.' },
];

/* ---- Sound for the video export ("Add sound", from the Fixsound app) -------------------------------------------
   startStyle:    the style picked first: 'standard', 'jazz' or 'lofi' (sound packs made in Fixsound are offered too).
   attentionTone: true = a tone at the start of the safety part, false = none.
   toneVolume:    loudness of the tones: 1 = normal, 0.5 = half, 2 = double.
   pieceSeconds:  the sound is mixed in pieces of this many seconds; smaller uses less memory on phones.
   The music pieces, their volumes per part and the style names are in fixsound-core.js (STYLES). */
const SOUND = {
  startStyle: 'standard',
  attentionTone: true,
  toneVolume: 1,
  pieceSeconds: 30,
};

/* ---- Starting options of each export format ---------------------------------------------------------------------
   What is switched on when a guide is exported for the first time (each guide then remembers its own choice).
   true = on, false = off. res: 480, 720 or 1080. aspect: 'source', '16:9', '9:16' or '1:1'. paper: 'a4' or 'letter'.
   sound: true = "Add sound" is already on; stepTone: true = the short tone at each step is on. */
const EX_DEFAULTS = {
  fmt: 'mp4',
  mp4: { res: '720', aspect: 'source', fps: '30', intro: true, stepCards: true, captions: true, pictures: true, picDur: '3', fades: true, brandIntro: true, safety: true, brandOutro: true, watermark: true, fast: true, sound: false, soundStyle: SOUND.startStyle, stepTone: false },
  pdf: { paper: 'a4', autoPictures: true, safety: true, watermark: true },
  docx: { paper: 'a4', autoPictures: true, safety: true, watermark: true },
};

/* ---- Options shown on the export screen --------------------------------------------------------------------------
   k = the option's inner name (do not change), label = the text shown, seg = the choices as [value, text shown],
   need = only shown when that brand item exists, dep = only shown when that other option is on. */
const EX_SCHEMA = {
  mp4: [
    { k: 'res', label: 'Quality', seg: [['480', '480p'], ['720', '720p'], ['1080', '1080p']] },
    { k: 'aspect', label: 'Frame', seg: [['source', 'Original'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']] },
    { k: 'fps', label: 'Frames per second', seg: [['24', '24'], ['30', '30']] },
    { k: 'intro', label: 'Title card at the start' },
    { k: 'stepCards', label: 'Card before each step' },
    { k: 'captions', label: 'Step title and speed on video' },
    { k: 'pictures', label: 'Show marked-up pictures' },
    { k: 'picDur', label: 'Seconds per picture', seg: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], dep: 'pictures' },
    { k: 'fades', label: 'Fade between parts' },
    { k: 'brandIntro', label: 'Brand intro', need: 'intro' },
    { k: 'safety', label: 'Safety instructions', need: 'safety' },
    { k: 'brandOutro', label: 'Closing', need: 'outro' },
    { k: 'watermark', label: 'Logo watermark', need: 'logo' },
    { k: 'fast', label: 'Fast rendering' },
    { k: 'sound', label: 'Add sound (music)' },
    { k: 'soundStyle', label: 'Sound style', seg: () => soundStyleChoices(), dep: 'sound' },
    { k: 'stepTone', label: 'Short tone at each step', dep: 'sound' },
  ],
  pdf: [
    { k: 'paper', label: 'Paper', seg: [['a4', 'A4'], ['letter', 'Letter']] },
    { k: 'autoPictures', label: 'Add a frame to steps without pictures' },
    { k: 'safety', label: 'Safety instructions', need: 'safetyText' },
    { k: 'watermark', label: 'Logo on pictures', need: 'logo' },
  ],
  docx: [
    { k: 'paper', label: 'Paper', seg: [['a4', 'A4'], ['letter', 'Letter']] },
    { k: 'autoPictures', label: 'Add a frame to steps without pictures' },
    { k: 'safety', label: 'Safety instructions', need: 'safetyText' },
    { k: 'watermark', label: 'Logo on pictures', need: 'logo' },
  ],
  edit: [],
};

/* ---- Look of the exports (video cards, PDF, Word) ----------------------------------------------------------------
   Colours as #RRGGBB. The app's own colours (orange etc.) are at the top of style.css. */
const XT = {
  black: '#0D0D0D', panel: '#161616', stage: '#262626', line: '#2E2E2E',
  white: '#FFFFFF', grey1: '#C2C2C2', grey2: '#8F8F8F', grey3: '#5E5E5E',
  // light pages for printing
  paper: '#FFFFFF', ink: '#0D0D0D', ink2: '#4D4D4D', ink3: '#7A7A7A', rule: '#D9D9D9', wash: '#F2F2F2', stageLight: '#E6E6E6',
  // safety notes keep a signal colour
  caution: '#FFC83D', cautionDeep: '#C79100', cautionBg: '#FFF6D9', cautionInk: '#4A3700', cautionBgDark: '#2A2410',
};

/* ---- Words used in the exports, English and German --------------------------------------------------------------
   Only change the text between the quotes. Lines like  steps: (n) => …  build a text from a number; change the
   words inside, not the symbols. */
const XSTR = {
  en: {
    lang: 'en', locale: 'en-GB',
    guide: 'Repair guide', step: 'Step', of: 'of',
    steps: (n) => (n === 1 ? '1 step' : `${n} steps`),
    safetyKicker: 'Safety', safety: 'Safety instructions', caution: 'Caution',
    tools: 'Tools and parts', overview: 'All steps', toStep: 'Go to step', intro: 'Before you start',
    page: (i, n) => `Page ${i} of ${n}`,
    fast: (s) => `${s} speed`, slow: (s) => `${s} slow motion`,
    madeBy: 'Made by', created: 'Created', contact: 'Contact', company: 'Company', guideInfo: 'This guide',
    ask: 'Questions about this repair?', rights: (y, c) => `© ${y} ${c}. All rights reserved.`,
    video: 'Video', picture: 'Picture', length: 'Length',
  },
  de: {
    lang: 'de', locale: 'de-DE',
    guide: 'Reparaturanleitung', step: 'Schritt', of: 'von',
    steps: (n) => (n === 1 ? '1 Schritt' : `${n} Schritte`),
    safetyKicker: 'Sicherheit', safety: 'Sicherheitshinweise', caution: 'Achtung',
    tools: 'Werkzeug und Material', overview: 'Alle Schritte', toStep: 'Zum Schritt', intro: 'Bevor Sie beginnen',
    page: (i, n) => `Seite ${i} von ${n}`,
    fast: (s) => `${s} Zeitraffer`, slow: (s) => `${s} Zeitlupe`,
    madeBy: 'Erstellt von', created: 'Erstellt am', contact: 'Kontakt', company: 'Unternehmen', guideInfo: 'Diese Anleitung',
    ask: 'Fragen zu dieser Reparatur?', rights: (y, c) => `© ${y} ${c} - Alle Rechte vorbehalten.`,
    video: 'Video', picture: 'Bild', length: 'Länge',
  },
};
