/**
 * LES CHARNIERS — la distribution des fosses de la vallée (spec `cendreux.md` R20 ;
 * décision d'Alexis du 2026-07-31 : *« une distribution logique, mais un peu partout quand même »*).
 *
 * Ce que ces gardes affirment, dans l'ordre où ça compte :
 *   1. la loterie des lieux n'a pas bougé d'un octet (`horsSemis`) ;
 *   2. le champ MODULE et n'autorise jamais — aucune zone à zéro, chez le joueur comme aux marges ;
 *   3. et il MODULE VRAIMENT — les marges en portent trois fois plus que le pré du village.
 */
import { describe, expect, it } from 'vitest'
import { MORTS, TERRAIN_GRASS, TERRAIN_ROAD } from './balance'
import { createEmptyMap, isBlockingTile, terrainAt, zoneTierAt, type WorldMap } from './map'
import { distSq } from './geometry'
import { densiteDeBase } from './morts'
import { placeCharniers, placePois, POI_TYPES } from './poi'
import { generateZonedTerrain } from './zonegen'
import { carteDeTest } from '../../../tools/carte-cache'

/** La vallée de production — celle que le joueur ouvre en lançant une Veillée. */
const CARTE = carteDeTest(2026)
const charniersDe = (map: WorldMap) => map.zones.filter((z) => z.kind === 'charnier')
const lieuxDe = (map: WorldMap) => map.zones.filter((z) => z.kind !== undefined && z.kind !== 'charnier')

/** Une carte d'essai zonée : moitié ouest en tier 0, moitié est en tier 2. */
function carteDeuxTiers(taille = 480) {
  const map = createEmptyMap(taille, taille, TERRAIN_GRASS)
  const pas = 16
  const cols = Math.ceil(taille / pas)
  const rows = Math.ceil(taille / pas)
  map.zonePas = pas
  map.zoneDefs = [
    { slug: 'pres_bas', nom: 'les Prés Bas', tier: 0 },
    { slug: 'cendriere', nom: 'la Cendrière', tier: 2 },
  ]
  map.zoneGrid = new Array<number>(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) map.zoneGrid[j * cols + i] = i < cols / 2 ? 0 : 1
  }
  const zoneDe = (tx: number, ty: number): string | undefined => {
    if (tx < 0 || ty < 0 || tx >= taille || ty >= taille) return undefined
    return map.zoneDefs![map.zoneGrid![Math.floor(ty / pas) * cols + Math.floor(tx / pas)]!]!.slug
  }
  return { map, zoneDe }
}

describe('la loterie des lieux ne bouge pas', () => {
  it('un type `horsSemis` ne sort JAMAIS du tirage général', () => {
    // La garde doit d'abord VOIR : sans type marqué, elle passerait au vert sans rien vérifier.
    expect(POI_TYPES.filter((t) => t.horsSemis === true).length).toBeGreaterThan(0)
    const { map, zoneDe } = carteDeuxTiers()
    placePois(map, 7, zoneDe)
    expect(map.zones.filter((z) => z.kind === 'charnier')).toEqual([])
  })

  it('la passe des charniers est ADDITIVE : elle ne touche ni aux lieux, ni au terrain', () => {
    const { map, zoneDe } = carteDeuxTiers()
    placePois(map, 7, zoneDe)
    const avantZones = JSON.stringify(map.zones)
    const avantTerrain = map.terrain.slice()

    placeCharniers(map, 7, (tx, ty) => densiteDeBase(map, tx, ty), zoneDe)

    // Les lieux d'avant sont là, identiques, dans le même ordre — les charniers sont EN PLUS.
    expect(JSON.stringify(map.zones.slice(0, JSON.parse(avantZones).length))).toEqual(avantZones)
    expect(charniersDe(map).length).toBeGreaterThan(0)
    // Et aucune tuile n'a changé : un charnier ne perce pas son seuil, il se pose de plain-pied.
    // Sans cette garde, la passe aurait re-sculpté la vallée sous prétexte d'y ajouter des fosses.
    expect(map.terrain).toEqual(avantTerrain)
  })

  it('la vallée de production porte toujours ses 139 autres lieux', () => {
    // Non-régression grossière mais parlante : si `horsSemis` fuyait dans la loterie, les autres
    // types en perdraient — le tirage est à somme nulle.
    // RÉ-ÉPINGLÉ 138 → 136 → 134 (Stratigraphie, 2026-08-09) : la grille du socle devenue
    // globale re-tire la lame des lacs (dérive assumée, en-tête de `socle.ts`), puis le
    // prédicat `pres` des lieux humains (S-R14) déplace des points du semis — deux cascades
    // dans une loterie à somme nulle. Le mécanisme est intact (réservations et `capFor`
    // verts) — c'est la SORTIE qui a changé, avec l'aval de la direction.
    // RE-ÉPINGLÉ 134 → 135 (Vocabulaire du pré §2ter, 2026-08-15) : le repeint de la T0 et
    // l'héritage d'éligibilité (`poi.ts` — sans lui : 132) rebrassent la loterie et les
    // set-pieces. MESURÉ par kind (seed 2026) : verger, pierre levée et source chaude +1,
    // arche et tanière −1 — net +1, aucun type ne meurt.
    // RE-ÉPINGLÉ 135 → 133 (La couronne §2quinquies, 2026-08-16) : les set-pieces ÉLUS (plus
    // posés) déplacent leurs bbox, l'écartement du semis suit. MESURÉ par kind (seed 2026) :
    // tanière et verger −1, tout le reste identique — aucun type ne meurt.
    // RE-ÉPINGLÉ 133 → 136 (Les stèles, annales.md R8, 2026-08-21) : trois stèles HORS-SEMIS
    // se posent au bord des croisées/gués saillants — un AJOUT pur, pas un rebrassage : la
    // loterie ne bouge pas d'un tirage, les 133 lieux d'avant sont les MÊMES (gardé juste
    // en dessous, par différence de kinds).
    // RE-ÉPINGLÉ 136 → 143 (Les frontières universelles, `sol-dessine.md` R20-R24, 2026-08-27) :
    // le verdict de sol est passé au motif → à la tuile pour TOUTE la carte, donc le terrain a
    // changé partout hors Racine — et la loterie, qui lit le terrain, se rebrasse avec lui. ⚠ À
    // la différence des stèles, ce n'est PAS un ajout pur : les 133 d'avant ne sont plus les
    // mêmes, la somme nulle a rejoué. Le mécanisme est intact — A19 (`zonegen.test.ts`, « aucune
    // ligne morte ») reste vert : les 38 types naissent tous, aucun ne meurt. Les stèles passent
    // de 3 à 4 : elles se posent au bord des croisées saillantes, et la carte en offre une de plus.
    // RE-ÉPINGLÉ 143 → 145 (LA LOUVIÈRE, faune R28, 2026-08-28) : un 39e type entre dans la
    // loterie — à somme nulle, il affame donc d'autres tirages.
    // MESURÉ (seed 2026) : 5 Louvières (cap 3 × l'échelle de surface `capFor`), net +2 —
    // stèles (4) et repaires (9) inchangés, et A19 (« aucune ligne morte ») reste vert :
    // les 39 types naissent tous, aucun ne meurt.
    // RE-ÉPINGLÉ 145 → 144 (LA LOUVIÈRE EST T0 SEUL, même jour) : ses zones de vallée
    // retirées (« retire toutes mentions des autres zones que la t0 »), la Louvière ne se
    // sème plus qu'en `pres_bas` — la loterie rebrasse. MESURÉ (seed 2026) : 1 Louvière
    // (le filet de réservation), net −1 — stèles (4) et repaires (9) inchangés, les 39
    // types naissent tous. Le MONDE JOUÉ, lui, ne bouge pas : MESURÉ (T0, seed 7),
    // les lieux sont identiques au kind et à la tuile près avec l'une ou l'autre liste
    // — ses seules zones étaient déjà `pres_bas`.
    expect(lieuxDe(CARTE.map).length).toBe(144)
    expect(lieuxDe(CARTE.map).filter((z) => z.kind === 'stele').length).toBe(4)
    expect(lieuxDe(CARTE.map).filter((z) => z.kind !== 'stele').length).toBe(140)
    expect(lieuxDe(CARTE.map).filter((z) => z.kind === 'repaire').length).toBe(9)
  })
})

describe('le champ module, il n’autorise jamais', () => {
  it('CHAQUE zone de la vallée porte au moins un charnier — les Prés Bas compris', () => {
    const { map } = CARTE
    const defs = map.zoneDefs!
    const grid = map.zoneGrid!
    const pas = map.zonePas!
    const cols = Math.ceil(map.width / pas)
    const rows = Math.ceil(map.height / pas)
    const parZone = new Map<string, number>()
    for (const z of charniersDe(map)) {
      const i = Math.min(cols - 1, Math.floor((z.x + z.w / 2) / pas))
      const j = Math.min(rows - 1, Math.floor((z.y + z.h / 2) / pas))
      const slug = defs[grid[j * cols + i] ?? 0]!.slug
      parZone.set(slug, (parZone.get(slug) ?? 0) + 1)
    }
    // Toutes les zones effectivement peintes sur la carte, pas la table des définitions.
    const peintes = new Set<string>()
    for (const v of grid) peintes.add(defs[v ?? 0]!.slug)
    for (const slug of peintes) {
      expect(parZone.get(slug) ?? 0, `${slug} n’a aucun charnier`).toBeGreaterThanOrEqual(MORTS.CHARNIER_MIN_PAR_ZONE)
    }
  })

  it('le joueur en a un sous la main — pas seulement aux marges', () => {
    // C'est LA mesure qui a fait changer la règle : un tirage indépendant par point laissait les
    // Prés Bas à zéro sur cette seed exacte. « Un peu partout » veut dire « chez soi aussi ».
    const pres = charniersDe(CARTE.map).filter((z) => zoneTierAt(CARTE.map, Math.floor(z.x), Math.floor(z.y)) === 0)
    expect(pres.length).toBeGreaterThanOrEqual(3)
  })

  it('une carte SANS zones en reçoit quand même, uniformément (R17)', () => {
    const map = createEmptyMap(480, 480, TERRAIN_GRASS)
    placeCharniers(map, 11, (tx, ty) => densiteDeBase(map, tx, ty))
    expect(charniersDe(map).length).toBeGreaterThanOrEqual(MORTS.CHARNIER_MIN_PAR_ZONE)
  })
})

describe('…et il module VRAIMENT', () => {
  it('les marges en portent près de trois fois plus que le pré du village, à surface égale', () => {
    const { map } = CARTE
    const pas = map.zonePas!
    const cols = Math.ceil(map.width / pas)
    const rows = Math.ceil(map.height / pas)
    // Surface par tier, lue sur la grille de zones (une case = pas²).
    const aire = [0, 0, 0]
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tier = zoneTierAt(map, i * pas, j * pas)
        aire[tier] = (aire[tier] ?? 0) + pas * pas
      }
    }
    const compte = [0, 0, 0]
    for (const z of charniersDe(map)) {
      const tier = zoneTierAt(map, Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2))
      compte[tier] = (compte[tier] ?? 0) + 1
    }
    const densite = compte.map((n, i) => n / aire[i]!)
    // 0,25 → 0,50 → 0,75 : le rapport attendu entre les marges et chez soi est de 3.
    expect(densite[2]! / densite[0]!).toBeGreaterThan(2)
    expect(densite[1]!).toBeGreaterThan(densite[0]!)
    expect(densite[2]!).toBeGreaterThan(densite[1]!)
  })

  it('le semis pèse plus lourd que la zone : la Cendrière n’a pas TOUT', () => {
    // Une garde contre le retour de l'adressage par zone déguisé : si un jour le placement se
    // remettait à ne servir que le pire sol, ce compte s'effondrerait.
    const { map } = CARTE
    const total = charniersDe(map).length
    expect(total).toBeGreaterThan(30)
    const marges = charniersDe(map).filter((z) => zoneTierAt(map, Math.floor(z.x), Math.floor(z.y)) === 2).length
    expect(marges).toBeLessThan(total * 0.75)
  })
})

describe('le charnier est un lieu comme les autres', () => {
  it('il se pose sur un sol praticable, jamais sur une sente, jamais dans un autre lieu', () => {
    const { map } = CARTE
    const autres = lieuxDe(map)
    // Le carré de l'écart, multiplié EXPLICITEMENT : `**` (comme Math.pow) n'est pas garanti
    // au bit près d'un moteur JS à l'autre, et le lint de /sim l'interdit — jusque dans les tests.
    const ecart2 = MORTS.CHARNIER_ECART_LIEU * MORTS.CHARNIER_ECART_LIEU
    for (const z of charniersDe(map)) {
      const tx = Math.floor(z.x + z.w / 2)
      const ty = Math.floor(z.y + z.h / 2)
      expect(isBlockingTile(map, tx, ty), `${z.name} est dans le bloquant`).toBe(false)
      for (let y = z.y; y < z.y + z.h; y++) {
        for (let x = z.x; x < z.x + z.w; x++) {
          expect(terrainAt(map, x, y), `${z.name} mord une sente`).not.toBe(TERRAIN_ROAD)
        }
      }
      for (const a of autres) {
        const d2 = distSq(tx, ty, a.x + a.w / 2, a.y + a.h / 2)
        expect(d2, `${z.name} est trop près du centre de ${a.name}`).toBeGreaterThanOrEqual(ecart2)
        // ET LA PROPRIÉTÉ QUI COMPTE VRAIMENT — aucun recouvrement de RECTANGLES.
        // `tropPres` ne connaît que les CENTRES, or les set-pieces sont vastes : le Bois Noir
        // fait 48 tuiles de large, soit une demi-diagonale de 33,9 — plus que l'écart de 32.
        // Un charnier posé en diagonale à 32 tuiles de son centre tomberait donc DANS son coin,
        // et `poisAt` rendrait deux lieux pour ces tuiles : le « Cairn au milieu du Cercle de
        // pierres » que `tropPres` existe pour empêcher. Vérifié à 0 sur la seed du jeu, mais
        // par chance et non par construction — c'est donc ici que la garde doit vivre.
        const recouvre = z.x < a.x + a.w && a.x < z.x + z.w && z.y < a.y + a.h && a.y < z.y + z.h
        expect(recouvre, `${z.name} recouvre ${a.name}`).toBe(false)
      }
    }
  })

  it('même seed, mêmes charniers — au nom et à la tuile près', () => {
    const bis = generateZonedTerrain(2026)
    expect(charniersDe(bis.map)).toEqual(charniersDe(CARTE.map))
  })

  it('il porte un numéro lisible au-delà du quatorzième', () => {
    // La table figée de `roman` s'arrêtait à XIV ; les charniers la dépassent largement.
    const noms = charniersDe(CARTE.map).map((z) => z.name)
    expect(noms.length).toBeGreaterThan(14)
    for (const n of noms) expect(n, `${n} n’est pas numéroté en romain`).toMatch(/^le Charnier [IVXLCDM]+$/)
  })
})
