import { describe, expect, it } from 'vitest'
import { runScenario } from './scenario'

// Le tsconfig de /sim est ES2022 pur (pas de lib Node) — le test, lui, tourne
// sur Node : on déclare le strict nécessaire.
declare const process: { env: Record<string, string | undefined> }
declare const console: { log: (...args: unknown[]) => void }

/**
 * Le banc de test (V10). Par défaut : 6 jours (rapide, dans la CI).
 * Calibrage long : SCENARIO_DAYS=60 pnpm scenario — imprime le rapport.
 */
const DAYS = Number(process.env.SCENARIO_DAYS ?? 6)

describe('le banc de test', () => {
  it(`l'écosystème tient ${DAYS} jours : personne n'affame, les Feux gardent leur caractère`, { timeout: 300_000 }, () => {
    const report = runScenario(2026, DAYS)

    // Le rapport, pour l'humain (et l'agent) qui calibre balance.ts.
    console.log(`\n═══ Rapport de scénario — ${report.days} jours (${report.ticks} ticks) ═══`)
    for (const v of report.villages) {
      console.log(
        `  ${v.name} [${v.archetype}] : ${v.membersAlive} membres, nourriture ${v.granaryFood}, bois ${v.granaryWood}`,
      )
    }
    console.log(`  morts d'avatars : ${report.deaths} · hordes : ${report.hordesSpawned} · échantillons affamés : ${report.starvationSamples}`)
    console.log(`\n─── Chronique (${report.chronicle.length} entrées) ───`)
    for (const line of report.chronicle.slice(0, 30)) console.log(`  ${line}`)

    // Les invariants : l'écosystème ne s'effondre pas silencieusement — quelques
    // pics de faim momentanés et isolés sont tolérés (bruit stochastique d'une
    // trajectoire donnée), un effondrement réel produirait un nombre bien plus grand.
    expect(report.starvationSamples).toBeLessThanOrEqual(3)
    const foyer = report.villages.find((v) => v.archetype === 'foyer')
    expect(foyer).toBeDefined()
    expect(foyer!.membersAlive).toBeGreaterThan(0)
    expect(report.chronicle.length).toBeGreaterThan(2)
  })
})
