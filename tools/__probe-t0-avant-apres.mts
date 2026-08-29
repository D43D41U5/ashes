// Le tirage du MONDE JOUÉ bouge-t-il quand la Louvière perd ses zones de vallée ?
// On génère le T0 deux fois : zones actuelles (['pres_bas']) puis l'ancienne liste
// remise à chaud dans POI_TYPES — même graine, comparaison des lieux au nom et à la tuile.
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { POI_TYPES } from '../packages/sim/src/poi'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'

const releve = () =>
  generateZonedTerrain(7, undefined, MONDE_JOUE)
    .map.zones.map((z) => `${z.kind}@${z.x},${z.y}`)
    .join(' | ')

const apres = releve()
const type = POI_TYPES.find((t) => t.slug === 'louviere')! as { zones?: string[] }
type.zones = ['sylve', 'alpages', 'pres_bas']
const avant = releve()

console.log(avant === apres ? 'IDENTIQUE au lieu près (T0, seed 7)' : 'DIFFÈRE')
if (avant !== apres) {
  console.log('avant:', avant)
  console.log('apres:', apres)
}
