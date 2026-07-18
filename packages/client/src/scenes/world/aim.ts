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
import { COMPONENT_TYPES, FOOD_VALUES, WEAPON_DAMAGE, type ItemId, type StructureType, type WallMaterial } from '@braises/sim'
import type { Placeable } from '../../hud-state'
import type { Corpse, PlayerAction, ResourceNode } from '@braises/sim'

/**
 * Le contexte de POSE (spec construction R8) : le palier de matériau choisi pour
 * mur/porte, et la structure DÉJÀ sur la tuile visée (pour l'améliorer d'un clic).
 */
export interface BuildContext {
  material: WallMaterial
  onTile: { id: number; type: StructureType } | null
}

/** Ce qu'il y a sous le curseur, et si c'est à portée de bras. */
export interface AimTarget {
  tx: number
  ty: number
  /** Le cadavre sur la tuile (il PRIME sur le nœud : on ouvre ce qu'on vient de tuer). */
  corpseId: number | null
  /** Le nœud RÉCOLTABLE (stock > 0) sur la tuile. */
  nodeId: number | null
  /** Distance ≤ `range` entre le joueur et le CENTRE de la tuile visée. */
  inRange: boolean
}

/** Que vise-t-on ? Purement descriptif : aucune action décidée ici. */
export function aimAt(
  tx: number,
  ty: number,
  player: { x: number; y: number },
  nodes: readonly ResourceNode[],
  corpses: readonly Corpse[],
  range: number,
): AimTarget {
  const corpse = corpses.find((c) => Math.floor(c.x) === tx && Math.floor(c.y) === ty)
  const node = nodes.find((n) => n.tx === tx && n.ty === ty && n.stock > 0)
  const dx = tx + 0.5 - player.x
  const dy = ty + 0.5 - player.y
  return {
    tx,
    ty,
    corpseId: corpse?.id ?? null,
    nodeId: node?.id ?? null,
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
  /** Direction vers le curseur, depuis l'avatar (non normalisée : la sim le fait). */
  dx: number
  dy: number
}

export function isFood(item: ItemId | null): boolean {
  return item !== null && FOOD_VALUES[item] !== undefined
}

export function isWeapon(item: ItemId | null): boolean {
  return item !== null && WEAPON_DAMAGE[item] !== undefined
}

export function clickToAction(
  target: AimTarget,
  placing: Placeable | null,
  hand?: HandContext,
  build?: BuildContext,
): PlayerAction | null {
  // POSER prime sur tout : quand on tient un feu de camp (ou qu'une pièce est armée),
  // le clic POSE, il ne récolte ni ne frappe « en passant ». Le mode dit ce que le
  // clic fait — c'est ce qui le rend prévisible (même règle que le fantôme).
  if (placing === 'fire') return { type: 'place_campfire', tx: target.tx, ty: target.ty }
  // Un COMPOSANT tenu se pose (spec construction R20, flux feu de camp).
  if (placing !== null && (COMPONENT_TYPES as readonly string[]).includes(placing)) {
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
    if (placing === 'wall' || placing === 'door') {
      return { type: 'build', structure: placing, tx: target.tx, ty: target.ty, material: build?.material ?? 'wood' }
    }
    return { type: 'build', structure: placing, tx: target.tx, ty: target.ty }
  }

  // MANGER : on tient de quoi, on croque. (Le clic maintenu répète — voir holdHarvest.)
  if (hand && isFood(hand.held)) return { type: 'eat', item: hand.held! }

  // FRAPPER : une arme en main frappe TOUJOURS — on ne coupe pas du bois avec une
  // lance, et surtout on ne veut pas qu'un clic de panique parte récolter un buisson
  // pendant qu'un loup arrive.
  if (hand && isWeapon(hand.held)) return { type: 'attack', dx: hand.dx, dy: hand.dy }

  // Hors portée, on n'émet rien : la sim refuserait, et un refus n'est pas
  // gratuit (c'est un SimEvent que la chronique consomme — spec recolte.md G7).
  if (target.inRange) {
    if (target.corpseId !== null) return { type: 'loot_corpse', corpseId: target.corpseId }
    if (target.nodeId !== null) return { type: 'harvest', nodeId: target.nodeId }
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
  // Le MAINTIEN nourrit : c'est le geste que l'utilisateur a demandé pour le bandage
  // (« sélectionner dans la ceinture, maintenir le clic »), et il vaut pour ce qui se
  // mange. Une ARME en main, elle, ne passe jamais par ici : `input-bindings` a vu
  // partir la charge à l'appui, et n'appelle plus ce résolveur tant qu'elle dure.
  if (hand && isFood(hand.held)) return { type: 'eat', item: hand.held! }
  if (!target.inRange || target.nodeId === null) return null
  return { type: 'harvest', nodeId: target.nodeId }
}
