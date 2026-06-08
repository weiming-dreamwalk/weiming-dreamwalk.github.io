const BATTLE_CORRUPTION_SAMPLES = 26;

export function battleCorruptionBoundary(width, height, progress, phase) {
  const boundaryX = width * progress;
  const amplitude = Math.min(width * 0.055, 20 + width * progress * 0.025);
  const points = [];

  for (let index = 0; index <= BATTLE_CORRUPTION_SAMPLES; index += 1) {
    const y = (height / BATTLE_CORRUPTION_SAMPLES) * index;
    const wave =
      Math.sin(y * 0.018 + phase * 1.7) * amplitude +
      Math.sin(y * 0.007 - phase * 1.1) * amplitude * 0.46 +
      Math.sin(y * 0.037 + phase * 0.8) * amplitude * 0.18;
    const ragged = Math.sin(index * 1.73 + phase * 4.2) * amplitude * 0.12;
    const x = Math.max(0, Math.min(width, boundaryX + wave + ragged));
    points.push({ x, y });
  }

  return points;
}

export function drawCoverImage(ctx, image, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

export function drawBattleCorruptionParticles(ctx, points, phase, dpr) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  points.forEach((point, index) => {
    if (index % 3 !== 0) return;
    const pulse = Math.sin(phase * 5.6 + index * 0.9);
    const count = 1 + (index % 2);

    for (let particle = 0; particle < count; particle += 1) {
      const drift = Math.sin(phase * 2.8 + index + particle * 1.9);
      const x = point.x + drift * 16 * dpr + (particle - 1) * 7 * dpr;
      const y = point.y + Math.cos(phase * 3.4 + particle + index * 0.6) * 12 * dpr;
      const radius = (1.2 + Math.abs(pulse) * 2.4 + particle * 0.35) * dpr;
      const alpha = 0.18 + Math.abs(pulse) * 0.34;

      ctx.fillStyle = particle % 2
        ? `rgba(255, 130, 182, ${alpha})`
        : `rgba(135, 83, 220, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.8, radius * 0.72, drift, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "rgba(224, 157, 193, 0.42)";
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  points.forEach((point, index) => {
    const offset = Math.sin(index * 1.41 + phase * 6) * 2.8 * dpr;
    if (index === 0) ctx.moveTo(point.x + offset, point.y);
    else ctx.lineTo(point.x + offset, point.y);
  });
  ctx.stroke();
  ctx.restore();
}
