import { ADVANCED_RELIC_POOL, CARD_DEFS, EVENT_DEFS, RELIC_DEFS } from "./config.js";
import { renderPileCard } from "./battle/templates.js";
import { escapeHtml, shuffle, wait } from "./battle/utils.js";

const EVENT_CARD_REFERENCE_NAMES = Object.entries(CARD_DEFS)
  .map(([key, def]) => ({ key, name: def.name }))
  .sort((a, b) => b.name.length - a.name.length);

export class EventController {
  constructor({ root, runState, onComplete = null }) {
    this.root = root;
    this.runState = runState;
    this.onComplete = onComplete;
    this.eventDef = null;
  }

  async start(eventKey) {
    this.eventDef = EVENT_DEFS[eventKey];
    if (!this.eventDef) {
      this.onComplete?.();
      return;
    }

    this.root.hidden = false;
    this.root.innerHTML = this.renderEvent();
    this.root.querySelectorAll("[data-event-choice]").forEach((button) => {
      button.addEventListener("click", () => this.choose(Number(button.dataset.eventChoice)));
    });
    await wait(20);
    this.root.classList.add("is-active");
  }

  renderEvent() {
    return `
      <div class="event-bg" style="--event-bg: url('${this.eventDef.background}')" aria-hidden="true"></div>
      <section class="event-panel">
        <header>
          <h1>${escapeHtml(this.eventDef.title)}</h1>
          <p>${escapeHtml(this.eventDef.text)}</p>
        </header>
        <div class="event-choice-list">
          ${this.eventDef.choices.map((choice, index) => this.renderChoice(choice, index)).join("")}
        </div>
      </section>
    `;
  }

  renderChoice(choice, index) {
    const refs = this.cardRefsInText(`${choice.detail || ""} ${choice.quote || ""}`);
    return `
      <button class="event-choice" type="button" data-event-choice="${index}">
        <span class="event-choice-copy">
          <strong>${escapeHtml(choice.label)}</strong>
          ${choice.quote ? `<em>${escapeHtml(choice.quote)}</em>` : ""}
          <span>${escapeHtml(choice.detail)}</span>
        </span>
        ${refs.length ? `
          <span class="event-choice-card-refs" aria-label="相关卡牌">
            ${refs.map((key) => renderPileCard({ id: `event-ref-${key}`, key })).join("")}
          </span>
        ` : ""}
      </button>
    `;
  }

  cardRefsInText(text = "") {
    const refs = new Set();
    EVENT_CARD_REFERENCE_NAMES.forEach(({ key, name }) => {
      if (text.includes(name)) refs.add(key);
    });
    return [...refs].slice(0, 3);
  }

  async choose(index) {
    const choice = this.eventDef.choices[index];
    if (!choice) return;
    this.root.querySelectorAll("[data-event-choice]").forEach((button) => {
      button.disabled = true;
    });

    for (const effect of choice.effects) {
      await this.applyEffect(effect);
    }
    await this.leaveEvent();
  }

  async applyEffect(effect) {
    const player = this.runState.player;
    if (effect.type === "gainMental") {
      player.mental = Math.min(player.maxMental, player.mental + effect.amount);
      return;
    }
    if (effect.type === "loseMental") {
      player.mental = Math.max(0, player.mental - effect.amount);
      return;
    }
    if (effect.type === "gainHp") {
      player.hp = Math.min(player.maxHp, player.hp + effect.amount);
      return;
    }
    if (effect.type === "loseHp") {
      player.hp = Math.max(0, player.hp - effect.amount);
      return;
    }
    if (effect.type === "gainMaxMental") {
      player.maxMental += effect.amount;
      return;
    }
    if (effect.type === "loseMaxMental") {
      player.maxMental = Math.max(1, player.maxMental - effect.amount);
      player.mental = Math.min(player.mental, player.maxMental);
      return;
    }
    if (effect.type === "healFull") {
      player.hp = player.maxHp;
      return;
    }
    if (effect.type === "loseAllMental") {
      player.mental = 0;
      return;
    }
    if (effect.type === "gainNextBattleBlock") {
      this.runState.nextBattleBlock = (this.runState.nextBattleBlock || 0) + effect.amount;
      return;
    }
    if (effect.type === "addCard") {
      const count = effect.count || 1;
      for (let index = 0; index < count; index += 1) {
        this.runState.deckKeys.push(effect.key);
      }
      return;
    }
    if (effect.type === "removeCard") {
      await this.chooseCardToRemove();
      return;
    }
    if (effect.type === "removeUpToCards") {
      await this.chooseCardsToRemove(effect.count || 1);
      return;
    }
    if (effect.type === "gainRandomAdvancedRelics") {
      this.gainRandomRelics(ADVANCED_RELIC_POOL, effect.count || 1);
    }
  }

  chooseCardToRemove() {
    if (!this.runState.deckKeys.length) return Promise.resolve();
    const cards = this.runState.deckKeys.map((key, index) => ({ id: `event-remove-${index}`, key, index }));
    const selector = document.createElement("section");
    selector.className = "event-remove-panel";
    selector.innerHTML = `
      <div class="event-remove-dialog">
        <h2>删除 1 张牌</h2>
        <div class="event-remove-grid">
          ${cards.map((card) => `
            <button type="button" data-remove-index="${card.index}" aria-label="删除 ${escapeHtml(CARD_DEFS[card.key]?.name || card.key)}">
              ${renderPileCard(card)}
            </button>
          `).join("")}
        </div>
      </div>
    `;
    this.root.append(selector);

    return new Promise((resolve) => {
      selector.addEventListener("click", (event) => {
        const button = event.target.closest("[data-remove-index]");
        if (!button) return;
        const index = Number(button.dataset.removeIndex);
        if (Number.isFinite(index)) this.runState.deckKeys.splice(index, 1);
        selector.remove();
        resolve();
      });
    });
  }

  chooseCardsToRemove(maxCount = 1) {
    if (!this.runState.deckKeys.length || maxCount <= 0) return Promise.resolve();
    const cards = this.runState.deckKeys.map((key, index) => ({ id: `event-remove-many-${index}`, key, index }));
    const selector = document.createElement("section");
    selector.className = "event-remove-panel";
    selector.innerHTML = `
      <div class="event-remove-dialog">
        <h2>删除至多 ${maxCount} 张牌</h2>
        <div class="event-remove-grid">
          ${cards.map((card) => `
            <button type="button" data-remove-index="${card.index}" aria-label="选择 ${escapeHtml(CARD_DEFS[card.key]?.name || card.key)}">
              ${renderPileCard(card)}
            </button>
          `).join("")}
        </div>
        <div class="event-remove-actions">
          <button type="button" data-confirm-remove>确认</button>
          <button type="button" data-skip-remove>不删除</button>
        </div>
      </div>
    `;
    this.root.append(selector);

    return new Promise((resolve) => {
      const selected = new Set();
      selector.addEventListener("click", (event) => {
        const cardButton = event.target.closest("[data-remove-index]");
        if (cardButton) {
          const index = Number(cardButton.dataset.removeIndex);
          if (!Number.isFinite(index)) return;
          if (selected.has(index)) {
            selected.delete(index);
          } else if (selected.size < maxCount) {
            selected.add(index);
          }
          cardButton.classList.toggle("is-selected", selected.has(index));
          return;
        }
        if (event.target.closest("[data-confirm-remove]")) {
          [...selected].sort((a, b) => b - a).forEach((index) => this.runState.deckKeys.splice(index, 1));
          selector.remove();
          resolve();
          return;
        }
        if (event.target.closest("[data-skip-remove]")) {
          selector.remove();
          resolve();
        }
      });
    });
  }

  gainRandomRelics(pool, count) {
    const candidates = shuffle(pool.filter((key) => RELIC_DEFS[key] && !this.runState.relics.includes(key)));
    candidates.slice(0, count).forEach((key) => this.runState.relics.push(key));
  }

  async leaveEvent() {
    this.root.classList.remove("is-active");
    await wait(360);
    this.root.hidden = true;
    this.root.innerHTML = "";
    this.onComplete?.();
  }
}
