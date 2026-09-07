import { describe, expect, it } from 'vitest'
import { createEmptyMap, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE, type WorldMap } from '@ashes/sim'
import { deplierLeLift } from './deplier-etage'
import { creerRelief } from './relief'
import { LIFT_TUILES, TILE_PX } from './framing'

/**
 * Une mesa fabriquée à la main : un chapeau de roche 4×4 aux rangées 10..13, colonnes 4..7,
 * porté par un étage +1 sur la même empreinte, et une rampe (5, 14) juste au sud. Tout le
 * reste est de l'herbe au sol.
 */
function mesa(): WorldMap {
  const m = createEmptyMap(16, 24, TERRAIN_GRASS)
  const idx: number[] = []
  for (let y = 10; y <= 13; y++) for (let x = 4; x <= 7; x++) {
    m.terrain[y * m.width + x] = TERRAIN_ROCK
    idx.push(y * m.width + x)
  }
  idx.push(14 * m.width + 5)
  idx.sort((a, b) => a - b)
  m.etages = [{ niveau: 1, idx, terrain: idx.map(() => TERRAIN_SCREE), x0: 4, y0: 10, x1: 8, y1: 15 }]
  m.connecteurs = [{ x: 5, y: 14, de: 0, vers: 1, type: 'rampe' }]
  return m
}
const P = TILE_PX
const tuile = (m: WorldMap, tx: number, ty: number, souterrain = false) => {
  const p = deplierLeLift(creerRelief(m), (tx + 0.5) * P, (ty + 0.5) * P, souterrain)
  return { tx: Math.floor(p.x / P), ty: Math.floor(p.y / P) }
}

describe('deplierLeLift — le curseur vise ce qu’on VOIT, à travers le lift de l’étage', () => {
  it('le lift vaut deux tuiles : c’est la prémisse du défaut', () => {
    expect(LIFT_TUILES).toBe(2)
  })

  it('sur le plateau, la rangée d’écran ty désigne la tuile ty + LIFT du plateau', () => {
    const m = mesa()
    // La pierre de la tuile (5, 12) se dessine à la rangée 10 : c’est là qu’on la vise.
    expect(tuile(m, 5, 10)).toEqual({ tx: 5, ty: 12 })
    // Le haut du plateau (rangée 10) se dessine à la rangée 8, sur le vrai sol du nord.
    expect(tuile(m, 5, 8)).toEqual({ tx: 5, ty: 10 })
    // Et X ne bouge pas.
    expect(deplierLeLift(creerRelief(m), 5 * P + 3, 10 * P + 7).x).toBe(5 * P + 3)
  })

  it('hors de la mesa, le sol plat reste le sol plat', () => {
    const m = mesa()
    expect(tuile(m, 1, 10)).toEqual({ tx: 1, ty: 10 })
    expect(tuile(m, 5, 20)).toEqual({ tx: 5, ty: 20 })
    // Deux rangées au sud du plateau : ty + LIFT sort de l’empreinte → sol.
    expect(tuile(m, 6, 16)).toEqual({ tx: 6, ty: 16 })
  })

  it('la rampe : ses trois rangées d’écran sont la rampe', () => {
    const m = mesa()
    expect(tuile(m, 5, 12)).toEqual({ tx: 5, ty: 14 }) // le haut de l’entaille (règle 1)
    expect(tuile(m, 5, 13)).toEqual({ tx: 5, ty: 14 }) // la rangée du milieu (règle 2)
    expect(tuile(m, 5, 14)).toEqual({ tx: 5, ty: 14 }) // le tablier, au sol
  })

  it('la paroi sud (rangées 12-13 à l’écran, hors colonne de rampe) retombe sur la roche du sol', () => {
    const m = mesa()
    expect(tuile(m, 6, 13)).toEqual({ tx: 6, ty: 13 })
  })

  it('sous terre, rien ne se déplie ; sans étages non plus', () => {
    const m = mesa()
    expect(tuile(m, 5, 10, true)).toEqual({ tx: 5, ty: 10 })
    expect(tuile(createEmptyMap(16, 24, TERRAIN_GRASS), 5, 10)).toEqual({ tx: 5, ty: 10 })
  })
})

/**
 * Une terrasse fabriquée à la main (spec `terrasses.md`) : les rangées 0..9 au palier 1, le
 * reste au palier 0, et une rampe (5, 10) — la tuile BASSE du connecteur, au pied de la paroi.
 */
function terrasse(): WorldMap {
  const m = createEmptyMap(16, 24, TERRAIN_GRASS)
  m.palier = Array.from({ length: m.width * m.height }, (_, i) => (Math.floor(i / m.width) < 10 ? 1 : 0))
  m.connecteurs = [{ x: 5, y: 10, de: 0, vers: 1, type: 'rampe' }]
  return m
}

describe('deplierLeLift — les terrasses lèvent le sol lui-même', () => {
  it('le palier 1 se dessine LIFT rangées plus haut : la rangée d’écran vise ty + LIFT', () => {
    const m = terrasse()
    expect(tuile(m, 5, 3)).toEqual({ tx: 5, ty: 5 })
    expect(tuile(m, 5, 7)).toEqual({ tx: 5, ty: 9 }) // la dernière rangée haute
  })

  it('le palier 0 ne bouge pas', () => {
    const m = terrasse()
    expect(tuile(m, 5, 12)).toEqual({ tx: 5, ty: 12 })
    expect(tuile(m, 1, 20)).toEqual({ tx: 1, ty: 20 })
  })

  it('la rampe : ses rangées d’écran (8, 9, 10) sont la rampe, au palier bas', () => {
    const m = terrasse()
    expect(tuile(m, 5, 8)).toEqual({ tx: 5, ty: 10 })
    expect(tuile(m, 5, 9)).toEqual({ tx: 5, ty: 10 })
    expect(tuile(m, 5, 10)).toEqual({ tx: 5, ty: 10 })
  })

  it('la paroi (rangées d’écran 8-9 hors rampe) désigne la tuile du sol qu’elle cache', () => {
    // Le coût des terrasses (T-R8) : les deux rangées du haut palier sous la paroi sont
    // invisibles — un clic sur la paroi tombe sur elles, le dépliage ne les invente pas.
    const m = terrasse()
    expect(tuile(m, 6, 8)).toEqual({ tx: 6, ty: 8 })
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * LA GUEULE D'UNE GROTTE — l'arche est peinte SUR LA PAROI, au-dessus du seuil qu'on foule
 *
 * *(Alexis, 2026-09-06 : « l'entrée d'une grotte sort d'une case par rapport au sprite de
 * l'entrée, ce qui donne des murs invisibles quand on est dehors ».)*
 *
 * `poserLaGueule` pose l'image de 32×48 à `ty − palier × LIFT − LIFT` et `PROFIL` (`cave-art.ts`)
 * n'ouvre RIEN sur sa troisième rangée : tout le noir vit donc sur les `LIFT` rangées d'écran
 * AU-DESSUS du seuil. Viser ce noir tombait sur le monde plat — dans la masse.
 *
 * ⚠ **CE QUI FERAIT ROUGIR** : retirer la branche `gueule` de `deplierLeLift` doit faire rougir
 * « l'arche » aux DEUX paliers (les rangées rendraient leur propre rangée). Et remplacer le test
 * `c.de === bas` par un `Math.min(c.de, c.vers) === bas` (la règle de la rampe, dont `vers` est
 * négatif ici) doit le faire rougir aussi : la garde tient les deux bords.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
const LIGNE = 12
const GX = 10

/** Le karst de laboratoire : la terrasse `p + 1` au nord de `LIGNE`, le sol `p` au sud, une salle
 *  de niveau `−(p + 1)` sous la masse, et la PAIRE de connecteurs `gueule` sur la rangée `LIGNE`. */
function karst(p: number): WorldMap {
  const N = 24
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

describe('deplierLeLift — viser une gueule de grotte depuis le dehors', () => {
  for (const p of [0, 1]) {
    const yl = LIGNE - p * LIFT_TUILES // la rangée d’écran du SEUIL

    it(`palier ${p} : les deux rangées de l’arche désignent le seuil, pas la masse`, () => {
      const m = karst(p)
      for (const x of [GX, GX + 1]) {
        expect(tuile(m, x, yl - 2), `haut de l’arche, colonne ${x}`).toEqual({ tx: x, ty: LIGNE })
        expect(tuile(m, x, yl - 1), `bas de l’arche, colonne ${x}`).toEqual({ tx: x, ty: LIGNE })
      }
    })

    it(`palier ${p} : le seuil et le dehors ne bougent pas`, () => {
      const m = karst(p)
      expect(tuile(m, GX, yl), 'la rangée du seuil').toEqual({ tx: GX, ty: LIGNE })
      expect(tuile(m, GX, yl + 1), 'une rangée au sud').toEqual({ tx: GX, ty: LIGNE + 1 })
      expect(tuile(m, GX, yl + 3), 'trois rangées au sud').toEqual({ tx: GX, ty: LIGNE + 3 })
    })

    it(`palier ${p} : hors de la paire, la paroi reste la paroi`, () => {
      // Le flanc (`cv-flanc`) n’est qu’un encadrement : la colonne voisine n’a pas de connecteur,
      // et sa rangée d’écran retombe sur la tuile que la paroi cache (T-R8, comme partout).
      const m = karst(p)
      for (const x of [GX - 1, GX + 2]) {
        expect(tuile(m, x, yl - 1), `colonne ${x}`).toEqual({ tx: x, ty: yl - 1 })
      }
    })
  }

  it('la gueule ne vole pas les rangées d’une rampe voisine', () => {
    // `de` d’une gueule est son palier et `vers` le niveau de sa salle (négatif) ; celui d’une
    // rampe encadre deux paliers. Les deux branches se lisent sur des champs différents.
    const m = karst(0)
    m.connecteurs = [...m.connecteurs!, { x: GX + 5, y: LIGNE, de: 0, vers: 1, type: 'rampe' }]
    expect(tuile(m, GX + 5, LIGNE - 2), 'le haut de l’entaille de la rampe').toEqual({ tx: GX + 5, ty: LIGNE })
    expect(tuile(m, GX + 5, LIGNE - 1), 'la rangée du milieu').toEqual({ tx: GX + 5, ty: LIGNE })
  })
})
