import { CARD_DEFS, SHOP_CARD_POOL } from "./config.js";
import { renderPileCard } from "./battle/templates.js";
import { renderRelicBar } from "./relics.js";
import {
  battleCorruptionBoundary,
  drawBattleCorruptionParticles,
  drawCoverImage,
} from "./battle/corruption.js";
import { escapeHtml, shuffle, wait } from "./battle/utils.js";

const RARITY_LABELS = {
  common: "普通",
  build: "构筑",
  rare: "稀有",
};
const SHOP_CORRUPTION_FRAME_INTERVAL = 50;
const SHOP_CORRUPTION_DPR_CAP = 0.85;

export class ShopController {
  constructor({ root, runState, onComplete = null, onRestart = null }) {
    this.root = root;
    this.runState = runState;
    this.onComplete = onComplete;
    this.onRestart = onRestart;
    this.corruptionFrame = 0;
    this.corruptionImage = null;
    this.corruptionDisplay = 0;
    this.corruptionLastDraw = 0;
  }

  async start() {
    if (this.isRunComplete()) {
      await this.startEnding();
      return;
    }

    this.ensureShopState();
    this.root.hidden = false;
    this.root.classList.remove("is-ending-shop");
    this.root.innerHTML = this.renderShop();
    this.cacheElements();
    this.bindEvents();
    this.startCorruption();
    if (this.runState.shopState.needsRefresh || !this.runState.shopState.offers.length) {
      this.resetShelfAfterBattle();
    } else {
      this.message.textContent = "书架将在下一场战斗后刷新";
      this.render();
    }
    await wait(20);
    this.root.classList.add("is-active");
  }

  async startEnding() {
    this.root.hidden = false;
    this.root.classList.add("is-ending-shop");
    this.root.innerHTML = this.renderEnding();
    this.corruptionCanvas = this.root.querySelector("#shopCorruptionCanvas");
    this.root.querySelector("#shopRestartDream")?.addEventListener("click", () => this.restartDream());
    this.startCorruption();
    await wait(20);
    this.root.classList.add("is-active");
  }

  cacheElements() {
    this.corruptionCanvas = this.root.querySelector("#shopCorruptionCanvas");
    this.mentalValue = this.root.querySelector("#shopMentalValue");
    this.deckCount = this.root.querySelector("#shopDeckCount");
    this.shelf = this.root.querySelector("#shopShelf");
    this.refreshButton = this.root.querySelector("#shopRefresh");
    this.removeButton = this.root.querySelector("#shopRemove");
    this.leaveButton = this.root.querySelector("#shopLeave");
    this.message = this.root.querySelector("#shopMessage");
    this.deckOverlay = this.root.querySelector("#shopDeckOverlay");
    this.deckOverlayGrid = this.root.querySelector("#shopDeckOverlayGrid");
    this.relicMount = this.root.querySelector("#shopRelicMount");
  }

  bindEvents() {
    this.shelf.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-shop-buy]");
      if (button) await this.buyOffer(button.dataset.shopBuy);
    });
    this.refreshButton.addEventListener("click", () => this.refreshShelf());
    this.removeButton.addEventListener("click", () => this.chooseCardToRemove());
    this.leaveButton.addEventListener("click", () => this.leaveShop());
    this.deckCount.addEventListener("click", () => this.showDeckOverlay());
    this.deckOverlay.addEventListener("click", (event) => {
      if (event.target === this.deckOverlay || event.target.closest("[data-close-shop-deck]")) {
        this.hideDeckOverlay();
      }
    });
  }

  isRunComplete() {
    return this.runState.completedSites?.includes("site_23");
  }

  renderShop() {
    return `
      <div class="shop-bg" aria-hidden="true"></div>
      <canvas class="shop-corruption-canvas" id="shopCorruptionCanvas" aria-hidden="true"></canvas>
      <div class="shop-relic-mount" id="shopRelicMount">${renderRelicBar(this.runState.relics)}</div>
      <section class="shop-panel">
        <header>
          <span>图书馆</span>
          <h1>书架</h1>
        </header>
        <div class="shop-status">
          <strong id="shopMentalValue">精神 0 / 0</strong>
          <button type="button" id="shopDeckCount">牌组 0</button>
        </div>
        <div class="shop-shelf" id="shopShelf"></div>
        <footer class="shop-actions">
          <button type="button" id="shopRefresh">刷新书架</button>
          <button type="button" id="shopRemove">删除一张牌</button>
          <button type="button" id="shopLeave">离开</button>
        </footer>
        <div class="shop-message" id="shopMessage" aria-live="polite"></div>
      </section>
      <div class="shop-deck-overlay" id="shopDeckOverlay" hidden>
        <section class="shop-deck-dialog" role="dialog" aria-modal="true" aria-labelledby="shopDeckOverlayTitle">
          <header>
            <h2 id="shopDeckOverlayTitle">当前牌组</h2>
            <button type="button" data-close-shop-deck aria-label="关闭牌组">×</button>
          </header>
          <div class="shop-deck-grid" id="shopDeckOverlayGrid"></div>
        </section>
      </div>
    `;
  }

  renderEnding() {
    return `
      <div class="shop-bg" aria-hidden="true"></div>
      <canvas class="shop-corruption-canvas" id="shopCorruptionCanvas" aria-hidden="true"></canvas>
      <section class="shop-panel shop-ending-panel">
        <header>
          <span>图书馆</span>
          <h1>哈，你竟然通关了！</h1>
        </header>
        <p>作者还没想好这里要放什么剧情，但我们还能继续下一轮体验</p>
        <button class="shop-ending-restart" id="shopRestartDream" type="button">重回梦境</button>
      </section>
    `;
  }

  render() {
    const player = this.runState.player;
    this.mentalValue.textContent = `精神 ${player.mental} / ${player.maxMental}`;
    this.deckCount.textContent = `牌组 ${this.runState.deckKeys.length}`;
    const refreshCost = this.refreshCost();
    const removeCost = this.runState.shopRemoveCost ?? 2;

    this.refreshButton.textContent = `刷新书架 ${refreshCost} 精神`;
    this.refreshButton.disabled = player.mental < refreshCost || !this.availableCards().length;
    this.removeButton.textContent = `删除一张牌 ${removeCost} 精神`;
    this.removeButton.disabled = player.mental < removeCost || !this.runState.deckKeys.length;

    const offers = this.runState.shopState.offers;
    this.shelf.innerHTML = offers.length
      ? offers.map((offer) => this.renderOffer(offer)).join("")
      : '<p class="shop-empty">这次访问中，书架已经没有新牌了</p>';
  }

  renderOffer(offer) {
    const def = CARD_DEFS[offer.key];
    const affordable = this.runState.player.mental >= offer.cost;
    return `
      <article class="shop-offer ${offer.rarity}" data-shop-offer="${escapeHtml(offer.key)}">
        <div class="shop-offer-card">
          ${renderPileCard({ id: `shop-${offer.key}`, key: offer.key })}
        </div>
        <div class="shop-offer-info">
          <strong>${escapeHtml(def.name)}</strong>
          <span>${escapeHtml(RARITY_LABELS[offer.rarity])}牌</span>
          <em>${offer.cost} 精神</em>
          <button type="button" data-shop-buy="${escapeHtml(offer.key)}" ${affordable ? "" : "disabled"}>
            ${affordable ? "购买" : "精神不足"}
          </button>
        </div>
      </article>
    `;
  }

  async refreshShelf({ free = false, markSkipped = true, animate = true } = {}) {
    const cost = free ? 0 : this.refreshCost();
    if (this.runState.player.mental < cost) return;
    const previousMental = this.runState.player.mental;
    this.runState.player.mental -= cost;
    if (!free && this.hasRelic("old_campus_card") && !this.runState.shopFlags.old_campus_card_refresh_used) {
      this.runState.shopFlags.old_campus_card_refresh_used = true;
      this.flashRelic("old_campus_card");
    }
    if (animate) {
      this.shelf.classList.add("is-refreshing");
      await wait(260);
    }
    this.runState.shopState.offers = this.drawShelf();
    this.runState.shopState.needsRefresh = false;
    this.message.textContent = "书架将在下一场战斗后刷新";
    this.render();
    if (cost) this.animateMentalChange(this.runState.player.mental - previousMental);
    if (animate) {
      await wait(20);
      this.shelf.classList.remove("is-refreshing");
      this.shelf.classList.add("is-entering");
      window.setTimeout(() => this.shelf?.classList.remove("is-entering"), 520);
    }
  }

  drawShelf() {
    const available = this.availableCards();
    const common = shuffle(available.filter((card) => card.rarity === "common"));
    const selected = [];
    const selectedKeys = new Set();
    let rareAdded = false;

    if (common.length) {
      selected.push(common[0]);
      selectedKeys.add(common[0].key);
    }

    for (const card of shuffle(available.filter((item) => !selectedKeys.has(item.key)))) {
      if (selected.length >= 5) break;
      if (card.rarity === "rare") {
        if (rareAdded) continue;
        rareAdded = true;
      }
      selected.push(card);
      selectedKeys.add(card.key);
    }

    return selected;
  }

  availableCards() {
    return Object.entries(SHOP_CARD_POOL)
      .flatMap(([rarity, cards]) => cards.map((card) => ({ ...card, rarity })))
      .filter((card) => card.rarity !== "rare" || !this.runState.shopState.boughtRareKeys.includes(card.key))
      .filter((card) => !card.unlockAfterSite || this.runState.completedSites?.includes(card.unlockAfterSite));
  }

  async buyOffer(key) {
    const offer = this.runState.shopState.offers.find((item) => item.key === key);
    if (!offer || this.runState.player.mental < offer.cost) return;
    const cardEl = this.shelf.querySelector(`[data-shop-offer="${CSS.escape(key)}"]`);
    if (cardEl) {
      cardEl.classList.add("is-buying");
      await wait(260);
    }
    const previousMental = this.runState.player.mental;
    this.runState.player.mental -= offer.cost;
    this.runState.deckKeys.push(offer.key);
    if (offer.rarity === "rare") {
      this.runState.shopState.boughtRareKeys.push(offer.key);
      this.runState.shopState.boughtRareKeys = [...new Set(this.runState.shopState.boughtRareKeys)];
    }
    this.runState.shopState.offers = this.runState.shopState.offers.filter((item) => item.key !== key);
    this.message.textContent = `购买 ${CARD_DEFS[offer.key].name}`;
    this.render();
    this.animateMentalChange(this.runState.player.mental - previousMental);
  }

  refreshCost() {
    if (this.hasRelic("old_campus_card") && !this.runState.shopFlags?.old_campus_card_refresh_used) return 0;
    return 1;
  }

  hasRelic(key) {
    return this.runState.relics?.includes(key);
  }

  flashRelic(key) {
    if (!key || !this.relicMount) return;
    const token = this.relicMount.querySelector(`[data-relic-key="${CSS.escape(key)}"]`);
    if (!token) return;
    token.classList.remove("is-triggering");
    void token.offsetWidth;
    token.classList.add("is-triggering");
    window.setTimeout(() => token.classList.remove("is-triggering"), 900);
  }

  chooseCardToRemove() {
    const cost = this.runState.shopRemoveCost ?? 2;
    if (this.runState.player.mental < cost || !this.runState.deckKeys.length) return;

    const cards = this.runState.deckKeys.map((key, index) => ({ id: `shop-remove-${index}`, key, index }));
    const selector = document.createElement("section");
    selector.className = "shop-remove-panel";
    selector.innerHTML = `
      <div class="shop-remove-dialog">
        <h2>删除 1 张牌</h2>
        <div class="shop-remove-grid">
          ${cards.map((card) => `
            <button type="button" data-remove-index="${card.index}" aria-label="删除 ${escapeHtml(CARD_DEFS[card.key]?.name || card.key)}">
              ${renderPileCard(card)}
            </button>
          `).join("")}
        </div>
      </div>
    `;
    this.root.append(selector);

    selector.addEventListener("click", (event) => {
      if (event.target === selector) {
        selector.remove();
        return;
      }
      const button = event.target.closest("[data-remove-index]");
      if (!button) return;
      const index = Number(button.dataset.removeIndex);
      if (!Number.isFinite(index)) return;
      const [removed] = this.runState.deckKeys.splice(index, 1);
      const previousMental = this.runState.player.mental;
      this.runState.player.mental -= cost;
      this.runState.shopRemoveCost = cost + 1;
      this.message.textContent = `删除 ${CARD_DEFS[removed]?.name || "牌"}`;
      selector.remove();
      this.render();
      this.animateMentalChange(this.runState.player.mental - previousMental);
    });
  }

  ensureShopState() {
    this.runState.shopFlags ||= {};
    this.runState.shopRemoveCost ??= 2;
    this.runState.shopState ||= {
      offers: [],
      seenKeys: [],
      boughtRareKeys: [],
      needsRefresh: true,
    };
    this.runState.shopState.offers ||= [];
    this.runState.shopState.seenKeys ||= [];
    this.runState.shopState.boughtRareKeys ||= [];
    this.runState.shopState.needsRefresh ??= true;
  }

  resetShelfAfterBattle() {
    this.generateFreshShelfState();
    this.message.textContent = "书架将在下一场战斗后刷新";
    this.render();
  }

  markBattleCompleted() {
    this.ensureShopState();
    this.generateFreshShelfState();
  }

  generateFreshShelfState() {
    this.runState.shopFlags ||= {};
    this.runState.shopFlags.old_campus_card_refresh_used = false;
    this.runState.shopState.offers = [];
    this.runState.shopState.seenKeys = [];
    this.runState.shopState.needsRefresh = false;
    this.runState.shopState.offers = this.drawShelf();
  }

  animateMentalChange(delta) {
    if (!delta || !this.mentalValue) return;
    this.mentalValue.classList.remove("is-changing");
    void this.mentalValue.offsetWidth;
    this.mentalValue.classList.add("is-changing");
    const label = document.createElement("span");
    label.className = "shop-mental-float";
    label.textContent = delta > 0 ? `+${delta}` : String(delta);
    this.mentalValue.append(label);
    window.setTimeout(() => label.remove(), 860);
  }

  showDeckOverlay() {
    if (!this.deckOverlay || !this.deckOverlayGrid) return;
    const cards = this.runState.deckKeys.map((key, index) => ({ id: `shop-deck-${index}`, key }));
    this.deckOverlayGrid.innerHTML = cards.length
      ? cards.map((card) => renderPileCard(card)).join("")
      : '<p class="shop-empty">牌组为空</p>';
    this.deckOverlay.hidden = false;
    requestAnimationFrame(() => this.deckOverlay.classList.add("is-visible"));
  }

  hideDeckOverlay() {
    if (!this.deckOverlay) return;
    this.deckOverlay.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!this.deckOverlay.classList.contains("is-visible")) this.deckOverlay.hidden = true;
    }, 220);
  }

  async leaveShop() {
    this.stopCorruption();
    this.root.classList.remove("is-active", "is-ending-shop");
    await wait(360);
    this.root.hidden = true;
    this.root.innerHTML = "";
    this.onComplete?.();
  }

  async restartDream() {
    this.stopCorruption();
    this.root.classList.remove("is-active", "is-ending-shop");
    await wait(360);
    this.root.hidden = true;
    this.root.innerHTML = "";
    this.onRestart?.();
  }

  startCorruption() {
    this.stopCorruption();
    const player = this.runState.player || { hp: 80, maxHp: 80 };
    this.corruptionDisplay = this.shopCorruptionTarget(player);
    this.corruptionLastDraw = 0;
    this.corruptionImage = new Image();
    this.corruptionImage.src = "./assets/scenes/stage_01/bg-1.png";
    this.corruptionFrame = requestAnimationFrame((now) => this.drawCorruption(now));
  }

  stopCorruption() {
    if (!this.corruptionFrame) return;
    cancelAnimationFrame(this.corruptionFrame);
    this.corruptionFrame = 0;
  }

  shopCorruptionTarget(player = this.runState.player || { hp: 80, maxHp: 80 }) {
    const raw = player.hp <= 0 ? 1 : Math.max(0, Math.min(1, 1 - player.hp / player.maxHp));
    return Math.min(0.72, raw);
  }

  drawCorruption(now) {
    if (!this.corruptionCanvas || !this.corruptionImage) return;
    if (this.corruptionLastDraw && now - this.corruptionLastDraw < SHOP_CORRUPTION_FRAME_INTERVAL) {
      this.corruptionFrame = requestAnimationFrame((time) => this.drawCorruption(time));
      return;
    }
    this.corruptionLastDraw = now;

    const cssWidth = this.corruptionCanvas.clientWidth;
    const cssHeight = this.corruptionCanvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) {
      this.corruptionFrame = requestAnimationFrame((time) => this.drawCorruption(time));
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, SHOP_CORRUPTION_DPR_CAP);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.corruptionCanvas.width !== width || this.corruptionCanvas.height !== height) {
      this.corruptionCanvas.width = width;
      this.corruptionCanvas.height = height;
    }

    const ctx = this.corruptionCanvas.getContext("2d");
    const player = this.runState.player || { hp: 80, maxHp: 80 };
    const target = this.shopCorruptionTarget(player);
    this.corruptionDisplay += (target - this.corruptionDisplay) * 0.08;

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

    this.corruptionFrame = requestAnimationFrame((time) => this.drawCorruption(time));
  }
}
