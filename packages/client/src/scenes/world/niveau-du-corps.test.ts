/**
 * ═══ LE SEUIL D'UNE GUEULE NE FAIT PAS SAUTER LE CORPS D'UN ÉTAGE ═══
 *
 * *(Alexis, 2026-09-06 : « mon personnage fait un saut d'un étage lorsque je rentre dans une
 * grotte, ça dure quelques frames ».)*
 *
 * Le client dessine à la position PRÉDITE avec l'étage de l'AUTORITÉ (`etageJoueur` n'est posé
 * qu'à la réconciliation) : pendant quelques images, la prédiction a franchi le seuil et le
 * snapshot dit encore « dehors ». C'est CET état-là qu'on éprouve — `etageAutorite` figé au
 * palier, la position déjà dans la salle.
 *
 * ⚠ **CE QUI FERAIT ROUGIR, énoncé AVANT d'accepter le vert** : retirer la garde `niveauDeSalle`
 * de `niveau-du-corps.ts` (le repli rend alors `relief.hauteur`, le TOIT de la masse) doit faire
 * rougir « le seuil franchi ». Et remplacer cette garde par un `return salle` inconditionnel doit
 * faire rougir « la mesa sans salle » et « la tuile de la gueule » — sans quoi la garde ne mesure
 * qu'un seul de ses deux bords. (MESURÉ dans le monde joué avant correctif : sur les six grottes
 * les plus proches du spawn, aux trois rangées derrière le seuil, 32 px d'écart — un étage.)
 */
import { describe, expect, it } from 'vitest'
import { createEmptyMap, TERRAIN_GRASS, TERRAIN_ROCK, type Connecteur, type EtageCreux, type WorldMap } from '@ashes/sim'
import { creerRelief } from '../../render/relief'
import { niveauDuCorpsDessine } from './niveau-du-corps'

/* ═══════════════════════════════════════════════════════════════════════════════════
 * LE KARST DE LABORATOIRE — la forme des vraies grottes, en petit
 *
 * Deux terrasses : le sol au palier `p` au sud de `LIGNE`, la masse au palier `p + 1` au nord.
 * Une salle de niveau `−(p + 1)` creusée SOUS la masse (G-R1), sa gueule sur la rangée `LIGNE`,
 * deux tuiles de large (`poserLeKarst` : la paire de connecteurs, ouest d'abord).
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const N = 24
const LIGNE = 12
const GX = 10 // la tuile ouest de la gueule

function karstDeLabo(p: number): WorldMap {
  const map = createEmptyMap(N, N, TERRAIN_GRASS)
  const niveau = -(p + 1)
  map.palier = new Array<number>(N * N).fill(p)
  const tuiles: number[] = []
  for (let y = LIGNE; y >= LIGNE - 4; y--) {
    for (let x = GX; x <= GX + 1; x++) {
      if (y < LIGNE) map.terrain[y * N + x] = TERRAIN_ROCK // la masse reste de la roche AU SOL
      tuiles.push(y * N + x)
    }
  }
  for (let y = 0; y < LIGNE; y++) {
    for (let x = 0; x < N; x++) {
      map.palier[y * N + x] = p + 1 // la terrasse du dessus, gueule comprise (elle est du sol bas)
      if (x < GX || x > GX + 1) map.terrain[y * N + x] = TERRAIN_ROCK
    }
  }
  for (const x of [GX, GX + 1]) map.palier[LIGNE * N + x] = p
  tuiles.sort((a, b) => a - b)
  const salle: EtageCreux = {
    niveau, idx: tuiles, terrain: tuiles.map(() => TERRAIN_GRASS),
    x0: GX, y0: LIGNE - 4, x1: GX + 2, y1: LIGNE + 1,
  }
  map.etages = [salle]
  const gueule: Connecteur[] = [GX, GX + 1].map((x) => ({ x, y: LIGNE, de: p, vers: niveau, type: 'gueule' }))
  map.connecteurs = gueule
  return map
}

/** Le niveau DESSINÉ au centre de cette tuile, l'autorité figée à `etageAutorite`. */
function niveauA(map: WorldMap, tx: number, ty: number, etageAutorite: number): number {
  return niveauDuCorpsDessine(map, creerRelief(map), tx + 0.5, ty + 0.5, etageAutorite)
}

describe('le niveau où le corps se dessine — le seuil d’une gueule', () => {
  for (const p of [0, 1]) {
    const salle = -(p + 1)

    it(`palier ${p} : dehors, le corps reste au palier`, () => {
      const map = karstDeLabo(p)
      expect(niveauA(map, GX, LIGNE + 2, p), 'deux tuiles au sud du seuil').toBe(p)
      expect(niveauA(map, GX, LIGNE + 1, p), 'juste devant le seuil').toBe(p)
    })

    it(`palier ${p} : la tuile de la gueule est encore le dehors`, () => {
      // Elle porte la salle ET le sol du palier : c'est de LÀ qu'on franchit le seuil. Basculer
      // ici ferait passer le regard sous la roche une tuile trop tôt.
      const map = karstDeLabo(p)
      expect(niveauA(map, GX, LIGNE, p), 'la tuile ouest de la paire').toBe(p)
      expect(niveauA(map, GX + 1, LIGNE, p), 'la tuile est de la paire').toBe(p)
    })

    it(`palier ${p} : le seuil franchi, l’autorité en retard — la SALLE, pas le toit`, () => {
      const map = karstDeLabo(p)
      for (let d = 1; d <= 4; d++) {
        // `p` : l'étage que le snapshot annonce encore pendant les quelques images de retard.
        expect(niveauA(map, GX, LIGNE - d, p), `${d} rangée(s) derrière le seuil`).toBe(salle)
        expect(niveauA(map, GX + 1, LIGNE - d, p), `${d} rangée(s), tuile est`).toBe(salle)
      }
    })

    it(`palier ${p} : l’autorité rattrape — et rien ne bouge`, () => {
      const map = karstDeLabo(p)
      for (let d = 1; d <= 4; d++) {
        expect(niveauA(map, GX, LIGNE - d, salle), `${d} rangée(s), autorité rentrée`).toBe(salle)
      }
    })

    it(`palier ${p} : la masse SANS salle porte toujours son toit`, () => {
      // Le repli d'avant la garde reste la règle partout ailleurs : une colonne de la terrasse
      // haute où rien n'est creusé dessine le corps sur le toit, comme le chapeau d'une mesa.
      const map = karstDeLabo(p)
      expect(niveauA(map, GX + 6, LIGNE - 2, p), 'six colonnes à l’est de la gueule').toBe(p + 1)
    })
  }

  it('une salle de plain-pied avec le corps ne l’enfonce pas', () => {
    // Le second bord de la garde : la salle ne porte le corps que si la surface est PLUS HAUTE
    // que lui. Une tuile de roche au MÊME palier — le corps la longe du dehors — garde son toit,
    // et donc sa strate de surface : sans quoi le regard passerait sous la roche à côté d'elle.
    const map = karstDeLabo(1)
    map.palier![(LIGNE - 2) * N + GX] = 1 // la masse redescend au palier du corps
    expect(niveauA(map, GX, LIGNE - 2, 1), 'roche de plain-pied, salle dessous').toBe(1)
  })

  it('la salle d’un autre palier ne porte personne', () => {
    // La garde exige `−salle − 1 === etageAutorite` : une salle qui s'ouvre sur un AUTRE palier
    // que celui du corps ne le porte pas — c'est la géométrie de G-R1, pas « une salle quelconque ».
    const map = karstDeLabo(1) // salle −2, qui s'ouvre sur le palier 1
    expect(niveauA(map, GX, LIGNE - 2, 0), 'le corps se dit au palier 0').toBe(2)
  })
})
