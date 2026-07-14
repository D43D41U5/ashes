/**
 * LES GARDES DU FRONT DE CENDRE — spec `worldgen.md` R27-R31.
 *
 * Ce qu'elles protègent n'est pas un détail d'équilibrage : c'est la promesse centrale de la
 * saison. Si le front ne part pas, la vallée ne se perd pas. S'il va trop loin, il ne reste plus
 * un endroit où naître, et celui qui rejoint au jour 40 ne joue pas au même jeu que les autres.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE } from './balance'
import { avanceeDuFront, CENDRE, estCendre, partSousLaCendre } from './cendre'
import { generateZonedTerrain } from './zonegen'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { MONDE } from './zonegraph'
import { createSim, spawnEntity, step } from './sim'
import { drainEvents } from './events'

const carte = generateZonedTerrain(2026)
const racine = carte.graphe.racine
const cendriere = carte.graphe.zones.find((z) => z.def.slug === 'cendriere')!
/** L'avancée maximale du front — CALIBRÉE POUR CETTE CARTE, pas une constante. */
const MAX = carte.map.cendreMax!
const frontAu = (jour: number): number => avanceeDuFront(jour, MAX)

/**
 * La part des Prés Bas sous la cendre, au jour donné — **les seuils exclus**.
 *
 * Un couloir de seuil n'appartient à AUCUNE des deux zones qu'il relie : le percement le
 * réaffecte à l'une d'elles pour son sol, mais géométriquement il est DANS la falaise. La gorge
 * qui mène à la Cendrière est donc déjà dans le feu au jour 1 — et c'est juste : c'est une gorge
 * de cendre, pas un pré. On ne la compte pas parmi les Prés Bas.
 */
const partDeLaRacine = (jour: number): number =>
  partSousLaCendre(carte.map, frontAu(jour), (i) => carte.zone[i] === racine && !carte.rampe[i])

describe('le front de cendre', () => {
  it('R27 — la CENDRIÈRE brûle depuis le premier jour, et elle seule', () => {
    // Une tuile de la Cendrière a une distance NÉGATIVE : elle est dedans. Le front à zéro la
    // brûle donc déjà — c'est chez elle que la cendre tombe, c'est le sens du nom.
    // On ne compte QUE le sol : les marges de VIDE se rattachent à la région la plus proche (il faut
    // bien qu'un échantillon réponde), mais une crevasse n'a rien à brûler.
    const dedans = partSousLaCendre(
      carte.map,
      0,
      (i) => carte.zone[i] === cendriere.id && carte.map.terrain[i] !== 0,
    )
    expect(dedans, 'la Cendrière ne brûle pas').toBeGreaterThan(0.9)
    // Et les Prés Bas, eux, sont INTACTS au jour 1. On y meurt de faim, pas de cendre.
    expect(partDeLaRacine(1), 'les Prés Bas brûlent déjà au jour 1').toBe(0)
  })

  it('R27 — l\'ACTE I est un répit : le front ne bouge pas', () => {
    // Le joueur a le temps de bâtir, de s'attacher, et de croire que ça durera. C'est ce qui rend
    // la suite cruelle — et c'est le calendrier du GDD, à la lettre.
    const finActeI = BALANCE.ACT_BOUNDARIES[0]!
    for (let jour = 1; jour <= finActeI; jour++) {
      expect(frontAu(jour), `le front bouge au jour ${jour} (acte I)`).toBe(0)
    }
    expect(frontAu(finActeI + 1)).toBeGreaterThan(0)
  })

  it('R27 — le front ACCÉLÈRE : la moitié du temps n\'a mangé qu\'un quart du chemin', () => {
    const debut = BALANCE.ACT_BOUNDARIES[0]!
    const milieu = debut + Math.round((BALANCE.SEASON_DAYS - debut) / 2)
    const aMiChemin = frontAu(milieu) / MAX
    // Une progression linéaire donnerait 0,5. Une menace qu'on s'habitue à voir bouger n'en est
    // plus une : celle-ci, on croit la maîtriser — jusqu'au jour où elle traverse le village.
    expect(aMiChemin).toBeGreaterThan(0.2)
    expect(aMiChemin).toBeLessThan(0.33)
    expect(frontAu(BALANCE.SEASON_DAYS)).toBeCloseTo(MAX, 0)
  })

  it('R29 — la cendre mange une GROSSE PART des Prés Bas, sans les effacer', () => {
    // Décision d'Alexis : « elle en mange une grosse part ». Les villages du sud doivent partir,
    // ceux du nord tiennent. **La vallée rétrécit sans disparaître** — et c'est ce qui garantit
    // qu'il reste toujours un endroit où naître (R30).
    // ET C'EST EXACT, PAS APPROCHÉ. Le front est calibré PAR CARTE (dichotomie à la génération) :
    // à distance fixe, la même valeur couvrait 48 % des Prés Bas sur une seed et 81 % sur une
    // autre. Une saison = une carte : on ne tire pas au sort si la vallée brûle à moitié ou aux
    // quatre cinquièmes.
    const fin = partDeLaRacine(BALANCE.SEASON_DAYS)
    expect(fin, `la cendre couvre ${(fin * 100).toFixed(1)} % des Prés Bas`).toBeCloseTo(CENDRE.PART_CIBLE, 2)
  })

  it('R30 — IL RESTE TOUJOURS UN ENDROIT OÙ NAÎTRE, même au dernier jour', () => {
    // Sans cette garantie, celui qui rejoint le serveur au jour 40 naîtrait dans le feu — il ne
    // jouerait pas au même jeu que les autres. C'est la contrepartie indispensable de R29.
    const front = frontAu(BALANCE.SEASON_DAYS)
    const { width, height } = carte.map
    let refuges = 0
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const i = y * width + x
        if (carte.zone[i] !== racine) continue
        if (!estCendre(carte.map, x, y, front)) refuges += 1
      }
    }
    expect(refuges, 'plus une seule tuile vivante dans les Prés Bas au dernier jour').toBeGreaterThan(500)
  })

  it('la cendre AVANCE, monotone : ce qui a brûlé ne repousse pas', () => {
    const { width } = carte.map
    // Une tuile qui brûle au jour J brûle encore au jour J+1. C'est une propriété du modèle (le
    // front ne fait que croître), et la tester la protège d'une courbe mal écrite.
    const echantillons: number[] = []
    for (let k = 0; k < 400; k++) echantillons.push((k * 6197) % (carte.map.terrain.length))
    let precedent = 0
    for (let jour = 1; jour <= BALANCE.SEASON_DAYS; jour += 3) {
      const front = frontAu(jour)
      expect(front).toBeGreaterThanOrEqual(precedent)
      precedent = front
      for (const i of echantillons) {
        const x = i % width
        const y = (i - x) / width
        if (estCendre(carte.map, x, y, frontAu(jour - 3))) {
          expect(estCendre(carte.map, x, y, front), 'une tuile brûlée a repoussé').toBe(true)
        }
      }
    }
  })
}, 120_000)

describe('ce que la cendre DÉTRUIT', () => {
  it('R30 — le SPAWN RECULE devant le feu : personne ne naît dans la cendre', () => {
    const nodes = placeZoneNodes(carte)
    const emplacements = emplacementsDeVillage(carte, nodes)
    const combien = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)

    const auJour1 = pointsDeSpawn(carte, emplacements, combien, frontAu(1))
    const auDernier = pointsDeSpawn(carte, emplacements, combien, frontAu(BALANCE.SEASON_DAYS))

    // Le serveur tourne des semaines. Si les Prés Bas brûlent au jour 30, celui qui rejoint au
    // jour 31 ne doit PAS naître dans le feu — il ne jouerait pas au même jeu que les autres.
    expect(auDernier.length, 'plus un seul point de spawn au dernier jour').toBeGreaterThan(0)
    for (const s of auDernier) {
      expect(
        estCendre(carte.map, s.tx, s.ty, frontAu(BALANCE.SEASON_DAYS)),
        `on naît dans la cendre en (${s.tx}, ${s.ty})`,
      ).toBe(false)
    }
    // Et le refuge s'est DÉPLACÉ : la vallée a reculé, le point de naissance avec elle.
    expect(auDernier.length).toBeLessThan(auJour1.length)
  }, 120_000)

  it('la cendre BRÛLE LES NŒUDS — et le village s\'appauvrit avant de mourir', () => {
    // C'est ce qui fait que la migration n'est pas une consigne mais une FUITE : le village qui
    // reste ne meurt pas d'un coup, il s'appauvrit jour après jour, jusqu'à ce que rester coûte
    // plus cher que partir. Le mécanisme le plus doux qu'on puisse infliger, et le plus cruel.
    const front = frontAu(BALANCE.SEASON_DAYS)
    const nodes = placeZoneNodes(carte)
    const width = carte.map.width
    const survivants = nodes.filter((n) => !estCendre(carte.map, n.tx, n.ty, front))
    const brules = nodes.length - survivants.length
    expect(brules, 'la cendre ne brûle aucun nœud').toBeGreaterThan(1000)
    // …mais elle n'efface pas la vallée : il reste de quoi vivre ailleurs.
    expect(survivants.length).toBeGreaterThan(nodes.length * 0.5)
    // Et aucun survivant n'est dans le feu.
    for (const n of survivants.slice(0, 500)) {
      expect(carte.map.cendre![n.ty * width + n.tx]!).toBeGreaterThanOrEqual(front)
    }
  }, 120_000)
})

describe('le front, dans la BOUCLE (et non plus sur le papier)', () => {
  it('sauter à l\'acte III fait AVANCER la cendre et BRÛLER les nœuds', () => {
    // Sans le saut de jour, personne ne verrait jamais ce mécanisme : en Veillée, l'acte III
    // arrive au bout d'une heure et demie de jeu. Une mécanique qu'on ne peut pas ATTEINDRE est
    // une mécanique morte, et ce projet en a déjà enterré cinq.
    const nodes = placeZoneNodes(carte)
    const sim = createSim(2026, { map: carte.map, nodes, calendarScale: 720, debug: true })
    const joueur = spawnEntity(sim, 100, 100)
    const avant = sim.nodes.length

    // Jour 10 (acte I) : le front dort, rien ne brûle.
    step(sim, [{ entityId: joueur, dx: 0, dy: 0, action: { type: 'debug_set_season_day', day: 10 } }])
    step(sim, [{ entityId: joueur, dx: 0, dy: 0 }])
    expect(sim.nodes.length, 'la cendre a mangé pendant l\'acte I').toBe(avant)

    // Jour 60 (le dernier) : la vallée a reculé.
    drainEvents(sim)
    step(sim, [{ entityId: joueur, dx: 0, dy: 0, action: { type: 'debug_set_season_day', day: 60 } }])
    step(sim, [{ entityId: joueur, dx: 0, dy: 0 }])
    expect(sim.nodes.length, 'aucun nœud n\'a brûlé au dernier jour').toBeLessThan(avant)

    // Et le monde l'a DIT : un événement de domaine par jour, pas un par buisson.
    const events = drainEvents(sim)
    const avances = events.filter((e) => e.type === 'cendre_avance')
    expect(avances.length, 'la cendre a avancé en silence').toBeGreaterThanOrEqual(1)
    expect(avances[0]).toMatchObject({ type: 'cendre_avance' })
    expect((avances[0] as { noeudsBrules: number }).noeudsBrules).toBeGreaterThan(0)
  }, 120_000)
})
