/**
 * QUI LE COUP ARMÉ PRENDRAIT — MAINTENANT.
 *
 * Fonction PURE, sortie de `WorldScene` pour la raison qui a déjà sorti `encaissement` et
 * `desequilibre` d'`attack-fx` : du branchement neuf sans garde est du code dont rien ne
 * distingue « ça marche » de « ça sort tôt à chaque image ».
 *
 * ═══ POURQUOI DÉSIGNER, PLUTÔT QUE MIEUX DESSINER ═══
 *
 * Le télégraphe est désormais exact (`render/zone-frappe.ts`), et il reste dur à lire : une
 * zone au SOL se juge contre des billboards DEBOUT alors que la sim résout aux PIEDS. C'est
 * le piège mesuré du curseur (0,56 tuile d'erreur, 23 à 42 % des coups perdus), et le
 * demander au joueur, c'est le lui faire refaire à chaque coup. On NOMME donc les cibles.
 *
 * ═══ UN SEUL SENS, UNE SEULE COULEUR (décision d'Alexis, 2026-08-28) ═══
 *
 * Le liseré ROUGE dit une chose et une seule : **celui-là prend le coup si je le lâche
 * maintenant**. Pas « il est blessé », pas « on te vise » — une seule couleur pour deux
 * messages est pire que pas de couleur du tout.
 *
 * Le premier jet ajoutait un second cas (moi, souligné quand le coup d'un ADVERSAIRE
 * m'atteindrait). L'information est réelle, mais elle a besoin de son propre signe : mise
 * dans le même rouge, elle rendait le liseré ambigu au moment exact où il doit être lu
 * sans réfléchir. Elle est retirée, pas oubliée.
 *
 * Aucun filtre d'alliance n'est nécessaire, et ce n'est pas un raccourci : « le JOUEUR
 * frappe toujours tout ce qui est dans son arc » (spec combat R4quinquies — la troisième
 * alliance ne lie que les PNJ entre eux). On ne surligne jamais les cibles d'un TIERS :
 * il faudrait rejouer ici les quatre alliances de `resolveStrike` (harde, espèce cendreux,
 * même village, vol) et la ligne de tir — une seconde source de vérité qui dériverait.
 *
 * MÊLÉE SEULEMENT : un arc bandé a déjà son retour dédié (`tir.md` T2ter — le corps de
 * l'archer clignote, la ligne dit le point de chute), et son trait ne prend qu'UN corps
 * après une ligne dégagée. Marquer tout ce qui baigne dans son axe mentirait.
 */
import { inStrikeZone, type Strike } from '@ashes/sim'

/** Ce qu'il faut savoir d'un corps pour décider : sa position LOGIQUE et s'il vit. */
export interface Corps {
  id: number
  x: number
  y: number
  hp: number
}

/** Le coup armé, tel que le snapshot le transporte. */
export interface CoupArme {
  id: number
  dx: number
  dy: number
  strike: Strike
  ranged: boolean
}

/**
 * LES CORPS QUE LE COUP DU JOUEUR PRENDRAIT, s'il partait maintenant. Vide pour le coup de
 * quiconque d'autre : le liseré est une réponse à « qui vais-je toucher ? », et rien d'autre.
 */
export function ciblesDesignees(coup: CoupArme, corps: readonly Corps[], playerId: number): number[] {
  if (coup.ranged || coup.id !== playerId) return []
  const armeur = corps.find((e) => e.id === coup.id)
  if (!armeur) return []
  return corps
    // Un mort n'est plus une cible : `resolveStrike` l'écarte aussi (`target.hp <= 0`).
    .filter((c) => c.id !== coup.id && c.hp > 0)
    .filter((c) => inStrikeZone(coup.strike, armeur.x, armeur.y, coup.dx, coup.dy, c.x, c.y))
    .map((c) => c.id)
}
