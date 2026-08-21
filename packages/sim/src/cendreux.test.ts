import { describe, it, expect } from 'vitest'
import { BALANCE, COMBAT, MONSTER_DEFS, CENDREUX, METEO, SLOTS, TERRAIN_GRASS, WEAPON_PROFILES } from './balance'
import { meteoVisionFactor } from './meteo'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { countOf, inventoryOf } from './items'
import { die, startAttack } from './combat'
import { advanceCendreux, risenAlive } from './cendreux'
import { secouerLeSol } from './sens'
import { advanceReveils, partRampante } from './morts'
import { spawnMonster, advanceMonsters } from './monsters'
import { createEmptyMap } from './map'
import { drainEvents } from './events'
import { cycleOffsetForStartHour, DAY_TICKS_PER_CYCLE, seasonRamp, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
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
  it('LE CADRAN : au chaud (jour d\'acte I), la même proie à 3 tuiles est INVISIBLE — presque amorphe', () => {
    // Décision d'Alexis 2026-08-21 (« un cendreux doit être presque amorphe lorsqu'il fait
    // chaud ») : à 90 de froid de base, l'éveil vaut 0 et la vue tombe à son plancher
    // (aggroRange × 0,2 = 1 tuile). On peut passer à trois tuiles d'une carcasse en plein
    // midi — mais marcher DESSUS la réveille toujours (le plancher existe pour ça).
    const state = createSim(1) // tick 0 = jour, acte I : plaine à 90
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 8, 5) // à 3 tuiles : dans l'ancienne vue (5), hors de la vue engourdie (1)
    advanceMonsters(state)
    expect(monster.path?.length ?? 0).toBe(0)
    expect(monster.targetId).toBeNull()
  })
  it('…et dans le froid qui mord (nuit d\'acte III), il chasse à pleine vue (chemin posé)', () => {
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(0), calendarScale: 1 })
    state.tick = 54 * TICKS_PER_SEASON_DAY // jour 55 : plaine de nuit à 10 → éveil 1
    state.tick -= state.tick % TICKS_PER_CYCLE // minuit
    const id = spawnMonster(state, 'cendreux', 5, 5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    humanAt(state, 8, 5) // proie dans aggroRange 5, vue pleine
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
    // Depuis le cadran (2026-08-21), la garde se joue LÀ OÙ LE MONSTRE EST ÉVEILLÉ : la
    // nuit d'acte III (plaine à 10, éveil 1, vue pleine) — le cas nominal du siège. Une
    // nuit TIÈDE d'acte I laisse désormais l'homme tranquille à trois tuiles : ce n'est
    // plus le bug du bouclier (nearestWarmth battait l'homme), c'est la torpeur — et le
    // monstre paiera sa venue autrement (il boira le feu, décision ⑯).
    const state = createSim(1, { cycleOffset: cycleOffsetForStartHour(0), calendarScale: 1 })
    state.tick = 54 * TICKS_PER_SEASON_DAY // acte III
    state.tick -= state.tick % TICKS_PER_CYCLE // aligné à minuit (patron du banc `nuits`)
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
   * ═══ LA PROIE NE MEURT PAS, ET C'EST LA MOITIÉ DE LA MESURE ═══
   *
   * Une proie tuée **cesse d'être une proie** (`preys()` filtre `hp > 0`) : le montage d'origine
   * laissait le témoin mourir, donc il mesurait une nuit ÉTEINTE dès la première mort — et pire,
   * chaque mort semait un cadavre qui se levait. MESURÉ après l'alliance des Cendreux (A34) :
   * cette fontaine à cadavres portait la vallée à **119 levés** et faisait déborder le test de ses
   * 30 s. On maintient donc le témoin en vie, comme le fait déjà `tools/recensement-cendreux.mts`
   * pour la même raison. C'est un PLAFOND du terme « nuit » : un joueur qui ne rend jamais un coup
   * et ne fait jamais de feu.
   *
   * Étalon sur 8 nuits par acte, proie maintenue : **22 hurlements / 0 raclements → 29 / 6 → 0 / 16**,
   * et 10 → 11 → 16 chasseurs envoyés.
   */
  const NUITS = 8 // le tirage est par MINUTE et par acte : une seule nuit est un pile ou face

  function nuits(jourDeSaison: number, combien = NUITS): { loups: number; morts: number; hurlements: number; raclements: number } {
    const cumul = { loups: 0, morts: 0, hurlements: 0, raclements: 0 }
    for (let n = 0; n < combien; n++) {
      const state = createSim(100 + n, {
        map: createEmptyMap(64, 64, TERRAIN_GRASS),
        cycleOffset: cycleOffsetForStartHour(0), // minuit
        calendarScale: 1,
      })
      // On se place au jour de saison voulu sans jouer 55 jours : le calendrier dérive du tick.
      state.tick = (jourDeSaison - 1) * TICKS_PER_SEASON_DAY
      state.tick -= state.tick % TICKS_PER_CYCLE // aligner sur le début du cycle (minuit)
      const proie = humanAt(state, 32.5, 32.5)
      drainEvents(state)
      for (let t = 0; t < 18 * 60 * BALANCE.TICK_RATE_HZ; t++) {
        tick(state) // une nuit entière
        proie.hp = 100 // elle tient debout toute la nuit — voir le bandeau ci-dessus
      }
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

  it('A13 — acte III : le vivant a quitté la vallée, elle n\'envoie que des morts', { timeout: 120_000 }, () => {
    // 3 nuits et non 8 : depuis le CRESCENDO (cris → salves, 2026-08-21), une nuit d'acte III
    // porte des dizaines de marcheurs — 8 nuits explosaient le budget du banc pour la même
    // vérité. Le « si » qu'on mesure (espèce) se voit dès la première salve.
    const n = nuits(55, 3)
    expect(n.raclements).toBeGreaterThan(0)
    expect(n.hurlements).toBe(0)
    expect(n.loups).toBe(0)
  })

  it('A13 — et la nuit d\'acte III pèse PLUS que celle d\'acte I (la montée se mesure)', { timeout: 120_000 }, () => {
    // ON COMPARE CE QUI SE COMPARE : le nombre de CHASSEURS que la nuit envoie.
    //
    // L'assertion d'origine opposait les *raclements* d'acte III aux *hurlements* d'acte I —
    // deux événements que deux espèces n'émettent pas au même rythme, donc un rapport qui ne
    // dit rien. Elle passait (38 > 19) grâce à la fontaine à cadavres du montage mortel : le
    // champ des morts qu'elle creusait appelait plus de rôdeurs. Témoin maintenu en vie, elle
    // s'inverse (16 < 22) alors que la nuit d'acte III envoie bel et bien PLUS de monde.
    //
    // CE QUE ÇA LAISSE OUVERT, ET QUI EST UNE QUESTION DE CALIBRAGE (Alexis) : la montée
    // mesurée sur les chasseurs envoyés est de 10 → 16, soit ×1,6, quand le taux par minute,
    // lui, quadruple (0,12 → 0,55). Le plafond `UNDEAD_MAX_ALIVE` de l'acte mange la
    // différence. C'est exactement le défaut que `docs/specs/saison-sans-fin.md` nomme — « une
    // table de trois valeurs, et une table est plate ».
    //
    // PAR NUIT, depuis le 2026-08-21 : la salve du cri est passée de 6 à 2 réveils en fin de
    // saison (décision d'Alexis sur mesure — un regard remplissait le plafond en deux minutes).
    // Le raccourci « 3 nuits de crescendo pèsent plus que 8 nuits tièdes » vivait sur cette
    // fontaine (16-38 chasseurs en 3 nuits ; 9 désormais) ; le titre, lui, dit LA nuit — on
    // compare donc ce qu'une nuit envoie, et la montée reste nette (≈ 3 contre ≈ 1,2).
    const acteI = nuits(5)
    const acteIII = nuits(55, 3)
    expect((acteIII.loups + acteIII.morts) / 3).toBeGreaterThan((acteI.loups + acteI.morts) / NUITS)
  })

  it('A14 — un rôdeur mort ne HURLE pas : il a son propre signe', { timeout: 120_000 }, () => {
    const n = nuits(55, 1) // une seule nuit d'acte III : ~18 tirages à 55 %, le signe est sûr
    // Un Cendreux qui émettrait `wolf_howl` ferait préparer au joueur la mauvaise parade :
    // on distance un Cendreux (1,3 t/s contre 4), jamais un loup.
    expect(n.hurlements).toBe(0)
    expect(n.raclements).toBeGreaterThan(0)
  })

  it('A13 — borné par espèce : jamais plus que le plafond GLOBAL du jour', { timeout: 120_000 }, () => {
    // Depuis le crescendo (2026-08-21), la nuit d'acte III n'est plus le seul canal : le cri
    // lève le sol par salves. La borne qui tient TOUT — et qu'on affirme ici — est le plafond
    // GLOBAL du jour (rampe 12 → 60) : les morts comptés VIVANTS en fin de nuit ne peuvent
    // jamais le dépasser. Le plafond par proie de la nuit qui chasse garde ses gardes propres
    // (morts.test A20) ; celle-ci est la borne de T15 sur la somme.
    const n = nuits(55, 3)
    const jour55 = Math.round(seasonRamp(CENDREUX.GLOBAL.DEBUT, CENDREUX.GLOBAL.FIN, 55))
    // `nuits` CUMULE trois états indépendants : la borne de T15 vaut PAR NUIT — et elle est
    // SERRÉE (mesuré : chaque nuit de crescendo finit le plafond PILE, 56/56).
    expect(n.morts).toBeLessThanOrEqual(jour55 * 3)
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
    const state = createSim(1, { calendarScale: 1 })
    // AU JOUR 55 : le plafond GLOBAL (2026-08-21, en rampe 12 → 60) vaut 56 — c'est bien
    // MAX_ALIVE (24, la borne INTERNE de la contagion, R8) que ce banc doit voir mordre.
    // Au jour 1, le global (13) mordait AVANT lui et le test mesurait l'autre plafond.
    state.tick = 54 * TICKS_PER_SEASON_DAY
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
    const state = createSim(1, { calendarScale: 1 })
    state.tick = 54 * TICKS_PER_SEASON_DAY // jour 55 : le plafond global (56) laisse la place
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

/**
 * A34 — **LE LEVÉ SURVIT À SON MEURTRIER** (spec `cendreux.md` R7, `docs/mesure-contagion.md`).
 *
 * ═══ CE QU'IL GARDE, ET POURQUOI IL EXISTE ═══
 *
 * Ce test a d'abord été écrit à l'ENVERS : il verrouillait le défaut. Le Cendreux qui se lève naît
 * EXACTEMENT sur le cadavre, donc sous le meurtrier qui s'y tient encore — et comme un Cendreux
 * frappe à 34 pour 20 PV, il l'abattait dans le tick même de sa levée. MESURÉ sur une nuit d'acte
 * III : **313 levées, 313 abattues dans leur tick**, `risenAlive` à 0 en permanence, donc
 * `CENDREUX.MAX_ALIVE` qui ne mord jamais et une contagion qui ne blesse personne. La promesse du
 * jeu — *on veille ses morts au feu, ou ils reviennent* — était détruite par son propre exécutant.
 *
 * Décision d'Alexis (2026-07-31) : **TOUS les Cendreux sont alliés entre eux**, par ESPÈCE et non
 * par harde ni par couple tueur→levé. L'assertion s'est donc inversée, et c'est le même test qui
 * prouve le correctif.
 *
 * ═══ POURQUOI ÇA AVAIT ÉCHAPPÉ AU RESTE DU FICHIER ═══
 *
 * Il appelait `advanceCendreux(state)` **seul, hors du tick, à SEPT endroits** (A7 en tête) et ne
 * jouait un tick complet qu'à DEUX. Hors du tick, aucun wind-up ne se résout : le levé survit
 * toujours, et le banc d'essai ne pouvait structurellement pas produire le phénomène. Ce test-ci
 * joue des ticks COMPLETS — c'est toute la différence, et c'est ce qu'il faut garder.
 */
describe('A34 — le Cendreux levé survit au coup de celui qui l\'a fait', () => {
  it('dans un tick COMPLET, le levé naît sous le coup de son meurtrier et n\'en meurt PAS', () => {
    const state = createSim(1)
    state.cycleOffset = cycleOffsetForStartHour(0) // minuit : le Cendreux ne cherche pas d'abri

    // Une victime seule, loin de tout feu — les trois conditions de `willRiseAsCendreux`.
    const victime = humanAt(state, 40, 40)
    const tueurId = spawnMonster(state, 'cendreux', 41, 40)
    const tueur = state.entities.find((e) => e.id === tueurId)!
    die(state, victime, tueurId)
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    expect(corpse).toBeDefined()

    // LE MEURTRIER RESTE PLANTÉ SUR LE CORPS ET REFRAPPE — c'est ce que fait le rôdeur de la
    // nuit, qui garde sa proie. On lance le coup par le VRAI chemin (`startAttack`, celui que
    // l'IA du Cendreux emprunte) plutôt que de laisser l'IA choisir son moment : le test doit
    // mesurer une géométrie et des dégâts, pas un ordonnancement.
    const def = MONSTER_DEFS.cendreux
    // LA PRÉMISSE DU TEST, AFFIRMÉE AVANT D'ÊTRE EXPLOITÉE : sans l'alliance, un seul coup de
    // Cendreux tuerait un Cendreux. Si ce rapport s'inversait un jour (PV montés au-dessus des
    // dégâts), le test passerait pour la mauvaise raison — il ne prouverait plus l'alliance, juste
    // que 34 ne suffit pas. C'est ce qu'a montré la contre-épreuve jouée à `hp` 100.
    //
    // DEUX CONTRE-ÉPREUVES, PARCE QUE LE TEST A CHANGÉ DE SENS. Un test qui affirme une SURVIE
    // passe aussi quand le coup n'arrive jamais (mauvais calage du tick, `startAttack` refusé,
    // cible hors de l'arc) — il serait alors décoratif. Vérifié en retirant la seule garde
    // d'espèce de `resolveStrike` : A34 vire au rouge sur `mortMemeTick`, tué par `byEntityId`
    // = le meurtrier. Le coup arrive donc bien, et c'est l'alliance qui l'écarte.
    expect(def.damage).toBeGreaterThanOrEqual(def.hp)
    const lance = startAttack(state, tueur, corpse.x - tueur.x, corpse.y - tueur.y, {
      windupTicks: def.windupTicks,
      damage: def.damage,
    })
    expect(lance).toBe(true)

    // Le wind-up naît avec `ticksLeft = windupTicks` et se décrémente dès le premier `step` :
    // il se résout donc au tick `départ + windupTicks − 1`. On CALE la levée dessus — c'est la
    // coïncidence que la nuit produit d'elle-même, ici rendue exacte.
    const tickResolution = state.tick + def.windupTicks - 1
    corpse.risesAt = tickResolution

    let levee: { entityId: number; tick: number } | undefined
    let mortMemeTick: { byEntityId: number } | undefined
    for (let t = 0; t < def.windupTicks + 2; t++) {
      step(state, [])
      for (const e of drainEvents(state)) {
        if (e.type === 'cendreux_risen') levee = { entityId: e.entityId, tick: e.tick }
        if (e.type === 'entity_died' && levee && e.entityId === levee.entityId && e.tick === levee.tick) {
          mortMemeTick = { byEntityId: e.byEntityId }
        }
      }
    }

    expect(levee).toBeDefined() // il s'est bien levé…
    expect(mortMemeTick).toBeUndefined() // …et RIEN ne l'a tué dans le tick de sa levée
    // Il est vivant, et il COMPTE — c'est ce qui rend `CENDREUX.MAX_ALIVE` capable de mordre.
    expect(risenAlive(state)).toBe(1)
    // …et il est INTACT : l'alliance écarte la cible, elle ne se contente pas de lui laisser
    // un PV. (On ne dit RIEN du wind-up du meurtrier : son IA en relance un dès qu'il peut, et
    // affirmer quoi que ce soit là-dessus reviendrait à tester un ordonnancement.)
    const leve = state.entities.find((e) => e.id === levee!.entityId)!
    expect(leve.hp).toBe(MONSTER_DEFS.cendreux.hp)
  })
})

/**
 * A35 — L'ALLIANCE EST DE L'ESPÈCE, ET ELLE EST ÉTROITE.
 *
 * A34 prouve le cas qui a motivé la règle (le levé sous son meurtrier). Celui-ci en balaye les
 * BORDS, parce qu'une alliance mal bornée est un bouclier : elle protégerait les Cendreux du
 * joueur, ou tout le bestiaire les uns des autres.
 *
 * Un seul montage, une seule géométrie : deux cibles côte à côte dans le MÊME arc — un Cendreux
 * et un vivant. Ce qui change d'un cas à l'autre est uniquement QUI frappe.
 */
describe('A35 — l\'alliance des Cendreux : par espèce, et rien de plus', () => {
  /** Pose deux cibles dans le même arc, frappe depuis `attaquant`, et rend leurs PV. */
  function coupSurDeuxCibles(attaquantEstCendreux: boolean): { cendreux: number; vivant: number } {
    const state = createSim(1)
    state.cycleOffset = cycleOffsetForStartHour(0)
    const def = MONSTER_DEFS.cendreux
    // Les deux cibles se touchent presque, droit devant l'attaquant : l'arc les prend toutes deux.
    const cibleCendreuxId = spawnMonster(state, 'cendreux', 41, 39.7)
    const cibleVivant = humanAt(state, 41, 40.3)
    const attaquantId = attaquantEstCendreux
      ? spawnMonster(state, 'cendreux', 40, 40)
      : spawnMonster(state, 'wolf', 40, 40)
    const attaquant = state.entities.find((e) => e.id === attaquantId)!
    startAttack(state, attaquant, 1, 0, { windupTicks: def.windupTicks, damage: def.damage })
    for (let t = 0; t < def.windupTicks + 1; t++) step(state, [])
    const cendreuxEnt = state.entities.find((e) => e.id === cibleCendreuxId)
    return {
      // Retiré de `entities` = mort d'un seul coup : on le compte 0 PV.
      cendreux: cendreuxEnt?.hp ?? 0,
      vivant: state.entities.find((e) => e.id === cibleVivant.id)?.hp ?? 0,
    }
  }

  it('un Cendreux dans l\'arc d\'un Cendreux est ÉPARGNÉ — le vivant, lui, encaisse', () => {
    const r = coupSurDeuxCibles(true)
    expect(r.cendreux).toBe(MONSTER_DEFS.cendreux.hp) // intact : pas une égratignure
    expect(r.vivant).toBeLessThan(100) // et le coup a bel et bien porté : ce n'est pas un coup mort
  })

  it('LE MÊME Cendreux, dans l\'arc d\'un loup, encaisse — l\'alliance ne le rend pas invulnérable', () => {
    const r = coupSurDeuxCibles(false)
    expect(r.cendreux).toBeLessThan(MONSTER_DEFS.cendreux.hp)
  })

  it('le joueur garde son verbe : un avatar abat un Cendreux comme avant', () => {
    const state = createSim(1)
    const cendreuxId = spawnMonster(state, 'cendreux', 41, 40)
    const joueur = humanAt(state, 40, 40)
    grantItems(state, joueur.id, { iron_axe: 1 })
    joueur.activeSlot = 0
    strike(state, joueur.id, 1, 0)
    const ent = state.entities.find((e) => e.id === cendreuxId)!
    expect(ent.hp).toBe(MONSTER_DEFS.cendreux.hp - WEAPON_PROFILES.iron_axe.light.damage)
  })
})

/**
 * ═══ LES SENS HONNÊTES (spec R24-R25, 2026-08-21) ═══
 *
 * Le Cendreux cesse d'être un rayon nu : sa vue lit le stimulus de la chasse (allure,
 * couvert — `stimulusPourLesMorts`), et le sol lui porte les impacts (`secouerLeSol`).
 * Montages sur carte VIDE d'herbe (terrain déterministe : couvert nominal, litière inerte)
 * et sur le cadran réel — acte III à minuit pour l'éveil plein, tick 0 pour l'amorphe
 * (patron du banc `nuits`, mémoire « cadran température »).
 */
describe('les sens honnêtes (R24-R25)', () => {
  /** Acte III, minuit, plaine d'herbe : température 10, éveil 1 — la vue est pleine. */
  function nuitActeIII(): SimState {
    const state = createSim(1, {
      map: createEmptyMap(160, 160, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0),
      calendarScale: 1,
    })
    state.tick = 54 * TICKS_PER_SEASON_DAY
    state.tick -= state.tick % TICKS_PER_CYCLE // aligné à minuit
    return state
  }

  it("A36 — l'allure se lit : le marcheur est vu à 4 tuiles, l'accroupi passe", () => {
    // Un feu PLUS PROCHE que l'homme ancre la dérive de chaleur (`nearestWarmth` choisit le
    // feu, donc `targetId` ne peut venir QUE des yeux) : le test isole le canal de la vue.
    const acquis = (gait: 'walk' | 'sneak'): number | null => {
      const state = nuitActeIII()
      state.structures.push({ type: 'fire', tx: 5, ty: 17, villageId: 0 } as never)
      const id = spawnMonster(state, 'cendreux', 5, 15)
      const monster = state.monsters.find((m) => m.entityId === id)!
      const e = humanAt(state, 9, 15) // 4 tuiles : dans la vue nominale (5), hors de la vue accroupie (~2,75)
      e.gait = gait
      advanceMonsters(state)
      return monster.targetId
    }
    expect(acquis('walk')).not.toBeNull()
    expect(acquis('sneak')).toBeNull()
  })

  /**
   * Un front météo PLEIN sur la colonne x = 80 d'une carte de 160 : le front va d'ouest en
   * est, et à mi-traversée sa bande couvre [50, 110] (pluie) ou [55, 105] (brouillard) —
   * la rampe de bord (15 % de la largeur) laisse le cœur à pleine intensité autour de 80.
   * Le montage PROUVE sa prémisse : le facteur de vue au point des acteurs est bien celui
   * du type de front, pas 1.
   */
  function frontPlein(state: SimState, type: 'pluie' | 'brouillard', x: number, y: number): void {
    const T = METEO.TRAVERSEE_TICKS
    state.meteo = { type, cycle: 0, day: 30, edge: 0, startTick: state.tick - T, endTick: state.tick + T }
    expect(meteoVisionFactor(state, x, y)).toBe(METEO.VISION[type])
  }

  it('A37 — le sprint porte au-delà de la vue : acquis à 7 tuiles, où le marcheur passe — brouillard compris', () => {
    // Le canal VIBRATION (bruit d'allure, sans couvert ni météo) : sprint 1,6 → 5 × 1,6 = 8.
    const acquis = (gait: 'walk' | 'sprint', brouillard = false): number | null => {
      const state = nuitActeIII()
      state.structures.push({ type: 'fire', tx: 80, ty: 17, villageId: 0 } as never)
      const id = spawnMonster(state, 'cendreux', 80, 15)
      const monster = state.monsters.find((m) => m.entityId === id)!
      const e = humanAt(state, 87, 15) // 7 tuiles
      e.gait = gait
      if (brouillard) frontPlein(state, 'brouillard', e.x, e.y)
      advanceMonsters(state)
      return monster.targetId
    }
    expect(acquis('sprint')).not.toBeNull()
    expect(acquis('walk')).toBeNull()
    // Le brouillard voile la vue de moitié (0,5) — le sol, lui, porte le sprint comme au clair.
    expect(acquis('sprint', true)).not.toBeNull()
  })

  it('A38 — le contact ne se négocie pas : immobile, sous la pluie, sur un Cendreux amorphe — détecté', () => {
    // Tick 0, plaine à 90 : éveil 0, vue engourdie 1 tuile. Sans le plancher `SENS.CONTACT`,
    // le stimulus de l'immobile (0,25) ET la pluie (0,85) la réduiraient à 0,21 tuile — et
    // le nettoyage de jour deviendrait un pillage furtif gratuit (décision ⑮). Avant ce
    // chantier, la pluie seule la trouait déjà à 0,85 : le plancher s'applique APRÈS tout.
    const chaud = (dist: number): number | null => {
      const state = createSim(1, { map: createEmptyMap(160, 160, TERRAIN_GRASS) })
      const id = spawnMonster(state, 'cendreux', 80, 15)
      const monster = state.monsters.find((m) => m.entityId === id)!
      const e = humanAt(state, 80 + dist, 15)
      e.gait = 'still'
      frontPlein(state, 'pluie', e.x, e.y)
      advanceMonsters(state)
      return monster.targetId
    }
    expect(chaud(0.9)).not.toBeNull() // marcher sur une carcasse la réveille TOUJOURS
    expect(chaud(1.5)).toBeNull() // le plancher est un plancher, pas une vue
  })

  it("A39 — le coup d'outil ameute : la hache à 6 tuiles donne le point d'impact pour dernier lieu vu", () => {
    const state = nuitActeIII()
    const id = spawnMonster(state, 'cendreux', 26.5, 15.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const bucheron = humanAt(state, 20.5, 16.5)
    state.nodes.push({ id: 9001, type: 'tree', tx: 20, ty: 15, stock: 5, regrowAt: 0 })
    tick(state, [{ entityId: bucheron.id, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 9001 } }])
    expect(monster.lastSeenX).toBe(20.5) // le point d'IMPACT, pas le bûcheron
    expect(monster.lastSeenY).toBe(15.5)
    expect(monster.path?.length ?? 0).toBeGreaterThan(0) // et il marche dessus

    // Le même coup, de jour au chaud : l'éveil module la portée — personne ne sent rien.
    const jour = createSim(1, { map: createEmptyMap(160, 160, TERRAIN_GRASS) })
    const id2 = spawnMonster(jour, 'cendreux', 26.5, 15.5)
    const monster2 = jour.monsters.find((m) => m.entityId === id2)!
    const b2 = humanAt(jour, 20.5, 16.5)
    jour.nodes.push({ id: 9001, type: 'tree', tx: 20, ty: 15, stock: 5, regrowAt: 0 })
    tick(jour, [{ entityId: b2.id, dx: 0, dy: 0, action: { type: 'harvest', nodeId: 9001 } }])
    expect(monster2.lastSeenX).toBeUndefined()
  })

  it('A40 — la corde ne vibre pas le sol : un tir bandé résolu ne plante aucun dernier lieu', () => {
    const state = nuitActeIII()
    // La chaleur la plus proche du mort est un feu : il dérive vers lui, pas vers les corps.
    state.structures.push({ type: 'fire', tx: 20, ty: 18, villageId: 0 } as never)
    const id = spawnMonster(state, 'cendreux', 20.5, 15.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const archer = humanAt(state, 10.5, 15.5)
    grantItems(state, archer.id, { bow: 1, arrow: 5 })
    archer.activeSlot = archer.inventory.findIndex((s) => s?.item === 'bow')
    const cible = humanAt(state, 13.5, 15.5) // l'impact tombera à 7 tuiles du mort — sous COUP (8)
    const pv0 = cible.hp
    tick(state, [{ entityId: archer.id, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < WEAPON_PROFILES.bow.chargeTicks + 2; t++) tick(state)
    tick(state, [{ entityId: archer.id, dx: 0, dy: 0, action: { type: 'attack_release', dx: 1, dy: 0 } }])
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(state)
    expect(cible.hp).toBeLessThan(pv0) // le trait a PORTÉ : l'impact existe bel et bien…
    expect(monster.lastSeenX).toBeUndefined() // …et le sol n'en a rien porté (T7 intact)
  })

  it('A40bis — la pose de pièce ébranle plus loin que le coup (SENS.BATIR)', () => {
    const state = nuitActeIII()
    const village = foundNpcVillage(state, 12, 12, 2)
    const id = spawnMonster(state, 'cendreux', 24.5, 12.5) // à 10 tuiles de la pose : hors COUP (8), sous BATIR (12)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const poseur = humanAt(state, 14.5, 13.5)
    village.memberIds.push(poseur.id)
    poseur.inventory[0] = { item: 'chest', count: 1 }
    poseur.activeSlot = 0
    tick(state, [{ entityId: poseur.id, dx: 0, dy: 0, action: { type: 'place_component', tx: 14, ty: 12 } }])
    expect(monster.lastSeenX).toBe(14.5)
    expect(monster.lastSeenY).toBe(12.5)
  })

  it("A41 — la horde n'écoute pas le sol, et la secousse ne consomme aucun tirage", () => {
    const state = nuitActeIII()
    const enHorde = spawnMonster(state, 'cendreux', 8.5, 15.5)
    const seul = spawnMonster(state, 'cendreux', 8.5, 18.5)
    state.hordes.push({ memberEntityIds: [enHorde] } as never)
    const rng0 = state.rngState
    secouerLeSol(state, 10.5, 15.5, CENDREUX.SENS.COUP)
    expect(state.monsters.find((m) => m.entityId === enHorde)!.lastSeenX).toBeUndefined() // il a déjà son Feu (R5)
    expect(state.monsters.find((m) => m.entityId === seul)!.lastSeenX).toBe(10.5)
    expect(state.rngState).toBe(rng0) // le patron A28 : aucun pas de PRNG
  })
})

/**
 * ═══ LE RAMPANT (spec R26, 2026-08-21) ═══
 *
 * Ce que le sol rend n'a pas toujours ses jambes : une part des RÉVEILS — lue dans le champ
 * des morts, élue par hash du réveil — sort rampante, à vie : allure × 0,2, vue × 0,6, pas de
 * siège, même morsure. Montages sur carte vide d'herbe, acte III à minuit (éveil 1).
 */
describe('le rampant (R26)', () => {
  function nuitActeIII(): SimState {
    const state = createSim(1, {
      map: createEmptyMap(160, 160, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0),
      calendarScale: 1,
    })
    state.tick = 54 * TICKS_PER_SEASON_DAY
    state.tick -= state.tick % TICKS_PER_CYCLE
    return state
  }

  /** Fait ÉMERGER `n` réveils sur des sites distincts, pour une proie posée loin, et rend les corps. */
  function emerger(state: SimState, n: number, proieId = humanAt(state, 150.5, 150.5).id) {
    for (let i = 0; i < n; i++) {
      state.reveils.push({ x: 10.5 + 3 * (i % 10), y: 10.5 + 3 * Math.floor(i / 10), at: state.tick, preyId: proieId })
    }
    advanceReveils(state)
    return state.monsters.filter((m) => m.type === 'cendreux')
  }

  it('A42 — la part est une pente du champ, et le marcheur reste la règle', () => {
    expect(partRampante(0)).toBe(CENDREUX.RAMPANT.PART_MIN)
    expect(partRampante(1)).toBe(CENDREUX.RAMPANT.PART_MAX)
    expect(partRampante(0.5)).toBeGreaterThan(partRampante(0.25))
    expect(partRampante(2)).toBe(CENDREUX.RAMPANT.PART_MAX) // borné
    const sortis = emerger(nuitActeIII(), 50)
    expect(sortis.length).toBe(50) // sous le plafond du jour 55 : tous sortent
    const rampants = sortis.filter((m) => m.rampant === true).length
    expect(rampants).toBeGreaterThan(0) // le sol en rend, même au plancher du champ
    expect(rampants).toBeLessThan(25) // …mais jamais la majorité
  })

  it("A43 — même réveil, même corps, et l'élection n'ajoute aucun tirage", () => {
    const a = nuitActeIII()
    const b = nuitActeIII()
    const pa = humanAt(a, 150.5, 150.5).id // la proie d'abord : c'est l'ÉMERGENCE qu'on mesure
    const pb = humanAt(b, 150.5, 150.5).id
    const ra = emerger(a, 30, pa).map((m) => m.rampant === true)
    const rb = emerger(b, 30, pb).map((m) => m.rampant === true)
    expect(ra).toEqual(rb)
    expect(ra.some(Boolean)).toBe(true) // et il y en a : l'égalité n'est pas celle de deux vides
    // LE FLUX SEEDÉ NE BOUGE QUE DE CE QUE LES NAISSANCES TIRENT DÉJÀ. `spawnMonster` consomme
    // un pas par corps (préexistant) ; trente émergences, rampants compris, laissent le PRNG
    // EXACTEMENT là où trente naissances nues le laissent : l'élection est un hash, pas un tirage.
    const c = nuitActeIII()
    humanAt(c, 150.5, 150.5)
    for (let i = 0; i < 30; i++) spawnMonster(c, 'cendreux', 10.5 + 3 * (i % 10), 10.5 + 3 * Math.floor(i / 10))
    expect(a.rngState).toBe(c.rngState)
  })

  it('A44 — les réveils seuls : un cadavre levé a ses jambes', () => {
    const state = nuitActeIII()
    const e = humanAt(state, 40.5, 40.5)
    die(state, e, 0)
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    const leve = state.monsters.find((m) => m.type === 'cendreux')!
    expect(leve.risen).toBe(true)
    expect(leve.rampant).toBeUndefined()
  })

  it('A45 — il rampe, il ne court pas — et il voit à ras du sol', () => {
    // Même montage, même but (un dernier lieu vu à 30 tuiles) : le chemin couvert en 200 ticks.
    const parcouru = (rampant: boolean): number => {
      const state = nuitActeIII()
      const id = spawnMonster(state, 'cendreux', 20.5, 20.5)
      const monster = state.monsters.find((m) => m.entityId === id)!
      if (rampant) monster.rampant = true
      monster.lastSeenX = 50.5
      monster.lastSeenY = 20.5
      const ent = state.entities.find((en) => en.id === id)!
      for (let t = 0; t < 200; t++) advanceMonsters(state)
      return ent.x - 20.5
    }
    const marche = parcouru(false)
    const rampe = parcouru(true)
    expect(marche).toBeGreaterThan(5)
    expect(rampe).toBeGreaterThan(0) // il avance — « presque amorphe » n'est pas « statue »
    expect(rampe / marche).toBeLessThan(0.3) // ~0,2 : PZ « un cinquième d'un marcheur »
    expect(rampe / marche).toBeGreaterThan(0.1)

    // LA VUE RASE : une proie à 4 tuiles, vue par le marcheur (5), pas par le rampant (3).
    const voit = (rampant: boolean): number | null => {
      const state = nuitActeIII()
      state.structures.push({ type: 'fire', tx: 20, ty: 22, villageId: 0 } as never) // ancre la chaleur
      const id = spawnMonster(state, 'cendreux', 20, 20)
      const monster = state.monsters.find((m) => m.entityId === id)!
      if (rampant) monster.rampant = true
      humanAt(state, 24, 20)
      advanceMonsters(state)
      return monster.targetId
    }
    expect(voit(false)).not.toBeNull()
    expect(voit(true)).toBeNull()
  })

  it("A46 — il n'assiège pas : proie enclose, pas un mur touché", () => {
    // Le montage d'A4, le monstre couché.
    const state = createSim(1, { cycleOffset: DAY_TICKS_PER_CYCLE })
    const proie = humanAt(state, 17.5, 15.5)
    let id = 1000
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) !== 2 && Math.abs(dy) !== 2) continue
        state.structures.push({ id: id++, type: 'wall', tx: 17 + dx, ty: 15 + dy, villageId: 0, hp: 200 } as never)
      }
    }
    const pvMurs0 = state.structures.reduce((n, s) => n + ((s as { hp?: number }).hp ?? 0), 0)
    const mid = spawnMonster(state, 'cendreux', 12.5, 15.5)
    state.monsters.find((m) => m.entityId === mid)!.rampant = true
    for (let t = 0; t < 2500; t++) tick(state)
    const pvMurs1 = state.structures.reduce((n, s) => n + ((s as { hp?: number }).hp ?? 0), 0)
    expect(pvMurs1).toBe(pvMurs0) // pas un coup au mur
    expect(proie.hp).toBe(100) // et la proie, enclose, est intouchée
  })
})

/** ═══ LA MÉMOIRE EXTRAPOLE (spec R28, 2026-08-21) ═══ */
describe('la mémoire extrapole (R28)', () => {
  function nuitActeIII(): SimState {
    const state = createSim(1, {
      map: createEmptyMap(160, 160, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0),
      calendarScale: 1,
    })
    state.tick = 54 * TICKS_PER_SEASON_DAY
    state.tick -= state.tick % TICKS_PER_CYCLE
    return state
  }
  /** Une pensée du Cendreux : on avance l'horloge d'un intervalle de décision, puis on le fait penser. */
  function pense(state: SimState): void {
    state.tick += MONSTER_DEFS.cendreux.thinkEveryTicks
    advanceMonsters(state)
  }

  it('A47 — vue deux fois en marche vers l\'est puis perdue : le lieu à vérifier est devant, borné', () => {
    const state = nuitActeIII()
    const id = spawnMonster(state, 'cendreux', 20.5, 20.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const proie = humanAt(state, 23.5, 20.5) // à 3 tuiles : vue
    advanceMonsters(state) // pensée 1 : dernier lieu (23,5 ; 20,5)
    expect(monster.lastSeenX).toBe(23.5)
    proie.x = 25.5 // 2 tuiles en un intervalle de pensée : 4 t/s, la course du joueur — encore en vue
    pense(state) // pensée 2 : vitesse retenue 0,2 tuile/tick
    expect(monster.lastSeenVx).toBeCloseTo(2 / MONSTER_DEFS.cendreux.thinkEveryTicks, 6)
    proie.x = 150.5 // disparue (hors de toute vue)
    proie.y = 150.5
    pense(state) // pensée 3 : la première sans elle — il extrapole, une fois
    // 0,2 t/tick × 40 ticks = 8 tuiles : pile la borne. Depuis (25,5) → (33,5).
    expect(monster.lastSeenX).toBeCloseTo(25.5 + CENDREUX.MEMOIRE.EXTRAPOLATION_MAX, 6)
    expect(monster.lastSeenY).toBe(20.5)
    expect(monster.lastSeenVx).toBeUndefined() // consommée
    expect(monster.path?.length ?? 0).toBeGreaterThan(0) // et il y va
    pense(state) // pensée 4 : rien de neuf — le lieu ne dérive pas une seconde fois
    expect(monster.lastSeenX).toBeCloseTo(25.5 + CENDREUX.MEMOIRE.EXTRAPOLATION_MAX, 6)
  })

  it('…une proie vue IMMOBILE puis perdue : le lieu ne bouge pas', () => {
    const state = nuitActeIII()
    const id = spawnMonster(state, 'cendreux', 20.5, 20.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const proie = humanAt(state, 24.5, 20.5)
    advanceMonsters(state)
    pense(state) // deux vues au même endroit : vitesse nulle
    expect(monster.lastSeenVx).toBe(0)
    proie.x = 150.5
    proie.y = 150.5
    pense(state)
    expect(monster.lastSeenX).toBe(24.5)
    expect(monster.lastSeenY).toBe(20.5)
  })

  it('…et une secousse efface la vitesse retenue : un impact n\'a pas de direction', () => {
    const state = nuitActeIII()
    const id = spawnMonster(state, 'cendreux', 20.5, 20.5)
    const monster = state.monsters.find((m) => m.entityId === id)!
    const proie = humanAt(state, 23.5, 20.5)
    advanceMonsters(state)
    proie.x = 25.5
    pense(state)
    expect(monster.lastSeenVx).toBeDefined()
    secouerLeSol(state, 22.5, 25.5, CENDREUX.SENS.COUP)
    expect(monster.lastSeenX).toBe(22.5)
    expect(monster.lastSeenVx).toBeUndefined()
    expect(monster.lastSeenAt).toBeUndefined()
  })
})
