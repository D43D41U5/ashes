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
  NODE_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  TERRAIN_ROAD,
  TERRAIN_WET_MEADOW,
  TERRAIN_WILLOW,
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
   */
  FIBRE_PRAIRIE: 0.03,

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
  BAIES_LISIERE: 0.015,

  /**
   * LES TAS DE FEUILLES (forêts-vivantes §1 R1 — sel 'FEUI') : la fouille du sous-bois,
   * dans la bande du CORPS des feuillus — la seule bande sans objet propre (la lisière a
   * ses baies, le cœur ses champignons). Chance par tuile libre, passe appendue en queue.
   */
  TAS_FEUILLES: 0.02,

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
  const seed = (c.graphe.seed ^ 0x51ab3f77) | 0
  let id = 1

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      if (c.rampe[i]) continue // le seuil ne nourrit rien
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
  const occupees = new Set(nodes.map((n) => n.ty * width + n.tx))
  const arbres = arbresDeLaRacine(c, occupees, id)
  for (const a of arbres) nodes.push(a)
  id += arbres.length

  // ── LES VERGERS SAUVAGES — le lieu qui portait un NOM et rien d'autre ─────
  const vergers = vergersSauvages(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  for (const v of vergers) nodes.push(v)
  id += vergers.length

  // ── LES CHAMPIGNONS — abondants à l'humide/l'ombre, TRÈS RARES en forêt (verbe 3) ──
  const mush = champignonsRares(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  for (const m of mush) nodes.push(m)
  id += mush.length

  // ── LA FIBRE DES PRAIRIES HUMIDES — la place à fibre de la T0 (spec §2ter R34) ──
  const fibres = fibresDesPrairies(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  for (const f of fibres) nodes.push(f)
  id += fibres.length

  // ── LE TEASER — un seul filon, dans la racine, et il est dérisoire ────────
  const t = poserLeTeaser(c, id)
  if (t) { nodes.push(t); id += 1 }

  // ── LE TEASER DU BOIS NOIR — le patron du Filon, appliqué au gros bois ────
  const vieux = teaserDuBoisNoir(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  if (vieux) { nodes.push(vieux); id += 1 }

  // ── LA PROFONDEUR PORTE DU JEU (spec §2quater R40) — en QUEUE : aucun nœud d'avant ne bouge ──
  const baies = baiesDeLisiere(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  for (const b of baies) nodes.push(b)
  id += baies.length
  const coeurs = champignonsDuCoeur(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  for (const m of coeurs) nodes.push(m)
  id += coeurs.length
  const feuilles = tasDeFeuilles(c, new Set(nodes.map((n) => n.ty * width + n.tx)), id)
  for (const f of feuilles) nodes.push(f)
  return nodes
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
 */
export function emplacementsDeVillage(c: CarteZonee, nodes: ResourceNode[]): Emplacement[] {
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
