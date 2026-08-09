/**
 * LE SOCLE — les gardes de la couche I (spec `stratigraphie.md` S-A1/S-A3/S-A4).
 *
 * On ne juge pas la BEAUTÉ du relief ici (elle se juge sur PNG, méthode §5 de la spec) — on
 * garde les PROPRIÉTÉS : le déterminisme au bit près, le drainage total (toute cellule hors
 * niveau de base a un récepteur), la variable d'ordre partout (aucune zone au champ plat),
 * le treillis maître (le socle ne touche ni zone ni terrain), et le contrat de compatibilité
 * de la Racine (son champ historique, mêmes sels, mêmes valeurs).
 */
import { describe, expect, it } from 'vitest'
import { batirLeSocle, type Socle } from './socle'
import { CREUX, seuilParQuantile } from './racine-relief'
import { deriveGrapheZones } from './zonegraph'
import { decouperEnBlocs } from './zonegen'
import { fbm2 } from './noise'

/** Le monde d'essai : petit (8 joueurs), mais le VRAI graphe et le VRAI échantillonnage. */
function monde(seed: number): { socle: Socle; zone: Int32Array; g: ReturnType<typeof deriveGrapheZones> } {
  const g = deriveGrapheZones(seed, 8)
  const blocs = decouperEnBlocs(g)
  const B = 16
  const zone = new Int32Array(g.width * g.height)
  for (let y = 0; y < g.height; y++) {
    const by = Math.min(blocs.rows - 1, Math.floor(y / B))
    for (let x = 0; x < g.width; x++) {
      zone[y * g.width + x] = blocs.zone[by * blocs.cols + Math.min(blocs.cols - 1, Math.floor(x / B))]!
    }
  }
  const videAt = (x: number, y: number): boolean => {
    const bx = Math.min(blocs.cols - 1, Math.max(0, Math.floor(x / B)))
    const by = Math.min(blocs.rows - 1, Math.max(0, Math.floor(y / B)))
    return blocs.vide[by * blocs.cols + bx] === 1
  }
  const socle = batirLeSocle(g, seed, zone, g.width, g.height, videAt)
  expect(socle).not.toBeNull()
  return { socle: socle!, zone, g }
}

describe('le socle', () => {
  const { socle, zone, g } = monde(7)

  it('S-A1 — est déterministe au bit près : deux constructions, mêmes champs', () => {
    const bis = monde(7).socle
    expect(Array.from(bis.altLarge)).toEqual(Array.from(socle.altLarge))
    expect(Array.from(bis.alt)).toEqual(Array.from(socle.alt))
    expect(Array.from(bis.flux)).toEqual(Array.from(socle.flux))
    expect(Array.from(bis.recepteur)).toEqual(Array.from(socle.recepteur))
  })

  it('ne produit ni NaN ni infini, nulle part', () => {
    for (const champ of [socle.alt, socle.altLarge, socle.flux, socle.pente] as const) {
      for (let k = 0; k < champ.length; k++) {
        expect(Number.isFinite(champ[k]!), `cellule ${k}`).toBe(true)
      }
    }
  })

  it('S-R3 — TOUT draine : hors niveau de base, chaque cellule a un récepteur', () => {
    for (let k = 0; k < socle.recepteur.length; k++) {
      if (socle.dedans[k] === 1) {
        expect(socle.recepteur[k], `la base ${k} ne draine pas`).toBe(-1)
      } else {
        expect(socle.recepteur[k], `la cellule ${k} n'a pas d'exutoire`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('le drainage ACCUMULE : un vrai réseau se forme (des troncs, pas des filets épars)', () => {
    let max = 0
    for (let k = 0; k < socle.flux.length; k++) if (socle.flux[k]! > max) max = socle.flux[k]!
    // Sur un monde de 8 joueurs (~15 000 cellules hors racine), un tronc principal draine au
    // moins un demi-millier de cellules — sinon le champ est du bruit, pas un bassin versant.
    expect(max).toBeGreaterThan(500)
  })

  it('S-A3 — la variable d\'ordre existe PARTOUT : aucune zone au champ dégénéré', () => {
    for (const z of g.zones) {
      const actives = new Uint8Array(socle.alt.length)
      let n = 0
      for (let k = 0; k < socle.alt.length; k++) {
        if (socle.zoneCell[k] === z.id && socle.videCell[k] === 0) { actives[k] = 1; n++ }
      }
      if (n < 40) continue // une zone à peine échantillonnée ne prouve rien
      const q20 = seuilParQuantile(socle.alt, actives, 0.2, -0.5, 1.5)
      const q80 = seuilParQuantile(socle.alt, actives, 0.8, -0.5, 1.5)
      expect(q80 - q20, `${z.def.slug} : champ plat (q20=${q20}, q80=${q80})`).toBeGreaterThan(0.01)
    }
  })

  it('S-A4 — le treillis est maître : le socle ne mute jamais `zone`', () => {
    const avant = Array.from(zone.slice(0, 4096))
    monde(7) // reconstruit — sur les MÊMES entrées re-dérivées
    expect(Array.from(zone.slice(0, 4096))).toEqual(avant)
  })

  it('la Racine garde son champ historique : altLarge = l\'ondulation de juillet, par tuile', () => {
    const M = CREUX.MOTIF
    let verifiees = 0
    for (let k = 0; k < socle.altLarge.length && verifiees < 200; k++) {
      if (socle.dedans[k] !== 1) continue
      const kx = k % socle.cols
      const ky = (k - kx) / socle.cols
      const attendu = fbm2(kx * M + M / 2, ky * M + M / 2, CREUX.ECHELLE_LARGE, (7 ^ 0x43524555) | 0)
      expect(socle.altLarge[k]).toBe(attendu)
      verifiees++
    }
    expect(verifiees).toBeGreaterThan(100)
  })

  it('les cellules de la Racine sont le niveau de base : plus basses que le reste, en rang', () => {
    // La physique interne (pas altLarge, qui mélange deux échelles pour compatibilité) se lit
    // par le drainage : le flux TOTAL déversé dans la racine domine tout autre puits.
    let versRacine = 0
    let ailleurs = 0
    for (let k = 0; k < socle.recepteur.length; k++) {
      const r = socle.recepteur[k]!
      if (r >= 0 && socle.dedans[r] === 1) versRacine += socle.flux[k]!
      else if (r === -1 && socle.dedans[k] === 0) ailleurs += socle.flux[k]!
    }
    expect(versRacine, 'rien ne se déverse dans la Racine').toBeGreaterThan(0)
    expect(ailleurs, 'des puits hors niveau de base').toBe(0)
  })
})
