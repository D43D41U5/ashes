/**
 * ═══ LES BIOMES DES LUCIOLES — une règle, pas une liste choisie ═══
 *
 * Extrait de `ambient-life.ts` (qui importe Phaser) pour être PUR, donc prouvé : la garde
 * `firefly-biomes.test.ts` balaie les 31 terrains de `TERRAINS` et affirme la règle sur
 * CHACUN, au lieu d'inspecter les neuf ids qu'on a écrits. Un terrain neuf ajouté à une
 * famille exclue rougit de lui-même — c'est tout l'intérêt.
 */
import {
  TERRAIN_GRASS,
  TERRAIN_MARSH,
  TERRAIN_HEATH,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_PEAT_BOG,
  TERRAIN_REED_MARSH,
  TERRAIN_WET_MEADOW,
  TERRAIN_JUNIPER_HEATH,
  TERRAIN_CLAIRIERE,
} from '@ashes/sim'

/**
 * ═══ OÙ LES LUCIOLES DAIGNENT VIVRE : LE DÉCOUVERT (Alexis, 2026-08-26) ═══
 *
 * *« déplace les lucioles vers les biomes sans arbres, sans neige et sans cendre »* — donc
 * les prés, les landes et les fonds humides, et plus le sous-bois. Trois exclusions, trois
 * raisons distinctes, et aucune n'est de la prudence :
 *
 * - **SANS ARBRES** — futaie, pins, mélèzes, vieille sylve, saulaie et futaie morte sortent.
 *   Une saulaie est un BOIS (des saules restent des arbres) : elle sort avec les autres,
 *   même si la berge humide est un habitat de manuel. La clairière RESTE : c'est la trouée,
 *   elle n'a par définition pas d'arbre — mais c'est un trou DANS le bois, donc les lucioles
 *   y gardent un pied. À rouvrir si on les veut franchement hors forêt.
 * - **SANS NEIGE** — `snow` et `glacier` n'ont jamais été là, et le haut pays non plus :
 *   `alpine_meadow` et `alpine_flowers` sont des prés sans arbre, mais ce sont les prés du
 *   Névé, cernés de neige. Une nuée qui grésille au bord d'un glacier dit « décor posé au
 *   hasard » aussi fort qu'une nuée SUR le glacier.
 * - **SANS CENDRE** — les trois cendres, la futaie morte et le chaos de blocs de la
 *   Cendrière sortent. ⚠ **LA LISTE N'Y SUFFIT PAS** : `map.terrain` n'est jamais muté (voir
 *   `carte-immuable.test.ts`), la cendre est DÉRIVÉE au rendu. Qui interroge la carte trouve
 *   `grass` sur un sol cendré. C'est le `sample` passé au constructeur qui doit rendre le sol
 *   VU (`PaveLayer.terrainAffiche`) — sans quoi cette exclusion-ci est un commentaire.
 *
 * ⚠ **`heath` et `peat_bog` sont à 0 % de la vallée jouée aujourd'hui** (mesuré, graines
 * 2026/7/31, monde `racine`) : ils sont ici parce que la règle est un BIOME, pas une liste
 * choisie — le jour où une zone les porte, les lucioles y sont déjà.
 */
export const FIREFLY_TERRAINS: ReadonlySet<number> = new Set([
  TERRAIN_GRASS, // — 31 % de la vallée à elle seule : c'est elle qui change tout (voir plus bas)
  TERRAIN_FLOWER_MEADOW, //
  TERRAIN_WET_MEADOW, // — le pré mouillé : l'habitat de manuel, et il en reste 2,9 %
  TERRAIN_JUNIPER_HEATH, //
  TERRAIN_MARSH, //
  TERRAIN_REED_MARSH, //
  TERRAIN_PEAT_BOG, // — 0 % dans la Racine
  TERRAIN_HEATH, // — 0 % dans la Racine (le mot du gradient sud et du sol des Ruines)
  TERRAIN_CLAIRIERE, // — la trouée du bois au crépuscule : c'est LÀ qu'on voit des lucioles
])

/**
 * ⚠ CE QUE CE JEU DE TERRAINS FAIT AU RYTHME DES NUITS — mesuré, pas estimé (graines 2026/7/31,
 * 400 positions de joueur tirées sur du praticable, les 24 tirages de `findSwarmSpot`) :
 *
 *     ancien (le bois)  : 12,2–13,3 % de la vallée   →  P(un essaim se pose) = 50–62 %
 *     neuf (le découvert): 45,5–47,5 % de la vallée  →  P(un essaim se pose) = 99–100 %
 *
 * `MAX_SWARMS` plafonne toujours à trois : ce n'est pas la DENSITÉ qui change, c'est la
 * FRÉQUENCE. Une nuit sur deux sans lucioles devient toutes les nuits avec — y compris au pied
 * du village. Le « beaucoup de nuit entre eux » d'au-dessus n'est plus garanti par la
 * géographie, seulement par `SWARM_SEPARATION`. Si on veut retrouver la rareté, le bouton est
 * `1 grass` : sans elle le découvert retombe à ~18 % (les prés fleuris, les landes et l'humide),
 * juste au-dessus de l'ancien bois. C'est un réglage de JEU, donc une décision d'Alexis.
 */
