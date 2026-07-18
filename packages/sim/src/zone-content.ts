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
import { NODE_DEFS, TERRAIN_GRASS, TERRAINS, type NodeType } from './balance'
import { estCendre } from './cendre'
import type { ResourceNode } from './economy'
import { distSq } from './geometry'
import { fbm2, hash2 } from './noise'
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
  TEASER_STOCK: 3,

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
    commun: { tree: 0.32, rock: 0.1, fiber_plant: 0.08 },
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
      return n === 'forest' || n === 'old_growth' || n === 'pine' || n === 'larch' || n === 'burnt_forest'
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
      nodes.push({ id, type, tx, ty, stock: NODE_DEFS[type].stock, regrowAt: 0 })
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

  // ── LE TEASER — un seul filon, dans la racine, et il est dérisoire ────────
  const t = poserLeTeaser(c, id)
  if (t) nodes.push(t)
  return nodes
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
  const stock = NODE_DEFS.tree.stock
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
      } else if (terrainAdmet('tree', t)) {
        // LES CLAIRIÈRES : décidées par BLOC (cf. `clairiereForet`) → des trouées RECTANGULAIRES.
        // Le MÊME champ sert au rendu du sol (qui y verdit) : une source unique, sinon les
        // clairières des arbres et celles du sol divergeraient.
        if (clairiereForet(c.graphe.seed, tx, ty) > 0) continue // ce bloc est une clairière : nu
        pas = CONTENU.ARBRES_FORET_PAS; socle = 0.85; ampli = 0.4
      } else {
        continue // ni herbe ni forêt : ce sol garde sa nature (fleuraie, accent…)
      }

      const bosquet = fbm2(tx, ty, CONTENU.ARBRES_ECHELLE, (seed ^ 0x4be1) | 0)
      const chance = (1 / pas) * (socle + ampli * bosquet)
      if (hash2(tx, ty, (seed ^ 0x3d7a) | 0) >= chance) continue

      out.push({ id, type: 'tree', tx, ty, stock, regrowAt: 0 })
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
