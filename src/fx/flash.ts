interface Flash {
  x: number
  y: number
  strength: number
  start: number
}

let flashes: Flash[] = []

export function addFlash(x: number, y: number, strength: number, now: number) {
  flashes.push({ x, y, strength, start: now })
}

export function drawFlashes(ctx: CanvasRenderingContext2D, width: number, height: number, now: number) {
  flashes = flashes.filter((f) => now - f.start < 260)

  for (const f of flashes) {
    const age = now - f.start

    if (age < 120) {
      ctx.fillStyle = `rgba(255,255,255,${0.6 * f.strength * (1 - age / 120)})`
      ctx.fillRect(0, 0, width, height)
    }

    const t = age / 260
    const r = (120 + 220 * f.strength) * (0.6 + t)
    const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
    glow.addColorStop(0, `rgba(255,245,220,${0.9 * (1 - t)})`)
    glow.addColorStop(0.4, `rgba(255,200,140,${0.35 * (1 - t)})`)
    glow.addColorStop(1, 'rgba(255,180,120,0)')
    ctx.fillStyle = glow
    ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2)
  }
}
