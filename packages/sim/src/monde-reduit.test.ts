/**
 * LES GARDES DU MONDE RÉDUIT — spec `worldgen.md` §7bis (décision d'Alexis, 2026-08-18 :
 * « on ne garde que le t0 pour l'instant »).
 *
 * Le monde joué devient racine + Cendrière ; le graphe complet DORT derrière le plan `'vallee'`,
 * gardé par toutes les gardes existantes (elles appellent la génération SANS option — le chemin
 * complet reste leur objet). Ici on prouve trois choses, et rien d'autre :
 *
 *   A-MR1 — le monde réduit TIENT : deux zones, deux seuils, des sentes, des gués, un front armé,
 *           des villages et des spawns dans la racine — la boucle de saison entière a ses organes.
 *   A-MR2 — le T0 réduit est LE MÊME T0 : géométrie absolue (w×h des rects) identique à celle de
 *           la vallée complète — la calibration (espacement des villages, semis, rivière) survit.
 *   A-MR3 — le plan réduit est DÉTERMINISTE, au bit près, comme l'autre (A12).
 *   A-MR4 — le banc joue LE MONDE JOUÉ : `construireMondeDuBanc` porte `MONDE_JOUE`, pas un choix
 *           local — un banc qui calibrerait la vallée entière mesurerait un jeu que personne ne joue.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_ROAD, TERRAINS } from './balance'
import { placeHuntingGrounds } from './faune'
import { nidsAMonstre } from './poi'
import { BANC_JOUEURS, construireMondeDuBanc } from './scenario'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { generateZonedTerrain } from './zonegen'
import { deriveGrapheZones, MONDE, MONDE_JOUE, tailleCarte } from './zonegraph'

/** Les graines de production des autres gardes — le monde qu'on jouera vraiment. */
const SEEDS = [2026, 7]

const reduits = SEEDS.map((s) => ({ s, c: generateZonedTerrain(s, MONDE.JOUEURS_CIBLE, 'racine') }))

describe('A-MR1 — le monde réduit tient : la boucle de saison a tous ses organes', () => {
  it('UNE zone exactement — les Prés Bas seuls (2026-08-24), et la carte est COUPÉE au nord', () => {
    for (const { s, c } of reduits) {
      const slugs = c.graphe.zones.map((z) => z.def.slug).sort()
      expect(slugs, `seed ${s}`).toEqual(['pres_bas'])
      expect(c.graphe.monde, `seed ${s}`).toBe('racine')
      expect(c.graphe.zones[c.graphe.racine]!.def.slug, `seed ${s}`).toBe('pres_bas')
      // La carte rétrécit VRAIMENT (sinon on paie 78 % de roche morte en mémoire et en sauvegarde).
      const pleine = tailleCarte(MONDE.JOUEURS_CIBLE)
      expect(c.map.width, `seed ${s}`).toBe(pleine.width)
      expect(c.map.height, `seed ${s}`).toBeLessThan(pleine.height * 0.5)
    }
  })

  // ⚠ CONSTAT, PAS PROMESSE (2026-08-24) : à une seule zone il n'y a plus de frontière, donc plus
  //   AUCUN seuil — et sans seuil, plus de sente ni de route entre zones. Ce que ça prive (convoi,
  //   réfugié, poste d'Arche) est écrit dans `docs/decisions.md` et attend la nouvelle mécanique.
  //   La garde reste ARMÉE pour que le jour où une seconde zone revient, elle le dise.
  it("aucun seuil — le monde joué n'a plus de frontière", () => {
    for (const { s, c } of reduits) {
      expect((c.map.seuils ?? []).length, `seed ${s}`).toBe(0)
    }
  })

  // ⚠ CE QUI EST TOMBÉ AVEC LA CENDRIÈRE (2026-08-24), et il faut le regarder en face : les
  //   sentes se tracent ENTRE LES SEUILS (`zonegen-sentes`, `for (const s of g.seuils)`). À une
  //   seule zone il n'y a plus de seuil, donc **plus une seule tuile de route sur la carte**.
  //   Conséquences en chaîne, toutes constatées ici : plus de convoi, de réfugié ni de poste
  //   d'Arche ; `sortDuLieu` ne rend plus jamais 'pille' (la route en est la cause) — tout lieu
  //   bâti naît INTACT ; et la règle de lecture « loin des routes = intact = riche » n'a plus
  //   d'axe. La garde est RETOURNÉE pour dire l'état réel — le jour où les sentes reviennent
  //   (dans la zone, ou avec une seconde région), elle échouera et il faudra la réécrire.
  it("aucune route, et c'est la conséquence du T0 seul — à rouvrir", () => {
    for (const { s, c } of reduits) {
      let routes = 0
      for (const t of c.map.terrain) if (t === TERRAIN_ROAD) routes++
      expect(routes, `seed ${s}`).toBe(0)
      // Les gués, eux, survivent : ils naissent de la RIVIÈRE, pas des sentes.
      const gues = c.map.zones.filter((z) => z.name === 'le Gué')
      expect(gues.length, `seed ${s}`).toBeGreaterThanOrEqual(2)
    }
  })

  it("le monde joué n'a NI Cendrière NI champ de cendre — le front est retiré (2026-08-24)", () => {
    for (const { s, c } of reduits) {
      expect(c.graphe.zones.some((z) => z.def.slug === 'cendriere'), `seed ${s}`).toBe(false)
      expect(c.map.cendre, `seed ${s}`).toBeUndefined()
      // Une seule région, et c'est le T0 : elle a pris toute la place du sud.
      expect(c.graphe.zones.length, `seed ${s}`).toBe(1)
      expect(c.graphe.zones[0]!.def.slug, `seed ${s}`).toBe('pres_bas')
    }
  })

  // (A-MR5 — « le front est une marée SUD→NORD » : retiré le 2026-08-24 avec le front et la
  //  Cendrière. Elle épinglait le champ mesuré au VOISIN plutôt qu'au rect ; il n'y a plus ni
  //  champ ni voisin dans le monde joué.)

  it('villages et spawns existent, et TOUS dans la racine — le jeu a où naître', () => {
    for (const { s, c } of reduits) {
      const nodes = placeZoneNodes(c)
      const grounds = placeHuntingGrounds(c.map, s)
      const emplacements = emplacementsDeVillage(c, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(c.map) })
      // La Veillée fonde le joueur + un Foyer + une Meute : il faut au moins trois sites tenables.
      expect(emplacements.length, `seed ${s}`).toBeGreaterThanOrEqual(3)
      const spawns = pointsDeSpawn(c, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
      expect(spawns.length, `seed ${s}`).toBeGreaterThan(0)
      for (const e of [...emplacements, ...spawns]) {
        const zid = c.zone[e.ty * c.map.width + e.tx]!
        expect(c.graphe.zones[zid]!.def.slug, `seed ${s} : site hors racine à ${e.tx},${e.ty}`).toBe('pres_bas')
      }
    }
  })

  it('le balayage d\'échelles — le plan réduit génère à toutes les tailles, comme l\'autre', () => {
    for (let k = 1; k <= 8; k++) {
      const seed = k * 7919
      const c = generateZonedTerrain(seed, 8, 'racine')
      expect(c.graphe.zones.length, `seed ${seed}`).toBe(1)
      expect((c.map.seuils ?? []).length, `seed ${seed}`).toBe(0)
      // La carte SORT, à toutes les échelles : c'est ce que ce balayage garde. On vérifie donc
      // qu'elle a du sol marchable, et non plus qu'elle a des routes (il n'y en a plus).
      let marchables = 0
      for (const t of c.map.terrain) if (TERRAINS[t]?.walkable) marchables++
      expect(marchables, `seed ${seed}`).toBeGreaterThan(0)
    }
  }, 120_000)
})

describe("A-MR2 — le T0 réduit est le T0 complet ÉTIRÉ sur le sud (2026-08-24)", () => {
  it('même largeur et même x que dans la vallée complète, mais étiré jusqu\'au bord sud', () => {
    for (const s of SEEDS) {
      const complet = deriveGrapheZones(s)
      const reduit = deriveGrapheZones(s, MONDE.JOUEURS_CIBLE, 'racine')
      const a = complet.zones.find((z) => z.def.slug === 'pres_bas')!.rect!
      const b = reduit.zones.find((z) => z.def.slug === 'pres_bas')!.rect!
      // La LARGEUR ne bouge pas : la calibration horizontale (espacement des villages, semis,
      // rivière) est celle de la vallée complète, au bit près.
      expect(b.w, `seed ${s}`).toBe(a.w)
      expect(b.x, `seed ${s} : x intact (on ne translate qu'en y)`).toBe(a.x)
      // La HAUTEUR grandit : le T0 a pris la place de la Cendrière (y1 0,915 → 0,985).
      expect(b.h, `seed ${s}`).toBeGreaterThan(a.h)
      // …et il descend jusqu'au bas de la carte, à la marge de bloc près.
      // Il descend jusqu'au bas de la carte, au jitter de rail près (±0,8 % de la hauteur).
      const bas = reduit.height - (b.y + b.h)
      expect(bas, `seed ${s} : le T0 touche le bord sud`).toBeLessThanOrEqual(MONDE.BLOC * 5)
      // La Cendrière n'est plus du plan.
      expect(reduit.zones.some((z) => z.def.slug === 'cendriere'), `seed ${s}`).toBe(false)
    }
  })
})

describe('A-MR3 — le plan réduit est déterministe, au bit près (le contrat A12, étendu)', () => {
  it('même seed, même monde réduit — graphe ET carte', () => {
    const a = generateZonedTerrain(42, 8, 'racine')
    const b = generateZonedTerrain(42, 8, 'racine')
    expect(JSON.stringify(a.graphe)).toBe(JSON.stringify(b.graphe))
    expect(a.map.terrain).toEqual(b.map.terrain)
    expect(a.map.zones).toEqual(b.map.zones)
    expect(a.map.seuils).toEqual(b.map.seuils)
  }, 60_000)
})

describe('A-MR4 — le banc joue LE MONDE JOUÉ', () => {
  it('construireMondeDuBanc porte MONDE_JOUE — pas un choix local au banc', () => {
    // La sim du banc expose ses zones (`zoneDefs`) ; le graphe attendu se DÉRIVE (pas de terrain,
    // quasi gratuit). Si un jour le banc regénérait la vallée entière pendant que le jeu sert le
    // monde réduit — ou l'inverse — cette garde rougit, quelle que soit la valeur de MONDE_JOUE.
    const banc = construireMondeDuBanc(2026)
    const attendu = deriveGrapheZones(2026, BANC_JOUEURS, MONDE_JOUE)
    expect(banc.sim.map.zoneDefs?.map((z) => z.slug).sort())
      .toEqual(attendu.zones.map((z) => z.def.slug).sort())
  })
})
