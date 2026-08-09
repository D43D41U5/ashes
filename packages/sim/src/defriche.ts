/**
 * LE DÉFRICHEMENT — on ne défriche pas deux fois le même carré.
 *
 * Décision d'Alexis, 2026-08-06 : **rien ne repousse dans l'emprise d'un village**. Un
 * tronc abattu, une pierre cassée, un filon vidé chez soi ne reviennent JAMAIS — et
 * rien ne dérive du dehors pour venir les remplacer. Le bois d'un village vient donc de
 * l'extérieur, définitivement, ce qui donne enfin sa contrepartie au Feu (évier permanent,
 * `advanceUpkeep`) : on rentre du bois, on ne le récolte pas sur place.
 *
 * DEUX EXCEPTIONS, et elles ont la même raison : **ce qui est VIVANT repousse, ce qui
 * s'EXTRAIT ne revient pas**. Les baies, la fibre et les champignons (`NodeDef.renewable`)
 * repoussent jusque dans le village — c'est le potager qui vient tout seul, et il ne dispute
 * rien au bois. Les buissons, fleurs et cailloux dont parlait la demande ne sont pas des
 * nœuds du tout : c'est du décor de rendu (`client/render/clutter.ts`), hors de portée d'ici.
 *
 * ── POURQUOI UN MODULE À PART ───────────────────────────────────────────────────
 *
 * Trois appelants, et deux d'entre eux ne peuvent pas se voir : `economy.ts` importe déjà
 * `village.ts` (pour `structureAt`), donc `village.ts` ne peut pas importer `economy.ts` en
 * retour. Le prédicat vit ici, ne dépend que de `balance.ts`, et les deux le lisent sans
 * cycle. Le troisième appelant est le CLIENT (voir plus bas).
 *
 * ── LE NŒUD N'EST PAS DÉTRUIT, IL EST DÉFRICHÉ ──────────────────────────────────
 *
 * Un nœud défriché reste dans `state.nodes`, à `stock 0` pour toujours. On ne le retire pas,
 * et c'est délibéré : le protocole ne transmet les nœuds qu'UNE fois (`node-shadow.ts`) puis
 * des deltas de stock ; un nœud retiré n'émettrait plus rien du tout et le client dessinerait
 * un arbre fantôme, contre lequel il se cognerait en prédiction locale. À `stock 0` il émet au
 * contraire un delta que le client reçoit, et **le client applique CE MÊME prédicat** — c'est
 * la leçon de la Cendre (`snapshot-view.majCendre`) : on ne transmet rien, chacun recalcule.
 *
 * Un `stock 0` ne bloque déjà plus le déplacement (`collision.ts` teste `stock > 0`). Restait
 * la POSE, qui refusait toute tuile portant un nœud sans regarder son stock : c'était le vrai
 * piège de cette règle — abattre l'arbre pour bâtir là, et ne plus pouvoir. D'où `poseLibre`.
 *
 * PUR — aucune horloge, aucun PRNG, aucun Math approximé (`abs`, `max`).
 */
import { BALANCE, NODE_DEFS, type NodeType } from './balance'

/** Ce que le défrichement a besoin de savoir d'un village : où brûle son Feu. */
export interface FoyerDeVillage {
  fireTx: number
  fireTy: number
}

/** Ce qu'il a besoin de savoir d'un nœud. Structurel : le client passe le sien. */
export interface NoeudSitue {
  type: NodeType
  tx: number
  ty: number
  stock: number
}

/**
 * LE RAYON DE L'EMPRISE — le carré RÉSERVÉ (palier 3), pas celui du palier courant.
 *
 * Le carré est retenu à sa taille MAX dès la fondation (spec construction R1-R2) ; monter le
 * Feu ne fait que l'OUVRIR à la pose. Le défrichement suit la RÉSERVATION : sinon, passer du
 * palier 1 au 2 rendrait constructible une couronne de trois tuiles reboisée entre-temps, et
 * le joueur qui a défriché large verrait sa clairière se refermer par l'anneau.
 */
export function rayonEmprise(): number {
  const byTier = BALANCE.FIRE_RADIUS_BY_TIER
  return byTier[byTier.length - 1]!
}

/** Cette tuile est-elle dans l'emprise d'un village ? (Chebyshev — le domaine est un CARRÉ.) */
export function dansEmprise(villages: readonly FoyerDeVillage[], tx: number, ty: number): boolean {
  const r = rayonEmprise()
  for (const v of villages) {
    if (Math.max(Math.abs(v.fireTx - tx), Math.abs(v.fireTy - ty)) <= r) return true
  }
  return false
}

/**
 * Ce nœud est-il sous la règle du défrichement ? Deux conditions : il est dans l'emprise
 * d'un village ET il s'EXTRAIT (pas `renewable`). Ne regarde PAS le stock : la question est
 * « ce nœud repoussera-t-il ? », pas « est-il vide ? ».
 */
export function noeudDefrichable(villages: readonly FoyerDeVillage[], node: { type: NodeType; tx: number; ty: number }): boolean {
  if (NODE_DEFS[node.type].renewable) return false
  return dansEmprise(villages, node.tx, node.ty)
}

/**
 * Ce nœud est-il DÉFRICHÉ — vidé, et pour de bon ? C'est l'état terminal.
 *
 * Le rendu s'en sert pour ne plus dessiner l'arbre (le client pose une SOUCHE transitoire à
 * sa place, `snapshot-view.stumps` : un tronc qui s'évapore ne raconterait rien — mais elle
 * s'efface, la tuile reste NUE) ; la pose s'en sert pour libérer la tuile.
 */
export function noeudDefriche(villages: readonly FoyerDeVillage[], node: NoeudSitue): boolean {
  return node.stock <= 0 && noeudDefrichable(villages, node)
}

/**
 * LA TUILE EST-ELLE LIBRE POUR BÂTIR, du point de vue des nœuds ?
 *
 * Un nœud occupe sa tuile — sauf s'il est défriché : il n'en reste rien à contourner, et
 * c'est précisément là qu'on veut bâtir. Sans cette exception, la règle se retournerait
 * contre elle-même : on abat l'arbre pour faire place, et la place ne vient jamais.
 */
export function poseLibre(villages: readonly FoyerDeVillage[], nodes: readonly NoeudSitue[], tx: number, ty: number): boolean {
  for (const n of nodes) {
    if (n.tx !== tx || n.ty !== ty) continue
    return noeudDefriche(villages, n)
  }
  return true
}
