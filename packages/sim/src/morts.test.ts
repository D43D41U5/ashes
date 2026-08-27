/**
 * LE CHAMP DES MORTS et LA COURONNE DE RÉVEIL — critères A17 à A22 de `docs/specs/cendreux.md`.
 *
 * La règle que ces tests protègent tient en une phrase, et elle a été payée trois fois
 * aujourd'hui : **le champ décide combien et où, jamais si** (R16). Chaque fois qu'une règle a
 * laissé la géographie AUTORISER la nuit, la nuit est devenue muette autour de là où le joueur
 * vit — mesuré sur la carte de production : zéro cendre avant le jour 60, zéro sol brûlé à
 * moins de 74 tuiles, zéro Repaire à moins de 110.
 */
import { describe, it, expect } from 'vitest'
import { BALANCE, CENDREUX, MORTS, NIGHT_HUNT, TERRAIN_GRASS, TERRAIN_ROCK } from './balance'
import { createEmptyMap } from './map'
import { advanceReveils, densiteDesMorts, rodeursPortes, siteDansLaCouronne } from './morts'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { drainEvents } from './events'
import { die } from './combat'
import { advanceCendreux } from './cendreux'
import { cycleOffsetForStartHour, gameTimeAt, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'

/** Le cœur d'une saison, en jour de l'année — DÉRIVÉ d'`ACT_DAYS` (`saisons.md` S1 : quatre
 *  saisons de trente jours), jamais écrit. Un montage se pose sur une saison, pas sur un jour. */
const coeurDeSaison = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2

/** Une carte à zones, montée à la main : trois tiers, en bandes horizontales. */
function carteAZones(): SimState {
  const map = createEmptyMap(120, 120, TERRAIN_GRASS)
  const pas = 20
  const cols = Math.ceil(map.width / pas)
  const rows = Math.ceil(map.height / pas)
  map.zonePas = pas
  map.zoneDefs = [
    { slug: 'pres_bas', nom: 'les Prés Bas', tier: 0 },
    { slug: 'sylve', nom: 'la Sylve', tier: 1 },
    { slug: 'aiguilles', nom: 'les Aiguilles', tier: 2 },
  ]
  map.zoneGrid = new Array<number>(cols * rows)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) map.zoneGrid[j * cols + i] = j < 2 ? 0 : j < 4 ? 1 : 2
  return createSim(1, { map })
}

describe('le champ des morts (R15-R17)', () => {
  it('A17 — le champ a un PLANCHER : il ne rend jamais zéro, nulle part', () => {
    // C'est la garde structurelle de R16. Un champ qui peut rendre 0 est un interrupteur
    // déguisé, et l'interrupteur a rendu la nuit muette trois fois aujourd'hui.
    const state = carteAZones()
    for (let y = 0; y < state.map.height; y += 7) {
      for (let x = 0; x < state.map.width; x += 7) {
        expect(densiteDesMorts(state, x, y)).toBeGreaterThanOrEqual(MORTS.PLANCHER)
      }
    }
  })

  it('A18 — le champ a du RELIEF : les marges portent plus de morts que le pré du village', () => {
    const state = carteAZones()
    const chezSoi = densiteDesMorts(state, 60, 10) // tier 0
    const ceinture = densiteDesMorts(state, 60, 60) // tier 1
    const marges = densiteDesMorts(state, 60, 110) // tier 2
    expect(chezSoi).toBeLessThan(ceinture)
    expect(ceinture).toBeLessThan(marges)
    // Un rapport d'au moins deux : sinon « où tu dors décide » n'est qu'une phrase de spec.
    expect(marges / chezSoi).toBeGreaterThanOrEqual(2)
  })

  it('A18bis — il est BORNÉ à 1 : le pire sol de la vallée reste un sol', () => {
    const state = carteAZones()
    for (let y = 0; y < state.map.height; y += 11) {
      for (let x = 0; x < state.map.width; x += 11) expect(densiteDesMorts(state, x, y)).toBeLessThanOrEqual(1)
    }
  })

  it('A19 — une carte SANS zones vaut son plancher, uniformément (R17)', () => {
    // Un banc headless n'a pas demandé de géographie et ne doit pas en payer une — même
    // précédent que `zoneTierAt` (0), `faunaCap` (0) et `grounds` (vide). Le tirage pondéré
    // qui s'appuie dessus y redevient exactement uniforme.
    const state = createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS) })
    const d0 = densiteDesMorts(state, 5, 5)
    expect(d0).toBe(MORTS.PLANCHER + MORTS.PART_TIER[0]!)
    for (let y = 0; y < 64; y += 5) for (let x = 0; x < 64; x += 5) expect(densiteDesMorts(state, x, y)).toBe(d0)
  })

  it('A20 — le champ MODULE le nombre de rôdeurs, il ne le supprime jamais', () => {
    const state = carteAZones()
    const plafond = NIGHT_HUNT.UNDEAD_MAX_FIN // le plafond continu, à son sommet (le cœur du Grand Froid)
    const chezSoi = rodeursPortes(state, 60, 10, plafond)
    const marges = rodeursPortes(state, 60, 110, plafond)
    expect(chezSoi).toBeGreaterThanOrEqual(MORTS.MIN_RODEURS) // jamais zéro : il module (R16)
    expect(marges).toBeGreaterThan(chezSoi) // …mais il module VRAIMENT
    expect(marges).toBeLessThanOrEqual(plafond) // le plafond de l'acte reste le toit
  })

  it('A20bis — un plafond de zéro reste zéro : le plancher du champ ne ressuscite rien', () => {
    // Depuis le cadran de température, le « si » appartient à l'ÉVEIL (une plaine tiède
    // n'envoie pas de morts) et le plafond continu ne descend plus à zéro — mais la
    // propriété structurelle demeure : un plafond nul doit rendre zéro, le plancher du
    // champ ne doit jamais ressusciter un danger que l'appelant a éteint (R16).
    const state = carteAZones()
    expect(rodeursPortes(state, 60, 110, 0)).toBe(0)
  })
})

describe('la couronne de réveil (R18-R19)', () => {
  it('A21 — c\'est une COURONNE, pas quatre diagonales', () => {
    // Avant : `ox` ET `oy` à ±SPAWN_DIST, donc quatre points à 21,2 tuiles, jamais de côté.
    // On vérifie les deux : la distance est celle qu'annonce la constante, et le tour est fait.
    const state = createSim(1, { map: createEmptyMap(120, 120, TERRAIN_GRASS) })
    const angles = new Set<string>()
    let dMin = Infinity
    let dMax = 0
    for (let i = 0; i < 200; i++) {
      const s = siteDansLaCouronne(state, 60, 60, i / 200)!
      expect(s).toBeDefined()
      const dx = s.x - 60
      const dy = s.y - 60
      const d = Math.sqrt(dx * dx + dy * dy)
      dMin = Math.min(dMin, d)
      dMax = Math.max(dMax, d)
      // le quadrant ET les axes : on note le signe, plus « est-ce un axe ? »
      angles.add(`${Math.sign(Math.round(dx))},${Math.sign(Math.round(dy))}`)
    }
    // Neuf secteurs possibles (8 directions + le centre exclu) : les 8 doivent être touchés.
    expect(angles.size).toBeGreaterThanOrEqual(8)
    expect(dMin).toBeGreaterThanOrEqual(NIGHT_HUNT.SPAWN_DIST - NIGHT_HUNT.SPAWN_RING - 1)
    expect(dMax).toBeLessThanOrEqual(NIGHT_HUNT.SPAWN_DIST + NIGHT_HUNT.SPAWN_RING + 1)
    // …et surtout : plus JAMAIS la diagonale de 21,2 que produisait l'ancien placement.
    expect(dMax).toBeLessThan(NIGHT_HUNT.SPAWN_DIST * 1.41)
  })

  it('A22 — le sol PORTE et il MÈNE à la proie : jamais dans la roche, jamais sans chemin', () => {
    // MESURÉ avant, sur la carte de production : 14,0 % des naissances tombaient dans la roche
    // ou un mur, 4,2 % sur un sol libre sans aucun chemin — 18,2 % de nuits perdues en silence.
    // Ici : une île d'herbe cernée de roche, et la proie dessus.
    const map = createEmptyMap(120, 120, TERRAIN_ROCK)
    for (let y = 40; y < 80; y++) for (let x = 40; x < 80; x++) map.terrain[y * map.width + x] = TERRAIN_GRASS
    const state = createSim(1, { map })
    for (let i = 0; i < 100; i++) {
      const s = siteDansLaCouronne(state, 60, 60, i / 100)
      if (!s) continue // la couronne peut être entièrement noyée : le refus est LOYAL
      expect(map.terrain[Math.floor(s.y) * map.width + Math.floor(s.x)]).toBe(TERRAIN_GRASS)
    }
  })

  it('A22bis — aucun sol praticable : il refuse, il ne pose pas dans le mur', () => {
    // L'ancien code gardait le dernier essai, bloqué ou non — c'est le bug exact de R12 pour
    // la horde. Ici, tout est roche : la bonne réponse est « rien », pas « n'importe où ».
    const state = createSim(1, { map: createEmptyMap(120, 120, TERRAIN_ROCK) })
    expect(siteDansLaCouronne(state, 60, 60, 0.5)).toBeUndefined()
  })

  it('A22ter — une ENCEINTE ne disqualifie rien : le siège reste possible (R3)', () => {
    // LA FAUTE DE CONCEPTION QUE CE TEST FERME. Exiger un chemin à travers les STRUCTURES
    // paraît juste et ne l'est pas : R3 dit qu'un Cendreux qui ne peut pas atteindre sa cible
    // FRAPPE le franchissement qui le bloque — c'est ce qui donne leur raison d'être aux murs,
    // au toit et à la porte, et c'est ce qu'A4 vient tout juste de livrer. Un test de
    // joignabilité naïf aurait rendu le joueur enclos intouchable UNE SECONDE FOIS, par
    // l'autre bout : plus aucun réveil autour de lui. La roche disqualifie, le mur non.
    const state = createSim(1, { map: createEmptyMap(120, 120, TERRAIN_GRASS) })
    let id = 1000
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) !== 2 && Math.abs(dy) !== 2) continue
        state.structures.push({ id: id++, type: 'wall', tx: 60 + dx, ty: 60 + dy, villageId: 0, hp: 200 } as never)
      }
    }
    const site = siteDansLaCouronne(state, 60.5, 60.5, 0.5)
    expect(site).toBeDefined() // …et le Cendreux ira frapper à la porte (A4)
  })

  it('A23 — UN SEUL tirage, et le même tirage rend le même site (déterminisme)', () => {
    const state = carteAZones()
    const rng = state.rngState
    const a = siteDansLaCouronne(state, 60, 60, 0.42, (tx, ty) => densiteDesMorts(state, tx, ty))
    const b = siteDansLaCouronne(state, 60, 60, 0.42, (tx, ty) => densiteDesMorts(state, tx, ty))
    expect(a).toEqual(b)
    // …et il n'a RIEN consommé du PRNG de l'état : le tirage lui est passé, pas pris (R19).
    expect(state.rngState).toEqual(rng)
  })

  it('A24 — le champ PONDÈRE vraiment le placement : le mort sort du pire sol', () => {
    // Une carte dont la moitié nord est en tier 2 et la moitié sud en tier 0. Sur beaucoup de
    // tirages, les réveils doivent pencher au nord — sinon la pondération est décorative.
    const map = createEmptyMap(120, 120, TERRAIN_GRASS)
    const pas = 20
    const cols = Math.ceil(map.width / pas)
    const rows = Math.ceil(map.height / pas)
    map.zonePas = pas
    map.zoneDefs = [
      { slug: 'aiguilles', nom: 'les Aiguilles', tier: 2 },
      { slug: 'pres_bas', nom: 'les Prés Bas', tier: 0 },
    ]
    map.zoneGrid = new Array<number>(cols * rows)
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) map.zoneGrid[j * cols + i] = j < rows / 2 ? 0 : 1
    const state = createSim(1, { map })

    let nord = 0
    let sud = 0
    for (let i = 0; i < 400; i++) {
      const s = siteDansLaCouronne(state, 60, 60, i / 400, (tx, ty) => densiteDesMorts(state, tx, ty))!
      if (s.y < 60) nord += 1
      else if (s.y > 60) sud += 1
    }
    // 0,75 contre 0,25 : le nord doit l'emporter largement, sans écraser le sud (le plancher
    // garantit qu'un réveil au sud reste possible — c'est R16, vu depuis le placement).
    expect(nord).toBeGreaterThan(sud * 1.5)
    expect(sud).toBeGreaterThan(0)
  })
})

describe('le réveil : le sol travaille, puis il rend son mort (R14, R21)', () => {
  /** Une nuit, un homme seul, loin de tout : le montage minimal de la nuit qui chasse. */
  function nuitAvecUnHomme(): { state: SimState; proie: number } {
    const state = createSim(7, {
      map: createEmptyMap(120, 120, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(0, 1), // minuit
      calendarScale: 1,
    })
    // AU CŒUR DU GRAND FROID : c'est l'éveil qui décide si la nuit envoie un mort ou un loup,
    // et il ne tient qu'au froid (`eveilCendreuxAt`). Ce montage visait « l'acte III » quand
    // l'acte III était l'hiver ; sous les quatre saisons qui tournent (`saisons.md` S1, S4) le
    // même jour 55 est le plein été, où l'éveil vaut zéro — la nuit n'y enverrait que des loups.
    state.tick = (coeurDeSaison(4) - 1) * TICKS_PER_SEASON_DAY // l'éveil est à 1 : QUE des morts
    state.tick -= state.tick % TICKS_PER_CYCLE
    expect(gameTimeAt(state, state.tick).isNight).toBe(true) // minuit, et on le prouve
    const id = spawnEntity(state, 60.5, 60.5)
    return { state, proie: id }
  }

  it('A25 — la nuit ne pose plus un monstre : elle plante un RÉVEIL, et il MÛRIT', () => {
    const { state } = nuitAvecUnHomme()
    let vuEnCours = false
    for (let t = 0; t < 8 * 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(state, [])
      if (state.reveils.length > 0) vuEnCours = true
      if (state.monsters.some((m) => m.type === 'cendreux')) break
    }
    expect(vuEnCours).toBe(true) // le sol a travaillé…
    const ne = state.monsters.find((m) => m.type === 'cendreux')
    expect(ne).toBeDefined() // …et il a rendu son mort
    // …avec tout ce que la nuit qui chasse lui donnait avant : il se dissipe, il mord, il sait
    // pour qui il est venu. Un réveil qui perdrait ces trois marques ferait un Cendreux errant.
    expect(ne!.ambient).toBe(true)
    expect(ne!.nightHunter).toBe(true)
    expect(ne!.huntTargetId).not.toBeUndefined()
  })

  it('A26 — il naît PRÈS, et bien plus près que le loup', () => {
    const { state } = nuitAvecUnHomme()
    for (let t = 0; t < 8 * 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(state, [])
      if (state.reveils.length > 0) break
    }
    const r = state.reveils[0]!
    // Multiplication explicite : `**` est interdit dans /sim, tests compris (invariant n°2 —
    // l'opérateur de puissance n'est pas exact d'un moteur JS à l'autre).
    const dx = r.x - 60.5
    const dy = r.y - 60.5
    const d = Math.sqrt(dx * dx + dy * dy)
    // LES DEUX BORNES. Un plafond seul laisserait passer un réveil à distance ZÉRO — sous les
    // pieds du joueur —, ce qui n'est plus théorique maintenant que la naissance est proche :
    // c'est exactement le « jamais collé dans le dos » que la nuit qui chasse promet.
    expect(d).toBeGreaterThanOrEqual(NIGHT_HUNT.SPAWN_DIST_UNDEAD - NIGHT_HUNT.SPAWN_RING_UNDEAD - 1)
    expect(d).toBeLessThanOrEqual(NIGHT_HUNT.SPAWN_DIST_UNDEAD + NIGHT_HUNT.SPAWN_RING_UNDEAD + 1)
    // À 1,3 tuile/s, quinze tuiles font SEIZE SECONDES de marche : contre un joueur à 4 t/s,
    // le Cendreux n'atteignait jamais rien. C'est le préavis du réveil qui paie ce
    // rapprochement — et le loup, lui, garde ses quinze tuiles (il les couvre en trois s).
    expect(NIGHT_HUNT.SPAWN_DIST_UNDEAD).toBeLessThan(NIGHT_HUNT.SPAWN_DIST)
  })

  it('A27 (RENVERSÉE le 2026-08-21, décision ⑦) — LE FEU REPOUSSE LE RÉVEIL, il ne l\'annule plus', () => {
    // L'ANCIENNE A27 (« le feu étouffe, rien n'en sort ») est morte SCIEMMENT : le feu qui
    // annulait était le germe d'un ward magique — le camp au feu ne voyait jamais le Grand Froid.
    // La nouvelle règle : le tertre s'effondre ici (`reveil_etouffe`, même geste à l'écran),
    // et le sol REPREND son travail hors de la bulle, timer remis à neuf. Le feu achète de
    // la DISTANCE et du TEMPS — chaque bulle se paie en bois — jamais l'immunité.
    const { state } = nuitAvecUnHomme()
    for (let t = 0; t < 8 * 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(state, [])
      if (state.reveils.length > 0) break
    }
    const r = state.reveils[0]!
    expect(r).toBeDefined()
    // Le joueur rallume : un feu à portée, PENDANT que le sol travaille.
    state.structures.push({ type: 'fire', tx: Math.floor(r.x), ty: Math.floor(r.y), villageId: 0, lit: true } as never)
    drainEvents(state)
    step(state, [])
    // Le tertre d'ICI s'est tu…
    expect(drainEvents(state).some((e) => e.type === 'reveil_etouffe')).toBe(true)
    // …mais le sol a REPRIS ailleurs : un réveil vit toujours, HORS de la bulle, timer neuf.
    expect(state.reveils.length).toBe(1)
    const deplace = state.reveils[0]!
    const ddx = deplace.x - (Math.floor(r.x) + 0.5)
    const ddy = deplace.y - (Math.floor(r.y) + 0.5)
    expect(ddx * ddx + ddy * ddy).toBeGreaterThan(CENDREUX.HEARTH_WARD_RADIUS * CENDREUX.HEARTH_WARD_RADIUS)
    expect(deplace.at).toBeGreaterThan(r.at - 1) // le temps est racheté : terme repoussé
    expect(deplace.preyId).toBe(r.preyId) // c'est toujours pour LUI que le sol se lève
    // Et il ABOUTIT : quelque chose finit par sortir — hors de la bulle. Le feu n'est plus
    // une immunité ; c'est le renversement assumé de l'ancienne assertion.
    for (let t = 0; t < MORTS.REVEIL_TICKS * 3; t++) step(state, [])
    const sorti = state.monsters.find((m) => m.type === 'cendreux' && m.nightHunter === true)
    expect(sorti).toBeDefined()
  })

  it('R9 tient toujours — la VEILLÉE DU CADAVRE au feu, elle, n\'a pas bougé d\'un iota', () => {
    // La décision ⑦ ne touche que le RÉVEIL du sol. Un cadavre veillé par un feu ne se
    // relève pas, et l'annulation est revérifiée au réveil — S4 mot pour mot.
    const state = createSim(7, { map: createEmptyMap(64, 64, TERRAIN_GRASS) })
    const id = spawnEntity(state, 30.5, 30.5)
    const e = state.entities.find((en) => en.id === id)!
    die(state, e, 0, 'cold')
    const corpse = state.corpses.find((c) => c.risesAt !== undefined)!
    state.structures.push({ type: 'fire', tx: 30, ty: 30, villageId: 0 } as never)
    state.tick = corpse.risesAt!
    advanceCendreux(state)
    expect(state.monsters.find((m) => m.type === 'cendreux')).toBeUndefined()
    expect(state.corpses.find((c) => c.id === corpse.id)?.risesAt).toBeUndefined()
  })

  it('A28 — le réveil n\'ajoute AUCUN tirage : allumer un feu ne décale pas le monde', () => {
    // Le site et l'instant sont décidés à la plantation. Si l'étouffement ou l'émergence
    // consommaient du PRNG, une décision du joueur (allumer) déplacerait le flux seedé — et
    // deux parties identiques divergeraient sur un geste qui n'est pas un input de sim.
    const { state } = nuitAvecUnHomme()
    for (let t = 0; t < 8 * 60 * BALANCE.TICK_RATE_HZ; t++) {
      step(state, [])
      if (state.reveils.length > 0) break
    }
    const rng = state.rngState
    advanceReveils(state) // mûrit ou pas, peu importe
    expect(state.rngState).toEqual(rng)
  })
})
