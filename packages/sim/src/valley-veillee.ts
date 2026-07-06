/**
 * La Vallée de la Veillée — le squelette artisanal de la carte solo
 * (design 2026-07-06). Coordonnées en tuiles, axe y vers le sud.
 *
 * Cinq régions : la Plaine (ouest, domestique), la Vieille Forêt (nord-ouest,
 * dense), les Collines du Levant (nord-est, la Mine), le Marais et le Lac
 * (sud), le Plateau (nord, derrière le Col). La rivière descend du nord et se
 * jette dans le Lac ; deux franchissements — le Pont (route) et le Gué.
 *
 * Les seuils de biome sont du contenu de carte, ajustés à l'œil au smoke
 * test — pas des nombres d'équilibrage (balance.ts).
 */
import type { ValleySkeleton } from './valleygen'

export const VEILLEE_SKELETON: ValleySkeleton = {
  width: 192,
  height: 192,
  borderThickness: 4,
  // La crête du Plateau, percée au Col (x 48-60) ; le bras est meurt dans la
  // gorge de la rivière — on peut remonter la berge à gué, c'est voulu.
  ridges: [
    { points: [{ x: 6, y: 38 }, { x: 48, y: 38 }], halfWidth: 2 },
    { points: [{ x: 60, y: 38 }, { x: 114, y: 38 }], halfWidth: 2 },
  ],
  river: {
    points: [
      { x: 118, y: 6 }, { x: 116, y: 28 }, { x: 112, y: 52 }, { x: 106, y: 76 },
      { x: 108, y: 100 }, { x: 114, y: 120 }, { x: 120, y: 138 }, { x: 126, y: 152 },
    ],
    halfWidth: 2,
  },
  lake: { x: 126, y: 152, r: 13 },
  roads: [
    // la grand-route ouest-est : Clairière → Croisée → Pont → l'Est
    [{ x: 22, y: 118 }, { x: 76, y: 118 }, { x: 146, y: 118 }, { x: 170, y: 118 }],
    // la route de la Mine, depuis l'est du Pont
    [{ x: 146, y: 118 }, { x: 150, y: 90 }, { x: 154, y: 60 }, { x: 156, y: 46 }],
    // le sentier du Gué : Croisée → nord → gué → les Collines
    [{ x: 76, y: 118 }, { x: 72, y: 90 }, { x: 84, y: 64 }, { x: 104, y: 48 }, { x: 122, y: 44 }, { x: 148, y: 44 }],
    // le sentier du Col : bifurcation vers le Plateau
    [{ x: 72, y: 90 }, { x: 62, y: 66 }, { x: 54, y: 44 }, { x: 50, y: 22 }],
    // le sentier du Hameau : Croisée → sud → le Marais
    [{ x: 76, y: 118 }, { x: 82, y: 132 }, { x: 90, y: 144 }, { x: 98, y: 154 }],
  ],
  crossings: [
    { kind: 'bridge', x: 113, y: 118 },
    { kind: 'ford', x: 113, y: 45 },
  ],
  clearings: [
    { x: 22, y: 116, r: 6 },   // la Clairière (spawn)
    { x: 38, y: 108, r: 7 },   // site du village Foyer
    { x: 146, y: 110, r: 7 },  // site du village Meute
    { x: 46, y: 130, r: 6 },   // site du village neutre (scénario)
    { x: 54, y: 37, r: 5 },    // le Col — toujours ouvert
    { x: 150, y: 40, r: 6 },   // futur site de village dans les Collines dégagées
  ],
  ruins: [
    { x: 86, y: 138 },
    { x: 93, y: 143 },
  ],
  // Réseau d'eau procédural (scalable) : ruisseaux et étangs rares.
  water: { streamDensity: 0.0008, pondDensity: 0.0004 },
  // Mines ancrées côté bordure : une profonde (gisement fer+charbon, ancrée
  // côté est, près des Collines) + des carrières procédurales.
  // TODO (suivi mine): creuser réellement dans la roche + longueur de galerie
  // ∝ borderThickness — aujourd'hui la galerie est un sentier à ciel ouvert
  // adjacent à la roche, pas un tunnel creusé dedans (voir valleygen-mines.ts).
  // simpleDensity à 0.15 (une carrière, côté ouest) — calibré au banc de
  // scénario : à 0.3 (deux carrières), la seconde tombe côté est dans la
  // bande de lignes du Clan du Levant (Meute) et, par ricochet du flux RNG
  // séquentiel de generateNodes (une passe ligne par ligne sur toute la
  // carte), y ré-attribue son écosystème vivrier — le village s'effondre en
  // 6 jours (45 échantillons affamés, 0 survivant). À 0.15, une seule
  // carrière (côté ouest, loin des sites) : banc de scénario propre (0
  // échantillon affamé). La mine profonde seule (sans carrière) est neutre —
  // testé isolément, mêmes résultats que sans mine du tout.
  mines: {
    deep: [{ x: 178, y: 46, toward: 'right' }],
    simpleDensity: 0.15,
  },
  regions: [
    { x: 8, y: 8, w: 100, h: 28, forest: 0.42, rock: 0.1 },    // le Plateau
    { x: 8, y: 40, w: 100, h: 56, forest: 0.62, rock: 0.04 },  // la Vieille Forêt
    { x: 126, y: 8, w: 60, h: 84, forest: 0.3, rock: 0.06 },   // les Collines — dégagées, habitables
    { x: 8, y: 96, w: 112, h: 52, forest: 0.35, rock: 0.03 },  // la Plaine
    { x: 56, y: 148, w: 88, h: 38, marsh: 0.55, forest: 0.1 }, // le Marais
  ],
  landmarks: [
    // Les spécifiques d'abord : zoneAt prend la première zone contenante,
    // et generateNodes lit kind='gisement' via zoneAt.
    { name: 'la Clairière', x: 16, y: 110, w: 12, h: 12 },
    { name: 'la Croisée', x: 72, y: 114, w: 9, h: 9 },
    { name: 'le Pont', x: 108, y: 113, w: 11, h: 10 },
    { name: 'le Gué', x: 108, y: 40, w: 11, h: 10 },
    { name: 'le Col', x: 48, y: 30, w: 12, h: 14 },
    { name: 'le Hameau abandonné', x: 84, y: 136, w: 14, h: 12 },
    // Le gisement (fer + charbon) vit désormais dans la galerie profonde
    // ancrée côté bordure (champ `mines`) — ce landmark redevient un simple
    // repère toponymique, sans rôle mécanique.
    { name: 'la Mine du Levant', x: 146, y: 36, w: 16, h: 14 },
    { name: 'la Tanière des Sangliers', kind: 'taniere', x: 34, y: 64, w: 6, h: 6 },
    { name: 'la Vieille Tanière', kind: 'taniere', x: 58, y: 82, w: 6, h: 6 },
    { name: 'le Lac', x: 113, y: 139, w: 26, h: 26 },
    // Les régions ensuite — le HUD nomme la région quand rien de plus précis.
    { name: 'le Plateau', x: 8, y: 8, w: 100, h: 28 },
    { name: 'la Vieille Forêt', x: 8, y: 40, w: 100, h: 56 },
    { name: 'les Collines du Levant', x: 126, y: 8, w: 60, h: 84 },
    { name: 'le Marais', x: 56, y: 148, w: 88, h: 38 },
    { name: 'la Plaine', x: 8, y: 96, w: 112, h: 52 },
  ],
}

/** Les sites du scénario — où l'hôte pose spawn, villages et monstres. */
export const VEILLEE_SITES = {
  spawn: { x: 22.5, y: 116.5 },
  foyer: { x: 38, y: 108 },
  meute: { x: 146, y: 110 },
  neutre: { x: 46, y: 130 },
  boars: [
    { x: 36, y: 66 }, { x: 60, y: 84 }, { x: 46, y: 74 },
  ],
  zombies: [
    { x: 90, y: 142 }, { x: 86, y: 148 },          // le Hameau
    { x: 100, y: 158 }, { x: 118, y: 172 },        // le Marais
    { x: 40, y: 20 }, { x: 65, y: 17 },            // le Plateau
  ],
}
