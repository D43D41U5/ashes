/**
 * LE TIR (spec `docs/specs/tir.md`) — A1 à A9.
 *
 * L'arc n'apporte pas un système, il apporte une FORME d'arme : le gros de ce qui suit
 * ne vérifie donc pas des mécaniques neuves, mais que les anciennes tiennent quand
 * l'arme cesse de frapper au bout du bras — un seul corps touché, une ligne exigée, une
 * munition qui sort et qui revient, et un geste qui peut être ABANDONNÉ sans rien coûter.
 *
 * ═══ DEUX CHOIX DE BANC, ET ILS ONT COÛTÉ UNE MESURE CHACUN ═══
 *
 * ① LES CIBLES DE GÉOMÉTRIE SONT DES AVATARS, PAS DES BÊTES. Un cône bandé fait ±3° :
 *    à deux tuiles, une bête qui dérive d'un demi-pas en sort — le premier jet de ces
 *    gardes ratait TOUS ses tirs bandés, et c'était le banc qui bougeait, pas le code.
 *    Un avatar ne bouge que si on lui donne un input : la géométrie s'affirme alors sur
 *    ce qu'on voulait affirmer. Les bêtes reviennent là où c'est la BÊTE le sujet.
 *
 * ② ON VISE LE CORPS, comme le joueur. Décocher vers une direction figée pendant que la
 *    cible marche, c'est tester sa propre visée, pas la portée de l'arme.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, HUNT, MONSTER_DEFS, TERRAIN_GRASS, TERRAIN_ROCK, WEAPON_PROFILES } from './balance'
import { fleches, pendingStrike, porteeBandee, tientUnArc } from './combat'
import { drainEvents } from './events'
import { countOf, type ItemBag, type ItemId } from './items'
import { createEmptyMap } from './map'
import { spawnMonster } from './monsters'
import { equipBestWeapon } from './npc'
import { rngNext } from './rng'
import { createSim, spawnEntity, step, type MoveInput, type SimState } from './sim'
import { grantItems } from './village'

function makeSim(w = 60, h = 60): SimState {
  return createSim(5, { map: createEmptyMap(w, h, TERRAIN_GRASS) })
}

const entity = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!
const vivant = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)

function grantHeld(sim: SimState, entityId: number, item: ItemId, others: ItemBag = {}): void {
  grantItems(sim, entityId, { [item]: 1, ...others })
  const e = entity(sim, entityId)
  e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === item)
}

/** Un archer prêt à tirer : l'arc EN MAIN et un carquois. */
function archer(sim: SimState, x: number, y: number, arc: 'bow' | 'crude_bow' = 'bow', arrows = 10): number {
  const id = spawnEntity(sim, x, y)
  grantHeld(sim, id, arc, { arrow: arrows })
  return id
}

const tick = (sim: SimState, inputs: MoveInput[] = []): void => step(sim, inputs)

/** Le temps de maintien qui fait sortir le tir BANDÉ, avec sa marge. */
const bande = (arc: 'bow' | 'crude_bow'): number => WEAPON_PROFILES[arc].chargeTicks + 2

const raisons = (sim: SimState): string[] =>
  drainEvents(sim).flatMap((e) => (e.type === 'action_rejected' ? [e.reason] : []))

/** La visée du joueur : vers le CORPS, à l'instant du geste (spec `visee-corps`). */
function versLeCorps(sim: SimState, id: number, cibleId: number): { dx: number; dy: number } {
  const a = entity(sim, id)
  const c = entity(sim, cibleId)
  const dx = c.x - a.x
  const dy = c.y - a.y
  const n = Math.sqrt(dx * dx + dy * dy) || 1
  return { dx: dx / n, dy: dy / n }
}

/**
 * LE GESTE COMPLET, tel que le joueur le fait (T2) : je lève l'arc, je tiens, je vise le
 * corps, je décoche, et je laisse le trait se résoudre. Joué sur `step()` entier — le
 * défaut vit dans l'espace entre deux phases, pas dans une phase prise à part.
 */
function tirSur(sim: SimState, id: number, cibleId: number, hold: number, pendant: MoveInput[] = []): void {
  tick(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'attack_charge', ...versLeCorps(sim, id, cibleId) } }, ...pendant])
  for (let t = 0; t < hold; t++) tick(sim, pendant)
  tick(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'attack_release', ...versLeCorps(sim, id, cibleId) } }, ...pendant])
  for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim, pendant)
}

/** Le même geste, mais vers une direction — pour les tirs qui doivent RATER. */
function tirVers(sim: SimState, id: number, dx: number, dy: number, hold: number): void {
  tick(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'attack_charge', dx, dy } }])
  for (let t = 0; t < hold; t++) tick(sim)
  tick(sim, [{ entityId: id, dx: 0, dy: 0, action: { type: 'attack_release', dx, dy } }])
  for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('le geste (A1)', () => {
  it('décocher tôt donne le tir sec ; décocher mûr donne le tir bandé', () => {
    const dégâts = (hold: number): number => {
      const sim = makeSim()
      const a = archer(sim, 10, 10)
      const c = spawnEntity(sim, 13, 10)
      const pv = entity(sim, c).hp
      tirSur(sim, a, c, hold)
      return pv - entity(sim, c).hp
    }
    const sec = dégâts(0)
    const bandé = dégâts(bande('bow'))
    expect(sec).toBeGreaterThan(0)
    // Ce n'est pas « un peu plus » : le tir bandé est un AUTRE coup (T1).
    expect(bandé).toBeGreaterThan(sec * 2)
  })

  it('la PORTÉE du tir bandé dépasse de loin celle de toute arme de mêlée', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10)
    // Neuf tuiles : bien au-delà de la lance chargée (3,1), et loin dans les 33 de l'arc bandé.
    const c = spawnEntity(sim, 19, 10)
    const pv = entity(sim, c).hp
    tirSur(sim, a, c, bande('bow'))
    expect(entity(sim, c).hp).toBeLessThan(pv)
  })

  it('au-delà de sa portée, le trait ne porte pas', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10)
    const c = spawnEntity(sim, 10 + WEAPON_PROFILES.bow.charged.range + 2, 10)
    const pv = entity(sim, c).hp
    tirSur(sim, a, c, bande('bow'))
    expect(entity(sim, c).hp).toBe(pv)
  })

  it('UN ARC NE FRAPPE PAS : aucun Strike de mêlée, arc levé ou non, à sec ou non', () => {
    // Le cas le plus favorable à un coup de crosse : la cible est COLLÉE, et on prend le
    // chemin le plus court vers un coup (`attack` immédiat).
    for (const arrows of [10, 0]) {
      const cas = arrows === 0 ? 'à sec' : 'carquois plein'
      const sim = makeSim()
      const a = archer(sim, 10, 10, 'bow', arrows)
      const c = spawnEntity(sim, 10.9, 10)
      const pv = entity(sim, c).hp
      expect(tientUnArc(entity(sim, a)), cas).toBe(true)
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
      for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) tick(sim)
      const w = entity(sim, a).windup
      // Ce qui part — s'il part quelque chose — est un TRAIT, jamais une crosse : le
      // seul `Strike` qu'un arc connaisse porte `ranged`.
      if (w) expect(w.ranged, cas).toBe(true)
      if (arrows === 0) {
        expect(w, `${cas} : rien ne part`).toBeUndefined()
        expect(entity(sim, c).hp, cas).toBe(pv)
      }
    }
  })
})

describe('l’annulation (A1bis)', () => {
  it('lever l’arc puis le rabaisser : rien ne part, aucune flèche ne sort', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10)
    const c = spawnEntity(sim, 13, 10)
    const pv = entity(sim, c).hp
    const avant = fleches(entity(sim, a))

    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < bande('bow'); t++) tick(sim)
    expect(entity(sim, a).charge, "l'arc est bien bandé avant qu'on renonce").toBeDefined()

    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_cancel' } }])
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)

    expect(entity(sim, a).charge, 'la corde est retombée').toBeUndefined()
    expect(entity(sim, a).windup, 'aucun coup n’est parti').toBeUndefined()
    expect(fleches(entity(sim, a)), 'la flèche est restée au carquois').toBe(avant)
    expect(entity(sim, c).hp).toBe(pv)
    expect(sim.groundItems.filter((p) => p.item === 'arrow')).toHaveLength(0)
  })

  it('LA MÊLÉE EN PROFITE AUSSI : une charge de hache annulée n’envoie plus de coup', () => {
    // La correction de comportement que `attack_cancel` apporte au reste du jeu : la
    // seule sortie d'une charge était de FRAPPER, donc ouvrir son sac lançait le coup.
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'iron_axe')
    const c = spawnEntity(sim, 11, 10)
    const pv = entity(sim, c).hp
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < WEAPON_PROFILES.iron_axe.chargeTicks + 2; t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_cancel' } }])
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, c).hp).toBe(pv)
  })
})

describe('on ne bande pas accroupi (A1ter)', () => {
  /** Marche `ticks` en tenant `item`, accroupi, en bandant ou non — rend allure et distance. */
  const marcher = (item: ItemId, bander: boolean, ticks = 20): { gait: string; parcouru: number } => {
    const sim = makeSim(120, 120)
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, item, { arrow: 10 })
    const x0 = entity(sim, a).x
    const base: MoveInput = { entityId: a, dx: 1, dy: 0, sneak: true }
    for (let t = 0; t < ticks; t++) {
      tick(sim, [bander ? { ...base, action: { type: 'attack_charge', dx: 1, dy: 0, hold: true } } : base])
    }
    return { gait: entity(sim, a).gait, parcouru: entity(sim, a).x - x0 }
  }

  it('l’arc CHASSE le pas lent : bander en rampant, c’est se relever', () => {
    expect(marcher('bow', false).gait, 'accroupi, arc au repos : il rampe').toBe('sneak')
    expect(marcher('bow', true).gait, 'accroupi ET bandant : il MARCHE').toBe('walk')
  })

  it('…mais une LANCE s’arme très bien à quatre pattes (la contre-épreuve)', () => {
    // La règle vaut pour les armes de TIR seulement — chasse C6 récompense justement
    // l'approche rampante, lance armée, et ce chantier ne la retire pas.
    expect(marcher('spear', true).gait).toBe('sneak')
  })

  it('BANDER RALENTIT : on avance moins vite qu’au repos, arc en main', () => {
    const repos = marcher('bow', false).parcouru
    const bandant = marcher('bow', true).parcouru
    expect(bandant).toBeLessThan(repos / COMBAT.CHARGE_MOVE_FACTOR)
    expect(bandant).toBeGreaterThan(0)
  })
})

describe('on rebande sans lever le doigt (A1quinquies)', () => {
  /**
   * LE GESTE D'ALEXIS : le clic droit reste enfoncé après le tir, donc le client continue
   * d'envoyer `attack_charge { hold }` à sa cadence. Ce qu'on prouve ici, c'est que la SIM
   * s'en accommode — le trait part quand même, puis la corde repart d'elle-même à la
   * seconde où la récupération s'achève, sans qu'un doigt ait bougé.
   */
  it('le trait part, PUIS la corde repart toute seule après la récupération', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10, 'bow', 5)
    const c = spawnEntity(sim, 14, 10)
    const pv = entity(sim, c).hp
    const viser = { dx: 1, dy: 0 }

    // On lève l'arc et on tient jusqu'à pleine bande.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', ...viser } }])
    for (let t = 0; t < bande('bow'); t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', ...viser, hold: true } }])
    }
    // On décoche — et le doigt NE QUITTE PAS le bouton droit : dès le tick suivant, le
    // client réclame de nouveau la corde. C'est le cas que la grammaire doit encaisser.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_release', ...viser } }])
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', ...viser, hold: true } }])
    }

    expect(entity(sim, c).hp, 'le trait est bien parti malgré le ré-armement').toBeLessThan(pv)
    expect(fleches(entity(sim, a)), 'et il a coûté sa flèche').toBe(4)
    expect(entity(sim, a).charge, 'la corde est repartie toute seule').toBeDefined()
  })

  it('à sec, le ré-armement reste MUET — il ne noie pas le flux d’événements', () => {
    // Le maintien n'est pas une demande répétée : quinze « carquois vide » par seconde
    // dans le flux que l'alignement et la chronique consomment seraient une pollution.
    const sim = makeSim()
    const a = archer(sim, 10, 10, 'bow', 0)
    drainEvents(sim)
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0, hold: true } }])
    }
    expect(raisons(sim).filter((r) => r === 'carquois vide')).toHaveLength(0)
  })
})

describe('le télégraphe du tir (A2)', () => {
  it('le décochage ARME — il ne résout pas', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10)
    const c = spawnEntity(sim, 18, 10)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < bande('bow'); t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_release', dx: 1, dy: 0 } }])
    const w = entity(sim, a).windup
    expect(w, 'le décochage arme un wind-up').toBeDefined()
    expect(w!.ticksLeft).toBeGreaterThan(0)
    expect(w!.ranged, 'et il se déclare TIR — c’est ce que le client peint').toBe(true)
    expect(entity(sim, c).hp, 'rien n’est encore arrivé à la cible').toBe(100)
  })

  it('une cible qui sort du cône PENDANT l’armement ne prend rien', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10)
    const c = spawnEntity(sim, 18, 10)
    const pv = entity(sim, c).hp
    // Elle est immobile jusqu'au décochage — donc bien visée — puis elle déboule de côté.
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < bande('bow'); t++) tick(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_release', ...versLeCorps(sim, a, c) } }])
    const esquive: MoveInput[] = [{ entityId: c, dx: 0, dy: -1 }]
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim, esquive)
    expect(entity(sim, c).hp, 'elle est sortie de l’axe à temps').toBe(pv)
    // …et le télégraphe n'était pas gratuit : elle a bel et bien dû BOUGER.
    expect(Math.abs(entity(sim, c).y - 10)).toBeGreaterThan(0.3)
  })
})

describe('un seul corps (A3)', () => {
  it('deux corps alignés : SEUL le plus proche du tireur est touché', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10)
    const devant = spawnEntity(sim, 14, 10)
    const derrière = spawnEntity(sim, 18, 10)
    const pv = entity(sim, derrière).hp
    tirSur(sim, a, derrière, bande('bow')) // on VISE celui du fond
    expect(entity(sim, devant).hp, 'c’est celui de devant qui a pris').toBeLessThan(pv)
    expect(entity(sim, derrière).hp, 'celui du fond est intact').toBe(pv)
  })

  it('une MÊLÉE, elle, prend toujours tout ce qui est dans sa zone', () => {
    // La contre-épreuve : `single` est porté par le Strike, pas par le pipeline.
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'iron_axe')
    const g = spawnEntity(sim, 10.6, 9.4)
    const d = spawnEntity(sim, 10.6, 10.6)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, g).hp).toBeLessThan(100)
    expect(entity(sim, d).hp).toBeLessThan(100)
  })
})

describe('la ligne dégagée (A4)', () => {
  const roche = (sim: SimState, tx: number, ty: number): void => {
    sim.map.terrain[ty * sim.map.width + tx] = TERRAIN_ROCK
  }

  it('un obstacle entre les deux annule le coup, à portée et dans l’arc', () => {
    const libre = makeSim()
    const a1 = archer(libre, 10, 10)
    const c1 = spawnEntity(libre, 18, 10)
    tirSur(libre, a1, c1, bande('bow'))
    expect(entity(libre, c1).hp, 'témoin : sans obstacle, le trait porte').toBeLessThan(100)

    const barré = makeSim()
    const a2 = archer(barré, 10, 10)
    const c2 = spawnEntity(barré, 18, 10)
    roche(barré, 14, 10)
    tirSur(barré, a2, c2, bande('bow'))
    expect(entity(barré, c2).hp, 'la roche a arrêté le trait').toBe(100)
  })

  it('une PORTE close arrête le trait ; la MÊME porte ouverte le laisse passer', () => {
    // La garde se joue sur une tuile qui porte DEUX structures dont une seule bloque :
    // c'est le piège qui a déjà fait traverser un mur à ce dépôt (« le premier solide »).
    const pvAprès = (open: boolean): number => {
      const sim = makeSim()
      const a = archer(sim, 10, 10)
      const c = spawnEntity(sim, 18, 10)
      const commun = { tx: 14, ty: 10, villageId: 0, ownerId: 0, access: 'public', hp: 10 }
      sim.structures.push({ id: 1, type: 'floor', ...commun } as never)
      sim.structures.push({ id: 2, type: 'door', ...commun, open } as never)
      tirSur(sim, a, c, bande('bow'))
      return entity(sim, c).hp
    }
    expect(pvAprès(false), 'porte CLOSE : le trait s’arrête').toBe(100)
    expect(pvAprès(true), 'porte OUVERTE : le trait passe').toBeLessThan(100)
  })
})

describe('la comptabilité des flèches (A5)', () => {
  it('un tir décoché coûte EXACTEMENT une flèche', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10, 'bow', 5)
    const c = spawnEntity(sim, 14, 10)
    tirSur(sim, a, c, bande('bow'))
    expect(fleches(entity(sim, a))).toBe(4)
  })

  it('à sec, l’arc NE SE BANDE MÊME PAS — et le refus le dit', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10, 'bow', 0)
    const c = spawnEntity(sim, 14, 10)
    drainEvents(sim)
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    expect(entity(sim, a).charge, 'la corde ne part pas').toBeUndefined()
    expect(raisons(sim)).toContain('carquois vide')
    for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(entity(sim, c).hp).toBe(100)
    expect(sim.groundItems.filter((p) => p.item === 'arrow')).toHaveLength(0)
  })

  it('quand une flèche retombe, c’est TOUJOURS sur du praticable — porte, rate, ou mur', () => {
    // Depuis qu'une flèche sur deux se perd (décision d'Alexis), on ne peut plus affirmer
    // qu'un tir DONNÉ laisse un tas : on tire donc plusieurs fois, et l'on vérifie ce qui
    // ne doit JAMAIS arriver — une flèche qu'on voit et qu'on ne peut pas atteindre.
    const cas: { nom: string; monter: (sim: SimState) => void }[] = [
      { nom: 'elle porte', monter: (sim) => void spawnEntity(sim, 14, 10) },
      { nom: 'elle rate', monter: () => {} },
      {
        nom: 'un mur l’arrête',
        monter: (sim) => {
          sim.map.terrain[10 * sim.map.width + 14] = TERRAIN_ROCK
        },
      },
    ]
    for (const { nom, monter } of cas) {
      const sim = makeSim()
      const a = archer(sim, 10, 10, 'bow', 12)
      monter(sim)
      for (let i = 0; i < 12; i++) tirVers(sim, a, 1, 0, bande('bow'))
      const piles = sim.groundItems.filter((p) => p.item === 'arrow')
      expect(piles.length, `${nom} — douze tirs laissent au moins un tas`).toBeGreaterThan(0)
      for (const pile of piles) {
        const tx = Math.floor(pile.x)
        const ty = Math.floor(pile.y)
        expect(sim.map.terrain[ty * sim.map.width + tx], `${nom} — tombée sur du praticable`).not.toBe(TERRAIN_ROCK)
      }
    }
  })

  it('UNE FLÈCHE SUR DEUX SE PERD — le carquois se vide pour de bon', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10, 'bow', 20)
    for (let i = 0; i < 20; i++) tirVers(sim, a, 1, 0, 0)
    expect(fleches(entity(sim, a)), 'les vingt sont bien parties').toBe(0)
    const piles = sim.groundItems.filter((p) => p.item === 'arrow')
    // Les rescapées se rassemblent en UN tas : sinon la récupération — le geste qui paie
    // toute l'économie de munition — deviendrait une corvée de vingt clics.
    expect(piles).toHaveLength(1)
    const rendues = piles[0]!.count
    expect(rendues, 'il en revient').toBeGreaterThan(0)
    expect(rendues, 'et il s’en perd vraiment').toBeLessThan(20)
  })
})

describe('bander se voit (A6)', () => {
  /**
   * ON MESURE UNE APPROCHE, PAS UNE POSE. La question du joueur n'est pas « quelle est
   * la méfiance après une seconde » mais « à quelle distance vais-je me faire lever ? ».
   *
   * Le VENT est posé à la main, et c'est indispensable : `SCENT_STRENGTH` vaut 1, donc un
   * chasseur AU VENT est perçu au maximum quoi qu'il fasse — le nez masquerait la règle
   * entière. (Ce n'est pas un artefact de banc : dans le jeu aussi, bander ne se voit que
   * quand le vent ne vous a pas déjà trahi.)
   */
  function distanceDeLevée(bander: boolean, seuil: number): number {
    const sim = makeSim(120, 120)
    sim.wind = { x: -1, y: 0 } // l'archer est SOUS le vent
    const a = archer(sim, 10, 10, 'bow', 40)
    const c = spawnMonster(sim, 'deer', 40, 10)
    sim.monsters.find((m) => m.entityId === c)!.suspicion = 0
    for (let t = 0; t < 600; t++) {
      const marche: MoveInput = { entityId: a, dx: 1, dy: 0 }
      tick(sim, [bander ? { ...marche, action: { type: 'attack_charge', dx: 1, dy: 0, hold: true } } : marche])
      const m = sim.monsters.find((x) => x.entityId === c)
      const cible = vivant(sim, c)
      if (!m || !cible) break
      if (m.suspicion >= seuil) return Math.abs(cible.x - entity(sim, a).x)
    }
    return -1
  }

  it('MARCHER SUR UNE BÊTE L’ARC BANDÉ LA LÈVE DEUX FOIS PLUS LOIN', () => {
    // MESURÉ : levée à 5,0 tuiles corde molle contre 10,7 arc bandé (seuil 1) ; fixée à
    // 6,2 contre 11,2. On affirme l'ORDRE et un écart NET, pas les décimales.
    const molleLevée = distanceDeLevée(false, 1)
    const bandéeLevée = distanceDeLevée(true, 1)
    expect(molleLevée).toBeGreaterThan(0)
    expect(bandéeLevée).toBeGreaterThan(molleLevée * 1.5)

    const molleFixée = distanceDeLevée(false, HUNT.SUSPICION_ALERT)
    const bandéeFixée = distanceDeLevée(true, HUNT.SUSPICION_ALERT)
    expect(bandéeFixée).toBeGreaterThan(molleFixée)
  })

  it('MAIS À L’ARRÊT ET DE LOIN, bander ne change RIEN — le tir long propre survit', () => {
    // L'autre moitié de la règle, et c'est elle qui la rend juste : un corps FIGÉ redevient
    // un rocher (VIS_STILL), corde tendue ou non. « S'arrêter, puis bander » est donc le
    // geste qui paie — exactement le stop-and-go de chasse C1.
    const méfianceAprèsUneSeconde = (dist: number, bander: boolean): number => {
      const sim = makeSim(120, 120)
      sim.wind = { x: -1, y: 0 }
      const a = archer(sim, 10, 10)
      const c = spawnMonster(sim, 'deer', 10 + dist, 10)
      sim.monsters.find((m) => m.entityId === c)!.suspicion = 0
      const immobile: MoveInput = { entityId: a, dx: 0, dy: 0 }
      for (let t = 0; t < BALANCE.TICK_RATE_HZ; t++) {
        tick(sim, [bander ? { ...immobile, action: { type: 'attack_charge', dx: 1, dy: 0, hold: true } } : immobile])
      }
      return sim.monsters.find((m) => m.entityId === c)?.suspicion ?? -1
    }
    // À neuf tuiles — dans la portée de l'arc long — l'archer immobile reste invisible.
    expect(méfianceAprèsUneSeconde(9, true)).toBe(0)
    expect(méfianceAprèsUneSeconde(9, false)).toBe(0)
  })

  it('les deux facteurs sont bien des MAJORATIONS (sinon la règle dirait l’inverse)', () => {
    expect(HUNT.DRAW_VISIBILITY).toBeGreaterThan(1)
    expect(HUNT.DRAW_NOISE).toBeGreaterThan(1)
  })
})

describe('le coup propre à distance (A7)', () => {
  it('un tir bandé couche un cerf NON ALERTÉ d’un seul coup ; le même cerf LEVÉ tient', () => {
    // LE VENT EST POSÉ, et c'est la règle du jeu qui l'exige, pas le banc : `SCENT_STRENGTH`
    // vaut 1, donc un chasseur AU VENT est perçu au maximum quoi qu'il fasse (chasse C17).
    // Sans cette ligne, le cerf est levé AVANT le décochage et la mise à mort propre ne
    // s'applique jamais — ce qui est exactement ce que le jeu doit faire, mais ce n'est
    // pas ce qu'on mesure ici.
    const propre = makeSim()
    propre.wind = { x: -1, y: 0 } // l'archer est sous le vent
    const a1 = archer(propre, 10, 10)
    const d1 = spawnMonster(propre, 'deer', 19, 10)
    tirSur(propre, a1, d1, bande('bow'))
    expect(vivant(propre, d1), 'le cerf est mort net').toBeUndefined()

  })

  it('UNE BÊTE LEVÉE NE DISTANCE PLUS L’ARC — ce que le triplement de portée a changé', () => {
    // AVANT le triplement (11 tuiles), un cerf levé à 3 tuiles était à 11,29 à la
    // résolution : il sortait de portée pendant qu'on bandait, et « on ne bande pas sur une
    // bête qui a compris » était une règle. À 33 tuiles, il ne peut plus s'échapper en
    // courant — il faut un obstacle ou de la distance de départ. C'est un COÛT du choix
    // d'Alexis, pas un défaut : la traque de `chasse.md` C8 perd de son sens si tout
    // fuyard reste à portée. À surveiller au calibrage.
    const sim = makeSim(120, 120)
    sim.wind = { x: -1, y: 0 }
    const a = archer(sim, 10, 10)
    const d = spawnMonster(sim, 'deer', 13, 10)
    const bête = sim.monsters.find((m) => m.entityId === d)!
    bête.suspicion = 1
    bête.alertSince = 0
    tirSur(sim, a, d, bande('bow'))
    const fuyard = vivant(sim, d)
    expect(fuyard, 'il a survécu au trait (26 pour 45 PV)').toBeDefined()
    expect(fuyard!.hp, 'mais il l’a PRIS : la fuite ne le sauve plus').toBeLessThan(MONSTER_DEFS.deer.hp)
  })

  it('le FACTEUR du coup propre ne s’applique pas à une bête déjà levée', () => {
    // Mesuré au TIR SEC (armement 0,15 s) : c'est le seul moyen de comparer les deux
    // dégâts sur une bête qui court — un tir bandé, elle ne le reçoit jamais (ci-dessus).
    const dégâts = (levée: boolean): number => {
      const sim = makeSim()
      sim.wind = { x: -1, y: 0 }
      const a = archer(sim, 10, 10)
      const d = spawnMonster(sim, 'deer', 14, 10)
      const bête = sim.monsters.find((m) => m.entityId === d)!
      if (levée) {
        bête.suspicion = 1
        bête.alertSince = 0
      } else bête.suspicion = 0
      tirSur(sim, a, d, 0)
      return MONSTER_DEFS.deer.hp - (vivant(sim, d)?.hp ?? 0)
    }
    const propre = dégâts(false)
    const sale = dégâts(true)
    expect(sale, 'le trait porte dans les deux cas').toBeGreaterThan(0)
    // Un ENCADREMENT, pas une égalité : la bête blessée SAIGNE (chasse C8) pendant les
    // deux secondes qu'on laisse tourner, et ce filet-là n'appartient pas au coup.
    expect(propre).toBeGreaterThan(sale * (HUNT.CLEAN_KILL_FACTOR - 0.5))
    expect(propre).toBeLessThan(sale * (HUNT.CLEAN_KILL_FACTOR + 0.5))
  })
})

describe('le trait ne repousse pas (A8)', () => {
  it('la cible d’un trait n’est pas poussée, KNOCKBACK armé', () => {
    // On ARME le recul le temps de la garde : le jour où le nombre remonte, ce qu'il
    // commande est déjà prouvé — et il ne doit jamais commander le trait (T10).
    const avant = COMBAT.KNOCKBACK_TILES
    ;(COMBAT as { KNOCKBACK_TILES: number }).KNOCKBACK_TILES = 0.5
    try {
      const sim = makeSim()
      const a = archer(sim, 10, 10)
      // Un avatar : il n'a aucune raison de bouger tout seul, donc tout mouvement
      // observé serait la poussée — et rien d'autre.
      const c = spawnEntity(sim, 14, 10)
      const x0 = entity(sim, c).x
      const y0 = entity(sim, c).y
      tirSur(sim, a, c, bande('bow'))
      expect(entity(sim, c).hp, 'le trait a bien porté').toBeLessThan(100)
      expect(entity(sim, c).x, 'pas d’un pouce').toBe(x0)
      expect(entity(sim, c).y).toBe(y0)
    } finally {
      ;(COMBAT as { KNOCKBACK_TILES: number }).KNOCKBACK_TILES = avant
    }
  })

  it('…alors qu’une MÊLÉE, elle, repousse bien (la contre-épreuve)', () => {
    const avant = COMBAT.KNOCKBACK_TILES
    ;(COMBAT as { KNOCKBACK_TILES: number }).KNOCKBACK_TILES = 0.5
    try {
      const sim = makeSim()
      const a = spawnEntity(sim, 10, 10)
      grantHeld(sim, a, 'spear')
      const c = spawnEntity(sim, 11.5, 10)
      const x0 = entity(sim, c).x
      tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: 1, dy: 0 } }])
      for (let t = 0; t < 2 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
      expect(entity(sim, c).x).toBeGreaterThan(x0)
    } finally {
      ;(COMBAT as { KNOCKBACK_TILES: number }).KNOCKBACK_TILES = avant
    }
  })
})

describe('le déterminisme (A9)', () => {
  it('le tir ajoute UN tirage par trait — celui de la flèche perdue, et lui seul', () => {
    // La formulation d'avant (« aucun tirage ») est morte avec la décision d'Alexis : une
    // flèche sur deux se perd, et ce hasard-là vit dans le PRNG de l'état. Ce qu'on garde,
    // c'est la BORNE : un tir dans le vide, qui ne blesse personne et ne franchit donc
    // aucun palier (R7 tire à chaque palier), ne consomme QUE ce tirage-là.
    const avancees = (tirs: number): number => {
      const sim = makeSim()
      const a = archer(sim, 10, 10, 'bow', 12)
      for (let t = 0; t < 5; t++) tick(sim)
      const avant = sim.rngState
      let n = 0
      let etat = avant
      for (let i = 0; i < tirs; i++) tirVers(sim, a, 1, 0, bande('bow'))
      // On recompte le nombre d'avancées en rejouant le générateur depuis l'état de départ.
      while (etat !== sim.rngState && n < 1000) {
        etat = rngNext(etat)
        n++
      }
      return n
    }
    expect(avancees(0), 'sans tirer, le flux ne bouge pas').toBe(0)
    expect(avancees(1), 'un trait : un tirage').toBe(1)
    expect(avancees(4), 'quatre traits : quatre tirages').toBe(4)
  })

  it('même graine, mêmes gestes : même état', () => {
    const jouer = (): SimState => {
      const sim = makeSim()
      const a = archer(sim, 10, 10, 'bow', 6)
      spawnMonster(sim, 'cendreux', 15, 10)
      spawnMonster(sim, 'wolf', 16, 12)
      for (let i = 0; i < 3; i++) tirVers(sim, a, 1, 0, bande('bow'))
      return sim
    }
    expect(JSON.stringify(jouer())).toBe(JSON.stringify(jouer()))
  })
})

describe('aucune IA ne s’arme d’un arc (T11)', () => {
  it('un PNJ qui n’a QU’UN arc reste mains nues plutôt que sans défense', () => {
    // Depuis qu'un arc ne frappe pas, l'empoigner DÉSARME : la milice marcherait au
    // Cendreux les mains vides. Un mauvais rang n'y suffirait pas — l'arc long (8) passe
    // déjà sous l'épieu taillé (10), donc il ne serait choisi QUE dans ce cas précis.
    const sim = makeSim()
    const n = spawnEntity(sim, 10, 10)
    grantItems(sim, n, { bow: 1, arrow: 10 })
    equipBestWeapon(entity(sim, n))
    expect(tientUnArc(entity(sim, n))).toBe(false)
  })

  it('…mais il empoigne bien une lance quand il en a une', () => {
    const sim = makeSim()
    const n = spawnEntity(sim, 10, 10)
    grantItems(sim, n, { bow: 1, spear: 1 })
    equipBestWeapon(entity(sim, n))
    const e = entity(sim, n)
    expect(e.inventory[e.activeSlot]?.item).toBe('spear')
  })
})

describe('la portée croît avec la bande (T1bis)', () => {
  it('la portée s’interpole LINÉAIREMENT entre le tir sec et la pleine bande', () => {
    const p = WEAPON_PROFILES.bow
    expect(porteeBandee(p, 0)).toBe(p.light.range)
    expect(porteeBandee(p, p.chargeTicks)).toBe(p.charged.range)
    // Le MILIEU tombe pile au milieu : c'est une droite, pas une courbe qui s'arrondit.
    expect(porteeBandee(p, p.chargeTicks / 2)).toBeCloseTo((p.light.range + p.charged.range) / 2, 6)
    // Et elle ne dépasse jamais : une corde n'est pas « plus que pleine ».
    expect(porteeBandee(p, p.chargeTicks * 3)).toBe(p.charged.range)
  })

  it('elle est CONTINUE au raccord — rien ne saute quand le coup devient lourd', () => {
    const p = WEAPON_PROFILES.bow
    expect(porteeBandee(p, p.chargeTicks)).toBe(p.charged.range)
  })

  it('une LANCE, elle, n’allonge pas son manche (la contre-épreuve)', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantHeld(sim, a, 'spear')
    tick(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack_charge', dx: 1, dy: 0 } }])
    for (let t = 0; t < 4; t++) tick(sim)
    expect(pendingStrike(entity(sim, a)).range).toBe(WEAPON_PROFILES.spear.light.range)
  })
})

describe('les deux arcs (T9)', () => {
  it('l’arc de fortune est SOUS l’épieu taillé en dégâts, et très au-dessus en portée', () => {
    // C'est l'échange qui fait tenir la nuit 1 : s'il dominait sur les deux axes, tout
    // le calibrage du premier soir serait à refaire.
    expect(WEAPON_PROFILES.crude_bow.charged.damage).toBeLessThan(WEAPON_PROFILES.crude_spear.light.damage)
    expect(WEAPON_PROFILES.crude_bow.charged.range).toBeGreaterThan(WEAPON_PROFILES.crude_spear.charged.range * 2.5)
  })

  it('le sanglier ne tombe PAS d’un tir de fortune, même propre — il saigne', () => {
    const sim = makeSim()
    const a = archer(sim, 10, 10, 'crude_bow', 5)
    const b = spawnMonster(sim, 'boar', 14, 10)
    tirSur(sim, a, b, bande('crude_bow'))
    const survivant = vivant(sim, b)
    expect(survivant, 'il est encore debout').toBeDefined()
    expect(survivant!.hp).toBeLessThan(MONSTER_DEFS.boar.hp)
  })

  it('le carquois est commun aux deux arcs', () => {
    const sim = makeSim()
    const a = spawnEntity(sim, 10, 10)
    grantItems(sim, a, { crude_bow: 1, bow: 1, arrow: 4 })
    const c = spawnEntity(sim, 13, 10)
    const e = entity(sim, a)
    e.activeSlot = e.inventory.findIndex((s) => s !== null && s.item === 'crude_bow')
    tirSur(sim, a, c, bande('crude_bow'))
    expect(countOf(entity(sim, a).inventory, 'arrow')).toBe(3)
    entity(sim, a).activeSlot = e.inventory.findIndex((s) => s !== null && s.item === 'bow')
    tirSur(sim, a, c, bande('bow'))
    expect(countOf(entity(sim, a).inventory, 'arrow')).toBe(2)
  })
})
