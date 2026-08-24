/**
 * LE NIVEAU D'EAU A-T-IL DE QUOI SE PEINDRE ? (spec `saisons.md` S10)
 *
 * Ce fichier ne garde pas la LOI de l'eau — `saisons.test.ts` s'en charge. Il garde sa
 * PRÉMISSE, sur la carte de PRODUCTION, parce que c'est elle qui a failli tout rendre muet :
 *
 *   ① `map.distEau` existe et couvre la carte. `distanceALEau` rend **0** quand le champ est
 *      absent, et `estInonde` finit par `d > 0 && d <= …` — un champ manquant ne jette pas, il
 *      rend la crue FAUSSE PARTOUT, en silence. C'est le patron exact du zéro-sentinelle qui
 *      avait planché le monde à 0 °C.
 *   ② Les trois régimes ont de quoi mordre sur la VRAIE vallée : des gués à fermer, des mares
 *      à vider, des rives à noyer. Une garde sur une carte de test prouverait la fonction, pas
 *      le jeu — et « le banc n'a pas de joueur » a déjà coûté une séance.
 *
 * Les jours sont DÉRIVÉS, jamais écrits : le caractère « la Crue » se cherche en balayant
 * l'élection, comme la spec le fait pour tout le reste.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, EAU, TERRAIN_SHALLOW_WATER, YEAR_DAYS } from './balance'
import { crueGlobale, distanceALEau, estAsseche, estGueBloque, estInonde, niveauDEau } from './eau'
import { MARCHABLE, terrainAt } from './map'
import { modificateurDuJour } from './modificateur'
import { createSim, type SimState } from './sim'
import { TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { generateZonedTerrain } from './zonegen'

/** La vallée de production, bâtie UNE fois (≈ 7 s) — celle que `worker/veillee.ts` joue. */
let cache: SimState | null = null
function vallee(): SimState {
  if (cache) return cache
  const carte = generateZonedTerrain(2026)
  cache = createSim(2026, {
    map: carte.map,
    calendarScale: TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE,
    jourDeDepart: BALANCE.JOUR_DE_DEPART,
    finDeSaison: null,
  })
  return cache
}

/** Le tick du premier instant du jour de saison `jour`, pour un monde né au jour de départ. */
function tickDuJour(sim: SimState, jour: number): number {
  return Math.max(0, Math.round(((jour - sim.jourDeDepart) * TICKS_PER_SEASON_DAY) / sim.calendarScale))
}

/** LE PREMIER JOUR OÙ LA CRUE EST TIRÉE, cherché dans l'élection — jamais écrit en dur. Elle
 *  n'est au tirage qu'à l'Éclosion (S18), donc on balaie des années, pas des jours. */
function jourDeCrue(depuis: number): number {
  for (let j = depuis; j < depuis + YEAR_DAYS * 40; j++) {
    if (modificateurDuJour(j) === 'crue') return j
  }
  throw new Error('la Crue n’est jamais tirée en quarante ans — l’élection est cassée')
}

/** LE PREMIER JOUR OÙ LA VALLÉE EST VRAIMENT À SEC, cherché dans la loi — jamais écrit en dur,
 *  même doctrine que `jourDeCrue`. L'aridité demande de la chaleur : elle ne mord qu'au cœur de
 *  l'Ardeur, et le monde n'y ouvre plus (S2). Un an de balayage suffit — l'été revient. */
function jourDeSecheresse(sim: SimState): number {
  for (let j = sim.jourDeDepart; j < sim.jourDeDepart + YEAR_DAYS; j++) {
    if (niveauDEau(sim, tickDuJour(sim, j)) <= -EAU.SEUIL_ASSECHEMENT) return j
  }
  throw new Error('la vallée n’est à sec aucun jour de l’année — l’aridité est cassée')
}

describe('S10 — la prémisse du rendu de l’eau', () => {
  it('la carte de production porte un champ de distance à l’eau COMPLET', () => {
    const { map } = vallee()
    // Sans lui, `distanceALEau` rend 0 partout et la crue n'inonde RIEN, sans un mot.
    expect(map.distEau, 'map.distEau est absent — la crue serait muette').toBeDefined()
    expect(map.distEau!.length, 'le champ couvre toute la carte').toBe(map.width * map.height)
    // Et il dit quelque chose : de l'eau (0) et de la terre lointaine (le plafond).
    let zeros = 0
    let plafond = 0
    for (const d of map.distEau!) {
      if (d === 0) zeros++
      else if (d >= EAU.PORTEE_CRUE) plafond++
    }
    expect(zeros, 'des tuiles à distance nulle : de l’eau').toBeGreaterThan(0)
    expect(plafond, 'des tuiles loin de toute eau').toBeGreaterThan(0)
  })

  it('au cœur de l’été, la vallée est à SEC — et il y a des mares à vider', () => {
    const sim = vallee()
    // L'ARIDITÉ VEUT DE LA CHALEUR AUTANT QUE DE LA SÉCHERESSE (`ariditeGlobale` = chaleur ×
    // temps). Rien n'a plu avant le premier tick, donc le TEMPS est au maximum dès la
    // naissance — mais la CHALEUR, elle, suit la courbe du socle, et le monde ouvre désormais
    // à l'ouverture des Pluies (S2, jour 61 depuis le 2026-08-24) : à +16,4 °C le facteur de
    // chaleur ne vaut que 0,2, et la vallée naît HUMIDE. C'est juste, et c'est pour ça que le
    // jour se DÉRIVE comme celui de la Crue au lieu d'être « l'ouverture ».
    const t = tickDuJour(sim, jourDeSecheresse(sim))
    expect(niveauDEau(sim, t)).toBeLessThanOrEqual(-EAU.SEUIL_ASSECHEMENT)

    const niveau = niveauDEau(sim, t)
    let asseches = 0
    for (let i = 0; i < sim.map.terrain.length; i++) {
      if (sim.map.terrain[i] !== TERRAIN_SHALLOW_WATER) continue
      const tx = i % sim.map.width
      const ty = Math.floor(i / sim.map.width)
      if (estAsseche({ ...sim, tick: t }, tx, ty, niveau)) asseches++
    }
    expect(asseches, 'des hauts-fonds à assécher sur la vraie carte').toBeGreaterThan(100)
  })

  it('sous la Crue, il y a des gués à fermer ET des rives à noyer', () => {
    const sim = vallee()
    const jour = jourDeCrue(sim.jourDeDepart)
    const t = tickDuJour(sim, jour)
    const etat = { ...sim, tick: t }
    expect(crueGlobale(etat, t), `la Crue est bien tirée au jour ${jour}`).toBeGreaterThan(0)

    const niveau = niveauDEau(etat, t)
    let gues = 0
    let noyees = 0
    let sousLaPortee = 0
    for (let i = 0; i < sim.map.terrain.length; i++) {
      const tx = i % sim.map.width
      const ty = Math.floor(i / sim.map.width)
      const terrain = terrainAt(sim.map, tx, ty)
      if (terrain === TERRAIN_SHALLOW_WATER) {
        if (estGueBloque(etat, tx, ty, niveau)) gues++
      } else if (MARCHABLE[terrain] === 1) {
        const d = distanceALEau(sim.map, tx, ty)
        if (d > 0 && d <= EAU.PORTEE_CRUE) sousLaPortee++
        if (estInonde(etat, tx, ty, niveau)) noyees++
      }
    }
    expect(sousLaPortee, 'des terres à portée de crue').toBeGreaterThan(0)
    expect(gues, 'des gués que la crue ferme').toBeGreaterThan(0)
    expect(noyees, 'des terres que la crue noie').toBeGreaterThan(0)
  })

  it('LA CRUE SE RETIRE : c’est une fonte, elle s’épuise avec la saison', () => {
    // Le premier jour de l'Éclosion, la crue vaut 1 et noie TOUTE la portée (huit tuiles depuis
    // chaque rive — 85 733 tuiles sur la carte de 2026). Ce n'est pas un plateau : elle décroît
    // jusqu'à la fin de la saison, et l'eau redescend. C'est cette PENTE qui en fait un
    // caractère qu'on traverse plutôt qu'une carte différente.
    const sim = vallee()
    const debut = jourDeCrue(sim.jourDeDepart)
    const compte = (jour: number): number => {
      const t = tickDuJour(sim, jour)
      const etat = { ...sim, tick: t }
      const niveau = niveauDEau(etat, t)
      if (niveau <= 0) return 0
      let n = 0
      for (let i = 0; i < sim.map.terrain.length; i++) {
        const tx = i % sim.map.width
        const ty = Math.floor(i / sim.map.width)
        if (MARCHABLE[terrainAt(sim.map, tx, ty)] !== 1) continue
        if (estInonde(etat, tx, ty, niveau)) n++
      }
      return n
    }
    const auPlusHaut = compte(debut)
    const aMiSaison = compte(debut + Math.floor(BALANCE.ACT_DAYS / 2))
    const aLaFin = compte(debut + BALANCE.ACT_DAYS - 1)
    expect(auPlusHaut, 'la crue noie à son ouverture').toBeGreaterThan(0)
    expect(aMiSaison, 'elle s’est déjà retirée à mi-saison').toBeLessThan(auPlusHaut)
    expect(aLaFin, 'et davantage à la fin').toBeLessThan(aMiSaison)
  })

  it('un gué fermé et une mare à sec ne peuvent pas coexister — le niveau a UN signe', () => {
    // La garde de forme derrière l'ordre des trois régimes dans la couche de rendu : un niveau
    // ne peut être à la fois ≥ +0,3 (le gué ferme) et ≤ −0,6 (la mare part). Si cette garde
    // tombait, la peinture deviendrait un choix arbitraire au lieu d'une dérivation.
    expect(EAU.SEUIL_GUE_BLOQUE).toBeGreaterThan(-EAU.SEUIL_ASSECHEMENT)
  })
})
