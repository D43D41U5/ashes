/**
 * Le pont snapshot → HUD : tout ce que WorldScene publie vers UIScene passe
 * ici, via le registry typé (`hud-state.ts`). Regroupé pour que la scène
 * reste du câblage et que la liste des clés publiées se lise d'un coup d'œil.
 */
import {
  BALANCE,
  chronicleFromEvents,
  type Corpse,
  type Entity,
  type GameTime,
  type ItemId,
  type PlayerAction,
  type SimEvent,
  type Structure,
  type Village,
} from '@braises/sim'
import type Phaser from 'phaser'
import { getHud, setHud, type StationId } from '../../hud-state'

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
  const near = new Set<StationId>()
  for (const s of structures) {
    if (s.type !== 'fire' && s.type !== 'workshop' && s.type !== 'furnace') continue
    const dx = s.tx + 0.5 - me.x
    const dy = s.ty + 0.5 - me.y
    if (dx * dx + dy * dy <= r * r) near.add(s.type)
  }
  const stations = [...near]
  // On ne republie QUE si ça change : `setHud` réveille les lecteurs du registry,
  // et cette fonction tourne à chaque frame (la position bouge en continu).
  const before = getHud(registry, 'stationsInRange') ?? []
  if (before.length !== stations.length || stations.some((s) => !before.includes(s))) {
    setHud(registry, 'stationsInRange', stations)
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

/** L'alarme de mon village (flash rouge côté UI). */
export function publishAlarm(registry: Registry, at: number): void {
  setHud(registry, 'alarm', { at })
}

export function publishSeasonEnded(registry: Registry): void {
  setHud(registry, 'seasonEnded', true)
}
