import Phaser from 'phaser';
import type { GameSnapshotPayload } from '../types';
import { GameScene } from './GameScene';

export class GameRenderer {
  private readonly game: Phaser.Game;
  private readonly onResize = () => {
    this.game.scale.resize(window.innerWidth, window.innerHeight);
  };

  constructor(containerId: string) {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerId,
      width: window.innerWidth,
      height: window.innerHeight,
      pixelArt: true,
      antialias: false,
      scene: [GameScene],
      backgroundColor: '#101922',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    });

    window.addEventListener('resize', this.onResize);
  }

  pushSnapshot(snapshot: GameSnapshotPayload): void {
    const scene = this.game.scene.keys.GameScene as GameScene | undefined;
    if (!scene || !scene.scene.isActive()) {
      return;
    }
    scene.pushSnapshot(snapshot);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.game.destroy(true);
  }
}
