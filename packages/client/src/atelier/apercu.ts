/**
 * LES VIGNETTES DE LA PALETTE DE L'ATELIER — et rien d'autre.
 *
 * Le RENDU de l'aperçu, lui, est LE JEU (`scene.ts` : le vrai `SnapshotView`, décision
 * d'Alexis du 2026-08-10 — le composeur canvas qui vivait ici a été retiré, jugé illisible :
 * même en vrais albédos, un second renderer n'atteint pas le pipeline). Ne reste que la
 * miniature de palette : l'albédo d'une pièce écrasé en 16×16 — un ICONE de bouton, pas un
 * aperçu, et c'est le seul endroit où un dessin hors-Phaser reste honnête.
 */
import { albedosAtelier } from '../render/bati-art'

const T = 16

/** Les albédos, dessinés UNE fois par page. */
const ALBEDOS = albedosAtelier()

/** La vignette d'un caractère de palette : l'albédo de sa pièce s'il en a un, la teinte de
 *  sa région sinon — la palette montre ce que la case DONNERA, pas un aplat arbitraire. */
export function vignette(piece: string | undefined, region: string | undefined): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = T
  c.height = T
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.fillStyle = region === 'salle' ? '#4a3a28' : region === 'cour' ? '#54452e' : '#2a2e26'
  g.fillRect(0, 0, T, T)
  if (piece) {
    const a = ALBEDOS.get(`st-${piece}`)
    if (a) {
      const k = Math.min(T / a.width, T / a.height)
      g.drawImage(a, (T - a.width * k) / 2, T - a.height * k, a.width * k, a.height * k)
    }
  }
  return c
}
