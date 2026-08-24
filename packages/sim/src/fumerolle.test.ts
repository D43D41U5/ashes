/**
 * LES GARDES DES FUMEROLLES (spec `cendre.md`).
 *
 * Sur le VRAI monde : leur placement dépend du cœur de la corruption, donc d'un champ de coût que
 * seule la vraie carte porte. Une carte de test uniforme ne dirait rien.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAINS } from './balance'
import { CENDRE, auCoeurDeLaCendre, avanceesDepuisAges, foyersDeLaCarte } from './cendre'
import {
  FUMEROLLE, froidDeFumerolle, fumerolleIci, fumerollesAutour, idDeFumerolle,
  ouvrirLesFumerolles, toutesLesFumerolles,
} from './fumerolle'
import type { ResourceNode } from './economy'
import { generateZonedTerrain } from './zonegen'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = generateZonedTerrain(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const auJour = (jour: number): number[] =>
  avanceesDepuisAges(foyers.map(() => Math.max(0, jour - REVEIL)), foyers.length)

describe('elles naissent AVEC la corruption, et nulle part ailleurs', () => {
  it('aucune avant le réveil — le cœur n’existe pas encore', () => {
    expect(toutesLesFumerolles(map, auJour(1), SEED)).toHaveLength(0)
    expect(toutesLesFumerolles(map, auJour(REVEIL), SEED)).toHaveLength(0)
  })

  it('elles apparaissent au fil de la cendre, sans jamais reculer', () => {
    let precedent = 0
    for (const jour of [120, 240, 360, 600, 840]) {
      const n = toutesLesFumerolles(map, auJour(jour), SEED).length
      expect(n, `jour ${jour}`).toBeGreaterThanOrEqual(precedent)
      precedent = n
    }
    expect(precedent, 'et il y en a vraiment, à terme').toBeGreaterThan(10)
  }, 60_000)

  it('CHACUNE est au CŒUR, sur un sol qui se marche — jamais sur la frange', () => {
    const av = auJour(360)
    const f = toutesLesFumerolles(map, av, SEED)
    expect(f.length).toBeGreaterThan(0)
    for (const b of f) {
      expect(auCoeurDeLaCendre(map, b.tx, b.ty, av, SEED), `(${b.tx},${b.ty}) hors du cœur`).toBe(true)
      // Une fumerolle dans une falaise ne se visiterait pas : le sol d'ARRIVÉE doit se marcher.
      // (Le terrain brut peut être n'importe quoi — c'est la cendre qui décide de la surface.)
      const t = map.terrain[b.ty * map.width + b.tx]!
      expect(TERRAINS[t], `terrain inconnu en (${b.tx},${b.ty})`).toBeDefined()
    }
  }, 60_000)
})

describe('UN LIEU, PAS UNE TEXTURE — c’est le réglage qui le décide', () => {
  it('deux voisines ne tiennent jamais dans le même écran', () => {
    // L'écran montre ~36 tuiles de large. La promesse « on la repère de loin, et une seule à la
    // fois » ne tient que si l'écart minimal la dépasse. ⚠ MESURÉ à 21 tuiles au premier jet (le
    // tirage courait sur toute la maille, donc deux bouches pouvaient se coller de part et
    // d'autre d'un bord commun) — le tirage est depuis borné au cœur de la maille.
    const f = toutesLesFumerolles(map, auJour(840), SEED)
    expect(f.length).toBeGreaterThan(10)
    let min = Infinity
    for (let i = 0; i < f.length; i++) {
      for (let j = i + 1; j < f.length; j++) {
        const dx = f[i]!.tx - f[j]!.tx
        const dy = f[i]!.ty - f[j]!.ty
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < min) min = d
      }
    }
    expect(min, 'deux fumerolles dans un écran = une texture, pas un lieu').toBeGreaterThan(30)
  }, 60_000)

  it('elles restent rares : une poignée par foyer, jamais un tapis', () => {
    const n = toutesLesFumerolles(map, auJour(840), SEED).length
    expect(n / foyers.length, 'par foyer, à l’an 7').toBeLessThan(15)
  }, 60_000)
})

describe('le semis est PUR — même seed, mêmes bouches', () => {
  it('deux lectures rendent exactement la même liste', () => {
    const av = auJour(360)
    const a = toutesLesFumerolles(map, av, SEED)
    const b = toutesLesFumerolles(map, av, SEED)
    expect(a).toEqual(b)
  }, 60_000)

  it('`fumerolleIci` et la liste disent la MÊME chose — un seul écrivain', () => {
    const av = auJour(360)
    const f = toutesLesFumerolles(map, av, SEED)
    for (const b of f.slice(0, 20)) {
      expect(fumerolleIci(map, b.tx, b.ty, av, SEED), `(${b.tx},${b.ty})`).toBe(true)
      // …et pas sur la tuile d'à côté : c'est un point, pas une zone.
      expect(fumerolleIci(map, b.tx + 1, b.ty, av, SEED)).toBe(false)
    }
  }, 60_000)

  it('`fumerollesAutour` est la restriction locale de la liste globale', () => {
    const av = auJour(360)
    const f = toutesLesFumerolles(map, av, SEED)
    const b = f[Math.floor(f.length / 2)]!
    const local = fumerollesAutour(map, b.tx, b.ty, 10, av, SEED)
    expect(local.some((q) => q.tx === b.tx && q.ty === b.ty), 'elle se trouve elle-même').toBe(true)
    for (const q of local) {
      expect(f.some((x) => x.tx === q.tx && x.ty === q.ty), 'aucune bouche inventée').toBe(true)
    }
  }, 60_000)

  it('les ids sont dérivés de la POSITION, jamais de max+1', () => {
    const av = auJour(840)
    const f = toutesLesFumerolles(map, av, SEED)
    const vus = new Set<number>()
    for (const b of f) {
      const id = idDeFumerolle(map, b.tx, b.ty)
      expect(vus.has(id), `id ${id} en double`).toBe(false)
      vus.add(id)
      expect(idDeFumerolle(map, b.tx, b.ty), 'stable').toBe(id)
    }
  }, 60_000)
})

describe('le froid : une PENTE, jamais un seuil', () => {
  it('maximal au trou, nul au bord du souffle, monotone entre les deux', () => {
    const av = auJour(360)
    const b = toutesLesFumerolles(map, av, SEED)[0]!
    let precedent = Infinity
    for (let r = 0; r <= FUMEROLLE.RAYON; r++) {
      const f = froidDeFumerolle(map, b.tx + 0.5 + r, b.ty + 0.5, av, SEED)
      expect(f, `à ${r} tuiles`).toBeLessThanOrEqual(precedent + 1e-9)
      precedent = f
    }
    expect(froidDeFumerolle(map, b.tx + 0.5, b.ty + 0.5, av, SEED)).toBeCloseTo(FUMEROLLE.FROID, 5)
    expect(froidDeFumerolle(map, b.tx + 0.5 + FUMEROLLE.RAYON, b.ty + 0.5, av, SEED)).toBe(0)
  }, 60_000)

  it('deux bouches proches NE CUMULENT PAS leur souffle', () => {
    // On prend la plus froide, pas la somme : sinon un doublet ferait un point mortel invisible.
    const av = auJour(840)
    const f = toutesLesFumerolles(map, av, SEED)
    for (const b of f.slice(0, 30)) {
      const froid = froidDeFumerolle(map, b.tx + 0.5, b.ty + 0.5, av, SEED)
      expect(froid).toBeLessThanOrEqual(FUMEROLLE.FROID + 1e-9)
    }
  }, 60_000)

  it('aucun froid là où il n’y a pas de fumerolle', () => {
    const av = auJour(1) // rien n'est éveillé
    expect(froidDeFumerolle(map, 700.5, 400.5, av, SEED)).toBe(0)
  })
})

describe('elles s’ouvrent en NŒUDS récoltables', () => {
  it('une bouche éveillée devient un nœud de sel, et une seule fois', () => {
    const av = auJour(360)
    const nodes: ResourceNode[] = []
    const n1 = ouvrirLesFumerolles(nodes, map, av, SEED, FUMEROLLE.SEL_STOCK)
    expect(n1).toBeGreaterThan(0)
    expect(nodes).toHaveLength(n1)
    expect(nodes[0]!.type).toBe('fumerolle')
    expect(NODE_DEFS.fumerolle.item, 'elle donne du SEL').toBe('salt')
    expect(NODE_DEFS.fumerolle.renewable, 'on y REVIENT, on ne la vide pas').toBe(true)
    // Rappelée, elle n'en rouvre aucune : les ids sont dérivés, donc déjà connus.
    expect(ouvrirLesFumerolles(nodes, map, av, SEED, FUMEROLLE.SEL_STOCK)).toBe(0)
    expect(nodes).toHaveLength(n1)
  }, 60_000)

  it('elle ne se pose jamais sur une tuile déjà occupée', () => {
    const av = auJour(360)
    const b = toutesLesFumerolles(map, av, SEED)[0]!
    const squatteur: ResourceNode = { id: 42, type: 'rock', tx: b.tx, ty: b.ty, stock: 3, regrowAt: 0 }
    const nodes: ResourceNode[] = [squatteur]
    ouvrirLesFumerolles(nodes, map, av, SEED, FUMEROLLE.SEL_STOCK)
    const surLaTuile = nodes.filter((n) => n.tx === b.tx && n.ty === b.ty)
    expect(surLaTuile, 'une tuile ne porte qu’un nœud').toHaveLength(1)
    expect(surLaTuile[0]!.id).toBe(42)
  }, 60_000)

  it('elle N’EST PAS `vivant` — la cendre ne la fait pas tomber (R13)', () => {
    expect(NODE_DEFS.fumerolle.vivant).toBeUndefined()
  })
})
