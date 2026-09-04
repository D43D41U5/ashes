/**
 * ═══ LE CHAMP DU CHAOS DIT LA MÊME CHOSE QUE SON PRÉDICAT ═══
 *
 * `champDuChaos` existe pour que l'ART puisse dessiner les dalles du lapiaz à la fraction de
 * tuile (`render/paves.ts`) ; `galerieDuChaos` reste le prédicat que la SIM consulte pour semer.
 * Deux fonctions, une géométrie — et une division au milieu, qui peut arrondir.
 *
 * ⚠ **LA GARDE PORTE SUR LES VRAIES TUILES DU MONDE JOUÉ, PAS SUR UN RECTANGLE SYNTHÉTIQUE.**
 * `larg` se lit dans un `fbm2` aux coordonnées MONDE : un balayage de 0 à 200 fabriquerait ses
 * conditions et ne prouverait rien sur le pays qu'on joue (mémoire « garde d'atteignabilité au
 * runtime »). On balaie donc le lapiaz tel qu'il est né, tuile à tuile.
 */
import { describe, expect, it } from 'vitest'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE_JOUE } from './zonegraph'
import { TERRAIN_BOULDERS, TERRAIN_SCREE } from './balance'
import { champDuChaos, galerieDuChaos, MINE } from './zone-content'

const SEEDS = [2026, 7, 4242]

describe('le champ du chaos', () => {
  it('accorde le champ continu et le prédicat de galerie sur toute la caillasse du monde joué', () => {
    let vues = 0
    let galeries = 0
    for (const seed of SEEDS) {
      const c = carteDeTest(seed, 8, MONDE_JOUE)
      const { width, height, terrain } = c.map
      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          const t = terrain[ty * width + tx]
          if (t !== TERRAIN_BOULDERS && t !== TERRAIN_SCREE) continue
          vues++
          const dedans = galerieDuChaos(tx, ty, seed)
          if (dedans) galeries++
          expect(champDuChaos(tx, ty, seed) < 1, `(${tx}, ${ty}) graine ${seed}`).toBe(dedans)
          // Le réseau de la MINE (l'échelle des buttes) répond de la même façon.
          expect(champDuChaos(tx, ty, seed, MINE) < 1).toBe(galerieDuChaos(tx, ty, seed, MINE))
        }
      }
    }
    // LA PRÉMISSE — sans caillasse ni galerie, l'accord ci-dessus serait vide de sens.
    // Re-épinglée 10 000 → 8 000 le 2026-08-30 (pays endoréique : l'érosion redessine le relief
    // sur lequel naît le lapiaz, et l'eau prend de la place). MESURÉ : 9 267 tuiles balayées.
    expect(vues).toBeGreaterThan(8_000)
    expect(galeries).toBeGreaterThan(1_000)
  })

  it('rend sous 1 dans l allée, au-dessus sur la dalle — sur du vrai chaos de blocs', () => {
    // ⚠ LA GRAINE 2026 N'A PAS DE `boulders` À HUIT JOUEURS (mesuré : 0 tuile ; la carte
    // rétrécit avec le nombre de joueurs, et le lapiaz avec elle). On cherche donc du chaos
    // là où il y en a, au lieu de supposer qu'il y en a partout.
    let trouve = 0
    for (const seed of SEEDS) {
      const c = carteDeTest(seed, 8, MONDE_JOUE)
      const { width, height, terrain } = c.map
      let galerie = -1
      let masse = -1
      for (let i = 0; i < width * height && (galerie < 0 || masse < 0); i++) {
        if (terrain[i] !== TERRAIN_BOULDERS) continue
        const tx = i % width
        const ty = (i - tx) / width
        if (galerieDuChaos(tx, ty, seed)) { if (galerie < 0) galerie = i } else if (masse < 0) masse = i
      }
      if (galerie < 0 || masse < 0) continue
      trouve++
      expect(champDuChaos(galerie % width, (galerie - (galerie % width)) / width, seed)).toBeLessThan(1)
      expect(champDuChaos(masse % width, (masse - (masse % width)) / width, seed)).toBeGreaterThanOrEqual(1)
    }
    expect(trouve, 'aucune graine ne porte de chaos de blocs — la garde ne garde rien').toBeGreaterThan(0)
  })

  it('se lit CONTINÛMENT entre deux tuiles — c est ce qui lui donne un bord non carré', () => {
    const seed = 2026
    // Sur un segment d'une tuile, le champ ne peut pas sauter : deux points distants d'un
    // seizième de tuile diffèrent de peu. (La propriété qui rend le dessin sous-pixel légitime.)
    let maxSaut = 0
    for (let k = 0; k < 4000; k++) {
      const fx = 1200 + (k % 200) / 16
      const fy = 100 + Math.floor(k / 200) / 16
      maxSaut = Math.max(maxSaut, Math.abs(champDuChaos(fx, fy, seed) - champDuChaos(fx + 1 / 16, fy, seed)))
    }
    expect(maxSaut).toBeLessThan(0.25)
  })
})
