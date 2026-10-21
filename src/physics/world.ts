import {
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import type { Shard } from '../wall/shatter'

const LIFETIME = 4000
const FADE = 800
const GRAVITY = 2000 // px/s²
const AIR_DRAG = 0.7 // 1/s
const RESTITUTION = 0.2
const FLOOR_FRICTION = 6 // 1/s while sliding on the floor
const MAX_SHARDS = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 200 : 400

// ---------------------------------------------------------------------------
// Simulation: plain 3D rigid-ish bodies, no collisions between shards.
// World units are screen px; y points up, z points at the viewer.
// ---------------------------------------------------------------------------

export interface Body {
  pos: Vector3
  vel: Vector3
  quat: Quaternion
  /** unit axis + rad/s */
  spinAxis: Vector3
  spin: number
  /** rough half-size, used for the floor contact */
  radius: number
  born: number
}

export interface SimBounds {
  width: number
  height: number
  cameraZ: number
}

const tmpQuat = new Quaternion()

export class ShardSim {
  bodies: Body[] = []

  constructor(public bounds: SimBounds) {}

  /** `center` and `impact` are world positions on the wall (z = front face). */
  spawn(center: Vector3, impact: Vector3, radius: number, strength: number, now: number, rand = Math.random): Body {
    const out = new Vector3(center.x - impact.x, center.y - impact.y, 0)
    if (out.lengthSq() < 1e-6) out.set(rand() - 0.5, rand() - 0.5, 0)
    out.normalize()

    // same outward speeds as the old 2D version, plus a push toward the camera
    const speed = (180 + 540 * strength) * (0.4 + rand() * 0.8)
    const vel = new Vector3(
      out.x * speed,
      out.y * speed + (120 + 240 * strength) * rand(),
      (250 + 650 * strength) * (0.5 + rand() * 0.5),
    )

    const spinAxis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5)
    if (spinAxis.lengthSq() < 1e-6) spinAxis.set(1, 0, 0)
    spinAxis.normalize()

    const body: Body = {
      pos: center.clone(),
      vel,
      quat: new Quaternion(),
      spinAxis,
      spin: (1 + 9 * rand()) * (0.3 + 0.7 * strength),
      radius,
      born: now,
    }
    this.bodies.push(body)
    return body
  }

  /** Advances by `dt` seconds. Returns the bodies that should be removed. */
  step(dt: number, now: number): Body[] {
    const { width, height, cameraZ } = this.bounds
    const floor = -height / 2
    const drag = Math.exp(-AIR_DRAG * dt)
    const removed: Body[] = []

    for (const b of this.bodies) {
      b.vel.y -= GRAVITY * dt
      b.vel.multiplyScalar(drag)
      b.pos.addScaledVector(b.vel, dt)

      tmpQuat.setFromAxisAngle(b.spinAxis, b.spin * dt)
      b.quat.premultiply(tmpQuat).normalize()

      // floor: bounce, then slide to a stop
      const contact = floor + b.radius * 0.35
      if (b.pos.y < contact) {
        b.pos.y = contact
        if (b.vel.y < 0) b.vel.y = -b.vel.y * RESTITUTION
        const f = Math.exp(-FLOOR_FRICTION * dt)
        b.vel.x *= f
        b.vel.z *= f
        b.spin *= f
      }

      const gone =
        now - b.born > LIFETIME ||
        b.pos.z > cameraZ * 0.7 || // about to fly through the lens
        Math.abs(b.pos.x) > width ||
        b.pos.y < -height
      if (gone) removed.push(b)
    }

    if (removed.length) this.bodies = this.bodies.filter((b) => !removed.includes(b))
    return removed
  }

  remove(body: Body) {
    this.bodies = this.bodies.filter((b) => b !== body)
  }
}

// ---------------------------------------------------------------------------
// Rendering: one extruded mesh per shard
// ---------------------------------------------------------------------------

interface LiveShard {
  body: Body
  mesh: Mesh
  face: MeshStandardMaterial
  texture: CanvasTexture
}

export class ShardWorld {
  group = new Group()
  shards: LiveShard[] = []
  sim = new ShardSim({ width: 0, height: 0, cameraZ: 1 })

  constructor(private interior: Material) {}

  resize(bounds: SimBounds) {
    this.sim.bounds = bounds
  }

  /**
   * Turns a cut-out shard into a 3D chunk `depth` px thick, sitting exactly
   * where it was cut, and launches it away from `impact` (screen px).
   */
  add(shard: Shard, impact: { x: number; y: number }, strength: number, depth: number, now: number) {
    const { width: w, height: h } = this.sim.bounds
    const toWorld = (x: number, y: number) => new Vector3(x - w / 2, h / 2 - y, 0)

    // outline relative to the center of mass, y flipped to world-up
    const shape = new Shape(shard.vertices.map((p) => new Vector2(p.x - shard.center.x, shard.center.y - p.y)))
    const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false })
    // pivot at mid-depth so it tumbles around its middle
    geometry.translate(0, 0, -depth / 2)
    mapCapUVs(geometry, shard)

    const texture = new CanvasTexture(shard.canvas)
    texture.colorSpace = SRGBColorSpace
    const face = new MeshStandardMaterial({ map: texture, roughness: 0.9, transparent: true })
    const mesh = new Mesh(geometry, [face, this.interior])
    mesh.castShadow = true
    mesh.receiveShadow = true

    let radius = 0
    for (const p of shard.vertices) radius = Math.max(radius, Math.hypot(p.x - shard.center.x, p.y - shard.center.y))

    const center = toWorld(shard.center.x, shard.center.y)
    center.z = -depth / 2
    const body = this.sim.spawn(center, toWorld(impact.x, impact.y), radius, strength, now)
    this.sync(mesh, body)

    this.group.add(mesh)
    this.shards.push({ body, mesh, face, texture })
    while (this.shards.length > MAX_SHARDS) this.dispose(this.shards[0])
  }

  step(dtMs: number, now: number) {
    const dt = Math.min(dtMs, 50) / 1000
    for (const body of this.sim.step(dt, now)) {
      const live = this.shards.find((s) => s.body === body)
      if (live) this.dispose(live)
    }
    for (const s of this.shards) {
      this.sync(s.mesh, s.body)
      s.face.opacity = Math.min(1, (LIFETIME - (now - s.body.born)) / FADE)
    }
  }

  clear() {
    while (this.shards.length) this.dispose(this.shards[this.shards.length - 1])
  }

  private sync(mesh: Mesh, body: Body) {
    mesh.position.copy(body.pos)
    mesh.quaternion.copy(body.quat)
  }

  private dispose(s: LiveShard) {
    this.group.remove(s.mesh)
    s.mesh.geometry.dispose()
    s.face.dispose()
    s.texture.dispose()
    this.sim.remove(s.body)
    this.shards = this.shards.filter((x) => x !== s)
  }
}

/**
 * ExtrudeGeometry's default cap UVs are just the shape's xy. Remap them onto
 * the shard's own cut-out image so each chunk shows the bricks it was cut from.
 */
function mapCapUVs(geometry: ExtrudeGeometry, shard: Shard) {
  const pos = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const caps = geometry.groups.find((g) => g.materialIndex === 0)
  if (!caps) return
  for (let i = caps.start; i < caps.start + caps.count; i++) {
    // local world xy -> screen offset from the center -> shard image
    const sx = pos.getX(i)
    const sy = -pos.getY(i)
    uv.setXY(i, (sx - shard.offsetX) / shard.width, 1 - (sy - shard.offsetY) / shard.height)
  }
  uv.needsUpdate = true
}
