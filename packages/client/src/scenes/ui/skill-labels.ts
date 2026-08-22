/**
 * LES NOMS DES QUATRE MÉTIERS — une seule source, deux consommateurs.
 *
 * Le paperdoll (`hud-character`) les affiche à froid ; le toast de montée de niveau
 * (`hud-core`) les crie à chaud. Les deux doivent dire le MÊME mot — sinon « Bûcheron »
 * ici et « Coupe-bois » là, et le joueur ne fait pas le lien. On les tient ici.
 */
import type { SkillId } from '@ashes/sim'

export const SKILL_LABELS: Record<SkillId, string> = {
  woodcutting: 'Bûcheron',
  mining: 'Mineur',
  foraging: 'Cueilleur',
  crafting: 'Artisan',
  // La branche CHASSE/PÊCHE du GDD (l.687), ouverte par la pêche (spec peche.md D6) : le mot
  // est celui de la branche, pas du geste qui l'a ouverte — la chasse s'y branchera.
  hunting: 'Chasseur',
}
