# Fixframe code guide (for people who don't program)

This guide explains how Fixframe is put together, which file does what, and how to change things safely.
You can read and edit every file directly on github.com: there is no build step, so what is in the repository
is exactly what runs on the phones and laptops.

## The app in one minute

A web app is made of three kinds of files:

| Kind | File(s) | What it is |
| --- | --- | --- |
| The screens | `index.html` | All screens and buttons, written as HTML: `<button id="btn-new">New guide from video</button>`. |
| The look | `style.css` | Colours, sizes, spacing, the phone and desktop layouts. |
| The behaviour | the other `.js` files | JavaScript: what happens when you tap a button, how videos are cut, how a PDF is written … |

`index.html` loads the code files in a fixed order, listed at its end: `settings.js` first, `start.js` last.

Other files in the repository:

| File | What it is |
| --- | --- |
| `sw.js` | The "service worker": keeps a copy of the app on the device so it works offline, and installs updates only when someone taps *Check for updates*. It also holds the version number and the list of files to keep offline. |
| `manifest.webmanifest` | Name, icon and colours used when the app is installed on a home screen. |
| `sample.mp4`, `step-bg.jpg` | The demo clip of the Sample guide and the card background picture. |
| `snd-*.m4a` | The built-in music and the two tones for *Add sound* (from the Fixsound app, about 3 MB). |
| `fx-font-*.ttf`, `Noto-OFL.txt`, `Inter-OFL.txt` | The export font (Noto Sans SemiCondensed, a few symbols from Inter) and the licences. |
| `icon-*.png`, `apple-touch-icon.png`, `favicon-64.png` | App icons. |
| `access.json` | Only if you use invitation codes; made by your owner tool. Never edit it by hand. |
| `owner/` | Only if you put the owner tool on the website for your iPhone. Contains no codes. |
| `README.md` | How to install, use and publish Fixframe. |

## Where to change what

**Start with `settings.js`.** It collects what you are most likely to change, with a note above each part:

- the version number,
- the privacy text and the edit-file text,
- the speeds a step can have (½×, 1×, 2× …),
- how long brand pictures are shown,
- QR code size and speed,
- *Add sound*: the style picked first, the tone at the safety part, how loud the tones are,
- the export formats, their starting options and the option texts on the export screen,
- the brand look of the exported videos, PDFs and Word files: colours (`XT`), text sizes, margins and the 70/30 split
  of the video (`XV`), and the words in English and German (`XSTR`).

Everything else, with how safe it is to touch:

- **Easy:** safe to change texts.
- **Medium:** change texts and values, not the structure.
- **Engine:** better leave it as it is.

| Code file | What it does | Level |
| --- | --- | --- |
| `settings.js` | The values above. | Easy |
| `start-screen.js` | Start screen (guide list) and the Settings sheet. | Easy |
| `export-screen.js` | Export screen: format buttons, progress, result with Save/Share. | Easy |
| `sound-export.js` | *Add sound*: works out where presentation, safety, steps and closing are, and puts the music under the finished video. | Medium |
| `picture-editor.js` | Full-screen markup editor; hint texts at the top (`PE_HINTS`). | Easy |
| `sample-guide.js` | The Sample guide made on the first start. | Easy |
| `editor.js` | The editor: player, steps and their buttons, guide info, several videos, undo. | Medium |
| `timeline.js` | Film strip with the step blocks and their handles. | Medium |
| `markup-shapes.js` | How arrows, boxes, circles, frames and numbers are drawn; the 7 colours (`ANN_COLORS`). | Medium |
| `brand-settings.js` | Brand & safety screen; default language and card background. | Medium |
| `video-render.js` | Paints every frame of the exported video: cards, captions, speed badge, pictures, logo. | Medium |
| `pdf-export.js` | Writes the PDF guide. | Medium |
| `word-export.js` | Writes the Word guide. | Medium |
| `document-data.js` | Collects pictures and texts for PDF and Word. | Medium |
| `export-look.js` | Small helpers for the export look (dates, "Step 3 / 12", copyright line). | Medium |
| `hand-over.js` | Saving and sharing files, your name, opening an edit file. | Medium |
| `qr-transfer.js` | The screens that show and scan QR codes. | Medium |
| `invitation.js` | Invitation screen, export counter, unlock code screen. | Medium |
| `guide-data.js` | What a guide consists of; history. | Medium |
| `icons.js` | The small button drawings. | Medium |
| `helpers.js` | Small tools used everywhere (dialogs, messages, buttons). | Medium |
| `start.js` | Starts the app and connects the buttons to what they do. | Medium |
| `codes.js` | The maths of invitation and unlock codes, shared with the owner tool. **Do not change.** | Engine |
| `edit-file.js` | Reads and writes edit files. | Engine |
| `qr-engine.js` | Makes and reads QR codes. | Engine |
| `fast-video-reader.js` | Reads video frames quickly for the export, with a self-check. | Engine |
| `mp4-writer.js` | Makes the MP4 file. | Engine |
| `fixsound-core.js` | The Fixsound app's sound engine, taken over unchanged: music, styles, sound packs, mix, sound writer. Volumes per style in `STYLES`. | Engine |
| `recorder-fallback.js` | Plan B for browsers without an MP4 writer. | Engine |
| `video-files.js` | Opens videos in the background, jumps to frames, takes stills. | Engine |
| `old-video-converter.js`, `old-video-tables.js` | Converts old 3GP / AVI / Motion JPEG videos. | Engine |
| `pictures.js` | Opens pictures in every format, including TIFF. | Engine |
| `export-font.js`, `pdf-font-metrics.js` | Fonts inside PDF and Word files. | Engine |
| `storage.js` | Saves guides on the device. Changes can lose people's guides. | Engine |
| `updates.js` | Offline copy and *Check for updates*. | Engine |

Every code file starts with a box that says the same in a few lines: what it does, what you might change, and how
careful to be.

## Reading JavaScript: the ten things you will see

| You see | It means |
| --- | --- |
| `// some words` or `/* some words */` | A note for people. The app ignores it. |
| `'Text'` or `"Text"` or `` `Text` `` | A text. Change what is between the quote marks, keep the marks. |
| `` `Step ${n} of ${total}` `` | A text with numbers filled in. Keep the `${…}` parts. |
| `const SPEEDS = [0.5, 1, 2];` | A named value; here a list in square brackets. |
| `{ name: 'PDF', icon: 'pdf' }` | A group of named values in curly brackets. Keep the commas between them. |
| `true` / `false` | On / off. |
| `function drawStepCard(…) { … }` | A piece of behaviour with a name. Everything between `{` and `}` belongs to it. |
| `h('button', { id: 'ex-qr' }, 'Show as QR code')` | Makes a button (or other element) with that text. |
| `$('#ex-go')` | Finds the element with `id="ex-go"` in `index.html`. |
| `toast('Export stopped')` | Shows a short message at the bottom of the screen. |

Most texts you see in the app can be found by searching the repository for them (the search box at the top of
GitHub, or `.` on github.com to open the file editor and search across all files).

## Changing something safely

### Best: try it in a test copy first

Create a second repository, for example `fixframe-test`, switch on GitHub Pages for it (as in README.md), and upload
the same files. Try your change there at `https://<your-name>.github.io/fixframe-test/`. Only when it works, make the
same change in the real repository. The test copy has its own guides and no invitation list (do not copy
`access.json` there, unless you want to test the invitations).

### Edit a file on github.com

1. Open the file, click the pencil (*Edit this file*).
2. Make the change. Keep quote marks, commas and brackets as they were.
3. Click *Commit changes…* and write a short note, for example "Privacy text shorter".

### Publish the change to the devices

1. Raise the version in **both** places, to the same number, for example from `1.8.2` to `1.8.3`:
   - `settings.js`: `const APP_VERSION = '1.8.3';`
   - `sw.js`: `const VERSION = '1.8.3';`
2. Wait 1–3 minutes until GitHub Pages has published it.
3. On each phone or laptop: **Settings → Check for updates → Install update**.

Without a new version number the devices keep the old copy, even though GitHub shows the new file.

### Added a new code file?

Add it in two places, otherwise it is not loaded or not kept offline:

- at the end of `index.html`: `<script src="my-file.js"></script>` (before `start.js`);
- in `sw.js`, in the file list between `FILES-START` and `FILES-END`: `'./my-file.js',`.

### If something goes wrong

- **Blank screen or a button does nothing:** usually a missing quote mark or comma. Open the browser's developer
  tools on a laptop (Chrome: `F12` → *Console*). The red line names the file and the line number.
- **Undo:** on github.com, open the file → *History* → open the version before your change → copy its text back into
  the file. Then raise the version again so the devices update.
- **Guides are never lost by a code change on GitHub:** they live on each device. Only `storage.js` and
  `edit-file.js` handle them, so leave those two alone.

## Examples

| You want to … | Change this |
| --- | --- |
| Shorten the privacy text | `settings.js` → `TEXTS.privacy` |
| Rename a button on the start screen | `index.html`, search for the button text |
| Make the app's orange darker | `style.css` → `--marker` (and `--marker-press` for the pressed look) |
| Change the black of the exported cards | `settings.js` → `XT.black` |
| Bigger step titles in the video | `settings.js` → `XV.stepTitle: 42` |
| More room for the step text (35 %) | `settings.js` → `XV.panel: 0.35` |
| Allow four lines per text block | `settings.js` → `XV.maxLines: 4` |
| Change "Repair guide" / "Reparaturanleitung" on exports | `settings.js` → `XSTR.en.guide` / `XSTR.de.guide` |
| Start every video export in 1080p | `settings.js` → `EX_DEFAULTS.mp4.res: '1080'` (new guides; existing guides keep their choice) |
| Offer 3× speed | `settings.js` → add `3` to `SPEEDS` (a device with an older version reads a 3× step as 1×) |
| Show brand pictures for 6 seconds as a choice | `settings.js` → add `6` to `PICTURE_SHOW_SECONDS` |
| Slower QR code changes | `settings.js` → `QR_SETTINGS.secondsPerCode: 1.5` |
| Other markup colours | `markup-shapes.js` → `ANN_COLORS` (now the brand colours) |
| Different hints in the picture editor | `picture-editor.js` → `PE_HINTS` |
| Start every video export with sound | `settings.js` → `EX_DEFAULTS.mp4.sound: true` (new guides) |
| No tone at the start of the safety part | `settings.js` → `SOUND.attentionTone: false` |
| Quieter tones | `settings.js` → `SOUND.toneVolume: 0.5` |
| Quieter Jazz music | `fixsound-core.js` → `STYLES`, the number after `'b:jazz1'` (0.65 now) |
| Change the number of free video exports | Not in the code: owner tool → Settings → limit, then upload the new `access.json` |
| Change the waiting animation | `index.html`, search for "waiting animation". It is one drawing with its own animation; easiest is to ask for a new one to be built in. |

## What stays outside the repository

The tests and the build helpers (they check every version before it is handed to you) are kept with the project
and are not needed on GitHub. The owner kit (invitation codes, owner tool with codes) is private and never goes
to GitHub.
