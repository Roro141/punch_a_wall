# Punch Wall

Punch toward your webcam and the wall on screen breaks where you hit it.

Hand tracking is MediaPipe's HandLandmarker, the shards are Voronoi cells (d3-delaunay), and they fall with matter-js. Everything runs in the browser and no video leaves your machine.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Start camera** and allow the camera.

- `D` toggles the debug view (skeleton, fist score, growth graph, tuning sliders)
- `R` or the **Reset wall** button rebuilds the wall
- clicking anywhere is a test punch, handy without a camera

## How a punch is detected

A punch is a **closed fist whose bounding box grows fast**, i.e. it's coming at the camera.

- **fist score**: how curled the four fingers are (plus a bit of thumb), from MediaPipe's 3D world landmarks. 0 = open, 1 = fist.
- **growth**: `ln(size / prevSize) / dt`, per second. It's a log rate, so it works the same whether you're close or far.
- it fires when fist ≥ *fist min* and growth ≥ *growth min* for *min frames* frames in a row
- fast punches often blur so much that the tracker loses the hand. If the hand was "primed" (fist, growth ≥ *growth primed*) and then vanishes within *vanish window*, that counts too.
- *cooldown* stops one punch from firing twice

## Tuning tips

Turn on debug (`D`) and watch the growth graph while you punch. The red line is *growth min* and the orange one is *growth primed*.

- **Missing punches?** Lower *growth min* a bit, or set *min frames* to 1.
- **Fires when you just move your hand around?** Raise *growth min* or *fist min*.
- **Fist score stays low when punching?** Lower *fist min*. A fist pointed straight at the camera is the hardest case for the tracker.
- Good lighting helps a lot. Dim rooms mean more motion blur.

Slider values are saved in localStorage. Hit **Defaults** to go back.

## Deploying

It's a plain Vite app. On Vercel just import the repo; the defaults (build `npm run build`, output `dist`) work as is. The camera needs HTTPS, which Vercel gives you.

The hand model lives in `public/models`. The MediaPipe wasm files are copied from `node_modules` into `public/mediapipe` on `npm install` (see `scripts/copy-wasm.mjs`), so nothing is loaded from a CDN.

## Scripts

- `npm run dev`: dev server
- `npm run build`: type check + production build
- `npm run preview`: serve the build locally
- `npm test`: unit tests for the fist score and punch detector
