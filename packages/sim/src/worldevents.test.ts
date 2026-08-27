import { describe, expect, it } from 'vitest'
import { BALANCE, CENDREUX, TEMPERATURE, TERRAIN_GRASS, TERRAIN_ROAD, TERRAIN_ROCK, WORLD_EVENTS } from './balance'
import { drainEvents, type SimEvent } from './events'
import { countOf } from './items'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { foundNpcVillage } from './worldgen'
import { computeFlowField } from './pathfinding'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type SimState } from './sim'
import { cycleOffsetForStartHour, dayTicksAt, seasonDayAtTick, seasonRamp, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { grantItems, structureAt } from './village'
import { spawnConvoy, spawnHorde } from './worldevents'

/**
 * LES JOURS-REPÈRES DE L'ANNÉE (spec `saisons.md` S1-S4) — dérivés de la cadence des saisons,
 * jamais écrits : l'année compte quatre saisons de `ACT_DAYS` jours, et ce qui commande la
 * pression n'est plus l'avancée dans un arc mais la place dans le TOUR. Le creux est au cœur
 * de l'Ardeur (nuit à +20 °C, les morts sont amorphes), le plein régime au cœur du Grand
 * Froid (nuit à −16 °C, sous le cran de fureur), et les Pluies sont la montée à mi-régime.
 */
const MI_ARDEUR = Math.round(BALANCE.ACT_DAYS * 1.5)
const MI_GRAND_FROID = Math.round(BALANCE.ACT_DAYS * 3.5)

/**
 * LA NUIT QUI MET LES MORTS À MI-RÉGIME — CHERCHÉE SUR LA COURBE, JAMAIS ÉCRITE.
 *
 * Le contrat A7(a) ne vise pas un jour, il vise un RÉGIME : assez froid pour que les goules
 * marchent (au cœur de l'Ardeur elles sont amorphes, `TORPEUR.CHAUD`), assez loin du cran de
 * fureur pour qu'aucun cri ne parte. C'était « la nuit d'acte II » quand l'arc allait dans un
 * seul sens ; sous l'année qui tourne, c'est un point de la MONTÉE des Pluies vers l'hiver —
 * et il se déplacerait si les cardinaux glissaient (S12). On le cherche donc au lieu de le
 * poser : le jour dont la nuit de plaine tombe au plus près du milieu de la plage de torpeur.
 */
const NUIT_A_MI_REGIME = ((): number => {
  const cible = (CENDREUX.TORPEUR.CHAUD + CENDREUX.TORPEUR.FROID) / 2
  const nuitDe = (j: number): number => TEMPERATURE.SOCLE(j, 1) - TEMPERATURE.ECART_NUIT(j)
  let elu = 2 * BALANCE.ACT_DAYS + 1
  for (let j = elu; j <= 3 * BALANCE.ACT_DAYS; j++) {
    if (Math.abs(nuitDe(j) - cible) < Math.abs(nuitDe(elu) - cible)) elu = j
  }
  return elu
})()

function run(sim: SimState, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(sim, [])
}

function collect(sim: SimState, kept: SimEvent['type'][]): SimEvent[] {
  return drainEvents(sim).filter((e) => kept.includes(e.type))
}

describe('le flow field (A1)', () => {
  it('le gradient contourne une chicane ; identique à chaque run', () => {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    // Deux murs de roche en chicane.
    for (let tx = 0; tx < 15; tx++) map.terrain[6 * 20 + tx] = TERRAIN_ROCK
    for (let tx = 5; tx < 20; tx++) map.terrain[12 * 20 + tx] = TERRAIN_ROCK
    const a = computeFlowField(map, [], [], 10, 2)
    const b = computeFlowField(map, [], [], 10, 2)
    expect(a).toEqual(b)
    // Depuis le sud (10, 18), la distance existe et dépasse largement la ligne droite.
    expect(a[18 * 20 + 10]).toBeGreaterThan(20)

    // Et une horde la remonte jusqu'au Feu.
    const sim = createSim(3, { map })
    foundNpcVillage(sim, 10, 2, 0) // village sans PNJ : personne ne défend
    const z = spawnMonster(sim, 'cendreux', 10.5, 18.5)
    sim.hordes.push({ id: 1, fireTx: sim.villages[0]!.fireTx, fireTy: sim.villages[0]!.fireTy, villageId: sim.villages[0]!.id, memberEntityIds: [z] })
    sim.nextHordeId = 2
    for (let t = 0; t < 3000; t++) {
      step(sim, [])
      const e = sim.entities.find((en) => en.id === z)
      if (e && Math.abs(e.x - 10.5) < 2 && Math.abs(e.y - 2.5) < 2) break
    }
    const e = sim.entities.find((en) => en.id === z)!
    expect(Math.abs(e.y - 2.5)).toBeLessThan(3) // arrivé au Feu malgré la chicane
  })
})

describe('les murs face à la horde (A2)', () => {
  function walledSim() {
    const map = createEmptyMap(20, 20, TERRAIN_GRASS)
    const sim = createSim(4, { map })
    foundNpcVillage(sim, 10, 5, 0)
    // Un mur barre le couloir sud (le seul accès n'est pas muré ailleurs,
    // mais le gradient passe par lui : la bête frappe ce qui la bloque).
    const owner = spawnEntity(sim, 10.5, 6.5)
    sim.villages[0]!.memberIds.push(owner)
    // Marteau EN MAIN : bâtir l'exige désormais (spec recolte.md G12).
    grantItems(sim, owner, { hammer: 1 })
    step(sim, [{ entityId: owner, dx: 0, dy: 0, action: { type: 'set_active_slot', slot: 0 } }])
    grantItems(sim, owner, { wood: 50 })
    for (let tx = 8; tx <= 12; tx++) {
      step(sim, [{ entityId: owner, dx: 0, dy: 0, action: { type: 'build', structure: 'wall', tx, ty: 8 } }])
    }
    return { sim, owner }
  }

  it('les Cendreux frappent le mur qui bloque, il casse, la horde passe', () => {
    const { sim, owner } = walledSim()
    // LE BÂTISSEUR SORT DU CADRE une fois son mur posé. Sans ça le test ne mesure plus ce
    // qu'il croit : le Cendreux voit l'homme (`aggroRange`), lâche la descente de gradient
    // pour le CHASSER, et **contourne** le mur par l'est — qui n'enferme rien (« le seul
    // accès n'est pas muré ailleurs »). Mesuré : il arrivait au but sans toucher la paroi.
    // Le zombie qu'il remplace ne le faisait pas, mais lui non plus n'aurait pas dû : ce
    // test parle de la HORDE qui coule vers le Feu, pas d'une bête qui poursuit un homme.
    sim.entities.find((e) => e.id === owner)!.x = 2.5
    sim.entities.find((e) => e.id === owner)!.y = 17.5
    const z = spawnMonster(sim, 'cendreux', 10.5, 12.5)
    sim.hordes.push({ id: 1, fireTx: sim.villages[0]!.fireTx, fireTy: sim.villages[0]!.fireTy, villageId: sim.villages[0]!.id, memberEntityIds: [z] })
    drainEvents(sim)
    const wall = structureAt(sim.structures, 10, 8)!
    for (let t = 0; t < 6000 && structureAt(sim.structures, 10, 8); t++) step(sim, [])
    expect(structureAt(sim.structures, 10, 8)).toBeUndefined()
    expect(drainEvents(sim).some((e) => e.type === 'structure_destroyed' && e.structureId === wall.id)).toBe(true)
  })

  it('réparé à temps, le mur tient (+50 PV par bois)', () => {
    const { sim, owner } = walledSim()
    const wall = structureAt(sim.structures, 10, 8)!
    wall.hp = 40
    step(sim, [{ entityId: owner, dx: 0, dy: 1 }]) // s'approcher du mur
    for (let t = 0; t < 20; t++) step(sim, [{ entityId: owner, dx: 0, dy: 1 }])
    step(sim, [{ entityId: owner, dx: 0, dy: 0, action: { type: 'repair', structureId: wall.id } }])
    expect(wall.hp).toBe(90)
  })
})

describe('l’alarme (A3)', () => {
  it('une seule alarme par vague ; les dormeurs se réveillent', () => {
    const sim = createSim(6, { map: createEmptyMap(30, 30, TERRAIN_GRASS) })
    foundNpcVillage(sim, 15, 15, 2)
    // Nuit : tout le monde dort. Le crépuscule est SAISONNIER (spec `saisons.md` S6) — on le
    // lit sur le cycle en cours au lieu de la constante d'avant, sans quoi on se poserait
    // en plein jour un jour sur deux.
    sim.tick = dayTicksAt(sim, sim.tick)
    for (const npc of sim.npcs) {
      npc.energy = 10
      npc.sleeping = true
    }
    drainEvents(sim)
    spawnMonster(sim, 'cendreux', 21, 15) // dans le rayon de 10
    run(sim, 30)
    const alarms = collect(sim, ['alarm_raised'])
    expect(alarms).toHaveLength(1)
    expect(sim.npcs.some((n) => !n.sleeping)).toBe(true) // la milice est debout
    run(sim, 60)
    expect(collect(sim, ['alarm_raised'])).toHaveLength(0) // pas de spam
  })
})

describe('les hordes nocturnes (A4, A5)', () => {
  it('spawn à la nuit, dissipation à l’aube ; plus grosses au Grand Froid qu’à l’Ardeur', { timeout: 30_000 }, () => {
    // Échelle : 1 tick ≈ 1 jour — non : on teste en cycle réel, saison forcée.
    const mkSim = (jour: number) => {
      const sim = createSim(8, {
        map: createEmptyMap(40, 40, TERRAIN_GRASS),
        calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE, // 1 cycle = 1 jour de saison
      })
      foundNpcVillage(sim, 20, 20, 0)
      // Un tick avant le CRÉPUSCULE du cycle visé — saisonnier depuis S6, donc relu sur le
      // cycle et non pris à une constante : la nuit d'hiver commence 3 h plus tôt que celle
      // d'été, et se poser sur l'ancienne heure fixe raterait la moitié des levées.
      const debut = (jour - 1) * TICKS_PER_CYCLE
      sim.tick = debut + dayTicksAt(sim, debut) - 1
      return sim
    }

    // AU CŒUR DE L'ARDEUR — le CREUX de l'année (S15 : la rampe lit `dureteDeLAnnee`, nulle
    // au cœur de l'été). On force la chance en essayant plusieurs nuits ; la taille est celle
    // de la RAMPE au jour joué (décision ⑭ — plus de table d'actes).
    let sim = mkSim(MI_ARDEUR)
    let spawned: SimEvent[] = []
    let nuitsJouees = 0
    for (let night = 0; night < 12 && spawned.length === 0; night++) {
      run(sim, TICKS_PER_CYCLE)
      nuitsJouees += 1
      spawned = [...spawned, ...collect(sim, ['horde_spawned'])]
    }
    // DOUZE NUITS AU PLUS, et c'est aussi une borne de SENS : au-delà on aurait quitté
    // l'Ardeur et mesuré la taille d'une autre saison. Mesuré : elle se lève à la 1re.
    expect(spawned.length, 'aucune horde levée en douze nuits d’Ardeur').toBeGreaterThan(0)
    const size1 = (spawned[0] as { size: number }).size
    // Le jour se lit sur le tick de la DÉCISION (l'aube qui a planifié), pas sur l'horloge
    // d'arrivée du test — les nuits jouées ont fait avancer le calendrier.
    const jour1 = seasonDayAtTick((spawned[0] as { tick: number }).tick, sim.calendarScale, sim.jourDeDepart)
    expect(size1).toBe(Math.round(seasonRamp(WORLD_EVENTS.HORDE_TAILLE.DEBUT, WORLD_EVENTS.HORDE_TAILLE.FIN, jour1)))
    void nuitsJouees
    // L'aube ne DISSIPE plus (décision ⑮) : elle FIGE — la liste des hordes se vide, mais
    // les corps restent (reliques, expiresAt), repris hors regard par le balayage.
    run(sim, TICKS_PER_CYCLE)
    expect(sim.hordes).toHaveLength(0)

    // AU CŒUR DU GRAND FROID : taille supérieure. Ce n'est plus « plus tard dans l'arc »,
    // c'est plus LOIN dans le tour — l'année qui boucle rendra l'Ardeur suivante douce à
    // nouveau (S15), la garde se lit donc entre deux SAISONS, jamais entre deux jours.
    sim = mkSim(MI_GRAND_FROID)
    spawned = []
    for (let night = 0; night < 12 && spawned.length === 0; night++) {
      run(sim, TICKS_PER_CYCLE)
      spawned = [...spawned, ...collect(sim, ['horde_spawned'])]
    }
    expect(spawned.length, 'aucune horde levée au cœur du Grand Froid').toBeGreaterThan(0)
    const size2 = (spawned[0] as { size: number }).size
    expect(size2).toBeGreaterThan(size1)
  })
})

describe('la carcasse de convoi (A6)', () => {
  it('apparaît sur la route, gardée ; son butin se ramasse', () => {
    const map = createEmptyMap(30, 30, TERRAIN_GRASS)
    for (let tx = 0; tx < 30; tx++) map.terrain[15 * 30 + tx] = TERRAIN_ROAD
    const sim = createSim(12, { map })
    drainEvents(sim)
    spawnConvoy(sim)
    const events = collect(sim, ['convoy_spawned'])
    expect(events).toHaveLength(1)
    const { tx, ty } = events[0] as { tx: number; ty: number }
    expect(map.terrain[ty * 30 + tx]).toBe(TERRAIN_ROAD)
    expect(sim.monsters).toHaveLength(WORLD_EVENTS.CONVOY_GUARDS)
    const corpse = sim.corpses[0]!
    expect(countOf(corpse.inventory, 'components')).toBe(2)

    // Un joueur ramasse (les gardiens sont écartés pour le test).
    for (const m of [...sim.monsters]) {
      sim.entities = sim.entities.filter((e) => e.id !== m.entityId)
    }
    sim.monsters = []
    const player = spawnEntity(sim, corpse.x, corpse.y)
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'loot_corpse', corpseId: corpse.id } }])
    expect(countOf(sim.entities.find((e) => e.id === player)!.inventory, 'iron_ingot')).toBe(3)
  })

  /**
   * LA FUITE DES GARDES (corrigée le 2026-07-31). `spawnConvoy` posait deux gardes tous les
   * deux jours de saison et **rien ne les retirait jamais** — ni dissipation d'ambiant, ni
   * décantation avec la carcasse, qui disparaît pourtant en deux cycles. MESURÉ avant : la
   * vallée passait de 5 à 39 Cendreux au jour 36, puis 75 en fin de saison, par ce seul
   * canal. Le bug était antérieur (les gardes étaient des zombies, tout aussi éternels) mais
   * il PORTAIT depuis que le Cendreux converge sur les feux et frappe les murs.
   */
  it('les gardes partent avec leur carcasse — et jamais sous les yeux de quelqu’un', () => {
    const map = createEmptyMap(30, 30, TERRAIN_GRASS)
    for (let tx = 0; tx < 30; tx++) map.terrain[15 * 30 + tx] = TERRAIN_ROAD
    const sim = createSim(3, { map })
    spawnConvoy(sim)
    const gardes = sim.monsters.filter((m) => m.expiresAt !== undefined)
    expect(gardes.length).toBe(WORLD_EVENTS.CONVOY_GUARDS)
    const quand = gardes[0]!.expiresAt!

    // ① UN TÉMOIN SUR PLACE : l'heure passe, ils restent. Une bête qui s'évapore devant
    //    vous, c'est le décor qui avoue.
    const garde = sim.entities.find((e) => e.id === gardes[0]!.entityId)!
    const temoin = spawnEntity(sim, garde.x, garde.y)
    sim.tick = quand
    step(sim, [])
    expect(sim.monsters.filter((m) => m.expiresAt !== undefined).length).toBe(WORLD_EVENTS.CONVOY_GUARDS)

    // ② PLUS PERSONNE : ils s'en vont, eux et leurs entités.
    const t = sim.entities.find((e) => e.id === temoin)!
    t.x = 1.5
    t.y = 1.5
    const avant = sim.entities.length
    step(sim, [])
    expect(sim.monsters.filter((m) => m.expiresAt !== undefined).length).toBe(0)
    expect(sim.entities.length).toBe(avant - WORLD_EVENTS.CONVOY_GUARDS) // aucune entité orpheline
  })
})

describe('LE scénario (A7) — tient ou casse', () => {
  it('(a) horde de 4 contre milice armée de 4 : le village tient (≤ 1 perte)', { timeout: 30_000 }, () => {
    // NUIT DES PLUIES FINISSANTES, prise au RÉGIME et non au numéro d'acte (l'acte II de
    // 21 jours n'existe plus, S1-S3) : le contrat mesure la MILICE contre l'assaut nominal —
    // froid (la courbe élit le jour 79, nuit de plaine à −3,9 °C : les goules courent à
    // mi-régime), HORS fureur (−3,9 °C reste loin au-dessus de `TORPEUR.FUREUR` = −13,2 :
    // pas de cris, pas de salves — le climax du Grand Froid a ses propres gardes).
    // RE-MESURÉ sous le calendrier qui tourne, 12 graines : 12/12 tiennent, et le plateau
    // s'étend sur toute la fin des Pluies (j77→j83) — ce n'est pas une graine chanceuse.
    const sim = createSim(14, { map: createEmptyMap(40, 40, TERRAIN_GRASS), cycleOffset: cycleOffsetForStartHour(0, 1), calendarScale: 1 })
    sim.tick = (NUIT_A_MI_REGIME - 1) * TICKS_PER_SEASON_DAY
    sim.tick -= sim.tick % TICKS_PER_CYCLE
    sim.tick += 1
    foundNpcVillage(sim, 20, 20, 4)
    spawnHorde(sim, 4)
    for (let t = 0; t < 8000 && sim.monsters.length > 0; t++) step(sim, [])
    expect(sim.monsters).toHaveLength(0)
    expect(sim.npcs.length).toBeGreaterThanOrEqual(3)
  })

  it('(b) horde de 10 contre 2 PNJ : le village casse', { timeout: 30_000 }, () => {
    // Graine 17 (était 15), 2026-08-02 — le CORPS-CIBLE (spec combat R4quinquies) rend un
    // peu de tranchant à la milice, et la graine 15 est passée du côté « le village tient ».
    // Vérifié avant de la changer, sur 12 graines (`tools/diag-horde.mts`) : (b) CASSE
    // **9/12 → 7/12**, et (a) « le village tient » ne bouge pas (11/12 → 11/12). La
    // propriété survit largement ; c'est bien la graine qui a tourné, pas la promesse —
    // à la différence du raid d'alignement A7(b), où le taux s'est effondré (5/12 → 1/12)
    // et où le commentaire le dit.
    // NUIT DU CŒUR DU GRAND FROID (jour 105) : « le village casse » est un contrat d'ENDGAME
    // — au plein régime, le froid extrême arme aussi le CRI (le cran ⑤ EST cette zone de
    // froid ; la nuit de plaine y vaut −16 °C, sous `TORPEUR.FUREUR`), et le crescendo fait
    // partie de la promesse. L'ancien « acte III, jour 55 » visait cette zone-là ; sous
    // l'année qui tourne (S1), le jour 55 est une fin d'Ardeur tiède où rien ne se lève.
    // RE-MESURÉ au cœur du Grand Froid, 12 graines : 12/12 cassent, en 780 à 1 619 ticks.
    const sim = createSim(17, { map: createEmptyMap(40, 40, TERRAIN_GRASS), cycleOffset: cycleOffsetForStartHour(0, 1), calendarScale: 1 })
    sim.tick = (MI_GRAND_FROID - 1) * TICKS_PER_SEASON_DAY
    sim.tick -= sim.tick % TICKS_PER_CYCLE
    sim.tick += 1
    foundNpcVillage(sim, 20, 20, 2)
    spawnHorde(sim, 10)
    for (let t = 0; t < 8000 && sim.npcs.length > 0 && sim.monsters.length > 0; t++) step(sim, [])
    expect(sim.npcs.length).toBeLessThan(2) // des morts — la défense a cassé
  })
})

describe('le déterminisme (A8)', () => {
  it('replay exact avec hordes, alarmes et carcasses', () => {
    const map = createEmptyMap(30, 30, TERRAIN_GRASS)
    for (let tx = 0; tx < 30; tx++) map.terrain[22 * 30 + tx] = TERRAIN_ROAD
    const options = { map, calendarScale: 720 }
    const setup = (state: SimState) => {
      foundNpcVillage(state, 15, 10, 3)
      spawnEntity(state, 5.5, 5.5)
      spawnHorde(state, 3)
      spawnConvoy(state)
    }
    const live = createSim(77, options)
    const log = createReplayLog(77, options)
    setup(live)
    const playerId = live.entities.find((e) => !live.npcs.some((n) => n.entityId === e.id) && !live.monsters.some((m) => m.entityId === e.id))!.id
    for (let t = 0; t < 2500; t++) {
      recordAndStep(live, log, [{ entityId: playerId, dx: t % 3 === 0 ? 1 : -1, dy: t % 5 === 0 ? 1 : 0 }])
    }
    const replayed = runReplay(log, setup)
    expect(snapshot(replayed)).toBe(snapshot(live))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════
// UNE HORDE EST UNE FOULE, PAS UNE FILE (décision d'Alexis, 2026-08-20)
//
// « Les Cendreux ne doivent pas se superposer de la sorte, ils doivent se comporter comme dans
// Project Zomboid lorsqu'on parle de horde. »
//
// `hordeStep` descendait un gradient PARTAGÉ : tous les membres au même endroit du champ
// élisent la même tuile suivante et marchent l'un DANS l'autre. Le défaut ne se voyait pas au
// banc — la sim comptait bien seize goules — il se voyait à l'ÉCRAN : treize goules relevées,
// deux silhouettes visibles. La garde mesure donc ce que l'œil mesurait : l'ESPACE OCCUPÉ.
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('la horde s’ouvre en marchant (décision 2026-08-20)', () => {
  /** Les corps vivants de la horde, dans l'ordre de ses membres. */
  const corps = (sim: SimState) => {
    const h = sim.hordes[0]!
    return h.memberEntityIds
      .map((id) => sim.entities.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined && e.hp > 0)
  }
  /** Combien de TUILES distinctes la horde occupe — la mesure de l'œil, pas celle du compteur. */
  const tuilesOccupees = (sim: SimState): number =>
    new Set(corps(sim).map((e) => `${Math.floor(e.x)},${Math.floor(e.y)}`)).size
  /** Un village sans milice armée : on vient regarder MARCHER, pas se battre. */
  function hordeEnMarche(taille: number, graine = 23): SimState {
    const sim = createSim(graine, { map: createEmptyMap(60, 60, TERRAIN_GRASS), cycleOffset: cycleOffsetForStartHour(0, 1), calendarScale: 1 })
    // LA NUIT FROIDE (cœur du Grand Froid, minuit) — depuis le cadran de température
    // (2026-08-21), une horde de nuit tiède marche au quart de l'allure : l'écart se mesure
    // au régime que la machine vise, la nuit d'assaut de l'hiver, pas dans une nuit
    // d'Ardeur à +20 °C où les morts sont amorphes (S4).
    sim.tick = (MI_GRAND_FROID - 1) * TICKS_PER_SEASON_DAY
    sim.tick -= sim.tick % TICKS_PER_CYCLE
    sim.tick += 1 // pas PILE sur la frontière du cycle : l'aube de worldevents y disperserait la horde au premier pas
    foundNpcVillage(sim, 30, 30, 1)
    expect(spawnHorde(sim, taille)).not.toBeNull()
    return sim
  }

  it('elle DÉFAIT un tas : douze goules sur une tuile se rangent sur douze', () => {
    const sim = hordeEnMarche(12)
    // ═══ LA PRÉMISSE SE PROUVE PAR CONSTRUCTION ═══
    //
    // Premier jet de cette garde : « au tick 0 elles naissent en bloc serré ». FAUX, et le
    // test l'a dit — `spawnHorde` les pose sur une grille de 3 de large (`i % 3`), donc douze
    // membres occupent DÉJÀ douze tuiles à la naissance. Elles ne naissent pas empilées :
    // elles s'empilaient EN MARCHANT, en descendant toutes le même gradient. Partir de la
    // naissance n'aurait donc rien prouvé — on aurait constaté un semis.
    //
    // On les empile nous-mêmes, toutes sur la même tuile. C'est le pire cas possible, et le
    // seul départ dont on puisse dire que ce qui suit est l'effet de l'écart.
    const bloc = corps(sim)[0]!
    for (const e of corps(sim)) { e.x = bloc.x; e.y = bloc.y }
    expect(tuilesOccupees(sim), 'la prémisse : elles partent TOUTES sur la même tuile').toBe(1)

    // MESURÉ : le tas se défait en ~360 ticks (18 s) — 1 → 2 → 4 → 5 → 9 → 12. On laisse
    // 500 ticks, une marge d'un tiers, et on s'arrête AVANT que la milice n'en tue une : à
    // partir de là, le compte de tuiles baisse pour une raison qui n'est pas l'empilement.
    let range = 0
    for (let t = 0; t < 500 && corps(sim).length === 12; t++) {
      step(sim, [])
      if (tuilesOccupees(sim) === 12) { range = t; break }
    }
    expect(range, 'le tas ne s’est jamais défait').toBeGreaterThan(0)
  })

  it('et elle NE SE RETASSE PAS en marchant — mesuré sur quatre graines', () => {
    // QUATRE GRAINES, PAS UNE. Une horde est un système chaotique : une graine choisie dirait
    // ce qu'on veut entendre (leçon « mesurer la pire seconde » — moyenner sur ≥ 4 graines
    // avant de comparer). On note, pour chacune, la PART des ticks de marche où les douze
    // goules occupent douze tuiles distinctes.
    const parts: number[] = []
    for (const graine of [23, 7, 41, 88]) {
      const sim = hordeEnMarche(12, graine)
      // ON N'EXIGE RIEN DE LA NAISSANCE, et le test l'a appris en rougissant : `spawnHorde`
      // pose ses membres sur une grille de 3 de large, MAIS rabat sur la tuile d'ancrage tout
      // membre dont la case tombe hors du champ de flux (`champ === -1`). Près d'un obstacle,
      // douze goules naissent donc sur TROIS tuiles. Ce qu'on garde ici est la MARCHE, pas le
      // semis — et le test d'à côté prouve déjà qu'un tas se défait.
      const serie: number[] = []
      for (let t = 0; t < 1200; t++) {
        step(sim, [])
        if (corps(sim).length < 12) break // une goule est tombée : le dénominateur a changé
        serie.push(tuilesOccupees(sim))
      }
      // LA GARDE PROUVE QU'ELLE A REGARDÉ QUELQUE CHOSE : sans ça, une horde massacrée au
      // deuxième tick rendrait « aucune régression » par accident.
      expect(serie.length, `graine ${graine} : la horde n'a pas marché assez pour mesurer`).toBeGreaterThan(200)
      const tri = [...serie].sort((a, b) => a - b)
      expect(tri[Math.floor(tri.length / 2)], `graine ${graine} : la moitié du temps, elle se tasse`).toBe(12)
      parts.push(serie.filter((v) => v === 12).length / serie.length)
    }
    // LE PLANCHER EST CELUI DU PIRE CAS MESURÉ (68 %, graine 7 — sa horde s'engouffre dans la
    // porte de l'enceinte), avec de la marge. Une régression en COLONNE le ferait tomber à
    // zéro : c'est le seul chiffre qu'on ait besoin de séparer.
    for (const [i, part] of parts.entries()) {
      expect(part, `graine ${[23, 7, 41, 88][i]} : ${(100 * part).toFixed(0)} % de marche étalée`).toBeGreaterThan(0.6)
    }
  })

  it('et elle ARRIVE quand même : s’écarter ne doit pas défaire l’assaut', () => {
    const sim = hordeEnMarche(12)
    const feu = { x: sim.villages[0]!.fireTx, y: sim.villages[0]!.fireTy }
    const distanceAuFeu = (): number => {
      const cs = corps(sim)
      // MULTIPLICATION EXPLICITE, jamais `**` : la spec ECMAScript ne le garantit pas au bit
      // près d'un moteur à l'autre, et un replay enregistré au navigateur doit rejouer sur
      // Node (invariant §2). Le lint de `/sim` le refuse, y compris dans un test.
      return Math.min(...cs.map((e) => Math.sqrt((e.x - feu.x) * (e.x - feu.x) + (e.y - feu.y) * (e.y - feu.y))))
    }
    const depart = distanceAuFeu()
    for (let t = 0; t < 3000 && corps(sim).length > 0 && distanceAuFeu() > 3; t++) step(sim, [])
    // LE POINT QUI COMPTE : le gibier serré s'IMMOBILISE et attend qu'on lui fasse de la
    // place ; une goule qui ferait ça figerait la horde à trente tuiles du village. La
    // poussée biaise donc la cible du pas au lieu de s'y substituer — et ça se prouve.
    expect(depart).toBeGreaterThan(10)
    expect(distanceAuFeu()).toBeLessThanOrEqual(3)
  })
})

describe('le berceau de la horde — le champ (tx, ty) de `horde_spawned`', () => {
  /**
   * CE QUE CETTE GARDE PROTÈGE : un outil qui reçoit le fait doit pouvoir ALLER VOIR la
   * horde. L'événement ne portait que sa cible, si bien que l'atelier de la vitrine devait
   * l'attendre au feu du village — 301 à 481 s de temps réel MESURÉES par prise, parce
   * qu'elle naît hors du rayon d'intérêt du client (64 tuiles).
   *
   * La propriété affirmée est donc CELLE DONT L'OUTIL A BESOIN, et une seule : depuis
   * (tx, ty), le paquet ENTIER tient dans un cadre de jeu. Le cadrage large de la vitrine
   * en montre 22 de haut, d'où la borne de 8 tuiles — assez lâche pour survivre à un
   * changement du bloc de naissance, assez serrée pour qu'un (tx, ty) qui désignerait la
   * cible, un coin de carte ou le barycentre d'autre chose la fasse rougir.
   *
   * ET ELLE EST EXHAUSTIVE : douze graines, tous les membres de chaque horde, pas un
   * échantillon — c'est le tirage du point d'entrée qui pourrait déraper, pas la moyenne.
   */
  it('(tx, ty) désigne le paquet : sur douze graines, aucun membre n’est à plus de 8 tuiles', () => {
    let nees = 0
    for (let seed = 1; seed <= 12; seed++) {
      const sim = createSim(seed, { map: createEmptyMap(80, 80, TERRAIN_GRASS) })
      foundNpcVillage(sim, 40, 40, 0)
      drainEvents(sim)
      const horde = spawnHorde(sim, 16)
      if (!horde) continue
      nees += 1
      const faits = collect(sim, ['horde_spawned'])
      expect(faits, 'une horde qui naît émet son fait').toHaveLength(1)
      const e = faits[0] as { hordeId: number; tx: number; ty: number }
      expect(e.hordeId).toBe(horde.id)
      for (const id of horde.memberEntityIds) {
        const corps = sim.entities.find((q) => q.id === id)!
        const dx = corps.x - (e.tx + 0.5)
        const dy = corps.y - (e.ty + 0.5)
        expect(
          Math.sqrt(dx * dx + dy * dy),
          `graine ${seed} : la goule ${id} est en (${corps.x}, ${corps.y}), le berceau dit (${e.tx}, ${e.ty})`,
        ).toBeLessThanOrEqual(8)
      }
    }
    // LA PRÉMISSE : sans horde née, la boucle ci-dessus n'affirme RIEN.
    expect(nees, 'douze graines, douze hordes — sinon la garde ne garde rien').toBe(12)
  })
})
