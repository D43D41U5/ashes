/**
 * ═══ LA NEIGE SUR LES PERSISTANTS — ce qui décide qu'une cime est coiffée ═══
 *
 * *(Demande d'Alexis, 2026-08-25 : « il faudrait ajouter une couche de neige sur les arbres
 * persistants ». Le DESSIN de la coiffe vit dans `render/houppier-grappes.ts` ; ici, le seul
 * choix « cet arbre-là porte-t-il de la neige, et combien ».)*
 *
 * ═══ POURQUOI PAS `gel.etatAt`, QUI EXISTAIT DÉJÀ ═══
 *
 * La couche de gel connaît le niveau de neige de chaque tuile — et c'est exactement ce qu'il ne
 * faut PAS lire ici. `niveauPourCouverture` est construit pour rendre le SOL moucheté : un
 * seuil positionnel par tuile (`seuilDeNeige` = plaques fbm + gigue de ±0,18), et son en-tête
 * l'assume. MESURÉ, à couverture constante sur un bloc de 60×60 tuiles :
 *
 *     couverture 0,30 → 44 % des voisinages 3×3 portent PLUSIEURS niveaux
 *     couverture 0,50 → 92 %
 *     couverture 0,90 → 81 %
 *
 * Au sol, c'est la texture voulue. Sur des cimes, ce serait du bruit : deux pins à une tuile
 * l'un de l'autre porteraient deux coiffes différentes, et ils passeraient de chargé à nu à des
 * instants différents. **La neige qui est tombée sur un peuplement est tombée sur tout le
 * peuplement.**
 *
 * On lit donc la COUVERTURE continue (`neigeAuSol`, la même loi, avant son seuillage par
 * tuile), et on l'échantillonne au PEUPLEMENT : un point par bloc de `BLOC_TUILES`. Le pop
 * reste un pop — une texture ne s'interpole pas — mais il est SYNCHRONE sur tout le bosquet,
 * et c'est la seule chose qu'on puisse contrôler.
 *
 * ═══ ET POURQUOI C'EST MÉMOÏSÉ ═══
 *
 * `neigeAuSol` rembobine trois cycles de météo et intègre la fonte tranche par tranche —
 * `gel-layer` le paie déjà par chunk, et son en-tête dit pourquoi il ne le paie pas par frame.
 * Un appel par arbre visible et par image serait hors de question. Ici : un appel par bloc de
 * 8×8 tuiles et par quantum de temps, soit une poignée par seconde sur un écran entier.
 *
 * ⚠ **LE CACHE SE PÉRIME SUR LE TEMPS, PAS SUR L'APPARTENANCE.** Un cache qu'on n'invalide
 * qu'en entrant dans un bloc neuf ne verrait jamais arriver un front : la neige tomberait sur
 * un bosquet qu'on regarde sans que rien ne change à l'écran. Le quantum de tick le garantit.
 */
import { neigeAuSol, type SimState } from '@ashes/sim'
import type { EtatCime } from '../../render/arbre-art'

export const NEIGE_DES_CIMES = {
  /** Le côté du bloc d'échantillonnage, en tuiles — l'échelle d'un peuplement, pas d'une tuile. */
  BLOC_TUILES: 8,
  /** Au-dessus : la cime est poudrée. C'est le seuil du manteau au sol (`GEL.NEIGE_SEUIL_MIN`
   *  vaut 0,12) relevé d'un cran : il faut plus de neige pour tenir sur une branche que par
   *  terre — ce qui tombe sur une cime en glisse aussi. */
  SEUIL_POUDRE: 0.28,
  /** Au-dessus : la cime est chargée. */
  SEUIL_CHARGE: 0.68,
  /** Le cache se périme tous les N ticks (20 Hz → 10 s). Assez court pour voir un front
   *  arriver, assez long pour que le coût soit nul. */
  PEREMPTION_TICKS: 200,
} as const

/**
 * L'état d'enneigement des cimes, mémoïsé par bloc et par quantum de temps.
 *
 * Une INSTANCE, pas des fonctions libres : le cache a une durée de vie, et elle est celle de la
 * vue. Deux vues (le jeu, un banc) ne doivent pas se partager un état de neige.
 */
export class NeigeDesCimes {
  private readonly memo = new Map<number, number>()
  private quantum = -1

  /**
   * L'état de cime d'un persistant planté là. Rend toujours `'feuillu'` sans état de gel —
   * l'absence d'information n'invente pas de neige.
   */
  etatDe(etat: SimState | null, tx: number, ty: number): EtatCime {
    const c = this.couvertureDe(etat, tx, ty)
    if (c >= NEIGE_DES_CIMES.SEUIL_CHARGE) return 'neige2'
    if (c >= NEIGE_DES_CIMES.SEUIL_POUDRE) return 'neige1'
    return 'feuillu'
  }

  /** La couverture au centre du bloc qui contient cette tuile — c'est l'échantillon partagé. */
  couvertureDe(etat: SimState | null, tx: number, ty: number): number {
    if (etat === null) return 0
    const q = Math.floor(etat.tick / NEIGE_DES_CIMES.PEREMPTION_TICKS)
    if (q !== this.quantum) {
      this.quantum = q
      this.memo.clear()
    }
    const B = NEIGE_DES_CIMES.BLOC_TUILES
    const bx = Math.floor(tx / B)
    const by = Math.floor(ty / B)
    // La carte fait au plus quelques milliers de tuiles de côté : `by * 65536 + bx` est une clé
    // entière sûre, et c'est la même arithmétique que les autres index de tuile du client.
    const cle = by * 65536 + bx
    let v = this.memo.get(cle)
    if (v === undefined) {
      // Le CENTRE du bloc, jamais son coin : un coin est sur la frontière de quatre blocs, et
      // deux blocs voisins y liraient deux valeurs presque égales pour des tuiles éloignées.
      v = neigeAuSol(etat, bx * B + (B >> 1), by * B + (B >> 1))
      this.memo.set(cle, v)
    }
    return v
  }
}
