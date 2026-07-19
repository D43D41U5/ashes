/**
 * LE PANNEAU DE CHAT — façon WoW : un historique en bas à gauche et une ligne de
 * saisie qui s'ouvre à la touche Entrée.
 *
 * Il vit dans l'UIScene (au-dessus du monde et du HUD) : c'est ce qui manquait à la
 * première version, dont la barre de saisie, rendue dans WorldScene, passait SOUS
 * l'UIScene et restait invisible. WorldScene tient le clavier et l'hôte ; il pose
 * l'historique (`chatLog`) et le brouillon (`chatDraft`) au registry, ce panneau les LIT.
 *
 * Les bulles au-dessus des têtes (le versant spatial) restent, elles, dans WorldScene.
 */
import Phaser from 'phaser'
import type { ChatLine } from '../../hud-state'
import { FONT } from './typography'

const X = 16
const WIDTH = 480
const LINES = 8
const LINE_H = 18
/** Au-dessus du HUD, sous les modales (carte 1001, rupture 1003). */
const DEPTH = 990
/** Fondu des vieux messages hors saisie : pleins jusqu'à `HOLD`, éteints à `GONE`. */
const HOLD_MS = 8000
const GONE_MS = 12000

export interface ChatPanel {
  update(log: ChatLine[], draft: string | null, now: number): void
}

const lineStyle = { fontFamily: FONT, fontSize: '14px', color: '#e8e0c8', stroke: '#14141a', strokeThickness: 3 } as const

/** L'étiquette d'une ligne : « Vous : … » pour soi, « Joueur N : … » sinon (les noms viennent en L2). */
function label(line: ChatLine): string {
  return `${line.self ? 'Vous' : `Joueur ${line.from}`} : ${line.text}`
}

export function createChatPanel(scene: Phaser.Scene): ChatPanel {
  const inputY = scene.scale.height - 200
  const topY = inputY - LINES * LINE_H - 8

  // Voile discret derrière l'historique — visible seulement quand il y a à lire ou à écrire.
  const bg = scene.add
    .rectangle(X - 8, topY, WIDTH, LINES * LINE_H + 36, 0x0a0a0e, 0.5)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(DEPTH)
    .setVisible(false)

  // Les lignes de l'historique, du BAS (récent) vers le HAUT (ancien).
  const lines = Array.from({ length: LINES }, (_, i) =>
    scene.add
      .text(X, inputY - 8 - (i + 1) * LINE_H, '', lineStyle)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
      .setVisible(false),
  )

  // La ligne de saisie — visible seulement quand on écrit.
  const input = scene.add
    .text(X, inputY, '', { ...lineStyle, color: '#ffffff' })
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(DEPTH + 1)
    .setVisible(false)

  return {
    update(log, draft, now) {
      const composing = draft !== null
      const recent = log.slice(-LINES)
      let anyVisible = false
      for (let i = 0; i < LINES; i++) {
        // i = 0 → la plus récente, juste au-dessus de la saisie ; i croissant = plus vieux.
        const line = recent[recent.length - 1 - i]
        const obj = lines[i]!
        if (!line) {
          obj.setVisible(false)
          continue
        }
        const age = now - line.at
        // En saisie, tout est plein ; sinon les vieux messages s'éteignent.
        const alpha = composing ? 1 : age >= GONE_MS ? 0 : age <= HOLD_MS ? 1 : 1 - (age - HOLD_MS) / (GONE_MS - HOLD_MS)
        if (alpha <= 0.02) {
          obj.setVisible(false)
          continue
        }
        anyVisible = true
        obj.setVisible(true).setAlpha(alpha).setText(label(line)).setColor(line.self ? '#cfe6a0' : '#e8e0c8')
      }

      if (composing) input.setVisible(true).setText(`Dire : ${draft}|`)
      else input.setVisible(false)

      bg.setVisible(composing || anyVisible)
    },
  }
}
