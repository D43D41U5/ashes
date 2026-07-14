import { beforeAll, describe, expect, it } from 'vitest'
import { generateAlpineTerrain } from './alpinegen'
import { TERRAIN_DEEP_WATER, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER } from './balance'
import {
  carveDistanceToMain, inMainComponent, walkableComponents, walkableSpawn,
  type CarveField, type WalkableComponents,
} from './connectivity'
import { isBlockingTile, maxSouthGradient, type WorldMap } from './map'
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

/**
 * ON REND LA MAIN ENTRE DEUX CARTES — et ce n'est pas de la coquetterie.
 *
 * Générer cinq cartes de production, c'est ~45 s de calcul SYNCHRONE. Le worker
 * vitest bloque alors sa propre boucle d'événements et ne peut plus répondre au
 * battement de cœur RPC du processus principal (`onTaskUpdate`). Vitest le compte
 * comme une **erreur non gérée** : tous les tests passent, et la suite sort en
 * échec quand même. Un portail qui dit « rouge » alors que tout est vert est pire
 * qu'un portail rouge.
 *
 * Une micro-attente entre deux cartes suffit : le worker vide sa file de messages,
 * répond, et repart. Elle ne coûte rien (le travail, lui, reste synchrone).
 *
 * `setTimeout` EST DÉCLARÉ ICI, ET PAS IMPORTÉ. `/sim` est pur (invariant n°1) :
 * son `tsconfig` ne charge ni les types du DOM ni ceux de Node, précisément pour
 * qu'aucune API d'hôte ne s'y glisse par inadvertance. Ce fichier est un TEST — il
 * tourne dans un worker Node et a le droit d'y toucher — mais on ne va pas ouvrir
 * la porte de la sim entière pour une ligne. On déclare donc ce dont on a besoin,
 * localement, et la porte reste fermée.
 */
declare const setTimeout: (fn: () => void, ms: number) => unknown

const respire = (): Promise<void> => new Promise((r) => { setTimeout(() => { r() }, 0) })

beforeAll(async () => {
  for (const seed of PROD_SEEDS) {
    const map = generateAlpineTerrain(PROD.width, PROD.height, seed)
    const comp = walkableComponents(map)
    maps.set(seed, map)
    comps.set(seed, comp)
    fields.set(seed, carveDistanceToMain(map, comp, POI_PLACEMENT.MAX_CARVE_TILES))
    await respire()
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

describe('la vraie carte — le fleuve', () => {
  /**
   * CRITICAL — LE FLEUVE SÉPARE, ET LES GUÉS RECOUSENT.
   *
   * L'invariant TOPOLOGIQUE de la vallée, et le seul qui donne un sens au reste :
   * la rivière n'est pas un motif bleu, c'est une FRONTIÈRE. Cinq tuiles d'eau
   * profonde, et l'eau profonde bloque. On ne passe qu'aux gués — « le
   * franchissement est une décision », comme du temps du squelette artisanal.
   *
   * Cette garde a été écrite APRÈS coup, parce qu'il a fallu TROIS tentatives pour
   * que ce soit vrai, et qu'aucune des deux premières ne se voyait :
   *   1. le tronc mourait au milieu de la carte (on le contournait par le bout) ;
   *   2. sa source était un point INTÉRIEUR, à 96 tuiles du bord : il restait un
   *      couloir entre elle et la montagne (on le contournait par le haut) ;
   *   3. le lissage du cours par moyenne glissante tirait ses EXTRÉMITÉS vers
   *      l'intérieur — la bouche s'arrêtait sept tuiles trop haut, et il restait
   *      un couloir en bas de carte (on le contournait par le sud).
   *
   * À chaque fois, la carte était superbe, la rivière traversait à l'œil, et les
   * six gués étaient posés. Seule la MESURE l'a dit : on rebouche les gués, et on
   * regarde si la vallée se scinde. Si elle reste d'un seul tenant, le fleuve
   * n'est un obstacle pour personne et les gués sont de la décoration.
   *
   * (La moitié « les gués recousent » est déjà tenue par la garde des 99 % plus
   * haut : avec eux, la vallée est un seul monde.)
   */
  it('CRITICAL — gués rebouchés, la vallée se SCINDE en deux rives', () => {
    eachMap((map, seed) => {
      const gues = map.zones.filter((z) => z.kind === undefined && z.name.startsWith('le Gué'))
      // 6 ou 7 sur les 12 seeds mesurées — l'espacement est proportionnel au cours,
      // et le cours est long par construction (`farthestSource`). 4 laisse la marge.
      expect.soft(gues.length, `seed ${seed} : trop peu de gués (${gues.length})`).toBeGreaterThanOrEqual(4)

      // On reboue les gués — l'eau y redevient profonde, donc infranchissable.
      const barre: WorldMap = { ...map, terrain: map.terrain.slice() }
      for (const z of gues) {
        for (let ty = Math.max(0, z.y); ty < Math.min(map.height, z.y + z.h); ty++) {
          for (let tx = Math.max(0, z.x); tx < Math.min(map.width, z.x + z.w); tx++) {
            const i = ty * map.width + tx
            if (barre.terrain[i] === TERRAIN_SHALLOW_WATER) barre.terrain[i] = TERRAIN_DEEP_WATER
          }
        }
      }

      const c = walkableComponents(barre)
      const total = c.sizes.reduce((a, b) => a + b, 0)
      const rives = [...c.sizes].sort((a, b) => b - a)
      const seconde = (rives[1] ?? 0) / total

      // DEUX VRAIES RIVES, pas un coin détaché. Mesuré sur 12 seeds : la petite rive
      // pèse de 29,6 % à 48,4 % du marchable (typique : 45 %). Le seuil à 20 % laisse
      // la marge du hasard sans rien concéder sur l'intention — si un jour le fleuve
      // ne détache plus qu'un bout de 10 %, il aura cessé de structurer la vallée.
      expect
        .soft(
          seconde,
          `seed ${seed} : gués rebouchés, la vallée ne se scinde pas vraiment ` +
            `(rives : ${rives.slice(0, 3).map((s) => ((100 * s) / total).toFixed(1) + '%').join(' / ')}). ` +
            `Le fleuve ne sépare rien de conséquent — il se contourne, et les ${gues.length} gués ne servent à rien.`,
        )
        .toBeGreaterThan(0.2)
    })
  })
})

describe('la vraie carte — les sentiers', () => {
  /**
   * CRITICAL — LE SENTIER MÈNE AU GUÉ.
   *
   * C'est la garde qui donne un sens à la précédente. Le fleuve sépare la vallée en
   * deux rives et ne se franchit qu'aux gués : bonne topologie — et pure punition,
   * tant que rien ne dit OÙ SONT LES GUÉS. Le joueur voit 35×20 tuiles ; une vallée
   * de 1200×1800 fait vingt-cinq écrans de large.
   *
   * Le réseau sort d'un Dijkstra qui part du point de départ, et le fleuve n'étant
   * franchissable qu'aux gués, tout chemin d'une rive à l'autre y passe
   * NÉCESSAIREMENT. On ne code rien pour ça : la géographie s'en charge. Cette garde
   * vérifie que la géographie a bien fait son travail — qu'aucun gué n'est resté
   * orphelin, et qu'aucun lieu chargé n'est au bout d'aucun chemin.
   *
   * (Un chemin peint SEULEMENT au franchissement serait un auto-but : on ne
   * trouverait le panneau qu'une fois déjà arrivé à la porte. Ce qui compte, c'est
   * que le sentier VIENNE DE LOIN.)
   */
  /**
   * Le sentier s'arrête au SEUIL : il ne pave pas un lieu, et il ne bâtit pas de
   * pont — au gué, on patauge. On cherche donc la route au BORD de la zone, pas en
   * son centre : à un gué, le centre est au milieu du courant, et l'eau ne porte
   * jamais de route (c'est la règle qui garde au fleuve son pouvoir de séparer).
   */
  const MARGE = 8 // tuiles au-delà du bord de la zone

  function sentierProche(map: WorldMap, z: WorldMap['zones'][number]): boolean {
    const x0 = Math.max(0, z.x - MARGE)
    const y0 = Math.max(0, z.y - MARGE)
    const x1 = Math.min(map.width - 1, z.x + z.w + MARGE)
    const y1 = Math.min(map.height - 1, z.y + z.h + MARGE)
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (map.terrain[ty * map.width + tx] === TERRAIN_ROAD) return true
      }
    }
    return false
  }

  it('CRITICAL — un sentier mène à CHAQUE gué et à CHAQUE lieu chargé', () => {
    const charges = new Set(POI_TYPES.filter((t) => (t.reserve ?? 0) > 0).map((t) => t.slug))
    eachMap((map, seed) => {
      const routes = map.terrain.filter((t) => t === TERRAIN_ROAD).length
      expect.soft(routes, `seed ${seed} : aucun sentier sur la carte`).toBeGreaterThan(1000)

      for (const z of map.zones) {
        const estGue = z.kind === undefined && z.name.startsWith('le Gué')
        const estCharge = z.kind !== undefined && charges.has(z.kind)
        if (!estGue && !estCharge) continue
        expect
          .soft(
            sentierProche(map, z),
            `${z.name} (seed ${seed}, [${z.x},${z.y}]) : AUCUN sentier n'y mène. ` +
              `Le joueur devra le trouver au hasard, sur vingt-cinq écrans de vallée.`,
          )
          .toBe(true)
      }
    })
  })
})

describe('la vraie carte — le relief est RENDABLE', () => {
  /**
   * CRITICAL — LE JEU DÉMARRE, SUR TOUTE SEED.
   *
   * Le client donne du relief en soulevant chaque tuile de `elevation × RELIEF_H`
   * pixels. Si le sol descend vers le SUD plus vite que `TILE_PX / RELIEF_H` par
   * tuile, deux tuiles voisines se croisent à l'écran : l'image se replie, et le
   * client **lève une exception** (`assertNoFold`, appelé SANS garde de
   * développement — un écran blanc, pas un artefact).
   *
   * Le 2026-07-14, **quatre seeds sur seize** dépassaient ce plafond. Le jeu ne
   * démarrait pas dessus. Personne ne le voyait : le mode Veillée code la seed
   * 2026 en dur, et elle passait — de justesse (11,3 sur un budget de 16).
   *
   * Trois causes, toutes dans `/sim`, toutes corrigées :
   *   • `erodeChannels` creusait une tranchée à PAROIS VERTICALES — l'incision
   *     vaut `0,2·√(acc)/√N`, ce qui saute de 0,2 en UNE tuile entre le chenal et
   *     sa berge. Elle s'étale désormais (`EROSION_BANK_TILES`) : une vallée en V
   *     au lieu d'une entaille ;
   *   • `addReliefBumps` appliquait un domain warp de 72 tuiles d'amplitude à un
   *     motif de 24 tuiles de longueur d'onde — trois fois son échelle. Ce n'est
   *     plus tordre un motif, c'est le tirer au sort ;
   *   • le même vallon s'arrêtait NET au bord de l'eau, y laissant une marche.
   *
   * Résultat : pente sud maximale 0,153 → 0,051 au pire. Marge ×3.
   *
   * LE SEUIL EST DUPLIQUÉ ICI, ET C'EST ASSUMÉ : `/sim` ne peut pas importer les
   * constantes de rendu du client (invariant n°1 — la pureté). Si `RELIEF_H` ou
   * `TILE_PX` bougent, ce nombre doit bouger avec eux ; le commentaire est le lien.
   */
  const RELIEF_H = 150 // client : render/framing.ts
  const TILE_PX = 16 //   idem
  const BUDGET = TILE_PX / RELIEF_H // 0,10667

  it('CRITICAL — le relief ne REPLIE pas le rendu (le client refuserait de démarrer)', () => {
    eachMap((map, seed) => {
      const g = maxSouthGradient(map.elevation!, map.width, map.height)
      expect
        .soft(
          g,
          `seed ${seed} : pente sud maximale ${g.toFixed(4)} ≥ ${BUDGET.toFixed(4)}. ` +
            `Le client lèverait une exception au démarrage (assertNoFold) : ÉCRAN BLANC, pas un artefact.`,
        )
        .toBeLessThan(BUDGET)
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
