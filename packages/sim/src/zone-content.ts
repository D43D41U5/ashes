/**
 * LE CONTENU DES ZONES — « loin » ne veut plus dire « plus ». Ça veut dire LE SEUL ENDROIT.
 *
 * LE GRIEF QU'ON RÉPARE ICI, et il était arithmétique. Le GDD promettait trois cercles : au
 * camp la récolte est médiocre, la richesse est au loin. Le code le mettait en œuvre par
 * `circleFactor`, qui multipliait le **stock d'un nœud**. Deux chiffres l'annulaient :
 *
 *   • `WILD_RADIUS = 70` tuiles sur une carte de 1200×1800 — le pas de la porte. Pas un
 *     gradient : une marche, franchie dès la première sortie.
 *   • `CARRY.CAPACITY = 30` et `ITEM_WEIGHT.wood = 1` — un sac plein fait trente bois **où
 *     qu'on soit**. Multiplier le stock d'un nœud lointain par 3,6 ne changeait donc RIEN à ce
 *     qu'on rapportait : *on revenait avec trente bois du bout du monde comme du coin du feu.*
 *
 * D'où : `circleFactor` et `WILD_RADIUS` sont **supprimés** (décision d'Alexis). La rareté
 * devient GÉOGRAPHIQUE. La ressource structurante d'une zone n'existe **nulle part ailleurs** —
 * et elle est LOURDE (3 unités le fût, 3 le bloc taillé : un sac n'en ramène que dix). La zone
 * dit OÙ ; le poids dit COMBIEN. Les deux verrous se répondent, et le portage redevient un jeu.
 *
 * ET LE TEASER. Dans la zone de départ, **un** filon de fer, dérisoire, épuisé en une heure.
 * Il ne sert pas à s'équiper — il sert à dire : *« ça existe. Pas ici. »* C'est le moteur
 * d'exploration le moins cher jamais inventé, et c'est une demande explicite du directeur de
 * jeu (« on peut lui montrer que certaines ressources existent dans des endroits pas naturels,
 * de manière très limitée, pour ouvrir une petite fenêtre »).
 *
 * Pur et déterministe : `hash2`/`fbm2`, `+ - * / sqrt` (invariant n°2).
 */
import {
  FAUNA,
  NODE_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SCREE,
  TERRAIN_WET_MEADOW,
  TERRAIN_WILLOW,
  TERRAIN_SHALLOW_WATER,
  TERRAIN_DEEP_WATER,
  TERRAINS,
  type NodeType,
} from './balance'
import { estCendre } from './cendre'
import type { ResourceNode } from './economy'
import { distSq } from './geometry'
import { profondeurAt, terrainAt, type WorldMap } from './map'
import { fbm2, hash2 } from './noise'
import { estCoeur, estLisiere, TERRAINS_BOISES_MASSIF, TERRAINS_FEUILLUS } from './profondeur'
import { CREUX } from './racine-relief'
import { RELIEF, type CarteZonee } from './zonegen'
import { EAU, estUnCoude } from './zonegen-water'
import { MONDE } from './zonegraph'

export const CONTENU = {
  /**
   * UN NŒUD TOUS LES ~N TUILES MARCHABLES. **Et il valait 7 — c'était une moquette.**
   *
   * Mesuré (et jamais avant, ce qui est la vraie faute) : **335 752 nœuds**, soit un buisson
   * toutes les **6,1 tuiles marchables**. Le sol de la vallée était pavé de baies. Alexis, en
   * jouant : *« la densité de ressources est délirante dans la zone de départ. »*
   *
   * 36 → ~62 000 nœuds, un tous les ~31 pas. La récolte redevient un DÉPLACEMENT : on cherche un
   * bosquet, on y va, on le vide. C'est le geste que le jeu veut, et il était noyé sous l'abondance.
   *
   * (La modulation par bosquets — `ECHELLE_BOSQUET` — les GROUPE : la densité moyenne ne dit pas
   * ce qu'on voit. On voit des bouquets d'arbres et des prés nus, pas un tapis régulier.)
   */
  PAS_SEMIS: 36,
  /** Échelle des bosquets : les nœuds se GROUPENT (une forêt, un filon), ils ne se saupoudrent
   *  pas. Un tapis uniforme n'est pas un pays, c'est une moquette. */
  ECHELLE_BOSQUET: 34,

  /**
   * LES ARBRES DE LA RACINE — récoltables, et posés à DEUX densités selon le sol (demande
   * d'Alexis, 2026-07-18). Ce sont de vrais nœuds `tree`, pas du décor : on veut du bois qu'on
   * COUPE, pas des conifères qu'on regarde.
   *
   *   • `FORET_PAS` — sur la forêt de la racine (ses bosquets), DENSE : une vraie futaie de bois.
   *   • `PRE_PAS`   — sur l'herbe du pré, ÉPARS : quelques arbres qui ponctuent la plaine sans la
   *                   boiser (le sol reste un pré ; ils n'y comptent d'ailleurs pas pour fonder un
   *                   village, cf. `emplacementsDeVillage`).
   *
   * `ECHELLE` = la taille des groupes quand les arbres se rassemblent. `PAS` GRAND = rare.
   */
  ARBRES_FORET_PAS: 5,
  ARBRES_PRE_PAS: 90,
  ARBRES_ECHELLE: 22,

  /**
   * LES CLAIRIÈRES DE LA FORÊT — un couvert plein, MAIS troué de clairières RECTANGULAIRES et
   * irrégulières (demande d'Alexis, 2026-07-18 — le grain « RimWorld » de la carte).
   *
   * La décision « clairière ? » se prend par BLOC (le motif de 8 tuiles, comme tout le terrain) :
   * une clairière est donc, par construction, un rectangle ; des blocs voisins se fondent en
   * clairières plus grandes, aux contours en marches d'escalier. `ECHELLE` règle leur taille,
   * `SEUIL` la part de forêt qu'elles évident (plus il est BAS, plus il y a de clairières).
   */
  CLAIRIERE_ECHELLE: 34,
  CLAIRIERE_SEUIL: 0.62,

  /** Le teaser : UN filon, et son stock est dérisoire. Épuisé en une heure. */
  /** La densité d'un VERGER : un buisson toutes ~3 tuiles de son emprise. Assez dense pour que
   *  le trouver soit une aubaine (c'est une récompense d'exploration), assez épars pour rester
   *  un bosquet et non un mur de fruits. Calibration. */
  VERGER_DENSITE: 0.34,
  TEASER_STOCK: 3,

  /**
   * L'ÉCONOMIE DU MONDE RÉDUIT (t0-exploration §2sexies) — les comptes de nœuds des trois
   * dérivations : minerais SUR la rocaille des affleurements (R48), carrières AU PIED de
   * l'enceinte (R49), vieux fûts AU CŒUR des massifs (R50). Ordres de grandeur — le calibrage
   * se fait en regardant la carte, et les planchers de R51 sont gardés par A28.
   */
  /** Nœuds par affleurement. 4 × stock 8 = 32 coups par butte : un filet, pas une mine. */
  AFFL_NOEUDS: 4,
  /** Les BLOCS d'une butte (décision d'Alexis 2026-08-18 : « un bloc = une tuile pleine de
   *  non traversable ») : de VRAIS nœuds `bloc` pleine tuile, en trois tailles — ils bloquent
   *  tant qu'ils ont du stock et se taillent en pierre. 10 depuis la purge du décor pierreux
   *  (« trop de cailloux-clutter ») : c'est EUX qui peuplent la butte, personne d'autre. */
  AFFL_BLOCS: 10,
  /** Postes de carrière le long de l'enceinte, écartés au max-min. */
  CARRIERES: 3,
  /** Nœuds `quarry` par poste (stock 6 chacun). */
  CARRIERE_NOEUDS: 3,
  /** Rayon de pose autour d'un poste de carrière, en tuiles. */
  CARRIERE_RAYON: 6,
  /** Vieux fûts (`old_tree`, stock standard) aux cœurs des massifs — hors Bois Noir (le
   *  teaser R11 garde son récit : « le gros bois existe. Pas ici. »). */
  VIEUX_FUTS: 2,

  /**
   * LES CHAMPIGNONS (spec recolte-maitrise verbe 3) — un patch tous les X tuiles LIBRES, par
   * terrain. ABONDANT à l'humide et à l'ombre franche (marais, tourbière, roselière, sous-bois de
   * vieille sylve) ; TRÈS RARE sur le sol des forêts ordinaires (demande d'Alexis : quelques-uns
   * dans les bois de la zone T0, une curiosité qu'on croise tôt). Posés en PASSE SÉPARÉE, appendue,
   * positionnelle — la table `CONTENUS` n'est pas touchée, aucun nœud existant ne bouge. Calibration.
   */
  CHAMPIGNON_HUMIDE: 0.06,
  CHAMPIGNON_FORET: 0.006,

  /**
   * LA FIBRE DES PRAIRIES HUMIDES (spec t0-exploration §2ter R34) — la prairie humide est LA
   * place à fibre de la T0 : la ressource des bandages a un endroit, au lieu d'un saupoudrage
   * uniforme. Passe appendue, positionnelle ('FIBR'), même patron que les champignons : la
   * table `CONTENUS` n'est pas touchée, aucun nœud existant ne bouge. Chance par tuile libre.
   * 0.03 → 0.08 avec R34bis : l'affinité éclaircit la fibre du pré sec, la prairie CONCENTRE
   * en face — le total reste du même ordre, l'endroit devient lisible.
   */
  FIBRE_PRAIRIE: 0.08,

  /**
   * L'AFFINITÉ DU SEMIS COMMUN DE LA RACINE (spec t0-exploration §2ter R34bis, demande
   * d'Alexis 2026-08-18 : « équilibré mais logique »). Le saupoudrage que R34 dénonçait pour
   * la fibre valait pour TOUT le commun du pré : baies, fibre et pierre tombaient n'importe
   * où, et la carte des ressources était un bruit blanc (mesuré, seed 2026 : aucune structure
   * spatiale hors champignons/feuilles). Le tirage du TYPE ne change pas — la table de la
   * zone reste la loi — mais une ressource tirée là où elle n'a PAS de raison d'être est
   * ÉCLAIRCIE (facteur < 1, tirage positionnel 'AFIN') :
   *   — la FIBRE veut l'humide : plein régime aux mots mouillés et au bord de l'eau ;
   *   — la BAIE veut le bord et la lande : plein régime en lande/bruyère et au contact des bois ;
   *   — la PIERRE veut le relief : plein régime en lande (R34 : « sa pierre ») et au pied du rocheux.
   * Les passes appendues CONCENTRENT en face (FIBRE_PRAIRIE, BAIES_LISIERE renforcées).
   * RACINE SEULE : les tables des zones T1/T2 ne bougent pas d'un nœud (A14/A15 intacts).
   */
  /** Rayon (Chebyshev) du « au contact de » : bois, eau, rocheux. 2 = la portée d'un regard. */
  AFFINITE_RAYON: 2,
  /** La fibre du pré sec, loin de toute eau : ce qui reste du saupoudrage. */
  AFFINITE_FIBRE_SEC: 0.25,
  /** La baie de plein champ, loin des bois et hors lande. */
  AFFINITE_BAIE_OUVERT: 0.25,
  /** La pierre de plaine, hors pierrier et loin de tout relief. */
  AFFINITE_PIERRE_OUVERT: 0.15,
  /**
   * LES PIERRIERS DU PRÉ — le pré n'a presque pas de relief à toucher : l'éclaircie seule ne
   * dessinerait rien (mesuré : 28 % de pierre « logique », le reste en bruit). La vérité
   * géologique d'un fond de vallée est le CHAMP DE BLOCS erratiques : un champ basse
   * fréquence ('PIER') élit des nappes où la pierre garde plein régime — on cherche un
   * pierrier comme on cherche un bosquet. Même grammaire que ECHELLE_BOSQUET.
   */
  PIERRIER_ECHELLE: 30,
  PIERRIER_SEUIL: 0.66,
  /** La chance par tuile libre D'UN PIERRIER (passe appendue 'PIRR') : le champ de blocs est
   *  plus dense que ne l'était le saupoudrage — on le voit de loin, on y va, on le vide. */
  PIERRIER_CHANCE: 0.025,

  /**
   * LA PROFONDEUR PORTE DU JEU (spec t0-exploration §2quater R40). Le VIEUX FÛT : facteur de
   * stock des arbres du cœur (`stockDArbre` — fonction pure de la position, appliquée au
   * semis ET réappliquée à la repousse). Les CHAMPIGNONS DU CŒUR ('COEU') et les BAIES DE
   * LISIÈRE ('LISI') : chance par tuile libre, passes appendues en queue — patron 'FIBR'.
   * CHAMPIGNON_COEUR se lit contre CHAMPIGNON_FORET (0.006) : le cœur est ×5 le régime
   * commun, sans atteindre l'humide franc (0.06).
   */
  VIEUX_FUT_FACTEUR: 1.5,
  CHAMPIGNON_COEUR: 0.03,
  /** 0.015 → 0.03 avec R34bis : la lisière est LE bord à baies — elle concentre ce que
   *  l'affinité retire au plein champ. */
  BAIES_LISIERE: 0.03,

  /**
   * LES TAS DE FEUILLES (forêts-vivantes §1 R1 — sel 'FEUI') : la fouille du sous-bois,
   * dans la bande du CORPS des feuillus — la seule bande sans objet propre (la lisière a
   * ses baies, le cœur ses champignons). Chance par tuile libre, passe appendue en queue.
   */
  TAS_FEUILLES: 0.02,

  /**
   * LES COINS DE PÊCHE (spec `peche.md` P3/P4 — sel 'PECH'). Réglage de GÉNÉRATEUR : il se
   * calibre en regardant une carte (combien de coins sur la rivière, combien par lac), pas en
   * jouant — c'est la ligne de partage de `balance.ts`.
   */
  /** Rivière : deux coudes retenus sont séparés d'au moins ce nombre de PAS DE FIL. Une poignée
   *  de coins sur toute la rivière, pas un par méandre. */
  PECHE_ESPACEMENT_FIL: 40,
  /** Lac : un coin, plus un par tranche de ce nombre de tuiles de BERGE candidates (haut-fond
   *  touchant le profond, hors rivière) — un lac de 45×45 a ~180 tuiles de berge, donc deux… */
  PECHE_BERGE_PAR_COIN: 150,
  /** …plafonné à ce nombre par lac, … */
  PECHE_MAX_PAR_LAC: 3,
  /** …et deux coins d'un même lac sont écartés d'au moins ce Chebyshev. */
  PECHE_ESPACEMENT_LAC: 24,
  /** Une tuile profonde à moins de ce rayon Chebyshev du fil appartient à la RIVIÈRE (pas au lac). */
  PECHE_RAYON_RIVIERE: 2,

  /**
   * UN EMPLACEMENT DE VILLAGE : ce qu'il lui faut sous la main, et sur quel rayon.
   *
   * **CES SEUILS SONT COUPLÉS À `PAS_SEMIS`, et je l'avais oublié.** En divisant la densité de
   * nœuds par cinq (elle était délirante), j'ai rendu ces minimums cinq fois plus durs à
   * atteindre sans y toucher : les Prés Bas ne portaient plus que **11 emplacements pour 17
   * villages**. La garde A17 l'a dit tout de suite — c'est exactement à ça qu'elle sert.
   *
   * On élargit donc le RAYON (un village regarde plus loin autour de lui, ce qui est de toute
   * façon plus juste : quarante tuiles, c'est dix secondes de marche) et on rabaisse les
   * minimums en proportion.
   */
  RAYON_VILLAGE: 40,
  BOIS_MIN: 4,
  PIERRE_MIN: 2,
  /**
   * UN SITE TENABLE (worldgen R17bis, question ③ de la calibration de saison) : les baies de
   * la maille de fondation — un village PNJ n'a QU'UNE source de nourriture, il ne chasse
   * pas — et l'écart au RECTANGLE d'un lieu à monstre résident (tanière, repaire). L'écart au
   * coin de chasse, lui, n'a pas de constante ici : il se DÉRIVE de la faune
   * (`GROUND_RADIUS + SPAWN_RING_MAX` — la portée exacte à laquelle la présence des
   * villageois fait naître des loups), et il doit suivre ces constantes s'il bougent.
   * MESURÉ (banc, 4 graines) : les villages viables portent 5-20 baies en maille ; 4 exclut
   * le désert sans toucher un seul site sain. Tanière à 44 tuiles : village à effectif
   * plein ; 32 est un plancher de bon sens, pas une peur.
   */
  BAIES_MIN: 4,
  ECART_NID: 32,
  /**
   * PLACE NETTE autour du foyer : on ne fonde pas un village dans un couloir.
   *
   * 5 → un carré de 11×11 tout marchable. Il valait 7 (15×15), et les BUTTES l'ont rendu trop
   * dur : leurs parois hachent la plaine, et les Prés Bas ne portaient plus que 15 emplacements
   * pour 17 villages. Onze tuiles suffisent largement au Feu, au coffre et aux six maisons
   * (`foundNpcVillage` les pose à ±3) — quinze était du confort, pas un besoin.
   */
  DEGAGEMENT: 5,
  /** Pas du balayage des emplacements. Fin : un village fait dix tuiles de large, et chercher
   *  tous les douze pas en manquait. */
  PAS_BALAYAGE: 8,
}

/**
 * CE QUE CHAQUE ZONE DONNE. `structurant` n'existe nulle part ailleurs (R9) ; `commun` est le
 * fond de subsistance ; `liaison` est partagé et **déclaré** (le charbon, au Karst *et* au
 * Versant Brûlé — une couture, pas un relâchement : deux zones qu'un même besoin relie donnent
 * au joueur un CHOIX DE ROUTE).
 *
 * UNE ZONE PEUT NE RIEN DONNER, et c'est un outil, pas un oubli : le Névé et les seuils ne
 * nourrissent rien — c'est ce qui rend un village impossible dedans **sans qu'aucune règle ne
 * l'interdise**. On ne dit jamais non au joueur ; on rend l'endroit inhabitable par ce qui n'y
 * pousse pas.
 */
interface ContenuZone {
  /** La ressource qui DÉFINIT la zone. Exclusive. Rare (elle vaut le voyage). */
  structurant?: { type: NodeType; part: number }
  /** Partagée avec d'autres zones, et déclarée. */
  liaison?: { type: NodeType; part: number }[]
  /** Le fond de subsistance : bois, pierre, fibre, baies. Des parts, normalisées. */
  commun: Partial<Record<NodeType, number>>
}

export const CONTENUS: Record<string, ContenuZone> = {
  // ── T0 : LA RACINE. Tout le commun, en abondance. Rien d'autre. ──
  // (Le teaser de fer s'y ajoute à la main : il est unique, il ne se sème pas.)
  pres_bas: { commun: { tree: 0.42, rock: 0.16, fiber_plant: 0.22, berry_bush: 0.2 } },

  // ── T1 : LA CEINTURE. Chacune donne ce que les autres n'ont pas. ──
  sylve: { structurant: { type: 'old_tree', part: 0.3 }, commun: { tree: 0.5, fiber_plant: 0.14, berry_bush: 0.06 } },
  karst: {
    structurant: { type: 'iron_vein', part: 0.3 },
    liaison: [{ type: 'coal_seam', part: 0.18 }],
    commun: { rock: 0.44, fiber_plant: 0.08 },
  },
  tourbiere: { structurant: { type: 'peat_cut', part: 0.34 }, commun: { fiber_plant: 0.4, berry_bush: 0.16, tree: 0.1 } },
  alpages: { structurant: { type: 'quarry', part: 0.28 }, commun: { rock: 0.3, fiber_plant: 0.32, berry_bush: 0.1 } },
  brule: {
    structurant: { type: 'ash_heap', part: 0.34 },
    liaison: [{ type: 'coal_seam', part: 0.16 }],
    // `berry_bush` : les baies des PIONNIERS (stratigraphie S-R20) — `terrainAdmet` les refuse
    // au calciné et les donne à la lande et à l'herbe des stades : la reprise se RÉCOLTE, le
    // gradient de succession est aussi un gradient de garde-manger.
    commun: { tree: 0.28, rock: 0.1, fiber_plant: 0.08, berry_bush: 0.12 },
  },
  ruines: { structurant: { type: 'rubble', part: 0.3 }, commun: { rock: 0.34, fiber_plant: 0.2, tree: 0.16 } },

  // ── T2 : LES MARGES. Le contenu se décidera ; la carte lui MÉNAGE LA PLACE (spec §11).
  //    En attendant, elles portent de quoi survivre en expédition — et rien de plus.
  cendriere: { commun: { tree: 0.4, rock: 0.6 } },
  glacier: { commun: { rock: 1 } },
  aiguilles: { commun: { rock: 1 } },
  gouffre: { commun: { rock: 1 } },
  lac_mort: { commun: { fiber_plant: 0.6, berry_bush: 0.4 } },
}

/** Le terrain admet-il ce nœud ? Un arbre ne pousse pas dans un éboulis. */
function terrainAdmet(type: NodeType, terrain: number): boolean {
  const def = TERRAINS[terrain]
  if (!def?.walkable) return false
  const n = def.name
  switch (type) {
    case 'tree':
    case 'old_tree':
      return n === 'forest' || n === 'old_growth' || n === 'pine' || n === 'larch' || n === 'burnt_forest' || n === 'willow'
    case 'berry_bush':
      return n !== 'snow' && n !== 'scree' && n !== 'boulders' && n !== 'shallow_water'
    case 'fiber_plant':
      return n !== 'snow' && n !== 'scree' && n !== 'shallow_water'
    case 'peat_cut':
      return n === 'peat_bog' || n === 'reed_marsh' || n === 'marsh'
    case 'rock':
    case 'bloc':
    case 'quarry':
    case 'iron_vein':
    case 'coal_seam':
    case 'rubble':
      return n !== 'shallow_water' && n !== 'peat_bog' && n !== 'reed_marsh'
    case 'ash_heap':
      return n === 'burnt_forest' || n === 'heath'
    case 'leaf_pile':
      // La litière des FEUILLUS (forêts-vivantes §1) : le sec ne fait pas de tas.
      return n === 'forest' || n === 'old_growth' || n === 'willow'
    case 'champignon':
      // L'humide et l'ombre : marais, tourbière, roselière, sous-bois de vieille sylve, le sol
      // des forêts ordinaires (là, très rare — voir `champignonsRares`) — et les deux mots
      // mouillés du pré (spec t0-exploration §2ter R34) : saulaie et prairie humide.
      return n === 'marsh' || n === 'peat_bog' || n === 'reed_marsh' || n === 'old_growth' || n === 'forest'
        || n === 'willow' || n === 'wet_meadow'
    default:
      return true
  }
}

/** Le voisinage Chebyshev ≤ r de la tuile contient-il un terrain qui satisfait `pred` ? */
function voisinageA(map: WorldMap, tx: number, ty: number, r: number, pred: (t: number) => boolean): boolean {
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
      if (pred(map.terrain[y * map.width + x]!)) return true
    }
  }
  return false
}

// Les familles de terrain de l'affinité — par NOM, l'idiome de `terrainAdmet` : une seule
// vérité (la table TERRAINS), pas une liste d'ids de plus à tenir synchrone.
const nomDe = (t: number): string => TERRAINS[t]?.name ?? ''
const estEau = (t: number): boolean => { const n = nomDe(t); return n === 'shallow_water' || n === 'deep_water' }
const estHumide = (t: number): boolean => {
  const n = nomDe(t)
  return n === 'wet_meadow' || n === 'willow' || n === 'marsh' || n === 'reed_marsh' || n === 'peat_bog'
}
const estLande = (t: number): boolean => { const n = nomDe(t); return n === 'juniper_heath' || n === 'heath' }
const estRocheux = (t: number): boolean => {
  const n = nomDe(t)
  return n === 'rock' || n === 'cliff' || n === 'scree' || n === 'boulders'
}

/**
 * L'AFFINITÉ DU SEMIS COMMUN (§2ter R34bis) — là où la ressource tirée a une raison d'être,
 * plein régime (1) ; ailleurs, le facteur d'éclaircie de sa famille. Fonction PURE de la
 * position — le verdict d'une tuile ne dépend que de son voisinage de terrain.
 */
function affiniteDuCommun(c: CarteZonee, type: NodeType, t: number, tx: number, ty: number): number {
  const r = CONTENU.AFFINITE_RAYON
  switch (type) {
    case 'fiber_plant':
      if (estHumide(t)) return 1
      if (voisinageA(c.map, tx, ty, r, (u) => estEau(u) || estHumide(u))) return 1
      return CONTENU.AFFINITE_FIBRE_SEC
    case 'berry_bush':
      if (estLande(t)) return 1
      if (voisinageA(c.map, tx, ty, r, (u) => TERRAINS_BOISES_MASSIF.includes(u))) return 1
      return CONTENU.AFFINITE_BAIE_OUVERT
    case 'rock':
      if (estLande(t)) return 1
      if (voisinageA(c.map, tx, ty, r, estRocheux)) return 1
      // Le champ de blocs erratiques : une nappe élue par le champ 'PIER', pas un semis.
      if (fbm2(tx, ty, CONTENU.PIERRIER_ECHELLE, (c.graphe.seed ^ 0x50494552) | 0) > CONTENU.PIERRIER_SEUIL) return 1
      return CONTENU.AFFINITE_PIERRE_OUVERT
    default:
      return 1
  }
}

/**
 * LE SEMIS. Un balayage, un tirage positionnel (fonction pure de la tuile : déplacer un nœud
 * d'une tuile ne remélange pas la carte), des bosquets.
 *
 * **UN SEUIL NE NOURRIT RIEN** (spec R10.3) : aucune tuile de rampe ne porte de nœud. Ce n'est
 * pas de la saveur — c'est ce qui rend un village impossible dans une porte, sans interdit.
 */
export function placeZoneNodes(c: CarteZonee): ResourceNode[] {
  const { width, height, terrain } = c.map
  const nodes: ResourceNode[] = []
  // LES COULÉES SONT STÉRILES (forêts-vivantes §4 R5bis) : un couloir où l'on circule et
  // où l'on voit venir. Le prédicat vit ICI, en un point : le semis principal le teste, et
  // TOUTES les passes appendues l'héritent par l'ensemencement de leurs `occupees` — une
  // passe future ne peut pas l'oublier.
  const steriles = (c.map.coulees ?? []).filter((i) => i >= 0)
  // LA TUILE DU SOMMET d'une butte reste NUE (§2sexies R48bis) : le client y dresse le chicot.
  // Réservée ICI, à la source — le semis principal passait AVANT les passes de butte et pouvait
  // y poser un rocher de la table ordinaire (attrapé par la garde A29, seed 7).
  const sommets = c.affleurements.map((a) => sommetDeButte(c, a.rect)).filter((i) => i >= 0)
  const sterileSet = new Set([...steriles, ...sommets])
  const occupeesPlus = (): Set<number> => new Set([...nodes.map((n) => n.ty * width + n.tx), ...steriles, ...sommets])
  const seed = (c.graphe.seed ^ 0x51ab3f77) | 0
  let id = 1

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i]) continue // le seuil ne nourrit rien
      if (sterileSet.has(i)) continue // la coulée non plus (forêts-vivantes §4)
      const t = terrain[i]!
      if (t === TERRAIN_ROAD) continue // rien ne pousse sur une sente (t0-exploration R18)
      if (!TERRAINS[t]?.walkable) continue

      // Une CLAIRIÈRE de la forêt de la racine reste NUE — la trouée respire (le sol y verdit).
      // Sans ça, le semis commun la reboiserait à moitié et la clairière ne se lirait plus.
      if (c.zone[i] === c.graphe.racine && terrainAdmet('tree', t) && clairiereForet(c.graphe.seed, tx, ty) > 0) {
        continue
      }

      // La densité : un nœud tous les PAS_SEMIS, modulée par les bosquets. Les nœuds se
      // GROUPENT — un tapis uniforme n'est pas un pays, c'est une moquette.
      const bosquet = fbm2(tx, ty, CONTENU.ECHELLE_BOSQUET, (seed ^ 0x2f9e) | 0)
      const chance = (1 / CONTENU.PAS_SEMIS) * (0.35 + 1.6 * bosquet)
      if (hash2(tx, ty, seed) >= chance) continue

      const type = tirerType(c, c.zone[i]!, t, tx, ty, seed)
      if (!type) continue
      // L'AFFINITÉ éclaircit l'illogique (§2ter R34bis) — RACINE SEULE : les zones dormantes
      // gardent leur semis au nœud près. Sel neuf ('AFIN') : aucun flux existant décalé.
      if (c.zone[i] === c.graphe.racine) {
        const a = affiniteDuCommun(c, type, t, tx, ty)
        if (a < 1 && hash2(tx, ty, (seed ^ 0x4146494e) | 0) >= a) continue
      }
      // Le stock d'un ARBRE passe par `stockDArbre` (§2quater R40) : au cœur d'un massif,
      // le vieux fût — partout ailleurs, le défaut du type, à l'identique d'avant.
      nodes.push({ id, type, tx, ty, stock: type === 'tree' ? stockDArbre(c.map, tx, ty) : NODE_DEFS[type].stock, regrowAt: 0 })
      id += 1
    }
  }

  // ── LES ARBRES DE LA RACINE — récoltables, denses en forêt, épars sur le pré ──
  // Une seconde passe, à part : sur l'herbe, ces arbres ne sortent pas de la table de la zone
  // (l'herbe n'admet pas le bois, `terrainAdmet`), ils s'y AJOUTENT ; en forêt, ils DENSIFIENT ce
  // que la table donnait déjà. Dans les deux cas ce sont de vrais nœuds à couper — pas du décor.
  const occupees = occupeesPlus()
  const arbres = arbresDeLaRacine(c, occupees, id)
  for (const a of arbres) nodes.push(a)
  id += arbres.length

  // ── LES VERGERS SAUVAGES — le lieu qui portait un NOM et rien d'autre ─────
  const vergers = vergersSauvages(c, occupeesPlus(), id)
  for (const v of vergers) nodes.push(v)
  id += vergers.length

  // ── LES CHAMPIGNONS — abondants à l'humide/l'ombre, TRÈS RARES en forêt (verbe 3) ──
  const mush = champignonsRares(c, occupeesPlus(), id)
  for (const m of mush) nodes.push(m)
  id += mush.length

  // ── LA FIBRE DES PRAIRIES HUMIDES — la place à fibre de la T0 (spec §2ter R34) ──
  const fibres = fibresDesPrairies(c, occupeesPlus(), id)
  for (const f of fibres) nodes.push(f)
  id += fibres.length

  // ── LE TEASER — un seul filon, dans la racine, et il est dérisoire ────────
  const t = poserLeTeaser(c, id)
  if (t) { nodes.push(t); id += 1 }

  // ── LE TEASER DU BOIS NOIR — le patron du Filon, appliqué au gros bois ────
  const vieux = teaserDuBoisNoir(c, occupeesPlus(), id)
  if (vieux) { nodes.push(vieux); id += 1 }

  // ── LA PROFONDEUR PORTE DU JEU (spec §2quater R40) — en QUEUE : aucun nœud d'avant ne bouge ──
  const baies = baiesDeLisiere(c, occupeesPlus(), id)
  for (const b of baies) nodes.push(b)
  id += baies.length
  const coeurs = champignonsDuCoeur(c, occupeesPlus(), id)
  for (const m of coeurs) nodes.push(m)
  id += coeurs.length
  const feuilles = tasDeFeuilles(c, occupeesPlus(), id)
  for (const f of feuilles) nodes.push(f)
  id += feuilles.length

  // ── LES PIERRIERS DU PRÉ (§2ter R34bis) — la pierre en CHAMPS DE BLOCS, pas en semis ──
  const pierriers = pierriersDuPre(c, occupeesPlus(), id)
  for (const p of pierriers) nodes.push(p)
  id += pierriers.length

  // ── L'ÉCONOMIE DU MONDE RÉDUIT (t0-exploration §2sexies) — en QUEUE, et GATED : sur le plan
  //    complet les trois passes rendent [] — zéro nœud, zéro décalage, A14/A15bis intacts. ──
  const minerais = mineraisDesAffleurements(c, occupeesPlus(), id)
  for (const m of minerais) nodes.push(m)
  id += minerais.length
  const blocs = blocsDesAffleurements(c, occupeesPlus(), id)
  for (const b of blocs) nodes.push(b)
  id += blocs.length
  const carrieres = carrieresDeLEnceinte(c, occupeesPlus(), id)
  for (const q of carrieres) nodes.push(q)
  id += carrieres.length
  const futs = vieuxFutsDesCoeurs(c, occupeesPlus(), id)
  for (const f of futs) nodes.push(f)
  id += futs.length

  // ── LES COINS DE PÊCHE (spec `peche.md` P3-P5) — en QUEUE : aucun nœud d'avant ne bouge ──
  const coins = coinsDePeche(c, occupeesPlus(), id)
  for (const k of coins) nodes.push(k)
  return nodes
}

/**
 * ═══ LES COINS DE PÊCHE (spec `peche.md` P2-P5 — sel 'PECH') ═══
 *
 * Un coin est une tuile de HAUT-FOND qui TOUCHE le PROFOND (4-voisinage) : joignable depuis la
 * berge ou le gué (portée 1,5 t), et lisible — on pêche VERS le profond. Deux eaux, deux types :
 *
 * - **La rivière, aux coudes** : `estUnCoude` (l'unique définition) désigne les pivots du fil ; à
 *   chaque coude retenu, la tuile candidate de plus petit `hash2` gagne ; un coude n'est retenu
 *   que si le précédent retenu est à ≥ `PECHE_ESPACEMENT_FIL` pas de fil.
 * - **Les lacs, contre leur cœur** : chaque LAC est une composante 4-connexe de profond (BFS) ; ses
 *   candidates sont les tuiles P2 de sa berge dont le profond touché n'est PAS de la rivière (à
 *   plus de `PECHE_RAYON_RIVIERE` Chebyshev de tout point du fil — un lac que la rivière traverse
 *   a ses coudes ET ses coins de lac, loin du fil). Il reçoit `1 + floor(berge / PECHE_BERGE_PAR_COIN)`
 *   coins, plafonnés à `PECHE_MAX_PAR_LAC`, choisis par `hash2` croissant et écartés de
 *   `PECHE_ESPACEMENT_LAC`. En Racine, hors `lac_mort`. Déterministe, sans PRNG.
 *
 * Patron 'FIBR' : passe appendue en queue, tirage positionnel, aucun nœud existant ne bouge.
 * Racine seule (D3) : les eaux des autres zones attendent leur contenu T2.
 */
function coinsDePeche(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x50454348) | 0 // 'PECH'
  const fil = c.map.fil ?? []
  const estEnRacine = (i: number): boolean => c.zone[i] === c.graphe.racine
  const slugDe = (i: number): string => c.graphe.zones[c.zone[i]!]?.def.slug ?? ''
  const profondVoisin = (tx: number, ty: number): number => {
    const v = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const
    for (const [dx, dy] of v) {
      const x = tx + dx
      const y = ty + dy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const j = y * width + x
      if (terrain[j] === TERRAIN_DEEP_WATER) return j
    }
    return -1
  }
  /** Candidat P2 : haut-fond libre, hors seuil, touchant le profond. Rend l'index du profond ou −1. */
  const candidat = (tx: number, ty: number): number => {
    const i = ty * width + tx
    if (c.rampe[i] || occupees.has(i)) return -1
    if (terrain[i] !== TERRAIN_SHALLOW_WATER) return -1
    return profondVoisin(tx, ty)
  }

  // ── LA RIVIÈRE, AUX COUDES ──
  const R = EAU.RIVIERE_DEMI_LIT
  let dernierCoude = -Infinity
  for (let k = 1; k + 1 < fil.length; k++) {
    if (!estUnCoude(fil, k, width)) continue
    if (k - dernierCoude < CONTENU.PECHE_ESPACEMENT_FIL) continue
    const cx = fil[k]! % width
    const cy = (fil[k]! - cx) / width
    let meilleur = -1
    let meilleurH = 2
    for (let ty = cy - R; ty <= cy + R; ty++) {
      for (let tx = cx - R; tx <= cx + R; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        if (candidat(tx, ty) < 0) continue
        const h = hash2(tx, ty, salt)
        if (h < meilleurH) {
          meilleurH = h
          meilleur = ty * width + tx
        }
      }
    }
    if (meilleur < 0) continue
    const tx = meilleur % width
    const ty = (meilleur - tx) / width
    out.push({ id, type: 'fishing_spot_river', tx, ty, stock: NODE_DEFS.fishing_spot_river.stock, regrowAt: 0 })
    occupees.add(meilleur)
    id += 1
    dernierCoude = k
  }

  // ── LES LACS, CONTRE LEUR CŒUR ──
  // Le voisinage du fil : une tuile profonde à moins de PECHE_RAYON_RIVIERE Chebyshev du fil est
  // de la rivière, pas d'un lac. Un Set, construit une fois : O(fil × rayon²).
  const pres = new Set<number>()
  const RR = CONTENU.PECHE_RAYON_RIVIERE
  for (const i of fil) {
    const fx = i % width
    const fy = (i - fx) / width
    for (let y = fy - RR; y <= fy + RR; y++) {
      for (let x = fx - RR; x <= fx + RR; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        pres.add(y * width + x)
      }
    }
  }
  // Les LACS : composantes 4-connexes de profond, en Racine, hors Lac Mort — balayage row-major,
  // donc l'ordre des lacs (et des ids) est stable pour une carte donnée.
  const compDe = new Int32Array(width * height).fill(-1)
  let nbLacs = 0
  const berges: number[][] = [] // par lac : les index des tuiles candidates de sa berge
  for (let i = 0; i < width * height; i++) {
    if (compDe[i] !== -1 || terrain[i] !== TERRAIN_DEEP_WATER) continue
    if (!estEnRacine(i) || slugDe(i) === 'lac_mort') continue
    const lac = nbLacs
    nbLacs += 1
    const berge: number[] = []
    const vuBerge = new Set<number>()
    const pile = [i]
    compDe[i] = lac
    while (pile.length > 0) {
      const j = pile.pop()!
      const jx = j % width
      const jy = (j - jx) / width
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = jx + dx
        const y = jy + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const k = y * width + x
        if (terrain[k] === TERRAIN_DEEP_WATER) {
          if (compDe[k] === -1) {
            compDe[k] = lac
            pile.push(k)
          }
          continue
        }
        // Une tuile de berge candidate (P2) dont LE profond touché ici n'est pas de la rivière.
        if (vuBerge.has(k) || pres.has(j)) continue
        if (candidat(x, y) < 0) continue
        vuBerge.add(k)
        berge.push(k)
      }
    }
    berges.push(berge)
  }
  const E = CONTENU.PECHE_ESPACEMENT_LAC
  for (const berge of berges) {
    if (berge.length === 0) continue
    const quota = Math.min(CONTENU.PECHE_MAX_PAR_LAC, 1 + Math.floor(berge.length / CONTENU.PECHE_BERGE_PAR_COIN))
    const tries = berge
      .map((k) => ({ k, h: hash2(k % width, (k - (k % width)) / width, salt) }))
      .sort((a, b) => a.h - b.h || a.k - b.k)
    const choisis: { tx: number; ty: number }[] = []
    for (const { k } of tries) {
      if (choisis.length >= quota) break
      const tx = k % width
      const ty = (k - tx) / width
      if (choisis.some((l) => Math.max(Math.abs(l.tx - tx), Math.abs(l.ty - ty)) < E)) continue
      if (occupees.has(k)) continue // un coin de rivière a pu prendre cette tuile
      out.push({ id, type: 'fishing_spot_lake', tx, ty, stock: NODE_DEFS.fishing_spot_lake.stock, regrowAt: 0 })
      occupees.add(k)
      choisis.push({ tx, ty })
      id += 1
    }
  }
  return out
}

/**
 * ═══ LES MINERAIS DES AFFLEUREMENTS — le contenant donne le contenu (§2sexies R48) ═══
 *
 * Par le REGISTRE (`c.affleurements`), jamais en devinant le terrain : les `boulders` ordinaires
 * du pré ne sont pas des gisements. Un affleurement = UNE identité (ferreux OU charbonneux).
 * Répartition par pas constant dans la liste row-major des tuiles de rocaille — l'écartement
 * sans tirage ; le départ est salé positionnel ('AFFL'), le patron canonique du worldgen.
 */
/**
 * LE SOMMET D'UNE BUTTE — la tuile de rocaille la plus proche du centre du rect (balayage
 * row-major, comparaison stricte : ordre total, déterministe). Elle reste NUE de tout nœud :
 * le client y dresse le chicot du fer (render/buttes.ts calcule LA MÊME tuile — deux codes,
 * une règle : « la tuile de pierrier la plus proche du centre »).
 */
function sommetDeButte(c: CarteZonee, r: { x: number; y: number; w: number; h: number }): number {
  const { width, height, terrain } = c.map
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  let sommet = -1
  let bestD = Infinity
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
      const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
      if (d < bestD) { bestD = d; sommet = ty * width + tx }
    }
  }
  return sommet
}

/** Les tuiles de rocaille LIBRES d'une butte (hors rampe, hors occupées, hors sommet). */
function rocailleLibre(c: CarteZonee, r: { x: number; y: number; w: number; h: number }, type: NodeType, occupees: Set<number>): number[] {
  const { width, height, terrain } = c.map
  const sommet = sommetDeButte(c, r)
  const libres: number[] = []
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
      const i = ty * width + tx
      if (i === sommet || c.rampe[i] || occupees.has(i)) continue
      if (terrain[i] !== TERRAIN_SCREE) continue // le contenant est la rocaille PEINTE, exactement
      if (!terrainAdmet(type, terrain[i]!)) continue
      libres.push(i)
    }
  }
  return libres
}

/** Répartition par pas constant dans la liste row-major — l'écartement sans tirage. */
function semerSurLaButte(
  libres: number[], n: number, depart: number, type: NodeType,
  width: number, occupees: Set<number>, id: number, out: ResourceNode[],
): void {
  for (let k = 0; k < n; k++) {
    const i = libres[Math.min(libres.length - 1, depart + Math.floor((k * libres.length) / n))]!
    if (occupees.has(i)) continue
    occupees.add(i)
    const tx = i % width
    out.push({ id: id + out.length, type, tx, ty: (i - tx) / width, stock: NODE_DEFS[type].stock, regrowAt: 0 })
  }
}

function mineraisDesAffleurements(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  const { width } = c.map
  const out: ResourceNode[] = []
  for (const aff of c.affleurements) {
    const type: NodeType = aff.ressource === 'fer' ? 'iron_vein' : 'coal_seam'
    const libres = rocailleLibre(c, aff.rect, type, occupees)
    const n = Math.min(CONTENU.AFFL_NOEUDS, libres.length)
    if (n === 0) continue
    const depart = Math.floor(hash2(aff.rect.x, aff.rect.y, (c.graphe.seed ^ 0x4146464c) | 0) * (libres.length / n))
    semerSurLaButte(libres, n, depart, type, width, occupees, id + out.length, out)
  }
  return out
}

/**
 * LA TAILLE D'UN BLOC — pure fonction de la tuile, PARTAGÉE sim/client (le patron
 * `treeJitter` : « même fonction pure que la collision, sprite et règle coïncident »).
 * Le sim en fait le STOCK (un gros bloc se taille plus longtemps), le client en fait
 * l'ART (`nd-bloc-<taille>`) — deux lectures, une vérité, aucune donnée transportée.
 */
export function tailleDeBloc(tx: number, ty: number): 0 | 1 | 2 {
  return Math.min(2, Math.floor(hash2(tx, ty, 0x7a11e) * 3)) as 0 | 1 | 2
}
/** Le stock par taille de bloc — la taille EST la résistance. */
export const BLOC_STOCKS: readonly [number, number, number] = [8, 12, 18]

/**
 * ═══ LES BLOCS DES BUTTES — « un bloc = une tuile pleine de non traversable » (Alexis) ═══
 *
 * Le chaos de pierres qui peuple une butte n'est pas du décor : ce sont de VRAIS nœuds `bloc`
 * (mémoire du projet : « ajoute X » = objets de jeu réels). Chacun REMPLIT sa tuile — boîte
 * pleine (`blockHalfSub: 4`), art pleine tuile SANS offset côté client — et bloque tant qu'il
 * a du stock : se frayer un passage se CREUSE, à mains nues. Trois TAILLES (`tailleDeBloc`),
 * et la taille fait le stock. Semés APRÈS les minerais, jamais sur le sommet, agrégés en
 * masses de 1-3 tuiles. Le décor client ne garde que les moellons qu'on enjambe (INV-2).
 */
function blocsDesAffleurements(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  const { width, terrain } = c.map
  const out: ResourceNode[] = []
  for (const aff of c.affleurements) {
    const libres = rocailleLibre(c, aff.rect, 'bloc', occupees)
    const n = Math.min(CONTENU.AFFL_BLOCS, libres.length)
    if (n === 0) continue
    const sel = (c.graphe.seed ^ 0x424c4f43) | 0 /* 'BLOC' */
    const depart = Math.floor(hash2(aff.rect.y, aff.rect.x, sel) * (libres.length / n))
    const sommet = sommetDeButte(c, aff.rect)
    const pose = (i: number): void => {
      occupees.add(i)
      const tx = i % width
      const ty = (i - tx) / width
      out.push({ id: id + out.length, type: 'bloc', tx, ty, stock: BLOC_STOCKS[tailleDeBloc(tx, ty)], regrowAt: 0 })
    }
    for (let k = 0; k < n; k++) {
      const i = libres[Math.min(libres.length - 1, depart + Math.floor((k * libres.length) / n))]!
      if (occupees.has(i)) continue
      pose(i)
      // « DE DIFFÉRENTES TAILLES » AU NIVEAU DE LA COLLISION (précision d'Alexis : un bloc =
      // une tuile PLEINE) : un bloc sur deux s'agrège un voisin de rocaille — des MASSES de
      // 1 à 2 tuiles pleines (3 quand deux chaos se touchent), pas un semis de plots isolés.
      const tx = i % width
      const ty = (i - tx) / width
      if (hash2(tx, ty, (sel ^ 0x11) | 0) < 0.5) {
        const dirs = [i + 1, i + width, i - 1, i - width]
        const d0 = Math.floor(hash2(tx, ty, (sel ^ 0x22) | 0) * 4)
        for (let d = 0; d < 4; d++) {
          const j = dirs[(d0 + d) % 4]!
          const jx = j % width
          const jy = (j - jx) / width
          if (jx < aff.rect.x || jx >= aff.rect.x + aff.rect.w || jy < aff.rect.y || jy >= aff.rect.y + aff.rect.h) continue
          if (j === sommet || occupees.has(j) || c.rampe[j]) continue
          if (terrain[j] !== TERRAIN_SCREE) continue
          pose(j)
          break
        }
      }
    }
  }
  return out
}

/**
 * ═══ LES CARRIÈRES DE L'ENCEINTE — on taille la montagne, pas le pré (§2sexies R49) ═══
 *
 * Candidates : les tuiles marchables de la racine au CONTACT ORTHOGONAL de la roche, hors
 * seuils et routes, et là où le front n'arrive JAMAIS (`cendre > cendreMax` — ce qui exclut
 * d'office le mur de la frontière Cendrière : ses abords brûlent). Les postes s'écartent au
 * MAX-MIN (le patron des points de spawn), départ salé ('CARR') ; autour de chaque poste,
 * quelques nœuds `quarry` sur les candidates voisines.
 */
function carrieresDeLEnceinte(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  if ((c.graphe.monde ?? 'vallee') !== 'racine') return []
  const { width, height, terrain, cendre, cendreMax } = c.map
  if (!cendre || cendreMax === undefined) return []
  const candidates: number[] = []
  for (let ty = 1; ty < height - 1; ty++) {
    for (let tx = 1; tx < width - 1; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      if (c.rampe[i] || occupees.has(i)) continue
      const t = terrain[i]!
      if (t === TERRAIN_ROAD || !TERRAINS[t]?.walkable) continue
      if (cendre[i]! <= cendreMax) continue
      if (terrain[i - 1] !== TERRAIN_ROCK && terrain[i + 1] !== TERRAIN_ROCK
        && terrain[i - width] !== TERRAIN_ROCK && terrain[i + width] !== TERRAIN_ROCK) continue
      if (!terrainAdmet('quarry', t)) continue
      candidates.push(i)
    }
  }
  if (candidates.length === 0) return []

  const sel = (c.graphe.seed ^ 0x43415252) | 0 /* 'CARR' */
  const postes: number[] = [candidates[Math.min(candidates.length - 1, Math.floor(hash2(candidates.length, 0, sel) * candidates.length))]!]
  while (postes.length < CONTENU.CARRIERES) {
    let best = -1
    let bestD = -1
    for (const i of candidates) {
      const tx = i % width
      const ty = (i - tx) / width
      let d = Infinity
      for (const p of postes) {
        const px = p % width
        const py = (p - px) / width
        const dd = (tx - px) * (tx - px) + (ty - py) * (ty - py)
        if (dd < d) d = dd
      }
      if (d > bestD) { bestD = d; best = i }
    }
    if (best < 0 || bestD <= 0) break
    postes.push(best)
  }

  const out: ResourceNode[] = []
  const R2 = CONTENU.CARRIERE_RAYON * CONTENU.CARRIERE_RAYON
  for (const p of postes) {
    const px = p % width
    const py = (p - px) / width
    const proches = candidates.filter((i) => {
      const tx = i % width
      const ty = (i - tx) / width
      return (tx - px) * (tx - px) + (ty - py) * (ty - py) <= R2
    })
    const n = Math.min(CONTENU.CARRIERE_NOEUDS, proches.length)
    for (let k = 0; k < n; k++) {
      const i = proches[Math.min(proches.length - 1, Math.floor((k * proches.length) / n))]!
      if (occupees.has(i)) continue
      occupees.add(i)
      const tx = i % width
      out.push({ id: id + out.length, type: 'quarry', tx, ty: (i - tx) / width, stock: NODE_DEFS.quarry.stock, regrowAt: 0 })
    }
  }
  return out
}

/**
 * ═══ LES VIEUX FÛTS DES CŒURS — le gros bois vit au fond des bois (§2sexies R50) ═══
 *
 * `old_tree` (stock standard, pas un teaser) dans les cellules CŒUR des massifs de la racine
 * (§2quater), HORS Bois Noir — son teaser garde son récit. Repli R51 : si aucune cellule cœur
 * n'existe à cette échelle, le tuile boisée la plus PROFONDE fait l'affaire. Postes au max-min,
 * même patron que les carrières.
 */
function vieuxFutsDesCoeurs(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode[] {
  if ((c.graphe.monde ?? 'vallee') !== 'racine') return []
  const { width, height, terrain } = c.map
  const boisNoir = c.map.zones.find((z) => z.kind === 'bois_noir')
  const dansBoisNoir = (tx: number, ty: number): boolean =>
    boisNoir !== undefined && tx >= boisNoir.x && tx < boisNoir.x + boisNoir.w && ty >= boisNoir.y && ty < boisNoir.y + boisNoir.h
  const coeurs: number[] = []
  let repli = -1
  let repliProf = 0
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      if (c.rampe[i] || occupees.has(i)) continue
      if (!terrainAdmet('old_tree', terrain[i]!)) continue
      if (dansBoisNoir(tx, ty)) continue
      const d = profondeurAt(c.map, tx, ty)
      if (estCoeur(d)) coeurs.push(i)
      if (d > repliProf) { repliProf = d; repli = i }
    }
  }
  const bassin = coeurs.length > 0 ? coeurs : repli >= 0 ? [repli] : []
  if (bassin.length === 0) return []

  const sel = (c.graphe.seed ^ 0x46555453) | 0 /* 'FUTS' */
  const postes: number[] = [bassin[Math.min(bassin.length - 1, Math.floor(hash2(bassin.length, 1, sel) * bassin.length))]!]
  while (postes.length < CONTENU.VIEUX_FUTS) {
    let best = -1
    let bestD = -1
    for (const i of bassin) {
      const tx = i % width
      const ty = (i - tx) / width
      let d = Infinity
      for (const p of postes) {
        const px = p % width
        const py = (p - px) / width
        const dd = (tx - px) * (tx - px) + (ty - py) * (ty - py)
        if (dd < d) d = dd
      }
      if (d > bestD) { bestD = d; best = i }
    }
    if (best < 0 || bestD <= 0) break
    postes.push(best)
  }

  const out: ResourceNode[] = []
  for (const i of postes) {
    if (occupees.has(i)) continue
    occupees.add(i)
    const tx = i % width
    out.push({ id: id + out.length, type: 'old_tree', tx, ty: (i - tx) / width, stock: NODE_DEFS.old_tree.stock, regrowAt: 0 })
  }
  return out
}

/**
 * UN vieil arbre dans le Bois Noir, au stock dérisoire (spec t0-exploration R11).
 *
 * Même grammaire que le Filon affleurant : « le gros bois existe. Pas ici. » Le joueur qui a
 * compris le fer comprend le bois sans un mot. C'est la SECONDE exception déclarée à
 * l'exclusivité des structurantes (worldgen R9/A14) — un teaser informe, il n'équipe pas :
 * `TEASER_STOCK` coups et il est mort, quand la Vieille Sylve en porte des centaines.
 *
 * Déterminisme : choix positionnel salé ('VIEU') parmi les tuiles admissibles de l'empreinte,
 * balayées en row-major — aucun tirage sur le PRNG partagé, aucun décalage de flux.
 */
function teaserDuBoisNoir(c: CarteZonee, occupees: Set<number>, id: number): ResourceNode | null {
  const { width, terrain } = c.map
  const bois = c.map.zones.find((z) => z.kind === 'bois_noir')
  if (!bois) return null
  const libres: number[] = []
  for (let ty = Math.floor(bois.y); ty < bois.y + bois.h; ty++) {
    for (let tx = Math.floor(bois.x); tx < bois.x + bois.w; tx++) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= c.map.height) continue
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      if (!terrainAdmet('old_tree', terrain[i]!)) continue
      libres.push(i)
    }
  }
  if (libres.length === 0) return null
  const k = Math.min(libres.length - 1, Math.floor(hash2(bois.x, bois.y, (c.graphe.seed ^ 0x56494555) | 0) * libres.length))
  const i = libres[k]!
  return { id, type: 'old_tree', tx: i % width, ty: (i - (i % width)) / width, stock: CONTENU.TEASER_STOCK, regrowAt: 0 }
}

/**
 * LE VERGER SAUVAGE PORTE ENFIN DES FRUITS.
 *
 * C'était un lieu VIDE : `family: 'eco'`, aucune charge de découverte, aucun contenu — un nom
 * posé sur de l'herbe ordinaire. Deux des cinq lieux de la zone de départ étaient dans ce cas,
 * et c'est exactement ce qui rend une carte T0 décevante : on marche vers quelque chose qui
 * s'annonce, et il n'y a rien. Trouver un verger DOIT payer.
 *
 * Ce qu'il pose : de VRAIS buissons à baies récoltables (mémoire de projet : « ajoute X au
 * biome Y » veut dire de vrais nœuds, pas du décor ni une teinte), densément, dans son
 * empreinte. C'est une récompense de NOURRITURE — la ressource qui compte le plus tôt.
 *
 * DÉTERMINISME : décision par tuile via `hash2` salé d'une constante ASCII neuve ('VERG'), le
 * patron canonique du worldgen. Aucun tirage sur le PRNG partagé, aucune entité — donc aucun
 * décalage de flux. Et rien qui touche la marchabilité : on n'ajoute que des nœuds.
 */
/**
 * LES CHAMPIGNONS (spec recolte-maitrise verbe 3). Un patch pousse là où c'est adapté : ABONDANT
 * à l'humide/l'ombre franche (marais, tourbière, roselière, sous-bois de vieille sylve), TRÈS RARE
 * sur le sol des forêts ordinaires (`forest` — quelques-uns dans les bois de la zone T0, demande
 * d'Alexis). Nulle part ailleurs. VISIBLE de tous (un trajet) ; le SAVOIR pour le récolter est gaté
 * à part (`NodeDef.minForageLevel`, jugé dans `economy.strikeRejection`).
 *
 * PASSE SÉPARÉE, appendue (comme `vergersSauvages`/`arbresDeLaRacine`) : elle ne touche pas la table
 * `CONTENUS`, donc aucun nœud existant ne bouge et le flux de génération n'est pas décalé (leçon RNG).
 * Tirage POSITIONNEL (`hash2` salé de 'MUSH'), aucun PRNG partagé, sur tuile LIBRE (hors seuil, hors
 * tuile déjà occupée). Pur et déterministe.
 */
/**
 * LE STOCK DE NAISSANCE D'UN ARBRE (spec §2quater R40) — le VIEUX FÛT du cœur : stock majoré
 * `×VIEUX_FUT_FACTEUR`. FONCTION PURE de la position, appliquée au semis ET réappliquée à la
 * repousse (`economy.ts` : la repousse remet le stock au défaut du type — une donnée
 * d'instance mourrait au premier épuisement, le patron `withForageRichness`). Jamais en
 * futaie ancienne : le Bois Noir garde sa doctrine du teaser (« le gros bois existe. Pas
 * ici. ») — le cœur majore l'ORDINAIRE, il n'importe jamais une structurante. Et le bonus
 * MEURT AVEC L'ARBRE (R38) : la tuile déboisée depuis l'amorce rend le défaut, l'étiquette
 * de profondeur restant inerte.
 */
export function stockDArbre(map: WorldMap, tx: number, ty: number): number {
  const base = NODE_DEFS.tree.stock
  const t = terrainAt(map, tx, ty)
  if (t === TERRAIN_OLD_GROWTH || !TERRAINS_BOISES_MASSIF.includes(t)) return base
  return estCoeur(profondeurAt(map, tx, ty)) ? Math.round(base * CONTENU.VIEUX_FUT_FACTEUR) : base
}

/**
 * LES BAIES DE LISIÈRE (spec §2quater R40 — sel 'LISI'). Le bois se CUEILLE au bord : la
 * bande de lisière (1 ≤ d ≤ PROF_LISIERE) porte des buissons à baies. Passe appendue en
 * queue, tirage positionnel — patron 'FIBR' : la table `CONTENUS` n'est pas touchée, aucun
 * nœud existant ne bouge, le flux de génération n'est pas décalé.
 */
function baiesDeLisiere(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x4c495349) | 0 // 'LISI'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue // le seuil ne nourrit rien ; tuile prise
      if (!estLisiere(profondeurAt(c.map, tx, ty))) continue // prof ≥ 1 ⇒ boisé, Racine
      if (!terrainAdmet('berry_bush', terrain[i]!)) continue
      if (hash2(tx, ty, salt) >= CONTENU.BAIES_LISIERE) continue
      out.push({ id, type: 'berry_bush', tx, ty, stock: NODE_DEFS.berry_bush.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LES CHAMPIGNONS DU CŒUR (spec §2quater R40 — sel 'COEU'). Le cœur DONNE : un régime ×5 le
 * sol des forêts communes (`CHAMPIGNON_COEUR` vs `CHAMPIGNON_FORET`), là où seuls les grands
 * massifs mènent. `terrainAdmet` reste la loi : pin et mélèze n'en portent pas (verbe 3 —
 * l'humide et l'ombre), un cœur de bosquet de crête reste sec.
 */
function champignonsDuCoeur(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x434f4555) | 0 // 'COEU'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      if (!estCoeur(profondeurAt(c.map, tx, ty))) continue
      if (!terrainAdmet('champignon', terrain[i]!)) continue
      if (hash2(tx, ty, salt) >= CONTENU.CHAMPIGNON_COEUR) continue
      out.push({ id, type: 'champignon', tx, ty, stock: NODE_DEFS.champignon.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LES TAS DE FEUILLES (forêts-vivantes §1 R1 — sel 'FEUI'). La bande du CORPS
 * (`PROF_LISIERE < d < PROF_COEUR`) des feuillus gagne sa fouille : des vers sous les
 * feuilles — le premier appât qui n'est pas de la nourriture. Patron 'FIBR' : passe
 * appendue en queue, tirage positionnel, aucun nœud existant ne bouge.
 */
function tasDeFeuilles(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x46455549) | 0 // 'FEUI'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue
      if (!TERRAINS_FEUILLUS.includes(terrain[i]!)) continue
      const d = profondeurAt(c.map, tx, ty)
      if (d <= CREUX.PROF_LISIERE || d >= CREUX.PROF_COEUR) continue // la bande du CORPS
      if (hash2(tx, ty, salt) >= CONTENU.TAS_FEUILLES) continue
      out.push({ id, type: 'leaf_pile', tx, ty, stock: NODE_DEFS.leaf_pile.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LES PIERRIERS DU PRÉ (§2ter R34bis — sel 'PIRR'). Le champ 'PIER' qui garde la pierre du
 * semis commun à plein régime CONCENTRE aussi : dans une nappe élue, la pierre est plus dense
 * que ne l'était le saupoudrage — un champ de blocs erratiques se voit de loin, se nomme, se
 * vide. Racine seule, patron 'FIBR' : passe appendue, tirage positionnel, aucun nœud existant
 * ne bouge.
 */
function pierriersDuPre(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const champ = (c.graphe.seed ^ 0x50494552) | 0 // 'PIER' — LE MÊME champ que l'affinité
  const salt = (c.graphe.seed ^ 0x50495252) | 0 // 'PIRR'
  // Une BUTTE n'est pas un pierrier : elle est peuplée par SES blocs (§2sexies R48bis), la
  // nappe ne doit pas y déverser de la pierre ordinaire ni décaler leur semis.
  const dansUneButte = (tx: number, ty: number): boolean =>
    c.affleurements.some((a) => tx >= a.rect.x && tx < a.rect.x + a.rect.w && ty >= a.rect.y && ty < a.rect.y + a.rect.h)
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue
      if (c.rampe[i] || occupees.has(i)) continue
      const t = terrain[i]!
      if (t === TERRAIN_ROAD || !TERRAINS[t]?.walkable) continue
      if (!terrainAdmet('rock', t)) continue
      if (dansUneButte(tx, ty)) continue
      if (fbm2(tx, ty, CONTENU.PIERRIER_ECHELLE, champ) <= CONTENU.PIERRIER_SEUIL) continue
      if (hash2(tx, ty, salt) >= CONTENU.PIERRIER_CHANCE) continue
      out.push({ id, type: 'rock', tx, ty, stock: NODE_DEFS.rock.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

function champignonsRares(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x4d555348) | 0 // 'MUSH'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue // le seuil ne nourrit rien ; tuile déjà prise
      const def = TERRAINS[terrain[i]!]
      if (!def?.walkable) continue
      const n = def.name
      const prob =
        n === 'marsh' || n === 'peat_bog' || n === 'reed_marsh' || n === 'old_growth'
          || n === 'willow' || n === 'wet_meadow' // les mots mouillés du pré (spec §2ter R34)
          ? CONTENU.CHAMPIGNON_HUMIDE
          : n === 'forest'
            ? CONTENU.CHAMPIGNON_FORET
            : -1 // tout autre terrain : jamais de champignon
      if (prob < 0 || hash2(tx, ty, salt) >= prob) continue
      out.push({ id, type: 'champignon', tx, ty, stock: NODE_DEFS.champignon.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

/**
 * LA FIBRE DES PRAIRIES HUMIDES (spec t0-exploration §2ter R34, décision d'Alexis 2026-08-15).
 *
 * La prairie humide est LA place à fibre de la T0 — joncs et laîches : la ressource des
 * bandages a un ENDROIT lisible, au lieu d'un saupoudrage uniforme sur tout le pré. Même
 * patron que `champignonsRares` : passe séparée, appendue, tirage POSITIONNEL (`hash2` salé
 * 'FIBR'), aucune tuile de seuil ni de tuile déjà prise, aucun PRNG partagé — le flux de
 * génération n'est pas décalé (leçon RNG).
 */
function fibresDesPrairies(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  const salt = (c.graphe.seed ^ 0x46494252) | 0 // 'FIBR'
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i] || occupees.has(i)) continue // le seuil ne nourrit rien ; tuile déjà prise
      if (terrain[i] !== TERRAIN_WET_MEADOW) continue
      if (hash2(tx, ty, salt) >= CONTENU.FIBRE_PRAIRIE) continue
      out.push({ id, type: 'fiber_plant', tx, ty, stock: NODE_DEFS.fiber_plant.stock, regrowAt: 0 })
      occupees.add(i)
      id += 1
    }
  }
  return out
}

function vergersSauvages(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, terrain, zones } = c.map
  const out: ResourceNode[] = []
  let id = idStart
  for (const z of zones) {
    if (z.kind !== 'verger') continue
    for (let ty = Math.floor(z.y); ty < z.y + z.h; ty++) {
      for (let tx = Math.floor(z.x); tx < z.x + z.w; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= c.map.height) continue
        const i = ty * width + tx
        if (c.rampe[i] || occupees.has(i)) continue
        const t = terrain[i]!
        // On respecte l'admission du terrain : un verger ne fait pas pousser de buisson sur
        // la roche. S'il tombe sur un sol qui n'en veut pas, il reste maigre — et c'est juste.
        if (!terrainAdmet('berry_bush', t)) continue
        if (hash2(tx, ty, (c.graphe.seed ^ 0x56455247) | 0) >= CONTENU.VERGER_DENSITE) continue
        out.push({ id, type: 'berry_bush', tx, ty, stock: NODE_DEFS.berry_bush.stock, regrowAt: 0 })
        occupees.add(i)
        id += 1
      }
    }
  }
  return out
}

/**
 * LES ARBRES DE LA RACINE — récoltables, à deux densités selon le sol.
 *
 * La racine porte ses propres arbres, posés en NŒUDS récoltables (pas en décor : on ne coupe pas
 * un décor). Deux régimes selon le terrain de la tuile :
 *
 *   • sur la FORÊT (les bosquets de la racine) : DENSE — une vraie futaie de bois qu'on abat,
 *     mais TROUÉE de clairières rectangulaires (décidées par bloc). Ils s'ajoutent au peu que la
 *     table commune y posait déjà.
 *   • sur l'HERBE (le pré) : ÉPARS avec un plancher — quelques arbres qui ponctuent la plaine
 *     sans la boiser. Le sol reste un pré (`solDe` ne change pas) ; ce sont des nœuds posés sur
 *     un terrain qui, d'ordinaire, n'en porte pas.
 *
 * Le semis est CLUSTERISÉ (un bruit basse fréquence groupe les arbres). On ne pose que sur une
 * tuile LIBRE de la racine (hors seuil, hors tuile déjà occupée par un autre nœud), et rien sur
 * un sol qui n'est ni herbe ni forêt (la fleuraie, la roche… gardent leur nature).
 *
 * Pur et déterministe : `hash2`/`fbm2`, `+ - * /` (invariant n°2).
 */
function arbresDeLaRacine(c: CarteZonee, occupees: Set<number>, idStart: number): ResourceNode[] {
  const { width, height, terrain } = c.map
  const seed = (c.graphe.seed ^ 0x51ab3f77) | 0
  const out: ResourceNode[] = []
  let id = idStart
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine) continue // rien que dans les Prés Bas
      if (c.rampe[i]) continue // un seuil ne nourrit rien
      if (occupees.has(i)) continue // une tuile ne porte qu'un seul nœud

      const t = terrain[i]!
      // La FORÊT est un couvert PLEIN ; l'HERBE est éparse avec un plancher (0,5..1,7× : toujours
      // quelques arbres, parfois un petit groupe).
      let pas: number
      let socle: number
      let ampli: number
      if (t === TERRAIN_GRASS) {
        pas = CONTENU.ARBRES_PRE_PAS; socle = 0.5; ampli = 1.2
      } else if (t === TERRAIN_FOREST || t === TERRAIN_OLD_GROWTH || t === TERRAIN_PINE || t === TERRAIN_LARCH || t === TERRAIN_WILLOW) {
        // LES CLAIRIÈRES : décidées par BLOC (cf. `clairiereForet`) → des trouées RECTANGULAIRES.
        // Le MÊME champ sert au rendu du sol (qui y verdit) : une source unique, sinon les
        // clairières des arbres et celles du sol divergeraient.
        //
        // La FUTAIE, c'est la forêt, le Bois Noir (old_growth, spec t0-exploration R9) et — depuis
        // le 2026-07-29 — les BOSQUETS DE CRÊTE (pin, mélèze : le bois SEC des dos, demande
        // d'Alexis). Ce sont les quatre sols de la Racine qu'on habite sous un couvert. PAS la
        // lisière calcinée : « admet l'arbre » ne veut pas dire « en est couvert » — le calciné du
        // sud garde ses arbres épars de la table commune, il ne devient pas une pépinière plus
        // riche que le pré qu'il remplace.
        //
        // SANS CETTE LIGNE le bosquet de crête serait un APLAT DE COULEUR : `terrainAdmet` laisse
        // bien le pin porter des arbres, mais à la densité commune du semis (un nœud toutes les
        // 36 tuiles) — on aurait peint un bois qui n'en est pas un.
        if (clairiereForet(c.graphe.seed, tx, ty) > 0) continue // ce bloc est une clairière : nu
        pas = CONTENU.ARBRES_FORET_PAS; socle = 0.85; ampli = 0.4
      } else {
        continue // ni herbe ni futaie : ce sol garde sa nature (fleuraie, lande, accent…)
      }

      const bosquet = fbm2(tx, ty, CONTENU.ARBRES_ECHELLE, (seed ^ 0x4be1) | 0)
      const chance = (1 / pas) * (socle + ampli * bosquet)
      if (hash2(tx, ty, (seed ^ 0x3d7a) | 0) >= chance) continue

      // Le cœur d'un massif pose des VIEUX FÛTS (§2quater R40) — `stockDArbre`, la même loi
      // que le semis commun et la repousse.
      out.push({ id, type: 'tree', tx, ty, stock: stockDArbre(c.map, tx, ty), regrowAt: 0 })
      id += 1
    }
  }
  return out
}

/**
 * LE CHAMP DES CLAIRIÈRES DE LA FORÊT — une SOURCE UNIQUE, et c'est le point.
 *
 * Rend 0 sous le couvert plein, et une valeur CROISSANTE vers le CŒUR d'une clairière (la marge
 * au-dessus du seuil : plus on est au centre, plus le bruit est haut). La décision se prend par
 * BLOC (le motif de 8 tuiles) : une clairière est donc un rectangle, et des blocs voisins se
 * fondent en clairières plus grandes, irrégulières.
 *
 * Deux consommateurs, un seul calcul (comme `poiClearings`) : le semis d'arbres l'ÉVIDE (`> 0` →
 * bloc nu) ; le rendu du sol y VERDIT (`arbresDeLaRacine` boise, la clairière verdit — il ne faut
 * surtout pas que les deux se contredisent). Pur et déterministe (`fbm2`, `+ - * /`).
 */
export function clairiereForet(seed: number, tx: number, ty: number): number {
  const M = RELIEF.MOTIF
  const bx = Math.floor(tx / M) * M + M / 2
  const by = Math.floor(ty / M) * M + M / 2
  const s = ((seed ^ 0x51ab3f77) ^ 0x6f2a) | 0
  const v = fbm2(bx, by, CONTENU.CLAIRIERE_ECHELLE, s)
  return v > CONTENU.CLAIRIERE_SEUIL ? v - CONTENU.CLAIRIERE_SEUIL : 0
}

/** Le type de nœud d'une tuile : la table de sa zone, filtrée par ce que le terrain admet. */
function tirerType(
  c: CarteZonee,
  zoneId: number,
  terrain: number,
  tx: number,
  ty: number,
  seed: number,
): NodeType | null {
  const def = CONTENUS[c.graphe.zones[zoneId]!.def.slug]
  if (!def) return null

  const table: [NodeType, number][] = []
  if (def.structurant) table.push([def.structurant.type, def.structurant.part])
  for (const l of def.liaison ?? []) table.push([l.type, l.part])
  for (const [k, v] of Object.entries(def.commun)) table.push([k as NodeType, v!])

  // On ne garde que ce que le terrain admet, puis on renormalise : une zone d'éboulis ne
  // fabrique pas d'arbres, mais elle ne doit pas non plus se retrouver VIDE parce que sa table
  // parlait d'arbres.
  const ok = table.filter(([type]) => terrainAdmet(type, terrain))
  const total = ok.reduce((s, [, p]) => s + p, 0)
  if (total <= 0) return null

  let r = hash2(tx, ty, (seed ^ 0x7c31) | 0) * total
  for (const [type, part] of ok) {
    r -= part
    if (r <= 0) return type
  }
  return ok[ok.length - 1]![0]
}

/**
 * LE TEASER — *« ça existe. Pas ici. »*
 *
 * Un filon, un seul, dans la racine, au stock dérisoire. Il n'équipe personne : il **informe**.
 * On le pose **loin du centre** de la racine (dans son dernier quart) : il faut l'avoir cherché
 * pour le trouver, et l'avoir trouvé pour se demander où sont les autres.
 */
function poserLeTeaser(c: CarteZonee, id: number): ResourceNode | null {
  const { width, height, terrain } = c.map

  // LE FILON EST UN LIEU, DÉSORMAIS — et le minerai se pose DANS ce lieu.
  // Tant qu'il n'était qu'un nœud perdu à la tuile la plus lointaine, son message ne pouvait
  // pas être délivré : rien ne le signalait, rien ne le retenait, il n'était sur aucune carte.
  // En l'ancrant sur « le Filon affleurant », on garde exactement ce qu'il était (unique, loin,
  // dérisoire) et on rend enfin possible ce que son intention demandait : le CHERCHER.
  for (const z of c.map.zones) {
    if (z.kind !== 'filon') continue
    for (let ty = Math.floor(z.y); ty < z.y + z.h; ty++) {
      for (let tx = Math.floor(z.x); tx < z.x + z.w; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
        const i = ty * width + tx
        if (c.rampe[i] || !terrainAdmet('iron_vein', terrain[i]!)) continue
        return { id, type: 'iron_vein', tx, ty, stock: CONTENU.TEASER_STOCK, regrowAt: 0 }
      }
    }
  }

  // REPLI — aucune carte ne porte forcément un lieu (cartes de test, anciennes vallées) :
  // on retombe alors sur le comportement d'origine, la tuile la plus loin du cœur.
  const r = c.graphe.zones[c.graphe.racine]!
  let best: { tx: number; ty: number } | null = null
  let bestD = -1
  for (let ty = 0; ty < height; ty += 3) {
    for (let tx = 0; tx < width; tx += 3) {
      const i = ty * width + tx
      if (c.zone[i] !== c.graphe.racine || c.rampe[i]) continue
      if (!terrainAdmet('iron_vein', terrain[i]!)) continue
      const d = distSq(tx, ty, r.x, r.y)
      // Le plus LOIN du cœur de la racine — mais toujours chez elle. Départage déterministe.
      if (d > bestD) { bestD = d; best = { tx, ty } }
    }
  }
  if (!best) return null
  return { id, type: 'iron_vein', tx: best.tx, ty: best.ty, stock: CONTENU.TEASER_STOCK, regrowAt: 0 }
}

// ────────────────────────────────────────────────────────────────────────────
// LE PEUPLEMENT — on ne dit JAMAIS non au joueur (spec R17)
// ────────────────────────────────────────────────────────────────────────────

export interface Emplacement {
  tx: number
  ty: number
  zone: number
}

/**
 * LES DANGERS DU PLACEMENT (worldgen R17bis) — ce que la liste des emplacements ÉVITE.
 *
 * Le paramètre est OBLIGATOIRE, et c'est voulu : un appelant qui l'oublierait rendrait la
 * garde muette en silence. Un monde qui n'a vraiment ni coins ni nids (carte de test) le dit
 * en passant deux tableaux vides.
 */
export interface DangersDePlacement {
  /** Les coins de chasse (`placeHuntingGrounds`) : leur territoire fait naître la faune —
   *  loups compris — autour de quiconque y vit. */
  coinsDeChasse: { x: number; y: number }[]
  /** Les RECTANGLES des lieux à monstre résident (`nidsAMonstre` — tanière, repaire). */
  nids: { x: number; y: number; w: number; h: number }[]
}

/**
 * LES EMPLACEMENTS DE VILLAGE — et **aucune règle n'en interdit un seul**.
 *
 * C'est la trouvaille du brainstorm, et elle est d'Alexis : *« on peut poser son village dès
 * qu'il y a de la place — par contre les ressources sont là où elles doivent être : dans le
 * blizzard, pas de bois ni d'eau liquide. »* **La distribution des ressources EST la règle de
 * peuplement.** Personne ne s'installe dans le Névé, non pas parce qu'on l'interdit, mais parce
 * qu'on n'y bâtit rien. Zéro code de restriction, zéro frustration de « emplacement interdit ».
 *
 * Cette fonction ne DÉCIDE donc rien : elle CONSTATE. Elle liste les endroits où un village
 * pourrait vivre — du bois, de la pierre, de la place — et le fait qu'ils soient tous dans les
 * zones nourricières est une **conséquence**, pas une consigne.
 *
 * R17bis étend le CONSTAT (2026-08-18, question ③ de la calibration) : « pourrait vivre »
 * veut aussi dire y SURVIVRE. Des baies à portée (la seule nourriture d'un village PNJ), pas
 * de nid à monstre au seuil, et hors du territoire d'un coin de chasse — mesuré au banc :
 * 4 fondateurs saignés à mort au JOUR 1 par la meute née de l'anneau (graine 1234). Le joueur,
 * lui, fonde toujours où il veut : `found_village` ne lit pas cette liste (R17 intact).
 */
export function emplacementsDeVillage(c: CarteZonee, nodes: ResourceNode[], dangers: DangersDePlacement): Emplacement[] {
  const { width, height, terrain } = c.map
  const out: Emplacement[] = []
  const ecart2 = MONDE.ESPACEMENT_VILLAGES * MONDE.ESPACEMENT_VILLAGES

  // Index des nœuds par maille — ET PAR ZONE.
  //
  // LA ZONE EST LA CORRECTION, et elle a un sens de jeu. Une maille de quarante tuiles DÉBORDE
  // chez la voisine : le Gouffre se mettait à compter les arbres d'à côté et devenait habitable
  // (mesuré, seed 7). Or entre les deux il y a une FALAISE — le bois d'en face ne se ramasse pas
  // sans faire le tour par un seuil. **On ne compte que ce qu'on peut aller chercher.**
  const maille = CONTENU.RAYON_VILLAGE
  const mw = Math.ceil(width / maille)
  const bois = new Map<number, number>()
  const pierre = new Map<number, number>()
  const baies = new Map<number, number>()
  const cle = (tx: number, ty: number, z: number): number =>
    (Math.floor(ty / maille) * mw + Math.floor(tx / maille)) * 32 + z
  for (const n of nodes) {
    const ti = n.ty * width + n.tx
    const k = cle(n.tx, n.ty, c.zone[ti]!)
    // Seul le bois SUR TERRAIN BOISÉ fonde un village. Les arbres épars du pré (des nœuds posés sur
    // l'herbe, cf. `arbresDuPre`) PONCTUENT la plaine — ils n'en font pas un chantier. Sans ce
    // filtre, quelques arbres rendraient TOUTE la plaine constructible, et le refuge ne reculerait
    // plus devant la cendre (R30). Pour tout arbre poussant sur son terrain naturel, c'est un no-op.
    if ((n.type === 'tree' || n.type === 'old_tree') && terrainAdmet('tree', terrain[ti]!)) {
      bois.set(k, (bois.get(k) ?? 0) + 1)
    }
    if (n.type === 'rock' || n.type === 'quarry') pierre.set(k, (pierre.get(k) ?? 0) + 1)
    if (n.type === 'berry_bush') baies.set(k, (baies.get(k) ?? 0) + 1)
  }

  // LE TERRITOIRE D'UN COIN DE CHASSE (R17bis) — l'écart se DÉRIVE, jamais écrit : c'est la
  // portée exacte à laquelle la faune du coin peut naître de la présence d'un villageois
  // (le disque du coin + l'anneau autour de l'hôte). Si la faune change, la garde suit.
  const ecartChasse = FAUNA.GROUND_RADIUS + FAUNA.SPAWN_RING_MAX
  const ecartChasse2 = ecartChasse * ecartChasse
  // Distance au RECTANGLE d'un nid (0 dedans) : l'empreinte d'un lieu, pas son centre.
  const presDUnNid = (tx: number, ty: number): boolean => {
    for (const n of dangers.nids) {
      const dx = Math.max(n.x - tx, 0, tx - (n.x + n.w))
      const dy = Math.max(n.y - ty, 0, ty - (n.y + n.h))
      if (dx * dx + dy * dy < CONTENU.ECART_NID * CONTENU.ECART_NID) return true
    }
    return false
  }

  const pas = CONTENU.PAS_BALAYAGE
  for (let ty = maille; ty < height - maille; ty += pas) {
    for (let tx = maille; tx < width - maille; tx += pas) {
      const i = ty * width + tx
      if (!TERRAINS[terrain[i]!]?.walkable || c.rampe[i]) continue

      // De la PLACE : un carré dégagé, tout marchable. On ne fonde pas dans un couloir.
      if (!degage(c, tx, ty)) continue

      // DU BOIS et DE LA PIERRE à portée, DANS SA PROPRE ZONE. C'est tout — et c'est ce qui, tout
      // seul, rend le Névé, le Glacier, les Aiguilles et le Gouffre inhabitables. Aucune règle ne
      // les interdit : on n'y bâtit simplement rien.
      const k = cle(tx, ty, c.zone[i]!)
      if ((bois.get(k) ?? 0) < CONTENU.BOIS_MIN) continue
      if ((pierre.get(k) ?? 0) < CONTENU.PIERRE_MIN) continue
      // DES BAIES (R17bis) : la seule nourriture d'un village PNJ. Le désert s'exclut ici.
      if ((baies.get(k) ?? 0) < CONTENU.BAIES_MIN) continue

      // UN SITE TENABLE (R17bis) : hors du territoire d'un coin de chasse, loin d'un nid.
      if (dangers.coinsDeChasse.some((g) => distSq(g.x, g.y, tx, ty) < ecartChasse2)) continue
      if (presDUnNid(tx, ty)) continue

      // LA BUTTE N'EST LE JARDIN DE PERSONNE (§2sexies R52) : un village ne se pose pas sur un
      // affleurement — la distance fait le prix du minerai. Même famille de CONSTAT que R17bis ;
      // le joueur, lui, fonde toujours où il veut (R17). `[]` sur le plan complet : no-op.
      if (c.affleurements.some((a) => {
        const dx = Math.max(a.rect.x - tx, 0, tx - (a.rect.x + a.rect.w))
        const dy = Math.max(a.rect.y - ty, 0, ty - (a.rect.y + a.rect.h))
        return dx * dx + dy * dy < CONTENU.DEGAGEMENT * CONTENU.DEGAGEMENT
      })) continue

      // Assez loin du village précédent : on se frotte, on ne se marche pas dessus.
      if (out.some((e) => distSq(e.tx, e.ty, tx, ty) < ecart2)) continue
      out.push({ tx, ty, zone: c.zone[i]! })
    }
  }
  return out
}

/** Un carré tout marchable autour du point : la place nette d'un foyer. */
function degage(c: CarteZonee, tx: number, ty: number): boolean {
  const { width, terrain } = c.map
  const r = CONTENU.DEGAGEMENT
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      if (!TERRAINS[terrain[y * width + x]!]?.walkable) return false
    }
  }
  return true
}

/**
 * LE SPAWN — ÉPARPILLÉ dans la racine (décision d'Alexis : *« pour éviter la guerre au
 * lancement »*).
 *
 * On ne fait naître personne au même endroit : cinquante joueurs qui apparaissent sur la même
 * tuile, ce sont cinquante joueurs qui se disputent le même arbre à la minute deux. On les
 * disperse sur les emplacements viables de la racine, les plus écartés qu'on trouve — un semis
 * glouton max-min, déterministe.
 */
export function pointsDeSpawn(
  c: CarteZonee,
  emplacements: Emplacement[],
  combien: number,
  front = 0,
): Emplacement[] {
  /**
   * LE SPAWN SUIT LE FRONT (spec R30, décision d'Alexis).
   *
   * Le serveur tourne des semaines. Si les Prés Bas sont sous la cendre au jour 30, celui qui
   * rejoint au jour 31 naîtrait **dans le feu** — il ne jouerait pas au même jeu que les autres.
   * On ne fait donc naître personne dans ce qui a brûlé.
   *
   * Et ça RACONTE quelque chose, ce qui ne gâche rien : les nouveaux arrivent par la bouche de la
   * vallée, en fuyant déjà.
   */
  const dans = emplacements.filter(
    (e) => e.zone === c.graphe.racine && !estCendre(c.map, e.tx, e.ty, front),
  )
  if (dans.length === 0) return []

  const r = c.graphe.zones[c.graphe.racine]!
  // On part du plus proche du cœur de la racine — un point d'ancrage déterministe…
  let depart = dans[0]!
  let bestD = Infinity
  for (const e of dans) {
    const d = distSq(e.tx, e.ty, r.x, r.y)
    if (d < bestD) { bestD = d; depart = e }
  }
  const out = [depart]
  // …puis chaque suivant est celui qui est le PLUS LOIN de tous les déjà pris.
  while (out.length < combien && out.length < dans.length) {
    let best: Emplacement | null = null
    let bestScore = -1
    for (const e of dans) {
      if (out.includes(e)) continue
      let score = Infinity
      for (const o of out) score = Math.min(score, distSq(e.tx, e.ty, o.tx, o.ty))
      if (score > bestScore) { bestScore = score; best = e }
    }
    if (!best) break
    out.push(best)
  }
  return out
}
