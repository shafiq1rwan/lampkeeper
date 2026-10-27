// Tunable gameplay values. Simulation rules read from here; visual tuning lives in rendering/theme.ts.

export const SIM = {
  /** Fixed simulation step in seconds. */
  dt: 1 / 60,
  /** Max fixed steps per rendered frame (caps catch-up after a stall). */
  maxStepsPerFrame: 5,
  /** Frame deltas above this are clamped (e.g. after a suspended tab). */
  maxFrameDelta: 0.1,
};

export const PLAYER = {
  radius: 0.3,
  /** World units per second. Modestly faster than the creature's chase speed. */
  speed: 3.4,
  /** Movement multiplier while holding a repair (walking out of range still cancels it). */
  repairMoveFactor: 0.6,
  /** Distance walked between footstep events. */
  stepDistance: 0.7,
};

export const INTERACT = {
  repairRange: 1.3,
  switchRange: 1.15,
  helpRange: 1.45,
  exitRange: 1.55,
  /** Seconds a repair must be held. */
  repairTime: 1.5,
  /** Minimum seconds between press actions (switch, help, exit). */
  pressDebounce: 0.25,
  /** A new target must be this much closer than the current one to steal the highlight. */
  hysteresis: 0.12,
  /** Extra range allowed before an in-progress repair cancels. */
  holdRangeGrace: 0.2,
};

export const POWER = {
  /** Default number of circuits that can be on at once. */
  capacity: 2,
  /** Seconds between switching a circuit off and its protection disappearing. */
  offWarning: 1.0,
};

export const LIGHT = {
  corridorRadius: 2.6,
  roomRadius: 3.1,
  /** Small emergency pads at breaker panels away from the nook. */
  switchPadRadius: 1.5,
  /** Emergency porch light at an active tenant's door. */
  porchRadius: 1.5,
};

export interface CreatureTuning {
  patrolSpeed: number;
  chaseSpeed: number;
  retreatSpeed: number;
  detectRange: number;
  /** Seconds without sight before a chase becomes an investigation. */
  loseSightTime: number;
  warnTime: number;
  captureRange: number;
  /** Continuous contact time required before a capture (reaction window). */
  captureGrace: number;
  /** Seconds the creature waits at a light boundary before giving up. */
  lurkTime: number;
  /** Seconds it wanders away, nearly oblivious, after giving up at a light boundary. */
  disinterestTime: number;
  /** A reachable dark region smaller than this many cells counts as a trap. */
  pocketMin: number;
  /** Seconds trapped in a small dark pocket before it loses its way and re-emerges elsewhere. */
  trapTime: number;
  cooldownTime: number;
  investigateLookTime: number;
  hearingRange: number;
  respawnDelay: number;
  emergeTime: number;
  dissolveTime: number;
  spawnMinDistance: number;
  repathInterval: number;
  radius: number;
}

export const CREATURE_DEFAULT: CreatureTuning = {
  patrolSpeed: 1.5,
  chaseSpeed: 2.9,
  retreatSpeed: 2.3,
  detectRange: 6.5,
  loseSightTime: 1.25,
  warnTime: 0.8,
  captureRange: 0.8,
  captureGrace: 0.3,
  lurkTime: 2.5,
  disinterestTime: 6,
  pocketMin: 60,
  trapTime: 8,
  cooldownTime: 1.5,
  investigateLookTime: 2.0,
  hearingRange: 9,
  respawnDelay: 6,
  emergeTime: 1.4,
  dissolveTime: 0.9,
  spawnMinDistance: 9,
  repathInterval: 0.3,
  radius: 0.32,
};

export const VALIDATION = {
  /** Seeded attempts before using the shift's authored fallback. */
  attempts: 40,
  /** Minimum straight-line distance between creature start and player start. */
  spawnClearance: 9,
  /** Minimum distance between two faults. */
  faultSpacing: 3,
};

export const STORY_SHIFTS = 5;
