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
 *   A-MR5 — on ne naît JAMAIS sur une île : les points de naissance sont sur la landmass principale.
 *   A-MR6 — le premier point se TIRE (graine du monde), et le tirage est déterministe.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_ROAD, TERRAINS } from './balance'
import { walkableComponents } from './connectivity'
import { placeHuntingGrounds } from './faune'
import { distSq } from './geometry'
import { nidsAMonstre } from './poi'
import { BANC_JOUEURS, construireMondeDuBanc } from './scenario'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { generateZonedTerrain } from './zonegen'
import { carteDeTest } from '../../../tools/carte-cache'
import { deriveGrapheZones, MONDE, MONDE_JOUE, tailleCarte } from './zonegraph'

/** Les graines de production des autres gardes — le monde qu'on jouera vraiment. */
const SEEDS = [2026, 7]

const reduits = SEEDS.map((s) => ({ s, c: carteDeTest(s, MONDE.JOUEURS_CIBLE, 'racine') }))

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
      const spawns = pointsDeSpawn(c, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE), s)
      expect(spawns.length, `seed ${s}`).toBeGreaterThan(0)
      for (const e of [...emplacements, ...spawns]) {
        const zid = c.zone[e.ty * c.map.width + e.tx]!
        expect(c.graphe.zones[zid]!.def.slug, `seed ${s} : site hors racine à ${e.tx},${e.ty}`).toBe('pres_bas')
      }
    }
  })

  /**
   * ═══ A-MR5 — ON NE NAÎT JAMAIS SUR UNE ÎLE ═══
   *
   * `emplacementsDeVillage` ne sait dire que *marchable* — et depuis que l'hydrologie est dérivée
   * (`zonegen-hydro.ts`), le monde joué porte 21 à 70 composantes marchables : une principale qui
   * en fait 97,5 à 99,5 %, et des îlots. Un carré dégagé sur un îlot est un site parfaitement
   * viable à ses yeux.
   *
   * **MESURÉ AVANT la règle (2026-08-31, `tools/__sonde-spawn-ile.mts`) : sur la graine 2026 — LA
   * vallée canonique, celle de `?solo` et de tous les smokes — le premier point de naissance
   * tombait sur une poche de 1 499 tuiles**, coupée des 99,4 % du monde ; la graine 7 en avait un
   * autre plus loin dans le semis. Le joueur naissait dans un enclos, sans un mot : rien ne le
   * dit, aucun type ne l'attrape, et il faut ouvrir la carte pour le voir.
   *
   * La garde porte sur les DIX-SEPT points, pas sur le premier : c'est le même semis qui sert au
   * multi (`server/scenario.ts`), où le 12ᵉ arrivant compte autant que le 1ᵉʳ.
   */
  it('A-MR5 — les points de naissance sont TOUS sur la landmass principale', () => {
    for (const { s, c } of reduits) {
      const nodes = placeZoneNodes(c)
      const grounds = placeHuntingGrounds(c.map, s)
      const emplacements = emplacementsDeVillage(c, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(c.map) })
      const spawns = pointsDeSpawn(c, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE), s)
      const comp = walkableComponents(c.map)
      // La prémisse de la garde : il Y A des poches sur cette carte. Sans elle, un monde d'une
      // seule composante rendrait ce test vert sans jamais l'éprouver.
      expect(comp.sizes.length, `seed ${s} : aucune poche — la garde ne prouve rien`).toBeGreaterThan(1)
      for (const e of spawns) {
        const label = comp.label[e.ty * c.map.width + e.tx]
        expect(
          label,
          `seed ${s} : naissance à (${e.tx},${e.ty}) sur une poche de ${comp.sizes[label!] ?? 0} tuiles, ` +
          `coupée du monde (${comp.sizes[comp.main]} tuiles)`,
        ).toBe(comp.main)
      }
    }
  })

  /**
   * ═══ A-MR6 — LE PREMIER POINT SE TIRE (décision d'Alexis, 2026-08-31) ═══
   *
   * *« On choisit aléatoirement un spawn sur la map. »* L'ancre était *le site le plus proche du
   * cœur de la racine* : MESURÉ sur dix graines, le premier spawn tombait toujours dans le
   * mouchoir `x ∈ [720, 920], y ∈ [352, 640]` d'une carte de 1581×852. Deux choses à garder, et
   * elles tirent en sens contraire — c'est pour ça qu'il en faut deux :
   *
   *   ① le tirage est bien un TIRAGE : la graine décide, et l'ancre n'est plus celle du cœur ;
   *   ② il reste DÉTERMINISTE (invariant n°2) : même graine, même point, deux fois de suite.
   *
   * ⚠ ① SE LIT SUR LES POINTS RENDUS, ET SUR L'ENSEMBLE DES GRAINES. Deux précautions, chacune
   * pour une panne de garde distincte :
   *
   *   — *sur les points rendus*, parce que le vivier du tirage (racine ∩ continent ∩ écart de
   *     fosse) ne se reconstitue pas depuis le dehors sans RECOPIER les trois règles — et une
   *     garde qui recopie la règle qu'elle teste ne garde rien. Or les dix-sept points rendus
   *     SONT tous tirés de ce vivier : si l'ancre en est le plus proche du cœur, elle est le
   *     plus proche du cœur des dix-sept. La propriété se lit donc sans rien reconstruire.
   *     *(Écrite sur `emplacements` — le vivier d'avant filtrage — la garde passait au VERT
   *     contre l'ancienne règle : mesuré, 46 sites contre 31 après l'écart de fosse, et deux
   *     « cœurs » différents.)*
   *   — *sur l'ensemble des graines*, parce qu'un tirage honnête PEUT sortir l'ancre la plus
   *     proche du cœur : une chance sur dix-sept par graine. Graine par graine, la garde
   *     rougirait 6 % du temps contre du code juste. Sur l'ensemble, elle demande que TOUTES y
   *     retombent — ce que l'ancienne règle faisait par construction, et un vrai tirage une
   *     fois sur ~290.
   */
  it('A-MR6 — le premier point est tiré au sort, et le tirage est déterministe', () => {
    const combien = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)
    const releve = reduits.map(({ s, c }) => {
      const nodes = placeZoneNodes(c)
      const grounds = placeHuntingGrounds(c.map, s)
      const emplacements = emplacementsDeVillage(c, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(c.map) })
      const a = pointsDeSpawn(c, emplacements, combien, s)
      const b = pointsDeSpawn(c, emplacements, combien, s)
      // ② même graine, même semis — au point près, et sur les dix-sept.
      expect(a, `seed ${s} : le semis n'est pas reproductible`).toEqual(b)

      // ① l'ancre est-elle le plus proche du cœur de la racine PARMI LES POINTS RENDUS ?
      // (cf. l'en-tête : c'est la lecture qui n'exige pas de reconstituer le vivier.)
      const r = c.graphe.zones[c.graphe.racine]!
      const auCoeur = a.reduce((meilleur, e) =>
        distSq(e.tx, e.ty, r.x, r.y) < distSq(meilleur.tx, meilleur.ty, r.x, r.y) ? e : meilleur)
      return { s, ancre: a[0]!, surLeCoeur: a[0]! === auCoeur, rendus: a.length }
    })
    // ① l'ancre n'est plus CELLE DU CŒUR — affirmé sur l'ensemble (cf. l'en-tête).
    expect(
      releve.every((x) => x.surLeCoeur),
      `sur toutes les graines l'ancre est le point le plus proche du cœur de la racine ` +
      `(${releve.map((x) => `${x.s}: 1er de ${x.rendus}`).join(', ')}) — le tirage ne tire plus`,
    ).toBe(false)
    // ① bis : deux graines, deux ancres — le tirage suit bien la graine du monde.
    expect(releve[0]!.ancre.tx !== releve[1]!.ancre.tx || releve[0]!.ancre.ty !== releve[1]!.ancre.ty).toBe(true)
  })

  it('le balayage d\'échelles — le plan réduit génère à toutes les tailles, comme l\'autre', () => {
    for (let k = 1; k <= 8; k++) {
      const seed = k * 7919
      const c = carteDeTest(seed, 8, 'racine')
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
    const a = carteDeTest(42, 8, 'racine')
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
