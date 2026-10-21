import { config } from '../config'
import { OneEuroFilter, type EuroParams } from './oneEuro'

export interface Point {
  x: number
  y: number
  z?: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const WRIST = 0
const MIDDLE_MCP = 9
const KNUCKLES = [5, 9, 13, 17]
const TIPS = [8, 12, 16, 20]

export function boundingBox(points: Point[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function boxCenter(box: Box): Point {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}

/**
 * Wrist to middle knuckle, in units of image height.
 *
 * MediaPipe's x (and z) are fractions of the image width and y is a fraction
 * of the height, so x and z get multiplied by the aspect ratio to put all three
 * on the same scale. z is included so the length doesn't collapse when the
 * fist turns to face the camera.
 */
export function palmSize(points: Point[], aspect = 1) {
  const a = points[WRIST]
  const b = points[MIDDLE_MCP]
  return Math.hypot((b.x - a.x) * aspect, b.y - a.y, ((b.z ?? 0) - (a.z ?? 0)) * aspect)
}

/**
 * 0 = open hand, 1 = tight fist.
 * Ratio of average fingertip-to-wrist distance over average knuckle-to-wrist
 * distance: about 2 for an open hand, about 1 for a fist. Scale-free, so it
 * works at any distance. Best fed MediaPipe's 3D world landmarks.
 */
export function fistScore(points: Point[], open = config.FIST_RATIO_OPEN, closed = config.FIST_RATIO_CLOSED) {
  const wrist = points[WRIST]
  let tips = 0
  let knuckles = 0
  for (let i = 0; i < 4; i++) {
    tips += dist(points[TIPS[i]], wrist)
    knuckles += dist(points[KNUCKLES[i]], wrist)
  }
  if (knuckles <= 0) return 0
  const ratio = tips / knuckles
  return Math.min(1, Math.max(0, (open - ratio) / (open - closed)))
}

/** Log growth per second, so "30% bigger in 100ms" means the same near or far. */
export function growthRate(prevSize: number, size: number, dtMs: number) {
  if (prevSize <= 0 || size <= 0 || dtMs <= 0) return 0
  return Math.log(size / prevSize) / (dtMs / 1000)
}

export interface SizeSample {
  t: number
  size: number
}

/**
 * Growth between now and the sample closest to `windowMs` ago. Comparing
 * across a window instead of frame-to-frame keeps one jittery frame from
 * looking like a punch. Returns 0 until there's at least half a window of history.
 */
export function windowedGrowth(history: SizeSample[], windowMs: number) {
  if (history.length < 2) return 0
  const now = history[history.length - 1]
  let base: SizeSample | null = null
  for (let i = history.length - 2; i >= 0; i--) {
    base = history[i]
    if (now.t - history[i].t >= windowMs) break
  }
  if (!base || now.t - base.t < windowMs / 2) return 0
  return growthRate(base.size, now.size, now.t - base.t)
}

export interface RawHand {
  id: string
  /** normalized image landmarks (x, y in 0..1, z relative depth) */
  image: Point[]
  /** metric 3D landmarks, if the tracker gave them */
  world?: Point[]
}

export interface HandFeatures {
  id: string
  /** smoothed normalized image landmarks */
  image: Point[]
  palmSize: number
  growth: number
  fist: number
}

interface HandHistory {
  imageFilters: OneEuroFilter[]
  worldFilters: OneEuroFilter[]
  sizes: SizeSample[]
}

function smooth(points: Point[], filters: OneEuroFilter[], t: number, p: EuroParams): Point[] {
  return points.map((pt, i) => ({
    x: filters[i * 3].filter(pt.x, t, p),
    y: filters[i * 3 + 1].filter(pt.y, t, p),
    z: filters[i * 3 + 2].filter(pt.z ?? 0, t, p),
  }))
}

const newFilters = () => Array.from({ length: 21 * 3 }, () => new OneEuroFilter())

/** Keeps per-hand filters and size history, and turns raw landmarks into features. */
export class FeatureTracker {
  private hands = new Map<string, HandHistory>()

  update(raw: RawHand[], now: number, aspect: number): HandFeatures[] {
    const euro: EuroParams = {
      minCutoff: config.EURO_MIN_CUTOFF,
      beta: config.EURO_BETA,
      dCutoff: config.EURO_D_CUTOFF,
    }
    const t = now / 1000
    const seen = new Set<string>()

    const out = raw.map((hand) => {
      seen.add(hand.id)
      let h = this.hands.get(hand.id)
      if (!h) this.hands.set(hand.id, (h = { imageFilters: newFilters(), worldFilters: newFilters(), sizes: [] }))

      const image = smooth(hand.image, h.imageFilters, t, euro)
      const world = hand.world ? smooth(hand.world, h.worldFilters, t, euro) : image

      const size = palmSize(image, aspect)
      h.sizes.push({ t: now, size })
      while (h.sizes.length > 2 && now - h.sizes[1].t > config.GROWTH_WINDOW_MS * 2) h.sizes.shift()

      return {
        id: hand.id,
        image,
        palmSize: size,
        growth: windowedGrowth(h.sizes, config.GROWTH_WINDOW_MS),
        fist: fistScore(world),
      }
    })

    // a hand that drops out starts fresh when it comes back
    for (const id of this.hands.keys()) if (!seen.has(id)) this.hands.delete(id)
    return out
  }

  reset() {
    this.hands.clear()
  }
}
