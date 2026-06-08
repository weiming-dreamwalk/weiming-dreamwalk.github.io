import { DESIGN_SIZE, SITES, STARTER_DECK_KEYS } from "./src/config.js";
import { BattleController } from "./src/battle.js";
import { EventController } from "./src/events.js";
import { ShopController } from "./src/shop.js";
import { fitStageToViewport } from "./src/layout.js";
import { CorruptionController } from "./src/corruption.js";
import { SiteController } from "./src/sites.js";
import { renderRelicBar } from "./src/relics.js";
import { ASSET_MANIFEST } from "./src/asset-manifest.js";

const stage = document.querySelector("#mapStage");
const layer = document.querySelector("#mapLayer");
const mapRelicMount = document.querySelector("#mapRelicMount");
const loadingScreen = document.querySelector("#loadingScreen");
const loadingText = document.querySelector("#loadingText");
const loadingBar = document.querySelector("#loadingBar");
const titlePage = document.querySelector("#titlePage");
const titleEnter = document.querySelector("#titleEnter");
const settingsOverlay = document.querySelector("#settingsOverlay");
const settingsClose = document.querySelector("#settingsClose");
const reducedEffectsToggle = document.querySelector("#reducedEffectsToggle");
const battleScene = document.querySelector("#battleScene");
const eventScene = document.querySelector("#eventScene");
const shopScene = document.querySelector("#shopScene");
let transitioning = false;
let titleVisible = false;
const createInitialRunState = ({ skipTutorial = false } = {}) => ({
  deckKeys: [...STARTER_DECK_KEYS],
  relics: [],
  completedSites: ["site_17"],
  shopFlags: {},
  shopRemoveCost: 2,
  skipTutorial,
  player: {
    hp: 80,
    maxHp: 80,
    mental: 6,
    maxMental: 12,
  },
});
const runState = createInitialRunState();

const corruption = new CorruptionController({
  designSize: DESIGN_SIZE,
  clipPath: document.querySelector("#corruptionClipPath"),
  clearingPath: document.querySelector("#corruptionClearingPath"),
  edgePath: document.querySelector("#corruptionEdge"),
  edgeGlowPath: document.querySelector("#corruptionEdgeGlow"),
});

const siteController = new SiteController({
  layer,
  sites: SITES,
  onSiteClick: handleSiteClick,
});

const battle = new BattleController({
  root: battleScene,
  runState,
  onComplete: () => {
    shop.markBattleCompleted();
    renderMapRelics();
    corruption.resumeIdle();
    transitioning = false;
  },
  onEnterShop: () => {
    shop.markBattleCompleted();
    renderMapRelics();
    corruption.pauseIdle();
    transitioning = true;
    shop.start();
  },
  onDefeatReturn: resetDream,
});

const events = new EventController({
  root: eventScene,
  runState,
  onComplete: () => {
    renderMapRelics();
    corruption.resumeIdle();
    transitioning = false;
  },
});

const shop = new ShopController({
  root: shopScene,
  runState,
  onComplete: () => {
    renderMapRelics();
    corruption.resumeIdle();
    transitioning = false;
  },
  onRestart: resetDream,
});

corruption.setStep(siteController.getCorruptionStep());
corruption.pauseIdle();
renderMapRelics();
bindTitlePage();
bindSettings();
void boot();

function renderMapRelics() {
  if (mapRelicMount) mapRelicMount.innerHTML = renderRelicBar(runState.relics);
}

function bindSettings() {
  const stored = localStorage.getItem("weiming-reduced-effects") === "1";
  setReducedEffects(stored);
  reducedEffectsToggle?.addEventListener("click", () => {
    setReducedEffects(!document.body.classList.contains("is-reduced-effects"));
  });
  settingsClose?.addEventListener("click", closeSettings);
  settingsOverlay?.addEventListener("click", (event) => {
    if (event.target === settingsOverlay) closeSettings();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (settingsOverlay?.hidden) openSettings();
    else closeSettings();
  });
}

function setReducedEffects(enabled) {
  document.body.classList.toggle("is-reduced-effects", enabled);
  localStorage.setItem("weiming-reduced-effects", enabled ? "1" : "0");
  if (!reducedEffectsToggle) return;
  reducedEffectsToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function openSettings() {
  if (!settingsOverlay) return;
  settingsOverlay.hidden = false;
  requestAnimationFrame(() => {
    settingsOverlay.classList.add("is-visible");
    reducedEffectsToggle?.focus({ preventScroll: true });
  });
}

function closeSettings() {
  if (!settingsOverlay) return;
  settingsOverlay.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!settingsOverlay.classList.contains("is-visible")) settingsOverlay.hidden = true;
  }, 180);
}

function resetDream() {
  Object.keys(runState).forEach((key) => {
    delete runState[key];
  });
  Object.assign(runState, createInitialRunState({ skipTutorial: true }));
  siteController.reset();
  renderMapRelics();
  corruption.setStep(siteController.getCorruptionStep());
  transitioning = false;
  battleScene.hidden = true;
  eventScene.hidden = true;
  shopScene.hidden = true;
  showTitlePage();
}

function bindTitlePage() {
  titlePage?.addEventListener("click", enterGameFromTitle);
  titleEnter?.addEventListener("click", enterGameFromTitle);
  titlePage?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      enterGameFromTitle();
    }
  });
}

function showTitlePage() {
  if (!titlePage) return;
  titleVisible = true;
  transitioning = false;
  corruption.pauseIdle();
  titlePage.hidden = false;
  titlePage.setAttribute("tabindex", "0");
  requestAnimationFrame(() => {
    titlePage.classList.add("is-visible");
    titleEnter?.focus({ preventScroll: true });
  });
}

async function boot() {
  updateLoadingProgress(0);
  try {
    await preloadAssets(ASSET_MANIFEST, updateLoadingProgress);
    await document.fonts?.ready;
  } catch (error) {
    console.warn("资源预加载未完全完成，继续进入标题页。", error);
  } finally {
    updateLoadingProgress(1);
    window.setTimeout(() => {
      hideLoadingScreen();
      showTitlePage();
    }, 220);
  }
}

function hideLoadingScreen() {
  if (!loadingScreen) return;
  loadingScreen.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!loadingScreen.classList.contains("is-visible")) loadingScreen.hidden = true;
  }, 380);
}

function updateLoadingProgress(progress) {
  const normalized = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const percent = Math.round(normalized * 100);
  if (loadingBar) loadingBar.style.setProperty("--loading-progress", `${percent}%`);
  if (loadingText) loadingText.textContent = `正在载入梦境 ${percent}%`;
}

async function preloadAssets(assets, onProgress) {
  const totalBytes = assets.reduce((total, asset) => total + (asset.size || 1), 0) || 1;
  let loadedBytes = 0;
  let cursor = 0;
  const concurrency = 4;
  const report = () => onProgress?.(loadedBytes / totalBytes);

  async function worker() {
    while (cursor < assets.length) {
      const asset = assets[cursor];
      cursor += 1;
      await preloadAsset(asset, (delta) => {
        loadedBytes += delta;
        report();
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function preloadAsset(asset, onChunk) {
  const expectedSize = asset.size || 1;
  let loaded = 0;
  const finish = () => {
    if (loaded < expectedSize) {
      onChunk(expectedSize - loaded);
      loaded = expectedSize;
    }
  };

  try {
    const response = await fetch(asset.url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`${response.status} ${asset.url}`);
    if (!response.body?.getReader) {
      await response.arrayBuffer();
      finish();
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkSize = value?.byteLength || 0;
      loaded += chunkSize;
      onChunk(chunkSize);
    }
    finish();
  } catch (error) {
    console.warn(`资源加载失败：${asset.url}`, error);
    finish();
  }
}

function enterGameFromTitle() {
  if (!titlePage || !titleVisible) return;
  titleVisible = false;
  titlePage.classList.remove("is-visible");
  window.setTimeout(() => {
    if (!titleVisible) titlePage.hidden = true;
  }, 430);
  corruption.resumeIdle();
  layout();
}

async function handleSiteClick(clickedSite) {
  if (transitioning || titleVisible) return;
  if (!siteController.canSelect(clickedSite)) return;
  if (clickedSite.shop) {
    transitioning = true;
    corruption.pauseIdle();
    shop.start();
    return;
  }

  const nextSite = siteController.getNextSequenceSite();
  if (!nextSite || clickedSite.id !== nextSite.id) return;

  transitioning = true;
  await corruption.expandToStep(nextSite.sequence);
  siteController.markCorrupted(nextSite.id);
  if (!runState.completedSites.includes(nextSite.id)) runState.completedSites.push(nextSite.id);
  if (clickedSite.battle) {
    corruption.pauseIdle();
    battle.start(clickedSite.battle);
    return;
  }
  if (clickedSite.event) {
    corruption.pauseIdle();
    events.start(clickedSite.event);
    return;
  }
  transitioning = false;
}

function layout() {
  fitStageToViewport(stage, DESIGN_SIZE);
}

window.addEventListener("resize", layout);
layout();
