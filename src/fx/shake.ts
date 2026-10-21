// "Trauma" style shake: hits add trauma, it decays linearly, and the offset
// scales with trauma^2 so small hits stay subtle and big ones really rattle.
let trauma = 0

export function addShake(amount: number) {
  trauma = Math.min(1, trauma + amount)
}

export function applyShake(ctx: CanvasRenderingContext2D, dt: number) {
  trauma = Math.max(0, trauma - dt / 350)
  if (trauma === 0) return
  const k = trauma * trauma
  const maxOffset = 14
  ctx.translate((Math.random() * 2 - 1) * maxOffset * k, (Math.random() * 2 - 1) * maxOffset * k)
  ctx.rotate((Math.random() * 2 - 1) * 0.012 * k)
}

export function resetShake() {
  trauma = 0
}
