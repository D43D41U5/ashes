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
import { deriveGrapheZones, distAuRect, MONDE, MONDE_JOUE, tailleCarte } from './zonegraph'

/** Les graines de production des autres gardes — le monde qu'on jouera vraiment. */
const SEEDS = [2026, 7]

const reduits = SEEDS.map((s) => ({ s, c: generateZonedTerrain(s, MONDE.JOUEURS_CIBLE, 'racine') }))

describe('A-MR1 — le monde réduit tient : la boucle de saison a tous ses organes', () => {
  it('deux zones exactement — les Prés Bas et la Cendrière, et la carte est COUPÉE au nord', () => {
    for (const { s, c } of reduits) {
      const slugs = c.graphe.zones.map((z) => z.def.slug).sort()
      expect(slugs, `seed ${s}`).toEqual(['cendriere', 'pres_bas'])
      expect(c.graphe.monde, `seed ${s}`).toBe('racine')
      expect(c.graphe.zones[c.graphe.racine]!.def.slug, `seed ${s}`).toBe('pres_bas')
      // La carte rétrécit VRAIMENT (sinon on paie 78 % de roche morte en mémoire et en sauvegarde).
      const pleine = tailleCarte(MONDE.JOUEURS_CIBLE)
      expect(c.map.width, `seed ${s}`).toBe(pleine.width)
      expect(c.map.height, `seed ${s}`).toBeLessThan(pleine.height * 0.5)
    }
  })

  it('deux seuils sur l\'unique frontière, dont UN de secours — la règle des impasses joue', () => {
    for (const { s, c } of reduits) {
      const seuils = c.map.seuils ?? []
      expect(seuils.length, `seed ${s}`).toBe(2)
      expect(seuils.filter((x) => x.secours).length, `seed ${s}`).toBe(1)
    }
  })

  it('des sentes et AU MOINS deux gués : sans route, ni convoi, ni réfugié, ni poste d\'Arche', () => {
    for (const { s, c } of reduits) {
      let routes = 0
      for (const t of c.map.terrain) if (t === TERRAIN_ROAD) routes++
      expect(routes, `seed ${s} : aucune tuile de route — les sentes sont mortes`).toBeGreaterThan(0)
      const gues = c.map.zones.filter((z) => z.name === 'le Gué')
      expect(gues.length, `seed ${s}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('le front de cendre est ARMÉ — la Cendrière reste le moteur de la saison', () => {
    for (const { s, c } of reduits) {
      expect(c.map.cendreMax, `seed ${s}`).toBeDefined()
      expect(c.map.cendreMax!, `seed ${s}`).toBeGreaterThan(0)
    }
  })

  it('A-MR5 — le front est une marée SUD→NORD : rien ne brûle loin au nord de la Cendrière', () => {
    // LE BUG QUE CETTE GARDE ÉPINGLE (trouvé par la dérivation des carrières, 2026-08-18) : à
    // deux zones, « la région d'en face » est TOUJOURS la Cendrière — le champ de cendre valait
    // la distance à SON PROPRE bord sur tout le pourtour, et 37 % de la racine « brûlait » à
    // plus de 200 tuiles au NORD du feu. Le front avançait depuis toutes les enceintes.
    // Depuis : la distance au front EST la distance au rect de la Cendrière (± le grain du bloc).
    for (const { s, c } of reduits) {
      const { width, height, cendre, cendreMax, terrain } = c.map
      const rc = c.graphe.zones.find((z) => z.def.slug === 'cendriere')!.rect!
      let faux = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (c.zone[i] !== c.graphe.racine) continue
          // Les tuiles MARCHABLES seulement : le vide (la roche) se RATTACHE à la racine pour
          // l'ambiance, et son champ vaut |m|+1 par conception — « le vide ne brûle pas ».
          // C'est là où le jeu se joue que la marée doit être vraie.
          if (!TERRAINS[terrain[i]!]?.walkable) continue
          if (cendre![i]! <= cendreMax! && distAuRect(x, y, rc) > cendreMax! + 32) faux++
        }
      }
      expect(faux, `seed ${s} : des tuiles brûlent HORS DE PORTÉE du feu — le front n'est pas une marée sud→nord`).toBe(0)
    }
  })

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
      expect(c.graphe.zones.length, `seed ${seed}`).toBe(2)
      expect((c.map.seuils ?? []).length, `seed ${seed}`).toBe(2)
      let routes = 0
      for (const t of c.map.terrain) if (t === TERRAIN_ROAD) routes++
      expect(routes, `seed ${seed}`).toBeGreaterThan(0)
    }
  }, 120_000)
})

describe('A-MR2 — le T0 réduit est LE MÊME T0 : la géométrie absolue survit', () => {
  it('les rects racine et Cendrière ont les mêmes dimensions que dans la vallée complète', () => {
    for (const s of SEEDS) {
      const complet = deriveGrapheZones(s)
      const reduit = deriveGrapheZones(s, MONDE.JOUEURS_CIBLE, 'racine')
      for (const slug of ['pres_bas', 'cendriere']) {
        const a = complet.zones.find((z) => z.def.slug === slug)!.rect!
        const b = reduit.zones.find((z) => z.def.slug === slug)!.rect!
        expect({ w: b.w, h: b.h }, `seed ${s}, ${slug}`).toEqual({ w: a.w, h: a.h })
        expect(b.x, `seed ${s}, ${slug} : x intact (on ne translate qu'en y)`).toBe(a.x)
      }
      // Et l'EMBOÎTEMENT survit : l'écart vertical racine→Cendrière est le même (translation pure).
      const dyC = complet.zones.find((z) => z.def.slug === 'cendriere')!.rect!.y
        - complet.zones.find((z) => z.def.slug === 'pres_bas')!.rect!.y
      const dyR = reduit.zones.find((z) => z.def.slug === 'cendriere')!.rect!.y
        - reduit.zones.find((z) => z.def.slug === 'pres_bas')!.rect!.y
      expect(dyR, `seed ${s}`).toBe(dyC)
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
