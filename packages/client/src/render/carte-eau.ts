/**
 * ═══ L'EAU DU JOUR SUR LA CARTE — C1 de la reprise de l'eau (décisions d'Alexis, 2026-09-12) ═══
 *
 * La carte du joueur (`carte-art`) est bakée UNE fois depuis le terrain immuable : elle montrait
 * de l'eau là où l'on marche à sec, un gué ouvert là où la crue l'a fermé. Or les trois régimes
 * de l'eau (`saisons.md` S10) sont des verdicts de VALLÉE, constants dans le jour de saison
 * (D1, `eau-evenements.ts`) : ce module les traduit en UN ÉTAT PAR TUILE, recalculé quand le
 * jour change et que le régime a bougé — jamais par image, jamais par cellule.
 *
 * Trois décisions, une par question :
 *   · SUR TOUT L'ARPENTÉ, au jour (« la vallée est à sec » vaut pour l'autre versant aussi ; la
 *     chronique le dit, la carte ne le cache pas) — pas de canal « vu depuis la bascule ».
 *   · L'ASSEC EN VASE DÉDIÉE (la référence du monde, assagie) : le lit garde sa forme, la mare
 *     partie ne s'efface pas en pré.
 *   · LA CRUE AVEC LES DEUX EAUX DE LA CARTE : le gué fermé prend l'eau profonde (la loi de la
 *     sim : « il se comporte comme de l'eau profonde »), la terre noyée l'eau peu profonde, et
 *     le liseré de côte se redessine sur la rive DU JOUR. Les teintes du monde assagies
 *     rendaient la crue plus claire que l'eau (126 contre 62) : à contresens sur une carte.
 *
 * PUR : la loi de la sim par tuile (`terreNoyee`, `eauASec`, `guesFermes`), un tableau d'octets.
 */
import {
  EAU, eauASec, guesFermes, terreNoyee, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER,
  type EtatEau, type WorldMap,
} from '@ashes/sim'

/** L'état d'une tuile pour la carte du jour. `BAKE` : comme le bake l'a peinte. */
export const EAU_JOUR_BAKE = 0
/** Eau peu profonde À SEC : la vase. */
export const EAU_JOUR_ASSEC = 1
/** Eau peu profonde sous la crue : le GUÉ FERMÉ, peint en eau profonde. */
export const EAU_JOUR_GUE_FERME = 2
/** Terre NOYÉE par la crue : peinte en eau peu profonde. */
export const EAU_JOUR_NOYEE = 3

/** Les trois verdicts de vallée que la carte lit, avec le niveau (la crue s'étale avec lui). */
export interface RegimeDeCarte {
  aSec: boolean
  guesFermes: boolean
  niveau: number
}

/** Le régime du jour depuis l'état que le client tient déjà (`etatGel`) et le niveau hoisté. */
export function regimeDeCarte(etat: EtatEau, niveau: number): RegimeDeCarte {
  return { aSec: eauASec(etat, niveau), guesFermes: guesFermes(etat, niveau), niveau }
}

/** LA PORTÉE DE LA NAPPE en tuiles — ce qui, du niveau, change vraiment l'image. */
function porteeDeCrue(niveau: number): number {
  return niveau > 0 ? Math.round(niveau * EAU.PORTEE_CRUE) : 0
}

/** LA CLEF DU RÉGIME : deux régimes de même clef peignent la même carte. C'est ce que
 *  WorldScene compare au changement de jour pour ne repeindre que si l'image bouge. */
export function cleDuRegime(r: RegimeDeCarte): string {
  return `${r.aSec ? 's' : '-'}${r.guesFermes ? 'g' : '-'}${porteeDeCrue(r.niveau)}`
}

/**
 * DÉRIVE L'ÉTAT DU JOUR PAR TUILE — ou `null` quand la carte du jour EST le bake (363 jours sur
 * 365 : aucun octet, aucune branche dans la peinture). O(N) sinon, sans allocation par tuile.
 */
export function deriverEauDuJour(map: WorldMap, regime: RegimeDeCarte): Uint8Array | null {
  const portee = porteeDeCrue(regime.niveau)
  if (!regime.aSec && !regime.guesFermes && portee === 0) return null
  const { width, height, terrain } = map
  const out = new Uint8Array(width * height)
  const peuProfonde = regime.aSec ? EAU_JOUR_ASSEC : regime.guesFermes ? EAU_JOUR_GUE_FERME : EAU_JOUR_BAKE
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const i = ty * width + tx
      const t = terrain[i]
      if (t === TERRAIN_SHALLOW_WATER) out[i] = peuProfonde
      else if (portee > 0 && t !== TERRAIN_DEEP_WATER && terreNoyee(map, tx, ty, regime.niveau)) out[i] = EAU_JOUR_NOYEE
    }
  }
  return out
}

/** CETTE TUILE EST-ELLE DE L'EAU AUJOURD'HUI ? Hors carte : non (comme le `VOID` du bake). */
export function estEauDuJour(map: WorldMap, eau: Uint8Array, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false
  const i = ty * map.width + tx
  const e = eau[i]
  if (e === EAU_JOUR_NOYEE) return true
  if (e === EAU_JOUR_ASSEC) return false
  const t = map.terrain[i]
  return t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER
}
