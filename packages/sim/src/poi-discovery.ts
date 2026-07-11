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
import { poiCenter, poisAt } from './map'
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

/** Distance AU CARRÉ entre deux centres de zones. Jamais de sqrt : invariant #2. */
function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Un candidat à la révélation : ni le lieu source, ni un lieu déjà connu, ni un toponyme. */
function isCandidate(state: SimState, knownPois: number[], sourceId: number, poiId: number): boolean {
  if (poiId === sourceId) return false
  if (knownPois.includes(poiId)) return false
  return state.map.zones[poiId]?.kind !== undefined
}

/**
 * La charge de savoir d'un lieu qu'on vient de fouler : elle révèle D'AUTRES
 * lieux, à distance. C'est une ACCÉLÉRATION de la règle de base (fouler suffit
 * à connaître) — jamais un substitut.
 */
function applyKnowledge(state: SimState, entityId: number, knownPois: number[], sourceId: number): void {
  const charge = POI_CHARGES[state.map.zones[sourceId]?.kind ?? '']
  if (charge === undefined || charge.devise !== 'savoir') return

  const origin = poiCenter(state.map.zones[sourceId]!)

  if (charge.reveal === 'radius') {
    const r2 = charge.radiusTiles * charge.radiusTiles
    for (let poiId = 0; poiId < state.map.zones.length; poiId += 1) {
      if (!isCandidate(state, knownPois, sourceId, poiId)) continue
      const zone = state.map.zones[poiId]!
      if (charge.family !== undefined && poiFamily(zone.kind!) !== charge.family) continue
      if (dist2(origin, poiCenter(zone)) > r2) continue
      know(state, entityId, knownPois, poiId)
    }
    return
  }

  // reveal === 'nearest' : LE plus proche, égalités départagées par poiId croissant.
  // On itère en ordre croissant et on n'accepte qu'un `<` STRICT : le premier
  // rencontré à distance égale gagne donc naturellement (spec R8).
  let bestId = -1
  let bestD2 = Infinity
  for (let poiId = 0; poiId < state.map.zones.length; poiId += 1) {
    if (!isCandidate(state, knownPois, sourceId, poiId)) continue
    const zone = state.map.zones[poiId]!
    if (charge.kinds !== undefined && !charge.kinds.includes(zone.kind!)) continue
    const d2 = dist2(origin, poiCenter(zone))
    if (d2 < bestD2) {
      bestD2 = d2
      bestId = poiId
    }
  }
  if (bestId >= 0) know(state, entityId, knownPois, bestId)
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
      const fresh = know(state, entity.id, entity.knownPois, poiId)
      // R6.2 — la charge de savoir, si le lieu en porte une, ne joue qu'à la
      // PREMIÈRE foulée : `fresh` est notre garde d'idempotence.
      if (fresh) applyKnowledge(state, entity.id, entity.knownPois, poiId)

      // R12 — la première visite d'un JOUEUR, tous joueurs confondus. Il n'y a
      // qu'un premier : en multi, c'est une course. Émis pour TOUS les POI ; la
      // chronique, elle, ne formatera que les quatre lieux de devise `recit`.
      if (!state.visitedPois.includes(poiId)) {
        state.visitedPois.push(poiId)
        const zone = state.map.zones[poiId]!
        emitEvent(state, {
          type: 'poi_first_visit',
          tick: state.tick,
          poiId,
          kind: zone.kind ?? '',
          name: zone.name,
          byEntityId: entity.id,
        })
      }
    }
  }
}
