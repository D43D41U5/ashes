/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import type { GameTime } from '@braises/sim'
import Phaser from 'phaser'

/** Alpha de l'obscurité selon l'heure du cycle (jour [0,15), nuit [15,24)). */
function nightAlpha(hourOfCycle: number): number {
  const MAX = 0.55
  if (hourOfCycle < 13.5) return 0
  if (hourOfCycle < 16) return ((hourOfCycle - 13.5) / 2.5) * MAX // crépuscule
  if (hourOfCycle < 22.5) return MAX
  return (1 - (hourOfCycle - 22.5) / 1.5) * MAX // aube
}

export class UIScene extends Phaser.Scene {
  private nightOverlay!: Phaser.GameObjects.Rectangle
  private hud!: Phaser.GameObjects.Text

  constructor() {
    super('ui')
  }

  create(): void {
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x0b1030, 0)
      .setOrigin(0)

    this.hud = this.add.text(10, 8, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#e8e0c8',
      stroke: '#14141a',
      strokeThickness: 3,
    })
  }

  override update(): void {
    const time = this.registry.get('time') as GameTime | undefined
    if (!time) return
    this.nightOverlay.setAlpha(nightAlpha(time.hourOfCycle))
    const zone = this.registry.get('zone') as string | undefined
    const hour = String(Math.floor(time.hourOfCycle)).padStart(2, '0')
    this.hud.setText(
      `Jour ${time.seasonDay} — Acte ${'I'.repeat(time.act)} — ${hour}h${time.isNight ? ' (nuit)' : ''}` +
        (zone ? `\n${zone}` : ''),
    )
  }
}
