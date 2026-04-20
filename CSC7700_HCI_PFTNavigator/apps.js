const CONFIG = {
  floors: {
    1: 'assets/floor1.png',
    2: 'assets/floor2.png',
    3: 'assets/floor3.png',
  },
  graphFile: 'data/graph.json',
  roomsFile: 'data/rooms.json',
};

const S = {
  floor: 1,
  nodes: {},
  rooms: [],
  roomIndex: [],
  imgW: 1,
  imgH: 1,
  scale: 1,
  panX: 0,
  panY: 0,
  dest: null,
  startNodeId: null,
  path: null,
  crossFloor: null,
  debug: {
    showNodes: false,
    showEdges: false,
    showLabels: false,
    lastClick: null,
  }
};

const mapImg       = document.getElementById('map-img');
const canvas       = document.getElementById('path-canvas');
const ctx          = canvas.getContext('2d');
const mapArea      = document.getElementById('map-area');
const mapCont      = document.getElementById('map-container');
const loading      = document.getElementById('loading');
const searchInput  = document.getElementById('search-input');
const searchClear  = document.getElementById('search-clear');
const resultsPanel = document.getElementById('results-panel');
const destCard     = document.getElementById('dest-card');
const destRoom     = document.getElementById('dest-room');
const destLabel    = document.getElementById('dest-label');
const destFloor    = document.getElementById('dest-floor');
const noRoute      = document.getElementById('no-route');
const banner       = document.getElementById('crossfloor-banner');

const toggleNodes  = document.getElementById('toggle-nodes');
const toggleEdges  = document.getElementById('toggle-edges');
const toggleLabels = document.getElementById('toggle-labels');
const debugReadout = document.getElementById('debug-readout');
const btnCopyCoords = document.getElementById('btn-copy-coords');

async function boot() {
  const params = new URLSearchParams(location.search);
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
      .filter(Boolean)
      .map(t => t.toString().toLowerCase()),
  }));

  if (qrAnchor && S.nodes[qrAnchor]) {
    S.startNodeId = qrAnchor;
    S.floor = S.nodes[qrAnchor].floor || qrFloor;
  } else {
    S.floor = qrFloor;
    S.startNodeId = defaultStart(S.floor);
  }

  console.log('Loaded graph nodes:', Object.keys(S.nodes).length);

  setFloor(S.floor, false);
  await loadFloorImage(S.floor);
  loading.classList.add('hidden');
  renderAll();
}

function defaultStart(floor) {
  const n = Object.values(S.nodes).find(n =>
    n.floor === floor && (n.type === 'anchor' || n.type === 'stair')
  );
  return n ? n.id : null;
}

const imgCache = {};

function loadFloorImage(floor) {
  return new Promise(resolve => {
    if (imgCache[floor]) {
      applyImage(imgCache[floor]);
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgCache[floor] = img;
      applyImage(img);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = CONFIG.floors[floor];
  });
}

function applyImage(img) {
  mapImg.src = img.src;
  S.imgW = img.naturalWidth;
  S.imgH = img.naturalHeight;
  canvas.width = S.imgW;
  canvas.height = S.imgH;
  fitToView();
}

function fitToView() {
  const aw = mapArea.clientWidth;
  const ah = mapArea.clientHeight;
  S.scale = Math.min(aw / S.imgW, ah / S.imgH);
  S.panX = (aw - S.imgW * S.scale) / 2;
  S.panY = (ah - S.imgH * S.scale) / 2;
  applyTransform();
}

function setFloor(floor, redrawPath = true) {
  S.floor = floor;
  document.querySelectorAll('.ftab').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.floor, 10) === floor);
  });
  loadFloorImage(floor).then(() => {
    if (redrawPath) renderAll();
  });
}

document.getElementById('floor-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.ftab');
  if (!tab) return;
  const floor = parseInt(tab.dataset.floor, 10);
  if (floor !== S.floor) setFloor(floor);
});

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle('visible', q.length > 0);
  if (q.length < 1) { closeResults(); return; }
  renderResults(search(q));
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length > 0) {
    renderResults(search(searchInput.value.trim()));
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  closeResults();
  searchInput.focus();
});

document.addEventListener('pointerdown', e => {
  if (!resultsPanel.contains(e.target) && e.target !== searchInput) closeResults();
});

function search(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  S.roomIndex.forEach(({ room, tokens }) => {
    let score = 0;
    terms.forEach(term => {
      tokens.forEach(tok => {
        if (tok === term) score += 10;
        else if (tok.startsWith(term)) score += 6;
        else if (tok.includes(term)) score += 2;
      });
    });
    if (score > 0) scored.push({ room, score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.room);
}

function renderResults(rooms) {
  if (rooms.length === 0) {
    resultsPanel.innerHTML = '<div class="result-empty">No results</div>';
  } else {
    resultsPanel.innerHTML = rooms.map(r => `
      <div class="result-item" data-rid="${r.id}">
        <div>
          <div class="result-room">${r.id}</div>
          <div class="result-label">${r.label || ''}</div>
        </div>
        <div class="result-floor">Floor ${r.floor}</div>
      </div>`).join('');
    resultsPanel.querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        selectRoom(S.rooms.find(r => r.id === el.dataset.rid));
      });
    });
  }
  resultsPanel.classList.add('open');
}

function closeResults() {
  resultsPanel.classList.remove('open');
}

function selectRoom(room) {
  if (!room) return;
  S.dest = room;
  closeResults();
  searchInput.blur();
  searchInput.value = '';
  searchClear.classList.remove('visible');

  destRoom.textContent = room.id;
  destLabel.textContent = room.label || '';
  destFloor.textContent = `Floor ${room.floor}`;
  destCard.classList.add('visible');
  noRoute.style.display = 'none';

  const route = computeRoute(S.startNodeId, room.doorNode, S.floor, room.floor);

  if (!route) {
    noRoute.style.display = 'block';
    setTimeout(() => { noRoute.style.display = 'none'; }, 2500);
    return;
  }

  S.path = route.segment;
  S.crossFloor = route.crossFloor || null;

  setFloor(S.floor, false);
  setTimeout(() => {
    renderAll();
    zoomToPath(S.path);
    updateBanner(route);
  }, 50);
}

document.getElementById('btn-clear-dest').addEventListener('click', clearDest);

function clearDest() {
  S.dest = null;
  S.path = null;
  S.crossFloor = null;
  destCard.classList.remove('visible');
  banner.classList.remove('visible');
  renderAll();
}

function computeRoute(startId, destDoorId, startFloor, destFloor) {
  if (!startId || !destDoorId) return null;

  if (startFloor === destFloor) {
    const path = bfs(startId, destDoorId, startFloor);
    if (!path) return null;
    return { segment: path };
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
      best = {
        total,
        segment: seg1,
        crossFloor: {
          via: t,
          partner,
          seg2,
          targetFloor: destFloor,
        }
      };
    }
  }
  return best || null;
}

function bfs(startId, goalId, floor) {
  if (startId === goalId) return [startId];
  const visited = new Set([startId]);
  const queue = [[startId, [startId]]];

  while (queue.length) {
    const [cur, path] = queue.shift();
    const node = S.nodes[cur];
    if (!node) continue;
    for (const neighborId of (node.edges || [])) {
      if (visited.has(neighborId)) continue;
      const nb = S.nodes[neighborId];
      if (!nb || nb.floor !== floor) continue;
      const newPath = [...path, neighborId];
      if (neighborId === goalId) return newPath;
      visited.add(neighborId);
      queue.push([neighborId, newPath]);
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
  // Fallback: same type, coords within 0.1, AND the candidate node
  // must actually exist on targetFloor (handles stairs that only span 1-2F)
  return Object.values(S.nodes).find(n =>
    n.floor === targetFloor &&
    n.type === node.type &&
    Math.abs(n.nx - node.nx) < 0.1 &&
    Math.abs(n.ny - node.ny) < 0.1
  ) || null;
}

function renderAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoute();
  drawDebugEdges();
  drawDebugNodes();
  drawLastClick();
}

function drawRoute() {
  if (!S.path || !S.dest) return;

  let segment = S.path;
  if (S.crossFloor && S.floor === S.crossFloor.targetFloor) {
    segment = S.crossFloor.seg2;
  }

  const pts = segment
    .map(id => S.nodes[id])
    .filter(n => n && n.floor === S.floor);

  if (pts.length < 2) {
    if (pts.length === 1) drawDestDot(pts[0]);
    return;
  }

  const coords = pts.map(n => ({
    x: n.nx * S.imgW,
    y: n.ny * S.imgH,
  }));

  const dashLen = 28;
  const gapLen = 14;
  const offset = (Date.now() / 30) % (dashLen + gapLen);

  ctx.save();
  ctx.strokeStyle = '#0a84ff';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([dashLen, gapLen]);
  ctx.lineDashOffset = -offset;

  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
  ctx.stroke();

  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(coords[0].x, coords[0].y);
  for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
  ctx.stroke();
  ctx.restore();

  drawYouAreHere(coords[0]);

  if (!S.crossFloor || S.floor === S.dest.floor) {
    drawDestDot(pts[pts.length - 1]);
  } else {
    drawTransitMarker(coords[coords.length - 1], S.crossFloor.via.type);
  }
}

function drawDebugEdges() {
  if (!S.debug.showEdges) return;

  const nodes = Object.values(S.nodes).filter(n => n.floor === S.floor);
  const drawn = new Set();

  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,140,0.85)';
  ctx.lineWidth = 4;

  for (const n of nodes) {
    const x1 = n.nx * S.imgW;
    const y1 = n.ny * S.imgH;

    for (const edgeId of (n.edges || [])) {
      const t = S.nodes[edgeId];
      if (!t || t.floor !== S.floor) continue;

      const key = [n.id, t.id].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);

      const x2 = t.nx * S.imgW;
      const y2 = t.ny * S.imgH;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawDebugNodes() {
  if (!S.debug.showNodes) return;

  const nodes = Object.values(S.nodes).filter(n => n.floor === S.floor);

  for (const n of nodes) {
    const x = n.nx * S.imgW;
    const y = n.ny * S.imgH;

    let color = '#ff453a';
    let radius = 8;

    if (n.type === 'corridor') { color = '#ffd60a'; radius = 9; }
    if (n.type === 'door')     { color = '#ff375f'; radius = 7; }
    if (n.type === 'anchor')   { color = '#64d2ff'; radius = 10; }
    if (n.type === 'stair')    { color = '#bf5af2'; radius = 9; }
    if (n.type === 'elevator') { color = '#30d158'; radius = 9; }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (S.debug.showLabels) {
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.strokeText(n.id, x + 12, y - 10);
      ctx.fillText(n.id, x + 12, y - 10);
    }
    ctx.restore();
  }
}

function drawLastClick() {
  if (!S.debug.lastClick || S.debug.lastClick.floor !== S.floor) return;

  const { x, y } = S.debug.lastClick;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 14, y);
  ctx.lineTo(x + 14, y);
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x, y + 14);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawYouAreHere(pt) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,132,255,0.2)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#0a84ff';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function drawDestDot(node) {
  const x = node.nx * S.imgW;
  const y = node.ny * S.imgH;
  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,55,95,0.25)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#ff375f';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const label = S.dest?.id || '';
  ctx.font = 'bold 22px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeText(label, x, y - 20);
  ctx.fillText(label, x, y - 20);
  ctx.restore();
}

function drawTransitMarker(pt, type) {
  const label = type === 'elevator' ? 'Elevator' : 'Stairs';
  ctx.save();
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = '#ff9f0a';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.font = 'bold 18px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeText(label, pt.x, pt.y - 22);
  ctx.fillText(label, pt.x, pt.y - 22);
  ctx.restore();
}

function zoomToPath(segment) {
  const pts = segment
    .map(id => S.nodes[id])
    .filter(n => n && n.floor === S.floor);
  if (pts.length === 0) return;

  const pad = 80;
  const minNx = Math.min(...pts.map(n => n.nx));
  const maxNx = Math.max(...pts.map(n => n.nx));
  const minNy = Math.min(...pts.map(n => n.ny));
  const maxNy = Math.max(...pts.map(n => n.ny));

  const pxW = (maxNx - minNx) * S.imgW || S.imgW * 0.3;
  const pxH = (maxNy - minNy) * S.imgH || S.imgH * 0.3;

  const aw = mapArea.clientWidth;
  const ah = mapArea.clientHeight;
  const scaleX = (aw - pad * 2) / pxW;
  const scaleY = (ah - pad * 2) / pxH;
  const newScale = Math.min(scaleX, scaleY, 3);

  const cx = (minNx + maxNx) / 2 * S.imgW;
  const cy = (minNy + maxNy) / 2 * S.imgH;
  S.scale = newScale;
  S.panX = aw / 2 - cx * S.scale;
  S.panY = ah / 2 - cy * S.scale;
  applyTransform();
}

function updateBanner(route) {
  if (!route.crossFloor) {
    banner.classList.remove('visible');
    return;
  }
  const { via, targetFloor } = route.crossFloor;
  const verb = via.type === 'elevator' ? 'Take elevator' : 'Take stairs';
  banner.textContent = `${verb} to floor ${targetFloor} → tap floor tab to continue`;
  banner.classList.add('visible');
}

function applyTransform() {
  mapCont.style.transform = `translate(${S.panX}px,${S.panY}px) scale(${S.scale})`;
}

toggleNodes?.addEventListener('change', e => {
  S.debug.showNodes = e.target.checked;
  renderAll();
});

toggleEdges?.addEventListener('change', e => {
  S.debug.showEdges = e.target.checked;
  renderAll();
});

toggleLabels?.addEventListener('change', e => {
  S.debug.showLabels = e.target.checked;
  renderAll();
});

btnCopyCoords?.addEventListener('click', async () => {
  if (!S.debug.lastClick) return;
  const text = `${S.debug.lastClick.pxX}, ${S.debug.lastClick.pxY}  =>  ${S.debug.lastClick.nx.toFixed(4)}, ${S.debug.lastClick.ny.toFixed(4)}`;
  try {
    await navigator.clipboard.writeText(text);
    debugReadout.textContent = `${text} copied`;
  } catch {
    debugReadout.textContent = text;
  }
});

mapArea.addEventListener('click', e => {
  const rect = mapArea.getBoundingClientRect();
  const localX = (e.clientX - rect.left - S.panX) / S.scale;
  const localY = (e.clientY - rect.top - S.panY) / S.scale;

  if (localX < 0 || localY < 0 || localX > S.imgW || localY > S.imgH) return;

  const nx = localX / S.imgW;
  const ny = localY / S.imgH;

  S.debug.lastClick = {
    floor: S.floor,
    x: localX,
    y: localY,
    pxX: Math.round(localX),
    pxY: Math.round(localY),
    nx,
    ny,
  };

  debugReadout.textContent =
    `px(${Math.round(localX)}, ${Math.round(localY)})  norm(${nx.toFixed(4)}, ${ny.toFixed(4)})`;

  console.log('Map click:', S.debug.lastClick);
  renderAll();
});

let lastTouches = null;
mapArea.addEventListener('touchstart', e => {
  lastTouches = getTouches(e);
}, { passive: true });

mapArea.addEventListener('touchmove', e => {
  e.preventDefault();
  const cur = getTouches(e);
  if (!lastTouches) { lastTouches = cur; return; }

  if (cur.length === 1 && lastTouches.length === 1) {
    S.panX += cur[0].x - lastTouches[0].x;
    S.panY += cur[0].y - lastTouches[0].y;
  } else if (cur.length >= 2 && lastTouches.length >= 2) {
    const prevD = dist(lastTouches[0], lastTouches[1]);
    const curD  = dist(cur[0], cur[1]);
    const f = curD / prevD;
    const cx = (cur[0].x + cur[1].x) / 2 - mapArea.getBoundingClientRect().left;
    const cy = (cur[0].y + cur[1].y) / 2 - mapArea.getBoundingClientRect().top;
    S.panX = cx - (cx - S.panX) * f;
    S.panY = cy - (cy - S.panY) * f;
    S.scale *= f;

    const pcx = (lastTouches[0].x + lastTouches[1].x) / 2;
    const pcy = (lastTouches[0].y + lastTouches[1].y) / 2;
    const ncx = (cur[0].x + cur[1].x) / 2;
    const ncy = (cur[0].y + cur[1].y) / 2;
    S.panX += ncx - pcx;
    S.panY += ncy - pcy;
  }
  lastTouches = cur;
  applyTransform();
}, { passive: false });

mapArea.addEventListener('touchend', () => { lastTouches = null; });

mapArea.addEventListener('wheel', e => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.1 : 0.91;
  const rect = mapArea.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  S.panX = cx - (cx - S.panX) * f;
  S.panY = cy - (cy - S.panY) * f;
  S.scale *= f;
  applyTransform();
}, { passive: false });

let mouseDrag = false, mouseOrigin = null, mouseOriginPan = null;
mapArea.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  mouseDrag = true;
  mouseOrigin = { x: e.clientX, y: e.clientY };
  mouseOriginPan = { x: S.panX, y: S.panY };
});

window.addEventListener('mousemove', e => {
  if (!mouseDrag) return;
  S.panX = mouseOriginPan.x + e.clientX - mouseOrigin.x;
  S.panY = mouseOriginPan.y + e.clientY - mouseOrigin.y;
  applyTransform();
});

window.addEventListener('mouseup', () => { mouseDrag = false; });

function getTouches(e) {
  return Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

window.addEventListener('resize', () => {
  if (S.imgW > 1) {
    fitToView();
    renderAll();
  }
});

boot().catch(console.error);