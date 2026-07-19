/**
 * L'ÉCRAN PRINCIPAL — le premier choix : jouer SEUL (la Veillée, /sim dans un Worker)
 * ou REJOINDRE une vallée partagée (un serveur, /sim sur Node). C'est le seul aiguillage
 * solo/multi ; WorldScene reçoit le choix par les `data` de scène et n'instancie pas
 * l'hôte lui-même (« seul le transport change »).
 *
 * DEEP-LINK : `?solo` démarre droit en Veillée, `?server=ws://…` droit sur un serveur —
 * on saute le menu. Le smoke test s'en sert (`?solo`) pour piloter le jeu sans cliquer ;
 * un humain sans query voit le menu.
 *
 * RENDU : la planche est en DOM (voir `ui/menu-dom.ts`), rendue ISO à la maquette
 * « Ashes UI » Turn 9A — le canvas Phaser ne saurait égaler un titre en `text-shadow`,
 * un anneau en `conic-gradient` et la police `JetBrains Mono` sans se créneler à
 * l'upscale. Cette scène ne fait donc que MONTER le voile, brancher les gestes, et le
 * RETIRER au lancement d'une partie (ou à l'arrêt de la scène).
 */
import Phaser from 'phaser'
import { mountMenu, type MenuHandle } from './ui/menu-dom'
import type { WorldSceneData } from './WorldScene'

export class MenuScene extends Phaser.Scene {
  private menu: MenuHandle | undefined

  constructor() {
    super('menu')
  }

  create(): void {
    // DEEP-LINK : on saute le menu si l'intention est explicite dans l'URL.
    const params = new URLSearchParams(window.location.search)
    if (params.has('solo')) return this.launch({ mode: 'solo' })
    const server = params.get('server')
    if (server) return this.launch({ mode: 'multi', url: server })

    this.menu = mountMenu({
      onSolo: () => this.launch({ mode: 'solo' }),
      onServer: (s) => this.launch({ mode: 'multi', url: s.url }),
    })
    // Le voile vit hors de la liste d'affichage de Phaser : on le retire à la main.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dismiss())
  }

  private dismiss(): void {
    this.menu?.destroy()
    this.menu = undefined
  }

  private launch(data: WorldSceneData): void {
    this.dismiss() // retirer le voile AVANT de révéler le monde
    this.scene.start('world', data)
  }
}
