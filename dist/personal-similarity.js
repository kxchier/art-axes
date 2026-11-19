/* Shared, model-independent scoring: one unique set of personal labels per film. */
(function (root) {
  function normalizeLabel(text) {
    return text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
  }
  function splitLabels(text) {
    return [...new Set(text.split(/[,;\n]+/u).map(normalizeLabel).filter(Boolean))];
  }
  function buildProfiles(relations, count) {
    const profiles = Array.from({ length: count }, () => new Map());
    for (const { a, b, label } of relations) {
      for (const term of splitLabels(label)) {
        for (const film of [a, b]) {
          if (!profiles[film].has(term)) profiles[film].set(term, []);
          profiles[film].get(term).push({ a, b, label });
        }
      }
    }
    return profiles;
  }
  function cosine(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    return normA && normB ? Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB))) : 0;
  }
  function compareProfiles(left, right, embeddings) {
    const a = [...left.keys()], b = [...right.keys()];
    if (!a.length || !b.length) return { score: null, matches: [], reason: 'missing' };
    if ([...a, ...b].some(label => !embeddings.has(label))) return { score: null, matches: [], reason: 'pending' };
    const grid = a.map(x => b.map(y => cosine(embeddings.get(x), embeddings.get(y))));
    const forward = grid.map(row => Math.max(...row));
    const backward = b.map((_, j) => Math.max(...grid.map(row => row[j])));
    const score = (forward.reduce((s, v) => s + v, 0) / a.length + backward.reduce((s, v) => s + v, 0) / b.length) / 2;
    const matches = a.flatMap((x, i) => b.map((y, j) => ({ left: x, right: y, score: grid[i][j] })))
      .sort((x, y) => y.score - x.score);
    return { score, matches, reason: 'ready' };
  }
  function pluralKey(label) {
    return normalizeLabel(label).replace(/\b([a-z]{3,})s\b/gu, (word, stem) => /(?:ss|us|is)$/u.test(word) ? word : stem);
  }
  function buildThemes(labels, embeddings, separations = [], threshold = .6, preferredGroups = []) {
    const ready = [...new Set(labels)].filter(label => embeddings.has(label)).sort();
    const blocked = new Set(separations.map(pair => JSON.stringify(pair.slice().sort())));
    const preferred = new Set();
    preferredGroups.forEach(group => { for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) preferred.add(JSON.stringify([normalizeLabel(group[i]), normalizeLabel(group[j])].sort())); });
    const similarities = new Map();
    const similarity = (a, b) => {
      if (a === b) return 1;
      const key = JSON.stringify([a, b].sort());
      if (blocked.has(key)) return -1;
      if (preferred.has(key)) return 1;
      if (/\b(?:not|no|without|never)\b/u.test(a) !== /\b(?:not|no|without|never)\b/u.test(b)) return -1;
      if (!similarities.has(key)) similarities.set(key, pluralKey(a) === pluralKey(b) ? 1 : cosine(embeddings.get(a), embeddings.get(b)));
      return similarities.get(key);
    };
    const groups = ready.map(label => [label]);
    // Complete linkage prevents a chain of weakly related labels swallowing distinct themes.
    while (true) {
      let best = null, bestScore = threshold;
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const score = Math.min(...groups[i].flatMap(a => groups[j].map(b => similarity(a, b))));
        if (score > bestScore) { best = [i, j]; bestScore = score; }
      }
      if (!best) break;
      groups[best[0]].push(...groups[best[1]]);
      groups.splice(best[1], 1);
    }
    return groups.map(members => themeFromMembers(members, embeddings));
  }
  function themeFromMembers(members, embeddings) {
    const ranked = members.slice().sort((a, b) => {
      const average = label => members.reduce((sum, other) => sum + cosine(embeddings.get(label), embeddings.get(other)), 0) / members.length;
      const difference = average(b) - average(a);
      return (Math.abs(difference) > 1e-9 ? difference : 0) || a.length - b.length || a.localeCompare(b);
    });
    const vector = embeddings.get(members[0]).map((_, i) => members.reduce((sum, label) => sum + embeddings.get(label)[i], 0) / members.length);
    const norm = Math.hypot(...vector) || 1;
    return { id: ranked[0], labels: members.slice().sort(), vector: vector.map(value => value / norm) };
  }
  function themesAtCount(themes, count, embeddings) {
    const groups = themes.slice();
    const target = Math.max(1, Math.min(groups.length, Math.round(count) || groups.length));
    // Merge the closest theme centroids until the chosen level of detail is reached.
    while (groups.length > target) {
      let best = [0, 1], bestScore = -1;
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const similarity = cosine(groups[i].vector, groups[j].vector);
        if (similarity > bestScore) { best = [i, j]; bestScore = similarity; }
      }
      groups[best[0]] = themeFromMembers([...groups[best[0]].labels, ...groups[best[1]].labels], embeddings);
      groups.splice(best[1], 1);
    }
    return groups;
  }
  function membershipOverlap(a = new Set(), b = new Set()) {
    if (!a.size || !b.size) return 0;
    let common = 0;
    for (const film of a) if (b.has(film)) common++;
    return common / Math.sqrt(a.size * b.size);
  }
  // A sparse attraction graph forms local clusters; there is no circular constraint or fit-to-canvas expansion.
  function layoutMagnets(labels, embeddings, memberships = new Map(), labelSizes = new Map()) {
    const ready = [...new Set(labels)].filter(label => embeddings.has(label)).sort();
    if (ready.length === 1) return new Map([[ready[0], { x: .5, y: .52 }]]);
    if (!ready.length) return new Map();
    const points = ready.map((_, i) => ({ x: .5 + Math.cos(i / ready.length * Math.PI * 2) * .22, y: .53 + Math.sin(i / ready.length * Math.PI * 2) * .18 }));
    const similarities = ready.map(a => ready.map(b => {
      const semantic = cosine(embeddings.get(a), embeddings.get(b));
      const sharedFilms = membershipOverlap(memberships.get(a), memberships.get(b));
      return semantic + .35 * sharedFilms * (1 - semantic);
    }));
    const links = ready.map(() => new Set());
    ready.forEach((_, i) => {
      const nearest = ready.map((_, j) => ({ j, similarity: i === j ? -1 : similarities[i][j] }))
        .sort((a,b) => b.similarity - a.similarity).slice(0, 2);
      for (const neighbor of nearest) if (neighbor.similarity >= .38) {
        links[i].add(neighbor.j); links[neighbor.j].add(i);
      }
    });
    for (let step = 0; step < 650; step++) {
      const delta = points.map(point => ({ x: (.5 - point.x) * .002, y: (.53 - point.y) * .002 }));
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const dx = points[j].x - points[i].x, dy = points[j].y - points[i].y;
        const distance = Math.max(.001, Math.hypot(dx, dy));
        const similarity = similarities[i][j];
        const repulsion = .000018 * (1 - .8 * similarity) / (distance * distance + .002);
        let force = -repulsion;
        if (links[i].has(j)) {
          const strength = Math.pow(Math.max(0, (similarity - .25) / .75), 2);
          const rest = .035 + .07 * (1 - similarity);
          force += (distance - rest) * .2 * strength;
        }
        delta[i].x += dx / distance * force; delta[i].y += dy / distance * force;
        delta[j].x -= dx / distance * force; delta[j].y -= dy / distance * force;
      }
      points.forEach((point, i) => {
        point.x = Math.max(.08, Math.min(.92, point.x + Math.max(-.025, Math.min(.025, delta[i].x))));
        point.y = Math.max(.2, Math.min(.86, point.y + Math.max(-.025, Math.min(.025, delta[i].y))));
      });
    }
    // Resolve only actual text-box overlaps, leaving empty space between semantic clusters.
    for (let step = 0; step < 35; step++) {
      let overlap = false;
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        const a = labelSizes.get(ready[i]), b = labelSizes.get(ready[j]);
        if (!a || !b) continue;
        const dx = points[j].x - points[i].x, dy = points[j].y - points[i].y;
        const minX = (a.width + b.width) / 2, minY = (a.height + b.height) / 2;
        if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;
        overlap = true;
        // Stack nearby labels vertically when that requires less screen space.
        if ((minX - Math.abs(dx)) / minX < (minY - Math.abs(dy)) / minY) {
          const shift = Math.sign(dx || 1) * (minX - Math.abs(dx) + .001) / 2;
          points[i].x -= shift; points[j].x += shift;
        } else {
          const shift = Math.sign(dy || 1) * (minY - Math.abs(dy) + .001) / 2;
          points[i].y -= shift; points[j].y += shift;
        }
      }
      points.forEach(point => { point.x = Math.max(.08, Math.min(.92, point.x)); point.y = Math.max(.2, Math.min(.86, point.y)); });
      if (!overlap) break;
    }
    return new Map(ready.map((label, i) => [label, points[i]]));
  }
  function magnetTarget(profile, magnets, aliases = new Map()) {
    const labels = [...new Set([...profile.keys()].map(label => aliases.get(label) || label))];
    if (!labels.length || labels.some(label => !magnets.has(label))) return null;
    return {
      x: labels.reduce((sum, label) => sum + magnets.get(label).x, 0) / labels.length,
      y: labels.reduce((sum, label) => sum + magnets.get(label).y, 0) / labels.length
    };
  }
  const api = { normalizeLabel, splitLabels, buildProfiles, cosine, compareProfiles, layoutMagnets, magnetTarget, pluralKey, buildThemes, themesAtCount, membershipOverlap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PersonalSimilarity = api;
})(globalThis);
