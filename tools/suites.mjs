/**
 * `pnpm test` — TOUTES les suites, et un compte-rendu qui ne ment pas.
 *
 * ── CE QUE ÇA REMPLACE, ET POURQUOI ─────────────────────────────────────────────
 *
 * `pnpm -r run test` s'arrête au PREMIER paquet qui échoue. Et comme `client` et `server`
 * dépendent de `@ashes/sim` en `workspace:*`, pnpm ordonne toujours /sim en tête : le
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
  // 2026-08-30 : les réfugiés quittent le jeu (refugees.test, prompt-gate.test retirés) — et
  // les suites ont malgré ça GROSSI (chantiers cendre + garde _lit) : planchers recalés dessus.
  { nom: 'sim', dir: 'packages/sim', args: ['run', '--exclude', 'src/scenario.test.ts'], plancher: 2045 },
  { nom: 'client', dir: 'packages/client', args: ['run'], plancher: 1385 },
  { nom: 'serveur', dir: 'packages/server', args: ['run'], plancher: 36 },
  // Le banc pilote le vrai worldgen sur la carte de production : lent, et seul à porter le
  // drapeau qui ignore les erreurs non gérées (voir l'en-tête de `scenario.test.ts`).
  { nom: 'banc', dir: 'packages/sim', args: ['run', 'src/scenario.test.ts', '--dangerouslyIgnoreUnhandledErrors'], plancher: 3 },
]

/**
 * ═══ LE PLANCHER : UN TEST QUI DISPARAÎT DOIT COÛTER AUSSI CHER QU'UN TEST QUI ÉCHOUE ═══
 *
 * Le total des tests était IMPRIMÉ et comparé à RIEN. On pouvait donc perdre des dizaines
 * de tests — un fichier vidé, supprimé, ou qui ne se charge plus — et lire un compte-rendu
 * parfaitement vert. C'est la panne la plus silencieuse qui soit : on croit garder 2 000
 * tests, on en garde 1 700, et rien ne le dit, ni en local ni sur une PR.
 *
 * Le plancher n'est PAS le compte exact : il est posé quelques pourcents en dessous, parce
 * qu'on doit pouvoir retirer un test devenu faux sans faire rougir le dépôt. Ce qu'il
 * attrape est l'EFFONDREMENT — un fichier entier qui s'évapore. Et il vieillit dans le bon
 * sens : une suite qui grandit le laisse simplement derrière elle, sans jamais mentir.
 * On le relève quand la suite a franchement grossi, pas à chaque test ajouté.
 */

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
 * Ce que Vitest dit de lui-même. Il imprime DEUX lignes de compte, et il faut les DEUX :
 *
 *   Test Files  79 passed (79)          ← les FICHIERS
 *   Tests  1339 passed | 2 skipped      ← les TESTS
 *
 * ⚠ LIRE « Tests » SEUL NE SUFFIT PAS, et c'est par là que la commande mentait. Un fichier
 * qui échoue à la COLLECTE — un import cassé, un export de barrel renommé, un cycle — ne
 * produit AUCUN test, donc `failed` y vaut 0 : la ligne « Tests » est parfaitement verte
 * pendant que « Test Files » dit `1 failed`. Reproduit avec le vitest du dépôt. Combiné au
 * flaky connu, ça sortait en 0 — et la CI aussi.
 *
 * On prend la DERNIÈRE occurrence de chaque ligne : Vitest les réécrit au fil de l'eau.
 * (`/Tests\s+/` ne peut pas capturer « Test Files » par erreur : pas de `s` après `Test`.)
 */
function compte(sortie) {
  const nombresDe = (etiquette) => {
    const lignes = [...sortie.matchAll(new RegExp(`${etiquette}\\s+(.+)$`, 'gm'))]
    const derniere = lignes[lignes.length - 1]
    if (!derniere) return null
    const texte = derniere[1]
    return (mot) => {
      const m = texte.match(new RegExp(`(\\d+)\\s+${mot}`))
      return m ? Number(m[1]) : 0
    }
  }
  const tests = nombresDe('Tests')
  if (!tests) return null
  const fichiers = nombresDe('Test Files')
  return {
    passes: tests('passed'),
    echecs: tests('failed'),
    sautes: tests('skipped'),
    // `null` quand la ligne manque : on ne fabrique pas un zéro rassurant à partir de rien.
    fichiersEchecs: fichiers ? fichiers('failed') : null,
  }
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
  const nom = r.suite.nom.padEnd(8)
  const sousLePlancher = c.passes < r.suite.plancher
  if (c.echecs > 0) {
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}`)
  } else if (c.fichiersEchecs === null) {
    // La ligne « Test Files » manque alors que « Tests » est là : format inattendu. On ne
    // devine pas — un garde-fou qui suppose est un garde-fou qui finira par se tromper.
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (ligne « Test Files » illisible — format de Vitest inattendu)`)
  } else if (c.fichiersEchecs > 0) {
    // LE CAS QUE LA PORTE DU FLAKY AVALAIT : un fichier qui ne se CHARGE plus n'apporte aucun
    // test, donc aucun échec de test. Ce n'est pas un flake de RPC, c'est du code cassé.
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (${c.fichiersEchecs} FICHIER(S) EN ÉCHEC — collecte cassée, pas un flaky)`)
  } else if (sousLePlancher) {
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (SOUS LE PLANCHER de ${r.suite.plancher} — des tests ont DISPARU)`)
  } else if (r.code !== 0 && r.flaky) {
    // On le DIT à chaque fois : un bruit qu'on tolère en silence finit par cacher autre chose.
    // Et on n'arrive ici QU'APRÈS avoir écarté les trois cas ci-dessus : la question n'est pas
    // « le flaky apparaît-il ? » mais « est-il la SEULE explication de cette sortie non nulle ? ».
    console.log(`  [33m•[0m ${nom} ${detail}  (sortie ${r.code} — flaky Vitest « onTaskUpdate », aucun test ni fichier en échec)`)
  } else if (r.code !== 0) {
    rouge = true
    console.log(`  [31m✗[0m ${nom} ${detail}  (sortie ${r.code}, hors flaky connu — à regarder)`)
  } else {
    console.log(`  [32m✓[0m ${nom} ${detail}`)
  }
}

const total = resultats.reduce((n, r) => n + (r.compte?.passes ?? 0), 0)
const planchers = SUITES.reduce((n, s) => n + s.plancher, 0)
console.log(`\n  ${total} tests passés sur ${resultats.length} suites (plancher cumulé : ${planchers}).`)
process.exit(rouge ? 1 : 0)
