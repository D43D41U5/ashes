/**
 * L'ÉCRAN DE RUPTURE — quand l'hôte est perdu.
 *
 * Il y a deux sortes d'erreurs, et les confondre serait une faute :
 *
 * - les erreurs de JEU (« trop tôt », « hors de portée »…) passent par `errorText` :
 *   elles s'affichent trois secondes et s'effacent. La partie continue.
 * - la RUPTURE — le Worker a jeté une exception, le transport est mort, le protocole
 *   est désaccordé — ne s'efface JAMAIS. Plus aucun snapshot n'arrivera : l'avatar
 *   marcherait dans un monde figé, ou resterait devant une barre de chargement qui ne
 *   monte plus. On l'écrit en grand, on dit ce qu'on sait, et on offre la seule chose
 *   qui puisse encore aider : recharger.
 *
 * La partie n'est pas perdue pour autant : la Veillée est SEEDÉE (`VEILLEE_SEED`) —
 * recharger régénère la même vallée. Ce qui est perdu, c'est la progression de la
 * session en cours (la persistance viendra avec la Phase LAN).
 */
import type Phaser from 'phaser'
import { FONT } from './typography'

/** Cendre chaude sur fond de suie : c'est grave, mais on reste dans le monde du jeu. */
const BACKDROP = 0x0a0a0e
const PANEL = 0x14141a
const BORDER = 0x8a2a1e
const BUTTON = 0x8a4a2e
const BUTTON_HOVER = 0xb35f39

export interface FatalPanel {
  /** Affiche la rupture. Le PREMIER motif gagne : les suivants n'en sont que les
   *  conséquences (un worker mort ré-émet volontiers du bruit). */
  show(reason: string): void
}

export function createFatalPanel(scene: Phaser.Scene, depth: number, onReload: () => void): FatalPanel {
  const W = scene.scale.width
  const H = scene.scale.height
  const cx = W / 2
  const cy = H / 2

  const style = {
    fontFamily: FONT,
    fontSize: '16px',
    color: '#e8e0c8',
    stroke: '#14141a',
    strokeThickness: 3,
  } as const

  // Le voile est OPAQUE : derrière lui le monde est figé (ou n'est jamais né). Le
  // laisser transparaître donnerait l'illusion d'un jeu encore vivant.
  const backdrop = scene.add.rectangle(0, 0, W, H, BACKDROP, 0.94).setOrigin(0)
  const panel = scene.add.rectangle(cx, cy, 720, 300, PANEL, 1).setStrokeStyle(2, BORDER)
  const title = scene.add
    .text(cx, cy - 110, 'LA VEILLÉE S’EST ROMPUE', { ...style, fontSize: '24px', color: '#e8842c' })
    .setOrigin(0.5)
  const reason = scene.add
    .text(cx, cy - 50, '', {
      ...style,
      fontSize: '15px',
      color: '#ff9a7a',
      strokeThickness: 0,
      align: 'center',
      wordWrap: { width: 640 },
    })
    .setOrigin(0.5, 0)
  const hint = scene.add
    .text(cx, cy + 20, 'L’hôte de simulation ne répond plus : plus rien n’avancera.\nRecharger régénère la même vallée (la seed ne change pas).', {
      ...style,
      fontSize: '14px',
      color: '#b8b0a0',
      strokeThickness: 0,
      align: 'center',
    })
    .setOrigin(0.5, 0)

  const btnBg = scene.add.rectangle(cx, cy + 105, 260, 44, BUTTON, 1).setStrokeStyle(2, 0x14141a)
  const btnText = scene.add.text(cx, cy + 105, 'RECHARGER', { ...style, fontSize: '17px' }).setOrigin(0.5)
  btnBg
    .setInteractive({ useHandCursor: true })
    .on('pointerover', () => btnBg.setFillStyle(BUTTON_HOVER))
    .on('pointerout', () => btnBg.setFillStyle(BUTTON))
    .on('pointerup', () => onReload())

  const root = scene.add
    .container(0, 0, [backdrop, panel, title, reason, hint, btnBg, btnText])
    .setDepth(depth)
    .setVisible(false)

  let rompu = false

  return {
    show(motif) {
      if (rompu) return // le premier motif est la CAUSE ; la suite n'est que du bruit
      rompu = true
      reason.setText(motif)
      root.setVisible(true)
    },
  }
}
