/**
 * ═══ LES TRACES DU COIN DE CHASSE (spec faune R24, A38) — du décor logique, jamais un mensonge ═══
 *
 * Les traces se DÉRIVENT de la structure réelle du coin — les mêmes données que le
 * comportement des bêtes, donc la trace ne peut pas mentir :
 *
 *   — les EMPREINTES jalonnent la coulée attachée au coin (`map.coulees`, l'attache
 *     est LA règle de `couleeStep` : la coulée dont la fin — l'eau — est la plus
 *     proche du cœur, à ≤ `HUNT.COULEE_ATTACHE`) ;
 *   — les FUMÉES parsèment le gagnage (anneau proche du cœur, sol ouvert) ;
 *   — les FROTTIS marquent la LISIÈRE du massif le plus proche (un arbre en bord de
 *     bois — cohérent avec le Brame).
 *
 * Tout est PUR (carte + coins + graine → positions, `hash2`) et vit hors Phaser :
 * mesurable sans écran, recalculé quand la liste des coins bouge (R27 — le monde
 * ressème, les traces suivent ; celles d'un coin mort s'effacent avec lui).
 */
import { FAUNA, HUNT, TERRAINS, WOOD_TERRAINS, hash2, terrainAt, type WorldMap } from '@ashes/sim'

export interface Trace {
  x: number
  y: number
  sorte: 'empreinte' | 'fumees' | 'frottis'
  /** Le CAP d'une empreinte, en huitièmes (0-7) — le sens de la marche le long de la coulée. */
  cap?: number
}

/** Un pas d'empreintes sur deux-trois tuiles : un chemin se lit, il ne se pave pas. */
const PAS_EMPREINTE = 3
const FUMEES_PAR_COIN = 4
const FROTTIS_PAR_COIN = 3
/** L'écart minimal entre deux frottis (tuiles) : trois marques, pas une palissade. */
const FROTTIS_ECART = 4

const SEL_TRACES = 0x54524143 // 'TRAC'

function octant(dx: number, dy: number): number {
  // Huit caps, sans trigonométrie : le signe et la dominante suffisent.
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax >= ay * 2.414) return dx > 0 ? 0 : 4
  if (ay >= ax * 2.414) return dy > 0 ? 2 : 6
  if (dx > 0) return dy > 0 ? 1 : 7
  return dy > 0 ? 3 : 5
}

/** LA COULÉE DU COIN — la même attache que `couleeStep` : début inclus, fin exclue, ou null. */
function couleeDuCoin(map: WorldMap, gx: number, gy: number): { debut: number; fin: number } | null {
  const coulees = map.coulees
  if (!coulees || coulees.length === 0) return null
  const width = map.width
  let debut = 0
  let meilleur = -1
  let meilleure = HUNT.COULEE_ATTACHE * HUNT.COULEE_ATTACHE
  for (let k = 0; k <= coulees.length; k++) {
    if (k < coulees.length && coulees[k]! >= 0) continue
    if (k > debut) {
      const finIdx = coulees[k - 1]!
      const fx = finIdx % width
      const fy = (finIdx - fx) / width
      const d2 = (gx - (fx + 0.5)) * (gx - (fx + 0.5)) + (gy - (fy + 0.5)) * (gy - (fy + 0.5))
      if (d2 < meilleure) {
        meilleure = d2
        meilleur = debut
      }
    }
    debut = k + 1
  }
  if (meilleur < 0) return null
  let fin = meilleur
  while (fin < coulees.length && coulees[fin]! >= 0) fin += 1
  return { debut: meilleur, fin }
}

/** Les traces d'UN coin. Un coin sans coulée n'a pas d'empreintes ; sans massif, pas de frottis. */
export function tracesDuCoin(map: WorldMap, ground: { x: number; y: number }, seed: number): Trace[] {
  const out: Trace[] = []
  const width = map.width
  const graine = (seed ^ SEL_TRACES) | 0

  // LES EMPREINTES — le long de la coulée, dans le sens de la descente (vers l'eau).
  const chemin = couleeDuCoin(map, ground.x, ground.y)
  if (chemin) {
    for (let k = chemin.debut; k < chemin.fin; k += PAS_EMPREINTE) {
      const i = map.coulees![k]!
      const tx = i % width
      const ty = (i - tx) / width
      const j = map.coulees![Math.min(k + 1, chemin.fin - 1)]!
      const jx = j % width
      const jy = (j - jx) / width
      // Un léger jet de côté : des pas de bête, pas des clous plantés au centre.
      const ox = (hash2(graine, i, 0x45) - 0.5) * 0.5
      const oy = (hash2(graine, i, 0x46) - 0.5) * 0.5
      out.push({ x: tx + 0.5 + ox, y: ty + 0.5 + oy, sorte: 'empreinte', cap: octant(jx - tx, jy - ty) })
    }
  }

  // LES FUMÉES — le gagnage se lit au sol, à quelques tuiles du cœur, sol ouvert.
  for (let n = 0; n < FUMEES_PAR_COIN; n++) {
    const ox = (hash2(graine, n, 0x47) * 2 - 1) * 7
    const oy = (hash2(graine, n, 0x48) * 2 - 1) * 7
    const tx = Math.floor(ground.x + ox)
    const ty = Math.floor(ground.y + oy)
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
    const t = terrainAt(map, tx, ty)
    if (!TERRAINS[t]?.walkable || WOOD_TERRAINS.includes(t)) continue
    out.push({ x: tx + 0.5, y: ty + 0.5, sorte: 'fumees' })
  }

  // LES FROTTIS — la lisière du bois le plus proche : un arbre en bord de massif,
  // côté canton. Les candidats se trient par distance au cœur (déterministe).
  const r = FAUNA.GROUND_COVER_NEAR
  const candidats: { tx: number; ty: number; d2: number }[] = []
  const x0 = Math.max(0, Math.floor(ground.x) - r)
  const x1 = Math.min(map.width - 1, Math.floor(ground.x) + r)
  const y0 = Math.max(0, Math.floor(ground.y) - r)
  const y1 = Math.min(map.height - 1, Math.floor(ground.y) + r)
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!WOOD_TERRAINS.includes(terrainAt(map, tx, ty))) continue
      const bord =
        (tx > 0 && !WOOD_TERRAINS.includes(terrainAt(map, tx - 1, ty))) ||
        (tx < map.width - 1 && !WOOD_TERRAINS.includes(terrainAt(map, tx + 1, ty))) ||
        (ty > 0 && !WOOD_TERRAINS.includes(terrainAt(map, tx, ty - 1))) ||
        (ty < map.height - 1 && !WOOD_TERRAINS.includes(terrainAt(map, tx, ty + 1)))
      if (!bord) continue
      const d2 = (ground.x - (tx + 0.5)) * (ground.x - (tx + 0.5)) + (ground.y - (ty + 0.5)) * (ground.y - (ty + 0.5))
      candidats.push({ tx, ty, d2 })
    }
  }
  candidats.sort((a, b) => a.d2 - b.d2 || a.ty * width + a.tx - (b.ty * width + b.tx))
  const pris: { tx: number; ty: number }[] = []
  for (const c of candidats) {
    if (pris.length >= FROTTIS_PAR_COIN) break
    let trop = false
    for (const p of pris) {
      const dx = p.tx - c.tx
      const dy = p.ty - c.ty
      if (dx * dx + dy * dy < FROTTIS_ECART * FROTTIS_ECART) {
        trop = true
        break
      }
    }
    if (trop) continue
    pris.push({ tx: c.tx, ty: c.ty })
    out.push({ x: c.tx + 0.5, y: c.ty + 0.5, sorte: 'frottis' })
  }

  return out
}

/** Les traces de TOUS les coins vivants — à recalculer quand la liste bouge (R27). */
export function tracesDuMonde(map: WorldMap, grounds: readonly { x: number; y: number }[], seed: number): Trace[] {
  const out: Trace[] = []
  for (const g of grounds) out.push(...tracesDuCoin(map, g, seed))
  return out
}
