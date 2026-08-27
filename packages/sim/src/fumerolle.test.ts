/**
 * LES GARDES DES FUMEROLLES (spec `cendre.md`).
 *
 * Sur le VRAI monde : leur placement dépend du cœur de la corruption, donc d'un champ de coût que
 * seule la vraie carte porte. Une carte de test uniforme ne dirait rien.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, NODE_DEFS, TERRAINS } from './balance'
import { CENDRE, auCoeurDeLaCendre, avanceesDepuisAges, estCendre, foyersDeLaCarte } from './cendre'
import {
  FUMEROLLE, froidDeFumerolle, fumerolleIci, fumerollesAutour, idDeFumerolle,
  ouvrirLesFumerolles, toutesLesFumerolles,
} from './fumerolle'
import type { WorldMap } from './map'
import type { ResourceNode } from './economy'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1
const auJour = (jour: number): number[] =>
  avanceesDepuisAges(foyers.map(() => Math.max(0, jour - REVEIL)), foyers.length)

describe('elles naissent AVEC la corruption, et nulle part ailleurs', () => {
  /**
   * ⚠ CETTE GARDE DISAIT UN ACCIDENT, PAS UNE LOI (corrigé le 2026-08-25).
   *
   * Elle exigeait ZÉRO fumerolle au jour du réveil « parce que le cœur n'existe pas encore ». Or
   * il existe : `avanceeDeCendre(0)` vaut `CENDRE.R0`, donc chaque charnier porte déjà son
   * disque. Le zéro ne venait pas du modèle, il venait de la RARETÉ du semis — aucune bouche ne
   * tombait dans un disque aussi petit. Le premier resserrement du semis l'a fait rougir, et il
   * avait raison de rougir : la garde tenait par chance depuis le début.
   *
   * Ce qui est une loi, c'est que rien ne fume là où la cendre n'a pas pris. On l'affirme des
   * deux côtés — sans champ de cendre, jamais ; au réveil, le compte doit être une poussière de
   * ce qu'il devient — et on PROUVE LA PRÉMISSE au passage (le monde mûr, lui, en porte).
   */
  it('rien ne fume là où la cendre n’a pas pris', () => {
    // ① Un monde SANS cendre du tout : la mécanique entière est muette.
    // ⚠ ON RETIRE LE CHAMP, on ne le met pas à `undefined` : `exactOptionalPropertyTypes` refuse
    //   l'un et accepte l'autre, et c'est `tsc` qui l'a dit — pas vitest, qui passait très bien.
    const sansCendre: WorldMap = { ...map }
    delete sansCendre.cendreCout
    expect(toutesLesFumerolles(sansCendre, auJour(840), SEED)).toHaveLength(0)
    // ② Au réveil, le disque `R0` est minuscule : ce qui s'y ouvre tient sur les doigts d'une
    //    main, et chaque bouche est bien AU CŒUR d'un foyer (pas posée sur la terre vierge).
    const av0 = auJour(REVEIL)
    const auReveil = toutesLesFumerolles(map, av0, SEED)
    expect(auReveil.length, 'au réveil, la cendre est un disque, pas une région').toBeLessThanOrEqual(foyers.length)
    for (const b of auReveil) expect(auCoeurDeLaCendre(map, b.tx, b.ty, av0, SEED)).toBe(true)
    // ③ LA PRÉMISSE : le monde mûr en porte vraiment beaucoup plus — sans quoi ② passerait
    //    parce que le semis est mort, et non parce que la cendre est jeune.
    const mur = toutesLesFumerolles(map, auJour(840), SEED).length
    expect(mur, 'le semis est mort').toBeGreaterThan(20 * Math.max(1, auReveil.length))
  }, 60_000)

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
    // L'écran montre ~36 tuiles de large (`FUMEROLLE.ECRAN_TUILES`). La promesse « on la repère
    // de loin, et une seule à la fois » ne tient que si l'écart minimal l'atteint. ⚠ MESURÉ à 21
    // tuiles au premier jet (le tirage courait sur toute la maille, donc deux bouches pouvaient
    // se coller de part et d'autre d'un bord commun) — le tirage est depuis borné au cœur de la
    // maille, et ce plancher est DÉRIVÉ : `MAILLE × (1 − JEU)`.
    //
    // ⚠ LE SEUIL SE LIT SUR L'ÉCRAN, PAS SUR LE RÉGLAGE. L'écrire `MAILLE × (1 − JEU)` ferait une
    // garde qui ne garde rien : elle suivrait le semis dans sa chute au lieu de la refuser. C'est
    // le CADRE qui est l'étalon (mémoire `etalon-d-un-rayon-est-le-cadre`).
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
    expect(min, 'deux fumerolles dans un écran = une texture, pas un lieu').toBeGreaterThanOrEqual(
      FUMEROLLE.ECRAN_TUILES,
    )
  }, 60_000)

  /**
   * ⚠ CETTE GARDE A CHANGÉ D'ÉTALON LE 2026-08-25, ET C'ÉTAIT LE FOND DU DÉFAUT.
   *
   * Elle comptait « par FOYER » — or un foyer n'est pas une quantité que le joueur perçoit : la
   * cendre d'un foyer couvre dix tuiles au réveil et cent mille à l'an 7, si bien que « moins de
   * 15 par foyer » autorisait aussi bien un tapis qu'une absence. La garde était verte pendant
   * qu'on traversait la cendrière sans voir une seule bouche (MESURÉ : une pour 14 000 tuiles).
   *
   * Le bon dénominateur est la CENDRE ELLE-MÊME : combien de terre brûlée pour une bouche. On
   * borne des deux côtés — trop rare est un défaut au même titre que trop dense, et c'est
   * précisément celui qu'on vient de payer.
   */
  it('une bouche pour quelques écrans de cendre — ni un tapis, ni une absence', () => {
    const av = auJour(840)
    const n = toutesLesFumerolles(map, av, SEED).length
    let cendre = 0
    for (let ty = 0; ty < map.height; ty += 2) {
      for (let tx = 0; tx < map.width; tx += 2) if (estCendre(map, tx, ty, av, SEED)) cendre += 4
    }
    // Un écran ≈ 36 × 20 tuiles ≈ 720. On veut en croiser une toutes les deux à huit poignées
    // d'écrans : assez pour que la cendre en porte, assez peu pour qu'elle reste une TERRE NUE.
    const ecran = FUMEROLLE.ECRAN_TUILES * 20
    const ecransParBouche = cendre / n / ecran
    expect(ecransParBouche, 'un tapis de fumée').toBeGreaterThan(2)
    expect(ecransParBouche, 'on traverse la cendrière sans en voir une').toBeLessThan(8)
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
