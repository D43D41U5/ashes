/**
 * LES NOMS FRANÇAIS DES TERRAINS — pour l'ENCYCLOPÉDIE, qui dit où vit une bête.
 *
 * `TERRAINS` (/sim) porte des slugs anglais (`old_growth`, `juniper_heath`) : ce sont des
 * identifiants, pas des mots de jeu. L'écran, lui, est en français comme le reste.
 *
 * PARTIEL PAR CONSTRUCTION, et gardé : seuls les terrains qu'une fiche cite ont besoin d'un
 * nom, mais `encyclopedie.test.ts` balaie les habitats de `MONSTER_DEFS` et échoue si l'un
 * d'eux n'en a pas — un habitat neuf ne peut donc pas afficher un slug anglais en silence.
 */
export const TERRAIN_NOMS: Record<string, string> = {
  grass: 'prairie',
  road: 'sente',
  forest: 'forêt',
  shallow_water: 'gué',
  rock: 'roche',
  deep_water: 'eau profonde',
  wall: 'mur',
  marsh: 'marais',
  scree: 'éboulis',
  snow: 'neige',
  pine: 'pinède',
  larch: 'mélèzes',
  old_growth: 'vieille sylve',
  willow: 'saulaie',
  heath: 'lande',
  flower_meadow: 'prairie fleurie',
  alpine_meadow: 'alpage',
  alpine_flowers: 'alpage fleuri',
  wet_meadow: 'prairie humide',
  peat_bog: 'tourbière',
  reed_marsh: 'roselière',
  juniper_heath: 'lande à genévriers',
  clairiere: 'clairière',
}

/** Le nom d'un terrain, ou son slug si personne ne le lui a donné (la garde le rattrapera). */
export function nomDeTerrain(slug: string): string {
  return TERRAIN_NOMS[slug] ?? slug
}
