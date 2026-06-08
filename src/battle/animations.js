import { centerOf, smoothTiming, wait } from "./utils.js";

const CARD_ANIMATION_MS = 340;

export async function animateFromPile(pileEl, cardEl, delay = 0) {
  if (!pileEl || !cardEl) return;
  const from = centerOf(pileEl);
  const to = centerOf(cardEl);
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const style = getComputedStyle(cardEl);
  const handX = parseFloat(style.getPropertyValue("--hand-x")) || 0;
  const handY = parseFloat(style.getPropertyValue("--hand-y")) || 0;
  const handRot = style.getPropertyValue("--hand-rot").trim() || "0deg";

  let animation = null;
  try {
    animation = cardEl.animate(
      [
        {
          opacity: 0,
          transform: `translate3d(${handX + dx}px, ${handY + dy}px, 0) rotate(-9deg) scale(0.68)`,
        },
        {
          opacity: 1,
          transform: `translate3d(${handX}px, ${handY}px, 0) rotate(${handRot}) scale(1)`,
        },
      ],
      {
        ...smoothTiming(CARD_ANIMATION_MS),
        delay,
      },
    );
    await animation.finished;
  } finally {
    if (animation) animation.cancel();
  }
}

export async function animateRetainedCard(cardEl, dx, dy) {
  if (!cardEl || (!dx && !dy)) return;
  const style = getComputedStyle(cardEl);
  const handX = parseFloat(style.getPropertyValue("--hand-x")) || 0;
  const handY = parseFloat(style.getPropertyValue("--hand-y")) || 0;
  const handRot = style.getPropertyValue("--hand-rot").trim() || "0deg";
  let animation = null;

  try {
    animation = cardEl.animate(
      [
        {
          transform: `translate3d(${handX + dx}px, ${handY + dy}px, 0) rotate(${handRot}) scale(1)`,
        },
        {
          transform: `translate3d(${handX}px, ${handY}px, 0) rotate(${handRot}) scale(1)`,
        },
      ],
      smoothTiming(360),
    );
    await animation.finished;
  } finally {
    if (animation) animation.cancel();
  }
}

export async function animateCardFlight(cardEl, targetEl, kind) {
  const clone = cardEl.cloneNode(true);
  const from = cardEl.getBoundingClientRect();
  const target = centerOf(targetEl);
  const dx = target.x - (from.left + from.width / 2);
  const dy = target.y - (from.top + from.height / 2);

  clone.classList.add("battle-card-fly", `fly-${kind}`);
  clone.classList.remove("is-playing", "is-dragging", "is-hovered");
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  clone.style.width = `${from.width}px`;
  clone.style.height = `${from.height}px`;
  document.body.append(clone);

  await clone.animate(
    [
      { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)", opacity: 1 },
      {
        transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${kind === "attack" ? 18 : -10}deg) scale(${kind === "attack" ? 0.9 : 0.72})`,
        opacity: kind === "attack" ? 0.75 : 0.08,
      },
    ],
    smoothTiming(kind === "attack" ? 560 : 460),
  ).finished;

  clone.remove();
}

export async function animateSkillPlay(cardEl, discardPile) {
  return animateSkillPlayToDestination(cardEl, discardPile, { discard: true });
}

export async function animateSkillExhaust(cardEl) {
  return animateSkillPlayToDestination(cardEl, null, { discard: false });
}

async function animateSkillPlayToDestination(cardEl, discardPile, { discard = true } = {}) {
  const playTarget = {
    x: window.innerWidth / 2,
    y: Math.max(118, window.innerHeight * 0.42),
  };
  const { rect: playRect, clone } = await animateCardToPoint(cardEl, playTarget, {
    rotation: -3,
    scale: 1.06,
    opacity: 0.95,
    duration: 360,
    keepClone: !discard,
  });
  await wait(110);
  if (discard) {
    await animateFloatingCardToTarget(playRect, cardEl, discardPile, "skill");
  } else {
    await animateCardShatter(clone || cardEl, { removeSource: true });
  }
}

async function animateCardToPoint(cardEl, point, options = {}) {
  const clone = cardEl.cloneNode(true);
  const from = cardEl.getBoundingClientRect();
  const dx = point.x - (from.left + from.width / 2);
  const dy = point.y - (from.top + from.height / 2);

  clone.classList.add("battle-card-fly", "fly-skill-play");
  clone.classList.remove("is-playing", "is-dragging", "is-hovered");
  clone.style.left = `${from.left}px`;
  clone.style.top = `${from.top}px`;
  clone.style.width = `${from.width}px`;
  clone.style.height = `${from.height}px`;
  document.body.append(clone);

  cardEl.classList.add("is-playing");
  await clone.animate(
    [
      { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)", opacity: 1 },
      {
        transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${options.rotation || 0}deg) scale(${options.scale || 1})`,
        opacity: options.opacity ?? 1,
      },
    ],
    smoothTiming(options.duration || 420),
  ).finished;
  const finalRect = clone.getBoundingClientRect();
  if (options.keepClone) return { rect: finalRect, clone };
  clone.remove();
  return { rect: finalRect, clone: null };
}

async function animateFloatingCardToTarget(fromRect, sourceCard, targetEl, kind) {
  const clone = sourceCard.cloneNode(true);
  const target = centerOf(targetEl);
  const dx = target.x - (fromRect.left + fromRect.width / 2);
  const dy = target.y - (fromRect.top + fromRect.height / 2);

  clone.classList.add("battle-card-fly", `fly-${kind}`);
  clone.classList.remove("is-playing", "is-dragging", "is-hovered");
  clone.style.left = `${fromRect.left}px`;
  clone.style.top = `${fromRect.top}px`;
  clone.style.width = `${fromRect.width}px`;
  clone.style.height = `${fromRect.height}px`;
  document.body.append(clone);

  await clone.animate(
    [
      { transform: "translate3d(0, 0, 0) rotate(-3deg) scale(1)", opacity: 0.95 },
      {
        transform: `translate3d(${dx}px, ${dy}px, 0) rotate(-13deg) scale(0.58)`,
        opacity: 0,
      },
    ],
    smoothTiming(kind === "skill" ? 310 : 420),
  ).finished;
  clone.remove();
}

export async function animateGeneratedCardToPile(cardEl, targetEl, delay = 0, options = {}) {
  if (!cardEl || !targetEl) return;
  const total = Math.max(1, options.total || 1);
  const index = Math.max(0, options.index || 0);
  const middle = (total - 1) / 2;
  const spread = total > 1 ? Math.min(92, 390 / (total - 1)) : 0;
  const start = {
    x: window.innerWidth * 0.5 + (index - middle) * spread,
    y: Math.max(124, window.innerHeight * 0.42) + Math.abs(index - middle) * 6,
  };
  cardEl.classList.add("battle-card-fly", "fly-generated");
  cardEl.style.left = `${start.x - 75}px`;
  cardEl.style.top = `${start.y - 105}px`;
  document.body.append(cardEl);

  let revealAnimation = null;
  let flightAnimation = null;
  try {
    revealAnimation = cardEl.animate(
      [
        { opacity: 0, transform: "translate3d(0, 20px, 0) rotate(-4deg) scale(0.72)" },
        { opacity: 1, transform: `translate3d(0, 0, 0) rotate(${(index - middle) * 4}deg) scale(0.98)` },
      ],
      {
        ...smoothTiming(240),
        delay,
      },
    );
    await revealAnimation.finished;
    revealAnimation.cancel();
    cardEl.style.opacity = "1";
    cardEl.style.transform = `translate3d(0, 0, 0) rotate(${(index - middle) * 4}deg) scale(0.98)`;

    await wait(options.holdMs ?? 690);

    const from = cardEl.getBoundingClientRect();
    const target = centerOf(targetEl);
    const dx = target.x - (from.left + from.width / 2);
    const dy = target.y - (from.top + from.height / 2);
    flightAnimation = cardEl.animate(
      [
        {
          opacity: 1,
          transform: `translate3d(0, 0, 0) rotate(${(index - middle) * 4}deg) scale(0.98)`,
          filter: "brightness(1)",
        },
        {
          opacity: 0.08,
          transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${14 + Math.random() * 12}deg) scale(0.42)`,
          filter: "brightness(0.82)",
        },
      ],
      smoothTiming(460),
    );
    await flightAnimation.finished;
  } finally {
    if (revealAnimation) revealAnimation.cancel();
    if (flightAnimation) flightAnimation.cancel();
    cardEl.remove();
  }
}

export async function animateCardShatter(cardEl, { removeSource = false } = {}) {
  if (!cardEl) return;
  const rect = cardEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    if (removeSource) cardEl.remove();
    return;
  }

  const rows = 4;
  const cols = 5;
  const animations = [];
  cardEl.style.visibility = "hidden";

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const width = rect.width / cols;
      const height = rect.height / rows;
      const x = col * width;
      const y = row * height;
      const shard = document.createElement("span");
      const inner = cardEl.cloneNode(true);
      const centerX = x + width / 2 - rect.width / 2;
      const centerY = y + height / 2 - rect.height / 2;
      const flyX = centerX * 0.46 + (Math.random() - 0.35) * 120;
      const flyY = centerY * 0.54 - 36 - Math.random() * 86;

      shard.className = "card-shard";
      shard.style.left = `${rect.left + x}px`;
      shard.style.top = `${rect.top + y}px`;
      shard.style.width = `${width}px`;
      shard.style.height = `${height}px`;

      inner.classList.remove("battle-card-fly", "is-playing", "is-dragging", "is-hovered");
      inner.style.position = "absolute";
      inner.style.left = `${-x}px`;
      inner.style.top = `${-y}px`;
      inner.style.bottom = "auto";
      inner.style.margin = "0";
      inner.style.width = `${rect.width}px`;
      inner.style.height = `${rect.height}px`;
      inner.style.transform = "none";
      inner.style.visibility = "visible";
      shard.append(inner);
      document.body.append(shard);

      animations.push(
        shard.animate(
          [
            {
              opacity: 1,
              transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)",
              filter: "blur(0px)",
            },
            {
              opacity: 0,
              transform: `translate3d(${flyX}px, ${flyY}px, 0) rotate(${(Math.random() - 0.5) * 120}deg) scale(0.38)`,
              filter: "blur(5px)",
            },
          ],
          {
            duration: 760 + row * 55 + col * 35,
            easing: "cubic-bezier(.18,.84,.22,1)",
            fill: "forwards",
          },
        ).finished.then(() => shard.remove()),
      );
    }
  }

  await Promise.all(animations);
  if (removeSource) cardEl.remove();
}

export async function shatterEnemy(enemyCard, container) {
  if (!enemyCard || !container) return;

  const rows = 5;
  const cols = 6;
  const animations = [];
  const rect = enemyCard.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const visibleTexture = enemyCard.querySelector(".enemy-texture.is-visible") || enemyCard.querySelector(".enemy-texture");
  const textureSrc = visibleTexture?.currentSrc || visibleTexture?.src || "./assets/scenes/stage_08/enemy.png";

  enemyCard.classList.add("is-shattered");

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const shard = document.createElement("span");
      const width = rect.width / cols;
      const height = rect.height / rows;
      const x = col * width;
      const y = row * height;
      const offsetX = x + width / 2 - rect.width / 2;
      const offsetY = y + height / 2 - rect.height / 2;
      const wind = 180 + col * 34 + Math.random() * 90;
      const lift = -54 + (row - (rows - 1) / 2) * 22 + Math.random() * 46;
      const flyX = wind + Math.max(0, offsetX * 0.3);
      const flyY = lift + offsetY * 0.18;
      const imageHeight = rect.width * (1080 / 1920);
      const imageTop = (rect.height - imageHeight) / 2;

      shard.className = "enemy-shard";
      shard.style.backgroundImage = `url("${textureSrc}")`;
      shard.style.left = `${rect.left - containerRect.left + x}px`;
      shard.style.top = `${rect.top - containerRect.top + y}px`;
      shard.style.width = `${width}px`;
      shard.style.height = `${height}px`;
      shard.style.backgroundSize = `${rect.width}px ${imageHeight}px`;
      shard.style.backgroundPosition = `${-x}px ${imageTop - y}px`;
      container.append(shard);

      animations.push(
        shard.animate(
          [
            {
              opacity: 1,
              transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)",
              filter: "blur(0px)",
            },
            {
              opacity: 0,
              transform: `translate3d(${flyX}px, ${flyY}px, 0) rotate(${80 + (col - row) * 18}deg) scale(0.34)`,
              filter: "blur(7px)",
            },
          ],
          {
            duration: 1500 + row * 90 + col * 55,
            easing: "cubic-bezier(.18,.84,.22,1)",
            fill: "forwards",
          },
        ).finished.then(() => shard.remove()),
      );
    }
  }

  await Promise.all(animations);
}
