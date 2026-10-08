/**
 * CE QUE LA LUMIÈRE LIT EN PLUS DANS LA FAÇADE (`etat-gel.ts`, en-tête ; spec
 * `lumiere-globale.md` LG-R11, LG-R18 ; `nuit-noire.md` N2bis).
 *
 * Ce que ce fichier garde : que la prédiction du client (`clarteSurSoiAt` sur la façade) rend
 * EXACTEMENT ce que l'autorité rend sur le vrai `SimState` — derrière un fût, sous la torche
 * d'un autre avatar, à côté d'un figurant qui en porte une. Et que chaque champ optionnel
 * COMPTE : sans lui, la façade est plus claire que l'autorité, le sens interdit de N2bis.
 * Le montage est celui de `lumiere.test.ts` (sim) : minuit de nouvelle lune, un feu libre.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FIRE,
  LUNAISON_JOURS,
  LUNE_PLEINE_JOUR,
  SLOTS,
  TERRAIN_GRASS,
  addItems,
  NUIT,
  braiseNeuve,
  bulleDeBraise,
  chargePleine,
  clarteSurSoiAt,
  createEmptyMap,
  createSim,
  cycleOffsetForStartHour,
  getGameTime,
  jourDeSaison,
  makeInventory,
  spawnEntity,
  type Entity,
  type Monster,
  type SimState,
  type Structure,
} from '@ashes/sim'
import { creerEtatGel, majEtatGel, type SourceDuGel } from './etat-gel'

const FEU = { tx: 50, ty: 48 }
/** Un porteur de torche AVATAR, loin du feu : là, seule sa flamme éclaire. */
const AUTRE = { x: 40.5, y: 40.5 }
/** Un porteur de torche FIGURANT, aussi loin : sa flamme ne compte pas (LG-R18). */
const FIGURANT = { x: 60.5, y: 40.5 }

function nuitNoire(): SimState {
  const jourDeDepart = Math.floor(LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2)
  const sim = createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart, meteoActive: true })
  sim.cycleOffset = cycleOffsetForStartHour(0, jourDeSaison(sim))
  return sim
}
const ent = (sim: SimState, id: number): Entity => sim.entities.find((e) => e.id === id)!

/** Le feu libre de `addStructure`, à la main : la sim n'exporte pas son bâtisseur. */
function feu(sim: SimState, tx: number, ty: number): void {
  const fuel = makeInventory(FIRE.FUEL_SLOTS)
  addItems(fuel, { wood: 3 })
  const s = { id: sim.nextStructureId, type: 'fire', tx, ty, villageId: 0, ownerId: 0, access: 'public', hp: 100, fuel, burnAt: sim.tick, burnSlot: 0 }
  sim.nextStructureId += 1
  sim.structures.push(s as unknown as Structure)
}
function porteur(sim: SimState, x: number, y: number): Entity {
  const e = ent(sim, spawnEntity(sim, x, y))
  e.inventory = makeInventory(SLOTS.PLAYER)
  e.inventory[0] = { item: 'torche_vive', count: 1, wear: 0 }
  e.activeSlot = 0
  return e
}

/**
 * Le monde témoin : un feu, un fût juste à l'ouest, deux porteurs de torche dont un figurant.
 *
 * ⚠ LE FIGURANT ÉTAIT UN PNJ jusqu'au 2026-09-29 ; `SimState.npcs` est parti avec les villages
 * PNJ (tranche 3) et c'est un MONSTRE qui tient le rôle. La façade porte toujours la liste des
 * figurants — une de moins, mais celle qui existe dans le jeu joué —, et LG-R18 est inchangée.
 */
function monde(): SimState {
  const sim = nuitNoire()
  feu(sim, FEU.tx, FEU.ty)
  sim.nodes.push({ id: 9001, type: 'tree', tx: FEU.tx - 1, ty: FEU.ty, stock: 5, regrowAt: 0 })
  porteur(sim, AUTRE.x, AUTRE.y)
  const figurant = porteur(sim, FIGURANT.x, FIGURANT.y)
  sim.monsters.push({ entityId: figurant.id } as unknown as Monster)
  return sim
}

type Porte = { nodes?: boolean; entities?: boolean; figurants?: boolean }
function sourceDepuis(sim: SimState, porte: Porte): SourceDuGel {
  const src: SourceDuGel = {
    map: sim.map,
    temps: getGameTime(sim),
    calendarScale: sim.calendarScale,
    jourDeDepart: sim.jourDeDepart,
    cendreAge: sim.cendreAge,
    seed: sim.seed,
    structures: sim.structures,
    meteo: sim.meteo ?? null,
    brume: sim.brume ?? null,
    ...(porte.nodes ? { nodes: sim.nodes } : {}),
    ...(porte.entities ? { entities: sim.entities } : {}),
    ...(porte.figurants ? { monsters: sim.monsters } : {}),
  }
  return src
}

/** Un balayage de points : quarts de tuile sur la fenêtre qui contient le feu et les porteurs. */
function* points(): Generator<[number, number]> {
  for (let ty = 38; ty <= 56; ty++) for (let tx = 38; tx <= 64; tx++) for (const q of [0.25, 0.75]) yield [tx + q, ty + q]
}
const clarte = (etat: SimState, x: number, y: number): number => clarteSurSoiAt(etat, etat.tick, x, y, false)

describe('la façade rend la même clarté que le vrai SimState (LG-R11, LG-R18)', () => {
  it('L1 — tout porté, la prédiction vaut l’autorité au bit près, sur tout le balayage', () => {
    const sim = monde()
    const facade = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, figurants: true }))
    // Le ciel seul, loin de toute flamme : le plancher de la nuit (la nouvelle lune n'est pas
    // le zéro exact — c'est `clarteDuCiel` qui le dit, pas ce test).
    const ciel = clarte(sim, 90.5, 90.5)
    let n = 0
    let eclaires = 0
    for (const [x, y] of points()) {
      const vrai = clarte(sim, x, y)
      expect(clarte(facade, x, y), `(${x}, ${y})`).toBe(vrai)
      n++
      if (vrai > ciel) eclaires++
    }
    // La prémisse : le balayage traverse des points qu'une flamme éclaire ET des points au ciel seul.
    expect(n).toBeGreaterThan(900)
    expect(eclaires).toBeGreaterThan(50)
    expect(eclaires).toBeLessThan(n)
  })

  it('L2 — sans les nœuds, la façade est PLUS CLAIRE que l’autorité derrière le fût (N2bis)', () => {
    const sim = monde()
    const sans = creerEtatGel(sourceDepuis(sim, { entities: true, figurants: true }))
    let mensonges = 0
    for (const [x, y] of points()) {
      const vrai = clarte(sim, x, y)
      const predit = clarte(sans, x, y)
      expect(predit, `(${x}, ${y})`).toBeGreaterThanOrEqual(vrai) // jamais plus sombre : un fût ne fait qu'ôter
      if (predit > vrai) mensonges++
    }
    expect(mensonges).toBeGreaterThan(0)
    // Le point témoin : à l'ouest du fût, dans son ombre — la sim y voit moins que la façade nue.
    const ombre: [number, number] = [FEU.tx - 2.5, FEU.ty + 0.5]
    expect(clarte(sim, ...ombre)).toBeLessThan(clarte(sans, ...ombre))
    expect(clarte(sim, ...ombre)).toBeGreaterThan(0) // pénombre, pas le noir : le fût ne fait que 2×2 texels
  })

  it('L3 — sans les corps, la torche de l’autre avatar manque ; avec, elle vaut l’autorité', () => {
    const sim = monde()
    const sans = creerEtatGel(sourceDepuis(sim, { nodes: true, figurants: true }))
    const avec = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, figurants: true }))
    const pres: [number, number] = [AUTRE.x + 1, AUTRE.y + 1]
    const vrai = clarte(sim, ...pres)
    expect(vrai).toBeGreaterThan(0.5) // à un pas du porteur, sa flamme domine le ciel de nouvelle lune
    expect(clarte(avec, ...pres)).toBe(vrai)
    expect(clarte(sans, ...pres)).toBeLessThan(vrai)
  })

  it('L4 — sans les figurants, la façade compte la torche d’un figurant que l’autorité ignore (LG-R18)', () => {
    const sim = monde()
    const sans = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true }))
    const avec = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, figurants: true }))
    const pres: [number, number] = [FIGURANT.x + 1, FIGURANT.y + 1]
    const vrai = clarte(sim, ...pres)
    expect(clarte(avec, ...pres)).toBe(vrai)
    expect(clarte(sans, ...pres)).toBeGreaterThan(vrai)
  })

  it('L5 — `majEtatGel` remet les quatre champs à jour, et les efface quand la source ne les porte plus', () => {
    const sim = monde()
    const facade = creerEtatGel(sourceDepuis(sim, {}))
    const ombre: [number, number] = [FEU.tx - 2.5, FEU.ty + 0.5]
    const nu = clarte(facade, ...ombre)
    majEtatGel(facade, sourceDepuis(sim, { nodes: true, entities: true, figurants: true }))
    expect(clarte(facade, ...ombre)).toBe(clarte(sim, ...ombre))
    expect(clarte(facade, ...ombre)).toBeLessThan(nu)
    majEtatGel(facade, sourceDepuis(sim, {}))
    expect(clarte(facade, ...ombre)).toBe(nu)
  })
})


// ═══════════════════════════════════════════════════════════════════════════════════════════
// B-A18 — LE TERME SUR SOI EXISTE POUR CE FICHIER, ET POUR LUI SEUL
//
// En `/sim`, le terme sur soi de `clarteSurSoiAt` coïncide avec le balayage **en plaine nue**
// (B-A18 ⑧) — mais il n'est PAS redondant pour autant : le balayage paie un `partVisible`, et la
// part visible d'un corps sur sa propre source tombe sous 1 contre un mur ou sous une pièce
// pleine (`lumiere.test.ts` ⑨). *(Ce bandeau disait « prouvé REDONDANT » : corrigé à l'audit de
// fusion du 2026-10-05.)* Ce qui est propre à CE fichier est l'autre raison : ici les deux
// POSITIONS diffèrent — le client prédit la sienne, la façade garde celle du snapshot.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('B-A18 — la prédiction ne doit JAMAIS être plus sombre que l’autorité (N2bis)', () => {
  /** La charge choisie exprès : la clarté sur soi passe JUSTE au-dessus du seuil, et le rayon
   *  (`RAYON_BASE × f`) tombe JUSTE en dessous de l'écart de prédiction. C'est la seule fenêtre
   *  où l'erreur change un VERDICT et pas seulement un nombre. */
  const F = 0.35
  const ECART = 2.0 // tuiles entre la position du snapshot et la position prédite

  it('L4 — braise à 35 %, deux tuiles de retard de snapshot : la prédiction tient le verdict de la parade', () => {
    const sim = nuitNoire()
    const moi = porteur(sim, 48.5, 48.5)
    moi.inventory = makeInventory(SLOTS.PLAYER) // pas de torche : la braise seule
    moi.activeSlot = -1
    const braise = braiseNeuve(0)
    braise.charge = Math.round(F * chargePleine(0))
    moi.braise = braise
    const facade = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true }))
    const px = moi.x + ECART
    const py = moi.y

    // LA PRÉMISSE, affirmée et non supposée : à cette charge le halo NE PORTE PAS jusqu'au
    // point prédit, et il rend quand même la parade AU CONTACT. Sans ces deux faits, la garde
    // ne peut pas rougir.
    expect(bulleDeBraise(braise, ECART)).toBe(0)
    expect(bulleDeBraise(braise, 0)).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR)

    // CE QUE LE CLIENT FAIT : il passe sa braise, au contact de sa position PRÉDITE.
    const predit = clarteSurSoiAt(facade, facade.tick, px, py, false, undefined, braise)
    expect(predit).toBeGreaterThanOrEqual(NUIT.SEUIL_NOIR) // il prédit « je pare »

    // L'AUTORITÉ, pour le même corps à la même place : un `SimState` où le corps EST en px, py.
    const autorite = nuitNoire()
    const lui = porteur(autorite, px, py)
    lui.inventory = makeInventory(SLOTS.PLAYER)
    lui.activeSlot = -1
    lui.braise = { niveau: braise.niveau, charge: braise.charge }
    expect(clarteSurSoiAt(autorite, autorite.tick, px, py, false, undefined, lui.braise)).toBeCloseTo(predit, 12)

    // ⚠ LA FALSIFICATION, JOUÉE DANS LA GARDE : sans la braise au contact — c'est-à-dire si le
    // client la laissait au balayage de la façade, dont les entités sont restées DEUX TUILES en
    // arrière — il prédirait le noir, donc un refus de parade que l'autorité n'a pas prononcé.
    const sansLeTerme = clarteSurSoiAt(facade, facade.tick, px, py, false)
    expect(sansLeTerme).toBeLessThan(NUIT.SEUIL_NOIR)
    expect(sansLeTerme).toBeLessThan(predit)
  })

  it('L5 — N2bis sur tout le balayage : la façade rend la clarté de l’autorité au bit, braises comprises', () => {
    // Le patron de L1, mais avec des braises CHARGÉES sur les porteurs : L1 les a toutes vides
    // (ses avatars naissent pleins, mais `porteur` n'y touche pas — donc L1 passait déjà par le
    // halo sans le dire). Ici on le dit, et on le fait varier.
    const sim = monde()
    let charges = 0
    let i = 0
    for (const e of sim.entities) {
      e.braise = braiseNeuve(0)
      e.braise.charge = Math.round(((i++ % 5) / 4) * chargePleine(0))
      if (e.braise.charge > 0) charges++
    }
    expect(charges).toBeGreaterThan(0) // nécessaire, et PAS suffisant — voir juste en dessous
    // ⚠ **UN CORPS DE PLUS, SANS TORCHE — ET SANS LUI CETTE GARDE EST VACUEUSE SUR LES BRAISES.**
    // MESURÉ à l'audit de fusion du 2026-10-05 : sur les 1 026 points du balayage, le maximum de
    // la lumière des braises valait **exactement 0**, pour DEUX raisons qui se cumulent — ⓐ le
    // seul corps chargé par la boucle ci-dessus était le FIGURANT (i = 1), que `lumiereDesBraises`
    // écarte (N6) ; ⓑ et même chargé, un porteur de TORCHE la domine partout (portée 10 contre 4,
    // même sommet), donc le `max` ne laissait jamais parler une braise. Le compte de braises
    // chargées était donc une prémisse NÉCESSAIRE prise pour suffisante.
    const nu = ent(sim, spawnEntity(sim, 44.5, 52.5))
    nu.inventory = makeInventory(SLOTS.PLAYER)
    nu.activeSlot = -1
    nu.braise = braiseNeuve(0)
    nu.braise.charge = Math.round(0.8 * chargePleine(0))
    // LA PRÉMISSE EFFECTIVE : ce point-ci du balayage est éclairé par CETTE braise et par rien
    // d'autre — hors de portée du feu (6) comme des deux torches (10), ciel de nouvelle lune.
    const sonde = clarte(sim, 44.75, 52.75)
    expect(sonde).toBeCloseTo(bulleDeBraise(nu.braise, Math.sqrt(2) * 0.25), 12)
    expect(sonde).toBeGreaterThan(NUIT.SEUIL_NOIR)
    const facade = creerEtatGel(sourceDepuis(sim, { nodes: true, entities: true, figurants: true }))
    let n = 0
    for (const [x, y] of points()) {
      expect(clarte(facade, x, y), `(${x}, ${y})`).toBe(clarte(sim, x, y))
      n++
    }
    expect(n).toBeGreaterThan(500)
  })
})

describe('B-A18 — GARDE DE SOURCE : `WorldScene` passe bien sa braise à la prédiction', () => {
  it('L6 — l’appel de `clarteSurSoiAt` dans `WorldScene` porte un 7ᵉ argument', () => {
    // ⚠ POURQUOI UNE GARDE DE SOURCE : `braise` est un paramètre OPTIONNEL, donc l'oublier
    // compile, tourne, et ne se voit qu'à la nuit, au seuil, en marche — c'est-à-dire jamais
    // dans une suite. L4 prouve que l'argument CHANGE le verdict ; celle-ci prouve qu'il est là.
    const src = readFileSync(join(__dirname, '../WorldScene.ts'), 'utf8')
    const i = src.indexOf('clarteSurSoiAt(')
    expect(i).toBeGreaterThan(0) // PRÉMISSE : l'appel existe encore
    // LA FENÊTRE DE L'APPEL, et son bord est choisi : la branche `: 1` du ternaire qui le porte
    // (« avant la première façade d'état, on suppose le jour »). ⚠ Ma première version coupait à
    // la première `)` après `this.etageJoueur` — elle tombait DANS un commentaire, et la garde
    // rougissait sur un code juste. Le même piège que la garde de la barre de crans, qui lisait
    // le liseré du voisin : une fenêtre de source se borne sur un jalon, pas sur un caractère.
    const fin = src.indexOf('\n      : 1', i)
    expect(fin).toBeGreaterThan(i) // PRÉMISSE : le jalon de fin existe
    const appel = src.slice(i, fin)
    expect(appel).toContain('this.etageJoueur') // la fenêtre couvre bien les arguments
    expect(appel).toContain("getHud(this.registry, 'braise')")
  })
})
