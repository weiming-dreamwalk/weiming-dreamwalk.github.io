import {
  MAP_CORRUPTION_CLEARINGS,
  MAP_CORRUPTION_STAGES,
} from "./config.js";

const CLIP_POINT_COUNT = 72;
const EDGE_POINT_COUNT = 34;
const CLEARING_POINT_COUNT = 64;
const EDGE_GLITCH = 6;
const PHASE_SCALE = 0.0009;
const SMOOTHING_PASSES = 3;
const IDLE_FRAME_INTERVAL = 50;

export class CorruptionController {
  constructor({ designSize, clipPath, clearingPath, edgePath, edgeGlowPath }) {
    this.designSize = designSize;
    this.clipPath = clipPath;
    this.clearingPath = clearingPath;
    this.edgePath = edgePath;
    this.edgeGlowPath = edgeGlowPath;
    this.step = 0;
    this.clipPoints = [];
    this.edgePoints = [];
    this.clearingPoints = MAP_CORRUPTION_CLEARINGS.map((points) => (
      smoothPoints(normalizeClosed(points, CLEARING_POINT_COUNT), true)
    ));
    this.animationFrame = null;
    this.idleFrame = null;
    this.idleEnabled = true;
    this.lastIdleDraw = 0;

    this.draw([], [], 0);
    this.startIdle();
  }

  setStep(step) {
    const stage = this.getStage(step);

    this.step = clamp(step, 0, MAP_CORRUPTION_STAGES.length);
    this.clipPoints = stage ? smoothPoints(normalizeClosed(stage.clip, CLIP_POINT_COUNT), true) : [];
    this.edgePoints = stage ? smoothPoints(normalizeOpen(stage.edge, EDGE_POINT_COUNT), false) : [];
    this.draw(this.clipPoints, this.edgePoints, performance.now() * PHASE_SCALE);
  }

  expandToStep(step) {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }

    const targetStep = clamp(step, 0, MAP_CORRUPTION_STAGES.length);
    const targetStage = this.getStage(targetStep);

    if (!targetStage || targetStep <= this.step + 0.01) {
      this.setStep(targetStep);
      return Promise.resolve();
    }

    const startClip = this.clipPoints.length
      ? this.clipPoints
      : smoothPoints(normalizeClosed(targetStage.clip, CLIP_POINT_COUNT), true);
    const startEdge = this.edgePoints.length
      ? this.edgePoints
      : smoothPoints(normalizeOpen(targetStage.edge, EDGE_POINT_COUNT), false);
    const targetClip = smoothPoints(normalizeClosed(targetStage.clip, CLIP_POINT_COUNT), true);
    const targetEdge = smoothPoints(normalizeOpen(targetStage.edge, EDGE_POINT_COUNT), false);
    const startTime = performance.now();
    const duration = 1620;

    return new Promise((resolve) => {
      const tick = (now) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = easeInOutCubic(progress);
        const clipPoints = interpolatePoints(startClip, targetClip, eased);
        const edgePoints = interpolatePoints(startEdge, targetEdge, eased);

        this.draw(clipPoints, edgePoints, now * PHASE_SCALE + progress * 0.6);

        if (progress < 1) {
          this.animationFrame = requestAnimationFrame(tick);
        } else {
          this.animationFrame = null;
          this.step = targetStep;
          this.clipPoints = targetClip;
          this.edgePoints = targetEdge;
          this.draw(this.clipPoints, this.edgePoints, now * PHASE_SCALE);
          resolve();
        }
      };

      this.animationFrame = requestAnimationFrame(tick);
    });
  }

  startIdle() {
    const tick = (now) => {
      if (this.idleEnabled && !this.animationFrame && this.clipPoints.length && now - this.lastIdleDraw >= IDLE_FRAME_INTERVAL) {
        this.lastIdleDraw = now;
        this.draw(this.clipPoints, this.edgePoints, now * PHASE_SCALE);
      }

      this.idleFrame = requestAnimationFrame(tick);
    };

    this.idleFrame = requestAnimationFrame(tick);
  }

  pauseIdle() {
    this.idleEnabled = false;
  }

  resumeIdle() {
    this.idleEnabled = true;
    this.lastIdleDraw = 0;
  }

  draw(clipPoints, edgePoints, phase) {
    if (!clipPoints.length) {
      this.clipPath.setAttribute("d", "");
      this.clearingPath?.setAttribute("d", "");
      this.edgePath.setAttribute("d", "");
      this.edgeGlowPath.setAttribute("d", "");
      this.setEdgeOpacity(0);
      return;
    }

    const glitchedClip = glitchPoints(clipPoints, phase, this.designSize, true);
    const glitchedEdge = glitchPoints(edgePoints, phase + 0.35, this.designSize, false);
    const clipPath = createClosedPath(glitchedClip);
    const clearingPath = this.clearingPoints
      .map((points, index) => createClosedPath(glitchPoints(points, phase + index * 0.47, this.designSize, false)))
      .join(" ");
    const edgePath = createOpenPath(glitchedEdge);

    this.clipPath.setAttribute("d", clipPath);
    this.clearingPath?.setAttribute("d", clearingPath);
    this.edgePath.setAttribute("d", edgePath);
    this.edgeGlowPath.setAttribute("d", edgePath);
    this.setEdgeOpacity(0);
  }

  getStage(step) {
    if (step <= 0) return null;
    return MAP_CORRUPTION_STAGES[Math.min(step, MAP_CORRUPTION_STAGES.length) - 1];
  }

  setEdgeOpacity(opacity) {
    this.edgePath.style.opacity = String(opacity);
    this.edgeGlowPath.style.opacity = String(opacity);
  }
}

function normalizeClosed(points, targetCount) {
  return resample(points, targetCount, true);
}

function normalizeOpen(points, targetCount) {
  return resample(points, targetCount, false);
}

function smoothPoints(points, closed) {
  if (points.length < 4) return points;

  let smoothed = points.map((point) => ({ ...point }));

  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    smoothed = smoothed.map((point, index) => {
      if (!closed && (index === 0 || index === smoothed.length - 1)) {
        return point;
      }

      const previous = smoothed[(index - 1 + smoothed.length) % smoothed.length];
      const next = smoothed[(index + 1) % smoothed.length];

      return {
        x: point.x * 0.5 + (previous.x + next.x) * 0.25,
        y: point.y * 0.5 + (previous.y + next.y) * 0.25,
      };
    });
  }

  return smoothed;
}

function resample(points, targetCount, closed) {
  if (!points.length) return [];
  if (points.length === 1) return Array.from({ length: targetCount }, () => ({ ...points[0] }));

  const segments = [];
  const segmentCount = closed ? points.length : points.length - 1;
  let totalLength = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);

    segments.push({ from, to, length, start: totalLength });
    totalLength += length;
  }

  if (totalLength <= 0.01) {
    return Array.from({ length: targetCount }, () => ({ ...points[0] }));
  }

  const samples = [];
  const denominator = closed ? targetCount : targetCount - 1;

  for (let sampleIndex = 0; sampleIndex < targetCount; sampleIndex += 1) {
    const distance = closed
      ? (totalLength * sampleIndex) / denominator
      : (totalLength * sampleIndex) / Math.max(1, denominator);
    const segment = findSegment(segments, Math.min(distance, totalLength));
    const local = segment.length <= 0
      ? 0
      : (distance - segment.start) / segment.length;

    samples.push({
      x: lerp(segment.from.x, segment.to.x, local),
      y: lerp(segment.from.y, segment.to.y, local),
    });
  }

  return samples;
}

function findSegment(segments, distance) {
  return segments.find((segment) => distance <= segment.start + segment.length) || segments[segments.length - 1];
}

function interpolatePoints(fromPoints, toPoints, progress) {
  return toPoints.map((to, index) => {
    const from = fromPoints[index] || to;

    return {
      x: lerp(from.x, to.x, progress),
      y: lerp(from.y, to.y, progress),
    };
  });
}

function glitchPoints(points, phase, designSize, keepMapEdges) {
  const length = points.length || 1;

  return points.map((point, index) => {
    if (keepMapEdges && isMapEdgePoint(point, designSize)) {
      return point;
    }

    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const tangent = normalize({
      x: next.x - previous.x,
      y: next.y - previous.y,
    });
    const normal = { x: -tangent.y, y: tangent.x };
    const u = index / length;
    const localPhase = phase + u * Math.PI * 5.5 + randomSigned(index + 17) * 0.75;
    const randomA = interpolatedNoise(index, phase * 0.42 + u * 2.7);
    const randomB = interpolatedNoise(index + 97, phase * 0.32 + u * 1.9);
    const wave =
      Math.sin(u * Math.PI * 4.2 + localPhase * 1.65) * EDGE_GLITCH +
      Math.sin(u * Math.PI * 9.1 - localPhase * 1.08) * EDGE_GLITCH * 0.44 +
      Math.sin(u * Math.PI * 15.4 + localPhase * 0.76) * EDGE_GLITCH * 0.2 +
      randomA * EDGE_GLITCH * 0.24;
    const lateral = randomB * EDGE_GLITCH * 0.18;

    return clampPoint({
      x: point.x + normal.x * wave + tangent.x * lateral,
      y: point.y + normal.y * wave + tangent.y * lateral,
    }, designSize);
  });
}

function interpolatedNoise(seed, phase) {
  const current = Math.floor(phase);
  const fraction = phase - current;
  const from = randomSigned(seed * 131 + current * 917);
  const to = randomSigned(seed * 131 + (current + 1) * 917);
  const eased = fraction * fraction * (3 - 2 * fraction);

  return lerp(from, to, eased);
}

function randomSigned(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function isMapEdgePoint(point, designSize) {
  return (
    point.x <= 0.5 ||
    point.y <= 0.5 ||
    point.x >= designSize.width - 0.5 ||
    point.y >= designSize.height - 0.5
  );
}

function createClosedPath(points) {
  if (!points.length) return "";
  const path = createSmoothPath(points, true);
  return `${path} Z`;
}

function createOpenPath(points) {
  if (!points.length) return "";
  return createSmoothPath(points, false);
}

function createSmoothPath(points, closed) {
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  const lastIndex = closed ? points.length : points.length - 1;

  for (let index = 0; index < lastIndex; index += 1) {
    if (!closed && index === points.length - 1) break;

    const current = points[index];
    const next = points[(index + 1) % points.length];
    const previous = closed
      ? points[(index - 1 + points.length) % points.length]
      : points[Math.max(0, index - 1)];
    const afterNext = closed
      ? points[(index + 2) % points.length]
      : points[Math.min(points.length - 1, index + 2)];
    const cp1 = {
      x: current.x + (next.x - previous.x) / 7.5,
      y: current.y + (next.y - previous.y) / 7.5,
    };
    const cp2 = {
      x: next.x - (afterNext.x - current.x) / 7.5,
      y: next.y - (afterNext.y - current.y) / 7.5,
    };

    path += ` C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}`;
    path += ` ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}`;
    path += ` ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }

  return path;
}

function clampPoint(point, designSize) {
  return {
    x: clamp(point.x, 0, designSize.width),
    y: clamp(point.y, 0, designSize.height),
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
