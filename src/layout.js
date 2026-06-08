export function fitStageToViewport(stage, designSize) {
  const scale = Math.max(
    window.innerWidth / designSize.width,
    window.innerHeight / designSize.height,
  );
  const width = designSize.width * scale;
  const height = designSize.height * scale;
  const x = (window.innerWidth - width) / 2;
  const y = (window.innerHeight - height) / 2;

  stage.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}
