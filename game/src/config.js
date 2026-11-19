// Neon Harbor — tunable numbers. One place for every feel, spawn and reward value
// so balancing the game never means hunting through the simulation code.

export const CFG = {
  // City layout
  blockSize: 44, // metres of buildings inside one block
  streetWidth: 14, // metres of road between blocks
  blocks: 9, // 9 x 9 blocks
  buildingTarget: 128, // how many buildings the city generator aims for
  harborX: 268, // east of this line the land ends and the water begins

  // Player on foot
  walkSpeed: 6,
  runSpeed: 10.5,
  playerRadius: 0.7,
  playerHealth: 100,

  // Driving
  carAccel: 20, // m/s^2 at full throttle
  carBrake: 34,
  carReverseMax: 11,
  carMaxSpeed: 39, // ~140 km/h
  carSteerMax: 0.62, // radians of front-wheel angle
  carGrip: 7.5, // how fast sideways velocity bleeds off
  carRadius: 1.7,
  carHealth: 150,

  // Population
  trafficCars: 14,
  parkedCars: 8,
  pedestrians: 26,
  trafficSpeed: 9,

  // Wanted / police
  heatSteal: 34,
  heatRam: 20,
  heatShot: 15,
  heatHitPed: 25,
  heatDecayPerSec: 4,
  heatCalmSeconds: 6, // seconds out of police sight before heat starts to fall
  policeSightRange: 60,
  policeMax: 5,
  policeAccel: 24,
  policeMaxSpeed: 30, // slower than the player's top speed, so a clean
  policeRamDamage: 2, // getaway on a straight is possible — but a ram hurts

  // Combat
  pistolDamage: 34,
  pistolRange: 55,
  punchDamage: 12,
  punchRange: 2.2,
  punchCooldown: 0.45,
  shotCooldown: 0.28,

  // Missions
  missionReward: [300, 500, 800],
  missionRadius: 26,

  // Feel
  cameraDistance: 13,
  cameraHeight: 6.5,
  minimapRange: 190,
};

// Wanted stars from a heat value of 0..100. 10 heat is the first star.
export function starsForHeat(heat) {
  if (heat < 10) return 0;
  if (heat < 30) return 1;
  if (heat < 50) return 2;
  if (heat < 70) return 3;
  if (heat < 90) return 4;
  return 5;
}

// How many police cars answer a given star level (the token budget).
export function policeBudget(stars) {
  return Math.min(stars, CFG.policeMax);
}
