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
import { faitsDuLieu, saillant, texteDeStele } from './annales'
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
  /** LA STÈLE (annales.md R11) : révèle LE lieu que son texte désigne — l'écrivain unique. */
  | { devise: 'savoir'; reveal: 'stele' }
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
  // La Tour de guet effondrée : le Belvédère de la plaine — on grimpe aux décombres, on voit.
  // Rayon entre le Chêne (on est sous un arbre) et le Belvédère (on domine tout).
  tour_guet: { devise: 'savoir', reveal: 'radius', radiusTiles: POI.REVEAL_TOUR_TILES },
  // LES PIERRES SE RÉPONDENT : un menhir révèle la pierre (ou le Cercle) inconnue la plus
  // proche — une chaîne d'indices, le patron Vegvisir. Jamais la carte d'un coup.
  pierre_levee: { devise: 'savoir', reveal: 'nearest', kinds: POI.PIERRES_KINDS },
  // La stèle révèle CE QUE SON TEXTE DÉSIGNE, rien d'autre (annales.md R11) — et une stèle
  // brisée ne désigne rien : la lacune a un coût (R10).
  stele: { devise: 'savoir', reveal: 'stele' },

  // ── Le répit : trois lieux qui refont les trajets ──
  source_chaude: { devise: 'repit' },
  grotte: { devise: 'repit' },
  tarn: { devise: 'repit' },

  // ── Le récit : quatre lieux qui entrent dans la chronique ──
  sanctuaire: { devise: 'recit' },
  arbre: { devise: 'recit' },
  // Le Grand Chêne ouvre la carte autour de lui : c'est la RÉCOMPENSE qui apprend au joueur
  // que marcher vers un repère paie. Rayon plus court qu'un Belvédère (on est en plaine, on
  // ne domine rien) — mais c'est le premier « voir plus loin » de la partie.
  chene: { devise: 'savoir', reveal: 'radius', radiusTiles: POI.REVEAL_CHENE_TILES },
  erratique: { devise: 'recit' },
  cascade: { devise: 'recit' },
  // Le Cercle de pierres : la destination de la chaîne des menhirs. L'atteindre se raconte.
  cercle_pierres: { devise: 'recit' },
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
 * RÉVÉLER UN LIEU À UN JOUEUR — la façade de `know` pour les révélateurs EXTERNES (la rumeur
 * du réfugié, annales.md R12). Même garde d'idempotence, même événement `poi_discovered` :
 * une révélation est une révélation, d'où qu'elle vienne.
 */
export function revelerPoi(state: SimState, entityId: number, knownPois: number[], poiId: number): boolean {
  return know(state, entityId, knownPois, poiId)
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

  if (charge.reveal === 'stele') {
    // Le texte et la révélation sortent de la MÊME fonction pure : ils ne peuvent pas
    // diverger. `lieuVise` est absent sur une stèle brisée ou muette — alors rien.
    const texte = texteDeStele(state.map, Math.floor(origin.x), Math.floor(origin.y))
    if (texte?.lieuVise !== undefined && isCandidate(state, knownPois, sourceId, texte.lieuVise)) {
      know(state, entityId, knownPois, texte.lieuVise)
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

/** Le point est-il sur l'empreinte d'un POI de ce `kind` ? (effets continus de terrain) */
export function isOnPoiKind(state: SimState, x: number, y: number, kind: string): boolean {
  return poisAt(state.map, x, y).some((poiId) => state.map.zones[poiId]?.kind === kind)
}

/** Multiplicateur de régén d'endurance dû au lieu — le Tarn est une halte. 1 partout ailleurs. */
export function staminaPoiFactor(state: SimState, x: number, y: number): number {
  return isOnPoiKind(state, x, y, 'tarn') ? POI.TARN_STAMINA_FACTOR : 1
}

/**
 * Une étape de tick. DEUX seuils, et leur différence est le cœur du système :
 *
 *   - **VOIR** un lieu (`POI.SIGHT_TILES`) le fait entrer dans ta carte. On ne
 *     se plante pas sur un Sanctuaire pour savoir qu'il existe : on l'aperçoit,
 *     et on le note. C'est aussi pourquoi les monuments dépassent la canopée.
 *
 *   - **L'ATTEINDRE** (fouler son empreinte) donne sa CHARGE et compte comme
 *     PREMIÈRE VISITE. Le Belvédère ne révèle sa grappe que si l'on MONTE — il
 *     ne servirait à rien qu'il fasse grimper si l'apercevoir suffisait. Et « le
 *     premier à *atteindre* le Sanctuaire » ne peut pas être quelqu'un qui l'a
 *     vu de loin.
 *
 * Appelée juste après la boucle d'inputs — la découverte est la conséquence du
 * pas qu'on vient de faire.
 */
export function advancePois(state: SimState): void {
  const npcIds = new Set(state.npcs.map((n) => n.entityId))
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  const sight2 = POI.SIGHT_TILES * POI.SIGHT_TILES

  for (const entity of state.entities) {
    if (npcIds.has(entity.id) || monsterIds.has(entity.id)) continue // les PNJ n'ont pas de carte

    // ── VOIR : tout lieu à portée de vue entre dans la carte ──
    for (let poiId = 0; poiId < state.map.zones.length; poiId += 1) {
      const zone = state.map.zones[poiId]!
      if (zone.kind === undefined) continue // un toponyme n'est pas un lieu
      if (entity.knownPois.includes(poiId)) continue
      // Distance AU CARRÉ au bord le plus proche de l'empreinte : un grand lieu
      // se voit dès qu'on approche de son flanc, pas de son centre.
      const dx = Math.max(zone.x - entity.x, 0, entity.x - (zone.x + zone.w))
      const dy = Math.max(zone.y - entity.y, 0, entity.y - (zone.y + zone.h))
      if (dx * dx + dy * dy > sight2) continue
      know(state, entity.id, entity.knownPois, poiId)
    }

    // ── ATTEINDRE : la charge, et la première visite ──
    for (const poiId of poisAt(state.map, entity.x, entity.y)) {
      // La charge ne joue qu'une fois. `reachedPois` la garde — `knownPois` ne
      // peut plus servir de garde, puisqu'on connaît désormais le lieu AVANT de
      // l'atteindre (on l'a vu venir).
      if (!entity.reachedPois.includes(poiId)) {
        entity.reachedPois.push(poiId)
        applyKnowledge(state, entity.id, entity.knownPois, poiId)
      }

      // R12 — la première visite d'un JOUEUR, tous joueurs confondus. Il n'y a
      // qu'un premier : en multi, c'est une course. Émis pour TOUS les POI ; la
      // chronique, elle, ne formatera que les quatre lieux de devise `recit`.
      if (!state.visitedPois.includes(poiId)) {
        state.visitedPois.push(poiId)
        const zone = state.map.zones[poiId]!
        // LES FAITS D'ANNALES DU LIEU, par la primitive partagée (`annales.ts` — la même clef
        // que l'écrivain, jamais un rayon). Lecture pure d'une donnée statique : zéro tirage,
        // zéro horloge — le flux d'événements gagne des champs, jamais un événement.
        // Le verdict de SAILLANCE (annales.md R4) est porté par l'événement : le formateur
        // est pur sur les événements et ne voit pas la carte — la sim témoigne du verdict
        // comme du fait. C'est ce qui empêche « Personne n'était revenu » de devenir un tic :
        // hors des routes, l'intact est PARTOUT, donc il ne se dit que là où il est seul.
        const faits = faitsDuLieu(state.map, zone).map((f) => ({
          ere: f.ere, type: f.type, ...(f.cause !== undefined ? { cause: f.cause } : {}),
          saillant: saillant(state.map, f),
        }))
        // LA STÈLE SE CITE (annales.md R11) : l'événement porte ses lignes — la chronique est
        // formatée loin de la carte, la sim témoigne de l'inscription comme elle témoigne du nom.
        const centre = poiCenter(zone)
        const stele = zone.kind === 'stele' ? texteDeStele(state.map, Math.floor(centre.x), Math.floor(centre.y)) : undefined
        emitEvent(state, {
          type: 'poi_first_visit',
          tick: state.tick,
          poiId,
          kind: zone.kind ?? '',
          name: zone.name,
          byEntityId: entity.id,
          ...(faits.length > 0 ? { faits } : {}),
          ...(stele !== undefined ? { stele: { lignes: stele.lignes } } : {}),
        })
      }
    }
  }
}
