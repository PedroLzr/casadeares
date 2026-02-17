export type ClassType = 'sorceress' | 'paladin' | 'barbarian';

export type ItemType = 'sword' | 'boots' | 'amulet' | 'armor' | 'blessing';

export interface LobbyPlayer {
  socketId: string;
  playerId: number;
  name: string;
  classType: ClassType;
  joinedAt: number;
}

export interface LobbyStatePayload {
  roomId: string;
  hostId: string;
  players: LobbyPlayer[];
}

export interface SnapshotMap {
  cellsPerSide: number;
  sizePx: number;
}

export interface SnapshotPlayer {
  socketId: string;
  playerId: number;
  name: string;
  classType: ClassType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield: number;
  attackDamage: number;
  speedPerSecond: number;
  attackCooldownTicks: number;
  swords: number;
  boots: number;
  amulets: number;
  armors: number;
  blessings: number;
}

export interface SnapshotHazard {
  id: string;
  type: 'fire' | 'meteor';
  x: number;
  y: number;
  size: number;
  ttlTicks: number;
}

export interface SnapshotItem {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  radius: number;
  ttlTicks: number;
}

export interface GameSnapshotPayload {
  t: number;
  tick: number;
  players: SnapshotPlayer[];
  hazards: SnapshotHazard[];
  items: SnapshotItem[];
  pickups: SnapshotPickupEvent[];
  map: SnapshotMap;
}

export interface SnapshotPickupEvent {
  id: string;
  socketId: string;
  playerId: number;
  playerName: string;
  itemType: ItemType;
  tick: number;
}

export interface GameEndResult {
  position: number;
  socketId: string;
  playerId: number;
  name: string;
  classType: ClassType;
  hp: number;
  maxHp: number;
  deathTick: number | null;
}

export interface GameEndPayload {
  results: GameEndResult[];
}

export interface SocketErrorPayload {
  code: string;
  message: string;
}
