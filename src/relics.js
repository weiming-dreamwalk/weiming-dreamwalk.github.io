import { RELIC_DEFS } from "./config.js";
import { escapeHtml } from "./battle/utils.js";

export const RELIC_ICON_POSITIONS = {
  soy_milk: [0, 0],
  unfinished_homework: [1, 0],
  scratch_paper: [2, 0],
  used_bottle: [3, 0],
  old_campus_card: [4, 0],
  borrowed_umbrella: [0, 1],
  wrong_notebook: [1, 1],
  folding_chair: [2, 1],
  expired_coffee: [3, 1],
  campus_net_auth: [4, 1],
  lecture_album: [0, 2],
  lost_found_slip: [1, 2],
  auto_checkin_script: [2, 2],
  gpa_calculator: [3, 2],
  empty_classroom: [4, 2],
  old_clock: [0, 3],
  course_selection: [1, 3],
  extension_request: [2, 3],
  boya_shadow: [3, 3],
  graduate_list: [4, 3],
  dorm_earplug: [0, 4],
};

const RELIC_ICON_ASSETS = {
  dorm_earplug: "campus_net_auth",
};

export function renderRelicBar(relicKeys = []) {
  const keys = relicKeys.filter((key) => RELIC_DEFS[key]);
  return `
    <div class="relic-bar${keys.length ? "" : " is-empty"}" data-relic-bar>
      ${keys.length
        ? keys.map((key) => renderRelicToken(key)).join("")
        : '<span class="relic-empty">暂无遗物</span>'}
    </div>
  `;
}

export function renderRelicToken(key) {
  const relic = RELIC_DEFS[key];
  return `
    <span class="relic-token" data-relic-key="${escapeHtml(key)}" ${relicIconStyle(key)}>
      ${renderRelicIcon(key)}
      <span class="relic-tooltip" role="tooltip">
        <strong>${escapeHtml(relic.name)}</strong>
        <span>${escapeHtml(relic.text)}</span>
      </span>
    </span>
  `;
}

export function renderRelicIcon(key) {
  return `<i class="relic-icon" aria-hidden="true"></i>`;
}

export function relicIconStyle(key) {
  const safeKey = RELIC_DEFS[key] ? RELIC_ICON_ASSETS[key] || key : "soy_milk";
  return `style="--relic-url:url('./assets/relics/icons/${safeKey}.png');"`;
}
