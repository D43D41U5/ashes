import { beforeAll, describe, expect, it } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import {
  carveDistanceToMain, inMainComponent, walkableComponents, walkableSpawn,
  type CarveField, type WalkableComponents,
} from './connectivity'
import { isBlockingTile, type WorldMap } from './map'
import { POI_PLACEMENT, POI_TYPES } from './poi'

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
const comps = new Map<number, WalkableComponents>()
const fields = new Map<number, CarveField>()
beforeAll(() => {
  for (const seed of PROD_SEEDS) {
    const map = generateAlpineTerrain(PROD.width, PROD.height, seed)
    const comp = walkableComponents(map)
    maps.set(seed, map)
    comps.set(seed, comp)
    fields.set(seed, carveDistanceToMain(map, comp, POI_PLACEMENT.MAX_CARVE_TILES))
  }
}, 300_000)

/** Itère les gardes sur chaque seed, avec un libellé qui dit laquelle a cassé. */
function eachMap(fn: (map: WorldMap, seed: number, comp: WalkableComponents) => void): void {
  for (const seed of PROD_SEEDS) fn(maps.get(seed)!, seed, comps.get(seed)!)
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

describe('la vraie carte — la table des lieux ne ment pas', () => {
  /**
   * CRITICAL — AUCUNE LIGNE MORTE DANS LA TABLE.
   *
   * La garde la plus rentable du fichier : elle attrape une CLASSE entière de
   * bugs, pas un cas. Un type de lieu dont aucune tuile de la vraie carte ne
   * satisfait (biome ∧ altitude ∧ accessible) ne naîtra JAMAIS, sur aucune seed.
   * Il reste pourtant dans la table, nommé, pondéré, plafonné — une promesse que
   * rien ne tient, et que rien ne signalait.
   *
   * Trois lignes étaient mortes quand cette garde a été écrite (2026-07-13), et
   * chacune pour une raison différente — d'où l'intérêt de tester la propriété,
   * pas les cas :
   *   • la FONDRIÈRE : ses biomes (tourbière, roselière) n'existaient nulle part —
   *     `BANDS.MARSH_WET` était calé au-dessus du maximum de la distribution ;
   *   • le CHAMP DE CREVASSES : 176 000 tuiles de glacier, pas une à moins de trois
   *     tuiles du monde (le glacier est muré derrière la neige et la roche) ;
   *   • le BELVÉDÈRE : `minElev` au-dessus du plafond du marchable — il ne pouvait
   *     naître que sur du bloquant.
   *
   * Le seuil est bas exprès (une tuile suffit à prouver que la ligne peut vivre) :
   * cette garde dit « ce type est POSSIBLE », pas « ce type est fréquent ». La
   * fréquence, c'est l'affaire des plafonds ; l'existence garantie, celle de
   * `reserve` — et chacune a sa propre garde.
   */
  it('CRITICAL — chaque type de lieu a des tuiles éligibles sur la vraie carte', () => {
    // Les types INDEXÉS PAR BIOME : sans ça, la garde teste 26 types sur chacune
    // des 2,16 M tuiles de chacune des 5 cartes (280 M tours — elle expirait).
    // Ici chaque tuile ne réveille que les types qui pourraient l'habiter.
    const byTerrain = new Map<number, typeof POI_TYPES>()
    for (const t of POI_TYPES) {
      for (const b of t.biomes) {
        const list = byTerrain.get(b) ?? []
        list.push(t)
        byTerrain.set(b, list)
      }
    }

    for (const seed of PROD_SEEDS) {
      const map = maps.get(seed)!
      const field = fields.get(seed)!
      const vivants = new Set<string>()
      for (let i = 0; i < map.terrain.length && vivants.size < POI_TYPES.length; i++) {
        if (field.dist[i]! > field.limit) continue // hors d'atteinte : ne compte pas
        const cands = byTerrain.get(map.terrain[i]!)
        if (cands === undefined) continue
        const el = map.elevation![i]!
        for (const t of cands) {
          if (vivants.has(t.slug)) continue // déjà prouvé possible : inutile de recompter
          if (el < (t.minElev ?? 0) || el > (t.maxElev ?? 1)) continue
          vivants.add(t.slug)
        }
      }
      for (const t of POI_TYPES) {
        expect
          .soft(
            vivants.has(t.slug),
            `${t.name} (seed ${seed}) : AUCUNE tuile de la carte ne satisfait ` +
              `biome ∈ [${t.biomes.join(',')}] ∧ altitude ∈ [${t.minElev ?? 0}, ${t.maxElev ?? 1}] ∧ accessible. ` +
              `Ce type ne naîtra jamais : la table promet un lieu que la carte ne peut pas porter.`,
          )
          .toBe(true)
      }
    }
  }, 60_000)
})

describe('la vraie carte — la connexité', () => {
  /**
   * CRITICAL — ON PEUT Y ALLER.
   *
   * La garde qui manquait, et la plus importante de ce fichier. « Marchable » et
   * « atteignable » ne sont pas le même mot : une clairière au cœur d'un massif
   * est faite de tuiles parfaitement praticables où nul ne mettra jamais les
   * pieds. La garde d'empreinte ci-dessus vérifie la première propriété et
   * passait au vert pendant que **16 lieux sur 81** (seed du jeu) étaient murés —
   * dont les 3 Grottes, l'unique Source chaude et l'unique Belvédère, c'est-à-dire
   * les trois devises de la spec `lieux.md`, mortes à 100 %.
   *
   * On mesure ce que le joueur peut faire : partir du spawn, et marcher.
   */
  it('CRITICAL — TOUT lieu est atteignable à pied depuis le point de départ', () => {
    eachMap((map, seed, comp) => {
      for (const z of map.zones) {
        if (z.kind === undefined) continue // toponyme, pas un lieu
        let joignable = false
        for (let ty = z.y; ty < z.y + z.h && !joignable; ty++) {
          for (let tx = z.x; tx < z.x + z.w; tx++) {
            if (inMainComponent(comp, map, tx, ty)) { joignable = true; break }
          }
        }
        expect
          .soft(joignable, `${z.name} (seed ${seed}, [${z.x},${z.y}) ${z.w}×${z.h}) est INATTEIGNABLE`)
          .toBe(true)
      }
    })
  })

  /**
   * Le point de départ EST dans le monde. Évident ? Il ne l'était pas : le spawn
   * se prenait « la tuile marchable la plus proche du centre », sans regarder si
   * elle communiquait avec quoi que ce soit. Une carte dont le centre tombe dans
   * un massif à poche aurait fait naître le joueur muré dans un placard.
   */
  it('CRITICAL — le point de départ appartient au monde', () => {
    eachMap((map, seed, comp) => {
      const s = walkableSpawn(map, comp)
      expect
        .soft(inMainComponent(comp, map, Math.floor(s.x), Math.floor(s.y)), `seed ${seed} : spawn hors du monde`)
        .toBe(true)
    })
  })

  /**
   * LA VALLÉE EST UN SEUL MONDE. Les poches murées existent (le bruit en fabrique
   * toujours), mais elles doivent rester une poussière : si une carte se scindait
   * en deux moitiés de taille comparable, la moitié d'un monde deviendrait
   * inaccessible en silence — les lieux qu'elle contient, sa faune, ses
   * ressources. Seuil à 99 % : mesuré à 99,99 % sur les 5 seeds (la plus grosse
   * poche fait 54 tuiles sur 1,6 million).
   */
  it('CRITICAL — au moins 99 % du marchable est d’un seul tenant', () => {
    eachMap((map, seed, comp) => {
      const total = comp.sizes.reduce((a, b) => a + b, 0)
      const monde = comp.main === -1 ? 0 : comp.sizes[comp.main]!
      expect
        .soft(
          monde / total,
          `seed ${seed} : le monde ne fait que ${((100 * monde) / total).toFixed(1)} % du marchable ` +
            `(${comp.sizes.length} composantes, la plus grosse ${monde}/${total})`,
        )
        .toBeGreaterThanOrEqual(0.99)
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
