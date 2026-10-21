import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { ShardSim } from '../src/physics/world'

const bounds = { width: 1280, height: 720, cameraZ: 1142 }
const DT = 1 / 60

function sim() {
  return new ShardSim({ ...bounds })
}

/** Runs the sim and returns when each body was removed (ms), or null if still alive. */
function run(s: ShardSim, ms: number) {
  const removedAt = new Map<unknown, number>()
  for (let t = 0; t <= ms; t += DT * 1000) {
    for (const b of s.step(DT, t)) removedAt.set(b, t)
  }
  return removedAt
}

describe('ShardSim', () => {
  it('launches shards out of the wall toward the camera', () => {
    const s = sim()
    const b = s.spawn(new Vector3(100, 0, -10), new Vector3(0, 0, -10), 30, 1, 0, () => 0.5)
    expect(b.vel.z).toBeGreaterThan(0)
    expect(b.vel.x).toBeGreaterThan(0) // away from the impact point
    s.step(DT, 16)
    expect(b.pos.z).toBeGreaterThan(-10)
  })

  it('harder punches throw shards faster', () => {
    const s = sim()
    const soft = s.spawn(new Vector3(50, 0, 0), new Vector3(0, 0, 0), 30, 0, 0, () => 0.5)
    const hard = s.spawn(new Vector3(50, 0, 0), new Vector3(0, 0, 0), 30, 1, 0, () => 0.5)
    expect(hard.vel.length()).toBeGreaterThan(soft.vel.length() * 2)
  })

  it('lands on the floor and never sinks through it', () => {
    const s = new ShardSim({ ...bounds, cameraZ: 1e9 }) // ignore the near-camera cutoff here
    const b = s.spawn(new Vector3(0, 0, 0), new Vector3(0, 50, 0), 40, 0.2, 0, () => 0.5)
    let lowest = Infinity
    for (let t = 0; t < 3000; t += DT * 1000) {
      s.step(DT, t)
      lowest = Math.min(lowest, b.pos.y)
    }
    const floor = -bounds.height / 2
    expect(lowest).toBeGreaterThanOrEqual(floor)
    expect(b.pos.y).toBeLessThan(floor + 40) // settled on it
    expect(Math.abs(b.vel.y)).toBeLessThan(50)
  })

  it('removes shards after their lifetime', () => {
    const s = new ShardSim({ ...bounds, cameraZ: 1e9 })
    const b = s.spawn(new Vector3(0, -300, 0), new Vector3(0, -250, 0), 20, 0, 0, () => 0.5)
    const removed = run(s, 5000)
    expect(removed.get(b)).toBeGreaterThan(3900)
    expect(s.bodies).toHaveLength(0)
  })

  it('removes shards before they fly through the camera', () => {
    const s = new ShardSim({ ...bounds, cameraZ: 300 })
    const b = s.spawn(new Vector3(0, 0, 0), new Vector3(0, 0, 0), 20, 1, 0, () => 0.99)
    const removed = run(s, 2000)
    expect(removed.get(b)).toBeLessThan(1000)
  })
})
