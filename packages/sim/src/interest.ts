/**
 * LA ZONE D'INTÉRÊT — chacun ne reçoit que ce qui se passe autour de lui.
 *
 * Le snapshot partait ENTIER à chaque client, vingt fois par seconde : toutes les bêtes de
 * la vallée, y compris celles à deux mille tuiles. MESURÉ sur le monde de production à
 * 8 joueurs : **4,76 Mo/s par client**, et `entities` à lui seul 68 % du poids. À 50 joueurs
 * (`MAX_PLAYERS`) c'est intenable — et ça n'a jamais servi à rien, puisque le client ne
 * dessine que sa fenêtre de caméra.
 *
 * DEUX GAINS POUR UN. Le premier est la bande passante. Le second est l'ANTI-TRICHE : un
 * client modifié ne peut plus lire la position des joueurs qu'il ne devrait pas voir — on
 * ne peut pas tricher sur ce qu'on n'a pas reçu. C'est ce que la roadmap appelle
 * « interest management (anti-ESP) ».
 *
 * ── CE QUI EST FILTRÉ, ET CE QUI NE L'EST PAS ───────────────────────────────────
 *
 * FILTRÉ (spatial et volumineux) : `entities`, `monsters`, `npcs`, `blood`, `groundItems`,
 * `refugeeGroups`. `monsters` et `npcs` suivent EXACTEMENT le sort de leur entité — garder
 * la fiche d'une bête dont le corps n'est plus transmis ne dessinerait rien et coûterait
 * quand même.
 *
 * PAS FILTRÉ, et chaque exception a sa raison :
 *   • `nodeDeltas` — c'est un DIFF. Un delta jeté n'est jamais rejoué : le client garderait
 *     à vie un stock faux pour ce nœud. Un état différentiel ne se filtre pas dans l'espace.
 *   • `events` — le flux de domaine alimente la chronique, l'alignement et le HUD. Un
 *     village fondé à l'autre bout de la vallée est une nouvelle qui doit arriver.
 *   • `structures`, `villages`, `functions` — la géographie bâtie ; le client s'en sert
 *     au-delà de sa vue (carte, overlay des fonctions), et elle pèse ~0 % du snapshot.
 *   • `corpses` — LE CAS QUI COÛTE, et on l'assume. Le client SUIT son propre cadavre pour
 *     savoir s'il a été pillé (`WorldScene`, `myCorpseId`), or on ressuscite au Feu, parfois
 *     loin de son corps : filtrer les cadavres ferait croire au joueur que le sien a disparu.
 *     Un `Corpse` ne porte pas l'identité du mort, le serveur ne peut donc pas faire
 *     l'exception proprement. Le jour où il la portera, les cadavres rejoindront le filtre.
 *
 * PUR — aucune horloge, aucune E/S, aucun Math approximé (distance au carré, `+` et `*`).
 */
import type { SnapshotMessage } from './protocol'

/**
 * LE RAYON, en tuiles, et d'où il sort.
 *
 * La caméra montre `VISIBLE_TILES_TALL = 20` tuiles de haut ; en 16:9 cela fait ~36 tuiles
 * de large, soit une demi-diagonale de ~20 tuiles depuis l'avatar. On prend **64** : plus
 * de TROIS FOIS la demi-diagonale. Rien ne peut donc apparaître ou disparaître dans le
 * champ de vision — ce qui franchit la frontière est déjà largement hors écran, y compris
 * avec l'avance de caméra au pointeur et les grands sprites qui débordent.
 *
 * Ce n'est pas un réglage de confort : le descendre ferait « popper » des acteurs à l'écran,
 * et c'est le genre de défaut qu'on ne voit qu'en jouant. Le monter ne coûte que du fil.
 */
export const INTEREST_RADIUS_TILES = 64

/** Distance au carré — pas de `Math.hypot` (interdit dans /sim : non déterministe entre moteurs). */
function loin(ax: number, ay: number, bx: number, by: number, r2: number): boolean {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy > r2
}

/**
 * Le snapshot vu DEPUIS un point — les collections spatiales rognées au rayon d'intérêt.
 *
 * Le corps commun est partagé par référence : on ne recopie que les tableaux qu'on rogne,
 * et seulement quand ils changent réellement (une collection entièrement dans le rayon est
 * rendue telle quelle, sans allocation). À 50 joueurs, l'immense majorité des ticks ne
 * réalloue donc que ce qui bouge.
 */
export function filtreParInteret<T extends Omit<SnapshotMessage, 'lastProcessedInput'>>(
  base: T,
  centre: { x: number; y: number },
  rayonTuiles: number = INTEREST_RADIUS_TILES,
): T {
  const r2 = rayonTuiles * rayonTuiles
  const proche = (p: { x: number; y: number }): boolean => !loin(p.x, p.y, centre.x, centre.y, r2)

  const entities = base.entities.filter(proche)
  // Rien n'est sorti : on rend le corps commun tel quel, sans une allocation.
  if (entities.length === base.entities.length) return base

  const vivants = new Set<number>()
  for (const e of entities) vivants.add(e.id)
  const suitSonCorps = (o: { entityId: number }): boolean => vivants.has(o.entityId)

  return {
    ...base,
    entities,
    monsters: base.monsters.filter(suitSonCorps),
    npcs: base.npcs.filter(suitSonCorps),
    blood: base.blood.filter(proche),
    groundItems: base.groundItems.filter(proche),
    // Les réfugiés sont posés en TUILES (`tx`/`ty`), pas en coordonnées continues.
    refugeeGroups: base.refugeeGroups.filter((g) => !loin(g.tx, g.ty, centre.x, centre.y, r2)),
  }
}
