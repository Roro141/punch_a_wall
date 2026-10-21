const MORTAR = '#4a4440'

/** Brick size depends only on the wall width, so the color and height maps line up. */
export function brickLayout(width: number) {
  const brickW = Math.max(70, Math.round(width / 14))
  return {
    brickW,
    brickH: Math.round(brickW * 0.42),
    gap: Math.max(3, Math.round(brickW * 0.05)),
  }
}

function eachBrick(width: number, height: number, fn: (x: number, y: number, w: number, h: number) => void) {
  const { brickW, brickH, gap } = brickLayout(width)
  for (let row = 0, y = 0; y < height; row++, y += brickH + gap) {
    const shift = row % 2 ? -brickW / 2 : 0
    for (let x = shift; x < width; x += brickW + gap) fn(x, y, brickW, brickH)
  }
}

export function paintBrickWall(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = MORTAR
  ctx.fillRect(0, 0, width, height)
  eachBrick(width, height, (x, y, w, h) => paintBrick(ctx, x, y, w, h))

  // fine grit over everything, mortar included
  for (let i = 0; i < (width * height) / 60; i++) {
    const shade = Math.random() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${Math.random() * 0.08})`
    ctx.fillRect(Math.random() * width, Math.random() * height, 1.5, 1.5)
  }

  // darker toward the edges so the middle feels lit
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.3,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

function paintBrick(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const hue = 8 + Math.random() * 14
  const light = 30 + Math.random() * 14
  ctx.fillStyle = `hsl(${hue}, ${45 + Math.random() * 15}%, ${light}%)`
  ctx.fillRect(x, y, w, h)

  // a bit of top light / bottom shadow
  const shade = ctx.createLinearGradient(0, y, 0, y + h)
  shade.addColorStop(0, 'rgba(255,255,255,0.10)')
  shade.addColorStop(0.3, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.25)')
  ctx.fillStyle = shade
  ctx.fillRect(x, y, w, h)

  // blotches
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`
    ctx.beginPath()
    ctx.ellipse(
      x + Math.random() * w,
      y + Math.random() * h,
      2 + Math.random() * w * 0.15,
      1 + Math.random() * h * 0.2,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
}

/**
 * Height map for the 3D wall's bump map: mortar is low, brick faces are high
 * with soft edges and a little pitting, so the fist light catches the joints.
 */
export function paintBrickHeight(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.save()
  ctx.filter = 'blur(1.5px)'
  ctx.fillStyle = '#d8d8d8'
  eachBrick(width, height, (x, y, w, h) => ctx.fillRect(x + 1, y + 1, w - 2, h - 2))
  ctx.restore()

  for (let i = 0; i < (width * height) / 90; i++) {
    const v = Math.random() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.25})`
    ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2)
  }
}
