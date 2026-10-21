import { describe, expect, it } from 'vitest'
import { CalibrationSession, computeCalibration, STEPS, type CalibrationInput } from '../src/calibration/calibrate'
import { defaultConfig } from '../src/config'

const C = { ...defaultConfig }

const input = (over: Partial<CalibrationInput> = {}): CalibrationInput => ({
  stillGrowth: [0.1, -0.2, 0.3],
  moveGrowth: [0.5, 1.0, -0.8],
  stillSeen: 1,
  moveSeen: 1,
  punchPeaks: [4, 5, 6],
  stillFist: [0.2],
  moveFist: [0.9],
  ...over,
})

describe('computeCalibration', () => {
  it('puts STRIKE_RATE 40% of the way from noise max to the weakest punch', () => {
    const out = computeCalibration(input(), C)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // noise max 1.0, weakest punch 4.0 -> 1 + 0.4 * 3
    expect(out.calibration.noiseMax).toBe(1)
    expect(out.calibration.weakestPunch).toBe(4)
    expect(out.calibration.strikeRate).toBeCloseTo(2.2)
    expect(out.calibration.strengthFullRate).toBeCloseTo(6 * C.CALIB_STRENGTH_HEADROOM)
  })

  it('fails when punches overlap with normal movement', () => {
    const out = computeCalibration(input({ moveGrowth: [3.5] }), C)
    expect(out).toMatchObject({ ok: false, reason: 'overlap' })
  })

  it('fails with fewer than 3 punches', () => {
    expect(computeCalibration(input({ punchPeaks: [4, 5] }), C)).toMatchObject({ ok: false, reason: 'few-punches' })
  })

  it('fails when the hand was mostly out of view', () => {
    expect(computeCalibration(input({ moveSeen: 0.3 }), C)).toMatchObject({ ok: false, reason: 'no-hand' })
  })

  it('never goes below CALIB_MIN_RATE', () => {
    const out = computeCalibration(input({ stillGrowth: [0], moveGrowth: [0], punchPeaks: [1.5, 2, 2] }), C)
    expect(out.ok && out.calibration.strikeRate).toBe(C.CALIB_MIN_RATE)
  })
})

describe('CalibrationSession', () => {
  it('runs the three steps and finds the punches', () => {
    let now = 0
    const s = new CalibrationSession(now, C)
    const step = (ms: number, growth: (t: number) => number | null) => {
      for (let t = 0; t < ms; t += 33) {
        now += 33
        const g = growth(t)
        s.addFrame(g === null ? [] : [{ growth: g, fist: 0.9 }], now)
        s.tick(now)
      }
    }

    step(3000, () => 0) // get ready
    step(STEPS[0].ms, (t) => Math.sin(t) * 0.3) // still
    step(3000, () => 0)
    step(STEPS[1].ms, (t) => Math.sin(t / 50) * 1.2) // moving around, max ~1.2
    step(3000, () => 0)
    // three punches 1s apart, peaks 4, 5, 6; the second loses the hand mid-punch
    const peaks = [4, 5, 6]
    step(3600, (t) => {
      const i = Math.floor(t / 1000)
      const phase = t % 1000
      if (i > 2 || phase > 100) return 0
      if (i === 1 && phase > 60) return null
      return phase < 50 ? peaks[i] / 2 : peaks[i]
    })

    const view = s.view(now)
    expect(view.kind).toBe('done')
    if (view.kind !== 'done' || !view.outcome.ok) throw new Error('calibration failed')
    expect(view.outcome.calibration.punchPeaks).toEqual([4, 5, 6])
    expect(view.outcome.calibration.noiseMax).toBeCloseTo(1.2, 1)
    expect(view.outcome.calibration.strikeRate).toBeGreaterThan(1.2)
    expect(view.outcome.calibration.strikeRate).toBeLessThan(4)
  })
})
