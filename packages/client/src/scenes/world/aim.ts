/**
 * LE RÉSOLVEUR DE VISÉE — pur, zéro Phaser, donc prouvé par des tests.
 *
 * C'est ici qu'on répond aux deux seules questions que pose un clic dans le
 * monde : « qu'est-ce que je vise ? » et « qu'est-ce que ça déclenche ? ».
 * Extrait du closure Phaser exprès : la cascade qui vivait dans
 * `input-bindings.ts` cachait un piège (spec recolte.md), et un piège dans une
 * closure de handler ne se teste pas.
 *
 * LE PIÈGE, POUR MÉMOIRE : le clic gauche se résolvait « cadavre → nœud →
 * SINON BÂTIR ». Bâtir était donc le cas PAR DÉFAUT du clic dans le monde —
 * viser un arbre et tomber une tuile à côté ne faisait pas « rien », ça posait
 * un mur. L'échec était masqué tant qu'on n'avait pas de village ; le jour où
 * le Feu brûle, on se construit un mur en pleine coupe de bois.
 *
 * Désormais : bâtir est un MODE (`selected !== null`), et le clic nu ne peut
 * QUE récolter ou looter (spec recolte.md G1-G2).
 *
 * Aucune règle de jeu n'est décidée ici — la sim revalide tout (invariant §3).
 * On ne fait qu'éviter d'ÉMETTRE une action qu'on sait perdue d'avance.
 */
import { COMPONENT_TYPES, EDGE_E, EDGE_N, EDGE_O, EDGE_S, FOOD_VALUES, NODE_DEFS, STRUCTURE_HP, WEAPON_DAMAGE, edgeBarrierAt, isCropMature, isPlot, isRangedWeapon, piece, toolTier, type ItemId, type StructureType, type WallMaterial } from '@ashes/sim'
import type { Placeable } from '../../hud-state'
import type { ComponentType, Corpse, PlayerAction, ResourceNode } from '@ashes/sim'

/**
 * Le contexte de POSE (spec construction R8) : le palier de matériau choisi pour
 * mur/porte, et la structure DÉJÀ sur la tuile visée (pour l'améliorer d'un clic).
 */
export interface BuildContext {
  material: WallMaterial
  /**
   * L'ARÊTE ARMÉE (spec construction R23) — le bit que `A`/`E` ont choisi. Il part TEL QUEL dans
   * l'action `build` quand la pièce armée est un mur ou une porte ; sol et toit l'ignorent.
   */
  edge: number
  /**
   * LA PIÈCE DÉJÀ EN PLACE SUR LA CIBLE, celle qu'un clic AMÉLIORE au lieu de doubler.
   *
   * « La cible » n'est plus la tuile quand on pose sur une arête : c'est **l'arête armée**. Lire
   * la tuile ferait qu'un coin de pièce, qui porte déjà un mur au nord, améliorerait ce mur-là
   * au lieu de poser celui de l'ouest — le geste le plus courant de la construction (fermer un
   * angle) deviendrait impossible, et l'inventaire se viderait en améliorations non demandées.
   *
   * EN MODE DÉMOLIR, c'est la cible de la DESTRUCTION — résolue par `demolishTargetAt`, qui
   * ne rend que ce qui est À MOI. Une seule notion (« ce que ce clic touche »), donc un seul
   * champ : le surlignage rouge et l'action lisent la même chose ou l'on détruirait ailleurs
   * que là où on voit.
   */
  onTile: { id: number; type: StructureType } | null
  /**
   * LE MODE DÉMOLIR est-il armé au menu du marteau (décision d'Alexis, 2026-08-01) ? Armé, le
   * clic DÉTRUIT `onTile` — et ne fait rien d'autre : ni poser, ni récolter, ni frapper « en
   * passant ». C'est la règle des modes (voir plus bas) appliquée au geste destructeur, et
   * c'est ce qui empêche un marteau de casser un mur au milieu d'une coupe de bois.
   */
  demolir?: boolean
}

/**
 * CE QUE LE MODE DÉMOLIR DÉTRUIRAIT sur la tuile visée — `undefined` = rien, et « rien »
 * est une réponse fréquente : on ne démolit QUE SES PROPRES constructions (décision
 * d'Alexis, 2026-08-01). Le mur d'un voisin n'a donc aucune affordance ici.
 *
 * La sim, elle, garde sa règle (propriétaire OU Chef, spec village R9/A5) : ce filtre est
 * l'AFFORDANCE du joueur, pas le droit. Il ne relâche rien — il resserre.
 *
 * TROIS COUCHES ET QUATRE ARÊTES PEUVENT SE PARTAGER UNE TUILE (spec construction §116, R23) :
 * un sol, un toit, un coffre, et jusqu'à quatre barrières d'arête — « le coin d'une pièce porte
 * deux murs distincts… deux démolitions ». « La première structure de la tuile » détruirait
 * donc au hasard, et la sim ne peut pas rattraper ça : elle accepte tout `structureId` valide.
 *
 * C'EST LE CURSEUR QUI DÉSIGNE, PAS L'ARÊTE ARMÉE (mesuré au navigateur le 2026-08-01 : sur un
 * coin, `A`/`E` armées sur une arête vide ne surlignaient RIEN et le clic restait muet — un
 * mode invisible, puisque le fantôme de pose est éteint pendant qu'on démolit). On prend donc
 * la position EXACTE du curseur dans la tuile et l'on sert l'arête la PLUS PROCHE qui porte
 * quelque chose à moi : viser le mur qu'on veut casser suffit, et le surlignage rouge saute
 * d'un mur à l'autre à mesure qu'on glisse. L'ordre :
 *
 *   1. les ARÊTES, de la plus proche du curseur à la plus lointaine — par `edgeBarrierAt`, qui
 *      trouve la barrière DES DEUX CÔTÉS du trait : un mur du coin peut être déclaré sur la
 *      tuile voisine (bit opposé), et il serait alors indémolissable depuis celle qu'on vise ;
 *   2. les COUCHES de la tuile, dans l'ordre où l'on démonte une maison : ce qui se tient
 *      DEBOUT (coffre, four, feu libre), puis ce qui COUVRE (toit), puis ce qui PORTE (sol).
 */
export function demolishTargetAt<S extends DemolishStructure>(
  structures: readonly S[],
  /** Position du curseur en TUILES, fraction comprise (c'est elle qui désigne l'arête). */
  wx: number,
  wy: number,
  playerId: number,
  /** LE LEVAGE DU PLAN DE TOIT, EN TUILES (calage du 2026-08-10) : le sprite d'un toit se
   *  dessine à la crête du mur, `MUR_HT` au-dessus de sa tuile — le toit qu'on VOIT sous le
   *  curseur est donc celui de la tuile d'en dessous (`ty + leveToitTuiles`). L'appelant passe
   *  la valeur DÉRIVÉE (`MUR_HT / TILE_PX`), jamais un nombre à lui ; 0 = couches au sol. */
  leveToitTuiles = 0,
): S | undefined {
  // JE NE SAIS PAS ENCORE QUI JE SUIS → RIEN N'EST À MOI. Les ids d'entité commencent à 1
  // (`nextEntityId`), donc 0 ne désigne personne : c'est la valeur d'attente de `WorldScene`
  // avant le `ready`. Or `ownerId === 0` veut dire « au village / au monde » — sans cette
  // garde, un snapshot arrivé trop tôt rendrait tout le bâti de POI démolissable d'un clic.
  if (playerId === 0) return undefined
  const tx = Math.floor(wx)
  const ty = Math.floor(wy)
  const u = wx - tx
  const v = wy - ty
  const mien = (s: S | undefined): s is S => s !== undefined && s.ownerId === playerId && demolissable(s)
  // Les quatre arêtes triées par distance au curseur. Tri STABLE (ES2019) : à égalité parfaite
  // — le curseur pile au centre — l'ordre déclaré tranche, donc la visée ne vacille jamais.
  const aretes = [
    { bit: EDGE_N, d: v },
    { bit: EDGE_E, d: 1 - u },
    { bit: EDGE_S, d: 1 - v },
    { bit: EDGE_O, d: u },
  ].sort((a, b) => a.d - b.d)
  for (const { bit } of aretes) {
    const b = edgeBarrierAt(structures, tx, ty, bit)
    if (mien(b)) return b
  }
  const couche = (pred: (s: S) => boolean): S | undefined =>
    structures.find(
      (s) => s.tx === tx && s.ty === ty && (s.edges === undefined || s.edges === 0) && mien(s) && pred(s),
    )
  // LE TOIT SE VISE OÙ IL SE VOIT. Son sprite étant levé, la tuile qu'il recouvre à l'écran est
  // `leveToitTuiles` plus HAUT que la sienne — on résout donc le toit de la tuile d'en dessous.
  // Sans ça, cliquer le chaume visible sélectionnait le toit deux rangées plus au sud, et le
  // halo s'allumait 32 px au-dessus du curseur (revue du 2026-08-10 — le défaut « le curseur
  // vise un billboard », réintroduit pour les toits par le levage). Le solide garde la main :
  // dedans, le toit fond (alpha 0,12) et c'est bien le coffre qu'on voit et qu'on vise.
  const toitVisible = (): S | undefined =>
    structures.find(
      (s) => s.tx === tx && s.ty === ty + leveToitTuiles && (s.edges === undefined || s.edges === 0) && mien(s) && s.type === 'roof',
    )
  return (
    couche((s) => s.type !== 'floor' && s.type !== 'roof') ??
    toitVisible() ??
    couche((s) => s.type === 'floor')
  )
}

/** Ce qu'il faut savoir d'une structure pour dire si le marteau la détruit — un SOUS-ENSEMBLE
 *  du `Structure` du snapshot (même patron qu'`AimStructure`) : le résolveur reste pur et se
 *  teste sans fabriquer une structure complète. */
export interface DemolishStructure {
  id: number
  tx: number
  ty: number
  type: StructureType
  /** À QUI elle est. C'est TOUT le filtre « seules ses propres constructions ». */
  ownerId: number
  /** 0 = pièce libre (hors village) — ce qui distingue un feu de camp d'un Foyer. */
  villageId: number
  /** Le(s) bit(s) d'arête d'une barrière ; absent = la pièce prend sa tuile entière. */
  edges?: number
}

/** Ce que la sim refuserait de toute façon : le Feu D'UN VILLAGE ne s'éteint pas (village.ts,
 *  spec village R9). Un feu de camp LIBRE, lui, se démonte — c'est un objet de survie. */
function demolissable(s: DemolishStructure): boolean {
  return !(s.type === 'fire' && s.villageId !== 0)
}

/** Ce qu'il y a sous le curseur, et si c'est à portée de bras. */
export interface AimTarget {
  tx: number
  ty: number
  /** Le cadavre sur la tuile (il PRIME sur le nœud : on ouvre ce qu'on vient de tuer). */
  corpseId: number | null
  /** Le nœud RÉCOLTABLE (stock > 0) sur la tuile. */
  nodeId: number | null
  /**
   * LA FAMILLE D'OUTIL de ce nœud — `'axe'`, `'pickaxe'`, ou `null` (le geste nu : fibre,
   * baies, champignons, tourbe). Lue du registre (`NODE_DEFS[type].tool`), jamais recopiée.
   *
   * Elle existe pour UNE question, depuis que la hache est une arme (décision d'Alexis,
   * 2026-08-20) : l'objet en main est-il l'outil DE CE NŒUD-CI ? C'est ce qui permet à la
   * hache de fer d'abattre un arbre au lieu de frapper dans le vide, sans qu'une lance ne
   * se mette pour autant à couper du bois.
   */
  nodeTool: 'axe' | 'pickaxe' | null
  /** L'ENTITÉ (PNJ/joueur) visée sous le curseur, à portée du joueur — la cible d'un DON
   *  ou d'un soin (spec alignement/combat). `null` = personne sous le curseur à portée. */
  entityId: number | null
  /** L'entité visée SAIGNE-t-elle (ou boite, ou a le bras cassé) ? La cible d'un soin.
   *  Faux si personne n'est visé. Le snapshot porte les plaies de chacun ; la sim revalide. */
  entityWounded: boolean
  /** Un FEU (structure) est-il sur la tuile visée ? La cible de `feed_fire` (du bois en main
   *  + clic sur le Feu → on le nourrit). La sim vise TOUJOURS le foyer de l'acteur. */
  onFire: boolean
  /** L'id du FEU visé (structure) — pour ouvrir SON modal à la touche F (spec feu-station S17).
   *  `null` = aucun feu sous le curseur. La portée se lit sur `inRange`. */
  fireId: number | null
  /** Une structure ABÎMÉE (hp < max, hors Feu) sur la tuile visée — la cible de `repair`
   *  (du bois en main + clic → on la répare). `null` = rien à réparer ici. La sim revalide
   *  l'appartenance et la portée. */
  repairableId: number | null
  /** Une PARCELLE vide sur la tuile visée — la cible de `plant` (une graine en main + clic). */
  plantableId: number | null
  /** Une PARCELLE mûre sur la tuile visée — la cible de `harvest_crop` (clic, mains libres). */
  harvestableId: number | null
  /**
   * LA PILE AU SOL visée — la cible de `pick_up` (spec chasse C18, `tir.md` T6).
   *
   * L'action existe dans /sim depuis les piles au sol, mais AUCUN geste ne l'atteignait :
   * ce qu'on jetait était perdu. Le tir l'a rendu intenable — une flèche qui retombe et
   * qu'on ne peut pas reprendre n'est pas un coût, c'est une fuite.
   */
  pileId: number | null
  /** Distance ≤ `range` entre le joueur et le CENTRE de la tuile visée. */
  inRange: boolean
}

/** Ce dont `aimAt` a besoin d'une structure pour trancher feed_fire/repair (sous-ensemble de `Structure`). */
export interface AimStructure {
  id: number
  tx: number
  ty: number
  type: StructureType
  hp: number
  /** Le tick de mise en terre — parcelles seulement (agriculture). Pour la maturité. */
  plantedAt?: number
}

/** Le curseur doit être à peu près SUR l'entité (≤ ça, en tuiles) pour la viser — sinon
 *  un clic dans le vide près d'un PNJ donnerait « en passant ». */
const AIM_ENTITY_TILES = 1.4

/** Que vise-t-on ? Purement descriptif : aucune action décidée ici. */
export function aimAt(
  tx: number,
  ty: number,
  player: { x: number; y: number },
  nodes: readonly ResourceNode[],
  corpses: readonly Corpse[],
  range: number,
  /** Les autres entités (PNJ/joueurs) — SANS soi ni les monstres : le caller filtre.
   *  `wounds` est OPTIONNEL : un appelant qui ne vise que le don n'a pas à le fournir. */
  entities: readonly { id: number; x: number; y: number; wounds?: { leg?: true; arm?: true; bleeding?: true } }[] = [],
  /** Les structures — pour repérer le Feu (feed_fire), une structure abîmée (repair), une
   *  parcelle à semer/récolter (agriculture) visés. */
  structures: readonly AimStructure[] = [],
  /** Le tick courant (dernier snapshot) — pour juger la MATURITÉ d'une parcelle (harvest_crop). */
  tick = 0,
  /** Les piles au sol (spec chasse C18) — la cible de `pick_up`. Vide par défaut : un
   *  appelant qui ne vise que le don n'a pas à les fournir. */
  piles: readonly { id: number; x: number; y: number }[] = [],
): AimTarget {
  const corpse = corpses.find((c) => Math.floor(c.x) === tx && Math.floor(c.y) === ty)
  // LA PILE de la tuile visée. Comme le cadavre : on la cherche à la TUILE, parce qu'une
  // pile n'a pas d'emprise — c'est un tas posé, et le joueur désigne un carreau de sol.
  const pile = piles.find((p) => Math.floor(p.x) === tx && Math.floor(p.y) === ty)
  const node = nodes.find((n) => n.tx === tx && n.ty === ty && n.stock > 0)
  // Une seule passe sur les structures de la tuile : le Feu se NOURRIT (feed_fire, jamais
  // « réparé ») ; toute structure abîmée se RÉPARE ; une parcelle se SÈME (vide) ou se RÉCOLTE
  // (mûre). `STRUCTURE_HP` est TOTAL sur `StructureType` — pas de garde. Maturité PURE (isCropMature).
  let onFire = false
  let fireId: number | null = null
  let damaged: AimStructure | undefined
  let plantable: AimStructure | undefined
  let harvestable: AimStructure | undefined
  for (const s of structures) {
    if (s.tx !== tx || s.ty !== ty) continue
    if (s.type === 'fire') {
      onFire = true
      fireId = s.id
      continue
    }
    if (s.hp < STRUCTURE_HP[s.type]) damaged = s // toute structure hors Feu, abîmée, se répare
    if (isPlot(s.type)) {
      // Parcelle (plein air) / serre (hiver) / terroir (le meilleur) se sèment/récoltent pareil ;
      // la sim tranche le gel de la terre à ciel ouvert (sur le CLIMAT DU LIEU depuis
      // `flore-froid.md` F4, plus sur l'acte) et le rendement au moment voulu.
      if (s.plantedAt === undefined) plantable = s
      else if (isCropMature(s, tick)) harvestable = s
    }
  }
  const dx = tx + 0.5 - player.x
  const dy = ty + 0.5 - player.y

  // L'ENTITÉ visée : la plus proche du CURSEUR (tuile visée), à condition d'être sous le
  // curseur (≤ AIM_ENTITY_TILES) ET à portée de bras du JOUEUR (la sim revalide la portée).
  let entityId: number | null = null
  let entityWounded = false
  let bestD = AIM_ENTITY_TILES * AIM_ENTITY_TILES
  for (const e of entities) {
    const cx = e.x - (tx + 0.5)
    const cy = e.y - (ty + 0.5)
    const dCursor = cx * cx + cy * cy
    const px = e.x - player.x
    const py = e.y - player.y
    if (px * px + py * py <= range * range && dCursor < bestD) {
      bestD = dCursor
      entityId = e.id
      // La plaie de la CIBLE, pas la mienne. C'est toute la différence entre « je me panse »
      // et « je le panse » — et c'est ce que le client ne portait pas jusqu'ici.
      const w = e.wounds
      entityWounded = Boolean(w && (w.bleeding || w.leg || w.arm))
    }
  }

  return {
    tx,
    ty,
    corpseId: corpse?.id ?? null,
    nodeId: node?.id ?? null,
    nodeTool: node ? NODE_DEFS[node.type].tool : null,
    entityId,
    entityWounded,
    onFire,
    fireId,
    repairableId: damaged?.id ?? null,
    plantableId: plantable?.id ?? null,
    harvestableId: harvestable?.id ?? null,
    pileId: pile?.id ?? null,
    inRange: dx * dx + dy * dy <= range * range,
  }
}

/**
 * Que déclenche un clic gauche sur cette visée ? `null` = RIEN, et « rien » est
 * une réponse légitime — c'est même toute la correction : un clic dans le vide
 * ne doit plus retomber sur `build`.
 *
 * En mode construction (`selected !== null`), le clic BÂTIT, point. On ne récolte
 * pas « en passant » avec un marteau en main : le mode dit ce que le clic fait,
 * et c'est ce qui le rend prévisible.
 */
/**
 * L'OBJET EN MAIN DÉCIDE DU CLIC (décision utilisateur, 2026-07-13). C'est la règle
 * qui remplace les quinze touches de verbes qu'on a débranchées — et c'est la seule
 * qu'il y ait à apprendre :
 *
 *   · de la NOURRITURE en main  → on mange (au clic maintenu) ;
 *   · une ARME en main          → on frappe, vers le curseur ;
 *   · un nœud / un cadavre visé → on récolte, on fouille ;
 *   · sinon                     → on frappe quand même (mains nues, ou le manche).
 *
 * Le dernier cran est vital : sans lui, un joueur sans arme serait SANS DÉFENSE la
 * nuit — et la nuit chasse. Une punition sans parade est un impôt.
 *
 * Pur : c'est ici que la règle se prouve, pas dans un closure Phaser.
 */
export interface HandContext {
  /** Ce qu'on TIENT (spec inventaire R9). `null` = mains nues. */
  held: ItemId | null
  /** Le slot de ceinture SÉLECTIONNÉ — la sim consomme CE slot, pas un autre.
   *  Absent = pas de désignation (un test) : la sim retombe sur sa règle par défaut. */
  slot?: number
  /** Le joueur a-t-il une plaie ? (saignement/jambe/bras). C'est la CONDITION du
   *  bandage : des fibres en main NE pansent que si l'on saigne — sinon le clic
   *  retombe sur la frappe (la défense du pauvre survit, cf. le dernier cran). */
  wounded?: boolean
  /** Combien on tient dans la case active — le MONTANT d'un don (spec alignement). Sans
   *  lui, on donne 1 (le contrat par défaut). */
  heldCount?: number
  /** Direction vers le curseur, depuis l'avatar (non normalisée : la sim le fait). */
  dx: number
  dy: number
}

/**
 * LE MATÉRIAU DE SOIN — aujourd'hui, les fibres, et elles seules (spec combat R7 :
 * `BANDAGE_FIBER_COST`). Tenir des fibres est le geste du bandage prévu par la
 * grammaire ceinture+clic (voir plus bas). Isolé en fonction pour que le jour où un
 * `pansement` craftable existe, on l'ajoute ICI, à un seul endroit.
 */
export function isCareMaterial(item: ItemId | null): boolean {
  return item === 'fiber'
}

/** MANGER le slot qu'on tient — on transmet l'index à la sim pour qu'elle croque CE
 *  slot, jamais un autre (spec inventaire R9). Sans index désigné, on n'en met pas. */
function eatHeld(hand: HandContext): PlayerAction {
  return hand.slot !== undefined && hand.slot >= 0
    ? { type: 'eat', item: hand.held!, slot: hand.slot }
    : { type: 'eat', item: hand.held! }
}

export function isFood(item: ItemId | null): boolean {
  return item !== null && FOOD_VALUES[item] !== undefined
}

export function isWeapon(item: ItemId | null): boolean {
  return item !== null && WEAPON_DAMAGE[item] !== undefined
}

/**
 * L'OBJET EN MAIN EST-IL L'OUTIL DE CE NŒUD-CI ? (décision d'Alexis, 2026-08-20)
 *
 * Née d'une contradiction entre deux décisions actées : `decisions.md:250` disait « la hache
 * n'est pas une arme », `:468` a fait de `steel_axe` l'arme la plus forte du jeu. Alexis a
 * tranché pour 468 — **la hache EST une arme**. Mais elle reste AUSSI le palier haut de sa
 * famille d'outil (`TOOL_TIERS.axe`, rendement fer ×4 et acier ×5 contre atelier ×3) : lire
 * la décision comme « donc elle ne coupe plus » supprimerait les deux derniers barreaux sur
 * cinq de la progression d'abattage et ferait de `TOOL_TIERS` une table menteuse.
 *
 * On ne RECOPIE pas la table : on appelle `toolTier`, « LA règle, en un seul endroit », dont
 * `TOOL_YIELD` et `TOOL_RANK` dérivent tous les deux. Un outil de la famille rend un palier
 * autre que `'none'` ; tout le reste (une lance, un arc, une pierre) rend `'none'`.
 */
export function estLOutilDuNoeud(item: ItemId | null, family: 'axe' | 'pickaxe' | null): boolean {
  if (item === null || family === null) return false
  return toolTier(item, family) !== 'none'
}

/**
 * CE QUI SE POSE SANS MARTEAU — composants et coffre tenu.
 *
 * Écrit comme prédicat de type pour que le compilateur porte la suite : ce qui survit à ce
 * test EST une pièce du marteau, et un `Placeable` neuf qui ne serait ni composant ni pièce
 * de marteau ferait rougir `tsc` au lieu de partir en coup de poing.
 */
function estPosableSansMarteau(p: Placeable): p is ComponentType | 'chest' {
  return (COMPONENT_TYPES as readonly string[]).includes(p) || p === 'chest'
}

export function clickToAction(
  target: AimTarget,
  placing: Placeable | null,
  hand?: HandContext,
  build?: BuildContext,
): PlayerAction | null {
  // DÉMOLIR PRIME SUR TOUT (décision d'Alexis, 2026-08-01) : c'est un MODE, armé au menu du
  // marteau, et un mode dit ce que le clic fait. Sans cible — rien à moi sous le curseur —
  // le clic ne fait RIEN : il ne retombe ni sur la récolte ni sur la frappe. Le marteau armé
  // pour détruire ne doit pas se mettre à couper du bois parce qu'on a visé à côté.
  if (build?.demolir) return build.onTile ? { type: 'demolish', structureId: build.onTile.id } : null
  // POSER prime sur tout : quand on tient un feu de camp (ou qu'une pièce est armée),
  // le clic POSE, il ne récolte ni ne frappe « en passant ». Le mode dit ce que le
  // clic fait — c'est ce qui le rend prévisible (même règle que le fantôme).
  if (placing === 'fire') return { type: 'place_campfire', tx: target.tx, ty: target.ty }
  // Un COMPOSANT ou le COFFRE tenu se pose (spec construction R20, flux feu de camp).
  // LE TEST EST UN PRÉDICAT DE TYPE, PAS UN `includes` NU : c'est lui qui laisse le
  // compilateur savoir qu'après ce `return`, il ne reste que des pièces du MARTEAU. La
  // version précédente ne restreignait rien, et l'exhaustivité du bloc suivant ne tenait
  // qu'à l'énumération à la main qui l'a fait échouer sur `cloture` et `encadrement`.
  if (placing !== null && estPosableSansMarteau(placing)) {
    return { type: 'place_component', tx: target.tx, ty: target.ty }
  }
  if (placing !== null) {
    // Cliquer un MUR/PORTE existant, une pièce mur/porte armée, l'AMÉLIORE au palier
    // de matériau choisi (spec construction R8) — plutôt que de buter « tuile occupée ».
    if (
      (placing === 'wall' || placing === 'door') &&
      build?.onTile &&
      (build.onTile.type === 'wall' || build.onTile.type === 'door')
    ) {
      return { type: 'upgrade_structure', structureId: build.onTile.id }
    }
    // `material` n'accompagne QUE mur/porte (les pièces molles n'en ont pas) : on ne
    // le glisse dans l'action que là — `exactOptionalPropertyTypes` refuse un `undefined`.
    // ET L'ARÊTE VA AVEC (R23) : un mur de joueur ne prend plus sa tuile. Sans `build`
    // (un appelant qui n'en fournit pas), on retombe sur le NORD plutôt que sur la pose
    // pleine tuile — le fantôme, lui, dessine toujours une arête, et les deux doivent dire
    // la même chose ou l'on poserait ailleurs que là où on vise.
    if (placing === 'wall' || placing === 'door') {
      return {
        type: 'build',
        structure: placing,
        tx: target.tx,
        ty: target.ty,
        material: build?.material ?? 'wood',
        edges: build?.edge ?? EDGE_N,
      }
    }
    // ═══ LE RESTE SE DÉRIVE DU REGISTRE — IL NE S'ÉNUMÈRE PAS ═══
    //
    // Ce bloc listait `palissade`, puis `floor` et `roof`, et se refermait SANS branche par
    // défaut. `cloture` et `encadrement`, passées au marteau le 2026-08-01 (D1), tombaient donc
    // à travers et traversaient tout le bas de la fonction jusqu'à `attack` : le joueur armait
    // sa clôture, voyait le fantôme, voyait la tuile verte — et donnait un coup de poing, sans
    // même un `action_rejected` pour l'expliquer. Deux pièces livrées, mortes en jeu.
    //
    // Une garde par cas choisi ne couvre pas une union qui s'élargit. On demande donc au
    // REGISTRE, comme `carre-village` et `WorldScene.placeable` le font déjà : ce qui n'est pas
    // `arete: 'interdite'` se pose sur une arête, le reste prend sa tuile. La palissade y rentre
    // sans cas particulier (`arete: 'requise'`, et pas de matériau : le bois est son essence).
    //
    // ⚠ CE GESTE DÉPEND MAINTENANT D'UN CHAMP QUE L'AUDIT DIT MENTEUR. `cloture` et
    // `encadrement` déclarent `arete: 'interdite'`, et c'est bien ainsi que le joueur les pose
    // (pleine tuile, comme `construction.test.ts` D1 l'affirme) — mais le WORLDGEN, lui, en pose
    // sur des arêtes (mesuré sur le monde servi : 38 clôtures et 4 encadrements). Le jour où
    // quelqu'un « corrige » le registre pour coller au worldgen, la pose du JOUEUR basculera
    // silencieusement sur l'arête. Les deux usages doivent être démêlés avant de toucher au
    // champ — c'est le constat `arete-ecrite-hors-registre` de l'audit du 2026-08-20.
    return piece(placing).arete === 'interdite'
      ? { type: 'build', structure: placing, tx: target.tx, ty: target.ty }
      : { type: 'build', structure: placing, tx: target.tx, ty: target.ty, edges: build?.edge ?? EDGE_N }
  }

  // DONNER (spec alignement R2, l'acte chaud FONDAMENTAL) : de la nourriture en main ET un
  // voisin sous le curseur → on le NOURRIT, lui. Prime sur MANGER : viser un PNJ dit « c'est
  // pour toi ». Le geste unique qui laisse choisir le Foyer (sinon le seul bouton est piller).
  // La sim revalide tout (portée, extérieur, satiété) et ne compte l'acte chaud que si utile.
  if (hand && isFood(hand.held) && target.entityId !== null) {
    return { type: 'give', targetEntityId: target.entityId, item: hand.held!, count: hand.heldCount ?? 1 }
  }

  // MANGER : on tient de quoi, on croque. (Le clic maintenu répète — voir holdHarvest.)
  if (hand && isFood(hand.held)) return eatHeld(hand)

  // PANSER QUELQU'UN (décision d'Alexis 2026-07-28 : TOUT blessé, étranger compris) — le
  // troisième verbe chaud, et le dernier qui manquait au joueur. La sim l'acceptait DÉJÀ et
  // le récompensait (`combat.ts` → `HEAL_OUTSIDER_WARMTH`) ; le client, lui, ne savait panser
  // que soi. Il contredisait donc la sim, et le dilemme du voisin n'avait que deux issues —
  // donner ou piller — là où le froid en a deux aussi. Un étranger blessé devient une
  // OCCASION, pas seulement une menace ou une ressource.
  //
  // Même règle que le DON, et pour la même raison : viser quelqu'un dit « c'est pour toi ».
  // On passe donc AVANT le soin sur soi — sinon, en saignant tous les deux, le clic sur le
  // voisin se serait soigné moi. La sim revalide tout (portée, plaie, fibres, cooldown), et
  // elle seule décide si l'acte est chaud.
  if (hand && isCareMaterial(hand.held) && target.entityId !== null && target.entityWounded) {
    return { type: 'bandage', targetEntityId: target.entityId }
  }

  // SE PANSER (spec combat R7) : des fibres en main ET une plaie → on se bande. Placé
  // AVANT la frappe et la récolte : si l'on a équipé des fibres en saignant, le clic
  // SOIGNE, il ne part pas frapper un buisson ni récolter « en passant ». Sans plaie,
  // on tombe plus bas (la frappe) — tenir des fibres n'ôte pas la défense du pauvre.
  // C'est un TAP délibéré (une plaie par bandage) : le maintien ne le répète pas, pour
  // ne pas cracher des « trop tôt » dans le flux que la chronique lit. Cible : soi.
  if (hand && isCareMaterial(hand.held) && hand.wounded) return { type: 'bandage' }

  // NOURRIR LE FEU (spec construction R16) : du BOIS en main + le Feu sous le curseur, à portée
  // → on l'alimente. « Le seul geste qui tient l'upkeep » : c'est le levier JOUEUR de la mortalité
  // du village (sans lui, le Feu se vide et le foyer tombe en ruine sans recours). La sim vise
  // TOUJOURS le foyer de l'acteur (pas la tuile cliquée) et revalide membre/portée/place.
  if (hand && hand.held === 'wood' && target.onFire && target.inRange) return { type: 'feed_fire' }
  // RÉPARER : du BOIS en main + une structure ABÎMÉE sous le curseur, à portée → on la répare.
  // Le pendant défensif du feed_fire : après une horde, remurer sa maison de sa propre main
  // plutôt que d'attendre un PNJ. La sim revalide l'appartenance, la portée et le coût.
  if (hand && hand.held === 'wood' && target.repairableId !== null && target.inRange)
    return { type: 'repair', structureId: target.repairableId }
  // SEMER (agriculture voie A) : une GRAINE en main + une parcelle VIDE sous le curseur, à
  // portée → on la met en terre. La pousse se dérive ensuite du tick (pur). La sim revalide.
  if (hand && hand.held === 'graine' && target.plantableId !== null && target.inRange)
    return { type: 'plant', structureId: target.plantableId }

  // UN ARC NE FRAPPE PAS, ET NE RÉCOLTE PAS NON PLUS (spec `tir.md` T2, décision
  // d'Alexis). Le clic gauche reste le bouton du TIR (il décoche, arc levé — voir
  // input-bindings) ; arc BAISSÉ, il est inerte.
  //
  // Inerte, et surtout PAS « il retombe sur la règle du dessous » : laisser un porteur
  // d'arc glisser jusqu'à `harvest` ferait exactement ce que la règle ci-dessous existe
  // pour empêcher — un clic de panique qui part cueillir un buisson pendant qu'un loup
  // arrive. Une arme en main reste une arme en main, même quand elle ne peut rien de près.
  if (hand && isRangedWeapon(hand.held ?? 'unarmed')) return null

  // L'OUTIL PRIME SUR L'ARME — MAIS SEULEMENT SUR SON PROPRE NŒUD (décision d'Alexis,
  // 2026-08-20 : « la hache est une arme »).
  //
  // La hache de fer et la hache d'acier sont dans `WEAPON_DAMAGE` ET sont les paliers haut
  // de `TOOL_TIERS.axe`. Sans cette branche, la règle du dessous les envoyait FRAPPER un
  // arbre : on forgeait le meilleur outil du palier fer et on perdait la capacité de couper
  // du bois — les rendements ×4 et ×5 devenaient inatteignables, alors que la sim, elle, les
  // accordait volontiers (`case 'harvest'` n'a aucune garde « arme en main »). C'était un
  // défaut de TRANSMISSION, pas de règle.
  //
  // Ce n'est PAS une exception à « l'objet en main décide du clic » : c'est son complément —
  // quand l'objet sait faire les deux, la CIBLE tranche. Et les deux autres motifs de
  // `decisions.md:250` tiennent toujours : une lance ne coupe rien (elle n'appartient à
  // aucune famille d'outil, `toolTier` rend `'none'`), et le clic de panique ne peut partir
  // récolter que si le curseur est PILE sur un nœud de sa propre famille — pas sur un buisson
  // quelconque, pas à côté.
  //
  // Rien à câbler en aval : `input-bindings` route sur le TYPE rendu ici, donc un `harvest`
  // sur un arbre arme la jauge d'abattage (`harvest_charge_start`) exactement comme avec une
  // hache d'atelier, et sur un filon il verrouille le rocher.
  if (hand && target.inRange && target.nodeId !== null && estLOutilDuNoeud(hand.held, target.nodeTool))
    return { type: 'harvest', nodeId: target.nodeId }

  // FRAPPER : une arme en main frappe TOUJOURS — on ne coupe pas du bois avec une
  // lance, et surtout on ne veut pas qu'un clic de panique parte récolter un buisson
  // pendant qu'un loup arrive.
  if (hand && isWeapon(hand.held)) return { type: 'attack', dx: hand.dx, dy: hand.dy }

  // Hors portée, on n'émet rien : la sim refuserait, et un refus n'est pas
  // gratuit (c'est un SimEvent que la chronique consomme — spec recolte.md G7).
  if (target.inRange) {
    if (target.corpseId !== null) return { type: 'loot_corpse', corpseId: target.corpseId }
    if (target.nodeId !== null) return { type: 'harvest', nodeId: target.nodeId }
    // RÉCOLTER LE POTAGER (agriculture voie A) : une parcelle MÛRE, mains libres → on cueille
    // (comme un nœud). La sim revalide la maturité, l'appartenance, la portée.
    if (target.harvestableId !== null) return { type: 'harvest_crop', structureId: target.harvestableId }
  }

  // RIEN À RÉCOLTER, RIEN EN MAIN : on frappe. C'est la défense du pauvre, et elle
  // doit exister — sinon la nuit qui chasse n'a pas de parade pour qui n'a pas
  // encore d'arme, et une punition sans parade n'est pas une punition.
  if (hand) return { type: 'attack', dx: hand.dx, dy: hand.dy }
  return null
}

/**
 * Le clic MAINTENU récolte-t-il, et à quel rythme ? (spec recolte.md G6-G8)
 *
 * Le client CADENCE lui-même : sans ça, un maintien enverrait une `harvest` par
 * frame pour se faire rejeter « trop tôt » 19 fois sur 20 — et chaque refus est
 * un `action_rejected` de plus dans le flux d'événements, que l'alignement et la
 * chronique consomment. Le flux n'est pas une poubelle.
 *
 * La cible est RÉ-ÉVALUÉE à chaque coup (le nœud s'épuise, le curseur bouge, la
 * caméra glisse encore après la course) : on récolte ce qu'on vise MAINTENANT.
 *
 * IL NE FRAPPE PLUS (spec combat R4ter). Le maintien MARTELAIT : une attaque par
 * seconde, tant que le doigt restait sur le bouton. Ce geste appartient désormais à
 * la CHARGE — maintenir arme un coup lourd, il ne répète plus le léger. Un même
 * bouton ne peut pas vouloir dire « refrappe » et « charge » : il fallait choisir,
 * et l'utilisateur a choisi la charge. Le martèlement, lui, reste pour la récolte et
 * la nourriture, où il ne coûte rien à personne.
 */
export function holdHarvest(
  target: AimTarget,
  placing: Placeable | null,
  now: number,
  lastSentAt: number,
  cooldownMs: number,
  hand?: HandContext,
): PlayerAction | null {
  if (placing !== null) return null // en pose (construction ou feu de camp), le maintien ne martèle rien
  if (now - lastSentAt < cooldownMs) return null

  // ⚠ LA PRÉMISSE « une ARME ne passe jamais par ici » ÉTAIT FAUSSE POUR L'ARC, et elle l'a
  // été en silence. Elle tenait pour une arme de MÊLÉE : `input-bindings` voit partir la
  // charge à l'appui et n'appelle plus ce résolveur tant qu'elle dure. Mais un ARC ne charge
  // pas au clic gauche — `clickToAction` rend `null` pour lui, exprès — et `holding` est armé
  // INCONDITIONNELLEMENT à l'appui (`input-bindings:739`, avant toutes les branches de
  // sortie). Le maintien retombait donc ici sans garde : le clic gauche, MUET en tapant, se
  // mettait à RÉCOLTER dès qu'on le tenait. C'est très exactement ce que le refus explicite
  // de `clickToAction` existe pour empêcher — « et surtout PAS il retombe sur la règle du
  // dessous ». La garde manquait à l'autre bout du geste. (Audit UX 2026-08-20, D4-2.)
  if (hand && isRangedWeapon(hand.held ?? 'unarmed')) return null

  // LE MAINTIEN NE MANGE PAS CE QU'ON VIENT DE DONNER. Le clic sur un voisin, nourriture en
  // main, DONNE (`clickToAction`, spec alignement R2 — l'acte chaud fondamental). Le maintien,
  // lui, tombait sur `eatHeld` : un doigt qui s'attarde d'un dixième de seconde sur le geste
  // le plus généreux du jeu le retournait en son contraire, et avalait le vivre destiné au
  // voisin. On ne re-DONNE pas non plus (un clic donne déjà toute la pile tenue) : viser
  // quelqu'un, c'est dire « c'est pour toi » — le maintien n'a alors rien à ajouter.
  // (Audit UX 2026-08-20, D4-4.)
  if (hand && isFood(hand.held) && target.entityId !== null) return null

  // Le MAINTIEN nourrit : c'est le geste que l'utilisateur a demandé pour le bandage
  // (« sélectionner dans la ceinture, maintenir le clic »), et il vaut pour ce qui se mange.
  if (hand && isFood(hand.held)) return eatHeld(hand)
  if (!target.inRange || target.nodeId === null) return null
  return { type: 'harvest', nodeId: target.nodeId }
}

/** Ce que la touche d'INTERACTION désigne sous le curseur. Trois familles, trois sprites. */
export type InteractKind = 'fire' | 'node' | 'pile'

/** CE QUE `F` FERAIT DE CE QU'ON SURVOLE — la cible, sa famille, et si elle est à portée. */
export interface InteractTarget {
  kind: InteractKind
  id: number
  /** À portée de bras ? Hors portée, la touche ne fait rien : le contour se GRISE. */
  inRange: boolean
}

/**
 * CE QUE LA TOUCHE D'INTERACTION (`F`) VISE SOUS LE CURSEUR — la MÊME cascade que le
 * handler, extraite ici pour qu'il n'y en ait qu'une (2026-08-03, demande d'Alexis :
 * un contour blanc sur ce avec quoi on peut interagir).
 *
 * Deux lecteurs, une seule résolution : le handler de `F` (qui AGIT) et le contour de
 * `snapshot-view` (qui MONTRE). Deux cascades recopiées finiraient par diverger d'un
 * cran — et un contour qui désigne autre chose que ce que la touche déclenche est pire
 * que pas de contour du tout : il PROMET. C'est la leçon déjà payée par le surlignage
 * de démolition (voir `demolishTargetAt`).
 *
 * L'ORDRE EST CELUI DU HANDLER, et il est motivé là-bas :
 *   ① le FEU visé (→ son modal) ;
 *   ② le nœud de CUEILLETTE visé (→ `harvest whole`) — il prime sur la pile : dans un
 *     jardin clos, un tas posé au pied d'un buisson ne doit pas voler le geste ;
 *   ③ la PILE au sol visée (→ `pick_up`).
 *
 * LA PORTE N'EST PAS ICI, et c'est délibéré : depuis R26 elle se prend par PROXIMITÉ,
 * pas au curseur (une porte vit sur une arête — le joueur est DEVANT elle, il ne la
 * vise pas). Elle n'a donc pas de survol à souligner, et le contour ne la connaît pas.
 *
 * `inRange` est rendu même hors de portée : la cible existe, la touche ne peut juste
 * pas l'atteindre. C'est ce qui permet au contour de se griser au lieu de disparaître
 * — même grammaire que la teinte de visée et que le halo de démolition.
 */
export function interactTargetAt(
  target: AimTarget,
  /** Le nœud est-il de la CUEILLETTE (métier `foraging`) ? Un arbre ou un rocher se
   *  récolte au CLIC, pas à `F` — ils ne sont donc pas des cibles d'interaction. */
  estCueillette: (nodeId: number) => boolean,
): InteractTarget | null {
  if (target.fireId !== null) return { kind: 'fire', id: target.fireId, inRange: target.inRange }
  if (target.nodeId !== null && estCueillette(target.nodeId))
    return { kind: 'node', id: target.nodeId, inRange: target.inRange }
  if (target.pileId !== null) return { kind: 'pile', id: target.pileId, inRange: target.inRange }
  return null
}
