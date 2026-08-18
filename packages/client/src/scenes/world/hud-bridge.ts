/**
 * Le pont snapshot → HUD : tout ce que WorldScene publie vers UIScene passe
 * ici, via le registry typé (`hud-state.ts`). Regroupé pour que la scène
 * reste du câblage et que la liste des clés publiées se lise d'un coup d'œil.
 */
import {
  capaciteStation,
  BALANCE,
  chronicleFromEvents,
  COOK_SLOT,
  FIRE,
  FIRE_UPKEEP,
  fireStateAt,
  fuelBurnProgress,
  fuelTicksRemaining,
  hasItems,
  type Corpse,
  type Entity,
  type GameTime,
  type Inventory,
  type ItemBag,
  type ItemId,
  type PlayerAction,
  type SimEvent,
  type RefugeeGroup,
  type SkillId,
  type StationFonction,
  type Structure,
  type Village,
} from '@ashes/sim'
import type Phaser from 'phaser'
import { getHud, setHud, type CapacitesEnPortee, type FireView, type SeasonVerdict } from '../../hud-state'

type Registry = Phaser.Data.DataManager

/** L'heure du monde + l'état de MON village (undefined = pas de village). */
export function publishTimeAndVillage(registry: Registry, time: GameTime, myVillage: Village | undefined): void {
  setHud(registry, 'time', time)
  setHud(registry, 'village', myVillage?.memberIds.length ?? 0)
  setHud(registry, 'tasks', myVillage?.tasks ?? [])
  setHud(registry, 'archetype', myVillage?.archetype ?? null)
  setHud(registry, 'villageWarmth', myVillage?.warmth ?? 0)
}

/** Les jauges et l'inventaire de MON avatar (l'entité autoritative du snapshot). */
export function publishPlayerVitals(registry: Registry, me: Entity): void {
  setHud(registry, 'inv', me.inventory)
  setHud(registry, 'activeSlot', me.activeSlot)
  setHud(registry, 'hunger', me.hunger)
  setHud(registry, 'temperature', me.temperature)
  setHud(registry, 'skills', me.skills)
  setHud(registry, 'hp', me.hp)
  setHud(registry, 'stamina', me.stamina)
  setHud(registry, 'wounds', me.wounds)
  setHud(registry, 'knownPois', me.knownPois)
  setHud(registry, 'craftQueue', me.craftQueue)
  // LA DÉCOUVERTE (D2) vient du snapshot : le client ne décide jamais de ce qui est connu.
  setHud(registry, 'seen', me.seen ?? [])
}

/**
 * Les stations d'artisanat à PORTÉE (spec craft-file F14). Pur miroir : même
 * mesure que la sim (`INTERACT_RANGE`, importé, jamais recopié), au centre de la
 * tuile. Il sert à GRISER les vignettes — la sim, elle, revalide à l'enfilage ET
 * à chaque tick (une station qu'on quitte met la file en pause, F7).
 */
export function publishStationsInRange(
  registry: Registry,
  me: { x: number; y: number },
  structures: Structure[],
): void {
  const r = BALANCE.INTERACT_RANGE
  // LE MEILLEUR PALIER DE CHAQUE FONCTION à portée. On ne teste plus une liste de types
  // écrite ici (elle avait déjà deux entrées de retard sur la sim) : le registre dit ce
  // que chaque pièce OFFRE, et on garde le maximum par fonction — un atelier lourd sert
  // donc aussi les recettes d'établi, comme la sim le décide de son côté.
  const caps: CapacitesEnPortee = {}
  for (const s of structures) {
    const offre = capaciteStation(s.type)
    if (offre === null) continue
    const dx = s.tx + 0.5 - me.x
    const dy = s.ty + 0.5 - me.y
    if (dx * dx + dy * dy > r * r) continue
    if ((caps[offre.fonction] ?? 0) < offre.niveau) caps[offre.fonction] = offre.niveau
  }
  // On ne republie QUE si ça change : `setHud` réveille les lecteurs du registry, et
  // cette fonction tourne à chaque frame (la position bouge en continu).
  const before = getHud(registry, 'stationsInRange') ?? {}
  const memes =
    Object.keys(caps).length === Object.keys(before).length &&
    (Object.keys(caps) as StationFonction[]).every((f) => before[f] === caps[f])
  if (!memes) setHud(registry, 'stationsInRange', caps)
}

/**
 * Y a-t-il un feu de camp LIBRE à portée que je pourrais promouvoir en foyer ?
 * (un `fire` villageId 0 que JE possède, à `INTERACT_RANGE`, et sans village encore).
 * UIScene en tire la fenêtre du bas « Fonder un village ici ? ». Pur miroir : la sim
 * revalide `found_village`. On ne republie que sur CHANGEMENT — ça tourne chaque frame.
 */
/**
 * LOGIQUE PURE (testée) : quel feu LIBRE puis-je promouvoir en foyer, ici et
 * maintenant ? Un `fire` villageId 0 que JE possède, à `INTERACT_RANGE`, et à
 * condition de n'avoir pas déjà un village (un foyer par partie). `null` = aucun.
 */
export function foundableFireAt(
  player: { x: number; y: number },
  structures: Structure[],
  villages: Village[],
  playerId: number,
): number | null {
  if (villages.some((v) => v.memberIds.includes(playerId))) return null
  const r = BALANCE.INTERACT_RANGE
  for (const s of structures) {
    if (s.type !== 'fire' || s.villageId !== 0 || s.ownerId !== playerId) continue
    const dx = s.tx + 0.5 - player.x
    const dy = s.ty + 0.5 - player.y
    if (dx * dx + dy * dy <= r * r) return s.id
  }
  return null
}

export function publishFoundableFire(
  registry: Registry,
  player: { x: number; y: number },
  structures: Structure[],
  villages: Village[],
  playerId: number,
): void {
  const id = foundableFireAt(player, structures, villages, playerId)
  const found = id === null ? null : { structureId: id }
  const before = getHud(registry, 'foundableFire') ?? null
  if (before?.structureId !== found?.structureId) setHud(registry, 'foundableFire', found)
}

/** LES RÉFUGIÉS À PORTÉE (V2-25) : le groupe le plus proche à portée d'interaction, ou `null`. */
export function publishRefugeesNearby(
  registry: Registry,
  player: { x: number; y: number },
  groups: RefugeeGroup[],
): void {
  const r = BALANCE.INTERACT_RANGE
  let near: { groupId: number; count: number } | null = null
  let bestD = r * r
  for (const g of groups) {
    const dx = g.tx + 0.5 - player.x
    const dy = g.ty + 0.5 - player.y
    const d = dx * dx + dy * dy
    if (d <= bestD) {
      bestD = d
      near = { groupId: g.id, count: g.count }
    }
  }
  const before = getHud(registry, 'refugeesNearby') ?? null
  if (before?.groupId !== near?.groupId) setHud(registry, 'refugeesNearby', near)
}

/**
 * LOGIQUE PURE (testée) : puis-je monter le palier de mon Feu, ici et maintenant ?
 * Conditions miroir de la sim (`upgrade_fire`, village.ts) : je suis le CHEF de mon
 * village, à `INTERACT_RANGE` de son Feu, et le palier n'est pas au max. Rend le
 * palier courant et le coût du SUIVANT (`FIRE_UPGRADE_COST[tier]`), ou `null`.
 * L'affordabilité, elle, dépend du sac — elle est calculée au moment de publier.
 */
export function upgradableFireAt(
  player: { x: number; y: number },
  villages: Village[],
  playerId: number,
): { villageId: number; tier: number; nextCost: ItemBag } | null {
  const v = villages.find((vg) => vg.chiefId === playerId)
  if (!v) return null
  const nextCost = BALANCE.FIRE_UPGRADE_COST[v.tier] // index = palier courant → coût du suivant
  if (!nextCost) return null // palier maximal atteint (tier ≥ longueur du barème)
  const r = BALANCE.INTERACT_RANGE
  const dx = v.fireTx + 0.5 - player.x
  const dy = v.fireTy + 0.5 - player.y
  if (dx * dx + dy * dy > r * r) return null
  return { villageId: v.id, tier: v.tier, nextCost }
}

export function publishUpgradableFire(
  registry: Registry,
  player: { x: number; y: number },
  villages: Village[],
  playerId: number,
  inv: Inventory,
): void {
  const up = upgradableFireAt(player, villages, playerId)
  const next =
    up === null ? null : { villageId: up.villageId, tier: up.tier, nextCost: up.nextCost, affordable: hasItems(inv, up.nextCost) }
  // On ne republie que sur CHANGEMENT signifiant (ça tourne chaque frame) : le village,
  // le palier, ou le passage possible↔impossible du coût. Le contenu du coût, lui, ne
  // change pas pour un palier donné.
  const before = getHud(registry, 'upgradableFire') ?? null
  if (before?.villageId !== next?.villageId || before?.tier !== next?.tier || before?.affordable !== next?.affordable) {
    setHud(registry, 'upgradableFire', next)
  }
}

/**
 * Le conteneur ouvert est-il encore à portée d'interaction du joueur ? Même
 * mesure qu'à l'ouverture (`nearestContainer`) : au carré, contre
 * `INTERACT_RANGE` importé de /sim (jamais recopié). `(cx, cy)` est le point
 * monde du conteneur (centre de tuile pour un coffre, position pour une dépouille).
 */
export function containerInRange(cx: number, cy: number, player: { x: number; y: number }): boolean {
  const range = BALANCE.INTERACT_RANGE
  return (cx - player.x) ** 2 + (cy - player.y) ** 2 <= range * range
}

/**
 * Résout le conteneur ouvert (coffre/cadavre) contre CE snapshot, pour que
 * UIScene affiche son contenu sans fouiller le monde. On referme le panneau de
 * loot dans deux cas : le conteneur a disparu — une dépouille vidée s'efface
 * (spec inventaire R16) — OU le joueur s'en est éloigné au-delà d'`INTERACT_RANGE`
 * (sinon un panneau fantôme demeure, dont tout `transfer` serait rejeté « trop
 * loin »). Le sac du joueur, lui, reste ouvert : seul le loot se referme.
 */
export function publishOpenContainer(
  registry: Registry,
  structures: Structure[],
  corpses: Corpse[],
  player: { x: number; y: number },
): void {
  const oc = getHud(registry, 'openContainer') ?? null
  if (oc === null) {
    setHud(registry, 'openContainerView', null)
    return
  }
  if (oc.kind === 'structure') {
    const s = structures.find((x) => x.id === oc.id)
    if (s?.inventory && containerInRange(s.tx + 0.5, s.ty + 0.5, player)) {
      setHud(registry, 'openContainerView', { kind: 'structure', id: oc.id, inv: s.inventory, title: 'Coffre' })
      return
    }
  } else {
    const c = corpses.find((x) => x.id === oc.id)
    if (c && containerInRange(c.x, c.y, player)) {
      setHud(registry, 'openContainerView', { kind: 'corpse', id: oc.id, inv: c.inventory, title: 'Dépouille' })
      return
    }
  }
  // Disparu ou hors de portée : on referme (le sac joueur reste, lui, ouvert).
  setHud(registry, 'openContainer', null)
  setHud(registry, 'openContainerView', null)
}

/**
 * LE MODAL DU FEU (spec feu-station S18) résolu contre CE snapshot : l'état (allumé/braises/
 * éteint dérivé du tick + combustible), le combustible, le slot de cuisson, et le BOUTON
 * contextuel (fonder / améliorer, S19 — même logique que les fenêtres d'avant, déplacée dans
 * le panneau). On referme le modal si le feu a disparu ou si le joueur s'en est éloigné.
 */
export function publishOpenFire(
  registry: Registry,
  structures: Structure[],
  villages: Village[],
  player: { x: number; y: number },
  playerId: number,
  tick: number,
  inv: Inventory,
): void {
  const of = getHud(registry, 'openFire') ?? null
  if (of === null) {
    setHud(registry, 'openFireView', null)
    return
  }
  const s = structures.find((x) => x.id === of.structureId)
  if (!s || s.type !== 'fire' || !containerInRange(s.tx + 0.5, s.ty + 0.5, player)) {
    setHud(registry, 'openFire', null) // disparu ou hors de portée → le modal se referme seul
    setHud(registry, 'openFireView', null)
    return
  }
  // CUISSON : 3 ENTRÉES (STACK d'aliments crus). Le compteur de l'unité EN COURS vit dans
  // `cookRemaining` (parallèle) : engagée (`rem>0`) → progression via COOK_SLOT ; prête (`rem<=0`,
  // sorties pleines) → 100 % ; pas engagée (`rem==null`, feu éteint depuis la pose) → 0 %.
  const cookIn: FireView['cookIn'] = Array.from({ length: FIRE.COOK_INPUTS }, (_, i) => {
    const sl = s.cookIn?.[i]
    if (!sl) return null
    const rule = COOK_SLOT[s.type]?.[sl.item]
    const rem = s.cookRemaining?.[i]
    const progress = rem == null ? 0 : rule ? Math.max(0, Math.min(1, 1 - rem / rule.ticks)) : 1
    return { item: sl.item, count: sl.count, ready: rem != null && rem <= 0, progress }
  })
  const cookOut: FireView['cookOut'] = Array.from({ length: FIRE.COOK_OUTPUTS }, (_, i) => {
    const sl = s.cookOut?.[i]
    return sl ? { item: sl.item, count: sl.count } : null
  })
  // Le bouton contextuel (S19), même logique de disponibilité que les fenêtres flottantes retirées.
  let action: FireView['action'] = null
  if (foundableFireAt(player, structures, villages, playerId) === of.structureId) {
    action = { kind: 'found', label: 'Fonder un Foyer ici' }
  } else {
    const up = upgradableFireAt(player, villages, playerId)
    if (up && s.villageId === up.villageId) {
      action = {
        kind: 'upgrade',
        label: `Améliorer le Foyer (palier ${up.tier + 1})`,
        affordable: hasItems(inv, up.nextCost),
      }
    }
  }
  // Le combustible : sur un feu LIBRE il vit sur la structure (bûches brûlées une à une) ; sur un
  // FOYER, encore sur le village (réserve, migration différée S16). On dérive dans les deux cas le
  // NOMBRE de bûches, le TEMPS restant avant extinction, et la progression de la bûche EN COURS.
  // COMBUSTIBLE : 3 slots de bois (feu libre) ; un FOYER (réserve village, S16) → un pseudo-slot.
  const village = s.villageId !== 0 ? villages.find((v) => v.id === s.villageId) : undefined
  const fuel: FireView['fuel'] = village
    ? [{ item: 'wood', count: Math.floor(village.fuel / FIRE_UPKEEP.FEED_PER_WOOD) }, null, null]
    : Array.from({ length: FIRE.FUEL_SLOTS }, (_, i) => {
        const sl = s.fuel?.[i]
        return sl ? { item: sl.item, count: sl.count } : null
      })
  setHud(registry, 'openFireView', {
    structureId: s.id,
    title: s.villageId === 0 ? 'FEU DE CAMP' : 'FOYER',
    state: fireStateAt(tick, s),
    fuel,
    fuelTimeRemaining: village ? Math.round(village.fuel / FIRE_UPKEEP.DRAIN_PER_TICK) : fuelTicksRemaining(tick, s),
    fuelBurnProgress: village ? 0 : fuelBurnProgress(tick, s),
    fuelBurnSlot: village ? -1 : s.burnSlot ?? -1, // la case ANCRÉE qui brûle (source unique : la sim)
    cookIn,
    cookOut,
    action,
  })
}

/** UIScene POSE une action ici ; WorldScene la draine (`drainQueuedActions`).
 *  L'UI ne parle pas à l'hôte — seul WorldScene connaît le transport. */
export function queueAction(registry: Registry, action: PlayerAction): void {
  const queue = getHud(registry, 'pendingActions') ?? []
  queue.push(action)
  setHud(registry, 'pendingActions', queue)
}

/** WorldScene POSE une récolte reçue de la sim ; UIScene la draine et l'affiche
 *  (les toasts « +2 BOIS »). Le sens est l'inverse de `queueAction` : ici c'est
 *  le monde qui informe le HUD. Une FILE, pas une valeur : deux récoltes peuvent
 *  tomber dans le même snapshot, et aucune ne doit être écrasée. */
export function publishPickup(registry: Registry, item: ItemId, count: number): void {
  const queue = getHud(registry, 'pickups') ?? []
  queue.push({ item, count })
  setHud(registry, 'pickups', queue)
}

/** Côté UIScene : récupère et vide la file des récoltes. */
export function drainPickups(registry: Registry): { item: ItemId; count: number }[] {
  const queue = getHud(registry, 'pickups') ?? []
  if (queue.length > 0) setHud(registry, 'pickups', [])
  return queue
}

/** FABRIQUÉ (event `item_crafted` sur moi) : même canal que `publishPickup`, file à part
 *  — le bandeau de fabrication ne se fond pas dans les toasts de récolte. */
export function publishCraft(registry: Registry, item: ItemId): void {
  const queue = getHud(registry, 'crafts') ?? []
  queue.push({ item })
  setHud(registry, 'crafts', queue)
}

/** Côté UIScene : récupère et vide la file des fabrications. */
export function drainCrafts(registry: Registry): { item: ItemId }[] {
  const queue = getHud(registry, 'crafts') ?? []
  if (queue.length > 0) setHud(registry, 'crafts', [])
  return queue
}

/** NIVEAU (event `skill_level_up` sur moi) : le plus gros toast, sa propre file. */
export function publishLevelUp(registry: Registry, skill: SkillId, level: number): void {
  const queue = getHud(registry, 'levelUps') ?? []
  queue.push({ skill, level })
  setHud(registry, 'levelUps', queue)
}

/** L'HÔTE A SAUVEGARDÉ (ou a échoué) : une VALEUR, pas une file — seul le dernier état
 *  compte. `shownAt` est l'horloge PHASER (celle du fondu de l'indicateur) ; `at` l'horloge
 *  murale de l'hôte, qui sert à DATER la sauvegarde, jamais à animer. */
export function publishSaved(registry: Registry, at: number, ok: boolean, shownAt: number): void {
  setHud(registry, 'saveState', { at, ok, shownAt })
}

/** Côté UIScene : récupère et vide la file des montées de métier. */
export function drainLevelUps(registry: Registry): { skill: SkillId; level: number }[] {
  const queue = getHud(registry, 'levelUps') ?? []
  if (queue.length > 0) setHud(registry, 'levelUps', [])
  return queue
}

/** Côté WorldScene : récupère et vide la file d'actions de l'UI. */
export function drainQueuedActions(registry: Registry): PlayerAction[] {
  const queue = getHud(registry, 'pendingActions') ?? []
  if (queue.length > 0) setHud(registry, 'pendingActions', [])
  return queue
}

/** La chronique mise en forme depuis le log d'événements retenus. */
export function publishChronicle(
  registry: Registry,
  eventLog: SimEvent[],
  calendarScale: number,
  villages: Village[],
): void {
  const names = Object.fromEntries(villages.map((v) => [v.id, v.name]))
  setHud(registry, 'chronicle', chronicleFromEvents(eventLog, calendarScale, names))
}

/** Message d'erreur éphémère (action rejetée, hôte perdu, protocole…). */
export function publishError(registry: Registry, reason: string, at: number): void {
  setHud(registry, 'error', { reason, at })
}

/** LE CONSEIL (audit UI/UX P2-7) : le canal d'apprentissage, séparé de l'alerte rouge.
 *  On y enseigne un verbe (récolter, parer, donner, nourrir le Feu) sans crier au refus.
 *  Encre neutre, tenue longue côté UIScene — le patron `publishError` mais un autre ton. */
export function publishHint(registry: Registry, text: string, at: number): void {
  setHud(registry, 'hint', { text, at })
}

/** LE JOUEUR EST TOMBÉ (audit UI/UX P1) : un one-shot horodaté que UIScene lit pour
 *  lever le voile de mort. `cause` vient de l'événement `entity_died` (froid/faim, ou
 *  `undefined` = tué → `null` ici). Horodaté avec `at` : un nouveau `at` = une nouvelle
 *  mort (le même patron que `publishError`). */
export function publishDeath(
  registry: Registry,
  cause: 'cold' | 'hunger' | 'lightning' | undefined,
  byEntityId: number,
  killerType: string | null,
  hadLoot: boolean,
  at: number,
): void {
  setHud(registry, 'deathMoment', { cause: cause ?? null, byEntityId, killerType, hadLoot, at })
}

/** L'alarme de mon village (flash rouge côté UI). */
export function publishAlarm(registry: Registry, at: number): void {
  setHud(registry, 'alarm', { at })
}

export function publishSeasonEnded(registry: Registry, verdicts: SeasonVerdict[], myVillageId: number | null): void {
  // Les verdicts + l'id de MON village : l'écran de fin de saison couronne le mien, montre
  // les voisins, et le distingue par archétype. `seasonVerdicts !== null` EST « la saison est
  // finie » — pas besoin d'un booléen miroir à côté. Le récit (chronique) est déjà en état.
  setHud(registry, 'seasonVerdicts', { verdicts, myVillageId })
}
