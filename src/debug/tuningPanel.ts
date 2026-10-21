import { defaultTuning, saveTuning, type Tuning } from '../config'

const fields: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: 'fistMin', label: 'fist min', min: 0, max: 1, step: 0.05 },
  { key: 'growthMin', label: 'growth min /s', min: 0.5, max: 8, step: 0.1 },
  { key: 'growthPrimed', label: 'growth primed /s', min: 0.2, max: 6, step: 0.1 },
  { key: 'minFrames', label: 'min frames', min: 1, max: 6, step: 1 },
  { key: 'vanishMs', label: 'vanish window ms', min: 0, max: 400, step: 10 },
  { key: 'cooldownMs', label: 'cooldown ms', min: 100, max: 1500, step: 50 },
  { key: 'smoothing', label: 'smoothing (1 = raw)', min: 0.1, max: 1, step: 0.05 },
]

export function mountTuningPanel(root: HTMLElement, tuning: Tuning) {
  root.innerHTML = '<h3>Tuning</h3>'
  const inputs = new Map<keyof Tuning, { input: HTMLInputElement; value: HTMLElement }>()

  for (const field of fields) {
    const row = document.createElement('label')
    row.innerHTML = `<span>${field.label}</span><output></output>`
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(field.min)
    input.max = String(field.max)
    input.step = String(field.step)
    input.addEventListener('input', () => {
      tuning[field.key] = Number(input.value)
      refresh()
      saveTuning(tuning)
    })
    row.append(input)
    root.append(row)
    inputs.set(field.key, { input, value: row.querySelector('output')! })
  }

  const reset = document.createElement('button')
  reset.textContent = 'Defaults'
  reset.addEventListener('click', () => {
    Object.assign(tuning, defaultTuning)
    refresh()
    saveTuning(tuning)
  })
  root.append(reset)

  function refresh() {
    for (const [key, { input, value }] of inputs) {
      input.value = String(tuning[key])
      value.textContent = String(tuning[key])
    }
  }
  refresh()
}
