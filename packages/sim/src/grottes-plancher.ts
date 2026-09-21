/**
 * LE PLANCHER DES GROTTES (spec `grottes.md` G-R8a) — la passe TARDIVE de l'hôte.
 *
 * La génération élit ses karsts par la roche (`creuserLesKarsts`, G-R8b) : un pays d'argile en
 * porte peu, et MESURÉ avant cette passe (5 graines) : 3 à 10 des 17 points de naissance et 13 à
 * 25 des 40-49 sites de village n'avaient AUCUNE Grotte à ≤ `PLANCHER_RAYON` — la Grotte était
 * une découverte d'acte II. Le plancher est la promesse inverse : pour chaque point de naissance
 * et chaque site de village, s'il n'a pas de Grotte à portée, on en creuse une sur **la paroi
 * éligible la plus proche, quelle que soit sa roche** — mêmes étapes que la génération
 * (`creuserUnKarst` : tronc, salles, nappe, trace), même pose (`poserLeKarst`), même pierre.
 *
 * TARDIVE, comme `placeZoneNodes` : elle tourne APRÈS `pointsDeSpawn`/`emplacementsDeVillage`
 * — ce sont eux qui disent où l'on naît — et AVANT `createSim`, qui emporte la carte. Elle
 * MUTE la carte (grilles creuses, connecteurs, zones, trace sur `terrain`, coulées), la liste
 * `karsts` et les nœuds (ceux qu'une gueule ou une trace recouvre tombent, la pierre du cœur
 * s'ajoute en queue). Positionnelle de bout en bout (`hash2` salé) : aucun flux RNG (G-A2).
 *
 * Ce qu'elle NE promet PAS : le rayon. Si la paroi éligible la plus proche est elle-même à plus
 * de `PLANCHER_RAYON` (MESURÉ : un spawn de la graine 1234 à 226 t de toute paroi), la Grotte se
 * creuse là quand même — c'est la plus proche possible — et le point est RAPPORTÉ `horsRayon`.
 */
import { construireEtage, type Connecteur, type EtageCreux } from './etages'
import type { ResourceNode } from './economy'
import { pierreDUnKarst } from './zone-content'
import { poserLeKarst, type CarteZonee } from './zonegen'
import { tracerLesCouleesDepuis } from './zonegen-coulees'
import {
  creuserUnKarst, gueuleDuSegment, KARST, masqueDesLieux, segmentEncoreEligible, segmentsDeParoiEligibles,
  type ChampDeKarst, type Karst,
} from './zonegen-karst'

/** Un point à couvrir : une naissance, un site de village. */
export interface PointACouvrir {
  tx: number
  ty: number
}

export interface RapportDuPlancher {
  /** Les karsts creusés par la passe, dans l'ordre des points. */
  creuses: Karst[]
  /**
   * Les points restés sans Grotte à ≤ `PLANCHER_RAYON` après la passe, avec la distance de la
   * gueule la plus proche, celle de la première paroi éligible essayée (`Infinity` : aucune
   * paroi plus proche que la Grotte déjà là) et le compte des parois où la roche n'a pas cédé.
   * Un point n'est ici que si la paroi la plus proche était hors rayon, ou refusée.
   */
  horsRayon: { tx: number; ty: number; grotte: number; paroi: number; refusees: number }[]
}

/** Le champ du creusement, relu sur la carte FINIE : la roche prise est celle de tous les étages. */
export function champDuPlancher(c: CarteZonee): ChampDeKarst | null {
  const { map } = c
  const rect = c.graphe.zones[c.graphe.racine]?.rect
  if (map.palier === undefined || c.socle === null || rect === undefined) return null
  const { width, height } = map
  const reserve = new Uint8Array(width * height)
  for (const et of map.etages ?? []) for (const i of et.idx) reserve[i] = 1
  const portes = new Set<number>()
  for (const k of map.connecteurs ?? []) {
    const i = k.y * width + k.x
    portes.add(i)
    reserve[i] = 1
  }
  return {
    terrain: map.terrain, width, height, palier: map.palier, creux: c.socle, rect, reserve,
    lieux: masqueDesLieux(map.zones, width, height), portes,
  }
}

/** La distance² d'un point à la gueule principale (tuile ouest) de chaque karst : la plus courte. */
function grotteLaPlusProche2(karsts: readonly Karst[], width: number, p: PointACouvrir): number {
  let best = Infinity
  for (const k of karsts) {
    const o = k.gueules[0]![0]
    const ox = o % width
    const oy = (o - ox) / width
    const d = (ox - p.tx) * (ox - p.tx) + (oy - p.ty) * (oy - p.ty)
    if (d < best) best = d
  }
  return best
}

/**
 * AJOUTER À UN ÉTAGE EXISTANT — ou l'ouvrir. La grille creuse reste triée (la dichotomie en
 * dépend) et son terrain aligné ; la boîte englobante s'étend. Les étages restent rangés par
 * niveau croissant, comme la génération les range.
 */
function ajouterALEtage(map: CarteZonee['map'], niveau: number, tuiles: readonly number[], terrainDe: ReadonlyMap<number, number>): void {
  const width = map.width
  const etages = map.etages ?? []
  const existant = etages.find((e) => e.niveau === niveau)
  const lire = (tx: number, ty: number): number => terrainDe.get(ty * width + tx)!
  if (existant === undefined) {
    const neuf = construireEtage(niveau, tuiles, width, lire)
    let at = etages.length
    for (let i = 0; i < etages.length; i++) {
      if (etages[i]!.niveau > niveau) {
        at = i
        break
      }
    }
    etages.splice(at, 0, neuf)
  } else {
    const ajout = construireEtage(niveau, tuiles, width, lire)
    const idx: number[] = []
    const terrain: number[] = []
    let a = 0
    let b = 0
    while (a < existant.idx.length || b < ajout.idx.length) {
      const ia = a < existant.idx.length ? existant.idx[a]! : Infinity
      const ib = b < ajout.idx.length ? ajout.idx[b]! : Infinity
      if (ia <= ib) {
        idx.push(ia)
        terrain.push(existant.terrain[a]!)
        a += 1
        if (ia === ib) b += 1 // la réserve l'interdit ; par sûreté, l'existant garde son terrain
      } else {
        idx.push(ib)
        terrain.push(ajout.terrain[b]!)
        b += 1
      }
    }
    const fusion: EtageCreux = {
      niveau, idx, terrain,
      x0: Math.min(existant.x0, ajout.x0), y0: Math.min(existant.y0, ajout.y0),
      x1: Math.max(existant.x1, ajout.x1), y1: Math.max(existant.y1, ajout.y1),
    }
    etages[etages.indexOf(existant)] = fusion
  }
  map.etages = etages
}

/**
 * LA PASSE. Pour chaque point, dans l'ordre donné (les naissances d'abord, puis les sites) : rien
 * si une gueule est à ≤ `PLANCHER_RAYON` ; sinon les segments encore éligibles, du plus proche au
 * plus loin (distance à leur gueule, puis l'ordre des index), jusqu'à ce que la roche cède.
 */
export function creuserLePlancher(c: CarteZonee, nodes: ResourceNode[], points: readonly PointACouvrir[]): RapportDuPlancher {
  const rapport: RapportDuPlancher = { creuses: [], horsRayon: [] }
  const champ = champDuPlancher(c)
  if (champ === null || points.length === 0) return rapport
  const { map } = c
  const width = map.width
  const R2 = KARST.PLANCHER_RAYON * KARST.PLANCHER_RAYON
  // Les segments d'une seule lecture : un segment pris par un karst du plancher se revalide
  // avant de servir (`segmentEncoreEligible`) — bien moins cher que de tout relire à chaque point.
  const segments = segmentsDeParoiEligibles(champ)
  const connecteurs: Connecteur[] = map.connecteurs ?? []
  let idSuivant = 0
  for (const n of nodes) if (n.id >= idSuivant) idSuivant = n.id + 1

  for (const p of points) {
    if (grotteLaPlusProche2(c.karsts, width, p) <= R2) continue
    // LA MÊME TUILE QUE LA MESURE : `grotteLaPlusProche2` lit la tuile OUEST de la paire de gueule
    // (`gueules[0][0]`), or `gueuleDuSegment` rend la tuile EST. Planifier sur l'est et mesurer
    // sur l'ouest décalait d'une tuile : une paroi planifiée à 99,6 t creusait une Grotte mesurée à
    // 100,4 — hors rayon, sans refus ni paroi lointaine à rapporter (G-A7 rougie sur la graine 1234
    // le 2026-09-20, la carte du flanc). La distance se prend donc à `gx − 1`.
    const ordre = segments
      .map((s, i) => {
        const gx = gueuleDuSegment(s) - 1
        return { s, i, d: (gx - p.tx) * (gx - p.tx) + (s.y - p.ty) * (s.y - p.ty) }
      })
      .sort((u, v) => u.d - v.d || u.i - v.i)
    // Une paroi plus loin que la Grotte déjà la plus proche n'améliore rien : on ne creuse pas
    // deux fois pour le même point (le second passage d'un site déjà servi hors rayon).
    const dejaLa = grotteLaPlusProche2(c.karsts, width, p)
    let paroi = Infinity
    let refusees = 0
    let k: Karst | null = null
    for (const { s, d } of ordre) {
      if (d >= dejaLa) break
      if (!segmentEncoreEligible(champ, s)) continue
      if (paroi === Infinity) paroi = Math.sqrt(d)
      k = creuserUnKarst(champ, s, gueuleDuSegment(s))
      if (k !== null) break
      refusees += 1
    }
    if (k === null) {
      rapport.horsRayon.push({ tx: p.tx, ty: p.ty, grotte: Math.sqrt(dejaLa), paroi, refusees })
      continue
    }
    k.plancher = true
    // La pose — la même que la génération : grille creuse, connecteurs, zone.
    const terrainKarst = new Map<number, number>()
    poserLeKarst(map, k, (niveau, tuiles) => ajouterALEtage(map, niveau, tuiles, terrainKarst), connecteurs, terrainKarst)
    c.karsts.push(k)
    rapport.creuses.push(k)
    // Ce que la gueule et la trace recouvrent ne nourrit plus (stérilité de G-R9, seuils de R10.3).
    const pris = new Set<number>(k.trace)
    for (const paire of k.gueules) for (const i of paire) pris.add(i)
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!
      if (n.etage === undefined && pris.has(n.ty * width + n.tx)) nodes.splice(i, 1)
    }
    for (const n of pierreDUnKarst(k, width, idSuivant)) {
      nodes.push(n)
      idSuivant = n.id + 1
    }
    if (grotteLaPlusProche2(c.karsts, width, p) > R2) {
      rapport.horsRayon.push({ tx: p.tx, ty: p.ty, grotte: Math.sqrt(grotteLaPlusProche2(c.karsts, width, p)), paroi, refusees })
    }
  }
  if (rapport.creuses.length === 0) return rapport
  // `poserLeKarst` a ouvert des étages sur une carte qui n'en avait peut-être pas : les deux
  // champs vont ensemble (spec `etages.md` E-R1/E-R7).
  map.connecteurs = connecteurs
  // LES COULÉES DES KARSTS SECS (G-R9) — une par gueule principale, le même champ de descente
  // que la génération, ajoutées à la suite des coulées existantes (chemins séparés par -1).
  const secs = rapport.creuses.filter((k) => !k.noye).map((k) => k.gueules[0]![1])
  if (secs.length > 0) {
    const coulees = tracerLesCouleesDepuis(map.terrain, c.zone, c.graphe, width, map.height, c.socle, secs)
    if (coulees.length > 0) map.coulees = map.coulees && map.coulees.length > 0 ? [...map.coulees, -1, ...coulees] : coulees
  }
  return rapport
}
