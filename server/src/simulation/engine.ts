import {
  ARMOR_MAX_HP_BONUS,
  AMULET_COOLDOWN_REDUCTION_TICKS,
  ATTACK_COOLDOWN_TICKS,
  ATTACK_DAMAGE,
  ATTACK_KNOCKBACK_PX,
  ATTACK_RANGE,
  BARBARIAN_SHIELD,
  BOOTS_SPEED_BONUS_PER_SECOND,
  DANGER_ESCAPE_SPEED_MULTIPLIER,
  DETECTION_RANGE,
  FIRE_AREA_SIZE,
  FIRE_DAMAGE_PER_TICK,
  FIRE_ESCAPE_MARGIN_PX,
  FIRE_DURATION_TICKS,
  FIRE_INTERVAL_TICKS,
  GRID_CELL_PX,
  HP_MAX,
  ITEM_RADIUS,
  ITEM_DETECTION_RANGE,
  ITEM_SPAWN_INTERVAL_TICKS,
  ITEM_TTL_TICKS,
  MAX_ATTACK_DAMAGE,
  MAX_ITEMS_ON_MAP,
  MAX_SPEED_PX_PER_SECOND,
  MAP_WALL_COLLISION_PADDING,
  METEOR_AREA_SIZE,
  METEOR_DAMAGE,
  METEOR_WARNING_TICKS,
  METEOR_INTERVAL_TICKS,
  METEOR_VISUAL_TTL,
  MIN_ATTACK_COOLDOWN_TICKS,
  LOW_HP_TELEPORT_ATTACK_LOCK_TICKS,
  LOW_HP_TELEPORT_ATTEMPTS,
  LOW_HP_TELEPORT_MAX_DISTANCE_PX,
  LOW_HP_TELEPORT_MIN_DISTANCE_PX,
  LOW_HP_TELEPORT_TRIGGER_RATIO,
  PALADIN_HEAL_TO_HP,
  PALADIN_TRIGGER_HP,
  PLAYER_DIAMETER,
  PLAYER_SEPARATION_MIN_PUSH_PX,
  PLAYER_SEPARATION_PUSH_MULTIPLIER,
  PLAYER_SEPARATION_VISIBLE_GAP_PX,
  PLAYER_RADIUS,
  SNAPSHOT_EVERY_TICKS,
  SORCERESS_FIRE_TELEPORT_TICKS,
  SPATIAL_HASH_CELL_SIZE,
  SPEED_PX_PER_SECOND,
  SWORD_ATTACK_BONUS,
  SHRINK_MIN_SAFE_CELLS,
  SHRINK_START_TICKS,
  SHRINK_STEP_TICKS,
  SHRINK_WARNING_TICKS,
  TICK_MS,
  TICK_RATE,
  WALL_ESCAPE_MARGIN_PX,
  WANDER_CHANGE_TICKS
} from '../constants';
import type {
  GameEndPayload,
  GameEndResult,
  GameSnapshotPayload,
  ItemType,
  LobbyPlayer,
  SnapshotHazard,
  SnapshotItem,
  SnapshotMap,
  SnapshotPickupEvent,
  SnapshotPlayer
} from '../types';
import { SpatialHash } from './spatialHash';

interface Vec2 {
  x: number;
  y: number;
}

interface SimPlayer extends LobbyPlayer {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;
  deathTick: number | null;
  attackCooldownTicks: number;
  attackCooldownTicksMax: number;
  attackDamage: number;
  speedPerTick: number;
  swordCount: number;
  bootsCount: number;
  amuletCount: number;
  armorCount: number;
  blessingCount: number;
  wanderDir: Vec2;
  wanderTicksLeft: number;
  sorceressFireTicks: number;
  paladinUsed: boolean;
  barbarianUsed: boolean;
  lowHpTeleportUsed: boolean;
}

interface FireZone {
  id: string;
  x: number;
  y: number;
  size: number;
  endTick: number;
}

interface MeteorVisual {
  id: string;
  x: number;
  y: number;
  size: number;
  expiresAtTick: number;
}

interface PendingMeteorStrike {
  x: number;
  y: number;
  size: number;
  impactTick: number;
}

interface PendingRingActivation {
  activateTick: number;
  centers: Vec2[];
}

interface SimItem {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  radius: number;
  expiresAtTick: number;
}

type SnapshotCallback = (snapshot: GameSnapshotPayload) => void;
type EndCallback = (payload: GameEndPayload) => void;

export class GameSimulation {
  private readonly map: SnapshotMap;
  private readonly players = new Map<string, SimPlayer>();
  private readonly spatialHash = new SpatialHash(SPATIAL_HASH_CELL_SIZE);
  private readonly damageQueue = new Map<string, number>();

  private tick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  private fireZones: FireZone[] = [];
  private meteorVisuals: MeteorVisual[] = [];
  private pendingMeteorStrikes: PendingMeteorStrike[] = [];
  private pendingRingActivations: PendingRingActivation[] = [];
  private shrinkLayer = 0;
  private nextShrinkTick = SHRINK_START_TICKS;
  private items: SimItem[] = [];
  private pickupEvents: SnapshotPickupEvent[] = [];
  private nextHazardId = 1;
  private nextItemId = 1;
  private nextPickupEventId = 1;

  constructor(
    lobbyPlayers: LobbyPlayer[],
    private readonly onSnapshot: SnapshotCallback,
    private readonly onEnd: EndCallback
  ) {
    const n = lobbyPlayers.length;
    const cellsPerSide = Math.ceil(12 + 6 * Math.sqrt(n));
    this.map = {
      cellsPerSide,
      sizePx: cellsPerSide * GRID_CELL_PX
    };

    for (const lobbyPlayer of lobbyPlayers) {
      const spawned = this.randomSpawnPoint();
      this.players.set(lobbyPlayer.socketId, {
        ...lobbyPlayer,
        x: spawned.x,
        y: spawned.y,
        hp: HP_MAX,
        maxHp: HP_MAX,
        shield: 0,
        alive: true,
        deathTick: null,
        attackCooldownTicks: 0,
        attackCooldownTicksMax: ATTACK_COOLDOWN_TICKS,
        attackDamage: ATTACK_DAMAGE,
        speedPerTick: SPEED_PX_PER_SECOND / TICK_RATE,
        swordCount: 0,
        bootsCount: 0,
        amuletCount: 0,
        armorCount: 0,
        blessingCount: 0,
        wanderDir: randomUnitVector(),
        wanderTicksLeft: WANDER_CHANGE_TICKS,
        sorceressFireTicks: 0,
        paladinUsed: false,
        barbarianUsed: false,
        lowHpTeleportUsed: false
      });
    }
  }

  start(): void {
    if (this.timer || this.ended) {
      return;
    }

    this.timer = setInterval(() => {
      this.step();
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  removePlayer(socketId: string): void {
    this.players.delete(socketId);
    this.damageQueue.delete(socketId);

    if (this.alivePlayers().length <= 1) {
      this.finishGame();
    }
  }

  private step(): void {
    if (this.ended) {
      return;
    }

    this.tick += 1;
    this.spawnHazardsIfNeeded();
    this.spawnItemsIfNeeded();
    this.updateShrinkingRing();
    this.resolveRingActivations();
    this.movePlayers();
    this.resolvePlayerSeparation();
    this.pushDangerPlayersInward();
    this.resolveMeteorImpacts();
    this.collectItems();
    this.scheduleAttacks();
    this.applyFireAndSorceressSkill();
    this.resolveDamageQueue();
    this.cleanupExpiredWorldElements();

    if (this.tick % SNAPSHOT_EVERY_TICKS === 0) {
      this.emitSnapshot();
    }

    if (this.alivePlayers().length <= 1) {
      this.finishGame();
    }
  }

  private spawnHazardsIfNeeded(): void {
    if (this.tick > 0 && this.tick % METEOR_INTERVAL_TICKS === 0) {
      this.spawnMeteorWave();
    }

    if (this.tick > 0 && this.tick % FIRE_INTERVAL_TICKS === 0) {
      this.spawnFireZone();
    }
  }

  private spawnItemsIfNeeded(): void {
    if (this.tick === 0 || this.tick % ITEM_SPAWN_INTERVAL_TICKS !== 0) {
      return;
    }

    const alive = this.alivePlayers();
    if (alive.length === 0) {
      return;
    }

    const freeSlots = Math.max(0, MAX_ITEMS_ON_MAP - this.items.length);
    if (freeSlots === 0) {
      return;
    }

    const planned = Math.max(1, Math.floor(alive.length / 3));
    const spawnCount = Math.min(freeSlots, planned);

    for (let i = 0; i < spawnCount; i += 1) {
      const pos = this.randomPointInsideMapAvoidFire(ITEM_RADIUS, 30);
      this.items.push({
        id: this.nextItem(),
        type: randomItemType(),
        x: pos.x,
        y: pos.y,
        radius: ITEM_RADIUS,
        expiresAtTick: this.tick + ITEM_TTL_TICKS
      });
    }
  }

  private spawnMeteorWave(): void {
    const alive = this.alivePlayers();
    if (alive.length === 0) {
      return;
    }

    const count = Math.max(1, Math.floor(alive.length / 10));

    for (let i = 0; i < count; i += 1) {
      const center = this.randomSquareCenterInsideMap(METEOR_AREA_SIZE);
      const x = center.x;
      const y = center.y;
      const id = this.nextHazard('meteor');

      this.meteorVisuals.push({
        id,
        x,
        y,
        size: METEOR_AREA_SIZE,
        expiresAtTick: this.tick + METEOR_VISUAL_TTL
      });
      this.pendingMeteorStrikes.push({
        x,
        y,
        size: METEOR_AREA_SIZE,
        impactTick: this.tick + METEOR_WARNING_TICKS
      });
    }
  }

  private resolveMeteorImpacts(): void {
    if (this.pendingMeteorStrikes.length === 0) {
      return;
    }

    const remaining: PendingMeteorStrike[] = [];
    const alive = this.alivePlayers();

    for (const strike of this.pendingMeteorStrikes) {
      if (strike.impactTick > this.tick) {
        remaining.push(strike);
        continue;
      }

      const half = strike.size / 2;
      for (const player of alive) {
        if (Math.abs(player.x - strike.x) <= half && Math.abs(player.y - strike.y) <= half) {
          this.queueDamage(player.socketId, METEOR_DAMAGE);
        }
      }
    }

    this.pendingMeteorStrikes = remaining;
  }

  private spawnFireZone(): void {
    const center = this.randomSquareCenterInsideMap(FIRE_AREA_SIZE);
    const x = center.x;
    const y = center.y;

    this.fireZones.push({
      id: this.nextHazard('fire'),
      x,
      y,
      size: FIRE_AREA_SIZE,
      endTick: this.tick + FIRE_DURATION_TICKS
    });
  }

  private movePlayers(): void {
    this.rebuildSpatialHash();

    for (const player of this.alivePlayers()) {
      const dangerEscapeDir = this.escapeDirectionIfInDanger(player);
      const target = this.findTarget(player, DETECTION_RANGE);
      const nearbyItem = this.findItem(player, ITEM_DETECTION_RANGE);
      const targetDistance = target
        ? Math.hypot(target.x - player.x, target.y - player.y)
        : Number.POSITIVE_INFINITY;
      let dir: Vec2;
      let stepSpeed = player.speedPerTick;

      if (dangerEscapeDir) {
        dir = dangerEscapeDir;
        stepSpeed *= DANGER_ESCAPE_SPEED_MULTIPLIER;
      } else if (nearbyItem && nearbyItem.distance <= targetDistance) {
        dir = normalize({
          x: nearbyItem.item.x - player.x,
          y: nearbyItem.item.y - player.y
        });
      } else if (target) {
        dir = normalize({
          x: target.x - player.x,
          y: target.y - player.y
        });
      } else {
        if (player.wanderTicksLeft <= 0) {
          player.wanderDir = randomUnitVector();
          player.wanderTicksLeft = WANDER_CHANGE_TICKS;
        }

        player.wanderTicksLeft -= 1;
        dir = player.wanderDir;
      }

      player.x += dir.x * stepSpeed;
      player.y += dir.y * stepSpeed;
      this.clampToMap(player);
    }
  }

  private updateShrinkingRing(): void {
    if (this.tick < this.nextShrinkTick) {
      return;
    }

    if (!this.canShrinkRing()) {
      this.nextShrinkTick = Number.MAX_SAFE_INTEGER;
      return;
    }

    const centers = this.buildRingCellCenters(this.shrinkLayer);
    if (centers.length === 0) {
      this.nextShrinkTick = Number.MAX_SAFE_INTEGER;
      return;
    }

    const activateTick = this.tick + SHRINK_WARNING_TICKS;
    for (const center of centers) {
      this.meteorVisuals.push({
        id: this.nextHazard('meteor'),
        x: center.x,
        y: center.y,
        size: GRID_CELL_PX,
        expiresAtTick: activateTick
      });
    }

    this.pendingRingActivations.push({
      activateTick,
      centers
    });
    this.shrinkLayer += 1;
    this.nextShrinkTick += SHRINK_STEP_TICKS;
  }

  private resolveRingActivations(): void {
    if (this.pendingRingActivations.length === 0) {
      return;
    }

    const remaining: PendingRingActivation[] = [];
    for (const activation of this.pendingRingActivations) {
      if (activation.activateTick > this.tick) {
        remaining.push(activation);
        continue;
      }

      for (const center of activation.centers) {
        this.fireZones.push({
          id: this.nextHazard('fire'),
          x: center.x,
          y: center.y,
          size: GRID_CELL_PX,
          endTick: Number.MAX_SAFE_INTEGER
        });
      }
    }

    this.pendingRingActivations = remaining;
  }

  private canShrinkRing(): boolean {
    const remainingAfterNextShrink = this.map.cellsPerSide - (this.shrinkLayer + 1) * 2;
    return remainingAfterNextShrink >= SHRINK_MIN_SAFE_CELLS;
  }

  private buildRingCellCenters(layer: number): Vec2[] {
    const minCell = layer;
    const maxCell = this.map.cellsPerSide - layer - 1;
    if (maxCell - minCell < 1) {
      return [];
    }

    const centers: Vec2[] = [];

    for (let x = minCell; x <= maxCell; x += 1) {
      centers.push(this.cellCenterToWorld(x, minCell));
      centers.push(this.cellCenterToWorld(x, maxCell));
    }

    for (let y = minCell + 1; y <= maxCell - 1; y += 1) {
      centers.push(this.cellCenterToWorld(minCell, y));
      centers.push(this.cellCenterToWorld(maxCell, y));
    }

    return centers;
  }

  private cellCenterToWorld(cellX: number, cellY: number): Vec2 {
    return {
      x: cellX * GRID_CELL_PX + GRID_CELL_PX / 2,
      y: cellY * GRID_CELL_PX + GRID_CELL_PX / 2
    };
  }

  private escapeDirectionIfInDanger(player: SimPlayer): Vec2 | null {
    let escaping = false;
    let vx = 0;
    let vy = 0;

    const min = this.mapMinBound(PLAYER_RADIUS);
    const max = this.mapMaxBound(PLAYER_RADIUS);
    const distToLeft = player.x - min;
    const distToRight = max - player.x;
    const distToTop = player.y - min;
    const distToBottom = max - player.y;

    if (distToLeft < WALL_ESCAPE_MARGIN_PX) {
      escaping = true;
      vx += (WALL_ESCAPE_MARGIN_PX - distToLeft) / WALL_ESCAPE_MARGIN_PX;
    }
    if (distToRight < WALL_ESCAPE_MARGIN_PX) {
      escaping = true;
      vx -= (WALL_ESCAPE_MARGIN_PX - distToRight) / WALL_ESCAPE_MARGIN_PX;
    }
    if (distToTop < WALL_ESCAPE_MARGIN_PX) {
      escaping = true;
      vy += (WALL_ESCAPE_MARGIN_PX - distToTop) / WALL_ESCAPE_MARGIN_PX;
    }
    if (distToBottom < WALL_ESCAPE_MARGIN_PX) {
      escaping = true;
      vy -= (WALL_ESCAPE_MARGIN_PX - distToBottom) / WALL_ESCAPE_MARGIN_PX;
    }

    for (const zone of this.fireZones) {
      const half = zone.size / 2 + FIRE_ESCAPE_MARGIN_PX;
      const dx = player.x - zone.x;
      const dy = player.y - zone.y;
      if (Math.abs(dx) > half || Math.abs(dy) > half) {
        continue;
      }

      escaping = true;
      const repel = normalize({
        x: dx === 0 ? randomFloat(-0.2, 0.2) : dx,
        y: dy === 0 ? randomFloat(-0.2, 0.2) : dy
      });
      vx += repel.x * 1.8;
      vy += repel.y * 1.8;
    }

    if (!escaping) {
      return null;
    }

    vx += (this.map.sizePx / 2 - player.x) * 0.02;
    vy += (this.map.sizePx / 2 - player.y) * 0.02;
    return normalize({ x: vx, y: vy });
  }

  private pushDangerPlayersInward(): void {
    for (const player of this.alivePlayers()) {
      const dir = this.escapeDirectionIfInDanger(player);
      if (!dir) {
        continue;
      }
      const nudge = Math.max(0.75, player.speedPerTick * 0.6);
      player.x += dir.x * nudge;
      player.y += dir.y * nudge;
      this.clampToMap(player);
    }
  }

  private resolvePlayerSeparation(): void {
    this.rebuildSpatialHash();
    const processedPairs = new Set<string>();
    const targetSeparation = PLAYER_DIAMETER + PLAYER_SEPARATION_VISIBLE_GAP_PX;

    for (const player of this.alivePlayers()) {
      const nearbyIds = this.spatialHash.queryCircle(player.x, player.y, targetSeparation + 2);

      for (const otherId of nearbyIds) {
        if (otherId === player.socketId) {
          continue;
        }

        const other = this.players.get(otherId);
        if (!other || !other.alive) {
          continue;
        }

        const pairKey = player.playerId < other.playerId
          ? `${player.socketId}|${other.socketId}`
          : `${other.socketId}|${player.socketId}`;

        if (processedPairs.has(pairKey)) {
          continue;
        }
        processedPairs.add(pairKey);

        let dx = other.x - player.x;
        let dy = other.y - player.y;
        let distance = Math.hypot(dx, dy);

        if (distance >= targetSeparation) {
          continue;
        }

        if (distance < 0.0001) {
          const nudge = randomUnitVector();
          dx = nudge.x;
          dy = nudge.y;
          distance = 1;
        }

        const penetration = targetSeparation - distance;
        const nx = dx / distance;
        const ny = dy / distance;
        const push = Math.max(
          PLAYER_SEPARATION_MIN_PUSH_PX,
          (penetration / 2) * PLAYER_SEPARATION_PUSH_MULTIPLIER
        );

        player.x -= nx * push;
        player.y -= ny * push;
        other.x += nx * push;
        other.y += ny * push;

        this.clampToMap(player);
        this.clampToMap(other);
      }
    }
  }

  private collectItems(): void {
    if (this.items.length === 0) {
      return;
    }

    const alive = this.alivePlayers();
    if (alive.length === 0) {
      return;
    }

    const remaining: SimItem[] = [];

    for (const item of this.items) {
      let collected = false;
      for (const player of alive) {
        const distance = Math.hypot(player.x - item.x, player.y - item.y);
        if (distance > PLAYER_RADIUS + item.radius) {
          continue;
        }

        this.applyItemEffect(player, item.type);
        this.pickupEvents.push({
          id: this.nextPickupEvent(),
          socketId: player.socketId,
          playerId: player.playerId,
          playerName: player.name,
          itemType: item.type,
          tick: this.tick
        });
        collected = true;
        break;
      }

      if (!collected) {
        remaining.push(item);
      }
    }

    this.items = remaining;
  }

  private applyItemEffect(player: SimPlayer, itemType: ItemType): void {
    if (itemType === 'sword') {
      player.attackDamage = Math.min(MAX_ATTACK_DAMAGE, player.attackDamage + SWORD_ATTACK_BONUS);
      player.swordCount += 1;
      return;
    }

    if (itemType === 'boots') {
      const maxSpeedPerTick = MAX_SPEED_PX_PER_SECOND / TICK_RATE;
      const bonusPerTick = BOOTS_SPEED_BONUS_PER_SECOND / TICK_RATE;
      player.speedPerTick = Math.min(maxSpeedPerTick, player.speedPerTick + bonusPerTick);
      player.bootsCount += 1;
      return;
    }

    if (itemType === 'armor') {
      player.maxHp += ARMOR_MAX_HP_BONUS;
      player.hp = Math.min(player.maxHp, player.hp + ARMOR_MAX_HP_BONUS);
      player.armorCount += 1;
      return;
    }

    if (itemType === 'blessing') {
      player.blessingCount += 1;
      return;
    }

    player.attackCooldownTicksMax = Math.max(
      MIN_ATTACK_COOLDOWN_TICKS,
      player.attackCooldownTicksMax - AMULET_COOLDOWN_REDUCTION_TICKS
    );
    player.amuletCount += 1;
  }

  private scheduleAttacks(): void {
    this.rebuildSpatialHash();

    for (const player of this.alivePlayers()) {
      if (player.attackCooldownTicks > 0) {
        player.attackCooldownTicks -= 1;
      }

      if (player.attackCooldownTicks > 0) {
        continue;
      }

      const target = this.findTarget(player, ATTACK_RANGE);
      if (!target) {
        continue;
      }

      const distance = Math.hypot(target.x - player.x, target.y - player.y);
      if (distance <= ATTACK_RANGE) {
        this.queueDamage(target.socketId, player.attackDamage);
        this.applyAttackKnockback(player, target);
        player.attackCooldownTicks = player.attackCooldownTicksMax;
      }
    }
  }

  private applyFireAndSorceressSkill(): void {
    for (const player of this.alivePlayers()) {
      let insideFire = false;

      for (const zone of this.fireZones) {
        if (isPointInsideSquare(player.x, player.y, zone.x, zone.y, zone.size)) {
          insideFire = true;
          if (player.blessingCount === 0) {
            this.queueDamage(player.socketId, FIRE_DAMAGE_PER_TICK);
          }
        }
      }

      if (player.classType !== 'sorceress') {
        continue;
      }

      if (insideFire) {
        player.sorceressFireTicks += 1;
        if (player.sorceressFireTicks >= SORCERESS_FIRE_TELEPORT_TICKS) {
          this.teleportSorceress(player);
          player.sorceressFireTicks = 0;
        }
      } else {
        player.sorceressFireTicks = 0;
      }
    }
  }

  private teleportSorceress(player: SimPlayer): void {
    if (this.tryRandomSafeTeleport(player, 20)) {
      return;
    }

    player.x = this.map.sizePx / 2;
    player.y = this.map.sizePx / 2;
    this.clampToMap(player);
  }

  private isValidTeleportPosition(x: number, y: number, ignoreSocketId?: string): boolean {
    const min = this.mapMinBound(PLAYER_RADIUS);
    const max = this.mapMaxBound(PLAYER_RADIUS);
    if (x < min || y < min || x > max || y > max) {
      return false;
    }

    if (this.isPointInsideAnyFire(x, y)) {
      return false;
    }

    for (const player of this.players.values()) {
      if (!player.alive || player.socketId === ignoreSocketId) {
        continue;
      }
      const distance = Math.hypot(player.x - x, player.y - y);
      if (distance < PLAYER_DIAMETER) {
        return false;
      }
    }

    return true;
  }

  private resolveDamageQueue(): void {
    const pending = [...this.damageQueue.entries()];
    this.damageQueue.clear();

    for (const [socketId, totalIncoming] of pending) {
      if (totalIncoming <= 0) {
        continue;
      }

      const player = this.players.get(socketId);
      if (!player || !player.alive) {
        continue;
      }

      let incoming = totalIncoming;

      if (player.classType === 'barbarian' && !player.barbarianUsed) {
        player.barbarianUsed = true;
        player.shield += BARBARIAN_SHIELD;
      }

      if (player.shield > 0) {
        const absorbed = Math.min(player.shield, incoming);
        player.shield -= absorbed;
        incoming -= absorbed;
      }

      if (incoming > 0) {
        const before = player.hp;
        player.hp -= incoming;

        if (
          player.classType === 'paladin' &&
          !player.paladinUsed &&
          before > PALADIN_TRIGGER_HP &&
          player.hp <= PALADIN_TRIGGER_HP
        ) {
          player.paladinUsed = true;
          player.hp = PALADIN_HEAL_TO_HP;
        }

        if (player.hp <= 0) {
          player.hp = 0;
          player.alive = false;
          player.deathTick = this.tick;
          continue;
        }

        const lowHpThreshold = player.maxHp * LOW_HP_TELEPORT_TRIGGER_RATIO;
        const crossedLowHp = before > lowHpThreshold && player.hp <= lowHpThreshold;
        if (crossedLowHp && !player.lowHpTeleportUsed) {
          player.lowHpTeleportUsed = true;
          this.tryLowHpTeleport(player);
          player.attackCooldownTicks = Math.max(
            player.attackCooldownTicks,
            LOW_HP_TELEPORT_ATTACK_LOCK_TICKS
          );
        }
      }
    }
  }

  private applyAttackKnockback(attacker: SimPlayer, target: SimPlayer): void {
    const dir = normalize({
      x: target.x - attacker.x,
      y: target.y - attacker.y
    });

    target.x += dir.x * ATTACK_KNOCKBACK_PX;
    target.y += dir.y * ATTACK_KNOCKBACK_PX;
    this.clampToMap(target);
  }

  private tryRandomSafeTeleport(player: SimPlayer, attempts: number): boolean {
    for (let i = 0; i < attempts; i += 1) {
      const candidateX = randomFloat(this.mapMinBound(PLAYER_RADIUS), this.mapMaxBound(PLAYER_RADIUS));
      const candidateY = randomFloat(this.mapMinBound(PLAYER_RADIUS), this.mapMaxBound(PLAYER_RADIUS));

      if (this.isValidTeleportPosition(candidateX, candidateY, player.socketId)) {
        player.x = candidateX;
        player.y = candidateY;
        return true;
      }
    }

    return false;
  }

  private tryLowHpTeleport(player: SimPlayer): void {
    const rival = this.findClosestEnemy(player);
    if (!rival) {
      return;
    }
    const rivalDistance = Math.hypot(rival.x - player.x, rival.y - player.y);
    if (rivalDistance > DETECTION_RANGE) {
      return;
    }

    for (let i = 0; i < LOW_HP_TELEPORT_ATTEMPTS; i += 1) {
      const angle = randomFloat(0, Math.PI * 2);
      const distance = randomFloat(LOW_HP_TELEPORT_MIN_DISTANCE_PX, LOW_HP_TELEPORT_MAX_DISTANCE_PX);
      const candidateX = rival.x + Math.cos(angle) * distance;
      const candidateY = rival.y + Math.sin(angle) * distance;

      if (!this.isValidTeleportPosition(candidateX, candidateY, player.socketId)) {
        continue;
      }

      player.x = candidateX;
      player.y = candidateY;
      return;
    }

    this.tryRandomSafeTeleport(player, LOW_HP_TELEPORT_ATTEMPTS);
  }

  private cleanupExpiredWorldElements(): void {
    this.fireZones = this.fireZones.filter((zone) => zone.endTick > this.tick);
    this.meteorVisuals = this.meteorVisuals.filter((zone) => zone.expiresAtTick > this.tick);
    this.items = this.items.filter((item) => item.expiresAtTick > this.tick);
  }

  private queueDamage(socketId: string, amount: number): void {
    this.damageQueue.set(socketId, (this.damageQueue.get(socketId) ?? 0) + amount);
  }

  private alivePlayers(): SimPlayer[] {
    const result: SimPlayer[] = [];
    for (const player of this.players.values()) {
      if (player.alive) {
        result.push(player);
      }
    }
    return result;
  }

  private findTarget(player: SimPlayer, maxRange: number): SimPlayer | null {
    const nearbyIds = this.spatialHash.queryCircle(player.x, player.y, maxRange);

    let best: SimPlayer | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const otherId of nearbyIds) {
      if (otherId === player.socketId) {
        continue;
      }

      const candidate = this.players.get(otherId);
      if (!candidate || !candidate.alive) {
        continue;
      }

      const distance = Math.hypot(candidate.x - player.x, candidate.y - player.y);
      if (distance > maxRange) {
        continue;
      }

      if (!best) {
        best = candidate;
        bestDistance = distance;
        continue;
      }

      const hasLessHp = candidate.hp < best.hp;
      const sameHp = candidate.hp === best.hp;
      const isCloser = distance < bestDistance;
      const sameDistance = Math.abs(distance - bestDistance) < 0.0001;
      const lowerPlayerId = candidate.playerId < best.playerId;

      if (hasLessHp || (sameHp && (isCloser || (sameDistance && lowerPlayerId)))) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return best;
  }

  private findClosestEnemy(player: SimPlayer): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of this.players.values()) {
      if (!candidate.alive || candidate.socketId === player.socketId) {
        continue;
      }

      const distance = Math.hypot(candidate.x - player.x, candidate.y - player.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    return best;
  }

  private findItem(player: SimPlayer, maxRange: number): { item: SimItem; distance: number } | null {
    let best: SimItem | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const item of this.items) {
      const distance = Math.hypot(item.x - player.x, item.y - player.y);
      if (distance > maxRange) {
        continue;
      }

      if (!best || distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }

    if (!best) {
      return null;
    }

    return { item: best, distance: bestDistance };
  }

  private rebuildSpatialHash(): void {
    this.spatialHash.clear();

    for (const player of this.players.values()) {
      if (player.alive) {
        this.spatialHash.insert(player.socketId, player.x, player.y);
      }
    }
  }

  private clampToMap(player: SimPlayer): void {
    const min = this.mapMinBound(PLAYER_RADIUS);
    const max = this.mapMaxBound(PLAYER_RADIUS);
    player.x = clamp(player.x, min, max);
    player.y = clamp(player.y, min, max);
  }

  private randomSpawnPoint(): Vec2 {
    return this.randomPointInsideMap(PLAYER_RADIUS);
  }

  private randomPointInsideMap(radius: number): Vec2 {
    const min = this.mapMinBound(radius);
    const max = this.mapMaxBound(radius);
    return {
      x: randomFloat(min, max),
      y: randomFloat(min, max)
    };
  }

  private randomPointInsideMapAvoidFire(radius: number, attempts: number): Vec2 {
    for (let i = 0; i < attempts; i += 1) {
      const candidate = this.randomPointInsideMap(radius);
      if (!this.isPointInsideAnyFire(candidate.x, candidate.y)) {
        return candidate;
      }
    }

    return this.randomPointInsideMap(radius);
  }

  private randomSquareCenterInsideMap(squareSize: number): Vec2 {
    const half = squareSize / 2;
    const min = this.mapMinBound(half);
    const max = this.mapMaxBound(half);
    if (min >= max) {
      return {
        x: this.map.sizePx / 2,
        y: this.map.sizePx / 2
      };
    }

    return {
      x: randomFloat(min, max),
      y: randomFloat(min, max)
    };
  }

  private mapMinBound(radius: number): number {
    return radius + MAP_WALL_COLLISION_PADDING;
  }

  private mapMaxBound(radius: number): number {
    return this.map.sizePx - radius - MAP_WALL_COLLISION_PADDING;
  }

  private isPointInsideAnyFire(x: number, y: number): boolean {
    for (const zone of this.fireZones) {
      if (isPointInsideSquare(x, y, zone.x, zone.y, zone.size)) {
        return true;
      }
    }
    return false;
  }

  private nextHazard(prefix: 'fire' | 'meteor'): string {
    const id = `${prefix}-${this.nextHazardId}`;
    this.nextHazardId += 1;
    return id;
  }

  private nextItem(): string {
    const id = `item-${this.nextItemId}`;
    this.nextItemId += 1;
    return id;
  }

  private nextPickupEvent(): string {
    const id = `pickup-${this.nextPickupEventId}`;
    this.nextPickupEventId += 1;
    return id;
  }

  private emitSnapshot(): void {
    const players: SnapshotPlayer[] = [...this.players.values()]
      .filter((player) => player.alive)
      .sort((a, b) => a.playerId - b.playerId)
      .map((player) => ({
        socketId: player.socketId,
        playerId: player.playerId,
        name: player.name,
        classType: player.classType,
        x: player.x,
        y: player.y,
        hp: player.hp,
        maxHp: player.maxHp,
        shield: player.shield,
        attackDamage: player.attackDamage,
        speedPerSecond: Math.round(player.speedPerTick * TICK_RATE),
        attackCooldownTicks: player.attackCooldownTicksMax,
        swords: player.swordCount,
        boots: player.bootsCount,
        amulets: player.amuletCount,
        armors: player.armorCount,
        blessings: player.blessingCount
      }));

    const hazards: SnapshotHazard[] = [
      ...this.fireZones.map((zone) => ({
        id: zone.id,
        type: 'fire' as const,
        x: zone.x,
        y: zone.y,
        size: zone.size,
        ttlTicks: Math.max(0, zone.endTick - this.tick)
      })),
      ...this.meteorVisuals.map((meteor) => ({
        id: meteor.id,
        type: 'meteor' as const,
        x: meteor.x,
        y: meteor.y,
        size: meteor.size,
        ttlTicks: Math.max(0, meteor.expiresAtTick - this.tick)
      }))
    ];

    const items: SnapshotItem[] = this.items.map((item) => ({
      id: item.id,
      type: item.type,
      x: item.x,
      y: item.y,
      radius: item.radius,
      ttlTicks: Math.max(0, item.expiresAtTick - this.tick)
    }));

    const pickups: SnapshotPickupEvent[] = [...this.pickupEvents];
    this.pickupEvents = [];

    this.onSnapshot({
      t: Date.now(),
      tick: this.tick,
      players,
      hazards,
      items,
      pickups,
      map: this.map
    });
  }

  private finishGame(): void {
    if (this.ended) {
      return;
    }

    this.ended = true;
    this.stop();
    this.emitSnapshot();

    const results = this.buildResults();
    this.onEnd({ results });
  }

  private buildResults(): GameEndResult[] {
    const sortable = [...this.players.values()].sort((a, b) => {
      const aScore = a.alive ? Number.MAX_SAFE_INTEGER : (a.deathTick ?? -1);
      const bScore = b.alive ? Number.MAX_SAFE_INTEGER : (b.deathTick ?? -1);

      if (aScore !== bScore) {
        return bScore - aScore;
      }
      if (a.hp !== b.hp) {
        return b.hp - a.hp;
      }
      return a.playerId - b.playerId;
    });

    const ranked: GameEndResult[] = [];
    let prev: SimPlayer | null = null;
    let prevPosition = 1;

    for (let i = 0; i < sortable.length; i += 1) {
      const player = sortable[i];
      let position = i + 1;

      if (prev && this.sameRankingScore(prev, player)) {
        position = prevPosition;
      }

      prev = player;
      prevPosition = position;

      ranked.push({
        position,
        socketId: player.socketId,
        playerId: player.playerId,
        name: player.name,
        classType: player.classType,
        hp: player.hp,
        maxHp: player.maxHp,
        deathTick: player.deathTick
      });
    }

    return ranked;
  }

  private sameRankingScore(a: SimPlayer, b: SimPlayer): boolean {
    const aScore = a.alive ? Number.MAX_SAFE_INTEGER : (a.deathTick ?? -1);
    const bScore = b.alive ? Number.MAX_SAFE_INTEGER : (b.deathTick ?? -1);
    return aScore === bScore && a.hp === b.hp;
  }
}

function isPointInsideSquare(px: number, py: number, cx: number, cy: number, size: number): boolean {
  const half = size / 2;
  return Math.abs(px - cx) <= half && Math.abs(py - cy) <= half;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomUnitVector(): Vec2 {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function randomItemType(): ItemType {
  const roll = Math.random();
  if (roll < 0.3) {
    return 'sword';
  }
  if (roll < 0.55) {
    return 'boots';
  }
  if (roll < 0.75) {
    return 'amulet';
  }
  if (roll < 0.9) {
    return 'armor';
  }
  return 'blessing';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 0.00001) {
    return randomUnitVector();
  }

  return {
    x: v.x / len,
    y: v.y / len
  };
}
