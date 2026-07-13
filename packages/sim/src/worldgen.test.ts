import { beforeAll, describe, expect, it } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { isBlockingTile, type WorldMap } from './map'
import { POI_TYPES } from './poi'

/**
 * LES GARDES SUR LA VRAIE CARTE — celles qui n'ont de sens qu'à la taille de
 * production, et sur plusieurs seeds.
 *
 * POURQUOI UN FICHIER À PART. Le projet a trois fois de suite livré une
 * mécanique MORTE que la suite headless voyait verte (journal, 2026-07-11 :
 * « trois mécaniques mortes, toutes trouvées EN PILOTANT LE JEU »). La cause
 * est toujours la même : **les tests posaient leurs propres petites cartes**.
 * Le Belvédère révélait dans un rayon de 40 tuiles là où le semis en espace 96
 * — invisible sur une carte de test où les lieux sont à dix tuiles l'un de
 * l'autre. Les constantes de gameplay sont ABSOLUES (un rayon en tuiles), le
 * semis est RELATIF (une fraction de la carte) : les deux ne se rencontrent
 * qu'à l'échelle réelle. Ces gardes tournent donc sur 1200×1800, point.
 *
 * ET POURQUOI ELLES SONT TOUTES ICI. Une carte de production coûte ~8,5 s.
 * Éparpillées dans plusieurs fichiers, ces gardes la regénéraient chacune de
 * leur côté (vitest isole les fichiers dans des workers distincts : rien ne se
 * partage entre eux). Elles vivent donc ensemble, au-dessus d'UNE fixture, et
 * chaque nouvel invariant du monde vient s'ajouter ici plutôt que de payer une
 * seconde fois le prix des cartes.
 *
 * PRÉCÉDENT À NE PAS RÉPÉTER : ces gardes ont été écrites le 2026-07-11 dans
 * `poi.test.ts` avec un `beforeAll` de 60 s — insuffisant pour cinq cartes.
 * Le hook expirait, vitest SKIPPAIT les tests, et la suite affichait « 1
 * failed » que personne ne reliait aux gardes. **Elles n'ont jamais tourné.**
 * D'où le budget large ci-dessous : le coût est réel, il s'assume.
 */
const PROD = { width: 1200, height: 1800 } // les dimensions que boote le worker Veillée
const PROD_SEEDS = [2026, 99, 2718, 31415, 7] // 2026 = la seed du jeu

const maps = new Map<number, WorldMap>()
beforeAll(() => {
  for (const seed of PROD_SEEDS) maps.set(seed, generateAlpineTerrain(PROD.width, PROD.height, seed))
}, 300_000)

/** Itère les gardes sur chaque seed, avec un libellé qui dit laquelle a cassé. */
function eachMap(fn: (map: WorldMap, seed: number) => void): void {
  for (const seed of PROD_SEEDS) fn(maps.get(seed)!, seed)
}

describe('la vraie carte — les lieux', () => {
  /**
   * CRITICAL — LA RÉSERVATION (décision d'Alexis, 2026-07-11).
   *
   * Onze lieux portent une CHARGE de gameplay (savoir, répit, récit — spec
   * `docs/specs/lieux.md`). Un lieu dont une mécanique dépend ne peut pas se
   * permettre de ne pas exister : sans réservation, le Belvédère sortait ZÉRO
   * fois sur la seed du jeu (il avait pourtant dix points de semis éligibles —
   * il perdait simplement la loterie face au Cairn, poids 12), et la devise
   * « savoir » se réduisait au seul Cairn.
   *
   * On ne peut PAS lire `POI_CHARGES` ici (cycle d'import poi ↔ poi-discovery) :
   * on s'appuie sur `reserve`, le champ qui PORTE la garantie dans la table.
   */
  it('CRITICAL — tout lieu à `reserve` existe sur CHAQUE carte', () => {
    const reserves = POI_TYPES.filter((t) => (t.reserve ?? 0) > 0)
    expect(reserves).toHaveLength(11) // les onze lieux chargés — si ça change, relire la spec

    eachMap((map, seed) => {
      for (const t of reserves) {
        const n = map.zones.filter((z) => z.kind === t.slug).length
        expect
          .soft(n, `${t.name} (seed ${seed}) : réservé à ${t.reserve}, posé ${n} fois`)
          .toBeGreaterThanOrEqual(Math.min(t.reserve!, t.cap))
      }
    })
  })

  /**
   * CRITICAL (revue « les lieux », constat 1) : un lieu qu'on ne peut pas
   * fouler est une mécanique morte — `advancePois` et `isSheltered` testent
   * tous deux `poisAt`, qui ne regarde QUE l'empreinte de la Zone (jamais un
   * anneau de secours). `placePois` validait le biome au CENTRE du point sans
   * vérifier que l'empreinte contenait une tuile marchable — or plusieurs
   * biomes de la table (ROCK, GLACIER…) sont massivement bloquants.
   *
   * ATTENTION : « marchable dans l'empreinte » n'est PAS « atteignable ». Voir
   * la garde d'atteignabilité plus bas — elles se ressemblent et ne disent pas
   * du tout la même chose.
   */
  it('CRITICAL — toute zone-POI a au moins une tuile marchable dans son empreinte', () => {
    eachMap((map, seed) => {
      for (const z of map.zones) {
        if (z.kind === undefined) continue // toponyme, pas un POI
        let walkable = false
        for (let ty = z.y; ty < z.y + z.h && !walkable; ty++) {
          for (let tx = z.x; tx < z.x + z.w; tx++) {
            if (!isBlockingTile(map, tx, ty)) { walkable = true; break }
          }
        }
        expect
          .soft(walkable, `${z.name} (seed ${seed}, [${z.x},${z.y}) ${z.w}×${z.h}) n'a AUCUNE tuile marchable`)
          .toBe(true)
      }
    })
  })
})

describe('la vraie carte — l’enceinte', () => {
  /**
   * CRITICAL (revue « le lieu creuse son propre sol ») : l'invariant que ce
   * correctif met le plus en danger. `sealBorderRing` rend bloquante une tuile
   * d'épaisseur sur tout le pourtour pour SCELLER la vallée ; `placePois` (qui
   * peut désormais réécrire du terrain pour creuser un lieu) tourne juste
   * après. Une seule tuile percée sur cet anneau ouvrirait le monde.
   */
  it("CRITICAL — l'anneau de bordure reste intégralement bloquant après toutes les passes", () => {
    eachMap((map, seed) => {
      for (let x = 0; x < map.width; x++) {
        expect.soft(isBlockingTile(map, x, 0), `(${x},0) seed ${seed} n'est plus bloquant`).toBe(true)
        expect
          .soft(isBlockingTile(map, x, map.height - 1), `(${x},${map.height - 1}) seed ${seed} n'est plus bloquant`)
          .toBe(true)
      }
      for (let y = 0; y < map.height; y++) {
        expect.soft(isBlockingTile(map, 0, y), `(0,${y}) seed ${seed} n'est plus bloquant`).toBe(true)
        expect
          .soft(isBlockingTile(map, map.width - 1, y), `(${map.width - 1},${y}) seed ${seed} n'est plus bloquant`)
          .toBe(true)
      }
    })
  })
})
