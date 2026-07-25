/**
 * LES SENTES DU PAYS D'AVANT — les routes de la Racine (spec t0-exploration R17-R18).
 *
 * Le pré n'est pas vierge : on y vivait, on guettait le sud, on est partis. Les sentes en
 * sont la trace praticable : des polylignes Manhattan de terrain `road` (id 2, ×1,25 — la
 * valeur que la table portait depuis toujours sans qu'aucune carte ne s'en serve), qui
 * relient CHAQUE seuil de la Racine à un carrefour central. La route est un choix, pas un
 * rail : plus rapide, plus exposée — Rust l'a montré, la route FABRIQUE les rencontres.
 *
 * ═══ LE GUÉ NAÎT DU CROISEMENT ═══
 *
 * Là où une sente rencontre le CŒUR profond de la rivière, elle ne s'arrête pas : elle le
 * REND FRANCHISSABLE — le profond redevient haut-fond sur la largeur du passage (R7). C'est
 * le croisement qui crée le gué, pas l'inverse ; et s'il en manque (aucune sente ne croise),
 * on en force aux tiers du cours — la rivière n'a JAMAIS le droit d'être un goulot (R5,
 * worldgen R11bis : l'eau profonde est un mur, un mur sans porte coupe la zone en deux).
 *
 * Rien ne pousse sur une sente (R18) : `zone-content` exclut le terrain `road` de tous ses
 * semis, comme il exclut les rampes. Une route à buissons est une pelouse rayée.
 *
 * Pur et déterministe : `hash2`, `+ - * / abs sign min max floor round` (invariant n°2).
 */
import { TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER } from './balance'
import { hash2 } from './noise'
import type { Riviere } from './zonegen-water'
import type { GrapheZones } from './zonegraph'

export const SENTES = {
  /** Demi-largeur d'une sente. 1 → 3 tuiles : deux charrettes se croisent, à peine. */
  DEMI: 1,
  /** Longueur d'un tronçon droit avant d'envisager un coude (marches Manhattan, comme l'eau). */
  TRONCON: 24,
  /** La bouche d'un seuil : à combien de pas du point de seuil, DANS la Racine, la sente prend. */
  BOUCHE: 26,
  /** Demi-longueur d'un gué le long du cœur de la rivière (en tuiles de cœur converties). */
  GUE_DEMI: 3,
  /** Nombre minimal de gués sur la rivière — forcés aux tiers si les croisements n'ont pas payé. */
  GUES_MIN: 2,
  /** Deux gués à moins de N tuiles ne comptent que pour un (dédoublonnage des toponymes). */
  GUE_ECART: 24,
} as const

export interface Gue {
  x: number
  y: number
}

/**
 * Trace les sentes de la Racine et perce les gués. Rend les gués (pour leurs toponymes).
 *
 * À appeler APRÈS l'eau (les sentes doivent savoir où est le cœur profond) et AVANT le
 * percement des seuils (les bouches se calculent depuis le graphe, pas depuis les couloirs —
 * et le couloir, percé ensuite, marquera `rampe` ses tuiles, sente comprise : un seuil ne
 * nourrit rien, la règle tient déjà).
 */
export function tracerLesSentes(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
  riviere: Riviere | null,
  setPieces: readonly { x: number; y: number; w: number; h: number }[] = [],
): Gue[] {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return []
  const sel = (seed ^ 0x53454e54) | 0 /* 'SENT' */
  const gues: Gue[] = []

  const marchable = (i: number): boolean => TERRAINS[terrain[i]!]?.walkable === true

  // UN LIEU SE POSTE AU BORD DU CHEMIN, PAS DESSOUS (R18) — et un set-piece encore moins :
  // mesuré par la revue, la première écriture pavait 72 tuiles de route À TRAVERS le Cercle
  // de pierres (et rayait le Bois Noir et la Combe sur cinq seeds sur neuf). La route les
  // CONTOURNE : leur rect (+1 de marge) est un obstacle du tracé, au même titre qu'un lac.
  const dansSetPiece = (x: number, y: number): boolean =>
    setPieces.some((p) => x >= p.x - 1 && x < p.x + p.w + 1 && y >= p.y - 1 && y < p.y + p.h + 1)

  // ── LE CARREFOUR : le point de la Racine où toutes les sentes convergent ──
  // Le centre du rectangle, rabattu sur la première tuile de terre ferme trouvée en spirale
  // de motifs (déterministe). Un carrefour dans un lac ne serait pas un carrefour — ni dans
  // un set-piece.
  const sec = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    if (dansSetPiece(x, y)) return false
    const i = y * width + x
    if (zone[i] !== racineId || !marchable(i)) return false
    const t = terrain[i]!
    return t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER
  }
  let hubX = Math.round(r.x + r.w / 2)
  let hubY = Math.round(r.y + r.h / 2)
  if (!sec(hubX, hubY)) {
    let trouve = false
    for (let rayon = 8; rayon <= 240 && !trouve; rayon += 8) {
      for (let k = 0; k < 16 && !trouve; k++) {
        const x = hubX + Math.round((hash2(rayon, k * 2, sel) * 2 - 1) * rayon)
        const y = hubY + Math.round((hash2(rayon, k * 2 + 1, sel) * 2 - 1) * rayon)
        if (sec(x, y)) { hubX = x; hubY = y; trouve = true }
      }
    }
    if (!trouve) return [] // une Racine sans un seul carré de terre sèche au centre : on renonce
  }

  // ── LES BOUCHES : un départ de sente par seuil de la Racine ──
  const bouches: { x: number; y: number }[] = []
  for (const s of g.seuils) {
    if (s.a !== racineId && s.b !== racineId) continue
    const versRacine = s.a === racineId ? -1 : 1
    const ix = s.ax * versRacine
    const iy = s.ay * versRacine
    let px = -1
    let py = -1
    for (let k = SENTES.BOUCHE; k < SENTES.BOUCHE + 40; k++) {
      const x = s.x + ix * k
      const y = s.y + iy * k
      if (x < 0 || y < 0 || x >= width || y >= height) break
      const i = y * width + x
      if (zone[i] === racineId && marchable(i)) { px = x; py = y; break }
    }
    if (px >= 0) bouches.push({ x: px, y: py })
  }
  if (bouches.length === 0) return []

  // ── LE TRACÉ : bouche → carrefour, en marches de Manhattan qui ESQUIVENT les lacs ──
  const peindre = (cx: number, cy: number, horiz: boolean): void => {
    for (let w = -SENTES.DEMI; w <= SENTES.DEMI; w++) {
      const x = horiz ? cx : cx + w
      const y = horiz ? cy + w : cy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = y * width + x
      if (zone[i] !== racineId || !marchable(i)) continue
      const t = terrain[i]!
      // L'eau ne se pave pas : une sente TRAVERSE l'eau peu profonde (le pas ralentit, c'est
      // le prix du gué) et son terrain reste de l'eau. Seule la terre ferme devient route.
      if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) continue
      terrain[i] = TERRAIN_ROAD
    }
  }

  /** Le prochain pas depuis (px,py) vers (tx,ty) rencontre-t-il un obstacle infranchissable ?
   *  Le cœur de la RIVIÈRE ne compte pas : on le perce (c'est le gué). Un cœur de LAC, si —
   *  et un SET-PIECE aussi : la route les contourne. */
  const bloque = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true
    if (dansSetPiece(x, y)) return true
    const i = y * width + x
    if (terrain[i] !== TERRAIN_DEEP_WATER) return false
    return !(riviere?.coeur.has(i) ?? false)
  }

  const percerGue = (x: number, y: number): void => {
    if (riviere && percerLeCoeur(terrain, riviere, x, y, width, height) > 0
      && gues.every((q) => Math.abs(q.x - x) + Math.abs(q.y - y) >= SENTES.GUE_ECART)) {
      gues.push({ x, y })
    }
  }

  for (let b = 0; b < bouches.length; b++) {
    let px = bouches[b]!.x
    let py = bouches[b]!.y
    peindre(px, py, true)
    peindre(px, py, false)
    let garde = 0
    const gardeMax = 2 * (width + height)
    while ((px !== hubX || py !== hubY) && garde < gardeMax) {
      const dx = hubX - px
      const dy = hubY - py
      let horiz = Math.abs(dx) >= Math.abs(dy)
      let step = horiz ? Math.sign(dx) : Math.sign(dy)
      // L'ESQUIVE : si l'axe naturel bute sur un cœur de lac, on tente l'autre axe ; si les
      // deux butent, on fait un pas de côté FRANC (déterministe) le long de l'autre axe.
      const nx = (h: boolean, s2: number): number => (h ? px + s2 : px)
      const ny = (h: boolean, s2: number): number => (h ? py : py + s2)
      if (bloque(nx(horiz, step), ny(horiz, step))) {
        const autre = !horiz
        const stepAutre = (autre ? Math.sign(dy) : Math.sign(dx)) || (hash2(px, py, sel) < 0.5 ? -1 : 1)
        if (!bloque(nx(autre, stepAutre), ny(autre, stepAutre))) {
          horiz = autre
          step = stepAutre
        } else {
          // Cul-de-sac local : pas de côté forcé, dans le sens qui vient du hash (stable).
          horiz = autre
          step = hash2(px + 7, py + 3, sel) < 0.5 ? -1 : 1
        }
      }
      const troncon = Math.max(1, Math.min(SENTES.TRONCON, horiz ? Math.abs(dx) : Math.abs(dy)))
      for (let t = 0; t < troncon; t++) {
        const sx = horiz ? px + step : px
        const sy = horiz ? py : py + step
        if (bloque(sx, sy)) break // le lac est devant : on replanifie au tour suivant
        px = sx
        py = sy
        const i = py * width + px
        // LE GUÉ : le pas tombe sur le cœur de la rivière → on le perce et on continue.
        if (terrain[i] === TERRAIN_DEEP_WATER && (riviere?.coeur.has(i) ?? false)) {
          percerGue(px, py)
        }
        peindre(px, py, horiz)
        garde++
      }
      garde++
    }
  }

  return gues
}

/**
 * Convertit le cœur profond de la rivière en haut-fond autour de (x,y). Rend le NOMBRE de
 * tuiles converties — zéro veut dire « il n'y avait rien à percer ici » (un lac-perle, une
 * portion déjà ouverte), et un gué qui n'a rien percé n'est PAS un gué : la première écriture
 * enregistrait le toponyme sans condition, et la seed du jeu affichait « le Gué » sur de l'eau
 * infranchissable (mesuré par la revue — un gué fantôme).
 */
function percerLeCoeur(
  terrain: number[],
  riviere: Riviere,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let converti = 0
  for (let dy = -SENTES.GUE_DEMI; dy <= SENTES.GUE_DEMI; dy++) {
    for (let dx = -SENTES.GUE_DEMI; dx <= SENTES.GUE_DEMI; dx++) {
      const gx = x + dx
      const gy = y + dy
      if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue // pas de wrap de ligne
      const i = gy * width + gx
      if (riviere.coeur.has(i) && terrain[i] === TERRAIN_DEEP_WATER) {
        terrain[i] = TERRAIN_SHALLOW_WATER
        converti++
      }
    }
  }
  return converti
}

/**
 * ═══ LES GUÉS FORCÉS — la rivière n'est JAMAIS un goulot (R7), et la garantie vit ICI ═══
 *
 * Hors de `tracerLesSentes`, et c'est le point (revue du 2026-07-25) : la première écriture
 * forçait ses gués À L'INTÉRIEUR du traceur, APRÈS ses sorties anticipées — une Racine sans
 * carrefour trouvable rendait zéro sente ET zéro gué, rivière pourtant valide. Ici, on ne
 * dépend de rien : tant qu'il manque des gués, on balaie les positions du FIL dont le
 * voisinage porte du cœur ENCORE PROFOND (jamais un lac-perle : `percerLeCoeur` rend zéro et
 * on passe), aux fractions les plus étalées d'abord. Un gué ne compte que s'il a VRAIMENT
 * percé — le compte rendu est le compte vrai.
 */
export function forcerLesGues(
  terrain: number[],
  riviere: Riviere | null,
  gues: Gue[],
  width: number,
  height: number,
): void {
  if (!riviere || riviere.fil.length === 0) return
  // Les fractions du cours, de la plus structurante à la plus fine : tiers, puis quarts, etc.
  const fractions: number[] = []
  for (let den = 3; den <= 9 && fractions.length < 24; den++) {
    for (let num = 1; num < den; num++) fractions.push(num / den)
  }
  for (const f of fractions) {
    if (gues.length >= SENTES.GUES_MIN) return
    const k = Math.round(f * (riviere.fil.length - 1))
    const i = riviere.fil[k]!
    const x = i % width
    const y = (i - x) / width
    if (percerLeCoeur(terrain, riviere, x, y, width, height) === 0) continue
    if (gues.every((q) => Math.abs(q.x - x) + Math.abs(q.y - y) >= SENTES.GUE_ECART)) {
      gues.push({ x, y })
    }
  }
}
