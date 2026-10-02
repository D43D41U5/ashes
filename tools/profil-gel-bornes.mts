/**
 * ═══ CE QUE LES DEUX BORNES DE PALIER FONT GAGNER — l'A/B de l'étape 2 de `braise.md` § 3 ═══
 *
 * `estGele` d'aujourd'hui contre une RÉPLIQUE de celui d'avant le 2026-10-02 (porte GLOBALE
 * d'abord, aucune borne de palier). Même sim, même tick, mêmes tuiles.
 *
 * ⚠ **POURQUOI UN A/B ALTERNÉ DANS UN SEUL PROCESSUS, et non deux lots.** Deux lots ont été
 * essayés le 2026-10-02 (`profil-porte-gel.mts` bâti deux fois, à HEAD et sur l'arbre) : ils ont
 * rendu 7 ms avant et 25 ms après au cœur du Grand Froid, soit une régression ×3,4 — alors que le
 * code d'aujourd'hui fait, par construction, STRICTEMENT MOINS de travail (les deux bornes ne
 * peuvent que court-circuiter une lecture, jamais en ajouter une).
 *
 * **LA CAUSE EST UN CALLEE FROID, ET ELLE EST MESURÉE** (ce n'est PAS du bruit de VM : le bloc
 * fautif était le même à chaque lot, pendant que les autres blocs du même lot tenaient à 1 ms).
 * Avec les deux bornes, les trois cardinaux doux et toute l'altitude court-circuitent : plus un
 * seul appel à `baselineTemperature`. Le cœur du Grand Froid au palier 0 est alors **le premier
 * bloc du processus à l'exécuter**, et il la paie froide. MESURÉ, 3 000 tuiles d'eau au palier 0,
 * dans cet ordre : 1ᵉʳ tour **90,64 ms**, 2ᵉ 89,53, 5ᵉ 31,79, régime **11,14 ms** — ×8.
 * Le préchauffage du profileur (120 tours) n'y change rien : lui aussi court-circuite.
 *
 * ⚠ Ce que cela dit du CLIENT est **SUSPECTÉ** : si son fil principal garde `baselineTemperature`
 * chaud par ailleurs, il ne paiera jamais ce premier tour ; sinon, la première cuisson du premier
 * instant gelant de l'année le paie une fois. Ce n'est pas mesuré dans le navigateur.
 *
 * Alterner tour par tour dans le même processus croise les préchauffages (chaque `head()` garde le
 * callee chaud pour le `neuf()` qui suit) et lire la MÉDIANE donne le RÉGIME — c'est ce qu'on veut
 * ici : le coût d'une cuisson en partie courante, pas celui de la toute première.
 *
 * ⚠ **ET L'A/B SE VÉRIFIE LUI-MÊME** : avant de chronométrer, les deux régimes doivent compter le
 * même nombre de tuiles prises. Un A/B de perf entre deux fonctions qui ne rendent pas la même
 * chose ne mesure rien — il compare deux jeux.
 *
 * `node_modules/.pnpm/node_modules/.bin/esbuild --bundle tools/profil-gel-bornes.mts --format=esm \
 *    --platform=node --outfile=tools/__gb.mjs && node tools/__gb.mjs`
 * (⚠ la sortie doit rester SOUS `tools/` : `carteDeTest` cherche `packages/sim/src` en relatif.)
 * ⚠ `tsx` invente 25 % sur ce genre de chemin (mémoire « Profiler /sim : tsx ment de 25 % ») —
 * c'est esbuild, et le chrono est du temps CPU, pas du temps de mur.
 */
import { createSim } from '../packages/sim/src/sim'
import { carteDeTest } from './carte-cache'
import { MONDE, MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { estGele, gelPossible } from '../packages/sim/src/gel'
import { baselineTemperature, baselineTemperatureAt } from '../packages/sim/src/temperature'
import { palierDuSol } from '../packages/sim/src/etages'
import { foyersDeLaCarte } from '../packages/sim/src/cendre'
import { terrainAt } from '../packages/sim/src/map'
import { GEL, TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER } from '../packages/sim/src/balance'

const m = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const sim = createSim(2026, { map: m.map, calendarScale: 1, meteoActive: false })

/**
 * ⚠ **IL FAUT MESURER LES DEUX RÉGIMES DE CENDRE, et le premier jet ne mesurait que le facile.**
 * Depuis le 2026-10-02, `plancherDuPalier` retranche un majorant des froids LOCAUX (fumerolle,
 * cendre) — mais **seulement si la carte peut les porter**, c'est-à-dire si `cendreAge` n'est pas
 * vide. Or `createSim` le laisse vide : une sonde qui s'arrête là mesure le gain SANS la pénalité
 * qu'elle vient d'introduire. On mesure donc `cendre neuve` (la borne serrée) **et** `cendre
 * vieillie` (la borne élargie de `FROID_LOCAL_MAX`), et l'écart entre les deux EST le prix du
 * correctif de soudure.
 *
 * ⚠ **ET DEPUIS `map.souffleMax` (le même jour, plus tard), L'ÉLARGISSEMENT N'EST PLUS LE MÊME** :
 * le majorant du souffle est précalculé PAR PALIER, donc la borne élargie ne perd plus 12,6 °C
 * partout mais 8,09 au palier 0 et 9,75 en altitude (exact — c'est le pire souffle vrai de chaque
 * palier). Les chiffres que cet instrument rendait le matin se lisent donc comme l'état d'AVANT ce
 * champ ; l'A/B qui attribue le gain du champ lui-même est dans `profil-gel-structures.mts`
 * (`ASHES_SANS_SOUFFLEMAX=1`).
 */
const REGIMES = [
  { nom: 'cendre NEUVE (cendreAge vide — borne serrée)', ages: [] as number[] },
  { nom: 'cendre VIEILLIE (120 j — borne élargie)', ages: foyersDeLaCarte(sim.map).map(() => 120) },
]

const seuilDe = (t: number): number | undefined =>
  t === TERRAIN_SHALLOW_WATER ? GEL.SEUIL_GUE : t === TERRAIN_DEEP_WATER ? GEL.SEUIL_PROFOND : undefined
/** La RÉPLIQUE de HEAD — l'ordre d'avant, et la porte de la vallée entière. */
function estGeleHEAD(tx: number, ty: number): boolean {
  if (!gelPossible(sim)) return false
  const seuil = seuilDe(terrainAt(sim.map, tx, ty))
  if (seuil === undefined) return false
  const t = baselineTemperature(sim, tx, ty)
  if (t < seuil) return true
  if (t >= seuil + GEL.HYSTERESIS) return false
  return baselineTemperatureAt(sim, tx, ty, Math.max(0, sim.tick - GEL.RETARD_TICKS)) < seuil
}

const eau: [number, number][] = []
for (let ty = 0; ty < m.map.height; ty++) for (let tx = 0; tx < m.map.width; tx++) {
  const t = terrainAt(m.map, tx, ty)
  if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) eau.push([tx, ty])
}
const JOURS = [[15, 'mi-Éclosion'], [45, 'mi-Ardeur'], [75, 'cœur des Pluies'], [105, 'cœur du Grand Froid']] as const
const TICKS: Record<number, number> = { 15: 24201126, 45: 76044135, 75: 127881126, 105: 179718182 }

for (const regime of REGIMES) {
 sim.cendreAge = regime.ages
 console.log(`\n╔══ ${regime.nom} ══`)
 for (const p of [0, 3]) {
  const ech = eau.filter(([x, y]) => palierDuSol(m.map, x, y) === p).slice(0, 3000)
  console.log(`\n═══ PALIER ${p} · ${ech.length} tuiles d'eau ═══`)
  for (const [jour, nom] of JOURS) {
    sim.tick = TICKS[jour]!
    // ⚠ LA RÉFÉRENCE DOIT VRAIMENT LIRE L'AIR : si un jour la porte globale se remettait à
    //   couper, le témoin court-circuiterait aussi et l'A/B sous-estimerait le gain en silence.
    if (!gelPossible(sim)) throw new Error(`${nom} p${p} : la porte GLOBALE coupe — le témoin ne lit plus l'air, l'A/B ne vaut rien`)
    const neuf = (): number => { let n = 0; for (const [x, y] of ech) if (estGele(sim, x, y)) n++; return n }
    const head = (): number => { let n = 0; for (const [x, y] of ech) if (estGeleHEAD(x, y)) n++; return n }
    if (neuf() !== head()) throw new Error(`${nom} p${p} : les deux ne comptent pas pareil`)
    for (let k = 0; k < 80; k++) { neuf(); head() }
    const A: number[] = [], B: number[] = []
    for (let r = 0; r < 41; r++) {
      let c = process.cpuUsage(); head(); let d = process.cpuUsage(c); B.push((d.user + d.system) / 1000)
      c = process.cpuUsage(); neuf(); d = process.cpuUsage(c); A.push((d.user + d.system) / 1000)
    }
    A.sort((a, b) => a - b); B.sort((a, b) => a - b)
    const g = B[20]! / A[20]!
    console.log(`  ${nom.padEnd(20)} HEAD ${B[0]!.toFixed(2)}/${B[20]!.toFixed(2)} ms  →  AUJOURD'HUI ${A[0]!.toFixed(2)}/${A[20]!.toFixed(2)} ms  (×${g.toFixed(2)} sur la médiane) · ${neuf()}/${ech.length} prises`)
  }
 }
}
