export function createMetrics() {
  return {
    engine: "handmade",
    label: "JS discs",
    stepMs: 0,
    contacts: 0,
    obstacleHits: 0,
    resetCount: 0,
    lastComparison: null,
  };
}

export function sampleStep(metrics, startedAt, details = {}) {
  metrics.stepMs = metrics.stepMs * 0.9 + (performance.now() - startedAt) * 0.1;
  metrics.contacts = details.contacts ?? 0;
  metrics.obstacleHits = details.obstacleHits ?? 0;
}
