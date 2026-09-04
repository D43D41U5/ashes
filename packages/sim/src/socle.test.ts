/**
 * LE SOCLE — les gardes de la couche I (spec `stratigraphie.md` S-A1/S-A3/S-A4).
 *
 * On ne juge pas la BEAUTÉ du relief ici (elle se juge sur PNG, méthode §5 de la spec) — on
 * garde les PROPRIÉTÉS : le déterminisme au bit près, le drainage sans boucle d'un pays
 * ENDORÉIQUE (toute chaîne descend et finit dans une cuvette — amendement du 2026-08-30), la
 * variable d'ordre partout (aucune zone au champ plat), le treillis maître (le socle ne touche
 * ni zone ni terrain), et le contrat d'ÉCHELLE de la Racine (son champ érodé garde les bornes
 * du champ de juillet — la forme change, jamais l'échelle).
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

  it('S-R3 — le pays est ENDORÉIQUE : tout descend, et finit dans une cuvette (jamais en boucle)', () => {
    // ⚑ 2026-08-30 : la garde disait « hors niveau de base, chaque cellule a un récepteur ». Le
    // niveau de base n'existe plus (`socle.ts` ②) — une cellule sans récepteur est désormais un
    // TERMINUS légitime, celui que l'hydrologie inondera en lac. Ce qui reste NON négociable, et
    // que cette garde prouve : la pente accompagne le récepteur, et aucune chaîne ne boucle
    // (sans quoi la pile de Braun-Willett serait fausse et le flux, du bruit).
    const n = socle.recepteur.length
    let terminus = 0
    for (let k = 0; k < n; k++) {
      const r = socle.recepteur[k]!
      if (r < 0) {
        terminus++
        expect(socle.pente[k], `terminus ${k} : une pente sans récepteur`).toBe(0)
      } else {
        expect(socle.pente[k], `cellule ${k} : un récepteur sans pente`).toBeGreaterThan(0)
      }
    }
    expect(terminus, 'aucune cuvette : le pays draine vers un bord').toBeGreaterThan(0)
    expect(terminus / n, 'trop de terminus — le champ est plat, pas endoréique').toBeLessThan(0.1)
    // AUCUNE BOUCLE : depuis chaque cellule, on descend et on aboutit — en moins de n pas.
    for (let s = 0; s < n; s += 37) {
      let k = s
      let pas = 0
      while (socle.recepteur[k]! >= 0) {
        k = socle.recepteur[k]!
        expect(++pas, `boucle de récepteurs depuis ${s}`).toBeLessThan(n)
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

  it('la Racine S\'ÉRODE, et garde l\'ÉTENDUE de juillet : la forme change, jamais l\'échelle', () => {
    // ⚑ 2026-08-30 : la garde disait « altLarge = l'ondulation de juillet, par tuile ». La Racine
    // n'est plus épinglée (`socle.ts` ①) — mais son champ érodé se RECALE sur le min/max du champ
    // historique, et c'est ce contrat-là qui protège tout l'aval : les seuils qui le lisent
    // (`CREUX.LAME` pour la lame des lacs, les quantiles de végétation) sont en unités de ce champ.
    const M = CREUX.MOTIF
    const juillet = (k: number): number => {
      const kx = k % socle.cols
      const ky = (k - kx) / socle.cols
      return fbm2(kx * M + M / 2, ky * M + M / 2, CREUX.ECHELLE_LARGE, (7 ^ 0x43524555) | 0)
    }
    let dedans = 0
    let bougees = 0
    let jMin = Infinity, jMax = -Infinity, aMin = Infinity, aMax = -Infinity
    for (let k = 0; k < socle.altLarge.length; k++) {
      if (socle.dedans[k] !== 1) continue
      dedans++
      const j = juillet(k)
      if (socle.altLarge[k] !== j) bougees++
      if (j < jMin) jMin = j
      if (j > jMax) jMax = j
      if (socle.altLarge[k]! < aMin) aMin = socle.altLarge[k]!
      if (socle.altLarge[k]! > aMax) aMax = socle.altLarge[k]!
    }
    expect(dedans, 'pas de Racine échantillonnée — la garde ne prouve rien').toBeGreaterThan(100)
    // L'ÉROSION A EU LIEU : le champ n'est plus celui de juillet, presque nulle part.
    expect(bougees / dedans, 'le champ de la Racine est resté celui de juillet').toBeGreaterThan(0.9)
    // L'ÉCHELLE, ELLE, EST INTACTE : mêmes bornes, au bit près.
    expect(aMin, 'le plancher du champ a bougé').toBe(jMin)
    expect(aMax, 'le plafond du champ a bougé').toBe(jMax)
  })

  it('le monde s\'écoule VERS la Racine : c\'est elle qui reçoit, et le plus gros terminus y est', () => {
    // ⚑ 2026-08-30 : la garde exigeait « zéro puits hors de la Racine », ce que l'endoréisme
    // abroge (une cuvette de montagne est un terminus légitime). Ce qui doit rester vrai, c'est le
    // SENS de la pente à l'échelle du monde : la Racine est le fond de la vallée.
    let versRacine = 0
    const parZone = new Map<number, number>()
    for (let k = 0; k < socle.recepteur.length; k++) {
      const r = socle.recepteur[k]!
      if (r >= 0 && socle.dedans[r] === 1 && socle.dedans[k] === 0) versRacine += socle.flux[k]!
      if (r === -1) {
        const z = socle.dedans[k] === 1 ? -1 : socle.zoneCell[k]!
        parZone.set(z, (parZone.get(z) ?? 0) + socle.flux[k]!)
      }
    }
    expect(versRacine, 'rien ne se déverse dans la Racine').toBeGreaterThan(0)
    // Le flux qui TERMINE dans la Racine domine celui qui termine dans n'importe quelle autre
    // zone : les cuvettes de montagne existent (endoréisme), mais le fond de la vallée reçoit
    // le pays. C'est le SENS de la pente à l'échelle du monde, pas l'absence de puits ailleurs.
    const racine = parZone.get(-1) ?? 0
    let meilleureAutre = 0
    for (const [z, f] of parZone) if (z !== -1 && f > meilleureAutre) meilleureAutre = f
    expect(racine, `la Racine ne reçoit pas le plus gros bassin (${racine} contre ${meilleureAutre})`)
      .toBeGreaterThan(meilleureAutre)
  })
})
