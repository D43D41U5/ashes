import { describe, it, expect } from 'vitest'
import { BALANCE, COMBAT, MONSTER_DEFS, CENDREUX, NIGHT_HUNT, SLOTS, TERRAIN_GRASS, WEAPON_PROFILES } from './balance'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { countOf, inventoryOf } from './items'
import { die } from './combat'
import { advanceCendreux, risenAlive } from './cendreux'
import { spawnMonster, advanceMonsters } from './monsters'
import { createEmptyMap } from './map'
import { drainEvents } from './events'
import { cycleOffsetForStartHour, DAY_TICKS_PER_CYCLE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { grantItems } from './village'
import { foundNpcVillage } from './worldgen'

function tick(state: SimState, inputs: MoveInput[] = []): void {
  step(state, inputs)
}

/** Attaque et laisse le wind-up se résoudre — même montage que combat.test.ts. */
function strike(state: SimState, attackerId: number, dx: number, dy: number): void {
  tick(state, [{ entityId: attackerId, dx: 0, dy: 0, action: { type: 'attack', dx, dy } }])
  for (let t = 0; t < COMBAT.WINDUP_TICKS; t++) tick(state)
  for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(state)
}

describe('type cendreux (fondation)', () => {
  it('MONSTER_DEFS.cendreux : PV bas, dégâts hauts, très lent', () => {
    const d = MONSTER_DEFS.cendreux
    expect(d.hp).toBe(20) // 2 coups d'arme basique
    expect(d.damage).toBe(34) // 3 coups tuent un avatar 100 PV
    expect(d.speed).toBeLessThan(2) // très lent (joueur = 4)
  })
  it('constantes CENDREUX présentes', () => {
    expect(CENDREUX.WITNESS_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.HEARTH_WARD_RADIUS).toBeGreaterThan(0)
    expect(CENDREUX.RISE_DELAY).toBeGreaterThan(0)
    expect(CENDREUX.WARMTH_SEEK_RANGE).toBeGreaterThan(0)
  })
})

function humanAt(state: SimState, x: number, y: number) {
  const id = spawnEntity(state, x, y)
  const e = state.entities.find((en) => en.id === id)!
  return e
}

describe('la levée — critère à la mort', () => {
  it('mort cold, seul, loin d\'un feu → cadavre marqué risesAt', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 5) < 1 && Math.abs(c.y - 5) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
  it('mort cold mais un feu à portée → pas de marquage', () => {
    const state = createSim(1)
    state.structures.push({ type: 'fire', tx: 5, ty: 5, villageId: 0 } as never)
    const e = humanAt(state, 6, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)
    expect(corpse).toBeUndefined()
  })
  /**
   * A6 — LA CAUSE NE COMPTE PLUS (spec `cendreux.md` R6, décision 2026-07-31).
   *
   * Ce test affirmait l'inverse (« mort non-cold → pas de marquage ») et il avait raison de
   * son époque. Le froid s'est révélé un GOULOT et non une règle : il ne mord la plaine qu'en
   * acte III, et sur une saison Veillée entière mesurée au banc il n'a tué qu'UNE fois — la
   * levée ne partait donc jamais. Ce qui fait un Cendreux, c'est mourir SEUL et LOIN D'UN FEU.
   */
  it('A6 — une mort par arme, seule et loin d\'un feu, marque le cadavre', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0) // combat, pas le froid
    expect(state.corpses.find((c) => c.risesAt !== undefined)).toBeDefined()
  })
})

describe('le réveil', () => {
  it('à risesAt : un cendreux naît, porte le loot, le cadavre disparaît, event émis', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    e.inventory = inventoryOf(SLOTS.PLAYER, { berries: 3 })
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = corpse.risesAt!
    state.events.length = 0
    advanceCendreux(state)
    const risen = state.monsters.find((m) => m.type === 'cendreux')
    expect(risen).toBeDefined()
    const ent = state.entities.find((en) => en.id === risen!.entityId)!
    expect(countOf(ent.inventory, 'berries')).toBe(3) // loot hérité
    expect(state.corpses.find((c) => c.id === corpse.id)).toBeUndefined()
    expect(state.events.some((ev) => ev.type === 'cendreux_risen')).toBe(true)
  })
  it('R6 : la levée n’est PAS un atelier de réparation — une hache usée se relève usée', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    e.inventory[0] = { item: 'iron_axe', count: 1, wear: 99 } // un coup avant la casse
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    const risen = state.monsters.find((m) => m.type === 'cendreux')!
    const ent = state.entities.find((en) => en.id === risen.entityId)!
    // Mourir de froid ne doit rien réparer : sinon le gel est une forge gratuite.
    const axe = ent.inventory.find((s) => s?.item === 'iron_axe')
    expect(axe).toBeDefined()
    expect(axe!.wear).toBe(99)
  })
  it('CONSERVATION — un cadavre gavé au-delà de 40 déverse l’excédent au sol, rien n’est détruit', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    // Le vecteur : un dépôt (transfer) a gavé le cadavre AVANT sa levée, au-delà
    // des 40 cases d’un Cendreux. 41 haches (non empilables → 41 cases distinctes).
    corpse.inventory = inventoryOf(SLOTS.CORPSE, { axe: 41 })
    state.tick = corpse.risesAt!
    advanceCendreux(state)

    const risen = state.monsters.find((m) => m.type === 'cendreux')!
    const ent = state.entities.find((en) => en.id === risen.entityId)!
    const inCendreux = countOf(ent.inventory, 'axe')
    const spilled = state.corpses.reduce((n, c) => n + countOf(c.inventory, 'axe'), 0)
    expect(inCendreux).toBe(SLOTS.NPC) // le Cendreux est plein (40 cases)
    expect(spilled).toBe(1) // l’excédent est tombé au sol, en un tas lootable
    expect(inCendreux + spilled).toBe(41) // CONSERVATION : rien n’est détruit
  })

  it('annulation : un feu à portée au réveil → pas de cendreux', () => {
    const state = createSim(1)
    const e = humanAt(state, 5, 5)
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.structures.push({ type: 'fire', tx: 5, ty: 5, villageId: 0 } as never) // veillé
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeUndefined()
    expect(state.corpses.find((c) => c.id === corpse.id)?.risesAt).toBeUndefined()
  })
})

describe('intégration Cendreux', () => {
  it('stats : meurt en 2 coups de hache (10), tue un avatar 100 PV en 3 coups', () => {
    expect(Math.ceil(MONSTER_DEFS.cendreux.hp / 10)).toBe(2) // 2 coups d'arme basique (hache 10)
    expect(Math.ceil(100 / MONSTER_DEFS.cendreux.damage)).toBe(3) // 3 coups sur 100 PV
  })
  /**
   * A1 — UN SEUL MORT-VIVANT. Le test qui vivait ici affirmait « zombie inchangé » ; il n'a
   * plus d'objet : le type est sorti du bestiaire (R1). On affirme le contraire, et par le
   * COMPILATEUR plutôt qu'à la main — `MONSTER_DEFS` est exhaustif sur `MonsterType`, donc
   * ses clés SONT le bestiaire (mémoire `enumerer-une-union-par-le-compilateur`).
   */
  it('A1 — le bestiaire ne porte plus de zombie', () => {
    expect(Object.keys(MONSTER_DEFS)).not.toContain('zombie')
    expect(Object.keys(MONSTER_DEFS)).toContain('cendreux')
  })
})

describe('IA cendreux (jour/nuit)', () => {
  it('jour, sans proie → immobile', () => {
    const state = createSim(1) // tick 0 = jour
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const ent = state.entities.find((e) => e.id === id)!
    const x0 = ent.x, y0 = ent.y
    for (let i = 0; i < 40; i++) advanceMonsters(state)
    expect(ent.x).toBe(x0); expect(ent.y).toBe(y0) // dormant
  })
  it('jour, une proie en vue → se rapproche (chemin posé)', () => {
    const state = createSim(1)
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 8, 5) // proie dans aggroRange 5
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
  })
  it('nuit → dérive vers une source de chaleur (feu) dans le rayon', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    state.structures.push({ type: 'fire', tx: 15, ty: 5, villageId: 0 } as never) // dans WARMTH_SEEK_RANGE 20
    advanceMonsters(state)
    expect((monster.path?.length ?? 0)).toBeGreaterThan(0)
  })

  /**
   * S5 ARME LE PHARE, S6 ACTE LE SIÈGE — le Cendreux arrivé au feu doit MORDRE.
   *
   * Le montage reproduit la mesure qui a trouvé le trou : le Cendreux vient de l'ouest, le
   * feu est entre lui et l'homme. Il chemine vers le foyer (S5) et s'y arrête à ~1,4 tuile ;
   * à cette distance AUCUN humain ne peut plus battre le feu dans `nearestWarmth`, donc
   * l'ancienne cible (`goal.prey`) restait nulle et l'homme assis de l'autre côté du feu
   * était invisible — 0 coup, 0 dégât. Le feu du joueur devenait son meilleur bouclier.
   */
  it('A5 — arrivé au feu, il mord quand même l\'homme assis à côté (S5/S6)', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit
    state.structures.push({ type: 'fire', tx: 15, ty: 15, villageId: 0 } as never)
    const proie = humanAt(state, 17.5, 15.5) // DERRIÈRE le feu, vu du Cendreux
    spawnMonster(state, 'cendreux', 5.5, 15.5) // il vient de l'ouest
    const pv0 = proie.hp
    for (let t = 0; t < 2500; t++) tick(state)
    expect(proie.hp).toBeLessThan(pv0)
  })

  /**
   * A4 — LE SIÈGE, SEUL (spec R3 ; S6, acté le 2026-07-25 et jamais livré).
   *
   * Mesure de référence, avant : cible tenue 4 000 ticks sur 4 000, **0 mur touché, 0 tuile
   * parcourue**. N'importe quelle enceinte rendait le joueur intouchable — et le Cendreux ne
   * venait même pas frapper à la porte.
   */
  it('A4 — proie enclose : il frappe l\'enceinte au lieu de rester planté', () => {
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE }) // nuit
    const proie = humanAt(state, 17.5, 15.5)
    // Un anneau de murs autour d'elle : injoignable à pied, l'A* ne rend aucun chemin.
    // Les murs portent un `id` — un coup se résout par `structureId`, donc une structure
    // sans identité encaisse zéro et le test passerait au vert pour la mauvaise raison.
    let id = 1000
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) !== 2 && Math.abs(dy) !== 2) continue
        state.structures.push({ id: id++, type: 'wall', tx: 17 + dx, ty: 15 + dy, villageId: 0, hp: 200 } as never)
      }
    }
    const pvMurs0 = state.structures.reduce((n, s) => n + ((s as { hp?: number }).hp ?? 0), 0)
    spawnMonster(state, 'cendreux', 12.5, 15.5) // dans WARMTH_SEEK_RANGE, hors de l'enceinte
    for (let t = 0; t < 2500; t++) tick(state)
    const pvMurs1 = state.structures.reduce((n, s) => n + ((s as { hp?: number }).hp ?? 0), 0)
    expect(pvMurs1).toBeLessThan(pvMurs0) // l'enceinte a encaissé…
    expect(proie.hp).toBeLessThan(100) // …puis cédé : un mur retarde, il n'immunise pas
  })
})

describe('la nuit bascule d\'espèce (R11) — la tension croissante', () => {
  /**
   * A13 — CE QUE LA NUIT ENVOIE, ACTE PAR ACTE. C'est ici que vit la montée, et pas dans la
   * horde : une saison de Veillée ne fait que SIX NUITS et la horde ne se tire qu'une fois
   * par nuit (3 hordes sur toute la partie, mesuré). La nuit qui chasse se tire à la MINUTE.
   *
   * Mesuré sur 8 nuits par acte : 19 hurlements / 0 raclements → 18 / 10 → 0 / 38.
   */
  const NUITS = 8 // le tirage est par MINUTE et par acte : une seule nuit est un pile ou face

  function nuits(jourDeSaison: number): { loups: number; morts: number; hurlements: number; raclements: number } {
    const cumul = { loups: 0, morts: 0, hurlements: 0, raclements: 0 }
    for (let n = 0; n < NUITS; n++) {
      const state = createSim(100 + n, {
        map: createEmptyMap(64, 64, TERRAIN_GRASS),
        cycleOffset: cycleOffsetForStartHour(0), // minuit
        calendarScale: 1,
      })
      // On se place au jour de saison voulu sans jouer 55 jours : le calendrier dérive du tick.
      state.tick = (jourDeSaison - 1) * TICKS_PER_SEASON_DAY
      state.tick -= state.tick % TICKS_PER_CYCLE // aligner sur le début du cycle (minuit)
      humanAt(state, 32.5, 32.5)
      drainEvents(state)
      for (let t = 0; t < 18 * 60 * BALANCE.TICK_RATE_HZ; t++) tick(state) // une nuit entière
      const events = drainEvents(state)
      cumul.loups += state.monsters.filter((m) => m.type === 'wolf' && m.nightHunter === true).length
      cumul.morts += state.monsters.filter((m) => m.type === 'cendreux' && m.nightHunter === true).length
      cumul.hurlements += events.filter((e) => e.type === 'wolf_howl').length
      cumul.raclements += events.filter((e) => e.type === 'cendreux_prowl').length
    }
    return cumul
  }

  it('A13 — acte I : la vallée est encore vivante, elle n\'envoie que des loups', () => {
    const n = nuits(5)
    expect(n.hurlements).toBeGreaterThan(0)
    expect(n.raclements).toBe(0)
    expect(n.morts).toBe(0)
  })

  it('A13 — acte III : le vivant a quitté la vallée, elle n\'envoie que des morts', () => {
    const n = nuits(55)
    expect(n.raclements).toBeGreaterThan(0)
    expect(n.hurlements).toBe(0)
    expect(n.loups).toBe(0)
  })

  it('A13 — et la nuit d\'acte III pèse PLUS que celle d\'acte I (la montée se mesure)', () => {
    // Le taux par minute quadruple (0,12 → 0,55) : la dernière nuit doit envoyer davantage,
    // sinon « croissante » n'est qu'un mot dans une spec.
    expect(nuits(55).raclements).toBeGreaterThan(nuits(5).hurlements)
  })

  it('A14 — un rôdeur mort ne HURLE pas : il a son propre signe', () => {
    const n = nuits(55)
    // Un Cendreux qui émettrait `wolf_howl` ferait préparer au joueur la mauvaise parade :
    // on distance un Cendreux (1,3 t/s contre 4), jamais un loup.
    expect(n.hurlements).toBe(0)
    expect(n.raclements).toBeGreaterThan(0)
  })

  it('A13 — borné par espèce : jamais plus que le plafond de l\'acte', () => {
    const n = nuits(55)
    expect(n.morts).toBeLessThanOrEqual(NIGHT_HUNT.UNDEAD_MAX_ALIVE[2]! * NUITS)
  })
})

describe('la contagion et son plafond (R7-R8)', () => {
  it('A7 — un homme tué par un Cendreux, seul et loin d\'un feu, se relève à son tour', () => {
    const state = createSim(1)
    const victime = humanAt(state, 40, 40)
    const tueur = spawnMonster(state, 'cendreux', 41, 40)
    die(state, victime, tueur) // c'est le Cendreux qui l'a eu
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    expect(corpse).toBeDefined()
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    expect(state.monsters.filter((m) => m.type === 'cendreux')).toHaveLength(2) // le tueur + le levé
  })

  it('A8 — au plafond, plus rien ne se relève ; en abattre un rouvre la porte', () => {
    const state = createSim(1)
    for (let i = 0; i < CENDREUX.MAX_ALIVE; i++) {
      const id = spawnMonster(state, 'cendreux', 100 + i * 2, 100)
      state.monsters.find((m) => m.entityId === id)!.risen = true // nés d'un cadavre
    }
    expect(risenAlive(state)).toBe(CENDREUX.MAX_ALIVE)

    const premier = humanAt(state, 40, 40)
    die(state, premier, 0)
    expect(state.corpses.find((c) => c.risesAt !== undefined)).toBeUndefined() // plafond atteint

    // On en abat un : la vallée retrouve une place, et la levée repart.
    const victime = state.entities.find((e) => e.id === state.monsters[0]!.entityId)!
    victime.hp = 0
    const second = humanAt(state, 44, 44)
    die(state, second, 0)
    expect(state.corpses.find((c) => c.risesAt !== undefined)).toBeDefined()
  })

  /**
   * A8bis — LE PLAFOND NE COMPTE QUE LES LEVÉS. Mesuré avant cette distinction : la vallée
   * atteignait 24 Cendreux — le plafond pile — dès le jour 21, rien qu'avec les 5 Repaires et
   * les gardes de convoi ; la levée qu'on venait d'ouvrir se refermait pour les deux tiers de
   * la saison. Ces populations-là ont déjà leurs propres bornes.
   */
  it('A8bis — Repaires, hordes et convois ne consomment pas le plafond', () => {
    const state = createSim(1)
    for (let i = 0; i < CENDREUX.MAX_ALIVE + 5; i++) spawnMonster(state, 'cendreux', 100 + i * 2, 100)
    expect(risenAlive(state)).toBe(0) // aucun n'est né d'un cadavre
    const e = humanAt(state, 40, 40)
    die(state, e, 0)
    expect(state.corpses.find((c) => c.risesAt !== undefined)).toBeDefined()
  })
})

describe('le critère « allié » — branche village de willRiseAsCendreux', () => {
  // Un village PNJ pose un Feu (ward 12) à (12,12) : on déplace la mort et
  // l'allié loin de là (>12) pour isoler la branche « seul », jamais exercée
  // par les tests ci-dessus (qui ne montent jamais de village).

  it('un allié vivant du même village à portée (WITNESS_RADIUS) empêche la levée', () => {
    const state = createSim(1)
    foundNpcVillage(state, 12, 12, 2) // Feu en (12,12), ward 12
    const dier = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    const ally = state.entities.find((e) => e.id === state.npcs[1]!.entityId)!
    dier.x = 200; dier.y = 200 // loin de tout feu (>> HEARTH_WARD_RADIUS)
    ally.x = 204; ally.y = 200 // distance 4 <= WITNESS_RADIUS (8) : témoin vivant
    die(state, dier, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 200) < 1 && Math.abs(c.y - 200) < 1)
    expect(corpse?.risesAt).toBeUndefined() // pas seul → pas de levée
  })

  it('même montage mais l\'allié est hors WITNESS_RADIUS → cadavre marqué', () => {
    const state = createSim(1)
    foundNpcVillage(state, 12, 12, 2)
    const dier = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    const ally = state.entities.find((e) => e.id === state.npcs[1]!.entityId)!
    dier.x = 200; dier.y = 200
    ally.x = 220; ally.y = 200 // distance 20 > WITNESS_RADIUS (8)
    die(state, dier, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 200) < 1 && Math.abs(c.y - 200) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })

  it('même montage mais l\'allié est déjà mort (hp 0) → ne compte pas comme témoin', () => {
    const state = createSim(1)
    foundNpcVillage(state, 12, 12, 2)
    const dier = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    const ally = state.entities.find((e) => e.id === state.npcs[1]!.entityId)!
    dier.x = 200; dier.y = 200
    ally.x = 204; ally.y = 200 // à portée, mais...
    ally.hp = 0 // ...mort : ne fait plus office de témoin
    die(state, dier, 0, 'cold')
    const corpse = state.corpses.find((c) => Math.abs(c.x - 200) < 1 && Math.abs(c.y - 200) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
})

describe('le critère « joueur » (A7) — respawn au Feu ET cadavre marqué au lieu de la mort', () => {
  it('un joueur membre du village, seul, loin du Feu, meurt de froid : les deux effets à la fois', () => {
    const state = createSim(1)
    const village = foundNpcVillage(state, 12, 12, 1) // 1 PNJ, reste près du Feu
    const player = spawnEntity(state, 200, 200)
    village.memberIds.push(player) // le joueur devient membre du village
    const entity = state.entities.find((e) => e.id === player)!
    const deathX = entity.x
    const deathY = entity.y

    die(state, entity, 0, 'cold')

    // Effet 1 : respawn au Feu du village, PV de respawn.
    const respawned = state.entities.find((e) => e.id === player)!
    expect(respawned.x).toBe(village.fireTx + 0.5)
    expect(respawned.y).toBe(village.fireTy + 0.5)
    expect(respawned.hp).toBe(COMBAT.RESPAWN_HP)
    // Effet 2 : un cadavre marqué existe là où le joueur est mort (pas au Feu).
    const corpse = state.corpses.find((c) => Math.abs(c.x - deathX) < 1 && Math.abs(c.y - deathY) < 1)
    expect(corpse?.risesAt).toBe(state.tick + CENDREUX.RISE_DELAY)
  })
})

describe('tuer un Cendreux : 2 coups d\'arme basique, cadavre + loot redéposé (critères 6, 8)', () => {
  it('un Cendreux levé (loot hérité) survit à 1 coup de hache, meurt au 2e, redépose le loot', () => {
    const state = createSim(1)
    // Un PNJ (pas un joueur) : à sa mort il est retiré pour de bon (spec R10),
    // donc pas de respawn qui viendrait traîner près du site et fausser le
    // pipeline de coups réel plus bas (qui frappe toute entité à portée/arc).
    foundNpcVillage(state, 12, 12, 1) // Feu en (12,12), ward 12
    const human = state.entities.find((e) => e.id === state.npcs[0]!.entityId)!
    human.x = 200; human.y = 200 // loin de tout feu et de tout témoin (spec levée « seul »)
    human.inventory = inventoryOf(SLOTS.NPC, { berries: 3 })
    die(state, human, 0, 'cold')
    const originalCorpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = originalCorpse.risesAt!
    advanceCendreux(state)
    const risen = state.monsters.find((m) => m.type === 'cendreux')!
    const cendreuxEnt = state.entities.find((en) => en.id === risen.entityId)!
    expect(countOf(cendreuxEnt.inventory, 'berries')).toBe(3) // loot hérité (déjà couvert, ici en contexte)
    expect(cendreuxEnt.hp).toBe(MONSTER_DEFS.cendreux.hp) // 20

    // Un attaquant armé d'une hache (iron_axe) à portée de corps-à-corps (1 tuile) :
    // le Cendreux est déjà dans son propre MELEE_ENGAGE_RANGE donc il ne se déplace
    // pas — la position reste stable pour les deux coups.
    const attackerId = spawnEntity(state, cendreuxEnt.x + 1, cendreuxEnt.y)
    grantItems(state, attackerId, { iron_axe: 1 })
    // …et il la TIENT : depuis la spec inventaire R9, une hache au fond du sac
    // frappe comme un poing (COMBAT.UNARMED_DAMAGE), pas au profil de la hache.
    state.entities.find((e) => e.id === attackerId)!.activeSlot = 0

    // Deux coups via le vrai pipeline de wind-up (`startAttack` + `advanceCombat`
    // résolu dans `step`), pas de l'arithmétique sur constantes. Avant le fix
    // (combat.ts) la régén de PV s'appliquait à tort aux monstres avec un
    // plafond fixe de 100 au lieu de leur PV max propre (20 ici) et grignotait
    // juste assez pendant les deux wind-ups pour empêcher le KO exact.
    const attacker = () => state.entities.find((e) => e.id === attackerId)!
    strike(state, attackerId, cendreuxEnt.x - attacker().x, cendreuxEnt.y - attacker().y)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeDefined() // 1 coup : encore en vie
    // Les PV restants se DÉDUISENT du profil de l'arme (WEAPON_PROFILES), jamais d'un
    // nombre écrit ici : le jour où la hache est réglée, ce test suit sans mentir.
    expect(cendreuxEnt.hp).toBe(MONSTER_DEFS.cendreux.hp - WEAPON_PROFILES.iron_axe.light.damage)

    strike(state, attackerId, cendreuxEnt.x - attacker().x, cendreuxEnt.y - attacker().y)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeUndefined() // 2e coup : mort
    expect(state.entities.find((en) => en.id === cendreuxEnt.id)).toBeUndefined()

    // Le loot hérité du cadavre d'origine est redéposé dans un nouveau cadavre.
    const lootCorpse = state.corpses.find((c) => c.id !== originalCorpse.id && countOf(c.inventory, 'berries') === 3)
    expect(lootCorpse).toBeDefined()
  })
})
