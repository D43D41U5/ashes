/**
 * ═══ LA LUMIÈRE DE LA TORCHE — les COURBES, pures et testées (spec `torche.md`) ═══
 *
 * Aucune dépendance Phaser, comme `lighting.ts` dont ce module est le pendant portatif : ici
 * les nombres, ailleurs le rendu. La sim ne sait RIEN de tout ça (elle ne tient que l'horloge,
 * `TORCHE.BURN_TICKS`) — la lumière est un fait de rendu, et c'est le signe que le design est
 * juste : une torche qui éclairerait « dans la sim » serait une torche qui protège.
 *
 * ═══ ELLE EST LARGE ET FAIBLE — ET C'EST TOUT LE SUJET (révisé 2026-08-26) ═══
 *
 * *« Il faudrait doubler le diamètre de lumière de la torche et diminuer l'intensité de sa
 * lumière »* (Alexis, 2026-08-26). Les trois portées ont donc DOUBLÉ, et les trois intensités
 * ont été DIVISÉES PAR DEUX en échange.
 *
 * Le réglage d'avant tenait en un mot : PETITE. Le Feu creuse la nuit sur 6 tuiles, la torche
 * en creusait le tiers — 2 tuiles, un poing de flamme. La crainte est écrite en toutes lettres
 * dans `fireHoleRadius` : un trou trop large « effaçait la nuit à vingt-cinq tuiles » (décision
 * du 2026-08-03) — et ce trou-là ne bougeait pas. Celui-ci MARCHE avec le joueur : ce qu'il
 * efface, il l'efface partout où l'on va.
 *
 * CE QUI TIENT CETTE CRAINTE, MAINTENANT, CE N'EST PLUS LE RAYON MAIS LA FORCE. Le trou du
 * voile a deux leviers indépendants — jusqu'où il porte, et de combien il RETIRE (`VeilFire.
 * force`). On échange l'un contre l'autre : deux fois plus loin, deux fois moins profond
 * (`TORCHE_HOLE_FORCE`). Ce que le joueur y gagne, c'est de voir le relief venir de plus loin ;
 * ce que la nuit y garde, c'est de rester une nuit — sous la torche, le sol s'éclaircit sans
 * jamais retrouver son jour, et un Feu reste, à toute distance, la lumière franche.
 *
 * Ce qu'elle doit donner, ce n'est toujours pas de la visibilité pleine : c'est **de quoi
 * marcher**. On voit où l'on met les pieds et ce qui se dresse alentour, dans une lueur qui
 * reste basse. Au-delà, la nuit reste la nuit — c'est ce contraste-là qui la rend tenable au
 * lieu de la supprimer.
 *
 * ═══ ELLE AGONISE ═══
 *
 * `partDeFlamme` (partagée avec /sim — la MÊME courbe des deux côtés, jamais deux qui divergent)
 * descend de 1 à 0 sur la combustion. La lumière n'y répond PAS linéairement : elle tient, puis
 * lâche sur le dernier tiers (`AGONIE`). Une décroissance linéaire aurait fait faiblir la
 * torche dès le premier pas — ce qu'on veut, c'est que le joueur VOIE VENIR le noir, assez tôt
 * pour rentrer, mais pas au prix d'une flamme molle toute sa vie.
 */
import { flicker } from './lighting'

/** Le trou dans le voile de nuit — doublé le 2026-08-26 (2 → 4), voir l'en-tête. Il reste SOUS
 *  celui d'un Feu (6 × vacillement, donc jamais moins de 4,95) : un foyer doit rester, à
 *  distance égale, la lumière la plus franche du monde. */
export const TORCHE_HOLE_TILES = 4
/**
 * DE COMBIEN le trou de la torche RETIRE, en part de ce qu'un Feu retire (`HOLE_ERASE_PEAK`).
 *
 * C'est la contrepartie du rayon doublé, et elle vit ICI plutôt qu'au point d'appel : le
 * `force: 1` était écrit en dur dans `WorldScene`, c'est-à-dire dans une boucle de rendu, où
 * personne ne va chercher un réglage. Les deux nombres de la même décision doivent se lire
 * côte à côte, sans quoi on doublera le rayon une fois de plus sans toucher à la profondeur.
 */
export const TORCHE_HOLE_FORCE = 0.5
/** La flaque au sol : un peu plus large que le trou, pour qu'on ne voie pas son bord. */
export const TORCHE_POOL_TILES = 6
/** Le rayon du point light, en tuiles — ce qui allume les fûts et les corps autour. */
export const TORCHE_LIGHT_TILES = 10

/** Sous cette part de flamme, la torche entre en AGONIE et sa lumière lâche pour de bon. */
export const AGONIE = 0.34

/**
 * LA FORCE de la torche, de 0 à 1 — ce que TOUT le reste multiplie.
 *
 * Trois facteurs, et pas un de plus :
 *   • LA NUIT (`1 - day`) — de jour, une torche ne se voit pas. Elle ne s'éteint pas pour
 *     autant (le joueur la tient), mais elle n'ÉCLAIRE plus rien : le soleil l'a mangée.
 *     Même règle que la flaque du Feu, et pour la même raison — ne rien masquer de jour.
 *   • L'AGONIE (`part`) — pleine tant qu'il reste plus d'`AGONIE` de flamme, puis en chute
 *     jusqu'à zéro. Une rampe, pas une marche : on doit avoir le temps de voir et de rentrer.
 *   • LE VACILLEMENT — la MÊME `flicker` que les Feux (deux ondes incommensurables et un
 *     crépitement), pour qu'une flamme portée batte comme une flamme plantée. Elle passe par
 *     l'ALPHA, jamais par la taille : un rayon qui respire ferait grouiller la grille de pixels
 *     (la leçon de `fire-ground-glow`).
 */
export function forceDeTorche(part: number, day: number, timeMs = 0, seed = 0): number {
  if (part <= 0) return 0
  const nuit = Math.max(0, Math.min(1, 1 - day))
  const agonie = Math.min(1, Math.max(0, part) / AGONIE)
  return Math.max(0, Math.min(1, nuit * agonie * flicker(timeMs, seed)))
}

/**
 * Le trou que la torche creuse dans le voile, en tuiles.
 *
 * ⚠ IL NE VACILLE PAS EN TAILLE — `forceDeTorche` porte le battement dans l'alpha, ici on ne
 * garde que l'agonie, et par la RACINE : un disque perd sa surface au carré de son rayon, donc
 * une portée qui suivrait l'agonie linéairement se refermerait deux fois trop vite à l'œil.
 * (Le rayon tombe quand même à 0 avec la flamme — le monde se referme.)
 */
export function torcheHoleRadius(part: number, day: number): number {
  if (part <= 0) return 0
  const nuit = Math.max(0, Math.min(1, 1 - day))
  const agonie = Math.min(1, Math.max(0, part) / AGONIE)
  return TORCHE_HOLE_TILES * Math.sqrt(agonie) * nuit
}
