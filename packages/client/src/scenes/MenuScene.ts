/**
 * L'ÉCRAN PRINCIPAL — le premier choix : jouer SEUL (la Veillée, /sim dans un Worker)
 * ou REJOINDRE une vallée partagée (un serveur, /sim sur Node). C'est le seul aiguillage
 * solo/multi ; WorldScene reçoit le choix par les `data` de scène et n'instancie pas
 * l'hôte lui-même (« seul le transport change »).
 *
 * DEEP-LINK : `?solo` démarre droit en Veillée, `?server=ws://…` droit sur un serveur —
 * on saute le menu. Le smoke test s'en sert (`?solo`) pour piloter le jeu sans cliquer ;
 * un humain sans query voit le menu.
 */
import Phaser from 'phaser'
import { FONT } from './ui/typography'
import { SERVERS, type ServerEntry } from '../servers'
import type { WorldSceneData } from './WorldScene'

const BACKDROP = 0x0a0a0e
const CARD = 0x16161e
const CARD_HOVER = 0x22222c
const BORDER = 0x3a3a46
const ACCENT = 0xe8842c

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu')
  }

  create(): void {
    // DEEP-LINK : on saute le menu si l'intention est explicite dans l'URL.
    const params = new URLSearchParams(window.location.search)
    if (params.has('solo')) return this.launch({ mode: 'solo' })
    const server = params.get('server')
    if (server) return this.launch({ mode: 'multi', url: server })

    const cx = this.scale.width / 2
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, BACKDROP, 1).setOrigin(0)

    this.text(cx, 118, 'BRAISES', 68, '#f0e6c8', 6).setOrigin(0.5)
    this.text(cx, 176, 'Survie · une vallée de 60 jours · l’alignement émerge', 16, '#9a8f78', 0).setOrigin(0.5)

    // ── SOLO ──────────────────────────────────────────────────────────────────
    this.card(cx, 288, 460, 68, () => this.launch({ mode: 'solo' }))
    this.text(cx, 272, 'JOUER SEUL', 22, '#f0e6c8', 3).setOrigin(0.5)
    this.text(cx, 302, 'La Veillée — la vallée pour vous seul, hors ligne', 14, '#9a8f78', 0).setOrigin(0.5)

    // ── MULTI ─────────────────────────────────────────────────────────────────
    this.text(cx, 384, '— ou rejoindre une vallée partagée —', 14, '#6f6a60', 0).setOrigin(0.5)
    SERVERS.forEach((s, i) => this.serverRow(cx, 430 + i * 74, s))

    this.text(cx, this.scale.height - 40, 'Phase LAN', 12, '#4a463e', 0).setOrigin(0.5)
  }

  /** Un texte du menu — toute la police passe par ici (FONT, contour sombre lisible). */
  private text(x: number, y: number, str: string, size: number, color: string, stroke: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, str, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      ...(stroke > 0 ? { stroke: '#14141a', strokeThickness: stroke } : {}),
    })
  }

  /** Un rectangle cliquable (fond + survol accentué) ; les textes se posent par-dessus. */
  private card(cx: number, cy: number, w: number, h: number, onClick: () => void): void {
    const bg = this.add.rectangle(cx, cy, w, h, CARD, 1).setStrokeStyle(2, BORDER)
    bg.setInteractive({ useHandCursor: true })
      .on('pointerover', () => bg.setFillStyle(CARD_HOVER).setStrokeStyle(2, ACCENT))
      .on('pointerout', () => bg.setFillStyle(CARD).setStrokeStyle(2, BORDER))
      .on('pointerup', onClick)
  }

  /** La ligne d'un serveur : nom à gauche, seed + plafond de joueurs à droite. */
  private serverRow(cx: number, cy: number, s: ServerEntry): void {
    const w = 460
    this.card(cx, cy, w, 60, () => this.launch({ mode: 'multi', url: s.url }))
    this.text(cx - w / 2 + 20, cy, s.name, 20, '#e8e0c8', 3).setOrigin(0, 0.5)
    this.text(cx + w / 2 - 20, cy - 9, `seed ${s.seed}`, 13, '#9a8f78', 0).setOrigin(1, 0.5)
    this.text(cx + w / 2 - 20, cy + 10, `max ${s.maxClients} joueurs`, 13, '#c98b3a', 0).setOrigin(1, 0.5)
  }

  private launch(data: WorldSceneData): void {
    this.scene.start('world', data)
  }
}
