/**
 * ═══ CE QUE LE CHAMP LIT D'UNE SOURCE (LG-R14, LG-R20) — PUR ═══
 *
 * Deux fonctions minuscules, et un fichier à elles parce qu'elles doivent être **prouvables
 * headless** : `night-veil` et `champ-gpu` importent tous les deux Phaser, et un test qui les
 * charge meurt à l'import. La leçon est datée du 2026-10-05 (les courbes de la flaque de braise
 * ont déménagé pour exactement ça) : *une loi se range là où elle peut être prouvée.*
 *
 * Ce qu'elles encodent tient en deux phrases, et chacune a déjà coûté une session ailleurs :
 *   • la place d'une source dans le champ est **logique** (`yLogique`), jamais celle où on la
 *     dessine — le dessin porte le `lift`, la grille de la sim ne le connaît pas ;
 *   • sa force est celle **du champ** (`forceGi`), jamais celle du voile (`force`), qui est un
 *     creusement. Les deux sont séparées depuis LG-R6, et c'est ce qui permet à une source
 *     d'éclairer sans trouer la nuit — un essaim de lucioles, par exemple.
 */
import { GI } from './reglages'

/** Une source du voile, telle que `WorldScene` l'assemble. */
export interface SourceDuVoile {
  readonly worldX: number
  /** Sa place LOGIQUE en Y — le champ est la grille de la sim. */
  readonly yLogique: number
  readonly radiusTiles: number
  /** Sa force DANS LE CHAMP (`forceGi`), pas le creusement du voile. */
  readonly forceGi: number
  readonly niveau: number
  /** Sa couleur, quand ce n'est pas une flamme (LG-R20). */
  readonly rgb?: readonly [number, number, number]
}

/** Ce que le champ consomme : même forme que `SourceGi` de `champ-gpu`. */
export interface SourceDuChamp {
  readonly worldX: number
  readonly worldY: number
  readonly radiusTiles: number
  readonly force: number
  readonly palier: number
  readonly rgb?: readonly [number, number, number]
}

/**
 * LA TEINTE D'UNE SOURCE : la sienne, ou celle du feu à défaut.
 *
 * Extraite pour qu'une garde éprouve LE VRAI défaut — une source non-flamme dont le `rgb` se perd
 * en chemin ne lève rien, ne change aucun type, et ressort simplement AMBRE. C'est la classe de
 * panne la plus coûteuse du rendu : elle a l'air de marcher.
 */
export function teinteDeLaSource(s: { readonly rgb?: readonly [number, number, number] }): readonly [number, number, number] {
  return s.rgb ?? GI.TEINTE_FEU
}

/** La conversion voile → champ. Les trois pièges qu'elle met à UN endroit sont en tête de fichier. */
export function sourceDuChamp(f: SourceDuVoile): SourceDuChamp {
  return {
    worldX: f.worldX,
    worldY: f.yLogique,
    radiusTiles: f.radiusTiles,
    force: f.forceGi,
    palier: f.niveau,
    // ⚠ SPREAD CONDITIONNEL (`exactOptionalPropertyTypes`) — et surtout : sans cette clause, une
    // source colorée ressortirait AMBRE par le défaut de `teinteDeLaSource`, sans qu'une ligne
    // ne bouge ni qu'un type ne proteste.
    ...(f.rgb ? { rgb: f.rgb } : {}),
  }
}
