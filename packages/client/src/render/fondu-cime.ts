/**
 * ═══ LE FONDU DE CIME — une cime ne change JAMAIS d'un coup ═══
 *
 * *(Demande d'Alexis, 2026-08-25 : « il faudra que la transition entre chaque état soit lerpée,
 * une transition lente d'ailleurs ».)*
 *
 * Une cime a une texture, et une texture ne s'interpole pas : le feuillu devenait nu en une
 * image, le persistant se couvrait de neige en une image, et la forêt changeait de saison en une
 * image. Trois sauts, et le dernier était le pire — la teinte du sol, elle, glisse.
 *
 * On fond donc DEUX SPRITES l'un dans l'autre : la cime d'avant s'efface pendant que celle
 * d'après paraît. C'est le seul fondu possible entre deux images cuites, et c'est celui que le
 * reste du client emploie déjà pour les mêmes raisons (les transitions de flore, `flore-gel.ts`).
 *
 * ═══ DEUX DURÉES, PARCE QUE CE NE SONT PAS DEUX MÊMES CHOSES ═══
 *
 *   • un ÉTAT change parce qu'il s'est passé quelque chose À CET ARBRE-LÀ : ses feuilles
 *     tombent, la neige le prend. C'est un événement, il se voit — quelques secondes.
 *   • la SAISON change pour TOUS les arbres à la fois, et elle ne doit surtout pas se voir
 *     comme un événement : c'est une dérive. Beaucoup plus long, et l'œil ne l'attrape jamais
 *     en train de basculer.
 *
 * ⚠ **UN SEUL FONDU À LA FOIS PAR ARBRE.** Composer une défeuillaison et un virage de saison
 * demanderait quatre textures et deux facteurs ; si un état change pendant qu'une saison
 * glisse, la nouvelle transition REPART de ce qu'on voyait à cet instant — c'est-à-dire de
 * l'image d'où le fondu était rendu. On ne perd rien de visible : au pire, une couleur de
 * saison intermédiaire est court-circuitée pendant les quelques secondes d'une défeuillaison.
 *
 * PUR : aucune dépendance à Phaser, testable en Node. Le module dit QUOI dessiner et à quelle
 * opacité ; c'est `snapshot-view` qui pose les sprites.
 */
import type { EtatCime } from './arbre-art'

export const FONDU_CIME = {
  /** Un ÉTAT qui change (feuillu ↔ nu, la neige qui prend ou fond) — un événement, en ms. */
  ETAT_MS: 6000,
  /** LA SAISON qui glisse d'un cran — une dérive, jamais un basculement, en ms. */
  SAISON_MS: 30000,
  /** Au-delà de ce silence, on oublie un arbre : il est hors vue depuis longtemps. */
  OUBLI_MS: 30000,
} as const

/** Ce qu'il faut dessiner : la cime d'après, celle d'avant, et où en est le passage. */
export interface EtapeFondu {
  /** La cime d'après — celle vers laquelle on va, à l'opacité `u`. */
  cle: string
  /** La cime d'avant, à l'opacité `1 − u`. `null` quand il n'y a pas de fondu en cours. */
  precedente: string | null
  /** L'avancement dans [0, 1]. Vaut 1 hors transition. */
  u: number
}

interface Suivi {
  cle: string
  etat: EtatCime
  precedente: string | null
  debut: number
  duree: number
  vu: number
}

/**
 * LES FONDUS EN COURS, un par arbre.
 *
 * Indexé par l'ID DU NŒUD, jamais par l'index de pool : les sprites de cime se réattribuent à
 * chaque image, et deux arbres échangeraient leur transition en cours d'un simple mouvement de
 * caméra. C'est la même leçon que le pool des cimes lui-même (« la texture doit être reposée à
 * CHAQUE image »), et elle se paie ici en fondus qui sautent d'un arbre à l'autre.
 */
export class FonduDeCime {
  private readonly suivis = new Map<number, Suivi>()
  private dernierMenage = 0

  /**
   * Où en est cet arbre. À appeler CHAQUE image pour chaque cime visible : c'est cet appel qui
   * détecte le changement et arme la transition.
   */
  etape(id: number, cle: string, etat: EtatCime, now: number): EtapeFondu {
    const s = this.suivis.get(id)
    if (s === undefined) {
      // Premier regard : aucune transition. Un arbre qui entre dans le cadre est déjà dans son
      // état — il ne doit pas « devenir » nu sous les yeux du joueur qui s'approche.
      this.suivis.set(id, { cle, etat, precedente: null, debut: now, duree: 0, vu: now })
      return { cle, precedente: null, u: 1 }
    }
    s.vu = now
    if (cle !== s.cle) {
      // LA NOUVELLE TRANSITION PART DE CE QU'ON VOIT. Si un fondu était en cours, sa cible
      // devient le point de départ : le pire écart possible est celui d'un fondu à peine
      // commencé, et il dure quelques secondes.
      s.precedente = s.cle
      s.duree = etat === s.etat ? FONDU_CIME.SAISON_MS : FONDU_CIME.ETAT_MS
      s.debut = now
      s.cle = cle
      s.etat = etat
    }
    if (s.precedente === null) return { cle: s.cle, precedente: null, u: 1 }
    const u = s.duree <= 0 ? 1 : Math.min(1, Math.max(0, (now - s.debut) / s.duree))
    if (u >= 1) {
      s.precedente = null
      return { cle: s.cle, precedente: null, u: 1 }
    }
    return { cle: s.cle, precedente: s.precedente, u }
  }

  /**
   * Oublie les arbres qu'on n'a plus regardés depuis longtemps. Appelé à chaque image, il ne
   * balaie qu'une fois par `OUBLI_MS` : la carte reste bornée à ce qui est passé sous les yeux
   * dans la dernière demi-minute, sans balayage par frame.
   */
  menage(now: number): void {
    if (now - this.dernierMenage < FONDU_CIME.OUBLI_MS) return
    this.dernierMenage = now
    for (const [id, s] of this.suivis) {
      if (now - s.vu > FONDU_CIME.OUBLI_MS) this.suivis.delete(id)
    }
  }

  /**
   * TOUT OUBLIER — quand ce n'est pas la cime qui a changé, mais la façon de la dessiner.
   *
   * Le module ne juge que sur la CLÉ : il ne peut pas distinguer « cet arbre a perdu ses feuilles »
   * de « tous les arbres viennent de passer de l'art peint au `_lit` ». Le second n'est pas une
   * transition du monde, c'est un changement de pipeline — il ne se fond pas, il se pose. À
   * l'appelant de le dire (`snapshot-view`, au basculement d'éclairage).
   */
  oublieTout(): void {
    this.suivis.clear()
  }

  /** Combien d'arbres sont suivis — pour les gardes (la carte doit rester bornée). */
  get taille(): number {
    return this.suivis.size
  }
}
