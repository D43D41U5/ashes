/**
 * LE CHAMP DE COURANT — la SOURCE UNIQUE de « où l'eau va » côté rendu.
 *
 * La worldgen garde le FIL de la rivière (`map.fil`, amont → aval, pas unitaires
 * 4-connexes). Ce module l'élargit en un champ de VECTEURS par tuile d'eau :
 *   1. la TANGENTE LISSÉE du fil (fenêtre ±TANGENTE_FENETRE pas) — les marches de
 *      Manhattan du tracé deviennent des diagonales continues ;
 *   2. la peinture du couloir par PLUS-PROCHE-POINT du fil (min-distance, jamais
 *      dernier-écrit : au méandre serré, deux directions opposées ne se recouvrent
 *      pas en couture franche) ;
 *   3. des passes de moyenne 3×3 sur les tuiles d'EAU seulement, SANS renormaliser —
 *      le vecteur raccourcit au virage (l'eau y ralentit, c'est juste) et EXPIRE en
 *      s'exhalant dans l'eau sans courant (embouchure, lac-perle traversé) au lieu
 *      de tomber en falaise au bord du couloir.
 *
 * Consommateurs : la texture d'eau (canaux G/B du champ de rive → le shader advecte
 * le clapot vers l'aval) et les feuilles qui dérivent (`feuilles-derive.ts`). Les
 * mares, lacs et marais loin du fil n'ont AUCUN courant — leur eau ne va nulle part.
 *
 * Pur : aucun import Phaser — testé headless (`flow-field.test.ts`).
 */
import type { WorldMap } from '@ashes/sim'

/** Les deux terrains d'eau (ids de `TERRAINS`, sim/balance.ts) — même duplication
 *  assumée que feuilles-derive et water-field : fragile si balance renumérote. */
const SHALLOW = 4
const DEEP = 6

/** LA vitesse du courant (tuiles/s) — feuilles ET surface de l'eau la partagent :
 *  une feuille flotte SUR l'eau, elle va exactement aussi vite qu'elle. */
export const COURANT_VITESSE = 0.55

/**
 * Le taper de berge : le courant meurt CONTRE la rive (l'écume et le trait de rive
 * restent ancrés), plein dès TAPER_RIVE_MAX tuiles du bord. Bornes resserrées à 0,7
 * (revue DA) : un goulet d'une tuile de large garde ~70 % de son courant — c'est
 * pile où le joueur traverse, la rivière doit s'y lire. Mêmes bornes dans le shader
 * (interpolées dans le GLSL depuis ces constantes) et pour les feuilles.
 */
export const TAPER_RIVE_MIN = 0.15
export const TAPER_RIVE_MAX = 0.7

/** smoothstep(TAPER_RIVE_MIN, TAPER_RIVE_MAX, d) — la rampe CPU, identique au GPU. */
export function taperRive(d: number): number {
  const t = Math.min(1, Math.max(0, (d - TAPER_RIVE_MIN) / (TAPER_RIVE_MAX - TAPER_RIVE_MIN)))
  return t * t * (3 - 2 * t)
}

/** Demi-largeur du couloir de courant autour du fil — la demi-largeur du lit de la
 *  worldgen (EAU.RIVIERE_DEMI_LIT = 3). */
const DEMI_LIT = 3
/** Passes de moyenne 3×3 : lissent les coutures ET exhalent le courant sur ~PASSES
 *  tuiles au-delà du couloir, en expirant. */
const PASSES = 3
/** Fenêtre (en pas de fil) de la tangente lissée. */
const TANGENTE_FENETRE = 6
/** L'expiration par passe du courant né HORS du couloir (l'exhalaison de l'embouchure). */
const EXPIRATION = 0.6
/** Sous cette norme, le vecteur n'est pas gardé — le champ reste creux. */
const EPSILON = 0.02

export interface FlowField {
  /** index de tuile → vecteur courant (norme ≤ 1, aval). Creux : pas d'entrée = pas de courant. */
  courant: Map<number, { x: number; y: number }>
  width: number
  height: number
}

/** Le vecteur courant à une position (tuiles) — lecture par tuile, `null` hors courant. */
export function flowAt(field: FlowField, x: number, y: number): { x: number; y: number } | null {
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) return null
  return field.courant.get(Math.floor(y) * field.width + Math.floor(x)) ?? null
}

/** Bâtit le champ depuis `map.fil`. `null` si la carte n'a pas de rivière. */
export function buildFlowField(map: Pick<WorldMap, 'width' | 'height' | 'terrain' | 'fil'>): FlowField | null {
  const fil = map.fil
  if (!fil || fil.length < 2) return null
  const { width, height, terrain } = map
  const eau = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false
    const t = terrain[ty * width + tx]
    return t === SHALLOW || t === DEEP
  }

  // ── 1. Les tangentes lissées, une par point du fil ──
  const n = fil.length
  const tangX = new Float32Array(n)
  const tangY = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = fil[Math.max(0, i - TANGENTE_FENETRE)]!
    const b = fil[Math.min(n - 1, i + TANGENTE_FENETRE)]!
    const ax = a % width
    const bx = b % width
    const dx = bx - ax
    const dy = (b - bx) / width - (a - ax) / width
    const norme = Math.sqrt(dx * dx + dy * dy) || 1
    tangX[i] = dx / norme
    tangY[i] = dy / norme
  }

  // ── 2. La peinture par plus-proche-point : chaque tuile d'eau du couloir prend la
  // tangente du point de fil le plus proche (distance euclidienne au carré — un
  // dernier-écrit mettrait une couture franche à chaque méandre). Les tuiles jusqu'à
  // DEMI_LIT + PASSES sont enrôlées comme CANDIDATES du lissage (l'exhalaison). ──
  const RAYON_CANDIDAT = DEMI_LIT + PASSES
  const meilleure = new Map<number, { d2: number; i: number }>()
  const candidates = new Set<number>()
  for (let i = 0; i < n; i++) {
    const p = fil[i]!
    const px = p % width
    const py = (p - px) / width
    for (let oy = -RAYON_CANDIDAT; oy <= RAYON_CANDIDAT; oy++) {
      for (let ox = -RAYON_CANDIDAT; ox <= RAYON_CANDIDAT; ox++) {
        const tx = px + ox
        const ty = py + oy
        if (!eau(tx, ty)) continue // un index de fil peut être SEC (peinture sautée) — on revalide
        const j = ty * width + tx
        candidates.add(j)
        if (Math.max(Math.abs(ox), Math.abs(oy)) > DEMI_LIT) continue
        const d2 = ox * ox + oy * oy
        const m = meilleure.get(j)
        if (!m || d2 < m.d2) meilleure.set(j, { d2, i })
      }
    }
  }
  if (meilleure.size === 0) return null
  let courant = new Map<number, { x: number; y: number }>()
  for (const [j, m] of meilleure) courant.set(j, { x: tangX[m.i]!, y: tangY[m.i]! })

  // ── 3. Les passes de moyenne 3×3 — eau seulement au dénominateur (la berge ne tire
  // pas le vecteur), l'eau sans courant compte pour zéro (le champ y expire). ──
  for (let p = 0; p < PASSES; p++) {
    const prochain = new Map<number, { x: number; y: number }>()
    for (const j of candidates) {
      const tx = j % width
      const ty = (j - tx) / width
      let sx = 0
      let sy = 0
      let cnt = 0
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const vx = tx + ox
          const vy = ty + oy
          if (!eau(vx, vy)) continue
          const v = courant.get(vy * width + vx)
          if (v) {
            sx += v.x
            sy += v.y
          }
          cnt++
        }
      }
      if (cnt === 0) continue
      let x = sx / cnt
      let y = sy / cnt
      if (!meilleure.has(j)) {
        x *= EXPIRATION
        y *= EXPIRATION
      }
      if (x * x + y * y > EPSILON * EPSILON) prochain.set(j, { x, y })
    }
    courant = prochain
  }

  return { courant, width, height }
}
