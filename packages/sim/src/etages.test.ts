/**
 * ═══ LES ÉTAGES — la TRANCHE VERTICALE (spec `etages.md` §9) ═══
 *
 * Ce que ces gardes éprouvent, dans l'ordre de la spec : la grille creuse et sa sérialisation
 * (E-A1), le déterminisme (E-A2), **la règle de distance, exhaustivement** (E-A3 — c'est ici que
 * vit le bug silencieux, et nulle part ailleurs), l'île (E-A4), la connexité (E-A5) et le fait que
 * la carte générale ignore tout de cette histoire (E-A6).
 *
 * ⚠ **CE QUI FERAIT ROUGIR E-A3, énoncé AVANT d'accepter son vert** (la leçon des trois ✓ obtenus
 * par accident) : remplacer le corps d'`atteignableEntreEtages` par `return true` — le balayage
 * doit alors rougir sur les paires d'étages différents hors de portée d'un connecteur ; par
 * `return ae === be` — il doit rougir sur les paires que la rampe relie. La garde tient les deux
 * bouts, sans quoi elle ne mesure rien. (Vérifié à la main les deux fois, 2026-08-31.)
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, FAUNA, NODE_DEFS, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_SCREE } from './balance'
import { carteDeTest } from '../../../tools/carte-cache'
import { isBlockedAt, moveAvatar } from './collision'
import {
  atteignableEntreEtages, connecteurAt, etageApresLePas, etageDe, etagesDuPas,
  marchableAEtage, palierDuSol, terrainAEtage, type Connecteur, type EtageCreux,
} from './etages'
import { MARCHABLE, createEmptyMap, terrainAt, type WorldMap } from './map'
import { nodeAt, type ResourceNode } from './economy'
import { spawnMonster } from './monsters'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { renderVignette } from './vignette'
import { placeZoneNodes } from './zone-content'
import { generateZonedTerrain } from './zonegen'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026

/* ═══════════════════════════════════════════════════════════════════════════════════
 * LA MESA DE LABORATOIRE — le vrai modèle, en petit
 *
 * Un chapeau de roche 6×6 (infranchissable au sol, comme dans le monde joué), une jupe d'herbe
 * autour, et UNE rampe au sud. L'étage +1 porte le chapeau ET la rampe : c'est cette tuile
 * partagée qui fait d'une rampe une rampe. Rien de l'étage 0 n'est repeint — la rampe est déjà
 * marchable, elle l'était avant qu'on décide qu'elle en était une.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const CAP_X0 = 10
const CAP_Y0 = 10
const CAP_N = 6
const RAMPE = { x: 12, y: CAP_Y0 + CAP_N } // juste au sud du chapeau

function mesaDeLabo(opts: { sansConnecteur?: boolean } = {}): WorldMap {
  const map = createEmptyMap(24, 24, TERRAIN_GRASS)
  const tuiles: number[] = []
  for (let dy = 0; dy < CAP_N; dy++) {
    for (let dx = 0; dx < CAP_N; dx++) {
      const x = CAP_X0 + dx
      const y = CAP_Y0 + dy
      map.terrain[y * map.width + x] = TERRAIN_ROCK // le chapeau reste de la roche AU SOL
      tuiles.push(y * map.width + x)
    }
  }
  tuiles.push(RAMPE.y * map.width + RAMPE.x)
  tuiles.sort((a, b) => a - b)
  const etage: EtageCreux = {
    niveau: 1,
    idx: tuiles,
    terrain: tuiles.map(() => TERRAIN_SCREE),
    x0: CAP_X0, y0: CAP_Y0, x1: CAP_X0 + CAP_N, y1: RAMPE.y + 1,
  }
  map.etages = [etage]
  if (opts.sansConnecteur !== true) {
    map.connecteurs = [{ x: RAMPE.x, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' }]
  }
  return map
}

/* ─────────────────────────── E-A1 — SÉRIALISATION ─────────────────────────── */

describe('E-A1 — la grille creuse voyage en JSON', () => {
  it('un SimState à deux étages survit à JSON.parse(JSON.stringify(…)) sans perte', () => {
    const sim = createSim(SEED, { map: mesaDeLabo() })
    const id = spawnEntity(sim, RAMPE.x + 0.5, RAMPE.y + 0.5)
    sim.entities.find((e) => e.id === id)!.etage = 1

    const repris = JSON.parse(JSON.stringify(sim)) as SimState
    expect(repris.map.etages).toEqual(sim.map.etages)
    expect(repris.map.connecteurs).toEqual(sim.map.connecteurs)
    expect(repris.entities[0]!.etage).toBe(1)
    // LA SECONDE MOITIÉ DE E-A1, et c'est elle qui dit que l'étage TRAVERSE LE RÉSEAU :
    // `snapshot()` est le sérialiseur du protocole, et `SnapshotMessage.entities` porte
    // l'`Entity` de /sim — donc `etage` arrive au client sans une ligne de protocole à écrire.
    expect(snapshot(repris)).toBe(snapshot(sim))
    expect(snapshot(sim)).toContain('"etage":1')
    // Et la lecture rend la même chose des deux côtés — c'est ça, « sans perte ».
    for (let y = 0; y < repris.map.height; y++) {
      for (let x = 0; x < repris.map.width; x++) {
        expect(terrainAEtage(repris.map, 1, x, y)).toBe(terrainAEtage(sim.map, 1, x, y))
      }
    }
  })

  it('ni Map, ni Set, ni classe : la structure est faite de tableaux plats de nombres', () => {
    const e = etageDe(mesaDeLabo(), 1)!
    expect(Array.isArray(e.idx)).toBe(true)
    expect(Array.isArray(e.terrain)).toBe(true)
    expect(e.idx.every((v) => typeof v === 'number')).toBe(true)
    expect(e.terrain).toHaveLength(e.idx.length)
    // `idx` est TRIÉ CROISSANT — la dichotomie de `terrainAEtage` en dépend, et le tri par
    // défaut de JavaScript est lexicographique : [10, 9] y resterait [10, 9].
    for (let i = 1; i < e.idx.length; i++) expect(e.idx[i]!).toBeGreaterThan(e.idx[i - 1]!)
  })

  it('la lecture est EXHAUSTIVE : chaque tuile du plan rend le terrain qu’elle porte, ou le vide', () => {
    const map = mesaDeLabo()
    const dedans = new Set(map.etages![0]!.idx)
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const attendu = dedans.has(y * map.width + x) ? TERRAIN_SCREE : 0 // 0 = void, non marchable
        expect(terrainAEtage(map, 1, x, y), `(${x},${y})`).toBe(attendu)
      }
    }
    // Un étage qui n'existe pas est du vide partout — jamais une exception, jamais la carte.
    expect(terrainAEtage(map, 2, CAP_X0, CAP_Y0)).toBe(0)
    expect(terrainAEtage(map, -1, CAP_X0, CAP_Y0)).toBe(0)
    // …et l'étage 0 reste la CARTE, mot pour mot.
    expect(terrainAEtage(map, 0, CAP_X0, CAP_Y0)).toBe(TERRAIN_ROCK)
  })
})

/* ─────────────────────────── E-A2 — DÉTERMINISME ─────────────────────────── */

describe('E-A2 — même graine, mêmes étages', () => {
  /**
   * ⚠ SUR DEUX GRAINES, ET NON SUR SOIXANTE comme le dit la spec : une génération du monde joué
   * coûte ~10 s, et soixante paires en coûteraient vingt minutes. Ce qu'on paie ici est le
   * discriminant : la passe des étages ne TIRE RIEN (aucun appel au PRNG, l'élection de la rampe
   * est un `max` sur des coordonnées) — si elle tirait, deux générations de la même graine
   * diffèreraient dès la première butte. Le reste du déterminisme du worldgen est déjà gardé
   * ailleurs (`zonegen.test.ts`, `replay.test.ts`), et il couvre le terrain dont ces étages
   * dérivent. Ces tests appellent `generateZonedTerrain` EN DIRECT : ils éprouvent la
   * GÉNÉRATION, jamais le cache (règle du dépôt).
   */
  for (const graine of [SEED, 7]) {
    it(`graine ${graine} : deux générations rendent les mêmes étages et les mêmes connecteurs`, () => {
      const a = generateZonedTerrain(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      const b = generateZonedTerrain(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      expect(a.etages).toEqual(b.etages)
      expect(a.connecteurs).toEqual(b.connecteurs)
      // Et les PALIERS du sol (spec `terrasses.md` T-A1) : la même paire de générations le dit.
      expect(a.palier).toEqual(b.palier)
      expect(a.palier).toBeDefined()
      expect(a.connecteurs!.length).toBeGreaterThan(0) // la garde ne peut pas passer à vide
    }, 60_000)
  }
})

/* ─────────────── E-A3 — LA RÈGLE DE DISTANCE, EXHAUSTIVE ─────────────── */

describe('E-A3 — atteignable ⟺ la règle E-R5, sur tout l’espace des paires', () => {
  /**
   * LE BALAYAGE. On ne choisit pas des cas : on parcourt tout le plan × tous les étages en jeu
   * × les deux mondes (avec et sans connecteur), et on affirme **une seule propriété** — celle
   * de E-R5, mot pour mot : *deux points s'atteignent s'ils sont au même étage, ou si l'UN des
   * deux est à moins de N tuiles d'un connecteur qui les relie.*
   *
   * C'est le patron de `collision.test.ts` (série B) : la géométrie ne se garde pas par
   * échantillons, elle se balaie. 24 × 24 positions × 3 étages, des deux côtés — les paires
   * ordonnées, parce que la règle doit être SYMÉTRIQUE et que l'affirmer suppose de la poser
   * dans les deux sens.
   */
  const N = BALANCE.ETAGE_PORTEE_CONNECTEUR

  for (const sansConnecteur of [false, true]) {
    it(`${sansConnecteur ? 'sans rampe' : 'avec la rampe'} : la règle tient sur toutes les paires`, () => {
      const map = mesaDeLabo({ sansConnecteur })
      const cs = map.connecteurs ?? []
      const points: { x: number; y: number; e: number }[] = []
      for (let y = 0; y < map.height; y += 2) {
        for (let x = 0; x < map.width; x += 2) {
          for (const e of [0, 1, 2]) points.push({ x: x + 0.5, y: y + 0.5, e })
        }
      }
      let vus = 0
      let traversants = 0
      for (const a of points) {
        for (const b of points) {
          // LA RÈGLE, ÉNONCÉE À PART — c'est la seule chose que ce test affirme.
          const attendu = a.e === b.e || cs.some((c) => {
            const relie = (c.de === a.e && c.vers === b.e) || (c.de === b.e && c.vers === a.e)
            if (!relie) return false
            const dax = a.x - (c.x + 0.5), day = a.y - (c.y + 0.5)
            const dbx = b.x - (c.x + 0.5), dby = b.y - (c.y + 0.5)
            return dax * dax + day * day <= N * N || dbx * dbx + dby * dby <= N * N
          })
          const rendu = atteignableEntreEtages(map, a.x, a.y, a.e, b.x, b.y, b.e)
          expect(rendu, `(${a.x},${a.y}@${a.e}) → (${b.x},${b.y}@${b.e})`).toBe(attendu)
          vus++
          if (a.e !== b.e && attendu) traversants++
        }
      }
      // LA GARDE PROUVE SA PRÉMISSE : sans ces deux comptes, un `return false` constant la
      // passerait au vert dans le monde sans rampe, et un `return true` dans l'autre.
      expect(vus).toBeGreaterThan(100_000)
      if (sansConnecteur) expect(traversants, 'sans rampe, RIEN ne traverse').toBe(0)
      else expect(traversants, 'avec la rampe, quelque chose traverse').toBeGreaterThan(0)
    })
  }

  it('un plancher ne se traverse jamais tout seul : deux étages éloignés restent séparés même sur la rampe', () => {
    const map = mesaDeLabo()
    // La rampe relie 0 et 1. Elle ne relie PAS 0 et 2, même debout dessus.
    expect(atteignableEntreEtages(map, RAMPE.x + 0.5, RAMPE.y + 0.5, 0, RAMPE.x + 0.5, RAMPE.y + 0.5, 2)).toBe(false)
    expect(atteignableEntreEtages(map, RAMPE.x + 0.5, RAMPE.y + 0.5, 0, RAMPE.x + 0.5, RAMPE.y + 0.5, 1)).toBe(true)
  })

  it('même étage : la règle sort avant de regarder quoi que ce soit (le cas de 100 % du jeu d’aujourd’hui)', () => {
    const nu = createEmptyMap(8, 8, TERRAIN_GRASS) // aucun étage, aucun connecteur
    expect(atteignableEntreEtages(nu, 0.5, 0.5, 0, 7.5, 7.5, 0)).toBe(true)
    expect(atteignableEntreEtages(nu, 0.5, 0.5, 0, 7.5, 7.5, 1)).toBe(false)
  })
})

/* ─── E-A3 (le vrai appelant) + E-A4 — LE LOUP NE MORD PAS À TRAVERS LA ROCHE ─── */

describe('E-A3/E-A4 — le loup au pied de la mesa ne choisit pas celui qui est dessus', () => {
  /** Un loup affamé, lâché à trois tuiles de sa proie — le cas où il l'acquiert toujours. */
  function meute(opts: { proieEnHaut: boolean; sansConnecteur?: boolean }): {
    sim: SimState
    proie: number
    loupId: number
  } {
    const sim = createSim(SEED, {
      map: mesaDeLabo(opts.sansConnecteur === true ? { sansConnecteur: true } : {}),
      faunaCap: 0,
      worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(2, 1), // l'heure du loup : pleine vigueur
    })
    // La proie AU MILIEU du chapeau, hors de portée de la rampe (E-R5 : c'est la distance au
    // CONNECTEUR qui décide, pas la distance au loup).
    const px = CAP_X0 + 1.5
    const py = CAP_Y0 + 1.5
    const proie = spawnEntity(sim, px, py)
    if (opts.proieEnHaut) sim.entities.find((e) => e.id === proie)!.etage = 1
    // Le loup au PIED, au nord-ouest du chapeau, à deux tuiles de la proie en projection.
    const loupId = spawnMonster(sim, 'wolf', CAP_X0 - 1.5, CAP_Y0 - 0.5)
    const m = sim.monsters.find((mm) => mm.entityId === loupId)!
    m.faim = 1
    m.sortie = true
    return { sim, proie, loupId }
  }

  function chasseCentTicks(sim: SimState, loupId: number, proie: number): boolean {
    const inputs: MoveInput[] = []
    let vise = false
    for (let t = 0; t < 100; t++) {
      step(sim, inputs)
      const m = sim.monsters.find((mm) => mm.entityId === loupId)
      if (m === undefined) break
      m.faim = 1
      m.sortie = true
      if (m.targetId === proie) vise = true
    }
    return vise
  }

  it('LA PRÉMISSE : au SOL, le même loup à la même distance la choisit — la garde peut échouer', () => {
    const { sim, proie, loupId } = meute({ proieEnHaut: false })
    expect(chasseCentTicks(sim, loupId, proie)).toBe(true)
  })

  it('EN HAUT : il ne la choisit jamais — un plancher les sépare (E-R5)', () => {
    const { sim, proie, loupId } = meute({ proieEnHaut: true })
    expect(chasseCentTicks(sim, loupId, proie)).toBe(false)
    // …et la proie n'a pas pris un coup : pas de cible, pas de traque, pas de morsure.
    expect(sim.entities.find((e) => e.id === proie)!.hp).toBe(100)
  })

  it('E-A4 — LES CONNECTEURS BOUCHÉS : l’étage devient une île, rien n’y entre ni n’en sort', () => {
    const { sim, proie, loupId } = meute({ proieEnHaut: true, sansConnecteur: true })
    expect(chasseCentTicks(sim, loupId, proie)).toBe(false)
    // ET LE PAS EST MURÉ DES DEUX CÔTÉS. En haut : le bord du plateau ne mène nulle part.
    const map = sim.map
    for (const i of map.etages![0]!.idx) {
      const x = i % map.width
      const y = (i - x) / map.width
      for (const [vx, vy] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
        const dehors = !marchableAEtage(map, 1, vx, vy)
        if (!dehors) continue
        // Une tuile hors du plateau est bloquée pour qui est à l'étage 1 — et donc le pas
        // n'a aucun moyen d'en descendre : la seule porte était le connecteur.
        expect(isBlockedAt({ map, etages: [1] }, vx, vy), `descente en (${vx},${vy})`).toBe(true)
      }
    }
    // En bas : la rampe n'ouvre plus rien, la roche du chapeau bloque comme avant.
    expect(etagesDuPas(map, 0, RAMPE.x, RAMPE.y)).toBeUndefined()
    expect(isBlockedAt({ map, etages: [0] }, CAP_X0, CAP_Y0 + CAP_N - 1)).toBe(true)
  })
})

/* ───────────────── LE PAS : ON MONTE, ON REDESCEND, ET PAR LÀ SEULEMENT ───────────────── */

describe('la rampe se monte et se descend — sans un bouton', () => {
  function marche(sim: SimState, id: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1, ticks: number): void {
    for (let t = 0; t < ticks; t++) step(sim, [{ entityId: id, dx, dy }])
  }

  it('on monte par la rampe, et l’étage bascule en quittant la tuile partagée', () => {
    const sim = createSim(SEED, { map: mesaDeLabo() })
    const id = spawnEntity(sim, RAMPE.x + 0.5, RAMPE.y + 2.5)
    const e = sim.entities[0]!
    expect(e.etage).toBeUndefined() // absent ≡ 0, et c'est le monde d'avant

    marche(sim, id, 0, -1, 3 * BALANCE.TICK_RATE_HZ) // vers le nord, droit sur la mesa
    expect(e.etage, 'il est sur le plateau').toBe(1)
    expect(Math.floor(e.y), 'et il a franchi le bord du chapeau').toBeLessThan(RAMPE.y)

    marche(sim, id, 0, -1, 5 * BALANCE.TICK_RATE_HZ) // il traverse le plateau
    expect(e.etage).toBe(1)
    expect(Math.floor(e.y), 'il s’arrête au bord nord — un plateau a un bord').toBe(CAP_Y0)

    marche(sim, id, 0, 1, 10 * BALANCE.TICK_RATE_HZ) // il redescend
    expect(e.etage, 'de retour au sol, le champ redevient ABSENT').toBeUndefined()
    expect(Math.floor(e.y)).toBeGreaterThan(RAMPE.y)
  })

  it('le bord du plateau n’est pas une falaise qu’on saute : on ne sort que par la rampe', () => {
    const sim = createSim(SEED, { map: mesaDeLabo() })
    const id = spawnEntity(sim, CAP_X0 + 0.5, CAP_Y0 + 0.5)
    sim.entities[0]!.etage = 1
    // Vers l'ouest, le nord, l'est : hors du chapeau il n'y a rien à l'étage 1.
    for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0]] as const) {
      marche(sim, id, dx, dy, 3 * BALANCE.TICK_RATE_HZ)
      const e = sim.entities[0]!
      expect(e.etage, `en poussant vers ${dx},${dy}`).toBe(1)
      expect(marchableAEtage(sim.map, 1, Math.floor(e.x), Math.floor(e.y))).toBe(true)
    }
  })

  it('ON NE RESTE JAMAIS EN L’AIR : un corps reposé hors du pas retombe au sol', () => {
    /**
     * ⚠ LA GARDE QUI MANQUAIT, et le défaut est atteignable en jeu ORDINAIRE. Mourir sur un
     * plateau (les loups n'y montent pas : c'est le refuge évident) ressuscitait au Feu du
     * village un corps **encore marqué étage +1**, dans un monde où rien n'est marchable à cet
     * étage-là : toutes ses tuiles bloquées, figé sur place, sans un mot. Les trois chemins qui
     * REPOSENT un corps hors du pas — le respawn, la téléportation de debug, la berge de la
     * glace rompue — effacent donc l'étage ; et `etageApresLePas` retombe sur 0 plutôt que de
     * garder l'étage courant, parce que le SOL existe toujours : on ne peut pas n'être nulle part.
     *
     * Les 22 autres gardes montent sur le plateau EN MARCHANT — aucune ne pouvait voir ceci.
     */
    const sim = createSim(SEED, { map: mesaDeLabo() })
    const id = spawnEntity(sim, CAP_X0 + 0.5, CAP_Y0 + 0.5)
    const e = sim.entities[0]!
    e.etage = 1
    // Le corps est REPOSÉ loin de toute mesa, sans passer par le pas — et il garde son étage.
    e.x = 3.5
    e.y = 3.5
    const avant = { x: e.x, y: e.y }
    marche(sim, id, 1, 0, 2 * BALANCE.TICK_RATE_HZ)
    expect(e.etage, 'il est redescendu au sol tout seul').toBeUndefined()
    expect(e.x, 'et il marche : rien ne le bloque plus').toBeGreaterThan(avant.x + 0.5)
    expect(e.y).toBe(avant.y)
  })

  it('sur la rampe, les deux étages sont ouverts — et nulle part ailleurs', () => {
    const map = mesaDeLabo()
    expect(etagesDuPas(map, 0, RAMPE.x, RAMPE.y)).toEqual([0, 1])
    expect(etagesDuPas(map, 1, RAMPE.x, RAMPE.y)).toEqual([1, 0])
    expect(etagesDuPas(map, 0, RAMPE.x, RAMPE.y + 1), 'au sol ailleurs : le monde d’avant').toBeUndefined()
    expect(etagesDuPas(map, 1, CAP_X0, CAP_Y0)).toEqual([1])
    // On garde son étage tant qu'il porte ; sinon on prend celui qui porte.
    expect(etageApresLePas(map, [0, 1], 0, RAMPE.x, RAMPE.y)).toBe(0)
    expect(etageApresLePas(map, [0, 1], 0, CAP_X0, CAP_Y0)).toBe(1) // il quitte la rampe vers le haut
    expect(etageApresLePas(map, [1, 0], 1, RAMPE.x, RAMPE.y + 1)).toBe(0) // …et vers le bas
  })
})

/* ═══════════ LE MONDE JOUÉ — E-A5 (connexité) et E-A6 (la carte l’ignore) ═══════════ */

describe('le monde joué porte ses mesas', () => {
  const carte = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const map = carte.map

  it('E-A5 — CHAQUE ÉTAGE est atteignable : un connecteur, et une marche continue depuis lui', () => {
    /**
     * ⚠ **GÉNÉRALISÉE le 2026-09-02, et c'est la CAVE qui l'a exigé.** Elle affirmait sa
     * propriété sur l'étage +1 en supposant que TOUT connecteur l'ouvrait — vrai tant que les
     * rampes étaient les seules portes du jeu. Depuis que les gueules ouvrent l'étage **−1**, la
     * supposition est fausse, et la garde a rougi pour la bonne raison : `(789,201)` est une
     * gueule, elle n'est pas sur le plateau. On la réécrit donc sur la propriété qu'on voulait
     * dire depuis le début — *aucune tuile d'AUCUN étage n'est une île* — ce qui est plus fort et
     * ne redemandera rien le jour où un troisième palier arrivera.
     */
    const cs = map.connecteurs ?? []
    expect(cs.length).toBeGreaterThan(20) // ~50 mesas nues : la garde ne peut pas passer à vide
    const niveaux = (map.etages ?? []).map((e) => e.niveau)
    expect(niveaux, 'le monde joué porte le plateau ET la cave').toEqual(expect.arrayContaining([1, -1]))

    // Une porte est marchable DES DEUX CÔTÉS — c'est ce qui en fait une porte, quel que soit le
    // côté « sol » : depuis les terrasses, `de` est un palier du sol (0, 1 ou 2), pas l'étage 0.
    for (const c of cs) {
      expect(marchableAEtage(map, c.de, c.x, c.y), `(${c.x},${c.y}) marchable en ${c.de}`).toBe(true)
      expect(marchableAEtage(map, c.vers, c.x, c.y), `(${c.x},${c.y}) marchable en ${c.vers}`).toBe(true)
    }
    for (const niveau of niveaux) {
      const etage = etageDe(map, niveau)!
      // Les portes de CET étage creux : celles qui l'OUVRENT (`vers`). Un connecteur dont `de`
      // est ce niveau se tient sur le SOL de ce palier, pas sur la grille creuse — la rampe de
      // terrasse 0→1 n'est pas une tuile de l'étage 0 (la cave d'une mesa du palier 1).
      const portes = cs.filter((c) => c.vers === niveau)
      expect(portes.length, `l’étage ${niveau} a des portes`).toBeGreaterThan(0)
      // TOUTE tuile de cet étage est jointe à une de SES portes par une marche À CET ÉTAGE.
      // Multi-source depuis les connecteurs — le geste de `garantirLaConnexite`.
      const dedans = new Set(etage.idx)
      const vus = new Set<number>()
      const file: number[] = []
      for (const c of portes) {
        const i = c.y * map.width + c.x
        expect(dedans.has(i), `le connecteur (${c.x},${c.y}) est SUR l’étage ${niveau} qu’il ouvre`).toBe(true)
        if (!vus.has(i)) { vus.add(i); file.push(i) }
      }
      for (let k = 0; k < file.length; k++) {
        const i = file[k]!
        const x = i % map.width
        const y = (i - x) / map.width
        for (const [vx, vy] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
          const j = vy * map.width + vx
          if (!dedans.has(j) || vus.has(j)) continue
          vus.add(j)
          file.push(j)
        }
      }
      expect(vus.size, `aucune tuile de l’étage ${niveau} n’est une île`).toBe(etage.idx.length)
    }
  })

  it('E-A5 — le SOL ne perd RIEN : le chapeau reste roche, la rampe était déjà marchable', () => {
    // Sur TOUS les étages creux (depuis les terrasses, une mesa posée au palier 2 a son dessus
    // au niveau 3, sa cave au niveau 1 — et un étage mêle dessus, caves et rampes de terrasse).
    const cs = new Set((map.connecteurs ?? []).map((c) => c.y * map.width + c.x))
    let roche = 0
    for (const etage of map.etages ?? []) {
      for (const i of etage.idx) {
        const x = i % map.width
        const y = (i - x) / map.width
        const marchableAuSol = MARCHABLE[terrainAt(map, x, y)] === 1
        if (cs.has(i)) {
          // La rampe : marchable au sol AVANT qu'on en fasse une rampe, et marchable en haut.
          expect(marchableAuSol, `rampe (${x},${y}) au sol`).toBe(true)
          expect(marchableAEtage(map, etage.niveau, x, y), `rampe (${x},${y}) à l’étage ${etage.niveau}`).toBe(true)
        } else {
          // Le chapeau (et le plafond d'une cave, qui est le même chapeau vu d'en dessous) : de
          // la ROCHE, exactement comme avant les étages. On CONTOURNE une mesa.
          expect(terrainAt(map, x, y), `chapeau (${x},${y})`).toBe(TERRAIN_ROCK)
          roche++
        }
      }
    }
    expect(roche).toBeGreaterThan(1000)
    for (const c of map.connecteurs ?? []) expect(connecteurAt(map, c.x, c.y)).toEqual<Connecteur>(c)
  })

  it('E-R9 — AUCUNE MESA N’EST SCELLÉE : chaque plateau a sa porte, et un nœud ne la mure pas', () => {
    /**
     * ⚠ LA GARDE QUI A FAIT ÉLARGIR LA RAMPE. Le semis des nœuds (`placeZoneNodes`) tourne
     * APRÈS le worldgen et ne sait rien des rampes : à une tuile de large, il posait un rocher,
     * un arbre ou une carrière SUR la porte — **MESURÉ : 0 / 1 / 3 / 1 rampes murées sur les
     * graines 2026 / 7 / 4242 / 99** — et un nœud bloquant scelle un passage d'une tuile pour un
     * corps de 0,75. E-R9 tombait en silence, sur une mesa sur cinquante. `CREUX.RAMPE_LARGEUR`
     * = 3 l'a refermé (MESURÉ après : **zéro mesa scellée sur 5 graines**).
     *
     * On raisonne par COMPOSANTE de l'étage — une mesa, c'est une tache connexe à +1 — et non
     * par connecteur : une rampe de trois tuiles a trois portes, et il suffit qu'UNE reste
     * ouverte. (Une garde par connecteur aurait rougi sur un flanc muré alors que la mesa se
     * monte parfaitement par le milieu.)
     */
    const et = etageDe(map, 1)!
    const dedans = new Set(et.idx)
    const portes = new Set((map.connecteurs ?? []).map((c) => c.y * map.width + c.x))
    const nodes = placeZoneNodes(carte)
    const mures = new Set(
      nodes.filter((n) => NODE_DEFS[n.type].blockHalfSub > 0 && n.stock > 0).map((n) => n.ty * map.width + n.tx),
    )
    const vu = new Set<number>()
    let mesas = 0
    const sansPorte: number[] = []
    const scellees: number[] = []
    for (const depart of et.idx) {
      if (vu.has(depart)) continue
      const pile = [depart]
      vu.add(depart)
      const comp: number[] = []
      while (pile.length > 0) {
        const j = pile.pop()!
        comp.push(j)
        const x = j % map.width
        const y = (j - x) / map.width
        for (const [vx, vy] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
          const k = vy * map.width + vx
          if (!dedans.has(k) || vu.has(k)) continue
          vu.add(k)
          pile.push(k)
        }
      }
      mesas++
      const miennes = comp.filter((j) => portes.has(j))
      if (miennes.length === 0) sansPorte.push(depart)
      else if (miennes.every((j) => mures.has(j))) scellees.push(depart)
    }
    expect(mesas, 'la garde ne peut pas passer à vide').toBeGreaterThan(20)
    expect(sansPorte, 'un plateau sans rampe n’est jamais émis (E-R9)').toEqual([])
    expect(scellees, 'un nœud ne mure pas la dernière porte d’une mesa').toEqual([])
  })

  it('LA CARTE NE BOUGE PAS — mille ticks de monde vivant ne changent pas un bit des étages', () => {
    /**
     * LA MOITIÉ DE `carte-immuable` QUI NE PEUT PAS VIVRE LÀ-BAS. A0 confronte sa liste aux clés
     * du plan COMPLET, qui n'a ni butte nue ni mesa : y nommer `etages` le ferait rougir en
     * réclamant des clés que cette carte-là ne porte pas — c'est la raison EXACTE qui en a sorti
     * `cendreCout`. La promesse (« donnée statique, gelée à l'amorce », donc l'autosave a le droit
     * de ne pas la réécrire) se garde donc ICI, sur la carte qui la porte.
     */
    const sim = createSim(SEED, { map, faunaCap: 0, worldEvents: false })
    const id = spawnEntity(sim, map.width / 2, map.height / 2)
    const avant = JSON.stringify([sim.map.etages, sim.map.connecteurs])
    for (let t = 0; t < 1000; t++) step(sim, [{ entityId: id, dx: t % 2 === 0 ? 1 : -1, dy: 0 }])
    expect(JSON.stringify([sim.map.etages, sim.map.connecteurs])).toBe(avant)
  }, 60_000)

  it('UNE CARTE À PART ENTIÈRE : le plateau porte un VRAI terrain, varié et marchable', () => {
    /**
     * *« on doit appliquer le terrain, les nodes, POI etc. comme le reste de la map — on construit
     * une map en terrasse »* (Alexis, 2026-09-01). La première écriture remplissait l'étage d'un
     * `TERRAIN_SCREE` uniforme : joli de loin, mort de près. Un APLAT n'a rien à donner à
     * personne — ni au décor, ni à la table de récolte, ni à la teinte de saison, qui lisent tous
     * le terrain. C'est ce qui rendait la butte NUE.
     */
    // LE DESSUS SEUL : une tuile d'étage dont le sol est un cran plus bas (le chapeau). Depuis les
    // terrasses, un étage mêle les dessus, les caves (sol un cran plus HAUT, plancher de roche
    // nue — un aplat voulu) et les rampes de terrasse (le terrain du sol) : ces deux-là ne
    // disent rien de la variété d'un plateau, on les écarte.
    const portes = new Set((map.connecteurs ?? []).map((c) => c.y * map.width + c.x))
    const compte = new Map<number, number>()
    let total = 0
    let monochromes = 0
    for (const et of map.etages ?? []) {
      const dessus = new Set<number>()
      const rang = new Map(et.idx.map((i, k) => [i, k]))
      for (const i of et.idx) {
        if (portes.has(i)) continue
        const x = i % map.width
        const y = (i - x) / map.width
        if (palierDuSol(map, x, y) !== et.niveau - 1) continue
        dessus.add(i)
        const t = et.terrain[rang.get(i)!]!
        // Une tuile d'étage est un SOL : marchable, jamais du vide ni de la roche pleine.
        expect(MARCHABLE[t], `terrain ${t} marchable`).toBe(1)
        compte.set(t, (compte.get(t) ?? 0) + 1)
        total++
      }
      // Et pas UN SEUL plateau monochrome : la variété se voit sur chaque butte, pas seulement
      // dans la moyenne du pays — c'est la différence entre « le pays est varié » et « on le voit ».
      const vu = new Set<number>()
      for (const depart of dessus) {
        if (vu.has(depart)) continue
        const pile = [depart]
        vu.add(depart)
        const terrains = new Set<number>()
        while (pile.length > 0) {
          const j = pile.pop()!
          terrains.add(et.terrain[rang.get(j)!]!)
          const x = j % map.width
          const y = (j - x) / map.width
          for (const [vx, vy] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
            const k = vy * map.width + vx
            if (!dessus.has(k) || vu.has(k)) continue
            vu.add(k)
            pile.push(k)
          }
        }
        if (terrains.size < 2) monochromes += 1
      }
    }
    expect(total, 'la garde ne peut pas passer à vide').toBeGreaterThan(1000)
    // VARIÉ, et pas d'une variété de façade : chaque terrain présent pèse au moins un vingtième.
    expect(compte.size, 'plusieurs terrains sur les plateaux du pays').toBeGreaterThanOrEqual(3)
    for (const [t, n] of compte) {
      expect(n / total, `le terrain ${t} n’est pas une miette`).toBeGreaterThan(0.05)
    }
    expect(monochromes, 'aucun plateau d’un seul terrain').toBe(0)
  })

  it('le monde joué SÈME sur ses plateaux — et jamais sur la lèvre sud ni sur une rampe', () => {
    const nodes = placeZoneNodes(carte)
    // « Sur un plateau » = l'étage est ÉCRIT (T-R3 : un nœud posé sur le sol de sa tuile n'en a
    // pas, quel que soit le palier de ce sol) — et c'est l'étage de la mesa, 1, 2 ou 3 selon
    // le palier de son assise.
    const haut = nodes.filter((n) => n.etage !== undefined)
    expect(haut.length, 'la garde ne peut pas passer à vide').toBeGreaterThan(40)
    const portes = new Set((map.connecteurs ?? []).map((c) => c.y * map.width + c.x))
    for (const n of haut) {
      const i = n.ty * map.width + n.tx
      const dedans = new Set(etageDe(map, n.etage!)?.idx ?? [])
      expect(dedans.has(i), `(${n.tx},${n.ty}) est bien sur l’étage ${n.etage}`).toBe(true)
      // UNE PORTE N'EST PAS UN JARDIN : un bloc sur la rampe murerait la seule entrée — c'est le
      // défaut que `CREUX.RAMPE_LARGEUR` a déjà eu à réparer une fois, on ne le rouvre pas.
      expect(portes.has(i), `(${n.tx},${n.ty}) n’est pas une rampe`).toBe(false)
    }
  })

  it('AUCUN NŒUD FANTÔME SUR UN PLATEAU — la tuile vide reste vide, sur toute la carte', () => {
    /**
     * ⚠ **LE DÉFAUT QU'ALEXIS A RENCONTRÉ EN JEU (2026-09-01)** : *« si on monte par la colonne
     * la plus à droite, on est bloqué en haut de la rampe »*. La tête de la rampe de la mesa
     * (577..579, 377) portait un rocher INVISIBLE — celui de (595, 376), seize tuiles à l'est et
     * un étage plus bas, que la clé de `nodeIndexFor` confondait avec elle. MESURÉ avant
     * correctif : **184 fantômes bloquants** sur les 4 950 tuiles d'étage de cette graine.
     *
     * La garde balaie TOUT l'étage et lit la SORTIE (jamais la clé, qui est privée) : le nœud
     * rendu pour une tuile doit être posé SUR cette tuile, à CET étage. Ce qui la ferait rougir :
     * remettre le facteur d'étage à `16 * NODE_INDEX_STRIDE` (vérifié à la main — 184 tuiles
     * rouges sur la graine 2026).
     */
    const nodes = placeZoneNodes(carte)
    const et = etageDe(map, 1)!
    for (const i of et.idx) {
      const x = i % map.width
      const y = (i - x) / map.width
      const n = nodeAt(map, nodes, x, y, 1)
      if (n === undefined) continue
      expect(`${n.tx},${n.ty},${n.etage ?? 0}`, `le nœud rendu en (${x},${y}) à +1`).toBe(`${x},${y},1`)
    }
    // Et le miroir : chaque nœud SEMÉ se retrouve à sa propre tuile, à son propre étage — un
    // aliasing peut aussi MASQUER (l'index garde le premier), et ce sens-là ne se voit pas
    // en balayant les tuiles vides.
    for (const n of nodes) {
      const rendu = nodeAt(map, nodes, n.tx, n.ty, n.etage)!
      expect(`${rendu.tx},${rendu.ty},${rendu.etage ?? 0}`, `nœud ${n.id} en (${n.tx},${n.ty})`)
        .toBe(`${n.tx},${n.ty},${n.etage ?? 0}`)
    }
  })

  it('E-A6 — LA CARTE GÉNÉRALE IGNORE LES ÉTAGES : la vignette rend la même image, au pixel près', () => {
    const avec = renderVignette(map)
    const sansEtages: WorldMap = { ...map }
    delete sansEtages.etages
    delete sansEtages.connecteurs
    const sans = renderVignette(sansEtages)
    expect(sans.w).toBe(avec.w)
    expect(sans.h).toBe(avec.h)
    expect(Array.from(sans.rgb)).toEqual(Array.from(avec.rgb))
  })

  it('E-A8 — le monde sans étage ne paie rien : la collision reprend le chemin d’avant', () => {
    // `etages` absent sur le MoveWorld = le corps historique, mot pour mot. On l'affirme sur
    // la seule chose qui compte : la réponse, sur un balayage du plan autour d'une mesa.
    const etage = etageDe(map, 1)!
    const x0 = etage.idx[0]! % map.width
    const y0 = (etage.idx[0]! - x0) / map.width
    for (let y = y0 - 4; y < y0 + 12; y++) {
      for (let x = x0 - 4; x < x0 + 12; x++) {
        expect(isBlockedAt({ map }, x, y)).toBe(MARCHABLE[terrainAt(map, x, y)] !== 1)
      }
    }
  })
})

/* ═══════ UNE CARTE À PART ENTIÈRE : LES NŒUDS, ET LA FAUNE QUI MONTE ═══════ */

describe('les nœuds ont un étage', () => {
  it('DEUX NŒUDS PARTAGENT UNE TUILE — un par plancher — et l’index ne les confond pas', () => {
    /**
     * ⚠ **LA GARDE À PASSER AVANT DE SEMER QUOI QUE CE SOIT.** `nodeIndexFor` mémoïse par
     * `tx * STRIDE + ty` et garde LE PREMIER (`if (!idx.has(key))`). Depuis que le dessus d'une
     * mesa porte ses propres nœuds, deux nœuds partagent légitimement une tuile — et sans l'étage
     * dans la clé, le second devenait invisible. Tous les symptômes aval (un arbre qu'on ne peut
     * pas couper, un bloc qui barre le mauvais plancher) remonteraient ici en ayant l'air
     * d'autre chose.
     */
    const bas: ResourceNode = { id: 1, type: 'rock', tx: 12, ty: 12, stock: 3, regrowAt: 0 }
    const haut: ResourceNode = { id: 2, type: 'berry_bush', tx: 12, ty: 12, etage: 1, stock: 3, regrowAt: 0 }
    const nodes = [bas, haut]
    const plat = createEmptyMap(24, 24, TERRAIN_GRASS)
    expect(nodeAt(plat, nodes, 12, 12), 'le sol rend le sien').toBe(bas)
    expect(nodeAt(plat, nodes, 12, 12, 1), 'le plateau rend le sien').toBe(haut)
    expect(nodeAt(plat, nodes, 12, 12, 2), 'un étage vide ne rend rien').toBeUndefined()
  })

  it('un bloc du SOL ne barre pas le pas de qui marche au-dessus, et réciproquement', () => {
    const map = mesaDeLabo()
    const bloc: ResourceNode = { id: 1, type: 'rock', tx: CAP_X0 + 1, ty: CAP_Y0 + 1, stock: 3, regrowAt: 0 }
    const dessus: ResourceNode = { ...bloc, id: 2, etage: 1 }
    // Le bloc est AU SOL : il ne barre rien à l'étage 1 (on y marche vingt pixels plus haut).
    expect(isBlockedAt({ map, nodes: [bloc], etages: [1] }, bloc.tx, bloc.ty)).toBe(false)
    // Le même bloc POSÉ EN HAUT barre, lui — et seulement là.
    expect(isBlockedAt({ map, nodes: [dessus], etages: [1] }, bloc.tx, bloc.ty)).toBe(true)
  })

  it('LA CLÉ DE L’INDEX EST INJECTIVE : aucune tuile n’emprunte le nœud d’une autre', () => {
    /**
     * ⚠ **LA GARDE QUI MANQUAIT LE 2026-08-31.** L'étage entrait bien dans la clé — mais avec un
     * facteur de `16 * NODE_INDEX_STRIDE`, c'est-à-dire **seize tuiles de `tx`** et non seize
     * cartes : `(tx, ty, e)` et `(tx + 16, ty, e − 1)` avaient la MÊME clé. La garde d'à côté ne
     * pouvait pas le voir — elle interroge une tuile où les deux nœuds existent VRAIMENT, et
     * l'aliasing frappe là où le nœud demandé N'EXISTE PAS.
     *
     * On l'affirme donc sur la SORTIE et par BALAYAGE : pour un semis d'une seule tuile, toute
     * autre tuile de la fenêtre — le décalage fautif compris — ne rend rien. Ce qui la ferait
     * rougir : rendre au facteur d'étage une valeur inférieure à `NODE_INDEX_STRIDE²` (vérifié à
     * la main avec `16 * NODE_INDEX_STRIDE` : rouge sur `(x + 16k, y)` à l'étage `1 − k`, le
     * balayage l'attrape d'abord en `(x + 32, y)` à l'étage −1).
     */
    const seul: ResourceNode = { id: 1, type: 'rock', tx: 600, ty: 400, etage: 1, stock: 3, regrowAt: 0 }
    const nodes = [seul]
    const plat = createEmptyMap(700, 500, TERRAIN_GRASS)
    for (let e = -2; e <= 2; e++) {
      for (let dy = -40; dy <= 40; dy++) {
        for (let dx = -40; dx <= 40; dx++) {
          const attendu = dx === 0 && dy === 0 && e === 1 ? seul : undefined
          expect(nodeAt(plat, nodes, seul.tx + dx, seul.ty + dy, e), `(${dx},${dy}) étage ${e}`).toBe(attendu)
        }
      }
    }
  })

})

describe('une rampe est une entaille : on n’en sort pas par les joues', () => {
  /**
   * *Alexis, 2026-09-01 : « j'arrive à sortir de la rampe par les côtés, on ne peut traverser que
   * dans le sens de la rampe ».* Le DESSIN peint déjà des joues de roche de part et d'autre de
   * l'entaille (`plateau-art.ts`) : on traversait de la pierre — et l'on en sortait À MI-HAUTEUR,
   * donc en retombant d'un coup au niveau du pierrier.
   *
   * ⚠ CE QUI FERAIT ROUGIR, énoncé avant d'accepter le vert : retirer la fermeture (`joueDeRampe`)
   * — le pas vers l'ouest depuis la colonne de gauche redevient libre ; ou la poser sur TOUTE la
   * rangée — le pas ENTRE deux colonnes de la même rampe se ferme aussi, et la porte de trois
   * tuiles n'en fait plus qu'une.
   */
  const RAMPE_Y = CAP_Y0 + CAP_N
  /** La mesa de labo, mais avec la rampe LARGE de trois tuiles — celle du monde joué. */
  function mesaLarge(): WorldMap {
    const map = mesaDeLabo()
    const xs = [RAMPE.x - 1, RAMPE.x, RAMPE.x + 1]
    const tuiles = new Set(map.etages![0]!.idx)
    for (const x of xs) tuiles.add(RAMPE_Y * map.width + x)
    const idx = [...tuiles].sort((a, b) => a - b)
    map.etages = [{ ...map.etages![0]!, idx, terrain: idx.map(() => TERRAIN_SCREE) }]
    map.connecteurs = xs.map((x) => ({ x, y: RAMPE_Y, de: 0, vers: 1, type: 'rampe' as const }))
    return map
  }
  const pasX = (map: WorldMap, x: number, y: number, dx: -1 | 1): number =>
    moveAvatar({ map }, x, y, dx, 0, 1 / BALANCE.TICK_RATE_HZ).x - x

  it('LA JOUE SE FERME — le corps s’y arrête et ne la franchit JAMAIS', () => {
    const map = mesaLarge()
    const demi = BALANCE.AVATAR_HITBOX_TILES / 2
    // Les bords de l'entaille, en coordonnées de monde : trois tuiles, de `x0` à `x1`.
    const x0 = RAMPE.x - 1
    const x1 = RAMPE.x + 2
    // ⚠ ON POUSSE JUSQU'À L'ARRÊT, on n'exige pas qu'UN pas soit nul : le corps a le droit
    // d'avancer tant que son bord n'a pas atteint la joue — c'est ce que fait le reste de la
    // collision. Ce qu'on affirme, c'est qu'il ne la franchit pas, d'où qu'il parte.
    //
    // ⚠ ET ON PART DE POSITIONS QUE LE JEU PEUT PRODUIRE : sous une demi-hitbox du bord, le corps
    // CHEVAUCHE déjà la joue — un état que la fermeture rend inatteignable (on ne peut pas
    // entrer), et dont on ne veut surtout pas faire une prison si un TP l'y met.
    // On balaie TOUTE la largeur où un corps peut se tenir : de la joue ouest à la joue est.
    for (let px0 = x0 + demi; px0 <= x1 - demi + 1e-9; px0 += 0.1) {
      for (const dir of [-1, 1] as const) {
        let px = px0
        for (let k = 0; k < 40; k++) px = moveAvatar({ map }, px, RAMPE_Y + 0.5, dir, 0, 1 / BALANCE.TICK_RATE_HZ).x
        expect(px, `${dir < 0 ? 'ouest' : 'est'} depuis ${px0.toFixed(3)}`)
          .toBeGreaterThanOrEqual(x0 + demi - 1e-9)
        expect(px, `${dir < 0 ? 'ouest' : 'est'} depuis ${px0.toFixed(3)}`)
          .toBeLessThanOrEqual(x1 - demi + 1e-9)
      }
    }
  })

  it('…MAIS LA PORTE FAIT BIEN TROIS TUILES : on passe d’une colonne à l’autre', () => {
    const map = mesaLarge()
    expect(pasX(map, RAMPE.x - 0.5, RAMPE_Y + 0.5, 1), 'ouest → milieu').toBeGreaterThan(0)
    expect(pasX(map, RAMPE.x + 0.5, RAMPE_Y + 0.5, 1), 'milieu → est').toBeGreaterThan(0)
    expect(pasX(map, RAMPE.x + 0.5, RAMPE_Y + 0.5, -1), 'milieu → ouest').toBeLessThan(0)
  })

  it('ON N’ENTRE PAS NON PLUS PAR LE FLANC — sinon on serait soulevé depuis le sol', () => {
    const map = mesaLarge()
    const demi = BALANCE.AVATAR_HITBOX_TILES / 2
    // On pousse vingt pas contre la joue depuis le dehors : le corps vient s'y coller, et son
    // bord ne dépasse jamais la limite de l'entaille.
    let ouest = RAMPE.x - 2.5
    for (let k = 0; k < 20; k++) ouest = moveAvatar({ map }, ouest, RAMPE_Y + 0.5, 1, 0, 1 / BALANCE.TICK_RATE_HZ).x
    expect(ouest + demi, 'le bord est, venu de l’ouest').toBeLessThanOrEqual(RAMPE.x - 1 + 1e-9)
    let est = RAMPE.x + 3.5
    for (let k = 0; k < 20; k++) est = moveAvatar({ map }, est, RAMPE_Y + 0.5, -1, 0, 1 / BALANCE.TICK_RATE_HZ).x
    expect(est - demi, 'le bord ouest, venu de l’est').toBeGreaterThanOrEqual(RAMPE.x + 2 - 1e-9)
  })

  it('ET RIEN N’EST FERMÉ AILLEURS : la rangée d’à côté se longe librement', () => {
    const map = mesaLarge()
    for (const y of [RAMPE_Y + 1.5, RAMPE_Y + 2.5]) {
      expect(pasX(map, RAMPE.x - 1.5, y, 1), `rangée ${y}`).toBeGreaterThan(0)
      expect(pasX(map, RAMPE.x + 2.5, y, -1), `rangée ${y}`).toBeLessThan(0)
    }
    // Et le nord-sud de la rampe reste ouvert : une entaille se quitte toujours par où l'on vient.
    const map2 = mesaLarge()
    const sud = moveAvatar({ map: map2 }, RAMPE.x + 0.5, RAMPE_Y + 0.5, 0, 1, 1 / BALANCE.TICK_RATE_HZ)
    expect(sud.y, 'on redescend').toBeGreaterThan(RAMPE_Y + 0.5)
  })
})

describe('la faune monte — un plateau n’est plus un sanctuaire', () => {
  it('UN LOUP QUI VOUS TIENT VOUS SUIT SUR LE PLATEAU (décision d’Alexis, 2026-09-01)', () => {
    /**
     * La retenue traverse les planchers, l'ACQUISITION non : un loup ne vous CHOISIT pas à
     * travers douze mètres de roche (E-R5), mais celui qui vous tient déjà ne vous perd pas
     * parce que vous avez monté une rampe — c'est la doctrine de `chooseQuarry`, la même que
     * pour la furtivité et la pluie. Le plateau est un DÉTOUR, pas un sanctuaire.
     */
    const sim = createSim(SEED, {
      map: mesaDeLabo(), faunaCap: 0, worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(2, 1),
    })
    const proie = spawnEntity(sim, CAP_X0 + 2.5, CAP_Y0 + 1.5)
    sim.entities.find((e) => e.id === proie)!.etage = 1
    const loupId = spawnMonster(sim, 'wolf', RAMPE.x + 0.5, RAMPE.y + 2.5)
    const m = sim.monsters.find((mm) => mm.entityId === loupId)!
    m.faim = 1
    m.sortie = true
    m.targetId = proie // il vous TIENT déjà : il vous a vu monter
    let monte = false
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ && !monte; t++) {
      step(sim, [])
      const e = sim.entities.find((en) => en.id === loupId)
      if (e === undefined) break
      m.faim = 1
      m.sortie = true
      m.targetId = proie
      if ((e.etage ?? 0) === 1) monte = true
    }
    expect(monte, 'le loup a pris la rampe').toBe(true)
  })

  it('LA PRÉMISSE : sans rampe, il ne monte pas — la garde peut échouer', () => {
    const sim = createSim(SEED, {
      map: mesaDeLabo({ sansConnecteur: true }), faunaCap: 0, worldEvents: false,
      cycleOffset: cycleOffsetForStartHour(2, 1),
    })
    const proie = spawnEntity(sim, CAP_X0 + 2.5, CAP_Y0 + 1.5)
    sim.entities.find((e) => e.id === proie)!.etage = 1
    const loupId = spawnMonster(sim, 'wolf', RAMPE.x + 0.5, RAMPE.y + 2.5)
    const m = sim.monsters.find((mm) => mm.entityId === loupId)!
    m.faim = 1
    m.sortie = true
    m.targetId = proie
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
      step(sim, [])
      const e = sim.entities.find((en) => en.id === loupId)
      if (e === undefined) break
      m.faim = 1
      m.sortie = true
      m.targetId = proie
      expect(e.etage ?? 0, 'aucune porte : il reste en bas').toBe(0)
    }
    expect(sim.entities.find((e) => e.id === proie)!.hp, 'et la proie est intacte').toBe(100)
  })
})

/* ─────────────────── LA FAUNE RESTE AU SOL (périmètre assumé) ─────────────────── */

describe('périmètre de la tranche : seul l’avatar monte', () => {
  it('une bête n’a pas d’étage — elle vit au sol, et la garde le DIT plutôt que de le taire', () => {
    const sim = createSim(SEED, { map: mesaDeLabo(), faunaCap: 0, worldEvents: false })
    const loupId = spawnMonster(sim, 'wolf', RAMPE.x + 0.5, RAMPE.y + 3.5)
    const m = sim.monsters.find((mm) => mm.entityId === loupId)!
    m.faim = 1
    m.sortie = true
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])
    const e = sim.entities.find((en) => en.id === loupId)
    // Elle n'a jamais d'`etage` : `moveToward` ne passe pas par `etagesDuPas` (increment 2).
    if (e !== undefined) expect(e.etage).toBeUndefined()
    expect(FAUNA.LEAP_RANGE).toBeGreaterThan(0) // ancre : la faune est bien celle du vrai jeu
  })
})
