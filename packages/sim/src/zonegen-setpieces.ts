/**
 * LES SET-PIECES DE LA RACINE — des ENDROITS, pas des timbres (spec t0-exploration R9-R12).
 *
 * Le grief qu'on répare : les lieux de la Racine font 2 à 4 tuiles d'empreinte — on ne peut
 * pas ENTRER dedans, donc ils ne produisent aucune émotion. Don't Starve le fait depuis dix
 * ans : par carte, quelques morceaux de bravoure à grande empreinte, nommés, garantis — le
 * garanti structure la mémoire de la carte (« on campe au Bois Noir »).
 *
 * Trois, un de chaque, et leur corps est leur TERRAIN (aucun sprite-centre : le sol parle) :
 *
 *   • le BOIS NOIR — une mini-sylve (sol `old_growth`) : sombre, dense, trouée de clairières
 *     par les règles existantes. Il murmure ce que la Vieille Sylve promet — et il porte UN
 *     vieil arbre au stock dérisoire (le patron du Filon : « le gros bois existe. Pas ici. »).
 *   • le CERCLE DE PIERRES — une couronne de pierres levées sur la fleuraie. La destination
 *     de la chaîne des menhirs (les pierres se répondent — R2) ; sa charge est un RÉCIT.
 *   • la COMBE BRUMEUSE — un creux de marais et de roselière autour d'une mare. Champignons
 *     et fibre y abondent PAR LES RÈGLES EXISTANTES d'admission de terrain, pas par une
 *     table neuve — on peint le sol, le contenu suit.
 *
 * Le placement est un tirage par rejet, salé, positionnel : au cœur de la zone (marge aux
 * frontières — l'eau et les seuils vivent aux bords), hors de l'eau, hors de la lisière sud
 * (le gradient a son propre langage), écartés entre eux. LE CERCLE VA AU NORD : le front de
 * cendre mangera ~60 % du sud de la Racine (worldgen R29) — le bout de la chaîne des pierres
 * doit survivre à la saison, sinon les joueurs de fin de saison suivent des menhirs vers un
 * trou de cendre. Le Bois Noir et la Combe, eux, sont PERDABLES — et c'est voulu : regarder
 * la cendre avaler un endroit qu'on aimait, c'est la saison qui raconte.
 *
 * Pur et déterministe : `hash2`, arithmétique entière (invariant n°2).
 */
import { TERRAINS, TERRAIN_FLOWER_MEADOW, TERRAIN_MARSH, TERRAIN_OLD_GROWTH, TERRAIN_REED_MARSH, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER } from './balance'
import { isWater } from './map'
import { hash2 } from './noise'
import type { GrapheZones } from './zonegraph'

export const SET_PIECES = {
  /** Dimensions, en tuiles — quantifiées au motif de 8, comme toute forme de carte (R32). */
  BOIS: { w: 48, h: 40 },
  CERCLE: { w: 24, h: 24 },
  COMBE: { w: 40, h: 32 },
  /** Marge aux bords du rectangle de la Racine : un set-piece vit au cœur, pas au mur. */
  MARGE: 24,
  /** Écart minimal entre deux set-pieces — deux morceaux de bravoure ne se marchent pas dessus. */
  ECART_MIN: 200,
  /** La lisière sud (le gradient vers la Cendrière) reste à elle : aucun set-piece à moins de
   *  N tuiles du bord sud de la Racine. */
  EVITE_SUD: 70,
  /** Le Cercle vit dans la part de la Racine qui SURVIT à la saison (le nord). */
  CERCLE_NORD_FRAC: 0.38,
  /** Tentatives de rejet par set-piece. */
  ESSAIS: 120,
  /** La mare de la Combe, en demi-étendues. */
  MARE: { hw: 6, hh: 4 },
} as const

export interface SetPiece {
  kind: 'bois_noir' | 'cercle_pierres' | 'combe_brumeuse'
  nom: string
  x: number
  y: number
  w: number
  h: number
}

/** Pose les trois set-pieces (terrain EN PLACE) et rend leurs zones à enregistrer. */
export function placerLesSetPieces(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
): SetPiece[] {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return []
  const sel = (seed ^ 0x53455450) | 0 /* 'SETP' */
  const out: SetPiece[] = []

  // Un rectangle est posable si TOUTES ses tuiles sont de la Racine, marchables, sèches et
  // sans route — un set-piece ne s'assied ni sur un lac, ni sur la rivière, ni sur un mur.
  const posable = (x0: number, y0: number, w: number, h: number): boolean => {
    if (x0 < r.x + SET_PIECES.MARGE || y0 < r.y + SET_PIECES.MARGE) return false
    if (x0 + w > r.x + r.w - SET_PIECES.MARGE || y0 + h > r.y + r.h - SET_PIECES.MARGE) return false
    if (r.y + r.h - (y0 + h) < SET_PIECES.EVITE_SUD) return false // la lisière sud reste à elle
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = y * width + x
        if (zone[i] !== racineId) return false
        const t = terrain[i]!
        if (!TERRAINS[t]?.walkable) return false
        if (isWater(t) || t === TERRAIN_ROAD) return false
      }
    }
    return out.every((p) => {
      const dx = Math.abs(p.x + p.w / 2 - (x0 + w / 2))
      const dy = Math.abs(p.y + p.h / 2 - (y0 + h / 2))
      return dx + dy >= SET_PIECES.ECART_MIN
    })
  }

  const q = (v: number): number => Math.round(v / 8) * 8 // le motif : toute forme s'y aligne

  const tirer = (
    kind: SetPiece['kind'],
    nom: string,
    dims: { w: number; h: number },
    salt: number,
    nordFrac?: number,
  ): SetPiece | null => {
    for (let essai = 0; essai < SET_PIECES.ESSAIS; essai++) {
      const maxY = nordFrac !== undefined ? r.y + nordFrac * r.h - dims.h : r.y + r.h - dims.h
      const x0 = q(r.x + hash2(essai, salt, sel) * (r.w - dims.w))
      const y0 = q(r.y + hash2(essai, salt + 1, sel) * Math.max(1, maxY - r.y))
      if (!posable(x0, y0, dims.w, dims.h)) continue
      return { kind, nom, x: x0, y: y0, w: dims.w, h: dims.h }
    }
    return null // une Racine trop pleine d'eau peut refuser — la garde A19 le dira
  }

  // ── LE BOIS NOIR : le sol devient vieille futaie ; les arbres suivront (zone-content) ──
  const bois = tirer('bois_noir', 'le Bois Noir', SET_PIECES.BOIS, 10)
  if (bois) {
    out.push(bois)
    for (let y = bois.y; y < bois.y + bois.h; y++) {
      for (let x = bois.x; x < bois.x + bois.w; x++) {
        terrain[y * width + x] = TERRAIN_OLD_GROWTH
      }
    }
  }

  // ── LE CERCLE DE PIERRES : la fleuraie — les pierres elles-mêmes sont un décor client,
  //    dérivé du rect (déterministe des deux côtés sans une donnée de plus). ──
  const cercle = tirer('cercle_pierres', 'le Cercle de pierres', SET_PIECES.CERCLE, 20, SET_PIECES.CERCLE_NORD_FRAC)
  if (cercle) {
    out.push(cercle)
    for (let y = cercle.y; y < cercle.y + cercle.h; y++) {
      for (let x = cercle.x; x < cercle.x + cercle.w; x++) {
        terrain[y * width + x] = TERRAIN_FLOWER_MEADOW
      }
    }
  }

  // ── LA COMBE BRUMEUSE : anneaux rectilignes — marais, roselière, marais, et la mare. ──
  const combe = tirer('combe_brumeuse', 'la Combe brumeuse', SET_PIECES.COMBE, 30)
  if (combe) {
    out.push(combe)
    for (let y = combe.y; y < combe.y + combe.h; y++) {
      for (let x = combe.x; x < combe.x + combe.w; x++) {
        const d = Math.min(x - combe.x, combe.x + combe.w - 1 - x, y - combe.y, combe.y + combe.h - 1 - y)
        terrain[y * width + x] = d < 4 ? TERRAIN_MARSH : d < 10 ? TERRAIN_REED_MARSH : TERRAIN_MARSH
      }
    }
    const cx = combe.x + combe.w / 2
    const cy = combe.y + combe.h / 2
    for (let y = cy - SET_PIECES.MARE.hh; y <= cy + SET_PIECES.MARE.hh; y++) {
      for (let x = cx - SET_PIECES.MARE.hw; x <= cx + SET_PIECES.MARE.hw; x++) {
        terrain[y * width + x] = TERRAIN_SHALLOW_WATER
      }
    }
  }

  return out
}
