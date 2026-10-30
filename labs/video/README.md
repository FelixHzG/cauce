# cauce. labs — video demo

Live: https://guadalajara.vsfelix.com/labs/video/ · file: `cauce-labs.mp4` (2 min 10 s, 1920×1080, 30 fps, H.264 High,
faststart, no audio, 52.3 MB, 2-pass 3.2 Mbit/s) · `poster.jpg` · `cauce-labs-vertical.mp4` (34.8 s, 1080×1920, 23 MB) · agent: `video`.

A short montage of the cauce. labs prototypes. **Every moving image is the real interface of a prototype**, rendered
frame by frame on W10's GPU through each prototype's own demo hook (`window.__cauceDemo.seek(t)`). Nothing was screen
recorded, retimed by interpolation, drawn over or mocked up. The only added graphics are the title, section and end cards
and the lower-third captions, which are HTML pages rendered on W10 with the same Chromium.

## Structure

Start times are where each shot begins to fade in (the page jumps 0.4 s later, after the crossfade).

| start | length | shot | source |
|---|---|---|---|
| 0:00.0 | 4.5 s | cold | `sim-hidro` demo t 6.5–11 s · caption `lt-cold.png` |
| 0:04.0 | 3.4 s | title | card (gfx.html) |
| 0:07.0 | 2.1 s | sec-terreno | section card over a blurred first frame of the next shot |
| 0:08.7 | 4.0 s | terrain-a | `terrain-check` demo t 0.5–4.5 s · caption `lt-terreno.png` |
| 0:12.3 | 5.6 s | terrain-b | `terrain-check` demo t 6–11.6 s |
| 0:17.4 | 4.5 s | relieve-a | `sim-relieve` demo t 0.2–4.7 s |
| 0:21.5 | 2.1 s | sec-agua | section card over a blurred first frame of the next shot |
| 0:23.2 | 6.0 s | relieve-b | `sim-relieve` demo t 20–26 s · caption `lt-relieve.png` |
| 0:28.8 | 8.0 s | hidro-a | `sim-hidro` demo t 3–15 s at 1.5× · caption `lt-hidro.png` |
| 0:36.5 | 3.5 s | hidro-b | `sim-hidro` demo t 15.2–18.7 s |
| 0:39.6 | 4.6 s | hidro-c | `sim-hidro` demo t 21.4–26 s |
| 0:43.8 | 8.0 s | drenaje-a | `sim-drenaje` demo t 6–14 s · caption `lt-drenaje.png` |
| 0:51.5 | 4.0 s | drenaje-b | `sim-drenaje` demo t 18.4–22.4 s |
| 0:55.0 | 2.1 s | sec-nav | section card over a blurred first frame of the next shot |
| 0:56.8 | 6.0 s | mochi-a | `nav-mochi` demo t 6.8–12.8 s · caption `lt-mochi.png` |
| 1:02.5 | 3.2 s | mochi-b | `nav-mochi` demo t 24.8–28 s |
| 1:05.3 | 6.0 s | papel-a | `nav-papel` demo t 6.4–12.4 s, captured at 15 fps · caption `lt-papel.png` |
| 1:11.0 | 2.4 s | papel-b | `nav-papel` demo t 23.6–26 s, captured at 15 fps |
| 1:13.0 | 6.0 s | juguete-a | `nav-juguete` demo t 8.8–14.8 s · caption `lt-juguete.png` |
| 1:18.7 | 3.5 s | juguete-b | `nav-juguete` demo t 26.5–30 s |
| 1:21.8 | 6.0 s | neon-a | `nav-neon` demo t 9.6–15.6 s · caption `lt-neon.png` |
| 1:27.5 | 3.2 s | neon-b | `nav-neon` demo t 21.8–25 s |
| 1:30.3 | 6.0 s | pixel-a | `nav-pixel` demo t 7.4–13.4 s · caption `lt-pixel.png` |
| 1:36.0 | 3.0 s | pixel-b | `nav-pixel` demo t 23–26 s |
| 1:38.5 | 2.1 s | sec-inv | section card over a blurred first frame of the next shot |
| 1:40.3 | 4.5 s | inv1-a | `invertir-1` demo t 0.8–5.3 s · caption `lt-inv1.png` |
| 1:44.5 | 4.5 s | inv1-b | `invertir-1` demo t 18–22.5 s |
| 1:48.5 | 3.9 s | inv2-a | `invertir-2` demo t 9.4–13.3 s · caption `lt-inv2.png` |
| 1:52.2 | 4.7 s | inv2-b | `invertir-2` demo t 22.9–27.6 s |
| 1:56.5 | 6.0 s | inv3-a | `invertir-3` demo t 1–7 s · caption `lt-inv3.png` |
| 2:02.2 | 3.2 s | inv3-b | `invertir-3` demo t 21.8–25 s |
| 2:04.8 | 5.5 s | end | card (gfx.html) |

## How it was made

1. **Capture** (`work/video/w10/cap.mjs`, W10 `C:\Users\Felip\contorno-compute\labs\video\`): headless Chromium 1217
   (`--use-angle=d3d11 --enable-gpu --enable-unsafe-webgpu`) via `playwright-core`, one persistent profile per worker so
   tiles stay in the HTTP cache, three workers sharing a job queue (exclusive `.claim` files). Each job opens the
   prototype in demo mode with autoplay off (`&capture=1`, `&still=1`, `&autoplay=0`, `&t=0` depending on the
   prototype's README), waits for `__cauceDemo` (and its `ready` promise), then for every frame calls
   `seek(t)` inside `page.evaluate`, waits one more `requestAnimationFrame` (the MapLibre gotcha in the brief) and takes
   a JPEG screenshot (q93). Frame times are `t0 + i·speed/30`. Jobs are resumable (existing frames are skipped).
2. **Windows** (`work/video/clips.mjs`): demo-time windows picked from still sweeps of every prototype. All shots run at
   1× demo time except the sim-hidro storm (1.5×). nav-papel is the only clip captured at 15 fps (frames duplicated to 30 fps, no interpolation): its `seek()` waits up to 12 s for every hazard raster tile, and with the 29 layers now in `hazard/index.json` many frames hit that timeout (~7 s per frame).
3. **Graphics** (`w10/gfx.html` + `gfx.mjs`): one page with modes `title`, `section`, `end`, `lower`; Manrope 800 for
   the `cauce.` mark and titles, DM Sans for text, cyan `#72eee2` accents (same as the production atlas). Lower thirds are
   transparent PNGs placed per prototype so they do not cover its own alerts and HUD. Section cards sit on a blurred,
   darkened copy of the first frame of the next shot.
4. **Edit** (`w10/edit.mjs` + `edl.json` from `work/video/mkedl.mjs`): every shot becomes an intermediate (x264 CRF 10,
   exact frame count, lower third faded in/out with alpha fades), then one ffmpeg pass joins them with `xfade` crossfades
   (0.4 s between shots, 0.3 s inside a prototype, 0.5 s into the title and end cards) and encodes the final file with
   libx264 two-pass `-preset slow -b:v 3200k -maxrate 6500k -profile:v high -movflags +faststart -an`, 6 threads (W10 ffmpeg
   2024-03 build). The vertical cut uses `-crf 23 -maxrate 6M`.
5. **Checks**: stills extracted from the final encode with ffmpeg on W10, copied back and inspected.

## Decisions (made without the owner, as the brief asks)

- **Length and order:** 2 min 10 s. Cold open on the sim-hidro storm (water spreading over the 5 m city), title, then
  the four sections the brief asked for. Each navigation prototype gets two takes (alert → «Recalculando» → safe route
  at 1×, then its own arrival/summary card), ~9 s in total; each "dónde invertir" prototype ~8–9 s.
- **"El terreno"** uses `terrain-check` (it has no demo hook): `w10/terrain-demo.js` is injected after load and
  defines `__cauceDemo` with two camera keyframe paths (ZMG orbit, Barranca de Huentitán). Only the camera is scripted;
  the page, data and style are untouched. The section ends with sim-relieve's flow network ("Cada línea es el camino
  del agua sobre el relieve"), which bridges into section 02.
- **Capture-side CSS (no content change):** sim-hidro `.card{transition:none}` and `#timeline{backdrop-filter:none}`
  (headless Chromium painted the timeline panel as an empty blurred band while the camera moved; without the blur its
  real content shows), sim-drenaje `#caption{transition:none}`, terrain-check hides the zoom buttons (`?shot=1` hides
  the panel). CSS transitions run in wall-clock time, so they are not deterministic under `seek()`.
- **Demo URLs used:** nav-mochi `?demo=1&capture=1`, nav-papel `?demo=1&snapshot=1&still=1` (frozen route snapshot),
  nav-juguete `?demo=1`, nav-neon `?demo=1&t=0`, nav-pixel `?demo=1&capture=1`, sim-relieve `?demo=1&autoplay=0`,
  sim-hidro `?demo=1&still`, sim-drenaje `?demo=1&t=0`, invertir-1/3 `?demo=1&autoplay=0`, invertir-2 `?demo=1&still=1`.
  Navigation demos route live with the shared router as it is today (blockCritical on), so e.g. nav-neon's reroute now
  avoids La Piedrera; captions describe what is on screen now.
- **No GPU lock taken:** capture is many short seek+screenshot calls (MapLibre rendering, ~0.3–2 s each), not a long
  compute job, and the simulation queues were idle; holding the lock for ~1 h would have blocked any resumed sim.
  At most three Chromium instances ran at once; ffmpeg was limited to 6 threads.
- **Lower thirds** are placed per prototype (top-left, middle-left, top-right…) so they never cover the prototype's own
  alerts, instructions or HUD, and fade out after ~4 s. The text is copied from what the prototype shows (8 vs 0 sites,
  11 vs 2 points +4 min, +2.6 km +9 min, 73.8 M cells, ~25 min per 3 h storm). Simulations carry an `exploratorio` tag.
- **Vertical cut (34.8 s):** captured natively in each prototype's phone layout (540×960 viewport at 2× → 1080×1920),
  not cropped from the 16:9 footage: sim-hidro, sim-relieve (hypothesis panel), nav-neon, nav-juguete, nav-pixel,
  invertir-2, invertir-3, plus vertical title/end cards. nav-mochi and nav-papel were left out (their phone layouts are
  dense at the top and bottom, leaving no room for a caption).
- **Size:** first CRF 22 encode was 89 MB; the published file is two-pass 3.2 Mbit/s (52.3 MB, under the 60 MB aim).
  Checked full-resolution crops of the hardest shots (neon rain, pixel dithering): text stays legible.

## Honesty

- Captions avoid forecasts: simulations carry an `exploratorio` tag, and the end card says "Modelos exploratorios: no son
  pronósticos". Numbers in captions are copied from what the prototypes show on screen or from their status/README
  (sim-hidro 73.8 M cells and ~25 min per 3 h storm; papel 8 vs 0 records; juguete 11 vs 2 points, +4 min; pixel
  +2.6 km, +9 min).
- IMEPLAN records are presented as historical records, as the prototypes do.
- Rain particles, clocks and car speeds inside the navigation prototypes are those prototypes' own visual devices; each
  labels them on screen (time-lapse factor, "escenario", "histórico, no en vivo").

## Files

- `labs/video/`: `cauce-labs.mp4`, `poster.jpg`, `index.html` (player, chapter list with `#t=` links, links to every
  prototype), `README.md`, `cauce-labs-vertical.mp4`.
- VPS work dir `/srv/contorno/data/guadalajara-flood-lab/work/video/`: `clips.mjs` (what is filmed), `mkjobs*.mjs`
  (capture jobs), `mkgfx.mjs` (card and caption copy), `mkedl.mjs` (edit list), `mkindex.mjs` (page), `w10/` (scripts
  copied to W10), `sheets/` (contact sheets used to pick windows and to check the encode).
- W10 `C:\Users\Felip\contorno-compute\labs\video\`: `frames\<prototype>\<clip>\00000.jpg…` (captured frames),
  `gfx\` (rendered cards), `cauce-labs.mp4`, `cauce-labs-vertical.mp4`, `poster.jpg`, logs in `logs\` (~3.5 GB; the
  `shots\` intermediates and browser profiles were deleted after the encode, `edit.mjs` rebuilds the former in ~2 min).

To re-cut after a prototype changes: re-run its capture job (delete its `frames\<prototype>` folder, `node mkjobs.mjs
<prototype>` on the VPS, copy `w10/queue` to W10, `launchq.ps1`), then `node edit.mjs edl.json` on W10.

## Known gaps

- nav-papel is 15 fps (duplicated frames), so its car moves a little less smoothly than the other shots.
- terrain-check's overview shows the edge of the INEGI tile set (flat white beyond the AOI); that is how the check page
  renders, not an artefact of the capture.
- Footage reflects each prototype on 2026-10-30 ~05:30 UTC (router with blockCritical, hazard registry with 29 layers,
  sim-drenaje 126 runs, sim-hidro Tr 2/10/100). If a prototype changes, re-run its job and the edit (see above);
  nothing in the video is generated from data directly.
- No audio track at all (the brief said no music).
- `labs/index.html` (gallery) does not link to `/labs/video/` yet; the orchestrator owns that page.
