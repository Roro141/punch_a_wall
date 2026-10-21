import { config as liveConfig, type Config } from '../config'

/** What the detector needs from each tracked hand every frame. */
export interface HandSample {
  id: string
  /** screen position, used as the hit point */
  x: number
  y: number
  palmSize: number
  growth: number
  fist: number
}

export interface Punch {
  x: number
  y: number
  strength: number
  /** peak growth rate during the strike, /s */
  peak: number
  reason: 'strike' | 'vanish' | 'click'
  hand: string
  time: number
}

export type PunchState = 'IDLE' | 'FIST_READY' | 'STRIKING' | 'HIT' | 'COOLDOWN'

export interface HandTrack extends HandSample {
  state: PunchState
  /** when the current state started */
  since: number
  /** while IDLE: when the fist closed past FIST_ON, or -Infinity */
  fistSince: number
  /** highest growth seen during the current strike */
  peak: number
}

/**
 * Per-hand state machine:
 *
 *   IDLE --fist > FIST_ON for FIST_HOLD_MS--> FIST_READY
 *   FIST_READY --growth > STRIKE_RATE--> STRIKING
 *   FIST_READY --fist < FIST_OFF--> IDLE
 *   STRIKING --peak passed / STRIKE_MAX_MS / hand lost within VANISH_MS--> HIT
 *   HIT --> COOLDOWN --COOLDOWN_MS--> IDLE
 *
 * FIST_ON / FIST_OFF are separate so a score hovering near one threshold
 * doesn't flicker between states.
 */
export class PunchDetector {
  tracks = new Map<string, HandTrack>()
  /** survives the hand dropping out, so a lost-and-found hand can't skip its cooldown */
  private lastHit = new Map<string, number>()

  constructor(public config: Config = liveConfig) {}

  reset() {
    this.tracks.clear()
    this.lastHit.clear()
  }

  update(hands: HandSample[], now: number): Punch[] {
    const punches: Punch[] = []
    const seen = new Set<string>()

    for (const hand of hands) {
      seen.add(hand.id)
      let track = this.tracks.get(hand.id)
      if (!track) {
        const hitAt = this.lastHit.get(hand.id) ?? -Infinity
        const cooling = now - hitAt < this.config.COOLDOWN_MS
        track = {
          ...hand,
          state: cooling ? 'COOLDOWN' : 'IDLE',
          since: cooling ? hitAt : now,
          fistSince: -Infinity,
          peak: 0,
        }
        this.tracks.set(hand.id, track)
      }
      Object.assign(track, hand)
      const punch = this.step(track, hand, now)
      if (punch) punches.push(punch)
    }

    // Fast punches smear so badly that the tracker often loses the hand.
    // If that happens right after a strike started, it was almost surely a hit.
    for (const [id, track] of this.tracks) {
      if (seen.has(id)) continue
      if (track.state === 'STRIKING' && now - track.since <= this.config.VANISH_MS) {
        punches.push(this.hit(track, 'vanish', now))
      }
      this.tracks.delete(id)
    }

    return punches
  }

  private step(track: HandTrack, hand: HandSample, now: number): Punch | null {
    const c = this.config
    switch (track.state) {
      case 'IDLE':
        if (hand.fist > c.FIST_ON && track.fistSince === -Infinity) track.fistSince = now
        if (hand.fist < c.FIST_OFF) track.fistSince = -Infinity
        if (track.fistSince !== -Infinity && now - track.fistSince >= c.FIST_HOLD_MS) {
          this.enter(track, 'FIST_READY', now)
        }
        return null

      case 'FIST_READY':
        if (hand.fist < c.FIST_OFF) {
          this.enter(track, 'IDLE', now)
        } else if (hand.growth > c.STRIKE_RATE) {
          this.enter(track, 'STRIKING', now)
          track.peak = hand.growth
        }
        return null

      case 'STRIKING': {
        // the fist score is ignored here: motion blur wrecks it mid-punch
        track.peak = Math.max(track.peak, hand.growth)
        const peakPassed = hand.growth < track.peak * c.STRIKE_PEAK_DROP
        const fellBack = hand.growth < c.STRIKE_RATE
        const tooLong = now - track.since >= c.STRIKE_MAX_MS
        return peakPassed || fellBack || tooLong ? this.hit(track, 'strike', now) : null
      }

      case 'HIT':
        // keep `since` from the hit so the cooldown is measured from it
        track.state = 'COOLDOWN'
        return null

      case 'COOLDOWN':
        if (now - track.since >= c.COOLDOWN_MS) this.enter(track, 'IDLE', now)
        return null
    }
  }

  /** Maps a strike's peak growth to 0..1. */
  strength(peak: number) {
    const { STRIKE_RATE, STRENGTH_FULL_RATE } = this.config
    const span = STRENGTH_FULL_RATE - STRIKE_RATE
    if (span <= 0) return 1
    return Math.min(1, Math.max(0, (peak - STRIKE_RATE) / span))
  }

  private enter(track: HandTrack, state: PunchState, now: number) {
    track.state = state
    track.since = now
    if (state !== 'IDLE') track.fistSince = -Infinity
  }

  private hit(track: HandTrack, reason: Punch['reason'], now: number): Punch {
    const peak = track.peak
    this.enter(track, 'HIT', now)
    this.lastHit.set(track.id, now)
    track.peak = 0
    return { x: track.x, y: track.y, strength: this.strength(peak), peak, reason, hand: track.id, time: now }
  }
}
