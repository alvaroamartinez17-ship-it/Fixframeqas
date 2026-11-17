# Fixframe – repair guides from video

Fixframe turns repair videos into a step-by-step guide, right on your phone:

1. **Cut** one or more videos into steps (Split here / Set start / Set end, or drag the handles on the timeline)
   and speed up slow parts (½× to 16×).
2. **Capture** frames and mark them up with arrows, info boxes with a pointer, circles, frames and numbers.
3. **Export** an MP4 video, a PDF or a Word file (.docx). (GIF and HTML exports were removed in 1.5.7.)
4. **Hand over**: create an edit file (or show it as QR codes) and send it with the video so someone else can continue editing.

**Privacy:** Your videos and project data are processed locally in this browser. Fixframe does not upload them to
its server. Files leave the app only when you choose to save, download, export or share them.
The app contacts only the website that hosts it (your GitHub Pages site), and as little as possible:
- the first visit downloads the app once; after that it starts from the offline copy;
- it looks for a new version only when you tap **Settings → Check for updates** (never by itself);
- with an invitation list it reads `access.json` when a code is entered and then only every few days
  (7 by default, set in the owner tool), when the app is opened with a connection.

It sends nothing: invitation codes and unlock codes are checked on the device. The browser itself may still look at
the small file `sw.js` now and then when the app is opened online (web apps cannot switch this off); Fixframe makes
sure such a look downloads and installs nothing.
The same statement is shown on the start screen and under Settings → Privacy; it is written once, in
`settings.js` (`TEXTS.privacy`).

**Reading and changing the app yourself:** see **`CODE-GUIDE.md`**. Since 1.7.0 the files on GitHub are the app
itself, in readable form: the screens in `index.html`, the look in `style.css`, the behaviour in the `.js` files next to it
(one file per job, each starting with a plain-language explanation), and everything you are likely to change in
`settings.js`.

## Put it on GitHub Pages

1. Create a new repository on GitHub, for example `fixframe` (public, or private with Pages enabled on your plan).
2. Upload **all files of this folder** to the repository root. Since 1.8.1 there are no sub-folders: every file sits next
   to `index.html` (the screens), `style.css` (the look), the code files (`settings.js`, `editor.js` …), the music files
   (`snd-*.m4a`), icons, fonts, `sample.mp4`, `step-bg.jpg`, `README.md` and `CODE-GUIDE.md`. On github.com:
   *Add file → Upload files*, then choose all files at once (Ctrl+A / Cmd+A in the file window). Leave an existing
   `access.json` in the repository as it is.
   If you keep the owner tool on the website for your iPhone, leave the folder `owner` as it is too.
3. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`, Save.
4. After a minute the app is live at `https://<your-user>.github.io/fixframe/`.

## Install on the phone

- **iPhone (Safari):** open the address, tap **Share → Add to Home Screen**. Start Fixframe from the
  home-screen icon. The installed app keeps its own guides, separate from Safari, so create your guides in the installed app.
- **Android (Chrome):** open the address, then **⋮ → Install app** (or *Add to Home screen*).

- **Laptop or desktop (Chrome or Edge):** open the address. Wide windows get a desktop layout: video and timeline on
  the left, steps on the right. Video files and edit files can be dropped onto the start screen. To install it as a
  window of its own, use the install icon at the right end of the address bar (or ⋮ → *Cast, save and share* →
  *Install page as app*). Guides are stored per browser and device: a guide made on the phone reaches the laptop
  through an edit file plus its videos.

After the first start the app also works offline.

## Releasing an update

1. Change the version in **two places** and keep them identical:
   - `settings.js`: `const APP_VERSION = '1.8.3';`
   - `sw.js`: `const VERSION = '1.8.3';`
2. Upload the changed files to the repository (or edit them directly on github.com, see `CODE-GUIDE.md`).
   A new code file must also be added to the list of scripts at the end of `index.html` and to the file list in
   `sw.js`.
3. In the app: **Settings (sliders icon) → Check for updates → Install update**. Nothing happens automatically:
   each phone or laptop gets the new version only when someone taps *Check for updates* there. Guides are kept during
   updates. (Phones still on 1.5.1 or older check by themselves one last time and show the *Update ready* banner.)

## Invitation codes and unlock codes (optional)

Both are switched on by one file, **`access.json`**, in the repository root next to `index.html`. The file is not part
of the app download: it comes from the private owner kit (`fixframe-owner.html`), so an app update never overwrites it.

- **No `access.json`:** the app is open to everyone, with no export limit.
- **With `access.json`:** the app asks for a personal invitation code (`FX-XXXX-XXXX`) once per device. The file holds
  only a fingerprint of each code; the place in the list is the invitation number. After 10 video exports
  the app shows a request number and asks for an 8-digit unlock code. Editing, PDF and Word guides are not
  counted.
- **Block a code / new codes / other limit:** change it in the owner tool, download the new `access.json`, upload it here
  (Add file → Upload files). Activated phones read the list again only every few days (owner tool → Settings →
  *Check the list again every … days*, 7 by default; 0 = never after activation), so a blocked code stops at the next
  check. GitHub Pages can take a few minutes to serve a new file.
- **Switch it all off:** delete `access.json` from the repository.
- Do **not** upload `fixframe-owner.html`, `fixframe-owner.json` or `invitation-codes.txt`: they contain the codes.

This is a lock for honest users, not copy protection: the app is a public web page, so someone who can program can
read how it works and get around it.

## Old videos (3GP, AVI, Motion JPEG)

Browsers no longer play the video formats of older phones and cameras. Fixframe converts these on the device into
an MP4 (H.264) when you add them; the original file is not changed and nothing is uploaded. The sound is not kept.

- **3GP / 3G2 / MP4 / MOV with H.263 or MPEG-4 Part 2** – older Android and feature phones (3GP files), early
  smartphones and cameras.
- **AVI with MPEG-4 Part 2** (Xvid / DivX, Simple Profile) and **AVI or MOV with Motion JPEG** – older digital cameras.
- Not converted (a message names the reason): MPEG-4 with B-frames or other Advanced Simple Profile features (Xvid's
  default), data partitioning, H.263+ options, WMV, FLV, MPEG-1/2. Convert those to MP4 (H.264) first, e.g. with VLC.
- 3GP files with H.264 video play directly.

## Several videos in one guide

- **New guide from video** accepts one or several videos. Each video starts as one step.
- In the editor, the row above the steps lists the guide's videos. **Add video** loads more; tap a video to show it
  in the player and timeline; tap the shown video again for details, *Save a copy* or *Remove video from guide*.
- The step list shows all steps in guide order. A small `V2` on a step's thumbnail tells which video it was cut from.
  Tapping a step shows its video. The timeline shows the steps of the video on screen.
- Exports play the steps in list order, across all videos. The "Original" frame is the shape of the first video;
  other videos are fitted into it.

## Hand over a guide (edit file)

The edit file is a small `.fixframe.json` file. It does not contain the full video. It contains project information and
a small preview image for each source video. Project information means: the videos it uses (name, size, length), every
step (video, start, end, speed, title, instructions, caution), the pictures (time in the video, caption, markup),
guide info, export settings, the name of who made it and the hand-over history.

- **Your name:** enter it once in **Settings → Your name**. It is written into the guides you start and the edit files
  you create. If it is missing, the app asks before the first edit file.
- **Send:** in the editor, **Export → Edit file** (or **Guide info → Create edit file**). The result screen lists the
  videos to send along, each with a *Save* button in case the original is no longer in your gallery.
  Send the edit file and the video file(s) any way you like.
- **Receive:** on the start screen tap **Open an edit file**, pick the `.fixframe.json`, then pick each video it lists.
  The guide is rebuilt with all cuts, texts and markup; the pictures are captured again from the video.
- **Send back:** when an edit file belongs to a guide that is already on the phone, the videos are not needed again.
  Choose **Update the guide on this phone** (replaces its steps, texts and pictures) or **Keep both**.
- **By QR code (since 1.6.0):** instead of sending the edit file, show it as QR codes. After **Export → Edit file**, tap
  **Show as QR code**. On the other phone or laptop, tap **Scan QR code** on the start screen and hold its camera
  20–40 cm in front of the codes (a longer guide shows several codes one after another; they are read in any order).
  Works between any phones and laptops with a camera, in both directions, also offline. The codes hold the edit data
  without the preview pictures, compressed; the videos still have to be sent separately and are chosen on the other
  device as with an edit file. The camera picture is read in the browser to find the code. Fixframe reads the codes
  itself (no extra library); where the browser has its own QR reader (Chrome on Android and Mac), that is used first.
- **Guide info → History** shows who started the guide and who made or opened edit files.
- The brand kit (logo, card background, intro, safety and closing videos) is a setting of each phone and is not part of
  the edit file.

## Export design (Settings → Open brand settings → Export design)

Videos, PDF and Word guides share one product-page look: near-black stage (#0D0D0D), white type,
the repair shown on a grey stage, small upper-case
labels above large headlines, picture cards for all steps, a contact block and a footer with company and copyright.
The app's own screens keep their orange look.

- **Language:** English or Deutsch for all labels in the exports (Step/Schritt, Caution/Achtung, Page/Seite …).
  Your own texts are not translated.
- **Card background:** Black (standard) or Picture (the map picture `step-bg.jpg`, or your own, grey and darkened).
- **PDF pages:** Light (for printing) or Dark. The PDF cover is always black.
- **Company name, claim, contact and address:** used on the covers, in the contact block and the footers
  ("© 2026 Company - Alle Rechte vorbehalten.").
- **Font for exports:** Noto Sans SemiCondensed (brand font, included, SIL Open Font License, see `Noto-OFL.txt`; a few symbols from Inter, `Inter-OFL.txt`) or your brand font: load its
  .ttf or .otf files (regular and bold). It is drawn on video cards and embedded in PDF and Word (.ttf only)
  files. Fonts whose licence forbids embedding are used for videos only. Check your font licence before loading it.

## Brand & safety (Settings → Open brand settings)

- **Logo watermark:** load your logo (PNG with transparent background works best); choose corner, size and opacity.
- **Background picture for cards:** the title, safety and step cards use `step-bg.jpg`, shown grey and darkened.
  Load your own picture in the app, or replace `step-bg.jpg` in the repository to change the standard one.
- **Brand intro, safety instructions (text and/or a video or picture), closing:** stored once, used in every guide.
  Each can be a video (old formats are converted) or a picture shown for 3, 5, 8 or 10 seconds: JPEG, PNG, WebP, AVIF,
  GIF, BMP, SVG, TIFF, and HEIC where the browser can read it (Safari; on iPhone, pictures from Photos are converted
  automatically). Each part can be switched on or off on the export screen.

## Add sound (music under the video)
On the export screen, video format: switch on **Add sound (music)**, choose a **Sound style** (Standard, Jazz, Lo-fi, and any sound
packs made in the Fixsound app on the same web address) and, if wanted, **Short tone at each step**. After the video is made,
the music is laid under it, following the parts of the guide: presentation (brand intro + title card), safety (with an attention
tone at its start), steps, closing; it fades out at the end. The picture is not changed. The sound is mixed on the device; the
music files (`snd-*.m4a`, about 3 MB) are kept offline with the app. Spoken text is not part of it yet.
Sound needs a browser that can write sound (WebCodecs AudioEncoder: current Chrome/Edge, recent Safari). Where it cannot, the
video is made without sound and a message says so. Chrome without an AAC encoder writes the sound as Opus.

## Reset

**Settings → Delete all guides and reset** removes every guide, video and picture, your name and brand settings,
the stored invitation and export counter, plus the offline copy of the app. To remove the icon as well, touch and hold it and choose *Remove App* (iPhone)
or *Uninstall* (Android).

## Good to know

- Exported videos are silent.
- MP4 export uses the device's video encoder (iOS 16.4+ / current Chrome on Android, Chrome or Edge on a computer).
  Since 1.5.1 the frames of MP4, MOV and WebM-in-MP4 files are decoded in order (WebCodecs) instead of seeking the
  video for every frame, so rendering takes roughly as long as the finished video. Fragmented MP4s and formats the
  decoder does not offer (for example HEVC in some browsers) still use the slower way.
- 1.5.6 fixes video parts that stood still in exports of QuickTime-style videos (iPhone and many camera .MOV files):
  their frame-order table was misread. The fast way now also checks the time of every frame it hands out and switches
  to the careful way if a frame comes from the wrong moment.
- Before the fast way is used for a video, Fixframe compares two of its pictures with the browser's own video player
  on that device (since 1.5.5). If they differ, or the decoder stops answering, that video is read the careful way
  (seeking, slower) and a short message says so. The export option **Fast rendering** switches the fast way off
  completely.
- While a video renders, the export screen shows a looping animation (chainsaw, car, downhill bike, coffee machine).
  It is drawn inside `index.html` (look for "waiting animation"), so nothing extra is loaded for it.
- Keep Fixframe open and in front until an export finishes. Browsers slow down pages in background tabs and
  minimised windows, and the screen should stay on.
- Fixframe keeps its own copy of each video in the browser's storage. Delete guides you no longer need to free space;
  your original video files are not touched.
- Guides made with earlier versions keep working; they are converted when opened.
- Keyboard shortcuts on a computer: Space play/pause, ←/→ one frame (Shift: one second), S split, I start, O end, P picture.
