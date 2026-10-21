import { describe, expect, it } from 'vitest'
import { PunchDetector, type HandSample } from '../src/tracking/punchDetector'
import { defaultTuning } from '../src/config'

const FRAME = 33

function detector() {
  return new PunchDetector({ ...defaultTuning, smoothing: 1 })
}

// Feed a list of per-frame sizes (null = hand missing). Returns punches with their frame index.
function run(d: PunchDetector, sizes: (number | null)[], fist = 0.9, start = 0) {
  const punches = []
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]
    const hands: HandSample[] = size === null ? [] : [{ id: 'Right', x: 400, y: 300, size, fist }]
    const p = d.update(hands, start + i * FRAME)
    if (p) punches.push({ ...p, frame: i })
  }
  return punches
}

const still = (n: number, size = 100) => Array(n).fill(size)
// ~15% bigger every frame at 30fps is a growth of ~4.2/s
const lunge = (n: number, from = 100) => Array.from({ length: n }, (_, i) => from * 1.15 ** (i + 1))

describe('PunchDetector', () => {
  it('fires on a fist that grows fast', () => {
    const punches = run(detector(), [...still(5), ...lunge(4)])
    expect(punches).toHaveLength(1)
    expect(punches[0].reason).toBe('growth')
    expect(punches[0].x).toBe(400)
  })

  it('ignores an open hand moving toward the camera', () => {
    expect(run(detector(), [...still(5), ...lunge(4)], 0.2)).toHaveLength(0)
  })

  it('ignores a fist that is just held still', () => {
    expect(run(detector(), still(60))).toHaveLength(0)
  })

  it('ignores slow growth', () => {
    const slow = Array.from({ length: 30 }, (_, i) => 100 * 1.02 ** i)
    expect(run(detector(), [...still(5), ...slow])).toHaveLength(0)
  })

  it('counts a hand that vanishes mid-punch', () => {
    // one frame of growth is primed but not enough frames to fire on its own
    const punches = run(detector(), [...still(5), 110, null])
    expect(punches).toHaveLength(1)
    expect(punches[0].reason).toBe('vanish')
  })

  it('does not count a hand that just leaves the frame', () => {
    expect(run(detector(), [...still(5), null])).toHaveLength(0)
  })

  it('respects the cooldown', () => {
    const d = detector()
    // two lunges ~300ms apart, then one more well after the cooldown
    const sizes = [...still(4), ...lunge(3), ...still(4, 152), ...lunge(3, 152), ...still(15, 230), ...lunge(3, 230)]
    const punches = run(d, sizes)
    expect(punches).toHaveLength(2)
    expect(punches[1].time - punches[0].time).toBeGreaterThanOrEqual(defaultTuning.cooldownMs)
  })

  it('needs a few frames of tracking before growth counts', () => {
    // hand appears already "growing" - typical when it slides into view
    expect(run(detector(), lunge(2))).toHaveLength(0)
  })
})
