import type { Calibration } from '../calibration/calibrate'
import type { Config } from '../config'
import type { Punch, PunchState } from '../tracking/punchDetector'

export interface LogHand {
  id: string
  /** screen px */
  x: number
  y: number
  palm: number
  growth: number
  fist: number
  state: PunchState
}

export interface LogFrame {
  /** ms since recording started */
  t: number
  hands: LogHand[]
  /** thresholds at this frame: [STRIKE_RATE, FIST_ON, FIST_OFF], so slider changes show up in plots */
  th: [number, number, number]
}

export interface LogHit extends Omit<Punch, 'time'> {
  t: number
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4

/**
 * Records every tracked frame to memory while on. Stopping downloads the
 * session as JSON for scripts/plot_log.py. Nothing is sent anywhere.
 */
export class SessionLogger {
  recording = false
  private startedAt = 0
  private startedIso = ''
  private frames: LogFrame[] = []
  private hits: LogHit[] = []
  private configAtStart: Config | null = null

  start(now: number, config: Config) {
    this.recording = true
    this.startedAt = now
    this.startedIso = new Date().toISOString()
    this.frames = []
    this.hits = []
    this.configAtStart = { ...config }
  }

  get frameCount() {
    return this.frames.length
  }

  elapsed(now: number) {
    return this.recording ? now - this.startedAt : 0
  }

  record(now: number, hands: LogHand[], config: Config) {
    if (!this.recording) return
    this.frames.push({
      t: r4(now - this.startedAt),
      hands: hands.map((h) => ({
        ...h,
        x: Math.round(h.x),
        y: Math.round(h.y),
        palm: r4(h.palm),
        growth: r4(h.growth),
        fist: r4(h.fist),
      })),
      th: [config.STRIKE_RATE, config.FIST_ON, config.FIST_OFF],
    })
  }

  hit(punch: Punch) {
    if (!this.recording) return
    const { time, ...rest } = punch
    this.hits.push({ ...rest, peak: r4(rest.peak), strength: r4(rest.strength), t: r4(time - this.startedAt) })
  }

  /** Stops and downloads `punch-log-<timestamp>.json`. */
  stop(now: number, config: Config, calibration: Calibration | null, video: { width: number; height: number }) {
    if (!this.recording) return
    this.recording = false

    const data = {
      format: 'punch-wall-log',
      version: 1,
      startedAt: this.startedIso,
      durationMs: Math.round(now - this.startedAt),
      video,
      configAtStart: this.configAtStart,
      configAtEnd: { ...config },
      calibration,
      frames: this.frames,
      hits: this.hits,
    }

    const stamp = this.startedIso.replace(/\.\d+Z$/, '').replace(/:/g, '-')
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `punch-log-${stamp}.json`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)

    this.frames = []
    this.hits = []
  }
}
