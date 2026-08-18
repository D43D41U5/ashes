/**
 * RECENSEMENT A7/C7 — mine et grotte naissent-elles encore à empreinte 7 ?
 *
 * L'élargissement 5→7 (révision du 2026-08-11, l'anneau de massif) rétrécit l'éligibilité
 * (bordure, routes sous l'empreinte, budget de percement, et l'entrée désormais RELIÉE au
 * cœur). La loi écrite de l'élargissement : « si un type cesse de naître, on resserre » —
 * on MESURE donc, sur plusieurs seeds de la vraie carte de production, jamais au goût.
 *
 *   node --import tsx tools/recensement-antres.mts [seeds…]
 */
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'

const seeds = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [1, 2, 7, 2026, 4242]
const KINDS = ['mine', 'grotte', 'abri', 'oratoire', 'cabane', 'ruines'] as const

console.log(`seed      | ${KINDS.map((k) => k.padStart(8)).join(' | ')}`)
for (const seed of seeds) {
  const { map } = generateZonedTerrain(seed, undefined, MONDE_JOUE)
  const compte = new Map<string, number>()
  for (const z of map.zones) if (z.kind !== undefined) compte.set(z.kind, (compte.get(z.kind) ?? 0) + 1)
  console.log(`${String(seed).padEnd(9)} | ${KINDS.map((k) => String(compte.get(k) ?? 0).padStart(8)).join(' | ')}`)
}
