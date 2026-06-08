export function centerOf(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function pointInElement(element, x, y) {
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function floatText(targetElement, text, kind) {
  const point = centerOf(targetElement);
  const label = document.createElement("div");
  label.className = `battle-float-text ${kind}`;
  label.textContent = text;
  label.style.left = `${point.x}px`;
  label.style.top = `${point.y - 18}px`;
  document.body.append(label);
  window.setTimeout(() => label.remove(), 1280);
}

export function percent(value, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function watchAngle(value, max) {
  if (!max) return -90;
  const tick = Math.max(0, Math.min(12, Math.round((value / max) * 12)));
  return 270 - tick * 30;
}

export function smoothTiming(duration) {
  return {
    duration,
    easing: "cubic-bezier(.18,.84,.22,1)",
    fill: "both",
  };
}

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
