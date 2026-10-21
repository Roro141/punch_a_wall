import { config as liveConfig, type Config } from '../config'

// ---------------------------------------------------------------------------
// The math
// ---------------------------------------------------------------------------

export interface CalibrationInput {
  /** growth rate of every frame in step 1 (hold still) */
  stillGrowth: number[]
  /** growth rate of every frame in step 2 (fist, moving around, no punches) */
  moveGrowth: number[]
  /** fraction of frames in steps 1 and 2 where a hand was found */
  stillSeen: number
  moveSeen: number
  /** peak growth rate of each punch in step 3 */
  punchPeaks: number[]
  /** fist score of every frame in steps 1 and 2, kept for the log */
  stillFist: number[]
  moveFist: number[]
}

export interface Calibration {
  version: 1
  createdAt: string
  strikeRate: number
  strengthFullRate: number
  /** highest growth seen while not punching (steps 1 + 2) */
  noiseMax: number
  stillMax: number
  moveMax: number
  punchPeaks: number[]
  weakestPunch: number
  stillFistMedian: number
  moveFistMedian: number
}

export type CalibrationFailure = 'no-hand' | 'few-punches' | 'overlap'

export type CalibrationOutcome =
  | { ok: true; calibration: Calibration }
  | { ok: false; reason: CalibrationFailure; noiseMax: number; punchPeaks: number[] }

const PUNCHES_NEEDED = 3
const MIN_SEEN = 0.5

const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0)

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * STRIKE_RATE goes CALIB_SPLIT of the way from the loudest non-punch
 * movement to the weakest punch:
 *
 *   STRIKE_RATE = noiseMax + CALIB_SPLIT * (weakestPunch - noiseMax)
 *
 * Sitting a bit below the midpoint means a softer-than-calibrated punch
 * still lands, while staying well clear of anything seen during the
 * no-punch steps.
 */
export function computeCalibration(input: CalibrationInput, c: Config = liveConfig): CalibrationOutcome {
  const stillMax = max(input.stillGrowth)
  const moveMax = max(input.moveGrowth)
  const noiseMax = Math.max(stillMax, moveMax, 0)
  const punchPeaks = input.punchPeaks.slice(0, PUNCHES_NEEDED)

  if (input.stillSeen < MIN_SEEN || input.moveSeen < MIN_SEEN) {
    return { ok: false, reason: 'no-hand', noiseMax, punchPeaks }
  }
  if (punchPeaks.length < PUNCHES_NEEDED) {
    return { ok: false, reason: 'few-punches', noiseMax, punchPeaks }
  }

  const weakestPunch = Math.min(...punchPeaks)
  if (weakestPunch < noiseMax * c.CALIB_MIN_SEPARATION) {
    return { ok: false, reason: 'overlap', noiseMax, punchPeaks }
  }

  const strikeRate = Math.max(c.CALIB_MIN_RATE, noiseMax + c.CALIB_SPLIT * (weakestPunch - noiseMax))
  const strengthFullRate = Math.max(strikeRate * 1.5, max(punchPeaks) * c.CALIB_STRENGTH_HEADROOM)

  return {
    ok: true,
    calibration: {
      version: 1,
      createdAt: new Date().toISOString(),
      strikeRate,
      strengthFullRate,
      noiseMax,
      stillMax,
      moveMax,
      punchPeaks,
      weakestPunch,
      stillFistMedian: median(input.stillFist),
      moveFistMedian: median(input.moveFist),
    },
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'punch-wall:calibration'

export function loadCalibration(): Calibration | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return saved?.version === 1 && typeof saved.strikeRate === 'number' ? saved : null
  } catch {
    return null
  }
}

export function saveCalibration(cal: Calibration) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cal))
  } catch {
    // storage blocked: calibration still applies for this session
  }
}

export function applyCalibration(cal: Calibration, c: Config = liveConfig) {
  c.STRIKE_RATE = cal.strikeRate
  c.STRENGTH_FULL_RATE = cal.strengthFullRate
}

// ---------------------------------------------------------------------------
// The session: three timed steps, fed one frame at a time
// ---------------------------------------------------------------------------

export interface StepInfo {
  id: 'still' | 'move' | 'punch'
  title: string
  note: string
  ms: number
}

export const STEPS: StepInfo[] = [
  { id: 'still', title: 'Hold still', note: 'Hand up where the camera can see it. Don’t move.', ms: 5000 },
  {
    id: 'move',
    title: 'Make a fist, move around',
    note: 'Wave it, scratch your face, shift your weight. Anything but punching.',
    ms: 5000,
  },
  { id: 'punch', title: 'Punch 3 times', note: 'Full speed, straight at the camera. Pause between each.', ms: 12000 },
]

const READY_MS = 3000
/** punch-step peaks closer together than this are one punch */
const MERGE_MS = 300

export interface FrameHand {
  growth: number
  fist: number
}

export type SessionView =
  | {
      kind: 'step'
      index: number
      step: StepInfo
      stage: 'ready' | 'record'
      /** whole seconds left in the get-ready countdown */
      countdown: number
      /** 0..1 through the recording */
      progress: number
      handSeen: boolean
      punches: number
    }
  | { kind: 'done'; outcome: CalibrationOutcome }

export class CalibrationSession {
  private index = 0
  private stage: 'ready' | 'record' | 'done' = 'ready'
  private stageStart: number
  private handSeen = false
  private outcome: CalibrationOutcome | null = null

  private frames = { still: 0, move: 0 }
  private seen = { still: 0, move: 0 }
  private growth = { still: [] as number[], move: [] as number[] }
  private fist = { still: [] as number[], move: [] as number[] }

  // punch-step peak finding
  private peaks: number[] = []
  private inPeak = false
  private lastPeakEnd = -Infinity

  constructor(
    now: number,
    private c: Config = liveConfig,
  ) {
    this.stageStart = now
  }

  /** Feed every tracked video frame. */
  addFrame(hands: FrameHand[], now: number) {
    this.handSeen = hands.length > 0
    if (this.stage !== 'record') return
    const id = STEPS[this.index].id
    const growth = hands.length ? Math.max(...hands.map((h) => h.growth)) : null

    if (id === 'punch') {
      this.trackPunch(growth, now)
      return
    }
    this.frames[id]++
    if (growth === null) return
    this.seen[id]++
    this.growth[id].push(growth)
    this.fist[id].push(Math.max(...hands.map((h) => h.fist)))
  }

  /** Call every animation frame; advances the timers. */
  tick(now: number) {
    if (this.stage === 'done') return
    const elapsed = now - this.stageStart
    const step = STEPS[this.index]

    if (this.stage === 'ready' && elapsed >= READY_MS) {
      this.stage = 'record'
      this.stageStart = now
    } else if (this.stage === 'record') {
      const punchedEnough =
        step.id === 'punch' && this.peaks.length >= 3 && !this.inPeak && now - this.lastPeakEnd >= MERGE_MS
      if (elapsed >= step.ms || punchedEnough) this.next(now)
    }
  }

  view(now: number): SessionView {
    if (this.stage === 'done') return { kind: 'done', outcome: this.outcome! }
    const step = STEPS[this.index]
    const elapsed = now - this.stageStart
    return {
      kind: 'step',
      index: this.index,
      step,
      stage: this.stage,
      countdown: Math.max(1, Math.ceil((READY_MS - elapsed) / 1000)),
      progress: this.stage === 'record' ? Math.min(1, elapsed / step.ms) : 0,
      handSeen: this.handSeen,
      punches: this.peaks.length,
    }
  }

  /** Punch threshold during step 3: anything above all the non-punch movement. */
  private get punchFloor() {
    return Math.max(this.c.CALIB_MIN_RATE, max(this.growth.still), max(this.growth.move))
  }

  private trackPunch(growth: number | null, now: number) {
    if (growth !== null && growth > this.punchFloor) {
      if (!this.inPeak) {
        // a dip of a frame or two inside one punch shouldn't split it in two
        if (now - this.lastPeakEnd >= MERGE_MS || !this.peaks.length) this.peaks.push(growth)
        this.inPeak = true
      }
      this.peaks[this.peaks.length - 1] = Math.max(this.peaks[this.peaks.length - 1], growth)
    } else if (this.inPeak) {
      // includes the hand vanishing mid-punch: the peak so far stands
      this.inPeak = false
      this.lastPeakEnd = now
    }
  }

  private next(now: number) {
    this.index++
    this.stageStart = now
    if (this.index < STEPS.length) {
      this.stage = 'ready'
      return
    }
    this.stage = 'done'
    this.outcome = computeCalibration(
      {
        stillGrowth: this.growth.still,
        moveGrowth: this.growth.move,
        stillSeen: this.frames.still ? this.seen.still / this.frames.still : 0,
        moveSeen: this.frames.move ? this.seen.move / this.frames.move : 0,
        punchPeaks: this.peaks,
        stillFist: this.fist.still,
        moveFist: this.fist.move,
      },
      this.c,
    )
  }
}
