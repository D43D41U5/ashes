/**
 * ═══ CE QU'UN ESSAIM DE LUCIOLES PÈSE DANS LE CHAMP DE LA GI (LG-R20) ═══
 *
 * PUR, et c'est la raison d'être du fichier : `ambient-life.ts` tient les sprites, la flaque et la
 * source Light2D, donc il importe **Phaser** — un test headless qui le charge meurt à l'import.
 * La leçon est datée (2026-10-05, les courbes de la flaque de braise ont déménagé pour la même
 * raison) : *une loi se range là où elle peut être prouvée.*
 *
 * La géométrie et l'enveloppe, elles, restent dans `ambient-life` : ce sont des faits d'essaim.
 */
import { GI } from './gi/reglages'

/** Vert-jaune de luciole — la MÊME teinte que le sprite additif, la source et la flaque au sol. */
export const FIREFLY_TINT = 0xc8e87a

/**
 * ═══ LA TEINTE DE L'ESSAIM DANS LE CHAMP DE LA GI (LG-R20) ═══
 *
 * `FIREFLY_TINT` (ci-dessus) en lumière linéaire par canal, **normalisée à la luminance de `GI.TEINTE_FEU`**.
 * La normalisation n'est pas cosmétique : le champ multiplie la teinte par la FORCE
 * (`champ-gpu` : `rgb: [teinte × force, …]`), donc sans elle « force 1 » voudrait dire une chose
 * pour une flamme et une autre pour un essaim — la comparaison d'amplitude ci-dessous ne voudrait
 * plus rien dire. On garde donc la COULEUR de la luciole et on lui donne le POIDS d'une flamme ;
 * c'est exactement ce que fait une gueule avec `couleurDuJour`, la seule autre source du champ
 * qui ne soit pas une flamme.
 */
export const FIREFLY_GI_TINT: readonly [number, number, number] = (() => {
  const r = ((FIREFLY_TINT >> 16) & 0xff) / 255
  const v = ((FIREFLY_TINT >> 8) & 0xff) / 255
  const b = (FIREFLY_TINT & 0xff) / 255
  const lum = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const k = lum(GI.TEINTE_FEU) / lum([r, v, b])
  return [r * k, v * k, b * k]
})()

/**
 * ═══ CE QU'UN ESSAIM PÈSE DANS LE CHAMP — 1, ET CE N'EST PAS UN NOMBRE À MOI ═══
 *
 * Dans l'échelle du RENDU un Feu pousse **1** et une lumière PORTÉE la moitié
 * (`TORCHE_HOLE_FORCE`). Un essaim est une source POSÉE, et la loi qui le gouverne est déjà
 * écrite en toutes lettres dans `FIREFLY_LIGHT_INTENSITY` : *« l'essaim éclaire ses alentours
 * comme un Feu de camp éclaire les siens »* (Alexis, 2026-08-26, après deux montées). Parité de
 * Feu, donc — et l'enveloppe (`nuit × souffle × fondu`, toutes ≤ 1) fait le reste : un essaim ne
 * vaut un Feu qu'au plein de sa nuit, de son souffle et de son fondu.
 *
 * ⚠ **ET ON NE TRANSPORTE PAS `FIREFLY_LIGHT_INTENSITY` ICI** : 1,8 vit dans l'échelle de
 * Light2D, pas dans celle du champ. C'est la leçon de l'étape 7 — le sommet de `/sim` poussé tel
 * quel dans `veilFires` donnait à une braise le creusement d'un FEU : *une amplitude se dérive
 * dans l'échelle où elle est LUE, jamais dans celle d'où elle vient.*
 *
 * ⚠ Au passage, le commentaire de `FIREFLY_LIGHT_INTENSITY` est **périmé** : il justifie 1,8 par
 * « `dynamic-lighting` : 0,6 + 1,2×nuit, soit ~1,8 à minuit », or `intensiteDuFeu` multiplie ce
 * socle par 0,8 depuis le retrait de l'alignement — un Feu vaut 1,44 à minuit hors liseré. La
 * parité revendiquée n'est donc plus vraie DANS Light2D, raison de plus pour ne pas faire voyager
 * le rapport d'une échelle à l'autre.
 */
export const FIREFLY_GI_FORCE = 1

/** Une source d'essaim telle que le champ la lit : à sa place LOGIQUE (le champ est la grille de
 *  la sim, LG-R14 — donc jamais le `lift`, qui n'est que du dessin). */
export interface SourceEssaim {
  /** Place logique, en px monde. */
  readonly worldX: number
  readonly worldY: number
  readonly radiusTiles: number
  /** `FIREFLY_GI_FORCE × nuit × souffle × fondu` — la MÊME enveloppe que le point light. */
  readonly force: number
  readonly rgb: readonly [number, number, number]
}
