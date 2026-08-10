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
 *  sa région sinon — la palette montre ce que la case DONNERA, pas un aplat arbitraire.
 *  Les NŒUDS (arbre, baies) n'ont pas d'albédo ici (leurs textures naissent dans Phaser) :
 *  un glyphe dessiné à la main — admissible pour un icône de bouton, et mieux qu'un carré vide. */
export function vignette(piece: string | undefined, region: string | undefined, noeud?: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = T
  c.height = T
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.fillStyle = region === 'salle' ? '#4a3a28' : region === 'cour' ? '#54452e' : region === 'antre' ? '#4e4e58' : '#2a2e26'
  g.fillRect(0, 0, T, T)
  if (piece) {
    const a = ALBEDOS.get(`st-${piece}`)
    if (a) {
      const k = Math.min(T / a.width, T / a.height)
      g.drawImage(a, (T - a.width * k) / 2, T - a.height * k, a.width * k, a.height * k)
    }
  } else if (noeud === 'tree') {
    g.fillStyle = '#6b4a2f' //  le fût
    g.fillRect(7, 8, 2, 7)
    g.fillStyle = '#4a7a3a' //  le houppier
    g.fillRect(4, 2, 8, 7)
    g.fillRect(2, 4, 12, 4)
  } else if (noeud === 'berry_bush') {
    g.fillStyle = '#3f6b33' //  le buisson
    g.fillRect(3, 6, 10, 7)
    g.fillRect(5, 4, 6, 2)
    g.fillStyle = '#b03a3a' //  les baies
    g.fillRect(5, 7, 2, 2)
    g.fillRect(9, 9, 2, 2)
    g.fillRect(7, 11, 2, 2)
  }
  return c
}
