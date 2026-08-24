import { describe, expect, it } from 'vitest'
import {
  buildPoiStructures,
  createSim,
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

  // RÉANCRÉ (S1/S11) : la Cendre mord au GRAND FROID (j91-120 de l'année), plus à partir de
  // ⚠ Depuis le 2026-08-24 la Cendre ne déplace plus personne À AUCUN jour : le front est
  // retiré. La fenêtre balayée court donc sur toute la saison, et non plus jusqu'à d = 39.
  it('la Cendre ne déplace personne — le comportement de L1 est intact', () => {
    for (const d of [0, 5, 15, 21, 39, 45, 60]) {
      monde.sim.tick = jour(d)
      expect(baseDeNaissance(monde), `jour ${d}`).toEqual(monde.base)
    }
  })

  // (« personne ne naît jamais dans la cendre » et « RELOGE vraiment quand la base brûle » :
  //  retirés le 2026-08-24 avec le front. Ils gardaient R30 — le centre de l'anneau de naissance
  //  suivait le front, et le second forçait la tuile de base à distance 0 pour exercer vraiment
  //  la branche de relogement. Plus rien ne brûle : `baseDeNaissance` rend la base, toujours, ce
  //  que le test précédent vérifie déjà sur toute la fenêtre.)

}, 60_000)
