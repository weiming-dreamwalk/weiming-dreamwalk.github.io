import { SITE_RENDER_SCALE } from "./config.js";

const BASE_TILT = {
  rx: "5deg",
  ry: "-4deg",
  mx: "50%",
  my: "50%",
};

export class SiteController {
  constructor({ layer, sites, onSiteClick }) {
    this.layer = layer;
    this.sites = sites.map((site) => ({
      ...site,
      corrupted: Boolean(site.initialCorrupted),
    }));
    this.sequenceSites = this.sites
      .filter((site) => Number.isFinite(site.sequence))
      .sort((a, b) => a.sequence - b.sequence);
    this.cards = new Map();
    this.arrows = [];
    this.onSiteClick = onSiteClick;
    this.interactionLocked = false;

    this.renderArrows();
    this.render();
    this.updateAvailability();
  }

  renderArrows() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("flow-arrow-layer");
    svg.setAttribute("viewBox", "0 0 1396 785");
    svg.setAttribute("aria-hidden", "true");

    for (let index = 0; index < this.sequenceSites.length - 1; index += 1) {
      const from = this.sequenceSites[index];
      const to = this.sequenceSites[index + 1];
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const shadow = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const path = createArrowPath(from, to, index);

      group.classList.add("flow-arrow");
      group.dataset.from = from.id;
      group.dataset.to = to.id;
      shadow.classList.add("flow-arrow-shadow");
      shadow.setAttribute("d", path);
      line.classList.add("flow-arrow-line");
      line.setAttribute("d", path);

      group.append(shadow, line);
      svg.append(group);
      this.arrows.push({ group, from, to });
    }

    this.layer.append(svg);
  }

  render() {
    this.sites.forEach((site) => {
      const card = document.createElement("button");
      card.className = "site-card";
      card.type = "button";
      card.dataset.site = site.id;
      card.setAttribute("aria-label", site.label || `关卡 ${site.id.replace("site_", "")}`);

      card.style.left = `${site.x}px`;
      card.style.top = `${site.y}px`;
      card.style.setProperty("--site-width", `${site.width * SITE_RENDER_SCALE * getIconScale(site)}px`);
      card.style.setProperty("--site-height", `${site.height * SITE_RENDER_SCALE * getIconScale(site)}px`);
      card.style.setProperty("--mask-image", `url("./assets/sites/${site.id}.png")`);

      const image = document.createElement("img");
      image.src = `./assets/sites/${site.id}.png`;
      image.alt = "";
      image.draggable = false;
      card.append(image);

      card.addEventListener("pointerenter", (event) => this.hoverSite(event));
      card.addEventListener("pointermove", (event) => this.tiltSite(event));
      card.addEventListener("pointerleave", (event) => this.resetSite(event));
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (card.disabled || !this.canSelect(site)) return;
        this.onSiteClick(site);
      });

      this.layer.append(card);
      this.cards.set(site.id, card);
    });
  }

  getNextSequenceSite() {
    return this.sequenceSites.find((site) => !site.corrupted);
  }

  isShopUnlocked(site) {
    if (!site.shop) return true;
    if (!site.shopUnlockAfter) return true;
    return Boolean(this.sites.find((item) => item.id === site.shopUnlockAfter)?.corrupted);
  }

  canSelect(site) {
    if (this.interactionLocked) return false;
    if (site.shop) return this.isShopUnlocked(site);
    return this.getNextSequenceSite()?.id === site.id;
  }

  setInteractionLocked(locked) {
    this.interactionLocked = Boolean(locked);
    this.updateAvailability();
  }

  getCorruptionStep() {
    return this.sequenceSites.reduce((step, site) => {
      if (!site.corrupted) return step;
      return Math.max(step, site.sequence);
    }, 0);
  }

  markCorrupted(siteId) {
    const site = this.sites.find((item) => item.id === siteId);
    const card = this.cards.get(siteId);
    if (!site || !card) return;

    site.corrupted = true;
    card.classList.remove("is-hovered");
    card.classList.add("is-corrupted");
    card.setAttribute("aria-disabled", "true");
    this.setTilt(card, BASE_TILT);
    this.updateAvailability();
  }

  reset() {
    this.sites.forEach((site) => {
      site.corrupted = Boolean(site.initialCorrupted);
      const card = this.cards.get(site.id);
      if (!card) return;

      card.classList.remove("is-hovered", "is-corrupted", "is-current", "is-locked");
      this.setTilt(card, BASE_TILT);
    });

    this.updateAvailability();
  }

  updateAvailability() {
    const nextSite = this.getNextSequenceSite();
    const corruptedStep = this.getCorruptionStep();

    this.sites.forEach((site) => {
      const card = this.cards.get(site.id);
      if (!card) return;

      const selectable = !this.interactionLocked && (
        site.shop
          ? this.isShopUnlocked(site)
          : (!site.corrupted && nextSite?.id === site.id)
      );

      card.disabled = !selectable || site.corrupted;
      card.classList.toggle("is-shop", Boolean(site.shop));
      card.classList.toggle("is-available", selectable && !site.corrupted);
      card.classList.toggle("is-current", !site.shop && !site.corrupted && nextSite?.id === site.id);
      card.classList.toggle("is-locked", !site.corrupted && !selectable);

      if (site.corrupted) {
        card.classList.add("is-corrupted");
        card.setAttribute("aria-disabled", "true");
      } else {
        card.classList.remove("is-corrupted");
        card.setAttribute("aria-disabled", selectable ? "false" : "true");
      }
    });

    this.arrows.forEach(({ group, from, to }) => {
      group.classList.toggle("is-done", to.sequence <= corruptedStep);
      group.classList.toggle("is-current", from.corrupted && nextSite?.id === to.id);
      group.classList.toggle("is-locked", !from.corrupted || nextSite?.id !== to.id);
    });
  }

  hoverSite(event) {
    const card = event.currentTarget;
    if (card.disabled) return;

    card.classList.add("is-hovered");
    this.tiltSite(event);
  }

  tiltSite(event) {
    const card = event.currentTarget;
    if (card.disabled) return;

    const rect = card.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    this.setTilt(card, {
      rx: `${((0.5 - py) * 16).toFixed(2)}deg`,
      ry: `${((px - 0.5) * 18).toFixed(2)}deg`,
      mx: `${(px * 100).toFixed(1)}%`,
      my: `${(py * 100).toFixed(1)}%`,
    });
  }

  resetSite(event) {
    const card = event.currentTarget;
    if (card.disabled) return;

    card.classList.remove("is-hovered");
    this.setTilt(card, BASE_TILT);
  }

  setTilt(card, values) {
    card.style.setProperty("--rx", values.rx);
    card.style.setProperty("--ry", values.ry);
    card.style.setProperty("--mx", values.mx);
    card.style.setProperty("--my", values.my);
  }
}

function createArrowPath(from, to, index) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const start = {
    x: from.x,
    y: from.y,
  };
  const end = {
    x: to.x,
    y: to.y,
  };
  const bend = getArrowBend(index, distance);
  const nx = -uy;
  const ny = ux;
  const c1 = {
    x: start.x + dx * 0.36 + nx * bend,
    y: start.y + dy * 0.36 + ny * bend,
  };
  const c2 = {
    x: start.x + dx * 0.64 + nx * bend,
    y: start.y + dy * 0.64 + ny * bend,
  };

  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}`,
    `${c2.x.toFixed(2)} ${c2.y.toFixed(2)}`,
    `${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
  ].join(" ");
}

function getArrowBend(index, distance) {
  const directions = [-1, -0.55, 0.72, -0.9, -0.72, 0.58, 0.82];
  return directions[index % directions.length] * Math.min(90, Math.max(26, distance * 0.16));
}

function getIconScale(site) {
  return site.iconScale ?? 1;
}
