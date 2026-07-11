/**
 * Les lieux chargés — savoir, répit, récit (spec `docs/specs/lieux.md`).
 *
 * Les onze POI de famille `reward` étaient placés, nommés, et inertes :
 * `family === 'reward'` n'était lu que par la vignette, pour une couleur de
 * pastille. On leur donne une charge — et JAMAIS du butin (spec, critère A9) :
 * le butin tuerait le lieu à la première visite et fabriquerait une tournée de
 * ramassage, exactement la corvée que le GDD §8bis interdit.
 *
 * Les trois devises n'ont pas la même horloge, et c'est le cœur du système :
 * le savoir paye UNE FOIS (et change la carte), le répit paye TOUJOURS (et
 * change les trajets), le récit paye LA PREMIÈRE FOIS (et change ce qu'on
 * racontera).
 */
import { POI } from './balance'
import { emitEvent } from './events'
import { poisAt } from './map'
import { POI_TYPES, type PoiType } from './poi'
import type { SimState } from './sim'

/** Ce qu'un lieu donne quand on le foule. Aucune variante ne donne d'item. */
export type PoiCharge =
  /** Révèle tous les lieux d'un rayon (éventuellement filtrés par famille). */
  | { devise: 'savoir'; reveal: 'radius'; radiusTiles: number; family?: PoiType['family'] }
  /** Révèle LE lieu inconnu le plus proche (éventuellement parmi certains `kind`). */
  | { devise: 'savoir'; reveal: 'nearest'; kinds?: readonly string[] }
  /** Effet continu de terrain — chaleur, abri, repos. N'émet aucun événement. */
  | { devise: 'repit' }
  /** Première visite → une ligne dans la chronique. */
  | { devise: 'recit' }

export const POI_CHARGES: Record<string, PoiCharge> = {
  // ── Le savoir : quatre lieux qui rendent la carte ──
  // On monte, on regarde, on voit. C'est le lieu qui fait grimper.
  belvedere: { devise: 'savoir', reveal: 'radius', radiusTiles: POI.REVEAL_BELVEDERE_TILES },
  // La porte de pierre montre où l'on peut dormir de l'autre côté.
  arche: { devise: 'savoir', reveal: 'radius', radiusTiles: POI.REVEAL_ARCHE_TILES, family: 'shelter' },
  // Un jalon de sentier : les cairns se suivent et tirent vers l'inconnu.
  cairn: { devise: 'savoir', reveal: 'nearest' },
  // Quelqu'un a gravé ça pour dire « c'est par là ».
  petroglyphes: { devise: 'savoir', reveal: 'nearest', kinds: POI.ANCIENT_KINDS },

  // ── Le répit : trois lieux qui refont les trajets ──
  source_chaude: { devise: 'repit' },
  grotte: { devise: 'repit' },
  tarn: { devise: 'repit' },

  // ── Le récit : quatre lieux qui entrent dans la chronique ──
  sanctuaire: { devise: 'recit' },
  arbre: { devise: 'recit' },
  erratique: { devise: 'recit' },
  cascade: { devise: 'recit' },
}

/** La famille d'un `kind` de POI (undefined si le kind est inconnu). */
export function poiFamily(kind: string): PoiType['family'] | undefined {
  return POI_TYPES.find((t) => t.slug === kind)?.family
}

/**
 * Un joueur connaît-il déjà ce lieu ? (garde d'idempotence — appliquer une
 * charge deux fois est un non-événement, cette garde suffit ; rien à mémoriser
 * d'un tick à l'autre.)
 */
function know(state: SimState, entityId: number, knownPois: number[], poiId: number): boolean {
  if (knownPois.includes(poiId)) return false
  knownPois.push(poiId)
  const kind = state.map.zones[poiId]?.kind ?? ''
  emitEvent(state, { type: 'poi_discovered', tick: state.tick, poiId, kind, byEntityId: entityId })
  return true
}

/**
 * Une étape de tick : les lieux foulés par les JOUEURS entrent dans leur carte.
 * Appelée juste après la boucle d'inputs — la découverte est la conséquence du
 * pas qu'on vient de faire.
 */
export function advancePois(state: SimState): void {
  const npcIds = new Set(state.npcs.map((n) => n.entityId))
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))

  for (const entity of state.entities) {
    if (npcIds.has(entity.id) || monsterIds.has(entity.id)) continue // les PNJ n'ont pas de carte

    for (const poiId of poisAt(state.map, entity.x, entity.y)) {
      // R6.1 — la règle de base : fouler suffit à connaître (les 26 types).
      know(state, entity.id, entity.knownPois, poiId)
      // Les charges (savoir, récit) arrivent aux tâches 3 et 4.
    }
  }
}
