// Baseline copied before the MDS replacement. See the untouched source snapshot next to this file.
function legacyLayout({ metadata, synopsis, weights, targets, width = 1180, height = 793 }) {
  const points = targets.map((_, i) => ({ x: .5 + Math.cos(i / 10 * Math.PI * 2) * .3, y: .53 + Math.sin(i / 10 * Math.PI * 2) * .25 }));
  const computationalWeight = weights.metadata + weights.synopsis;
  const computationalShare = computationalWeight / (computationalWeight + weights.personal || 1);
  const personalShare = weights.personal / (computationalWeight + weights.personal || 1);
  const minX = 92 / width;
  const minY = 155 / height;
  const computationalSimilarities = targets.map((_, a) => targets.map((_, b) => computationalWeight ? (metadata[a][b] * weights.metadata + synopsis[a][b] * weights.synopsis) / computationalWeight : 0));
  for (let step = 0; step < 450; step++) {
    const delta = points.map(() => ({ x: 0, y: 0 }));
    for (let a = 0; a < targets.length; a++) for (let b = a + 1; b < targets.length; b++) {
      const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y;
      const distance = Math.max(.001, Math.hypot(dx, dy));
      const similarity = computationalSimilarities[a][b];
      const target = .16 + (1 - similarity) * .54;
      // Missing labels leave a movie governed by the computational sources.
      const share = (!targets[a] || !targets[b]) && computationalWeight ? 1 : computationalShare;
      const force = (distance - target) * .018 * share;
      delta[a].x += dx / distance * force; delta[a].y += dy / distance * force;
      delta[b].x -= dx / distance * force; delta[b].y -= dy / distance * force;
      // Keep poster cards legible, even when several movies share a magnet.
      if (Math.abs(dx) < minX && Math.abs(dy) < minY) {
        if (Math.abs(dx) / minX > Math.abs(dy) / minY) {
          const push = Math.sign(dx || 1) * (minX - Math.abs(dx)) * .12;
          delta[a].x -= push; delta[b].x += push;
        } else {
          const push = Math.sign(dy || 1) * (minY - Math.abs(dy)) * .12;
          delta[a].y -= push; delta[b].y += push;
        }
      }
    }
    points.forEach((point, i) => {
      if (targets[i]) {
        delta[i].x += (targets[i].x - point.x) * .15 * personalShare;
        delta[i].y += (targets[i].y - point.y) * .15 * personalShare;
      }
      point.x = Math.max(.08, Math.min(.92, point.x + delta[i].x));
      point.y = Math.max(.21, Math.min(.85, point.y + delta[i].y));
    });
  }
  return points.map(point => ({ x: point.x * 100, y: point.y * 100 }));
}

module.exports = { legacyLayout };
