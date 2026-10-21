import type { HandLandmarker } from '@mediapipe/tasks-vision'
import {
  applyCalibration,
  CalibrationSession,
  loadCalibration,
  saveCalibration,
  type Calibration,
} from './calibration/calibrate'
import { CalibrationScreen } from './calibration/screen'
import { cameraError, startCamera, toScreen } from './camera'
import { config, loadConfig, saveConfig } from './config'
import { SessionLogger, type LogHand } from './debug/logger'
import { DebugOverlay, type ScreenHand } from './debug/overlay'
import { mountTuningPanel } from './debug/tuningPanel'
import { playImpact, unlockAudio } from './fx/audio'
import { addFlash, drawFlashes } from './fx/flash'
import { addShake, applyShake, resetShake } from './fx/shake'
import { ShardWorld } from './physics/world'
import { boundingBox, boxCenter, FeatureTracker, type RawHand } from './tracking/features'
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

// Saved settings already include the last calibration; apply the calibration
// on its own only if the settings got lost.
let calibration: Calibration | null = loadCalibration()
if (!loadConfig() && calibration) applyCalibration(calibration)

const features = new FeatureTracker()
const detector = new PunchDetector()
const overlay = new DebugOverlay()
const logger = new SessionLogger()
const wall = new Wall()
const world = new ShardWorld()

let width = 0
let height = 0
let debug = false
let tracker: HandLandmarker | null = null
let hands: ScreenHand[] = []
let inferMs = 0
let fps = 60
let trackFps = 0
let lastTrackAt = 0
let status = 'no camera'
let session: CalibrationSession | null = null

const panel = mountTuningPanel(document.querySelector('#panel')!, () => {
  if (calibration) applyCalibration(calibration)
})

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

// --- calibration -------------------------------------------------------------

const calibScreen = new CalibrationScreen(document.querySelector('#calib')!, {
  onRedo: startCalibration,
  onFinish: finishCalibration,
})

function startCalibration() {
  if (!tracker) {
    showMessage('Calibration needs the camera and hand model.')
    return
  }
  msg.hidden = true
  session = new CalibrationSession(performance.now())
  detector.reset()
  document.body.classList.add('calibrating')
  calibScreen.show()
}

function finishCalibration(result: Calibration | null) {
  if (result) {
    calibration = result
    saveCalibration(result)
    applyCalibration(result)
    saveConfig()
    panel.refresh()
  }
  session = null
  detector.reset()
  calibScreen.hide()
  document.body.classList.remove('calibrating')
}

// --- hand tracking -------------------------------------------------------------

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
  if (lastTrackAt) trackFps += (1000 / Math.max(now - lastTrackAt, 1) - trackFps) * 0.1
  lastTrackAt = now

  const raw: RawHand[] = []
  result.landmarks.forEach((image, i) => {
    let id = result.handedness[i]?.[0]?.categoryName ?? 'Hand'
    // the classifier sometimes calls both hands the same thing
    if (raw.some((h) => h.id === id)) id += ` ${i + 1}`
    raw.push({ id, image, world: result.worldLandmarks[i] })
  })

  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
  const feats = features.update(raw, now, aspect)

  const samples: HandSample[] = []
  hands = feats.map((f) => {
    const points = f.image.map((p) => toScreen(p.x, p.y, video, width, height))
    const box = boundingBox(points)
    const center = boxCenter(box)
    samples.push({ id: f.id, x: center.x, y: center.y, palmSize: f.palmSize, growth: f.growth, fist: f.fist })
    return { id: f.id, points, box, center }
  })

  if (session) {
    session.addFrame(feats, now)
  } else {
    for (const punch of detector.update(samples, now)) {
      overlay.addPunch(punch)
      logger.hit(punch)
      impact(punch.x, punch.y, punch.strength)
    }
    overlay.record(detector, now)
  }

  const logged: LogHand[] = samples.map((s) => ({
    id: s.id,
    x: s.x,
    y: s.y,
    palm: s.palmSize,
    growth: s.growth,
    fist: s.fist,
    state: detector.tracks.get(s.id)?.state ?? 'IDLE',
  }))
  logger.record(now, logged, config)
}

document.querySelector('#start-btn')!.addEventListener('click', async () => {
  unlockAudio()
  startScreen.hidden = true
  try {
    await startCamera(video)
    status = 'waiting for model'
    await trackerReady
    if (tracker) {
      status = 'tracking'
      if (!calibration) startCalibration()
    }
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
  const punch = { ...p, peak: 0, reason: 'click' as const, hand: 'mouse', time: performance.now() }
  overlay.addPunch(punch)
  logger.hit(punch)
  impact(p.x, p.y, p.strength)
})

document.querySelector('#reset')!.addEventListener('click', resetWall)
document.querySelector('#recalibrate')!.addEventListener('click', startCalibration)

function toggleLogger() {
  const now = performance.now()
  if (logger.recording) {
    logger.stop(now, config, calibration, { width: video.videoWidth, height: video.videoHeight })
  } else {
    logger.start(now, config)
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  const key = e.key.toLowerCase()
  if (key === 'd') {
    debug = !debug
    document.body.classList.toggle('debug', debug)
  }
  if (key === 'r' && !session) resetWall()
  if (key === 'l') toggleLogger()
})

// --- render loop -------------------------------------------------------------

let last = performance.now()

function frame(now: number) {
  const dt = Math.min(now - last, 100)
  last = now
  fps += (1000 / Math.max(dt, 1) - fps) * 0.05

  if (session) {
    session.tick(now)
    calibScreen.render(session.view(now))
  }

  world.step(dt, now)

  sceneCtx.save()
  sceneCtx.clearRect(0, 0, width, height)
  applyShake(sceneCtx, dt)
  // the wall is fully opaque; you only see the camera through punched holes
  sceneCtx.drawImage(wall.canvas, 0, 0, width, height)
  world.draw(sceneCtx, now)
  drawFlashes(sceneCtx, width, height, now)
  sceneCtx.restore()

  const stats = {
    fps,
    trackFps,
    inferMs,
    shards: world.shards.length,
    status: session ? 'calibrating' : status,
    logMs: logger.recording ? logger.elapsed(now) : null,
    logFrames: logger.frameCount,
  }

  overlayCtx.clearRect(0, 0, width, height)
  overlay.drawReticles(overlayCtx, hands, detector)
  if (debug) overlay.draw(overlayCtx, hands, detector, stats, now)
  overlay.drawRecording(overlayCtx, stats, now)

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
