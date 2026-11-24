/* Candidate groups use average-link clustering over the bundled synopsis scores.
   They propose a question; only a participant supplies a label and ratings. */
(function(root) {
  function candidateGroups(scores, count) {
    const groups = scores.map((_, i) => [i]);
    while (groups.length > count) {
      let best = [0, 1], score = -Infinity;
      for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
        if (groups[a].length + groups[b].length > Math.ceil(scores.length / count)) continue;
        const similarity = groups[a].reduce((s, i) => s + groups[b].reduce((t, j) => t + scores[i][j], 0), 0) / (groups[a].length * groups[b].length);
        if (similarity > score) { best = [a, b]; score = similarity; }
      }
      groups[best[0]].push(...groups[best[1]]);
      groups.splice(best[1], 1);
    }
    return groups.sort((a, b) => b.length - a.length || a[0] - b[0]);
  }
  if (typeof module !== 'undefined') module.exports = { candidateGroups, ratingsFromRanking };
  else root.FilmGrouping = { candidateGroups };
})(globalThis);

function ratedMagnetTarget(profile, magnets, aliases) {
  const weights = new Map();
  for (const [label, origins] of profile) {
    const id = aliases.get(label) || label;
    if (!magnets.has(id)) continue;
    const weight = Math.max(...origins.map(o => o.magnet ? o.rating / 100 : 1));
    weights.set(id, Math.max(weights.get(id) || 0, weight));
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  return {
    strength: Math.max(...weights.values()),
    x: [...weights].reduce((s, [id, w]) => s + magnets.get(id).x * w, 0) / total,
    y: [...weights].reduce((s, [id, w]) => s + magnets.get(id).y * w, 0) / total
  };
}
function renderGroups() {
  if (!session.groups.length) session.groups = FilmGrouping.candidateGroups(synopsisData.scores, session.groupScale);
  const index = Math.min(session.groupCursor, session.groups.length - 1);
  session.groupCursor = index;
  const group = session.groups[index];
  const existing = session.magnets.find(m => m.id === `group-${session.groupScale}-${index}`);
  $('groupView').innerHTML = `<div class="group-heading"><div><span class="eyebrow">01 / find a connection</span><h2>what brings these films together?</h2><p>a feeling, a theme, a world…</p></div><label class="group-scale">look at<select id="groupScale"><option value="3" ${session.groupScale === 3 ? 'selected' : ''}>broader groups</option><option value="5" ${session.groupScale === 5 ? 'selected' : ''}>smaller groups</option></select></label></div>
    <div class="group-progress"><button id="prevGroup" class="quiet" ${index === 0 ? 'disabled' : ''}>← previous</button><span>group ${index + 1} / ${session.groups.length} · ${group.length} ${group.length === 1 ? 'film' : 'films'}</span><button id="nextGroup" class="quiet" ${index === session.groups.length - 1 ? 'disabled' : ''}>next →</button></div>
    <div class="group-films ${group.length <= 2 ? 'group-films-small' : ''}" style="--group-count: ${group.length}">${group.map(i => `<article><img src="${films[i].poster}" alt="${escapeHTML(films[i].title)} poster"><h3>${escapeHTML(films[i].title)}</h3><p>${films[i].year}</p><button class="text-button about-film" type="button" data-about-film="${i}" aria-label="About ${escapeHTML(films[i].title)}">about this film</button></article>`).join('')}</div>
    <form id="groupForm" class="group-form"><label for="groupLabel">${group.length === 1 ? 'what stands out about this film?' : 'how do these relate to you?'}</label><div><input id="groupLabel" maxlength="100" required placeholder="e.g. fluffy, finding your place, uneasy magic…" value="${escapeHTML(existing?.label || '')}"><button class="primary" type="submit">${existing ? 'edit' : 'make'} magnet →</button></div><p>next, rank these films within your theme.</p></form>
    <div class="group-footer"><button id="skipGroup" class="text-button">${index === session.groups.length - 1 ? 'nothing in common / explore map ↗' : 'nothing in common / skip →'}</button><button id="exploreGroups" type="button">explore my map ↗</button></div>`;
  $('groupScale').onchange = e => { session.groupScale = Number(e.target.value); session.groups = []; session.groupCursor = 0; save(); renderGroups(); };
  $('prevGroup').onclick = () => moveGroup(-1);
  $('nextGroup').onclick = () => moveGroup(1);
  $('skipGroup').onclick = nextGroupOrMap;
  $('exploreGroups').onclick = showMap;
  $('groupForm').onsubmit = e => {
    e.preventDefault();
    const label = $('groupLabel').value.trim();
    if (!label) return;
    const magnet = existing || { id: `group-${session.groupScale}-${index}`, ratings: films.map((_, i) => group.includes(i) ? 70 : 0) };
    magnet.label = label;
    if (!existing) session.magnets.push(magnet);
    save(); openGroupRanking(magnet.id, group);
  };
}
function moveGroup(offset) { session.groupCursor += offset; save(); renderGroups(); }
function nextGroupOrMap() {
  if (session.groupCursor < session.groups.length - 1) moveGroup(1);
  else showMap();
}
function openRatings(id, advance = false) {
  const magnet = session.magnets.find(m => m.id === id);
  if (!magnet) return;
  const dialog = $('ratingsDialog');
  dialog.innerHTML = `<div class="panel-heading"><span>02 / tune connections</span><button id="closeRatings" class="quiet" aria-label="Close ratings">×</button></div><h2>how “${escapeHTML(magnet.label)}” is each film?</h2><p class="rating-intro">adjust each connection from not at all to very much. suggested group members start at 70; every rating is yours to change.</p><label class="rename-magnet">magnet label<input id="renameMagnet" maxlength="100" value="${escapeHTML(magnet.label)}"></label><div class="rating-list">${films.map((film, i) => `<label class="rating-row"><img src="${film.poster}" alt=""><span>${escapeHTML(film.title)}<span class="rating-endpoints"><span>not at all</span><span>very much</span></span><input aria-label="${escapeHTML(film.title)} connection strength" type="range" min="0" max="100" value="${magnet.ratings[i]}" data-rating="${i}"></span><output>${magnet.ratings[i]}</output></label>`).join('')}</div><div class="dialog-actions"><button id="deleteRatedMagnet" class="quiet">delete magnet</button><button id="saveRatings" class="primary">${advance ? 'save & continue →' : 'save changes →'}</button></div>`;
  const draft = magnet.ratings.slice();
  dialog.oninput = e => { if (e.target.dataset.rating !== undefined) { draft[Number(e.target.dataset.rating)] = Number(e.target.value); e.target.closest('label').querySelector('output').textContent = e.target.value; } };
  $('closeRatings').onclick = () => dialog.close();
  $('saveRatings').onclick = () => {
    const label = $('renameMagnet').value.trim();
    if (!label) { $('renameMagnet').focus(); return; }
    magnet.label = label; magnet.ratings = draft;
    mapPositions = null; magnetSignature = ''; save(); dialog.close();
    if (advance) nextGroupOrMap();
    render();
  };
  $('deleteRatedMagnet').onclick = () => { session.magnets = session.magnets.filter(m => m.id !== id); mapPositions = null; magnetSignature = ''; save(); dialog.close(); render(); };
  dialog.showModal();
}
function renderRatingLinks() {
  $('ratingLinks').innerHTML = session.magnets.map(m => `<button class="relation" data-rating-link="${escapeHTML(m.id)}"><b>${escapeHTML(m.label)}</b><small>${m.ratings.filter(r => r > 0).length} films · edit label & strengths →</small></button>`).join('');
}
function initGroups() {
  const about = document.createElement('dialog');
  about.id = 'filmAboutDialog'; about.className = 'film-about-dialog';
  about.setAttribute('aria-labelledby', 'filmAboutTitle');
  document.body.append(about);
  $('groupView').addEventListener('click', event => {
    const button = event.target.closest('[data-about-film]');
    if (!button) return;
    const film = films[Number(button.dataset.aboutFilm)];
    about.innerHTML = `<div class="panel-heading"><h2 id="filmAboutTitle">${escapeHTML(film.title)}</h2><button id="closeFilmAbout" class="quiet" type="button" aria-label="Close film details">×</button></div><div class="film-about-content"><img src="${film.poster}" alt="${escapeHTML(film.title)} poster"><div><p class="film-about-meta">${film.year} / ${escapeHTML(film.director)}</p><p>${escapeHTML(film.synopsis)}</p></div></div>`;
    $('closeFilmAbout').onclick = () => about.close();
    about.showModal();
  });
  about.addEventListener('click', event => { if (event.target === about) { const r = about.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) about.close(); } });

  const ranking = document.createElement('dialog'); ranking.id = 'rankingDialog'; ranking.className = 'ranking-dialog'; ranking.setAttribute('aria-labelledby', 'rankingTitle'); document.body.append(ranking);
  const dialog = document.createElement('dialog'); dialog.id = 'ratingsDialog'; dialog.className = 'ratings-dialog'; document.body.append(dialog);
  $('ratingLinks').onclick = e => { const button = e.target.closest('[data-rating-link]'); if (button) openRatings(button.dataset.ratingLink); };
  $('addMagnet').onclick = () => {
    const magnet = {id: `custom-${Date.now()}`, label: 'new connection', ratings: films.map(() => 0)};
    session.magnets.push(magnet); save(); openRatings(magnet.id);
  };
}

// Ranks seed relative magnet strengths; films outside this group retain their ratings.
function ratingsFromRanking(ratings, order) {
  const result = ratings.slice();
  order.forEach((film, rank) => { result[film] = order.length === 1 ? 70 : Math.round(25 + 75 * rank / (order.length - 1)); });
  return result;
}
function openGroupRanking(id, members) {
  const magnet = session.magnets.find(m => m.id === id);
  if (!magnet) return;
  let order = members.slice().sort((a,b) => magnet.ratings[a] - magnet.ratings[b]);
  const dialog = $('rankingDialog');
  let dragged = null;
  dialog.innerHTML = `<div class="panel-heading"><span>02 / rank this group</span><button id="closeRanking" class="quiet" type="button" aria-label="Back to group label">×</button></div><h2 id="rankingTitle">how do they rank for “${escapeHTML(magnet.label)}”?</h2><p class="ranking-hint">drag the films into order, or use the arrow buttons.</p><div class="rank-endpoints"><span>least ${escapeHTML(magnet.label)}</span><span>most ${escapeHTML(magnet.label)}</span></div><div id="rankFilms" class="rank-films" aria-label="Films from least to most connected"></div><p id="rankAnnouncement" class="sr-only" aria-live="polite"></p><div class="dialog-actions"><button id="backToGroup" type="button">← edit theme</button><button id="saveGroupRanking" class="primary" type="button">save ranking & continue →</button></div>`;
  const renderOrder = (focusFilm = null, focusDirection = 1) => {
    $('rankFilms').innerHTML = order.map((i, rank) => `<article class="rank-film" draggable="true" data-rank-film="${i}"><span class="rank-number">${rank+1}</span><img src="${films[i].poster}" alt="${escapeHTML(films[i].title)} poster" draggable="false"><h3>${escapeHTML(films[i].title)}</h3><div class="rank-arrows"><button type="button" data-move-film="${i}" data-direction="-1" aria-label="Move ${escapeHTML(films[i].title)} toward least" ${rank === 0 ? 'disabled' : ''}>←</button><button type="button" data-move-film="${i}" data-direction="1" aria-label="Move ${escapeHTML(films[i].title)} toward most" ${rank === order.length-1 ? 'disabled' : ''}>→</button></div></article>`).join('');
    if (focusFilm !== null) {
      const button = $('rankFilms').querySelector(`[data-move-film="${focusFilm}"][data-direction="${focusDirection}"]`);
      (button.disabled ? $('rankFilms').querySelector(`[data-move-film="${focusFilm}"][data-direction="${-focusDirection}"]`) : button).focus();
    }
  };
  const move = (film, target, focus = false, direction = 1) => {
    const index = order.indexOf(film);
    if (index < 0 || target < 0 || target >= order.length) return;
    order.splice(index,1); order.splice(target,0,film);
    renderOrder(focus ? film : null, direction);
    $('rankAnnouncement').textContent = `${films[film].title}: position ${target+1} of ${order.length}, from least to most ${magnet.label}.`;
  };
  $('rankFilms').onclick = event => {
    const button = event.target.closest('[data-move-film]');
    if (!button) return;
    const film = Number(button.dataset.moveFilm), direction = Number(button.dataset.direction);
    move(film, order.indexOf(film)+direction, true, direction);
  };
  $('rankFilms').ondragstart = event => {
    const card = event.target.closest('[data-rank-film]');
    if (!card) return;
    dragged = Number(card.dataset.rankFilm);
    event.dataTransfer.setData('text/plain', String(dragged));
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  };
  $('rankFilms').ondragover = event => {
    if (dragged === null) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  };
  $('rankFilms').ondrop = event => {
    event.preventDefault();
    const card = event.target.closest('[data-rank-film]');
    if (card && dragged !== null) move(dragged, order.indexOf(Number(card.dataset.rankFilm)));
    dragged = null;
  };
  $('rankFilms').ondragend = () => { dragged = null; $('rankFilms').querySelector('.dragging')?.classList.remove('dragging'); };
  $('closeRanking').onclick = $('backToGroup').onclick = () => dialog.close();
  $('saveGroupRanking').onclick = () => {
    magnet.ratings = ratingsFromRanking(magnet.ratings, order);
    magnet.groupMembers = members.slice(); magnet.rankOrder = order.slice();
    mapPositions = null; magnetSignature = '';
    save(); dialog.close(); nextGroupOrMap(); render();
  };
  renderOrder(); dialog.showModal();
}
