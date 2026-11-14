// Graveyard Gridiron v1 — Deterministic Simulation Core (Spec §4, §5, §6, §7, §8, §12)
// Pure functions only; no DOM dependencies. Testable directly in Node.js.

import {
  FIELD_CONFIG,
  STAR_MULTIPLIERS,
  SPECIES,
  POSITIONS,
  ROSTER_POOL,
  TE_ROSTER_POOL,
  ALL_PLAYERS_BY_ID,
  DIRTY_TRICKS,
  DEATH_TEMPLATES,
  LEGACY_UPGRADES,
  LEGACY_EARNING_RATES
} from './data.js';
import { createRng } from './rng.js';

let nextUidCounter = 1;

/**
 * Create a unit instance from a player template ID or custom definition.
 */
export function createUnit(templateOrId, overrides = {}) {
  const baseTemplate =
    typeof templateOrId === 'string'
      ? ALL_PLAYERS_BY_ID[templateOrId]
      : templateOrId;

  if (!baseTemplate) {
    throw new Error(`Unknown player template: ${String(templateOrId)}`);
  }

  const speciesDef = SPECIES[overrides.species || baseTemplate.species];
  const posDef = POSITIONS[overrides.position || baseTemplate.position];
  if (!speciesDef || !posDef) {
    throw new Error(
      `Invalid species (${baseTemplate.species}) or position (${baseTemplate.position})`
    );
  }

  const side = overrides.side || baseTemplate.side || 'player';
  const stars = overrides.stars || baseTemplate.stars || 1;
  const starMult = STAR_MULTIPLIERS[stars] || 1.0;
  const steroidSlushie = Boolean(overrides.steroidSlushie ?? baseTemplate.steroidSlushie);
  const slushieMult = steroidSlushie ? DIRTY_TRICKS.steroid_slushie.statMult : 1.0;

  // §15 Thick Skulls: +5% max HP per rank for player units, applied after star scaling at unit creation
  const thickSkullsRank =
    side === 'player'
      ? Math.max(
          0,
          Number(
            overrides.thickSkullsRank ??
              overrides.thick_skulls ??
              overrides.upgrades?.thick_skulls ??
              overrides.legacyUpgrades?.thick_skulls ??
              baseTemplate.thickSkullsRank ??
              0
          )
        )
      : 0;
  const postStarBaseHp = Math.max(
    1,
    Math.round(posDef.baseHp * speciesDef.passive.hpMult * starMult)
  );
  const thickSkullsMult =
    1 + thickSkullsRank * LEGACY_UPGRADES.thick_skulls.hpBonusPctPerRank;
  const postLegacyHp = Math.max(1, Math.round(postStarBaseHp * thickSkullsMult));

  const rawHp = postLegacyHp * slushieMult;
  const rawDmg = posDef.baseDmg * speciesDef.passive.dmgMult * starMult * slushieMult;

  const maxHp = overrides.maxHp ?? Math.max(1, Math.round(rawHp));
  const hp = overrides.hp ?? maxHp;
  const dmg = overrides.dmg ?? Math.max(1, Math.round(rawDmg));
  const speed =
    overrides.speed ?? Math.max(1, posDef.baseSpeed + (speciesDef.passive.speedBonus || 0));
  const range =
    overrides.range ?? posDef.range + (speciesDef.passive.rangeBonus || 0);
  const armor = overrides.armor ?? (speciesDef.passive.baseArmor || 0);
  const dodge =
    overrides.dodge ??
    Math.min(0.75, (posDef.baseDodge || 0) + (speciesDef.passive.baseDodge || 0));

  const uid = overrides.uid || `${baseTemplate.id || 'unit'}_${nextUidCounter++}`;

  return {
    uid,
    id: baseTemplate.id || uid,
    templateId: baseTemplate.templateId || baseTemplate.id || uid,
    name: overrides.name || baseTemplate.name || uid,
    species: speciesDef.id,
    position: posDef.id,
    tier: baseTemplate.tier || 1,
    cost: overrides.cost ?? baseTemplate.cost ?? 1,
    stars,
    maxHp,
    baseMaxHp: maxHp,
    hp,
    dmg,
    baseDmg: dmg,
    speed,
    baseSpeed: speed,
    range,
    armor,
    dodge,
    poisonImmune: Boolean(speciesDef.passive.poisonImmune),
    poisonOnHit: speciesDef.passive.poisonOnHit || 0,
    side,
    row: overrides.row ?? baseTemplate.row ?? 0,
    col: overrides.col ?? baseTemplate.col ?? 0,
    alive: hp > 0,
    steroidSlushie,
    thickSkullsRank,
    poisonStacks: []
  };
}

/**
 * Automatic Star Combining (Spec §6 & §10):
 * 3 copies of same player (same id / name+species+position) at star S -> 1 copy at star S+1.
 * Cascades from 1-star -> 2-star -> 3-star.
 */
export function combineStars(roster) {
  let current = roster.map((u) => ({ ...u }));
  let combinedAny = false;
  const combineEvents = [];

  for (const targetStar of [1, 2]) {
    let changedInPass = true;
    while (changedInPass) {
      changedInPass = false;
      const groups = new Map();
      for (let i = 0; i < current.length; i++) {
        const u = current[i];
        if ((u.stars || 1) !== targetStar) continue;
        const key = `${u.templateId || u.id}::${u.species}::${u.position}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }

      for (const [, indices] of groups.entries()) {
        if (indices.length >= 3) {
          const [i1, i2, i3] = indices;
          const primary = current[i1];
          const trio = [current[i1], current[i2], current[i3]];
          const fieldedCopy = trio.find((u) => u.fielded || (u.row !== undefined && u.row !== null));
          const newStars = targetStar + 1;

          const tplRef = ALL_PLAYERS_BY_ID[primary.templateId || primary.id] || {
            ...primary,
            maxHp: undefined,
            hp: undefined,
            dmg: undefined
          };
          const upgraded = createUnit(tplRef, {
            uid: primary.uid,
            name: primary.name,
            stars: newStars,
            side: primary.side,
            row: fieldedCopy ? fieldedCopy.row : primary.row,
            col: fieldedCopy ? fieldedCopy.col : primary.col,
            steroidSlushie: trio.some((u) => u.steroidSlushie),
            thickSkullsRank: Math.max(...trio.map((u) => u.thickSkullsRank || 0))
          });
          upgraded.fielded = trio.some((u) => u.fielded);

          combineEvents.push({
            type: 'star_combine',
            templateId: primary.templateId || primary.id,
            name: primary.name,
            fromStars: targetStar,
            toStars: newStars,
            maxHp: upgraded.maxHp,
            dmg: upgraded.dmg
          });

          const removeSet = new Set([i1, i2, i3]);
          const nextList = [];
          for (let idx = 0; idx < current.length; idx++) {
            if (idx === i1) {
              nextList.push(upgraded);
            } else if (!removeSet.has(idx)) {
              nextList.push(current[idx]);
            }
          }
          current = nextList;
          changedInPass = true;
          combinedAny = true;
          break;
        }
      }
    }
  }

  return {
    roster: current,
    combined: combinedAny,
    events: combineEvents
  };
}

/**
 * Compute active Species Synergies for a fielded lineup (Spec §7).
 * Distinct fielded players per species trigger Synergy 2 and Synergy 4.
 */
export function computeSynergies(fieldedUnits) {
  const distinctBySpecies = {
    Skeleton: new Set(),
    Orc: new Set(),
    Robot: new Set(),
    Alien: new Set(),
    Zombie: new Set()
  };

  for (const u of fieldedUnits) {
    if (!u || u.hp <= 0) continue;
    if (distinctBySpecies[u.species]) {
      const distinctKey = u.templateId || u.id || u.uid;
      distinctBySpecies[u.species].add(distinctKey);
    }
  }

  const counts = {};
  const tiers = {};
  for (const sp of Object.keys(distinctBySpecies)) {
    const c = distinctBySpecies[sp].size;
    counts[sp] = c;
    tiers[sp] = c >= 4 ? 4 : c >= 2 ? 2 : 0;
  }

  return {
    counts,
    tiers,
    reassembleChance:
      tiers.Skeleton === 4
        ? SPECIES.Skeleton.synergies[4].reassembleChance
        : tiers.Skeleton === 2
        ? SPECIES.Skeleton.synergies[2].reassembleChance
        : 0,
    skeletonDeathAoe:
      tiers.Skeleton === 4 ? SPECIES.Skeleton.synergies[4].deathAoeDmg : 0,
    bloodlustDmgBonus:
      tiers.Orc === 4
        ? SPECIES.Orc.synergies[4].bloodlustDmgBonus
        : tiers.Orc === 2
        ? SPECIES.Orc.synergies[2].bloodlustDmgBonus
        : 0,
    orcKillHealPct:
      tiers.Orc === 4 ? SPECIES.Orc.synergies[4].killHealPct : 0,
    teamArmorBonus:
      tiers.Robot === 4
        ? SPECIES.Robot.synergies[4].teamArmorBonus
        : tiers.Robot === 2
        ? SPECIES.Robot.synergies[2].teamArmorBonus
        : 0,
    robotStationaryRepairPct:
      tiers.Robot === 4 ? SPECIES.Robot.synergies[4].stationaryRepairPct : 0,
    alienBlink: tiers.Alien >= 2,
    alienGuaranteedCrit: tiers.Alien === 4,
    zombiePoisonTicks:
      SPECIES.Zombie.passive.basePoisonTicks +
      (tiers.Zombie >= 2 ? SPECIES.Zombie.synergies[2].extraPoisonTicks : 0),
    zombieDevour: tiers.Zombie === 4
  };
}

function manhattan(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function isAdjacent(a, b) {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1;
}

export function designateBallCarrier(playerUnits, preferredCarrierUid = null) {
  const living = (playerUnits || []).filter((u) => u && u.alive !== false && (u.hp === undefined || u.hp > 0));
  if (living.length === 0) return null;
  if (preferredCarrierUid) {
    const preferred = living.find((u) => u.uid === preferredCarrierUid);
    if (preferred) return preferred;
  }
  const rb = living.find((u) => u.position === 'RB');
  if (rb) return rb;
  const qb = living.find((u) => u.position === 'QB');
  if (qb) return qb;
  return living[0];
}

export function selectTarget(unit, enemies) {
  const livingEnemies = enemies.filter((e) => e.alive && e.hp > 0);
  if (livingEnemies.length === 0) return null;

  // §6 OL TAUNT: enemies in adjacent cells must target OL
  const adjacentOls = livingEnemies.filter(
    (e) => e.position === 'OL' && isAdjacent(unit, e)
  );
  if (adjacentOls.length > 0) {
    adjacentOls.sort((a, b) => manhattan(unit, a) - manhattan(unit, b) || a.col - b.col);
    return adjacentOls[0];
  }

  // §5 Tuning Pass 2: In-range target preference (all units)
  // Filter to enemies within attack range first; only chase out-of-range enemies when none are in range.
  const unitRange = unit.range || 1;
  const inRangeEnemies = livingEnemies.filter((e) => manhattan(unit, e) <= unitRange);
  const candidatePool = inRangeEnemies.length > 0 ? inRangeEnemies : livingEnemies;

  const byNearest = (a, b) =>
    manhattan(unit, a) - manhattan(unit, b) ||
    a.hp - b.hp ||
    a.col - b.col ||
    a.row - b.row;

  switch (unit.position) {
    case 'QB': {
      // Furthest enemy (prioritize DB/LB among furthest)
      const sorted = [...candidatePool].sort((a, b) => {
        const dDiff = manhattan(unit, b) - manhattan(unit, a);
        if (dDiff !== 0) return dDiff;
        const aPri = a.position === 'DB' || a.position === 'LB' ? 1 : 0;
        const bPri = b.position === 'DB' || b.position === 'LB' ? 1 : 0;
        if (bPri !== aPri) return bPri - aPri;
        return a.col - b.col;
      });
      return sorted[0];
    }
    case 'WR': {
      // Lowest-HP enemy
      const sorted = [...candidatePool].sort(
        (a, b) => a.hp - b.hp || manhattan(unit, a) - manhattan(unit, b) || a.col - b.col
      );
      return sorted[0];
    }
    case 'LB': {
      // Enemy RB/QB first
      const priority = candidatePool.filter(
        (e) => e.position === 'RB' || e.position === 'QB'
      );
      if (priority.length > 0) {
        priority.sort((a, b) => {
          const aRb = a.position === 'RB' ? 0 : 1;
          const bRb = b.position === 'RB' ? 0 : 1;
          if (aRb !== bRb) return aRb - bRb;
          return byNearest(a, b);
        });
        return priority[0];
      }
      return [...candidatePool].sort(byNearest)[0];
    }
    case 'DB': {
      // Enemy QB/WR first
      const priority = candidatePool.filter(
        (e) => e.position === 'QB' || e.position === 'WR'
      );
      if (priority.length > 0) {
        priority.sort((a, b) => {
          const aQb = a.position === 'QB' ? 0 : 1;
          const bQb = b.position === 'QB' ? 0 : 1;
          if (aQb !== bQb) return aQb - bQb;
          return byNearest(a, b);
        });
        return priority[0];
      }
      return [...candidatePool].sort(byNearest)[0];
    }
    case 'RB':
    case 'OL':
    case 'TE':
    default:
      return [...candidatePool].sort(byNearest)[0];
  }
}

/**
 * §5 Tuning Pass 2 — Down-start opponent positioning (after formation reset):
 * 1. Coverage starts up: Each living opponent DB is matched to a distinct living player WR (nearest first)
 *    and starts the down at row 4 in that WR's lane if free (else nearest free row-4 cell, else its formation slot).
 * 2. Second-level pursuit: Any living opponent LB or DB who would start at row 5 in a lane (column) with
 *    no living opponent unit at row 4 steps up to that lane's free row-4 cell (or nearest free row-4 cell if taken).
 */
export function applyDownStartPositioning(playerUnits, opponentUnits, formationCoords = null) {
  const livingPlayers = (playerUnits || []).filter((u) => u.alive && u.hp > 0);
  const livingOpponents = (opponentUnits || []).filter((u) => u.alive && u.hp > 0);
  const allLiving = [...livingPlayers, ...livingOpponents];

  // Record which columns had a living opponent at row 4 right after formation reset
  const initialRow4OppCols = new Set(
    livingOpponents.filter((u) => u.row === 4).map((u) => u.col)
  );

  const isRow4ColFree = (col, ignoreUid = null) =>
    !allLiving.some((u) => u.uid !== ignoreUid && u.row === 4 && u.col === col);

  const findNearestFreeRow4Col = (preferredCol, tieBreakCol = preferredCol, ignoreUid = null) => {
    const cols = [0, 1, 2, 3, 4].filter((c) => isRow4ColFree(c, ignoreUid));
    if (cols.length === 0) return null;
    cols.sort(
      (a, b) =>
        Math.abs(a - preferredCol) - Math.abs(b - preferredCol) ||
        Math.abs(a - tieBreakCol) - Math.abs(b - tieBreakCol) ||
        a - b
    );
    return cols[0];
  };

  // 1. Coverage starts up: match each opponent DB to a distinct player WR (nearest first)
  const unmatchedDbs = livingOpponents.filter((u) => u.position === 'DB');
  const unmatchedWrs = livingPlayers.filter((u) => u.position === 'WR');

  while (unmatchedDbs.length > 0 && unmatchedWrs.length > 0) {
    let bestDbIdx = 0;
    let bestWrIdx = 0;
    let bestScore = Infinity;

    for (let di = 0; di < unmatchedDbs.length; di++) {
      const db = unmatchedDbs[di];
      for (let wi = 0; wi < unmatchedWrs.length; wi++) {
        const wr = unmatchedWrs[wi];
        const dist = manhattan(db, wr);
        const colDiff = Math.abs(db.col - wr.col);
        const score = dist * 100 + colDiff * 10 + wr.col;
        if (score < bestScore) {
          bestScore = score;
          bestDbIdx = di;
          bestWrIdx = wi;
        }
      }
    }

    const [db] = unmatchedDbs.splice(bestDbIdx, 1);
    const [wr] = unmatchedWrs.splice(bestWrIdx, 1);
    const dbStartCol = formationCoords?.get(db.uid)?.col ?? db.col;

    if (isRow4ColFree(wr.col, db.uid)) {
      db.row = 4;
      db.col = wr.col;
    } else {
      const freeCol = findNearestFreeRow4Col(wr.col, dbStartCol, db.uid);
      if (freeCol !== null) {
        db.row = 4;
        db.col = freeCol;
      }
    }
  }

  // 2. Second-level pursuit: any opponent LB or DB still at row 5 in a lane with no living row-4 opponent
  const row5Pursuers = livingOpponents.filter(
    (u) => (u.position === 'LB' || u.position === 'DB') && u.row === 5
  );

  for (const unit of row5Pursuers) {
    const laneCol = formationCoords?.get(unit.uid)?.col ?? unit.col;
    const laneHadNoRow4AtReset = !initialRow4OppCols.has(laneCol);
    const laneHasNoRow4Now = isRow4ColFree(laneCol, unit.uid);

    if (laneHadNoRow4AtReset || laneHasNoRow4Now) {
      if (isRow4ColFree(laneCol, unit.uid)) {
        unit.row = 4;
        unit.col = laneCol;
      } else {
        const freeCol = findNearestFreeRow4Col(laneCol, laneCol, unit.uid);
        if (freeCol !== null) {
          unit.row = 4;
          unit.col = freeCol;
        }
      }
    }
  }
}

function isCellOccupied(row, col, allUnits) {
  return allUnits.some((u) => u.alive && u.hp > 0 && u.row === row && u.col === col);
}

function chooseStepToward(unit, target, allUnits, isCarrier) {
  const candidates = [];
  const dRow = Math.sign(target.row - unit.row);
  const dCol = Math.sign(target.col - unit.col);

  // Player RB ball carrier prioritizes charging upfield (+row) when moving
  if (isCarrier && unit.side === 'player' && unit.row < FIELD_CONFIG.rows - 1) {
    candidates.push({ row: unit.row + 1, col: unit.col });
  }
  if (dRow !== 0) {
    candidates.push({ row: unit.row + dRow, col: unit.col });
  }
  if (dCol !== 0) {
    candidates.push({ row: unit.row, col: unit.col + dCol });
  }
  // Fallback sidesteps if direct path blocked
  if (dRow !== 0 && dCol === 0) {
    candidates.push({ row: unit.row, col: unit.col - 1 });
    candidates.push({ row: unit.row, col: unit.col + 1 });
  } else if (dCol !== 0 && dRow === 0) {
    const forwardRow = unit.side === 'player' ? unit.row + 1 : unit.row - 1;
    candidates.push({ row: forwardRow, col: unit.col });
  }

  for (const c of candidates) {
    if (
      c.row >= 0 &&
      c.row < FIELD_CONFIG.rows &&
      c.col >= 0 &&
      c.col < FIELD_CONFIG.cols &&
      !isCellOccupied(c.row, c.col, allUnits)
    ) {
      return c;
    }
  }
  return null;
}

function formatCauseOfDeath(reasonType, context, rng) {
  const list = DEATH_TEMPLATES[reasonType] || DEATH_TEMPLATES.attack;
  const tpl = rng.pick(list) || list[0];
  return tpl
    .replace('{victim}', context.victimName || 'Mutant')
    .replace('{killer}', context.killerName || 'Mystery Meat')
    .replace('{col}', String(context.col ?? 2));
}

/**
 * Pure deterministic simulation of a single 4-down Drive (Spec §5, §6, §7, §8, §12).
 *
 * @param {object} state - Drive state containing player & opponent lineups and optional tricks/modifiers
 * @param {number} rngSeed - Integer seed for deterministic PRNG
 */
export function simulateDrive(state, rngSeed = 1) {
  const rng = createRng(rngSeed);

  // Deep-clone fielded units so caller state is never mutated
  const rawPlayerUnits = (state.playerUnits || state.playerField || []).map((u, idx) =>
    createUnit(u, {
      ...u,
      side: 'player',
      row: u.row ?? Math.floor(idx / FIELD_CONFIG.cols),
      col: u.col ?? (idx % FIELD_CONFIG.cols)
    })
  );

  const rawOpponentUnits = (state.opponentUnits || state.opponentField || []).map((u, idx) =>
    createUnit(u, {
      ...u,
      side: 'opponent',
      row: u.row ?? (FIELD_CONFIG.rows - 1 - Math.floor(idx / FIELD_CONFIG.cols)),
      col: u.col ?? (idx % FIELD_CONFIG.cols)
    })
  );

  // Save initial formation coordinates for per-down line-of-scrimmage reset
  const formationCoords = new Map();
  for (const u of [...rawPlayerUnits, ...rawOpponentUnits]) {
    formationCoords.set(u.uid, { row: u.row, col: u.col });
  }

  // Compute initial species synergies per side
  const playerSynergies = computeSynergies(rawPlayerUnits);
  const opponentSynergies = computeSynergies(rawOpponentUnits);

  // Parse active Dirty Tricks for player and opponent
  const normalizeTricks = (trickInput) => {
    const arr = Array.isArray(trickInput)
      ? trickInput
      : trickInput
      ? [trickInput]
      : [];
    return {
      bribeTheRef: arr.includes('bribe_the_ref'),
      landMine: arr.includes('land_mine'),
      chainsawHandoff: arr.includes('chainsaw_handoff'),
      fakePuntGrease: arr.includes('fake_punt_grease'),
      resurrectionInsurance: arr.includes('resurrection_insurance'),
      steroidSlushie: arr.includes('steroid_slushie')
    };
  };

  const playerTricks = normalizeTricks(state.playerTricks || state.tricks?.player);
  const opponentTricks = normalizeTricks(state.opponentTricks || state.tricks?.opponent);

  const preferredCarrierUid = state.playerCarrierUid ?? state.carrierUid ?? null;

  // Apply Steroid Slushie (+50% HP/dmg this game, dies after game) if passed via trick flags
  const applySlushieIfArmed = (units, armed, targetUid, preferredUid = null) => {
    if (!armed) return null;
    if (units.some((u) => u.steroidSlushie)) {
      return units.find((u) => u.steroidSlushie);
    }
    const target =
      (targetUid && units.find((u) => u.uid === targetUid && u.alive)) ||
      designateBallCarrier(units, preferredUid) ||
      units.find((u) => u.alive);
    if (target) {
      const mult = DIRTY_TRICKS.steroid_slushie.statMult;
      target.steroidSlushie = true;
      target.maxHp = Math.round(target.maxHp * mult);
      target.baseMaxHp = target.maxHp;
      target.hp = Math.round(target.hp * mult);
      target.dmg = Math.round(target.dmg * mult);
      target.baseDmg = target.dmg;
    }
    return target;
  };

  const playerSlushieUnit = applySlushieIfArmed(
    rawPlayerUnits,
    playerTricks.steroidSlushie,
    state.steroidSlushieTargetUid,
    preferredCarrierUid
  );
  const opponentSlushieUnit = applySlushieIfArmed(
    rawOpponentUnits,
    opponentTricks.steroidSlushie,
    state.opponentSteroidSlushieTargetUid,
    null
  );

  // Track Resurrection Insurance availability (fires at most once per game/drive)
  let playerResInsuranceAvailable = Boolean(
    playerTricks.resurrectionInsurance || state.playerResurrectionInsurance
  );
  let opponentResInsuranceAvailable = Boolean(
    opponentTricks.resurrectionInsurance || state.opponentResurrectionInsurance
  );

  // Place Land Mines on scrimmage row (row 3)
  const activeMines = [];
  if (playerTricks.landMine) {
    const col = state.playerMineCol ?? 2;
    activeMines.push({ row: FIELD_CONFIG.scrimmageRow, col, owner: 'player', active: true });
  }
  if (opponentTricks.landMine) {
    const col = state.opponentMineCol ?? 1;
    activeMines.push({ row: FIELD_CONFIG.scrimmageRow, col, owner: 'opponent', active: true });
  }
  if (Array.isArray(state.mines)) {
    for (const m of state.mines) {
      activeMines.push({
        row: m.row ?? FIELD_CONFIG.scrimmageRow,
        col: m.col ?? 2,
        owner: m.owner || 'opponent',
        active: true
      });
    }
  }

  const events = [];
  if (playerSlushieUnit) {
    events.push({
      type: 'steroid_slushie',
      down: 1,
      tick: 0,
      unitId: playerSlushieUnit.uid,
      name: playerSlushieUnit.name,
      side: 'player',
      text: `🥤 STEROID SLUSHIE! ${playerSlushieUnit.name} chugged radioactive slush (+50% HP/DMG this game, doomed after)!`
    });
  }
  if (opponentSlushieUnit) {
    events.push({
      type: 'steroid_slushie',
      down: 1,
      tick: 0,
      unitId: opponentSlushieUnit.uid,
      name: opponentSlushieUnit.name,
      side: 'opponent',
      text: `🥤 STEROID SLUSHIE! Opponent's ${opponentSlushieUnit.name} is juiced (+50% HP/DMG)!`
    });
  }
  const ticks = [];
  const downs = [];
  const deaths = [];
  let driveYards = 0;
  let driveOutcome = 'TURNOVER';
  let drivePoints = 0;
  let massacre = false;
  let wipedSide = null;

  const getLiving = (units) => units.filter((u) => u.alive && u.hp > 0);

  // Guard: never emit ticks if a side starts the drive empty (Amendment 2)
  if (getLiving(rawPlayerUnits).length === 0 || getLiving(rawOpponentUnits).length === 0) {
    wipedSide = getLiving(rawPlayerUnits).length === 0 ? 'player' : 'opponent';
    massacre = true;
    driveOutcome = wipedSide === 'player' ? 'MASSACRE_LOSS' : 'MASSACRE_WIN';
    drivePoints = wipedSide === 'player' ? 0 : FIELD_CONFIG.tdPoints;
    events.push({
      type: 'massacre',
      down: 1,
      tick: 0,
      wipedSide,
      text:
        wipedSide === 'player'
          ? 'MASSACRE! No living players left to take the snap! Turnover!'
          : 'MASSACRE! The opposing team has zero living bodies! Automatic Touchdown!'
    });

    const earlyCarrier = designateBallCarrier(rawPlayerUnits, preferredCarrierUid);
    return {
      ticks,
      downs,
      yards: 0,
      points: drivePoints,
      opponentPoints: wipedSide === 'player' ? 14 : 0,
      outcome: driveOutcome,
      carrierUid: earlyCarrier ? earlyCarrier.uid : null,
      massacre: true,
      wipedSide,
      deaths,
      playerDeaths: [],
      opponentDeaths: [],
      events,
      survivingPlayerRoster: getLiving(rawPlayerUnits),
      survivingOpponentRoster: getLiving(rawOpponentUnits),
      synergies: { player: playerSynergies, opponent: opponentSynergies }
    };
  }

  // Designate Ball Carrier for the drive (§4 & §5 Tuning Pass 2: playerCarrierUid override if fielded & alive, else RB -> QB -> first living)
  const carrierUnit = designateBallCarrier(rawPlayerUnits, preferredCarrierUid);
  const carrierUid = carrierUnit ? carrierUnit.uid : null;

  // Bloodlust timers (in ticks)
  let playerBloodlustTicks = 0;
  let opponentBloodlustTicks = 0;

  // Helper to handle fatal damage, Resurrection Insurance, Skeleton AoE, Orc Bloodlust/Heal, Zombie Devour, and Team Wipe
  const handlePotentialDeath = (victim, killer, reasonType, downNum, tickNum, downEvents, tickEvents) => {
    if (!victim.alive || victim.hp > 0) return { died: false, teamWiped: false };

    // Check Resurrection Insurance (§8: survives at 1 HP — once)
    if (victim.side === 'player' && playerResInsuranceAvailable) {
      playerResInsuranceAvailable = false;
      victim.hp = 1;
      victim.alive = true;
      const insEv = {
        type: 'resurrection_insurance',
        down: downNum,
        tick: tickNum,
        unitId: victim.uid,
        name: victim.name,
        side: victim.side,
        text: `RESURRECTION INSURANCE! ${victim.name} flatlined but the stadium defibrillator brought him back at 1 HP!`
      };
      events.push(insEv);
      downEvents.push(insEv);
      tickEvents.push(insEv);
      return { died: false, teamWiped: false, resurrectedByInsurance: true };
    }

    if (victim.side === 'opponent' && opponentResInsuranceAvailable) {
      opponentResInsuranceAvailable = false;
      victim.hp = 1;
      victim.alive = true;
      const insEv = {
        type: 'resurrection_insurance',
        down: downNum,
        tick: tickNum,
        unitId: victim.uid,
        name: victim.name,
        side: victim.side,
        text: `RESURRECTION INSURANCE! Opponent's ${victim.name} survived at 1 HP!`
      };
      events.push(insEv);
      downEvents.push(insEv);
      tickEvents.push(insEv);
      return { died: false, teamWiped: false, resurrectedByInsurance: true };
    }

    // Confirmed Permadeath
    victim.hp = 0;
    victim.alive = false;

    const causeOfDeath = formatCauseOfDeath(
      reasonType,
      {
        victimName: victim.name,
        killerName: killer ? killer.name : 'The Turf Monster',
        col: victim.col
      },
      rng
    );

    const deathRecord = {
      uid: victim.uid,
      id: victim.id,
      templateId: victim.templateId,
      name: victim.name,
      species: victim.species,
      position: victim.position,
      stars: victim.stars || 1,
      thickSkullsRank: victim.thickSkullsRank || 0,
      side: victim.side,
      game: state.gameNumber || 1,
      down: downNum,
      tick: tickNum,
      killerId: killer ? killer.uid : null,
      killerName: killer ? killer.name : null,
      reasonType,
      causeOfDeath,
      eventsInDown: 0 // updated when down finishes
    };
    deaths.push(deathRecord);

    const killEv = {
      type: 'kill',
      down: downNum,
      tick: tickNum,
      victimId: victim.uid,
      victimName: victim.name,
      victimSide: victim.side,
      victimSpecies: victim.species,
      victimPosition: victim.position,
      killerId: killer ? killer.uid : null,
      killerName: killer ? killer.name : null,
      reasonType,
      causeOfDeath,
      text: causeOfDeath
    };
    events.push(killEv);
    downEvents.push(killEv);
    tickEvents.push(killEv);

    // If victim was the Player Ball Carrier, emit fumble notice
    if (victim.side === 'player' && victim.uid === carrierUid) {
      const fumbleEv = {
        type: 'fumble',
        down: downNum,
        tick: tickNum,
        unitId: victim.uid,
        name: victim.name,
        text: `FUMBLE! Ball carrier ${victim.name} was obliterated! The ball is loose!`
      };
      events.push(fumbleEv);
      downEvents.push(fumbleEv);
      tickEvents.push(fumbleEv);
    }

    // Trigger Orc Bloodlust on either side with >=2 Orcs (§7: after any player on either side dies)
    if (playerSynergies.bloodlustDmgBonus > 0) {
      playerBloodlustTicks = 2;
    }
    if (opponentSynergies.bloodlustDmgBonus > 0) {
      opponentBloodlustTicks = 2;
    }

    // Killer on-kill synergies (Orc 4 heal 20%, Zombie 4 devour +maxHp)
    if (killer && killer.alive && killer.hp > 0) {
      const killerSyn = killer.side === 'player' ? playerSynergies : opponentSynergies;
      if (killer.species === 'Orc' && killerSyn.orcKillHealPct > 0) {
        const healAmt = Math.max(1, Math.round(killer.maxHp * killerSyn.orcKillHealPct));
        killer.hp = Math.min(killer.maxHp, killer.hp + healAmt);
        const healEv = {
          type: 'orc_feast',
          down: downNum,
          tick: tickNum,
          unitId: killer.uid,
          name: killer.name,
          healAmt,
          text: `${killer.name} feasted on the carnage and healed ${healAmt} HP!`
        };
        events.push(healEv);
        downEvents.push(healEv);
        tickEvents.push(healEv);
      }
      if (killer.species === 'Zombie' && killerSyn.zombieDevour) {
        const gainedHp = victim.baseMaxHp || victim.maxHp;
        killer.maxHp += gainedHp;
        killer.hp += gainedHp;
        const devourEv = {
          type: 'zombie_devour',
          down: downNum,
          tick: tickNum,
          unitId: killer.uid,
          name: killer.name,
          gainedHp,
          text: `DEVOUR! ${killer.name} ate ${victim.name}'s brains and gained +${gainedHp} Max HP for the drive!`
        };
        events.push(devourEv);
        downEvents.push(devourEv);
        tickEvents.push(devourEv);
      }
    }

    // Skeleton Synergy 4: explode for AoE dmg on death to adjacent enemies
    const victimSyn = victim.side === 'player' ? playerSynergies : opponentSynergies;
    if (victim.species === 'Skeleton' && victimSyn.skeletonDeathAoe > 0 && reasonType !== 'skeleton_aoe') {
      const enemyPool = victim.side === 'player' ? rawOpponentUnits : rawPlayerUnits;
      const adjEnemies = getLiving(enemyPool).filter((e) => isAdjacent(victim, e));
      for (const adj of adjEnemies) {
        adj.hp -= victimSyn.skeletonDeathAoe;
        const aoeEv = {
          type: 'skeleton_aoe',
          down: downNum,
          tick: tickNum,
          sourceId: victim.uid,
          targetId: adj.uid,
          damage: victimSyn.skeletonDeathAoe,
          text: `${victim.name} exploded in a shower of sharp bones, hitting ${adj.name} for ${victimSyn.skeletonDeathAoe} dmg!`
        };
        events.push(aoeEv);
        downEvents.push(aoeEv);
        tickEvents.push(aoeEv);
        if (adj.hp <= 0) {
          handlePotentialDeath(adj, victim, 'skeleton_aoe', downNum, tickNum, downEvents, tickEvents);
        }
      }
    }

    // Check Team Wipe immediately (Amendment 2)
    const livingPlayersAfter = getLiving(rawPlayerUnits).length;
    const livingOpponentsAfter = getLiving(rawOpponentUnits).length;
    if (livingPlayersAfter === 0 || livingOpponentsAfter === 0) {
      wipedSide = livingPlayersAfter === 0 ? 'player' : 'opponent';
      massacre = true;
      const massacreEv = {
        type: 'massacre',
        down: downNum,
        tick: tickNum,
        wipedSide,
        text:
          wipedSide === 'player'
            ? 'MASSACRE! Every single player on your field has been wiped out! Drive over!'
            : 'MASSACRE! Your mutants wiped the entire opposing lineup off the field!'
      };
      events.push(massacreEv);
      downEvents.push(massacreEv);
      tickEvents.push(massacreEv);
      return { died: true, teamWiped: true };
    }

    return { died: true, teamWiped: false };
  };

  // Run up to 4 downs
  for (let downNum = 1; downNum <= FIELD_CONFIG.downsPerDrive; downNum++) {
    // Never start a down if either side is empty
    if (getLiving(rawPlayerUnits).length === 0 || getLiving(rawOpponentUnits).length === 0) {
      break;
    }

    // Reset surviving units to their formation starting slots and per-down health (§5: "HP is per-down health")
    const allUnits = [...rawPlayerUnits, ...rawOpponentUnits];
    for (const u of allUnits) {
      if (!u.alive || u.hp <= 0) continue;
      const startPos = formationCoords.get(u.uid);
      if (startPos) {
        u.row = startPos.row;
        u.col = startPos.col;
      }
      if (downNum > 1) {
        u.hp = u.maxHp;
      }
      u.movedThisDown = false;
      u.hasHitThisDown = false;
      u.dmg = u.baseDmg;
      u.speed = u.baseSpeed;
      u.poisonStacks = [];
    }

    // §5 Tuning Pass 2: Coverage starts up (opponent DBs match WRs at row 4) + Second-level pursuit (row-5 LB/DB step up to free row 4)
    applyDownStartPositioning(rawPlayerUnits, rawOpponentUnits, formationCoords);

    const downStartPositions = {};
    for (const u of allUnits) {
      if (u.alive && u.hp > 0) {
        downStartPositions[u.uid] = { row: u.row, col: u.col };
      }
    }

    const downEvents = [];
    let carrierCrossedScrimmage = false;
    let wrCatchTriggered = false;
    let wrCatchContested = false;
    let wrCatchBrokenUp = false;
    let carrierTackledForLoss = false;
    let qbSacked = false;
    let downIntercepted = false;
    let downEndedByMassacre = false;

    // Bribe The Ref applies on Down 1 when armed
    const playerBribeActive = downNum === 1 && playerTricks.bribeTheRef;
    const opponentBribeActive = downNum === 1 && opponentTricks.bribeTheRef;
    let opponentHitsNegatedByBribe = 0;
    let playerHitsNegatedByBribe = 0;

    // Fake Punt Grease applies on Down 1 when armed
    const playerGreaseActive = downNum === 1 && playerTricks.fakePuntGrease;
    const opponentGreaseActive = downNum === 1 && opponentTricks.fakePuntGrease;

    const livingCarrierAtStart = rawPlayerUnits.find(
      (u) => u.uid === carrierUid && u.alive && u.hp > 0
    );
    if (livingCarrierAtStart && livingCarrierAtStart.row >= FIELD_CONFIG.scrimmageRow) {
      carrierCrossedScrimmage = true;
    }

    // Run up to 8 ticks for this down
    for (let tickNum = 1; tickNum <= FIELD_CONFIG.ticksPerDown; tickNum++) {
      const livingPlayersStart = getLiving(rawPlayerUnits);
      const livingOpponentsStart = getLiving(rawOpponentUnits);

      // Never emit a tick if either side is empty
      if (livingPlayersStart.length === 0 || livingOpponentsStart.length === 0) {
        break;
      }

      const tickEvents = [];
      const attackersOnCarrierThisTick = new Set();

      // Sort all living units by speed descending (deterministic tie-breaker)
      const turnOrder = [...livingPlayersStart, ...livingOpponentsStart].sort((a, b) => {
        if (b.speed !== a.speed) return b.speed - a.speed;
        if (a.side !== b.side) return a.side === 'player' ? -1 : 1;
        if (a.row !== b.row) return b.row - a.row;
        return a.col - b.col;
      });

      for (const unit of turnOrder) {
        if (!unit.alive || unit.hp <= 0) continue;

        const enemies =
          unit.side === 'player' ? getLiving(rawOpponentUnits) : getLiving(rawPlayerUnits);
        const allies =
          unit.side === 'player' ? getLiving(rawPlayerUnits) : getLiving(rawOpponentUnits);
        const unitSyn = unit.side === 'player' ? playerSynergies : opponentSynergies;
        const enemySyn = unit.side === 'player' ? opponentSynergies : playerSynergies;

        if (enemies.length === 0) {
          break;
        }

        let target = selectTarget(unit, enemies);
        if (!target) continue;

        // §7 Alien Synergy 2 (Blink): teleport to target's row on tick 1 (skip the walk)
        if (tickNum === 1 && unit.species === 'Alien' && unitSyn.alienBlink) {
          const desiredRow = target.row;
          // Find closest available column to target on target's row (or adjacent row if full)
          const colCandidates = [0, 1, 2, 3, 4].sort(
            (c1, c2) => Math.abs(c1 - target.col) - Math.abs(c2 - target.col) || c1 - c2
          );
          let blinkCell = null;
          for (const c of colCandidates) {
            if (!isCellOccupied(desiredRow, c, allUnits)) {
              blinkCell = { row: desiredRow, col: c };
              break;
            }
          }
          if (blinkCell && (blinkCell.row !== unit.row || blinkCell.col !== unit.col)) {
            const fromRow = unit.row;
            const fromCol = unit.col;
            unit.row = blinkCell.row;
            unit.col = blinkCell.col;
            unit.movedThisDown = true;
            if (unit.uid === carrierUid && unit.row >= FIELD_CONFIG.scrimmageRow) {
              carrierCrossedScrimmage = true;
            }
            const blinkEv = {
              type: 'blink',
              down: downNum,
              tick: tickNum,
              unitId: unit.uid,
              name: unit.name,
              side: unit.side,
              from: { row: fromRow, col: fromCol },
              to: { row: unit.row, col: unit.col },
              text: `BLINK! ${unit.name} warped across space straight to row ${unit.row}!`
            };
            events.push(blinkEv);
            downEvents.push(blinkEv);
            tickEvents.push(blinkEv);
          }
        }

        // Re-evaluate distance after potential Blink
        target = selectTarget(unit, enemies);
        if (!target) continue;
        const dist = manhattan(unit, target);

        if (dist > unit.range) {
          // Move 1 cell toward target
          const nextCell = chooseStepToward(unit, target, allUnits, unit.uid === carrierUid);
          if (nextCell) {
            const from = { row: unit.row, col: unit.col };
            unit.row = nextCell.row;
            unit.col = nextCell.col;
            unit.movedThisDown = true;

            if (unit.uid === carrierUid && unit.row >= FIELD_CONFIG.scrimmageRow) {
              carrierCrossedScrimmage = true;
            }

            const moveEv = {
              type: 'move',
              down: downNum,
              tick: tickNum,
              unitId: unit.uid,
              name: unit.name,
              side: unit.side,
              from,
              to: { row: unit.row, col: unit.col }
            };
            events.push(moveEv);
            downEvents.push(moveEv);
            tickEvents.push(moveEv);

            // Check Land Mine on stepped cell (§8)
            const triggeredMine = activeMines.find(
              (m) => m.active && m.row === unit.row && m.col === unit.col
            );
            if (triggeredMine) {
              triggeredMine.active = false;
              const mineDmg = DIRTY_TRICKS.land_mine.damage;
              unit.hp -= mineDmg;
              const mineEv = {
                type: 'mine',
                down: downNum,
                tick: tickNum,
                unitId: unit.uid,
                name: unit.name,
                side: unit.side,
                row: unit.row,
                col: unit.col,
                damage: mineDmg,
                text: `KABOOM! ${unit.name} stepped on a Land Mine at lane ${unit.col} for ${mineDmg} dmg!`
              };
              events.push(mineEv);
              downEvents.push(mineEv);
              tickEvents.push(mineEv);

              if (unit.hp <= 0) {
                const deathRes = handlePotentialDeath(
                  unit,
                  null,
                  'mine',
                  downNum,
                  tickNum,
                  downEvents,
                  tickEvents
                );
                if (deathRes.teamWiped) {
                  downEndedByMassacre = true;
                  break;
                }
                if (deathRes.died) continue;
              }
            }
          }
        } else {
          // Target is in range: Attack / Ability
          // Check QB PASS every 3rd tick (§6)
          if (unit.position === 'QB' && tickNum % POSITIONS.QB.passIntervalTicks === 0) {
            const enemyDbs = enemies.filter((e) => e.position === 'DB');
            let interceptedBy = null;
            for (const db of enemyDbs) {
              if (rng.chance(POSITIONS.DB.interceptChance)) {
                interceptedBy = db;
                break;
              }
            }

            if (interceptedBy && unit.side === 'player') {
              downIntercepted = true;
              const intEv = {
                type: 'intercept',
                down: downNum,
                tick: tickNum,
                qbId: unit.uid,
                qbName: unit.name,
                dbId: interceptedBy.uid,
                dbName: interceptedBy.name,
                text: `PICKED OFF! ${interceptedBy.name} snatched ${unit.name}'s pass out of the air! Down over, 0 yards!`
              };
              events.push(intEv);
              downEvents.push(intEv);
              tickEvents.push(intEv);
              break;
            }

            // Buff friendly WRs (+dmg, +speed) and check Catch on tick 3
            const friendlyWrs = allies.filter((a) => a.position === 'WR');
            for (const wr of friendlyWrs) {
              wr.dmg += POSITIONS.QB.passWrDmgBuff;
              wr.speed += POSITIONS.QB.passWrSpeedBuff;
            }

            if (unit.side === 'player' && tickNum === 3 && friendlyWrs.length > 0) {
              const unmarkedWr = friendlyWrs.find(
                (wr) => !enemies.some((e) => manhattan(wr, e) <= 1)
              );
              const targetWr = unmarkedWr || friendlyWrs[0];
              const contestingDefender = enemies.find((e) => manhattan(targetWr, e) <= 1) || null;

              if (!contestingDefender) {
                // Unmarked WR: automatic catch as before
                wrCatchTriggered = true;
                const catchEv = {
                  type: 'catch',
                  down: downNum,
                  tick: tickNum,
                  qbId: unit.uid,
                  qbName: unit.name,
                  wrId: targetWr.uid,
                  wrName: targetWr.name,
                  contested: false,
                  brokenUp: false,
                  yardsBonus: 15,
                  text: `BOMB COMPLETE! ${unit.name} hit an wide-open ${targetWr.name} in stride for a +15 yd Catch play!`
                };
                events.push(catchEv);
                downEvents.push(catchEv);
                tickEvents.push(catchEv);
              } else {
                // §5 Tuning Pass 2: Contested catch (enemy within Manhattan 1 of targeted WR at tick 3)
                // 50% broken up (no +15, ticker logs "BROKEN UP!"), 50% completed anyway (+15 yards)
                wrCatchContested = true;
                if (rng.chance(0.5)) {
                  wrCatchBrokenUp = true;
                  const breakupEv = {
                    type: 'pass_breakup',
                    down: downNum,
                    tick: tickNum,
                    qbId: unit.uid,
                    qbName: unit.name,
                    wrId: targetWr.uid,
                    wrName: targetWr.name,
                    defenderId: contestingDefender.uid,
                    defenderName: contestingDefender.name,
                    contested: true,
                    brokenUp: true,
                    yardsBonus: 0,
                    text: `BROKEN UP! ${contestingDefender.name} jarred the pass loose from ${targetWr.name} in tight coverage!`
                  };
                  events.push(breakupEv);
                  downEvents.push(breakupEv);
                  tickEvents.push(breakupEv);
                } else {
                  wrCatchTriggered = true;
                  const catchEv = {
                    type: 'catch',
                    down: downNum,
                    tick: tickNum,
                    qbId: unit.uid,
                    qbName: unit.name,
                    wrId: targetWr.uid,
                    wrName: targetWr.name,
                    defenderId: contestingDefender.uid,
                    defenderName: contestingDefender.name,
                    contested: true,
                    brokenUp: false,
                    yardsBonus: 15,
                    text: `CONTESTED CATCH! ${targetWr.name} mossed ${contestingDefender.name} in traffic for a +15 yd Catch play!`
                  };
                  events.push(catchEv);
                  downEvents.push(catchEv);
                  tickEvents.push(catchEv);
                }
              }
            }
          }

          // Check Bribe The Ref hit callback (§8)
          if (
            unit.side === 'opponent' &&
            playerBribeActive &&
            opponentHitsNegatedByBribe < DIRTY_TRICKS.bribe_the_ref.negatedHits
          ) {
            opponentHitsNegatedByBribe++;
            const bribeEv = {
              type: 'bribe_callback',
              down: downNum,
              tick: tickNum,
              attackerId: unit.uid,
              attackerName: unit.name,
              targetId: target.uid,
              targetName: target.name,
              text: `FLAG ON THE PLAY! The bribed ref called back ${unit.name}'s hit for "Excessive Breathing"!`
            };
            events.push(bribeEv);
            downEvents.push(bribeEv);
            tickEvents.push(bribeEv);
            continue;
          }

          if (
            unit.side === 'player' &&
            opponentBribeActive &&
            playerHitsNegatedByBribe < DIRTY_TRICKS.bribe_the_ref.negatedHits
          ) {
            playerHitsNegatedByBribe++;
            const bribeEv = {
              type: 'bribe_callback',
              down: downNum,
              tick: tickNum,
              attackerId: unit.uid,
              attackerName: unit.name,
              targetId: target.uid,
              targetName: target.name,
              text: `RIGGED REF! Your hit by ${unit.name} was negated by the crooked official!`
            };
            events.push(bribeEv);
            downEvents.push(bribeEv);
            tickEvents.push(bribeEv);
            continue;
          }

          // Check Alien 4-synergy guaranteed crit on first hit of down
          const isGuaranteedCrit =
            unit.species === 'Alien' && unitSyn.alienGuaranteedCrit && !unit.hasHitThisDown;

          // Check Dodge
          const greaseDodgeBonus =
            (target.side === 'player' && playerGreaseActive) ||
            (target.side === 'opponent' && opponentGreaseActive)
              ? DIRTY_TRICKS.fake_punt_grease.teamDodgeBonus
              : 0;
          const effectiveDodge = Math.min(0.85, target.dodge + greaseDodgeBonus);

          if (!isGuaranteedCrit && effectiveDodge > 0 && rng.chance(effectiveDodge)) {
            const dodgeEv = {
              type: 'dodge',
              down: downNum,
              tick: tickNum,
              attackerId: unit.uid,
              attackerName: unit.name,
              targetId: target.uid,
              targetName: target.name,
              text: `WHIFF! ${target.name} greased out of ${unit.name}'s tackle!`
            };
            events.push(dodgeEv);
            downEvents.push(dodgeEv);
            tickEvents.push(dodgeEv);
            continue;
          }

          // Compute attack damage
          let rawAttackDmg = unit.dmg;

          // RB bonus damage when moving
          if (unit.position === 'RB' && unit.movedThisDown) {
            rawAttackDmg += POSITIONS.RB.moveDmgBonus;
          }

          // LB +50% damage against RB
          if (unit.position === 'LB' && target.position === 'RB') {
            rawAttackDmg *= POSITIONS.LB.rbDmgMultiplier;
          }

          // Orc Bloodlust team damage buff
          const bloodlustActive =
            unit.side === 'player' ? playerBloodlustTicks > 0 : opponentBloodlustTicks > 0;
          if (bloodlustActive && unitSyn.bloodlustDmgBonus > 0) {
            rawAttackDmg *= 1 + unitSyn.bloodlustDmgBonus;
          }

          // Chainsaw Handoff (+100% RB damage)
          const chainsawActive =
            (unit.side === 'player' && playerTricks.chainsawHandoff) ||
            (unit.side === 'opponent' && opponentTricks.chainsawHandoff);
          if (chainsawActive && unit.position === 'RB') {
            rawAttackDmg *= DIRTY_TRICKS.chainsaw_handoff.rbDmgMultiplier;
          }

          // Fake Punt Grease (-20% team damage this down)
          const attackerGrease =
            (unit.side === 'player' && playerGreaseActive) ||
            (unit.side === 'opponent' && opponentGreaseActive);
          if (attackerGrease) {
            rawAttackDmg *= DIRTY_TRICKS.fake_punt_grease.teamDmgMult;
          }

          // Alien 4-synergy guaranteed first-hit crit
          if (isGuaranteedCrit) {
            rawAttackDmg *= SPECIES.Alien.synergies[4].critMultiplier;
          }
          unit.hasHitThisDown = true;

          // OL Carrier Shield: if target is Ball Carrier and friendly OL is in same/adjacent lane (-30% dmg)
          const targetAllies =
            target.side === 'player' ? getLiving(rawPlayerUnits) : getLiving(rawOpponentUnits);
          if (
            target.side === 'player' &&
            target.uid === carrierUid &&
            targetAllies.some(
              (a) => a.position === 'OL' && Math.abs(a.col - target.col) <= 1
            )
          ) {
            rawAttackDmg *= 1 - POSITIONS.OL.carrierShieldReduction;
          }

          // Target Armor (Robot passive + Robot Plating team synergy)
          const totalArmor = target.armor + (enemySyn.teamArmorBonus || 0);
          const finalDmg = Math.max(1, Math.round(rawAttackDmg) - totalArmor);

          target.hp -= finalDmg;

          // Track yardage penalties (carrier tackled by 2+ enemies in one tick; QB sacked while someone else is carrier)
          if (target.side === 'player' && target.uid === carrierUid) {
            attackersOnCarrierThisTick.add(unit.uid);
            if (attackersOnCarrierThisTick.size >= 2) {
              carrierTackledForLoss = true;
            }
          }
          if (
            target.side === 'player' &&
            target.position === 'QB' &&
            target.uid !== carrierUid
          ) {
            qbSacked = true;
            const sackEv = {
              type: 'sack',
              down: downNum,
              tick: tickNum,
              attackerId: unit.uid,
              attackerName: unit.name,
              qbId: target.uid,
              qbName: target.name,
              damage: finalDmg,
              text: `SACKED! ${unit.name} blindsided QB ${target.name} for ${finalDmg} dmg (-5 yds)!`
            };
            events.push(sackEv);
            downEvents.push(sackEv);
            tickEvents.push(sackEv);
          }

          const hitEv = {
            type: 'attack',
            down: downNum,
            tick: tickNum,
            attackerId: unit.uid,
            attackerName: unit.name,
            attackerSide: unit.side,
            targetId: target.uid,
            targetName: target.name,
            targetSide: target.side,
            damage: finalDmg,
            crit: isGuaranteedCrit,
            targetRemainingHp: Math.max(0, target.hp)
          };
          events.push(hitEv);
          downEvents.push(hitEv);
          tickEvents.push(hitEv);

          // Zombie Poison on hit (§7: 2 dmg/tick, stacks; Robots are immune)
          if (unit.species === 'Zombie' && target.hp > 0 && !target.poisonImmune) {
            target.poisonStacks.push({
              dmg: SPECIES.Zombie.passive.poisonOnHit,
              ticksRemaining: unitSyn.zombiePoisonTicks,
              sourceUnit: unit
            });
          }

          // TE Shove every 4th tick (§6: shoves enemy back 1 row)
          if (
            unit.position === 'TE' &&
            tickNum % POSITIONS.TE.shoveIntervalTicks === 0 &&
            target.hp > 0
          ) {
            const shoveRow =
              target.side === 'opponent'
                ? Math.min(FIELD_CONFIG.rows - 1, target.row + 1)
                : Math.max(0, target.row - 1);
            if (shoveRow !== target.row && !isCellOccupied(shoveRow, target.col, allUnits)) {
              target.row = shoveRow;
              const shoveEv = {
                type: 'shove',
                down: downNum,
                tick: tickNum,
                attackerId: unit.uid,
                attackerName: unit.name,
                targetId: target.uid,
                targetName: target.name,
                toRow: shoveRow,
                col: target.col,
                text: `SHOVE! ${unit.name} bulldozed ${target.name} back to row ${shoveRow}!`
              };
              events.push(shoveEv);
              downEvents.push(shoveEv);
              tickEvents.push(shoveEv);

              // Check if shoved onto an active Land Mine!
              const shovedMine = activeMines.find(
                (m) => m.active && m.row === target.row && m.col === target.col
              );
              if (shovedMine) {
                shovedMine.active = false;
                target.hp -= DIRTY_TRICKS.land_mine.damage;
                const mineEv = {
                  type: 'mine',
                  down: downNum,
                  tick: tickNum,
                  unitId: target.uid,
                  name: target.name,
                  side: target.side,
                  row: target.row,
                  col: target.col,
                  damage: DIRTY_TRICKS.land_mine.damage,
                  text: `SHOVED ONTO A MINE! ${target.name} landed on a Land Mine at lane ${target.col}!`
                };
                events.push(mineEv);
                downEvents.push(mineEv);
                tickEvents.push(mineEv);
              }
            }
          }

          // Check target death
          if (target.hp <= 0) {
            const deathRes = handlePotentialDeath(
              target,
              unit,
              'attack',
              downNum,
              tickNum,
              downEvents,
              tickEvents
            );
            if (deathRes.teamWiped) {
              downEndedByMassacre = true;
              break;
            }
          }
        }
      }

      // End-of-tick effects (only if down hasn't already ended by massacre or intercept)
      if (!downEndedByMassacre && !downIntercepted) {
        // 1. Zombie Poison stacks
        for (const u of [...rawPlayerUnits, ...rawOpponentUnits]) {
          if (!u.alive || u.hp <= 0 || u.poisonStacks.length === 0) continue;
          let poisonDmg = 0;
          let lastPoisoner = null;
          for (const stack of u.poisonStacks) {
            poisonDmg += stack.dmg;
            stack.ticksRemaining -= 1;
            lastPoisoner = stack.sourceUnit || lastPoisoner;
          }
          u.poisonStacks = u.poisonStacks.filter((s) => s.ticksRemaining > 0);
          if (poisonDmg > 0) {
            u.hp -= poisonDmg;
            const pEv = {
              type: 'poison_tick',
              down: downNum,
              tick: tickNum,
              unitId: u.uid,
              name: u.name,
              damage: poisonDmg,
              remainingHp: Math.max(0, u.hp)
            };
            events.push(pEv);
            downEvents.push(pEv);
            tickEvents.push(pEv);
            if (u.hp <= 0) {
              const deathRes = handlePotentialDeath(
                u,
                lastPoisoner,
                'poison',
                downNum,
                tickNum,
                downEvents,
                tickEvents
              );
              if (deathRes.teamWiped) {
                downEndedByMassacre = true;
                break;
              }
            }
          }
        }
      }

      if (!downEndedByMassacre && !downIntercepted) {
        // 2. Chainsaw Handoff self-damage (5 dmg/tick to RB)
        const chainsawSides = [];
        if (playerTricks.chainsawHandoff) chainsawSides.push(rawPlayerUnits);
        if (opponentTricks.chainsawHandoff) chainsawSides.push(rawOpponentUnits);

        for (const sideUnits of chainsawSides) {
          const rbs = getLiving(sideUnits).filter((u) => u.position === 'RB');
          for (const rb of rbs) {
            rb.hp -= DIRTY_TRICKS.chainsaw_handoff.selfDmgPerTick;
            const csEv = {
              type: 'chainsaw_burn',
              down: downNum,
              tick: tickNum,
              unitId: rb.uid,
              name: rb.name,
              damage: DIRTY_TRICKS.chainsaw_handoff.selfDmgPerTick,
              remainingHp: Math.max(0, rb.hp)
            };
            events.push(csEv);
            downEvents.push(csEv);
            tickEvents.push(csEv);
            if (rb.hp <= 0) {
              const deathRes = handlePotentialDeath(
                rb,
                rb,
                'chainsaw',
                downNum,
                tickNum,
                downEvents,
                tickEvents
              );
              if (deathRes.teamWiped) {
                downEndedByMassacre = true;
                break;
              }
            }
          }
          if (downEndedByMassacre) break;
        }
      }

      // Decrement Bloodlust timers
      if (playerBloodlustTicks > 0) playerBloodlustTicks--;
      if (opponentBloodlustTicks > 0) opponentBloodlustTicks--;

      // Record emitted tick
      ticks.push({
        down: downNum,
        tick: tickNum,
        startPositions: tickNum === 1 ? downStartPositions : undefined,
        playerAliveStart: livingPlayersStart.length,
        opponentAliveStart: livingOpponentsStart.length,
        playerAliveEnd: getLiving(rawPlayerUnits).length,
        opponentAliveEnd: getLiving(rawOpponentUnits).length,
        events: tickEvents
      });

      if (downEndedByMassacre || downIntercepted) {
        break;
      }
    }

    // Backfill eventsInDown on any deaths that occurred during this down (for Funniest Death rule in Build 3)
    for (const d of deaths) {
      if (d.down === downNum) {
        d.eventsInDown = downEvents.length;
      }
    }

    // If the down ended via Team Wipe (Amendment 2), end the drive immediately!
    if (downEndedByMassacre) {
      if (wipedSide === 'player') {
        driveOutcome = 'MASSACRE_LOSS';
        drivePoints = 0; // 0 points regardless of cumulative yards!
      } else {
        driveOutcome = 'MASSACRE_WIN';
        drivePoints = FIELD_CONFIG.tdPoints;
      }
      downs.push({
        down: downNum,
        yards: 0,
        rawYards: 0,
        cumulativeYards: driveYards,
        outcome: driveOutcome,
        startPositions: downStartPositions,
        events: downEvents
      });
      break;
    }

    // Robot Synergy 4: stationary Robots repair 10% HP at end of down
    for (const [sideUnits, syn] of [
      [rawPlayerUnits, playerSynergies],
      [rawOpponentUnits, opponentSynergies]
    ]) {
      if (syn.robotStationaryRepairPct > 0) {
        for (const u of getLiving(sideUnits)) {
          if (u.species === 'Robot' && !u.movedThisDown) {
            const repair = Math.max(1, Math.round(u.maxHp * syn.robotStationaryRepairPct));
            u.hp = Math.min(u.maxHp, u.hp + repair);
          }
        }
      }
    }

    // Compute Yardage for this down (§5)
    let rawYards = 0;
    let clampedDownYards = 0;
    let lanesWon = 0;
    const carrierAliveAtEnd = rawPlayerUnits.some(
      (u) => u.uid === carrierUid && u.alive && u.hp > 0
    );
    const qbAliveAtEnd = rawPlayerUnits.some(
      (u) => u.position === 'QB' && u.alive && u.hp > 0
    );

    if (downIntercepted) {
      // §6 DB INTERCEPT: down ends immediately, 0 yards that down
      rawYards = 0;
      clampedDownYards = 0;
    } else {
      for (let col = 0; col < FIELD_CONFIG.cols; col++) {
        const playerColHp = getLiving(rawPlayerUnits)
          .filter((u) => u.col === col)
          .reduce((sum, u) => sum + u.hp, 0);
        const oppColHp = getLiving(rawOpponentUnits)
          .filter((u) => u.col === col)
          .reduce((sum, u) => sum + u.hp, 0);
        if (playerColHp > oppColHp) {
          lanesWon++;
        }
      }

      // §6: If QB dies, WR loses Catch
      const effectiveWrCatch = wrCatchTriggered && qbAliveAtEnd;

      rawYards =
        4 * lanesWon +
        (carrierAliveAtEnd ? 8 : 0) +
        (carrierCrossedScrimmage ? 12 : 0) +
        (effectiveWrCatch ? 15 : 0) -
        (carrierTackledForLoss ? 6 : 0) -
        (qbSacked ? 5 : 0) +
        (playerBribeActive ? DIRTY_TRICKS.bribe_the_ref.penaltyYards : 0) -
        (opponentBribeActive ? DIRTY_TRICKS.bribe_the_ref.penaltyYards : 0);

      clampedDownYards = Math.max(
        FIELD_CONFIG.minDownYards,
        Math.min(FIELD_CONFIG.maxDownYards, rawYards)
      );
    }

    driveYards += clampedDownYards;

    const downEndEv = {
      type: 'down_end',
      down: downNum,
      yardsThisDown: clampedDownYards,
      rawYards,
      cumulativeYards: driveYards,
      lanesWon,
      carrierAliveAtEnd,
      carrierCrossedScrimmage,
      wrCatchTriggered: wrCatchTriggered && qbAliveAtEnd,
      wrCatchContested,
      wrCatchBrokenUp,
      carrierTackledForLoss,
      qbSacked,
      downIntercepted,
      text: `End of Down ${downNum}: ${clampedDownYards >= 0 ? '+' : ''}${clampedDownYards} yds (Drive total: ${driveYards} yds)`
    };
    events.push(downEndEv);
    downEvents.push(downEndEv);

    downs.push({
      down: downNum,
      yards: clampedDownYards,
      rawYards,
      cumulativeYards: driveYards,
      lanesWon,
      carrierAliveAtEnd,
      carrierCrossedScrimmage,
      wrCatch: wrCatchTriggered && qbAliveAtEnd,
      wrCatchContested,
      wrCatchBrokenUp,
      carrierTackledForLoss,
      qbSacked,
      intercepted: downIntercepted,
      startPositions: downStartPositions,
      events: downEvents
    });

    // Check Touchdown (>= 80 cumulative yards)
    if (driveYards >= FIELD_CONFIG.tdYards) {
      driveOutcome = 'TD';
      drivePoints = FIELD_CONFIG.tdPoints;
      events.push({
        type: 'drive_end',
        down: downNum,
        outcome: 'TD',
        yards: driveYards,
        points: drivePoints,
        text: `TOUCHDOWN! ${driveYards} yards! +7 points and the crowd goes bananas!`
      });
      break;
    }

    // Check Ball Carrier Fumble (§4: If carrier dies mid-drive, ball drops; that drive is lost)
    if (!carrierAliveAtEnd) {
      driveOutcome = 'FUMBLE';
      drivePoints = 0;
      events.push({
        type: 'drive_end',
        down: downNum,
        outcome: 'FUMBLE',
        yards: driveYards,
        points: 0,
        text: `TURNOVER BY FUMBLE! Your Ball Carrier is dead on the turf! Drive lost (0 pts)!`
      });
      break;
    }

    // After 4th down, check Field Goal window (>= 50 yards, or >= 40 with kickerSynergy) vs Turnover
    if (downNum === FIELD_CONFIG.downsPerDrive) {
      const fgThreshold = state.kickerSynergy
        ? FIELD_CONFIG.fgYardsKicker
        : FIELD_CONFIG.fgYards;
      if (driveYards >= fgThreshold) {
        driveOutcome = 'FG';
        drivePoints = FIELD_CONFIG.fgPoints;
        events.push({
          type: 'drive_end',
          down: downNum,
          outcome: 'FG',
          yards: driveYards,
          points: drivePoints,
          text: `FIELD GOAL IS GOOD from ${100 - driveYards} yards out! +3 points!`
        });
      } else {
        driveOutcome = 'TURNOVER';
        drivePoints = 0;
        events.push({
          type: 'drive_end',
          down: downNum,
          outcome: 'TURNOVER',
          yards: driveYards,
          points: 0,
          text: `TURNOVER ON DOWNS at ${driveYards} yards! Zero points!`
        });
      }
    }
  }

  // Opponent simulated scoring (§5 Tuning Pass 1: clamp(12 - round(driveYards / 6), 0, 12); MASSACRE_WIN = 0; player wipe = 14)
  const opponentPoints = computeOpponentPoints(driveYards, driveOutcome);

  // §5: Surviving players heal to full baseMaxHp between DRIVES. Dead stays dead.
  const survivingPlayerRoster = getLiving(rawPlayerUnits).map((u) => ({
    ...u,
    maxHp: u.baseMaxHp,
    hp: u.baseMaxHp,
    dmg: u.baseDmg,
    speed: u.baseSpeed,
    poisonStacks: []
  }));

  const survivingOpponentRoster = getLiving(rawOpponentUnits).map((u) => ({
    ...u,
    maxHp: u.baseMaxHp,
    hp: u.baseMaxHp,
    dmg: u.baseDmg,
    speed: u.baseSpeed,
    poisonStacks: []
  }));

  return {
    ticks,
    downs,
    yards: driveYards,
    points: drivePoints,
    opponentPoints,
    outcome: driveOutcome,
    carrierUid,
    massacre,
    wipedSide,
    deaths,
    playerDeaths: deaths.filter((d) => d.side === 'player'),
    opponentDeaths: deaths.filter((d) => d.side === 'opponent'),
    events,
    survivingPlayerRoster,
    survivingOpponentRoster,
    resurrectionInsuranceUsed: {
      player:
        Boolean(playerTricks.resurrectionInsurance || state.playerResurrectionInsurance) &&
        !playerResInsuranceAvailable,
      opponent:
        Boolean(opponentTricks.resurrectionInsurance || state.opponentResurrectionInsurance) &&
        !opponentResInsuranceAvailable
    },
    synergies: {
      player: playerSynergies,
      opponent: opponentSynergies
    }
  };
}

/**
 * Per-drive simulated opponent scoring (Spec §5 Tuning Pass 1):
 * - MASSACRE_WIN -> 0
 * - MASSACRE_LOSS (player wipe) -> 14
 * - Otherwise -> clamp(12 - round(driveYards / 6), 0, 12)
 */
export function computeOpponentPoints(driveYards, driveOutcome = 'TURNOVER') {
  if (driveOutcome === 'MASSACRE_WIN') return 0;
  if (driveOutcome === 'MASSACRE_LOSS') return 14;
  return Math.max(0, Math.min(12, 12 - Math.round(driveYards / 6)));
}

/**
 * Compute Legacy Gold earned at run end (Spec §15):
 * Legacy earned = unspent run gold (1:1) + 5 per game won + 1 per total kill.
 * Supports either object `{ unspentGold, wins, kills }` or positional `(unspentGold, wins, kills)`.
 */
export function computeLegacyEarned(arg1 = 0, winsArg = 0, killsArg = 0) {
  const isObj = typeof arg1 === 'object' && arg1 !== null;
  const rawGold = isObj ? (arg1.unspentGold ?? arg1.gold ?? 0) : arg1;
  const rawWins = isObj ? (arg1.wins ?? 0) : winsArg;
  const rawKills = isObj ? (arg1.kills ?? arg1.totalKills ?? 0) : killsArg;

  const unspentGold = Math.max(0, Math.floor(rawGold));
  const wins = Math.max(0, Math.floor(rawWins));
  const kills = Math.max(0, Math.floor(rawKills));

  const unspentBonus = unspentGold * LEGACY_EARNING_RATES.perUnspentGold;
  const winsBonus = wins * LEGACY_EARNING_RATES.perWin;
  const killsBonus = kills * LEGACY_EARNING_RATES.perKill;
  const total = unspentBonus + winsBonus + killsBonus;

  if (!isObj) {
    return total;
  }

  return {
    unspentGold,
    wins,
    kills,
    unspentBonus,
    winBonus: winsBonus,
    winsBonus,
    killBonus: killsBonus,
    killsBonus,
    total,
    valueOf() {
      return total;
    }
  };
}

/**
 * Post-Game Permadeath & Exceptions Resolver (Spec §1.2, §7, §8):
 * - Removes dead players permanently from the roster.
 * - Skeleton Reassemble (Synergy 2 = 30%, Synergy 4 = 60%): rolls AT MOST ONCE per dead Skeleton trigger
 *   to return that Skeleton to the bench after the game.
 * - Steroid Slushie: any surviving player who took Steroid Slushie dies automatically after the game.
 */
export function resolvePostGamePermadeath({
  survivingRoster = [],
  gameDeaths = [],
  skeletonSynergyTier = 0,
  rngSeed = 1
}) {
  const rng = createRng(rngSeed);
  const reassembleChance =
    skeletonSynergyTier >= 4
      ? SPECIES.Skeleton.synergies[4].reassembleChance
      : skeletonSynergyTier >= 2
      ? SPECIES.Skeleton.synergies[2].reassembleChance
      : 0;

  const finalRoster = [];
  const finalGraveyard = [];
  const reassembled = [];
  const processedDeathUids = new Set();

  // 1. Check surviving players for Steroid Slushie post-game death (§8: No loophole)
  for (const unit of survivingRoster) {
    if (!unit.alive || unit.hp <= 0) continue;
    if (unit.steroidSlushie) {
      finalGraveyard.push({
        uid: unit.uid,
        id: unit.id,
        name: unit.name,
        species: unit.species,
        position: unit.position,
        stars: unit.stars || 1,
        side: 'player',
        reasonType: 'steroid_slushie',
        causeOfDeath: DEATH_TEMPLATES.steroid_slushie[0]
      });
    } else {
      finalRoster.push({
        ...unit,
        hp: unit.baseMaxHp || unit.maxHp
      });
    }
  }

  // 2. Process game deaths — Skeleton Reassemble is the ONLY post-game permadeath exception
  for (const death of gameDeaths) {
    if (death.side && death.side !== 'player') continue;
    if (processedDeathUids.has(death.uid)) continue;
    processedDeathUids.add(death.uid);

    if (
      death.species === 'Skeleton' &&
      reassembleChance > 0 &&
      !death.reassembleAttempted
    ) {
      death.reassembleAttempted = true; // Fires at most once per trigger
      if (rng.chance(reassembleChance)) {
        const revivedUnit = createUnit(death.templateId || death.id, {
          uid: death.uid,
          name: death.name,
          stars: death.stars || 1,
          side: 'player',
          thickSkullsRank: death.thickSkullsRank || 0
        });
        revivedUnit.fielded = false; // Returns to bench
        revivedUnit.reassembled = true;
        finalRoster.push(revivedUnit);
        reassembled.push(revivedUnit);
        continue;
      }
    }

    finalGraveyard.push(death);
  }

  return {
    roster: finalRoster,
    graveyard: finalGraveyard,
    reassembled
  };
}

/**
 * Bench Auto-Promotion & Roster Wipe Check between drives/games (Amendment 2).
 */
export function promoteBenchToField(fieldUnits, benchUnits, fieldLimit = FIELD_CONFIG.defaultFieldLimit) {
  const livingField = fieldUnits.filter((u) => u.alive && u.hp > 0);
  const livingBench = benchUnits.filter((u) => u.alive && u.hp > 0);

  while (livingField.length < fieldLimit && livingBench.length > 0) {
    const promoted = livingBench.shift();
    // Place frontline (OL, LB, TE, RB) in row 2 (closest to scrimmage) and backfield (WR, DB, QB) in row 1/0
    const preferredRows =
      promoted.position === 'QB'
        ? [0, 1, 2]
        : promoted.position === 'WR' || promoted.position === 'DB'
        ? [1, 2, 0]
        : [2, 1, 0];
    const colOrder = [2, 1, 3, 0, 4]; // Center lanes first

    let placed = false;
    for (const r of preferredRows) {
      for (const c of colOrder) {
        if (!isCellOccupied(r, c, livingField)) {
          promoted.row = r;
          promoted.col = c;
          promoted.fielded = true;
          livingField.push(promoted);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) break;
  }

  const totalLiving = livingField.length + livingBench.length;
  return {
    field: livingField,
    bench: livingBench,
    rosterWiped: totalLiving === 0
  };
}
