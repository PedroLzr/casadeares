export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 10;
export const SNAPSHOT_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;

export const HP_MAX = 10000;
export const ATTACK_DAMAGE = 500;
export const METEOR_DAMAGE = 2500;
export const FIRE_DAMAGE_PER_SECOND = 500;
export const FIRE_DAMAGE_PER_TICK = FIRE_DAMAGE_PER_SECOND / TICK_RATE;

export const GRID_CELL_PX = 16;
const BASE_GRID_CELL_PX = 64;
const WORLD_SCALE = GRID_CELL_PX / BASE_GRID_CELL_PX;
export const MAP_WALL_COLLISION_PADDING = Math.max(2, Math.round(GRID_CELL_PX * 0.25));

export const PLAYER_RADIUS = Math.max(2, Math.round(16 * WORLD_SCALE));
export const PLAYER_DIAMETER = PLAYER_RADIUS * 2;
export const SPEED_PX_PER_SECOND = Math.max(24, Math.round(120 * WORLD_SCALE));
export const SPEED_PER_TICK = SPEED_PX_PER_SECOND / TICK_RATE;
export const DETECTION_RANGE = Math.max(48, Math.round(220 * WORLD_SCALE));
export const ATTACK_RANGE = Math.max(PLAYER_DIAMETER + 2, Math.round(42 * WORLD_SCALE));
export const ATTACK_COOLDOWN_TICKS = 30;
export const WANDER_CHANGE_TICKS = 16;
export const ATTACK_KNOCKBACK_PX = Math.max(4, Math.round(20 * WORLD_SCALE));
export const ATTACK_KNOCKBACK_ATTACKER_RATIO = 0.45;
export const LOW_HP_TELEPORT_TRIGGER_RATIO = 0.5;
export const LOW_HP_TELEPORT_MIN_DISTANCE_PX = GRID_CELL_PX * 6;
export const LOW_HP_TELEPORT_MAX_DISTANCE_PX = GRID_CELL_PX * 10;
export const LOW_HP_TELEPORT_ATTACK_LOCK_TICKS = Math.max(6, Math.round(TICK_RATE * 0.5));
export const LOW_HP_TELEPORT_ATTEMPTS = 24;

export const METEOR_INTERVAL_TICKS = 8 * TICK_RATE;
export const FIRE_INTERVAL_TICKS = 10 * TICK_RATE;
export const FIRE_DURATION_TICKS = 5 * TICK_RATE;

export const METEOR_AREA_SIZE = GRID_CELL_PX * 5;
export const FIRE_AREA_SIZE = GRID_CELL_PX * 10;
export const METEOR_WARNING_TICKS = Math.max(6, Math.round(TICK_RATE * 0.5));
export const METEOR_IMPACT_TICKS = Math.max(4, Math.round(TICK_RATE * 0.25));
export const METEOR_VISUAL_TTL = METEOR_WARNING_TICKS + METEOR_IMPACT_TICKS;
export const SHRINK_START_TICKS = 60 * TICK_RATE;
export const SHRINK_STEP_TICKS = 30 * TICK_RATE;
export const SHRINK_WARNING_TICKS = 5 * TICK_RATE;
export const SHRINK_MIN_SAFE_CELLS = 8;
export const FIRE_ESCAPE_MARGIN_PX = Math.max(PLAYER_RADIUS, Math.round(GRID_CELL_PX * 0.4));
export const WALL_ESCAPE_MARGIN_PX = GRID_CELL_PX;
export const DANGER_ESCAPE_SPEED_MULTIPLIER = 1.25;
export const PLAYER_SEPARATION_PUSH_MULTIPLIER = 1.7;
export const PLAYER_SEPARATION_MIN_PUSH_PX = 0.8;

export const BARBARIAN_SHIELD = 5000;
export const PALADIN_TRIGGER_HP = 2000;
export const PALADIN_HEAL_TO_HP = 8000;
export const SORCERESS_FIRE_TELEPORT_TICKS = 20;

export const SPATIAL_HASH_CELL_SIZE = Math.max(16, GRID_CELL_PX * 2);

export const MAX_PLAYERS_PER_ROOM = 10;

export const NAME_MIN_LEN = 3;
export const NAME_MAX_LEN = 16;

export const HP_DISPLAY_DIVISOR = 100;

export const ITEM_RADIUS = Math.max(2, Math.round(14 * WORLD_SCALE));
export const ITEM_DETECTION_RANGE = Math.max(40, Math.round(160 * WORLD_SCALE));
export const ITEM_SPAWN_INTERVAL_TICKS = 3 * TICK_RATE;
export const ITEM_TTL_TICKS = 15 * TICK_RATE;
export const MAX_ITEMS_ON_MAP = 12;

export const SWORD_ATTACK_BONUS = 100;
export const BOOTS_SPEED_BONUS_PER_SECOND = Math.max(4, Math.round(20 * WORLD_SCALE));
export const AMULET_COOLDOWN_REDUCTION_TICKS = 2;
export const ARMOR_MAX_HP_BONUS = 2000;

export const MAX_ATTACK_DAMAGE = 1200;
export const MAX_SPEED_PX_PER_SECOND = Math.max(40, Math.round(220 * WORLD_SCALE));
export const MIN_ATTACK_COOLDOWN_TICKS = 12;
