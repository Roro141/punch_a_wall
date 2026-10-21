import { describe, expect, it } from 'vitest'
import {
  FeatureTracker,
  fistScore,
  growthRate,
  palmSize,
  windowedGrowth,
  type Point,
} from '../src/tracking/features'
import { OneEuroFilter } from '../src/tracking/oneEuro'

// Rough 21-point hands in a "metric" space, palm facing camera, fingers up (-y).
function hand(curled: boolean): Point[] {
  const pts: Point[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  pts[0] = { x: 0, y: 0, z: 0 } // wrist
  pts[4] = curled ? { x: -0.01, y: -0.06, z: -0.02 } : { x: -0.07, y: -0.07, z: 0 }
  ;[-0.025, 0, 0.02, 0.04].forEach((x, i) => {
    const base = 5 + i * 4
    pts[base] = { x, y: -0.08, z: 0 } // knuckle
    pts[base + 1] = { x, y: -0.115, z: 0 }
    pts[base + 2] = curled ? { x, y: -0.105, z: -0.03 } : { x, y: -0.14, z: 0 }
    pts[base + 3] = curled ? { x, y: -0.08, z: -0.03 } : { x, y: -0.16, z: 0 } // tip
  })
  return pts
}

/** Moves and scales a hand, like it would look closer to / further from the camera. */
const scaled = (pts: Point[], k: number, dx = 0.5, dy = 0.5) =>
  pts.map((p) => ({ x: dx + p.x * k, y: dy + p.y * k, z: (p.z ?? 0) * k }))

describe('fistScore', () => {
  it('is high for a fist', () => {
    expect(fistScore(hand(true))).toBeGreaterThan(0.8)
  })

  it('is low for an open hand', () => {
    expect(fistScore(hand(false))).toBeLessThan(0.2)
  })

  it('does not depend on distance', () => {
    expect(fistScore(scaled(hand(true), 3))).toBeCloseTo(fistScore(hand(true)))
  })

  it('stays within 0..1', () => {
    expect(fistScore(hand(true), 1.8, 1.5)).toBe(1)
    expect(fistScore(hand(false), 1.5, 1.1)).toBe(0)
  })
})

describe('palmSize', () => {
  it('is the wrist to middle knuckle distance', () => {
    expect(palmSize(hand(false))).toBeCloseTo(0.08)
  })

  it('corrects x for the aspect ratio', () => {
    const pts = hand(false).map((p) => ({ ...p }))
    pts[9] = { x: 0.1, y: 0, z: 0 }
    expect(palmSize(pts, 16 / 9)).toBeCloseTo(0.1 * (16 / 9))
  })

  it('counts depth, so a fist turned toward the camera keeps its size', () => {
    const pts = hand(false).map((p) => ({ ...p }))
    pts[9] = { x: 0, y: 0, z: -0.08 }
    expect(palmSize(pts)).toBeCloseTo(0.08)
  })
})

describe('growth', () => {
  it('reports log growth per second', () => {
    expect(growthRate(100, 100, 33)).toBe(0)
    expect(growthRate(100, 100 * Math.E, 1000)).toBeCloseTo(1)
    expect(growthRate(100, 50, 100)).toBeLessThan(0)
    expect(growthRate(0, 100, 33)).toBe(0)
  })

  it('compares against the sample about one window ago', () => {
    const history = [0, 33, 66, 100, 133].map((t) => ({ t, size: t >= 100 ? 2 : 1 }))
    // newest = t133 (size 2); first sample at least 100ms older is t33 (size 1)
    expect(windowedGrowth(history, 100)).toBeCloseTo(Math.log(2) / 0.1)
  })

  it('is 0 until there is half a window of history', () => {
    expect(windowedGrowth([{ t: 0, size: 1 }, { t: 33, size: 2 }], 100)).toBe(0)
    expect(windowedGrowth([{ t: 0, size: 1 }, { t: 60, size: 2 }], 100)).toBeGreaterThan(0)
  })
})

describe('OneEuroFilter', () => {
  const p = { minCutoff: 1, beta: 0, dCutoff: 1 }

  it('passes a constant through', () => {
    const f = new OneEuroFilter()
    for (let i = 0; i < 10; i++) expect(f.filter(5, i / 30, p)).toBe(5)
  })

  it('smooths jitter', () => {
    const f = new OneEuroFilter()
    let maxOut = 0
    for (let i = 0; i < 60; i++) {
      const out = f.filter(i % 2 ? 1 : -1, i / 30, p)
      if (i > 10) maxOut = Math.max(maxOut, Math.abs(out))
    }
    expect(maxOut).toBeLessThan(0.5)
  })

  it('lags less on fast moves when beta is higher', () => {
    const run = (beta: number) => {
      const f = new OneEuroFilter()
      let out = 0
      for (let i = 0; i < 6; i++) out = f.filter(i * 0.1, i / 30, { ...p, beta })
      return out
    }
    expect(Math.abs(0.5 - run(10))).toBeLessThan(Math.abs(0.5 - run(0)))
  })
})

describe('FeatureTracker', () => {
  it('sees a fist that gets bigger as growing', () => {
    const tracker = new FeatureTracker()
    let growth = 0
    let fist = 0
    for (let i = 0; i < 12; i++) {
      const k = i < 6 ? 1 : 1.15 ** (i - 5)
      const pts = scaled(hand(true), k)
      const [f] = tracker.update([{ id: 'Right', image: pts, world: hand(true) }], i * 33, 1)
      growth = f.growth
      fist = f.fist
    }
    expect(growth).toBeGreaterThan(1)
    expect(fist).toBeGreaterThan(0.8)
  })

  it('reports no growth for a hand that holds still', () => {
    const tracker = new FeatureTracker()
    let growth = 1
    for (let i = 0; i < 20; i++) {
      growth = tracker.update([{ id: 'Right', image: scaled(hand(true), 1) }], i * 33, 1)[0].growth
    }
    expect(Math.abs(growth)).toBeLessThan(1e-9)
  })
})
