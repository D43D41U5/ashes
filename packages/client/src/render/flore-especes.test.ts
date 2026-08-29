/**
 * Les gardes du CALENDRIER FLORAL (décisions d'Alexis 2026-08-28, sur planche rendue) —
 * voir l'en-tête de `flore-especes.ts` pour les trois lois. Ce qui ferait rougir chaque
 * garde est dit à côté d'elle : aucune ne peut passer par accident si le mécanisme est
 * inerte (leçon « une sonde qui ne peut pas échouer »).
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_JUNIPER_HEATH, TERRAIN_ALPINE_FLOWERS } from '@ashes/sim'
import {
  BRUYERE, COLCHIQUE, CROCUS, FENETRES, FLORAISON_BRUIT_J, FLORAISON_ETALEMENT_J, GENTIANE,
  JONQUILLE, MARGUERITE, NAPPES, TABLE_FLORALE, enFleur, nappeDe, pCoeur, pFleur,
} from './flore-especes'
import { FLOWERS } from './lit-props'
import { clutterAt, type SampleTerrain } from './clutter'

const SEED = 2026

describe('les deux tables sont synchrones', () => {
  it('chaque espèce du calendrier a sa variété FLOWERS, et réciproquement', () => {
    // Rougirait si on ajoutait une silhouette sans fenêtre (elle ne fleurirait jamais) ou
    // une fenêtre sans silhouette (indice hors table → texture manquante en silence).
    expect(FENETRES.length).toBe(FLOWERS.length)
  })

  it('les tables de biome ne citent que des espèces existantes', () => {
    for (const table of Object.values(TABLE_FLORALE)) {
      expect(table.length).toBeGreaterThan(0)
      for (const e of table) {
        expect(e).toBeGreaterThanOrEqual(0)
        expect(e).toBeLessThan(FLOWERS.length)
      }
    }
  })
})

describe('les fenêtres de floraison', () => {
  const tuiles: [number, number][] = []
  for (let i = 0; i < 12; i++) tuiles.push([7 + i * 13, 11 + i * 7])

  it('au cœur du Grand Froid (j110), RIEN ne fleurit — sur toutes les tuiles', () => {
    // Rougirait si une fenêtre débordait sur l'hiver (l'étalement ±4 j compris).
    for (let e = 0; e < FENETRES.length; e++) {
      for (const [tx, ty] of tuiles) expect(enFleur(e, 110, tx, ty)).toBe(false)
    }
  })

  it('au jour de l\'ouverture du monde (j61+14=75), le pré ne porte que la colchique', () => {
    // La promesse de la planche : les Pluies ont une identité, pas un reste d'été.
    const enFleurAuPre = new Set<number>()
    for (const e of new Set(TABLE_FLORALE[TERRAIN_GRASS]!)) {
      for (const [tx, ty] of tuiles) if (enFleur(e, 75, tx, ty)) enFleurAuPre.add(e)
    }
    expect(enFleurAuPre).toEqual(new Set([COLCHIQUE]))
  })

  it('à la mi-Éclosion (j15), le pré porte crocus et jonquille partout — jamais l\'été', () => {
    for (const [tx, ty] of tuiles) {
      expect(enFleur(CROCUS, 15, tx, ty)).toBe(true)
      expect(enFleur(JONQUILLE, 15, tx, ty)).toBe(true)
      expect(enFleur(COLCHIQUE, 15, tx, ty)).toBe(false)
    }
  })

  it('l\'étalement par tuile existe : au bord d\'une fenêtre, des tuiles fleurissent et d\'autres pas', () => {
    // La marguerite débute j15±4 : à j15 pile, le pré doit être EN TRAIN de fleurir — un
    // balayage, pas une bascule. Rougirait si le décalage par tuile était inerte (tout un
    // pré qui s'allume le même matin).
    let oui = 0
    let non = 0
    for (let tx = 0; tx < 40; tx++) for (let ty = 0; ty < 40; ty++) {
      if (enFleur(MARGUERITE, 15, tx, ty)) oui++
      else non++
    }
    expect(oui).toBeGreaterThan(0)
    expect(non).toBeGreaterThan(0)
  })

  it('le jour est le seasonDay NON BORNÉ : l\'an 2 fleurit comme l\'an 1', () => {
    for (const [tx, ty] of tuiles) {
      expect(enFleur(COLCHIQUE, 75 + 120, tx, ty)).toBe(enFleur(COLCHIQUE, 75, tx, ty))
    }
  })

  it('les fenêtres restent dans l\'année, étalement et bruit compris (le contrat de `enFleur`)', () => {
    const marge = FLORAISON_ETALEMENT_J + FLORAISON_BRUIT_J
    for (const f of FENETRES) {
      expect(f.debut - marge).toBeGreaterThan(-20) // pas d'enjambement du tour de l'an
      expect(f.fin + marge).toBeLessThan(110) //       et l'hiver reste nu (garde j110)
      // La fenêtre du bord d'une nappe se RESSERRE de 2×étalement : elle doit survivre.
      expect(f.fin - f.debut).toBeGreaterThan(2 * marge)
    }
  })

  it('le cœur de la nappe fleurit avant le bord — et fane après lui', () => {
    // La colchique s\'ouvre j62 et se ferme j92. À j61, une tuile au cœur (force 0,95) est
    // déjà en fleur, une tuile de bord (force 0,05) pas encore ; à j93, le cœur tient
    // encore, le bord a fané. Les marges (±3,6 j) dominent le bruit (±1 j) : déterministe.
    // Rougirait si la force était inerte dans `enFleur` (retour au hash pur).
    expect(enFleur(COLCHIQUE, 61, 10, 10, 0.95)).toBe(true)
    expect(enFleur(COLCHIQUE, 61, 10, 10, 0.05)).toBe(false)
    expect(enFleur(COLCHIQUE, 93, 10, 10, 0.95)).toBe(true)
    expect(enFleur(COLCHIQUE, 93, 10, 10, 0.05)).toBe(false)
  })

  it('le jour est CONTINU : la fraction du jour fait éclore, pas seulement la date', () => {
    // Il existe une tuile dont le seuil tombe DANS la journée : pas en fleur à j15,0,
    // en fleur à j15,9. Rougirait si `enFleur` arrondissait le jour (retour à la salve
    // quotidienne d'une seconde).
    let vue = false
    for (let tx = 0; tx < 40 && !vue; tx++) for (let ty = 0; ty < 40 && !vue; ty++) {
      if (!enFleur(MARGUERITE, 15.0, tx, ty) && enFleur(MARGUERITE, 15.9, tx, ty)) vue = true
    }
    expect(vue).toBe(true)
  })
})

describe('les nappes', () => {
  it('déterministes, et sans calendrier par construction (l\'espèce d\'une tuile est FIXE)', () => {
    const a = nappeDe(TERRAIN_GRASS, 123, 456, SEED)
    const b = nappeDe(TERRAIN_GRASS, 123, 456, SEED)
    expect(a).toEqual(b)
  })

  it('chaque espèce de chaque table est ATTEIGNABLE quelque part (leçon du marais injoignable)', () => {
    // Rougirait si le biais de poids (0,5 + part) écrasait une espèce rare : une entrée de
    // table que le monde ne montre jamais est une espèce morte.
    for (const [terrain, table] of Object.entries(TABLE_FLORALE)) {
      const vues = new Set<number>()
      for (let tx = 0; tx < 160; tx += 2) for (let ty = 0; ty < 160; ty += 2) {
        vues.add(nappeDe(Number(terrain), tx, ty, SEED)!.espece)
      }
      expect([...new Set(table)].every((e) => vues.has(e)), `table du terrain ${terrain}`).toBe(true)
    }
  })

  it('les pentes d\'échange ont des bornes exactes', () => {
    expect(pFleur(0)).toBe(0)
    expect(pFleur(NAPPES.CREUX_BAS)).toBe(0)
    expect(pFleur(NAPPES.CREUX_HAUT)).toBe(1)
    expect(pFleur(1)).toBe(1)
    expect(pCoeur(NAPPES.COEUR)).toBe(0)
    expect(pCoeur(1)).toBeCloseTo(NAPPES.COEUR_BOOST, 10)
  })
})

describe('le semis à travers clutterAt', () => {
  const pre: SampleTerrain = () => TERRAIN_GRASS

  it('la fleur du pré porte une espèce de SA table, et la lande ne porte que la bruyère', () => {
    const tablePre = new Set(TABLE_FLORALE[TERRAIN_GRASS]!)
    let fleursPre = 0
    for (let tx = 0; tx < 200; tx++) for (let ty = 0; ty < 200; ty++) {
      for (const p of clutterAt(tx, ty, TERRAIN_GRASS, SEED, pre)) {
        if (p.kind !== 'flower') continue
        fleursPre++
        expect(p.espece !== undefined && tablePre.has(p.espece)).toBe(true)
      }
    }
    expect(fleursPre).toBeGreaterThan(100) // la prémisse : le pré fleurit vraiment

    const lande: SampleTerrain = () => TERRAIN_JUNIPER_HEATH
    let fleursLande = 0
    for (let tx = 0; tx < 200; tx++) for (let ty = 0; ty < 120; ty++) {
      for (const p of clutterAt(tx, ty, TERRAIN_JUNIPER_HEATH, SEED, lande)) {
        if (p.kind !== 'flower') continue
        fleursLande++
        expect(p.espece).toBe(BRUYERE)
      }
    }
    expect(fleursLande).toBeGreaterThan(30) // la lande gagne SA fleur — prémisse prouvée
  })

  it('la gentiane n\'existe qu\'en altitude — et y existe', () => {
    const alpage: SampleTerrain = () => TERRAIN_ALPINE_FLOWERS
    const especes = new Set<number>()
    for (let tx = 0; tx < 200; tx++) for (let ty = 0; ty < 120; ty++) {
      for (const p of clutterAt(tx, ty, TERRAIN_ALPINE_FLOWERS, SEED, alpage)) {
        if (p.kind === 'flower' && p.espece !== undefined) especes.add(p.espece)
      }
    }
    expect(especes.has(GENTIANE)).toBe(true)
    expect(new Set(TABLE_FLORALE[TERRAIN_GRASS]!).has(GENTIANE)).toBe(false)
  })

  it('l\'échange conserve la part de fleurs du biome (le total se redistribue, il ne fond pas)', () => {
    // La table du pré tire 2 fleurs pour 2 touffes : sans nappes, la part fleur/(fleur+touffe)
    // serait 0,5. Rougirait si les pentes CREUX/COEUR mangeaient les fleurs (part qui fond)
    // ou les multipliaient (aplat) — c'est la garde de calibration de `NAPPES`.
    let fleurs = 0
    let touffes = 0
    for (let tx = 0; tx < 300; tx++) for (let ty = 0; ty < 300; ty++) {
      for (const p of clutterAt(tx, ty, TERRAIN_GRASS, SEED, pre)) {
        if (p.kind === 'flower') fleurs++
        else if (p.kind === 'grass_tuft') touffes++
      }
    }
    const part = fleurs / (fleurs + touffes)
    expect(fleurs + touffes).toBeGreaterThan(3000) // prémisse : l'échantillon est réel
    expect(part).toBeGreaterThan(0.35)
    expect(part).toBeLessThan(0.65)
  })

  it('les fleurs se CONCENTRENT dans les nappes : le cœur est plusieurs fois plus fleuri que le creux', () => {
    // La promesse visuelle des nappes — des taches, pas un confetti. Rougirait si l'échange
    // était inerte (ratio ≈ 1) : c'est la garde qui distingue « câblé » de « décoratif ».
    let coeurFleurs = 0
    let coeurTouffes = 0
    let creuxFleurs = 0
    let creuxTouffes = 0
    for (let tx = 0; tx < 300; tx++) for (let ty = 0; ty < 300; ty++) {
      const force = nappeDe(TERRAIN_GRASS, tx, ty, SEED)!.force
      for (const p of clutterAt(tx, ty, TERRAIN_GRASS, SEED, pre)) {
        if (p.kind !== 'flower' && p.kind !== 'grass_tuft') continue
        if (force > NAPPES.COEUR) {
          if (p.kind === 'flower') coeurFleurs++
          else coeurTouffes++
        } else if (force < NAPPES.CREUX_BAS) {
          if (p.kind === 'flower') creuxFleurs++
          else creuxTouffes++
        }
      }
    }
    // Les deux régimes existent sur l'échantillon — sans quoi le ratio ne mesure rien.
    expect(coeurFleurs + coeurTouffes).toBeGreaterThan(200)
    expect(creuxFleurs + creuxTouffes).toBeGreaterThan(200)
    const tauxCoeur = coeurFleurs / (coeurFleurs + coeurTouffes)
    const tauxCreux = creuxFleurs / Math.max(1, creuxFleurs + creuxTouffes)
    expect(tauxCoeur).toBeGreaterThan(3 * tauxCreux)
  })
})
