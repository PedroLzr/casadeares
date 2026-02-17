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
  SnapshotPickupEvent,
  SnapshotPlayer,
  SocketErrorPayload
} from './types';

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
const resolvedServerUrl = resolveServerUrl(serverUrl);
const socket: Socket = io(resolvedServerUrl, {
  transports: ['websocket', 'polling']
});

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('No se encontró #app');
}

app.innerHTML = `
  <div id="game-root"></div>

  <section id="home-panel" class="panel">
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

    <label>Room ID (solo para unirse)
      <input id="room-input" type="text" maxlength="6" placeholder="ABC123" />
    </label>

    <div class="row">
      <button id="create-btn">Crear sala</button>
      <button id="join-btn" class="secondary">Unirse</button>
    </div>
  </section>

  <section id="lobby-panel" class="panel hidden">
    <h2>Lobby</h2>
    <p id="lobby-room"></p>
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
          <li><span class="swatch sorceress"></span><strong>Hechicera</strong>: teletransporte tras 1s continuo en fuego.</li>
          <li><span class="swatch paladin"></span><strong>Paladín</strong>: al bajar a 20% o menos, se cura a 80% (1 vez).</li>
          <li><span class="swatch barbarian"></span><strong>Bárbaro</strong>: primer daño activa escudo extra de 50 HP.</li>
        </ul>
      </div>
      <div class="legend-section">
        <h4>Objetos</h4>
        <ul class="legend-list">
          <li><span class="swatch sword"></span><strong>Espada</strong>: aumenta el daño de ataque.</li>
          <li><span class="swatch boots"></span><strong>Botas</strong>: aumenta la velocidad de movimiento.</li>
          <li><span class="swatch amulet"></span><strong>Amuleto</strong>: reduce el cooldown entre ataques.</li>
          <li><span class="swatch armor"></span><strong>Coraza</strong>: aumenta la vida máxima en +20.</li>
          <li><span class="swatch blessing"></span><strong>Bendición</strong>: inmunidad total al daño del fuego.</li>
        </ul>
      </div>
      <div class="legend-section">
        <h4>Peligros</h4>
        <ul class="legend-list">
          <li><span class="swatch fire"></span><strong>Fuego</strong>: daño por tick mientras estés dentro.</li>
          <li><span class="swatch meteor"></span><strong>Meteorito</strong>: cae en área cuadrada tras un breve aviso visual.</li>
          <li><span class="swatch fire"></span><strong>Cierre del mapa</strong>: el borde se convierte en fuego progresivamente y te obliga al centro.</li>
        </ul>
      </div>
    </div>
  </aside>

  <div id="toast" class="toast hidden"></div>
`;

const homePanel = must<HTMLDivElement>('#home-panel');
const lobbyPanel = must<HTMLDivElement>('#lobby-panel');
const endPanel = must<HTMLDivElement>('#end-panel');
const toast = must<HTMLDivElement>('#toast');
const leaderboardPanel = must<HTMLElement>('#leaderboard-panel');

const nameInput = must<HTMLInputElement>('#name-input');
const classSelect = must<HTMLSelectElement>('#class-select');
const roomInput = must<HTMLInputElement>('#room-input');
const createBtn = must<HTMLButtonElement>('#create-btn');
const joinBtn = must<HTMLButtonElement>('#join-btn');
const startBtn = must<HTMLButtonElement>('#start-btn');
const exitBtn = must<HTMLButtonElement>('#exit-btn');
const lobbyRoom = must<HTMLParagraphElement>('#lobby-room');
const lobbyPlayers = must<HTMLUListElement>('#lobby-players');
const resultsList = must<HTMLOListElement>('#results-list');
const leaderboardList = must<HTMLUListElement>('#leaderboard-list');

let renderer: GameRenderer | null = null;
let receivedFirstSnapshot = false;
let toastTimeout: number | null = null;
const highlightBySocketId = new Map<string, number>();

const savedName = localStorage.getItem('player_name');
if (savedName) {
  nameInput.value = savedName;
}
const savedClass = localStorage.getItem('player_class');
if (savedClass) {
  classSelect.value = savedClass;
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
});

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
  window.location.reload();
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
  renderLeaderboard(snapshot.players);
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
  lobbyRoom.textContent = `Sala: ${payload.roomId}`;
  lobbyPlayers.innerHTML = '';

  const selfId = socket.id;
  const isHost = selfId !== undefined && payload.hostId === selfId;

  const ordered = [...payload.players].sort((a, b) => a.playerId - b.playerId);
  for (const player of ordered) {
    lobbyPlayers.appendChild(playerLi(player, payload.hostId));
  }

  startBtn.classList.toggle('hidden', !isHost);
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
  homePanel.classList.toggle('hidden', screen !== 'home');
  lobbyPanel.classList.toggle('hidden', screen !== 'lobby');
  endPanel.classList.toggle('hidden', screen !== 'end');
  leaderboardPanel.classList.toggle('hidden', screen !== 'game');
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
    const shield = Math.ceil(player.shield / 100);
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

    const hpText = document.createElement('span');
    hpText.className = 'stats-hp-text';
    hpText.textContent = shield > 0 ? `HP ${hp}/${hpMax} +${shield}S` : `HP ${hp}/${hpMax}`;

    top.appendChild(rank);
    top.appendChild(identity);
    top.appendChild(hpText);

    const hpTrack = document.createElement('div');
    hpTrack.className = 'stats-hp-track';
    const hpFill = document.createElement('div');
    hpFill.className = 'stats-hp-fill';
    hpFill.style.width = `${(hpRatio * 100).toFixed(1)}%`;
    hpTrack.appendChild(hpFill);

    const metrics = document.createElement('div');
    metrics.className = 'stats-metrics';
    metrics.appendChild(metricChip('ATK', `${attack}`));
    metrics.appendChild(metricChip('VEL', `${player.speedPerSecond}`));
    metrics.appendChild(metricChip('CD', `${cooldownSeconds}s`));

    const items = document.createElement('div');
    items.className = 'stats-items';
    items.appendChild(itemChip('SW', player.swords));
    items.appendChild(itemChip('BT', player.boots));
    items.appendChild(itemChip('AM', player.amulets));
    items.appendChild(itemChip('CZ', player.armors));
    items.appendChild(itemChip('BD', player.blessings));

    li.appendChild(top);
    li.appendChild(hpTrack);
    li.appendChild(metrics);
    li.appendChild(items);
    leaderboardList.appendChild(li);
  }
}

function metricChip(label: string, value: string): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'metric-chip';
  chip.title = metricDescription(label);

  const key = document.createElement('span');
  key.className = 'metric-key';
  key.textContent = label;

  const val = document.createElement('span');
  val.className = 'metric-val';
  val.textContent = value;

  chip.appendChild(key);
  chip.appendChild(val);
  return chip;
}

function itemChip(label: string, count: number): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'item-chip';
  chip.textContent = `${label}: ${count}`;
  chip.title = itemDescription(label);
  return chip;
}

function metricDescription(label: string): string {
  if (label === 'ATK') {
    return 'Daño de cada golpe básico.';
  }
  if (label === 'VEL') {
    return 'Velocidad de movimiento en píxeles por segundo.';
  }
  return 'Cooldown entre ataques básicos.';
}

function itemDescription(label: string): string {
  if (label === 'SW') {
    return 'Espadas recogidas. Cada espada aumenta el daño de ataque.';
  }
  if (label === 'BT') {
    return 'Botas recogidas. Cada bota aumenta la velocidad de movimiento.';
  }
  if (label === 'CZ') {
    return 'Corazas recogidas. Cada coraza sube la vida máxima en +20.';
  }
  if (label === 'BD') {
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
