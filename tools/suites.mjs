/**
 * `pnpm test` — TOUTES les suites, et un compte-rendu qui ne ment pas.
 *
 * ── CE QUE ÇA REMPLACE, ET POURQUOI ─────────────────────────────────────────────
 *
 * `pnpm -r run test` s'arrête au PREMIER paquet qui échoue. Et comme `client` et `server`
 * dépendent de `@braises/sim` en `workspace:*`, pnpm ordonne toujours /sim en tête : le
 * masquage n'était donc pas de la malchance, il était STRUCTUREL. Dès que /sim sortait en
 * 1, les 325 tests du client, les 37 du serveur et le banc de scénario ne tournaient
 * **pas du tout** — sans qu'une ligne de la sortie le dise.
 *
 * Or /sim sortait en 1 régulièrement, sur un flaky d'infrastructure de Vitest
 * (`Timeout calling "onTaskUpdate"`) qui ne fait échouer AUCUN test : c'est un délai de RPC
 * que Vitest n'obtient pas quand un test occupe longuement le fil (les nôtres bâtissent des
 * mondes de production, dix secondes de calcul synchrone d'affilée). Le dépôt vivait donc
 * avec une règle orale — « juge sur `Tests N passed`, pas sur le code de sortie » — qu'il
 * fallait connaître, et que la commande de garde ne connaissait pas elle-même.
 *
 * Et à l'intérieur de /sim, un `&&` faisait la même chose en plus petit : le banc de
 * scénario (`test:scenario`, le seul test qui pilote le VRAI worldgen) ne tournait jamais
 * quand la première moitié trébuchait.
 *
 * ── CE QUE ÇA FAIT ──────────────────────────────────────────────────────────────
 *
 * Chaque suite tourne, quoi qu'il arrive aux autres. On lit ensuite les COMPTES DE TESTS
 * dans la sortie de Vitest, et c'est sur eux qu'on juge :
 *
 *   • des tests échouent .................... ROUGE, et on nomme lesquels
 *   • aucun test n'échoue, sortie non nulle .. le flaky connu : on le DIT, on ne rougit pas
 *   • aucun compte lisible ................... ROUGE (un plantage avant les tests en est un)
 *
 * La règle orale devient donc la règle de l'outil. Séquentiel et non parallèle : le banc de
 * scénario mesure un coût par tick, et deux suites qui se disputent le CPU le fausseraient.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * L'ordre est celui de l'utilité : ce qui casse le plus souvent d'abord, le banc (lent) en
 * dernier — on veut le verdict des suites rapides sans attendre.
 */
const SUITES = [
  { nom: 'sim', dir: 'packages/sim', args: ['run', '--exclude', 'src/scenario.test.ts'] },
  { nom: 'client', dir: 'packages/client', args: ['run'] },
  { nom: 'serveur', dir: 'packages/server', args: ['run'] },
  // Le banc pilote le vrai worldgen sur la carte de production : lent, et seul à porter le
  // drapeau qui ignore les erreurs non gérées (voir l'en-tête de `scenario.test.ts`).
  { nom: 'banc', dir: 'packages/sim', args: ['run', 'src/scenario.test.ts', '--dangerouslyIgnoreUnhandledErrors'] },
]

/** Le flaky connu, nommé — pour le distinguer d'une vraie erreur non gérée. */
const FLAKY = /Timeout calling ["']onTaskUpdate["']/

function lance(suite) {
  return new Promise((ok) => {
    const p = spawn('pnpm', ['exec', 'vitest', ...suite.args], {
      cwd: resolve(ROOT, suite.dir),
      env: { ...process.env, CI: '1' },
    })
    let sortie = ''
    const voir = (buf) => {
      const s = String(buf)
      sortie += s
      process.stdout.write(s) // on ne cache rien : la sortie de Vitest passe telle quelle
    }
    p.stdout.on('data', voir)
    p.stderr.on('data', voir)
    p.on('exit', (code) => ok({ code: code ?? 1, sortie }))
  })
}

/**
 * Ce que Vitest dit de lui-même. La ligne de compte a la forme
 * `Tests  868 passed | 2 skipped (870)` — ou `| 3 failed` quand ça va mal.
 * On prend la DERNIÈRE occurrence : Vitest la réécrit au fil de l'eau.
 */
function compte(sortie) {
  const lignes = [...sortie.matchAll(/Tests\s+(.+)$/gm)]
  const derniere = lignes[lignes.length - 1]
  if (!derniere) return null
  const texte = derniere[1]
  const nombre = (mot) => {
    const m = texte.match(new RegExp(`(\\d+)\\s+${mot}`))
    return m ? Number(m[1]) : 0
  }
  return { passes: nombre('passed'), echecs: nombre('failed'), sautes: nombre('skipped') }
}

const resultats = []
for (const suite of SUITES) {
  console.log(`\n[1m── ${suite.nom} ──[0m`)
  const { code, sortie } = await lance(suite)
  const c = compte(sortie)
  resultats.push({ suite, code, compte: c, flaky: FLAKY.test(sortie) })
}

console.log(`\n[1m════ COMPTE-RENDU ════[0m`)
let rouge = false
for (const r of resultats) {
  const c = r.compte
  if (!c) {
    rouge = true
    console.log(`  [31m✗[0m ${r.nom ?? r.suite.nom} — AUCUN COMPTE DE TESTS (la suite n'a pas démarré ; sortie ${r.code})`)
    continue
  }
  const detail = `${c.passes} ✓${c.echecs ? ` · ${c.echecs} ✗` : ''}${c.sautes ? ` · ${c.sautes} sautés` : ''}`
  if (c.echecs > 0) {
    rouge = true
    console.log(`  [31m✗[0m ${r.suite.nom.padEnd(8)} ${detail}`)
  } else if (r.code !== 0 && r.flaky) {
    // On le DIT à chaque fois : un bruit qu'on tolère en silence finit par cacher autre chose.
    console.log(`  [33m•[0m ${r.suite.nom.padEnd(8)} ${detail}  (sortie ${r.code} — flaky Vitest « onTaskUpdate », aucun test en échec)`)
  } else if (r.code !== 0) {
    rouge = true
    console.log(`  [31m✗[0m ${r.suite.nom.padEnd(8)} ${detail}  (sortie ${r.code}, hors flaky connu — à regarder)`)
  } else {
    console.log(`  [32m✓[0m ${r.suite.nom.padEnd(8)} ${detail}`)
  }
}

const total = resultats.reduce((n, r) => n + (r.compte?.passes ?? 0), 0)
console.log(`\n  ${total} tests passés sur ${resultats.length} suites.`)
process.exit(rouge ? 1 : 0)
