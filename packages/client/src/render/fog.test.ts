/**
 * LES GARDES DU BROUILLARD — module pur, donc testable sans navigateur ni carte réelle.
 */
import { describe, expect, it } from 'vitest'
import { CENDRE, type WorldMap } from '@ashes/sim'
import {
  avanceeVue, creerBrouillard, depackBrouillard, estampilleCendre, estVu, FOG_PAS,
  packBrouillard, partDecouverte, revele,
} from './fog'

/** Une vallée semée le lundi, et LA MÊME seed refondée le mardi : deux mondes, pas un. */
const LUNDI = { seed: 2026, neA: 1_000_000 }
const MARDI = { seed: 2026, neA: 2_000_000 }

/** Une carte jouet dont CHAQUE tuile est revendiquée par la fosse 0, à coût constant —
 *  de quoi éprouver l'estampille sans générer une vallée. */
function carteAvecCendre(largeur: number, hauteur: number, cout = 5): WorldMap {
  const N = largeur * hauteur
  return {
    width: largeur,
    height: hauteur,
    terrain: new Array<number>(N).fill(1),
    zones: [],
    cendreCout: new Array<number>(N).fill(cout * CENDRE.FOYERS_MAX + 0),
  } as unknown as WorldMap
}

describe('le brouillard de guerre', () => {
  it('naît entièrement FERMÉ — au tick 0 on ne connaît rien', () => {
    const b = creerBrouillard(160, 160)
    expect(partDecouverte(b)).toBe(0)
    expect(estVu(b, 80, 80)).toBe(false)
  })

  it('marcher DÉVOILE autour de soi, et seulement autour', () => {
    const b = creerBrouillard(800, 800)
    revele(b, 400, 400, 24)
    expect(estVu(b, 400, 400)).toBe(true)
    // Juste à côté : vu. Très loin : toujours fermé.
    expect(estVu(b, 400 + 16, 400)).toBe(true)
    expect(estVu(b, 700, 700)).toBe(false)
  })

  it('dévoile un DISQUE, pas un carré : le coin lointain reste fermé', () => {
    const b = creerBrouillard(800, 800)
    const r = 40
    revele(b, 400, 400, r)
    // Sur l'axe, à la portée : vu.
    expect(estVu(b, 400 + r - FOG_PAS, 400)).toBe(true)
    // En diagonale à la même distance sur CHAQUE axe : hors du disque (r√2 > r).
    expect(estVu(b, 400 + r, 400 + r)).toBe(false)
  })

  it('signale ce qui est NEUF — de quoi ne repeindre que si la carte a changé', () => {
    const b = creerBrouillard(400, 400)
    expect(revele(b, 200, 200, 16)).toBe(true) // première fois : du neuf
    expect(revele(b, 200, 200, 16)).toBe(false) // au même endroit : plus rien
    expect(revele(b, 320, 200, 16)).toBe(true) // ailleurs : du neuf
  })

  it('on n’OUBLIE jamais un pays traversé', () => {
    const b = creerBrouillard(400, 400)
    revele(b, 100, 100, 16)
    revele(b, 300, 300, 16) // on s'en va très loin
    expect(estVu(b, 100, 100)).toBe(true) // …et l'ancien reste acquis
  })

  it('hors carte n’est jamais « vu » — on ne dévoile pas le néant', () => {
    const b = creerBrouillard(160, 160)
    revele(b, 80, 80, 999) // une portée absurde ne déborde pas
    expect(estVu(b, -40, 80)).toBe(false)
    expect(estVu(b, 80, 4000)).toBe(false)
  })

  it('se TASSE et se relit à l’identique (un bit par cellule, base64)', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 100, 120, 40)
    revele(b, 400, 300, 24)
    const relu = depackBrouillard(packBrouillard(b, LUNDI), LUNDI, 600, 500)
    expect([...relu.vu]).toEqual([...b.vu])
    expect(partDecouverte(relu)).toBeCloseTo(partDecouverte(b))
  })

  it('le format tassé est BEAUCOUP plus léger qu’un tableau de chiffres', () => {
    const b = creerBrouillard(1291, 1937) // taille de production
    revele(b, 600, 900, 60)
    const tasse = packBrouillard(b, LUNDI).length
    const naif = JSON.stringify([...b.vu]).length
    expect(tasse).toBeLessThan(naif / 8)
  })

  it('une carte de TAILLE DIFFÉRENTE rend un brouillard NEUF, jamais un savoir décalé', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 300, 250, 80)
    // On relit avec d'autres dimensions : refuser vaut mieux que mentir.
    const autre = depackBrouillard(packBrouillard(b, LUNDI), LUNDI, 900, 700)
    expect(partDecouverte(autre)).toBe(0)
  })

  // ── L'ESTAMPILLE DE MONDE ─────────────────────────────────────────────────────────────
  // Le bug d'Alexis (2026-07-30) : « parfois j'ai une partie de la carte déjà découverte
  // quand je lance une nouvelle partie ». Le brouillard était rangé par CASE, et la taille
  // de carte ne dépend pas de la seed (`tailleCarte`) — donc la garde de dimensions ne
  // pouvait JAMAIS refuser le savoir de la vallée précédente. Une vallée refondée dans la
  // même case s'ouvrait avec la carte de l'ancienne.

  it('un brouillard d’UNE AUTRE VALLÉE (même seed, refondée) ne s’ouvre pas sur celle-ci', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 300, 250, 80)
    const relu = depackBrouillard(packBrouillard(b, LUNDI), MARDI, 600, 500)
    expect(partDecouverte(relu)).toBe(0)
  })

  it('une AUTRE SEED non plus — deux vallées ne partagent aucun savoir', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 300, 250, 80)
    const relu = depackBrouillard(packBrouillard(b, LUNDI), { seed: 7, neA: LUNDI.neA }, 600, 500)
    expect(partDecouverte(relu)).toBe(0)
  })

  it('un brouillard SANS estampille (rangé avant ce correctif) est refusé, pas deviné', () => {
    // Le format d'avant : la charge utile toute nue, sans en-tête. On ne sait pas de quel
    // monde il parle — donc on ne le croit pas.
    const b = creerBrouillard(600, 500)
    revele(b, 300, 250, 80)
    const nu = packBrouillard(b, LUNDI).split('|').pop()!
    expect(partDecouverte(depackBrouillard(nu, LUNDI, 600, 500))).toBe(0)
  })

  it('l’estampille se lit, la charge utile reste intacte — l’en-tête ne mange pas un bit', () => {
    const b = creerBrouillard(600, 500)
    revele(b, 120, 140, 32)
    const texte = packBrouillard(b, LUNDI)
    expect(texte.startsWith(`f2|${LUNDI.seed}|${LUNDI.neA}|`)).toBe(true)
    // La garde de longueur porte sur la CHARGE, pas sur la chaîne entière : sans quoi tout
    // brouillard estampillé serait refusé, et la reprise perdrait sa carte à chaque fois.
    expect([...depackBrouillard(texte, LUNDI, 600, 500).vu]).toEqual([...b.vu])
  })

  // ── LE SAVOIR-CENDRE (décision d'Alexis, 2026-08-28) ──────────────────────────────────
  // La carte montre la cendre TELLE QU'ON L'A VUE : chaque cellule vue retient l'avancée du
  // foyer qui la revendiquait au moment du passage — et rien de plus.

  it('l’estampille retient l’avancée VUE — et seulement sur les cellules du disque vu', () => {
    const b = creerBrouillard(320, 320)
    const map = carteAvecCendre(320, 320)
    revele(b, 100, 100, 24)
    expect(estampilleCendre(b, map, 100, 100, 24, [37.2])).toBe(true)
    const cellule = Math.floor(100 / b.pas) * b.cols + Math.floor(100 / b.pas)
    expect(avanceeVue(b, cellule)).toBeCloseTo(37.2, 1)
    // Loin du disque : jamais estampillé — on ne sait pas ce qu'on n'a pas regardé.
    const loin = Math.floor(300 / b.pas) * b.cols + Math.floor(300 / b.pas)
    expect(avanceeVue(b, loin)).toBe(-1)
  })

  it('le savoir-cendre est MONOTONE — revenir devant un front gelé ne désapprend rien', () => {
    const b = creerBrouillard(160, 160)
    const map = carteAvecCendre(160, 160)
    revele(b, 80, 80, 24)
    estampilleCendre(b, map, 80, 80, 24, [50])
    // Repasser avec une avancée MOINDRE (impossible en jeu, mais la garde est là) : rien ne bouge.
    expect(estampilleCendre(b, map, 80, 80, 24, [20])).toBe(false)
    const cellule = Math.floor(80 / b.pas) * b.cols + Math.floor(80 / b.pas)
    expect(avanceeVue(b, cellule)).toBeCloseTo(50, 1)
    // Et une avancée PLUS GRANDE s'apprend.
    expect(estampilleCendre(b, map, 80, 80, 24, [51])).toBe(true)
  })

  it('une cellule NON VUE ne s’estampille pas — voir d’abord, savoir ensuite', () => {
    const b = creerBrouillard(160, 160)
    const map = carteAvecCendre(160, 160)
    // Aucun `revele` : le disque est aveugle, l'estampille ne mord nulle part.
    expect(estampilleCendre(b, map, 80, 80, 24, [50])).toBe(false)
  })

  it('le savoir-cendre se TASSE et se relit à l’identique (format f2)', () => {
    const b = creerBrouillard(320, 320)
    const map = carteAvecCendre(320, 320)
    revele(b, 100, 100, 30)
    estampilleCendre(b, map, 100, 100, 30, [123.4])
    const relu = depackBrouillard(packBrouillard(b, LUNDI), LUNDI, 320, 320)
    expect([...relu.cendreVue]).toEqual([...b.cendreVue])
  })

  it('un brouillard f1 (d’avant le savoir-cendre) se relit — la carte arpentée survit', () => {
    const b = creerBrouillard(320, 320)
    revele(b, 100, 100, 30)
    // On refabrique la chaîne f1 telle que l'ancien code l'écrivait : mêmes trois segments.
    const [, seed, neA, vu] = packBrouillard(b, LUNDI).split('|')
    const relu = depackBrouillard(`f1|${seed}|${neA}|${vu}`, LUNDI, 320, 320)
    expect([...relu.vu]).toEqual([...b.vu])
    expect(relu.cendreVue.every((v) => v === 0)).toBe(true) // rien vu du front, honnêtement
  })
})
