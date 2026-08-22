/**
 * LE MANTEAU — la neige au sol et la glace, cuites EN PAVÉS (spec `sol-dessine.md` R16).
 *
 * La neige était une trame de cellules de 4 px, à 91 % d'opacité : on voyait le sol au
 * travers, et elle n'avait pas d'ÉPAISSEUR — un voile, pas une couche. Alexis (2026-08-22) :
 * « la neige devrait être complètement opaque » et « on devrait avoir un peu de hauteur sur
 * la neige, le même type d'effet qu'entre prairie et flower_meadow (liseré + ombre) ».
 *
 * La neige est donc un PAVÉ de `paves.ts`, comme l'herbe sur la litière : frange irrégulière
 * de 2-5 px qui déborde sur le sol nu, liseré sombre sur ses bords bas et latéraux, arête
 * haute claire, ombre portée sur ce qu'elle domine. Opaque par construction. Et la glace est
 * une SURFACE (R13 : pas d'épaisseur), opaque elle aussi, sur laquelle la neige déborde.
 *
 * ═══ UNE TUILE EST NUE, POUDREUSE OU JUSQU'AUX GENOUX (gel.md G9) ═══
 *
 * `neigeAuSol` rend une couverture continue dans [0, 1] ; un pavé n'a pas de demi-mesure. Le
 * NIVEAU d'une tuile est une loi de la sim (`niveauPourCouverture` : un seuil positionnel par
 * tuile, des plaques à l'échelle de quelques tuiles, la profonde au cœur des plaques) — la même
 * qui ralentit le pas. Ici on ne fait que la peindre : la poudreuse est un pavé sur le sol nu,
 * la profonde un pavé sur la poudreuse, avec la même frontière (frange, liseré, ombre).
 *
 * ═══ LA NEIGE NE COUVRE PAS LA GLACE ═══
 *
 * G5 (`gel.md`) : « on ne s'engage jamais sur la glace par surprise », et dans les deux sens —
 * la glace doit se VOIR. La trame plafonnait la neige à la moitié d'une tuile de glace ; le
 * pavé tranche : la glace ne porte pas de neige, le manteau s'arrête à la berge et déborde
 * sur la glace d'une frange avec son ombre — le lac gelé reste une forme lisible, bordée.
 *
 * ═══ CE QUI SE DESSINE OÙ ═══
 *
 * `cuireChunk` rend deux images. Le SOL de la couche : les corps de neige (opaques) et la
 * glace (opaque). Le SURPLOMB : ce que la neige pose SUR une tuile qui n'est pas à elle —
 * sa frange (opaque) et son ombre (un voile noir) sur le sol nu ou sur la glace. Le sol de la
 * couche se pose SOUS le surplomb de la berge (`pave-layer.ts`, +0,29) pour que la berge
 * garde sa frange, son liseré et son ombre sur la glace ; le surplomb du manteau se pose
 * AU-DESSUS, parce que la neige est sur la terre qui est sur l'eau.
 *
 * Pur : testé en Node (`manteau.test.ts`).
 */
import { NEIGE_GENOUX, NEIGE_POUDREUSE, hash2, type NiveauDeNeige } from '@ashes/sim'
import { GRAIN_CELLS } from './grain-sol'
import { cuireChunk, DESSOUS, GLACE_GUE, GLACE_LAC, MANTEAU, MANTEAU_PROFOND, type ChunkCuit } from './paves'

/** Réglages du manteau — ce qui se règle en REGARDANT (da-feeling), pas en jouant. Le SEUIL
 *  d'une tuile et sa distribution, eux, commandent le pas : ils vivent dans `GEL` (`balance.ts`,
 *  `niveauPourCouverture`) — une seule loi pour ce qu'on voit et ce qui ralentit. */
export const NEIGE_PAVE = {
  /** Les teintes, 0xRRGGBB. La poudreuse : blanche à peine bleutée. La profonde : un rien plus
   *  claire et plus froide — c'est son liseré et son ombre qui disent la marche, pas sa teinte.
   *  Le gué gelé : bleu clair, nettement plus bleu que la neige à côté. Le lac gelé : plus
   *  sombre et plus bleu — de la glace sur du noir, celle qui vaut une décision (elle rend
   *  praticable ce qui bloquait). */
  NEIGE: 0xe9eff9,
  NEIGE_PROFONDE: 0xf1f5fd,
  GLACE_GUE: 0xa8cde4,
  GLACE_LAC: 0x7098be,
  /** Le givre de la glace : une cellule de 4 px sur cinq, plus claire — sans lui un aplat lit
   *  « trou dans le rendu » plutôt que « surface gelée ». */
  GIVRE: 1.3,
  GIVRE_PART: 0.2,
} as const

/** L'état d'une tuile vu du manteau. Les niveaux de neige sont ceux de la sim (gel.md G9). */
export const TUILE_NUE = 0
export const TUILE_NEIGE = 1 // = NEIGE_POUDREUSE
export const TUILE_NEIGE_PROFONDE = 2 // = NEIGE_GENOUX
export const TUILE_GLACE_GUE = 3
export const TUILE_GLACE_LAC = 4
/** Falaise, mur, vide : le manteau ne s'y dessine pas et ne déborde pas dessus (R10). */
export const TUILE_STRUCTURELLE = -1
export type EtatTuile = -1 | 0 | 1 | 2 | 3 | 4

/** L'état d'une tuile de terre depuis son niveau de neige (la sim). */
export function tuileDeNiveau(niveau: NiveauDeNeige): EtatTuile {
  return niveau === NEIGE_GENOUX ? TUILE_NEIGE_PROFONDE : niveau === NEIGE_POUDREUSE ? TUILE_NEIGE : TUILE_NUE
}

/** Sous la neige, poudreuse ou profonde. */
export function estNeige(etat: EtatTuile): boolean {
  return etat === TUILE_NEIGE || etat === TUILE_NEIGE_PROFONDE
}

/** Le terrain virtuel de `paves.ts` pour un état de tuile. */
export function terrainDuManteau(etat: EtatTuile): number {
  switch (etat) {
    case TUILE_NEIGE: return MANTEAU
    case TUILE_NEIGE_PROFONDE: return MANTEAU_PROFOND
    case TUILE_GLACE_GUE: return GLACE_GUE
    case TUILE_GLACE_LAC: return GLACE_LAC
    case TUILE_STRUCTURELLE: return 0 // void : structurel
    default: return DESSOUS
  }
}

/** La couleur d'un terrain virtuel du manteau (le dessous n'en a pas : il est transparent). */
export function couleurDuManteau(t: number): number {
  if (t === MANTEAU) return NEIGE_PAVE.NEIGE
  if (t === MANTEAU_PROFOND) return NEIGE_PAVE.NEIGE_PROFONDE
  if (t === GLACE_GUE) return NEIGE_PAVE.GLACE_GUE
  if (t === GLACE_LAC) return NEIGE_PAVE.GLACE_LAC
  return 0
}

/** La trame de la glace : le givre, une cellule sur cinq, positionnel. `GRAIN_CELLS²` facteurs. */
export function trameDeGlace(): Float32Array {
  const trame = new Float32Array(GRAIN_CELLS * GRAIN_CELLS)
  for (let cy = 0; cy < GRAIN_CELLS; cy++) {
    for (let cx = 0; cx < GRAIN_CELLS; cx++) {
      trame[cy * GRAIN_CELLS + cx] = hash2(cx + 7919, cy + 104_729, 0x61e) < NEIGE_PAVE.GIVRE_PART ? NEIGE_PAVE.GIVRE : 1
    }
  }
  return trame
}

export interface CuissonManteau {
  cx: number
  cy: number
  /** L'état d'une tuile (coordonnées carte) — hors carte : structurelle. */
  etatAt: (tx: number, ty: number) => EtatTuile
  /** La trame de la neige (famille `neige` de `grain-sol`) et celle de la glace. */
  trameNeige: Float32Array | null
  trameGlace: Float32Array
}

/** Cuit un chunk du manteau : le sol (neige, glace) et le surplomb (frange et ombre de la
 *  neige sur le dessous et sur la glace). Même maille, mêmes chunks que le sol. */
export function cuireManteau(p: CuissonManteau): ChunkCuit {
  return cuireChunk({
    cx: p.cx,
    cy: p.cy,
    terrainAt: (tx, ty) => terrainDuManteau(p.etatAt(tx, ty)),
    couleurAt: (tx, ty) => couleurDuManteau(terrainDuManteau(p.etatAt(tx, ty))),
    trameDe: (t) => (t === MANTEAU || t === MANTEAU_PROFOND ? p.trameNeige : t === GLACE_GUE || t === GLACE_LAC ? p.trameGlace : null),
  })
}
