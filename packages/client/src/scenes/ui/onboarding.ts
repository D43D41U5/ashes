/**
 * L'ONBOARDING — piloté par l'ÉTAT, pas par un minuteur.
 *
 * L'ancienne version crachait trois conseils sur une horloge (2 s / 12 s / 24 s) :
 * un joueur qui avait DÉJÀ fait son feu s'entendait dire « il vous faut un feu »,
 * et la règle du feu tombait à 24 s qu'il en ait un ou non. Un conseil arrivé au
 * mauvais moment n'enseigne rien — il devient du bruit qu'on apprend à ignorer.
 *
 * Ici, chaque conseil naît d'une CONDITION de jeu, et une seule fois (jamais de
 * répétition : ce serait du harcèlement). Le principe du GDD tient : « trois, pas
 * trente » — le strict nécessaire pour ne pas mourir la première nuit, dit à
 * l'instant où il sert. Fonction PURE : zéro Phaser, donc prouvée par des tests.
 *
 * On n'enseigne que ce qui se JOUE : le conseil « nourrir le Feu » (l'upkeep V1-11) est
 * arrivé quand le geste joueur a été câblé (décision d'Alexis 2026-07-23, grappe entretien
 * — bois en main + clic sur le Feu → `feed_fire`), et se dit quand le Feu FAIBLIT.
 */

export type OnboardingHintId = 'basics' | 'make-fire' | 'fire-purpose' | 'feed-fire' | 'give-neighbor' | 'weapon'

/** L'état de jeu pertinent pour l'onboarding — un instantané lu par le caller. */
export interface OnboardingState {
  /** Millisecondes écoulées depuis que le monde est prêt (l'horloge de scène). */
  msAlive: number
  /** Le joueur a-t-il un Feu (il appartient à un village) ? Coupe le rappel « fais un feu ». */
  hasFire: boolean
  /** Le combustible du Feu est-il BAS ? Déclenche le conseil « nourris-le », à l'instant utile. */
  fireLow: boolean
  /** Une arme est-elle EN MAIN (case active) ? Déclenche la règle du combat, au bon instant. */
  hasWeapon: boolean
  /** Un ÉTRANGER (PNJ hors de mon village) est-il assez proche pour qu'on puisse le NOURRIR ? */
  neighborNear: boolean
}

export interface OnboardingHint {
  id: OnboardingHintId
  text: string
}

/** Le conseil de base attend un souffle (le temps de voir le monde) avant de s'afficher. */
export const BASICS_DELAY_MS = 2000
/** Le rappel du feu ne presse qu'après un moment sans en avoir fait — pas dès le spawn. */
export const MAKE_FIRE_DELAY_MS = 12000

const HINT_TEXT: Record<OnboardingHintId, string> = {
  basics: 'Clic gauche : récolter. TAB : votre sac et l’artisanat.',
  'make-fire': 'Ramassez du bois : il vous faut un FEU avant la nuit.',
  // La règle du jeu, dite une fois, à l'instant où le Feu naît : le cru ne nourrit plus un homme.
  'fire-purpose': 'Le feu cuit, réchauffe, et tient les loups à distance.',
  // L'UPKEEP (V1-11), enseigné quand le Feu FAIBLIT : sans ce geste, le foyer meurt de faim
  // et le village tombe en ruine. Le seul geste qui le tient — dit au moment où il presse.
  'feed-fire': 'Votre Feu faiblit. Tenez du BOIS et cliquez-le pour le nourrir — ou il s’éteindra.',
  // Le verbe chaud FONDAMENTAL (spec alignement R2) : sans ce conseil, le seul geste
  // évident envers un voisin serait de le frapper. On enseigne l'autre voie.
  'give-neighbor': 'Un voisin, tout près. Tenez de la nourriture et cliquez-le : DONNER en fait un allié.',
  // La règle du combat, dite À L'INSTANT où une arme arrive en main — jamais dans un mur
  // de texte au démarrage qu'on ferme sans lire. Le coup chargé resterait sinon un secret.
  weapon: 'MAINTENEZ le clic : un coup lourd s’arme. ESPACE : parez de face.',
}

/**
 * Le prochain conseil à montrer, ou `null` si aucun ne s'applique. On rend le PREMIER
 * conseil encore non montré dont la condition tient, dans l'ordre d'URGENCE ci-dessous :
 * le combat prime (il est mortel et fugace), puis les réactions à un changement d'état
 * (le Feu vient de naître, un voisin approche), enfin les rappels temporisés.
 *
 * Un conseil déjà dans `shown` ne revient jamais.
 */
export function nextOnboardingHint(state: OnboardingState, shown: ReadonlySet<OnboardingHintId>): OnboardingHint | null {
  const hint = (id: OnboardingHintId): OnboardingHint => ({ id, text: HINT_TEXT[id] })

  // 1. LE COMBAT — mortel et fugace : dès qu'une arme est en main, on dit la parade.
  if (state.hasWeapon && !shown.has('weapon')) return hint('weapon')
  // 2. LE FEU VIENT DE NAÎTRE — on enseigne sa valeur à l'instant où il existe.
  if (state.hasFire && !shown.has('fire-purpose')) return hint('fire-purpose')
  // 2bis. LE FEU FAIBLIT — on enseigne à le nourrir pile quand ça presse (upkeep V1-11).
  if (state.hasFire && state.fireLow && !shown.has('feed-fire')) return hint('feed-fire')
  // 3. UN VOISIN APPROCHE — on enseigne le don pendant qu'il est à portée d'être utile.
  if (state.neighborNear && !shown.has('give-neighbor')) return hint('give-neighbor')
  // 4. RAPPEL DU FEU — seulement si l'on n'en a toujours pas, après un délai.
  if (!state.hasFire && state.msAlive >= MAKE_FIRE_DELAY_MS && !shown.has('make-fire')) return hint('make-fire')
  // 5. LES BASES — le tout premier conseil, après un souffle.
  if (state.msAlive >= BASICS_DELAY_MS && !shown.has('basics')) return hint('basics')
  return null
}
