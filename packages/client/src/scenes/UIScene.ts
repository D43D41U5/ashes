/**
 * Scène UI en surimpression — pattern Manif : la caméra de jeu zoome et
 * suit l'avatar, l'UI vit dans une scène parallèle à caméra neutre (un
 * objet scrollFactor 0 dans une caméra zoomée serait projeté hors écran).
 * Communication par le registry : WorldScene écrit, UIScene lit.
 */
import type { GameTime, Inventory } from '@braises/sim'
import Phaser from 'phaser'

const STRUCTURE_LABELS: Record<string, string> = {
  wall: 'mur',
  door: 'porte',
  chest: 'coffre',
  workshop: 'atelier',
}

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
  private bottomBar!: Phaser.GameObjects.Text
  private errorText!: Phaser.GameObjects.Text

  constructor() {
    super('ui')
  }

  create(): void {
    this.nightOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x0b1030, 0)
      .setOrigin(0)

    const style = {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#e8e0c8',
      stroke: '#14141a',
      strokeThickness: 3,
    }
    this.hud = this.add.text(10, 8, '', style)
    this.bottomBar = this.add.text(10, this.scale.height - 52, '', style)
    this.errorText = this.add
      .text(this.scale.width / 2, this.scale.height - 90, '', { ...style, color: '#ff7a6b' })
      .setOrigin(0.5, 0)
  }

  override update(): void {
    const time = this.registry.get('time') as GameTime | undefined
    if (!time) return
    this.nightOverlay.setAlpha(nightAlpha(time.hourOfCycle))

    const zone = this.registry.get('zone') as string | undefined
    const members = (this.registry.get('village') as number | undefined) ?? 0
    const hour = String(Math.floor(time.hourOfCycle)).padStart(2, '0')
    this.hud.setText(
      `Jour ${time.seasonDay} — Acte ${'I'.repeat(time.act)} — ${hour}h${time.isNight ? ' (nuit)' : ''}` +
        (zone ? `\n${zone}` : '') +
        (members > 0 ? `\nVillage : ${members} membre${members > 1 ? 's' : ''}` : ''),
    )

    const inv = (this.registry.get('inv') as Inventory | undefined) ?? {}
    const selected = (this.registry.get('selected') as string | undefined) ?? 'wall'
    this.bottomBar.setText(
      `Bois ${inv.wood ?? 0} · Pierre ${inv.stone ?? 0} — [${STRUCTURE_LABELS[selected]}]\n` +
        `F : allumer un Feu · 1-4 : mur/porte/coffre/atelier · clic : bâtir · clic droit : démolir`,
    )

    const error = this.registry.get('error') as { reason: string; at: number } | undefined
    if (error && this.time.now - error.at < 2500) {
      this.errorText.setText(error.reason).setAlpha(1 - (this.time.now - error.at) / 2500)
    } else {
      this.errorText.setText('')
    }
  }
}
