/**
 * LE COMPILATEUR DES PLANS — `.plan` → `plans-batis.genere.ts` (spec `atelier-plans.md` A3).
 *
 * Il vit dans `tools/` et NON dans `/sim` : le lint y interdit `fs` (invariant de pureté),
 * et c'est justement de fichiers qu'il s'agit. Le PARSEUR, lui, est pur et vit dans `/sim`
 * (`plan-format.ts`) — une seule grammaire, lue ici, dans la garde vitest et dans l'Atelier.
 *
 *   node --import tsx tools/plans-compile.mts       # ou : pnpm plans
 *
 * Sortie DÉTERMINISTE (kinds en ordre alphabétique, formatage fixe) : deux exécutions
 * rendent les mêmes octets — le fichier généré est COMMITÉ, et la garde
 * `plans-batis.test.ts` rougit s'il diverge des `.plan`.
 *
 * L'endpoint de l'Atelier (vite.config.ts du client) relance CE script après chaque
 * sauvegarde : un seul émetteur, jamais deux.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parserPlan, type Plan } from '../packages/sim/src/plan-format'
import { POI_TYPES, verifierPlan } from '../packages/sim/src/index'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = resolve(RACINE, 'packages/sim/src/plans')
const SORTIE = resolve(RACINE, 'packages/sim/src/plans-batis.genere.ts')

const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.plan')).sort()
if (fichiers.length === 0) throw new Error(`aucun .plan dans ${DOSSIER}`)

const chaine = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const blocs: string[] = []
for (const fichier of fichiers) {
  const kind = basename(fichier, '.plan')
  if (!/^[a-z_]+$/.test(kind)) throw new Error(`nom de plan invalide : « ${fichier} » (attendu [a-z_]+.plan)`)
  let plan: Plan
  try {
    plan = parserPlan(readFileSync(resolve(DOSSIER, fichier), 'utf8'))
  } catch (e) {
    throw new Error(`${fichier} : ${(e as Error).message}`)
  }
  // LA GÉOMÉTRIE AUSSI, pas que la grammaire (revue du 2026-08-10) : un plan carré au mauvais
  // côté, une région au bord, une brèche sur du vide COMPILAIENT — et l'endpoint de l'Atelier,
  // qui prend ce compilateur pour porte, les aurait laissés atterrir sur disque. Le design dit
  // « un seul émetteur » : c'est donc ici, au point d'étranglement, que la garde du jeu tourne.
  const fautes = verifierPlan(kind, plan, POI_TYPES.find((t) => t.slug === kind)?.footprint)
  if (fautes.length) throw new Error(`${fichier} : ${fautes.join(' · ')}`)
  const lignes: string[] = [`  ${kind}: {`]
  lignes.push(`    usure: ${plan.usure},`)
  if (plan.fixe) lignes.push('    fixe: true,')
  lignes.push('    grille: [')
  for (const rangee of plan.grille) lignes.push(`      ${chaine(rangee)},`)
  lignes.push('    ],')
  for (const cle of ['breches', 'seuils', 'passages'] as const) {
    const liste = plan[cle]
    if (liste?.length) lignes.push(`    ${cle}: [${liste.map(chaine).join(', ')}],`)
  }
  lignes.push('  },')
  blocs.push(lignes.join('\n'))
}

const contenu = `/**
 * ═══ GÉNÉRÉ PAR tools/plans-compile.mts — NE PAS ÉDITER À LA MAIN ═══
 *
 * La source de chaque plan est packages/sim/src/plans/<kind>.plan (la prose du lieu y vit,
 * en lignes #). Régénérer : \`pnpm plans\` — ou sauvegarder depuis l'Atelier, qui relance le
 * même émetteur. La garde \`plans-batis.test.ts\` rougit si ce fichier diverge des .plan.
 */
import type { Plan } from './plan-format'

export const PLANS: Record<string, Plan> = {
${blocs.join('\n')}
}
`
writeFileSync(SORTIE, contenu)
console.log(`${fichiers.length} plans → ${SORTIE.replace(RACINE + '/', '')}`)
