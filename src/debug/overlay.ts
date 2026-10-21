import type { Config } from '../config'
import { HAND_CONNECTIONS } from '../tracking/handTracker'
import type { Box, Point } from '../tracking/features'
import type { HandTrack, Punch, PunchDetector, PunchState } from '../tracking/punchDetector'

export interface ScreenHand {
  id: string
  points: Point[]
  box: Box
  center: Point
}

export interface Stats {
  fps: number
  trackFps: number
  inferMs: number
  shards: number
  status: string
  /** ms recorded so far, or null when the logger is off */
  logMs: number | null
  logFrames: number
}

interface Sample {
  t: number
  growth: number
  state: PunchState
}

const HISTORY_MS = 3000
const GRAPH_MIN = -4

export const STATE_COLORS: Record<PunchState, string> = {
  IDLE: '#9ab',
  FIST_READY: '#fc3',
  STRIKING: '#f80',
  HIT: '#f33',
  COOLDOWN: '#b8f',
}

export class DebugOverlay {
  log: Punch[] = []
  private history = new Map<string, Sample[]>()

  record(detector: PunchDetector, now: number) {
    for (const track of detector.tracks.values()) {
      let samples = this.history.get(track.id)
      if (!samples) this.history.set(track.id, (samples = []))
      samples.push({ t: now, growth: track.growth, state: track.state })
    }
    for (const [id, samples] of this.history) {
      while (samples.length && now - samples[0].t > HISTORY_MS) samples.shift()
      if (!samples.length) this.history.delete(id)
    }
  }

  addPunch(punch: Punch) {
    this.log.unshift(punch)
    this.log.length = Math.min(this.log.length, 5)
  }

  /** Small aim marker, shown even with debug off so you know where you'll hit. */
  drawReticles(ctx: CanvasRenderingContext2D, hands: ScreenHand[], detector: PunchDetector) {
    for (const hand of hands) {
      const state = detector.tracks.get(hand.id)?.state ?? 'IDLE'
      const { x, y } = hand.center
      ctx.strokeStyle = STATE_COLORS[state]
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, Math.PI * 2)
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ctx.moveTo(x + dx * 10, y + dy * 10)
        ctx.lineTo(x + dx * 26, y + dy * 26)
      }
      ctx.stroke()
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    hands: ScreenHand[],
    detector: PunchDetector,
    stats: Stats,
    now: number,
  ) {
    ctx.font = '12px ui-monospace, Consolas, monospace'
    ctx.textBaseline = 'top'

    for (const hand of hands) this.drawSkeleton(ctx, hand)

    let y = 44
    for (const track of detector.tracks.values()) {
      this.drawPanel(ctx, track, detector.config, 12, y, now)
      y += 172
    }

    this.drawStats(ctx, stats)
    this.drawLog(ctx, now)
  }

  /** Shown with debug off too, so you can't forget the logger is running. */
  drawRecording(ctx: CanvasRenderingContext2D, stats: Stats, now: number) {
    if (stats.logMs === null) return
    const text = `REC ${(stats.logMs / 1000).toFixed(1)}s  ${stats.logFrames} frames  (L to stop + save)`
    ctx.font = '12px ui-monospace, Consolas, monospace'
    ctx.textBaseline = 'top'
    const w = ctx.measureText(text).width + 30
    const x = ctx.canvas.clientWidth / 2 - w / 2
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.fillRect(x, 12, w, 22)
    ctx.fillStyle = Math.floor(now / 500) % 2 ? '#f33' : '#800'
    ctx.beginPath()
    ctx.arc(x + 12, 23, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x + 22, 17)
  }

  private drawSkeleton(ctx: CanvasRenderingContext2D, hand: ScreenHand) {
    const { points, box, center } = hand
    ctx.strokeStyle = 'rgba(0,255,170,0.9)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const { start, end } of HAND_CONNECTIONS) {
      ctx.moveTo(points[start].x, points[start].y)
      ctx.lineTo(points[end].x, points[end].y)
    }
    ctx.stroke()

    ctx.fillStyle = '#fff'
    for (const p of points) ctx.fillRect(p.x - 2, p.y - 2, 4, 4)

    // the palm-size segment the growth rate is measured on
    ctx.strokeStyle = '#fc3'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    ctx.lineTo(points[9].x, points[9].y)
    ctx.stroke()

    ctx.fillStyle = '#fff'
    ctx.fillText(hand.id, box.minX, box.minY - 16)
    ctx.fillRect(center.x - 3, center.y - 3, 6, 6)
  }

  private drawPanel(ctx: CanvasRenderingContext2D, track: HandTrack, c: Config, x: number, y: number, now: number) {
    const w = 280
    const barW = w - 16
    const recentHit = this.log.find((p) => p.hand === track.id && now - p.time < 300)

    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(x, y, w, 160)

    // header: hand, state, palm size
    ctx.fillStyle = '#fff'
    ctx.fillText(track.id, x + 8, y + 8)
    ctx.fillStyle = recentHit ? STATE_COLORS.HIT : STATE_COLORS[track.state]
    ctx.fillText(recentHit ? 'HIT' : track.state, x + 64, y + 8)
    ctx.fillStyle = '#ccc'
    ctx.fillText(`palm ${track.palmSize.toFixed(3)}`, x + 176, y + 8)

    // fist bar with FIST_OFF and FIST_ON ticks
    ctx.fillStyle = '#333'
    ctx.fillRect(x + 8, y + 28, barW, 10)
    ctx.fillStyle = track.fist > c.FIST_ON ? '#fc3' : track.fist < c.FIST_OFF ? '#68a' : '#a98'
    ctx.fillRect(x + 8, y + 28, barW * track.fist, 10)
    for (const v of [c.FIST_OFF, c.FIST_ON]) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(x + 8 + barW * v - 1, y + 25, 2, 16)
    }
    ctx.fillStyle = '#ccc'
    ctx.fillText(`fist ${track.fist.toFixed(2)}  (off ${c.FIST_OFF} / on ${c.FIST_ON})`, x + 8, y + 44)

    ctx.fillStyle = track.growth > c.STRIKE_RATE ? '#f33' : '#ccc'
    ctx.fillText(`growth ${track.growth.toFixed(2)}/s   strike ${c.STRIKE_RATE.toFixed(2)}/s`, x + 8, y + 60)

    // growth graph
    const gx = x + 8
    const gy = y + 78
    const gw = barW
    const gh = 74
    const top = Math.max(8, c.STRIKE_RATE * 2)
    const toY = (v: number) => gy + gh - ((Math.min(top, Math.max(GRAPH_MIN, v)) - GRAPH_MIN) / (top - GRAPH_MIN)) * gh
    const toX = (t: number) => gx + gw - ((now - t) / HISTORY_MS) * gw

    ctx.fillStyle = '#111'
    ctx.fillRect(gx, gy, gw, gh)
    const hline = (v: number, color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(gx, toY(v))
      ctx.lineTo(gx + gw, toY(v))
      ctx.stroke()
    }
    hline(0, '#444')
    hline(c.STRIKE_RATE, 'rgba(255,60,60,0.9)')

    const samples = this.history.get(track.id) ?? []
    ctx.lineWidth = 2
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]
      const b = samples[i]
      ctx.strokeStyle = STATE_COLORS[b.state]
      ctx.beginPath()
      ctx.moveTo(toX(a.t), toY(a.growth))
      ctx.lineTo(toX(b.t), toY(b.growth))
      ctx.stroke()
    }

    // hits as vertical markers
    ctx.fillStyle = '#f33'
    for (const p of this.log) {
      if (p.hand === track.id && now - p.time < HISTORY_MS) ctx.fillRect(toX(p.time) - 1, gy, 2, gh)
    }
  }

  private drawStats(ctx: CanvasRenderingContext2D, stats: Stats) {
    const text =
      `render ${stats.fps.toFixed(0)} fps   tracking ${stats.trackFps.toFixed(0)} fps   ` +
      `inference ${stats.inferMs.toFixed(1)}ms   shards ${stats.shards}   ${stats.status}`
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(12, 12, ctx.measureText(text).width + 16, 22)
    ctx.fillStyle = '#0f8'
    ctx.fillText(text, 20, 17)
  }

  private drawLog(ctx: CanvasRenderingContext2D, now: number) {
    const bottom = ctx.canvas.clientHeight - 16
    this.log.forEach((p, i) => {
      const ago = ((now - p.time) / 1000).toFixed(1)
      const peak = p.reason === 'click' ? '' : `  peak ${p.peak.toFixed(2)}/s`
      const text = `${ago}s ago  ${p.hand}  ${p.reason}  strength ${p.strength.toFixed(2)}${peak}`
      const y = bottom - (i + 1) * 18
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(12, y - 3, ctx.measureText(text).width + 12, 18)
      ctx.fillStyle = i === 0 && now - p.time < 1000 ? '#f66' : '#ccc'
      ctx.fillText(text, 18, y)
    })
  }
}
