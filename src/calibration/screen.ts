import { STEPS, type Calibration, type CalibrationOutcome, type SessionView } from './calibrate'

interface Handlers {
  onRedo: () => void
  /** null = skip calibration and use the default thresholds */
  onFinish: (calibration: Calibration | null) => void
}

const FAILURES = {
  'no-hand': {
    title: 'No hand.',
    note: 'Couldn’t see your hand for most of the first two steps. Keep it up in frame, face the camera, and add some light.',
  },
  'few-punches': {
    title: 'Missed some.',
    note: 'Didn’t see 3 punches that stood out from your normal movement. Step back so your whole arm fits in frame, add light, and punch faster.',
  },
  overlap: {
    title: 'Too close to call.',
    note: 'Your punches looked a lot like your normal moves. Step back a bit or add light, then redo it.',
  },
}

const rate = (v: number) => `${v.toFixed(2)} <span class="unit">/s</span>`

/** The calibration slab. Owns its DOM, nothing else. */
export class CalibrationScreen {
  private slab: HTMLElement
  private key = ''
  private result: Calibration | null = null

  constructor(
    private root: HTMLElement,
    private handlers: Handlers,
  ) {
    this.slab = root.querySelector('.slab')!
    this.slab.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'redo') this.handlers.onRedo()
      if (act === 'skip') this.handlers.onFinish(null)
      if (act === 'go') this.handlers.onFinish(this.result)
    })
  }

  show() {
    this.key = ''
    this.root.hidden = false
  }

  hide() {
    this.root.hidden = true
  }

  render(view: SessionView) {
    const key = view.kind === 'done' ? 'done' : `${view.index}:${view.stage}`
    if (key !== this.key) {
      this.key = key
      this.slab.innerHTML = view.kind === 'done' ? this.doneHtml(view.outcome) : this.stepHtml(view)
      this.slab.querySelector<HTMLElement>('[data-act="go"], [data-act="redo"]')?.focus()
    }
    if (view.kind === 'step') this.update(view)
  }

  private stepHtml(view: Extract<SessionView, { kind: 'step' }>) {
    const { step, index, stage } = view
    const live =
      stage === 'ready'
        ? `<p class="count" aria-live="polite"></p><p class="label">Get ready</p>`
        : `<div class="meter" role="progressbar" aria-label="${step.title}"><span></span></div>
           ${step.id === 'punch' ? '<p class="tally"><b class="hits">0</b> / 3 punches</p>' : ''}`
    return `
      <p class="label">Calibration / step ${index + 1} of ${STEPS.length}</p>
      <h2 class="title">${step.title}.</h2>
      <p class="note">${step.note}</p>
      ${live}
      <p class="label hand"></p>
      <button class="textbtn" data-act="skip">Skip, use defaults</button>`
  }

  private update(view: Extract<SessionView, { kind: 'step' }>) {
    const count = this.slab.querySelector('.count')
    if (count) count.textContent = String(view.countdown)
    const bar = this.slab.querySelector<HTMLElement>('.meter span')
    if (bar) bar.style.width = `${(view.progress * 100).toFixed(1)}%`
    const hits = this.slab.querySelector('.hits')
    if (hits) hits.textContent = String(Math.min(view.punches, 3))
    const hand = this.slab.querySelector('.hand')
    if (hand) hand.textContent = view.handSeen ? 'Hand: in view' : 'Hand: not found'
  }

  private doneHtml(outcome: CalibrationOutcome) {
    if (!outcome.ok) {
      this.result = null
      const f = FAILURES[outcome.reason]
      const numbers =
        outcome.reason === 'no-hand'
          ? ''
          : `<dl class="readout">
               <dt>Normal movement peak</dt><dd>${rate(outcome.noiseMax)}</dd>
               <dt>Punches seen</dt><dd>${outcome.punchPeaks.map((p) => p.toFixed(2)).join(', ') || 'none'}</dd>
             </dl>`
      return `
        <p class="label">Calibration / failed</p>
        <h2 class="title">${f.title}</h2>
        <p class="note">${f.note}</p>
        ${numbers}
        <button class="sign" data-act="redo">Redo</button>
        <button class="textbtn" data-act="skip">Use defaults anyway</button>`
    }

    const cal = outcome.calibration
    this.result = cal
    return `
      <p class="label">Calibration / done</p>
      <h2 class="title">Locked in.</h2>
      ${scaleHtml(cal)}
      <dl class="readout">
        <dt>Normal movement peak</dt><dd>${rate(cal.noiseMax)}</dd>
        <dt>Weakest punch</dt><dd>${rate(cal.weakestPunch)}</dd>
        <dt>Trigger set at</dt><dd class="mark">${rate(cal.strikeRate)}</dd>
      </dl>
      <button class="sign" data-act="go">Start swinging</button>
      <button class="textbtn" data-act="redo">Redo</button>`
  }
}

/** A number line: the non-punch range, the trigger, and each punch peak. */
function scaleHtml(cal: Calibration) {
  const top = Math.max(...cal.punchPeaks) * 1.1
  const pct = (v: number) => `${((v / top) * 100).toFixed(1)}%`
  const ticks = cal.punchPeaks.map((p) => `<i class="punch" style="left:${pct(p)}"></i>`).join('')
  return `
    <div class="scale" aria-hidden="true">
      <span class="noise" style="width:${pct(cal.noiseMax)}"></span>
      <i class="trigger" style="left:${pct(cal.strikeRate)}"></i>
      ${ticks}
    </div>
    <p class="label scale-key">Moving around &nbsp;|&nbsp; trigger &nbsp;|&nbsp; punches</p>`
}
