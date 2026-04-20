// ═══════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════
const CONFIG = {
  floors: { 1:'assets/floor1.png', 2:'assets/floor2.png', 3:'assets/floor3.png' },
  graphFile:  'data/graph.json',
  roomsFile:  'data/rooms.json',
  historyKey: 'pft_nav_history',
  historyMax: 10,
};

const DEPT_COLORS = {
  'Chemical Engineering':              '#f7c832',
  'Mechanical/Industrial Engineering': '#c8b4e8',
  'Civil/Environmental Engineering':   '#e87070',
  'Petroleum Engineering':             '#7fbfdc',
  'Electrical/Computer Engineering':   '#b8d8a8',
  'Computer Science':                  '#f4a460',
  'Construction Management':           '#5b9a5a',
  'College':                           '#f5e27a',
  'University':                        '#888780',
};
const deptColor = r => DEPT_COLORS[r?.dept] || '#FDD023';

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
const S = {
  floor: 1,
  nodes: {}, rooms: [], roomIndex: [],
  imgW: 1, imgH: 1,
  scale: 1, panX: 0, panY: 0,
  dest: null, startNodeId: null,
  path: null, crossFloor: null,
};

// ═══════════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════════
const mapImg       = document.getElementById('map-img');
const canvas       = document.getElementById('path-canvas');
const ctx          = canvas.getContext('2d');
const mapArea      = document.getElementById('map-area');
const mapCont      = document.getElementById('map-container');
const loading      = document.getElementById('loading');
const inputFrom    = document.getElementById('input-from');
const inputTo      = document.getElementById('input-to');
const clearFrom    = document.getElementById('clear-from');
const clearTo      = document.getElementById('clear-to');
const fieldFrom    = document.getElementById('field-from');
const fieldTo      = document.getElementById('field-to');
const resultsPanel = document.getElementById('results-panel');
const destCard     = document.getElementById('dest-card');
const destRoom     = document.getElementById('dest-room');
const destLabel    = document.getElementById('dest-label');
const destFloorEl  = document.getElementById('dest-floor');
const destDeptBar  = document.getElementById('dest-dept-bar');
const noRoute      = document.getElementById('no-route');
const banner       = document.getElementById('crossfloor-banner');

// Which field is active: 'from' | 'to'
let activeField = 'to';

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════
async function boot() {
  const params   = new URLSearchParams(location.search);
  const qrFloor  = parseInt(params.get('floor')) || 1;
  const qrAnchor = params.get('anchor') || null;

  const [graphData, roomsData] = await Promise.all([
    fetch(CONFIG.graphFile).then(r => r.json()).catch(() => []),
    fetch(CONFIG.roomsFile).then(r => r.json()).catch(() => []),
  ]);

  graphData.forEach(n => { S.nodes[n.id] = n; });
  S.rooms = roomsData;
  S.roomIndex = roomsData.map(r => ({
    room: r,
    tokens: [r.id, r.label, ...(r.keywords || [])]
      .filter(Boolean).map(t => t.toString().toLowerCase()),
  }));

  if (qrAnchor && S.nodes[qrAnchor]) {
    S.startNodeId = qrAnchor;
    S.floor = S.nodes[qrAnchor].floor || qrFloor;
  } else {
    S.floor = qrFloor;
    S.startNodeId = defaultStart(S.floor);
  }

  setFloor(S.floor, false);
  await loadFloorImage(S.floor);
  loading.classList.add('hidden');

  // If QR anchor provided, pre-fill FROM field
  if (S.startNodeId) {
    const startNode = S.nodes[S.startNodeId];
    const startRoom = S.rooms.find(r => r.doorNode === S.startNodeId)
                   || (startNode ? { id: startNode.label || S.startNodeId, label: startNode.label || '', floor: startNode.floor } : null);
    if (startRoom) setFrom(startRoom, true);
  }

  renderAll();
}

function defaultStart(floor) {
  const n = Object.values(S.nodes).find(
    n => n.floor === floor && (n.type === 'anchor' || n.type === 'stair')
  );
  return n ? n.id : null;
}

// ═══════════════════════════════════════════════════
// IMAGE
// ═══════════════════════════════════════════════════
const imgCache = {};

function loadFloorImage(floor) {
  return new Promise(resolve => {
    if (imgCache[floor]) { applyImage(imgCache[floor]); resolve(); return; }
    const img = new Image();
    img.onload  = () => { imgCache[floor] = img; applyImage(img); resolve(); };
    img.onerror = () => resolve();
    img.src = CONFIG.floors[floor];
  });
}

function applyImage(img) {
  mapImg.src = img.src;
  S.imgW = img.naturalWidth;
  S.imgH = img.naturalHeight;
  canvas.width  = S.imgW;
  canvas.height = S.imgH;
  fitToView();
}

function fitToView() {
  const aw = mapArea.clientWidth, ah = mapArea.clientHeight;
  S.scale = Math.min(aw / S.imgW, ah / S.imgH);
  S.panX  = (aw - S.imgW * S.scale) / 2;
  S.panY  = (ah - S.imgH * S.scale) / 2;
  applyTransform();
}

// ═══════════════════════════════════════════════════
// FLOOR
// ═══════════════════════════════════════════════════
function setFloor(floor, redraw = true) {
  S.floor = floor;
  document.querySelectorAll('.ftab').forEach(t =>
    t.classList.toggle('active', parseInt(t.dataset.floor, 10) === floor)
  );
  loadFloorImage(floor).then(() => { if (redraw) renderAll(); });
}

document.getElementById('floor-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.ftab');
  if (!tab) return;
  const f = parseInt(tab.dataset.floor, 10);
  if (f !== S.floor) setFloor(f);
});

// ═══════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════
function setupField(inputEl, clearEl, fieldEl, fieldName) {
  inputEl.addEventListener('focus', () => {
    activeField = fieldName;
    fieldFrom.classList.toggle('active', fieldName === 'from');
    fieldTo.classList.toggle('active', fieldName === 'to');
    const q = inputEl.value.trim();
    if (q) showSearchResults(search(q));
    else showHistoryResults();
  });
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearEl.classList.toggle('visible', q.length > 0);
    if (!q) { showHistoryResults(); return; }
    // Restroom shortcut: only active on TO field
    if (fieldName === 'to' && isRestroomQuery(q)) {
      const rr = nearestRestroom();
      if (rr) {
        showSearchResults([rr]);
        return;
      }
    }
    showSearchResults(search(q));
  });
  clearEl.addEventListener('click', () => {
    inputEl.value = '';
    clearEl.classList.remove('visible');
    closeResults();
    if (fieldName === 'from') { S.startNodeId = null; S.startRoom = null; }
    else { S.dest = null; S.path = null; S.crossFloor = null; destCard.classList.remove('visible'); banner.classList.remove('visible'); }
    renderAll();
    inputEl.focus();
  });
}

setupField(inputFrom, clearFrom, fieldFrom, 'from');
setupField(inputTo,   clearTo,   fieldTo,   'to');

document.addEventListener('pointerdown', e => {
  const inPanel = resultsPanel.contains(e.target);
  const inFrom  = fieldFrom.contains(e.target);
  const inTo    = fieldTo.contains(e.target);
  if (!inPanel && !inFrom && !inTo) closeResults();
});

function search(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  S.roomIndex.forEach(({ room, tokens }) => {
    let score = 0;
    terms.forEach(term => tokens.forEach(tok => {
      if (tok === term)              score += 10;
      else if (tok.startsWith(term)) score += 6;
      else if (tok.includes(term))   score += 2;
    }));
    if (score > 0) scored.push({ room, score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.room);
}

function isRestroomQuery(q) {
  const t = q.toLowerCase().trim();
  return ['restroom','restrooms','bathroom','bathrooms','toilet','toilets','wc','washroom'].some(k => t.includes(k));
}

function nearestRestroom() {
  const startNode = S.nodes[S.startNodeId];
  const floor = startNode?.floor ?? S.floor;

  // Only consider restrooms on the same floor
  const restrooms = S.rooms.filter(r =>
    r.floor === floor && (
      r.label?.toLowerCase().includes('restroom') ||
      r.keywords?.some(k => k.toLowerCase().includes('restroom'))
    )
  );
  if (!restrooms.length) return null;
  if (!startNode) return restrooms[0];

  // Pick nearest by BFS path length
  let best = null, bestLen = Infinity;
  for (const rr of restrooms) {
    if (!rr.doorNode || !S.nodes[rr.doorNode]) continue;
    const p = bfs(S.startNodeId, rr.doorNode, floor);
    const len = p ? p.length : Infinity;
    if (len < bestLen) { bestLen = len; best = rr; }
  }
  return best;
}

function showSearchResults(rooms) {
  resultsPanel.innerHTML = rooms.length
    ? rooms.map(r => resultItemHTML(r)).join('')
    : '<div class="result-empty">No results</div>';
  bindResultItems(rooms);
  resultsPanel.classList.add('open');
}

function showHistoryResults() {
  const hist  = getHistory();
  const rooms = hist.map(h => S.rooms.find(r => r.id === h.id)).filter(Boolean);
  if (!rooms.length) { closeResults(); return; }
  resultsPanel.innerHTML =
    '<div class="result-section-label">Recent</div>' +
    rooms.map(r => resultItemHTML(r)).join('');
  bindResultItems(rooms);
  resultsPanel.classList.add('open');
}

function resultItemHTML(r) {
  return `<div class="result-item" data-rid="${r.id}">
    <div class="result-dot" style="background:#FDD023"></div>
    <div class="result-info">
      <div class="result-room">${r.id}</div>
      <div class="result-label">${r.label || ''}</div>
    </div>
    <div class="result-floor">F${r.floor}</div>
  </div>`;
}

function bindResultItems(rooms) {
  resultsPanel.querySelectorAll('.result-item').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const room = rooms.find(r => r.id === el.dataset.rid);
      if (!room) return;
      if (activeField === 'from') setFrom(room);
      else selectRoom(room);
    });
  });
}

function closeResults() {
  resultsPanel.classList.remove('open');
  fieldFrom.classList.remove('active');
  fieldTo.classList.remove('active');
}

// ═══════════════════════════════════════════════════
// ROOM SELECTION
// ═══════════════════════════════════════════════════

// S.startRoom holds the full room object for the FROM field
S.startRoom = null;

function setFrom(room, silent = false) {
  S.startRoom   = room;
  S.startNodeId = room.doorNode || S.startNodeId;
  inputFrom.value = room.id + (room.label ? '  ' + room.label : '');
  clearFrom.classList.add('visible');
  closeResults();
  if (!silent) inputTo.focus();
  // Re-navigate if dest already set
  if (S.dest && !silent) navigate();
}

function selectRoom(room) {
  if (!room) return;
  S.dest = room;
  inputTo.value = room.id + (room.label ? '  ' + room.label : '');
  clearTo.classList.add('visible');
  closeResults();
  inputTo.blur();
  saveHistory(room);
  navigate();
}

function navigate() {
  console.log('[navigate] startNodeId:', S.startNodeId, '| dest.doorNode:', S.dest?.doorNode, '| startRoom:', S.startRoom?.id);
  if (!S.startNodeId) {
    console.warn('[navigate] No start node — set FROM field first');
    noRoute.style.display = 'block';
    setTimeout(() => { noRoute.style.display = 'none'; }, 2500);
    return;
  }
  if (!S.dest?.doorNode) {
    console.warn('[navigate] Dest has no doorNode:', S.dest);
    noRoute.style.display = 'block';
    setTimeout(() => { noRoute.style.display = 'none'; }, 2500);
    return;
  }
  const startFloor = S.startRoom?.floor ?? S.floor;
  console.log('[navigate] startFloor:', startFloor, '| destFloor:', S.dest.floor);
  const route = computeRoute(S.startNodeId, S.dest.doorNode, startFloor, S.dest.floor);
  console.log('[navigate] route result:', route);

  destRoom.textContent    = S.dest.id;
  destLabel.textContent   = S.dest.label || '';
  destFloorEl.textContent = `Floor ${S.dest.floor}`;
  destDeptBar.style.background = '#FDD023';
  destCard.classList.add('visible');
  noRoute.style.display = 'none';

  if (!route) {
    noRoute.style.display = 'block';
    setTimeout(() => { noRoute.style.display = 'none'; }, 2500);
    return;
  }

  S.path = route.segment;
  S.crossFloor = route.crossFloor || null;

  // Show the floor where the route starts
  setFloor(startFloor, false);
  setTimeout(() => { renderAll(); zoomToPath(S.path); updateBanner(route); }, 50);
}

document.getElementById('btn-clear-dest').addEventListener('click', () => {
  S.dest = null; S.path = null; S.crossFloor = null;
  inputTo.value = ''; clearTo.classList.remove('visible');
  destCard.classList.remove('visible');
  banner.classList.remove('visible');
  renderAll();
});

// ═══════════════════════════════════════════════════
// HISTORY  (localStorage)
// ═══════════════════════════════════════════════════
function getHistory() {
  try { return JSON.parse(localStorage.getItem(CONFIG.historyKey)) || []; }
  catch { return []; }
}

function saveHistory(room) {
  let hist = getHistory().filter(h => h.id !== room.id);
  hist.unshift({ id: room.id, label: room.label || '', floor: room.floor, ts: Date.now() });
  if (hist.length > CONFIG.historyMax) hist.length = CONFIG.historyMax;
  try { localStorage.setItem(CONFIG.historyKey, JSON.stringify(hist)); } catch {}
}

// ═══════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════
function computeRoute(startId, destDoorId, startFloor, destFloor) {
  if (!startId || !destDoorId) return null;

  if (startFloor === destFloor) {
    const path = bfs(startId, destDoorId, startFloor);
    return path ? { segment: path } : null;
  }

  const transits = Object.values(S.nodes).filter(
    n => n.floor === startFloor && (n.type === 'stair' || n.type === 'elevator')
  );

  let best = null;
  for (const t of transits) {
    const seg1 = bfs(startId, t.id, startFloor);
    if (!seg1) continue;
    const partner = findPartner(t, destFloor);
    if (!partner) continue;
    const seg2 = bfs(partner.id, destDoorId, destFloor);
    if (!seg2) continue;
    const total = seg1.length + seg2.length;
    if (!best || total < best.total) {
      best = { total, segment: seg1,
        crossFloor: { via: t, partner, seg2, targetFloor: destFloor } };
    }
  }
  return best || null;
}

function bfs(startId, goalId, floor) {
  if (startId === goalId) return [startId];
  const visited = new Set([startId]);
  const queue   = [[startId, [startId]]];
  while (queue.length) {
    const [cur, path] = queue.shift();
    const node = S.nodes[cur];
    if (!node) continue;
    for (const nid of (node.edges || [])) {
      if (visited.has(nid)) continue;
      const nb = S.nodes[nid];
      if (!nb || nb.floor !== floor) continue;
      const np = [...path, nid];
      if (nid === goalId) return np;
      visited.add(nid);
      queue.push([nid, np]);
    }
  }
  return null;
}

function findPartner(node, targetFloor) {
  if (node.shaftId) {
    return Object.values(S.nodes).find(
      n => n.shaftId === node.shaftId && n.floor === targetFloor
    ) || null;
  }
  return Object.values(S.nodes).find(n =>
    n.floor === targetFloor && n.type === node.type &&
    Math.abs(n.nx - node.nx) < 0.1 && Math.abs(n.ny - node.ny) < 0.1
  ) || null;
}

// ═══════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════
let _raf = null;

function renderAll() {
  if (_raf) cancelAnimationFrame(_raf);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!S.path || !S.dest) return;
  drawRoute();
}

function drawRoute() {
  let segment = S.path;
  if (S.crossFloor && S.floor === S.crossFloor.targetFloor) segment = S.crossFloor.seg2;

  const pts = segment.map(id => S.nodes[id]).filter(n => n && n.floor === S.floor);
  if (pts.length < 2) { if (pts.length === 1) drawDestDot(pts[0]); return; }

  const coords = pts.map(n => ({ x: n.nx * S.imgW, y: n.ny * S.imgH }));

  // White halo
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(coords[0].x, coords[0].y);
  coords.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // Animated blue dash
  const dashLen = 28, gapLen = 14;
  const offset = (Date.now() / 30) % (dashLen + gapLen);
  ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 7;
  ctx.setLineDash([dashLen, gapLen]); ctx.lineDashOffset = -offset;
  ctx.beginPath(); ctx.moveTo(coords[0].x, coords[0].y);
  coords.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.restore();

  drawYouAreHere(coords[0]);

  const onDestFloor = !S.crossFloor || S.floor === S.dest.floor;
  if (onDestFloor) drawDestDot(pts[pts.length - 1]);
  else drawTransitMarker(coords[coords.length - 1], S.crossFloor.via.type);

  _raf = requestAnimationFrame(renderAll);
}

function drawYouAreHere(pt) {
  ctx.save();
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 18, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(10,132,255,0.2)'; ctx.fill();
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 9, 0, Math.PI*2);
  ctx.fillStyle = '#0a84ff'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

function drawDestDot(node) {
  const x = node.nx * S.imgW, y = node.ny * S.imgH;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,55,95,0.25)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2);
  ctx.fillStyle = '#ff375f'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  const lbl = S.dest?.id || '';
  ctx.font = 'bold 22px -apple-system,sans-serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
  ctx.strokeText(lbl, x, y - 20);
  ctx.fillStyle = '#fff'; ctx.fillText(lbl, x, y - 20);
  ctx.restore();
}

function drawTransitMarker(pt, type) {
  const lbl = type === 'elevator' ? 'Elevator' : 'Stairs';
  ctx.save();
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 14, 0, Math.PI*2);
  ctx.fillStyle = '#ff9f0a'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.font = 'bold 18px -apple-system,sans-serif'; ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
  ctx.strokeText(lbl, pt.x, pt.y - 22);
  ctx.fillStyle = '#fff'; ctx.fillText(lbl, pt.x, pt.y - 22);
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// ZOOM TO PATH
// ═══════════════════════════════════════════════════
function zoomToPath(segment) {
  const pts = segment.map(id => S.nodes[id]).filter(n => n && n.floor === S.floor);
  if (!pts.length) return;
  const pad = 80;
  const minNx = Math.min(...pts.map(n => n.nx)), maxNx = Math.max(...pts.map(n => n.nx));
  const minNy = Math.min(...pts.map(n => n.ny)), maxNy = Math.max(...pts.map(n => n.ny));
  const pxW = (maxNx - minNx) * S.imgW || S.imgW * 0.3;
  const pxH = (maxNy - minNy) * S.imgH || S.imgH * 0.3;
  const aw = mapArea.clientWidth, ah = mapArea.clientHeight;
  S.scale = Math.min((aw - pad*2) / pxW, (ah - pad*2) / pxH, 3);
  S.panX  = aw/2 - (minNx + maxNx)/2 * S.imgW * S.scale;
  S.panY  = ah/2 - (minNy + maxNy)/2 * S.imgH * S.scale;
  applyTransform();
}

// ═══════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════
function updateBanner(route) {
  if (!route.crossFloor) { banner.classList.remove('visible'); return; }
  const { via, targetFloor } = route.crossFloor;
  banner.textContent = `${via.type === 'elevator' ? 'Take elevator' : 'Take stairs'} to floor ${targetFloor} → tap floor tab to continue`;
  banner.classList.add('visible');
}

// ═══════════════════════════════════════════════════
// PAN & ZOOM
// ═══════════════════════════════════════════════════
function applyTransform() {
  mapCont.style.transform = `translate(${S.panX}px,${S.panY}px) scale(${S.scale})`;
}

let lastTouches = null;
mapArea.addEventListener('touchstart', e => { lastTouches = tc(e); }, { passive: true });
mapArea.addEventListener('touchmove', e => {
  e.preventDefault();
  const cur = tc(e);
  if (!lastTouches) { lastTouches = cur; return; }
  if (cur.length === 1 && lastTouches.length === 1) {
    S.panX += cur[0].x - lastTouches[0].x;
    S.panY += cur[0].y - lastTouches[0].y;
  } else if (cur.length >= 2 && lastTouches.length >= 2) {
    const f = hd(cur[0],cur[1]) / hd(lastTouches[0],lastTouches[1]);
    const r = mapArea.getBoundingClientRect();
    const cx = (cur[0].x+cur[1].x)/2-r.left, cy = (cur[0].y+cur[1].y)/2-r.top;
    S.panX = cx-(cx-S.panX)*f; S.panY = cy-(cy-S.panY)*f; S.scale *= f;
    S.panX += (cur[0].x+cur[1].x)/2-(lastTouches[0].x+lastTouches[1].x)/2;
    S.panY += (cur[0].y+cur[1].y)/2-(lastTouches[0].y+lastTouches[1].y)/2;
  }
  lastTouches = cur; applyTransform();
}, { passive: false });
mapArea.addEventListener('touchend', () => { lastTouches = null; });

mapArea.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.1 : 0.91;
  const r = mapArea.getBoundingClientRect();
  const cx = e.clientX-r.left, cy = e.clientY-r.top;
  S.panX = cx-(cx-S.panX)*f; S.panY = cy-(cy-S.panY)*f; S.scale *= f;
  applyTransform();
}, { passive: false });

let mDrag=false, mOrig=null, mPan=null;
mapArea.addEventListener('mousedown', e => {
  if (e.button!==0) return;
  mDrag=true; mOrig={x:e.clientX,y:e.clientY}; mPan={x:S.panX,y:S.panY};
});
window.addEventListener('mousemove', e => {
  if (!mDrag) return;
  S.panX=mPan.x+e.clientX-mOrig.x; S.panY=mPan.y+e.clientY-mOrig.y; applyTransform();
});
window.addEventListener('mouseup', () => { mDrag=false; });
window.addEventListener('resize', () => { if (S.imgW>1) { fitToView(); renderAll(); } });

function tc(e) { return Array.from(e.touches).map(t=>({x:t.clientX,y:t.clientY})); }
function hd(a,b) { return Math.hypot(b.x-a.x,b.y-a.y); }

// ═══════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════
boot().catch(console.error);
