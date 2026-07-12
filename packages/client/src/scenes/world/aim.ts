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
import type { Buildable } from '../../hud-state'
import type { Corpse, PlayerAction, ResourceNode } from '@braises/sim'

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
export function clickToAction(target: AimTarget, selected: Buildable | null): PlayerAction | null {
  if (selected !== null) return { type: 'build', structure: selected, tx: target.tx, ty: target.ty }
  // Hors portée, on n'émet rien : la sim refuserait, et un refus n'est pas
  // gratuit (c'est un SimEvent que la chronique consomme — spec recolte.md G7).
  if (!target.inRange) return null
  if (target.corpseId !== null) return { type: 'loot_corpse', corpseId: target.corpseId }
  if (target.nodeId !== null) return { type: 'harvest', nodeId: target.nodeId }
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
 */
export function holdHarvest(
  target: AimTarget,
  selected: Buildable | null,
  now: number,
  lastSentAt: number,
  cooldownMs: number,
): PlayerAction | null {
  if (selected !== null) return null // en mode construction, le maintien ne martèle rien
  if (now - lastSentAt < cooldownMs) return null
  if (!target.inRange || target.nodeId === null) return null
  return { type: 'harvest', nodeId: target.nodeId }
}
