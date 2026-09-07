/**
 * ═══ L'ACCESSEUR D'ÉTAGE DU RENDU — et la PRÉMISSE dont il vit ═══
 *
 * `strateDessineeA` ne regarde jamais le TYPE d'un connecteur : elle regarde le palier de sa
 * tuile (`palierDAcces`). Toute la loi tient à ce que ce palier soit bien celui d'où l'on
 * atteint le connecteur — `min(de, vers)` au pied d'une rampe, `de` au seuil d'une gueule.
 * **C'est une prémisse, donc elle s'affirme** (leçon « une garde prouve sa prémisse ») : si le
 * worldgen posait un jour une rampe sur sa tuile HAUTE, la loi rendrait la mauvaise strate en
 * silence, et c'est ce test-ci qui doit rougir en premier.
 *
 * ⚠ **CE QUI FERAIT ROUGIR, énoncé AVANT d'accepter le vert** : rendre `palierDAcces` égal à
 * `c.de` doit faire rougir la rampe descendante ; le rendre égal à `Math.min(c.de, c.vers)` doit
 * faire rougir la gueule. Et faire de `strateDessineeA` un `return { ty: ligne, etage: 0 }` doit
 * faire rougir le chapeau, la rampe ET la gueule — les trois règles, pas une seule.
 */
import { describe, expect, it } from 'vitest'
import {
  createEmptyMap, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE,
  type Connecteur, type WorldMap,
} from '@ashes/sim'
import { LIFT_TUILES } from './framing'
import { creerRelief } from './relief'
import { palierDAcces, strateDessineeA } from './strates'

const N = 24
const LIGNE = 12
const GX = 10

/** Une terrasse : le palier `p + 1` au nord de `LIGNE`, le palier `p` au sud, et une RAMPE posée
 *  sur sa tuile basse (au pied de la paroi, comme le worldgen la pose). */
function terrasse(p: number): WorldMap {
  const m = createEmptyMap(N, N, TERRAIN_GRASS)
  m.palier = Array.from({ length: N * N }, (_, i) => (Math.floor(i / N) < LIGNE ? p + 1 : p))
  m.connecteurs = [{ x: GX, y: LIGNE, de: p, vers: p + 1, type: 'rampe' }]
  return m
}

/** Un karst : la même terrasse, plus une salle de niveau `−(p + 1)` sous la masse et la PAIRE de
 *  connecteurs `gueule` qui l'ouvre sur le palier `p` (G-R1). */
function karst(p: number): WorldMap {
  const m = createEmptyMap(N, N, TERRAIN_GRASS)
  const niveau = -(p + 1)
  m.palier = new Array<number>(N * N).fill(p)
  const idx: number[] = []
  for (let y = LIGNE; y >= LIGNE - 4; y--) for (let x = GX; x <= GX + 1; x++) {
    if (y < LIGNE) m.terrain[y * N + x] = TERRAIN_ROCK
    idx.push(y * N + x)
  }
  for (let y = 0; y < LIGNE; y++) for (let x = 0; x < N; x++) {
    m.palier[y * N + x] = p + 1
    if (x < GX || x > GX + 1) m.terrain[y * N + x] = TERRAIN_ROCK
  }
  idx.sort((a, b) => a - b)
  m.etages = [{ niveau, idx, terrain: idx.map(() => TERRAIN_SCREE), x0: GX, y0: LIGNE - 4, x1: GX + 2, y1: LIGNE + 1 }]
  m.connecteurs = [GX, GX + 1].map((x) => ({ x, y: LIGNE, de: p, vers: niveau, type: 'gueule' as const }))
  return m
}

describe('palierDAcces — le palier d’où l’on atteint un connecteur, jamais son type', () => {
  for (const p of [0, 1]) {
    it(`palier ${p} : une rampe s’atteint par son BAS — min(de, vers)`, () => {
      const m = terrasse(p)
      const c = m.connecteurs![0]!
      expect(palierDAcces(creerRelief(m), c)).toBe(Math.min(c.de, c.vers))
    })

    it(`palier ${p} : une rampe DESCENDANTE se lit pareil (de et vers échangés)`, () => {
      // La même rampe, écrite dans l'autre sens : le worldgen n'a pas à garantir un ordre.
      const m = terrasse(p)
      const c = m.connecteurs![0]!
      m.connecteurs = [{ ...c, de: c.vers, vers: c.de }]
      expect(palierDAcces(creerRelief(m), m.connecteurs[0]!)).toBe(Math.min(c.de, c.vers))
    })

    it(`palier ${p} : une gueule s’atteint par son SEUIL — de, et non le min`, () => {
      const m = karst(p)
      const relief = creerRelief(m)
      for (const c of m.connecteurs!) {
        expect(palierDAcces(relief, c), `gueule (${c.x},${c.y})`).toBe(c.de)
        expect(palierDAcces(relief, c), 'et surtout PAS le min : la salle est en négatif')
          .not.toBe(Math.min(c.de, c.vers))
      }
    })
  }

  it('un type inconnu de la loi se lit comme les autres — l’escalier déclaré, jamais construit', () => {
    // `Connecteur.type` déclare `'escalier'` et rien ne le construit encore. Le jour où il
    // naîtra, la loi doit le porter SANS être touchée : c'est tout l'objet de `palierDAcces`.
    const m = terrasse(1)
    const escalier: Connecteur = { x: GX, y: LIGNE, de: 1, vers: 2, type: 'escalier' }
    m.connecteurs = [escalier]
    const relief = creerRelief(m)
    expect(palierDAcces(relief, escalier)).toBe(1)
    // Et ses rangées levées se dévoilent comme celles d'une rampe, sans une ligne de plus.
    const yl = LIGNE - 1 * LIFT_TUILES
    expect(strateDessineeA(relief, GX, yl - 1)).toEqual({ ty: LIGNE, etage: 1 })
  })
})

describe('strateDessineeA — quelle carte se dessine à cette rangée d’écran', () => {
  for (const p of [0, 1]) {
    const yl = LIGNE - p * LIFT_TUILES

    it(`palier ${p} : les rangées levées d’une rampe SONT la rampe, à son palier bas`, () => {
      const relief = creerRelief(terrasse(p))
      for (let d = 1; d <= LIFT_TUILES; d++) {
        expect(strateDessineeA(relief, GX, yl - d), `${d} rangée(s) au-dessus du pied`)
          .toEqual({ ty: LIGNE, etage: p })
      }
      expect(strateDessineeA(relief, GX, yl), 'le tablier, au sol').toEqual({ ty: LIGNE, etage: p })
    })

    it(`palier ${p} : les rangées de l’arche d’une gueule SONT le seuil`, () => {
      const relief = creerRelief(karst(p))
      for (const x of [GX, GX + 1]) for (let d = 1; d <= LIFT_TUILES; d++) {
        expect(strateDessineeA(relief, x, yl - d), `colonne ${x}, ${d} rangée(s) au-dessus`)
          .toEqual({ ty: LIGNE, etage: p })
      }
    })

    it(`palier ${p} : hors connecteur, la paroi désigne la tuile qu’elle cache`, () => {
      // Le coût des terrasses (T-R8) : les rangées du haut palier sous la paroi sont invisibles,
      // et le dépliage ne les invente pas. C'est le témoin de la règle 3.
      const relief = creerRelief(terrasse(p))
      const r = strateDessineeA(relief, GX + 4, yl - 1)
      expect(r.ty, 'la rangée reste la sienne').toBe(yl - 1)
    })

    it(`palier ${p} : au nord, le chapeau du palier haut se lit à sa hauteur`, () => {
      // La règle 1, et elle doit passer AVANT la règle 2 : la rangée d'écran d'un dessus de
      // terrasse n'est pas volée par le connecteur qui se dresse en dessous.
      const relief = creerRelief(terrasse(p))
      const haut = p + 1
      expect(strateDessineeA(relief, GX, LIGNE - 3 - haut * LIFT_TUILES))
        .toEqual({ ty: LIGNE - 3, etage: haut })
    })
  }

  it('sans relief, rien ne se déplie et tout est à l’étage 0', () => {
    const relief = creerRelief(createEmptyMap(N, N, TERRAIN_GRASS))
    expect(strateDessineeA(relief, 5, 7)).toEqual({ ty: 7, etage: 0 })
  })
})
