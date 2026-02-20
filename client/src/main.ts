import { io, type Socket } from 'socket.io-client';
import { GameRenderer } from './game/GameRenderer';
import './styles.css';
import type {
  ClassType,
  GameEndPayload,
  GameSnapshotPayload,
  ItemType,
  LobbyPlayer,
  LobbyStatePayload,
  OpenRoomsPayload,
  OpenRoomSummary,
  SnapshotPickupEvent,
  SnapshotPlayer,
  SocketErrorPayload
} from './types';

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
const resolvedServerUrl = resolveServerUrl(serverUrl);
const socket: Socket = io(resolvedServerUrl, {
  transports: ['websocket', 'polling']
});
const ROOM_QUERY_PARAM = 'room';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('No se encontró #app');
}

app.innerHTML = `
  <div id="game-root"></div>

  <div id="home-shell" class="home-shell">
    <section id="home-panel" class="panel home-panel">
      <h1>La casa de Ares</h1>

      <label>Nombre (3-16)
        <input id="name-input" type="text" maxlength="16" minlength="3" placeholder="Tu nombre" />
      </label>

      <label>Clase
        <select id="class-select">
          <option value="sorceress">Hechicera</option>
          <option value="paladin">Paladín</option>
          <option value="barbarian">Bárbaro</option>
        </select>
      </label>

      <label id="room-label">Room ID (solo para unirse)
        <input id="room-input" type="text" maxlength="6" placeholder="ABC123" />
      </label>

      <div id="home-actions" class="row">
        <button id="create-btn">Crear sala</button>
        <button id="join-btn" class="secondary">Unirse</button>
      </div>
      <button id="accept-btn" class="secondary hidden">Aceptar</button>
    </section>

    <aside id="open-rooms-panel" class="panel home-open-rooms">
      <h2>Partidas abiertas</h2>
      <p id="open-rooms-help" class="open-rooms-help">Salas en lobby disponibles para unirse.</p>
      <p id="open-rooms-empty" class="open-rooms-empty">No hay salas abiertas ahora.</p>
      <ul id="open-rooms-list" class="open-rooms-list"></ul>
    </aside>
  </div>

  <section id="lobby-panel" class="panel hidden">
    <h2>Lobby</h2>
    <div id="lobby-room-row" class="lobby-room-row">
      <p id="lobby-room"></p>
      <button id="copy-link-btn" class="secondary">Copiar enlace</button>
    </div>
    <p id="lobby-share-url" class="lobby-share-url"></p>
    <ul id="lobby-players"></ul>
    <button id="start-btn" class="hidden">Empezar batalla</button>
  </section>

  <section id="end-panel" class="panel hidden">
    <h2>Resultados</h2>
    <ol id="results-list"></ol>
    <button id="exit-btn">Salir</button>
  </section>

  <aside id="leaderboard-panel" class="leaderboard hidden">
    <div class="leaderboard-top">
      <h3>Estado de combate</h3>
      <ul id="leaderboard-list" class="stats-list"></ul>
    </div>
    <div class="leaderboard-bottom legend">
      <h3>Leyenda</h3>
      <div class="legend-section">
        <h4>Clases</h4>
        <ul class="legend-list">
          <li><span class="sprite-icon sprite-character sprite-character-sorceress"></span><span><strong>Hechicera</strong>: teletransporte tras 1s continuo en fuego.</span></li>
          <li><span class="sprite-icon sprite-character sprite-character-paladin"></span><span><strong>Paladín</strong>: al bajar a 20% o menos, se cura a 80% (1 vez).</span></li>
          <li><span class="sprite-icon sprite-character sprite-character-barbarian"></span><span><strong>Bárbaro</strong>: primer daño activa escudo extra de 50 HP.</span></li>
        </ul>
      </div>
      <div class="legend-section">
        <h4>Estadísticas</h4>
        <ul class="legend-list">
          <li><span><strong>A</strong>: daño de cada golpe básico.</span></li>
          <li><span><strong>V</strong>: velocidad de movimiento (px/s).</span></li>
          <li><span><strong>E</strong>: enfriamiento entre ataques.</span></li>
        </ul>
      </div>
      <div class="legend-section">
        <h4>Objetos</h4>
        <ul class="legend-list">
          <li><span class="sprite-icon sprite-item sprite-item-sword"></span><span><strong>Espada</strong>: aumenta el daño de ataque.</span></li>
          <li><span class="sprite-icon sprite-item sprite-item-boots"></span><span><strong>Botas</strong>: aumenta la velocidad de movimiento.</span></li>
          <li><span class="sprite-icon sprite-item sprite-item-amulet"></span><span><strong>Amuleto</strong>: reduce el cooldown entre ataques.</span></li>
          <li><span class="sprite-icon sprite-item sprite-item-armor"></span><span><strong>Coraza</strong>: aumenta la vida máxima en +20.</span></li>
          <li><span class="sprite-icon sprite-item sprite-item-blessing"></span><span><strong>Bendición</strong>: inmunidad total al daño del fuego.</span></li>
        </ul>
      </div>
      <div class="legend-section">
        <h4>Peligros</h4>
        <ul class="legend-list">
          <li><span class="sprite-icon sprite-hazard sprite-hazard-fire"></span><span><strong>Fuego</strong>: daño por tick mientras estés dentro.</span></li>
          <li><span class="sprite-icon sprite-hazard sprite-hazard-meteor"></span><span><strong>Meteorito</strong>: cae en área cuadrada tras un breve aviso visual.</span></li>
          <li><span class="sprite-icon sprite-hazard sprite-hazard-fire"></span><span><strong>Cierre del mapa</strong>: el borde se convierte en fuego progresivamente y te obliga al centro.</span></li>
        </ul>
      </div>
    </div>
  </aside>

  <div id="toast" class="toast hidden"></div>
`;

const homeShell = must<HTMLDivElement>('#home-shell');
const lobbyPanel = must<HTMLDivElement>('#lobby-panel');
const endPanel = must<HTMLDivElement>('#end-panel');
const toast = must<HTMLDivElement>('#toast');
const leaderboardPanel = must<HTMLElement>('#leaderboard-panel');

const nameInput = must<HTMLInputElement>('#name-input');
const classSelect = must<HTMLSelectElement>('#class-select');
const roomInput = must<HTMLInputElement>('#room-input');
const roomLabel = must<HTMLLabelElement>('#room-label');
const homeActions = must<HTMLDivElement>('#home-actions');
const createBtn = must<HTMLButtonElement>('#create-btn');
const joinBtn = must<HTMLButtonElement>('#join-btn');
const acceptBtn = must<HTMLButtonElement>('#accept-btn');
const startBtn = must<HTMLButtonElement>('#start-btn');
const exitBtn = must<HTMLButtonElement>('#exit-btn');
const lobbyRoom = must<HTMLParagraphElement>('#lobby-room');
const lobbyShareUrl = must<HTMLParagraphElement>('#lobby-share-url');
const copyLinkBtn = must<HTMLButtonElement>('#copy-link-btn');
const lobbyPlayers = must<HTMLUListElement>('#lobby-players');
const resultsList = must<HTMLOListElement>('#results-list');
const leaderboardList = must<HTMLUListElement>('#leaderboard-list');
const openRoomsList = must<HTMLUListElement>('#open-rooms-list');
const openRoomsEmpty = must<HTMLParagraphElement>('#open-rooms-empty');

let renderer: GameRenderer | null = null;
let receivedFirstSnapshot = false;
let toastTimeout: number | null = null;
let currentShareUrl: string | null = null;
const highlightBySocketId = new Map<string, number>();
const compactMobileQuery = window.matchMedia('(max-width: 600px) and (orientation: portrait)');
const desktopHudMarginPx = 16;
const desktopHudBoardGapPx = 18;
const minDesktopHudWidthPx = 220;
const leaderboardRenderIntervalMs = 140;
let lastLeaderboardRenderAt = 0;
let pendingLeaderboardPlayers: SnapshotPlayer[] | null = null;
let leaderboardRenderTimeout: number | null = null;
let legendWidthRaf: number | null = null;

const savedName = localStorage.getItem('player_name');
if (savedName) {
  nameInput.value = savedName;
}
const savedClass = localStorage.getItem('player_class');
if (savedClass) {
  classSelect.value = savedClass;
}
const roomFromUrl = getRoomIdFromQueryParam();
if (roomFromUrl) {
  roomInput.value = roomFromUrl;
  enableJoinViaLinkMode(roomFromUrl);
}

createBtn.addEventListener('click', () => {
  if (!socket.connected) {
    notify('Sin conexión con el servidor. Revisa red/SSL y recarga.');
    return;
  }

  const playerName = validatedName();
  if (!playerName) {
    notify('El nombre debe tener entre 3 y 16 caracteres.');
    return;
  }

  const selectedClass = classSelect.value as ClassType;
  persistIdentity(playerName, selectedClass);
  socket.emit('room:create', {
    name: playerName,
    class: selectedClass
  });
});

joinBtn.addEventListener('click', () => {
  submitJoin();
});

acceptBtn.addEventListener('click', () => {
  submitJoin();
});

copyLinkBtn.addEventListener('click', async () => {
  if (!currentShareUrl) {
    notify('No hay enlace de sala disponible todavía.');
    return;
  }

  const copied = await copyTextToClipboard(currentShareUrl);
  if (!copied) {
    notify('No se pudo copiar el enlace automáticamente.');
    return;
  }

  notify('Enlace de sala copiado.');
});

function submitJoin(): void {
  if (!socket.connected) {
    notify('Sin conexión con el servidor. Revisa red/SSL y recarga.');
    return;
  }

  const playerName = validatedName();
  if (!playerName) {
    notify('El nombre debe tener entre 3 y 16 caracteres.');
    return;
  }

  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    notify('Indica un roomId para unirte.');
    return;
  }

  const selectedClass = classSelect.value as ClassType;
  persistIdentity(playerName, selectedClass);
  socket.emit('room:join', {
    roomId,
    name: playerName,
    class: selectedClass
  });
}

startBtn.addEventListener('click', () => {
  if (!socket.connected) {
    notify('Sin conexión con el servidor. Revisa red/SSL y recarga.');
    return;
  }

  socket.emit('room:start');
});

exitBtn.addEventListener('click', () => {
  renderer?.destroy();
  renderer = null;
  socket.disconnect();
  removeRoomQueryParam();
  window.location.reload();
});

socket.on('connect', () => {
  socket.emit('room:listOpen');
});

socket.on('room:openList', (payload: OpenRoomsPayload) => {
  renderOpenRooms(payload.rooms);
});

socket.on('room:lobbyState', (payload: LobbyStatePayload) => {
  receivedFirstSnapshot = false;
  highlightBySocketId.clear();
  renderLobby(payload);
  setScreen('lobby');
});

socket.on('game:snapshot', (snapshot: GameSnapshotPayload) => {
  if (!renderer) {
    renderer = new GameRenderer('game-root');
  }

  consumePickupEvents(snapshot.pickups);
  scheduleLeaderboardRender(snapshot.players);
  renderer.pushSnapshot(snapshot);

  if (!receivedFirstSnapshot) {
    receivedFirstSnapshot = true;
    setScreen('game');
  }
});

socket.on('game:end', (payload: GameEndPayload) => {
  renderEnd(payload);
  setScreen('end');
});

socket.on('error', (payload: SocketErrorPayload | Error) => {
  if ('message' in payload) {
    notify(payload.message);
    return;
  }

  notify('Error de red.');
});

socket.on('connect_error', (err) => {
  const detail = err?.message ? ` (${err.message})` : '';
  notify(`No se pudo conectar al servidor (socket)${detail}.`);
});

socket.on('disconnect', (reason) => {
  if (reason === 'io client disconnect') {
    return;
  }
  notify('Conexión perdida con el servidor.');
});

function renderLobby(payload: LobbyStatePayload): void {
  syncRoomQueryParam(payload.roomId);
  lobbyRoom.textContent = `Sala: ${payload.roomId}`;
  currentShareUrl = buildShareUrl(payload.roomId);
  lobbyShareUrl.textContent = currentShareUrl;
  lobbyPlayers.innerHTML = '';

  const selfId = socket.id;
  const isHost = selfId !== undefined && payload.hostId === selfId;

  const ordered = [...payload.players].sort((a, b) => a.playerId - b.playerId);
  for (const player of ordered) {
    lobbyPlayers.appendChild(playerLi(player, payload.hostId));
  }

  startBtn.classList.toggle('hidden', !isHost);
}

function renderOpenRooms(rooms: OpenRoomSummary[]): void {
  openRoomsList.innerHTML = '';
  openRoomsEmpty.classList.toggle('hidden', rooms.length > 0);

  for (const room of rooms) {
    const li = document.createElement('li');
    li.className = 'open-room-row';

    const summary = document.createElement('div');
    summary.className = 'open-room-summary';

    const roomId = document.createElement('strong');
    roomId.className = 'open-room-id';
    roomId.textContent = room.roomId;

    const meta = document.createElement('span');
    meta.className = 'open-room-meta';
    meta.textContent = `${room.playerCount}/${room.maxPlayers} | Host: ${room.hostName}`;

    summary.appendChild(roomId);
    summary.appendChild(meta);

    const join = document.createElement('button');
    join.className = 'secondary open-room-join';
    join.type = 'button';
    join.textContent = 'Unirse';
    join.disabled = room.playerCount >= room.maxPlayers;
    join.addEventListener('click', () => {
      if (roomInput.readOnly) {
        notify('Estás en modo enlace. Quita ?room=... para elegir otra sala.');
        return;
      }
      roomInput.value = room.roomId;
      submitJoin();
    });

    li.appendChild(summary);
    li.appendChild(join);
    openRoomsList.appendChild(li);
  }
}

function renderEnd(payload: GameEndPayload): void {
  resultsList.innerHTML = '';

  const ordered = [...payload.results].sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.playerId - b.playerId;
  });

  for (const result of ordered) {
    const li = document.createElement('li');
    li.className = 'result-row';
    if (result.position === 1) {
      li.classList.add('result-gold');
    } else if (result.position === 2) {
      li.classList.add('result-silver');
    } else if (result.position === 3) {
      li.classList.add('result-bronze');
    }

    const left = document.createElement('div');
    left.className = 'result-left';

    const rank = document.createElement('span');
    rank.className = 'result-rank';
    rank.textContent = `#${result.position}`;

    const medal = document.createElement('span');
    medal.className = 'result-medal';
    medal.textContent = medalForPosition(result.position);

    const identity = document.createElement('div');
    identity.className = 'result-identity';

    const name = document.createElement('span');
    name.className = 'result-name';
    name.textContent = result.name;

    const classTag = document.createElement('span');
    classTag.className = `result-class class-${result.classType}`;
    classTag.textContent = classLabel(result.classType);

    identity.appendChild(name);
    identity.appendChild(classTag);
    left.appendChild(rank);
    left.appendChild(medal);
    left.appendChild(identity);

    const hpInfo = document.createElement('span');
    hpInfo.className = 'result-hp';
    const hp = Math.ceil(result.hp / 100);
    const maxHp = Math.max(1, Math.ceil(result.maxHp / 100));
    hpInfo.textContent = `HP ${hp}/${maxHp}`;

    li.appendChild(left);
    li.appendChild(hpInfo);
    resultsList.appendChild(li);
  }
}

function medalForPosition(position: number): string {
  if (position === 1) {
    return '🥇';
  }
  if (position === 2) {
    return '🥈';
  }
  if (position === 3) {
    return '🥉';
  }
  return '';
}

function setScreen(screen: 'home' | 'lobby' | 'game' | 'end'): void {
  homeShell.classList.toggle('hidden', screen !== 'home');
  lobbyPanel.classList.toggle('hidden', screen !== 'lobby');
  endPanel.classList.toggle('hidden', screen !== 'end');
  leaderboardPanel.classList.toggle('hidden', screen !== 'game');
  if (screen === 'game') {
    requestLegendWidthSync();
  }
}

function scheduleLeaderboardRender(players: SnapshotPlayer[]): void {
  pendingLeaderboardPlayers = players;
  const elapsed = performance.now() - lastLeaderboardRenderAt;
  const waitMs = Math.max(0, leaderboardRenderIntervalMs - elapsed);

  if (waitMs === 0) {
    flushLeaderboardRender();
    return;
  }

  if (leaderboardRenderTimeout !== null) {
    return;
  }

  leaderboardRenderTimeout = window.setTimeout(() => {
    leaderboardRenderTimeout = null;
    flushLeaderboardRender();
  }, waitMs);
}

function flushLeaderboardRender(): void {
  const players = pendingLeaderboardPlayers;
  if (!players) {
    return;
  }

  pendingLeaderboardPlayers = null;
  lastLeaderboardRenderAt = performance.now();
  renderLeaderboard(players);
}

function validatedName(): string | null {
  const value = nameInput.value.trim();
  if (value.length < 3 || value.length > 16) {
    return null;
  }
  return value;
}

function persistIdentity(name: string, classType: ClassType): void {
  localStorage.setItem('player_name', name);
  localStorage.setItem('player_class', classType);
}

function playerLi(player: LobbyPlayer, hostId: string): HTMLLIElement {
  const li = document.createElement('li');
  const hostTag = player.socketId === hostId ? ' [HOST]' : '';
  li.textContent = `${player.name} (${classLabel(player.classType)})${hostTag}`;
  return li;
}

function classLabel(classType: ClassType): string {
  if (classType === 'sorceress') {
    return 'Hechicera';
  }
  if (classType === 'paladin') {
    return 'Paladín';
  }
  return 'Bárbaro';
}

function renderLeaderboard(players: SnapshotPlayer[]): void {
  const ordered = [...players].sort((a, b) => {
    if (a.hp !== b.hp) {
      return b.hp - a.hp;
    }
    return a.playerId - b.playerId;
  });

  leaderboardList.innerHTML = '';
  const now = performance.now();
  for (const [socketId, until] of highlightBySocketId) {
    if (until <= now) {
      highlightBySocketId.delete(socketId);
    }
  }

  for (let i = 0; i < ordered.length; i += 1) {
    const player = ordered[i];
    const li = document.createElement('li');
    li.className = 'stats-row';
    const highlightUntil = highlightBySocketId.get(player.socketId) ?? 0;
    if (highlightUntil > now) {
      li.classList.add('item-pickup-highlight');
    }

    const hp = Math.ceil(player.hp / 100);
    const hpMax = Math.max(1, Math.ceil(player.maxHp / 100));
    const hpRatio = Math.max(0, Math.min(1, player.hp / player.maxHp));
    const attack = Math.ceil(player.attackDamage / 100);
    const cooldownSeconds = (player.attackCooldownTicks / 20).toFixed(2);

    const top = document.createElement('div');
    top.className = 'stats-top';

    const rank = document.createElement('span');
    rank.className = 'stats-rank';
    rank.textContent = `#${i + 1}`;

    const identity = document.createElement('div');
    identity.className = 'stats-identity';

    const name = document.createElement('span');
    name.className = 'stats-name';
    name.textContent = player.name;

    const classTag = document.createElement('span');
    classTag.className = `stats-class class-${player.classType}`;
    classTag.textContent = classLabel(player.classType);

    identity.appendChild(name);
    identity.appendChild(classTag);
    identity.appendChild(statBadge('A', `${attack}`));
    identity.appendChild(statBadge('V', `${player.speedPerSecond}`));
    identity.appendChild(statBadge('E', `${cooldownSeconds}s`));

    top.appendChild(rank);
    top.appendChild(identity);

    const hpTrack = document.createElement('div');
    hpTrack.className = 'stats-hp-track';
    const hpFill = document.createElement('div');
    hpFill.className = 'stats-hp-fill';
    hpFill.style.width = `${(hpRatio * 100).toFixed(1)}%`;
    const hpLabel = document.createElement('span');
    hpLabel.className = 'stats-hp-label';
    hpLabel.textContent = `${hp}/${hpMax}`;
    hpTrack.appendChild(hpFill);
    hpTrack.appendChild(hpLabel);

    const summary = document.createElement('div');
    summary.className = 'stats-summary';
    summary.appendChild(top);
    summary.appendChild(hpTrack);

    const items = document.createElement('div');
    items.className = 'stats-items';
    items.appendChild(itemChip('sword', player.swords));
    items.appendChild(itemChip('boots', player.boots));
    items.appendChild(itemChip('amulet', player.amulets));
    items.appendChild(itemChip('armor', player.armors));
    items.appendChild(itemChip('blessing', player.blessings));

    li.appendChild(summary);
    li.appendChild(items);
    leaderboardList.appendChild(li);
  }
}

function statBadge(label: string, value: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'stats-badge';
  badge.title = metricDescription(label);

  const key = document.createElement('span');
  key.className = 'stats-badge-key';
  key.textContent = label;

  const val = document.createElement('span');
  val.className = 'stats-badge-val';
  val.textContent = value;

  badge.appendChild(key);
  badge.appendChild(val);
  return badge;
}

function itemChip(itemType: ItemType, count: number): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'item-chip';
  chip.title = itemDescription(itemType);

  const icon = document.createElement('span');
  icon.className = `sprite-icon sprite-item sprite-item-${itemType}`;

  const countValue = document.createElement('span');
  countValue.className = 'item-chip-count';
  countValue.textContent = `${count}`;

  chip.appendChild(icon);
  chip.appendChild(countValue);
  return chip;
}

function metricDescription(label: string): string {
  if (label === 'A') {
    return 'Daño de cada golpe básico.';
  }
  if (label === 'V') {
    return 'Velocidad de movimiento en píxeles por segundo.';
  }
  return 'enfriamiento entre ataque';
}

function syncLegendWidth(): void {
  if (leaderboardPanel.classList.contains('hidden')) {
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (compactMobileQuery.matches || viewportWidth <= 600) {
    leaderboardPanel.style.left = '';
    leaderboardPanel.style.right = '';
    return;
  }

  const boardVisibleSize = Math.min(viewportWidth, viewportHeight);
  const boardRightEdgePx = (viewportWidth + boardVisibleSize) / 2;
  const leftPx = Math.round(boardRightEdgePx + desktopHudBoardGapPx);
  const rightPx = desktopHudMarginPx;
  if (leftPx + minDesktopHudWidthPx >= viewportWidth - rightPx) {
    leaderboardPanel.style.left = '';
    leaderboardPanel.style.right = `${rightPx}px`;
    return;
  }

  leaderboardPanel.style.left = `${leftPx}px`;
  leaderboardPanel.style.right = `${rightPx}px`;
}

window.addEventListener('resize', () => {
  requestLegendWidthSync();
});

function requestLegendWidthSync(): void {
  if (legendWidthRaf !== null) {
    return;
  }
  legendWidthRaf = window.requestAnimationFrame(() => {
    legendWidthRaf = null;
    syncLegendWidth();
  });
}

if ('addEventListener' in compactMobileQuery) {
  compactMobileQuery.addEventListener('change', requestLegendWidthSync);
} else {
  compactMobileQuery.addListener(requestLegendWidthSync);
}

function itemDescription(itemType: ItemType): string {
  if (itemType === 'sword') {
    return 'Espadas recogidas. Cada espada aumenta el daño de ataque.';
  }
  if (itemType === 'boots') {
    return 'Botas recogidas. Cada bota aumenta la velocidad de movimiento.';
  }
  if (itemType === 'armor') {
    return 'Corazas recogidas. Cada coraza sube la vida máxima en +20.';
  }
  if (itemType === 'blessing') {
    return 'Bendiciones recogidas. Inmunidad total al daño del fuego.';
  }
  return 'Amuletos recogidos. Cada amuleto reduce el cooldown de ataque.';
}

function consumePickupEvents(events: SnapshotPickupEvent[]): void {
  if (events.length === 0) {
    return;
  }

  const now = performance.now();
  const ordered = [...events].sort((a, b) => a.tick - b.tick);
  for (const event of ordered) {
    highlightBySocketId.set(event.socketId, now + 1600);
  }

  const latest = ordered[ordered.length - 1];
  const extra = ordered.length > 1 ? ` (+${ordered.length - 1} más)` : '';
  notify(`${latest.playerName} recogió ${itemLabel(latest.itemType)}${extra}.`, latest.itemType);
}

function itemLabel(itemType: ItemType): string {
  if (itemType === 'sword') {
    return 'Espada';
  }
  if (itemType === 'boots') {
    return 'Botas';
  }
  if (itemType === 'amulet') {
    return 'Amuleto';
  }
  if (itemType === 'armor') {
    return 'Coraza';
  }
  return 'Bendición';
}

function notify(message: string, itemType?: ItemType): void {
  toast.textContent = message;
  toast.className = 'toast';
  if (itemType) {
    toast.classList.add('pickup', `item-${itemType}`);
  }
  toast.classList.remove('hidden');

  if (toastTimeout !== null) {
    window.clearTimeout(toastTimeout);
  }

  toastTimeout = window.setTimeout(() => {
    toast.classList.add('hidden');
    toast.className = 'toast hidden';
    toastTimeout = null;
  }, 2500);
}

function must<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No se encontró ${selector}`);
  }
  return element;
}

function resolveServerUrl(configuredUrl?: string): string | undefined {
  if (!configuredUrl) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    return configuredUrl;
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const currentHost = window.location.hostname.toLowerCase();
  const currentIsLoopback = currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost === '::1';
  const pageIsHttps = window.location.protocol === 'https:';

  if (!isLoopback) {
    // Avoid mixed-content in HTTPS pages when server URL was set to plain HTTP.
    if (pageIsHttps && parsed.protocol === 'http:') {
      const sameHost = host === currentHost;
      if (sameHost) {
        return undefined;
      }
      parsed.protocol = 'https:';
      if (parsed.port === '80') {
        parsed.port = '';
      }
      return parsed.toString();
    }
    return configuredUrl;
  }

  // Avoid hardcoded localhost URLs when opening from another device (e.g. mobile).
  if (!currentIsLoopback) {
    const rewritten = new URL(window.location.origin);
    rewritten.port = parsed.port;
    rewritten.pathname = '';
    rewritten.search = '';
    rewritten.hash = '';
    return rewritten.toString();
  }

  return configuredUrl;
}

function enableJoinViaLinkMode(roomId: string): void {
  homeActions.classList.add('hidden');
  acceptBtn.classList.remove('hidden');
  joinBtn.classList.add('hidden');
  createBtn.classList.add('hidden');
  roomInput.value = roomId.toUpperCase();
  roomInput.readOnly = true;
  roomInput.classList.add('input-readonly');
  roomLabel.firstChild && (roomLabel.firstChild.textContent = 'Room ID (enlace compartido)');
}

function getRoomIdFromQueryParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(ROOM_QUERY_PARAM);
  if (!raw) {
    return null;
  }

  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!cleaned) {
    return null;
  }

  return cleaned;
}

function syncRoomQueryParam(roomId: string): void {
  const params = new URLSearchParams(window.location.search);
  const current = (params.get(ROOM_QUERY_PARAM) ?? '').toUpperCase();
  if (current === roomId.toUpperCase()) {
    return;
  }

  params.set(ROOM_QUERY_PARAM, roomId.toUpperCase());
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', nextUrl);
}

function removeRoomQueryParam(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(ROOM_QUERY_PARAM)) {
    return;
  }

  params.delete(ROOM_QUERY_PARAM);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', nextUrl);
}

function buildShareUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(ROOM_QUERY_PARAM, roomId.toUpperCase());
  return url.toString();
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below.
  }

  try {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.left = '-9999px';
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(helper);
    return ok;
  } catch {
    return false;
  }
}
