/**
 * One Euro filter (Casiez et al. 2012): a low-pass filter whose cutoff rises
 * with speed. Still hands get heavy smoothing (no jitter), fast hands get
 * light smoothing (little lag), which is what punch detection needs.
 */
export interface EuroParams {
  minCutoff: number
  beta: number
  dCutoff: number
}

function alpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export class OneEuroFilter {
  private x: number | null = null
  private dx = 0
  private t = 0

  /** `t` is in seconds. */
  filter(value: number, t: number, p: EuroParams) {
    if (this.x === null) {
      this.x = value
      this.t = t
      return value
    }
    const dt = t - this.t
    if (dt <= 0) return this.x
    this.t = t

    const rawDx = (value - this.x) / dt
    this.dx += alpha(p.dCutoff, dt) * (rawDx - this.dx)

    const cutoff = p.minCutoff + p.beta * Math.abs(this.dx)
    this.x += alpha(cutoff, dt) * (value - this.x)
    return this.x
  }
}
