import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { cameraError, startCamera, toScreen } from './camera'
import { loadTuning } from './config'
import { DebugOverlay, type ScreenHand } from './debug/overlay'
import { mountTuningPanel } from './debug/tuningPanel'
import { playImpact, unlockAudio } from './fx/audio'
import { addFlash, drawFlashes } from './fx/flash'
import { addShake, applyShake, resetShake } from './fx/shake'
import { ShardWorld } from './physics/world'
import { boundingBox, boxCenter, boxSize, fistScore } from './tracking/features'
import { createHandTracker } from './tracking/handTracker'
import { PunchDetector, type HandSample } from './tracking/punchDetector'
import { Wall } from './wall/shatter'

const video = document.querySelector<HTMLVideoElement>('#cam')!
const scene = document.querySelector<HTMLCanvasElement>('#scene')!
const overlayCanvas = document.querySelector<HTMLCanvasElement>('#overlay')!
const startScreen = document.querySelector<HTMLElement>('#start')!
const modelStatus = document.querySelector<HTMLElement>('#model-status')!
const msg = document.querySelector<HTMLElement>('#msg')!

const sceneCtx = scene.getContext('2d')!
const overlayCtx = overlayCanvas.getContext('2d')!

const tuning = loadTuning()
const detector = new PunchDetector(tuning)
const overlay = new DebugOverlay()
const wall = new Wall()
const world = new ShardWorld()

let width = 0
let height = 0
let debug = false
let tracker: HandLandmarker | null = null
let hands: ScreenHand[] = []
let inferMs = 0
let fps = 60
let status = 'no camera'

mountTuningPanel(document.querySelector('#panel')!, tuning)

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  for (const canvas of [scene, overlayCanvas]) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  wall.resize(width, height, dpr)
  world.resize(width, height)
}

let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(resize, 150)
})
resize()

function showMessage(text: string) {
  msg.textContent = text
  msg.hidden = false
}

function impact(x: number, y: number, strength: number) {
  const now = performance.now()
  for (const shard of wall.shatterAt(x, y, strength)) world.add(shard, { x, y }, strength, now)
  addShake(0.35 + 0.65 * strength)
  addFlash(x, y, strength, now)
  playImpact(strength)
}

function resetWall() {
  wall.rebuild()
  world.clear()
  detector.reset()
  resetShake()
}

// --- hand tracking ---------------------------------------------------------

const trackerReady = createHandTracker()
  .then((t) => {
    tracker = t
    modelStatus.textContent = 'hand model ready'
  })
  .catch((err) => {
    console.error(err)
    modelStatus.textContent = 'hand model failed to load'
    showMessage('Could not load the hand tracking model. Click still works as a test punch.')
  })

let lastVideoTime = -1

function onVideoFrame() {
  if (tracker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime
    track(tracker)
  }
  scheduleVideoFrame()
}

function scheduleVideoFrame() {
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onVideoFrame)
  else requestAnimationFrame(onVideoFrame)
}

function track(tracker: HandLandmarker) {
  const now = performance.now()
  const result = tracker.detectForVideo(video, now)
  inferMs = performance.now() - now

  const samples: HandSample[] = []
  hands = result.landmarks.map((landmarks, i) => {
    let id = result.handedness[i]?.[0]?.categoryName ?? 'Hand'
    // the classifier sometimes calls both hands the same thing
    if (samples.some((s) => s.id === id)) id += ` ${i + 1}`

    const points = landmarks.map((p) => toScreen(p.x, p.y, video, width, height))
    const box = boundingBox(points)
    const center = boxCenter(box)
    // world landmarks are metric 3D, which keeps the fist score sane when
    // the fist points straight at the camera
    const fist = fistScore(result.worldLandmarks[i] ?? landmarks)

    samples.push({ id, x: center.x, y: center.y, size: boxSize(box), fist })
    return { id, points, box, center }
  })

  const punch = detector.update(samples, now)
  overlay.record(detector, now)
  if (punch) {
    overlay.addPunch(punch)
    impact(punch.x, punch.y, punch.strength)
  }
}

document.querySelector('#start-btn')!.addEventListener('click', async () => {
  unlockAudio()
  startScreen.hidden = true
  try {
    await startCamera(video)
    status = 'waiting for model'
    await trackerReady
    if (tracker) status = 'tracking'
    scheduleVideoFrame()
  } catch (err) {
    console.error(err)
    status = 'no camera'
    showMessage(`${cameraError(err)} You can still click to punch.`)
  }
})

// --- input -----------------------------------------------------------------

scene.addEventListener('pointerdown', (e) => {
  unlockAudio()
  const p = { x: e.clientX, y: e.clientY, strength: 0.6 }
  overlay.addPunch({ ...p, reason: 'click', hand: 'mouse', time: performance.now() })
  impact(p.x, p.y, p.strength)
})

document.querySelector('#reset')!.addEventListener('click', resetWall)

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'd' || e.key === 'D') {
    debug = !debug
    document.body.classList.toggle('debug', debug)
  }
  if (e.key === 'r' || e.key === 'R') resetWall()
})

// --- render loop -------------------------------------------------------------

let last = performance.now()

function frame(now: number) {
  const dt = Math.min(now - last, 100)
  last = now
  fps += (1000 / Math.max(dt, 1) - fps) * 0.05

  world.step(dt, now)

  sceneCtx.save()
  sceneCtx.clearRect(0, 0, width, height)
  applyShake(sceneCtx, dt)
  // the wall is fully opaque; you only see the camera through punched holes
  sceneCtx.drawImage(wall.canvas, 0, 0, width, height)
  world.draw(sceneCtx, now)
  drawFlashes(sceneCtx, width, height, now)
  sceneCtx.restore()

  overlayCtx.clearRect(0, 0, width, height)
  overlay.drawReticles(overlayCtx, hands, detector)
  if (debug) {
    overlay.draw(overlayCtx, hands, detector, { fps, inferMs, shards: world.shards.length, status }, now)
  }

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
