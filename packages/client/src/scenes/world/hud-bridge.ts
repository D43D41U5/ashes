/**
 * Le pont snapshot → HUD : tout ce que WorldScene publie vers UIScene passe
 * ici, via le registry typé (`hud-state.ts`). Regroupé pour que la scène
 * reste du câblage et que la liste des clés publiées se lise d'un coup d'œil.
 */
import {
  chronicleFromEvents,
  type Corpse,
  type Entity,
  type GameTime,
  type PlayerAction,
  type SimEvent,
  type Structure,
  type Village,
} from '@braises/sim'
import type Phaser from 'phaser'
import { getHud, setHud } from '../../hud-state'

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
}

/**
 * Résout le conteneur ouvert (coffre/cadavre) contre CE snapshot, pour que
 * UIScene affiche son contenu sans fouiller le monde. S'il a disparu — une
 * dépouille vidée s'efface (spec inventaire R16) — on efface aussi la demande
 * d'ouverture : le panneau de loot se referme de lui-même, sans planter sur un
 * `id` devenu introuvable.
 */
export function publishOpenContainer(registry: Registry, structures: Structure[], corpses: Corpse[]): void {
  const oc = getHud(registry, 'openContainer') ?? null
  if (oc === null) {
    setHud(registry, 'openContainerView', null)
    return
  }
  if (oc.kind === 'structure') {
    const s = structures.find((x) => x.id === oc.id)
    if (s?.inventory) {
      setHud(registry, 'openContainerView', { kind: 'structure', id: oc.id, inv: s.inventory, title: 'Coffre' })
      return
    }
  } else {
    const c = corpses.find((x) => x.id === oc.id)
    if (c) {
      setHud(registry, 'openContainerView', { kind: 'corpse', id: oc.id, inv: c.inventory, title: 'Dépouille' })
      return
    }
  }
  // Introuvable : le conteneur n'existe plus (dépouille vidée). On referme.
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
