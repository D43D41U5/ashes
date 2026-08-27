/**
 * LES GARDES DE LA CENDRE (spec `cendre.md` A1-A16).
 *
 * Elles tournent sur le VRAI monde partout où la propriété est géographique : une carte de test
 * uniforme ne dirait rien de l'eau qui détourne ni de la roche qui freine, et ce sont justement
 * les deux choses qui rendent la frange organique.
 */
import { describe, expect, it } from 'vitest'
import {
  CENDRE, agonise, ancienneteDeCendre, avanceeDeCendre, avanceesDepuisAges, avancerLaCendre,
  calculeChampDeCendre, cendrePeutPrendre, coutDentree, estCendre, estSolCendre, foyersDeLaCarte,
  grainDeCendre, coutDe, foyerDe, terrainCendre, tomberLesMortsDeLaCendre,
  auCoeurDeLaCendre, profondeurDeCendre, solFoule,
} from './cendre'
import { BALANCE, NODE_DEFS, TERRAINS, TERRAIN_BURNT_FOREST, TERRAIN_CENDRE_BOIS, TERRAIN_CENDRE_MIN, TERRAIN_CENDRE_PRE,
  TERRAIN_CLIFF, TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_ROCK,
  TERRAIN_BOULDERS, TERRAIN_MARSH, TERRAIN_OLD_GROWTH, TERRAIN_SCREE, TERRAIN_SHALLOW_WATER,
  type NodeType } from './balance'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { placeHuntingGrounds } from './faune'
import { nidsAMonstre, POI_TYPES } from './poi'
import { RELIEF } from './zonegen'
import { fbm2 } from './noise'
import type { WorldMap } from './map'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1

/** Les avancées au jour donné, personne ne touchant aux fosses. */
const auJour = (jour: number): number[] =>
  avanceesDepuisAges(foyers.map(() => Math.max(0, jour - REVEIL)), foyers.length)

/** La part de la vallée cendrée, échantillonnée au pas de 2 (la carte fait 1,3 M de tuiles). */
function partCendree(jour: number): number {
  const av = auJour(jour)
  let n = 0
  let tot = 0
  for (let ty = 0; ty < map.height; ty += 2) {
    for (let tx = 0; tx < map.width; tx += 2) {
      tot++
      if (estCendre(map, tx, ty, av, SEED)) n++
    }
  }
  return n / tot
}

describe('A1/A2 — le champ est statique et complet, et tout se dérive du tick', () => {
  it('la carte de production porte les deux champs, et ils couvrent toute la carte', () => {
    expect(foyers.length).toBeGreaterThan(0)
    expect(map.cendreCout?.length).toBe(map.width * map.height)
  })

  it("l'eau et le vide sont hors d'atteinte, la terre ne l'est jamais", () => {
    let terre = 0
    let atteinte = 0
    for (let i = 0; i < map.width * map.height; i += 7) {
      const t = map.terrain[i]!
      const d = coutDe(map.cendreCout, i)
      if (!cendrePeutPrendre(t)) {
        expect(d, `l'eau/le vide ne se chemine pas (i=${i})`).toBe(-1)
        continue
      }
      terre++
      if (d >= 0) atteinte++
    }
    expect(terre).toBeGreaterThan(1000)
    // Une poche de terre isolée par l'eau serait légitime ; sur cette carte il n'y en a pas.
    expect(atteinte / terre).toBeGreaterThan(0.99)
  })

  it('le pliage tient le PIRE cas, pas seulement le monde joué', () => {
    // ⚠ LA GARDE QUI A ATTRAPÉ LE DÉFAUT : `FOYERS_MAX` valait 16, dimensionné sur le monde JOUÉ
    //   (9,3 fosses) — or le plan complet en porte **51**, et les index se seraient écrasés en
    //   silence : des tuiles auraient obéi à la mauvaise fosse. On confronte donc le pliage au
    //   PLAFOND DU REGISTRE, pas au compte d'une carte.
    const complet = carteDeTest(SEED)
    const f = foyersDeLaCarte(complet.map)
    expect(f.length, 'le plan complet en porte bien plus que le monde joué').toBeGreaterThan(16)
    const cap = POI_TYPES.find((t) => t.slug === 'charnier')?.cap ?? 0
    expect(cap, 'le registre plafonne les charniers').toBeGreaterThan(0)
    expect(CENDRE.FOYERS_MAX, 'et le pliage doit tenir ce plafond').toBeGreaterThan(cap)
  }, 120_000)

  it('chaque tuile atteinte est revendiquée par une fosse EXISTANTE', () => {
    for (let i = 0; i < map.width * map.height; i += 13) {
      if (coutDe(map.cendreCout, i) < 0) continue
      const k = foyerDe(map.cendreCout, i)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(foyers.length)
    }
  })

  it('deux calculs du même champ sont identiques au bit près (A2)', () => {
    const a = calculeChampDeCendre(map.width, map.height, map.terrain, foyers)
    const b = calculeChampDeCendre(map.width, map.height, map.terrain, foyers)
    expect(a).toEqual(b)
    expect(a).toEqual(map.cendreCout)
  }, 60_000)
})

describe('A3/A4 — le calendrier tient, et la cendre ne recule jamais', () => {
  it('rien ne bouge avant le réveil : la tache initiale est celle du jour 1', () => {
    expect(avanceeDeCendre(0)).toBe(CENDRE.R0)
    expect(partCendree(1)).toBe(partCendree(REVEIL))
  })

  it('A12 — la tache initiale se voit et ne coûte presque rien', () => {
    const p = partCendree(1)
    expect(p, 'elle existe').toBeGreaterThan(0)
    expect(p, 'et elle reste un lieu, pas une amputation').toBeLessThan(0.005)
  })

  /**
   * A3 — LE REPÈRE DE PRESSION, ET IL A CHANGÉ DE DATE LE 2026-08-25.
   *
   * Il gardait la contrainte d'origine : *« une pression réelle à la fin du second hiver »* —
   * la moitié de la vallée et la moitié des sites au JOUR 240. Alexis a divisé la propagation
   * par deux (« divise la propagation de la cendre par 2 ») : la loi étant une RACINE, atteindre
   * un coût donné demande **quatre fois** plus de jours, et le repère glisse du 2ᵉ au 6ᵉ hiver.
   *
   * On ne SUPPRIME pas la garde et on ne la relâche pas : on la REPOSE à sa nouvelle date, avec
   * la même forme (une date de calendrier, une part de vallée, une part de sites) et des bornes
   * aussi serrées qu'avant. Ce qui la ferait rougir : toucher `A` ou `PLAFOND_JOUR` sans le
   * vouloir, ou changer la géométrie du champ.
   *
   * MESURÉ (seed 2026, 50 sites) : jour 240 → 16,5 % de vallée / 16 % des sites ;
   * **jour 720 → 46,0 % / 54 %**.
   */
  it('A3 — à la fin du 6ᵉ hiver, la moitié de la vallée et la moitié des sites', () => {
    // Le 2ᵉ hiver ne mord PLUS : c'est la moitié du chantier, et il s'affirme.
    expect(partCendree(240), 'le 2ᵉ hiver est devenu doux').toBeLessThan(0.25)
    const part = partCendree(720)
    expect(part).toBeGreaterThan(0.4)
    expect(part).toBeLessThan(0.52)
    const nodes = placeZoneNodes(monde)
    const empl = emplacementsDeVillage(monde, nodes, {
      coinsDeChasse: placeHuntingGrounds(map, SEED), nids: nidsAMonstre(map),
    })
    const av = auJour(720)
    const pris = empl.filter((e) => estCendre(map, e.tx, e.ty, av, SEED)).length
    expect(pris / empl.length, 'le repère de pression, en sites').toBeGreaterThan(0.45)
  }, 120_000)

  it('A4 — monotone non décroissante, balayée jour par jour sur vingt ans', () => {
    let precedent = -1
    for (let jour = 1; jour <= 20 * 120; jour += 1) {
      const a = avanceeDeCendre(Math.max(0, jour - REVEIL))
      expect(a, `jour ${jour}`).toBeGreaterThanOrEqual(precedent)
      precedent = a
    }
  })

  it('la décroissance EXISTE : la vitesse du jour 240 est bien moindre que celle du réveil', () => {
    const v = (t: number) => avanceeDeCendre(t + 1) - avanceeDeCendre(t)
    expect(v(1)).toBeCloseTo(CENDRE.PLAFOND_JOUR, 5) // le plafond mord au début
    expect(v(149)).toBeLessThan(1) // …et plus du tout au jour 240
    expect(v(509)).toBeLessThan(v(149)) // …et de moins en moins
  })

  it('le plafond ne DÉPLACE pas la courbe : il ne fait que lisser son entrée', () => {
    // Passé `t = (A/3)²`, la loi plafonnée EST la racine nue, au flottant près.
    const r = CENDRE.A / CENDRE.PLAFOND_JOUR
    const t = Math.ceil(r * r) + 5
    expect(avanceeDeCendre(t)).toBeCloseTo(CENDRE.R0 + CENDRE.A * Math.sqrt(t), 6)
  })

  it('A14 — le cumul ne dépend pas de l’ordre des demandes', () => {
    const desordre = [900, 3, 120, 47, 1, 600, 12]
    const vus = desordre.map((t) => avanceeDeCendre(t))
    const relus = desordre.map((t) => avanceeDeCendre(t))
    expect(relus).toEqual(vus)
    // …et une lecture croissante rend exactement les mêmes nombres.
    expect(desordre.slice().sort((a, b) => a - b).map((t) => avanceeDeCendre(t)))
      .toEqual(desordre.slice().sort((a, b) => a - b).map((t) => vus[desordre.indexOf(t)]))
  })
})

describe('A6/A7 — le terrain freine, l’eau détourne : le champ n’est pas un cercle', () => {
  it('A6 — le minéral coûte trois fois le vivant', () => {
    expect(coutDentree(TERRAIN_ROCK)).toBe(CENDRE.COUT_MINERAL)
    expect(coutDentree(TERRAIN_CLIFF)).toBe(CENDRE.COUT_MINERAL)
    expect(coutDentree(TERRAIN_GRASS)).toBe(1)
    expect(coutDentree(TERRAIN_FOREST)).toBe(1)
  })

  it('A7 — il existe des tuiles dont le coût dépasse LARGEMENT leur distance à vol d’oiseau', () => {
    // La preuve que le champ chemine au lieu de rayonner. On compare, sur les tuiles atteintes,
    // le coût réel à ce que coûterait une ligne droite en terrain vivant.
    let vues = 0
    let detournees = 0
    for (let i = 0; i < map.width * map.height; i += 101) {
      const d = coutDe(map.cendreCout, i)
      if (d <= 0) continue
      const tx = i % map.width
      const ty = (i - tx) / map.width
      const f = foyers[foyerDe(map.cendreCout, i)]!
      const ex = tx - f.tx
      const ey = ty - f.ty
      const vol = Math.sqrt(ex * ex + ey * ey) * CENDRE.ORTHO
      if (vol <= 0) continue
      vues++
      if (d > vol * 1.5) detournees++
    }
    expect(vues).toBeGreaterThan(100)
    expect(detournees, 'des tuiles payées 1,5× la ligne droite : le champ CHEMINE').toBeGreaterThan(0)
  })

  /**
   * ⚠ **CETTE GARDE A CHANGÉ D'ÉNONCÉ LE 2026-08-25, elle n'a pas été relâchée.** Elle affirmait
   * « deux tuiles du même bloc rendent le même grain », le bloc étant une cellule de la grille des
   * axes. Depuis que le bloc SE DÉPLACE (`CENDRE.BLOC_AMPLITUDE` — sans quoi ses bords s'accordent
   * avec les isolignes octogonales du champ et la lisière sort en mur), cette cellule n'est plus
   * le bloc : deux voisines peuvent tomber de part et d'autre d'un bord.
   *
   * Ce qui doit tenir, et qui EST la raison d'être de la quantification, c'est que le grain se lise
   * **par PLAQUES et non par tuile** — un bruit tuile par tuile ferait une frange grésillante. On
   * l'affirme donc directement : la très grande majorité des couples de tuiles voisines partagent
   * leur grain, et une ligne de huit n'en porte qu'une poignée de valeurs. Un bruit par tuile
   * ferait rougir les deux.
   */
  it('le grain est borné et se lit par PLAQUES, jamais par tuile', () => {
    expect(CENDRE.MOTIF, 'il doit suivre le motif du terrain').toBe(RELIEF.MOTIF)
    const M = CENDRE.MOTIF
    /** Deux statistiques sur une lecture de grain : voisins partageant leur valeur, plaques par
     *  ligne de `M` tuiles. C'est ce qui sépare une plaque d'un grésillement. */
    const stat = (lire: (tx: number, ty: number) => number): { egaux: number; plaques: number } => {
      let egaux = 0
      let voisins = 0
      let somme = 0
      let lignes = 0
      for (let ty = 100; ty < 700; ty += 17) {
        for (let tx = 100; tx < 1400; tx += 31) {
          const vues = new Set<number>()
          for (let d = 0; d < M; d++) {
            const g = lire(tx + d, ty)
            vues.add(g)
            voisins += 2
            if (g === lire(tx + d + 1, ty)) egaux++
            if (g === lire(tx + d, ty + 1)) egaux++
          }
          somme += vues.size
          lignes++
        }
      }
      return { egaux: egaux / voisins, plaques: somme / lignes }
    }

    for (let k = 0; k < 200; k++) {
      expect(Math.abs(grainDeCendre(SEED, 40 + k * 7, 300 + k * 3))).toBeLessThanOrEqual(CENDRE.WARP_PART)
    }

    // LA PRÉMISSE : un grain lu TUILE PAR TUILE — ce qu'on refuse — échoue aux deux bornes.
    const parTuile = stat((tx, ty) => fbm2(tx, ty, CENDRE.WARP_ECHELLE, SEED))
    expect(parTuile.egaux).toBeLessThan(0.05)
    expect(parTuile.plaques).toBeGreaterThan(7)

    // LE GRAIN RÉEL. Sur la grille NUE (déplacement 0) : 87,5 % de voisins égaux, 1,88 plaque par
    // ligne de huit. Le déplacement du bloc en coupe un peu — 84,0 % et 2,10 mesurés — et c'est
    // le prix nommé de R6 ④. Il ne doit pas aller plus loin : au-delà, la frange grésille.
    const reel = stat((tx, ty) => grainDeCendre(SEED, tx, ty))
    expect(reel.egaux, 'la frange grésillerait').toBeGreaterThan(0.8)
    expect(reel.plaques, 'une ligne de huit tuiles porte deux plaques, pas huit').toBeLessThan(2.5)
  })

  it('le grain DÉFORME vraiment la frange — sans lui elle serait une isoligne nue', () => {
    // À un jour donné, on cherche deux tuiles de coût quasi égal dont l'une brûle et l'autre non.
    const av = auJour(240)
    const seuil = av[0]! * CENDRE.ORTHO
    let contreExemple = false
    for (let i = 0; i < map.width * map.height && !contreExemple; i += 37) {
      const d = coutDe(map.cendreCout, i)
      if (d < 0) continue
      if (Math.abs(d - seuil) > seuil * 0.05) continue
      const tx = i % map.width
      const ty = (i - tx) / map.width
      if (foyerDe(map.cendreCout, i) !== 0) continue
      if (estCendre(map, tx, ty, av, SEED) !== (d <= seuil)) contreExemple = true
    }
    expect(contreExemple, 'une tuile au moins échappe à l’isoligne : le grain agit').toBe(true)
  })
})

describe('A8 — les trois cendres, et le monde reste fermé', () => {
  it('LA FRANGE : chaque famille prend sa cendre, et l’eau n’en prend pas', () => {
    expect(terrainCendre(TERRAIN_GRASS)).toBe(TERRAIN_CENDRE_PRE)
    expect(terrainCendre(TERRAIN_FOREST)).toBe(TERRAIN_CENDRE_BOIS)
    expect(terrainCendre(TERRAIN_ROCK)).toBe(TERRAIN_CENDRE_MIN)
    expect(terrainCendre(TERRAIN_CLIFF)).toBe(TERRAIN_CENDRE_MIN)
    expect(terrainCendre(TERRAIN_DEEP_WATER)).toBeUndefined()
    expect(terrainCendre(TERRAIN_SHALLOW_WATER)).toBeUndefined()
  })

  it('LE CŒUR recycle la Cendrière — et le pré reste de la cendre', () => {
    // La corruption EST la Cendrière qui s'étend : au-delà de la frange, elle en a la peau.
    expect(terrainCendre(TERRAIN_FOREST, true), 'le bois devient le SOL de la Cendrière').toBe(TERRAIN_BURNT_FOREST)
    expect(terrainCendre(TERRAIN_OLD_GROWTH, true)).toBe(TERRAIN_BURNT_FOREST)
    // Les minéraux qu'elle portait déjà ne changent pas d'un pixel.
    expect(terrainCendre(TERRAIN_ROCK, true)).toBe(TERRAIN_ROCK)
    expect(terrainCendre(TERRAIN_CLIFF, true)).toBe(TERRAIN_CLIFF)
    // …et le caillouteux MARCHABLE prend le chaos de blocs, l'autre tache de la Cendrière.
    expect(terrainCendre(TERRAIN_SCREE, true)).toBe(TERRAIN_BOULDERS)
    // Décision d'Alexis : la Cendrière n'a AUCUN sol ouvert — le pré reste de la cendre.
    expect(terrainCendre(TERRAIN_GRASS, true)).toBe(TERRAIN_CENDRE_PRE)
    expect(terrainCendre(TERRAIN_DEEP_WATER, true)).toBeUndefined()
  })

  it('le cœur ne rend JAMAIS marchable ce qui ne l’était pas', () => {
    // Le même mode d'échec qu'à la frange (A8), sur l'autre bande : `wall` et `glacier` passent
    // par `estMineral` et ne doivent pas ressortir traversables.
    for (const t of Object.keys(TERRAINS).map(Number)) {
      const c = terrainCendre(t, true)
      if (c === undefined || TERRAINS[t]?.walkable !== false) continue
      expect(TERRAINS[c]?.walkable, `${TERRAINS[t]?.name} → ${TERRAINS[c]?.name}`).toBe(false)
    }
  })

  it('la frange fait bien 3 tuiles sur le vivant, et se compte en COÛT', () => {
    const av = auJour(240)
    let frange = 0
    let coeur = 0
    for (let i = 0; i < map.width * map.height; i += 149) {
      const tx = i % map.width
      const ty = (i - tx) / map.width
      const p = profondeurDeCendre(map, tx, ty, av, SEED)
      if (p < 0) continue
      if (p <= CENDRE.FRANGE_TUILES) frange++
      else coeur++
      expect(auCoeurDeLaCendre(map, tx, ty, av, SEED)).toBe(p > CENDRE.FRANGE_TUILES)
    }
    // Les deux bandes EXISTENT : une frange sans cœur (ou l'inverse) voudrait dire que la
    // largeur est absurde et que la moitié de la règle ne s'exerce jamais.
    expect(frange, 'il y a une frange').toBeGreaterThan(0)
    expect(coeur, 'et un cœur').toBeGreaterThan(frange)
  })

  it('A8 — la cendre MINÉRALE ne se traverse pas : sinon la cendre ouvre les bords du monde', () => {
    expect(TERRAINS[TERRAIN_CENDRE_MIN]?.walkable).toBe(false)
    // …et la conversion PRÉSERVE la traversabilité de tout ce qui ne l'était pas.
    for (const t of Object.keys(TERRAINS).map(Number)) {
      const c = terrainCendre(t)
      if (c === undefined) continue
      if (TERRAINS[t]?.walkable === false) {
        expect(TERRAINS[c]?.walkable, `${TERRAINS[t]?.name} → ${TERRAINS[c]?.name}`).toBe(false)
      }
    }
  })

  it('un sol cendré se reconnaît, et n’est jamais un sol vivant', () => {
    expect(estSolCendre(TERRAIN_CENDRE_PRE)).toBe(true)
    expect(estSolCendre(TERRAIN_CENDRE_BOIS)).toBe(true)
    expect(estSolCendre(TERRAIN_CENDRE_MIN)).toBe(true)
    expect(estSolCendre(TERRAIN_GRASS)).toBe(false)
    expect(estSolCendre(TERRAIN_FOREST)).toBe(false)
  })
})

describe('A9 — le vivant meurt lentement, le minéral reste', () => {
  const vivant = (t: string): boolean => NODE_DEFS[t as NodeType]?.vivant === true

  it('un arbre pris reste RÉCOLTABLE pendant son agonie, puis tombe', () => {
    // On cherche une tuile prise tôt, et on regarde son nœud vivre puis mourir.
    const av = auJour(240)
    let cible: { tx: number; ty: number } | null = null
    for (let i = 0; i < map.width * map.height && !cible; i += 11) {
      const tx = i % map.width
      const ty = (i - tx) / map.width
      if (estCendre(map, tx, ty, av, SEED)) cible = { tx, ty }
    }
    expect(cible).not.toBeNull()
    const ages = foyers.map(() => 240 - REVEIL)
    const anciennete = ancienneteDeCendre(map, cible!.tx, cible!.ty, ages, SEED)
    expect(anciennete, 'une tuile prise a un âge de cendre').toBeGreaterThanOrEqual(0)

    // Un arbre posé LÀ : debout tant que l'agonie dure, tombé après.
    const arbre = { id: 1, type: 'tree' as NodeType, tx: cible!.tx, ty: cible!.ty, stock: 10, regrowAt: 0 }
    const filon = { id: 2, type: 'iron_vein' as NodeType, tx: cible!.tx, ty: cible!.ty, stock: 8, regrowAt: 0 }
    const proprio = foyerDe(map.cendreCout, cible!.ty * map.width + cible!.tx)
    const jeunes = foyers.map((_, k) => (k === proprio && anciennete >= 0 ? 240 - REVEIL - anciennete + 1 : 0))
    const tot = tomberLesMortsDeLaCendre([arbre, filon], map, jeunes, SEED, vivant)
    expect(tot.restants, 'un jour après la prise, il est encore debout').toHaveLength(2)

    const vieux = tomberLesMortsDeLaCendre([arbre, filon], map, ages, SEED, vivant)
    expect(vieux.restants.map((n) => n.id), 'le minéral RESTE, toujours').toContain(2)
  }, 120_000)

  it('le minéral n’est jamais emporté, quel que soit l’âge', () => {
    const ages = foyers.map(() => 5000)
    const av = avanceesDepuisAges(ages, foyers.length)
    let pose: { tx: number; ty: number } | null = null
    for (let i = 0; i < map.width * map.height && !pose; i += 11) {
      const tx = i % map.width
      const ty = (i - tx) / map.width
      if (estCendre(map, tx, ty, av, SEED)) pose = { tx, ty }
    }
    const filon = { id: 7, type: 'iron_vein' as NodeType, tx: pose!.tx, ty: pose!.ty, stock: 8, regrowAt: 0 }
    const r = tomberLesMortsDeLaCendre([filon], map, ages, SEED, vivant)
    expect(r.tombes).toBe(0)
  })

  it('agonise() ne dit vrai que dans la fenêtre', () => {
    const ages = foyers.map(() => 0)
    // Sur une tuile jamais prise, jamais d'agonie.
    expect(agonise(map, 0, 0, ages, SEED)).toBe(false)
    expect(ancienneteDeCendre(map, -5, -5, ages, SEED)).toBe(-1)
  })
})

describe('A5 — personne ne naît sur le pas d’une fosse', () => {
  it('aucun spawn à moins de l’écart, et le semis n’est pas affamé', () => {
    const nodes = placeZoneNodes(monde)
    const empl = emplacementsDeVillage(monde, nodes, {
      coinsDeChasse: placeHuntingGrounds(map, SEED), nids: nidsAMonstre(map),
    })
    const combien = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)
    const spawns = pointsDeSpawn(monde, empl, combien)
    expect(spawns.length, 'le filtre ne doit pas affamer le semis').toBe(combien)
    for (const s of spawns) {
      const d = coutDe(map.cendreCout, s.ty * map.width + s.tx)
      expect(d < 0 || d >= CENDRE.ECART_SPAWN * CENDRE.ORTHO, `spawn (${s.tx},${s.ty}) à ${d}`).toBe(true)
    }
  }, 120_000)
})

describe('A11 — brûler une fosse FIGE son foyer', () => {
  it('un foyer gelé ne vieillit pas, et reprend où il en était', () => {
    const ages = [0, 0]
    const deux = [{ zone: 10 }, { zone: 20 }]
    avancerLaCendre(ages, deux, () => false, 1)
    expect(ages).toEqual([1, 1])
    // La zone 10 brûle : elle ne vieillit pas, l'autre continue.
    avancerLaCendre(ages, deux, (z) => z === 10, 1)
    expect(ages).toEqual([1, 2])
    // Le gel se lève : elle reprend EXACTEMENT où elle en était — jamais un rattrapage.
    avancerLaCendre(ages, deux, () => false, 1)
    expect(ages).toEqual([2, 3])
  })

  it('le caractère de la saison module ce que vaut un jour (R18)', () => {
    const ages = [0]
    const un = [{ zone: 3 }]
    avancerLaCendre(ages, un, () => false, 1.6) // `reveil`
    expect(ages[0]).toBeCloseTo(1.6, 10)
    avancerLaCendre(ages, un, () => false, 0.4) // `deluge`
    expect(ages[0]).toBeCloseTo(2.0, 10)
    // …mais un foyer GELÉ ne vieillit pas, quel que soit le caractère.
    avancerLaCendre(ages, un, () => true, 1.6)
    expect(ages[0]).toBeCloseTo(2.0, 10)
  })

  it('A13 — le caractère module SANS jamais inverser la monotonie', () => {
    const ages = [0]
    const un = [{ zone: 0 }]
    let precedent = avanceeDeCendre(0)
    for (let j = 0; j < 20 * 120; j++) {
      avancerLaCendre(ages, un, () => j % 37 === 0, j % 3 === 0 ? 0.4 : 1.6)
      const a = avanceeDeCendre(ages[0]!)
      expect(a, `jour ${j}`).toBeGreaterThanOrEqual(precedent)
      precedent = a
    }
  })
})

/**
 * ═══ A16 — LA LISIÈRE NE FAIT PAS DE MUR (spec `cendre.md` R6 ④) ═══
 *
 * Le nombre qui décide est **la plus longue portion de lisière parfaitement rectiligne**, en
 * tuiles. Un mur de quarante se lit comme un artefact d'affichage ; une arête de dix ne se voit
 * pas. L'instrument qui l'a calibré est `tools/diag-frange.mts`.
 *
 * ⚠ **ON NE COMPTE QUE LES COUPLES JOIGNABLES DES DEUX CÔTÉS.** Le bord d'un lac est droit sur
 * trente tuiles et ne doit rien au grain : sans ce filtre, la mesure accuse le relief — les plus
 * longues « arêtes » relevées tombaient à `x % MOTIF ≠ 0`, donc hors de la grille du grain, ce
 * qui l'a trahie.
 */
describe('A16 — la lisière ne fait pas de mur', () => {
  const MUR = 8
  /** Le grain, mais avec son déplacement LIBRE : la garde doit pouvoir rejouer l'état d'avant. */
  const grainAvecDeplacement = (tx: number, ty: number, amp: number): number => {
    let sx = tx
    let sy = ty
    if (amp > 0) {
      const selW = (SEED ^ 0x57415250) | 0
      sx = tx + amp * 2 * (fbm2(tx, ty, CENDRE.BLOC_ECHELLE, selW) - 0.5)
      sy = ty + amp * 2 * (fbm2(tx, ty, CENDRE.BLOC_ECHELLE, (selW ^ 0x2f3b) | 0) - 0.5)
    }
    const M = CENDRE.MOTIF
    const bx = Math.floor(sx / M) * M + M / 2
    const by = Math.floor(sy / M) * M + M / 2
    const sel = (SEED ^ 0x43454e44) | 0
    const large = fbm2(bx, by, CENDRE.WARP_ECHELLE, sel) - 0.5
    const fine = fbm2(bx, by, CENDRE.WARP_ECHELLE / 4, (sel ^ 0x9e37) | 0) - 0.5
    return (large * 0.75 + fine * 0.25) * 2 * CENDRE.WARP_PART
  }

  const releve = (age: number, amp: number): { max: number; murs: number } => {
    const av = avanceesDepuisAges(foyers.map(() => age), foyers.length)
    const W = map.width
    const H = map.height
    const cendre = new Uint8Array(W * H)
    const joignable = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const c = coutDe(map.cendreCout, i)
        if (c < 0) continue
        joignable[i] = 1
        const a = av[foyerDe(map.cendreCout, i)] ?? 0
        if (c <= a * CENDRE.ORTHO * (1 + grainAvecDeplacement(x, y, amp))) cendre[i] = 1
      }
    }
    let max = 0
    let murs = 0
    const balayer = (vertical: boolean): void => {
      for (let u = 1; u < (vertical ? W : H); u++) {
        let run = 0
        for (let v = 0; v < (vertical ? H : W); v++) {
          const i1 = vertical ? v * W + u - 1 : (u - 1) * W + v
          const i2 = vertical ? v * W + u : u * W + v
          if (joignable[i1] === 1 && joignable[i2] === 1 && cendre[i1] !== cendre[i2]) {
            run++
            if (run > max) max = run
          } else {
            if (run >= MUR) murs++
            run = 0
          }
        }
        if (run >= MUR) murs++
      }
    }
    balayer(true)
    balayer(false)
    return { max, murs }
  }

  // LA PRÉMISSE D'ABORD : sans le déplacement, la carte DOIT porter des murs. Une garde qui
  // passerait aussi sur le grain d'avant ne mesurerait pas le chantier (mémoire « une sonde qui
  // ne peut pas échouer »).
  it('sans déplacement, la lisière fait des murs — la garde a bien un défaut à voir', () => {
    const avant = releve(300, 0)
    expect(avant.max, 'le défaut a disparu tout seul : la garde ne prouve plus rien').toBeGreaterThan(30)
    expect(avant.murs).toBeGreaterThan(300)
  })

  it('avec le déplacement, aucune arête droite ne dépasse 24 tuiles', () => {
    for (const age of [90, 150, 300]) {
      const r = releve(age, CENDRE.BLOC_AMPLITUDE)
      expect(r.max, `age ${age} — plus longue arête droite`).toBeLessThanOrEqual(24)
      expect(r.murs, `age ${age} — arêtes de ${MUR} tuiles ou plus`).toBeLessThan(200)
    }
  })

  // Le déplacement ne doit RIEN prendre de plus à la vallée : c'est un réglage de forme, pas
  // d'équilibrage. Un quart de point d'écart et le calibrage de `A` serait à refaire.
  it("il ne change pas ce que la cendre PREND (moins d'un quart de point)", () => {
    const part = (amp: number): number => {
      const av = avanceesDepuisAges(foyers.map(() => 300), foyers.length)
      let pris = 0
      let total = 0
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const c = coutDe(map.cendreCout, y * map.width + x)
          if (c < 0) continue
          total++
          const a = av[foyerDe(map.cendreCout, y * map.width + x)] ?? 0
          if (c <= a * CENDRE.ORTHO * (1 + grainAvecDeplacement(x, y, amp))) pris++
        }
      }
      return pris / total
    }
    expect(Math.abs(part(CENDRE.BLOC_AMPLITUDE) - part(0))).toBeLessThan(0.0025)
  })

  it('le déplacement nul rend EXACTEMENT le grain quantifié sur la grille', () => {
    for (const [x, y] of [[0, 0], [7, 7], [8, 8], [631, 239], [1200, 700]] as [number, number][]) {
      expect(grainAvecDeplacement(x, y, 0)).toBe(grainAvecDeplacement(x - (x % CENDRE.MOTIF), y - (y % CENDRE.MOTIF), 0))
    }
  })
})

describe('une carte sans fosse ne brûle jamais — le repli est explicite', () => {
  it('le champ est vide, et rien n’est cendré', () => {
    const vide = calculeChampDeCendre(4, 4, new Array(16).fill(TERRAIN_GRASS), [])
    expect(vide.every((d) => d === -1)).toBe(true)
    const faux = { width: 4, height: 4, terrain: new Array(16).fill(TERRAIN_GRASS), zones: [] }
    expect(estCendre(faux as never, 1, 1, [999], SEED)).toBe(false)
    expect(foyersDeLaCarte(faux as never)).toHaveLength(0)
  })
})

/**
 * ═══ LE SOL QU'ON FOULE — LA CENDRE REMPLACE CE QU'ELLE COUVRE (Alexis, 2026-08-25) ═══
 *
 * *« Si c'est un marais avec de la cendre, pas d'offset pas de slow. »* Le terrain n'est jamais
 * muté : sans `solFoule`, `moveAvatar` lisait le sol d'AVANT et faisait patauger dans une boue
 * qui a brûlé.
 */
describe('solFoule — la cendre commande le pas', () => {
  /** Une carte d'un seul terrain, avec un foyer de cendre au coin — le vrai champ de coût. */
  function carteCendree(terrain: number): { map: WorldMap; ages: number[] } {
    const W = 40
    const H = 40
    const sol = new Array<number>(W * H).fill(terrain)
    // Le champ de coût du VRAI mécanisme (`calculeChampDeCendre`, l'écrivain unique) : un champ
    // écrit à la main testerait mon idée du champ, pas le champ.
    const cendreCout = calculeChampDeCendre(W, H, sol, [{ tx: 2, ty: 2 }])
    const map = {
      width: W, height: H, terrain: sol, zones: [], cendreCout,
    } as unknown as WorldMap
    return { map, ages: [400] } // 400 jours : la cendre a largement dépassé les 40 tuiles
  }

  it('un MARAIS cendré ne ralentit plus — c\'est de la poussière, pas de la boue', () => {
    const { map, ages } = carteCendree(TERRAIN_MARSH)
    const sol = solFoule({ map, cendreAge: ages, seed: 7 }, 20, 20)
    expect(sol, 'la cendre n\'a pas pris au centre — la prémisse est morte').toBeDefined()
    // Le marais vaut 0,6 ; ce qu'on foule doit être plus rapide, ET ce doit être un sol de cendre.
    expect(estSolCendre(sol!) || sol === TERRAIN_BURNT_FOREST).toBe(true)
    expect(TERRAINS[sol!]!.speedFactor).toBeGreaterThan(TERRAINS[TERRAIN_MARSH]!.speedFactor)
  })

  it('hors de la cendre, elle ne dit RIEN — l\'appelant garde son terrain', () => {
    const { map, ages } = carteCendree(TERRAIN_MARSH)
    // Âge nul : le disque `R0` seul, donc le loin n'est pas pris.
    expect(solFoule({ map, cendreAge: [0], seed: 7 }, 39, 39)).toBeUndefined()
    // Et une carte SANS champ de cendre ne paie rien du tout.
    const nu: WorldMap = { ...map }
    delete nu.cendreCout
    expect(solFoule({ map: nu, cendreAge: ages, seed: 7 }, 20, 20)).toBeUndefined()
  })

  /**
   * ⚠ LA GARDE QUI COMPTE, et elle a une raison d'exister : la table de la FRANGE envoie tout le
   * cailloutteux marchable sur `cendre_min`, déclaré `walkable: false` — un sol de RENDU. Rendu
   * au pas, il ferait d'un éboulis praticable un mur le jour où la cendre l'atteint.
   *
   * On balaie TOUT le registre plutôt que trois cas choisis (mémoire `garde-exhaustive-plutot-que-cas`) :
   * une poussière ne ferme jamais un passage, quel que soit le sol dessous.
   */
  it('elle ne rend JAMAIS un sol moins praticable que celui qu\'elle couvre', () => {
    // ⚠ ON BALAIE AUSSI LES ÂGES, ET C'EST LE POINT. Écrite sur un seul âge mûr, cette garde
    //   passait sans RIEN éprouver : à 400 jours tous les points échantillonnés sont au CŒUR
    //   (`profond = true`), et `cendre_min` n'existe que dans la FRANGE. MESURÉ avant correction :
    //   69 points couverts, **0 piège rencontré** — trois ✓ obtenus par accident.
    //   Les âges jeunes amènent le front sous les sondes, donc la frange avec lui.
    let pieges = 0
    let couverts = 0
    for (const id of Object.keys(TERRAINS).map(Number)) {
      const def = TERRAINS[id]!
      if (!def.walkable) continue
      const { map } = carteCendree(id)
      for (const age of [2, 6, 14, 40, 400]) {
        const ages = [age]
        const av = avanceesDepuisAges(ages, 1)
        for (const [tx, ty] of [[4, 4], [6, 6], [10, 10], [20, 20], [30, 30]] as const) {
          const prof = profondeurDeCendre(map, tx, ty, av, 7)
          if (prof < 0) continue
          couverts += 1
          // Ce que la table RENDRAIT sans la garde — c'est lui, le piège qu'on prétend éviter.
          const brut = terrainCendre(id, prof > CENDRE.FRANGE_TUILES)
          if (brut !== undefined && TERRAINS[brut]!.walkable === false) pieges += 1
          const sol = solFoule({ map, cendreAge: ages, seed: 7 }, tx, ty)
          if (sol === undefined) continue
          expect(TERRAINS[sol]!.walkable, `${def.name} cendré (âge ${age}) est devenu un mur`).toBe(true)
          expect(TERRAINS[sol]!.speedFactor, `${def.name} cendré s'arrête net`).toBeGreaterThan(0)
        }
      }
    }
    // LA PRÉMISSE, AFFIRMÉE : le balayage a bien couvert de la cendre, ET il a bien rencontré
    // le cas que la garde existe pour attraper. Sans ces deux lignes, elle peut redevenir verte
    // par accident au premier changement de table ou de calibrage.
    expect(couverts, 'le balayage n’a rencontré aucune cendre').toBeGreaterThan(50)
    expect(pieges, 'le balayage n’a jamais rencontré `cendre_min` — la garde ne garde rien').toBeGreaterThan(0)
  })
})
