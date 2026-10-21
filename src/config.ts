/**
 * Every punch-detection threshold lives here. The debug panel edits this
 * object live, and calibration overwrites STRIKE_RATE / STRENGTH_FULL_RATE.
 * The README has a table explaining each one.
 */
export const defaultConfig = {
  // --- landmark smoothing (One Euro filter) ---
  /** Hz. Lower = steadier landmarks when the hand is still, but more lag. */
  EURO_MIN_CUTOFF: 1.5,
  /** How fast the cutoff opens up with speed. Higher = less lag on fast moves. */
  EURO_BETA: 5,
  /** Hz. Cutoff for the speed estimate itself. */
  EURO_D_CUTOFF: 1,

  // --- features ---
  /** ms. Growth compares palm size now against palm size this long ago. */
  GROWTH_WINDOW_MS: 100,
  /** Fingertip/knuckle distance ratio that counts as a fully open hand (score 0). */
  FIST_RATIO_OPEN: 1.8,
  /** Ratio that counts as a tight fist (score 1). */
  FIST_RATIO_CLOSED: 1.1,

  // --- state machine ---
  /** Fist score needed to start counting toward FIST_READY. */
  FIST_ON: 0.6,
  /** Fist score below which the fist is considered open again (hysteresis). */
  FIST_OFF: 0.4,
  /** ms the fist must stay closed before a strike can start. */
  FIST_HOLD_MS: 120,
  /** /s. Growth rate that starts a strike. Calibration sets this. */
  STRIKE_RATE: 2.5,
  /** A strike resolves to HIT once growth falls below this fraction of its peak. */
  STRIKE_PEAK_DROP: 0.85,
  /** ms. A strike always resolves to HIT after this long. */
  STRIKE_MAX_MS: 150,
  /** ms. Losing the hand this soon after a strike starts still counts (motion blur). */
  VANISH_MS: 150,
  /** ms. Dead time after a hit. */
  COOLDOWN_MS: 500,
  /** /s. Peak growth that maps to full strength (1.0). Calibration sets this. */
  STRENGTH_FULL_RATE: 6,

  // --- calibration ---
  /** Where STRIKE_RATE goes between the noise max (0) and the weakest punch (1). */
  CALIB_SPLIT: 0.4,
  /** Weakest punch must be at least this many times the noise max, or calibration fails. */
  CALIB_MIN_SEPARATION: 1.3,
  /** /s. STRIKE_RATE never goes below this, even if the player held perfectly still. */
  CALIB_MIN_RATE: 1,
  /** STRENGTH_FULL_RATE = strongest calibration punch x this. */
  CALIB_STRENGTH_HEADROOM: 1.25,
}

export type Config = typeof defaultConfig
export type ConfigKey = keyof Config

/** The live config. Import this, never copy values out of it. */
export const config: Config = { ...defaultConfig }

const STORAGE_KEY = 'punch-wall:config:v2'

/** Loads slider overrides saved by the debug panel. */
export function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Config>
    for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
      if (typeof saved[key] === 'number') config[key] = saved[key]
    }
  } catch {
    // corrupt or blocked storage: just use defaults
  }
}

export function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // private mode etc. - settings just won't persist
  }
}

export function resetConfig() {
  Object.assign(config, defaultConfig)
}
