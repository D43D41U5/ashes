/**
 * ═══ OÙ NAISSENT LES VILLAGES — la sonde de la question ③ ═══
 *
 * Le banc de saison a mesuré deux accélérateurs de PLACEMENT (calibration-saison.md § ③) :
 * la graine 1234 fait naître le Foyer sous la pression des monstres de POI (mort au j6 sans
 * une famine), la graine 31 pose le neutre dans une zone sans baies (famine au j9). Avant
 * d'écrire la garde, on MESURE : pour chaque graine du banc, où sont les trois villages
 * choisis, à quelle distance du NID le plus proche (lieu à monstre résident — tanière,
 * repaire : `POI_TYPES.monster`), et combien de baies leur maille de fondation porte
 * (la même maille+zone que BOIS_MIN/PIERRE_MIN).
 *
 * Puis on balaie les seuils candidats (ECART_NID × BAIES_MIN) et on compte ce que chaque
 * couple laisse d'emplacements aux Prés Bas — la garde A17 (≥ 16) doit rester verte.
 *
 * Usage : node --import tsx tools/diag-placement.mts [seeds...]  (défaut : 2026 7 31 1234)
 */
import { BANC_JOUEURS, construireMondeDuBanc } from '../packages/sim/src/scenario'
import { POI_TYPES } from '../packages/sim/src/poi'
import { placeHuntingGrounds } from '../packages/sim/src/faune'
import { FAUNA } from '../packages/sim/src/balance'
import { emplacementsDeVillage, placeZoneNodes, CONTENU, type Emplacement } from '../packages/sim/src/zone-content'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'

const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite)
const SEEDS = seeds.length ? seeds : [2026, 7, 31, 1234]

/** Distance d'un point au RECTANGLE d'un lieu (0 si dedans) — l'empreinte, pas son centre. */
function distRect(tx: number, ty: number, z: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(z.x - tx, 0, tx - (z.x + z.w))
  const dy = Math.max(z.y - ty, 0, ty - (z.y + z.h))
  return Math.sqrt(dx * dx + dy * dy)
}

const NIDS = new Set(POI_TYPES.filter((t) => t.monster).map((t) => t.slug))
const DANGERS = new Set(POI_TYPES.filter((t) => t.family === 'danger').map((t) => t.slug))

for (const seed of SEEDS) {
  // Le MÊME monde que le banc (6 joueurs) — c'est là que les accélérateurs ont été mesurés.
  const carte = generateZonedTerrain(seed, BANC_JOUEURS, MONDE_JOUE)
  const nodes = placeZoneNodes(carte)
  // AVANT la garde R17bis (dangers vides) — pour lire ce qu'elle a écarté.
  const emplacements = emplacementsDeVillage(carte, nodes, { coinsDeChasse: [], nids: [] })
  const racine = carte.graphe.racine

  // Les baies par maille+zone — le MÊME comptage que la garde candidate.
  const maille = CONTENU.RAYON_VILLAGE
  const mw = Math.ceil(carte.map.width / maille)
  const cle = (tx: number, ty: number, z: number): number =>
    (Math.floor(ty / maille) * mw + Math.floor(tx / maille)) * 32 + z
  const baies = new Map<number, number>()
  for (const n of nodes) {
    if (n.type !== 'berry_bush') continue
    const i = n.ty * carte.map.width + n.tx
    const k = cle(n.tx, n.ty, carte.zone[i]!)
    baies.set(k, (baies.get(k) ?? 0) + 1)
  }
  const baiesDe = (e: Emplacement): number => baies.get(cle(e.tx, e.ty, e.zone)) ?? 0

  const lieux = carte.map.zones
    .map((z, poiId) => ({ z, poiId }))
    .filter(({ z }) => z.kind && DANGERS.has(z.kind))
  const nidLePlusProche = (tx: number, ty: number) => {
    let best = { d: Infinity, kind: '?' }
    for (const { z } of lieux) {
      if (!NIDS.has(z.kind!)) continue
      const d = distRect(tx, ty, z)
      if (d < best.d) best = { d, kind: z.kind! }
    }
    return best
  }

  // LES COINS DE CHASSE — le territoire (GROUND_RADIUS) est le disque où la faune naît.
  // (Plus de prédateurs dans l'anneau depuis le 2026-08-28 : la meute vit à la Louvière.)
  const grounds = placeHuntingGrounds(carte.map, seed)
  const chasseLaPlusProche = (tx: number, ty: number): number => {
    let best = Infinity
    for (const g of grounds) {
      const d = Math.sqrt((g.x - tx) * (g.x - tx) + (g.y - ty) * (g.y - ty))
      if (d < best) best = d
    }
    return best
  }

  // Les trois villages RÉELLEMENT fondés — par la recette du banc elle-même.
  const { sim } = construireMondeDuBanc(seed)

  console.log(`\n═══ graine ${seed} — ${emplacements.length} emplacements (${emplacements.filter((e) => e.zone === racine).length} aux Prés Bas)`)
  for (const v of sim.villages) {
    const nid = nidLePlusProche(v.fireTx, v.fireTy)
    const e = { tx: v.fireTx, ty: v.fireTy, zone: carte.zone[v.fireTy * carte.map.width + v.fireTx]! }
    const dangersProches = lieux
      .map(({ z }) => ({ kind: z.kind!, d: distRect(v.fireTx, v.fireTy, z) }))
      .filter((l) => l.d <= 64)
      .sort((a, b) => a.d - b.d)
      .map((l) => `${l.kind}@${l.d.toFixed(0)}`)
      .join(' ')
    console.log(
      `  ${v.name.padEnd(22)} (${v.fireTx},${v.fireTy}) zone=${e.zone === racine ? 'racine' : e.zone}` +
      ` — nid le plus proche : ${nid.kind}@${nid.d.toFixed(0)} — chasse@${chasseLaPlusProche(v.fireTx, v.fireTy).toFixed(0)}` +
      ` (territoire=${FAUNA.GROUND_RADIUS}) — baies(maille)=${baiesDe(e)}` +
      (dangersProches ? ` — dangers ≤64 : ${dangersProches}` : ''),
    )
  }

  // Le balayage des seuils : ce que chaque couple laisserait d'emplacements. NOTE : filtre
  // POST-espacement — une borne BASSE de ce que la vraie garde (dans le balayage) rendrait.
  console.log('  seuils (ECART_CHASSE × BAIES_MIN, nid ≥ 32 partout) → survivants (dont Prés Bas) :')
  for (const ecartChasse of [0, 46, 64, 76, 88, 96]) {
    const ligne: string[] = []
    for (const bmin of [0, 1, 2, 4, 6]) {
      const ok = emplacements.filter((e) =>
        nidLePlusProche(e.tx, e.ty).d >= 32 && chasseLaPlusProche(e.tx, e.ty) >= ecartChasse && baiesDe(e) >= bmin)
      ligne.push(`${ecartChasse}×${bmin}:${ok.length}(${ok.filter((e) => e.zone === racine).length})`)
    }
    console.log(`    ${ligne.join('  ')}`)
  }
}
