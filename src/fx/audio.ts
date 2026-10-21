let ctx: AudioContext | null = null
let out: AudioNode | null = null
let noise: AudioBuffer | null = null

// Has to be called from a click/keypress or the browser keeps it suspended.
export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext()
    const compressor = ctx.createDynamicsCompressor()
    compressor.connect(ctx.destination)
    out = compressor

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') ctx.resume()
}

export function playImpact(strength: number) {
  if (!ctx || !out || !noise) return
  const t = ctx.currentTime
  const volume = 0.5 + 0.5 * strength

  // low thump: sine with a fast pitch drop
  const thump = ctx.createOscillator()
  const thumpGain = ctx.createGain()
  thump.frequency.setValueAtTime(150, t)
  thump.frequency.exponentialRampToValueAtTime(40, t + 0.25)
  thumpGain.gain.setValueAtTime(volume, t)
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
  thump.connect(thumpGain).connect(out)
  thump.start(t)
  thump.stop(t + 0.4)

  // sharp crack: short bright noise burst
  burst(t, 0.12, 'highpass', 1800, 0.6 * volume, 0.001)

  // crumble: longer, darker noise tail with a filter sweep down
  const crumble = burst(t + 0.02, 0.7 + 0.4 * strength, 'lowpass', 2500, 0.45 * volume, 0.02)
  crumble.frequency.exponentialRampToValueAtTime(300, t + 0.8)
}

function burst(
  start: number,
  length: number,
  type: BiquadFilterType,
  freq: number,
  gain: number,
  attack: number,
) {
  const src = ctx!.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = 0.8 + Math.random() * 0.4

  const filter = ctx!.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq

  const env = ctx!.createGain()
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(gain, start + attack + 0.001)
  env.gain.exponentialRampToValueAtTime(0.001, start + length)

  src.connect(filter).connect(env).connect(out!)
  src.start(start)
  src.stop(start + length + 0.05)
  return filter
}
