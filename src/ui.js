// Graveyard Gridiron v1 — Full UI, Gauntlet, Dirty Tricks, Persistence & WebAudio Controller (Build 3)
// Pure vanilla JS ES module, no framework, no build step, no external assets.

import {
  FIELD_CONFIG,
  SPECIES,
  POSITIONS,
  ROSTER_POOL,
  SHOP_POOL,
  DIRTY_TRICKS,
  COACHES,
  RUN_STORAGE_KEY
} from './data.js';
import {
  createUnit,
  combineStars,
  computeSynergies,
  simulateDrive,
  resolvePostGamePermadeath,
  promoteBenchToField
} from './sim.js';
import { createRng } from './rng.js';

const SPECIES_SPLAT_ICON = {
  Skeleton: '🦴💥',
  Orc: '🩸💥',
  Robot: '⚙️⚡',
  Alien: '🧪✨',
  Zombie: '🦠🩸'
};

const TRICK_SHORT_LABELS = {
  bribe_the_ref: '💸Bribe',
  land_mine: '💣Mine',
  chainsaw_handoff: '🪚Saw',
  steroid_slushie: '🥤Slush',
  fake_punt_grease: '🧈Grease',
  resurrection_insurance: '⚡Insure'
};

// Trivial muteable WebAudio synthesizer (Spec §11 & Build 3 — zero external audio assets)
class SoundBleeper {
  constructor() {
    this.muted = false;
    this.ctx = null;
  }

  ensureContext() {
    if (this.muted) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone(freq = 440, duration = 0.08, type = 'square', endFreq = null, gainVal = 0.06) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (endFreq !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + duration);
      }
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Ignore audio errors on restricted autoplay
    }
  }

  play(effect) {
    if (this.muted) return;
    switch (effect) {
      case 'snap':
        this.playTone(580, 0.09, 'square', 880, 0.07);
        break;
      case 'hit':
        this.playTone(170, 0.06, 'triangle', 75, 0.06);
        break;
      case 'splat':
        this.playTone(320, 0.18, 'sawtooth', 55, 0.09);
        break;
      case 'mine':
        this.playTone(140, 0.22, 'sawtooth', 35, 0.1);
        break;
      case 'td':
        this.playTone(440, 0.09, 'square', 660, 0.07);
        setTimeout(() => this.playTone(660, 0.14, 'square', 880, 0.07), 90);
        break;
      case 'buy':
        this.playTone(620, 0.07, 'sine', 920, 0.06);
        break;
      case 'cup':
        this.playTone(523, 0.1, 'square', 659, 0.08);
        setTimeout(() => this.playTone(659, 0.1, 'square', 784, 0.08), 100);
        setTimeout(() => this.playTone(784, 0.2, 'square', 1046, 0.09), 200);
        break;
      default:
        this.playTone(400, 0.05, 'sine');
    }
  }
}

// Procedural Commentary Templates (Spec §11 — no LLM, templates only)
const TICKER_TEMPLATES = {
  kill: (ev) =>
    `💀 SPLAT! ${ev.causeOfDeath} (${ev.victimName} is worm food!)`,
  sack: (ev) =>
    `🚨 SACKED! ${ev.attackerName} folded QB ${ev.qbName} like a wet taco (-5 yds)!`,
  catch: (ev) =>
    `🚀 AIR MAIL! ${ev.qbName} laser-beamed ${ev.wrName} for a +15 yd Catch play!`,
  intercept: (ev) =>
    `🧤 PICKED OFF! ${ev.dbName} mugged the air and stole ${ev.qbName}'s pass! Down over (0 yds)!`,
  mine: (ev) =>
    `💣 KABOOM! ${ev.name} stepped on the lane ${ev.col} Land Mine and lost ${ev.damage} HP!`,
  blink: (ev) =>
    `👽 ZORP! ${ev.name} blinked through the 4th dimension straight to row ${ev.to.row}!`,
  shove: (ev) =>
    `🚧 BULLDOZER! ${ev.attackerName} shoved ${ev.targetName} backward into row ${ev.toRow}!`,
  fumble: (ev) =>
    `🏈 FUMBLE! Ball carrier ${ev.name} got vaporized and coughed up the pigskin!`,
  resurrection_insurance: (ev) =>
    `⚡ DEFIBRILLATOR! Resurrection Insurance saved ${ev.name} at 1 HP!`,
  steroid_slushie: (ev) =>
    `🥤 JUICED! ${ev.name} chugged a Steroid Slushie (+50% HP/DMG this game, doomed after)!`,
  bribe_callback: (ev) =>
    `💸 RIGGED REF! Official called back ${ev.attackerName}'s hit on ${ev.targetName}!`,
  massacre: (ev) =>
    ev.wipedSide === 'player'
      ? `☠️ MASSACRE! Your entire fielded squad was wiped off the turf! Turnover (0 pts)!`
      : `🔥 MASSACRE! Your mutants obliterated every last opponent on the field!`,
  big_gain: (ev) =>
    `📈 HUGE GAIN! +${ev.yardsThisDown} yards on Down ${ev.down} (Drive at ${ev.cumulativeYards}/80 yds)!`,
  down_end: (ev) =>
    `📏 Down ${ev.down} complete: ${ev.yardsThisDown >= 0 ? '+' : ''}${ev.yardsThisDown} yds (Total: ${ev.cumulativeYards}/80 yds).`,
  drive_end: (ev) => {
    if (ev.outcome === 'TD') return `🎉 TOUCHDOWN!! ${ev.yards} yards! +7 points! The bleachers are on fire!`;
    if (ev.outcome === 'FG') return `🥅 IT'S GOOD! Field Goal drilled after 4 downs (${ev.yards} yds) for +3 points!`;
    if (ev.outcome === 'FUMBLE') return `💀 DRIVE LOST BY FUMBLE! Carrier died on the field (0 pts)!`;
    return `🛑 TURNOVER ON DOWNS at ${ev.yards} yards! 0 points!`;
  }
};

/**
 * Coach ferocity damage multiplier by game number (Spec §5 Tuning Pass 1):
 * Games 1-2: ×0.80, Games 3-5: ×0.85, Games 6-7: ×0.95, Game 8: ×1.00
 */
export function getCoachFerocityMultiplier(gameNumber = 1) {
  if (gameNumber <= 2) return 0.8;
  if (gameNumber <= 5) return 0.85;
  if (gameNumber <= 7) return 0.95;
  return 1.0;
}

export class GraveyardGridironUI {
  constructor() {
    this.sfx = new SoundBleeper();
    this.rng = createRng(20261113);
    this.seedCounter = 1001;

    // Run & Game state
    this.gameNumber = 1; // 1..8
    this.gold = 10;
    this.teamHearts = 3;
    this.fieldRoster = [];
    this.benchRoster = [];
    this.shopSlots = [];
    this.heldTricks = []; // max 3: array of { uid, id, armed }
    this.gameResurrectionInsuranceArmed = false;
    this.atShopBoundary = false;

    // Run cumulative stats for Run Summary (§3 & Build 3)
    this.runStats = {
      wins: 0,
      losses: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalYards: 0
    };

    this.selectedUnitUid = null;
    this.lastCombineMessage = '';

    // Current Game (4 drives) state
    this.driveNumber = 1; // 1..4 (or 5 for sudden death)
    this.currentDownDisplay = 1;
    this.currentDriveYards = 0;
    this.playerGameScore = 0;
    this.opponentGameScore = 0;
    this.driveHistory = [];
    this.currentGameDeaths = [];
    this.allRunDeaths = [];
    this.lastReassembled = [];

    // Opponent lineup for current game
    this.opponentField = [];
    this.opponentBench = [];

    // Battle replay state
    this.isReplaying = false;
    this.replaySpeedMode = 1; // 1 = normal (300ms), 2 = fast (150ms), 3 = instant (18ms)
    this.driveSplats = [];

    if (typeof document !== 'undefined') {
      this.bindElements();
      if (!this.loadRunFromStorage()) {
        this.startNewRun(false);
      }
    } else {
      this.generateOpponentRoster();
    }
  }

  bindElements() {
    this.els = {
      gameBadge: document.getElementById('hud-game-badge'),
      coachName: document.getElementById('hud-coach-name'),
      driveDownLabel: document.getElementById('hud-drive-down'),
      scoreNumbers: document.getElementById('hud-score-numbers'),
      goldDisplay: document.getElementById('hud-gold'),
      heartsDisplay: document.getElementById('hud-hearts'),
      muteBtn: document.getElementById('mute-btn'),
      openShopBtn: document.getElementById('open-shop-btn'),
      resetRunBtn: document.getElementById('reset-run-btn'),
      benchSlotsRow: document.getElementById('bench-slots-row'),
      tricksArmRow: document.getElementById('tricks-arm-row'),
      synergyPills: document.getElementById('synergy-pills'),
      fieldGrid: document.getElementById('field-grid'),
      thermoFill: document.getElementById('thermo-fill'),
      thermoYards: document.getElementById('thermo-yards'),
      tickerHeadline: document.getElementById('ticker-headline'),
      tickerSubline: document.getElementById('ticker-subline'),
      snapBtn: document.getElementById('snap-btn'),
      speedBtn: document.getElementById('speed-btn'),

      // Modals
      shopModal: document.getElementById('shop-modal'),
      shopGameNum: document.getElementById('shop-game-num'),
      shopGold: document.getElementById('shop-gold'),
      shopFieldCount: document.getElementById('shop-field-count'),
      shopTricksCount: document.getElementById('shop-tricks-count'),
      combineBanner: document.getElementById('combine-banner'),
      shopCardsGrid: document.getElementById('shop-cards-grid'),
      shopTricksGrid: document.getElementById('shop-tricks-grid'),
      rerollBtn: document.getElementById('shop-reroll-btn'),
      autoDraftBtn: document.getElementById('shop-autodraft-btn'),
      shopRosterList: document.getElementById('shop-roster-list'),
      shopResetRunBtn: document.getElementById('shop-reset-run-btn'),
      closeShopBtn: document.getElementById('close-shop-btn'),

      resultModal: document.getElementById('result-modal'),
      resultContent: document.getElementById('result-content'),
      toGraveyardBtn: document.getElementById('to-graveyard-btn'),

      graveyardModal: document.getElementById('graveyard-modal'),
      reassembleBanner: document.getElementById('reassemble-banner'),
      tombstoneGrid: document.getElementById('tombstone-grid'),
      nextGameShopBtn: document.getElementById('next-game-shop-btn'),

      runSummaryModal: document.getElementById('run-summary-modal'),
      runSummaryTitle: document.getElementById('run-summary-title'),
      runSummaryContent: document.getElementById('run-summary-content'),
      newRunBtn: document.getElementById('new-run-btn')
    };

    this.els.muteBtn.addEventListener('click', () => {
      this.toggleMute();
    });

    this.els.openShopBtn.addEventListener('click', () => {
      if (this.isReplaying) return;
      this.openShopModal();
    });

    this.els.resetRunBtn.addEventListener('click', () => {
      if (this.isReplaying) return;
      this.hardResetRun();
    });

    this.els.shopResetRunBtn.addEventListener('click', () => {
      this.hardResetRun();
    });

    this.els.closeShopBtn.addEventListener('click', () => {
      this.closeShopModal();
    });

    this.els.rerollBtn.addEventListener('click', () => {
      this.rerollShop();
    });

    this.els.autoDraftBtn.addEventListener('click', () => {
      this.quickDraftStarters();
    });

    this.els.snapBtn.addEventListener('click', () => {
      this.handleSnapClick();
    });

    this.els.speedBtn.addEventListener('click', () => {
      this.cycleReplaySpeed();
    });

    this.els.toGraveyardBtn.addEventListener('click', () => {
      this.els.resultModal.classList.add('hidden');
      this.openGraveyardModal();
    });

    this.els.nextGameShopBtn.addEventListener('click', () => {
      this.els.graveyardModal.classList.add('hidden');
      this.advanceAfterGraveyard();
    });

    this.els.newRunBtn.addEventListener('click', () => {
      this.els.runSummaryModal.classList.add('hidden');
      this.hardResetRun();
    });
  }

  toggleMute() {
    this.sfx.muted = !this.sfx.muted;
    this.els.muteBtn.textContent = this.sfx.muted ? '🔇' : '🔊';
    if (!this.sfx.muted) {
      this.sfx.play('buy');
    }
    this.saveRunToStorage();
  }

  getFieldLimit() {
    return FIELD_CONFIG.fieldLimitByGame[Math.min(7, this.gameNumber - 1)] || 6;
  }

  getCurrentCoach() {
    return COACHES[Math.min(COACHES.length - 1, this.gameNumber - 1)];
  }

  /**
   * Persist run state to localStorage under key 'graveyard-gridiron-run-v1' (Spec §12 & Build 3)
   */
  saveRunToStorage() {
    try {
      const payload = {
        version: 1,
        seedCounter: this.seedCounter,
        gameNumber: this.gameNumber,
        gold: this.gold,
        teamHearts: this.teamHearts,
        fieldRoster: this.fieldRoster,
        benchRoster: this.benchRoster,
        shopSlots: this.shopSlots,
        heldTricks: this.heldTricks,
        gameResurrectionInsuranceArmed: this.gameResurrectionInsuranceArmed,
        atShopBoundary: this.atShopBoundary,
        runStats: this.runStats,
        driveNumber: this.driveNumber,
        currentDownDisplay: this.currentDownDisplay,
        currentDriveYards: this.currentDriveYards,
        playerGameScore: this.playerGameScore,
        opponentGameScore: this.opponentGameScore,
        driveHistory: this.driveHistory,
        currentGameDeaths: this.currentGameDeaths,
        allRunDeaths: this.allRunDeaths,
        opponentField: this.opponentField,
        opponentBench: this.opponentBench,
        muted: this.sfx.muted
      };
      window.localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }

  loadRunFromStorage() {
    try {
      const raw = window.localStorage.getItem(RUN_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !Array.isArray(data.fieldRoster)) return false;

      this.seedCounter = data.seedCounter || 1001;
      this.gameNumber = data.gameNumber || 1;
      this.gold = data.gold ?? 10;
      this.teamHearts = data.teamHearts ?? 3;
      this.fieldRoster = data.fieldRoster || [];
      this.benchRoster = data.benchRoster || [];
      this.shopSlots = data.shopSlots || [];
      this.heldTricks = data.heldTricks || [];
      this.gameResurrectionInsuranceArmed = Boolean(data.gameResurrectionInsuranceArmed);
      this.atShopBoundary = Boolean(data.atShopBoundary);
      this.runStats = data.runStats || {
        wins: 0,
        losses: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalYards: 0
      };
      this.driveNumber = data.driveNumber || 1;
      this.currentDownDisplay = data.currentDownDisplay || 1;
      this.currentDriveYards = data.currentDriveYards || 0;
      this.playerGameScore = data.playerGameScore || 0;
      this.opponentGameScore = data.opponentGameScore || 0;
      this.driveHistory = data.driveHistory || [];
      this.currentGameDeaths = data.currentGameDeaths || [];
      this.allRunDeaths = data.allRunDeaths || [];
      this.opponentField = data.opponentField || [];
      this.opponentBench = data.opponentBench || [];
      this.sfx.muted = Boolean(data.muted);
      this.els.muteBtn.textContent = this.sfx.muted ? '🔇' : '🔊';

      if (this.opponentField.length === 0) {
        this.generateOpponentRoster();
      }

      this.renderAll();
      if (this.atShopBoundary) {
        this.openShopModal();
      } else {
        this.announceMatchupTelegraph();
      }
      return true;
    } catch {
      return false;
    }
  }

  hardResetRun() {
    try {
      window.localStorage.removeItem(RUN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    this.els.shopModal.classList.add('hidden');
    this.els.resultModal.classList.add('hidden');
    this.els.graveyardModal.classList.add('hidden');
    this.els.runSummaryModal.classList.add('hidden');
    this.startNewRun(true);
  }

  startNewRun(fromReset = false) {
    this.gameNumber = 1;
    this.gold = 10;
    this.teamHearts = 3;
    this.fieldRoster = [];
    this.benchRoster = [];
    this.heldTricks = [];
    this.gameResurrectionInsuranceArmed = false;
    this.atShopBoundary = false;
    this.allRunDeaths = [];
    this.runStats = {
      wins: 0,
      losses: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalYards: 0
    };
    this.selectedUnitUid = null;
    this.lastCombineMessage = '';

    this.rollShopSlots();
    this.quickDraftStarters();
    this.setupGameMatchup();
    this.saveRunToStorage();
    this.renderAll();

    if (fromReset) {
      this.setTicker('🔄 RUN RESET! Fresh 10g budget drafted for Game 1 vs Coach Bones!', 'Tap 🛒 SHOP or press SNAP!');
    }
  }

  rollShopSlots() {
    // §7 Costs by tier: Tier 1 (Games 1-2 shop) 1-2g, Tier 2 (3-5) 2-3g, Tier 3 (6-8) 3-5g
    // Build 3 includes TE_ROSTER_POOL via SHOP_POOL!
    const maxTier = this.gameNumber <= 2 ? 1 : this.gameNumber <= 5 ? 2 : 3;
    const eligible = SHOP_POOL.filter((p) => p.tier <= maxTier);
    this.shopSlots = [];

    const isInitialRoll = this.fieldRoster.length === 0 && this.benchRoster.length === 0 && this.gold === 10;
    const rbs = eligible.filter((p) => p.position === 'RB');
    const ols = eligible.filter((p) => p.position === 'OL');
    const tes = eligible.filter((p) => p.position === 'TE');

    for (let i = 0; i < 5; i++) {
      let pick;
      if (isInitialRoll && i === 0 && rbs.length > 0) {
        pick = this.rng.pick(rbs);
      } else if (isInitialRoll && i === 1 && ols.length > 0) {
        pick = this.rng.pick(ols);
      } else if (i === 4 && tes.length > 0 && this.rng.chance(0.45)) {
        pick = this.rng.pick(tes);
      } else {
        pick = this.rng.pick(eligible) || SHOP_POOL[i % SHOP_POOL.length];
      }
      this.shopSlots.push({
        slotIndex: i,
        template: pick,
        sold: false
      });
    }
  }

  rerollShop() {
    if (this.gold < 2) {
      this.setTicker('💸 BROKE! You need 2g to reroll the Shop!', 'Sell a benched mutant (+1g) or go play a drive.');
      return;
    }
    this.gold -= 2;
    this.sfx.play('buy');
    this.rollShopSlots();
    this.saveRunToStorage();
    this.renderShopModal();
    this.renderHud();
  }

  quickDraftStarters() {
    for (let i = 0; i < this.shopSlots.length; i++) {
      const slot = this.shopSlots[i];
      if (!slot.sold && this.gold >= slot.template.cost) {
        this.buyShopSlot(i, true);
      }
    }
    this.autoPlaceBenchIfSpace();
    this.saveRunToStorage();
    this.renderAll();
    if (!this.els.shopModal.classList.contains('hidden')) {
      this.renderShopModal();
    }
  }

  buyShopSlot(slotIndex, silent = false) {
    const slot = this.shopSlots[slotIndex];
    if (!slot || slot.sold) return false;
    if (this.gold < slot.template.cost) {
      if (!silent) {
        this.setTicker('💸 NOT ENOUGH GOLD!', `${slot.template.name} costs ${slot.template.cost}g.`);
      }
      return false;
    }

    this.gold -= slot.template.cost;
    slot.sold = true;

    const newUnit = createUnit(slot.template.id, { side: 'player' });
    newUnit.fielded = false;
    this.benchRoster.push(newUnit);

    this.checkAndApplyStarCombine();
    this.autoPlaceBenchIfSpace();

    if (!silent) {
      this.sfx.play('buy');
      this.setTicker(
        `🛒 SIGNED: ${newUnit.name} (${newUnit.species} ${newUnit.position})!`,
        this.lastCombineMessage || 'Tap a player and tap rows 0-2 to arrange formation.'
      );
      this.saveRunToStorage();
      this.renderAll();
      this.renderShopModal();
    }
    return true;
  }

  buyDirtyTrick(trickId) {
    const trickDef = DIRTY_TRICKS[trickId];
    if (!trickDef) return false;
    if (this.heldTricks.length >= 3) {
      this.setTicker('🧨 MAX 3 TRICKS HELD!', 'Arm and use one of your held Dirty Tricks before buying more!');
      return false;
    }
    if (this.gameNumber < (trickDef.minGame || 1)) {
      this.setTicker('🔒 LOCKED!', `${trickDef.name} is only available from Game ${trickDef.minGame}+!`);
      return false;
    }
    if (this.gold < trickDef.cost) {
      this.setTicker('💸 NOT ENOUGH GOLD!', `${trickDef.name} costs ${trickDef.cost}g.`);
      return false;
    }

    this.gold -= trickDef.cost;
    this.heldTricks.push({
      uid: `trick_${Date.now()}_${this.seedCounter++}`,
      id: trickDef.id,
      name: trickDef.name,
      armed: false
    });
    this.sfx.play('buy');
    this.setTicker(`🧨 BOUGHT DIRTY TRICK: ${trickDef.name}!`, 'Tap its chip in the bar before a drive to ARM it!');
    this.saveRunToStorage();
    this.renderAll();
    this.renderShopModal();
    return true;
  }

  toggleArmTrick(trickUid) {
    if (this.isReplaying) return;
    const item = this.heldTricks.find((t) => t.uid === trickUid);
    if (!item) return;
    item.armed = !item.armed;
    this.sfx.play('buy');
    const def = DIRTY_TRICKS[item.id];
    this.setTicker(
      item.armed ? `🔥 ARMED TRICK: ${def.name.toUpperCase()}!` : `🧯 Disarmed ${def.name}.`,
      def.description
    );
    this.saveRunToStorage();
    this.renderAll();
    if (!this.els.shopModal.classList.contains('hidden')) {
      this.renderShopModal();
    }
  }

  sellBenchedUnit(uid) {
    const idx = this.benchRoster.findIndex((u) => u.uid === uid);
    if (idx === -1) return;
    const [removed] = this.benchRoster.splice(idx, 1);
    this.gold += 1;
    if (this.selectedUnitUid === uid) this.selectedUnitUid = null;
    this.sfx.play('buy');
    this.setTicker(`♻️ SOLD ${removed.name} to the glue factory for +1g!`, `Gold is now ${this.gold}g.`);
    this.saveRunToStorage();
    this.renderAll();
    this.renderShopModal();
  }

  checkAndApplyStarCombine() {
    const combinedAll = [
      ...this.fieldRoster.map((u) => ({ ...u, fielded: true })),
      ...this.benchRoster.map((u) => ({ ...u, fielded: false }))
    ];
    const res = combineStars(combinedAll);
    if (res.combined) {
      this.fieldRoster = res.roster.filter((u) => u.fielded);
      this.benchRoster = res.roster.filter((u) => !u.fielded);
      const ev = res.events[res.events.length - 1];
      const starsStr = '★'.repeat(ev.toStars);
      this.lastCombineMessage = `⭐ STAR UPGRADE! 3x ${ev.name} combined into ${starsStr} (${ev.maxHp} HP / ${ev.dmg} DMG)!`;
    }
  }

  autoPlaceBenchIfSpace() {
    const limit = this.getFieldLimit();
    const res = promoteBenchToField(this.fieldRoster, this.benchRoster, limit);
    this.fieldRoster = res.field;
    this.benchRoster = res.bench;
  }

  setupGameMatchup() {
    this.driveNumber = 1;
    this.currentDownDisplay = 1;
    this.currentDriveYards = 0;
    this.playerGameScore = 0;
    this.opponentGameScore = 0;
    this.driveHistory = [];
    this.currentGameDeaths = [];
    this.driveSplats = [];
    this.gameResurrectionInsuranceArmed = false;

    this.autoPlaceBenchIfSpace();
    this.generateOpponentRoster();
    this.announceMatchupTelegraph();
  }

  /**
   * AI coaches use Dirty Tricks from Game 3 up with the telegraph line from Spec §8
   */
  getOpponentActiveTricksForDrive() {
    if (this.gameNumber < 3) return [];
    const coach = this.getCurrentCoach();
    const tricks = coach.tricks || [];
    if (tricks.length === 0) return [];
    // Boss Coach 8 has 2 tricks: uses first on Drive 1, second on Drive 2
    if (tricks.length >= 2) {
      if (this.driveNumber === 1) return [tricks[0]];
      if (this.driveNumber === 2) return [tricks[1]];
      return [];
    }
    // Coaches 3..7 use their signature trick on Drive 1
    return this.driveNumber === 1 ? [tricks[0]] : [];
  }

  announceMatchupTelegraph() {
    const coach = this.getCurrentCoach();
    const oppTricks = this.getOpponentActiveTricksForDrive();
    if (this.gameNumber >= 3 && oppTricks.length > 0) {
      const trickNames = oppTricks.map((id) => DIRTY_TRICKS[id]?.name || id).join(' & ');
      this.setTicker(
        `⚠️ TELEGRAPH: ${coach.name} has armed something shiny... (${trickNames})!`,
        coach.telegraph || `${coach.description}`
      );
    } else {
      this.setTicker(
        `🏟️ GAME ${this.gameNumber}/8 vs ${coach.name.toUpperCase()} (Field Limit: ${this.getFieldLimit()})!`,
        `${coach.description} Tap players to place in rows 0-2, then press SNAP!`
      );
    }
  }

  generateOpponentRoster() {
    const coach = this.getCurrentCoach();
    const limit = coach.fieldLimit || 5;
    const benchCount = this.gameNumber === 1 ? 0 : this.gameNumber <= 4 ? 1 : 2;
    let pool = SHOP_POOL;
    if (coach.speciesFocus && coach.speciesFocus !== 'Mixed') {
      const focused = SHOP_POOL.filter((p) => p.species === coach.speciesFocus);
      if (focused.length > 0) pool = focused;
    }

    const ferocityMult = getCoachFerocityMultiplier(this.gameNumber);
    const desiredPositions = ['OL', 'RB', 'LB', 'DB', 'WR', 'QB', 'TE'];
    const createCoachUnit = (idx) => {
      const wantPos = desiredPositions[idx % desiredPositions.length];
      const posMatches = pool.filter((p) => p.position === wantPos);
      const tpl =
        posMatches.length > 0
          ? this.rng.pick(posMatches)
          : this.rng.pick(pool) || ROSTER_POOL[idx % ROSTER_POOL.length];
      const unit = createUnit(tpl.id, {
        side: 'opponent',
        stars: coach.starLevel || 1
      });
      const scaledDmg = Math.max(1, Math.round(unit.dmg * ferocityMult));
      unit.dmg = scaledDmg;
      unit.baseDmg = scaledDmg;
      return unit;
    };

    this.opponentField = [];
    this.opponentBench = [];
    for (let i = 0; i < limit + benchCount; i++) {
      this.opponentBench.push(createCoachUnit(i));
    }
    this.promoteOpponentBench();
  }

  promoteOpponentBench() {
    const coach = this.getCurrentCoach();
    const limit = coach.fieldLimit || 5;
    this.opponentField = this.opponentField.filter((u) => u.alive && u.hp > 0);
    this.opponentBench = this.opponentBench.filter((u) => u.alive && u.hp > 0);

    while (this.opponentField.length < limit && this.opponentBench.length > 0) {
      const unit = this.opponentBench.shift();
      const preferredRows =
        unit.position === 'OL' || unit.position === 'LB' || unit.position === 'RB' || unit.position === 'TE'
          ? [4, 5]
          : [5, 4];
      let placed = false;
      for (const r of preferredRows) {
        for (let c = 0; c < FIELD_CONFIG.cols; c++) {
          const occupied = this.opponentField.some((u) => u.row === r && u.col === c);
          if (!occupied) {
            unit.row = r;
            unit.col = c;
            this.opponentField.push(unit);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) break;
    }

    return {
      rosterWiped: this.opponentField.length + this.opponentBench.length === 0
    };
  }

  handleUnitSelect(uid) {
    if (this.isReplaying) return;
    if (this.selectedUnitUid === uid) {
      this.selectedUnitUid = null;
    } else {
      this.selectedUnitUid = uid;
    }
    this.renderAll();
  }

  handleCellTap(row, col) {
    if (this.isReplaying) return;
    const isPlayerZone = FIELD_CONFIG.playerRows.includes(row);
    const occupantOnField = this.fieldRoster.find((u) => u.row === row && u.col === col);

    if (!this.selectedUnitUid) {
      if (occupantOnField) {
        this.selectedUnitUid = occupantOnField.uid;
        this.setTicker(
          `👆 Selected ${occupantOnField.name} (${occupantOnField.species} ${occupantOnField.position})`,
          'Tap any cell in rows 0-2 to move/swap, or tap a bench unit to swap.'
        );
        this.renderAll();
      }
      return;
    }

    if (!isPlayerZone) {
      this.setTicker('🚫 INVALID ZONE!', 'You can only place your mutants in rows 0, 1, or 2 (bottom half)!');
      return;
    }

    const fromFieldIdx = this.fieldRoster.findIndex((u) => u.uid === this.selectedUnitUid);
    const fromBenchIdx = this.benchRoster.findIndex((u) => u.uid === this.selectedUnitUid);

    if (fromFieldIdx !== -1) {
      const movingUnit = this.fieldRoster[fromFieldIdx];
      if (occupantOnField && occupantOnField.uid !== movingUnit.uid) {
        const oldRow = movingUnit.row;
        const oldCol = movingUnit.col;
        movingUnit.row = row;
        movingUnit.col = col;
        occupantOnField.row = oldRow;
        occupantOnField.col = oldCol;
        this.setTicker(`🔄 Swapped ${movingUnit.name} and ${occupantOnField.name}!`, 'Ready to SNAP!');
      } else {
        movingUnit.row = row;
        movingUnit.col = col;
        this.setTicker(`📍 Placed ${movingUnit.name} at row ${row}, lane ${col}!`, 'Ready to SNAP!');
      }
      this.selectedUnitUid = null;
      this.saveRunToStorage();
      this.renderAll();
      return;
    }

    if (fromBenchIdx !== -1) {
      const benchUnit = this.benchRoster[fromBenchIdx];
      const limit = this.getFieldLimit();

      if (occupantOnField) {
        this.benchRoster.splice(fromBenchIdx, 1);
        const occIdx = this.fieldRoster.findIndex((u) => u.uid === occupantOnField.uid);
        if (occIdx !== -1) this.fieldRoster.splice(occIdx, 1);

        benchUnit.row = row;
        benchUnit.col = col;
        benchUnit.fielded = true;
        this.fieldRoster.push(benchUnit);

        occupantOnField.fielded = false;
        this.benchRoster.push(occupantOnField);
        this.setTicker(`🔄 Subbed in ${benchUnit.name} for ${occupantOnField.name}!`, 'Ready to SNAP!');
      } else if (this.fieldRoster.length < limit) {
        this.benchRoster.splice(fromBenchIdx, 1);
        benchUnit.row = row;
        benchUnit.col = col;
        benchUnit.fielded = true;
        this.fieldRoster.push(benchUnit);
        this.setTicker(`📍 Fielded ${benchUnit.name} at row ${row}, lane ${col}!`, 'Ready to SNAP!');
      } else {
        this.setTicker(
          `⚠️ FIELD LIMIT (${limit}) FULL!`,
          'Tap an occupied cell in rows 0-2 to swap that player onto the bench.'
        );
      }
      this.selectedUnitUid = null;
      this.saveRunToStorage();
      this.renderAll();
    }
  }

  cycleReplaySpeed() {
    this.replaySpeedMode = this.replaySpeedMode === 1 ? 2 : this.replaySpeedMode === 2 ? 3 : 1;
    const labels = { 1: '1x SPD', 2: '2x SPD', 3: 'MAX SPD' };
    this.els.speedBtn.textContent = labels[this.replaySpeedMode];
  }

  getTickDelayMs() {
    if (this.replaySpeedMode === 3) return 18;
    if (this.replaySpeedMode === 2) return 150;
    return 300;
  }

  async handleSnapClick() {
    if (this.isReplaying) return;

    if (this.fieldRoster.length === 0 && this.benchRoster.length > 0) {
      this.autoPlaceBenchIfSpace();
    }
    if (this.fieldRoster.length === 0) {
      this.openShopModal();
      this.setTicker('⚠️ NO PLAYERS ON FIELD!', 'Buy at least 1 mutant in the Shop before snapping!');
      return;
    }

    this.atShopBoundary = false;
    this.isReplaying = true;
    this.selectedUnitUid = null;
    this.driveSplats = [];
    this.currentDriveYards = 0;
    this.sfx.play('snap');

    // Consume armed player Dirty Tricks for this drive
    const armedTricks = this.heldTricks.filter((t) => t.armed).map((t) => t.id);
    this.heldTricks = this.heldTricks.filter((t) => !t.armed);

    if (armedTricks.includes('resurrection_insurance')) {
      this.gameResurrectionInsuranceArmed = true;
    }

    const oppTricks = this.getOpponentActiveTricksForDrive();

    const driveState = {
      gameNumber: this.gameNumber,
      playerUnits: this.fieldRoster,
      opponentUnits: this.opponentField,
      playerTricks: armedTricks,
      playerResurrectionInsurance: this.gameResurrectionInsuranceArmed,
      opponentTricks: oppTricks
    };

    const seed = this.seedCounter++;
    const simResult = simulateDrive(driveState, seed);

    // If Resurrection Insurance fired during the drive, mark it spent for the rest of the game
    if (simResult.resurrectionInsuranceUsed?.player) {
      this.gameResurrectionInsuranceArmed = false;
    }

    await this.replayDriveResult(simResult);
  }

  async replayDriveResult(simResult) {
    const liveUnits = new Map();
    const initialSnapCoords = new Map();

    for (const u of this.fieldRoster) {
      const clone = { ...u, alive: true };
      liveUnits.set(u.uid, clone);
      initialSnapCoords.set(u.uid, { row: u.row, col: u.col });
    }
    for (const u of this.opponentField) {
      const clone = { ...u, alive: true };
      liveUnits.set(u.uid, clone);
      initialSnapCoords.set(u.uid, { row: u.row, col: u.col });
    }

    let currentDown = 0;

    for (const tickRec of simResult.ticks) {
      if (tickRec.down !== currentDown) {
        currentDown = tickRec.down;
        this.currentDownDisplay = currentDown;
        for (const [uid, unit] of liveUnits.entries()) {
          if (!unit.alive) continue;
          const startPos = initialSnapCoords.get(uid);
          if (startPos) {
            unit.row = startPos.row;
            unit.col = startPos.col;
          }
          if (currentDown > 1) {
            unit.hp = unit.maxHp;
          }
        }
        this.renderFieldFromLiveUnits(liveUnits, {});
        this.renderHud();
      }

      const animFlags = {};
      let notableEventForTicker = null;

      for (const ev of tickRec.events) {
        if (ev.type === 'move' || ev.type === 'blink') {
          const u = liveUnits.get(ev.unitId);
          if (u) {
            u.row = ev.to.row;
            u.col = ev.to.col;
            animFlags[u.uid] = 'anim-hop';
          }
          if (ev.type === 'blink' && !notableEventForTicker) {
            notableEventForTicker = TICKER_TEMPLATES.blink(ev);
          }
        } else if (ev.type === 'shove') {
          const target = liveUnits.get(ev.targetId);
          if (target) {
            target.row = ev.toRow;
            animFlags[target.uid] = 'anim-hit';
          }
          animFlags[ev.attackerId] = 'anim-lunge';
          if (!notableEventForTicker) notableEventForTicker = TICKER_TEMPLATES.shove(ev);
        } else if (ev.type === 'attack') {
          const target = liveUnits.get(ev.targetId);
          if (target) {
            target.hp = ev.targetRemainingHp;
            animFlags[target.uid] = 'anim-hit';
          }
          animFlags[ev.attackerId] = 'anim-lunge';
          this.sfx.play('hit');
        } else if (ev.type === 'bribe_callback') {
          if (!notableEventForTicker) notableEventForTicker = TICKER_TEMPLATES.bribe_callback(ev);
        } else if (ev.type === 'mine') {
          const u = liveUnits.get(ev.unitId);
          if (u) {
            u.hp = Math.max(0, u.hp - ev.damage);
            animFlags[u.uid] = 'anim-hit';
          }
          this.sfx.play('mine');
          notableEventForTicker = TICKER_TEMPLATES.mine(ev);
        } else if (ev.type === 'poison_tick' || ev.type === 'chainsaw_burn') {
          const u = liveUnits.get(ev.unitId);
          if (u) {
            u.hp = ev.remainingHp;
          }
        } else if (ev.type === 'sack') {
          notableEventForTicker = TICKER_TEMPLATES.sack(ev);
        } else if (ev.type === 'catch') {
          notableEventForTicker = TICKER_TEMPLATES.catch(ev);
        } else if (ev.type === 'intercept') {
          notableEventForTicker = TICKER_TEMPLATES.intercept(ev);
        } else if (ev.type === 'resurrection_insurance') {
          const u = liveUnits.get(ev.unitId);
          if (u) {
            u.hp = 1;
            u.alive = true;
          }
          notableEventForTicker = TICKER_TEMPLATES.resurrection_insurance(ev);
        } else if (ev.type === 'kill') {
          const victim = liveUnits.get(ev.victimId);
          if (victim) {
            victim.hp = 0;
            victim.alive = false;
            animFlags[victim.uid] = 'anim-death';
            this.driveSplats.push({
              row: victim.row,
              col: victim.col,
              icon: SPECIES_SPLAT_ICON[victim.species] || '🩸💥'
            });
          }
          this.sfx.play('splat');
          notableEventForTicker = TICKER_TEMPLATES.kill(ev);
        } else if (ev.type === 'massacre') {
          notableEventForTicker = TICKER_TEMPLATES.massacre(ev);
        }
      }

      if (notableEventForTicker) {
        this.setTicker(notableEventForTicker, `Drive ${this.driveNumber}/4 • Down ${tickRec.down} • Tick ${tickRec.tick}/8`);
      }

      this.renderFieldFromLiveUnits(liveUnits, animFlags, true);
      await new Promise((r) => setTimeout(r, this.getTickDelayMs()));

      const downSummary = simResult.downs.find((d) => d.down === tickRec.down);
      const isLastTickOfDown =
        !simResult.ticks.some((t) => t.down === tickRec.down && t.tick > tickRec.tick);
      if (isLastTickOfDown && downSummary) {
        this.currentDriveYards = downSummary.cumulativeYards;
        this.renderThermometer();
        const downEndEv = downSummary.events.find((e) => e.type === 'down_end');
        if (downEndEv) {
          const line =
            downEndEv.yardsThisDown >= 20
              ? TICKER_TEMPLATES.big_gain(downEndEv)
              : TICKER_TEMPLATES.down_end(downEndEv);
          this.setTicker(line, `Drive Total: ${this.currentDriveYards} / 80 yds`);
        }
      }
    }

    // Drive complete: update game & run stats
    this.currentDriveYards = simResult.yards;
    this.playerGameScore += simResult.points;
    this.opponentGameScore += simResult.opponentPoints;
    this.runStats.totalYards += simResult.yards;
    this.runStats.totalKills += simResult.opponentDeaths.length;

    if (simResult.points >= 7) {
      this.sfx.play('td');
    }

    const driveEndEv = simResult.events.find((e) => e.type === 'drive_end');
    const driveHeadline = simResult.massacre
      ? TICKER_TEMPLATES.massacre({ wipedSide: simResult.wipedSide })
      : driveEndEv
      ? TICKER_TEMPLATES.drive_end(driveEndEv)
      : `Drive ${this.driveNumber} complete: ${simResult.outcome} (${simResult.yards} yds, +${simResult.points} pts)`;

    this.setTicker(
      driveHeadline,
      `Meanwhile, the other idiots scored +${simResult.opponentPoints} pts! (Score: YOU ${this.playerGameScore} - ${this.opponentGameScore} THEM)`
    );

    for (const d of simResult.playerDeaths) {
      this.currentGameDeaths.push({
        ...d,
        game: this.gameNumber,
        drive: this.driveNumber
      });
    }

    this.driveHistory.push({
      drive: this.driveNumber,
      outcome: simResult.outcome,
      yards: simResult.yards,
      playerPoints: simResult.points,
      opponentPoints: simResult.opponentPoints,
      casualties: simResult.playerDeaths.length
    });

    // Update surviving player roster (healed to full between drives per §5) and auto-promote bench (Amendment 2)
    this.fieldRoster = simResult.survivingPlayerRoster.map((u) => {
      const startPos = initialSnapCoords.get(u.uid);
      return {
        ...u,
        row: startPos ? startPos.row : u.row,
        col: startPos ? startPos.col : u.col,
        fielded: true
      };
    });

    const promo = promoteBenchToField(this.fieldRoster, this.benchRoster, this.getFieldLimit());
    this.fieldRoster = promo.field;
    this.benchRoster = promo.bench;

    // Update surviving opponent roster and auto-promote opponent bench reserves (Amendment 2)
    this.opponentField = simResult.survivingOpponentRoster.map((u) => {
      const startPos = initialSnapCoords.get(u.uid);
      return {
        ...u,
        row: startPos ? startPos.row : u.row,
        col: startPos ? startPos.col : u.col
      };
    });
    const oppPromo = this.promoteOpponentBench();

    this.isReplaying = false;

    // Check immediate Game End conditions (Amendment 2: ENTIRE roster field + bench wiped):
    if (promo.rosterWiped) {
      this.finishGame({ forcedOutcome: 'LOSS_WIPE' });
      return;
    }

    if (oppPromo.rosterWiped) {
      this.finishGame({ forcedOutcome: 'WIN_MASSACRE' });
      return;
    }

    // Completed 4 drives (or 5th sudden-death drive if tied after 4)
    if (this.driveNumber >= 4) {
      if (this.driveNumber === 4 && this.playerGameScore === this.opponentGameScore) {
        this.driveNumber = 5;
        this.currentDownDisplay = 1;
        this.setTicker(
          `⚡ TIED ${this.playerGameScore}-${this.opponentGameScore}! SUDDEN-DEATH 5TH DRIVE!`,
          'Winner of this 5th drive takes the game — and somebody is definitely dying!'
        );
        this.saveRunToStorage();
        this.renderAll();
        return;
      }
      this.finishGame({});
      return;
    }

    this.driveNumber += 1;
    this.currentDownDisplay = 1;
    this.announceMatchupTelegraph();
    this.saveRunToStorage();
    this.renderAll();
  }

  finishGame({ forcedOutcome = null }) {
    let playerWon = this.playerGameScore > this.opponentGameScore;
    if (forcedOutcome === 'WIN_MASSACRE') playerWon = true;
    if (forcedOutcome === 'LOSS_WIPE') playerWon = false;
    if (this.playerGameScore === this.opponentGameScore && !forcedOutcome) {
      const lastDrive = this.driveHistory[this.driveHistory.length - 1];
      playerWon = Boolean(lastDrive && lastDrive.yards >= 40);
    }

    this.lastGamePlayerWon = playerWon;
    if (playerWon) {
      this.runStats.wins += 1;
    } else {
      this.runStats.losses += 1;
    }

    // Compute active Skeleton synergy tier for post-game Skeleton Reassemble (§7)
    const syn = computeSynergies([...this.fieldRoster, ...this.currentGameDeaths]);
    const postGame = resolvePostGamePermadeath({
      survivingRoster: [...this.fieldRoster, ...this.benchRoster],
      gameDeaths: this.currentGameDeaths,
      skeletonSynergyTier: syn.tiers.Skeleton,
      rngSeed: this.seedCounter++
    });

    // Separate surviving field vs bench after Steroid Slushie post-game deaths & Skeleton Reassemble
    const survivingUids = new Set(postGame.roster.map((u) => u.uid));
    this.fieldRoster = this.fieldRoster
      .filter((u) => survivingUids.has(u.uid))
      .map((u) => ({ ...u, steroidSlushie: false, hp: u.baseMaxHp || u.maxHp }));
    this.benchRoster = this.benchRoster
      .filter((u) => survivingUids.has(u.uid))
      .map((u) => ({ ...u, steroidSlushie: false, hp: u.baseMaxHp || u.maxHp }));

    this.lastReassembled = postGame.reassembled;
    for (const rUnit of postGame.reassembled) {
      this.benchRoster.push(rUnit);
    }

    // Backfill game number on any Steroid Slushie post-game deaths
    for (const gd of postGame.graveyard) {
      if (!gd.game) gd.game = this.gameNumber;
      if (gd.eventsInDown === undefined) gd.eventsInDown = 4;
    }

    this.allRunDeaths.push(...postGame.graveyard);
    this.runStats.totalDeaths = this.allRunDeaths.length;

    // Economy reward (§10: Win = +6g + 1g per surviving starter max +5; Loss = +3g, -1 Team Heart)
    const survivingStartersBonus = Math.min(5, this.fieldRoster.length);
    const goldEarned = playerWon ? 6 + survivingStartersBonus : 3;
    this.gold += goldEarned;
    if (!playerWon) {
      this.teamHearts = Math.max(0, this.teamHearts - 1);
    }

    this.saveRunToStorage();
    this.renderAll();
    this.openResultModal({
      playerWon,
      forcedOutcome,
      goldEarned,
      survivingStartersBonus,
      graveyardDeathsThisGame: postGame.graveyard
    });
  }

  openResultModal({ playerWon, forcedOutcome, goldEarned, survivingStartersBonus, graveyardDeathsThisGame }) {
    const coach = this.getCurrentCoach();
    const bannerColor = playerWon ? 'var(--neon-green)' : 'var(--cartoon-red)';
    const titleText =
      forcedOutcome === 'WIN_MASSACRE'
        ? '🏆 VICTORY BY OPPONENT MASSACRE!'
        : forcedOutcome === 'LOSS_WIPE'
        ? '☠️ DEFEAT — ENTIRE ROSTER WIPED OUT!'
        : playerWon
        ? '🏆 GAME VICTORY!'
        : '💔 GAME DEFEAT!';

    const driveRowsHtml = this.driveHistory
      .map(
        (d) =>
          `<div class="roster-row-item">
            <span>Drive ${d.drive}: <strong>${d.outcome}</strong> (${d.yards} yds)</span>
            <span>YOU +${d.playerPoints} | THEM +${d.opponentPoints} | 💀 ${d.casualties}</span>
          </div>`
      )
      .join('');

    this.els.resultContent.innerHTML = `
      <div class="result-summary-card" style="border-color: ${bannerColor}">
        <div style="font-size: 18px; font-weight: 900; color: ${bannerColor}; margin-bottom: 4px;">
          ${titleText}
        </div>
        <div style="font-size: 13px; color: #fff; margin-bottom: 6px;">
          Game ${this.gameNumber}/8 vs <strong>${coach.name}</strong> (Record: ${this.runStats.wins}-${this.runStats.losses})
        </div>
        <div style="font-size: 24px; font-weight: 900; color: var(--neon-yellow); margin: 6px 0;">
          YOU ${this.playerGameScore} — ${this.opponentGameScore} THEM
        </div>
        <div style="font-size: 12px; color: var(--neon-green); font-weight: 800;">
          💰 Gold Earned: +${goldEarned}g ${
      playerWon ? `(6g Win + ${survivingStartersBonus}g Survivor Bonus)` : '(3g Mercy TV Money)'
    }
        </div>
        <div style="font-size: 12px; color: #ff8a80; font-weight: 800; margin-top: 3px;">
          ❤️ Team Hearts: ${'❤️'.repeat(this.teamHearts)}${'🖤'.repeat(3 - this.teamHearts)} | 💀 Game Casualties: ${graveyardDeathsThisGame.length}
        </div>
      </div>
      <div class="shop-Section-title">Drive-by-Drive Breakdown</div>
      <div class="shop-roster-list">${driveRowsHtml}</div>
    `;

    this.els.resultModal.classList.remove('hidden');
  }

  openGraveyardModal() {
    if (this.lastReassembled && this.lastReassembled.length > 0) {
      const names = this.lastReassembled.map((u) => u.name).join(', ');
      this.els.reassembleBanner.textContent = `💀 SKELETON REASSEMBLE! ${names} duct-taped their own bones back together and crawled onto the bench!`;
      this.els.reassembleBanner.classList.remove('hidden');
    } else {
      this.els.reassembleBanner.classList.add('hidden');
    }

    const deathsToShow =
      this.allRunDeaths.length > 0 ? this.allRunDeaths : this.currentGameDeaths;

    if (deathsToShow.length === 0) {
      this.els.tombstoneGrid.innerHTML = `
        <div class="result-summary-card" style="grid-column: 1 / -1;">
          Miraculously, nobody died yet! The groundskeeper is furious!
        </div>
      `;
    } else {
      this.els.tombstoneGrid.innerHTML = deathsToShow
        .map((d) => {
          const sp = SPECIES[d.species] || { emoji: '💀' };
          const starsStr = '★'.repeat(d.stars || 1);
          return `
            <div class="tombstone-card">
              <div class="tombstone-rip">🪦 R.I.P.</div>
              <div class="tombstone-name">${d.name} ${starsStr}</div>
              <div class="tombstone-meta">${sp.emoji} ${d.species} ${d.position} • Game ${d.game || this.gameNumber}</div>
              <div class="tombstone-epitaph">"${d.causeOfDeath}"</div>
            </div>
          `;
        })
        .join('');
    }

    this.els.graveyardModal.classList.remove('hidden');
  }

  /**
   * Transition after Graveyard screen:
   * - Win Game 8 -> Graveyard Cup Victory Run Summary screen (§3/§9)
   * - Lose 3 games (teamHearts <= 0) -> Run Over Summary screen (§3/§9)
   * - Otherwise advance to Game N+1 Shop, and check "NO ONE LEFT TO BURY THE DEAD" (Amendment 2)
   */
  advanceAfterGraveyard() {
    if (this.gameNumber >= 8 && this.lastGamePlayerWon) {
      this.sfx.play('cup');
      this.openRunSummaryModal('CUP_VICTORY');
      return;
    }

    if (this.teamHearts <= 0) {
      this.openRunSummaryModal('HEARTS_DEPLETED');
      return;
    }

    this.gameNumber = Math.min(8, this.gameNumber + 1);
    this.rollShopSlots();
    this.setupGameMatchup();

    // Check Spec §5 Amendment 2: if no players remain on field+bench and none can be afforded in the Shop -> RUN ENDS
    const totalPlayers = this.fieldRoster.length + this.benchRoster.length;
    const minShopCost = Math.min(...this.shopSlots.map((s) => s.template.cost));
    if (totalPlayers === 0 && this.gold < minShopCost) {
      this.openRunSummaryModal('NO_ONE_LEFT');
      return;
    }

    this.atShopBoundary = true;
    this.saveRunToStorage();
    this.renderAll();
    this.openShopModal();
  }

  /**
   * Pick the Funniest Death per Build 3 spec:
   * "funniest death = longest cause-of-death string is NOT the rule — pick the death with the most events in its down and say so"
   */
  getFunniestDeathByEventsInDown() {
    if (!this.allRunDeaths || this.allRunDeaths.length === 0) return null;
    const sorted = [...this.allRunDeaths].sort(
      (a, b) => (b.eventsInDown || 0) - (a.eventsInDown || 0)
    );
    return sorted[0];
  }

  openRunSummaryModal(reason = 'CUP_VICTORY') {
    this.atShopBoundary = false;
    let bannerTitle = '🏆 GRAVEYARD CUP CHAMPIONS!';
    let bannerSubtitle = 'You conquered all 8 Gauntlet Coaches and hoisted the Graveyard Cup!';
    let bannerColor = 'var(--neon-yellow)';

    if (reason === 'HEARTS_DEPLETED') {
      bannerTitle = '☠️ RUN OVER — OUT OF TEAM HEARTS!';
      bannerSubtitle = 'You lost 3 games and the franchise was repossessed by necromancers.';
      bannerColor = 'var(--cartoon-red)';
    } else if (reason === 'NO_ONE_LEFT') {
      bannerTitle = '🪦 NO ONE LEFT TO BURY THE DEAD';
      bannerSubtitle = 'Every mutant on your roster is dead and you cannot afford a replacement!';
      bannerColor = 'var(--cartoon-red)';
    }

    this.els.runSummaryTitle.textContent = bannerTitle;

    const funniest = this.getFunniestDeathByEventsInDown();
    const funniestHtml = funniest
      ? `
        <div class="result-summary-card" style="border-color: var(--neon-green); text-align: left;">
          <div style="font-size: 12px; font-weight: 900; color: var(--neon-green); margin-bottom: 4px;">
            😂 FUNNIEST DEATH (Picked by the death with the most events in its down: ${funniest.eventsInDown || 0} events in Game ${funniest.game || 1}, Down ${funniest.down || 1})
          </div>
          <div style="font-size: 14px; font-weight: 900; color: var(--neon-yellow);">
            🪦 ${funniest.name} (${funniest.species} ${funniest.position})
          </div>
          <div style="font-size: 12px; color: #ff9e9e; font-style: italic; margin-top: 2px;">
            "${funniest.causeOfDeath}"
          </div>
        </div>
      `
      : `
        <div class="result-summary-card">
          😂 Funniest Death (picked by the death with the most events in its down): None — zero casualties recorded!
        </div>
      `;

    this.els.runSummaryContent.innerHTML = `
      <div class="result-summary-card" style="border-color: ${bannerColor}">
        <div style="font-size: 20px; font-weight: 900; color: ${bannerColor}; margin-bottom: 4px;">
          ${bannerTitle}
        </div>
        <div style="font-size: 12px; color: #fff; margin-bottom: 10px;">
          ${bannerSubtitle}
        </div>
        <div class="shop-roster-list" style="text-align: left;">
          <div class="roster-row-item">
            <span>📊 Gauntlet Record</span>
            <strong>${this.runStats.wins} Wins - ${this.runStats.losses} Losses (Reached Game ${this.gameNumber}/8)</strong>
          </div>
          <div class="roster-row-item">
            <span>⚔️ Total Enemy Kills</span>
            <strong>${this.runStats.totalKills}</strong>
          </div>
          <div class="roster-row-item">
            <span>🪦 Total Team Deaths</span>
            <strong>${this.allRunDeaths.length}</strong>
          </div>
          <div class="roster-row-item">
            <span>📏 Total Yards Gained</span>
            <strong>${this.runStats.totalYards} yds</strong>
          </div>
        </div>
      </div>
      ${funniestHtml}
    `;

    this.els.runSummaryModal.classList.remove('hidden');
  }

  openShopModal() {
    this.atShopBoundary = true;
    this.saveRunToStorage();
    this.renderShopModal();
    this.els.shopModal.classList.remove('hidden');
  }

  closeShopModal() {
    this.atShopBoundary = false;
    this.autoPlaceBenchIfSpace();

    // Check "NO ONE LEFT TO BURY THE DEAD" if closing shop with 0 total players and insufficient gold
    const totalPlayers = this.fieldRoster.length + this.benchRoster.length;
    const minShopCost = Math.min(...this.shopSlots.filter((s) => !s.sold).map((s) => s.template.cost), 99);
    if (totalPlayers === 0 && this.gold < minShopCost) {
      this.els.shopModal.classList.add('hidden');
      this.openRunSummaryModal('NO_ONE_LEFT');
      return;
    }

    this.els.shopModal.classList.add('hidden');
    if (this.driveNumber === 1) {
      this.announceMatchupTelegraph();
    }
    this.saveRunToStorage();
    this.renderAll();
  }

  setTicker(headline, subline = '') {
    this.els.tickerHeadline.textContent = headline;
    this.els.tickerSubline.textContent = subline;
  }

  renderHud() {
    const coach = this.getCurrentCoach();
    this.els.gameBadge.textContent = `G${this.gameNumber}/8`;
    this.els.coachName.textContent = coach.name;
    this.els.driveDownLabel.textContent = `DRV ${this.driveNumber}/4 • DWN ${this.currentDownDisplay}/4`;
    this.els.scoreNumbers.textContent = `${this.playerGameScore} - ${this.opponentGameScore}`;
    this.els.goldDisplay.textContent = `💰${this.gold}g`;
    this.els.heartsDisplay.textContent = '❤️'.repeat(this.teamHearts) || '💀';
    this.els.muteBtn.textContent = this.sfx.muted ? '🔇' : '🔊';
  }

  renderBenchAndSynergies() {
    // Bench chips
    if (this.benchRoster.length === 0) {
      this.els.benchSlotsRow.innerHTML = `<span class="bench-label">BENCH(0)</span>`;
    } else {
      const chips = this.benchRoster
        .map((u) => {
          const sp = SPECIES[u.species] || { emoji: '💀' };
          const selClass = this.selectedUnitUid === u.uid ? 'selected' : '';
          const stars = '★'.repeat(u.stars || 1);
          return `<button type="button" class="bench-chip ${selClass}" data-bench-uid="${u.uid}">
            ${sp.emoji}${u.position} ${u.name.split(' ')[0]} ${stars}
          </button>`;
        })
        .join('');
      this.els.benchSlotsRow.innerHTML = `<span class="bench-label">BENCH:</span>${chips}`;
      this.els.benchSlotsRow.querySelectorAll('[data-bench-uid]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.handleUnitSelect(btn.getAttribute('data-bench-uid'));
        });
      });
    }

    // Dirty Tricks Arming chips (max 3 held, tap to arm before drive)
    if (this.heldTricks.length === 0) {
      this.els.tricksArmRow.innerHTML = '';
    } else {
      this.els.tricksArmRow.innerHTML = this.heldTricks
        .map((t) => {
          const shortLabel = TRICK_SHORT_LABELS[t.id] || t.name;
          return `<button type="button" class="trick-chip ${t.armed ? 'armed' : ''}" data-arm-trick="${t.uid}" title="Tap to arm/disarm ${t.name} for next drive">
            ${shortLabel}${t.armed ? '✓' : ''}
          </button>`;
        })
        .join('');
      this.els.tricksArmRow.querySelectorAll('[data-arm-trick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.toggleArmTrick(btn.getAttribute('data-arm-trick'));
        });
      });
    }

    // Active Species Synergies
    const syn = computeSynergies(this.fieldRoster);
    const badges = Object.keys(SPECIES)
      .map((spKey) => {
        const count = syn.counts[spKey] || 0;
        if (count === 0) return '';
        const tier = syn.tiers[spKey];
        const tierClass = tier === 4 ? 'active-4' : tier === 2 ? 'active-2' : '';
        return `<span class="syn-badge ${tierClass}">${SPECIES[spKey].emoji}${count}</span>`;
      })
      .filter(Boolean)
      .join('');

    this.els.synergyPills.innerHTML =
      badges || `<span class="syn-badge">Field ${this.fieldRoster.length}/${this.getFieldLimit()}</span>`;
  }

  renderThermometer() {
    const pct = Math.max(0, Math.min(100, (this.currentDriveYards / FIELD_CONFIG.tdYards) * 100));
    this.els.thermoFill.style.height = `${pct}%`;
    this.els.thermoYards.textContent = `${this.currentDriveYards}y`;
  }

  renderFieldFromLiveUnits(liveUnitsMap, animFlags = {}, keepDeadFrame = false) {
    const allUnits = Array.from(liveUnitsMap.values());
    const playerLiving = allUnits.filter((u) => u.side === 'player' && u.alive && u.hp > 0);
    const carrier =
      playerLiving.find((u) => u.position === 'RB') ||
      playerLiving.find((u) => u.position === 'QB') ||
      playerLiving[0];
    const carrierUid = carrier ? carrier.uid : null;

    const cellsHtml = [];
    for (let r = FIELD_CONFIG.rows - 1; r >= 0; r--) {
      for (let c = 0; c < FIELD_CONFIG.cols; c++) {
        const isPlayerZone = FIELD_CONFIG.playerRows.includes(r);
        const zoneClass = isPlayerZone ? 'player-zone placeable' : 'opponent-zone';
        const highlightClass = isPlayerZone && this.selectedUnitUid ? 'highlight-target' : '';

        const splat = this.driveSplats.find((s) => s.row === r && s.col === c);
        const splatHtml = splat ? `<div class="splat-decal">${splat.icon}</div>` : '';
        const scrimmageHtml =
          r === FIELD_CONFIG.scrimmageRow && c === 0
            ? `<span class="scrimmage-tag">SCRIMMAGE</span>`
            : '';

        const occupant = allUnits.find(
          (u) =>
            u.row === r &&
            u.col === c &&
            (u.alive || (keepDeadFrame && animFlags[u.uid] === 'anim-death'))
        );

        let tokenHtml = '';
        if (occupant) {
          const sp = SPECIES[occupant.species] || { emoji: '💀' };
          const stars = '★'.repeat(occupant.stars || 1);
          const hpPct = Math.max(0, Math.min(100, Math.round((occupant.hp / occupant.maxHp) * 100)));
          const selClass = this.selectedUnitUid === occupant.uid ? 'selected' : '';
          const animClass = animFlags[occupant.uid] || '';
          const isBallCarrier = occupant.uid === carrierUid;
          const avatarIcon = !occupant.alive ? '💀' : sp.emoji;
          const shortName = occupant.name.split(' ')[0];

          tokenHtml = `
            <div class="unit-token side-${occupant.side} species-${occupant.species} ${selClass} ${animClass}" data-unit-uid="${occupant.uid}">
              <div class="token-top-row">
                <span class="pos-badge">${occupant.position}</span>
                <span class="star-badge">${stars}</span>
              </div>
              <div class="token-avatar">
                ${avatarIcon}
                ${isBallCarrier ? '<span class="carrier-ball">🏈</span>' : ''}
              </div>
              <div class="token-name">${shortName}</div>
              <div class="token-hp-bar">
                <div class="token-hp-fill" style="width: ${hpPct}%"></div>
              </div>
            </div>
          `;
        }

        cellsHtml.push(`
          <div class="field-cell ${zoneClass} ${highlightClass}" data-row="${r}" data-col="${c}">
            ${scrimmageHtml}
            ${splatHtml}
            ${tokenHtml}
            <span class="cell-coord-hint">R${r}C${c}</span>
          </div>
        `);
      }
    }

    this.els.fieldGrid.innerHTML = cellsHtml.join('');

    this.els.fieldGrid.querySelectorAll('.field-cell').forEach((cellEl) => {
      cellEl.addEventListener('click', () => {
        const r = Number(cellEl.getAttribute('data-row'));
        const c = Number(cellEl.getAttribute('data-col'));
        this.handleCellTap(r, c);
      });
    });
  }

  renderShopModal() {
    const limit = this.getFieldLimit();
    this.els.shopGameNum.textContent = String(this.gameNumber);
    this.els.shopGold.textContent = `💰 ${this.gold}g`;
    this.els.shopFieldCount.textContent = `Fielded: ${this.fieldRoster.length}/${limit} | Bench: ${this.benchRoster.length}`;
    this.els.shopTricksCount.textContent = `Held: ${this.heldTricks.length}/3`;

    if (this.lastCombineMessage) {
      this.els.combineBanner.textContent = this.lastCombineMessage;
      this.els.combineBanner.classList.remove('hidden');
    } else {
      this.els.combineBanner.classList.add('hidden');
    }

    this.els.shopCardsGrid.innerHTML = this.shopSlots
      .map((slot, idx) => {
        const t = slot.template;
        const sp = SPECIES[t.species];
        const pos = POSITIONS[t.position];
        const preview = createUnit(t.id);
        const canBuy = !slot.sold && this.gold >= t.cost;

        return `
          <div class="shop-card ${slot.sold ? 'sold' : ''}">
            <div class="shop-card-info">
              <div class="shop-card-name">
                <span>${sp.emoji}</span>
                <span class="pos-badge">${t.position}</span>
                <span>${t.name}</span>
              </div>
              <div class="shop-card-stats">
                ${t.species} • HP ${preview.maxHp} • DMG ${preview.dmg} • SPD ${preview.speed} • RNG ${preview.range} (${pos.name})
              </div>
            </div>
            <button type="button" class="shop-buy-btn" data-buy-slot="${idx}" ${canBuy ? '' : 'disabled'}>
              ${slot.sold ? 'SOLD' : `BUY (${t.cost}g)`}
            </button>
          </div>
        `;
      })
      .join('');

    this.els.shopCardsGrid.querySelectorAll('[data-buy-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-buy-slot'));
        this.buyShopSlot(idx);
      });
    });

    // Render Dirty Tricks Shop (§8: max 3 held, Resurrection Insurance only Games 5+)
    this.els.shopTricksGrid.innerHTML = Object.values(DIRTY_TRICKS)
      .map((trick) => {
        const lockedByGame = this.gameNumber < (trick.minGame || 1);
        const fullHeld = this.heldTricks.length >= 3;
        const canAfford = this.gold >= trick.cost && !lockedByGame && !fullHeld;
        const btnLabel = lockedByGame
          ? `G${trick.minGame}+ ONLY`
          : fullHeld
          ? 'MAX 3 HELD'
          : `BUY (${trick.cost}g)`;

        return `
          <div class="shop-card ${lockedByGame ? 'sold' : ''}">
            <div class="shop-card-info">
              <div class="shop-card-name">
                <span>🧨 ${trick.name}</span>
              </div>
              <div class="shop-card-stats">${trick.description}</div>
            </div>
            <button type="button" class="shop-buy-btn" data-buy-trick="${trick.id}" ${canAfford ? '' : 'disabled'}>
              ${btnLabel}
            </button>
          </div>
        `;
      })
      .join('');

    this.els.shopTricksGrid.querySelectorAll('[data-buy-trick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.buyDirtyTrick(btn.getAttribute('data-buy-trick'));
      });
    });

    // Render Benched + Fielded Roster in Shop
    const benchRows = this.benchRoster.map((u) => {
      const sp = SPECIES[u.species];
      const stars = '★'.repeat(u.stars || 1);
      return `
        <div class="roster-row-item">
          <span>[BENCH] ${sp.emoji} <strong>${u.name}</strong> (${u.position} ${stars}) — HP ${u.maxHp} / DMG ${u.dmg}</span>
          <button type="button" class="sell-btn" data-sell-uid="${u.uid}">SELL (+1g)</button>
        </div>
      `;
    });

    const fieldRows = this.fieldRoster.map((u) => {
      const sp = SPECIES[u.species];
      const stars = '★'.repeat(u.stars || 1);
      return `
        <div class="roster-row-item">
          <span>[FIELD R${u.row}C${u.col}] ${sp.emoji} <strong>${u.name}</strong> (${u.position} ${stars}) — HP ${u.maxHp} / DMG ${u.dmg}</span>
          <span style="font-size: 10px; color: var(--neon-yellow);">UNDER CONTRACT</span>
        </div>
      `;
    });

    this.els.shopRosterList.innerHTML =
      [...benchRows, ...fieldRows].join('') ||
      `<div class="roster-row-item">No players signed yet! Buy starters above.</div>`;

    this.els.shopRosterList.querySelectorAll('[data-sell-uid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sellBenchedUnit(btn.getAttribute('data-sell-uid'));
      });
    });
  }

  renderAll() {
    this.renderHud();
    this.renderBenchAndSynergies();
    this.renderThermometer();

    const liveMap = new Map();
    for (const u of [...this.fieldRoster, ...this.opponentField]) {
      liveMap.set(u.uid, u);
    }
    this.renderFieldFromLiveUnits(liveMap, {});

    this.els.snapBtn.disabled = this.isReplaying;
    const armedCount = this.heldTricks.filter((t) => t.armed).length;
    const trickTag = armedCount > 0 ? ` [${armedCount} TRICK ARMED]` : '';
    this.els.snapBtn.textContent = this.isReplaying
      ? '⚡ BATTLING...'
      : `🏈 SNAP! (DRV ${this.driveNumber}/4)${trickTag}`;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.graveyardGame = new GraveyardGridironUI();
  });
}
