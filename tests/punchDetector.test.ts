import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config'
import { PunchDetector, type HandSample, type Punch } from '../src/tracking/punchDetector'

const FRAME = 33
const C = { ...defaultConfig, STRIKE_RATE: 2.5, STRENGTH_FULL_RATE: 6.5 }

type F = { growth?: number; fist?: number } | null

/** Feeds one frame per entry (null = hand lost). Returns hits with their frame index. */
function run(frames: F[], d = new PunchDetector({ ...C }), start = 0) {
  const hits: (Punch & { frame: number })[] = []
  frames.forEach((f, i) => {
    const hands: HandSample[] =
      f === null ? [] : [{ id: 'Right', x: 400 + i, y: 300, palmSize: 0.1, growth: f.growth ?? 0, fist: f.fist ?? 0.9 }]
    for (const p of d.update(hands, start + i * FRAME)) hits.push({ ...p, frame: i })
  })
  return { hits, d }
}

const hold = (n: number, fist = 0.9): F[] => Array.from({ length: n }, () => ({ growth: 0, fist }))
// strike: growth climbs, peaks, falls back
const strike = (peak = 5): F[] => [{ growth: 3 }, { growth: peak }, { growth: 3 }, { growth: 0 }]

describe('PunchDetector state machine', () => {
  it('needs the fist held for FIST_HOLD_MS before FIST_READY', () => {
    const d = new PunchDetector({ ...C })
    run(hold(4), d) // 0..99ms
    expect(d.tracks.get('Right')!.state).toBe('IDLE')
    run(hold(1), d, 4 * FRAME) // 132ms
    expect(d.tracks.get('Right')!.state).toBe('FIST_READY')
  })

  it('hits once the strike peaks', () => {
    const { hits } = run([...hold(6), ...strike(5)])
    expect(hits).toHaveLength(1)
    expect(hits[0].reason).toBe('strike')
    expect(hits[0].peak).toBe(5)
    // fires on the frame where growth drops off the peak, at the hand's position then
    expect(hits[0].frame).toBe(8)
    expect(hits[0].x).toBe(408)
  })

  it('ignores growth from an open hand', () => {
    expect(run([...hold(6, 0.1), ...strike()].map((f) => f && { ...f, fist: 0.1 })).hits).toHaveLength(0)
  })

  it('ignores a strike that starts before the fist hold finishes', () => {
    expect(run([...hold(2), ...strike()]).hits).toHaveLength(0)
  })

  it('ignores slow growth under STRIKE_RATE', () => {
    expect(run([...hold(6), ...Array(30).fill({ growth: 2 })]).hits).toHaveLength(0)
  })

  it('uses hysteresis between FIST_OFF and FIST_ON', () => {
    const d = new PunchDetector({ ...C })
    run([...hold(6), { growth: 0, fist: 0.5 }], d)
    expect(d.tracks.get('Right')!.state).toBe('FIST_READY')
    run([{ growth: 0, fist: 0.3 }], d, 7 * FRAME)
    expect(d.tracks.get('Right')!.state).toBe('IDLE')
  })

  it('a score between the thresholds does not start the hold', () => {
    const d = new PunchDetector({ ...C })
    run(hold(10, 0.5), d)
    expect(d.tracks.get('Right')!.state).toBe('IDLE')
  })

  it('resolves a strike after STRIKE_MAX_MS even if growth keeps climbing', () => {
    const climbing = Array.from({ length: 10 }, (_, i) => ({ growth: 3 + i }))
    const { hits } = run([...hold(6), ...climbing])
    expect(hits).toHaveLength(1)
    expect(hits[0].time - 6 * FRAME).toBeGreaterThanOrEqual(C.STRIKE_MAX_MS)
  })

  it('counts a hand lost right after the strike starts (motion blur)', () => {
    const { hits } = run([...hold(6), { growth: 4 }, null])
    expect(hits).toHaveLength(1)
    expect(hits[0].reason).toBe('vanish')
    expect(hits[0].x).toBe(406) // last seen position
    expect(hits[0].peak).toBe(4)
  })

  it('does not count a hand that just leaves while ready', () => {
    expect(run([...hold(6), null]).hits).toHaveLength(0)
  })

  it('respects the cooldown', () => {
    // second strike 200ms after the first: ignored. third after the cooldown: counts.
    const frames = [...hold(6), ...strike(), ...hold(2), ...strike(), ...hold(16), ...strike()]
    const { hits } = run(frames)
    expect(hits).toHaveLength(2)
    expect(hits[1].time - hits[0].time).toBeGreaterThanOrEqual(C.COOLDOWN_MS)
  })

  it('keeps the cooldown when the hand drops out and comes back', () => {
    const frames = [...hold(6), { growth: 4 }, null, ...hold(5), ...strike()]
    const { hits } = run(frames)
    expect(hits).toHaveLength(1)
  })

  it('maps peak growth to strength', () => {
    const d = new PunchDetector({ ...C })
    expect(d.strength(C.STRIKE_RATE)).toBe(0)
    expect(d.strength((C.STRIKE_RATE + C.STRENGTH_FULL_RATE) / 2)).toBeCloseTo(0.5)
    expect(d.strength(100)).toBe(1)
  })
})
