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
import { POI_TYPES, type PoiType } from './poi'

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
