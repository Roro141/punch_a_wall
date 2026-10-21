import { describe, expect, it } from 'vitest'
import { boundingBox, boxSize, fistScore, growthRate, type Point } from '../src/tracking/features'

// Rough 21-point hands in a "metric" space, palm facing camera, fingers up (-y).
function hand(curled: boolean): Point[] {
  const pts: Point[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }))
  pts[0] = { x: 0, y: 0, z: 0 } // wrist
  pts[1] = { x: -0.02, y: -0.02, z: 0 }
  pts[2] = { x: -0.035, y: -0.035, z: 0 }
  pts[3] = { x: -0.045, y: -0.05, z: 0 }
  pts[4] = curled ? { x: -0.01, y: -0.06, z: -0.02 } : { x: -0.07, y: -0.07, z: 0 }

  const xs = [-0.025, 0, 0.02, 0.04]
  xs.forEach((x, i) => {
    const base = 5 + i * 4
    pts[base] = { x, y: -0.08, z: 0 } // mcp
    pts[base + 1] = { x, y: -0.115, z: 0 } // pip
    if (curled) {
      pts[base + 2] = { x, y: -0.105, z: -0.03 }
      pts[base + 3] = { x, y: -0.08, z: -0.03 }
    } else {
      pts[base + 2] = { x, y: -0.14, z: 0 }
      pts[base + 3] = { x, y: -0.16, z: 0 }
    }
  })
  return pts
}

describe('fistScore', () => {
  it('is high for a fist', () => {
    expect(fistScore(hand(true))).toBeGreaterThan(0.8)
  })

  it('is low for an open hand', () => {
    expect(fistScore(hand(false))).toBeLessThan(0.3)
  })
})

describe('size + growth', () => {
  it('uses the bbox diagonal', () => {
    const box = boundingBox([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 1, y: 1 }])
    expect(boxSize(box)).toBe(5)
  })

  it('reports log growth per second', () => {
    expect(growthRate(100, 100, 33)).toBe(0)
    expect(growthRate(100, 100 * Math.E, 1000)).toBeCloseTo(1)
    expect(growthRate(100, 50, 100)).toBeLessThan(0)
  })

  it('ignores bad input', () => {
    expect(growthRate(0, 100, 33)).toBe(0)
    expect(growthRate(100, 120, 0)).toBe(0)
  })
})
