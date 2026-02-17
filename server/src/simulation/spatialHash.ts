interface SpatialItem {
  id: string;
  x: number;
  y: number;
}

export class SpatialHash {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, SpatialItem[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.buckets.clear();
  }

  insert(id: string, x: number, y: number): void {
    const key = this.keyFor(x, y);
    const list = this.buckets.get(key);
    const item: SpatialItem = { id, x, y };

    if (list) {
      list.push(item);
      return;
    }

    this.buckets.set(key, [item]);
  }

  queryCircle(x: number, y: number, radius: number): string[] {
    const minX = x - radius;
    const minY = y - radius;
    const maxX = x + radius;
    const maxY = y + radius;

    const seen = new Set<string>();
    for (const key of this.keysInAabb(minX, minY, maxX, maxY)) {
      const items = this.buckets.get(key);
      if (!items) {
        continue;
      }

      for (const item of items) {
        if (seen.has(item.id)) {
          continue;
        }
        seen.add(item.id);
      }
    }

    return [...seen];
  }

  private keyFor(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  private keysInAabb(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const minCellX = Math.floor(minX / this.cellSize);
    const maxCellX = Math.floor(maxX / this.cellSize);
    const minCellY = Math.floor(minY / this.cellSize);
    const maxCellY = Math.floor(maxY / this.cellSize);

    const keys: string[] = [];
    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      for (let cy = minCellY; cy <= maxCellY; cy += 1) {
        keys.push(`${cx},${cy}`);
      }
    }

    return keys;
  }
}
