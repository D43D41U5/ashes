import { describe, expect, it } from 'vitest'
import {
  avanceeDuFront,
  buildPoiStructures,
  createSim,
  estCendre,
  seasonDayAtTick,
  spawnPoiMonsters,
  TICKS_PER_SEASON_DAY,
  zoneSlugAt,
} from '@ashes/sim'
import { baseDeNaissance, createZone, LAN_SEED, MAX_PLAYERS, nextSpawnNear } from './scenario'

/**
 * OÙ LA VALLÉE LAN FAIT-ELLE NAÎTRE SES JOUEURS ?
 *
 * Ce test bâtit le monde de PRODUCTION (seed 2026, carte 1581×2372) : il coûte ~13 s. Il
 * les vaut, parce que c'est le seul endroit où l'on peut vérifier la chose qu'aucun type
 * ne dit — que le multi commence là où le jeu est jouable.
 *
 * CE QU'IL GARDE. `createZone` prenait `emplacements[0]`, « le premier emplacement venu ».
 * MESURÉ sur la carte de production : les cinq premiers emplacements viables sont dans
 * `brule` — LA TERRE BRÛLÉE —, et le site retenu tombait à **1 003 tuiles** des Prés Bas.
 * Le serveur multi faisait donc naître tout le monde dans la cendre, pendant que le solo
 * commençait dans la zone nourricière. Les 17 points rendus par `pointsDeSpawn`, eux, sont
 * TOUS dans `pres_bas` — c'est sa raison d'être (spec R18), et le semis est même
 * dimensionné pour ce serveur (`worker/veillee.ts` : « cinquante joueurs y naîtraient sans
 * se marcher dessus »).
 *
 * Rien ne signalait l'écart : les deux hôtes compilent, les deux mondes existent, et il
 * faut ouvrir la carte pour voir que ce ne sont pas les mêmes.
 */
describe('la vallée LAN — le monde de production', () => {
  const monde = createZone()

  it('fait naître les joueurs dans les PRÉS BAS, pas dans la terre brûlée', () => {
    expect(zoneSlugAt(monde.sim.map, monde.base.tx, monde.base.ty)).toBe('pres_bas')
  })

  it('le foyer de la sim est bien posé sur ce site', () => {
    // `home` pilote la température, la milice et le respawn : il doit suivre la base.
    expect(monde.sim.home).toEqual({ x: monde.base.tx + 0.5, y: monde.base.ty + 0.5 })
  })

  it('les 50 joueurs naissent sur des tuiles DISTINCTES et marchables', () => {
    // L'anneau de spawn est déterministe ; deux index différents ne doivent pas se
    // superposer, sinon deux joueurs se réveillent dans le même corps de tuile.
    const vus = new Set<string>()
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const s = nextSpawnNear(monde.sim.map, monde.base, i)
      vus.add(`${s.x},${s.y}`)
    }
    expect(vus.size).toBe(MAX_PLAYERS)
  })

  it('le monde porte de quoi jouer (garde de non-vacuité)', () => {
    expect(monde.sim.nodes.length).toBeGreaterThan(10_000)
    expect(monde.sim.grounds.length).toBeGreaterThan(0)
  })

  /**
   * LA PARITÉ D'AMORCE (spec lieux-batis A5). La Veillée bâtit ses lieux à l'amorce
   * (`worker/veillee.ts` : createSim → spawnPoiMonsters → buildPoiStructures) ; la zone
   * LAN doit porter LES MÊMES MURS. Elle ne les portait pas : en multi, la Ferme ruinée
   * était un sprite traversant — les joueurs LAN ne jouaient pas le monde du solo.
   *
   * On rejoue ici l'amorce de RÉFÉRENCE sur la même carte, dans le même ordre, avec le
   * même seed. Les deux peuplements sont POSITIONNELS (hash de la carte, jamais le PRNG
   * partagé — contrat A6) : les structures doivent être identiques au bit près, ids compris.
   */
  it("porte les mêmes murs qu'un monde solo — la parité d'amorce", () => {
    const ref = createSim(LAN_SEED, { map: monde.carte.map })
    spawnPoiMonsters(ref, LAN_SEED)
    buildPoiStructures(ref, LAN_SEED)
    expect(ref.structures.length, 'la référence ne bâtit rien : ce test ne garderait rien').toBeGreaterThan(0)
    expect(monde.sim.structures).toEqual(ref.structures)
  })

  /**
   * R30 — « LE SERVEUR TOURNE DES SEMAINES ».
   *
   * La règle est écrite dans `pointsDeSpawn` (spec R30, décision d'Alexis) et sa
   * justification nomme ce serveur : *« si les Prés Bas sont sous la cendre au jour 30,
   * celui qui rejoint au jour 31 naîtrait DANS LE FEU — il ne jouerait pas au même jeu que
   * les autres »*. Elle n'était pas appliquée : la base de naissance était calculée au
   * jour 0 et ne bougeait plus jamais.
   *
   * On avance l'horloge de la sim (le tick EST le calendrier) et on regarde où naît celui
   * qui arrive ce jour-là. Aucun `step` n'est joué : `baseDeNaissance` est une lecture pure
   * du tick et de la carte, exactement comme le front lui-même.
   */
  const jour = (d: number): number => d * TICKS_PER_SEASON_DAY * monde.sim.calendarScale

  it("l'acte I ne déplace personne — le comportement de L1 est intact", () => {
    for (const d of [0, 5, 15, 21]) {
      monde.sim.tick = jour(d)
      expect(baseDeNaissance(monde), `jour ${d}`).toEqual(monde.base)
    }
  })

  it('personne ne naît jamais dans la cendre, quel que soit le jour de la saison', () => {
    const cendreMax = monde.sim.map.cendreMax!
    expect(cendreMax).toBeGreaterThan(0) // la carte porte bien une Cendrière
    for (let d = 0; d <= 60; d += 2) {
      monde.sim.tick = jour(d)
      const front = avanceeDuFront(seasonDayAtTick(monde.sim.tick, monde.sim.calendarScale), cendreMax)
      const b = baseDeNaissance(monde)
      expect(estCendre(monde.sim.map, b.tx, b.ty, front), `jour ${d} : né dans la cendre en (${b.tx},${b.ty})`).toBe(false)
      // …et l'anneau serré autour d'elle reste marchable : on ne naît pas dans un mur.
      const s = nextSpawnNear(monde.sim.map, b, 0)
      expect(Number.isFinite(s.x) && Number.isFinite(s.y), `jour ${d}`).toBe(true)
    }
    monde.sim.tick = 0
  })

  /**
   * LE TEST PRÉCÉDENT NE SUFFIT PAS, ET IL FAUT LE DIRE : sur la seed 2026, MESURÉ, la base
   * des Prés Bas n'est JAMAIS atteinte par le front, même à son maximum (247 au jour 60).
   * Il vérifie donc une propriété vraie… sans jamais emprunter la branche qu'il prétend
   * garder. Un test qui ne peut pas échouer ne garde rien.
   *
   * On force donc la condition sur la VRAIE carte : on marque la tuile de la base comme
   * appartenant au tout premier anneau de cendre (distance 0), ce qui la fait brûler dès
   * que le front s'ébranle. C'est le seul moyen d'exercer réellement le relogement.
   */
  it('RELOGE vraiment quand la base brûle — la branche R30, exercée', () => {
    // On mute la carte DU SEMIS (`carte.map`), pas la copie de la sim : `createSim` copie
    // profondément ses options, et c'est `carte.map` que `pointsDeSpawn` consulte.
    const champ = monde.carte.map.cendre as unknown as number[]
    const i = monde.base.ty * monde.carte.map.width + monde.base.tx
    const avant = champ[i]!
    try {
      champ[i] = 0 // cette tuile part au premier souffle
      monde.sim.tick = jour(40) // acte III : le front est largement ouvert
      const front = avanceeDuFront(seasonDayAtTick(monde.sim.tick, monde.sim.calendarScale), monde.carte.map.cendreMax!)
      expect(estCendre(monde.carte.map, monde.base.tx, monde.base.ty, front)).toBe(true) // la base a bien brûlé
      const b = baseDeNaissance(monde)
      expect(b, 'la base aurait dû être abandonnée').not.toEqual(monde.base)
      expect(estCendre(monde.carte.map, b.tx, b.ty, front), 'relogé dans la cendre').toBe(false)
      expect(zoneSlugAt(monde.sim.map, b.tx, b.ty)).toBe('pres_bas') // et toujours dans la zone nourricière
    } finally {
      champ[i] = avant
      monde.sim.tick = 0
    }
  })
}, 60_000)
