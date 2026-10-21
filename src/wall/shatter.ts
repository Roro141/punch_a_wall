import { Delaunay } from 'd3-delaunay'
import Matter from 'matter-js'
import { paintBrickWall } from './texture'
import type { Point } from '../tracking/features'

export interface Shard {
  canvas: HTMLCanvasElement
  width: number
  height: number
  vertices: Point[]
  center: Point
  // where the shard image's top-left sits relative to its center of mass
  offsetX: number
  offsetY: number
}

export class Wall {
  canvas = document.createElement('canvas')
  ctx = this.canvas.getContext('2d')!
  width = 0
  height = 0
  dpr = 1
  private holes: Point[][] = []

  resize(width: number, height: number, dpr: number) {
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.rebuild()
  }

  rebuild() {
    this.holes = []
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.ctx.globalCompositeOperation = 'source-over'
    paintBrickWall(this.ctx, this.width, this.height)
  }

  shatterAt(x: number, y: number, strength: number): Shard[] {
    const scale = Math.min(this.width, this.height) / 800
    const radius = (70 + 90 * strength) * scale
    const count = Math.round(35 + 35 * strength)

    // Inner seeds become shards; r = R * u^1.4 packs them toward the impact
    // so the middle breaks into small bits and the edge into bigger chunks.
    const seeds: [number, number][] = []
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const r = radius * Math.random() ** 1.4
      seeds.push([x + Math.cos(a) * r, y + Math.sin(a) * r])
    }
    // Outer ring seeds only exist to give us crack lines around the hole.
    const ring = 14
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + Math.random() * 0.4
      const r = radius * (1.25 + Math.random() * 0.5)
      seeds.push([x + Math.cos(a) * r, y + Math.sin(a) * r])
    }

    const reach = radius * 2.2
    const voronoi = Delaunay.from(seeds).voronoi([x - reach, y - reach, x + reach, y + reach])

    const shards: Shard[] = []
    const ctx = this.ctx
    ctx.save()

    for (let i = 0; i < count; i++) {
      const cell = voronoi.cellPolygon(i)
      if (!cell) continue
      const poly = cell.slice(0, -1).map(([px, py]) => ({ x: px, y: py }))
      if (Math.abs(Matter.Vertices.area(poly, true)) < 25) continue
      if (this.coverage(poly) < 0.4) continue

      shards.push(this.cutShard(poly))
      this.holes.push(poly)
    }

    // punch the holes after cutting, otherwise later shards would copy empty pixels
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = '#000'
    for (const shard of shards) {
      tracePolygon(ctx, shard.vertices)
      ctx.fill()
    }

    // soot + cracks, only on what's left of the wall
    ctx.globalCompositeOperation = 'source-atop'
    const soot = ctx.createRadialGradient(x, y, radius * 0.6, x, y, radius * 1.8)
    soot.addColorStop(0, 'rgba(20,14,10,0.55)')
    soot.addColorStop(1, 'rgba(20,14,10,0)')
    ctx.fillStyle = soot
    ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2)

    ctx.strokeStyle = 'rgba(18,12,8,0.75)'
    ctx.lineWidth = 1.5 * scale + 0.5
    ctx.beginPath()
    for (let i = count; i < seeds.length; i++) {
      const cell = voronoi.cellPolygon(i)
      if (!cell) continue
      for (let j = 0; j < cell.length - 1; j++) {
        const [ax, ay] = cell[j]
        const [bx, by] = cell[j + 1]
        // skip the straight edges along the voronoi bounds
        if (Math.hypot(ax - x, ay - y) > reach * 0.9 || Math.hypot(bx - x, by - y) > reach * 0.9) continue
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
      }
    }
    ctx.stroke()
    ctx.restore()

    return shards
  }

  private cutShard(poly: Point[]): Shard {
    const center = Matter.Vertices.centre(poly)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of poly) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    minX = Math.floor(minX) - 1
    minY = Math.floor(minY) - 1

    const width = Math.ceil(maxX - minX + 2)
    const height = Math.ceil(maxY - minY + 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * this.dpr)
    canvas.height = Math.ceil(height * this.dpr)
    const ctx = canvas.getContext('2d')!
    ctx.scale(this.dpr, this.dpr)
    ctx.translate(-minX, -minY)

    tracePolygon(ctx, poly)
    ctx.clip()
    ctx.drawImage(this.canvas, 0, 0, this.width, this.height)

    // dark rim + a faint highlight so shards read as chunks, not flat cutouts
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.stroke()
    ctx.translate(-1, -1)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255,230,210,0.18)'
    ctx.stroke()

    return { canvas, width, height, vertices: poly, center, offsetX: minX - center.x, offsetY: minY - center.y }
  }

  // Rough fraction of the cell that's still wall, so punching an existing
  // hole doesn't spawn a pile of invisible shards.
  private coverage(poly: Point[]) {
    if (this.holes.length === 0) return 1
    const c = Matter.Vertices.centre(poly)
    const samples = [c, ...poly.map((p) => ({ x: (p.x + c.x) / 2, y: (p.y + c.y) / 2 }))]
    const solid = samples.filter((s) => !this.holes.some((h) => insidePolygon(s, h))).length
    return solid / samples.length
  }
}

function tracePolygon(ctx: CanvasRenderingContext2D, poly: Point[]) {
  ctx.beginPath()
  ctx.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
  ctx.closePath()
}

function insidePolygon(p: Point, poly: Point[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}
