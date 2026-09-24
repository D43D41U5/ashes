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
  // 2026-08-31 : +22 gardes avec les ÉTAGES (`etages.test.ts`, spec `etages.md`) — le plancher
  // suit, en gardant la marge de quelques pourcents que décrit le commentaire ci-dessous.
  // 2026-09-03 : +89 gardes avec les TERRASSES (`terrasses.test.ts`, spec `terrasses.md`) —
  //   suite à 2169, plancher relevé quelques pourcents dessous.
  // 2026-09-05 : +8 gardes avec L'EAU SUR L'ESCALIER (T-A11, `terrasses.test.ts`, N3) —
  //   suite à 2195, plancher recalé quelques pourcents dessous.
  // 2026-09-06 : +58 gardes avec LES GROTTES DE TERRASSE (`grottes.test.ts`, spec `grottes.md`) —
  //   suite à 2253, plancher relevé quelques pourcents dessous.
  // 2026-09-06 : +18 gardes avec LES VIGNETTES G-R6 et le gel sous la roche (G-A6/G-A8/G-A12,
  //   `grottes.test.ts`, `plans-batis.test.ts`) — suite à 2271, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +3 gardes E-A3 — le murmure ne traverse pas un plancher (`murmure.test.ts`, 2),
  //   et le feu n'écarte le loup que de SON étage (`etages-etancheite.test.ts`, 1)
  //   — suite à 2280, plancher relevé quelques pourcents dessous.
  // 2026-09-07 (lot ①, Q1..Q4) : +5 gardes E-A3 — les décisions d'Alexis sur le feu, la
  //   perception du Cendreux, le cri de la harde, le hurlement du clan et l'odorat
  //   (`etages-etancheite.test.ts`) — suite à 2285.
  // 2026-09-07 (lot ②, Q6) : +2 gardes E-A3 — on ne boit pas un feu qu'on ne peut pas toucher
  //   (feu libre et Foyer de village) — suite à 2287.
  // 2026-09-07 (lot ③, Q5) : +4 gardes E-A3 — l'interaction à portée (`near` et ses 25 appels,
  //   la ligne, le dépeçage, le coin de chasse appris, le bâti) — suite à 2291.
  // 2026-09-11 : +5 gardes E-R5 §23 — l'approche vise l'étage de sa cible (`etages-etancheite`),
  //   puis +4 gardes T-A13 — le bord de terrasse n'est plus la grille de 8 (`terrasses.test.ts`,
  //   spec T-R11) — suite à 2305, plancher relevé quelques pourcents dessous.
  // 2026-09-11 : +5 gardes avec LE PAS D'ÉTAGE DU VILLAGEOIS (`etages-etancheite.test.ts`, spec
  //   §24) — la paroi, le mur de la terrasse, la descente dans la salle, la remontée. Suite à 2310.
  // 2026-09-12 : +18 gardes avec LA QUALITÉ DE L'EAU (`qualite-eau.test.ts`, spec `qualite-eau.md`)
  //   — la suie au plafond, le sang qui descend le fil, le coude qui ne coud pas, l'eau dormante,
  //   les deux bornes, la glace qui protège, l'événement qui ne bégaie pas. Suite à 2328,
  //   plancher relevé quelques pourcents dessous.
  // 2026-09-12 : +3 gardes de REVUE sur le même lot — l'attache exhaustive sur le vrai monde joué
  //   (A2ter, avec le témoin de la borne d'avant), le corps qui MARCHE en saignant (A4bis : un
  //   événement par tuile, plafond et éviction par le vrai chemin) et la re-entrée (A8bis).
  //   Suite à 2331.
  // 2026-09-12 : +6 gardes de la revue `determinisme-sim` — l'éviction par le TICK (le gué qu'on
  //   saigne n'est plus jeté), la portée du booléen que lit la pêche (épinglée en dur), le marais
  //   qui se souille hors crue (décision d'Alexis) et son témoin, la sauvegarde d'avant le champ.
  //   Suite à 2337 ; +1 avec la roselière (décision d'Alexis, même jour) — suite à 2338.
  // 2026-09-12 : +3 gardes Q9 — LA HARDE RENONCE à boire une eau ensanglantée (A7, son témoin,
  //   le seuil ; `qualite-eau.test.ts`). Suite à 2341.
  // 2026-09-12 : +22 gardes avec LA PISTE DE SANG (`piste-de-sang.test.ts`, spec `piste-de-sang.md`)
  //   — il vient de loin et son témoin, en silence, le sens de la piste, elle guide sans réveiller
  //   (×4), le loup qui saigne et le frère qui saigne, le sang de l'HOMME seulement (×3 : le tag à
  //   la source, la piste de bête au sol, l'eau de bête), l'eau qui appelle vers l'amont (×5,
  //   méandre compris), elle se perd, le mur entre deux gouttes (revue), le Feu tient, la roche
  //   arrête. Suite à 2363 sur l'arbre (2358 sur l'arbre commité seul : 5 gardes d'étage de
  //   l'autre session en plus), plancher relevé à 2345.
  // 2026-09-12 : +8 gardes A11 — LA VOIE EXACTE DU RENDU (`qualite-eau.test.ts`, lot SANG 2c) : la
  //   table d'attache ≡ attacheAuFil (fleuve, méandre, bande du monde joué — attaches ET orphelines),
  //   l'empreinte ≡ qualiteDeLEau AU BIT PRÈS (neuf souillures mêlées sur toute la carte, le coude,
  //   huit traînées du monde joué), l'effacement de l'appel d'avant, les crans (une goutte par cran,
  //   cran ≥ 2 ⇔ eauSouillee). Suite à 2371 sur l'arbre (2366 sur l'arbre commité seul), plancher
  //   relevé à 2350.
  // 2026-09-12 : +7 gardes A2 — TOUS LES FLEUVES (reprise de l'eau ; décision d'Alexis : « tous les
  //   fils, partout »). `qualite-eau.test.ts` (6) : le fil global et ses fins, l'aval qui ne franchit
  //   jamais la fin d'un fleuve, le sang du bout du premier qui ne teint pas la source du second, le
  //   monde joué (chaque point d'un fleuve secondaire s'attache à SON fleuve et se pêche en rivière —
  //   avant : −1 et « lac »), un fleuve VIDE dans `fils` qui ne fait pas couler la suie d'un fleuve
  //   dans le suivant (revue déterminisme), la table et l'empreinte au bit près à deux fleuves (A11) ;
  //   `peche.test.ts` (1) : un second fleuve est une rivière, pas un lac. Suite à 2378 sur l'arbre
  //   (2373 sur l'arbre commité seul), plancher relevé à 2360.
  // 2026-09-12 : +1 garde A2bis — LE LIT PEINT (décision d'Alexis : la rivière de la pêche est le lit
  //   que le peintre a posé, plus une bande à 2 du fil). `peche.test.ts` : le lit à 3 et 4 du fil est
  //   rivière, le lac qu'un fil traverse reste lac, l'ordre du lit est indifférent, une tuile comblée
  //   n'est plus rien ; et sur le monde joué (dans la garde A1/A2) zéro tuile de `map.lacs` en
  //   rivière, ≥ 1 000 tuiles de rivière hors bande. Suite à 2379 sur l'arbre (2374 sur l'arbre
  //   commité seul) ; plancher inchangé (2360).
  // 2026-09-12 : +2 gardes A1 — LE DÉBIT PERSISTÉ (`hydro.test.ts` ; décision d'Alexis : `map.debit`,
  //   un rang 0-7 par tuile) — la loi du rang (l'inverse du rayon, 1..7, monotone, bornée) et le
  //   monde joué (terre et lacs à 0, tout point de fil hors lac > 0, le fleuve grossit vers sa
  //   bouche). `carte-immuable.test.ts` hache le champ. Suite à 2381 sur l'arbre (2376 sur l'arbre
  //   commité seul) ; plancher inchangé (2360).
  // 2026-09-12 : +1 garde (`eau-rendu.test.ts`) — la bande morte de l'assec est un verdict de vallée
  //   (`eauASec`), et la porte du client la lit ; l'entrée franche seule manquait 1 aube sur 240.
  //   Suite à 2382 sur l'arbre (2377 sur l'arbre commité seul) ; plancher inchangé (2360).
  // 2026-09-12 : +5 gardes D1 — LES ÉVÉNEMENTS D'EAU (`eau-evenements.test.ts`, spec `saisons.md`
  //   A25 ; décision d'Alexis : « la vallée, au jour, sans le gel ») — la mare qui part et revient,
  //   la saison jouée muette, la crue qui ferme les gués puis rend dans l'ordre, la sauvegarde
  //   d'avant, la chronique. Suite à 2387 sur l'arbre (2382 sur l'arbre commité seul) ; plancher
  //   inchangé (2360).
  // 2026-09-20 : +6 gardes — LA ROCHE EST ÉTANCHE (`etages.test.ts` 1 : un souterrain ne se rejoint
  //   jamais par sa gueule ; `etages-etancheite.test.ts` 1 : le sanglier ne sent ni n'encorne à
  //   travers un plancher) et LA PAROI TIENT UNE TUILE (`grottes.test.ts` G-A15, 4 graines). Suite à
  //   2458 sur l'arbre, 2 rouges PRÉEXISTANTS à HEAD dans `charniers.test.ts` (les 15 Sources du
  //   2026-09-13 jamais ré-épinglées : 172 lieux, et le Charnier XLVIII à 21 t d'une Source) ;
  //   plancher inchangé (2360).
  // 2026-09-20 : les deux rouges de `charniers.test.ts` soldés — 157 → 172 ré-épinglé (les 15 Sources
  //   sont un AJOUT pur : la loterie garde ses 134, gardés à part), et la Source sort de la règle
  //   d'écart des charniers (poussée APRÈS eux, `tropPres` ne l'a jamais vue ; le recouvrement reste
  //   gardé pour tous les lieux). Suite à 2460 ✓ sur l'arbre (2 sautés) ; plancher inchangé (2360).
  //   ⚠ A13 (`zonegen.test.ts`, < 20 s) tient à 17,7 s machine calme et rougit à 22 s sous les
  //   cinq workers à cache froid : une garde de temps se juge seule, pas dans la suite chargée.
  // 2026-09-21 : +4 gardes T-A14 — aucun pied de mur à plus d'un PLAFOND d'une montée, là où le
  //   terrain en offre une (`terrasses.test.ts`, spec `terrasses.md` §5, 4 graines). Suite à 2468 ✓
  //   sur l'arbre (2 sautés) ; plancher inchangé (2360).
  // 2026-09-22 : +1 garde A16 — un glanage ENCLAVÉ cesse d'être élu et le village prend celui
  //   qu'il PEUT atteindre (`glanage.test.ts`, spec `ascension.md` V-R12). Suite à 2469 ;
  //   plancher relevé d'autant.
  { nom: 'sim', dir: 'packages/sim', args: ['run', '--exclude', 'src/scenario.test.ts'], plancher: 2361 },
  // 2026-09-01 : +10 gardes avec le RENDU des étages (`plateau-art.test.ts`).
  // 2026-09-01 : +9 gardes avec le TRI DES ÉTAGES (strate, découvert — `framing.test.ts`),
  //   suite relevée à 1429 ✓, plancher recalé quelques pourcents dessous.
  // 2026-09-06 : +68 gardes avec les GROTTES (index à deux mondes, `index-noeuds.test.ts`…) —
  //   suite à 1497, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +12 gardes avec LE SEUIL D'UNE GUEULE (`niveau-du-corps.test.ts`, la loi sortie
  //   d'`etage-layer` pour être testable) — suite à 1524, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +7 gardes avec LA VISÉE D'UNE GUEULE (`deplier-etage.test.ts` : l'arche se
  //   déplie comme une rampe) — suite à 1531, plancher relevé quelques pourcents dessous.
  // 2026-09-07 : +16 gardes avec L'ACCESSEUR D'ÉTAGE DU RENDU (`strates.test.ts`, E-R28/29/30)
  //   — suite à 1547, plancher relevé quelques pourcents dessous.
  // 2026-09-08 : +18 gardes avec LES OISEAUX (`vol-des-oiseaux.test.ts` : l'heure du vol est
  //   celle du chant, l'aube n'appartient qu'aux passereaux, l'aile fait l'aller-retour)
  //   — suite à 1565, plancher relevé quelques pourcents dessous.
  // 2026-09-12 : trois ASSERTIONS modifiées (aucun test ajouté) — les compteurs de l'inventaire audio recalés sur `water_fouled`
  //   (99 faits, 42 silences décidés) : un fait muet est un fait COMPTÉ. Suite à 1565.
  // 2026-09-12 : +5 gardes avec LE CANAL B À TROIS CHIFFRES (`water-field.test.ts`, lot SANG 2c) —
  //   régime × cran de sang × palier : encodage/décodage exhaustif, aucun cran ne franchit un seuil
  //   de régime (un plafond à 9 crans rougissait : 5), les octets historiques 0/100/200 inchangés,
  //   `buildWaterField` pose les dizaines. Suite à 1570, plancher relevé à 1560.
  // 2026-09-12 : +19 gardes avec LES VOIX DE L'EAU (reprise de l'eau, B1 + B3) — la cascade a une
  //   voix (`cascade-audio.test.ts`, 12 : la loi de la cible — silence, une colonne « ici », √N,
  //   plafond, côté, voile, monotone ; la machine — pas de nappe sans colonne, cadence, sommeil,
  //   taire), le splash d'un autre et le clapotis se tiennent quelque part (`eau-audio.test.ts`, 6 :
  //   le point de rive par le gradient du SDF, ce que chaque voix tend au moteur), et la cascade
  //   seule a un panner (`engine.test.ts`, 1). Suite à 1589, plancher relevé à 1575.
  // 2026-09-12 : +2 gardes A2 (`flow-field.test.ts`) — un second fleuve a son courant (avant : une eau
  //   morte à l'écran), le fleuve principal ne bouge pas d'un vecteur loin de la confluence et la
  //   confluence prend le point de fil le plus proche. Suite à 1591 ; plancher inchangé (1575).
  // 2026-09-12 : +5 gardes C1 — LA CARTE MONTRE L'EAU DU JOUR (`carte-eau.test.ts`, spec `saisons.md`
  //   A26 ; trois décisions d'Alexis) — `null` les jours où la carte du jour est le bake, la
  //   dérivation par tuile, peindre « comme le bake » = copier le bake (octet pour octet), la vase
  //   de l'assec et son liseré, la crue aux deux eaux et la rive qui bouge. Suite à 1596 ;
  //   plancher inchangé (1575).
  // 2026-09-19 : la LUMIÈRE GLOBALE a apporté ses gardes au fil du chantier (176 tests GI, `render/gi/`,
  //   fusionnés sur main le 19/09) sans que le plancher bouge ; puis +6 avec LA PASSE DES CORPS EN
  //   ATTRIBUTS (`corps-gpu.test.ts` : les drapeaux empaquetés, la teinte, le GLSL sans uniforme par
  //   sprite). Suite à 1795, plancher relevé quelques pourcents dessous.
  // 2026-09-24 : +4 gardes V-R8 — LES PAROIS DE TERRASSE SUR LA CARTE (`carte-savoir.test.ts` :
  //   la crête porte le trait et le pied l'ombre, la rampe fait une trouée et LÀ SEULEMENT, une
  //   rampe de MESA n'ouvre rien — le piège du `vers` —, et sans `map.palier` rien ne bouge).
  //   Suite à 1802 ✓ sur l'arbre ; plancher inchangé (1740).
  { nom: 'client', dir: 'packages/client', args: ['run'], plancher: 1740 },
  { nom: 'serveur', dir: 'packages/server', args: ['run'], plancher: 36 },
  // Le banc pilote le vrai worldgen sur la carte de production : lent, et seul à porter le
  // drapeau qui ignore les erreurs non gérées (voir l'en-tête de `scenario.test.ts`).
  { nom: 'banc', dir: 'packages/sim', args: ['run', 'src/scenario.test.ts', '--dangerouslyIgnoreUnhandledErrors'], plancher: 4 },
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
