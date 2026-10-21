import { HAND_CONNECTIONS } from '../tracking/handTracker'
import type { Box, Point } from '../tracking/features'
import type { HandTrack, Punch, PunchDetector } from '../tracking/punchDetector'

export interface ScreenHand {
  id: string
  points: Point[]
  box: Box
  center: Point
}

export interface Stats {
  fps: number
  inferMs: number
  shards: number
  status: string
}

interface Sample {
  t: number
  growth: number
  fist: boolean
}

const HISTORY_MS = 2000
const GRAPH_MIN = -4
const GRAPH_MAX = 8
const STATE_COLORS: Record<string, string> = {
  warmup: '#888',
  idle: '#9ad',
  fist: '#fc6',
  primed: '#f80',
  cooldown: '#c6f',
}

export class DebugOverlay {
  log: Punch[] = []
  private history = new Map<string, Sample[]>()

  record(detector: PunchDetector, now: number) {
    for (const track of detector.tracks.values()) {
      let samples = this.history.get(track.id)
      if (!samples) this.history.set(track.id, (samples = []))
      samples.push({ t: now, growth: track.growth, fist: track.fist >= detector.tuning.fistMin })
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
      const track = detector.tracks.get(hand.id)
      const color = STATE_COLORS[track?.state ?? 'idle']
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(hand.center.x, hand.center.y, 18, 0, Math.PI * 2)
      ctx.moveTo(hand.center.x - 26, hand.center.y)
      ctx.lineTo(hand.center.x - 10, hand.center.y)
      ctx.moveTo(hand.center.x + 10, hand.center.y)
      ctx.lineTo(hand.center.x + 26, hand.center.y)
      ctx.moveTo(hand.center.x, hand.center.y - 26)
      ctx.lineTo(hand.center.x, hand.center.y - 10)
      ctx.moveTo(hand.center.x, hand.center.y + 10)
      ctx.lineTo(hand.center.x, hand.center.y + 26)
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
      this.drawPanel(ctx, track, detector, 12, y, now)
      y += 150
    }

    this.drawStats(ctx, stats)
    this.drawLog(ctx, now)
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

    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
    ctx.setLineDash([])

    ctx.fillStyle = '#fff'
    ctx.fillText(hand.id, box.minX, box.minY - 16)
    ctx.fillRect(center.x - 3, center.y - 3, 6, 6)
  }

  private drawPanel(
    ctx: CanvasRenderingContext2D,
    track: HandTrack,
    detector: PunchDetector,
    x: number,
    y: number,
    now: number,
  ) {
    const { fistMin, growthMin, growthPrimed } = detector.tuning
    const w = 260
    const recentPunch = this.log.find((p) => p.hand === track.id && now - p.time < 300)

    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(x, y, w, 138)

    ctx.fillStyle = '#fff'
    ctx.fillText(track.id, x + 8, y + 8)
    ctx.fillStyle = recentPunch ? '#f44' : STATE_COLORS[track.state]
    ctx.fillText(recentPunch ? 'PUNCH!' : track.state, x + 70, y + 8)
    ctx.fillStyle = '#ccc'
    ctx.fillText(`size ${track.size.toFixed(0)}px`, x + 170, y + 8)

    // fist bar with a tick at the threshold
    const barW = w - 16
    ctx.fillStyle = '#333'
    ctx.fillRect(x + 8, y + 26, barW, 10)
    ctx.fillStyle = track.fist >= fistMin ? '#fc6' : '#68a'
    ctx.fillRect(x + 8, y + 26, barW * track.fist, 10)
    ctx.fillStyle = '#fff'
    ctx.fillRect(x + 8 + barW * fistMin - 1, y + 23, 2, 16)
    ctx.fillText(`fist ${track.fist.toFixed(2)}`, x + 8, y + 40)

    ctx.fillStyle = track.growth >= growthMin ? '#f44' : track.growth >= growthPrimed ? '#f80' : '#ccc'
    ctx.fillText(`growth ${track.growth.toFixed(2)}/s`, x + 120, y + 40)

    // growth sparkline
    const gx = x + 8
    const gy = y + 58
    const gw = barW
    const gh = 72
    const toY = (v: number) =>
      gy + gh - ((Math.min(GRAPH_MAX, Math.max(GRAPH_MIN, v)) - GRAPH_MIN) / (GRAPH_MAX - GRAPH_MIN)) * gh

    ctx.fillStyle = '#111'
    ctx.fillRect(gx, gy, gw, gh)
    const line = (v: number, color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(gx, toY(v))
      ctx.lineTo(gx + gw, toY(v))
      ctx.stroke()
    }
    line(0, '#444')
    line(growthPrimed, 'rgba(255,136,0,0.6)')
    line(growthMin, 'rgba(255,68,68,0.8)')

    const samples = this.history.get(track.id) ?? []
    ctx.lineWidth = 2
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]
      const b = samples[i]
      ctx.strokeStyle = b.fist ? '#fc6' : '#68a'
      ctx.beginPath()
      ctx.moveTo(gx + gw - ((now - a.t) / HISTORY_MS) * gw, toY(a.growth))
      ctx.lineTo(gx + gw - ((now - b.t) / HISTORY_MS) * gw, toY(b.growth))
      ctx.stroke()
    }
  }

  private drawStats(ctx: CanvasRenderingContext2D, stats: Stats) {
    const text = `${stats.fps.toFixed(0)} fps   inference ${stats.inferMs.toFixed(1)}ms   shards ${stats.shards}   ${stats.status}`
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(12, 12, ctx.measureText(text).width + 16, 22)
    ctx.fillStyle = '#0f8'
    ctx.fillText(text, 20, 17)
  }

  private drawLog(ctx: CanvasRenderingContext2D, now: number) {
    const bottom = ctx.canvas.clientHeight - 16
    this.log.forEach((p, i) => {
      const ago = ((now - p.time) / 1000).toFixed(1)
      const text = `${ago}s ago  ${p.hand}  ${p.reason}  strength ${p.strength.toFixed(2)}`
      const y = bottom - (i + 1) * 18
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(12, y - 3, ctx.measureText(text).width + 12, 18)
      ctx.fillStyle = i === 0 && now - p.time < 1000 ? '#f66' : '#ccc'
      ctx.fillText(text, 18, y)
    })
  }
}
