/**
 * ═══ LA NASSE — LA PÊCHE QUI TRAVAILLE SANS NOUS (spec `nasse.md`, reprise de l'eau D3) ═══
 *
 * Quatre décisions d'Alexis (2026-09-13) : la nasse est une pêche **PASSIVE** ; **APPÂTÉE** (la
 * prise est proportionnelle à l'appât dépensé) ; **PERSONNELLE** (relève à la main) ; et un
 * **OUVRAGE POSÉ** — une pièce du registre, donc qu'on peut **PERDRE**.
 *
 * ═══ CES GARDES PROUVENT LEURS PRÉMISSES ═══
 *
 * La moitié des critères sont des ABSENCES (« sans appât, rien » ; « dans la glace, rien »), et
 * une absence passe au vert sur un mécanisme MORT. Chacune est donc précédée de son contraire
 * affirmé : le gel par `estGele` ET `eauIndisponible`, la souillure par `eauSouillee`, l'eau qui
 * se retire par `eauIndisponible` — et « la nasse pêche vraiment » par au moins une prise réelle.
 *
 * ═══ LA CADENCE SE FRANCHIT EN UN TICK, PAS EN 7/30 DE CYCLE ═══
 *
 * `NASSE.CADENCE_TICKS` vaut 8 400 ticks (7/30 de cycle — délibérément **pas un diviseur**, N6 :
 * à ¼ pile, les battements retombaient sur les quatre mêmes heures pour l'éternité, et la nasse
 * ne voyait jamais le créneau de nuit). Dérouler 8 400 `step()` par tentative rendrait ces gardes
 * inutilisables : on se place donc JUSTE AVANT le battement — la cadence est décalée par l'`id` de
 * la nasse — et on fait **UN vrai `step()`** : le mécanisme est éprouvé par la vraie boucle, pas
 * par un appel de phase isolé (`phase-seule-n-est-pas-un-tick`).
 *
 * Quand le MOMENT fait partie du montage (le gel, la souillure), on tient le tick FIXE et on
 * appelle `advanceNasses` en direct : une tentative qui dériverait d'un quart de cycle sortirait
 * de la nuit du Grand Froid, ou laisserait la rivière se laver de sa suie.
 */
import { describe, expect, it } from 'vitest'
import {
  BALANCE,
  FISH_SPECIES,
  NASSE,
  TERRAIN_DEEP_WATER,
  TERRAIN_GRASS,
  TERRAIN_SHALLOW_WATER,
  type NomDeNature,
} from './balance'
import { calculeChampDeCendre } from './cendre'
import { terrainConstructible } from './construction'
import { eauSouillee } from './coulee'
import { eauIndisponible } from './economy'
import { drainEvents, type SimEvent } from './events'
import { estGele } from './gel'
import { addItems, countOf, makeInventory, type Inventory, type ItemBag } from './items'
import { createEmptyMap, setTile, type WorldMap } from './map'
import { advanceNasses } from './nasse'
import { NATURE_LAC, NATURE_RIEN, NATURE_RIVIERE } from './peche-nature'
import { tableDePrises, type Conditions } from './peche-table'
import { PIECES } from './pieces'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { calendarScaleForSeasonCycles, dayTicksPourJour, TICKS_PER_CYCLE } from './time'
import { applyStructureDamage, hasAccess, type Structure } from './village'

// ── LE CALENDRIER DU BANC (même montage que `peche.test`/`gel.test`) ─────────
const SCALE = calendarScaleForSeasonCycles(BALANCE.SEASON_DAYS)
const coeurDe = (phase: number): number => (phase - 1) * BALANCE.ACT_DAYS + BALANCE.ACT_DAYS / 2
/** La seule fenêtre où le haut-fond prend vraiment : le cœur du Grand Froid, de nuit. */
const COEUR_DU_GRAND_FROID = coeurDe(4)
/** MIDI au cœur des Pluies : chaud, humide — l'eau est LIBRE. Un banc de pêche se pose à midi
 *  (à l'aube, la carte d'essai relève −2 °C et le haut-fond est PRIS). */
const JOUR_DOUX = coeurDe(3)
const MIDI_DOUX = Math.floor(dayTicksPourJour(JOUR_DOUX) / 2)

function tickDe(jour: number, nuit = false): number {
  const base = (jour - 1) * TICKS_PER_CYCLE
  const jourTicks = dayTicksPourJour(jour)
  return base + (nuit ? jourTicks + Math.floor((TICKS_PER_CYCLE - jourTicks) / 2) : Math.floor(jourTicks / 2))
}

// ── LE LAC D'ESSAI, ET SA NATURE ─────────────────────────────────────────────
const LAC = { x0: 20, y0: 10, x1: 30, y1: 20 }
/** La tuile de la nasse : un HAUT-FOND au bord du profond (`eauSeule` n'admet que ça). */
const NASSE_TX = 19
const NASSE_TY = 15

/**
 * La carte d'essai et SA nature d'eau, peintes à la main — comme `peche.test` : dériver la nature
 * ferait tester deux choses à la fois, et ici on veut CHOISIR l'eau (« et si c'était une rivière ? »
 * se pose en un argument).
 */
function carteDEssai(nature: number = NATURE_LAC): WorldMap {
  const map = createEmptyMap(60, 30, TERRAIN_GRASS)
  for (let ty = LAC.y0 - 1; ty <= LAC.y1; ty++) {
    for (let tx = LAC.x0 - 1; tx <= LAC.x1; tx++) {
      const profond = tx >= LAC.x0 && tx < LAC.x1 && ty >= LAC.y0 && ty < LAC.y1
      setTile(map, tx, ty, profond ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER)
    }
  }
  map.natureEau = map.terrain.map((t) => (t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER ? nature : NATURE_RIEN))
  return map
}

interface Banc {
  sim: SimState
  nasse: Structure
}

/** Pose une nasse À LA MAIN (les portes de pose ont leurs propres gardes, N1) et l'appâte. */
function poserNasse(sim: SimState, tx: number, ty: number, appats: ItemBag, cases?: number): Structure {
  const s: Structure = {
    id: sim.nextStructureId,
    type: 'fish_trap',
    tx,
    ty,
    villageId: 0,
    ownerId: 1,
    access: 'private',
    hp: PIECES.fish_trap.pv,
    inventory: makeInventory(cases ?? PIECES.fish_trap.capacite),
  }
  sim.nextStructureId += 1
  addItems(s.inventory!, appats)
  sim.structures.push(s)
  return s
}

function banc(opts: { appats?: ItemBag; nature?: number; seed?: number; gel?: boolean; cases?: number } = {}): Banc {
  const sim = createSim(opts.seed ?? 2026, {
    map: carteDEssai(opts.nature),
    nodes: [],
    faunaCap: 0,
    worldEvents: false,
    meteoActive: false,
    // Les bancs de gel gardent le jour 1 : `tickDe(jour)` compte ses cycles depuis lui.
    ...(opts.gel ? { calendarScale: SCALE } : { jourDeDepart: JOUR_DOUX }),
  })
  if (!opts.gel) sim.tick = MIDI_DOUX
  const nasse = poserNasse(sim, NASSE_TX, NASSE_TY, opts.appats ?? { worms: 30 }, opts.cases)
  drainEvents(sim)
  return { sim, nasse }
}

/** Aligne la cadence de CETTE nasse sur le tick `T` — l'`id` n'est qu'une donnée, et c'est le
 *  seul moyen de tenir l'instant FIXE au lieu de dériver d'un battement à l'autre. */
function caleLeBattement(b: Banc, T: number): void {
  const c = NASSE.CADENCE_TICKS
  b.nasse.id = (c - (T % c)) % c || c
}

/**
 * UNE tentative À L'INSTANT DU MONTAGE — et il est DÉLIBÉRÉ que toutes les tentatives d'une garde
 * tombent au même tick : le seul axe qui varie est alors le TIRAGE.
 *
 * ⚠ CE QUE CE BANC A APPRIS, ET QUI A CHANGÉ L'ÉQUILIBRAGE. Laisser le tick DÉRIVER de battement
 * en battement faisait pêcher la nasse à des heures arbitraires — or au cœur des Pluies le gué
 * PREND la nuit (`peche.md` : « un banc de pêche se pose à MIDI »). Résultat : zéro prise sur 40
 * tentatives et toutes les prémisses au rouge. La cause profonde n'était pas le banc : la cadence
 * DIVISAIT le cycle exactement, donc les battements rejouaient les mêmes quatre heures pour
 * toujours (corrigé — `NASSE.CADENCE_TICKS` vaut 7/30 de cycle et précesse).
 */
function tentativeAuTick(b: Banc, T: number = MIDI_DOUX): SimEvent[] {
  caleLeBattement(b, T)
  b.sim.tick = T
  advanceNasses(b.sim)
  return drainEvents(b.sim)
}

function tentatives(b: Banc, n: number, T: number = MIDI_DOUX): SimEvent[] {
  const out: SimEvent[] = []
  for (let i = 0; i < n; i++) out.push(...tentativeAuTick(b, T))
  return out
}

/**
 * LA MÊME CHOSE PAR LA VRAIE BOUCLE (`step()`) — au MIDI du cycle `k`, pour que le tick avance
 * toujours (jamais de rembobinage) et qu'on reste dans les Pluies, l'eau libre.
 *
 * Elle existe parce qu'une phase appelée seule ne prouve pas qu'elle est CÂBLÉE
 * (`phase-seule-n-est-pas-un-tick`) : c'est le branchement dans `sim.ts` qu'on éprouve ici.
 */
function tentativeParStep(b: Banc, k: number): SimEvent[] {
  const T = k * TICKS_PER_CYCLE + MIDI_DOUX
  caleLeBattement(b, T)
  b.sim.tick = T - 1
  step(b.sim, [])
  return drainEvents(b.sim)
}

type PriseEvt = Extract<SimEvent, { type: 'nasse_caught' }>
const prises = (evs: SimEvent[]): PriseEvt[] => evs.filter((e): e is PriseEvt => e.type === 'nasse_caught')
/** Les prises qui sont des POISSONS (une trouvaille ne porte pas d'espèce). */
const poissons = (evs: SimEvent[]): PriseEvt[] => prises(evs).filter((e) => e.species !== undefined)
const totalDansLePanier = (inv: Inventory): number => inv.reduce((n, sl) => n + (sl?.count ?? 0), 0)

// ── N1/N2 — L'OUVRAGE ────────────────────────────────────────────────────────
describe('N1/N2 — une entrée du registre, dans les hauts-fonds, à son poseur', () => {
  it('`fish_trap` est UNE pièce : privée, conteneur, posable sur l’eau, cassable', () => {
    const p = PIECES.fish_trap
    expect(p.acces).toBe('private') // personnelle (décision (3))
    expect(p.eau).toBe(true)
    expect(p.eauSeule).toBe(true)
    expect(p.capacite).toBeGreaterThan(0) // conteneur → la relève EST le geste du coffre
    expect(p.pv).toBeGreaterThan(0) // cassable → on peut la PERDRE (décision (4))
  })

  it('N2 — elle coûte de la FIBRE, et RIEN d’autre : les roseaux déjà cueillis à la roselière', () => {
    // Le sens de D3 : « pourquoi aller à la roselière », pas « faut-il un item roseau ». Aucune
    // matière neuve, aucun nœud neuf — donc aucune empreinte de carte déplacée.
    expect(Object.keys(PIECES.fish_trap.cout)).toEqual(['fiber'])
  })

  it('elle ne se pose QUE dans les hauts-fonds — ni terre ferme, ni eau profonde', () => {
    expect(terrainConstructible(TERRAIN_SHALLOW_WATER, 'fish_trap')).toBe(true)
    expect(terrainConstructible(TERRAIN_GRASS, 'fish_trap'), 'un piège à poissons sur l’herbe ne prendrait jamais rien').toBe(false)
    expect(terrainConstructible(TERRAIN_DEEP_WATER, 'fish_trap')).toBe(false)
  })

  it('N11 — la relève est PERSONNELLE : son poseur y accède, un autre non', () => {
    const b = banc()
    const moi = spawnEntity(b.sim, NASSE_TX + 1.5, NASSE_TY + 0.5)
    b.nasse.ownerId = moi
    expect(hasAccess(b.sim, moi, b.nasse)).toBe(true)
    const autre = spawnEntity(b.sim, NASSE_TX + 2.5, NASSE_TY + 0.5)
    expect(hasAccess(b.sim, autre, b.nasse), 'la nasse d’un autre ne s’ouvre pas').toBe(false)
  })
})

// ── N3/N4 — APPÂTÉE ──────────────────────────────────────────────────────────
describe('N3/N4 — APPÂTÉE : la prise se paie en appât', () => {
  it('N3 — sans appât : RIEN. Jamais « moins » — rien', () => {
    const b = banc({ appats: {} })
    expect(prises(tentatives(b, 12))).toHaveLength(0)
  })

  it('N4 — EXACTEMENT un appât par tentative, et jamais plus de prises que d’appâts dépensés', () => {
    const b = banc({ appats: { worms: 5 } })
    const evs = tentatives(b, 12) // douze battements, cinq vers seulement
    expect(countOf(b.nasse.inventory!, 'worms'), 'les cinq vers sont partis, un par tentative').toBe(0)
    const p = prises(evs)
    expect(p.length, 'jamais plus de prises que d’appâts dépensés').toBeLessThanOrEqual(5)
    // LA PRÉMISSE DE TOUS LES CAS « ZÉRO » DE CE FICHIER : la nasse pêche pour de vrai.
    expect(p.length, 'et le mécanisme n’est PAS inerte').toBeGreaterThan(0)
  })

  it('N4 — plus d’appât, plus de prises (monotone, sommé sur trois graines)', () => {
    const total = (vers: number): number =>
      [7, 2026, 42].reduce((n, seed) => n + prises(tentatives(banc({ seed, appats: { worms: vers } }), 20)).length, 0)
    expect(total(20)).toBeGreaterThan(total(3))
  })
})

// ── N5 — LE LIEU DICTE ───────────────────────────────────────────────────────
describe('N5 — le LIEU dicte la prise (rivière ≠ lac), hérité de `tableDePrises`', () => {
  it('les deux tables ne retiennent pas les mêmes espèces (balayage du domaine, pas un échantillon)', () => {
    const cond = (nature: NomDeNature): Conditions => ({ nature, zone: undefined, saison: 3, creneau: 'jour', surCoin: false, souille: false })
    const esp = (nature: NomDeNature): string[] =>
      tableDePrises(cond(nature))
        .lignes.filter((l) => l.kind === 'poisson')
        .map((l) => (l as Extract<typeof l, { kind: 'poisson' }>).species.id)
        .sort()
    const riviere = esp('riviere')
    const lac = esp('lac')
    expect(riviere.length).toBeGreaterThan(0)
    expect(lac.length).toBeGreaterThan(0)
    expect(riviere).not.toEqual(lac)
  })

  it('une nasse en RIVIÈRE ne prend que du poisson de rivière ; en LAC, que du poisson de lac', () => {
    for (const [nature, mot] of [
      [NATURE_RIVIERE, 'riviere'],
      [NATURE_LAC, 'lac'],
    ] as const) {
      const b = banc({ nature, appats: { worms: 40 } })
      const pris = poissons(tentatives(b, 40))
      expect(pris.length, `${mot} : la nasse a bien pris du poisson`).toBeGreaterThan(0)
      for (const e of pris) {
        const sp = FISH_SPECIES.find((s) => s.id === e.species)!
        expect(sp.eaux, `${e.species} ne mord pas en ${mot}`).toContain(mot)
      }
    }
  })
})

// ── N6 — CADENCÉE ────────────────────────────────────────────────────────────
describe('N6 — cadencée, pas par tick', () => {
  it('hors battement : AUCUN tirage, aucun événement. Au battement : ça tire', () => {
    const b = banc()
    caleLeBattement(b, MIDI_DOUX) // le battement tombe à MIDI, où l'eau est libre
    // LA PRÉMISSE : sans une eau pêchable, « ça ne tire pas » serait vrai pour la mauvaise raison.
    b.sim.tick = MIDI_DOUX
    expect(eauIndisponible(b.sim, NASSE_TX, NASSE_TY), 'à midi, l’eau est libre').toBeNull()
    const avant = b.sim.rngState
    b.sim.tick = MIDI_DOUX - 1
    advanceNasses(b.sim)
    expect(b.sim.rngState, 'hors battement, le PRNG n’est pas touché').toBe(avant)
    expect(drainEvents(b.sim)).toHaveLength(0)
    b.sim.tick = MIDI_DOUX // le battement
    advanceNasses(b.sim)
    expect(b.sim.rngState, 'au battement, la nasse a tiré').not.toBe(avant)
  })

  it('la cadence NE DIVISE PAS le cycle — sans quoi la nasse rejouerait les mêmes heures à jamais', () => {
    // La table de prises a un axe CRÉNEAU : une cadence diviseuse condamnerait la nasse à ne
    // jamais voir certaines heures, donc à ne jamais prendre les espèces de nuit.
    expect(TICKS_PER_CYCLE % NASSE.CADENCE_TICKS, 'la cadence doit précesser dans la journée').not.toBe(0)
  })

  it('CÂBLÉE dans `sim.ts` : un vrai `step()` fait pêcher la nasse', () => {
    const b = banc({ appats: { worms: 40 } })
    let pris = 0
    // Douze midis consécutifs (on reste dans les Pluies : l'eau est libre tout du long).
    for (let k = 0; k < 12; k++) pris += prises(tentativeParStep(b, k)).length
    expect(pris, 'la nasse prend par la VRAIE boucle, pas seulement par `advanceNasses`').toBeGreaterThan(0)
  })
})

// ── N7/N8 — LES BRIDAGES DE L'EAU ────────────────────────────────────────────
describe('N7/N8 — l’eau prise et l’eau qui se retire', () => {
  it('N7 — dans la GLACE : aucune prise, et aucun ver brûlé', () => {
    const b = banc({ gel: true, appats: { worms: 6 } })
    const T = tickDe(COEUR_DU_GRAND_FROID, true)
    b.sim.tick = T
    // LES PRÉMISSES D'ABORD : sans une eau RÉELLEMENT prise, ce cas passerait au vert sur une
    // nuit tiède — il mesurerait le montage, pas la règle.
    expect(estGele(b.sim, NASSE_TX, NASSE_TY), 'le haut-fond a bien pris').toBe(true)
    expect(eauIndisponible(b.sim, NASSE_TX, NASSE_TY), 'et la pêche y est refusée').toBe("l'eau est prise")
    const evs: SimEvent[] = []
    for (let i = 0; i < 6; i++) evs.push(...tentativeAuTick(b, T))
    expect(prises(evs)).toHaveLength(0)
    expect(countOf(b.nasse.inventory!, 'worms'), 'on ne brûle pas l’appât à pêcher dans la glace').toBe(6)
  })

  it('N8 — l’eau qui se retire MET EN PAUSE : prise et appât préservés, ouvrage intact — et ça REPREND', () => {
    const b = banc({ appats: { worms: 20 } })
    // La prémisse : elle pêchait.
    expect(prises(tentatives(b, 6)).length, 'elle pêchait avant que l’eau ne s’en aille').toBeGreaterThan(0)
    const versAvant = countOf(b.nasse.inventory!, 'worms')
    const panierAvant = totalDansLePanier(b.nasse.inventory!)

    // L'EAU S'EN VA. (La CAUSE exacte — l'assec de l'aridité — a ses propres gardes ailleurs ;
    // ce qui se juge ici est la RÈGLE DE SPEC : une eau qui ne porte plus met la nasse en PAUSE,
    // elle ne la détruit pas et ne la vide pas.)
    setTile(b.sim.map, NASSE_TX, NASSE_TY, TERRAIN_GRASS)
    expect(eauIndisponible(b.sim, NASSE_TX, NASSE_TY), 'l’eau ne porte plus').not.toBeNull()

    expect(prises(tentatives(b, 6)), 'à sec, elle ne prend plus').toHaveLength(0)
    expect(countOf(b.nasse.inventory!, 'worms'), 'l’appât est PRÉSERVÉ').toBe(versAvant)
    expect(totalDansLePanier(b.nasse.inventory!), 'la prise est PRÉSERVÉE').toBe(panierAvant)
    expect(b.sim.structures.some((s) => s.id === b.nasse.id), 'l’ouvrage est INTACT').toBe(true)
    expect(b.nasse.hp, 'et il n’a pas pris un point de dégât').toBe(PIECES.fish_trap.pv)

    // L'EAU REVIENT : elle REPREND (une pause, pas une mort).
    setTile(b.sim.map, NASSE_TX, NASSE_TY, TERRAIN_SHALLOW_WATER)
    expect(prises(tentatives(b, 12)).length, 'l’eau revenue, la nasse repart').toBeGreaterThan(0)
  })
})

// ── N9 — LA SOUILLURE ────────────────────────────────────────────────────────
describe('N9 — la SOUILLURE échange la table (le branchement de la qualité de l’eau, D1)', () => {
  /** Le montage de `coulee.test` : une rivière peinte à la main, un charnier RÉEL. La nature est
   *  peinte en RIVIÈRE — la lamproie de suie est la seule espèce `souillee`, et elle n'y mord. */
  function bancSouille(souille: boolean): Banc {
    const map = createEmptyMap(120, 40, TERRAIN_GRASS)
    const fil: number[] = []
    for (let x = 5; x <= 115; x++) {
      for (let dy = -2; dy <= 2; dy++) setTile(map, x, 20 + dy, TERRAIN_SHALLOW_WATER)
      setTile(map, x, 20, TERRAIN_DEEP_WATER)
      fil.push(20 * map.width + x)
    }
    map.fil = fil
    map.natureEau = map.terrain.map((t) => (t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER ? NATURE_RIVIERE : NATURE_RIEN))
    const sim = createSim(2026, { map, nodes: [], faunaCap: 0, worldEvents: false, meteoActive: false, jourDeDepart: JOUR_DOUX })
    sim.tick = MIDI_DOUX
    if (souille) {
      sim.map.cendreCout = calculeChampDeCendre(map.width, map.height, map.terrain, [{ tx: 40, ty: 16 }])
      sim.cendreAge = [0]
    }
    const nasse = poserNasse(sim, 40, 22, { worms: 80 })
    drainEvents(sim)
    return { sim, nasse }
  }

  it('en eau SOUILLÉE, seule la lamproie de suie mord ; en eau claire, jamais', () => {
    const sale = bancSouille(true)
    expect(eauSouillee(sale.sim, 40, 22), 'la prémisse : le haut-fond du lit est souillé').toBe(true)
    const evsSales: SimEvent[] = []
    for (let i = 0; i < 80; i++) evsSales.push(...tentativeAuTick(sale, MIDI_DOUX))
    const poissonsSales = poissons(evsSales)
    expect(poissonsSales.length, 'l’eau souillée porte quand même SA vie').toBeGreaterThan(0)
    for (const e of poissonsSales) {
      expect(e.species, 'en eau souillée, rien d’autre que la lamproie').toBe('lamproie')
    }

    const claire = bancSouille(false)
    expect(eauSouillee(claire.sim, 40, 22), 'la prémisse inverse : cette eau-là est claire').toBe(false)
    const evsClairs: SimEvent[] = []
    for (let i = 0; i < 80; i++) evsClairs.push(...tentativeAuTick(claire, MIDI_DOUX))
    const poissonsClairs = poissons(evsClairs)
    expect(poissonsClairs.length).toBeGreaterThan(0)
    expect(poissonsClairs.some((e) => e.species === 'lamproie'), 'la lamproie ne mord JAMAIS en eau claire').toBe(false)
  })
})

// ── N10 — LE PLAFOND ─────────────────────────────────────────────────────────
describe('N10 — pleine, elle s’arrête', () => {
  /** Ce que la nasse a PRIS : tout ce qui n'est pas de l'appât. C'est cela que le plafond borne. */
  const prisesStockees = (inv: Inventory): number =>
    inv.reduce((n, sl) => (sl === null || NASSE.APPATS[sl.item] !== undefined ? n : n + sl.count), 0)

  it('le plafond BORNE VRAIMENT : laissée seule avec de l’appât à ne plus finir, elle s’arrête net', () => {
    // ⚠ LA GARDE QUI MANQUAIT. Le cas d'à côté CONSTRUIT la plénitude (deux cases, deux items) :
    // il prouve la porte, pas le PLAFOND. Or les poissons crus S'EMPILENT (D12) : borner sur
    // « plus une case libre » ne borne pas 8 prises, mais 8 PILES — une nasse abandonnée
    // remplissait un cellier entier et sortait la canne du jeu. Ici on la laisse saturer pour de
    // vrai, et on demande ce qu'il y a DANS le panier.
    const b = banc({ appats: { worms: 400 } })
    tentatives(b, 250)
    expect(prisesStockees(b.nasse.inventory!), 'la prise stockée ne dépasse pas le plafond').toBeLessThanOrEqual(NASSE.CAPACITE)
    // …et elle a cessé de MANGER : un plafond qui laisse filer l'appât n'en est pas un.
    expect(countOf(b.nasse.inventory!, 'worms'), 'pleine, elle a arrêté de consommer ses vers').toBeGreaterThan(0)
  })

  it('aucune tentative, et SURTOUT aucun appât gâché', () => {
    const b = banc({ appats: { worms: 5, stone: 1 }, cases: 2 })
    expect(b.nasse.inventory!.every((sl) => sl !== null), 'la prémisse : plus une case libre').toBe(true)
    const avant = countOf(b.nasse.inventory!, 'worms')
    expect(prises(tentatives(b, 6))).toHaveLength(0)
    expect(countOf(b.nasse.inventory!, 'worms'), 'une nasse pleine ne mange pas ses vers').toBe(avant)
  })
})

// ── N12 — LA PERTE ───────────────────────────────────────────────────────────
describe('N12 — l’ouvrage se PERD', () => {
  it('cassée, la nasse verse sa prise ET son appât au sol', () => {
    const b = banc({ appats: { worms: 8 } })
    expect(prises(tentatives(b, 10)).length, 'la prémisse : il y a quelque chose dedans').toBeGreaterThan(0)
    const dedans = totalDansLePanier(b.nasse.inventory!)
    expect(dedans).toBeGreaterThan(0)

    applyStructureDamage(b.sim, b.nasse.id, PIECES.fish_trap.pv * 10)
    expect(b.sim.structures.some((s) => s.id === b.nasse.id), 'la nasse n’est plus là').toBe(false)
    const tas = b.sim.corpses.filter((c) => Math.floor(c.x) === NASSE_TX && Math.floor(c.y) === NASSE_TY)
    expect(tas.length, 'un tas est tombé sur sa tuile').toBe(1)
    expect(totalDansLePanier(tas[0]!.inventory), 'tout ce qu’elle portait est au sol').toBe(dedans)
  })
})

// ── N13 — DÉTERMINISME ───────────────────────────────────────────────────────
describe('N13 — déterministe, et MUETTE quand il n’y a pas de nasse', () => {
  it('même graine, mêmes prises (espèce, taille, portions)', () => {
    const suite = (seed: number): string =>
      poissons(tentatives(banc({ seed }), 10))
        .map((e) => `${e.species}:${e.mm}:${e.count}`)
        .join('|')
    expect(suite(7)).toBe(suite(7))
  })

  it('SANS nasse posée, le module ne touche pas au PRNG (aucun flux seedé décalé)', () => {
    // La leçon du décompte d'entités : un consommateur de PRNG qui s'éveille dans un monde qui
    // ne l'a pas demandé fait rougir des tests sans aucun rapport.
    const sim = createSim(2026, {
      map: carteDEssai(),
      nodes: [],
      faunaCap: 0,
      worldEvents: false,
      meteoActive: false,
      jourDeDepart: JOUR_DOUX,
    })
    sim.tick = NASSE.CADENCE_TICKS // un battement franc
    drainEvents(sim) // l'amorce du monde a sa propre voix : ce qu'on mesure, c'est ce qui SUIT
    const avant = sim.rngState
    advanceNasses(sim)
    expect(sim.rngState).toBe(avant)
    expect(drainEvents(sim)).toHaveLength(0)
  })
})
