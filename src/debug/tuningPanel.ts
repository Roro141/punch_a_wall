import { config, resetConfig, saveConfig, type ConfigKey } from '../config'

const fields: { key: ConfigKey; min: number; max: number; step: number }[] = [
  { key: 'STRIKE_RATE', min: 0.5, max: 12, step: 0.05 },
  { key: 'FIST_ON', min: 0, max: 1, step: 0.05 },
  { key: 'FIST_OFF', min: 0, max: 1, step: 0.05 },
  { key: 'FIST_HOLD_MS', min: 0, max: 400, step: 10 },
  { key: 'STRIKE_PEAK_DROP', min: 0.5, max: 1, step: 0.05 },
  { key: 'STRIKE_MAX_MS', min: 30, max: 400, step: 10 },
  { key: 'VANISH_MS', min: 0, max: 400, step: 10 },
  { key: 'COOLDOWN_MS', min: 100, max: 1500, step: 50 },
  { key: 'STRENGTH_FULL_RATE', min: 1, max: 20, step: 0.25 },
  { key: 'GROWTH_WINDOW_MS', min: 33, max: 250, step: 1 },
  { key: 'EURO_MIN_CUTOFF', min: 0.1, max: 10, step: 0.1 },
  { key: 'EURO_BETA', min: 0, max: 50, step: 0.5 },
]

/**
 * Sliders for the live config. `onDefaults` runs after a reset so the
 * caller can re-apply calibration on top of the code defaults.
 */
export function mountTuningPanel(root: HTMLElement, onDefaults: () => void) {
  root.innerHTML = '<h3>Tuning</h3>'
  const inputs = new Map<ConfigKey, { input: HTMLInputElement; value: HTMLElement }>()

  for (const field of fields) {
    const row = document.createElement('label')
    row.innerHTML = `<span>${field.key}</span><output></output>`
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(field.min)
    input.max = String(field.max)
    input.step = String(field.step)
    input.addEventListener('input', () => {
      config[field.key] = Number(input.value)
      refresh()
      saveConfig()
    })
    row.append(input)
    root.append(row)
    inputs.set(field.key, { input, value: row.querySelector('output')! })
  }

  const reset = document.createElement('button')
  reset.textContent = 'Defaults'
  reset.addEventListener('click', () => {
    resetConfig()
    onDefaults()
    saveConfig()
    refresh()
  })
  root.append(reset)

  function refresh() {
    for (const [key, { input, value }] of inputs) {
      input.value = String(config[key])
      value.textContent = String(Math.round(config[key] * 100) / 100)
    }
  }
  refresh()
  return { refresh }
}
