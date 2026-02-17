import Phaser from 'phaser';
import type {
  ClassType,
  GameSnapshotPayload,
  ItemType,
  SnapshotHazard,
  SnapshotItem,
  SnapshotPlayer
} from '../types';

interface SnapshotEntry {
  receivedAt: number;
  snapshot: GameSnapshotPayload;
}

interface RenderPlayer {
  body: Phaser.GameObjects.Sprite;
  nameText: Phaser.GameObjects.Text;
  hpText: Phaser.GameObjects.Text;
  hpShieldText: Phaser.GameObjects.Text;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  lastHp: number;
  lastX: number;
  lastY: number;
  lastAttackCooldownTicks: number;
  attackPoseUntilMs: number;
  tintResetEvent: Phaser.Time.TimerEvent | null;
}

interface DamagePopup {
  text: Phaser.GameObjects.Text;
  amount: number;
  tween: Phaser.Tweens.Tween | null;
}

interface RenderHazard {
  sprite: Phaser.GameObjects.Sprite;
  type: SnapshotHazard['type'];
  phase: 'warning' | 'impact' | 'loop';
  initialTtlTicks: number;
  warningRing: Phaser.GameObjects.Ellipse | null;
  warningTween: Phaser.Tweens.Tween | null;
}

interface InterpolatedState {
  players: SnapshotPlayer[];
  hazards: SnapshotHazard[];
  items: SnapshotItem[];
  mapSize: number;
  cellsPerSide: number;
}

const CHARACTER_SHEET_KEY = 'charactersSheet';
const ITEM_SHEET_KEY = 'itemsSheet';
const HAZARD_SHEET_KEY = 'hazardsSheet';
const CHARACTER_FRAMES_PER_CLASS = 10;
const HP_DISPLAY_DIVISOR = 100;
const METEOR_MIN_WARNING_TTL = 4;
const MOVE_ANIMATION_THRESHOLD_PX = 0.2;
const ATTACK_COOLDOWN_RESET_THRESHOLD = 4;
const ATTACK_TRIGGER_MIN_COOLDOWN_TICKS = 12;
const COMBAT_CONTACT_RANGE_PX = 12;
const COMBAT_JITTER_IDLE_THRESHOLD_PX = 1.1;
const ATTACK_POSE_MS = 130;

const CLASS_ROW_INDEX: Record<ClassType, number> = {
  barbarian: 0,
  paladin: 1,
  sorceress: 2
};

const ITEM_FRAME_INDEX: Record<ItemType, number> = {
  sword: 0,
  boots: 1,
  amulet: 2,
  armor: 3,
  blessing: 4
};

export class GameScene extends Phaser.Scene {
  private snapshots: SnapshotEntry[] = [];
  private serverTimeOffsetMs: number | null = null;

  private renderPlayers = new Map<string, RenderPlayer>();
  private renderHazards = new Map<string, RenderHazard>();
  private renderItems = new Map<string, Phaser.GameObjects.Sprite>();
  private damagePopups = new Map<string, DamagePopup>();

  private mapGraphics: Phaser.GameObjects.Graphics | null = null;
  private mapSizePx = 1024;
  private cellsPerSide = 16;
  private playerSizePx = 16;
  private nameFontPx = 12;
  private hpFontPx = 11;
  private hpBarHeightPx = 6;
  private textResolution = 1;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    this.load.spritesheet(CHARACTER_SHEET_KEY, '/sprites/characters_sheet_compact.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet(ITEM_SHEET_KEY, '/sprites/items_sheet_compact.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet(HAZARD_SHEET_KEY, '/sprites/hazards_sheet_compact.png', {
      frameWidth: 32,
      frameHeight: 32
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0f1720);
    this.cameras.main.roundPixels = true;
    this.ensureAnimations();
    this.textResolution = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
    this.drawMap(this.mapSizePx, this.cellsPerSide);
    this.scale.on('resize', () => {
      this.applyFixedCamera();
    });
  }

  pushSnapshot(snapshot: GameSnapshotPayload): void {
    const now = performance.now();
    this.snapshots.push({ receivedAt: now, snapshot });

    if (this.snapshots.length > 60) {
      this.snapshots.shift();
    }

    const estimatedOffset = now - snapshot.t;
    if (this.serverTimeOffsetMs === null) {
      this.serverTimeOffsetMs = estimatedOffset;
    } else {
      this.serverTimeOffsetMs = this.serverTimeOffsetMs * 0.9 + estimatedOffset * 0.1;
    }

    if (snapshot.map.sizePx !== this.mapSizePx || snapshot.map.cellsPerSide !== this.cellsPerSide) {
      this.drawMap(snapshot.map.sizePx, snapshot.map.cellsPerSide);
    }
  }

  update(): void {
    const state = this.getInterpolatedState(performance.now());
    if (!state) {
      return;
    }

    this.renderState(state);
  }

  private getInterpolatedState(now: number): InterpolatedState | null {
    if (this.snapshots.length === 0 || this.serverTimeOffsetMs === null) {
      return null;
    }

    const renderServerTime = now - this.serverTimeOffsetMs - 100;

    let older = this.snapshots[0];
    let newer = this.snapshots[this.snapshots.length - 1];

    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      const current = this.snapshots[i];
      const next = this.snapshots[i + 1];

      if (current.snapshot.t <= renderServerTime && next.snapshot.t >= renderServerTime) {
        older = current;
        newer = next;
        break;
      }
    }

    const denominator = newer.snapshot.t - older.snapshot.t;
    const alpha = denominator <= 0
      ? 0
      : Phaser.Math.Clamp((renderServerTime - older.snapshot.t) / denominator, 0, 1);

    const oldPlayersById = new Map(older.snapshot.players.map((p) => [p.socketId, p]));

    const interpolatedPlayers: SnapshotPlayer[] = newer.snapshot.players.map((newerPlayer) => {
      const olderPlayer = oldPlayersById.get(newerPlayer.socketId);
      if (!olderPlayer) {
        return newerPlayer;
      }

      return {
        ...newerPlayer,
        x: Phaser.Math.Linear(olderPlayer.x, newerPlayer.x, alpha),
        y: Phaser.Math.Linear(olderPlayer.y, newerPlayer.y, alpha)
      };
    });

    while (this.snapshots.length > 3 && this.snapshots[1].snapshot.t < renderServerTime - 250) {
      this.snapshots.shift();
    }

    return {
      players: interpolatedPlayers,
      hazards: newer.snapshot.hazards,
      items: newer.snapshot.items,
      mapSize: newer.snapshot.map.sizePx,
      cellsPerSide: newer.snapshot.map.cellsPerSide
    };
  }

  private renderState(state: InterpolatedState): void {
    if (state.mapSize !== this.mapSizePx || state.cellsPerSide !== this.cellsPerSide) {
      this.drawMap(state.mapSize, state.cellsPerSide);
    }

    const nearestEnemyDistanceBySocketId = this.computeNearestEnemyDistanceBySocketId(state.players);
    const alivePlayerIds = new Set<string>();
    for (const player of state.players) {
      alivePlayerIds.add(player.socketId);
      this.upsertPlayer(player, nearestEnemyDistanceBySocketId.get(player.socketId) ?? null);
    }

    for (const [socketId, renderPlayer] of this.renderPlayers) {
      if (alivePlayerIds.has(socketId)) {
        continue;
      }
      renderPlayer.tintResetEvent?.remove(false);
      renderPlayer.body.destroy();
      renderPlayer.nameText.destroy();
      renderPlayer.hpText.destroy();
      renderPlayer.hpShieldText.destroy();
      renderPlayer.hpBarBg.destroy();
      renderPlayer.hpBarFill.destroy();
      this.renderPlayers.delete(socketId);
    }

    const activeHazards = new Set<string>();
    for (const hazard of state.hazards) {
      activeHazards.add(hazard.id);
      this.upsertHazard(hazard);
    }

    for (const [hazardId, renderHazard] of this.renderHazards) {
      if (activeHazards.has(hazardId)) {
        continue;
      }
      this.destroyRenderHazard(renderHazard);
      this.renderHazards.delete(hazardId);
    }

    const activeItems = new Set<string>();
    for (const item of state.items) {
      activeItems.add(item.id);
      this.upsertItem(item);
    }

    for (const [itemId, shape] of this.renderItems) {
      if (activeItems.has(itemId)) {
        continue;
      }
      shape.destroy();
      this.renderItems.delete(itemId);
    }
  }

  private upsertPlayer(player: SnapshotPlayer, nearestEnemyDistance: number | null): void {
    const existing = this.renderPlayers.get(player.socketId);
    const hpRatio = Phaser.Math.Clamp(player.hp / player.maxHp, 0, 1);
    const hpDisplay = Math.max(0, Math.ceil(player.hp / 100));
    const hpMaxDisplay = Math.max(1, Math.ceil(player.maxHp / 100));
    const shieldDisplay = Math.max(0, Math.ceil(player.shield / 100));
    const hpLabel = `${hpDisplay}/${hpMaxDisplay}`;
    const shieldLabel = shieldDisplay > 0 ? `(+${shieldDisplay})` : '';
    const bodySize = Math.max(12, Math.round(this.playerSizePx * 1.45));
    const hpBarWidth = Math.max(bodySize + 4, 12);
    const px = Math.round(player.x);
    const py = Math.round(player.y);
    const stackGap = Math.max(1, Math.round(this.playerSizePx * 0.08));
    const bodyTopY = py - bodySize / 2;
    const hpBarY = Math.round(bodyTopY - stackGap - this.hpBarHeightPx / 2);
    const hpTextY = Math.round(hpBarY - this.hpBarHeightPx / 2 - stackGap);
    const nameTextY = Math.round(hpTextY - this.hpFontPx - stackGap);
    const damageTextY = Math.round(nameTextY - this.nameFontPx - stackGap);
    const walkAnim = playerWalkAnimationKey(player.classType);
    const idleFrame = classStartFrame(player.classType);

    if (!existing) {
      const body = this.add.sprite(px, py, CHARACTER_SHEET_KEY, idleFrame);
      body.setDisplaySize(bodySize, bodySize);
      body.setFrame(idleFrame);
      const nameText = this.add.text(px, nameTextY, player.name, {
        fontFamily: 'Trebuchet MS',
        fontSize: `${this.nameFontPx}px`,
        color: '#f8fafc'
      }).setOrigin(0.5, 1).setResolution(this.textResolution);

      const hpText = this.add.text(px, hpTextY, hpLabel, {
        fontFamily: 'Trebuchet MS',
        fontSize: `${this.hpFontPx}px`,
        color: '#94f7be'
      }).setOrigin(0, 1).setResolution(this.textResolution);

      const hpShieldText = this.add.text(px, hpTextY, shieldLabel, {
        fontFamily: 'Trebuchet MS',
        fontSize: `${this.hpFontPx}px`,
        color: '#7dd3fc'
      }).setOrigin(0, 1).setResolution(this.textResolution);
      hpShieldText.setVisible(shieldDisplay > 0);
      this.positionHpTexts(hpText, hpShieldText, px, hpTextY);

      const hpBarBg = this.add.rectangle(px, hpBarY, hpBarWidth, this.hpBarHeightPx, 0x1f2937).setOrigin(0.5, 0.5);
      const hpBarFill = this.add.rectangle(
        px - hpBarWidth / 2,
        hpBarY,
        hpBarWidth * hpRatio,
        this.hpBarHeightPx,
        0x1fdd7a
      )
        .setOrigin(0, 0.5);

      this.renderPlayers.set(player.socketId, {
        body,
        nameText,
        hpText,
        hpShieldText,
        hpBarBg,
        hpBarFill,
        lastHp: player.hp,
        lastX: player.x,
        lastY: player.y,
        lastAttackCooldownTicks: player.attackCooldownTicks,
        attackPoseUntilMs: 0,
        tintResetEvent: null
      });
      return;
    }

    const movedDistance = Math.hypot(player.x - existing.lastX, player.y - existing.lastY);
    const inCloseCombat = nearestEnemyDistance !== null && nearestEnemyDistance <= COMBAT_CONTACT_RANGE_PX;
    const nowMs = performance.now();
    const shouldIdleFromCombat = inCloseCombat && movedDistance < COMBAT_JITTER_IDLE_THRESHOLD_PX;
    const attackTriggered =
      player.attackCooldownTicks >= ATTACK_TRIGGER_MIN_COOLDOWN_TICKS &&
      player.attackCooldownTicks > existing.lastAttackCooldownTicks + ATTACK_COOLDOWN_RESET_THRESHOLD;
    if (attackTriggered) {
      existing.attackPoseUntilMs = nowMs + ATTACK_POSE_MS;
    }
    const shouldIdleFromAttack = nowMs < existing.attackPoseUntilMs;
    const isMoving = movedDistance >= MOVE_ANIMATION_THRESHOLD_PX && !shouldIdleFromCombat && !shouldIdleFromAttack;

    existing.body.setPosition(px, py);
    existing.body.setDisplaySize(bodySize, bodySize);
    if (isMoving) {
      if (existing.body.anims.currentAnim?.key !== walkAnim || !existing.body.anims.isPlaying) {
        existing.body.play(walkAnim, true);
      }
    } else {
      existing.body.stop();
      existing.body.setFrame(idleFrame);
    }
    existing.nameText.setPosition(px, nameTextY);
    existing.nameText.setText(player.name);
    existing.nameText.setFontSize(this.nameFontPx);
    existing.nameText.setResolution(this.textResolution);
    existing.hpText.setText(hpLabel);
    existing.hpText.setFontSize(this.hpFontPx);
    existing.hpText.setResolution(this.textResolution);
    existing.hpShieldText.setText(shieldLabel);
    existing.hpShieldText.setFontSize(this.hpFontPx);
    existing.hpShieldText.setResolution(this.textResolution);
    existing.hpShieldText.setVisible(shieldDisplay > 0);
    this.positionHpTexts(existing.hpText, existing.hpShieldText, px, hpTextY);
    existing.hpBarBg.setPosition(px, hpBarY);
    existing.hpBarBg.setSize(hpBarWidth, this.hpBarHeightPx);
    existing.hpBarBg.setDisplaySize(hpBarWidth, this.hpBarHeightPx);
    existing.hpBarFill.setPosition(px - hpBarWidth / 2, hpBarY);
    existing.hpBarFill.setSize(hpBarWidth * hpRatio, this.hpBarHeightPx);
    existing.hpBarFill.setDisplaySize(hpBarWidth * hpRatio, this.hpBarHeightPx);

    const hpLost = existing.lastHp - player.hp;
    if (hpLost > 0) {
      const damageDisplay = Math.max(1, Math.ceil(hpLost / HP_DISPLAY_DIVISOR));
      this.showDamagePopup(player.socketId, px, damageTextY, damageDisplay);
      this.flashPlayerTint(existing, 0xff6b6b, 130);
    }

    if (attackTriggered) {
      this.playAttackPulse(px, py);
      this.flashPlayerTint(existing, 0xffe08a, 90);
    }

    existing.lastHp = player.hp;
    existing.lastX = player.x;
    existing.lastY = player.y;
    existing.lastAttackCooldownTicks = player.attackCooldownTicks;
  }

  private upsertHazard(hazard: SnapshotHazard): void {
    const existing = this.renderHazards.get(hazard.id);
    const hzX = Math.round(hazard.x);
    const hzY = Math.round(hazard.y);
    const hzSize = Math.max(4, Math.round(hazard.size));
    if (!existing) {
      if (hazard.type === 'meteor') {
        const sprite = this.add.sprite(hzX, hzY, HAZARD_SHEET_KEY, 0);
        sprite.setDisplaySize(hzSize, hzSize);
        sprite.setAlpha(0.92);
        const useWarningRing = hzSize > 20;
        const warningRing = useWarningRing
          ? this.add.ellipse(hzX, hzY, hzSize * 0.95, hzSize * 0.95)
            .setFillStyle(0xffc145, 0.06)
            .setStrokeStyle(2, 0xffe087, 0.9)
          : null;
        const warningTween = warningRing
          ? this.tweens.add({
            targets: warningRing,
            alpha: { from: 0.35, to: 1 },
            duration: 250,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.InOut'
          })
          : null;

        this.renderHazards.set(hazard.id, {
          sprite,
          type: 'meteor',
          phase: 'warning',
          initialTtlTicks: Math.max(1, hazard.ttlTicks),
          warningRing,
          warningTween
        });
      } else {
        const sprite = this.add.sprite(hzX, hzY, HAZARD_SHEET_KEY, 4);
        sprite.setDisplaySize(hzSize, hzSize);
        sprite.setAlpha(0.86);
        sprite.play('hazard-fire-loop', true);
        this.renderHazards.set(hazard.id, {
          sprite,
          type: 'fire',
          phase: 'loop',
          initialTtlTicks: Math.max(1, hazard.ttlTicks),
          warningRing: null,
          warningTween: null
        });
      }
      return;
    }

    existing.sprite.setPosition(hzX, hzY);
    existing.sprite.setDisplaySize(hzSize, hzSize);

    if (hazard.type === 'fire') {
      existing.sprite.setAlpha(0.86);
      existing.sprite.play('hazard-fire-loop', true);
      return;
    }

    if (existing.warningRing) {
      existing.warningRing.setPosition(hzX, hzY);
      existing.warningRing.setDisplaySize(hzSize * 0.95, hzSize * 0.95);
    }

    const impactThreshold = Math.max(
      METEOR_MIN_WARNING_TTL,
      Math.floor(existing.initialTtlTicks * 0.35)
    );
    if (hazard.ttlTicks <= impactThreshold && existing.phase !== 'impact') {
      existing.phase = 'impact';
      existing.warningTween?.remove();
      existing.warningTween = null;
      existing.warningRing?.destroy();
      existing.warningRing = null;
      existing.sprite.play('hazard-meteor-impact', true);
      existing.sprite.setAlpha(0.95);
      return;
    }

    if (existing.phase === 'warning') {
      existing.sprite.setFrame(0);
      existing.sprite.setAlpha(0.92);
    } else {
      existing.sprite.play('hazard-meteor-impact', true);
      existing.sprite.setAlpha(0.95);
    }
  }

  private upsertItem(item: SnapshotItem): void {
    const existing = this.renderItems.get(item.id);
    const itemX = Math.round(item.x);
    const itemY = Math.round(item.y);
    const itemRadius = Math.max(2, Math.round(item.radius));
    const itemDiameter = itemRadius * 2;
    const itemSize = Math.max(10, itemDiameter + 4);
    const frame = ITEM_FRAME_INDEX[item.type];

    if (!existing) {
      const sprite = this.add.sprite(itemX, itemY, ITEM_SHEET_KEY, frame);
      sprite.setDisplaySize(itemSize, itemSize);
      this.renderItems.set(item.id, sprite);
      return;
    }

    existing.setPosition(itemX, itemY);
    existing.setFrame(frame);
    existing.setDisplaySize(itemSize, itemSize);
  }

  private drawMap(sizePx: number, cellsPerSide: number): void {
    this.mapSizePx = sizePx;
    this.cellsPerSide = cellsPerSide;
    const cellSize = sizePx / cellsPerSide;
    this.playerSizePx = Math.max(10, Math.round(cellSize * 0.62));
    this.nameFontPx = Math.max(8, Math.min(13, Math.round(this.playerSizePx * 0.58)));
    this.hpFontPx = Math.max(7, Math.min(11, Math.round(this.playerSizePx * 0.5)));
    this.hpBarHeightPx = Math.max(3, Math.min(7, Math.round(this.playerSizePx * 0.32)));

    if (!this.mapGraphics) {
      this.mapGraphics = this.add.graphics();
    }

    this.mapGraphics.clear();
    this.mapGraphics.fillStyle(0x0e141b, 1);
    this.mapGraphics.fillRect(0, 0, sizePx, sizePx);

    this.mapGraphics.lineStyle(1, 0x223242, 0.45);
    for (let i = 0; i <= cellsPerSide; i += 1) {
      const v = i * cellSize;
      this.mapGraphics.lineBetween(v, 0, v, sizePx);
      this.mapGraphics.lineBetween(0, v, sizePx, v);
    }

    this.mapGraphics.lineStyle(8, 0xd4b06a, 1);
    this.mapGraphics.strokeRect(0, 0, sizePx, sizePx);

    this.applyFixedCamera();
  }

  private applyFixedCamera(): void {
    const camera = this.cameras.main;
    const zoomToFit = Math.min(
      camera.width / this.mapSizePx,
      camera.height / this.mapSizePx
    );
    camera.setZoom(zoomToFit);
    camera.centerOn(this.mapSizePx / 2, this.mapSizePx / 2);
    this.updateTextResolutionForZoom();
  }

  private updateTextResolutionForZoom(): void {
    const zoom = this.cameras.main.zoom || 1;
    const dpr = window.devicePixelRatio || 1;
    const targetResolution = Math.max(1, Math.min(4, dpr * zoom));
    if (Math.abs(targetResolution - this.textResolution) < 0.01) {
      return;
    }

    this.textResolution = targetResolution;
    for (const renderPlayer of this.renderPlayers.values()) {
      renderPlayer.nameText.setResolution(this.textResolution);
      renderPlayer.hpText.setResolution(this.textResolution);
      renderPlayer.hpShieldText.setResolution(this.textResolution);
    }
    for (const popup of this.damagePopups.values()) {
      popup.text.setResolution(this.textResolution);
    }
  }

  private showDamagePopup(socketId: string, x: number, y: number, amount: number): void {
    const existing = this.damagePopups.get(socketId);
    if (existing) {
      existing.amount += amount;
      existing.text.setText(`-${existing.amount}`);
      existing.text.setPosition(x, y);
      existing.text.setAlpha(1);
      existing.text.setResolution(this.textResolution);
      existing.tween?.remove();
      existing.tween = this.createDamagePopupTween(socketId, existing.text, y);
      return;
    }

    const text = this.add.text(x, y, `-${amount}`, {
      fontFamily: 'Trebuchet MS',
      fontSize: `${Math.max(10, this.nameFontPx)}px`,
      color: '#ff4d4f',
      stroke: '#220000',
      strokeThickness: 2
    }).setOrigin(0.5, 1).setResolution(this.textResolution);

    const popup: DamagePopup = {
      text,
      amount,
      tween: null
    };
    this.damagePopups.set(socketId, popup);
    popup.tween = this.createDamagePopupTween(socketId, text, y);
  }

  private createDamagePopupTween(
    socketId: string,
    text: Phaser.GameObjects.Text,
    originY: number
  ): Phaser.Tweens.Tween {
    const lift = Math.max(14, Math.round(this.playerSizePx));
    return this.tweens.add({
      targets: text,
      y: originY - lift,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.Out',
      onComplete: () => {
        text.destroy();
        const current = this.damagePopups.get(socketId);
        if (current?.text === text) {
          this.damagePopups.delete(socketId);
        }
      }
    });
  }

  private destroyRenderHazard(renderHazard: RenderHazard): void {
    renderHazard.warningTween?.remove();
    renderHazard.warningRing?.destroy();
    renderHazard.sprite.destroy();
  }

  private ensureAnimations(): void {
    for (const classType of ['barbarian', 'paladin', 'sorceress'] as const) {
      const walkKey = playerWalkAnimationKey(classType);
      if (!this.anims.exists(walkKey)) {
        const start = classStartFrame(classType);
        this.anims.create({
          key: walkKey,
          frames: this.anims.generateFrameNumbers(CHARACTER_SHEET_KEY, {
            start,
            end: start + CHARACTER_FRAMES_PER_CLASS - 1
          }),
          frameRate: 9,
          repeat: -1
        });
      }
    }

    if (!this.anims.exists('hazard-meteor-impact')) {
      this.anims.create({
        key: 'hazard-meteor-impact',
        frames: this.anims.generateFrameNumbers(HAZARD_SHEET_KEY, { start: 1, end: 3 }),
        frameRate: 8,
        repeat: -1
      });
    }

    if (!this.anims.exists('hazard-fire-loop')) {
      this.anims.create({
        key: 'hazard-fire-loop',
        frames: this.anims.generateFrameNumbers(HAZARD_SHEET_KEY, { start: 4, end: 7 }),
        frameRate: 10,
        repeat: -1
      });
    }
  }

  private positionHpTexts(
    hpText: Phaser.GameObjects.Text,
    hpShieldText: Phaser.GameObjects.Text,
    centerX: number,
    y: number
  ): void {
    const showShield = hpShieldText.visible;
    const gap = showShield ? 4 : 0;
    const totalWidth = hpText.width + (showShield ? gap + hpShieldText.width : 0);
    const startX = Math.round(centerX - totalWidth / 2);

    hpText.setPosition(startX, y);
    hpShieldText.setPosition(startX + hpText.width + gap, y);
  }

  private playAttackPulse(x: number, y: number): void {
    const diameter = Math.max(12, Math.round(this.playerSizePx * 1.35));
    const pulse = this.add.ellipse(x, y, diameter, diameter * 0.74)
      .setStrokeStyle(2, 0xffc56b, 0.92)
      .setFillStyle(0xff9f43, 0.2);
    pulse.setRotation(Math.random() * Math.PI);

    this.tweens.add({
      targets: pulse,
      alpha: 0,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 140,
      ease: 'Cubic.Out',
      onComplete: () => pulse.destroy()
    });
  }

  private flashPlayerTint(renderPlayer: RenderPlayer, color: number, durationMs: number): void {
    renderPlayer.tintResetEvent?.remove(false);
    renderPlayer.body.setTint(color);
    renderPlayer.tintResetEvent = this.time.delayedCall(durationMs, () => {
      renderPlayer.body.clearTint();
      renderPlayer.tintResetEvent = null;
    });
  }

  private computeNearestEnemyDistanceBySocketId(players: SnapshotPlayer[]): Map<string, number> {
    const nearest = new Map<string, number>();
    for (let i = 0; i < players.length; i += 1) {
      const a = players[i];
      let best = Number.POSITIVE_INFINITY;
      for (let j = 0; j < players.length; j += 1) {
        if (i === j) {
          continue;
        }
        const b = players[j];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist < best) {
          best = dist;
        }
      }
      if (best < Number.POSITIVE_INFINITY) {
        nearest.set(a.socketId, best);
      }
    }
    return nearest;
  }
}

function classStartFrame(classType: ClassType): number {
  return CLASS_ROW_INDEX[classType] * CHARACTER_FRAMES_PER_CLASS;
}

function playerWalkAnimationKey(classType: ClassType): string {
  return `player-${classType}-walk`;
}
