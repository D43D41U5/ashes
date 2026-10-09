import { describe, expect, it } from 'vitest'
import { BALANCE, COMBAT, FIRE, MONSTER_DEFS, NUIT, SLOTS, TEMPERATURE, TERRAIN_GRASS } from './balance'
import { braiseNeuve } from './braise'
import { addItems, makeInventory } from './items'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type Entity, type MoveInput, type SimState } from './sim'
import { cycleOffsetForStartHour, gameTimeAt, jourDeSaison, TICKS_PER_CYCLE } from './time'
import { addStructure, type Structure } from './village'
import {
  clarteDeLune,
  clarteDeCeQuOnPorte,
  clarteDuCiel,
  clarteDuSoleil,
  clarteSurSoi,
  LUNAISON_JOURS,
  LUNE_PLEINE_JOUR,
  phaseDeLune,
} from './nuit'

/**
 * ⚠ UN FOYER LIBRE NAÎT ÉTEINT DEPUIS `braise.md` B-R17 (2026-10-04) : un `addStructure` nu ne
 * brûle plus rien. Les gardes de ce fichier éprouvent un feu QUI BRÛLE, donc le montage lui donne
 * la flamme — c'est la prémisse perdue qu'on refabrique, pas un contournement de la loi : la loi
 * elle-même est éprouvée par le vrai chemin joueur dans `braise.test.ts` (B-A17).
 */
/**
 * ⚠ **LA PRÉMISSE DES GARDES DE NUIT AVEUGLE, depuis l'étape 7** (B-R13c, 2026-10-05) : un
 * avatar neuf porte une braise PLEINE, donc il est sa propre source de lumière (clarté 1). Toute
 * garde qui affirme « ici on ne voit rien » doit donc vider la braise — sinon elle est rouge, ou
 * verte pour la mauvaise raison. `charge: 0` est l'état de jeu où la nuit noire existe encore
 * sous l'issue ⓐ (`braise.md` § 5.21) ; `braise: undefined` serait une sauvegarde d'avant l'étape 4.
 */
const braiseVide = (e: Entity): Entity => {
  if (e.braise !== undefined) e.braise.charge = 0
  return e
}
const allume = <S extends Structure>(sim: SimState, s: S): S => {
  s.allumee = true
  // …ET L'ANCRE DE COMBUSTION AVEC. `addStructure` ne la pose plus (un foyer naît éteint, donc rien
  // ne brûle à sa naissance) ; la production l'ancre au premier tick de flamme, clause « Sécurité »
  // d'`advanceFire`. Ici on la pose AVEC la flamme, pour rendre exactement l'état de naissance
  // d'avant la loi — c'est ce que ces montages supposent quand ils règlent `burnAt` à la main.
  if (s.fuel && s.burnAt === undefined) { s.burnAt = sim.tick; s.burnSlot = 0 }
  return s
}

/**
 * LE CADRAN DE LA LUNE, CÔTÉ /sim.
 *
 * Ce que ce fichier garde vraiment, ce n'est pas « la lune a des phases » (une table ne
 * surprend personne) : c'est que la COURBE TABULÉE reste celle du cosinus qu'elle remplace
 * (invariant §2 interdit `Math.cos` ici), et que les deux bouts qui portent tout le sens du
 * cadran — 0 à la nouvelle lune, 1 à la pleine — soient EXACTS et non « proches ». Une table
 * recopiée de travers ne casserait aucun autre test du dépôt : elle rendrait seulement la
 * moitié des nuits du jeu plus clémentes, en silence.
 */
/**
 * LA VRAIE COURBE, AUX PIRES POINTS — `(1 − cos 2πφ) / 2` évalué HORS des nœuds de la table
 * (aux MILIEUX de ses segments, là où une interpolation linéaire s'écarte le plus), et
 * recopié ici en littéraux : `Math.cos` est interdit jusque dans les tests de `/sim`.
 *
 * Ces douze nombres ne viennent PAS de la table qu'ils éprouvent — une garde écrite avec la
 * constante qu'elle teste ne garde rien. Ils viennent du cosinus, à six décimales.
 */
const REFERENCE: readonly (readonly [number, number])[] = [
  [0.0208333333, 0.004278],
  [0.0625, 0.03806],
  [0.1041666667, 0.103323],
  [0.1458333333, 0.195619],
  [0.1875, 0.308658],
  [0.2291666667, 0.434737],
  [0.2708333333, 0.565263],
  [0.3125, 0.691342],
  [0.3541666667, 0.804381],
  [0.3958333333, 0.896677],
  [0.4375, 0.96194],
  [0.4791666667, 0.995722],
]
/** Le jour de saison qui porte cette phase de lune (l'inverse de `phaseDeLune`). */
const jourDePhase = (phi: number): number => LUNE_PLEINE_JOUR + (phi - 0.5) * LUNAISON_JOURS

function makeSim(jourDeDepart = LUNE_PLEINE_JOUR): SimState {
  return createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart })
}
const ent = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!

/** LA NOUVELLE LUNE tombe à une DEMI-lunaison de la pleine — 11,5 jours, pas 11. */
const NOUVELLE_LUNE_JOUR = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2
/** Une braise PLEINE, le `soi` du plancher de B-R13d — par `braiseNeuve`, jamais un littéral. */
const braisePleine = (): NonNullable<Entity['braise']> => braiseNeuve(0)

/** Un feu LIBRE et allumé à `d` tuiles de (48,5 · 48,5) — le montage de `torche.test.ts`. */
function feu(sim: SimState, d = 1) {
  const s = allume(sim, addStructure(sim, 'fire', 48 + d, 48, 0, 0))
  s.fuel = makeInventory(FIRE.FUEL_SLOTS)
  addItems(s.fuel, { wood: 3 })
  s.burnAt = sim.tick
  s.burnSlot = 0
  return s
}

describe('la lune — la courbe', () => {
  it('L1 — les deux bouts sont EXACTS : 1 à la pleine lune, 0 à la neuve', () => {
    expect(clarteDeLune(LUNE_PLEINE_JOUR)).toBe(1)
    expect(clarteDeLune(NOUVELLE_LUNE_JOUR)).toBe(0)
    expect(phaseDeLune(LUNE_PLEINE_JOUR)).toBeCloseTo(0.5, 12)
    expect(phaseDeLune(NOUVELLE_LUNE_JOUR)).toBeCloseTo(0, 12)
  })

  it('L2 — la table SUIT le cosinus qu’elle remplace : écart ≤ 0,005 aux PIRES points', () => {
    let pire = 0
    for (const [phi, vrai] of REFERENCE) {
      // Le montage d'abord : `jourDePhase` rend bien un jour QUI PORTE cette phase.
      expect(phaseDeLune(jourDePhase(phi))).toBeCloseTo(phi, 10)
      // Puis les DEUX demi-lunaisons (φ et 1−φ ont la même clarté), puisque la lecture
      // exploite la symétrie : un miroir posé de travers ne se verrait que d'un côté.
      for (const jour of [jourDePhase(phi), jourDePhase(1 - phi)]) {
        const d = Math.abs(clarteDeLune(jour) - vrai)
        if (d > pire) pire = d
      }
    }
    // 0,0042 mesuré à l'écriture (au voisinage de la pleine lune, là où le pas est le plus
    // raide). La borne est AU-DESSUS du pire cas mesuré, pas du cas moyen.
    expect(pire).toBeLessThanOrEqual(0.005)
    expect(pire).toBeGreaterThan(0) // sinon la table serait le cosinus, et la garde inutile
  })

  it('L3 — le monde OUVRE sur la pleine lune (promesse de `saisons.md` S2)', () => {
    expect(clarteDeLune(BALANCE.JOUR_DE_DEPART)).toBe(1)
  })

  it('L4 — la lunaison boucle sur 23 jours, et rien n’en sort de [0, 1]', () => {
    for (let k = 0; k <= 460; k++) {
      const jour = LUNE_PLEINE_JOUR + (k / 460) * LUNAISON_JOURS
      const c = clarteDeLune(jour)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
      expect(clarteDeLune(jour + LUNAISON_JOURS)).toBeCloseTo(c, 12)
      expect(clarteDeLune(jour - 3 * LUNAISON_JOURS)).toBeCloseTo(c, 12)
    }
  })

  it('L5 — elle CROÎT sans un cran de la nouvelle lune à la pleine (et redescend ensuite)', () => {
    let prec = -1
    for (let k = 0; k <= 500; k++) {
      const c = clarteDeLune(NOUVELLE_LUNE_JOUR + (k / 500) * (LUNAISON_JOURS / 2))
      expect(c).toBeGreaterThanOrEqual(prec - 1e-12)
      prec = c
    }
    expect(prec).toBeCloseTo(1, 6)
  })
})

describe('la clarté du ciel — le noir TOMBE, il ne claque pas', () => {
  it('C1 — plein jour : 1, que la lune soit pleine ou neuve', () => {
    for (const jour of [LUNE_PLEINE_JOUR, NOUVELLE_LUNE_JOUR]) {
      const sim = makeSim(Math.floor(jour))
      sim.cycleOffset = cycleOffsetForStartHour(12, jourDeSaison(sim)) // midi
      expect(clarteDuCiel(sim)).toBe(1)
    }
  })

  it('C2 — cœur de la nuit : le ciel ne rend QUE ce que la lune en laisse', () => {
    const sim = makeSim(LUNE_PLEINE_JOUR)
    sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim)) // minuit
    const t = gameTimeAt(sim, sim.tick)
    expect(t.nuit).toBe(1)
    expect(clarteDuCiel(sim)).toBeCloseTo(clarteDeLune(t.seasonDay + t.jourFrac), 12)
  })

  it('C3 — la NOUVELLE lune est le fond du noir, et la pleine ne l’est jamais', () => {
    const noire = makeSim(Math.floor(NOUVELLE_LUNE_JOUR))
    noire.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(noire))
    const pleine = makeSim(LUNE_PLEINE_JOUR)
    pleine.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(pleine))
    expect(clarteDuCiel(noire)).toBeLessThan(0.15)
    expect(clarteDuCiel(pleine)).toBe(1)
  })

  // ═══ LA PORTE DU PLANCHER PORTÉ NE COMPTE QUE LE SOLEIL (`braise.md` § 5.28 ⓒ, 2026-10-08) ═══
  //
  // ⚠ CES TROIS GARDES NE SONT PAS DES REDITES DE C1-C3 : elles éprouvent la grandeur sur
  //   laquelle se GATE le plancher de B-R13d, et le défaut qu'elles ferment était invisible
  //   pour C1-C3, qui ne parlent que de la vision. La forme assertée est celle de la PORTE
  //   (`soi − ciel`), pas celle de la clarté, parce que c'est la porte qui décide.
  it('C3 bis — à midi, soleil et ciel SE CONFONDENT : la porte reste fermée, l’inertie de midi est intacte', () => {
    // La propriété qu'il ne faut SURTOUT pas perdre : à découvert à midi, `partsDuCorps` sature
    // et un plancher y effacerait le modelé du soleil (MESURÉ le 2026-10-05 : face au soleil
    // ×0,873, l'écran plus SOMBRE que sans lumière portée). Les deux lectures doivent donc
    // coïncider à midi, pleine lune comme neuve.
    for (const jour of [LUNE_PLEINE_JOUR, NOUVELLE_LUNE_JOUR]) {
      const sim = makeSim(Math.floor(jour))
      sim.cycleOffset = cycleOffsetForStartHour(12, jourDeSaison(sim))
      expect(clarteDuSoleil(sim)).toBe(1)
      expect(clarteDuSoleil(sim)).toBe(clarteDuCiel(sim))
      // …et la porte d'un porteur à braise PLEINE est fermée (≤ 0) à découvert.
      expect(clarteDeCeQuOnPorte(false, braisePleine()) - clarteDuSoleil(sim)).toBeLessThanOrEqual(0)
    }
  })

  it('C3 ter — la PLEINE LUNE n’achète plus le plancher : porte ouverte au soleil, fermée au ciel', () => {
    const sim = makeSim(LUNE_PLEINE_JOUR)
    sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim))
    const soi = clarteDeCeQuOnPorte(false, braisePleine())
    // LA PRÉMISSE, affirmée et non supposée : cette nuit-là est VRAIMENT une pleine lune, donc
    // l'ancienne porte était bien fermée. Sans cette clause, la garde serait verte sur une
    // nouvelle lune, où les deux lectures coïncident — le cas qui ne prouve rien.
    expect(clarteDuCiel(sim)).toBeGreaterThan(0.99)
    expect(soi - clarteDuCiel(sim)).toBeLessThan(0.01)
    // LE GAIN : au soleil seul, la nuit est une nuit, et le plancher rend tout.
    expect(clarteDuSoleil(sim)).toBe(0)
    expect(soi - clarteDuSoleil(sim)).toBe(soi)
  })

  it('C3 quater — sur la lunaison ENTIÈRE : le soleil ne dépasse jamais le ciel, et la porte ne se referme plus jamais', () => {
    // Le balayage, parce que le défaut de 2026-10-06 ne se voyait pas sur deux instants choisis :
    // il se comptait en NUITS (13 sur 30 donnaient au plancher la moitié de son amplitude).
    const soi = clarteDeCeQuOnPorte(false, braisePleine())
    let fermeesAuCiel = 0
    for (let d = 0; d < Math.ceil(LUNAISON_JOURS); d++) {
      const sim = makeSim(Math.floor(LUNE_PLEINE_JOUR + d))
      sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim))
      const ciel = clarteDuCiel(sim)
      const soleil = clarteDuSoleil(sim)
      // ① La lune ne peut qu'AJOUTER : le soleil seul est toujours ≤ le ciel entier.
      expect(soleil).toBeLessThanOrEqual(ciel)
      // ② Et au cœur de la nuit la porte est désormais GRANDE ouverte, toutes les nuits.
      expect(soi - soleil).toBeCloseTo(soi, 12)
      if (soi - ciel < soi / 2) fermeesAuCiel++
    }
    // LE CONTRÔLE POSITIF, qui dit ce que la loi ACHÈTE : avec l'ancienne lecture, une bonne
    // partie des nuits de la lunaison rendait moins de la moitié de l'amplitude. Si ce compte
    // tombait à zéro, c'est que la lune aurait cessé d'éclairer et la garde ne prouverait rien.
    expect(fermeesAuCiel).toBeGreaterThan(5)
  })

  it('C4 — AUCUN MUR sur le cycle entier : la pente du crépuscule est continue', () => {
    const sim = makeSim(Math.floor(NOUVELLE_LUNE_JOUR))
    let pire = 0
    let prec = clarteDuCiel(sim, 0)
    // Un pas de 40 ticks (2 s) : assez fin pour qu'un `if isNight` se voie (il rendrait un
    // saut d'un coup de toute la profondeur du noir), assez large pour rester rapide.
    for (let tick = 40; tick <= TICKS_PER_CYCLE; tick += 40) {
      const c = clarteDuCiel(sim, tick)
      const d = Math.abs(c - prec)
      if (d > pire) pire = d
      prec = c
    }
    expect(pire).toBeLessThan(0.05)
  })

  it('C5 — la clarté ne consomme AUCUN tirage (le flux seedé ne bouge pas)', () => {
    const sim = makeSim()
    const avant = sim.rngState
    for (let tick = 0; tick < 500; tick++) clarteDuCiel(sim, tick)
    expect(sim.rngState).toBe(avant)
  })
})

describe('la clarté sur soi — trois sources, un seul max', () => {
  const nuitNoire = (): SimState => {
    const sim = makeSim(Math.floor(NOUVELLE_LUNE_JOUR))
    sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim))
    return sim
  }

  it('S1 — la torche en main éclaire à plein, même au fond de la nouvelle lune', () => {
    const sim = nuitNoire()
    const id = spawnEntity(sim, 48.5, 48.5)
    const e = braiseVide(ent(sim, id))
    e.inventory = makeInventory(SLOTS.PLAYER)
    e.inventory[0] = { item: 'torche_vive', count: 1, wear: 0 }
    e.activeSlot = 0
    expect(clarteSurSoi(sim, e)).toBe(1)
    // ÉTEINTE, elle n'éclaire rien — c'est la flamme qui compte, pas le fagot.
    e.inventory[0] = { item: 'torche', count: 1 }
    expect(clarteSurSoi(sim, e)).toBeLessThan(0.15)
  })

  it('S2 — le coin du feu vaut la lumière, et elle DÉCROÎT jusqu’au bord de sa bulle', () => {
    const sim = nuitNoire()
    const id = spawnEntity(sim, 48.5, 48.5)
    const e = braiseVide(ent(sim, id))
    e.inventory = makeInventory(SLOTS.PLAYER)
    feu(sim, 1)
    const auContact = clarteSurSoi(sim, e)
    expect(auContact).toBeGreaterThan(0.7)
    // Trois tuiles plus loin : encore éclairé, mais moins.
    e.x = 48.5 + 3
    const plusLoin = clarteSurSoi(sim, e)
    expect(plusLoin).toBeLessThan(auContact)
    expect(plusLoin).toBeGreaterThan(0)
    // HORS de la bulle (`TEMPERATURE.FIRE_RANGE`) : le feu ne compte plus, il reste le ciel.
    e.x = 48.5 + TEMPERATURE.FIRE_RANGE + 1
    expect(clarteSurSoi(sim, e)).toBeCloseTo(clarteDuCiel(sim), 12)
  })

  it('S3 — un feu ÉTEINT n’éclaire pas (la bulle est celle qui chauffe)', () => {
    const sim = nuitNoire()
    const id = spawnEntity(sim, 48.5, 48.5)
    const e = braiseVide(ent(sim, id))
    e.inventory = makeInventory(SLOTS.PLAYER)
    const f = feu(sim, 1)
    f.fuel = makeInventory(FIRE.FUEL_SLOTS)
    delete f.burnAt
    delete f.burnSlot
    expect(clarteSurSoi(sim, e)).toBeCloseTo(clarteDuCiel(sim), 12)
  })
})

/**
 * LE PRIX DU NOIR (décision d'Alexis, 2026-08-26 : « la sortie dehors la nuit doit être dure »).
 *
 * Ces gardes se jouent sur `step()` et non sur `speedScaleFor` appelée à la main : la règle
 * vit dans l'ESPACE entre la posture, la clarté et l'allure, et une phase appelée seule ne
 * résout rien de ce qui compte ici (`entity.gait`, `entity.blocking`).
 */
describe('le prix du noir — on ne court pas, on ne pare pas', () => {
  /** Un monde posé sur la nuit voulue, avec un avatar au centre. */
  function nuitAvec(jour: number): { sim: SimState; id: number } {
    const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart: jour })
    sim.cycleOffset = cycleOffsetForStartHour(0, jour) // minuit : le fond de la nuit
    const id = spawnEntity(sim, 48.5, 48.5)
    braiseVide(ent(sim, id)).inventory = makeInventory(SLOTS.PLAYER)
    return { sim, id }
  }
  const marcher = (id: number): MoveInput[] => [{ entityId: id, dx: 1, dy: 0, sprint: true }]

  it('P1 — SOUS LA PLEINE LUNE, on court : la lune suffit, la torche est inutile', () => {
    const { sim, id } = nuitAvec(LUNE_PLEINE_JOUR)
    step(sim, marcher(id))
    expect(ent(sim, id).gait).toBe('sprint')
  })

  it('P2 — SOUS LA NOUVELLE LUNE, ON COURT QUAND MÊME (Alexis, 2026-09-02)', () => {
    /**
     * ⚠ **CETTE GARDE AFFIRMAIT L'INVERSE, et c'est une décision d'Alexis qui l'a retournée** :
     * *« je veux que tu cut le ralentissement dans le noir, tout simplement. »* Des deux
     * capacités que la règle du 2026-08-26 refusait sous `NUIT.SEUIL_NOIR`, **les jambes sont
     * sorties** ; la parade reste (P5). Le motif tient dans les nombres de P7, qui n'ont pas
     * bougé : le loup court à 4,8 quand on marche à 4 — lui retirer le sprint ne rendait pas la
     * nuit dure, ça rendait le loup INÉVITABLE.
     *
     * On l'affirme sur la MÊME mesure qu'avant, dans l'autre sens : la nouvelle lune couvre
     * exactement autant de terrain que la pleine.
     */
    const { sim, id } = nuitAvec(Math.floor(NOUVELLE_LUNE_JOUR))
    const x0 = ent(sim, id).x
    step(sim, marcher(id))
    const e = ent(sim, id)
    expect(e.gait, 'on court dans le noir').toBe('sprint')
    const clair = nuitAvec(LUNE_PLEINE_JOUR)
    const xc = ent(clair.sim, clair.id).x
    step(clair.sim, marcher(clair.id))
    expect((ent(clair.sim, clair.id).x - xc) / (e.x - x0), 'le même terrain, à la lune près')
      .toBeCloseTo(1, 6)
  })

  it('P3 — LA TORCHE VIVE rend LA GARDE, la torche éteinte non', () => {
    // La flamme ne rend plus les JAMBES (elles ne se perdaient plus, P2) : elle rend la GARDE,
    // et c'est désormais la seule chose que le noir retire.
    const { sim, id } = nuitAvec(Math.floor(NOUVELLE_LUNE_JOUR))
    const e = ent(sim, id)
    e.inventory[0] = { item: 'torche_vive', count: 1, wear: 0 }
    e.activeSlot = 0
    step(sim, [{ entityId: id, dx: 0, dy: 0, block: true }])
    expect(ent(sim, id).blocking).toBe(true)

    const eteint = nuitAvec(Math.floor(NOUVELLE_LUNE_JOUR))
    const f = ent(eteint.sim, eteint.id)
    f.inventory[0] = { item: 'torche', count: 1 }
    f.activeSlot = 0
    step(eteint.sim, [{ entityId: eteint.id, dx: 0, dy: 0, block: true }])
    expect(ent(eteint.sim, eteint.id).blocking, 'une torche éteinte n’éclaire rien').toBe(false)
  })

  it('P4 — LE COIN DU FEU aussi : la lumière est la lumière, d’où qu’elle vienne', () => {
    const { sim, id } = nuitAvec(Math.floor(NOUVELLE_LUNE_JOUR))
    feu(sim, 1)
    step(sim, [{ entityId: id, dx: 0, dy: 0, block: true }])
    expect(ent(sim, id).blocking).toBe(true)
  })

  it('P5 — LA PARADE tombe avec les jambes, et revient avec la flamme', () => {
    const noir = nuitAvec(Math.floor(NOUVELLE_LUNE_JOUR))
    step(noir.sim, [{ entityId: noir.id, dx: 0, dy: 0, block: true }])
    expect(ent(noir.sim, noir.id).blocking).toBe(false)

    const clair = nuitAvec(LUNE_PLEINE_JOUR)
    step(clair.sim, [{ entityId: clair.id, dx: 0, dy: 0, block: true }])
    expect(ent(clair.sim, clair.id).blocking).toBe(true)

    const torche = nuitAvec(Math.floor(NOUVELLE_LUNE_JOUR))
    const e = ent(torche.sim, torche.id)
    e.inventory[0] = { item: 'torche_vive', count: 1, wear: 0 }
    e.activeSlot = 0
    step(torche.sim, [{ entityId: torche.id, dx: 0, dy: 0, block: true }])
    expect(ent(torche.sim, torche.id).blocking).toBe(true)
  })

  it('P6 — EN PLEIN JOUR, la règle n’existe pas (même à la nouvelle lune)', () => {
    const sim = createSim(1, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      jourDeDepart: Math.floor(NOUVELLE_LUNE_JOUR),
    })
    sim.cycleOffset = cycleOffsetForStartHour(12, jourDeSaison(sim))
    const id = spawnEntity(sim, 48.5, 48.5)
    ent(sim, id).inventory = makeInventory(SLOTS.PLAYER)
    step(sim, [{ entityId: id, dx: 1, dy: 0, sprint: true, block: false }])
    expect(ent(sim, id).gait).toBe('sprint')
  })

  it('P7 — LA PRÉMISSE, ET ELLE EXPLIQUE MAINTENANT POURQUOI LES JAMBES SONT SORTIES', () => {
    const marche = BALANCE.WALK_SPEED_TILES_PER_S
    const course = marche * COMBAT.SPRINT_FACTOR
    const loup = MONSTER_DEFS.wolf.speed
    // Les trois nombres n'ont pas bougé, c'est la CONCLUSION qu'on en tire qui a changé
    // (Alexis, 2026-09-02). Le loup est plus rapide qu'un marcheur et plus lent qu'un coureur :
    // c'est exactement ce qui faisait du sprint la réponse au loup — donc lui retirer le sprint
    // dans le noir ne rendait pas la nuit dure, ça rendait le loup INÉVITABLE. Le jour où l'un
    // des trois bouge, c'est ici qu'on l'apprend.
    expect(loup).toBeGreaterThan(marche)
    expect(loup).toBeLessThan(course)
    // Le Cendreux, lui, se sème à la marche : ce n'est PAS les jambes qui le rendent
    // dangereux, c'est la parade qu'on perd (34 de dégâts contre 14 au loup).
    expect(MONSTER_DEFS.cendreux.speed).toBeLessThan(marche)
    expect(MONSTER_DEFS.cendreux.damage).toBeGreaterThan(MONSTER_DEFS.wolf.damage)
  })

  it('P8 — le seuil est UN nombre, et il vit dans `balance.ts`', () => {
    expect(NUIT.SEUIL_NOIR).toBeGreaterThan(0)
    expect(NUIT.SEUIL_NOIR).toBeLessThan(1)
    // Et il DÉCOUPE la lunaison : quelques nuits aveugles, la majorité claires. Une valeur
    // qui rendrait TOUTES les nuits noires (ou aucune) serait un cadran mort.
    let aveugles = 0
    for (let d = 0; d < LUNAISON_JOURS; d++) {
      if (clarteDeLune(LUNE_PLEINE_JOUR + d) < NUIT.SEUIL_NOIR) aveugles++
    }
    expect(aveugles).toBeGreaterThan(2)
    expect(aveugles).toBeLessThan(LUNAISON_JOURS - 2)
  })
})
