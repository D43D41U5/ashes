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
import { COMPONENT_TYPES, EDGE_N, FOOD_VALUES, STRUCTURE_HP, WEAPON_DAMAGE, isCropMature, isPlot, type ItemId, type StructureType, type WallMaterial } from '@ashes/sim'
import type { Placeable } from '../../hud-state'
import type { Corpse, PlayerAction, ResourceNode } from '@ashes/sim'

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
   */
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
): AimTarget {
  const corpse = corpses.find((c) => Math.floor(c.x) === tx && Math.floor(c.y) === ty)
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
      // la sim tranche le gel de la terre à ciel ouvert (acte III) et le rendement au moment voulu.
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
    entityId,
    entityWounded,
    onFire,
    fireId,
    repairableId: damaged?.id ?? null,
    plantableId: plantable?.id ?? null,
    harvestableId: harvestable?.id ?? null,
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
  // Un COMPOSANT ou le COFFRE tenu se pose (spec construction R20, flux feu de camp).
  if (placing !== null && ((COMPONENT_TYPES as readonly string[]).includes(placing) || placing === 'chest')) {
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
    // Il ne reste que les pièces MOLLES du marteau (sol/toit) — le reste (composants,
    // coffre, feu) a déjà été traité au-dessus.
    if (placing === 'floor' || placing === 'roof') {
      return { type: 'build', structure: placing, tx: target.tx, ty: target.ty }
    }
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
  // Le MAINTIEN nourrit : c'est le geste que l'utilisateur a demandé pour le bandage
  // (« sélectionner dans la ceinture, maintenir le clic »), et il vaut pour ce qui se
  // mange. Une ARME en main, elle, ne passe jamais par ici : `input-bindings` a vu
  // partir la charge à l'appui, et n'appelle plus ce résolveur tant qu'elle dure.
  if (hand && isFood(hand.held)) return eatHeld(hand)
  if (!target.inRange || target.nodeId === null) return null
  return { type: 'harvest', nodeId: target.nodeId }
}
