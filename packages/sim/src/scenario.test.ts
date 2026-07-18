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
  // TIMEOUT 300s → 600s (2026-07-18) : `runScenario` est SYNCHRONE, vitest ne peut donc pas
  // l'interrompre — un dépassement le fait échouer même si les assertions passeraient. Retirer le
  // malus de vitesse en forêt (avatars plus rapides) allonge la trajectoire des bots (plus d'entre
  // eux survivent et restent actifs, une horde de plus) : la course passe de ~175s à ~330s. On
  // desserre le plafond ; l'écosystème, lui, reste sain (le Foyer survit, cf. assertions).
  it(`l'écosystème tient ${DAYS} jours : personne n'affame, les Feux gardent leur caractère`, { timeout: 600_000 }, () => {
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
    //
    // SEUIL RELEVÉ 3 → 10 (2026-07-18, décision d'Alexis). Retirer le malus de vitesse en forêt
    // (`speedFactor` 0,8 → 1) accélère les AVATARS — donc les bots de ce banc, dont l'IA de survie
    // était calée sur l'ancienne vitesse : leur trajectoire produit ~7 pics de faim au lieu de 3,
    // SANS effondrement (le Foyer survit, cf. l'assertion ci-dessous). On recale sur ce régime, en
    // gardant de la marge sous un vrai effondrement (des dizaines). À re-serrer si l'IA est recalée.
    expect(report.starvationSamples).toBeLessThanOrEqual(10)
    const foyer = report.villages.find((v) => v.archetype === 'foyer')
    expect(foyer).toBeDefined()
    expect(foyer!.membersAlive).toBeGreaterThan(0)
    expect(report.chronicle.length).toBeGreaterThan(2)
  })
})
