/**
 * LA GRILLE DE LA GI, LUE DANS LA SIM — le raster des occludeurs d'une fenêtre de tuiles vient de
 * `occlusionAuGrain` (`packages/sim/src/lumiere.ts`, LG-R11 : un seul prédicat d'occultation, dans
 * `/sim`, dont l'écran DÉRIVE). Ici on ne décide de rien : on traduit les sortes en opaque/libre, et on
 * leur donne un albédo (un fait de rendu, `reglages.ts`).
 */
import { OCCLUDEUR, occlusionAuGrain, terrainAEtage, type MondeEclaire } from '@ashes/sim'
import { TILE_PX } from '../framing'
import { ALBEDO, hauteurDeBande, type Albedo } from './reglages'
import type { BandeGrille, GrilleGi } from './champ-ref'

/** Une fenêtre de tuiles, bornes incluses. */
export interface Fenetre {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** La grille au grain de la fenêtre, à l'étage `niveau`, avec l'origine du raster en texels absolus. */
export function grilleDuMonde(monde: MondeEclaire, niveau: number, f: Fenetre): GrilleGi & { readonly ox: number; readonly oy: number } {
  const o = occlusionAuGrain(monde, niveau, f.x0, f.y0, f.x1, f.y1)
  const T = o.gw / (f.x1 - f.x0 + 1)
  const n = o.gw * o.gh
  const occ = new Uint8Array(n)
  const albedo = new Float32Array(n * 3)
  const poser = (k: number, alb: Albedo) => {
    occ[k] = 1
    albedo[k * 3] = alb[0]
    albedo[k * 3 + 1] = alb[1]
    albedo[k * 3 + 2] = alb[2]
  }
  // Tuile par tuile (C6, LG-A14) : l'albédo d'un terrain plein se lit UNE fois par tuile, pas à
  // chacun de ses seize texels — `terrainAEtage` coûtait à chaque texel de roche.
  const tuilesW = f.x1 - f.x0 + 1
  const tuilesH = f.y1 - f.y0 + 1
  for (let ty = 0; ty < tuilesH; ty++)
    for (let tx = 0; tx < tuilesW; tx++) {
      let albTerrain: Albedo | null = null
      for (let sy = 0; sy < T; sy++) {
        const rang = (ty * T + sy) * o.gw + tx * T
        for (let sx = 0; sx < T; sx++) {
          const k = rang + sx
          const sorte = o.sortes[k]
          if (sorte === OCCLUDEUR.LIBRE) continue
          if (sorte === OCCLUDEUR.TERRAIN) {
            if (albTerrain === null) albTerrain = ALBEDO.TERRAIN[terrainAEtage(monde.map, niveau, f.x0 + tx, f.y0 + ty)] ?? ALBEDO.TERRAIN_DEFAUT
            poser(k, albTerrain)
          } else if (sorte === OCCLUDEUR.TRONC) poser(k, ALBEDO.TRONC)
          else if (sorte === OCCLUDEUR.NOEUD) poser(k, ALBEDO.NOEUD)
          else poser(k, ALBEDO.BATI_DEFAUT)
        }
      }
    }
  const murs: BandeGrille[] = []
  const albedoMurs: Albedo[] = []
  // La hauteur d'une bande, en texels : ce qu'elle lance comme ombre d'astre (LG-R9, `hauteurDeBande`).
  const pxParTexel = TILE_PX / T
  for (const b of o.bandes) {
    murs.push({ x0: b.x0 - o.ox, x1: b.x1 - o.ox, y0: b.y0 - o.oy, y1: b.y1 - o.oy, hauteur: hauteurDeBande(b.type) / pxParTexel })
    albedoMurs.push(ALBEDO.BATI[b.type] ?? ALBEDO.BATI_DEFAUT)
  }
  return { gw: o.gw, gh: o.gh, occ, murs, albedo, albedoMurs, ox: o.ox, oy: o.oy }
}
