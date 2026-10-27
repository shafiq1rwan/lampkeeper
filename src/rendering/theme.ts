// Visual tuning: palette, materials, lighting, camera and animation. Change the look here;
// nothing in this file affects simulation rules, protection boundaries or AI.

export const PALETTE = {
  background: 0x0a0f1f,
  void: 0x0d1428,

  wall: 0xd9c7a2,
  wallCap: 0x26304d,
  wallBase: 0x6d5a45,
  doorWood: 0x7a4a2b,
  doorFrame: 0x4c2f1d,
  doorPlate: 0xe8d9b5,
  exitDoor: 0x3c4a63,
  exitLocked: 0xc2503f,
  exitOpen: 0x58d38a,

  floorCorridor: 0xb8a07a,
  floorCorridorAlt: 0xae9671,
  floorRoom: 0x8c6544,
  floorRoomAlt: 0x83603f,
  floorNook: 0x9b8a6c,
  floorLanding: 0x7f8896,
  rug: 0x51707a,

  sofa: 0x3d6b5a,
  sofaCushion: 0xd8ccb0,
  wood: 0x6e4429,
  woodDark: 0x4a2c19,
  bedSheet: 0x4f7d68,
  pillow: 0xece4d0,
  book1: 0xb2563f,
  book2: 0x4f6d9a,
  book3: 0xd5b04a,
  cabinet: 0x8b7d6b,
  plantLeaf: 0x4f8a3c,
  plantLeafDark: 0x386b2c,
  pot: 0xc08a5a,

  fixtureMetal: 0x3a3f4a,
  bulbOn: [2.4, 1.75, 0.85] as [number, number, number],
  bulbOff: [0.32, 0.3, 0.26] as [number, number, number],
  bulbBroken: [0.12, 0.12, 0.13] as [number, number, number],
  bulbNook: [1.9, 1.6, 1.1] as [number, number, number],
  panel: 0x59606e,
  panelFace: 0x2b303b,
  leverOn: 0xffc35a,
  leverOff: 0x8c919c,

  playerJacket: 0xe0a22e,
  playerJacketDark: 0xb27a1c,
  playerPants: 0x2f3a55,
  playerSkin: 0xe8b98e,
  playerCap: 0xd38b22,
  playerBoot: 0x2a221c,
  lanternBody: 0x50555f,
  lanternGlow: [1.6, 1.6, 1.5] as [number, number, number],

  tenantTop: 0x8a5d9e,
  tenantPants: 0x3b3b46,
  tenantHair: 0x6a6a72,

  creature: 0x040509,
  creatureRim: 0x0d1430,
  creatureEye: 0xd9e6ff,
  creatureEyeAlert: 0xfff2c4,

  // Protection footprint overlay
  safeFill: [1.0, 0.64, 0.22] as [number, number, number],
  safeEdge: [1.0, 0.82, 0.45] as [number, number, number],
  darkTint: [0.1, 0.17, 0.4] as [number, number, number],
  previewEdge: [0.95, 0.95, 1.0] as [number, number, number],

  guide: 0xffc35a,
  sparks: 0xffd27a,
  smoke: 0x05070e,
};

export const LIGHTING = {
  hemiSky: 0x5d72b4,
  hemiGround: 0x161c30,
  hemiIntensity: 1.15,
  moonColor: 0x8fb0ff,
  moonIntensity: 0.6,
  /** Warm point lights are pooled and assigned to powered fixtures nearest the view centre. */
  warmColor: 0xffb259,
  warmIntensity: 4.5,
  warmDistance: 5.2,
  warmPoolHigh: 6,
  warmPoolLow: 3,
  lanternColor: 0xe4ecf2,
  lanternIntensity: 1.3,
  lanternDistance: 2.6,
  /** Per-wall tint: walls near powered lamps warm up, others stay cool. */
  wallWarm: [1.08, 0.94, 0.78] as [number, number, number],
  wallCool: [0.58, 0.66, 0.86] as [number, number, number],
};

export const CAMERA = {
  /** Rotation of the view around the vertical axis (radians). */
  yaw: (32 * Math.PI) / 180,
  /** Downward tilt (radians). */
  pitch: (52 * Math.PI) / 180,
  distance: 30,
  /** Visible world height in landscape. */
  viewHeight: 11.5,
  /** Minimum visible world width, so narrow portrait screens still see ahead. */
  minViewWidth: 10,
  maxViewHeight: 19,
  followLerp: 6,
  /** Look slightly ahead of the player's movement direction. */
  lookAhead: 1.2,
  maxPixelRatio: 2,
  maxPixelRatioLow: 1.25,
};

export const GEOMETRY = {
  wallHeight: 1.55,
  wallCutHeight: 0.28,
  /** Walls this far in front of the player (towards the camera) fade down. */
  cutForward: 4.2,
  cutLateral: 2.6,
  fixtureHeight: 1.15,
  doorHeight: 1.35,
};

export const ANIMATION = {
  walkBob: 0.06,
  walkSwing: 0.7,
  stepRate: 9,
  bulbIgnite: 0.35,
  wallCutSpeed: 8,
  creatureSway: 0.05,
};

export const EFFECTS = {
  bloomStrength: 0.55,
  bloomRadius: 0.4,
  bloomThreshold: 0.92,
  guideDashes: 14,
  sparkCount: 48,
  smokeCount: 40,
};

/** Hex colour → CSS string (for HUD tokens that mirror world colours). */
export function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
