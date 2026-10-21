import Matter from 'matter-js'
import type { Shard } from '../wall/shatter'

const { Engine, Bodies, Body, Composite } = Matter

const MAX_SHARDS = 400
const LIFETIME = 4000
const FADE = 800
const STEP = 1000 / 60

interface LiveShard {
  body: Matter.Body
  shard: Shard
  born: number
}

export class ShardWorld {
  engine = Engine.create({ gravity: { x: 0, y: 1 } })
  shards: LiveShard[] = []
  private floor: Matter.Body | null = null
  private width = 0
  private height = 0
  private pending = 0

  resize(width: number, height: number) {
    this.width = width
    this.height = height
    if (this.floor) Composite.remove(this.engine.world, this.floor)
    this.floor = Bodies.rectangle(width / 2, height + 30, width * 3, 60, { isStatic: true })
    Composite.add(this.engine.world, this.floor)
  }

  add(shard: Shard, impact: { x: number; y: number }, strength: number, now: number) {
    const body = Bodies.fromVertices(shard.center.x, shard.center.y, [shard.vertices], {
      restitution: 0.15,
      friction: 0.6,
      frictionAir: 0.012,
      density: 0.002,
    })

    const dx = shard.center.x - impact.x
    const dy = shard.center.y - impact.y
    const d = Math.hypot(dx, dy) || 1
    const speed = (3 + 9 * strength) * (0.4 + Math.random() * 0.8)
    Body.setVelocity(body, {
      x: (dx / d) * speed,
      y: (dy / d) * speed - (2 + 4 * strength) * Math.random(),
    })
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.35 * strength)

    Composite.add(this.engine.world, body)
    this.shards.push({ body, shard, born: now })

    while (this.shards.length > MAX_SHARDS) this.remove(0)
  }

  step(dt: number, now: number) {
    // fixed steps keep the sim stable when a frame hitches
    this.pending = Math.min(this.pending + dt, 100)
    while (this.pending >= STEP) {
      Engine.update(this.engine, STEP)
      this.pending -= STEP
    }

    for (let i = this.shards.length - 1; i >= 0; i--) {
      const { body, born } = this.shards[i]
      const { x, y } = body.position
      const gone = y > this.height + 300 || x < -300 || x > this.width + 300
      if (gone || now - born > LIFETIME) this.remove(i)
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number) {
    for (const { body, shard, born } of this.shards) {
      const age = now - born
      // shards "pop" toward you a little as they break off
      const pop = 1 + 0.18 * (1 - (1 - Math.min(age / 250, 1)) ** 3)
      ctx.save()
      ctx.globalAlpha = Math.min(1, (LIFETIME - age) / FADE)
      ctx.translate(body.position.x, body.position.y)
      ctx.rotate(body.angle)
      ctx.scale(pop, pop)
      ctx.drawImage(shard.canvas, shard.offsetX, shard.offsetY, shard.width, shard.height)
      ctx.restore()
    }
  }

  clear() {
    while (this.shards.length) this.remove(this.shards.length - 1)
  }

  private remove(index: number) {
    Composite.remove(this.engine.world, this.shards[index].body)
    this.shards.splice(index, 1)
  }
}

