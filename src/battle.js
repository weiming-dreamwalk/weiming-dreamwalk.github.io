import { BATTLE_DEFS, CARD_DEFS, RELIC_DEFS, STARTER_DECK_KEYS } from "./config.js";
import {
  animateCardFlight,
  animateCardShatter,
  animateFromPile,
  animateGeneratedCardToPile,
  animateRetainedCard,
  animateSkillExhaust,
  animateSkillPlay,
  shatterEnemy,
} from "./battle/animations.js?v=20260608_generated_showcase";
import {
  battleCorruptionBoundary,
  drawBattleCorruptionParticles,
  drawCoverImage,
} from "./battle/corruption.js";
import {
  cardCost,
  cardDef,
  createBattleState,
  effectiveAttackDamage,
  makeCard,
} from "./battle/state.js";
import {
  battleTemplate,
  cardReferenceKeys,
  hasSummerText,
  renderBattleCardInner,
  renderPileCard,
} from "./battle/templates.js";
import {
  escapeHtml,
  floatText,
  centerOf,
  nextFrame,
  percent,
  pointInElement,
  shuffle,
  smoothTiming,
  wait,
  watchAngle,
} from "./battle/utils.js";
import { relicIconStyle, renderRelicBar, renderRelicIcon } from "./relics.js";
import { statusIconStyle } from "./status-icons.js";

const DEAL_DELAY = 105;
const DRAG_START_THRESHOLD = 5;
const CORRUPTION_FRAME_INTERVAL = 42;
const CORRUPTION_DPR_CAP = 0.85;
const CARD_REFERENCE_NAMES = Object.entries(CARD_DEFS)
  .map(([key, def]) => ({ key, name: def.name }))
  .sort((a, b) => b.name.length - a.name.length);
const CHECKIN_SUCCESS_MESSAGES = [
  "签到成功。",
  "已记录本次位置。",
  "这一次，二维码没有为难你。",
  "你终于被系统承认存在了。",
];
const BASIC_SCAN_CONDITIONS = [
  {
    id: "played_attack",
    label: "打出攻击",
    description: "本回合打出至少 1 张攻击牌。",
    test: ({ player }) => player.attacksPlayedThisTurn >= 1,
  },
  {
    id: "block_10",
    label: "防御 10+",
    description: "本回合获得至少 10 防御。",
    test: ({ player }) => player.blockGainedThisTurn >= 10,
  },
  {
    id: "mental_5_8",
    label: "精神 5-8",
    description: "回合结束时，精神为 5-8。",
    endOnly: true,
    test: ({ player }) => player.mental >= 5 && player.mental <= 8,
  },
  {
    id: "recovered_mental",
    label: "回复精神",
    description: "本回合实际回复过精神。",
    conflicts: ["no_recovery"],
    test: ({ player }) => player.mentalRecoveriesThisTurn > 0,
  },
  {
    id: "discarded_card",
    label: "弃过牌",
    description: "本回合弃掉至少 1 张牌。",
    test: ({ player }) => player.discardedCardsThisTurn >= 1,
  },
  {
    id: "played_costly",
    label: "打出付费牌",
    description: "本回合打出至少 1 张费用至少为 1 的牌。",
    test: ({ player }) => player.costlyCardsPlayedThisTurn >= 1,
  },
  {
    id: "max_three_cards",
    label: "少出牌",
    description: "回合结束时，本回合打出的牌不超过 3 张。",
    endOnly: true,
    test: ({ player }) => player.cardsPlayedThisTurn <= 3,
  },
  {
    id: "mental_below_5",
    label: "低精神",
    description: "回合结束时，精神低于 5。",
    endOnly: true,
    test: ({ player }) => player.mental < 5,
  },
];
const ADVANCED_SCAN_CONDITIONS = [
  {
    id: "mental_exact_6",
    label: "精神正好 6",
    description: "回合结束时，精神正好为 6。",
    endOnly: true,
    test: ({ player }) => player.mental === 6,
  },
  {
    id: "attack_damage_20",
    label: "攻击伤害 20+",
    description: "本回合造成至少 20 点攻击伤害。",
    test: ({ player }) => player.attackDamageThisTurn >= 20,
  },
  {
    id: "no_recovery",
    label: "不回复精神",
    description: "回合结束时，本回合没有实际回复精神。",
    endOnly: true,
    conflicts: ["recovered_mental"],
    test: ({ player }) => player.mentalRecoveriesThisTurn <= 0,
  },
];

export class BattleController {
  constructor({ root, onComplete = null, onDefeatReturn = null, onEnterShop = null, runState = null }) {
    this.root = root;
    this.onComplete = onComplete;
    this.onDefeatReturn = onDefeatReturn;
    this.onEnterShop = onEnterShop;
    this.runState = runState || {
      deckKeys: [...STARTER_DECK_KEYS],
      relics: [],
      player: { hp: 80, maxHp: 80, mental: 6, maxMental: 12 },
    };
    this.state = createBattleState();
    this.handHoverIndex = null;
    this.busy = false;
    this.textureTimer = null;
    this.dragState = null;
    this.discardChoice = null;
    this.corruptionFrame = 0;
    this.corruptionImage = null;
    this.corruptionDisplay = 0;
    this.corruptionLastDraw = 0;
    this.corruptionCanvasRect = null;
    this.cardPerspectiveFrame = 0;
    this.pendingPerspective = null;
    this.cardPerspectiveRect = null;
    this.cardPerspectiveCard = null;
    this.bossCoffinRenderKey = "";
    this.relics = this.runState.relics;
    this.pendingDormDeathMessage = "";
  }

  async start(stageKey = "stage_08") {
    this.clearTextureTimer();
    const battleDef = BATTLE_DEFS[stageKey] || BATTLE_DEFS.stage_08;
    this.pendingDormDeathMessage = "";
    this.bossCoffinRenderKey = "";
    this.root.classList.remove(
      "battle-finished",
      "battle-victory-reward",
      "battle-defeat",
      "is-discarding",
      "player-damaged",
      "is-attack-targeted",
      "is-skill-targeted",
      "is-choosing-coffin",
    );
    this.root.hidden = false;
    this.root.innerHTML = battleTemplate(battleDef);
    this.relicRenderKey = "";
    this.cacheElements();
    this.bindEvents();
    this.relics = this.runState.relics;
    this.state = createBattleState(battleDef, this.runState.deckKeys, this.runState.player);
    this.state.relics = [...this.runState.relics];
    this.applyBattleStartRelics();
    this.applyTurnStartRelics();
    this.startCheckinTurn();
    this.renderAll();
    this.startTextureSwap(battleDef);
    this.startBattleCorruption(battleDef);

    await nextFrame();
    this.root.classList.add("is-active");
    this.enemyCards.forEach((enemyCard) => enemyCard.classList.add("is-entering"));
    window.setTimeout(() => {
      this.enemyCards.forEach((enemyCard) => enemyCard.classList.remove("is-entering"));
    }, 900);
    await wait(420);
    if (this.isLegShake()) {
      await this.showSystemNotice("你坐下的瞬间，前桌的腿开始有节奏地抖动。桌面上的水杯泛起细小的波纹。", { duration: 1800 });
    }
    await this.drawOpeningHand(5);
    await this.resolveCourseSelectionRelic();
    await this.showEarlyMorningBasicTutorial();
    this.busy = false;
    this.renderAll();
  }

  cacheElements() {
    this.enemyCards = [...this.root.querySelectorAll(".enemy-card")];
    this.enemyCard = this.enemyCards[0];
    this.enemyImages = [...this.root.querySelectorAll(".enemy-texture")];
    this.enemyWraps = [...this.root.querySelectorAll(".enemy-card-wrap")];
    this.enemyWrap = this.enemyWraps[0];
    this.enemyDom = new Map(
      this.enemyWraps.map((wrap) => [
        wrap.dataset.enemyWrap,
        {
          wrap,
          hpText: wrap.querySelector(".enemy-hp-text"),
          hpBar: wrap.querySelector(".enemy-hp-bar"),
          statusTags: wrap.querySelector(".enemy-status-tags"),
          intentText: wrap.querySelector(".enemy-intent-text"),
          intentTooltip: wrap.querySelector(".enemy-intent-tooltip"),
        },
      ]),
    );
    this.enemyBoard = this.root.querySelector("#enemyBoard");
    this.bossCoffin = this.root.querySelector("#bossCoffin");
    this.bossCoffinCards = this.root.querySelector("#bossCoffinCards");
    this.bossCoffinCount = this.root.querySelector("#bossCoffinCount");
    this.bossCoffinBonus = this.root.querySelector("#bossCoffinBonus");
    this.coffinChoiceMask = this.root.querySelector("#coffinChoiceMask");
    this.coffinChoiceHint = this.root.querySelector("#coffinChoiceHint");
    this.corruptionCanvas = this.root.querySelector("#battleCorruptionCanvas");
    this.hand = this.root.querySelector("#battleHand");
    this.drawPile = this.root.querySelector("#battleDrawPile");
    this.discardPile = this.root.querySelector("#battleDiscardPile");
    this.drawCount = this.root.querySelector("#battleDrawCount");
    this.discardCount = this.root.querySelector("#battleDiscardCount");
    this.discardChoiceMask = this.root.querySelector("#discardChoiceMask");
    this.discardChoiceControls = this.root.querySelector("#discardChoiceControls");
    this.discardChoiceConfirm = this.root.querySelector("#discardChoiceConfirm");
    this.message = this.root.querySelector("#battleMessage");
    this.playerHp = this.root.querySelector("#battlePlayerHp");
    this.playerMental = this.root.querySelector("#battlePlayerMental");
    this.playerBlock = this.root.querySelector("#battlePlayerBlock");
    this.watchHour = this.root.querySelector("#watchHour");
    this.watchMinute = this.root.querySelector("#watchMinute");
    this.watchReadout = this.root.querySelector("#watchReadout");
    this.watchHpTag = this.root.querySelector("#watchHpTag strong");
    this.watchMentalTag = this.root.querySelector("#watchMentalTag strong");
    this.endTurnBtn = this.root.querySelector("#battleEndTurn");
    this.debugFinishBtn = this.root.querySelector("#battleDebugFinish");
    this.pileOverlay = this.root.querySelector("#pileOverlay");
    this.pileOverlayTitle = this.root.querySelector("#pileOverlayTitle");
    this.pileOverlayGrid = this.root.querySelector("#pileOverlayGrid");
    this.awakeMeter = this.root.querySelector("#awakeMeter");
    this.awakeCount = this.root.querySelector("#awakeCount");
    this.awakeState = this.root.querySelector("#awakeState");
    this.awakeFeedback = this.root.querySelector("#awakeFeedback");
    this.awakeTooltip = this.root.querySelector(".awake-tooltip");
    this.vibrationMeter = this.root.querySelector("#vibrationMeter");
    this.vibrationCount = this.root.querySelector("#vibrationCount");
    this.vibrationPointer = this.root.querySelector("#vibrationPointer");
    this.vibrationState = this.root.querySelector("#vibrationState");
    this.checkinMeter = this.root.querySelector("#checkinMeter");
    this.checkinCount = this.root.querySelector("#checkinCount");
    this.checkinConditionList = this.root.querySelector("#checkinConditionList");
    this.checkinFeedback = this.root.querySelector("#checkinFeedback");
    this.checkinTooltip = this.root.querySelector("#checkinTooltip");
    this.endTurnForecast = this.root.querySelector("#endTurnForecast");
    this.awakeLessonToast = this.root.querySelector("#awakeLessonToast");
    this.systemNotice = this.root.querySelector("#battleSystemNotice");
    this.relicMount = this.root.querySelector("#battleRelicMount");
    this.statusList = this.root.querySelector("#battleStatusList");
    this.statusTooltip = this.root.querySelector("#battleStatusTooltip");
    this.relicOverlay = this.root.querySelector("#relicOverlay");
    this.relicChoiceGrid = this.root.querySelector("#relicChoiceGrid");
    this.failOverlay = this.root.querySelector("#battleFailOverlay");
    this.failReturnBtn = this.root.querySelector("#battleFailReturn");
    this.tutorialOverlay = this.root.querySelector("#battleTutorialOverlay");
    this.tutorialHighlights = this.root.querySelector("#battleTutorialHighlights");
    this.tutorialCard = this.root.querySelector("#battleTutorialCard");
  }

  bindEvents() {
    this.hand.addEventListener("pointermove", (event) => {
      if (this.dragState) return;
      const card = event.target.closest(".battle-card");
      const nextIndex = card && this.hand.contains(card) ? Number(card.dataset.index) : null;
      if (card && !this.areCardInteractionsReduced()) this.scheduleCardPerspective(card, event);
      if (this.discardChoice?.selectedId) {
        const selectedIndex = this.selectedDiscardIndex();
        if (this.handHoverIndex === selectedIndex) return;
        this.handHoverIndex = selectedIndex;
        this.cardPerspectiveRect = null;
        this.cardPerspectiveCard = null;
        this.layoutHand();
        return;
      }
      if (this.handHoverIndex === nextIndex) return;

      this.handHoverIndex = nextIndex;
      this.cardPerspectiveRect = null;
      this.cardPerspectiveCard = null;
      this.layoutHand();
    });

    this.hand.addEventListener("pointerleave", () => {
      if (this.discardChoice?.selectedId) {
        const selectedIndex = this.selectedDiscardIndex();
        if (this.handHoverIndex === selectedIndex) return;
        this.handHoverIndex = selectedIndex;
        this.cardPerspectiveRect = null;
        this.cardPerspectiveCard = null;
        this.layoutHand();
        return;
      }
      if (this.handHoverIndex === null) return;
      this.cardPerspectiveRect = null;
      this.cardPerspectiveCard = null;
      this.resetCardPerspective();
      this.handHoverIndex = null;
      this.layoutHand();
    });

    this.hand.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        event.preventDefault();
        return;
      }
      const cardEl = event.target.closest(".battle-card");
      if (this.discardChoice) {
        if (cardEl && this.hand.contains(cardEl)) this.selectDiscardChoice(cardEl.dataset.cardId);
        return;
      }
      if (!cardEl || this.busy || this.state.finished) return;
      this.beginCardDrag(event, cardEl);
    });
    this.hand.addEventListener("contextmenu", (event) => this.handleHandContextMenu(event));

    this.endTurnBtn.addEventListener("click", () => this.requestEndTurn());
    this.root.addEventListener("click", (event) => this.recoverEndTurnClick(event), true);
    this.debugFinishBtn?.addEventListener("click", () => this.debugFinishBattle());
    this.discardChoiceConfirm?.addEventListener("click", () => this.confirmDiscardChoice());
    this.drawPile.addEventListener("click", () => this.showPileOverlay("draw"));
    this.discardPile.addEventListener("click", () => this.showPileOverlay("discard"));
    this.pileOverlay.addEventListener("click", (event) => {
      if (event.target === this.pileOverlay || event.target.closest("[data-close-pile]")) {
        this.hidePileOverlay();
      }
    });
    this.statusList?.addEventListener("pointerover", (event) => this.showStatusTooltip(event));
    this.statusList?.addEventListener("pointerout", (event) => this.hideStatusTooltip(event));
    this.statusList?.addEventListener("focusin", (event) => this.showStatusTooltip(event));
    this.statusList?.addEventListener("focusout", (event) => this.hideStatusTooltip(event));
    this.bossCoffinCards?.addEventListener("click", (event) => this.chooseCoffinCard(event));
    this.coffinChoiceMask?.addEventListener("click", () => this.skipCoffinChoice());
    this.bindFailReturnButton();
  }

  bindFailReturnButton() {
    if (!this.failReturnBtn || this.failReturnBtn.dataset.bound) return;
    this.failReturnBtn.dataset.bound = "true";
    this.failReturnBtn.addEventListener("click", () => this.handleDefeatReturn());
  }

  requestEndTurn() {
    if (this.state.finished) return;
    if (this.coffinChoice) {
      this.message.textContent = "请先处理灵柩选择";
      return;
    }
    if (this.discardChoice) {
      this.message.textContent = "请先完成弃牌选择";
      return;
    }
    if (this.busy) {
      this.message.textContent = "正在结算，请稍候";
      return;
    }
    this.endTurn();
  }

  recoverEndTurnClick(event) {
    if (!this.endTurnBtn || event.target.closest?.("#battleEndTurn, #battleDebugFinish")) return;
    if (!this.isPointInsideElement(event, this.endTurnBtn)) return;
    if (event.target.closest?.(".pile-overlay, .discard-choice-mask, .coffin-choice-mask, .relic-overlay, .battle-fail-overlay, .battle-tutorial-overlay")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.requestEndTurn();
  }

  isPointInsideElement(event, element) {
    const rect = element.getBoundingClientRect();
    return event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
  }

  beginCardDrag(event, cardEl) {
    const card = this.state.hand.find((item) => item.id === cardEl.dataset.cardId);
    const reason = card ? this.playableReason(card) : "";
    if (!card || reason || cardEl.disabled) return;

    const rect = cardEl.getBoundingClientRect();
    this.dragState = {
      cardId: card.id,
      cardEl,
      parent: cardEl.parentElement,
      nextSibling: cardEl.nextElementSibling,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      rect,
      enemyRects: this.enemyCards.map((enemyCard) => ({
        enemyCard,
        enemyId: enemyCard.dataset.enemyId,
        rect: enemyCard.getBoundingClientRect(),
      })),
      playAreaRect: this.hand.getBoundingClientRect(),
      dragging: false,
      rafId: 0,
      dragX: 0,
      dragY: 0,
      targetEnemyId: null,
      skillTargeted: false,
      damagePreviewKey: "",
    };

    cardEl.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", this.handleCardDragMove, { passive: false });
    window.addEventListener("pointerup", this.handleCardDragEnd);
    window.addEventListener("pointercancel", this.handleCardDragCancel);
  }

  handleCardDragMove = (event) => {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    if (event.buttons !== 1) {
      void this.cancelActiveCardDrag();
      return;
    }

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.dragging && distance < DRAG_START_THRESHOLD) return;
    if (!drag.dragging) {
      drag.dragging = true;
      this.handHoverIndex = null;
      document.body.append(drag.cardEl);
      drag.cardEl.classList.add("is-dragging");
      drag.cardEl.style.left = `${drag.rect.left}px`;
      drag.cardEl.style.top = `${drag.rect.top}px`;
      drag.cardEl.style.width = `${drag.rect.width}px`;
      drag.cardEl.style.height = `${drag.rect.height}px`;
      drag.cardEl.style.bottom = "auto";
      drag.cardEl.style.transform = "translate3d(0, 0, 0) rotate(0deg) scale(1.06)";
      this.layoutHand();
      drag.cardEl.style.zIndex = "80";
    }

    this.positionDraggedCard(event.clientX, event.clientY);
    this.updateDragTarget(event.clientX, event.clientY);
  };

  handleHandContextMenu(event) {
    if (!event.target.closest(".battle-card")) return;
    event.preventDefault();
    void this.cancelActiveCardDrag();
  }

  async cancelActiveCardDrag() {
    const drag = this.dragState;
    if (!drag) return;
    this.detachDragListeners(drag);
    this.root.classList.remove("is-attack-targeted", "is-skill-targeted");
    this.clearEnemyTargets();
    if (drag.dragging) {
      await this.cancelCardDrag(drag);
      return;
    }
    this.dragState = null;
  }

  handleCardDragEnd = async (event) => {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    this.detachDragListeners(drag);

    if (!drag.dragging) {
      this.dragState = null;
      return;
    }

    const card = this.state.hand.find((item) => item.id === drag.cardId);
    const finalTargetEnemyCard = card && this.requiresEnemyTarget(card)
      ? this.enemyCardAtPoint(event.clientX, event.clientY)
      : null;
    if (finalTargetEnemyCard) {
      drag.targetEnemyId = finalTargetEnemyCard.dataset.enemyId || null;
    }
    const valid = card && (
      this.requiresEnemyTarget(card)
        ? Boolean(finalTargetEnemyCard)
        : this.isOutsidePlayArea(event.clientX, event.clientY)
    );
    this.root.classList.remove("is-attack-targeted", "is-skill-targeted");
    this.clearEnemyTargets();

    if (valid) {
      if (drag.rafId) {
        cancelAnimationFrame(drag.rafId);
        drag.rafId = 0;
        drag.cardEl.style.transform = `translate3d(${drag.dragX}px, ${drag.dragY}px, 0) rotate(0deg) scale(1.06)`;
      }
      this.dragState = null;
      await this.playCard(drag.cardId, drag.cardEl, drag.targetEnemyId);
      return;
    }

    await this.cancelCardDrag(drag);
  };

  handleCardDragCancel = async (event) => {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.detachDragListeners(drag);
    this.root.classList.remove("is-attack-targeted", "is-skill-targeted");
    this.clearEnemyTargets();
    if (drag.dragging) {
      await this.cancelCardDrag(drag);
      return;
    }
    this.dragState = null;
  };

  detachDragListeners(drag) {
    if (drag.cardEl.hasPointerCapture(drag.pointerId)) {
      drag.cardEl.releasePointerCapture(drag.pointerId);
    }
    window.removeEventListener("pointermove", this.handleCardDragMove);
    window.removeEventListener("pointerup", this.handleCardDragEnd);
    window.removeEventListener("pointercancel", this.handleCardDragCancel);
  }

  positionDraggedCard(clientX, clientY) {
    const drag = this.dragState;
    if (!drag) return;
    drag.dragX = clientX - drag.offsetX - drag.rect.left;
    drag.dragY = clientY - drag.offsetY - drag.rect.top;
    if (drag.rafId) return;
    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = 0;
      drag.cardEl.style.transform = `translate3d(${drag.dragX}px, ${drag.dragY}px, 0) rotate(0deg) scale(1.06)`;
    });
  }

  updateDragTarget(clientX, clientY) {
    const drag = this.dragState;
    if (!drag) return;
    const card = this.state.hand.find((item) => item.id === drag.cardId);
    if (!card) return;
    const def = cardDef(card);
    const needsEnemyTarget = this.requiresEnemyTarget(card);
    const targetEnemy = this.enemyCardAtPoint(clientX, clientY);
    const nextTargetEnemyId = targetEnemy?.dataset.enemyId || null;
    if (drag.targetEnemyId !== nextTargetEnemyId) {
      this.root.classList.toggle(
        "is-attack-targeted",
        needsEnemyTarget && Boolean(targetEnemy),
      );
      this.enemyCards.forEach((enemyCard) => {
        enemyCard.classList.toggle("is-targeted", enemyCard === targetEnemy);
      });
      drag.targetEnemyId = nextTargetEnemyId;
    }
    if (def.type === "attack") {
      this.updateDraggedDamagePreview(drag, card, targetEnemy);
    } else {
      this.updateDraggedDamagePreview(drag, card, null);
    }
    const skillTargeted = def.type !== "attack" && !needsEnemyTarget && this.isOutsidePlayArea(clientX, clientY);
    if (drag.skillTargeted !== skillTargeted) {
      drag.skillTargeted = skillTargeted;
      this.root.classList.toggle("is-skill-targeted", skillTargeted);
    }
  }

  updateDraggedDamagePreview(drag, card, targetEnemyCard) {
    if (!drag?.cardEl || !card) return;
    const enemy = targetEnemyCard ? this.enemyById(targetEnemyCard.dataset.enemyId) : null;
    const damageOverride = enemy
      ? effectiveAttackDamage(card, this.playerForAttack(card), enemy)
      : null;
    const previewKey = enemy ? `${enemy.id}:${damageOverride}` : "";
    if (drag.damagePreviewKey === previewKey) return;
    drag.damagePreviewKey = previewKey;
    drag.cardEl.innerHTML = renderBattleCardInner(card, { damageOverride, player: this.state.player });
  }

  areCardInteractionsReduced() {
    return Boolean(this.runState?.reducedEffects);
  }

  syncReducedEffects() {
    if (!this.areCardInteractionsReduced()) return;
    this.pendingPerspective = null;
    if (this.cardPerspectiveFrame) {
      cancelAnimationFrame(this.cardPerspectiveFrame);
      this.cardPerspectiveFrame = 0;
    }
    if (!this.hand) return;
    this.resetCardPerspective();
    this.layoutHand();
  }

  scheduleCardPerspective(cardEl, event) {
    if (this.areCardInteractionsReduced()) return;
    if (this.cardPerspectiveCard !== cardEl) {
      this.cardPerspectiveCard = cardEl;
      this.cardPerspectiveRect = null;
    }
    this.pendingPerspective = {
      cardEl,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (this.cardPerspectiveFrame) return;
    this.cardPerspectiveFrame = requestAnimationFrame(() => {
      this.cardPerspectiveFrame = 0;
      const pending = this.pendingPerspective;
      this.pendingPerspective = null;
      if (!pending?.cardEl?.isConnected) return;
      this.updateCardPerspective(pending.cardEl, pending);
    });
  }

  updateCardPerspective(cardEl, event) {
    if (this.areCardInteractionsReduced()) return;
    const rect = this.cardPerspectiveCard === cardEl && this.cardPerspectiveRect
      ? this.cardPerspectiveRect
      : cardEl.getBoundingClientRect();
    this.cardPerspectiveCard = cardEl;
    this.cardPerspectiveRect = rect;
    const px = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
    const py = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
    const clampedX = Math.max(0, Math.min(1, px));
    const clampedY = Math.max(0, Math.min(1, py));
    const rotateY = (clampedX - 0.5) * 13;
    const rotateX = (0.5 - clampedY) * 11;

    cardEl.style.setProperty("--card-mx", `${clampedX * 100}%`);
    cardEl.style.setProperty("--card-my", `${clampedY * 100}%`);
    cardEl.style.setProperty("--card-rx", `${rotateX.toFixed(2)}deg`);
    cardEl.style.setProperty("--card-ry", `${rotateY.toFixed(2)}deg`);
  }

  resetCardPerspective(scope = this.hand) {
    this.cardPerspectiveRect = null;
    this.cardPerspectiveCard = null;
    if (!scope) return;
    scope.querySelectorAll(".battle-card").forEach((card) => {
      card.style.setProperty("--card-mx", "50%");
      card.style.setProperty("--card-my", "28%");
      card.style.setProperty("--card-rx", "0deg");
      card.style.setProperty("--card-ry", "0deg");
    });
  }

  isValidDrop(card, clientX, clientY) {
    const def = cardDef(card);
    if (this.requiresEnemyTarget(card)) return Boolean(this.enemyCardAtPoint(clientX, clientY));
    return this.isOutsidePlayArea(clientX, clientY);
  }

  requiresEnemyTarget(card) {
    const def = cardDef(card);
    return def.type === "attack" || card.key === "evidence";
  }

  enemyCardAtPoint(clientX, clientY) {
    const cachedRects = this.dragState?.enemyRects;
    if (cachedRects?.length) {
      const hit = cachedRects.find(({ enemyCard, enemyId, rect }) => {
        const enemy = this.enemyById(enemyId);
        return (
          enemy &&
          enemy.hp > 0 &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom &&
          enemyCard.isConnected
        );
      });
      return hit?.enemyCard || null;
    }
    return this.enemyCards.find((enemyCard) => {
      const enemy = this.enemyById(enemyCard.dataset.enemyId);
      return enemy && enemy.hp > 0 && pointInElement(enemyCard, clientX, clientY);
    });
  }

  clearEnemyTargets() {
    this.enemyCards.forEach((enemyCard) => enemyCard.classList.remove("is-targeted"));
  }

  isOutsidePlayArea(clientX, clientY) {
    const rect = this.dragState?.playAreaRect || this.hand.getBoundingClientRect();
    const margin = 18;
    return (
      clientY < rect.top + margin ||
      clientY > rect.bottom - margin ||
      clientX < rect.left + margin ||
      clientX > rect.right - margin
    );
  }

  async cancelCardDrag(drag) {
    const { cardEl } = drag;
    if (drag.rafId) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = 0;
      cardEl.style.transform = `translate3d(${drag.dragX}px, ${drag.dragY}px, 0) rotate(0deg) scale(1.06)`;
    }

    const current = cardEl.getBoundingClientRect();
    cardEl.classList.remove("is-dragging", "is-hovered");
    this.restoreDraggedCard(drag);
    cardEl.style.visibility = "hidden";
    this.handHoverIndex = null;
    this.resetCardPerspective();
    this.layoutHand();
    await nextFrame();
    const target = cardEl.getBoundingClientRect();

    document.body.append(cardEl);
    cardEl.classList.add("is-dragging");
    cardEl.style.visibility = "";
    cardEl.style.left = `${current.left}px`;
    cardEl.style.top = `${current.top}px`;
    cardEl.style.width = `${current.width}px`;
    cardEl.style.height = `${current.height}px`;
    cardEl.style.bottom = "auto";
    cardEl.style.zIndex = "80";
    cardEl.style.transform = "translate3d(0, 0, 0) rotate(0deg) scale(1.06)";

    let animation = null;

    try {
      animation = cardEl.animate(
        [
          {
            transform: "translate3d(0, 0, 0) rotate(0deg) scale(1.06)",
          },
          {
            transform: `translate3d(${target.left - current.left}px, ${target.top - current.top}px, 0) rotate(0deg) scale(1)`,
          },
        ],
        smoothTiming(360),
      );
      await animation.finished;
    } finally {
      if (animation) animation.cancel();
      cardEl.classList.remove("is-dragging");
      this.restoreDraggedCard(drag);
      this.dragState = null;
      this.layoutHand();
    }
  }

  restoreDraggedCard(drag) {
    if (drag.nextSibling && drag.parent.contains(drag.nextSibling)) {
      drag.parent.insertBefore(drag.cardEl, drag.nextSibling);
    } else {
      drag.parent.append(drag.cardEl);
    }
    drag.cardEl.style.left = "";
    drag.cardEl.style.top = "";
    drag.cardEl.style.width = "";
    drag.cardEl.style.height = "";
    drag.cardEl.style.bottom = "";
    drag.cardEl.style.transform = "";
    drag.cardEl.style.zIndex = "";
    drag.cardEl.style.margin = "";
    drag.cardEl.style.cursor = "";
    drag.cardEl.style.visibility = "";
    delete drag.cardEl.dataset.layoutKey;
  }

  renderAll() {
    this.renderStats();
    this.renderPiles();
    this.renderHand();
    this.renderRelics();
  }

  renderRelics() {
    if (!this.relicMount) return;
    const renderKey = (this.runState.relics || []).join("|");
    if (this.relicRenderKey === renderKey) return;
    this.relicRenderKey = renderKey;
    this.relicMount.innerHTML = renderRelicBar(this.runState.relics);
  }

  flashRelic(key) {
    if (!key || !this.hasRelic(key)) return;
    if (!this.root.querySelector(`[data-relic-key="${CSS.escape(key)}"]`)) this.renderRelics();
    this.root.querySelectorAll(`[data-relic-key="${CSS.escape(key)}"]`).forEach((token) => {
      token.classList.remove("is-triggering");
      void token.offsetWidth;
      token.classList.add("is-triggering");
      window.setTimeout(() => token.classList.remove("is-triggering"), 900);
    });
  }

  renderStats() {
    const { player } = this.state;
    this.playerHp.textContent = `生命 ${player.hp} / ${player.maxHp}`;
    this.playerMental.textContent = `精神 ${player.mental} / ${player.maxMental}`;
    this.playerBlock.textContent = `防御 ${player.block}`;
    this.renderAwakeMeter();
    this.renderVibrationMeter();
    this.renderCheckinMeter();
    this.renderBossCoffin();
    this.renderStatusPanel();
    this.renderWatch();
    this.state.enemies.forEach((enemy) => {
      const dom = this.enemyDom?.get(enemy.id);
      if (!dom) return;
      dom.hpText.textContent = enemy.block > 0
        ? `${enemy.hp} / ${enemy.maxHp}  防御 ${enemy.block}`
        : `${enemy.hp} / ${enemy.maxHp}`;
      dom.hpBar.style.width = `${percent(enemy.hp, enemy.maxHp)}%`;
      if (dom.statusTags) {
        const statusHtml = this.renderEnemyStatusTags(enemy);
        if (enemy._statusHtml !== statusHtml) {
          enemy._statusHtml = statusHtml;
          dom.statusTags.innerHTML = statusHtml;
        }
      }
      if (dom.intentText) {
        const intentSummary = this.enemyIntentSummary(enemy);
        if (enemy._intentSummary !== intentSummary) {
          enemy._intentSummary = intentSummary;
          dom.intentText.textContent = intentSummary;
        }
      }
      if (dom.intentTooltip) {
        const intentDescription = this.renderDescriptionWithCardRefs(this.enemyIntentDescription(enemy));
        if (enemy._intentDescription !== intentDescription) {
          enemy._intentDescription = intentDescription;
          dom.intentTooltip.innerHTML = intentDescription;
        }
      }
      dom.wrap.classList.toggle("is-defeated", enemy.hp <= 0);
    });
  }

  renderPiles() {
    this.drawCount.textContent = String(this.state.drawPile.length);
    this.discardCount.textContent = String(this.state.discardPile.length);
  }

  renderWatch() {
    if (!this.watchHour || !this.watchMinute) return;
    const { player } = this.state;
    this.watchHour.style.setProperty("--watch-angle", `${watchAngle(player.hp, player.maxHp)}deg`);
    this.watchMinute.style.setProperty("--watch-angle", `${watchAngle(player.mental, player.maxMental)}deg`);
    if (this.watchHpTag) this.watchHpTag.textContent = `${player.hp}`;
    if (this.watchMentalTag) this.watchMentalTag.textContent = `${player.mental}`;
  }

  renderBossCoffin() {
    if (!this.bossCoffin) return;
    const active = this.isCoffinBoss();
    this.bossCoffin.hidden = !active;
    this.root.classList.toggle("is-coffin-boss", active);
    if (!active) return;
    const count = this.state.boss.coffin.length;
    const bonusCount = this.bossCoffinBonusCount();
    if (this.bossCoffinCount) this.bossCoffinCount.textContent = String(count);
    if (this.bossCoffinBonus) {
      this.bossCoffinBonus.textContent = this.state.boss.transformed
        ? `回响加成 +${bonusCount * 20}%`
        : `伤害 +${bonusCount * 20}%`;
    }
    if (this.bossCoffinCards) {
      const choosing = Boolean(this.coffinChoice);
      const allowed = new Set(this.coffinChoice?.allowedIds || this.state.boss.coffin.map((card) => card.id));
      const cards = choosing
        ? this.state.boss.coffin.filter((card) => allowed.has(card.id))
        : this.state.boss.coffin.slice(-6);
      const renderKey = `${choosing ? "choose" : "view"}:${cards.map((card) => card.id).join(",")}`;
      this.bossCoffinCards.setAttribute("aria-hidden", choosing ? "false" : "true");
      if (this.bossCoffinRenderKey !== renderKey) {
        this.bossCoffinRenderKey = renderKey;
        const middle = (cards.length - 1) / 2;
        this.bossCoffinCards.innerHTML = cards
          .map((card, index) => `
            <button class="boss-coffin-card${choosing ? " is-selectable" : ""}" type="button" data-coffin-card="${escapeHtml(card.id)}" style="--coffin-card-x:${(index - middle) * 28}px;--coffin-card-rot:${(index - middle) * 7}deg;--coffin-card-z:${index};" ${choosing ? "" : "disabled"}>
              ${escapeHtml(cardDef(card).name)}
            </button>
          `)
          .join("");
      }
    }
    this.bossCoffin.classList.toggle("is-open", this.state.boss.transformed);
  }

  renderAwakeMeter() {
    if (this.awakeMeter) this.awakeMeter.hidden = true;
    if (this.endTurnForecast && this.isEarlyMorning()) this.endTurnForecast.hidden = true;
  }

  renderVibrationMeter() {
    if (!this.vibrationMeter) return;
    const active = this.isLegShake();
    this.vibrationMeter.hidden = !active;
    this.root.classList.toggle("is-leg-shake", active);
    if (!active) return;

    const value = this.state.player.vibration || 0;
    const state = this.vibrationStateInfo(value);
    this.vibrationMeter.dataset.vibrationState = state.key;
    if (this.endTurnForecast) {
      this.endTurnForecast.hidden = false;
      this.endTurnForecast.dataset.awakeState = state.key === "resonance" ? "over" : state.key === "shake" ? "risk" : "safe";
      this.endTurnForecast.innerHTML = `
        <strong>${escapeHtml(state.label)}</strong>
        <span>${escapeHtml(state.forecast)}</span>
      `;
    }
    this.hand?.style.setProperty("--vibration-intensity", String(Math.min(6, value)));
    if (this.vibrationCount) this.vibrationCount.textContent = `${value}/4`;
    if (this.vibrationState) this.vibrationState.textContent = state.label;
    if (this.vibrationPointer) {
      this.vibrationPointer.style.left = `${Math.min(100, (Math.min(4, value) / 4) * 100)}%`;
    }
  }

  vibrationStateInfo(value = this.state.player.vibration || 0) {
    if (value <= 1) {
      return { key: "stable", label: "稳住了", forecast: "无事发生" };
    }
    if (value <= 3) {
      return { key: "shake", label: "桌面微震", forecast: "将 1 张垃圾加入弃牌堆" };
    }
    return { key: "resonance", label: "全桌共振", forecast: "垃圾进抽牌堆，失去 1 精神，敌人 +1 力量" };
  }

  renderCheckinMeter() {
    if (!this.checkinMeter) return;
    const active = this.isCheckin();
    this.checkinMeter.hidden = !active;
    if (!active) return;

    const { player } = this.state;
    const completed = new Set(player.checkinCompleted || []);
    const success = Boolean(player.checkinSuccess);
    this.checkinMeter.dataset.checkinState = success ? "success" : completed.size > 0 ? "progress" : "risk";
    if (this.checkinCount) this.checkinCount.textContent = `${Math.min(2, completed.size)}/2`;
    if (this.checkinConditionList) {
      this.checkinConditionList.innerHTML = (player.checkinConditions || [])
        .map((condition) => `
          <span class="checkin-condition${completed.has(condition.id) ? " is-complete" : ""}" title="${escapeHtml(condition.description)}">
            <i></i>
            <strong>${escapeHtml(condition.label)}</strong>
          </span>
        `)
        .join("");
    }
    if (this.checkinTooltip) {
      const conditionText = (player.checkinConditions || [])
        .map((condition) => `${completed.has(condition.id) ? "已完成" : "未完成"}：${condition.description}`)
        .join(" ");
      this.checkinTooltip.innerHTML = this.renderDescriptionWithCardRefs(
        `完成任意 2 项：签到成功，并对签到造成 12 无法被防御的伤害。回合结束仍未成功：失去 1 精神，将 1 张焦虑加入弃牌堆，签到获得 15 防御，下回合扫码条件 +1。${conditionText}`,
      );
    }
    if (this.endTurnForecast) {
      this.endTurnForecast.hidden = false;
      this.endTurnForecast.dataset.awakeState = success ? "safe" : "risk";
      this.endTurnForecast.innerHTML = success
        ? "<strong>已签到</strong><span>回合结束不会触发失败惩罚</span>"
        : "<strong>未签到</strong><span>结束回合：失去 1 精神，加入 1 张焦虑，敌人获得 15 防御</span>";
    }
  }

  showCheckinFeedback(text) {
    if (!this.checkinFeedback) return;
    this.checkinFeedback.textContent = text;
    this.checkinFeedback.classList.remove("is-visible");
    void this.checkinFeedback.offsetWidth;
    this.checkinFeedback.classList.add("is-visible");
    window.clearTimeout(this.checkinFeedbackTimer);
    this.checkinFeedbackTimer = window.setTimeout(() => {
      this.checkinFeedback?.classList.remove("is-visible");
    }, 1250);
  }

  async showSystemNotice(text, { duration = 1180 } = {}) {
    if (!text || !this.systemNotice) return;
    window.clearTimeout(this.systemNoticeTimer);
    this.systemNotice.textContent = text;
    this.systemNotice.hidden = false;
    this.systemNotice.classList.remove("is-visible");
    void this.systemNotice.offsetWidth;
    this.systemNotice.classList.add("is-visible");
    await wait(duration);
    this.systemNotice.classList.remove("is-visible");
    this.systemNoticeTimer = window.setTimeout(() => {
      if (!this.systemNotice?.classList.contains("is-visible")) {
        this.systemNotice.hidden = true;
      }
    }, 220);
    await wait(120);
  }

  checkinConditionPool() {
    return this.state.turnNumber > 3
      ? [...BASIC_SCAN_CONDITIONS, ...ADVANCED_SCAN_CONDITIONS]
      : [...BASIC_SCAN_CONDITIONS];
  }

  chooseScanConditions(count) {
    if (!this.isCheckin()) return [];
    const chosen = [];
    const blocked = new Set();
    const addCondition = (condition) => {
      if (!condition || chosen.some((item) => item.id === condition.id) || blocked.has(condition.id)) return false;
      chosen.push(condition);
      (condition.conflicts || []).forEach((id) => blocked.add(id));
      return true;
    };

    addCondition(shuffle(BASIC_SCAN_CONDITIONS)[0]);
    const pool = shuffle(this.checkinConditionPool());
    for (const condition of pool) {
      if (chosen.length >= count) break;
      addCondition(condition);
    }

    return chosen;
  }

  startCheckinTurn() {
    if (!this.isCheckin()) return;
    const { player } = this.state;
    const count = Math.max(2, 3 + (player.checkinNextBonus || 0) + (player.checkinNextAdjustment || 0));
    player.checkinConditions = this.chooseScanConditions(count);
    player.checkinCompleted = [];
    player.checkinSuccess = false;
    player.checkinSuccessMessage = "";
    player.checkinNextBonus = 0;
    player.checkinNextAdjustment = 0;
    this.checkScanConditions();
  }

  checkScanConditions({ includeEnd = false } = {}) {
    if (!this.isCheckin() || this.state.finished) return;
    const { player } = this.state;
    const completed = new Set(player.checkinCompleted || []);
    (player.checkinConditions || []).forEach((condition) => {
      if (condition.endOnly && !includeEnd) return;
      if (condition.test({ player, battle: this.state })) completed.add(condition.id);
    });
    player.checkinCompleted = [...completed];
    if (!player.checkinSuccess && completed.size >= 2) {
      this.resolveCheckinSuccess();
    }
    this.renderCheckinMeter();
  }

  resolveCheckinSuccess() {
    if (!this.isCheckin() || this.state.player.checkinSuccess) return;
    const enemy = this.firstAliveEnemy();
    if (!enemy) return;
    const message = CHECKIN_SUCCESS_MESSAGES[Math.floor(Math.random() * CHECKIN_SUCCESS_MESSAGES.length)];
    this.state.player.checkinSuccess = true;
    this.state.player.checkinSuccessMessage = message;
    this.damageEnemyUnblockable(12, enemy.id);
    this.message.textContent = message;
    this.showCheckinFeedback(message);
    void this.showSystemNotice(message);
  }

  async resolveCheckinEndOfTurn() {
    if (!this.isCheckin()) return;
    const { player } = this.state;
    if (player.checkinSuccess) {
      this.message.textContent = player.checkinSuccessMessage || "签到成功";
      return;
    }
    const enemy = this.firstAliveEnemy();
    this.loseMental(1);
    this.addCardsToPile("discardPile", "anxiety", 1);
    if (enemy) enemy.block = (enemy.block || 0) + 15;
    player.checkinNextBonus = (player.checkinNextBonus || 0) + 1;
    this.message.textContent = "未签到：失去 1 精神，加入 1 张焦虑，签到获得 15 防御";
    this.showCheckinFeedback("未检测到有效签到记录。");
    await this.showSystemNotice("未检测到有效签到记录。");
  }

  changeVibration(amount, reason) {
    if (!this.isLegShake() || amount <= 0 || this.state.finished) return;
    this.state.player.vibration += amount;
    this.message.textContent = `震感 +${amount}：${reason}`;
    this.renderVibrationMeter();
    this.renderStats();
  }

  showEarlyMorningBasicTutorial() {
    if (this.runState.skipTutorial) return Promise.resolve();
    if (!this.isEarlyMorning() || this.state.turnNumber !== 1 || !this.tutorialOverlay) return Promise.resolve();
    const steps = this.basicTutorialSteps();
    if (!steps.length) return Promise.resolve();

    this.busy = true;
    this.tutorialOverlay.hidden = false;
    this.tutorialOverlay.classList.add("is-visible");
    let index = 0;

    return new Promise((resolve) => {
      const finish = () => {
        this.tutorialOverlay.removeEventListener("click", next);
        window.removeEventListener("resize", render);
        this.tutorialOverlay.classList.remove("is-visible");
        window.setTimeout(() => {
          this.tutorialOverlay.hidden = true;
          if (this.tutorialHighlights) this.tutorialHighlights.innerHTML = "";
          this.busy = false;
          resolve();
        }, 180);
      };
      const next = () => {
        index += 1;
        if (index >= steps.length) {
          finish();
          return;
        }
        render();
      };
      const render = () => this.renderBasicTutorialStep(steps[index], index, steps.length);

      this.tutorialOverlay.addEventListener("click", next);
      window.addEventListener("resize", render);
      render();
    });
  }

  basicTutorialSteps() {
    return [
      {
        title: "精神",
        body: "卡牌左上角的数字是打出这张牌需要消耗的精神。精神降到很低时，有些牌会变强，也有些风险会变高。",
        targets: ["cardCost"],
      },
      {
        title: "左手手表",
        body: "手表同时显示生命和精神：时针对应生命，分针对应精神。数值变化时，指针会拨动。",
        targets: ["watch"],
      },
      {
        title: "攻击牌",
        body: "红色牌是攻击牌。攻击牌通常需要拖到敌人身上才能打出。",
        targets: ["attackCard"],
      },
      {
        title: "防御牌",
        body: "绿色牌是防御牌。防御会优先抵消本回合受到的伤害。",
        targets: ["defenseCard"],
      },
      {
        title: "技能牌",
        body: "蓝色牌是技能牌。技能牌通常提供抽牌、回复精神或特殊效果。",
        targets: ["skillCard"],
      },
      {
        title: "抽牌堆",
        body: "这里显示剩余抽牌数量。点击牌堆可以查看里面还有哪些牌。",
        targets: ["drawPile"],
      },
      {
        title: "弃牌堆",
        body: "打出或回合结束丢弃的牌会进入弃牌堆。抽牌堆用尽时，弃牌堆会洗回抽牌堆。",
        targets: ["discardPile"],
      },
    ];
  }

  renderBasicTutorialStep(step, index, total) {
    if (!this.tutorialCard || !this.tutorialHighlights) return;
    this.tutorialCard.innerHTML = `
      <span>${index + 1} / ${total}</span>
      <strong>${escapeHtml(step.title)}</strong>
      <p>${escapeHtml(step.body)}</p>
      <em>点击继续</em>
    `;
    const rects = (step.targets || [])
      .map((target) => this.tutorialTargetRect(target))
      .filter(Boolean)
      .slice(0, 4);
    this.tutorialHighlights.innerHTML = [
      this.renderTutorialShades(rects[0]),
      ...rects
      .map(({ rect, pad = 8 }) => {
        return `
          <i style="
            left:${rect.left - pad}px;
            top:${rect.top - pad}px;
            width:${rect.width + pad * 2}px;
            height:${rect.height + pad * 2}px;
          "></i>
        `;
      }),
    ].join("");
  }

  tutorialTargetRect(target) {
    const handCard = (selector) => this.hand?.querySelector(selector);
    if (target === "cardCost") {
      const card = this.hand?.querySelector(".battle-card");
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return {
        rect: {
          left: rect.left + rect.width * 0.11,
          top: rect.top + rect.height * 0.08,
          width: rect.width * 0.22,
          height: rect.height * 0.16,
        },
        pad: 4,
      };
    }
    const targetMap = {
      watch: ".player-watch",
      attackCard: ".battle-card.attack",
      defenseCard: ".battle-card.defense",
      skillCard: ".battle-card.skill",
      drawPile: "#battleDrawPile",
      discardPile: "#battleDiscardPile",
    };
    const element = target.endsWith("Card") ? handCard(targetMap[target]) : this.root.querySelector(targetMap[target]);
    if (!element) return null;
    return { rect: element.getBoundingClientRect(), pad: element.classList.contains("battle-card") ? 10 : 8 };
  }

  renderTutorialShades(target) {
    const shadeBackground = `
      radial-gradient(circle at 50% 52%, rgba(26, 8, 30, 0.18), rgba(12, 4, 16, 0.78) 68%),
      rgba(10, 4, 12, 0.64)
    `;
    if (!target) {
      return `<b class="battle-tutorial-shade" style="left:0;top:0;width:100vw;height:100vh;background:${shadeBackground};"></b>`;
    }
    const { rect, pad = 8 } = target;
    const left = Math.max(0, rect.left - pad - 6);
    const top = Math.max(0, rect.top - pad - 6);
    const right = Math.min(window.innerWidth, rect.left + rect.width + pad + 6);
    const bottom = Math.min(window.innerHeight, rect.top + rect.height + pad + 6);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    return `
      <b class="battle-tutorial-shade" style="left:0;top:0;width:100vw;height:${top}px;background:${shadeBackground};"></b>
      <b class="battle-tutorial-shade" style="left:0;top:${bottom}px;width:100vw;height:${Math.max(0, window.innerHeight - bottom)}px;background:${shadeBackground};"></b>
      <b class="battle-tutorial-shade" style="left:0;top:${top}px;width:${left}px;height:${height}px;background:${shadeBackground};"></b>
      <b class="battle-tutorial-shade" style="left:${right}px;top:${top}px;width:${Math.max(0, window.innerWidth - right)}px;height:${height}px;background:${shadeBackground};"></b>
    `;
  }

  renderStatusPanel() {
    if (!this.statusList) return;
    const statuses = this.playerStatuses();

    this.statusList.innerHTML = statuses
      .map((status) => `
        <span class="battle-status-token" tabindex="0" data-status-label="${escapeHtml(status.label)}" data-status-desc="${escapeHtml(status.description)}" data-card-key="${escapeHtml(status.cardKey || "")}" style="${statusIconStyle(status.label)}">
          <span class="battle-status-icon" aria-hidden="true"></span>
          ${status.value !== "" && status.value !== undefined ? `<i>${escapeHtml(String(status.value))}</i>` : ""}
        </span>
      `)
      .join("");
  }

  renderEnemyStatusTags(enemy) {
    const tags = [];
    if (enemy.strength) tags.push({ label: "力量", value: enemy.strength });
    if (enemy.gaze) tags.push({ label: "注视", value: enemy.gaze });
    if (!tags.length) return "";

    return tags
      .map((tag) => `
        <span class="enemy-status-tag">
          <strong>${escapeHtml(tag.label)}</strong>
          <i>${escapeHtml(String(tag.value))}</i>
        </span>
      `)
      .join("");
  }

  playerStatuses() {
    const { player } = this.state;
    const statuses = [
      { label: "防御", value: player.block, description: "受到伤害时先消耗防御。你的回合开始时清零。" },
    ];

    if (player.strength) statuses.push({ label: "力量", value: player.strength, description: "攻击牌伤害 +1。" });
    if (player.dexterity) statuses.push({ label: "敏捷", value: player.dexterity, description: "获得防御时，防御 +1。" });
    if (player.late) statuses.push({ label: "迟到", value: player.late, description: "持续 1 回合。第 2 张及之后的攻击牌：失去 1 精神。" });
    if (player.distracted) statuses.push({ label: "分心", value: player.distracted, description: "下次抽牌少抽 1 张，然后移除。" });
    if (player.networkWave) statuses.push({ label: "网络波动", value: player.networkWave, description: "下回合扫码条件数量 -1。" });
    if (player.summer) statuses.push({ label: "暑假", value: "", description: "持续到回合结束。本回合不能打出攻击牌。" });
    if (player.nullifyEnemyThisTurn) statuses.push({ label: "暂", value: "", description: "本回合敌人的伤害和效果无效。回响转化除外。" });
    if (player.nextDrawBonus) statuses.push({ label: "加抽", value: player.nextDrawBonus, description: "本场战斗每回合抽牌数增加。" });
    if (player.nextDrawPenalty) statuses.push({ label: "少抽", value: player.nextDrawPenalty, description: "下回合抽牌数减少。" });
    if (this.isDorm()) {
      if (this.dormEnemyAlive("smell")) statuses.push({ label: "臭味", value: "", description: "臭味怪存活。每回合第一次回复精神：少回复 1。" });
      if (this.dormEnemyAlive("noise")) statuses.push({ label: "噪声", value: "", description: "噪声怪存活。第 5 张及之后的牌：失去 1 精神。" });
      if (this.dormEnemyAlive("clutter")) statuses.push({ label: "堆积", value: "", description: "堆积怪存活。臭味怪和噪声怪受到的攻击伤害 -2。注视不受影响。" });
      if (player.mentalRecoveryPenaltyThisTurn) statuses.push({ label: "呛鼻", value: player.mentalRecoveryPenaltyThisTurn, description: "本回合回复精神时，回复量减少。" });
      if (player.skillHalfThisTurn) statuses.push({ label: "循环播放", value: "", description: "本回合第一张技能牌效果减半。" });
      if (this.state.dorm.nextEnemyDamagePenalty) statuses.push({ label: "舍敌", value: this.state.dorm.nextEnemyDamagePenalty, description: "下个敌方回合，所有敌人伤害降低。" });
    }
    if (this.isCoffinBoss()) {
      if (player.hollow) statuses.push({ label: "空洞", value: player.hollow, description: "获得精神时，每层抵消 1 点，并让理想的灵柩回复 10 生命。" });
      if (player.muddled) statuses.push({ label: "混浊", value: player.muddled, description: "回响转化留下的污染印记。" });
      if (player.breachNextBlock) statuses.push({ label: "破绽", value: player.breachNextBlock, description: "下回合第一次获得防御时，改为获得 0 防御。" });
      if (player.countdown) statuses.push({ label: "倒数", value: player.countdown, description: "你的回合结束时，每层造成 4 伤害。攻击 Boss 时移除 1 层。" });
      if (player.stingNextBlock) statuses.push({ label: "刺痛", value: player.stingNextBlock, description: "下回合每次获得防御：失去 1 精神。最多触发 2 次。" });
      if (player.rebuttalNextStrength) statuses.push({ label: "反驳", value: player.rebuttalNextStrength, description: "下回合第一次获得力量时，改为受到 6 伤害。" });
      if (player.overdraft) statuses.push({ label: "透支", value: player.overdraft, description: "你的回合开始时，每层失去 1 精神。实际回复精神时移除 1 层。" });
    }

    return statuses;
  }

  showStatusTooltip(event) {
    const token = event.target.closest(".battle-status-token");
    if (!token || !this.statusTooltip) return;
    const label = token.dataset.statusLabel || "";
    this.statusTooltip.innerHTML = `
      <strong class="battle-status-tooltip-title">${escapeHtml(label)}</strong>
      ${this.renderDescriptionWithCardRefs(token.dataset.statusDesc || "", token.dataset.cardKey ? [token.dataset.cardKey] : [])}
    `;
    this.statusTooltip.hidden = false;
  }

  hideStatusTooltip(event) {
    if (!this.statusTooltip) return;
    if (event.relatedTarget?.closest?.(".battle-status-token")) return;
    this.statusTooltip.hidden = true;
  }

  enemyIntentSummary(enemy) {
    if (this.isCoffinBoss()) return this.bossIntentSummary(enemy);
    const action = enemy.pattern[enemy.patternIndex] || enemy.pattern[0];
    if (!action) return "";
    if (this.isEarlyMorning()) {
      const parts = [];
      if (action.hits) {
        parts.push(`攻击 ${this.enemyHitValues(enemy, action).join("+")}`);
      } else if (action.damage) {
        parts.push(`攻击 ${this.enemyHitValues(enemy, action)[0]}`);
      }
      if (action.block) parts.push(`防御 ${action.block}`);
      if (action.status === "late") parts.push("迟到");
      return parts.join(" / ") || action.intent || action.name || "";
    }
    const parts = [];

    if (action.hits) {
      parts.push(`攻击 ${this.enemyHitValues(enemy, action).join("+")}`);
    } else if (action.damage) {
      parts.push(`攻击 ${this.enemyHitValues(enemy, action)[0]}`);
    }
    if (action.block) parts.push(`防御 ${action.block}`);
    if (action.blockAll) parts.push(`全体防御 ${action.blockAll}`);
    if (action.blockSelf) parts.push(`自身防御 ${action.blockSelf}`);
    if (action.blockOthers) parts.push(`其他防御 ${action.blockOthers}`);
    if (action.environmentAdd) parts.push(`${this.dormEnvironmentLabel(action.environmentAdd.key)}+${action.environmentAdd.amount}`);
    if (action.status === "late") parts.push("迟到");
    if (action.addDraw) parts.push(`塞${cardDef({ key: action.addDraw }).name}`);
    if (action.addDiscard) parts.push(`弃牌堆+${cardDef({ key: action.addDiscard }).name}`);
    if (action.anxietyIfMentalBelow !== undefined) parts.push("低精神塞焦虑");
    if (action.strengthIfMentalAtLeast !== undefined) parts.push("高精神加力量");
    if (action.anxietyToHandIfMentalZero) parts.push("0 精神塞焦虑");
    if (action.scanNextAdjustment) parts.push("网络波动");
    if (action.loseMentalIfBelow) parts.push("低精神失去精神");
    if (action.loseMental) parts.push(`失去精神 ${action.loseMental}`);
    if (action.addAnxietyIfMentalAbove !== undefined) parts.push("高精神塞焦虑");
    if (action.nextSkillHalf) parts.push("技能减半");
    if (action.mentalRecoveryPenaltyNext) parts.push("精神回复-1");
    if (action.loseMentalIfLastTurnCardsAtLeast) parts.push("多出牌失精神");
    if (action.status === "distracted") parts.push("分心");
    if (action.junkDamage || action.junkDamageCap) parts.push(`垃圾增伤 ${this.junkDamageBonus(action.junkDamageCap)}`);
    if (this.legShakeIntentEnhanced()) {
      parts.push("攻击将强化");
    }
    return parts.join(" / ") || action.intent || action.name || "";
  }

  enemyHitValues(enemy, action) {
    const hits = this.enemyActionHits(action);
    const strength = enemy.strength || 0;
    const dormPenalty = this.isDorm() ? this.state.dorm.nextEnemyDamagePenalty || 0 : 0;
    return hits.map((hit) => Math.max(0, hit + strength - dormPenalty));
  }

  enemyActionHits(action) {
    if (this.isCoffinBoss()) {
      if (this.state.boss.transformPending) return this.state.boss.coffin.map(() => 10);
      if (this.state.boss.phase === 1) return [this.bossPhaseOneDamage(action)];
      if (this.state.boss.phase === 2) return [this.bossModifiedDamage(20)];
    }
    const hits = action.hits ? [...action.hits] : action.damage ? [action.damage] : [];
    if (action.extraDamageIfMentalAtLeast && this.state.player.mental >= action.extraDamageIfMentalAtLeast.threshold) {
      hits.push(action.extraDamageIfMentalAtLeast.damage);
    }
    if (action.junkDamage) {
      const bonus = this.junkDamageBonus();
      if (bonus > 0) {
        for (let index = 0; index < hits.length; index += 1) {
          hits[index] += bonus;
        }
      }
    } else if (action.junkDamageCap) {
      const bonus = this.junkDamageBonus(action.junkDamageCap);
      if (bonus > 0) hits.push(bonus);
    }
    if (this.state.player.legShakeResonance && action.resonanceBonusDamage) {
      hits.push(action.resonanceBonusDamage);
    }
    if (action.bonusDamageIfHandHas && this.handHasAny(action.bonusDamageIfHandHas.keys)) {
      hits.push(action.bonusDamageIfHandHas.damage);
    }
    return hits;
  }

  junkDamageBonus(cap = null) {
    const count = this.countCardsByKey("junk");
    return cap ? Math.min(cap, count) : count;
  }

  countCardsByKey(key) {
    return [...this.state.drawPile, ...this.state.hand, ...this.state.discardPile]
      .filter((card) => card.key === key)
      .length;
  }

  handHasAny(keys = []) {
    return this.state.hand.some((card) => keys.includes(card.key));
  }

  legShakeIntentEnhanced() {
    return this.isLegShake() && (this.state.player.legShakeResonance || (this.state.player.vibration || 0) >= 4);
  }

  bossAttackMultiplier() {
    if (!this.isCoffinBoss()) return 1;
    return 1 + this.bossCoffinBonusCount() * 0.2;
  }

  bossCoffinBonusCount() {
    if (!this.isCoffinBoss()) return 0;
    return this.state.boss.transformed
      ? this.state.boss.coffinBonusCount || 0
      : this.state.boss.coffin.length || 0;
  }

  bossModifiedDamage(base = 0) {
    return Math.max(0, Math.round(base * this.bossAttackMultiplier()));
  }

  bossPhaseOneDamage(action = {}) {
    const base = action.damage || 15;
    return action.coffinBonus ? this.bossModifiedDamage(base) : base;
  }

  bossCurrentAction(enemy = this.firstAliveEnemy()) {
    if (!this.isCoffinBoss() || !enemy) return null;
    if (this.state.boss.transformPending) {
      return {
        id: "echo_transform",
        name: "回响转化",
        message: "现在，听听它们的回声。",
      };
    }
    if (this.state.boss.phase === 2) {
      return {
        id: "echo_attack",
        name: "回响",
        message: "回响从灵柩里漫出来。",
      };
    }
    return enemy.pattern[enemy.patternIndex] || enemy.pattern[0];
  }

  bossIntentSummary(enemy) {
    const action = this.bossCurrentAction(enemy);
    if (!action) return "";
    if (action.id === "echo_transform") {
      const damage = this.state.boss.coffin.length * 10;
      return damage > 0 ? `伤害 ${damage} / 回响转化 / 混浊` : "回响转化 / 混浊";
    }
    const hits = this.enemyHitValues(enemy, action);
    const damage = hits.length ? `伤害 ${hits.join("+")}` : "";
    if (this.state.boss.phase === 2) {
      const twist = this.nextBossTwist();
      return [damage, twist ? `释放扭曲：${twist.label}` : "无扭曲"].filter(Boolean).join(" / ");
    }
    const effects = action.sealHandCard ? "封存 / 呼唤" : action.hollow ? "空洞 2" : "";
    return [damage, effects].filter(Boolean).join(" / ");
  }

  bossIntentDescription(enemy) {
    const action = this.bossCurrentAction(enemy);
    if (!action) return "";
    if (action.id === "echo_transform") {
      const count = this.state.boss.coffin.length;
      return `回响转化：每张封存牌造成 10 伤害，当前共 ${count * 10}。随后封存牌进入弃牌堆，灵柩清空，但伤害加成保留。施加 1 混浊，移除所有空洞。不能被暂抵消。`;
    }
    const hits = this.enemyHitValues(enemy, action);
    const damageText = hits.length ? `伤害：${hits.join(" + ")}。` : "";
    const bonusText = action.coffinBonus || this.state.boss.phase === 2
      ? `${this.state.boss.transformed ? "回响保留" : "灵柩中有"} ${this.bossCoffinBonusCount()} 张牌的加成。攻击倍率 ${Math.round(this.bossAttackMultiplier() * 100)}%。`
      : "这次攻击不受灵柩加成影响。";
    if (this.state.boss.phase === 2) {
      const twist = this.nextBossTwist();
      return `${action.name}：${damageText}${bonusText}${twist ? ` 攻击后释放 ${twist.label}。` : " 当前没有可释放的扭曲效果。"}`;
    }
    if (action.sealHandCard) return `${action.name}：${damageText}${bonusText} 随机封存 1 张非保留手牌，并将 1 张呼唤加入手牌。`;
    if (action.hollow) return `${action.name}：${damageText}${bonusText} 施加 ${action.hollow} 空洞。`;
    return `${action.name}：${damageText}${bonusText}`;
  }

  dormEnvironmentLabel(key) {
    if (key === "smell") return "臭味";
    if (key === "noise") return "噪声";
    if (key === "clutter") return "堆积";
    return key;
  }

  enemyIntentDescription(enemy) {
    if (this.isCoffinBoss()) return this.bossIntentDescription(enemy);
    const action = enemy.pattern[enemy.patternIndex] || enemy.pattern[0];
    if (!action) return "";
    if (this.isEarlyMorning()) {
      const parts = [];
      if (action.hits) {
        parts.push(`伤害：${this.enemyHitValues(enemy, action).join(" + ")}。`);
      } else if (action.damage) {
        parts.push(`伤害：${this.enemyHitValues(enemy, action)[0]}。`);
      } else {
        parts.push("不造成伤害。");
      }
      return parts.join(" ");
    }
    const parts = [];

    if (action.name) parts.push(action.name);
    if (action.hits) {
      const hits = this.enemyHitValues(enemy, action).join(" + ");
      parts.push(`伤害：${hits}。`);
    } else if (action.damage) {
      parts.push(`伤害：${this.enemyHitValues(enemy, action)[0]}。`);
    }
    if (action.block) parts.push(`${enemy.name}获得 ${action.block} 防御。`);
    if (action.blockAll) parts.push(`全体敌人获得 ${action.blockAll} 防御。`);
    if (action.blockSelf) parts.push(`${enemy.name}获得 ${action.blockSelf} 防御。`);
    if (action.blockOthers) parts.push(`其他敌人获得 ${action.blockOthers} 防御。`);
    if (action.environmentAdd) parts.push(`${this.dormEnvironmentLabel(action.environmentAdd.key)}提高 ${action.environmentAdd.amount}。`);
    if (action.status === "late") parts.push("施加 1 迟到。");
    if (action.addDraw) parts.push(`1 张${cardDef({ key: action.addDraw }).name}加入抽牌堆。`);
    if (action.anxietyIfMentalBelow !== undefined) parts.push(`精神低于 ${action.anxietyIfMentalBelow}：1 张焦虑加入弃牌堆。`);
    if (action.strengthIfMentalAtLeast !== undefined) parts.push(`精神至少 ${action.strengthIfMentalAtLeast}：早八获得 1 力量。`);
    if (action.anxietyToHandIfMentalZero) parts.push("精神为 0：1 张焦虑加入手牌。");
    if (action.status === "distracted") parts.push("施加 1 分心。");
    if (action.addHand) parts.push(`1 张${cardDef({ key: action.addHand }).name}加入手牌。`);
    if (action.addDiscard) parts.push(`1 张${cardDef({ key: action.addDiscard }).name}加入弃牌堆。`);
    if (action.scanNextAdjustment) parts.push(`网络波动：下回合扫码条件 ${action.scanNextAdjustment > 0 ? "+" : ""}${action.scanNextAdjustment}。`);
    if (action.loseMentalIfBelow) parts.push(`精神低于 ${action.loseMentalIfBelow.threshold}：失去 ${action.loseMentalIfBelow.amount} 精神。`);
    if (action.loseMental) parts.push(`你失去 ${action.loseMental} 精神。`);
    if (action.addAnxietyIfMentalAbove !== undefined) parts.push(`精神高于 ${action.addAnxietyIfMentalAbove}：1 张焦虑加入弃牌堆。`);
    if (action.mentalRecoveryPenaltyNext) parts.push(`下回合回复精神 -${action.mentalRecoveryPenaltyNext}。`);
    if (action.nextSkillHalf) parts.push("下回合第一张技能牌效果减半。");
    if (action.loseMentalIfLastTurnCardsAtLeast) parts.push(`上回合打出至少 ${action.loseMentalIfLastTurnCardsAtLeast.threshold} 张牌：失去 ${action.loseMentalIfLastTurnCardsAtLeast.amount} 精神。`);
    if (action.bonusDamageIfHandHas) parts.push(`若你手牌中有${action.bonusDamageIfHandHas.keys.map((key) => CARD_DEFS[key]?.name || key).join("或")}，额外造成 ${action.bonusDamageIfHandHas.damage} 伤害。`);
    if (action.extraDamageIfMentalAtLeast) {
      parts.push(`精神至少 ${action.extraDamageIfMentalAtLeast.threshold}：追加 ${action.extraDamageIfMentalAtLeast.damage} 伤害。`);
    }
    if (action.junkDamage) {
      parts.push(`每有 1 张垃圾在抽牌堆、手牌、弃牌堆中，每段伤害 +1；当前每段 +${this.junkDamageBonus()}。`);
    } else if (action.junkDamageCap) {
      parts.push(`每有 1 张垃圾在抽牌堆、手牌、弃牌堆中，额外造成 1 伤害，最多 +${action.junkDamageCap}；当前 +${this.junkDamageBonus(action.junkDamageCap)}。`);
    }
    if (this.legShakeIntentEnhanced()) {
      parts.push("这名敌人本回合的攻击将得到强化。你感觉整个教室都在看你。");
    }
    return parts.join(" ");
  }

  renderDescriptionWithCardRefs(text, explicitKeys = []) {
    const refs = this.cardRefsInText(text, explicitKeys);
    const copy = `<span class="tooltip-copy">${escapeHtml(text)}</span>`;
    if (!refs.length) return copy;

    const previews = refs
      .map((key) => renderPileCard({ id: `tooltip-${key}`, key }))
      .join("");
    return `
      <span class="tooltip-with-cards">
        ${copy}
        <span class="tooltip-card-refs">${previews}</span>
      </span>
    `;
  }

  cardRefsInText(text = "", explicitKeys = []) {
    const refs = new Set(explicitKeys.filter((key) => CARD_DEFS[key]));
    CARD_REFERENCE_NAMES.forEach(({ key, name }) => {
      if (text.includes(name)) refs.add(key);
    });
    return [...refs].slice(0, 4);
  }

  renderHand() {
    this.hand.innerHTML = "";
    const selectingDiscard = Boolean(this.discardChoice);

    this.state.hand.forEach((card, index) => {
      const def = cardDef(card);
      const reason = this.playableReason(card);
      const button = document.createElement("button");
      button.className = `battle-card ${def.type}`;
      button.type = "button";
      button.disabled = (!selectingDiscard && Boolean(reason)) || this.state.finished;
      if (button.disabled) button.classList.add("is-disabled");
      if (selectingDiscard) button.classList.add("is-discard-selectable");
      if (selectingDiscard && this.discardChoice.selectedId === card.id) button.classList.add("is-discard-selected");
      if (hasSummerText(def)) button.classList.add("has-summer");
      if (cardReferenceKeys(card).length) button.classList.add("has-card-refs");
      if (this.isSpecialEffectActive(card)) button.classList.add("is-special-active");
      button.dataset.cardId = card.id;
      button.dataset.index = String(index);
      button.innerHTML = renderBattleCardInner(card, { player: this.state.player });
      if (this.isBossTwistRecorded(card)) {
        button.classList.add("is-twist-recorded");
        button.insertAdjacentHTML("beforeend", `
          <span class="battle-card-twist-warning">
            理想的灵柩将在第二阶段施放这张牌的扭曲效果
          </span>
        `);
      }
      const vibrationPreview = this.vibrationPreviewForCard(card);
      if (vibrationPreview.amount > 0) {
        button.classList.add("has-vibration-warning");
        button.insertAdjacentHTML("beforeend", this.renderVibrationWarning(vibrationPreview));
      }
      this.hand.append(button);
    });

    this.handCards = [...this.hand.querySelectorAll(".battle-card")];
    this.layoutHand();
  }

  renderVibrationWarning(preview) {
    return `
      <span class="battle-card-vibration-warning" role="status">
        <strong>将触发：震感 +${preview.amount}</strong>
        ${preview.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}
      </span>
    `;
  }

  cardCanAttemptMentalRecovery(card) {
    if (card.key === "breathe" || card.key === "overtake" || card.key === "call") return true;
    if (card.key === "boya") return this.state.player.summer;
    return false;
  }

  vibrationPreviewForCard(card) {
    if (!this.isLegShake()) return { amount: 0, reasons: [] };
    const reasons = [];
    let amount = 0;
    const add = (value, label) => {
      if (value <= 0) return;
      amount += value;
      reasons.push(`原因：${label}`);
    };

    if (card.key === "retake") add(2, "打出重修");
    if (this.predictedExtraDrawCount(card) > 0) add(1, "额外抽牌");
    if (this.predictedMentalRecovery(card) > 0) add(1, "实际回复精神");

    return { amount, reasons };
  }

  predictedExtraDrawCount(card) {
    if (card.key === "reflect") return this.state.player.summer ? 3 : 2;
    if (card.key === "retreat") return 2;
    if (card.key === "retake") {
      const bonus = this.hasRelic("wrong_notebook") && !this.state.relicFlags.wrong_notebook ? 1 : 0;
      return this.state.hand.length - 1 + bonus;
    }
    if (card.key === "overtake" && this.hasRelic("lecture_album") && !this.state.turnFlags.lecture_album) return 1;
    return 0;
  }

  predictedMentalRecovery(card) {
    const mentalAfterCost = Math.max(0, this.state.player.mental - cardCost(card, this.state.player));
    const mentalRoom = Math.max(0, this.state.player.maxMental - mentalAfterCost);
    if (!mentalRoom) return 0;
    if (card.key === "breathe") return Math.min(2, mentalRoom);
    if (card.key === "boya" && this.state.player.summer) return Math.min(2, mentalRoom);
    if (card.key === "overtake") return Math.min(1, mentalRoom);
    if (card.key === "call") return Math.min(1, mentalRoom);
    return 0;
  }

  showPileOverlay(kind) {
    if (!this.pileOverlay || !this.pileOverlayTitle || !this.pileOverlayGrid) return;
    const cards = kind === "draw" ? [...this.state.drawPile].reverse() : [...this.state.discardPile];
    this.pileOverlayTitle.textContent = kind === "draw" ? "抽牌堆" : "弃牌堆";
    this.pileOverlayGrid.innerHTML = cards.length
      ? cards.map((card) => renderPileCard(card)).join("")
      : '<p class="pile-empty">这里还没有牌</p>';
    this.pileOverlay.hidden = false;
    requestAnimationFrame(() => this.pileOverlay.classList.add("is-visible"));
  }

  hidePileOverlay() {
    if (!this.pileOverlay) return;
    this.pileOverlay.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!this.pileOverlay.classList.contains("is-visible")) {
        this.pileOverlay.hidden = true;
      }
    }, 220);
  }

  promptDiscardChoice() {
    if (!this.state.hand.length) return Promise.resolve(null);
    this.busy = true;
    this.message.textContent = "选择 1 张手牌弃掉";
    this.discardChoiceMask.hidden = false;
    this.discardChoiceControls.hidden = false;
    if (this.discardChoiceConfirm) this.discardChoiceConfirm.disabled = true;
    this.root.classList.add("is-discarding");

    return new Promise((resolve) => {
      this.discardChoice = {
        selectedId: null,
        resolve,
      };
      this.renderHand();
    });
  }

  selectDiscardChoice(cardId) {
    if (!this.discardChoice || !cardId) return;
    this.discardChoice.selectedId = cardId;
    this.handHoverIndex = this.selectedDiscardIndex();
    if (this.discardChoiceConfirm) this.discardChoiceConfirm.disabled = false;
    this.hand.querySelectorAll(".battle-card").forEach((cardEl) => {
      cardEl.classList.toggle("is-discard-selected", cardEl.dataset.cardId === cardId);
    });
    this.layoutHand();
  }

  selectedDiscardIndex() {
    if (!this.discardChoice?.selectedId) return null;
    const index = this.state.hand.findIndex((card) => card.id === this.discardChoice.selectedId);
    return index >= 0 ? index : null;
  }

  confirmDiscardChoice() {
    if (!this.discardChoice?.selectedId) return;
    const { selectedId, resolve } = this.discardChoice;
    this.discardChoice = null;
    this.root.classList.remove("is-discarding");
    this.discardChoiceMask.hidden = true;
    this.discardChoiceControls.hidden = true;
    if (this.discardChoiceConfirm) this.discardChoiceConfirm.disabled = true;
    resolve(selectedId);
  }

  async discardChosenHandCard(cardId) {
    if (!cardId) return;
    const index = this.state.hand.findIndex((card) => card.id === cardId);
    if (index < 0) return;
    const [card] = this.state.hand.splice(index, 1);
    const cardEl = this.hand.querySelector(`[data-card-id="${cardId}"]`);
    if (cardEl) {
      cardEl.classList.add("is-playing");
      await animateCardFlight(cardEl, this.discardPile, "discard");
      if (cardEl.isConnected) cardEl.remove();
    }
    this.state.discardPile.push(card);
    this.state.player.discardedCardsThisTurn += 1;
    this.message.textContent = `弃掉 ${cardDef(card).name}`;
    if (cardDef(card).type === "attack") this.gainMental(1, { cardEffect: true });
    this.checkScanConditions();
    this.handHoverIndex = null;
    this.renderAll();
  }

  async resolveBossPreDiscard() {
    if (!this.isCoffinBoss() || this.state.boss.transformed || this.state.boss.transformPending) return;
    const enemy = this.firstAliveEnemy();
    const action = this.bossCurrentAction(enemy);
    this.pendingBossRetrieveIds = this.state.player.attacksPlayedThisTurn <= 0
      ? this.state.boss.coffin.map((card) => card.id)
      : [];
    if (action?.sealHandCard && !this.state.player.nullifyEnemyThisTurn) {
      await this.sealRandomHandCardToCoffin();
    } else if (action?.sealHandCard) {
      this.message.textContent = "暂挡下了理想封存";
    }
  }

  async resolveBossNoAttackRetrieve() {
    if (!this.isCoffinBoss() || this.state.boss.transformed || this.state.boss.transformPending) return;
    const allowedIds = this.pendingBossRetrieveIds || [];
    this.pendingBossRetrieveIds = [];
    if (this.state.player.attacksPlayedThisTurn > 0 || allowedIds.length <= 0) return;
    await this.promptCoffinRetrieve({ optional: true, title: "未攻击：从灵柩中取回 1 张牌", allowedIds });
  }

  async sealRandomHandCardToCoffin() {
    if (!this.isCoffinBoss() || !this.bossCoffin) return null;
    const candidates = this.state.hand.filter((card) => !cardDef(card).retain);
    if (!candidates.length) {
      this.message.textContent = "理想封存：没有可封存的非保留手牌";
      return null;
    }
    const card = candidates[Math.floor(Math.random() * candidates.length)];
    const cardEl = this.hand.querySelector(`[data-card-id="${card.id}"]`);
    this.state.hand = this.state.hand.filter((item) => item.id !== card.id);
    this.state.boss.coffin.push(card);
    this.message.textContent = `${cardDef(card).name} 被封存进灵柩`;
    if (cardEl) {
      await this.animateCardIntoCoffin(cardEl);
      if (cardEl.isConnected) cardEl.remove();
    }
    this.renderAll();
    return card;
  }

  async promptCoffinRetrieve({ optional = false, title = "灵柩", allowedIds = null } = {}) {
    if (!this.isCoffinBoss() || !this.state.boss.coffin.length || !this.coffinChoiceMask) {
      return null;
    }
    const cards = allowedIds?.length
      ? this.state.boss.coffin.filter((card) => allowedIds.includes(card.id))
      : this.state.boss.coffin;
    if (!cards.length) return null;
    const wasBusy = this.busy;
    this.busy = true;
    if (this.coffinChoiceHint) {
      this.coffinChoiceHint.textContent = optional ? `${title}，点击遮罩可跳过` : title;
    }
    return new Promise((resolve) => {
      this.coffinChoice = {
        allowedIds: cards.map((card) => card.id),
        optional,
        wasBusy,
        resolve,
      };
      this.root.classList.add("is-choosing-coffin");
      this.coffinChoiceMask.hidden = false;
      requestAnimationFrame(() => this.coffinChoiceMask.classList.add("is-visible"));
      this.renderAll();
    });
  }

  async chooseCoffinCard(event) {
    const button = event.target.closest("[data-coffin-card]");
    if (!button || !this.coffinChoice) return;
    const cardId = button.dataset.coffinCard;
    if (!this.coffinChoice.allowedIds.includes(cardId)) return;
    await this.finishCoffinChoice(cardId);
  }

  async skipCoffinChoice() {
    if (!this.coffinChoice?.optional) return;
    await this.finishCoffinChoice(null);
  }

  async finishCoffinChoice(cardId) {
    if (!this.coffinChoice) return;
    const choice = this.coffinChoice;
    this.coffinChoice = null;
    this.root.classList.remove("is-choosing-coffin");
    this.coffinChoiceMask?.classList.remove("is-visible");
    let card = null;
    try {
      if (cardId) card = await this.retrieveCoffinCard(cardId);
    } catch (error) {
      this.recoverBattleInteraction("灵柩取回中断", error);
    } finally {
      window.setTimeout(() => {
        if (!this.coffinChoiceMask?.classList.contains("is-visible")) {
          this.coffinChoiceMask.hidden = true;
        }
      }, 180);
      this.busy = choice.wasBusy;
      this.renderAll();
      choice.resolve(card);
    }
  }

  async retrieveCoffinCard(cardId = null) {
    if (!this.isCoffinBoss() || !this.state.boss.coffin.length) return null;
    const index = cardId
      ? this.state.boss.coffin.findIndex((card) => card.id === cardId)
      : 0;
    if (index < 0) return null;
    const [card] = this.state.boss.coffin.splice(index, 1);
    this.state.hand.push(card);
    this.noteCardEnteredNonDiscard();
    this.renderAll();
    const cardEl = this.hand.querySelector(`[data-card-id="${card.id}"]`);
    await this.showSystemNotice("你听见棺中传来微弱的回声。一张被封存的牌回到了你手中。", { duration: 1450 });
    if (cardEl) await this.animateCardFromCoffin(cardEl);
    this.message.textContent = `${cardDef(card).name} 从灵柩中回到手牌`;
    return card;
  }

  recoverBattleInteraction(label, error) {
    console.error(label, error);
    if (this.dragState) {
      try {
        this.detachDragListeners(this.dragState);
      } catch {
        // Ignore cleanup failures; this path is only for recovering interaction.
      }
      this.dragState = null;
    }
    this.root.classList.remove("is-attack-targeted", "is-skill-targeted");
    this.clearEnemyTargets();
    this.currentResolvingCard = null;
    this.currentSkillMultiplier = 1;
    this.state.player.attackDamagePenalty = 0;

    if (!this.discardChoice) {
      this.root.classList.remove("is-discarding");
      if (this.discardChoiceMask) this.discardChoiceMask.hidden = true;
      if (this.discardChoiceControls) this.discardChoiceControls.hidden = true;
      if (this.discardChoiceConfirm) this.discardChoiceConfirm.disabled = true;
    }
    if (!this.coffinChoice) {
      this.root.classList.remove("is-choosing-coffin");
      this.coffinChoiceMask?.classList.remove("is-visible");
      if (this.coffinChoiceMask) this.coffinChoiceMask.hidden = true;
    }

    if (!this.state.finished) {
      this.busy = false;
      this.message.textContent = `${label}，已恢复操作`;
      this.renderAll();
    }
  }

  async animateCardIntoCoffin(cardEl) {
    if (!cardEl || !this.bossCoffin) return;
    const clone = cardEl.cloneNode(true);
    const from = cardEl.getBoundingClientRect();
    const to = centerOf(this.bossCoffin);
    clone.classList.add("battle-card-fly", "fly-coffin");
    clone.style.left = `${from.left}px`;
    clone.style.top = `${from.top}px`;
    clone.style.width = `${from.width}px`;
    clone.style.height = `${from.height}px`;
    document.body.append(clone);
    await clone.animate(
      [
        { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)", opacity: 1, filter: "brightness(1)" },
        {
          transform: `translate3d(${to.x - from.left - from.width / 2}px, ${to.y - from.top - from.height / 2}px, 0) rotate(-18deg) scale(0.18)`,
          opacity: 0.08,
          filter: "brightness(0.35) saturate(1.8)",
        },
      ],
      smoothTiming(680),
    ).finished;
    clone.remove();
  }

  async animateCardFromCoffin(cardEl) {
    if (!cardEl || !this.bossCoffin) return;
    const from = centerOf(this.bossCoffin);
    const to = centerOf(cardEl);
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const animation = cardEl.animate(
      [
        { transform: `translate3d(${dx}px, ${dy}px, 0) rotate(18deg) scale(0.22)`, opacity: 0 },
        { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)", opacity: 1 },
      ],
      smoothTiming(520),
    );
    await animation.finished;
    animation.cancel();
  }

  async animateRetainedCards(previousRects) {
    if (!previousRects.size) return;
    await nextFrame();
    const animations = [...previousRects.entries()].map(([cardId, previousRect]) => {
      const cardEl = this.hand.querySelector(`[data-card-id="${cardId}"]`);
      if (!cardEl) return Promise.resolve();
      const currentRect = cardEl.getBoundingClientRect();
      const dx = previousRect.left - currentRect.left;
      const dy = previousRect.top - currentRect.top;
      return animateRetainedCard(cardEl, dx, dy);
    });
    await Promise.all(animations);
  }

  layoutHand() {
    const cards = (this.handCards || [...this.hand.querySelectorAll(".battle-card")])
      .filter((card) => card.parentElement === this.hand);
    const count = cards.length;
    const middle = (count - 1) / 2;
    const baseGap = count > 1 ? Math.min(124, 720 / (count - 1)) : 0;
    const hoverIndex = this.handHoverIndex;

    cards.forEach((card, index) => {
      const hovered = hoverIndex === index && !card.disabled;
      const sideShift =
        hoverIndex === null
          ? 0
          : index < hoverIndex
            ? -40
            : index > hoverIndex
              ? 40
              : 0;
      const x = (index - middle) * baseGap + sideShift;
      const rotation = hovered ? 0 : (index - middle) * 5.2;
      const y = hovered ? -72 : Math.abs(index - middle) * 5;
      const tooltipLeft = index > middle || x > 120;
      const hasMechanismWarning = card.classList.contains("has-vibration-warning")
        || card.querySelector(".battle-card-awake-warning");
      const layoutKey = [
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        Math.round(rotation * 10) / 10,
        hovered ? 1 : 0,
        index,
      ].join(":");

      if (card.dataset.layoutKey !== layoutKey) {
        card.dataset.layoutKey = layoutKey;
        card.style.setProperty("--hand-x", `${x}px`);
        card.style.setProperty("--hand-y", `${y}px`);
        card.style.setProperty("--hand-rot", `${rotation}deg`);
        card.style.zIndex = hovered ? "30" : String(10 + index);
        card.classList.toggle("is-hovered", hovered);
      }
      card.classList.toggle("is-tooltip-left", tooltipLeft);
      card.classList.toggle("has-mechanism-warning", Boolean(hasMechanismWarning));
      if (!hovered) {
        card.style.setProperty("--card-mx", "50%");
        card.style.setProperty("--card-my", "28%");
        card.style.setProperty("--card-rx", "0deg");
        card.style.setProperty("--card-ry", "0deg");
      }
    });
  }

  async drawCards(count, { extra = false } = {}) {
    if (this.state.finished) return;
    this.busy = true;
    try {
      const drawnCards = [];
      for (let i = 0; i < count; i += 1) {
        if (this.state.drawPile.length === 0) {
          this.shuffleDiscardIntoDraw();
        }
        const card = this.state.drawPile.pop();
        if (!card) break;

        this.state.hand.push(card);
        drawnCards.push(card);
      }

      if (drawnCards.length) {
        this.renderAll();
        await Promise.all(
          drawnCards.map((card, index) => {
            const cardEl = this.hand.querySelector(`[data-card-id="${card.id}"]`);
            return animateFromPile(this.drawPile, cardEl, index * 38);
          }),
        );
        if (extra) this.changeVibration(1, "额外抽牌");
      }
    } catch (error) {
      this.recoverBattleInteraction("抽牌动画中断", error);
    } finally {
      if (!this.state.finished && !this.coffinChoice && !this.discardChoice) {
        this.busy = false;
      }
    }
  }

  async drawOpeningHand(count = 5) {
    if (!this.isEarlyMorning() || this.state.turnNumber !== 1) {
      await this.drawCards(count);
      return;
    }

    this.busy = true;
    try {
      const drawnCards = [];
      ["defense", "attack", "skill"].forEach((type) => {
        const card = this.takeCardFromDrawPileByType(type);
        if (card) drawnCards.push(card);
      });

      while (drawnCards.length < count) {
        if (this.state.drawPile.length === 0) this.shuffleDiscardIntoDraw();
        const card = this.state.drawPile.pop();
        if (!card) break;
        drawnCards.push(card);
      }

      this.state.hand.push(...drawnCards);
      if (drawnCards.length) {
        this.renderAll();
        await Promise.all(
          drawnCards.map((card, index) => {
            const cardEl = this.hand.querySelector(`[data-card-id="${card.id}"]`);
            return animateFromPile(this.drawPile, cardEl, index * 38);
          }),
        );
      }
    } catch (error) {
      this.recoverBattleInteraction("开局抽牌中断", error);
    } finally {
      if (!this.state.finished && !this.coffinChoice && !this.discardChoice) {
        this.busy = false;
      }
    }
  }

  takeCardFromDrawPileByType(type) {
    for (let index = this.state.drawPile.length - 1; index >= 0; index -= 1) {
      const card = this.state.drawPile[index];
      if (cardDef(card).type !== type) continue;
      const [picked] = this.state.drawPile.splice(index, 1);
      return picked;
    }
    return null;
  }

  async playCard(cardId, sourceEl = null, targetEnemyId = null) {
    const card = this.state.hand.find((item) => item.id === cardId);
    const cardEl = sourceEl || this.hand.querySelector(`[data-card-id="${cardId}"]`);
    const reason = card ? this.playableReason(card) : "";
    if (!card || !cardEl || reason || this.state.finished) return;

    this.busy = true;
    try {
      const def = cardDef(card);
      cardEl.classList.remove("is-dragging");
      cardEl.classList.add("is-playing");
      const playedCost = cardCost(card, this.state.player);
      const mentalBeforeCost = this.state.player.mental;
      this.state.player.mental -= playedCost;
      this.recordBossTwistSpend(card, playedCost, mentalBeforeCost);
      this.state.player.cardsPlayedThisTurn += 1;
      if (playedCost >= 1) this.state.player.costlyCardsPlayedThisTurn += 1;
      this.applyDormNoiseCardPenalty();
      if (playedCost >= 2 && this.hasRelic("unsubmitted_application")) {
        this.flashRelic("unsubmitted_application");
        this.gainPlayerStrength(1);
        this.message.textContent = "未提交的申请：获得 1 层力量";
      }
      this.checkScanConditions();
      if (def.type === "skill") this.beforeSkillCard(card);

      this.state.hand = this.state.hand.filter((item) => item.id !== cardId);

      const willExhaustOrVanish = Boolean(def.exhaust || def.vanish);

      if (def.type === "attack") {
        this.beforeAttackCard(card, mentalBeforeCost);
        const targetEnemy = this.enemyById(targetEnemyId) || this.firstAliveEnemy();
        const targetEnemyCard = this.enemyCardById(targetEnemy?.id) || this.enemyCard;
        await animateCardFlight(cardEl, targetEnemyCard, "attack");
        this.currentResolvingCard = card;
        this.resolveAttackCard(card, targetEnemy?.id);
        this.currentResolvingCard = null;
        this.state.player.attackDamagePenalty = 0;
        await this.animateEnemy("damaged", targetEnemyCard);
      } else {
        const targetEnemy = this.requiresEnemyTarget(card) ? this.enemyById(targetEnemyId) || this.firstAliveEnemy() : null;
        const targetEnemyCard = targetEnemy ? this.enemyCardById(targetEnemy.id) || this.enemyCard : null;
        if (targetEnemyCard) {
          await animateCardFlight(cardEl, targetEnemyCard, "skill");
        } else if (willExhaustOrVanish) {
          await animateSkillExhaust(cardEl);
        } else {
          await animateSkillPlay(cardEl, this.discardPile);
        }
        this.currentResolvingCard = card;
        await this.resolveSkillCard(card, targetEnemy?.id || null);
        this.currentResolvingCard = null;
        this.currentSkillMultiplier = 1;
      }

      if (cardEl.isConnected) cardEl.remove();
      this.movePlayedCard(card);
      this.handHoverIndex = null;
      if (this.pendingDormDeathMessage) {
        this.message.textContent = this.pendingDormDeathMessage;
        this.pendingDormDeathMessage = "";
      }
      this.renderAll();
      if (!this.firstAliveEnemy()) {
        await this.finishVictory();
        return;
      }
    } catch (error) {
      this.recoverBattleInteraction("出牌结算中断", error);
    } finally {
      this.currentResolvingCard = null;
      this.currentSkillMultiplier = 1;
      this.state.player.attackDamagePenalty = 0;
      if (!this.state.finished && !this.coffinChoice && !this.discardChoice) {
        this.busy = false;
      }
    }
  }

  async endTurn() {
    if (this.busy || this.state.finished) return;
    this.busy = true;
    try {
      this.message.textContent = "回合结束";
      this.checkScanConditions({ includeEnd: true });
      await this.resolveBossPreDiscard();

      const cards = [...this.state.hand];
      const retained = [];
      const discardEntries = cards.map((card) => ({
        card,
        element: this.hand.querySelector(`[data-card-id="${card.id}"]`),
      }));
      const retainedRects = new Map();
      const vanishedIds = new Set();
      const vanishAnimations = [];

      for (const { card, element } of discardEntries) {
        if (this.resolveCardEndOfTurn(card)) {
          vanishedIds.add(card.id);
          if (element) {
            element.classList.add("is-playing");
            vanishAnimations.push(animateCardShatter(element));
          }
          continue;
        }

        if (cardDef(card).retain) {
          retained.push(card);
          if (element) retainedRects.set(card.id, element.getBoundingClientRect());
          continue;
        }

        if (element) {
          element.classList.add("is-playing");
        }
        this.state.discardPile.push(card);
      }

      const discardAnimations = discardEntries
        .filter(({ card, element }) => !vanishedIds.has(card.id) && !cardDef(card).retain && element)
        .map(({ element }) => animateCardFlight(element, this.discardPile, "discard"));

      this.state.hand = retained;
      await Promise.all([...discardAnimations, ...vanishAnimations]);

      this.clearTemporaryCostModifiers();
      this.handHoverIndex = null;
      this.renderAll();
      await this.animateRetainedCards(retainedRects);
      await this.resolveBossNoAttackRetrieve();
      await wait(180);
      if (this.hasRelic("borrowed_umbrella") && this.state.player.attacksPlayedThisTurn === 0) {
        this.flashRelic("borrowed_umbrella");
        this.state.player.block += 6;
      }
      if (this.hasRelic("empty_classroom") && this.state.player.mental > 8) {
        this.flashRelic("empty_classroom");
        this.gainHp(3);
      }
      await this.resolveCheckinEndOfTurn();
      if (!this.firstAliveEnemy()) {
        await this.finishVictory();
        return;
      }
      await this.resolveEarlyMorningAwake();
      await this.resolveLegShakeVibration();
      this.resolveBossEndTurnStatuses();
      if (this.state.player.hp <= 0) {
        await this.finishDefeat();
        return;
      }
      this.tickPlayerTurnStatuses();
      this.renderAll();
      await wait(180);
      this.state.player.lastTurnCardsPlayed = this.state.player.cardsPlayedThisTurn;
      await this.enemyAct();
      this.renderAll();
      if (this.state.player.hp <= 0) {
        await this.finishDefeat();
        return;
      }
      this.startPlayerTurn();
      this.message.textContent = "你的回合";
      await wait(180);
      this.busy = false;
      const drawBonus = this.state.player.nextDrawBonus || 0;
      const drawPenalty = (this.state.player.nextDrawPenalty || 0) + (this.state.player.distracted || 0);
      const drawCount = Math.max(0, 5 + drawBonus - drawPenalty);
      this.state.player.nextDrawPenalty = 0;
      this.state.player.distracted = 0;
      await this.drawCards(drawCount);
    } catch (error) {
      this.recoverBattleInteraction("回合结束中断", error);
    } finally {
      if (!this.state.finished && !this.coffinChoice && !this.discardChoice) {
        this.busy = false;
      }
    }
  }

  applyDormNoiseCardPenalty() {
    if (!this.isDorm() || !this.dormEnemyAlive("noise")) return;
    if (this.state.player.cardsPlayedThisTurn >= 5) {
      this.loseMental(1);
      this.message.textContent = `噪声：连续出牌失去 1 精神`;
    }
  }

  damageEnemy(amount = 0, enemyId = null) {
    const enemy = this.enemyById(enemyId) || this.firstAliveEnemy();
    if (!enemy) return;
    const incoming = this.applyDormClutterRoadblock(amount, enemy);
    const blockBefore = enemy.block || 0;
    const blocked = Math.min(blockBefore, incoming);
    const damage = Math.max(0, incoming - blocked);
    enemy.block = Math.max(0, (enemy.block || 0) - blocked);
    enemy.hp = Math.max(0, enemy.hp - damage);
    if (blockBefore > 0 && enemy.block === 0) this.onEnemyBlockBroken(enemy);
    if (damage > 0 && cardDef(this.currentResolvingCard || { key: "" })?.type === "attack") {
      this.state.player.attackDamageThisTurn += damage;
      if (this.isCoffinBoss() && this.state.player.countdown > 0) {
        this.state.player.countdown = Math.max(0, this.state.player.countdown - 1);
      }
      this.checkScanConditions();
    }
    this.message.textContent = blocked ? `破除 ${blocked} 防御，造成 ${damage} 伤害` : `造成 ${damage} 伤害`;
    floatText(this.enemyCardById(enemy.id) || this.enemyCard, damage > 0 ? `-${damage}` : "防御", "enemy");
    this.checkBossPhaseThreshold(enemy);
    this.resolveEnemyDeath(enemy);
  }

  damageEnemyUnblockable(amount = 0, enemyId = null) {
    const enemy = this.enemyById(enemyId) || this.firstAliveEnemy();
    if (!enemy) return;
    enemy.hp = Math.max(0, enemy.hp - amount);
    this.message.textContent = `造成 ${amount} 无法被防御的伤害`;
    floatText(this.enemyCardById(enemy.id) || this.enemyCard, `-${amount}`, "enemy");
    this.checkBossPhaseThreshold(enemy);
    this.resolveEnemyDeath(enemy);
  }

  checkBossPhaseThreshold(enemy) {
    if (!this.isCoffinBoss() || !enemy || enemy.hp <= 0) return;
    if (this.state.boss.phase !== 1 || this.state.boss.transformPending || this.state.boss.transformed) return;
    if (enemy.hp < enemy.maxHp / 2) {
      this.state.boss.phase = 2;
      this.state.boss.transformPending = true;
      this.message.textContent = "灵柩开始回响，Boss 的下一次行动将变为回响转化";
      void this.showActionMessage(enemy.id, "你以为封存的东西会安静待在那里吗？");
    }
  }

  applyDormClutterRoadblock(amount, enemy) {
    if (!this.isDorm() || cardDef(this.currentResolvingCard || { key: "" })?.type !== "attack") return amount;
    if (enemy?.id === "clutter") return amount;
    if (!this.dormEnemyAlive("clutter")) return amount;
    return Math.max(0, amount - 2);
  }

  onEnemyBlockBroken(enemy) {
    if (!this.isDorm() || enemy.id !== "clutter") return;
  }

  gainBlock(amount = 0) {
    if (!amount) return;
    if (this.isCoffinBoss() && this.state.player.breachNextBlock > 0) {
      this.state.player.breachNextBlock = 0;
      this.message.textContent = "破绽：本次获得防御变为 0";
      this.renderStats();
      return;
    }
    let total = amount + Math.max(0, this.state.player.dexterity || 0);
    if (this.hasRelic("folding_chair") && !this.state.turnFlags?.folding_chair) {
      this.state.turnFlags.folding_chair = true;
      this.flashRelic("folding_chair");
      total += 6;
    }
    this.state.player.block += total;
    this.state.player.blockGainedThisTurn += total;
    if (this.isCoffinBoss() && this.state.player.stingNextBlock > 0 && this.state.player.stingTriggers < 2) {
      this.state.player.stingTriggers += 1;
      this.loseMental(1);
      if (this.state.player.stingTriggers >= 2) this.state.player.stingNextBlock = 0;
    }
    this.message.textContent = `获得 ${total} 防御`;
    this.checkScanConditions();
  }

  gainMental(amount = 0, { cardEffect = false } = {}) {
    if (!amount) return;
    const originalAmount = amount;
    if (this.isDorm() && !this.state.finished) {
      let penalty = this.state.player.mentalRecoveryPenaltyThisTurn || 0;
      const smellPenalty = !this.state.dorm.firstMentalRecoveryReduced && this.dormEnemyAlive("smell") ? 1 : 0;
      penalty += smellPenalty;
      if (smellPenalty > 0) this.state.dorm.firstMentalRecoveryReduced = true;
      if (penalty > 0) amount = Math.max(0, amount - penalty);
      if (amount <= 0) {
        this.message.textContent = `精神回复被压低：${originalAmount} -> 0`;
        return;
      }
    }
    const before = this.state.player.mental;
    let hollowAbsorbed = 0;
    if (this.isCoffinBoss() && this.state.player.hollow > 0) {
      const absorbed = Math.min(amount, this.state.player.hollow);
      hollowAbsorbed = absorbed;
      amount -= absorbed;
      this.state.player.hollow -= absorbed;
      this.healBoss(10 * absorbed);
      if (amount <= 0) {
        this.message.textContent = "你试图恢复的部分，成了它的养分。";
        void this.showSystemNotice("你试图恢复的部分，成了它的养分。");
        this.renderStats();
        return;
      }
    }
    this.state.player.mental = Math.min(this.state.player.maxMental, before + amount);
    const actual = this.state.player.mental - before;
    this.message.textContent = hollowAbsorbed > 0
      ? "你试图恢复的部分，成了它的养分。"
      : `回复 ${actual} 精神`;
    if (hollowAbsorbed > 0) void this.showSystemNotice("你试图恢复的部分，成了它的养分。");
    if (actual > 0) {
      if (this.isDorm() && !this.state.dorm.firstMentalRecoveryReduced) {
        this.state.dorm.firstMentalRecoveryReduced = true;
      }
      this.state.player.mentalRecoveriesThisTurn += 1;
      this.changeVibration(1, "实际回复精神");
      if (this.isCoffinBoss() && this.state.player.overdraft > 0) {
        this.state.player.overdraft = Math.max(0, this.state.player.overdraft - 1);
      }
      this.applyRelicEvent("mentalRecovered", { source: cardEffect ? this.currentResolvingCard?.key || "card" : "" });
      this.checkScanConditions();
    }
  }

  healBossByPercent(percentValue = 0) {
    const enemy = this.firstAliveEnemy();
    if (!enemy || percentValue <= 0) return;
    const heal = Math.max(1, Math.round(enemy.maxHp * (percentValue / 100)));
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
    floatText(this.enemyCardById(enemy.id) || this.enemyCard, `+${heal}`, "enemy");
  }

  healBoss(amount = 0) {
    const enemy = this.firstAliveEnemy();
    if (!enemy || amount <= 0) return;
    const heal = Math.min(amount, enemy.maxHp - enemy.hp);
    if (heal <= 0) return;
    enemy.hp += heal;
    floatText(this.enemyCardById(enemy.id) || this.enemyCard, `+${heal}`, "enemy");
  }

  gainPlayerStrength(amount = 1) {
    if (!amount) return;
    if (this.isCoffinBoss() && this.state.player.rebuttalNextStrength > 0) {
      this.state.player.rebuttalNextStrength = 0;
      this.takePlayerDamageDirect(6, "反驳：力量被取消");
      return;
    }
    this.state.player.strength += amount;
  }

  gainHp(amount = 0) {
    if (!amount) return;
    const before = this.state.player.hp;
    this.state.player.hp = Math.min(this.state.player.maxHp, before + amount);
    this.message.textContent = `回复 ${this.state.player.hp - before} 生命`;
    if (this.state.player.hp > before) {
      floatText(this.hand, `+${this.state.player.hp - before}`, "player");
    }
  }

  resolveAttackCard(card, enemyId = null) {
    const enemy = this.enemyById(enemyId) || this.firstAliveEnemy();
    const damage = effectiveAttackDamage(card, this.playerForAttack(card), enemy);

    if (card.key === "talk") {
      this.damageEnemy(damage, enemyId);
      return;
    }

    if (card.key === "3.92") {
      this.damageEnemy(damage, enemyId);
      return;
    }

    if (card.key === "persuade") {
      this.damageEnemy(damage, enemyId);
      this.gainPlayerStrength(1);
      return;
    }

    if (card.key === "one_tenth") {
      this.damageEnemy(damage, enemyId);
      this.applyGaze(enemyId, 2);
      this.addCardsToPile("drawPile", "evidence", 2);
    }
  }

  async resolveSkillCard(card, targetEnemyId = null) {
    if (card.key === "temporary") {
      this.state.player.nullifyEnemyThisTurn = true;
      this.message.textContent = "本回合敌人影响无效";
      return;
    }

    if (card.key === "evidence") {
      const stacks = this.scaledSkillAmount(this.state.player.mental > 6 ? 3 : 2);
      if (stacks > 0) this.applyGaze(targetEnemyId, stacks);
      return;
    }

    if (card.key === "insight") {
      const count = this.scaledSkillAmount(this.state.player.mental >= 8 ? 3 : 2);
      for (let index = 0; index < count; index += 1) {
        const roll = Math.floor(Math.random() * 3);
        if (roll === 0) this.gainPlayerStrength(1);
        if (roll === 1) this.state.player.dexterity += 1;
        if (roll === 2) this.state.player.nextDrawBonus += 1;
      }
      this.message.textContent = `获得 ${count} 层随机增益`;
      return;
    }

    if (card.key === "breathe") {
      this.gainMental(this.scaledSkillAmount(2), { cardEffect: true });
      this.state.player.nextDrawPenalty += 1;
      return;
    }

    if (card.key === "boya") {
      this.gainBlock(this.scaledSkillAmount(6));
      if (this.state.player.summer) {
        this.gainMental(this.scaledSkillAmount(2), { cardEffect: true });
      }
      return;
    }

    if (card.key === "reflect") {
      const count = this.scaledSkillAmount(this.state.player.summer ? 3 : 2);
      this.message.textContent = `抽 ${count} 张牌`;
      await this.drawCards(count, { extra: true });
      return;
    }

    if (card.key === "retreat") {
      await this.drawCards(this.scaledSkillAmount(2), { extra: true });
      const discardCardId = await this.promptDiscardChoice();
      await this.discardChosenHandCard(discardCardId);
      return;
    }

    if (card.key === "retake") {
      const bonus = this.hasRelic("wrong_notebook") && !this.state.relicFlags.wrong_notebook ? 1 : 0;
      if (bonus) {
        this.state.relicFlags.wrong_notebook = true;
        this.flashRelic("wrong_notebook");
      }
      const count = this.scaledSkillAmount(this.state.hand.length + bonus);
      this.state.player.discardedCardsThisTurn += this.state.hand.length;
      this.state.discardPile.push(...this.state.hand);
      this.state.hand = [];
      this.renderAll();
      this.checkScanConditions();
      await this.drawCards(count, { extra: true });
      return;
    }

    if (card.key === "torment") {
      this.gainBlock(11);
      return;
    }

    if (card.key === "rest") {
      this.gainBlock(this.state.player.summer ? 12 : 6);
      return;
    }

    if (card.key === "overtake") {
      this.gainMental(this.scaledSkillAmount(1), { cardEffect: true });
      this.state.player.summer = true;
      this.state.player.attackLocked = true;
      await this.enterSummer();
      return;
    }

    if (card.key === "last_stand") {
      const lost = this.state.player.mental;
      this.loseMental(lost);
      this.gainPlayerStrength(lost);
      this.message.textContent = `破釜沉舟：失去 ${lost} 精神，获得 ${lost} 层力量`;
      return;
    }

    if (card.key === "tower_shadow") {
      if (this.isCoffinBoss() && this.state.boss.coffin.length) {
        await this.promptCoffinRetrieve({ title: "塔影：从灵柩中取回 1 张牌" });
      } else {
        this.gainBlock(12);
        this.message.textContent = "塔影：灵柩为空，获得 12 防御";
      }
      return;
    }

    if (card.key === "toxin") {
      this.state.player.hp = Math.max(0, this.state.player.hp - 2);
      this.flashPlayerDamage();
      return;
    }

    if (card.key === "call") {
      if (this.isCoffinBoss()) {
        if (this.state.boss.transformed) {
          this.gainMental(this.scaledSkillAmount(1), { cardEffect: true });
        } else if (this.state.boss.coffin.length) {
          await this.promptCoffinRetrieve({ title: "呼唤：从灵柩中取回 1 张牌" });
        } else {
          this.message.textContent = "呼唤：灵柩里没有回应";
        }
      } else {
        this.gainMental(this.scaledSkillAmount(1), { cardEffect: true });
      }
    }
  }

  playableReason(card) {
    const def = cardDef(card);
    if (def.unplayable) return "无法打出";
    if (this.state.player.mental < cardCost(card, this.state.player)) return "精神不足";
    if (def.type === "attack" && this.state.player.attackLocked) return "不能攻击";
    if (card.key === "3.92" && this.state.player.mental >= 5) return "精神需低于 5";
    return "";
  }

  isSpecialEffectActive(card) {
    const { player } = this.state;
    if (card.key === "3.92") return player.mental < 5;
    if (card.key === "talk") return player.mental >= 6;
    if (card.key === "persuade") return true;
    if (card.key === "temporary") return cardCost(card, player) < cardDef(card).cost;
    if (card.key === "reflect" || card.key === "rest") return player.summer;
    if (card.key === "boya") return player.summer;
    return false;
  }

  isBossTwistRecorded(card) {
    return this.isCoffinBoss() && Boolean(this.state.boss.twistRecords?.[card.key]);
  }

  bossTwistDefs() {
    return {
      temporary: {
        label: "扭曲（暂）：破绽",
        message: "解构一切，失去一切",
        apply: () => {
          this.state.player.breachNextBlock = 1;
        },
      },
      one_tenth: {
        label: "扭曲（1/10）：倒数",
        message: "你的理想同样不值一提。",
        apply: () => {
          this.state.player.countdown += 1;
        },
      },
      torment: {
        label: "扭曲（煎熬）：刺痛",
        message: "你的身体先于灵魂崩溃。",
        apply: () => {
          this.state.player.stingNextBlock = 1;
          this.state.player.stingTriggers = 0;
        },
      },
      persuade: {
        label: "扭曲（好言相劝）：反驳",
        message: "说服不了理想，就会被理想说服。",
        apply: () => {
          this.state.player.rebuttalNextStrength = 1;
        },
      },
      last_stand: {
        label: "扭曲（破釜沉舟）：透支",
        message: "你燃尽的东西，会回来索取代价。",
        apply: () => {
          this.state.player.overdraft += 1;
        },
      },
    };
  }

  recordBossTwistSpend(card, playedCost = 0, mentalBeforeCost = this.state.player.mental) {
    if (!this.isCoffinBoss()) return;
    const eligible = new Set(["temporary", "one_tenth", "torment", "persuade", "last_stand"]);
    if (!eligible.has(card.key)) return;
    const value = card.key === "last_stand" ? mentalBeforeCost : playedCost;
    if (value <= 0) return;
    const current = this.state.boss.twistRecords[card.key] || 0;
    this.state.boss.twistRecords[card.key] = Math.max(current, value);
  }

  nextBossTwist() {
    if (!this.isCoffinBoss()) return null;
    const defs = this.bossTwistDefs();
    const next = Object.entries(this.state.boss.twistRecords || {})
      .filter(([key, value]) => defs[key] && value > 0)
      .sort((a, b) => b[1] - a[1])[0];
    if (!next) return null;
    const [key, value] = next;
    return { key, value, ...defs[key] };
  }

  makeBattleCard(key) {
    const card = makeCard(key, this.state.nextCardIndex);
    this.state.nextCardIndex += 1;
    return card;
  }

  addCardsToPile(pileName, key, count = 1) {
    const addedCards = [];
    for (let index = 0; index < count; index += 1) {
      const card = this.makeBattleCard(key);
      if (pileName === "drawPile") {
        const insertAt = Math.floor(Math.random() * (this.state.drawPile.length + 1));
        this.state.drawPile.splice(insertAt, 0, card);
      } else {
        this.state[pileName].push(card);
      }
      addedCards.push(card);
      if (pileName !== "discardPile") this.noteCardEnteredNonDiscard();
    }
    this.renderPiles();
    this.animateCardsAddedToPile(addedCards, pileName);
  }

  async addCardToHand(key, { label = "" } = {}) {
    const card = this.makeBattleCard(key);
    this.state.hand.push(card);
    this.noteCardEnteredNonDiscard();
    if (label) this.message.textContent = label;
    if (!this.hand || this.state.finished) {
      this.renderHand();
      return card;
    }
    const cardEl = this.createAnimationCard(card);
    await animateGeneratedCardToPile(cardEl, this.hand, 0, {
      index: 0,
      total: 1,
      holdMs: 720,
    });
    this.renderHand();
    return card;
  }

  animateCardsAddedToPile(cards, pileName) {
    const targetEl = pileName === "drawPile" ? this.drawPile : pileName === "discardPile" ? this.discardPile : null;
    if (!targetEl || !cards.length || this.state.finished) return;
    cards.forEach((card, index) => {
      const cardEl = this.createAnimationCard(card);
      void animateGeneratedCardToPile(cardEl, targetEl, index * 70, {
        index,
        total: cards.length,
      });
    });
  }

  createAnimationCard(card) {
    const def = cardDef(card);
    const cardEl = document.createElement("article");
    cardEl.className = `battle-card pile-card-preview ${def.type}${hasSummerText(def) ? " has-summer" : ""}`;
    cardEl.innerHTML = renderBattleCardInner(card, { player: this.state.player, showCardRefs: false });
    return cardEl;
  }

  noteCardEnteredNonDiscard() {
    if (!this.hasRelic("lost_found_slip") || this.state.relicFlags.lost_found_slip) return;
    this.state.relicFlags.lost_found_slip = true;
    this.flashRelic("lost_found_slip");
    this.gainMental(1);
  }

  movePlayedCard(card) {
    const def = cardDef(card);
    if (def.exhaust || def.vanish) {
      this.state.exhaustedPile.push(card);
      return;
    }
    this.state.discardPile.push(card);
  }

  isEndTurnVanishing(card) {
    return card.key === "drowsiness" || card.key === "anxiety" || card.key === "toxin" || card.key === "lag";
  }

  resolveCardEndOfTurn(card) {
    if (card.key === "anxiety") {
      this.loseMental(1);
      this.state.exhaustedPile.push(card);
      return true;
    }
    if (card.key === "drowsiness") {
      this.state.exhaustedPile.push(card);
      return true;
    }
    if (card.key === "lag") {
      if (this.isCheckin() && !this.state.player.checkinSuccess) this.loseMental(1);
      this.state.exhaustedPile.push(card);
      return true;
    }
    if (card.key === "todo") {
      if (this.state.player.summer) {
        this.gainMental(1, { cardEffect: true });
      } else {
        this.loseMental(1);
      }
      this.state.exhaustedPile.push(card);
      return true;
    }
    if (card.key === "toxin") {
      this.state.player.hp = Math.max(0, this.state.player.hp - 6);
      this.flashPlayerDamage();
      this.state.exhaustedPile.push(card);
      return true;
    }
    return false;
  }

  beforeAttackCard(card, mentalBeforeCost = this.state.player.mental) {
    const { player } = this.state;
    player.attacksPlayedThisTurn += 1;
    this.checkScanConditions();
    if (card.key === "3.92" && this.hasRelic("gpa_calculator") && !this.state.relicFlags.gpa_calculator) {
      this.state.relicFlags.gpa_calculator = true;
      this.flashRelic("gpa_calculator");
      this.gainPlayerStrength(1);
      this.message.textContent = "绩点计算器：获得 1 层力量";
    }
    if (player.late > 0 && player.attacksPlayedThisTurn >= 2) {
      this.loseMental(1);
    }
    player.attackDamagePenalty = this.pendingAttackPenalty(card);
    if (player.attackDamagePenalty > 0) {
      this.consumeDrowsiness();
    }
  }

  beforeSkillCard(card) {
    const { player } = this.state;
    player.skillsPlayedThisTurn += 1;
    this.currentSkillMultiplier = 1;
    if (player.skillHalfThisTurn && !this.state.turnFlags.skillHalfUsed) {
      this.state.turnFlags.skillHalfUsed = true;
      this.currentSkillMultiplier = 0.5;
      this.message.textContent = "循环播放：这张技能牌效果减半";
    }
    this.applyRelicEvent("skillPlayed", { card });
    if (card.key === "retake") {
      this.changeVibration(2, "打出重修");
    }
  }

  scaledSkillAmount(amount) {
    if ((this.currentSkillMultiplier || 1) < 1) return Math.floor(amount * this.currentSkillMultiplier);
    return amount;
  }

  async enterSummer() {
    if (this.hasRelic("boya_shadow") && !this.state.relicFlags.boya_shadow) {
      this.state.relicFlags.boya_shadow = true;
      this.flashRelic("boya_shadow");
      this.gainMental(2);
      this.gainBlock(8);
    }
    if (!this.hasRelic("lecture_album") || this.state.turnFlags.lecture_album) return;
    this.state.turnFlags.lecture_album = true;
    this.flashRelic("lecture_album");
    this.gainBlock(6);
    await this.drawCards(1, { extra: true });
  }

  playerForAttack(card) {
    return {
      ...this.state.player,
      attackDamagePenalty: this.state.player.attackDamagePenalty || this.pendingAttackPenalty(card),
      gpaCalculatorBonus: card.key === "3.92" && this.hasRelic("gpa_calculator"),
    };
  }

  pendingAttackPenalty(card) {
    if (cardDef(card).type !== "attack") return 0;
    return this.state.hand.some((item) => item.key === "drowsiness") ? 4 : 0;
  }

  consumeDrowsiness() {
    const index = this.state.hand.findIndex((item) => item.key === "drowsiness");
    if (index < 0) return;
    const [card] = this.state.hand.splice(index, 1);
    const cardEl = this.hand.querySelector(`[data-card-id="${card.id}"]`);
    if (cardEl) void animateCardShatter(cardEl);
    this.state.exhaustedPile.push(card);
  }

  loseMental(amount = 0) {
    if (!amount) return;
    if (this.hasRelic("dorm_earplug") && !this.state.relicFlags.dorm_earplug) {
      this.state.relicFlags.dorm_earplug = true;
      this.flashRelic("dorm_earplug");
      this.gainBlock(6);
      this.message.textContent = "宿舍耳塞：抵消精神损失，获得 6 防御";
      return;
    }
    const before = this.state.player.mental;
    this.state.player.mental = Math.max(0, this.state.player.mental - amount);
    this.message.textContent = `失去 ${amount} 精神`;
    if (before >= 5 && this.state.player.mental < 5) {
      this.applyRelicEvent("mentalBelowFive");
    }
  }

  applyGaze(enemyId = null, stacks = 1) {
    const enemy = this.enemyById(enemyId) || this.firstAliveEnemy();
    if (!enemy) return;
    enemy.gaze = (enemy.gaze || 0) + stacks;
    if (this.hasRelic("auto_checkin_script")) {
      this.state.relicFlags.auto_checkin_script_gaze = (this.state.relicFlags.auto_checkin_script_gaze || 0) + stacks;
      while (this.state.relicFlags.auto_checkin_script_gaze >= 3) {
        this.state.relicFlags.auto_checkin_script_gaze -= 3;
        this.flashRelic("auto_checkin_script");
        this.gainMental(1);
      }
    }
    if (enemy.gaze >= 10) {
      enemy.gaze = 0;
      this.damageEnemyUnblockable(50, enemy.id);
    } else {
      this.message.textContent = `施加 ${stacks} 层注视`;
    }
  }

  resolveEnemyDeath(enemy) {
    if (!this.isDorm() || !enemy || enemy.hp > 0 || enemy.deathResolved) return;
    enemy.deathResolved = true;
    this.state.dorm.nextEnemyDamagePenalty = 3;
    this.gainMental(1);
    this.pendingDormDeathMessage = [
      "一个问题被暂时解决了。\n宿舍短暂地松动了一下。",
      enemy.deathMessage || `${enemy.name} 倒下了`,
    ].filter(Boolean).join("\n\n");
    this.message.textContent = this.pendingDormDeathMessage;
  }

  addDormEnvironment(key, amount = 1) {
    if (!this.isDorm() || this.state.dorm[key] === undefined) return;
    this.state.dorm[key] += amount;
    const label = this.dormEnvironmentLabel(key);
    const hint = key === "smell"
      ? "空气变得更难呼吸。精神回复被压低。"
      : key === "noise"
        ? "声音贴着耳膜震动。连续出牌开始消耗精神。"
        : "空间越来越少。敌人的防御变厚。";
    this.message.textContent = `${label}+${amount}：${hint}`;
  }

  async resolveEarlyMorningAwake() {
    if (!this.isEarlyMorning()) return;
    const enemy = this.firstAliveEnemy();
    if (!enemy) return;

    this.addCardsToPile("drawPile", "anxiety", 1);
    this.message.textContent = "早八：加入 1 张焦虑";
  }

  async resolveLegShakeVibration() {
    if (!this.isLegShake()) return;
    const { player } = this.state;
    const enemy = this.firstAliveEnemy();
    const value = player.vibration || 0;
    player.legShakeResonance = false;

    if (value <= 1) {
      this.message.textContent = "震感：稳住了";
      await this.showSystemNotice("桌面恢复平静。你稳住了。");
    } else if (value <= 3) {
      this.addCardsToPile("discardPile", "junk", 1);
      this.message.textContent = "震感：桌面微震，1 张垃圾进入弃牌堆";
      await this.showSystemNotice("水杯晃了一下，但还没倒。");
    } else {
      this.addCardsToPile("drawPile", "junk", 1);
      this.loseMental(1);
      if (enemy) enemy.strength += 1;
      player.legShakeResonance = true;
      this.message.textContent = "震感：全桌共振";
      await this.showSystemNotice("你感觉整个教室都在看你。");
    }
    player.vibration = 0;
  }

  tickPlayerTurnStatuses() {
    const { player } = this.state;
    if (player.late > 0) player.late -= 1;
    if (player.networkWave > 0) player.networkWave -= 1;
    if (this.isCoffinBoss()) {
      player.breachNextBlock = 0;
      player.stingNextBlock = 0;
      player.stingTriggers = 0;
      player.rebuttalNextStrength = 0;
    }
  }

  resolveBossEndTurnStatuses() {
    if (!this.isCoffinBoss()) return;
    const { player } = this.state;
    if (player.countdown > 0) {
      const damage = player.countdown * 4;
      this.takePlayerDamageDirect(damage, "倒数");
    }
  }

  startPlayerTurn() {
    const { player } = this.state;
    this.state.turnNumber += 1;
    player.block = 0;
    if (this.isCoffinBoss() && player.overdraft > 0) {
      this.loseMental(player.overdraft);
      this.message.textContent = `透支：失去 ${player.overdraft} 精神`;
    }
    player.mentalRecoveryPenaltyThisTurn = player.mentalRecoveryPenaltyNext || 0;
    player.mentalRecoveryPenaltyNext = 0;
    player.skillHalfThisTurn = Boolean(player.nextSkillHalf);
    player.nextSkillHalf = false;
    player.summer = false;
    player.attackLocked = false;
    player.nullifyEnemyThisTurn = false;
    player.attacksPlayedThisTurn = 0;
    player.skillsPlayedThisTurn = 0;
    player.cardsPlayedThisTurn = 0;
    player.costlyCardsPlayedThisTurn = 0;
    player.blockGainedThisTurn = 0;
    player.attackDamageThisTurn = 0;
    player.discardedCardsThisTurn = 0;
    player.mentalRecoveriesThisTurn = 0;
    player.vibration = 0;
    player.legShakeResonance = false;
    this.state.dorm.enemyBlockBonusUsed = false;
    this.state.dorm.clutterBlockBrokenThisTurn = false;
    this.state.turnFlags = {};
    this.applyTurnStartRelics();
    this.startCheckinTurn();
    this.state.turnStarted = true;
    this.renderAwakeMeter();
    this.renderVibrationMeter();
    this.renderCheckinMeter();
  }

  moveDiscardNonAttackToDrawTop() {
    const index = this.state.discardPile.findIndex((card) => cardDef(card).type !== "attack");
    if (index < 0) return;
    const [card] = this.state.discardPile.splice(index, 1);
    this.state.drawPile.push(card);
    this.noteCardEnteredNonDiscard();
    this.message.textContent = `${cardDef(card).name} 回到抽牌堆顶`;
  }

  isEarlyMorning() {
    return this.state.battleDef?.mechanics === "earlyMorning";
  }

  isLegShake() {
    return this.state.battleDef?.mechanics === "legShake";
  }

  isCheckin() {
    return this.state.battleDef?.mechanics === "checkin";
  }

  isDorm() {
    return this.state.battleDef?.mechanics === "dorm";
  }

  dormEnemyAlive(id) {
    const enemy = this.enemyById(id);
    return Boolean(this.isDorm() && enemy && enemy.hp > 0);
  }

  isCoffinBoss() {
    return this.state.battleDef?.mechanics === "coffinBoss";
  }

  hasRelic(key) {
    return this.runState.relics.includes(key);
  }

  applyBattleStartRelics() {
    this.state.relicFlags = {};
    this.state.turnFlags = {};
    if (this.hasRelic("soy_milk")) {
      this.flashRelic("soy_milk");
      this.state.player.mental = Math.min(this.state.player.maxMental, this.state.player.mental + 1);
    }
    if (this.hasRelic("expired_coffee")) {
      this.flashRelic("expired_coffee");
      this.state.player.mental = Math.min(this.state.player.maxMental, this.state.player.mental + 3);
      this.gainPlayerStrength(1);
    }
    if (this.runState.nextBattleBlock) {
      this.state.player.block += this.runState.nextBattleBlock;
      this.runState.nextBattleBlock = 0;
    }
    if (this.hasRelic("graduate_list")) {
      this.flashRelic("graduate_list");
      this.state.relicFlags.graduate_list_maxMentalPenalty = 1;
      this.state.player.maxMental = Math.max(1, this.state.player.maxMental - 1);
      this.state.player.mental = Math.min(this.state.player.mental, this.state.player.maxMental);
      this.gainPlayerStrength(1);
      this.state.player.dexterity += 1;
    }
  }

  resolveCourseSelectionRelic() {
    if (!this.hasRelic("course_selection") || !this.relicOverlay || !this.relicChoiceGrid) return Promise.resolve();
    this.flashRelic("course_selection");
    const pool = Object.keys(CARD_DEFS).filter((key) => {
      const def = CARD_DEFS[key];
      return !def.unplayable && !def.vanish && key !== "toxin";
    });
    const choices = shuffle(pool).slice(0, 3);
    if (!choices.length) return Promise.resolve();

    this.busy = true;
    this.relicChoiceGrid.innerHTML = choices
      .map((key) => `
        <button class="relic-choice course-card-choice" type="button" data-course-card="${key}">
          <strong>${escapeHtml(CARD_DEFS[key].name)}</strong>
          <span>${escapeHtml(CARD_DEFS[key].text)}</span>
        </button>
      `)
      .join("");
    const title = this.relicOverlay.querySelector("h2");
    if (title) title.textContent = "选课系统";
    this.relicOverlay.hidden = false;
    requestAnimationFrame(() => this.relicOverlay.classList.add("is-visible"));

    return new Promise((resolve) => {
      const choose = (event) => {
        const button = event.target.closest("[data-course-card]");
        if (!button) return;
        const card = this.makeBattleCard(button.dataset.courseCard);
        card.costModifier = -1;
        this.state.hand.push(card);
        this.noteCardEnteredNonDiscard();
        this.relicOverlay.classList.remove("is-visible");
        window.setTimeout(() => {
          this.relicOverlay.hidden = true;
          if (title) title.textContent = "选择遗物";
          this.relicChoiceGrid.removeEventListener("click", choose);
          this.renderAll();
          this.busy = false;
          resolve();
        }, 220);
      };
      this.relicChoiceGrid.addEventListener("click", choose);
    });
  }

  clearTemporaryCostModifiers() {
    [
      ...this.state.hand,
      ...this.state.drawPile,
      ...this.state.discardPile,
      ...this.state.exhaustedPile,
    ].forEach((card) => {
      if (card.costModifier) delete card.costModifier;
    });
  }

  applyTurnStartRelics() {
    const { player } = this.state;
    if (this.hasRelic("expired_coffee") && this.state.turnNumber === 3 && !this.state.relicFlags.expired_coffee_turn3) {
      this.state.relicFlags.expired_coffee_turn3 = true;
      this.flashRelic("expired_coffee");
      this.loseMental(1);
    }
    if (this.hasRelic("old_clock") && this.state.turnNumber > 1 && this.state.turnNumber % 3 === 0) {
      this.flashRelic("old_clock");
      this.gainMental(1);
    }
    if (this.hasRelic("campus_net_auth") && player.mental >= 8) {
      this.flashRelic("campus_net_auth");
      player.dexterity += 1;
    }
  }

  applyRelicEvent(event, payload = {}) {
    if (event === "mentalRecovered" && payload.source && this.hasRelic("used_bottle")) {
      this.flashRelic("used_bottle");
      this.gainBlock(4);
    }
    if (event === "skillPlayed" && this.hasRelic("scratch_paper") && !this.state.relicFlags.scratch_paper) {
      this.state.relicFlags.scratch_paper = true;
      this.flashRelic("scratch_paper");
      this.gainBlock(3);
    }
    if (event === "mentalBelowFive" && this.hasRelic("unfinished_homework") && !this.state.relicFlags.unfinished_homework) {
      this.state.relicFlags.unfinished_homework = true;
      this.flashRelic("unfinished_homework");
      this.drawCards(1, { extra: true });
    }
  }

  async bossEnemyAct() {
    const enemy = this.firstAliveEnemy();
    if (!enemy) return;
    const action = this.bossCurrentAction(enemy);
    if (!action) return;

    await this.showActionMessage(enemy.id, action.message || action.name);
    if (action.id === "echo_transform") {
      await this.resolveBossTransform(enemy);
      return;
    }

    const hits = this.enemyHitValues(enemy, action);
    for (const hit of hits) {
      await this.animateEnemy("attack", this.enemyCardById(enemy.id));
      this.applyBossHit(hit);
      this.renderStats();
      await wait(300);
      if (this.state.player.hp <= 0) return;
    }

    if (this.state.boss.phase === 1) {
      if (action.hollow && !this.state.player.nullifyEnemyThisTurn) {
        this.state.player.hollow += action.hollow;
        this.message.textContent = `获得 ${action.hollow} 层空洞`;
        await wait(220);
      }
      if (action.addHand) {
        this.state.hand.push(this.makeBattleCard(action.addHand));
        this.noteCardEnteredNonDiscard();
        this.message.textContent = `呼唤进入手牌`;
        await wait(220);
      }
      enemy.patternIndex = (enemy.patternIndex + 1) % enemy.pattern.length;
      this.renderAll();
      return;
    }

    const twist = this.nextBossTwist();
    if (twist && !this.state.player.nullifyEnemyThisTurn) {
      await this.showActionMessage(enemy.id, twist.message);
      twist.apply();
      this.message.textContent = twist.label;
      await wait(260);
    }
    this.renderAll();
  }

  applyBossHit(hit = 0) {
    const damage = Math.max(0, hit);
    const blocked = Math.min(this.state.player.block, damage);
    const taken = this.state.player.nullifyEnemyThisTurn ? 0 : damage - blocked;
    if (!this.state.player.nullifyEnemyThisTurn) {
      this.state.player.block -= blocked;
      if (taken > 0 && this.state.player.hp - taken <= 0 && this.hasRelic("extension_request") && !this.state.relicFlags.extension_request) {
        this.state.relicFlags.extension_request = true;
        this.flashRelic("extension_request");
        this.state.player.hp = 1;
        this.state.player.mental = 0;
        this.message.textContent = "延期申请：保留 1 生命，失去所有精神";
      } else {
        this.state.player.hp = Math.max(0, this.state.player.hp - taken);
      }
    }
    this.message.textContent = this.state.player.nullifyEnemyThisTurn
      ? "暂挡下了伤害"
      : taken > 0 ? `受到 ${taken} 伤害` : "防御";
    floatText(this.root, taken > 0 ? `-${taken}` : this.state.player.nullifyEnemyThisTurn ? "无效" : "防御", "player");
    if (taken > 0) this.flashPlayerDamage();
  }

  async resolveBossTransform(enemy) {
    this.bossCoffin?.classList.add("is-opening");
    const releasedCards = [...this.state.boss.coffin];
    const hits = releasedCards.map(() => 10);
    const wasNullified = this.state.player.nullifyEnemyThisTurn;
    this.state.player.nullifyEnemyThisTurn = false;
    for (const hit of hits) {
      await this.animateEnemy("attack", this.enemyCardById(enemy.id));
      this.applyBossHit(hit);
      this.renderStats();
      await wait(260);
      if (this.state.player.hp <= 0) break;
    }
    this.state.player.muddled += 1;
    this.state.player.hollow = 0;
    this.message.textContent = wasNullified
      ? "回响转化穿过了暂：混浊降临，空洞消散"
      : "回响转化：混浊降临，空洞消散";
    this.state.boss.coffinBonusCount = releasedCards.length;
    if (releasedCards.length) {
      this.state.discardPile.push(...releasedCards);
      this.state.boss.coffin = [];
      this.renderPiles();
    }
    this.state.boss.transformPending = false;
    this.state.boss.transformed = true;
    this.state.boss.phase = 2;
    this.state.player.echoTransformed = true;
    this.swapBossPhaseTwoTextures();
    this.renderAll();
    await wait(420);
  }

  swapBossPhaseTwoTextures() {
    if (!this.isCoffinBoss() || !this.state.battleDef.phaseTwoImages?.length || !this.enemyCard) return;
    this.clearTextureTimer();
    this.enemyCard.style.setProperty("--enemy-mask", `url('${this.state.battleDef.phaseTwoImages[0]}')`);
    this.enemyCard.innerHTML = this.state.battleDef.phaseTwoImages
      .map((src, index) => `<img class="enemy-texture${index === 0 ? " is-visible" : ""}" src="${src}" alt="${this.state.battleDef.enemyName}" draggable="false" />`)
      .join("");
    this.enemyImages = [...this.root.querySelectorAll(".enemy-texture")];
    this.startTextureSwap({ ...this.state.battleDef, enemyImages: this.state.battleDef.phaseTwoImages });
  }

  async enemyAct() {
    this.state.enemies.forEach((enemy) => {
      enemy.block = 0;
    });
    this.renderStats();
    if (this.isCoffinBoss()) {
      await this.bossEnemyAct();
      return;
    }
    const activeEnemies = this.aliveEnemies();
    if (this.isDorm()) this.state.dorm.enemyBlockBonusUsed = false;

    for (const enemy of activeEnemies) {
      if (this.state.player.hp <= 0) break;
      const action = enemy.pattern[enemy.patternIndex] || enemy.pattern[0];
      if (!action) continue;

      await this.showActionMessage(enemy.id, action.message);
      if (action.block) {
        const gained = this.enemyGainBlock(enemy, action.block);
        this.message.textContent = `${enemy.name} 获得 ${gained} 防御`;
        this.renderStats();
        await wait(220);
      }
      if (action.blockAll) {
        this.aliveEnemies().forEach((target) => this.enemyGainBlock(target, action.blockAll));
        this.message.textContent = `全体敌人获得防御`;
        this.renderStats();
        await wait(220);
      }
      if (action.blockSelf) {
        const gained = this.enemyGainBlock(enemy, action.blockSelf);
        this.message.textContent = `${enemy.name} 获得 ${gained} 防御`;
        this.renderStats();
        await wait(220);
      }
      if (action.blockOthers) {
        this.aliveEnemies().filter((target) => target.id !== enemy.id).forEach((target) => this.enemyGainBlock(target, action.blockOthers));
        this.message.textContent = `其他敌人获得防御`;
        this.renderStats();
        await wait(220);
      }
      if (action.environmentAdd && !this.state.player.nullifyEnemyThisTurn) {
        this.addDormEnvironment(action.environmentAdd.key, action.environmentAdd.amount);
        this.renderStats();
        await wait(220);
      }
      if (action.status === "late") {
        if (!this.state.player.nullifyEnemyThisTurn) {
          this.state.player.late = 1;
        }
        this.message.textContent = this.state.player.nullifyEnemyThisTurn ? "迟到被暂挡下" : "陷入迟到";
        this.renderStats();
        await wait(220);
      }
      if (action.status === "distracted") {
        if (!this.state.player.nullifyEnemyThisTurn) {
          this.state.player.distracted = 1;
        }
        this.message.textContent = this.state.player.nullifyEnemyThisTurn ? "分心被暂挡下" : "陷入分心";
        this.renderStats();
        await wait(220);
      }
      if (action.addDraw && !this.state.player.nullifyEnemyThisTurn) {
        this.addCardsToPile("drawPile", action.addDraw, 1);
      }
      if (action.addDiscard && !this.state.player.nullifyEnemyThisTurn) {
        this.addCardsToPile("discardPile", action.addDiscard, 1);
      }
      if (action.scanNextAdjustment && !this.state.player.nullifyEnemyThisTurn) {
        this.state.player.checkinNextAdjustment += action.scanNextAdjustment;
        this.state.player.networkWave = 1;
      }
      if (action.addHand && !this.state.player.nullifyEnemyThisTurn) {
        const cardName = CARD_DEFS[action.addHand]?.name || "牌";
        await this.addCardToHand(action.addHand, { label: `${cardName}进入手牌` });
      }
      if (action.mentalRecoveryPenaltyNext && !this.state.player.nullifyEnemyThisTurn) {
        this.state.player.mentalRecoveryPenaltyNext += action.mentalRecoveryPenaltyNext;
      }
      if (action.loseMental && !this.state.player.nullifyEnemyThisTurn) {
        this.loseMental(action.loseMental);
        this.renderStats();
        await wait(180);
      }
      if (action.nextSkillHalf && !this.state.player.nullifyEnemyThisTurn) {
        this.state.player.nextSkillHalf = true;
      }
      if (this.state.player.legShakeResonance && action.resonanceAddDiscard && !this.state.player.nullifyEnemyThisTurn) {
        this.addCardsToPile("discardPile", action.resonanceAddDiscard, 1);
      }
      if (this.state.player.legShakeResonance && action.resonanceAddHand && !this.state.player.nullifyEnemyThisTurn) {
        const cardName = CARD_DEFS[action.resonanceAddHand]?.name || "牌";
        await this.addCardToHand(action.resonanceAddHand, { label: `${cardName}进入手牌` });
      }
      if (this.state.player.legShakeResonance && action.resonanceLoseMental && !this.state.player.nullifyEnemyThisTurn) {
        this.loseMental(action.resonanceLoseMental);
      }
      if (action.strength) {
        enemy.strength += action.strength;
        enemy.patternIndex = (enemy.patternIndex + 1) % enemy.pattern.length;
        this.message.textContent = action.message || `${enemy.name} 正在蓄势`;
        this.renderStats();
        await wait(180);
        continue;
      }

      let takenByEnemy = 0;
      if (action.hits || action.damage) {
        const hits = this.enemyHitValues(enemy, action);
        for (const hit of hits) {
          await this.animateEnemy("attack", this.enemyCardById(enemy.id));
          const damage = hit;
          const blocked = Math.min(this.state.player.block, damage);
          const taken = this.state.player.nullifyEnemyThisTurn ? 0 : damage - blocked;
          if (!this.state.player.nullifyEnemyThisTurn) {
            this.state.player.block -= blocked;
            if (taken > 0 && this.state.player.hp - taken <= 0 && this.hasRelic("extension_request") && !this.state.relicFlags.extension_request) {
              this.state.relicFlags.extension_request = true;
              this.flashRelic("extension_request");
              this.state.player.hp = 1;
              this.state.player.mental = 0;
              this.message.textContent = "延期申请：保留 1 生命，失去所有精神";
            } else {
              this.state.player.hp = Math.max(0, this.state.player.hp - taken);
            }
          }
          takenByEnemy += taken;
          this.message.textContent = this.state.player.nullifyEnemyThisTurn
            ? "暂挡下了伤害"
            : taken > 0 ? `受到 ${taken} 伤害` : "防御";
          floatText(this.root, taken > 0 ? `-${taken}` : this.state.player.nullifyEnemyThisTurn ? "无效" : "防御", "player");
          if (taken > 0) this.flashPlayerDamage();
          this.renderStats();
          await wait(260);
          if (this.state.player.hp <= 0) break;
        }
      }
      enemy.patternIndex = (enemy.patternIndex + 1) % enemy.pattern.length;
      if (action.anxietyIfMentalBelow !== undefined && this.state.player.mental < action.anxietyIfMentalBelow && !this.state.player.nullifyEnemyThisTurn) {
        this.addCardsToPile("discardPile", "anxiety", 1);
      }
      if (action.strengthIfMentalAtLeast !== undefined && this.state.player.mental >= action.strengthIfMentalAtLeast) {
        enemy.strength += 1;
      }
      if (action.anxietyToHandIfMentalZero && this.state.player.mental === 0 && !this.state.player.nullifyEnemyThisTurn) {
        this.state.hand.push(this.makeBattleCard("anxiety"));
        this.noteCardEnteredNonDiscard();
      }
      if (action.loseMentalIfBelow && this.state.player.mental < action.loseMentalIfBelow.threshold && !this.state.player.nullifyEnemyThisTurn) {
        this.loseMental(action.loseMentalIfBelow.amount);
      }
      if (
        action.loseMentalIfLastTurnCardsAtLeast &&
        this.state.player.lastTurnCardsPlayed >= action.loseMentalIfLastTurnCardsAtLeast.threshold &&
        !this.state.player.nullifyEnemyThisTurn
      ) {
        this.loseMental(action.loseMentalIfLastTurnCardsAtLeast.amount);
      }
      if (action.addAnxietyIfMentalAbove !== undefined && this.state.player.mental > action.addAnxietyIfMentalAbove && !this.state.player.nullifyEnemyThisTurn) {
        this.addCardsToPile("discardPile", "anxiety", 1);
      }
      if (action.hits || action.damage) {
        this.message.textContent = takenByEnemy > 0 ? `受到 ${takenByEnemy} 伤害` : "完全防御";
      }
      this.renderStats();
      await wait(220);
    }
    if (this.isDorm()) this.state.dorm.nextEnemyDamagePenalty = 0;
  }

  enemyGainBlock(enemy, amount = 0) {
    if (!enemy || amount <= 0) return 0;
    const total = amount;
    enemy.block = (enemy.block || 0) + total;
    return total;
  }

  flashPlayerDamage() {
    this.root.classList.remove("player-damaged");
    void this.root.offsetWidth;
    this.root.classList.add("player-damaged");
    window.setTimeout(() => this.root.classList.remove("player-damaged"), 780);
  }

  takePlayerDamageDirect(amount = 0, label = "受到伤害") {
    if (amount <= 0 || this.state.finished) return;
    this.state.player.hp = Math.max(0, this.state.player.hp - amount);
    this.message.textContent = `${label}：受到 ${amount} 伤害`;
    floatText(this.root, `-${amount}`, "player");
    this.flashPlayerDamage();
    this.renderStats();
  }

  async showActionMessage(enemyId, text) {
    const actionMessage = this.root.querySelector(`[data-action-message="${enemyId}"]`);
    if (!text || !actionMessage) return;
    const wrap = this.root.querySelector(`[data-enemy-wrap="${enemyId}"]`);

    actionMessage.innerHTML = [...text]
      .map((char, index) => `<span style="--char-delay: ${index * 42}ms">${escapeHtml(char)}</span>`)
      .join("");
    wrap?.classList.add("is-speaking");
    actionMessage.classList.remove("is-visible");
    void actionMessage.offsetWidth;
    actionMessage.classList.add("is-visible");
    await wait(880);
    actionMessage.classList.remove("is-visible");
    await wait(260);
    wrap?.classList.remove("is-speaking");
  }

  async finishVictory() {
    this.state.finished = true;
    this.busy = true;
    this.message.textContent = "战斗胜利";
    this.root.classList.add("battle-finished");
    this.endTurnBtn.disabled = true;
    if (this.debugFinishBtn) this.debugFinishBtn.disabled = true;
    this.renderStats();
    this.clearTextureTimer();
    await Promise.all(
      this.enemyCards.map((enemyCard) => {
        const wrap = enemyCard.closest(".enemy-card-wrap") || this.enemyWrap;
        return shatterEnemy(enemyCard, wrap);
      }),
    );
    await wait(520);
    await this.animateVictoryRecovery(10, 4);
    this.stopBattleCorruption();
    this.root.classList.add("battle-victory-reward");
    const hasCardRewards = Boolean(this.state.battleDef?.rewardCards?.length);
    let nextAction = "map";
    if (this.state.battleDef?.rewardPool?.length) {
      nextAction = await this.showRelicChoice(this.state.battleDef.rewardPool, { withVictoryActions: !hasCardRewards });
    }
    if (this.state.battleDef?.rewardCards?.length) {
      nextAction = await this.showCardRewardChoice(this.state.battleDef.rewardCards, { withVictoryActions: true });
    }
    if (!this.state.battleDef?.rewardPool?.length && !this.state.battleDef?.rewardCards?.length) {
      nextAction = await this.showVictoryActions();
    }
    this.renderAll();
    this.syncRunStatePlayer();
    if (nextAction === "shop") {
      await this.leaveBattle({ notifyComplete: false });
      this.onEnterShop?.();
      return;
    }
    await this.leaveBattle();
  }

  async animateVictoryRecovery(hpAmount = 10, mentalAmount = 4) {
    const hpBefore = this.state.player.hp;
    const mentalBefore = this.state.player.mental;
    this.state.player.hp = Math.min(this.state.player.maxHp, hpBefore + hpAmount);
    this.state.player.mental = Math.min(this.state.player.maxMental, mentalBefore + mentalAmount);
    const hpActual = this.state.player.hp - hpBefore;
    const mentalActual = this.state.player.mental - mentalBefore;
    const parts = [];
    if (hpActual > 0) parts.push(`回复 ${hpActual} 生命`);
    if (mentalActual > 0) parts.push(`回复 ${mentalActual} 精神`);
    this.message.textContent = parts.length
      ? `战斗结束：${parts.join("，")}`
      : "战斗结束：生命和精神已满";
    this.renderStats();
    const hpTarget = this.watchHour || this.playerHp || this.hand || this.root;
    const mentalTarget = this.watchMinute || this.playerMental || this.hand || this.root;
    floatText(hpTarget, hpActual > 0 ? `生命 +${hpActual}` : "生命已满", "player");
    floatText(mentalTarget, mentalActual > 0 ? `精神 +${mentalActual}` : "精神已满", "player");
    await wait(900);
  }

  async debugFinishBattle() {
    if (this.state.finished || this.busy) return;
    this.state.enemies.forEach((enemy) => {
      enemy.hp = 0;
      enemy.block = 0;
    });
    await this.finishVictory();
  }

  async leaveBattle({ notifyComplete = true } = {}) {
    this.stopBattleCorruption();
    this.root.classList.remove(
      "is-active",
      "battle-finished",
      "battle-victory-reward",
      "battle-defeat",
      "is-discarding",
      "player-damaged",
      "is-attack-targeted",
      "is-skill-targeted",
      "is-choosing-coffin",
    );
    await wait(620);
    this.root.hidden = true;
    this.root.innerHTML = "";
    if (notifyComplete && this.onComplete) this.onComplete();
  }

  async handleDefeatReturn() {
    await this.leaveBattle({ notifyComplete: false });
    this.onDefeatReturn?.();
  }

  syncRunStatePlayer() {
    if (!this.state?.player) return;
    const { player } = this.state;
    this.runState.player.hp = player.hp;
    this.runState.player.maxHp = player.maxHp;
    this.runState.player.mental = player.mental;
    this.runState.player.maxMental = player.maxMental + (this.state.relicFlags?.graduate_list_maxMentalPenalty || 0);
  }

  showRelicChoice(pool, { withVictoryActions = false } = {}) {
    if (!this.relicOverlay || !this.relicChoiceGrid) return Promise.resolve();
    const choices = shuffle(pool.filter((key) => !this.runState.relics.includes(key))).slice(0, 3);
    if (!choices.length) {
      return withVictoryActions ? this.showVictoryActions() : Promise.resolve();
    }
    const title = this.relicOverlay.querySelector("h2");
    if (title) title.textContent = "选择遗物";
    const actionBar = withVictoryActions ? this.prepareVictoryActionBar(true) : null;
    if (!withVictoryActions) this.cleanupVictoryActionBar(this.currentVictoryActionBar());

    this.relicChoiceGrid.classList.remove("is-victory-actions", "is-reward-cleared");
    this.relicChoiceGrid.innerHTML = choices
      .map((key) => {
        const relic = RELIC_DEFS[key];
        return `
          <button class="relic-choice" type="button" data-relic="${key}">
            <span class="relic-choice-icon" ${relicIconStyle(key)}>${renderRelicIcon(key)}</span>
            <strong>${escapeHtml(relic.name)}</strong>
            <span>${escapeHtml(relic.text)}</span>
          </button>
        `;
      })
      .join("");
    this.relicOverlay.hidden = false;
    requestAnimationFrame(() => this.relicOverlay.classList.add("is-visible"));

    return new Promise((resolve) => {
      const choose = (event) => {
        const button = event.target.closest("[data-relic]");
        if (!button) return;
        this.runState.relics.push(button.dataset.relic);
        if (!withVictoryActions) {
          this.relicOverlay.classList.remove("is-visible");
          window.setTimeout(() => {
            this.relicOverlay.hidden = true;
            this.relicChoiceGrid.removeEventListener("click", choose);
            resolve();
          }, 220);
          return;
        }
        this.relicChoiceGrid.classList.add("is-reward-cleared");
        this.relicChoiceGrid.innerHTML = "";
        if (title) title.textContent = "战斗胜利";
        this.setVictoryActionButtonsEnabled(actionBar, true);
      };
      const chooseAction = (event) => {
        const button = event.target.closest("[data-victory-action]");
        if (!button || button.disabled) return;
        const action = button.dataset.victoryAction === "shop" ? "shop" : "map";
        this.relicOverlay.classList.remove("is-visible");
        window.setTimeout(() => {
          this.relicOverlay.hidden = true;
          if (title) title.textContent = "选择遗物";
          this.relicChoiceGrid.classList.remove("is-reward-cleared");
          this.cleanupVictoryActionBar(actionBar);
          this.relicChoiceGrid.removeEventListener("click", choose);
          actionBar?.removeEventListener("click", chooseAction);
          resolve(action);
        }, 220);
      };
      this.relicChoiceGrid.addEventListener("click", choose);
      actionBar?.addEventListener("click", chooseAction);
    });
  }

  showCardRewardChoice(pool, { withVictoryActions = false } = {}) {
    if (!this.relicOverlay || !this.relicChoiceGrid) return Promise.resolve();
    const choices = shuffle(pool.filter((key) => CARD_DEFS[key])).slice(0, 3);
    if (!choices.length) {
      return withVictoryActions ? this.showVictoryActions() : Promise.resolve();
    }
    const title = this.relicOverlay.querySelector("h2");
    if (title) title.textContent = "选择一张牌";
    const actionBar = withVictoryActions ? this.prepareVictoryActionBar(true) : null;
    if (!withVictoryActions) this.cleanupVictoryActionBar(this.currentVictoryActionBar());

    this.relicChoiceGrid.classList.remove("is-victory-actions", "is-reward-cleared");
    this.relicChoiceGrid.innerHTML = choices
      .map((key) => `
        <button class="relic-choice card-reward-choice" type="button" data-card-reward="${key}">
          ${renderPileCard({ id: `reward-${key}`, key })}
        </button>
      `)
      .join("");
    this.relicOverlay.hidden = false;
    requestAnimationFrame(() => this.relicOverlay.classList.add("is-visible"));

    return new Promise((resolve) => {
      const choose = (event) => {
        const button = event.target.closest("[data-card-reward]");
        if (!button) return;
        this.runState.deckKeys.push(button.dataset.cardReward);
        if (!withVictoryActions) {
          this.relicOverlay.classList.remove("is-visible");
          window.setTimeout(() => {
            this.relicOverlay.hidden = true;
            if (title) title.textContent = "选择遗物";
            this.relicChoiceGrid.removeEventListener("click", choose);
            resolve();
          }, 220);
          return;
        }
        this.relicChoiceGrid.classList.add("is-reward-cleared");
        this.relicChoiceGrid.innerHTML = "";
        if (title) title.textContent = "战斗胜利";
        this.setVictoryActionButtonsEnabled(actionBar, true);
      };
      const chooseAction = (event) => {
        const button = event.target.closest("[data-victory-action]");
        if (!button || button.disabled) return;
        const action = button.dataset.victoryAction === "shop" ? "shop" : "map";
        this.relicOverlay.classList.remove("is-visible");
        window.setTimeout(() => {
          this.relicOverlay.hidden = true;
          if (title) title.textContent = "选择遗物";
          this.relicChoiceGrid.classList.remove("is-reward-cleared");
          this.cleanupVictoryActionBar(actionBar);
          this.relicChoiceGrid.removeEventListener("click", choose);
          actionBar?.removeEventListener("click", chooseAction);
          resolve(action);
        }, 220);
      };
      this.relicChoiceGrid.addEventListener("click", choose);
      actionBar?.addEventListener("click", chooseAction);
    });
  }

  showVictoryActions() {
    if (!this.relicOverlay || !this.relicChoiceGrid) return Promise.resolve("map");
    const title = this.relicOverlay.querySelector("h2");
    if (title) title.textContent = "战斗胜利";

    this.relicChoiceGrid.classList.add("is-victory-actions");
    this.relicChoiceGrid.innerHTML = `
      <button class="victory-action-choice" type="button" data-victory-action="shop">进入图书馆</button>
      <button class="victory-action-choice" type="button" data-victory-action="map">返回主界面</button>
    `;
    this.relicOverlay.hidden = false;
    requestAnimationFrame(() => this.relicOverlay.classList.add("is-visible"));

    return new Promise((resolve) => {
      const choose = (event) => {
        const button = event.target.closest("[data-victory-action]");
        if (!button) return;
        const action = button.dataset.victoryAction === "shop" ? "shop" : "map";
        this.relicOverlay.classList.remove("is-visible");
        window.setTimeout(() => {
          this.relicOverlay.hidden = true;
          if (title) title.textContent = "选择遗物";
          this.relicChoiceGrid.classList.remove("is-victory-actions");
          this.relicChoiceGrid.removeEventListener("click", choose);
          resolve(action);
        }, 220);
      };
      this.relicChoiceGrid.addEventListener("click", choose);
    });
  }

  prepareVictoryActionBar(disabled = true) {
    if (!this.relicChoiceGrid) return null;
    const dialog = this.relicChoiceGrid.closest(".relic-dialog");
    if (!dialog) return null;
    let actionBar = dialog.querySelector("[data-victory-action-bar]");
    if (!actionBar) {
      actionBar = document.createElement("div");
      actionBar.className = "victory-action-bar";
      actionBar.dataset.victoryActionBar = "true";
      this.relicChoiceGrid.insertAdjacentElement("afterend", actionBar);
    }
    actionBar.hidden = false;
    actionBar.innerHTML = `
      <button class="victory-action-choice" type="button" data-victory-action="shop">进入图书馆</button>
      <button class="victory-action-choice" type="button" data-victory-action="map">返回主界面</button>
    `;
    this.setVictoryActionButtonsEnabled(actionBar, !disabled);
    return actionBar;
  }

  currentVictoryActionBar() {
    return this.relicChoiceGrid?.closest(".relic-dialog")?.querySelector("[data-victory-action-bar]") || null;
  }

  setVictoryActionButtonsEnabled(actionBar, enabled) {
    actionBar?.querySelectorAll("[data-victory-action]").forEach((button) => {
      button.disabled = !enabled;
    });
    actionBar?.classList.toggle("is-enabled", enabled);
  }

  cleanupVictoryActionBar(actionBar) {
    if (!actionBar) return;
    actionBar.hidden = true;
    actionBar.classList.remove("is-enabled");
    actionBar.innerHTML = "";
  }

  async finishDefeat() {
    this.state.finished = true;
    this.busy = true;
    this.message.textContent = "战斗失败";
    this.root.classList.add("battle-finished", "battle-defeat");
    this.endTurnBtn.disabled = true;
    this.clearTextureTimer();
    this.renderAll();
    this.syncRunStatePlayer();
    this.stopBattleCorruption();
    this.ensureFailOverlay();
    this.failOverlay.hidden = false;
    requestAnimationFrame(() => this.failOverlay.classList.add("is-visible"));
  }

  ensureFailOverlay() {
    this.failOverlay ||= this.root.querySelector("#battleFailOverlay");
    this.failReturnBtn ||= this.root.querySelector("#battleFailReturn");
    if (!this.failOverlay) {
      this.failOverlay = document.createElement("div");
      this.failOverlay.className = "battle-fail-overlay";
      this.failOverlay.id = "battleFailOverlay";
      this.failOverlay.hidden = true;
      this.failOverlay.innerHTML = `
        <section class="battle-fail-dialog" role="dialog" aria-modal="true">
          <h2>你失败了</h2>
          <p>在与梦魇的战斗中，你证明了自己的决心，但真相仍被迷雾笼罩</p>
          <button type="button" id="battleFailReturn">重回梦境</button>
        </section>
      `;
      this.root.append(this.failOverlay);
      this.failReturnBtn = this.failOverlay.querySelector("#battleFailReturn");
    }
    this.bindFailReturnButton();
  }

  async animateEnemy(kind, enemyCard = this.enemyCard) {
    if (!enemyCard) return;
    enemyCard.classList.remove("enemy-attack", "enemy-damaged");
    void enemyCard.offsetWidth;
    enemyCard.classList.add(kind === "attack" ? "enemy-attack" : "enemy-damaged");
    await wait(kind === "attack" ? 980 : 720);
    enemyCard.classList.remove("enemy-attack", "enemy-damaged");
  }

  enemyById(enemyId) {
    return this.state.enemies.find((enemy) => enemy.id === enemyId);
  }

  enemyCardById(enemyId) {
    return this.root.querySelector(`.enemy-card[data-enemy-id="${enemyId}"]`);
  }

  aliveEnemies() {
    return this.state.enemies.filter((enemy) => enemy.hp > 0);
  }

  firstAliveEnemy() {
    return this.aliveEnemies()[0] || null;
  }

  startTextureSwap(battleDef) {
    if (!battleDef.textureInterval || this.enemyImages.length < 2) return;

    let index = 0;
    this.textureTimer = window.setInterval(() => {
      const previous = index;
      index = (index + 1) % this.enemyImages.length;
      const previousImage = this.enemyImages[previous];
      const nextImage = this.enemyImages[index];

      nextImage.style.zIndex = "2";
      previousImage.style.zIndex = "1";
      nextImage.classList.add("is-visible");
      window.setTimeout(() => {
        if (!this.textureTimer) return;
        previousImage.classList.remove("is-visible");
        previousImage.style.zIndex = "";
        nextImage.style.zIndex = "";
      }, 240);
    }, battleDef.textureInterval);
  }

  clearTextureTimer() {
    if (!this.textureTimer) return;
    window.clearInterval(this.textureTimer);
    this.textureTimer = null;
  }

  startBattleCorruption(battleDef) {
    this.stopBattleCorruption();
    this.corruptionDisplay = 1 - this.state.player.hp / this.state.player.maxHp;
    this.corruptionLastDraw = 0;
    this.corruptionCanvasRect = null;
    this.corruptionImage = new Image();
    this.corruptionImage.src = battleDef.corruptedBackground || battleDef.background;
    this.corruptionFrame = requestAnimationFrame((now) => this.drawBattleCorruption(now));
  }

  stopBattleCorruption() {
    if (!this.corruptionFrame) return;
    cancelAnimationFrame(this.corruptionFrame);
    this.corruptionFrame = 0;
  }

  drawBattleCorruption(now) {
    if (!this.corruptionCanvas || !this.corruptionImage) return;
    if (this.corruptionLastDraw && now - this.corruptionLastDraw < CORRUPTION_FRAME_INTERVAL) {
      this.corruptionFrame = requestAnimationFrame((time) => this.drawBattleCorruption(time));
      return;
    }
    this.corruptionLastDraw = now;

    const cssWidth = this.corruptionCanvas.clientWidth;
    const cssHeight = this.corruptionCanvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) {
      this.corruptionFrame = requestAnimationFrame((time) => this.drawBattleCorruption(time));
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, CORRUPTION_DPR_CAP);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.corruptionCanvas.width !== width || this.corruptionCanvas.height !== height) {
      this.corruptionCanvas.width = width;
      this.corruptionCanvas.height = height;
    }

    const ctx = this.corruptionCanvas.getContext("2d");
    const { player } = this.state;
    const target = player.hp <= 0 ? 1 : Math.max(0, Math.min(1, 1 - player.hp / player.maxHp));
    this.corruptionDisplay = target >= 1
      ? 1
      : this.corruptionDisplay + (target - this.corruptionDisplay) * 0.08;

    ctx.clearRect(0, 0, width, height);
    if (this.corruptionDisplay > 0.002 && this.corruptionImage.complete) {
      const phase = now * 0.001;
      const points = battleCorruptionBoundary(width, height, this.corruptionDisplay, phase);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      if (this.corruptionDisplay >= 0.995) {
        ctx.lineTo(width, 0);
        ctx.lineTo(width, height);
      } else {
        ctx.lineTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const current = points[index];
          const midY = (previous.y + current.y) / 2;
          ctx.bezierCurveTo(previous.x, midY, current.x, midY, current.x, current.y);
        }
      }
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.clip();
      drawCoverImage(ctx, this.corruptionImage, width, height);
      ctx.restore();

      if (this.corruptionDisplay < 0.995) {
        drawBattleCorruptionParticles(ctx, points, phase, dpr);
      }
    }

    this.corruptionFrame = requestAnimationFrame((time) => this.drawBattleCorruption(time));
  }

  shuffleDiscardIntoDraw() {
    if (this.state.discardPile.length === 0) return;
    this.state.drawPile = shuffle(this.state.discardPile);
    this.state.discardPile = [];
    this.renderPiles();
  }
}
