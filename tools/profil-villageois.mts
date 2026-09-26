/**
 * OÙ PART LA MILLISECONDE D'UN VILLAGEOIS, PAR RÉGIME.
 *
 * ⚠ **CETTE SONDE A PERDU SON PRÉFIXE `__` LE 2026-09-26 : ELLE SURVIT À SA SESSION.** Née
 * jetable pendant la passe sur la machine du village, elle est gardée parce que le chantier est
 * PARQUÉ et non fini (`FEATURES.VILLAGES_PNJ` est éteint, voir `features.ts`), et parce que son
 * outillage n'a rien de propre aux villages : le mode `fenetres` (le profileur armé seulement sur
 * un intervalle nommé) et ses trois lecteurs — `profil-lire.mjs` (carte de source, inlining
 * récupéré par les `positionTicks`, tables par passe / fonction / LIGNE, comparaison de deux lots
 * avec témoin), `profil-serie.mjs` (moyennes par régime, PIRE SECONDE glissante, pire tick) et
 * `profil-bloc.mjs` (isoler un pic dans une fenêtre déjà enregistrée) — servent n'importe quel
 * régime de `/sim`.
 *
 * RECETTE, et elle compte : `esbuild tools/profil-villageois.mts --bundle --platform=node
 * --format=esm --keep-names --sourcemap --target=node22` puis `node` **NU**, hors `tsx` (qui
 * majore d'environ 25 %). Le garde-fou qui marche pour juger une passe : **tout processus au-delà
 * de 50 % de CPU** — pas un motif nommé — **plus `/proc/pressure/cpu`**, échantillonné PENDANT la
 * passe. La moyenne de charge seule a fait rejeter à tort une passe saine (charge 3,02, mais
 * `full = 0` et 63 à 89 % d'inactivité).
 *
 * CE QU'ELLE A ÉTABLI, et où c'est écrit : `docs/specs/pnj.md` § P-A4 — le 1,36 ms/villageois
 * rendu à l'AMORÇAGE (croisière : 0,768), jour et nuit indistinguables sous le plancher de bruit,
 * et le vrai problème qui est un PIC de 517 à 607 ms au tick du crépuscule, causé par une bouffée
 * d'A* — `assignErrands` assigne les expéditions au tick unique où `estCrepuscule` est vrai, et
 * chaque villageois lance alors un A* complet sur 1581×1700.
 *
 * Le monde est celui de `profil-tick.mts` (graine 2026, `MONDE_JOUE`, 50 joueurs) ; seul le
 * NOMBRE DE VILLAGES change d'un run à l'autre. Le run à 0 village est le TÉMOIN INERTE : le
 * code de villageois ne peut pas s'y exécuter, donc tout ce qui ne bouge pas entre les deux est
 * la machine (carte, monstres, faune, météo) et non le villageois.
 *
 * Deux modes, même état au bit près (même graine, mêmes ticks, aucune entrée) :
 *   chrono  — aucun profileur : les ms/tick HONNÊTES, la série complète, la pire seconde.
 *   profil  — un `.cpuprofile` par TRANCHE : l'attribution, régime par régime.
 *
 * On DRAINE les événements à chaque tick, comme un hôte : `profil-tick` ne le fait pas, et sur
 * 36 000 ticks le tampon enflerait comme aucun hôte ne le permet.
 *
 *   node dist/probe.mjs <chrono|profil> <villages> <ticks> <sortie>
 */
import { Session } from 'node:inspector'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  BALANCE, MONDE, MONDE_JOUE, createSim, step, placeZoneNodes, placeHuntingGrounds, spawnPoiMonsters,
  creuserLePlancher, emplacementsDeVillage, pointsDeSpawn, generateZonedTerrain, foundNpcVillage, FAUNA, nidsAMonstre,
  getGameTime, drainEvents, TICKS_PER_CYCLE,
} from '../packages/sim/src/index'

const mode = process.argv[2] ?? 'chrono'
const villages = Number(process.argv[3] ?? 5)
const ticks = Number(process.argv[4] ?? TICKS_PER_CYCLE + 600)
const sortie = process.argv[5] ?? `/tmp/villageois-${villages}v`
const TRANCHE = Number(process.env.TRANCHE ?? 300)
const INTERVALLE = Number(process.env.INTERVALLE ?? 300)
const joueurs = 50
mkdirSync(sortie, { recursive: true })

// ─────────────────────────── LE MONDE, copie fidèle de profil-tick.mts ───────────────────────────
const t0 = performance.now()
const carte = generateZonedTerrain(2026, joueurs, MONDE_JOUE)
const tGen = performance.now() - t0
const nodes = placeZoneNodes(carte)
const emplacements = emplacementsDeVillage(carte, nodes, {
  coinsDeChasse: placeHuntingGrounds(carte.map, 2026),
  nids: nidsAMonstre(carte.map),
})
const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
creuserLePlancher(carte, nodes, [...spawns, ...emplacements])
const premier = spawns[0] ?? emplacements[0]
if (!premier) throw new Error('carte dégénérée')
const sim = createSim(2026, {
  map: carte.map,
  nodes,
  faunaCap: FAUNA.CAP,
  grounds: placeHuntingGrounds(carte.map, 2026),
  home: { x: premier.tx + 0.5, y: premier.ty + 0.5 },
})
spawnPoiMonsters(sim, 2026)
const d2 = (e: { tx: number; ty: number }) => (e.tx - premier.tx) ** 2 + (e.ty - premier.ty) ** 2
const voisins = emplacements
  .filter((e) => e.tx !== premier.tx || e.ty !== premier.ty)
  .sort((a, b) => d2(a) - d2(b))
  .slice(0, villages)
const dispositions = ['foyer', 'meute'] as const
for (const [i, v] of voisins.entries()) {
  foundNpcVillage(sim, v.tx, v.ty, BALANCE.NPC_PER_VILLAGE, dispositions[i] ?? 'neutre')
}

const gt0 = getGameTime(sim)
console.log(`mode ${mode} · villages ${villages} · ticks ${ticks} · tranche ${TRANCHE}`)
console.log(`carte ${sim.map.width}×${sim.map.height} · nœuds ${sim.nodes.length} · entités ${sim.entities.length} · PNJ ${sim.npcs.length} · monstres ${sim.monsters.length}`)
console.log(`génération : ${(tGen / 1000).toFixed(1)} s`)
console.log(`tick 0 : ${gt0.hourOfCycle.toFixed(2)} h · ${gt0.isNight ? 'NUIT' : 'jour'} · dayTicks ${gt0.dayTicks} / cycle ${TICKS_PER_CYCLE} · lever ${gt0.lever.toFixed(2)} h · jour de saison ${gt0.seasonDay}`)
console.log(`→ la NUIT commence au tick ${gt0.dayTicks}\n`)

// ─────────────────────────── LA MESURE ───────────────────────────
const session = mode === 'profil' ? new Session() : null
const post = (m: string, p?: object): Promise<Record<string, unknown>> =>
  new Promise((res, rej) => {
    // @ts-expect-error — la signature générique de l'inspecteur ne se laisse pas typer ici.
    session!.post(m, p, (e: Error | null, r: Record<string, unknown>) => (e ? rej(e) : res(r)))
  })
if (session) {
  session.connect()
  await post('Profiler.enable')
  await post('Profiler.setSamplingInterval', { interval: INTERVALLE })
  await post('Profiler.start')
}

// MODE FENÊTRES — le profileur n'est ARMÉ QUE dans des intervalles nommés, un fichier chacun.
//
// Deux raisons. D'abord le temps : profiler les 36 600 ticks du cycle pour n'en lire que cinq
// morceaux double la durée du run. Ensuite la RÉSOLUTION : la pire seconde du cycle est UN tick
// (le crépuscule) ; noyé dans une tranche de 600, il ne pèse que 4 % des échantillons et son
// coupable se perd. Chaque fenêtre porte donc son propre pas d'échantillonnage.
//   FENETRES="700-1300@300,8000-8600@300,15480-15530@50,16000-16600@300,26000-26600@300"
interface Fenetre { a: number; b: number; pas: number; nom: string }
const fenetres: Fenetre[] = (process.env.FENETRES ?? '')
  .split(',')
  .filter((s) => s.trim() !== '')
  .map((s) => {
    const m = /^(\d+)-(\d+)(?:@(\d+))?$/.exec(s.trim())
    if (!m) throw new Error(`fenêtre illisible : ${s}`)
    return { a: Number(m[1]), b: Number(m[2]), pas: Number(m[3] ?? 300), nom: `${m[1]}-${m[2]}` }
  })
const parFenetres = mode === 'fenetres' && fenetres.length > 0
const dernier = parFenetres ? Math.max(...fenetres.map((f) => f.b)) : ticks
const sessionF = parFenetres ? new Session() : null
const postF = (m: string, p?: object): Promise<Record<string, unknown>> =>
  new Promise((res, rej) => {
    // @ts-expect-error — idem.
    sessionF!.post(m, p, (e: Error | null, r: Record<string, unknown>) => (e ? rej(e) : res(r)))
  })
if (sessionF) {
  sessionF.connect()
  await postF('Profiler.enable')
  console.log(`fenêtres profilées : ${fenetres.map((f) => `${f.nom}@${f.pas}µs`).join(', ')} — on s'arrête au tick ${dernier}\n`)
}
const debutDe = new Map(fenetres.map((f) => [f.a, f] as const))
const finDe = new Map(fenetres.map((f) => [f.b, f] as const))

const serie = new Float64Array(ticks)
const journal: Record<string, number | string | boolean>[] = []
let tTranche = performance.now()

// ── LE CANARI DU FLUX D'ÉVÉNEMENTS ──
// `rngState` prouve que le PRNG a été tiré le même nombre de fois ; il ne prouve PAS que le même
// flux d'événements est sorti. Un A/B de perf doit montrer les deux. FNV-1a sur le JSON de chaque
// événement drainé, replié en 32 bits : déterministe, et sensible à l'ORDRE comme au contenu.
let hEvts = 0x811c9dc5
let nEvts = 0
const avaler = (s: string): void => {
  for (let i = 0; i < s.length; i++) {
    hEvts ^= s.charCodeAt(i)
    hEvts = Math.imul(hEvts, 0x01000193) >>> 0
  }
}

for (let i = 0; i < ticks; i++) {
  if (parFenetres) {
    const f = debutDe.get(i)
    if (f) {
      await postF('Profiler.setSamplingInterval', { interval: f.pas })
      await postF('Profiler.start')
      tTranche = performance.now()
    }
  }
  const a = performance.now()
  step(sim, [])
  const evts = drainEvents(sim)
  serie[i] = performance.now() - a
  // Le canari est HORS chrono : il ne doit pas payer dans la mesure qu'il garde.
  for (const e of evts) { avaler(JSON.stringify(e)); nEvts++ }
  if (parFenetres) {
    const f = finDe.get(i)
    if (f) {
      const r = await postF('Profiler.stop')
      writeFileSync(`${sortie}/f${f.nom}.cpuprofile`, JSON.stringify(r.profile))
      let s = 0
      for (let k = f.a; k <= f.b; k++) s += serie[k]!
      const gt = getGameTime(sim)
      console.log(
        `  FENÊTRE ${f.nom.padEnd(13)} : ${(s / (f.b - f.a + 1)).toFixed(2).padStart(7)} ms/tick (profileur armé, donc majoré)` +
          ` · ${gt.hourOfCycle.toFixed(1)} h ${gt.isNight ? 'NUIT' : 'jour'} · pnj ${sim.npcs.length} dorment ${sim.npcs.filter((n) => n.sleeping).length}` +
          ` · monstres ${sim.monsters.length} · rng ${sim.rngState} → f${f.nom}.cpuprofile`,
      )
      // Les cinq ticks les plus chers de la fenêtre : c'est là qu'est le gel, pas dans la moyenne.
      const pires: Array<[number, number]> = []
      for (let k = f.a; k <= f.b; k++) pires.push([serie[k]!, k])
      pires.sort((x, y) => y[0] - x[0])
      console.log(`       5 pires ticks : ${pires.slice(0, 5).map(([v, k]) => `${k}=${v.toFixed(1)}ms`).join('  ')}`)
      if (f.b - f.a <= 60) for (let k = f.a; k <= f.b; k++) console.log(`       tick ${k} : ${serie[k]!.toFixed(2)} ms`)
      if (i >= dernier) {
        console.log(`\nCANARI  rngState=${sim.rngState}  evenements=${nEvts}  hash=${hEvts >>> 0}  pnj=${sim.npcs.length}  monstres=${sim.monsters.length}`)
        writeFileSync(`${sortie}/journal-fenetres.json`, JSON.stringify({ villages, fenetres, nuitDes: gt0.dayTicks, rng: sim.rngState, nEvts, hash: hEvts >>> 0 }))
        process.exit(0)
      }
    }
  }

  if ((i + 1) % TRANCHE === 0) {
    const msTranche = (performance.now() - tTranche) / TRANCHE
    const gt = getGameTime(sim)
    const dorment = sim.npcs.filter((n) => n.sleeping).length
    const sansChemin = sim.npcs.filter((n) => n.sansChemin.length > 0).length
    journal.push({
      tick: i + 1,
      ms: Number(msTranche.toFixed(3)),
      h: Number(gt.hourOfCycle.toFixed(2)),
      nuit: gt.isNight,
      pnj: sim.npcs.length,
      dorment,
      sansChemin,
      monstres: sim.monsters.length,
      entites: sim.entities.length,
      corps: sim.corpses.length,
      rng: sim.rngState,
    })
    console.log(
      `  tick ${String(i + 1).padStart(6)} : ${msTranche.toFixed(2).padStart(7)} ms/tick · ${gt.hourOfCycle.toFixed(1).padStart(4)} h ${gt.isNight ? 'NUIT' : 'jour'}` +
        ` · pnj ${String(sim.npcs.length).padStart(2)} (dorment ${String(dorment).padStart(2)}, sansChemin ${sansChemin})` +
        ` · monstres ${String(sim.monsters.length).padStart(3)} · corps ${String(sim.corpses.length).padStart(3)} · rng ${sim.rngState}`,
    )
    if (session) {
      // On ARRÊTE, on écrit, on redémarre : le tick qui paie l'écriture est hors mesure de la
      // tranche suivante (le chrono de tranche redémarre après).
      const r = await post('Profiler.stop')
      writeFileSync(`${sortie}/t${String(i + 1).padStart(6, '0')}.cpuprofile`, JSON.stringify(r.profile))
      await post('Profiler.start')
    }
    tTranche = performance.now()
  }
}

writeFileSync(
  `${sortie}/serie-${mode}.json`,
  JSON.stringify({ mode, villages, ticks, TRANCHE, nuitDes: gt0.dayTicks, serie: [...serie].map((x) => Number(x.toFixed(4))), journal }),
)

// ─────────────────────────── LE VERDICT ───────────────────────────
const moy = (a: number, b: number): number => {
  let s = 0
  for (let i = a; i < b; i++) s += serie[i]!
  return s / (b - a)
}
const ROD = Math.min(500, Math.floor(ticks / 10)) // rodage : JIT + amorçage du village
const nuitDes = gt0.dayTicks
console.log(`\n── ${mode} · ${villages} villages · ${sim.npcs.length} PNJ vivants à la fin ──`)
console.log(`tout (hors ${ROD} de rodage) : ${moy(ROD, ticks).toFixed(2)} ms/tick`)
if (nuitDes > ROD) console.log(`JOUR  (ticks ${ROD}..${nuitDes}) : ${moy(ROD, Math.min(nuitDes, ticks)).toFixed(2)} ms/tick`)
if (ticks > nuitDes) console.log(`NUIT  (ticks ${nuitDes}..${ticks}) : ${moy(nuitDes, ticks).toFixed(2)} ms/tick`)

// La pire SECONDE : 20 ticks consécutifs (20 Hz), fenêtre glissante.
let pire = -1
let pireI = 0
let somme = 0
for (let i = 0; i < ticks; i++) {
  somme += serie[i]!
  if (i >= 20) somme -= serie[i - 20]!
  if (i >= 20 + ROD && somme > pire) { pire = somme; pireI = i - 19 }
}
let pireTick = ROD
for (let i = ROD; i < ticks; i++) if (serie[i]! > serie[pireTick]!) pireTick = i
console.log(`pire SECONDE : ticks ${pireI}..${pireI + 19} → ${(pire / 20).toFixed(2)} ms/tick (${pire.toFixed(0)} ms pour 20 ticks) · ${pireI < nuitDes ? 'jour' : 'NUIT'}`)
console.log(`pire TICK    : ${pireTick} → ${serie[pireTick]!.toFixed(2)} ms · ${pireTick < nuitDes ? 'jour' : 'NUIT'}`)
console.log(`budget 20 Hz : moyenne ${(moy(ROD, ticks) / 50 * 100).toFixed(1)} % · pire seconde ${(pire / 20 / 50 * 100).toFixed(1)} %`)
console.log(`CANARI  rngState=${sim.rngState}  evenements=${nEvts}  hash=${hEvts >>> 0}  pnj=${sim.npcs.length}  monstres=${sim.monsters.length}`)
