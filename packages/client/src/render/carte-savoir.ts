/**
 * ═══ LA CARTE-SAVOIR — ce que le personnage SAIT de la vallée, peint tuile à tuile ═══
 *
 * Trois états, décision d'Alexis du 2026-08-28 :
 *
 *   ENCRE   — cellule jamais vue : le noir du brouillard (R19), rien ne s'y devine.
 *   GRISÉ   — arpenté mais hors de portée de vue : la MÉMOIRE. La matière `grise` de
 *             `carte-art`, et la cendre telle qu'on l'a VUE (`Brouillard.cendreVue`), grisée.
 *   VIF     — le disque de vue autour du personnage : la matière `vive`, et la cendre à son
 *             avancée COURANTE (le disque est estampillé chaque image : le savoir y est frais).
 *
 * La cendre se REDÉRIVE par la loi du jeu (`coût ≤ avancée·ORTHO·(1+grain)`) à l'avancée que la
 * cellule a MÉMORISÉE — la carte ne montre jamais un front qu'on n'a pas regardé avancer. Le
 * grain est celui de `grainDeCendre`, appelé tuile à tuile : la carte et le sol du monde tombent
 * d'accord au pixel près, et les repeints sont locaux (un disque, une poignée de cellules).
 *
 * PUR : écrit dans un tampon RGBA fourni — aucune notion de canvas ni de Phaser ici.
 */
import { CENDRE, coutDe, grainDeCendre, terrainCendre, type WorldMap } from '@ashes/sim'
import { avanceeVue, type Brouillard } from './fog'
import { CARTE_ENCRE, couleurCendreCarte, griserPx, type CarteArt } from './carte-art'

/** Bornes de cellules (INCLUSIVES) couvertes par un disque en tuiles — de quoi ne repeindre
 *  que ce qu'un pas ou une estampille a pu changer. */
export function cellulesDuDisque(
  b: Brouillard,
  tuileX: number,
  tuileY: number,
  rayonTuiles: number,
): { cx0: number; cy0: number; cx1: number; cy1: number } {
  const r = Math.max(0, Math.ceil(rayonTuiles / b.pas))
  const cx = Math.floor(tuileX / b.pas)
  const cy = Math.floor(tuileY / b.pas)
  return {
    cx0: Math.max(0, cx - r),
    cy0: Math.max(0, cy - r),
    cx1: Math.min(b.cols - 1, cx + r),
    cy1: Math.min(b.rows - 1, cy + r),
  }
}

/**
 * PEINT UNE RÉGION DE CELLULES dans le tampon RGBA de la carte (1 px/tuile, taille de la carte).
 * L'appelant choisit la région : tout le monde au premier montage, le disque ensuite.
 */
export function peindreSavoirRegion(
  data: Uint8ClampedArray,
  art: CarteArt,
  map: WorldMap,
  b: Brouillard,
  seed: number,
  joueur: { x: number; y: number } | null,
  rayonVue: number,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
): void {
  const { width, height } = map
  const encreR = (CARTE_ENCRE >> 16) & 0xff
  const encreG = (CARTE_ENCRE >> 8) & 0xff
  const encreB = CARTE_ENCRE & 0xff
  const champ = map.cendreCout
  // LE DISQUE DE VUE EST CELUI DE `revele`, À LA CELLULE PRÈS (demande d'Alexis, 2026-08-28) :
  // même quantification, même comparaison — le vif épouse exactement les carrés du dévoilement,
  // la grammaire pixellisée du jeu. Un cercle lissé à la tuile flottait SUR le motif du
  // brouillard au lieu d'en être.
  const rCell = Math.max(0, Math.ceil(rayonVue / b.pas))
  const r2 = rCell * rCell
  const jcx = joueur === null ? 0 : Math.floor(joueur.x / b.pas)
  const jcy = joueur === null ? 0 : Math.floor(joueur.y / b.pas)

  for (let cy = Math.max(0, cy0); cy <= Math.min(b.rows - 1, cy1); cy++) {
    for (let cx = Math.max(0, cx0); cx <= Math.min(b.cols - 1, cx1); cx++) {
      const cellule = cy * b.cols + cx
      const vu = b.vu[cellule] === 1
      const av = avanceeVue(b, cellule)
      const dcx = cx - jcx
      const dcy = cy - jcy
      const enVue = joueur !== null && dcx * dcx + dcy * dcy <= r2
      const x1 = Math.min(width, (cx + 1) * b.pas)
      const y1 = Math.min(height, (cy + 1) * b.pas)
      for (let ty = cy * b.pas; ty < y1; ty++) {
        for (let tx = cx * b.pas; tx < x1; tx++) {
          const i = ty * width + tx
          const k = i * 4
          if (!vu) {
            data[k] = encreR
            data[k + 1] = encreG
            data[k + 2] = encreB
            data[k + 3] = 255
            continue
          }
          // LA CENDRE SUE — à l'avancée MÉMORISÉE par la cellule, par la loi du jeu.
          let cendre = false
          if (av >= 0 && champ) {
            const c = coutDe(champ, i)
            cendre = c >= 0 && c <= av * CENDRE.ORTHO * (1 + grainDeCendre(seed, tx, ty))
          }
          if (cendre) {
            const t = terrainCendre(map.terrain[i] ?? 0, false)
            let [r, g, bl] = couleurCendreCarte(t ?? map.terrain[i] ?? 0)
            if (!enVue) [r, g, bl] = griserPx(r, g, bl)
            data[k] = r
            data[k + 1] = g
            data[k + 2] = bl
          } else {
            const src = enVue ? art.vive : art.grise
            data[k] = src[k]!
            data[k + 1] = src[k + 1]!
            data[k + 2] = src[k + 2]!
          }
          data[k + 3] = 255
        }
      }
    }
  }
}
