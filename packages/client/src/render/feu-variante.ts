/**
 * LE RENDU DU FEU — et le banc qui a servi à le choisir.
 *
 * ═══ DÉCISION D'ALEXIS, 2026-08-26 : « fais tout » ═══
 *
 * Cinq propositions ont été photographiées en jeu, une par axe, sur la même nuit et le même
 * foyer (planche : `docs/decisions.md`, entrée du 2026-08-26). Alexis les prend **toutes les
 * cinq**. Le rendu par DÉFAUT est donc leur composition — `TOUT` —, et ce n'est PAS un simple
 * « ou logique » des cinq branches : trois d'entre elles ajoutent de la lumière au même
 * endroit, et empilées telles quelles elles rejouaient très exactement le délavage que
 * `fire-ground-glow` documente. Ce qui a été recalé, et pourquoi, est écrit à chaque point de
 * composition dans le code (chercher « COMPOSITION »).
 *
 * ═══ LE BANC RESTE, ET C'EST DÉLIBÉRÉ ═══
 *
 * `window.__FEU__` survit à la décision — mais il ne commande plus QUEL rendu on livre, il
 * permet de REVENIR EN ARRIÈRE pour comparer :
 *
 *   · absent (le cas normal)  → `TOUT`, le rendu du jeu.
 *   · 0                       → l'ÉTALON, le rendu d'avant le 2026-08-26.
 *   · 1..5                    → un seul axe, isolé — pour savoir lequel porte quoi quand un
 *                               réglage se discutera à nouveau.
 *
 * C'est la seule dette qu'on accepte ici, et elle se paie : elle vaut tant qu'on calibre le feu
 * en playtest. Le jour où plus personne ne pose `__FEU__`, ce fichier et ses branches partent
 * d'un bloc — un commutateur qu'on ne touche plus est un chemin mort que chaque correctif futur
 * doit quand même traverser.
 *
 * Il se lit À CHAQUE APPEL, jamais mémoïsé : le scénario smoke pose le décor UNE fois puis
 * balaie `__FEU__`. Une lecture au chargement aurait exigé un rechargement par variante, donc
 * autant de mondes, de lunes et de décors — et les images n'auraient plus différé que par ce
 * qu'on ne mesure pas.
 */

/** 0 = l'étalon d'avant · 1..5 = un axe isolé · 6 = TOUT (le rendu livré, et le défaut). */
export type VarianteFeu = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** LE RENDU DU JEU. Nommé, pour qu'aucun site d'appel n'ait à écrire `6` en dur. */
export const TOUT: VarianteFeu = 6

declare global {
  interface Window {
    __FEU__?: number
  }
}

/**
 * La variante active — `TOUT` par défaut, c'est-à-dire le rendu livré.
 *
 * ⚠ `0` DOIT rester atteignable : c'est l'étalon de comparaison, et un `?? TOUT` naïf sur un
 * `0` explicite le renverrait à `TOUT` (0 est falsy). D'où le test sur `undefined`.
 */
export function varianteFeu(): VarianteFeu {
  if (typeof window === 'undefined') return TOUT
  const brut = window.__FEU__
  if (brut === undefined || brut === null) return TOUT
  const v = Math.trunc(Number(brut))
  return (v >= 0 && v <= 6 ? v : TOUT) as VarianteFeu
}

/** Ce que la variante active ALLUME, axe par axe. Un seul endroit décide, et les cinq modules
 *  de rendu le lisent — sans quoi chacun aurait sa propre idée de ce que « tout » veut dire. */
export interface AxesFeu {
  /** ① Le battement asymétrique (`flickerV`) au lieu de la somme de sinusoïdes. */
  respiration: boolean
  /** ② La rampe de température (flaque à trois arrêts, teinte des langues, couleur de source). */
  coeurBlanc: boolean
  /** ③ Les braises balistiques et la langue courte. */
  escarbilles: boolean
  /** ④ La source resserrée et intense qui sculpte les volumes. */
  lisere: boolean
  /** ⑤ Le halo d'air chaud, en l'air au-dessus des bûches. */
  halo: boolean
  /** Vrai quand plusieurs axes ADDITIFS sont allumés ensemble — les points de composition
   *  s'en servent pour rentrer leurs gains (voir « COMPOSITION » dans les modules). */
  compose: boolean
}

export function axesFeu(v: VarianteFeu = varianteFeu()): AxesFeu {
  const tout = v === TOUT
  return {
    respiration: tout || v === 1,
    coeurBlanc: tout || v === 2,
    escarbilles: tout || v === 3,
    lisere: tout || v === 4,
    halo: tout || v === 5,
    compose: tout,
  }
}

/** Le nom de chaque rendu — repris tel quel par la planche de présentation. */
export const NOMS_VARIANTE: Record<VarianteFeu, string> = {
  0: 'étalon (le rendu d’avant)',
  1: 'la respiration',
  2: 'le cœur blanc',
  3: 'les escarbilles',
  4: 'le liseré chaud',
  5: 'le halo de chaleur',
  6: 'tout',
}
