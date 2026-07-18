/**
 * LA FENÊTRE DU BAS — « Fonder un village ici ? ».
 *
 * Elle paraît quand on s'approche d'un feu de camp qu'on a planté (un feu LIBRE,
 * à soi) et qu'on n'a pas encore de foyer. Un clic sur OUI fonde le village : le
 * feu devient le Feu du foyer, on en est le Chef. L'IGNORER (s'éloigner, ne pas
 * cliquer) laisse le feu tel quel — une simple source de chaleur et une station de
 * cuisine. C'est le seul moment où « allumer un feu » et « fonder un village » se
 * rejoignent, et c'est un CHOIX, jamais un automatisme (décision utilisateur).
 *
 * Zéro règle de jeu ici : elle POSE l'action `found_village`, la sim tranche.
 */
import type Phaser from 'phaser'
import type { PlayerAction } from '@braises/sim'
import { textStyle } from './typography'

const DEPTH = 950 // au-dessus du monde, sous les overlays plein écran (carte, sac)
const PANEL_W = 360
const PANEL_H = 70

export interface FoundVillagePrompt {
  /** `foundable` = le feu promouvable (ou `null` = rien à portée : la fenêtre s'efface). */
  update(foundable: { structureId: number } | null): void
}

export function createFoundVillagePrompt(
  scene: Phaser.Scene,
  send: (a: PlayerAction) => void,
): FoundVillagePrompt {
  const cx = scene.scale.width / 2
  // Au-dessus du bandeau d'erreur (height - 110) et de la ceinture, jamais dessus.
  const cy = scene.scale.height - 178

  const panel = scene.add
    .rectangle(cx, cy, PANEL_W, PANEL_H, 0x14141a, 0.94)
    .setStrokeStyle(2, 0x6b5a3a)
    .setScrollFactor(0)
    .setDepth(DEPTH)
  const label = scene.add
    .text(cx, cy - 16, 'Un feu de camp brûle ici.', textStyle('body', 'body'))
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(DEPTH)

  const btn = scene.add
    .rectangle(cx, cy + 14, 220, 26, 0x2a2a34, 0.96)
    .setStrokeStyle(1, 0xe8c66a)
    .setScrollFactor(0)
    .setDepth(DEPTH)
    .setInteractive({ useHandCursor: true })
  const btnText = scene.add
    .text(cx, cy + 14, 'Fonder un village ici', textStyle('label', 'body', false))
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(DEPTH)

  btn.on('pointerover', () => btn.setFillStyle(0x3a3a46, 0.98))
  btn.on('pointerout', () => btn.setFillStyle(0x2a2a34, 0.96))

  const nodes: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [panel, label, btn, btnText]
  const setShown = (v: boolean): void => {
    for (const n of nodes) n.setVisible(v)
  }
  setShown(false) // né caché : rien du HUD ne paraît avant le premier instant jouable

  let current: { structureId: number } | null = null
  btn.on('pointerdown', () => {
    if (!current) return
    send({ type: 'found_village', structureId: current.structureId })
    // On FERME tout de suite (optimiste). Le foyer n'est fondé côté sim qu'au
    // prochain snapshot ; d'ici là, un second clic renverrait un `found_village`
    // refusé (« déjà un foyer ») dans le flux d'événements — un bouton qui a tiré
    // se tait. Le snapshot suivant confirmera (foundableFire repasse à null).
    current = null
    setShown(false)
  })

  return {
    update(foundable) {
      current = foundable
      setShown(foundable !== null)
    },
  }
}
