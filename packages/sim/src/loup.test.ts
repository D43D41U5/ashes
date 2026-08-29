/**
 * LA LOUVIÈRE — la meute a une adresse (spec `loup.md`, décisions d'Alexis 2026-08-28).
 *
 * Ces gardes éprouvent ce que la spec a OUVERT : la résidence (L1-L3), la vie du
 * gîte et les petits (L5, L15), la jauge de faim et le cycle gîte↔chasse (L6-L10),
 * la rage (L13) et la déroute collective (L14). Ce qui existait déjà — encerclement,
 * bond, rompue, alpha — reste gardé par `faune.test.ts` (A12-A16).
 *
 * Le montage : une carte de forêt nue, une zone `louviere` poussée à la main, et
 * `spawnPoiMonsters` — exactement le chemin du vrai jeu (l'hôte peuple ce que le
 * worldgen a marqué). Le placement RÉEL (L1), lui, éprouve la GÉNÉRATION : il
 * appelle `generateZonedTerrain` en direct — jamais le cache (règle du dépôt).
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, FAUNA, MONSTER_DEFS, TERRAIN_FOREST } from './balance'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour } from './time'
import { spawnMonster, type Monster } from './monsters'
import { placeHuntingGrounds } from './faune'
import { drainEvents } from './events'
import { die } from './combat'
import { spawnPoiMonsters, POI_TYPES } from './poi'
import { distSq } from './geometry'
import { generateZonedTerrain } from './zonegen'
import { MONDE, MONDE_JOUE } from './zonegraph'

function tick(state: SimState, inputs: MoveInput[] = []): void {
  step(state, inputs)
}

function entity(state: SimState, id: number): Entity {
  return state.entities.find((e) => e.id === id)!
}

const SEED = 4242
const DEN = { x: 100, y: 100 } // le coin haut-gauche de la zone (3×3) — le centre est à +1,5

/**
 * Un monde qui porte UNE Louvière : la zone est poussée comme le worldgen la
 * pousserait, puis l'hôte peuple (`spawnPoiMonsters`) — le chemin du vrai jeu.
 * 2 h du matin par défaut : l'heure du loup, celle où le gîte VIT (la nuit d'un
 * nocturne est son jour) — les gardes de repos, elles, choisissent midi.
 */
function makeDen(opts: { hour?: number; ground?: { x: number; y: number } } = {}): {
  sim: SimState
  clan: Monster[]
  alpha: Monster
  adultes: Monster[]
  petits: Monster[]
  den: { x: number; y: number }
} {
  const map = createEmptyMap(200, 200, TERRAIN_FOREST)
  map.zones.push({ name: 'la Louvière I', x: DEN.x, y: DEN.y, w: 3, h: 3, kind: 'louviere' })
  const sim = createSim(SEED, {
    map,
    faunaCap: 0, // pas de peuplement ambiant : on regarde le clan, rien que lui
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(opts.hour ?? 2, 1),
    ...(opts.ground ? { grounds: [opts.ground] } : {}),
  })
  spawnPoiMonsters(sim, SEED)
  const clan = sim.monsters.filter((m) => m.homePoi !== undefined)
  const alpha = clan.find((m) => m.alpha === true)!
  return {
    sim,
    clan,
    alpha,
    adultes: clan.filter((m) => m.petit !== true && m.alpha !== true),
    petits: clan.filter((m) => m.petit === true),
    den: { x: DEN.x + 1.5, y: DEN.y + 1.5 },
  }
}

/** Tue une bête PROPREMENT par le chemin du jeu (`die`), comme un coup fatal le ferait. */
function slay(sim: SimState, m: Monster, byEntityId: number): void {
  const e = entity(sim, m.entityId)
  e.hp = 0
  die(sim, e, byEntityId)
}

describe('L1 — le placement : la meute a une adresse (GÉNÉRATION, sans cache)', () => {
  it('chaque Louvière du monde joué est en lisière d’un coin de chasse — jamais dedans, jamais loin', () => {
    const carte = generateZonedTerrain(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = carte
    const dens = map.zones.filter((z) => z.kind === 'louviere')
    expect(dens.length).toBeGreaterThanOrEqual(1) // la vallée a des meutes
    // Les coins relus par l'hôte — le MÊME appel que veillee.ts fera.
    const grounds = placeHuntingGrounds(map, 2026)
    expect(grounds.length).toBeGreaterThanOrEqual(dens.length) // au plus un gîte par coin
    const parCoin = new Map<number, number>()
    for (const d of dens) {
      const cx = d.x + d.w / 2
      const cy = d.y + d.h / 2
      let best = -1
      let bestD = Infinity
      for (let i = 0; i < grounds.length; i++) {
        const g = grounds[i]!
        const dd = distSq(cx, cy, g.x, g.y)
        if (dd < bestD) {
          bestD = dd
          best = i
        }
      }
      const dist = Math.sqrt(bestD)
      // La lisière : dans l'anneau [MIN, MAX] du cœur de SON coin (l'empreinte
      // fait 3 tuiles : une demi-diagonale de marge).
      expect(dist, `${d.name} à ${dist.toFixed(0)} t de son coin`).toBeGreaterThanOrEqual(28)
      expect(dist, `${d.name} à ${dist.toFixed(0)} t de son coin`).toBeLessThanOrEqual(63)
      parCoin.set(best, (parCoin.get(best) ?? 0) + 1)
    }
    for (const [coin, n] of parCoin) expect(n, `coin ${coin} : ${n} gîtes`).toBe(1)
  }, 60_000)
})

describe('L2-L3 — la composition, et le gîte qui respire', () => {
  it('L2 — un gîte peuplé porte 1 alpha, 2 adultes, 2 petits — un seul clan, personne d’ambiant', () => {
    const { sim, clan, alpha, adultes, petits } = makeDen()
    expect(clan).toHaveLength(1 + FAUNA.DEN_ADULTES + FAUNA.DEN_PETITS)
    expect(alpha).toBeDefined()
    expect(adultes).toHaveLength(FAUNA.DEN_ADULTES)
    expect(petits).toHaveLength(FAUNA.DEN_PETITS)
    const herd = alpha.herdId
    for (const m of clan) {
      expect(m.herdId).toBe(herd)
      expect(m.alphaId).toBe(alpha.entityId)
      expect(m.ambient).toBeUndefined() // résident : il ne se dissipe jamais
    }
    // L'alpha porte ses PV de chef ; le petit, presque rien ; l'adulte naît repu.
    expect(entity(sim, alpha.entityId).hp).toBe(MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP)
    for (const p of petits) {
      expect(entity(sim, p.entityId).hp).toBe(MONSTER_DEFS.wolf.hp * FAUNA.PETIT_HP)
      expect(p.faim).toBeUndefined() // un petit n'a pas de jauge : le clan le nourrit
    }
    for (const a of [alpha, ...adultes]) {
      expect(a.faim).toBe(0)
      expect(a.clanAdultes).toBe(1 + FAUNA.DEN_ADULTES)
    }
  })

  it('L3 — abattu, le gîte revient après le délai, JAMAIS sous les yeux — et l’alpha d’abord', () => {
    const { sim, clan } = makeDen()
    const a = spawnEntity(sim, DEN.x + 30.5, DEN.y + 0.5) // le chasseur, à 30 tuiles
    for (const m of [...clan]) slay(sim, m, a)
    expect(sim.monsters.filter((m) => m.homePoi !== undefined)).toHaveLength(0)

    // Le délai n'est pas écoulé : rien.
    for (let t = 0; t < 40; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(sim.monsters).toHaveLength(0)

    // Le délai écoulé, mais le chasseur CAMPE le gîte : on attend.
    entity(sim, a).x = DEN.x + 1.5
    entity(sim, a).y = DEN.y + 5.5
    sim.tick += FAUNA.DEN_RESPAWN_TICKS + 10
    for (let t = 0; t < 20; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(sim.monsters).toHaveLength(0) // une bête qui naît devant vous, c'est le décor qui avoue

    // Il s'éloigne : le clan revient, composition entière, chef en tête.
    entity(sim, a).x = DEN.x + 60.5
    entity(sim, a).y = DEN.y + 60.5
    for (let t = 0; t < 20 && sim.monsters.length === 0; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const revenu = sim.monsters.filter((m) => m.homePoi !== undefined)
    expect(revenu).toHaveLength(1 + FAUNA.DEN_ADULTES + FAUNA.DEN_PETITS)
    expect(revenu.filter((m) => m.alpha === true)).toHaveLength(1)
    expect(revenu.filter((m) => m.petit === true)).toHaveLength(FAUNA.DEN_PETITS)
  })

  it('L3 — CONTRE-TEST : des survivants en DÉROUTE ne tiennent pas le gîte plein', () => {
    const { sim, clan, alpha, petits } = makeDen()
    const a = spawnEntity(sim, DEN.x + 60.5, DEN.y + 60.5) // loin : rien ne bloque le retour
    // L'alpha tombe : les adultes se dispersent (R12) — les petits restent.
    slay(sim, alpha, a)
    tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const routes = sim.monsters.filter((m) => m.routed === true)
    expect(routes).toHaveLength(FAUNA.DEN_ADULTES)
    for (const r of routes) expect(r.homePoi, 'le déserteur a quitté le clan').toBeUndefined()
    for (const p of petits) expect(p.routed, 'le petit se terre, il ne déroute pas').toBeUndefined()

    // Le gîte repeuple AUTOUR des petits — les déserteurs ne comptent pas.
    sim.tick += FAUNA.DEN_RESPAWN_TICKS + 10
    for (let t = 0; t < 20; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const clan2 = sim.monsters.filter((m) => m.homePoi !== undefined)
    expect(clan2).toHaveLength(1 + FAUNA.DEN_ADULTES + FAUNA.DEN_PETITS)
    const chef2 = clan2.find((m) => m.alpha === true)!
    expect(chef2).toBeDefined()
    // Les petits d'avant sont toujours là, et ils ont RETENU le nouveau chef.
    for (const p of petits) {
      const encore = clan2.find((m) => m.entityId === p.entityId)
      expect(encore).toBeDefined()
      expect(encore!.alphaId).toBe(chef2.entityId)
    }
    void clan
  })
})

describe('L5 + L15 — la vie du gîte : le repos, la ronde, le jeu — et la défense', () => {
  it('L5 — une meute tranquille TIENT son gîte : au plus un adulte en ronde à la fois', () => {
    const { sim, clan, den, petits } = makeDen()
    let pireDehors = 0
    let pirePetit = 0
    for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      let dehors = 0
      for (const m of clan) {
        const e = entity(sim, m.entityId)
        const d = Math.sqrt(distSq(e.x, e.y, den.x, den.y))
        if (m.petit !== true && d > FAUNA.DEN_HOME_RADIUS + 1) dehors++
        expect(d, 'personne ne quitte l’emprise de la ronde').toBeLessThanOrEqual(FAUNA.DEN_PATROL_RADIUS + 4)
        if (m.petit === true) pirePetit = Math.max(pirePetit, d)
      }
      pireDehors = Math.max(pireDehors, dehors)
    }
    expect(pireDehors, 'la ronde est SEULE : un adulte à la fois').toBeLessThanOrEqual(1)
    expect(pirePetit, 'les petits jouent AU gîte').toBeLessThanOrEqual(FAUNA.PETIT_JEU_RAYON + 3)
    void petits
  })

  it('L5 — frappé, le clan prend l’agresseur en face — même repu', () => {
    const { sim, adultes } = makeDen()
    const a = spawnEntity(sim, DEN.x + 2.5, DEN.y + 1.5)
    const cible = adultes[0]!
    const e = entity(sim, cible.entityId)
    e.hp -= 5
    cible.lastAttackerId = a
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(cible.targetId).toBe(a) // il a pris son agresseur pour cible
    expect(entity(sim, a).hp).toBeLessThan(100) // et il a rendu le coup
  })

  it('L15 — un petit ne mord JAMAIS : harcelé dix secondes, pas un seul coup armé', () => {
    // Un petit ISOLÉ — dans le clan, les ADULTES défendent (c'est L5, gardé plus
    // haut) et le harceleur se fait mordre par eux : on ne mesurerait pas le petit.
    const map = createEmptyMap(160, 160, TERRAIN_FOREST)
    const sim = createSim(7, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(2, 1) })
    const id = spawnMonster(sim, 'wolf', 80.5, 80.5)
    const p = sim.monsters.find((m) => m.entityId === id)!
    p.petit = true
    entity(sim, id).hp = MONSTER_DEFS.wolf.hp * FAUNA.PETIT_HP
    const a = spawnEntity(sim, 81.5, 80.5)
    entity(sim, id).hp -= 2
    p.lastAttackerId = a
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
      expect(entity(sim, id).windup, 'un petit n’arme pas').toBeUndefined()
    }
    expect(entity(sim, a).hp).toBe(100) // pas une morsure de petit
  })
})

describe('L6-L10 — la faim, le départ, la chasse abstraite, le retour', () => {
  it('L6 — la jauge monte, monotone, au fil des heures', () => {
    const { sim, alpha } = makeDen()
    let avant = alpha.faim ?? 0
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      const f = alpha.faim ?? 0
      expect(f).toBeGreaterThanOrEqual(avant)
      avant = f
    }
    expect(avant).toBeGreaterThan(0)
  })

  it('L7 — l’alpha affamé lève les ADULTES ; les petits n’en bougent pas', () => {
    const { sim, alpha, adultes, petits } = makeDen({ ground: { x: DEN.x + 41.5, y: DEN.y + 1.5 } })
    alpha.faim = FAUNA.FAIM_DEPART + 0.05
    for (let t = 0; t < 10; t++) tick(sim)
    expect(alpha.sortie).toBe(true)
    for (const m of adultes) expect(m.sortie).toBe(true)
    for (const p of petits) expect(p.sortie).toBeUndefined()
  })

  it('L7 — CONTRE-TEST : un adulte seul affamé, l’alpha repu — personne ne part', () => {
    const { sim, alpha, adultes } = makeDen({ ground: { x: DEN.x + 41.5, y: DEN.y + 1.5 } })
    adultes[0]!.faim = 1
    alpha.faim = 0
    for (let t = 0; t < 5 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(alpha.sortie).toBeUndefined()
    for (const m of adultes) expect(m.sortie).toBeUndefined()
  })

  it('L9-L10 — SANS TÉMOIN, la chasse est abstraite : la meute sort, PERSONNE ne meurt, elle rentre repue', () => {
    const ground = { x: DEN.x + 41.5, y: DEN.y + 1.5 }
    const { sim, alpha, adultes, den } = makeDen({ ground })
    alpha.faim = 1
    for (const m of adultes) m.faim = 1

    let partiAuCoin = false
    const partants = [alpha, ...adultes]
    for (let t = 0; t < 130 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      if (!partiAuCoin) {
        const e = entity(sim, alpha.entityId)
        if (distSq(e.x, e.y, ground.x, ground.y) <= (FAUNA.SORTIE_ARRIVEE + 1) * (FAUNA.SORTIE_ARRIVEE + 1)) partiAuCoin = true
      }
      if (partiAuCoin && alpha.sortie === undefined) break
    }
    expect(partiAuCoin, 'la meute est ALLÉE au coin — elle était sur la route, rencontrable').toBe(true)
    expect(alpha.sortie, 'la sortie s’est refermée').toBeUndefined()
    expect(alpha.faim!).toBeLessThan(FAUNA.FAIM_DEPART) // le clan est nourri…
    expect(sim.corpses, '…et AUCUNE bête n’est morte : rien ne se simule hors regard').toHaveLength(0)

    // L10 — le retour : tout le monde rentre, et personne ne chasse en chemin.
    let rentres = false
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ && !rentres; t++) {
      tick(sim)
      // L'emprise de la RONDE, pas celle du repos : un adulte est légitimement
      // de garde à DEN_PATROL_RADIUS pendant que les autres se couchent (L5).
      rentres = partants.every((m) => {
        const e = entity(sim, m.entityId)
        return distSq(e.x, e.y, den.x, den.y) <= (FAUNA.DEN_PATROL_RADIUS + 2) * (FAUNA.DEN_PATROL_RADIUS + 2)
      })
    }
    expect(rentres, 'la meute est rentrée au gîte').toBe(true)
  }, 30_000)

  it('L9 — un TÉMOIN à portée gèle l’horloge abstraite : la chasse devra être vraie', () => {
    const ground = { x: DEN.x + 41.5, y: DEN.y + 1.5 }
    const { sim, alpha, adultes } = makeDen({ ground })
    // Le témoin, planté à 20 tuiles du coin — dans `CHASSE_REELLE`, hors d'aggro.
    const a = spawnEntity(sim, ground.x + 20.5, ground.y + 20.5)
    alpha.faim = 1
    for (const m of adultes) m.faim = 1
    for (let t = 0; t < 60 * BALANCE.TICK_RATE_HZ; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    // L'horloge n'a jamais abouti : la faim n'est pas tombée par magie.
    expect(alpha.faim!).toBeGreaterThan(FAUNA.FAIM_RETOUR)
    expect(alpha.sortie).toBe(true)
  }, 30_000)
})

describe('L13 — la rage : le sang engage, il ne fait pas mourir', () => {
  function seul(bleeding: boolean): { sim: SimState; loup: Monster; a: number; pas: (t: number) => MoveInput[] } {
    const map = createEmptyMap(160, 160, TERRAIN_FOREST)
    const sim = createSim(7, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(2, 1) })
    const id = spawnMonster(sim, 'wolf', 86.5, 80.5)
    const loup = sim.monsters.find((m) => m.entityId === id)!
    const a = spawnEntity(sim, 80.5, 80.5)
    if (bleeding) entity(sim, a).wounds.bleeding = true
    // L'homme PIÉTINE (un pas à droite, un pas à gauche) : figé en forêt, il est
    // quasi invisible (VIS_STILL × couvert, chasse C5) et le loup ne l'acquerrait
    // jamais — le banc mesurerait la furtivité, pas la rage.
    const pas = (t: number): MoveInput[] => [{ entityId: a, dx: t % 2 === 0 ? 1 : -1, dy: 0 }]
    return { sim, loup, a, pas }
  }

  it('L13a — un loup SEUL rôde sans mordre un homme intact ; le MÊME loup mord l’homme qui saigne', () => {
    // L'homme intact : huit secondes, pas une morsure (le courage, R11 — inchangé).
    const intact = seul(false)
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ; t++) tick(intact.sim, intact.pas(t))
    expect(entity(intact.sim, intact.a).hp).toBe(100)

    // L'homme qui saigne : la rage lève le courage — il engage, seul.
    const blesse = seul(true)
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ; t++) tick(blesse.sim, blesse.pas(t))
    expect(blesse.loup.rageUntil).toBeDefined()
    expect(entity(blesse.sim, blesse.a).hp).toBeLessThan(100)
  })

  it('L13b — LA FUREUR : tuer un petit rappelle les adultes sur le meurtrier, et le clan hurle UNE fois', () => {
    const { sim, alpha, adultes, petits } = makeDen({ ground: { x: DEN.x + 41.5, y: DEN.y + 1.5 } })
    // Les adultes sont PARTIS chasser…
    alpha.faim = 1
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(alpha.sortie).toBe(true)
    // …et le raid frappe le gîte.
    const a = spawnEntity(sim, DEN.x + 1.5, DEN.y + 3.5)
    drainEvents(sim)
    slay(sim, petits[0]!, a)
    for (const m of [alpha, ...adultes]) {
      expect(m.rageUntil, 'la fureur a pris tout le clan').toBeDefined()
      expect(m.sortie, 'la sortie est lâchée : ils RENTRENT').toBeUndefined()
      expect(m.targetId, 'sur le meurtrier').toBe(a)
    }
    const howls = drainEvents(sim).filter((e) => e.type === 'wolf_howl')
    expect(howls).toHaveLength(1)
  })

  it('L13c — LES SOUPAPES TIENNENT : enragé, il ROMPT quand même sous le seuil ; l’alpha mort disperse quand même', () => {
    // La rompue d'abord : un loup enragé blessé sous PACK_BREAK_HP décroche.
    const b = seul(true)
    for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) tick(b.sim, b.pas(t))
    expect(b.loup.rageUntil).toBeDefined()
    entity(b.sim, b.loup.entityId).hp = MONSTER_DEFS.wolf.hp * FAUNA.PACK_BREAK_HP - 1
    const dAvant = Math.sqrt(distSq(entity(b.sim, b.loup.entityId).x, entity(b.sim, b.loup.entityId).y, 80.5, 80.5))
    for (let t = 0; t < 4 * BALANCE.TICK_RATE_HZ; t++) tick(b.sim, [{ entityId: b.a, dx: 0, dy: 0 }])
    const dApres = Math.sqrt(distSq(entity(b.sim, b.loup.entityId).x, entity(b.sim, b.loup.entityId).y, 80.5, 80.5))
    expect(dApres).toBeGreaterThan(dAvant) // il s'éloigne : la rage n'est pas un sacrifice

    // La dispersion ensuite : l'alpha tombe en pleine fureur — le clan casse quand même.
    const { sim, alpha, adultes, petits } = makeDen()
    const a = spawnEntity(sim, DEN.x + 1.5, DEN.y + 3.5)
    slay(sim, petits[0]!, a) // la fureur s'allume
    expect(adultes[0]!.rageUntil).toBeDefined()
    slay(sim, alpha, a)
    tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    for (const m of adultes) {
      expect(m.routed).toBe(true)
      expect(m.rageUntil, 'la déroute éteint la rage').toBeUndefined()
    }
  })

  it('L13d — la poursuite enragée est BORNÉE : au-delà de PURSUIT_RANGE_RAGE, il lâche', () => {
    const pres = seul(true)
    pres.loup.rageUntil = 1e9
    pres.loup.targetId = pres.a
    entity(pres.sim, pres.loup.entityId).x = 80.5 + FAUNA.PURSUIT_RANGE_RAGE - 5 // à 35 t : tenu
    tick(pres.sim, [{ entityId: pres.a, dx: 0, dy: 0 }])
    expect(pres.loup.targetId).toBe(pres.a)

    const loin = seul(true)
    loin.loup.rageUntil = 1e9
    loin.loup.targetId = loin.a
    entity(loin.sim, loin.loup.entityId).x = 80.5 + FAUNA.PURSUIT_RANGE_RAGE + 5 // à 45 t : lâché
    tick(loin.sim, [{ entityId: loin.a, dx: 0, dy: 0 }])
    expect(loin.loup.targetId).toBeNull()
  })

  it('L13e — sans nouveau sang, la rage RETOMBE', () => {
    const { sim, loup, a } = seul(false)
    loup.rageUntil = sim.tick + 3
    for (let t = 0; t < 6; t++) tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(loup.rageUntil).toBeUndefined()
  })
})

describe('la cadence du bond (Alexis, 2026-08-28) — un bond est un événement, pas un ressort', () => {
  it('un même loup ne bondit JAMAIS deux fois en moins de LEAP_COOLDOWN — et le premier bond reste immédiat', () => {
    const map = createEmptyMap(200, 200, TERRAIN_FOREST)
    const sim = createSim(7, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(2, 1) })
    const id = spawnMonster(sim, 'wolf', 86.5, 80.5)
    const loup = sim.monsters.find((m) => m.entityId === id)!
    loup.nightHunter = true // brave seul (le courage n'est pas ce qu'on mesure)
    const a = spawnEntity(sim, 80.5, 80.5)
    // Le MANNEQUIN marche sans fin (cible en mouvement : le régime du bond R19)
    // et ne meurt pas — on mesure une CADENCE, pas une mise à mort.
    const heal = (): void => {
      const e = entity(sim, a)
      e.hp = 100
    }
    const departs: number[] = []
    let enVol = false
    for (let t = 0; t < 20 * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim, [{ entityId: a, dx: t % 40 < 20 ? 1 : -1, dy: 0 }])
      heal()
      const vole = loup.leapUntil !== undefined
      if (vole && !enVol) departs.push(sim.tick) // le FRONT MONTANT : un départ de bond
      enVol = vole
    }
    expect(departs.length, 'il bondit encore — la cadence n’est pas une interdiction').toBeGreaterThanOrEqual(2)
    for (let i = 1; i < departs.length; i++) {
      expect(departs[i]! - departs[i - 1]!, `bonds ${i - 1}→${i} trop rapprochés`).toBeGreaterThanOrEqual(FAUNA.LEAP_COOLDOWN)
    }
    // …et le PREMIER bond n'attend pas la cadence : c'est lui qui ouvre la chasse (R19).
    expect(FAUNA.LEAP_COOLDOWN).toBeGreaterThan(FAUNA.LEAP_TICKS + FAUNA.LEAP_RECOVER_TICKS) // sinon la cadence ne borne rien
  }, 30_000)

  it('LA DÉTENTE — le bond s’annonce : tassé immobile LEAP_CROUCH_TICKS durant, PUIS il vole', () => {
    const map = createEmptyMap(200, 200, TERRAIN_FOREST)
    const sim = createSim(7, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(2, 1) })
    const id = spawnMonster(sim, 'wolf', 84.5, 80.5)
    const loup = sim.monsters.find((m) => m.entityId === id)!
    loup.nightHunter = true
    const a = spawnEntity(sim, 80.5, 80.5)
    let prepDebut = -1
    let prepFin = -1
    let volDebut = -1
    const positions: { x: number; y: number }[] = []
    for (let t = 0; t < 8 * BALANCE.TICK_RATE_HZ && volDebut < 0; t++) {
      tick(sim, [{ entityId: a, dx: t % 2 === 0 ? 1 : -1, dy: 0 }])
      entity(sim, a).hp = 100
      const e = entity(sim, loup.entityId)
      if (loup.bondPrepUntil !== undefined) {
        if (prepDebut < 0) prepDebut = sim.tick
        prepFin = sim.tick
        positions.push({ x: e.x, y: e.y })
      }
      if (loup.leapUntil !== undefined && volDebut < 0) volDebut = sim.tick
    }
    expect(prepDebut, 'la détente a eu lieu').toBeGreaterThanOrEqual(0)
    expect(volDebut, 'le vol a suivi').toBeGreaterThanOrEqual(0)
    // Elle dure ce qu'elle promet (±1 tick de fenêtre d'observation)…
    expect(prepFin - prepDebut).toBeGreaterThanOrEqual(FAUNA.LEAP_CROUCH_TICKS - 2)
    // …le vol part À LA FIN de la détente, jamais avant…
    expect(volDebut).toBeGreaterThan(prepFin)
    // …et le loup n'a pas bougé d'un pouce pendant qu'il se bandait : c'est
    // l'IMMOBILITÉ qui rend le télégraphe lisible.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!.x).toBe(positions[0]!.x)
      expect(positions[i]!.y).toBe(positions[0]!.y)
    }
  })
})

describe('L14 — la déroute collective : la meute casse quand elle a compris', () => {
  it('perdre UN adulte sur trois ne casse rien ; perdre le DEUXIÈME casse tout — sauf les petits', () => {
    const { sim, alpha, adultes, petits } = makeDen()
    const a = spawnEntity(sim, DEN.x + 60.5, DEN.y + 60.5)

    slay(sim, adultes[0]!, a)
    tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(alpha.routed, 'un mort sur trois : la meute tient').toBeUndefined()
    expect(adultes[1]!.routed).toBeUndefined()

    slay(sim, adultes[1]!, a)
    tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    expect(alpha.routed, 'la moitié perdue : le clan casse — l’alpha aussi').toBe(true)
    expect(alpha.homePoi).toBeUndefined()
    for (const p of petits) expect(p.routed, 'les petits se terrent').toBeUndefined()
  })

  it('CONTRE-TEST — une meute de banc SANS étalon (clanAdultes) ne déroute qu’à l’alpha, comme avant', () => {
    const map = createEmptyMap(160, 160, TERRAIN_FOREST)
    const sim = createSim(7, { map, faunaCap: 0, worldEvents: false, cycleOffset: cycleOffsetForStartHour(2, 1) })
    const herdId = sim.nextHerdId++
    const ids: number[] = []
    for (let i = 0; i < 3; i++) {
      const id = spawnMonster(sim, 'wolf', 80.5 + i * 1.5, 80.5)
      const m = sim.monsters.find((x) => x.entityId === id)!
      m.herdId = herdId
      ids.push(id)
    }
    const a = spawnEntity(sim, 120.5, 120.5)
    const premier = sim.monsters.find((m) => m.entityId === ids[0])!
    slay(sim, premier, a)
    const second = sim.monsters.find((m) => m.entityId === ids[1])!
    slay(sim, second, a)
    tick(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const dernier = sim.monsters.find((m) => m.entityId === ids[2])!
    expect(dernier.routed, 'sans étalon de clan, pas de déroute collective').toBeUndefined()
  })
})

describe('L4 — la table', () => {
  it('la Louvière est au registre : hors semis, à monstre wolf — et le loup ambiant n’a plus de meute déclarée', () => {
    const t = POI_TYPES.find((p) => p.slug === 'louviere')!
    expect(t).toBeDefined()
    expect(t.horsSemis).toBe(true)
    expect(t.monster).toBe('wolf')
    expect(MONSTER_DEFS.wolf.herdSize, 'l’ambiant ne lève plus que des solitaires (L4)').toBeUndefined()
    expect(MONSTER_DEFS.wolf.loot_petit).toBeDefined()
  })
})

describe('le gîte ne tremble pas (R22 — diag-tremblement 2026-08-28)', () => {
  /**
   * Les deux pires signatures du relevé vivaient ICI : le petit épinglé PILE à
   * `PETIT_JEU_RAYON` (20 inversions de cap par seconde — le poursuivi fuyait le
   * jeu, le rayon nu le rappelait d'un tick) et l'adulte épinglé à l'anneau de
   * `DEN_HOME_RADIUS` pendant que la séparation des corps pousse la meute vers
   * lui. Le correctif : le retour S'ENGAGE (`regagne`, hystérésis jusqu'au
   * confort). On mesure comme `diag-cerf` : les inversions de cap de la PIRE
   * seconde — le tremblement en faisait vingt, une bête qui vit en fait
   * quelques-unes.
   */
  function pireSecondeDuClan(sim: SimState, betes: Monster[], secondes: number): number {
    const suivi = betes.map((m) => ({ x: entity(sim, m.entityId).x, y: entity(sim, m.entityId).y, sx: 0, sy: 0 }))
    const flips: number[] = []
    for (let t = 0; t < secondes * BALANCE.TICK_RATE_HZ; t++) {
      tick(sim)
      let f = 0
      betes.forEach((m, i) => {
        const e = entity(sim, m.entityId)
        const p = suivi[i]!
        const dx = e.x - p.x
        const dy = e.y - p.y
        const sx = dx > 0.001 ? 1 : dx < -0.001 ? -1 : 0
        const sy = dy > 0.001 ? 1 : dy < -0.001 ? -1 : 0
        if (sx !== 0 && p.sx !== 0 && sx !== p.sx) f += 1
        if (sy !== 0 && p.sy !== 0 && sy !== p.sy) f += 1
        if (sx !== 0) p.sx = sx
        if (sy !== 0) p.sy = sy
        p.x = e.x
        p.y = e.y
      })
      flips.push(f)
    }
    let pire = 0
    for (let d = 0; d + BALANCE.TICK_RATE_HZ <= flips.length; d += BALANCE.TICK_RATE_HZ) {
      let s = 0
      for (let k = d; k < d + BALANCE.TICK_RATE_HZ; k++) s += flips[k]!
      if (s > pire) pire = s
    }
    return pire
  }

  it('les petits jouent sans vibrer au rayon de jeu (20 inversions/s mesurées avant)', () => {
    const { sim, petits } = makeDen({ hour: 2 })
    expect(petits.length, 'la prémisse : le gîte a des petits').toBeGreaterThan(0)
    expect(pireSecondeDuClan(sim, petits, 45)).toBeLessThanOrEqual(8)
  })

  it("les adultes ne s'épinglent pas à l'anneau du gîte (DEN_HOME_RADIUS)", () => {
    const { sim, adultes, den } = makeDen({ hour: 2 })
    expect(adultes.length, 'la prémisse : le gîte a des adultes').toBeGreaterThan(1)
    // Posés SUR l'anneau, serrés — le pire montage du relevé (corps à 0,3 tuile).
    adultes.forEach((m, i) => {
      const e = entity(sim, m.entityId)
      e.x = den.x + FAUNA.DEN_HOME_RADIUS + 0.4
      e.y = den.y + i * 0.3
    })
    // Le dépilage d'une pile TÉLÉPORTÉE est un transitoire (la séparation Jacobi
    // défait la superposition en quelques secondes) : la promesse de R22 porte
    // sur le DURABLE. On laisse la pile se défaire hors mesure, puis on exige le
    // calme — avant le correctif, l'anneau tremblait ENCORE à la minute.
    for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) tick(sim)
    expect(pireSecondeDuClan(sim, adultes, 30)).toBeLessThanOrEqual(8)
  })
})
