import { CARD_DEFS } from "../config.js";
import { cardCost, cardDef, getEnemyDefs } from "./state.js";
import { escapeHtml } from "./utils.js";

const CARD_REFERENCE_NAMES = Object.entries(CARD_DEFS)
  .map(([key, def]) => ({ key, name: def.name }))
  .sort((a, b) => b.name.length - a.name.length);

export function battleTemplate(battleDef) {
  const enemyDefs = getEnemyDefs(battleDef);
  return `
    <div class="battle-bg" style="--battle-bg: url('${battleDef.background}')" aria-hidden="true"></div>
    <canvas class="battle-corruption-canvas" id="battleCorruptionCanvas" aria-hidden="true"></canvas>
    <div class="battle-vignette" aria-hidden="true"></div>
    <div class="battle-status-panel" id="battleStatusPanel">
      <div class="battle-relic-mount" id="battleRelicMount"></div>
      <div class="checkin-meter" id="checkinMeter" tabindex="0" hidden>
        <div class="checkin-meter-head">
          <strong>扫码条件</strong>
          <span id="checkinCount">0/2</span>
        </div>
        <div class="checkin-condition-list" id="checkinConditionList"></div>
        <div class="checkin-feedback" id="checkinFeedback" aria-live="polite"></div>
        <div class="checkin-tooltip" id="checkinTooltip"></div>
      </div>
      <div class="battle-status-list" id="battleStatusList"></div>
      <div class="battle-status-tooltip" id="battleStatusTooltip" hidden></div>
    </div>
    <div class="battle-hud">
      <div class="battle-player-stats">
        <span id="battlePlayerHp">生命 0 / 0</span>
        <span id="battlePlayerMental">精神 0 / 0</span>
        <span id="battlePlayerBlock">防御 0</span>
      </div>
      <div class="battle-message" id="battleMessage">你的回合</div>
      <div class="end-turn-wrap">
        <button class="battle-end-turn" id="battleEndTurn" type="button">结束回合</button>
        <button class="battle-debug-finish" id="battleDebugFinish" type="button">结束战斗</button>
        <div class="end-turn-forecast" id="endTurnForecast"></div>
      </div>
    </div>
    <div class="awake-lesson-toast" id="awakeLessonToast" hidden></div>
    <div class="battle-system-notice" id="battleSystemNotice" aria-live="polite" hidden></div>
    <div class="enemy-board enemy-count-${enemyDefs.length}" id="enemyBoard">
      ${enemyDefs.map((enemy) => enemyTemplate(enemy, battleDef)).join("")}
    </div>
    <div class="boss-coffin" id="bossCoffin" hidden>
      <img src="${battleDef.coffinImage || "./assets/scenes/stage_23/coffin.png"}" alt="" draggable="false" />
      <div class="boss-coffin-cards" id="bossCoffinCards" aria-hidden="true"></div>
      <strong id="bossCoffinCount">0</strong>
      <span id="bossCoffinBonus">+0%</span>
    </div>
    <div class="coffin-choice-mask" id="coffinChoiceMask" hidden>
      <span id="coffinChoiceHint">选择灵柩中的一张牌</span>
    </div>
    <div class="player-foreground" aria-hidden="true">
      <div class="player-left-rig">
        <div class="player-hand player-hand-left">
          <img src="./assets/player/hands_normal.png" alt="" draggable="false" />
        </div>
        <div class="player-watch">
          <img class="watch-face" src="./assets/player/watch.png" alt="" draggable="false" />
          <span class="watch-pointer watch-hour" id="watchHour"></span>
          <span class="watch-pointer watch-minute" id="watchMinute"></span>
          <span class="watch-readout" id="watchReadout" aria-live="polite">
            <span class="watch-stat-tag watch-hp-tag" id="watchHpTag"><b>生命</b><strong>0</strong></span>
            <span class="watch-stat-tag watch-mental-tag" id="watchMentalTag"><b>精神</b><strong>0</strong></span>
          </span>
        </div>
      </div>
      <div class="player-hand player-hand-right">
        <img src="./assets/player/hands_normal.png" alt="" draggable="false" />
      </div>
    </div>
    <div class="battle-table">
      <button class="pile draw-pile" id="battleDrawPile" type="button" aria-label="抽牌堆">
        <strong id="battleDrawCount">0</strong>
        <span>抽牌堆</span>
      </button>
      <div class="battle-hand" id="battleHand"></div>
      <button class="pile discard-pile" id="battleDiscardPile" type="button" aria-label="弃牌堆">
        <strong id="battleDiscardCount">0</strong>
        <span>弃牌堆</span>
      </button>
      <div class="discard-choice-controls" id="discardChoiceControls" hidden>
        <strong>选择 1 张手牌弃掉</strong>
        <button type="button" id="discardChoiceConfirm" disabled>弃牌</button>
      </div>
    </div>
    <div class="discard-choice-mask" id="discardChoiceMask" hidden></div>
    <div class="pile-overlay" id="pileOverlay" hidden>
      <section class="pile-dialog" role="dialog" aria-modal="true" aria-labelledby="pileOverlayTitle">
        <header>
          <h2 id="pileOverlayTitle">牌堆</h2>
          <button type="button" data-close-pile aria-label="关闭牌堆">×</button>
        </header>
        <div class="pile-card-grid" id="pileOverlayGrid"></div>
      </section>
    </div>
    <div class="relic-overlay" id="relicOverlay" hidden>
      <section class="relic-dialog" role="dialog" aria-modal="true">
        <h2>选择遗物</h2>
        <div class="relic-choice-grid" id="relicChoiceGrid"></div>
      </section>
    </div>
    <div class="battle-fail-overlay" id="battleFailOverlay" hidden>
      <section class="battle-fail-dialog" role="dialog" aria-modal="true">
        <h2>你失败了</h2>
        <p>在与梦魇的战斗中，你证明了自己的决心，但真相仍被迷雾笼罩</p>
        <button type="button" id="battleFailReturn">重回梦境</button>
      </section>
    </div>
    <div class="battle-tutorial-overlay" id="battleTutorialOverlay" hidden>
      <div class="battle-tutorial-highlights" id="battleTutorialHighlights" aria-hidden="true"></div>
      <section class="battle-tutorial-card" id="battleTutorialCard" role="dialog" aria-live="polite"></section>
    </div>
  `;
}

function enemyTemplate(enemy, battleDef) {
  const showVibrationMeter = battleDef.mechanics === "legShake";
  return `
    <div class="enemy-card-wrap" data-enemy-wrap="${enemy.id}">
      <div class="enemy-topline">
        ${showVibrationMeter ? vibrationMeterTemplate() : ""}
        <div class="enemy-intent">
          <span>意图</span>
          <strong class="enemy-intent-text">攻击 0</strong>
          <div class="enemy-intent-tooltip"></div>
        </div>
      </div>
      <div class="enemy-card" data-enemy-id="${enemy.id}" style="--enemy-mask: url('${enemy.enemyImages[0]}')">
        ${enemy.enemyImages
          .map(
            (src, index) =>
              `<img class="enemy-texture${index === 0 ? " is-visible" : ""}" src="${src}" alt="${enemy.name}" draggable="false" />`,
          )
          .join("")}
      </div>
      <div class="enemy-health">
        <span>${enemy.name}</span>
        <strong class="enemy-hp-text">0 / 0</strong>
        <div class="enemy-health-track"><i class="enemy-hp-bar"></i></div>
        <div class="enemy-status-tags"></div>
      </div>
      <div class="action-message-card" data-action-message="${enemy.id}" aria-live="polite"></div>
    </div>
  `;
}

function vibrationMeterTemplate() {
  return `
    <div class="vibration-meter" id="vibrationMeter" tabindex="0" hidden>
      <div class="vibration-meter-head">
        <strong>震感</strong>
        <span id="vibrationCount">0/4</span>
      </div>
      <div class="vibration-track" aria-label="震感阶段">
        <span class="vibration-stage" data-stage="stable">
          稳
          <em>0-1：无事发生。</em>
        </span>
        <span class="vibration-stage" data-stage="shake">
          微
          <em>2-3：将 1 张垃圾加入弃牌堆。</em>
        </span>
        <span class="vibration-stage" data-stage="resonance">
          共
          <em>4+：垃圾进抽牌堆，失去 1 精神，前桌获得 1 力量。</em>
        </span>
        <i id="vibrationPointer"></i>
      </div>
      <div class="vibration-state" id="vibrationState">稳住了</div>
    </div>
  `;
}

export function renderBattleCardInner(card, options = {}) {
  const def = cardDef(card);
  return `
    <span class="battle-card-cost">${cardCost(card, options.player)}</span>
    <strong>${def.name}</strong>
    <span class="battle-card-text">${highlightCardText(def.text, options)}</span>
    ${renderCardTags(def.tags, def.type)}
    ${hasSummerText(def) ? summerTooltip() : ""}
    ${options.showCardRefs === false ? "" : cardReferenceTooltip(card)}
  `;
}

export function renderPileCard(card, options = {}) {
  const def = cardDef(card);
  const refs = cardReferenceKeys(card);
  return `
    <article class="battle-card pile-card-preview ${def.type}${hasSummerText(def) ? " has-summer" : ""}${refs.length ? " has-card-refs" : ""}">
      ${renderBattleCardInner(card, options)}
    </article>
  `;
}

const CARD_TEXT_LINE_STARTERS = [
  "暑假",
  "进入暑假",
  "若",
  "精神至少",
  "精神高于",
  "下回合",
  "回合结束",
  "打出",
  "Boss ",
  "注视达到",
  "可能获得",
  "每失去",
];

function highlightCardText(text, { damageOverride = null } = {}) {
  return splitCardTextLines(text)
    .map((line, index) => {
      let html = escapeHtml(line);
      if (damageOverride !== null) {
        html = html.replace(
          /造成\s*\d+\s*点(?:基础)?伤害/,
          `造成 <span class="effective-damage">${damageOverride} 伤害</span>`,
        );
      }

      const highlighted = html
        .replaceAll("【暑假】", "__SUMMER__")
        .replaceAll("暑假", "__SUMMER__")
        .replaceAll("精神", '<span class="mental-highlight">精神</span>')
        .replaceAll("__SUMMER__", '<span class="summer-highlight">暑假</span>');
      const specialClass = index > 0 ? " is-special-effect" : "";
      return `<span class="battle-card-line${specialClass}">${highlighted}</span>`;
    })
    .join("");
}

function splitCardTextLines(text) {
  return text
    .split(/(?<=。)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((lines, sentence) => {
      const shouldStartNewLine =
        lines.length > 0 && CARD_TEXT_LINE_STARTERS.some((starter) => sentence.startsWith(starter));
      if (shouldStartNewLine) {
        lines.push(sentence);
      } else if (lines.length) {
        lines[lines.length - 1] += sentence;
      } else {
        lines.push(sentence);
      }
      return lines;
    }, []);
}

function renderCardTags(tags = [], type = "") {
  const typeLabel = cardTypeLabel(type);
  return `
    <span class="battle-card-tags">
      <span class="battle-card-tag-list">
        ${tags.map((tag) => `<span class="battle-card-tag">${escapeHtml(tag)}</span>`).join("")}
      </span>
      <span class="battle-card-type-tag">${escapeHtml(typeLabel)}</span>
    </span>
  `;
}

function cardTypeLabel(type) {
  if (type === "attack") return "攻击";
  if (type === "defense") return "防御";
  if (type === "skill") return "技能";
  return "";
}

export function hasSummerText(def) {
  return def.text.includes("暑假");
}

function summerTooltip() {
  return `
    <span class="battle-keyword-tip" role="tooltip">
      <strong>暑假</strong>
      <span>持续到回合结束。本回合不能打出攻击牌。</span>
    </span>
  `;
}

export function cardReferenceKeys(card) {
  const def = cardDef(card);
  return CARD_REFERENCE_NAMES
    .filter(({ key, name }) => key !== card.key && def.text.includes(name))
    .map(({ key }) => key)
    .slice(0, 3);
}

function cardReferenceTooltip(card) {
  const refs = cardReferenceKeys(card);
  if (!refs.length) return "";
  return `
    <span class="card-reference-tip" role="tooltip">
      ${refs.map((key) => renderPileCard({ id: `ref-${card.id}-${key}`, key }, { showCardRefs: false })).join("")}
    </span>
  `;
}
