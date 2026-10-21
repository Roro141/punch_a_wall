# Punch Wall

Punch toward your webcam and the wall on screen breaks where you hit it.

Hand tracking is MediaPipe's HandLandmarker, the shards are Voronoi cells (d3-delaunay), and the wall and flying chunks are rendered in 3D with [Three.js](https://threejs.org): the wall is a lit slab with real thickness, each shard is an extruded chunk that tumbles out toward you, the camera lurches in on every hit, and a warm light follows your fist. Everything runs in the browser and no video leaves your machine.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Start swinging** and allow the camera. The first time, a short calibration runs (see below). After that it goes straight to the wall.

- `D` toggles the debug view (skeleton, live features, growth graph, tuning sliders)
- `L` starts / stops the session logger. Stopping downloads `punch-log-<timestamp>.json`
- `R` or **Reset wall** rebuilds the wall
- **Recalibrate** reruns calibration
- clicking anywhere is a test punch, handy without a camera

## How punch detection works

A punch is a **closed fist that suddenly gets bigger in the image**, because it's coming at the camera fast. Everything below runs per hand, every video frame.

### Features

1. **Smoothing.** Raw MediaPipe landmarks jitter by a few pixels even when the hand is still, and that jitter shows up as fake growth. Each landmark coordinate goes through a [One Euro filter](https://gery.casiez.net/1euro/) first. It smooths heavily when the hand is slow and barely at all when it's fast, so it removes jitter without adding much lag to a punch.

2. **`palmSize`**: the distance from the wrist (landmark 0) to the middle knuckle (landmark 9), in units of image height. x and z are scaled by the aspect ratio so all three axes match.
   *Why not the hand's bounding box?* The box changes whenever the fingers move: opening the hand, spreading fingers, or rotating the wrist all resize it without the hand getting any closer. The wrist-to-knuckle segment is bone, so its length only changes when the hand moves toward or away from the camera. The z term keeps it from shrinking when the fist turns to point at the camera.

3. **`growthRate`**: `ln(palmSize_now / palmSize_~100ms_ago) / dt`, in 1/s.
   - *Log ratio* because it's scale-free: a hand 30% bigger after 100 ms reads the same whether you're near or far.
   - *Per second* so the value doesn't depend on the camera's frame rate.
   - *~100 ms window* (`GROWTH_WINDOW_MS`) instead of frame-to-frame, so a single noisy frame can't spike it.

4. **`fistScore`**: average fingertip-to-wrist distance divided by average knuckle-to-wrist distance. That ratio is about 2 for an open hand and about 1 for a fist. It's mapped linearly from `FIST_RATIO_OPEN` → 0 to `FIST_RATIO_CLOSED` → 1 and clamped. It uses MediaPipe's 3D world landmarks, because in 2D a fist pointed at the camera looks the same as an open hand pointed at the camera.

### State machine

```
IDLE ──fist > FIST_ON for FIST_HOLD_MS──▶ FIST_READY ──growth > STRIKE_RATE──▶ STRIKING ──▶ HIT ──▶ COOLDOWN ──COOLDOWN_MS──▶ IDLE
  ▲                                            │
  └───────────────fist < FIST_OFF──────────────┘
```

- **Hysteresis.** The fist closes at `FIST_ON` but only counts as open again below `FIST_OFF`. A score wobbling around one threshold would otherwise flip state every frame.
- **Fist hold.** The fist has to stay closed for `FIST_HOLD_MS` first. A hand that is still closing while it moves (grabbing something, say) doesn't get to strike.
- **Strike → hit.** STRIKING ends in a HIT as soon as the growth peak has passed (growth falls below `STRIKE_PEAK_DROP` × peak), growth falls back under `STRIKE_RATE`, or `STRIKE_MAX_MS` runs out. Waiting for the peak is what gives a real strength value, and it costs at most a frame or two.
- **Fist ignored mid-strike.** Motion blur wrecks the fist score during a fast punch, so STRIKING doesn't check it.
- **Motion-blur fallback.** Fast punches often blur so much that MediaPipe loses the hand. If the hand disappears within `VANISH_MS` of entering STRIKING, that counts as a hit at the last known position. A hand that leaves frame from IDLE or FIST_READY is ignored.
- **Strength** is the peak growth during the strike, mapped linearly from `STRIKE_RATE` → 0 to `STRENGTH_FULL_RATE` → 1.
- **Cooldown** stops one punch from landing twice. It survives the tracker losing the hand and finding it again.

### Thresholds

All of them live in one object in [`src/config.ts`](src/config.ts). The debug panel (`D`) edits them live, and changes are saved in localStorage. **Defaults** resets them and re-applies your calibration.

| Name | Default | What it does |
| --- | --- | --- |
| `EURO_MIN_CUTOFF` | 1.5 Hz | One Euro cutoff at rest. Lower = steadier still hand, more lag. |
| `EURO_BETA` | 5 | How fast the cutoff opens up with speed. Higher = less lag on fast moves, more jitter. |
| `EURO_D_CUTOFF` | 1 Hz | Cutoff for the filter's own speed estimate. |
| `GROWTH_WINDOW_MS` | 100 ms | How far back growth compares palm size. |
| `FIST_RATIO_OPEN` | 1.8 | Tip/knuckle ratio that scores 0 (open). |
| `FIST_RATIO_CLOSED` | 1.1 | Tip/knuckle ratio that scores 1 (fist). |
| `FIST_ON` | 0.6 | Fist score that starts the fist hold. |
| `FIST_OFF` | 0.4 | Fist score below which the fist counts as open again. |
| `FIST_HOLD_MS` | 120 ms | How long the fist must stay closed before FIST_READY. |
| `STRIKE_RATE` | 2.5 /s | Growth that starts a strike. **Set by calibration.** The default is a starting guess, not a measurement. |
| `STRIKE_PEAK_DROP` | 0.85 | Strike resolves once growth drops below this fraction of its peak. |
| `STRIKE_MAX_MS` | 150 ms | Strike always resolves after this long. |
| `VANISH_MS` | 150 ms | Losing the hand this soon after a strike starts still counts as a hit. |
| `COOLDOWN_MS` | 500 ms | Dead time after a hit. |
| `STRENGTH_FULL_RATE` | 6 /s | Peak growth that maps to strength 1. **Set by calibration.** |
| `CALIB_SPLIT` | 0.4 | Where calibration puts `STRIKE_RATE` between noise and punches (see below). |
| `CALIB_MIN_SEPARATION` | 1.3 | Weakest punch must be at least this × the noise max, or calibration fails. |
| `CALIB_MIN_RATE` | 1 /s | Floor for `STRIKE_RATE`, for when you held perfectly still. |
| `CALIB_STRENGTH_HEADROOM` | 1.25 | `STRENGTH_FULL_RATE` = strongest calibration punch × this. |

### Calibration

Every camera, room and arm is different, so the one number that matters most, `STRIKE_RATE`, is measured instead of guessed. Calibration runs the first time you start, and again whenever you hit **Recalibrate**. Each step has a 3-second countdown first.

1. **HOLD STILL** (5 s): baseline tracker noise.
2. **MAKE A FIST, MOVE AROUND** (5 s): hard negatives. Waving, scratching your face, shifting around: the movements that must *not* count.
3. **PUNCH 3 TIMES** (up to 12 s): each time growth rises above everything seen in steps 1–2, that's one punch, and its peak is recorded. Rises less than 300 ms apart are merged into one punch.

Then:

```
noiseMax     = max growth over steps 1 and 2
weakestPunch = min of the 3 punch peaks

STRIKE_RATE        = max(CALIB_MIN_RATE, noiseMax + CALIB_SPLIT × (weakestPunch − noiseMax))
STRENGTH_FULL_RATE = max(1.5 × STRIKE_RATE, strongest punch × CALIB_STRENGTH_HEADROOM)
```

With `CALIB_SPLIT = 0.4`, the trigger sits 40% of the way from your loudest non-punch movement to your softest punch. That's below the midpoint, so a punch a bit softer than your calibration punches still lands, while staying clear of anything you did in step 2.

Calibration **fails** and asks you to redo it when:
- the hand wasn't found in at least half the frames of steps 1 or 2,
- fewer than 3 punches stood out from the noise, or
- `weakestPunch < CALIB_MIN_SEPARATION × noiseMax`, meaning punches and normal movement overlap.

The fix is usually to step back so your whole forearm fits in frame, or to add light: dim light means more motion blur and noisier landmarks. You can also skip calibration and use the defaults.

The result is saved in localStorage (`punch-wall:calibration`).

### Logging and plotting

Press `L` to start recording. Every tracked frame's features and state, every hit, and the thresholds in effect go into memory. Nothing leaves the browser. Press `L` again to stop and download `punch-log-<timestamp>.json`.

```bash
pip install matplotlib
python scripts/plot_log.py punch-log-2026-10-21T14-03-22.json            # saves punch-log-....png next to it
python scripts/plot_log.py punch-log-....json --hand Right -o right.png
```

The plot has growth rate with the `STRIKE_RATE` line, the state machine over time, and fist score with `FIST_ON` / `FIST_OFF`. Detected hits are marked as vertical lines (red = strike, orange = blur fallback, grey = mouse click).

<!-- TODO: add a plot from a real session -->
![Example session plot](docs/example-plot.png)

*Placeholder: replace with a plot from a real recorded session.*

### Measured results

*Placeholder: not measured yet. To be filled in from real logs.*

| Measurement | Value |
| --- | --- |
| Setup (camera, resolution, lighting, distance) | _TODO_ |
| Tracking frame rate | _TODO_ |
| Typical `noiseMax` (still + moving around) | _TODO_ |
| Typical punch peak growth | _TODO_ |
| Calibrated `STRIKE_RATE` | _TODO_ |
| Punches thrown / detected | _TODO_ |
| False hits during non-punch movement | _TODO_ |
| Share of hits from the blur fallback | _TODO_ |
| Latency, punch extension → wall breaks | _TODO_ |

### Tuning tips

Turn on debug (`D`) and watch the growth graph while you punch. The red line is `STRIKE_RATE`. Line colour is the state: grey-blue IDLE, yellow FIST_READY, orange STRIKING, purple COOLDOWN.

- **First, recalibrate.** Most problems go away when the trigger is measured in your actual room.
- **Missing punches?** Check that the line turns yellow (FIST_READY) before you punch. If it doesn't, the fist isn't being recognised: lower `FIST_ON`. If it's yellow but doesn't cross the red line, lower `STRIKE_RATE`.
- **Hits when you're just moving around?** Raise `STRIKE_RATE`, or raise `FIST_HOLD_MS` so a fist has to settle before it can strike.
- **Landmarks look jittery / growth is noisy at rest?** Lower `EURO_MIN_CUTOFF`. **Punches feel late?** Raise `EURO_BETA`.
- Record a log (`L`) and plot it. It's much easier to pick thresholds from a plot than from a live graph.

## Deploying

It's a plain Vite app. On Vercel just import the repo; the defaults (build `npm run build`, output `dist`) work as is. The camera needs HTTPS, which Vercel gives you.

The hand model lives in `public/models`. The MediaPipe wasm files are copied from `node_modules` into `public/mediapipe` on `npm install` (see `scripts/copy-wasm.mjs`), so nothing is loaded from a CDN.

## Scripts

- `npm run dev`: dev server
- `npm run build`: type check + production build
- `npm run preview`: serve the build locally
- `npm test`: unit tests for the features, One Euro filter, punch state machine and calibration math
- `python scripts/plot_log.py <log.json>`: plot a session log (needs matplotlib)
