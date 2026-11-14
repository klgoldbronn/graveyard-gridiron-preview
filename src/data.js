// Graveyard Gridiron v1 — Data Module (Spec §4, §5, §6, §7, §8, §9, §10)
// Pure data definitions; never hardcode game tables in sim logic.

export const FIELD_CONFIG = {
  cols: 5,
  rows: 6,
  playerRows: [0, 1, 2],
  scrimmageRow: 3,
  opponentRows: [4, 5],
  downsPerDrive: 4,
  ticksPerDown: 8,
  tdYards: 80,
  fgYards: 50,
  fgYardsKicker: 40,
  minDownYards: -10,
  maxDownYards: 35,
  tdPoints: 7,
  fgPoints: 3,
  defaultFieldLimit: 6,
  startingHearts: 3,
  fieldLimitByGame: [5, 5, 6, 6, 6, 7, 7, 7]
};

export const STAR_MULTIPLIERS = {
  1: 1.0,
  2: 1.6, // +60% HP/dmg
  3: 2.5  // +150% HP/dmg
};

// §7. Species (5 species with passives and Synergy 2 / Synergy 4 thresholds)
export const SPECIES = {
  Skeleton: {
    id: 'Skeleton',
    name: 'Skeleton',
    vibe: 'Cheap, rattly, falls apart funny',
    color: '#e8e4d9',
    emoji: '💀',
    passive: {
      hpMult: 0.78,
      dmgMult: 0.95,
      speedBonus: 1,
      baseArmor: 0,
      baseDodge: 0.05,
      poisonImmune: false,
      poisonOnHit: 0
    },
    synergies: {
      2: {
        name: 'Reassemble',
        reassembleChance: 0.30,
        deathAoeDmg: 0,
        description: '30% chance a dead Skeleton returns to bench after the game'
      },
      4: {
        name: 'Reassemble + Bone Shrapnel',
        reassembleChance: 0.60,
        deathAoeDmg: 10,
        description: 'Reassemble 60%, and Skeletons explode for AoE dmg on death'
      }
    }
  },
  Orc: {
    id: 'Orc',
    name: 'Orc',
    vibe: 'Huge, dumb, glorious',
    color: '#4caf50',
    emoji: '👹',
    passive: {
      hpMult: 1.15,
      dmgMult: 1.28,
      speedBonus: -1,
      baseArmor: 0,
      baseDodge: 0.0,
      poisonImmune: false,
      poisonOnHit: 0
    },
    synergies: {
      2: {
        name: 'Bloodlust',
        bloodlustDmgBonus: 0.20,
        bloodlustDurationTicks: 2,
        killHealPct: 0,
        description: '+20% dmg for whole team for 2 ticks after any player (either side) dies'
      },
      4: {
        name: 'Bloodlust + Carnage Feast',
        bloodlustDmgBonus: 0.40,
        bloodlustDurationTicks: 2,
        killHealPct: 0.20,
        description: 'Bloodlust +40%, Orcs heal 20% on a kill'
      }
    }
  },
  Robot: {
    id: 'Robot',
    name: 'Robot',
    vibe: 'Clanky, sparking, deadpan',
    color: '#90a4ae',
    emoji: '🤖',
    passive: {
      hpMult: 1.05,
      dmgMult: 1.0,
      speedBonus: 0,
      baseArmor: 2, // flat -2 dmg/hit
      baseDodge: 0.0,
      poisonImmune: true, // immune to Zombie poison
      poisonOnHit: 0
    },
    synergies: {
      2: {
        name: 'Plating',
        teamArmorBonus: 1,
        stationaryRepairPct: 0,
        description: 'Team +1 armor'
      },
      4: {
        name: 'Heavy Plating + Auto-Repair',
        teamArmorBonus: 2,
        stationaryRepairPct: 0.10,
        description: 'Plating +2, Robots repair 10% HP per down if they did not move'
      }
    }
  },
  Alien: {
    id: 'Alien',
    name: 'Alien',
    vibe: 'Weird, floaty, too many eyes',
    color: '#00e5ff',
    emoji: '👽',
    passive: {
      hpMult: 0.90,
      dmgMult: 1.05,
      speedBonus: 1,
      baseArmor: 0,
      baseDodge: 0.15,
      rangeBonus: 1, // ranged zap
      poisonImmune: false,
      poisonOnHit: 0
    },
    synergies: {
      2: {
        name: 'Blink',
        blinkOnTick1: true,
        firstHitGuaranteedCrit: false,
        description: "Aliens teleport to their target's row on tick 1 (skip the walk)"
      },
      4: {
        name: 'Blink + Hyper-Zap',
        blinkOnTick1: true,
        firstHitGuaranteedCrit: true,
        critMultiplier: 2.0,
        description: "Blink + Aliens' first hit each down always crits"
      }
    }
  },
  Zombie: {
    id: 'Zombie',
    name: 'Zombie',
    vibe: 'Shambling, hungry, leaky',
    color: '#9ccc65',
    emoji: '🧟',
    passive: {
      hpMult: 1.05,
      dmgMult: 1.0,
      speedBonus: 0,
      baseArmor: 0,
      baseDodge: 0.05,
      poisonImmune: false,
      poisonOnHit: 2, // 2 dmg/tick, stacks
      basePoisonTicks: 2
    },
    synergies: {
      2: {
        name: 'Rot',
        extraPoisonTicks: 2,
        devourOnKill: false,
        description: 'Poison lasts +2 ticks'
      },
      4: {
        name: 'Rot + Devour',
        extraPoisonTicks: 2,
        devourOnKill: true,
        description: "Zombies that kill an enemy gain that enemy's max HP for the drive (devour)"
      }
    }
  }
};

// §6. Positions (7 classes: QB, RB, WR, OL, TE, LB, DB)
export const POSITIONS = {
  QB: {
    id: 'QB',
    name: 'Thrower',
    range: 3,
    hpClass: 'Low',
    baseHp: 44,
    baseDmg: 5,
    speedClass: 'Med',
    baseSpeed: 5,
    baseDodge: 0.05,
    targeting: 'furthest_enemy',
    passIntervalTicks: 3,
    passWrDmgBuff: 3,
    passWrSpeedBuff: 1,
    description: 'Targets furthest enemy (DB/LB). Every 3rd tick: PASS — buffs WR (+dmg, +speed) and triggers Catch check.'
  },
  RB: {
    id: 'RB',
    name: 'Ball Carrier',
    range: 1,
    hpClass: 'Med',
    baseHp: 64,
    baseDmg: 7,
    speedClass: 'Fast',
    baseSpeed: 7,
    baseDodge: 0.10,
    targeting: 'nearest_enemy',
    moveDmgBonus: 3,
    description: 'Targets nearest enemy, charges carrier forward. Bonus dmg when moving. THE yardage engine.'
  },
  WR: {
    id: 'WR',
    name: 'Speedster',
    range: 2,
    hpClass: 'Low',
    baseHp: 46,
    baseDmg: 7,
    speedClass: 'Fastest',
    baseSpeed: 9,
    baseDodge: 0.25,
    targeting: 'lowest_hp_enemy',
    description: 'Targets lowest-HP enemy. Dodge 25%. Catch play = big yards.'
  },
  OL: {
    id: 'OL',
    name: 'Blocker',
    range: 1,
    hpClass: 'Highest',
    baseHp: 98,
    baseDmg: 6,
    speedClass: 'Slow',
    baseSpeed: 3,
    baseDodge: 0.0,
    targeting: 'nearest_enemy',
    tauntAdjacent: true,
    carrierShieldReduction: 0.30, // carrier takes -30% dmg if OL in same/adjacent lane
    description: 'TAUNT: enemies in adjacent cells must target OL. Shields carrier if in same/adjacent lane (-30% dmg).'
  },
  TE: {
    id: 'TE',
    name: 'Monster Hybrid',
    range: 2, // 1-2
    hpClass: 'High',
    baseHp: 76,
    baseDmg: 8,
    speedClass: 'Med',
    baseSpeed: 5,
    baseDodge: 0.05,
    targeting: 'nearest_enemy',
    shoveIntervalTicks: 4,
    description: 'Attacks nearest, every 4th tick shoves enemy back 1 row (opens a lane).'
  },
  LB: {
    id: 'LB',
    name: 'Tackler',
    range: 1,
    hpClass: 'High',
    baseHp: 72,
    baseDmg: 8,
    speedClass: 'Med',
    baseSpeed: 6,
    baseDodge: 0.05,
    targeting: 'rb_qb_first',
    rbDmgMultiplier: 1.50, // +50% dmg to RB
    description: 'Targets enemy RB/QB first. +50% dmg to RB.'
  },
  DB: {
    id: 'DB',
    name: 'Interceptor',
    range: 3,
    hpClass: 'Med',
    baseHp: 54,
    baseDmg: 6,
    speedClass: 'Fast',
    baseSpeed: 8,
    baseDodge: 0.15,
    targeting: 'qb_wr_first',
    interceptChance: 0.35,
    description: 'Targets enemy QB/WR first. Chance on QB pass tick to INTERCEPT: down ends immediately, 0 yards.'
  }
};

// §7. 30-player v1 Roster Pool: 5 species x 6 positions (QB, RB, WR, OL, LB, DB)
// Plus TE_ROSTER_POOL (5 TE players, 1 per species) ready for Build 3 / TE tests.
// All names are original 90s cartoon gross-out tone — zero real NFL/MLF names.
export const ROSTER_POOL = [
  // Skeleton (Cheap, rattly, Tier 1-2, 1-2g)
  { id: 'skel_qb', name: 'Bones Mahoney', species: 'Skeleton', position: 'QB', tier: 1, cost: 1 },
  { id: 'skel_rb', name: 'Rattle McRibs', species: 'Skeleton', position: 'RB', tier: 1, cost: 1 },
  { id: 'skel_wr', name: 'Clatterdome Kid', species: 'Skeleton', position: 'WR', tier: 1, cost: 2 },
  { id: 'skel_ol', name: 'Femur Snapper', species: 'Skeleton', position: 'OL', tier: 1, cost: 1 },
  { id: 'skel_lb', name: 'Pelvis Crusher', species: 'Skeleton', position: 'LB', tier: 2, cost: 2 },
  { id: 'skel_db', name: 'Marrow Snatcher', species: 'Skeleton', position: 'DB', tier: 1, cost: 2 },

  // Orc (Huge, dumb, glorious, Tier 1-3, 2-4g)
  { id: 'orc_qb', name: 'Chuck Steakhead', species: 'Orc', position: 'QB', tier: 1, cost: 2 },
  { id: 'orc_rb', name: 'Gristle McLarge', species: 'Orc', position: 'RB', tier: 1, cost: 2 },
  { id: 'orc_wr', name: 'Snout Spittle', species: 'Orc', position: 'WR', tier: 2, cost: 2 },
  { id: 'orc_ol', name: 'Gorgutz Gutpunch', species: 'Orc', position: 'OL', tier: 2, cost: 3 },
  { id: 'orc_lb', name: 'Spleen Cleaver', species: 'Orc', position: 'LB', tier: 3, cost: 4 },
  { id: 'orc_db', name: 'Booger Blitz', species: 'Orc', position: 'DB', tier: 2, cost: 3 },

  // Robot (Clanky, sparking, deadpan, Tier 1-3, 2-4g)
  { id: 'bot_qb', name: 'K-9000 Unit', species: 'Robot', position: 'QB', tier: 2, cost: 3 },
  { id: 'bot_rb', name: 'Piston Crankshaft', species: 'Robot', position: 'RB', tier: 2, cost: 3 },
  { id: 'bot_wr', name: 'Sparkplug Zippy', species: 'Robot', position: 'WR', tier: 1, cost: 2 },
  { id: 'bot_ol', name: 'Bulkhead Bertha', species: 'Robot', position: 'OL', tier: 1, cost: 2 },
  { id: 'bot_lb', name: 'Servo Smasher', species: 'Robot', position: 'LB', tier: 2, cost: 3 },
  { id: 'bot_db', name: 'Radar Rustbucket', species: 'Robot', position: 'DB', tier: 1, cost: 2 },

  // Alien (Weird, floaty, too many eyes, Tier 1-3, 2-5g)
  { id: 'alien_qb', name: 'Glorp Zapper', species: 'Alien', position: 'QB', tier: 2, cost: 3 },
  { id: 'alien_rb', name: 'Xylar Tentacles', species: 'Alien', position: 'RB', tier: 2, cost: 3 },
  { id: 'alien_wr', name: 'Zorgon Eyestalk', species: 'Alien', position: 'WR', tier: 1, cost: 2 },
  { id: 'alien_ol', name: 'Bloop Nebula', species: 'Alien', position: 'OL', tier: 2, cost: 3 },
  { id: 'alien_lb', name: 'Quasar Slimeball', species: 'Alien', position: 'LB', tier: 3, cost: 5 },
  { id: 'alien_db', name: 'Vortex McGoo', species: 'Alien', position: 'DB', tier: 1, cost: 2 },

  // Zombie (Shambling, hungry, leaky, Tier 1-3, 1-4g)
  { id: 'zom_qb', name: 'Rotgut Larry', species: 'Zombie', position: 'QB', tier: 1, cost: 1 },
  { id: 'zom_rb', name: 'Maggot McGill', species: 'Zombie', position: 'RB', tier: 1, cost: 2 },
  { id: 'zom_wr', name: 'Jawbone Jitters', species: 'Zombie', position: 'WR', tier: 1, cost: 2 },
  { id: 'zom_ol', name: 'Sludge Shuffle', species: 'Zombie', position: 'OL', tier: 1, cost: 2 },
  { id: 'zom_lb', name: 'Brainz Jenkins', species: 'Zombie', position: 'LB', tier: 3, cost: 4 },
  { id: 'zom_db', name: 'Pustule Pete', species: 'Zombie', position: 'DB', tier: 2, cost: 3 }
];

// 7th position pool (TE) — included in SHOP_POOL in Build 3
export const TE_ROSTER_POOL = [
  { id: 'skel_te', name: 'Wishbone Wanda', species: 'Skeleton', position: 'TE', tier: 1, cost: 2 },
  { id: 'orc_te', name: 'Slobber Knockers', species: 'Orc', position: 'TE', tier: 3, cost: 4 },
  { id: 'bot_te', name: 'Hydraulic Hank', species: 'Robot', position: 'TE', tier: 2, cost: 3 },
  { id: 'alien_te', name: 'Plasma Proboscis', species: 'Alien', position: 'TE', tier: 3, cost: 4 },
  { id: 'zom_te', name: 'Ooze Drippington', species: 'Zombie', position: 'TE', tier: 2, cost: 3 }
];

export const SHOP_POOL = [...ROSTER_POOL, ...TE_ROSTER_POOL];

export const ALL_PLAYERS_BY_ID = Object.fromEntries(
  SHOP_POOL.map((p) => [p.id, p])
);

export const RUN_STORAGE_KEY = 'graveyard-gridiron-run-v1';

// §8. Dirty Tricks (6 tricks)
export const DIRTY_TRICKS = {
  bribe_the_ref: {
    id: 'bribe_the_ref',
    name: 'Bribe The Ref',
    cost: 4,
    minGame: 1,
    scope: 'down',
    negatedHits: 2,
    penaltyYards: 10,
    description: "Next down: opponent's first 2 hits are called back (negated) + you gain +10 yards 'penalty'"
  },
  land_mine: {
    id: 'land_mine',
    name: 'Land Mine',
    cost: 3,
    minGame: 1,
    scope: 'drive',
    damage: 15,
    row: 3, // Scrimmage row
    description: 'Place on a scrimmage cell. First unit to step there takes 15 dmg. Might kill your own guy if shoved.'
  },
  chainsaw_handoff: {
    id: 'chainsaw_handoff',
    name: 'Chainsaw Handoff',
    cost: 5,
    minGame: 1,
    scope: 'drive',
    rbDmgMultiplier: 2.0, // +100% dmg
    selfDmgPerTick: 5,
    description: 'Your RB gets +100% dmg this drive, but takes 5 dmg per tick (it is a running chainsaw)'
  },
  steroid_slushie: {
    id: 'steroid_slushie',
    name: 'Steroid Slushie',
    cost: 3,
    minGame: 1,
    scope: 'game',
    statMult: 1.5, // +50% HP/dmg this game
    diesAfterGame: true,
    description: 'One player: +50% HP/dmg this game, dies automatically after the game. No loophole.'
  },
  fake_punt_grease: {
    id: 'fake_punt_grease',
    name: 'Fake Punt Grease',
    cost: 2,
    minGame: 1,
    scope: 'down',
    teamDodgeBonus: 0.20,
    teamDmgMult: 0.80, // -20% dmg
    description: 'Whole team +dodge 20% this down, -20% dmg (slippery)'
  },
  resurrection_insurance: {
    id: 'resurrection_insurance',
    name: 'Resurrection Insurance',
    cost: 8,
    minGame: 5,
    scope: 'game',
    surviveHp: 1,
    description: 'Expensive, rare (Games 5+): Next player on your team who dies this game instead survives at 1 HP — once.'
  }
};

// §9. Opponents — The Gauntlet (8 coaches)
// Note: Coach 7 is named "The Scab Squad" (adjusted from "The Replacements" for trademark safety)
export const COACHES = [
  {
    game: 1,
    id: 'coach_bones',
    name: 'Coach Bones',
    speciesFocus: 'Skeleton',
    fieldLimit: 5,
    starLevel: 1,
    tricks: [],
    telegraph: null,
    description: 'Tutorial-ish. Cheap rattly team, no tricks.'
  },
  {
    game: 2,
    id: 'coach_daisy',
    name: 'Coach Daisy Chainsaw',
    speciesFocus: 'Mixed',
    fieldLimit: 5,
    starLevel: 1,
    tricks: ['land_mine'],
    telegraph: 'Coach Daisy Chainsaw is burying something ticking on the 50-yard line...',
    description: 'First Land Mine.'
  },
  {
    game: 3,
    id: 'the_accountant',
    name: 'The Accountant',
    speciesFocus: 'Robot',
    fieldLimit: 6,
    starLevel: 1,
    tricks: ['bribe_the_ref'],
    telegraph: 'The Accountant just handed the referee a briefcase full of unmarked bills...',
    description: 'Armor stack, Bribe The Ref.'
  },
  {
    game: 4,
    id: 'glorp_prime',
    name: 'Glorp Prime',
    speciesFocus: 'Alien',
    fieldLimit: 6,
    starLevel: 1,
    tricks: ['fake_punt_grease'],
    telegraph: 'Glorp Prime coated the football in zero-gravity space mucus...',
    description: 'Blink everywhere, hard to pin.'
  },
  {
    game: 5,
    id: 'coach_corpsegrinder',
    name: 'Coach Corpsegrinder',
    speciesFocus: 'Zombie',
    fieldLimit: 6,
    starLevel: 2,
    tricks: ['land_mine'],
    telegraph: 'Coach Corpsegrinder has armed something shiny and biohazardous...',
    description: 'Poison, devour snowball.'
  },
  {
    game: 6,
    id: 'big_brenda',
    name: 'Big Brenda',
    speciesFocus: 'Orc',
    fieldLimit: 7,
    starLevel: 2,
    tricks: ['chainsaw_handoff'],
    telegraph: 'Big Brenda just pull-started a two-stroke chainsaw in the huddle...',
    description: 'Bloodlust snowball, Chainsaw RB.'
  },
  {
    game: 7,
    id: 'the_scab_squad',
    name: 'The Scab Squad',
    speciesFocus: 'Mixed',
    fieldLimit: 7,
    starLevel: 2,
    tricks: ['steroid_slushie'],
    telegraph: 'The Scab Squad is passing around a glowing radioactive slushie cup...',
    description: 'All 2-stars stat check. Steroid Slushie use.'
  },
  {
    game: 8,
    id: 'baron_von_blitz',
    name: 'BARON VON BLITZ, CHAMPION',
    speciesFocus: 'Mixed',
    fieldLimit: 7,
    starLevel: 3,
    tricks: ['chainsaw_handoff', 'land_mine'],
    telegraph: 'BARON VON BLITZ cackles as his crew wires mines AND revs a chainsaw!',
    description: 'Boss. Mixed 2/3-star, two tricks per game.'
  }
];

export const DEATH_TEMPLATES = {
  attack: [
    '{victim} got folded in half like a lawn chair by {killer}!',
    '{killer} knocked {victim}\'s helmet into the cheap seats (head still inside)!',
    '{victim} was turned into chunky stadium salsa by {killer}!',
    '{killer} suplexed {victim} straight into an open grave!'
  ],
  mine: [
    'Stepped on the Land Mine at lane {col} he was standing right next to!',
    'Detonated a buried Land Mine at lane {col} with his face!'
  ],
  chainsaw: [
    'Forgot which end of the Chainsaw Handoff was the handle!',
    'Revved the Chainsaw Handoff too hard and sawed himself in half!'
  ],
  poison: [
    'Dissolved into a puddle of neon green Zombie sludge!',
    'Melted from the inside out thanks to stacked Zombie rot!'
  ],
  skeleton_aoe: [
    'Caught fatal flying ribcage shrapnel from {killer}\'s bone explosion!'
  ],
  steroid_slushie: [
    'Heart exploded into neon confetti in the locker room after chugging a Steroid Slushie!'
  ]
};

// §10 & §15 (v1.1 Legacy & Comeback Floor)
export const META_STORAGE_KEY = 'graveyard-gridiron-meta-v1';

export const ECONOMY_CONFIG = {
  startGold: 10,
  winBaseGold: 6,
  winMaxSurvivorBonus: 5,
  lossGold: 5, // v1.1 Comeback Floor: raised from 3g to 5g
  rerollCost: 2,
  sellBenchRefund: 1,
  rookieSlotCost: 1
};

export const LEGACY_EARNING_RATES = {
  perUnspentGold: 1,
  perWin: 5,
  perKill: 1
};

export const LEGACY_UPGRADES = {
  deep_pockets: {
    id: 'deep_pockets',
    name: 'Deep Pockets',
    emoji: '💰',
    maxRank: 3,
    prices: [15, 25, 40],
    bonusGoldPerRank: 2,
    effectText: '+2 starting gold per rank'
  },
  thick_skulls: {
    id: 'thick_skulls',
    name: 'Thick Skulls',
    emoji: '🪖',
    maxRank: 3,
    prices: [15, 25, 40],
    hpBonusPctPerRank: 0.05,
    effectText: '+5% max HP for all player units per rank (applied after star scaling)'
  },
  trick_satchel: {
    id: 'trick_satchel',
    name: 'Trick Satchel',
    emoji: '🎒',
    maxRank: 1,
    prices: [30],
    freeTricksAtStart: 1,
    effectText: 'Start each run with 1 random Dirty Trick (unarmed)'
  },
  extra_heart: {
    id: 'extra_heart',
    name: 'Extra Heart',
    emoji: '❤️',
    maxRank: 1,
    prices: [50],
    bonusHeartsPerRank: 1,
    effectText: '+1 Team Heart at run start'
  },
  early_scouting: {
    id: 'early_scouting',
    name: 'Early Scouting',
    emoji: '🔭',
    maxRank: 1,
    prices: [35],
    gameTierOffset: 1,
    maxTierCap: 3,
    effectText: 'Shop tier unlock calculated as if game number were +1 (cap tier 3)'
  },
  cut_rate_insurance: {
    id: 'cut_rate_insurance',
    name: 'Cut-Rate Insurance',
    emoji: '⚡',
    maxRank: 1,
    prices: [25],
    discountedInsuranceCost: 4,
    effectText: 'Resurrection Insurance costs 4g instead of 8g'
  }
};

