import { BATTLE_DEFS, CARD_DEFS, STARTER_DECK_KEYS } from "../config.js";
import { shuffle } from "./utils.js";

export function createBattleState(battleDef = BATTLE_DEFS.stage_08, deckKeys = STARTER_DECK_KEYS, playerStats = {}) {
  const enemies = getEnemyDefs(battleDef).map((enemy) => ({
    id: enemy.id,
    name: enemy.name,
    hp: enemy.hp,
    maxHp: enemy.hp,
    block: 0,
    strength: 0,
    gaze: 0,
    pattern: enemy.pattern,
    patternIndex: 0,
    environmentKey: enemy.environmentKey || "",
    deathMessage: enemy.deathMessage || "",
    deathResolved: false,
  }));

  return {
    battleDef,
    drawPile: shuffle(deckKeys.map((key, index) => makeCard(key, index))),
    hand: [],
    discardPile: [],
    exhaustedPile: [],
    relics: [],
    relicFlags: {},
    turnFlags: {},
    nextCardIndex: deckKeys.length,
    turnNumber: 1,
    awakeLessonShown: {
      lieIn: false,
    },
    dorm: {
      smell: battleDef.mechanics === "dorm" ? 1 : 0,
      noise: battleDef.mechanics === "dorm" ? 1 : 0,
      clutter: battleDef.mechanics === "dorm" ? 1 : 0,
      enemyBlockBonusUsed: false,
      nextEnemyDamagePenalty: 0,
      firstMentalRecoveryReduced: false,
      clutterBlockBrokenThisTurn: false,
    },
    boss: {
      phase: battleDef.mechanics === "coffinBoss" ? 1 : 0,
      transformPending: false,
      transformed: false,
      coffin: [],
      coffinBonusCount: 0,
      twistRecords: {},
    },
    player: {
      hp: playerStats.hp ?? 80,
      maxHp: playerStats.maxHp ?? 80,
      mental: playerStats.mental ?? 6,
      maxMental: playerStats.maxMental ?? 12,
      block: 0,
      strength: 0,
      dexterity: 0,
      vibration: 0,
      legShakeResonance: false,
      checkinConditions: [],
      checkinCompleted: [],
      checkinSuccess: false,
      checkinNextBonus: 0,
      checkinNextAdjustment: 0,
      checkinSuccessMessage: "",
      distracted: 0,
      late: 0,
      networkWave: 0,
      attacksPlayedThisTurn: 0,
      skillsPlayedThisTurn: 0,
      cardsPlayedThisTurn: 0,
      costlyCardsPlayedThisTurn: 0,
      blockGainedThisTurn: 0,
      attackDamageThisTurn: 0,
      discardedCardsThisTurn: 0,
      mentalRecoveriesThisTurn: 0,
      nullifyEnemyThisTurn: false,
      drawThenDiscard: 0,
      attackDamagePenalty: 0,
      summer: false,
      attackLocked: false,
      nextDrawBonus: 0,
      nextDrawPenalty: 0,
      mentalRecoveryPenaltyNext: 0,
      mentalRecoveryPenaltyThisTurn: 0,
      nextSkillHalf: false,
      skillHalfThisTurn: false,
      lastTurnCardsPlayed: 0,
      hollow: 0,
      muddled: 0,
      breachNextBlock: 0,
      countdown: 0,
      stingNextBlock: 0,
      stingTriggers: 0,
      rebuttalNextStrength: 0,
      overdraft: 0,
      echoTransformed: false,
    },
    enemies,
    finished: false,
  };
}

export function getEnemyDefs(battleDef) {
  if (battleDef.enemies?.length) return battleDef.enemies;
  return [
    {
      id: "enemy_0",
      name: battleDef.enemyName,
      enemyImages: battleDef.enemyImages,
      hp: battleDef.hp,
      pattern: battleDef.pattern,
      textureInterval: battleDef.textureInterval,
    },
  ];
}

export function enemyIntent(enemy) {
  const action = enemy.pattern[enemy.patternIndex] || enemy.pattern[0];
  if (!action) return "";
  if (action.intent) {
    if (action.damage || action.hits) {
      const bonus = enemy.strength || 0;
      return bonus ? `${action.intent} +${bonus}` : action.intent;
    }
    return action.intent;
  }
  if (action.hits) {
    const firstHit = action.hits[0] + enemy.strength;
    return `攻击 ${firstHit}x${action.hits.length}`;
  }
  if (action.damage) return `攻击 ${action.damage + enemy.strength}`;
  if (action.block) return `格挡 ${action.block}`;
  if (action.strength) return `增伤 ${action.strength}`;
  return "";
}

export function makeCard(key, index) {
  return {
    id: `${key}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    key,
  };
}

export function cardDef(card) {
  return CARD_DEFS[card.key];
}

export function cardCost(card, playerContext = null) {
  const def = cardDef(card);
  const player = playerContext || card.playerContext || null;
  if (def.dynamicCost === "mentalRecovery" && player) {
    return Math.max(0, Math.max(2, def.cost - Math.min(3, player.mentalRecoveriesThisTurn || 0)) + (card.costModifier || 0));
  }
  if (def.dynamicCost === "echo" && player?.echoTransformed) return Math.max(0, card.costModifier || 0);
  return Math.max(0, def.cost + (card.costModifier || 0));
}

export function effectiveAttackDamage(card, player = {}, enemy = {}) {
  const key = card.key;
  let damage = 0;

  if (key === "talk") {
    damage = player.mental >= 6 ? 10 : 5;
  } else if (key === "3.92") {
    damage = 3;
    if (player.gpaCalculatorBonus) damage += 2;
  } else if (key === "persuade") {
    damage = 7;
  } else if (key === "one_tenth") {
    damage = 4;
  }

  const playerStrength = Number(player.strength || player.power || 0);
  const playerDamageBonus = Number(player.damageBonus || 0);
  const enemyDamageTakenBonus = Number(enemy.damageTakenBonus || enemy.vulnerableBonus || 0);
  const enemyDamageReduction = Number(enemy.damageReduction || enemy.resistance || 0);
  const weakMultiplier = player.weak ? 0.75 : 1;
  const vulnerableMultiplier = enemy.vulnerable ? 1.5 : 1;

  damage += key === "3.92" ? playerStrength * 2 : playerStrength;
  damage += playerDamageBonus + enemyDamageTakenBonus;
  damage = Math.floor(damage * weakMultiplier * vulnerableMultiplier);
  damage -= enemyDamageReduction;
  damage -= Number(player.attackDamagePenalty || 0);
  return Math.max(0, damage);
}
