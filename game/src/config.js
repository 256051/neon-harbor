// Neon Harbor — every tuning number and colour in one place.
// The city is a grid: streets run every PITCH metres, blocks between them hold
// the buildings. Nothing here depends on the screen size or on three.js.
export const PITCH = 42; // metres between parallel street centrelines
export const STREETS = 9; // streets per direction, indices -4..4
export const CITY_HALF = ((STREETS - 1) / 2) * PITCH; // 168
export const STREET_HALF = 6; // half the road width
export const STEP = 1 / 60;

export const PLAYER = {
  walkSpeed: 6,
  sprintSpeed: 9.5,
  accel: 40,
  radius: 0.7,
  health: 100,
  punchDamage: 34,
  punchRange: 2.4,
  punchArc: 2.1, // radians of forward cone
  shootDamage: 50,
  shootRange: 32,
  shootCooldown: 0.35,
};

export const CAR = {
  accel: 16,
  brake: 30,
  reverseAccel: 10,
  maxSpeed: 38,
  maxReverse: 11,
  drag: 0.55,
  grip: 2.6, // steering authority
  radius: 2.3,
  health: 100,
};

// Feel table: every handling number in one place. Tune the feel here and
// nowhere else — acceleration, braking, steering, drift, camera.
export const FEEL = {
  carSteer: 2.6, // == CAR.grip, kept here as the single steering knob
  carDrift: 0.35, // how much speed survives a hard turn (lower = more slide)
  camAlign: 1.2, // rad/s the camera swings back behind the player
  camPitch: 0.32,
  camDist: 10.5,
  camMinDist: 6,
  camMaxDist: 16,
};

// AI tables: one row per actor type. The wanted level is a token budget —
// stars hand out chase tokens, and police without a token only patrol the
// perimeter instead of joining the chase (fairness and performance at once).
export const AI_POLICE = {
  maxChasers: 3,
  // Slightly slower than the player's top speed (38): a max-speed driver on
  // a straight can open a gap, but a slow or turning driver gets caught.
  chaseSpeed: 37,
  patrolRadius: 60,
  ramDamage: 8,
  ramCooldown: 2.2,
  ramMinSpeed: 3,
  spawnDist: 62,
  despawnDist: 90,
  // How long the player must stay out of sight (>30 m) before a chaser
  // gives up the chase and searches the last known position instead.
  searchDelay: 3,
};

export const AI_TRAFFIC = {
  cruiseMin: 9,
  cruiseMax: 13,
  turnChance: 0.004, // per step at an intersection
  stopDist: 12, // stop this far back from a red light
};

export const AI_PED = {
  walkMin: 1,
  walkMax: 2.2,
  fleeSpeed: 4.5,
  fleeRadius: 8, // a fast car or a gunshot this close scares a walker
  senseRadius: 18, // thugs notice the player inside this range
};

export const AI_THUG = {
  hp: 100,
  speed: 5.4,
  punchDamage: 9,
  punchRange: 1.6,
  windup: 0.55, // telegraph: the punch is telegraphed this long before it lands
  punchCooldown: 1.1,
  chaseRange: 45, // gives up beyond this distance
  reward: 25,
};

// Four signalised intersections: [x, z, phaseOffset]. The light cycles
// 12 s: north-south green 6 s, east-west green 6 s.
export const TRAFFIC_LIGHTS = [
  [0, 0, 0],
  [84, -42, 3],
  [-84, 42, 6],
  [42, 84, 9],
];
export const LIGHT_CYCLE = 12;

export const TRAFFIC_COUNT = 14;
export const PARKED_COUNT = 8;
export const PED_COUNT = 26;
export const PICKUP_COUNT = 6;

export const WANTED_MAX = 5;
export const WANTED_DECAY_CRIME_FREE = 15; // seconds without crime before decay starts
export const WANTED_DECAY_EVERY = 6; // seconds per star once decaying
export const POLICE_RAM_DAMAGE = 12;

export const START_CASH = 150;
export const PICKUP_VALUE = 50;
export const THUG_REWARD = 25;
export const DEATH_PENALTY = 200;

export const MISSIONS = [
  {
    id: 1,
    title: 'First Wheels',
    intro: 'Del: "New in town? You need wheels. Take one — any one — then meet me at the Docks."',
    reward: 300,
    stages: [
      { text: 'Steal a car — walk up to one and press E', target: null },
      { text: 'Drive to the Docks on the east side', target: [156, 42], radius: 10 },
    ],
  },
  {
    id: 2,
    title: 'Night Run',
    intro: 'Del: "Package at the old warehouse, west side. Get it across town to the Marina — fast. The clock is running."',
    reward: 500,
    stages: [
      { text: 'Pick up the package at the warehouse', target: [-150, -126], radius: 8 },
      { text: 'Deliver the package to the Marina — beat the clock!', target: [150, 126], radius: 8, timer: 100 },
    ],
  },
  {
    id: 3,
    title: 'Heat',
    intro: 'Del: "The drop was watched. Cops are all over you — shake them, then get to the Hideout."',
    reward: 800,
    stages: [
      { text: 'Lose the wanted level — break line of sight and stay quiet', target: null, wanted: 3 },
      { text: 'Reach the Hideout', target: [-126, 150], radius: 8 },
    ],
  },
];

export const PALETTE = {
  sky: 0x40366e,
  fog: 0x40366e,
  ground: 0x23232e,
  road: 0x2c2c38,
  sidewalk: 0x3a3a48,
  building: [0x5a5f7a, 0x7a5a5f, 0x4f6a72, 0x8a6f4d, 0x6a5a8a, 0x55684f],
  sun: 0xff9a3c,
  lamp: 0xffd9a0,
  playerJacket: 0x2ec4b6,
  policeBody: 0xe8e8e8,
  mission: 0xffd23f,
};

export const SAVE_KEY = 'neon-harbor.save.v1';
export const BEST_KEY = 'neon-harbor.best';
