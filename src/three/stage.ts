import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { ShardWorld } from '../physics/world'
import type { Point } from '../tracking/features'
import type { PunchState } from '../tracking/punchDetector'
import type { Shard, Wall } from '../wall/shatter'

const FOV = 35
const LOW_POWER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Fist light brightness per detector state, as a multiple of the base level. */
const AIM_LEVEL: Record<PunchState, number> = {
  IDLE: 0.8,
  FIST_READY: 1.8,
  STRIKING: 2.6,
  HIT: 2.6,
  COOLDOWN: 1.2,
}

export interface Aim {
  x: number
  y: number
  state: PunchState
}

/** A damped spring, used for the camera punch-in. */
class Spring {
  x = 0
  v = 0
  constructor(
    private omega: number,
    private zeta: number,
  ) {}

  /** Pushes the spring so its first swing peaks at about `amplitude`. */
  kick(amplitude: number) {
    // for damping around 0.4-0.45, an impulse v peaks at roughly 0.6 * v / omega
    this.v += (amplitude * this.omega) / 0.6
  }

  /** Fixed small substeps: one big step on a slow frame would blow the spring up. */
  step(dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.004))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const a = -this.omega * this.omega * this.x - 2 * this.zeta * this.omega * this.v
      this.v += a * h
      this.x += this.v * h
    }
  }

  reset() {
    this.x = this.v = 0
  }
}

/**
 * The Three.js scene: the brick wall as a lit slab at z = 0, the 3D shards,
 * and the camera. The camera is placed so the z = 0 plane lines up 1:1 with
 * screen pixels, so hit points, reticles and the 2D overlay all still match.
 */
export class Stage {
  renderer: WebGLRenderer
  scene = new Scene()
  camera = new PerspectiveCamera(FOV, 1, 1, 10000)
  world: ShardWorld

  private width = 1
  private height = 1
  private cameraZ = 1

  private wallMaterial = new MeshStandardMaterial({ transparent: true, alphaTest: 0.5, roughness: 0.92, metalness: 0 })
  private wallMesh = new Mesh(new PlaneGeometry(1, 1), this.wallMaterial)
  private wallTexture: CanvasTexture | null = null
  private bumpTexture: CanvasTexture | null = null
  /** broken-brick cross-section: hole rims and shard sides */
  private interior = new MeshStandardMaterial({ color: new Color('#6b3424'), roughness: 1, side: DoubleSide })
  private rims = new Group()

  private key = new DirectionalLight('#fff4e8', 1.1)
  private fill = new HemisphereLight('#fff8f0', '#3a2a22', 2.6)
  private fist = new PointLight('#ffb070', 0, 0, 2)
  private fistLevel = 0
  private fistFlash = 0

  // dolly is nearly critically damped so it doesn't swing back past rest
  private dolly = new Spring(22, 0.9)
  private roll = new Spring(28, 0.4)
  private tilt = new Spring(26, 0.45)

  constructor(
    canvas: HTMLCanvasElement,
    private wall: Wall,
  ) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.renderer.setClearColor(0x000000, 0)
    // the wall texture is already "final" colour; don't remap it
    this.renderer.toneMapping = NoToneMapping
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.shadowMap.enabled = !LOW_POWER
    this.renderer.shadowMap.type = PCFShadowMap

    this.world = new ShardWorld(this.interior)

    this.wallMesh.receiveShadow = true
    this.key.castShadow = !LOW_POWER
    this.key.shadow.mapSize.set(1024, 1024)
    this.key.shadow.bias = -0.0005

    this.scene.add(this.wallMesh, this.rims, this.world.group, this.key, this.key.target, this.fill, this.fist)
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width
    this.height = height
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)

    this.cameraZ = height / 2 / Math.tan(MathUtils.degToRad(FOV / 2))
    this.camera.aspect = width / height
    this.camera.near = 1
    this.camera.far = this.cameraZ * 4
    this.camera.updateProjectionMatrix()
    this.placeCamera()

    this.wallMesh.geometry.dispose()
    this.wallMesh.geometry = new PlaneGeometry(width, height)

    // light from the top-left, far enough back to cover the whole wall
    this.key.position.set(-width * 0.5, height * 0.7, this.cameraZ * 0.9)
    const cam = this.key.shadow.camera
    cam.left = -width * 0.75
    cam.right = width * 0.75
    cam.top = height * 0.75
    cam.bottom = -height * 0.75
    cam.near = 1
    cam.far = this.cameraZ * 3
    cam.updateProjectionMatrix()

    this.world.resize({ width, height, cameraZ: this.cameraZ })
    this.wallRebuilt()
  }

  /** Call after the wall's canvas was repainted from scratch (resize or reset). */
  wallRebuilt() {
    // canvas size may have changed, which needs a fresh texture
    this.wallTexture?.dispose()
    this.bumpTexture?.dispose()
    this.wallTexture = new CanvasTexture(this.wall.canvas)
    this.wallTexture.colorSpace = SRGBColorSpace
    this.bumpTexture = new CanvasTexture(this.wall.bump)
    this.wallMaterial.map = this.wallTexture
    this.wallMaterial.bumpMap = this.bumpTexture
    this.wallMaterial.bumpScale = 3
    this.wallMaterial.needsUpdate = true

    for (const rim of this.rims.children as Mesh[]) rim.geometry.dispose()
    this.rims.clear()
    this.world.clear()
    this.dolly.reset()
    this.roll.reset()
    this.tilt.reset()
  }

  /** A hit just cut `shards` out of the wall at screen point (x, y). */
  addPunch(shards: Shard[], x: number, y: number, strength: number, now: number) {
    const depth = this.wall.thickness
    if (this.wallTexture) this.wallTexture.needsUpdate = true
    for (const shard of shards) this.world.add(shard, { x, y }, strength, depth, now)
    if (shards.length) this.addRim(shards.map((s) => s.vertices), depth)

    // the camera lurches in, with a little twist
    const side = Math.random() < 0.5 ? -1 : 1
    this.dolly.kick(this.cameraZ * 0.06 * strength)
    this.roll.kick(side * MathUtils.degToRad(1.4) * strength)
    this.tilt.kick((Math.random() - 0.5) * MathUtils.degToRad(1.2) * strength)

    // light flash at the impact
    this.fist.position.set(x - this.width / 2, this.height / 2 - y, this.fist.position.z)
    this.fistFlash = 3 + 4 * strength
  }

  /** Each frame: physics, camera spring, fist light. `aim` is the tracked fist, if any. */
  update(dtMs: number, now: number, aim: Aim | null) {
    const dt = Math.min(dtMs, 50) / 1000
    this.world.step(dtMs, now)

    this.dolly.step(dt)
    this.roll.step(dt)
    this.tilt.step(dt)
    this.placeCamera()

    // fist light: eases toward the hand, brightness follows the detector state
    const reach = Math.min(this.width, this.height) * 0.28
    const ease = 1 - Math.exp(-14 * dt)
    if (aim) {
      this.fist.position.x += (aim.x - this.width / 2 - this.fist.position.x) * ease
      this.fist.position.y += (this.height / 2 - aim.y - this.fist.position.y) * ease
    }
    this.fist.position.z = reach
    const target = aim ? AIM_LEVEL[aim.state] : 0
    this.fistLevel += (target - this.fistLevel) * (1 - Math.exp(-6 * dt))
    this.fistFlash *= Math.exp(-7 * dt)
    // physically based falloff: scale by distance² so it looks the same on any screen
    this.fist.intensity = (this.fistLevel + this.fistFlash) * reach * reach
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  get shardCount() {
    return this.world.shards.length
  }

  /**
   * The wall plane is exactly screen-sized, so the camera may only twist as
   * far as the dolly's zoom-in leaves spare wall around the edges.
   */
  private placeCamera() {
    const dolly = Math.max(0, this.dolly.x)
    const zoom = this.cameraZ / (this.cameraZ - dolly) - 1
    const w = this.width
    const h = this.height
    const maxRoll = (zoom * Math.min(w, h)) / Math.max(w, h)
    const maxTilt = (zoom * h) / 2 / this.cameraZ
    this.camera.position.set(0, 0, this.cameraZ - dolly)
    this.camera.rotation.set(
      MathUtils.clamp(this.tilt.x, -maxTilt, maxTilt),
      0,
      MathUtils.clamp(this.roll.x, -maxRoll, maxRoll),
    )
  }

  /**
   * The inside faces of the new hole, so the wall reads as a thick slab.
   * Only edges on the outline of the punched area get a face: an edge shared
   * by two removed shards was inside the hole.
   */
  private addRim(polys: Point[][], depth: number) {
    const key = (a: Point, b: Point) => `${a.x.toFixed(2)},${a.y.toFixed(2)}>${b.x.toFixed(2)},${b.y.toFixed(2)}`
    const edges = new Map<string, [Point, Point]>()
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        const back = key(b, a)
        if (edges.has(back)) edges.delete(back)
        else edges.set(key(a, b), [a, b])
      }
    }

    const w = this.width
    const h = this.height
    const pos: number[] = []
    for (const [a, b] of edges.values()) {
      const ax = a.x - w / 2
      const ay = h / 2 - a.y
      const bx = b.x - w / 2
      const by = h / 2 - b.y
      pos.push(ax, ay, 0, bx, by, 0, bx, by, -depth)
      pos.push(ax, ay, 0, bx, by, -depth, ax, ay, -depth)
    }
    if (!pos.length) return

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geometry.computeVertexNormals()
    const rim = new Mesh(geometry, this.interior)
    rim.receiveShadow = true
    this.rims.add(rim)
  }
}
