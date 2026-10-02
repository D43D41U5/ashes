/**
 * ═══ CE QUE COÛTE LA PORTE DE GEL MORTE — l'instrument de l'étape 2 de `braise.md` § 3 ═══
 *
 * Depuis `FROID_PAR_ETAGE` (2026-09-30), `gelPossible` rend VRAI partout et toute l'année
 * (0/240 points, contre 120/240 avant) : le raccourci « rien ne gèle nulle part » ne coupe plus
 * jamais. Cet instrument chiffre ce que ça coûte, et il existe parce que `profil-tick` NE LE VOIT
 * PAS (trois relevés ont rendu l'A/B à l'envers, sous son plancher de bruit).
 *
 * ⚠ LE COÛT N'EST PAS DANS LE TICK, ET C'EST MESURÉ : les deux appelants qui martèlent `estGele`
 * sont les CHAMPS DE FLUX (`blockedAt`, sur l'eau profonde) et la CUISSON DES CHUNKS DU CLIENT
 * (`gel-layer.ts`, sur toute tuile d'eau). Or `empreinte-sim` relève **0 horde sur les 12 régimes**
 * du monde joué : les champs de flux ne tournent quasiment pas. **Reste le client**, et c'est lui
 * qu'on mesure ici.
 *
 * ═══ L'A/B, ET POURQUOI IL EST HONNÊTE ═══
 *
 * Côté client la porte est lue UNE FOIS PAR IMAGE puis court-circuite : `glacePossible && estGele(…)`.
 * Donc les deux régimes sont exactement :
 *   · porte VIVANTE (= HEAD)      → `glacePossible` faux → **zéro appel** à `estGele`
 *   · porte MORTE (= aujourd'hui) → `glacePossible` vrai → **un `estGele` par tuile d'eau**
 *
 * ⚠ **DEPUIS L'ÉTAPE 2 (2026-10-02), LA COLONNE « porte MORTE » NE MESURE PLUS LA PORTE MORTE** :
 * `estGele` porte désormais ses deux bornes PAR PALIER, donc cette colonne chronomètre le coût
 * d'AUJOURD'HUI, pas celui qu'on voulait supprimer. Ce que cet instrument garde de valable est le
 * COMPTAGE (combien de tuiles chaque borne récupère, et où) ; pour le gain en temps, c'est
 * `tools/profil-gel-bornes.mts` — qui alterne les deux régimes dans un seul processus, parce que
 * deux lots séparés ont menti de ×3,4 sur un callee froid (son en-tête le raconte).
 * On n'a donc RIEN à modifier dans `/sim` pour obtenir les deux côtés : il suffit de ne pas
 * appeler. L'A/B est ALTERNÉ dans la même passe et mesuré en **temps CPU** (`process.cpuUsage`),
 * parce qu'une autre session fait souvent tourner vitest à 100 % d'un cœur et que le temps mur
 * varie alors de 60 % d'une mesure à l'autre.
 *
 * ⚠ **TÉMOIN INERTE** : un troisième régime appelle `estGele` sur les tuiles NON aquatiques, où il
 * rend faux dès `seuilDe` (aucun `baselineTemperature`). Son écart avec la porte vivante EST le
 * plancher de bruit : si l'écart mesuré de la porte morte n'est pas franchement au-dessus, la
 * mesure ne dit rien.
 *
 * ⚠ **LES COMPTES SONT VENTILÉS PAR PALIER**, et c'est l'entrée dont l'étape 2 a besoin : une
 * garde locale À UN SEUL CÔTÉ (« ici rien ne gèle ») ne peut récupérer que l'eau du palier 0 ;
 * l'eau des paliers ≥ 1 est LÉGITIMEMENT gelée toute l'année (décision du 2026-10-01, les lacs
 * d'altitude sont des ponts) et ne se récupère qu'avec l'autre borne (« ici tout gèle », qui
 * rendrait vrai sans lire la température).
 *
 * ⚠ **À LANCER BUNDLÉ** — `tsx` invente ~25 % de temps dans les getters d'interop CJS, or
 * `baselineTemperatureAt` lit des constantes inter-modules en boucle :
 *   node_modules/.pnpm/node_modules/.bin/esbuild --bundle tools/profil-porte-gel.mts \
 *     --format=esm --platform=node --outfile=/tmp/porte.mjs && node /tmp/porte.mjs
 */
import {
  FAUNA, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER, TEMPERATURE,
  createSim, spawnEntity, emplacementsDeVillage, pointsDeSpawn, placeZoneNodes, placeHuntingGrounds,
  nidsAMonstre, spawnPoiMonsters, creuserLePlancher, generateZonedTerrain, MONDE, MONDE_JOUE,
  GEL, estGele, gelPossible, palierDuSol, terrainAt,
  TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, dayTicksPourJour, jourDeSaison, tourForDay,
  type SimState,
} from '../packages/sim/src/index'
import { TERRASSES } from '../packages/sim/src/terrasses'
import { partDeNuit } from '../packages/sim/src/time'
import { socleDuJour } from '../packages/sim/src/temperature'

// ═══ LA GÉOMÉTRIE DU CLIENT, reprise de `gel-layer.ts` / `paves.ts` / `framing.ts` ═══
const TILE_PX = 16
const CHUNK = 16            // PAVE.CHUNK
const L = CHUNK + 2         // 18 × 18 états cuits par chunk (marge d'une tuile)
const COURONNE = 1
const ECRAN = { w: 1920, h: 1080 }
const PAS_TICKS = 400       // un chunk relit le monde tous les 400 ticks

const SEED = Number(process.argv[2] ?? 2026)
const REPETS = Number(process.argv[3] ?? 7)

// ═══ LE MONDE JOUÉ ═══
const carte = generateZonedTerrain(SEED, 8, MONDE_JOUE)
const nodes = placeZoneNodes(carte)
const grounds = placeHuntingGrounds(carte.map, SEED)
const emplacements = emplacementsDeVillage(carte, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(carte.map) })
const spawns = pointsDeSpawn(carte, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE))
creuserLePlancher(carte, nodes, [...spawns, ...emplacements])
const ou = spawns[0] ?? emplacements[0]!
const sim: SimState = createSim(SEED, {
  map: carte.map, nodes, grounds, faunaCap: FAUNA.CAP,
  home: { x: ou.tx + 0.5, y: ou.ty + 0.5 }, calendarScale: 1,
})
spawnPoiMonsters(sim, SEED)
spawnEntity(sim, ou.tx + 0.5, ou.ty + 0.5)
const { map } = sim

// ═══ LES TUILES QUE LE CLIENT CUIT POUR UN ÉCRAN, autour d'un centre ═══
const chunksX = Math.ceil(ECRAN.w / (CHUNK * TILE_PX)) + 1 + 2 * COURONNE
const chunksY = Math.ceil(ECRAN.h / (CHUNK * TILE_PX)) + 1 + 2 * COURONNE

interface Region { nom: string; eau: number[]; sec: number[]; parPalier: Map<number, number> }
function regionAutour(nom: string, ctx: number, cty: number): Region {
  const cx0 = Math.max(0, Math.floor(ctx / CHUNK) - Math.floor(chunksX / 2))
  const cy0 = Math.max(0, Math.floor(cty / CHUNK) - Math.floor(chunksY / 2))
  const eau: number[] = [], sec: number[] = []
  const parPalier = new Map<number, number>()
  for (let cy = cy0; cy < cy0 + chunksY; cy++) for (let cx = cx0; cx < cx0 + chunksX; cx++) {
    const tx0 = cx * CHUNK - 1, ty0 = cy * CHUNK - 1   // la marge d'une tuile de `gel-layer`
    for (let ly = 0; ly < L; ly++) for (let lx = 0; lx < L; lx++) {
      const tx = tx0 + lx, ty = ty0 + ly
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
      const t = terrainAt(map, tx, ty)
      const i = ty * map.width + tx
      if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) {
        eau.push(i)
        const pp = palierDuSol(map, tx, ty)
        parPalier.set(pp, (parPalier.get(pp) ?? 0) + 1)
      } else sec.push(i)
    }
  }
  return { nom, eau, sec, parPalier }
}

/** Le barycentre de l'eau du palier le plus HAUT qui en porte : l'écran d'altitude. */
function centreEauHaute(): { tx: number; ty: number; palier: number } | undefined {
  let best: { tx: number; ty: number; palier: number } | undefined
  let sx = 0, sy = 0, n = 0, pMax = -1
  for (let ty = 0; ty < map.height; ty++) for (let tx = 0; tx < map.width; tx++) {
    const t = terrainAt(map, tx, ty)
    if (t !== TERRAIN_SHALLOW_WATER && t !== TERRAIN_DEEP_WATER) continue
    const pp = palierDuSol(map, tx, ty)
    if (pp > pMax) { pMax = pp; sx = 0; sy = 0; n = 0 }
    if (pp === pMax) { sx += tx; sy += ty; n++ }
  }
  if (n > 0) best = { tx: Math.round(sx / n), ty: Math.round(sy / n), palier: pMax }
  return best
}

// ═══ LES TICKS : le jour est CHERCHÉ sur le calendrier de la sim, jamais calculé à la main ═══
//   (une première version posait `tick = (j−1) × TICKS_PER_CYCLE` : les quatre cardinaux rendaient
//    tous le même plancher à 0,7 °C près — le jour ne variait pas. Le calendrier a un décalage.)
function tickPourJour(cible: number): number {
  // ⚠ UN JOUR DE SAISON VAUT `TICKS_PER_SEASON_DAY` (1 728 000 ticks), PAS UN CYCLE JOUR/NUIT.
  //   Une première version balayait des cycles : elle ne trouvait jamais le jour 105 et rendait
  //   le même plancher aux quatre cardinaux. On part du jour, puis on s'aligne sur le DÉBUT DU
  //   CYCLE qui le contient et on avance jusqu'à MIDI — vérifié par `partDeNuit` = 0.
  const t0 = (cible - 1) * TICKS_PER_SEASON_DAY
  const cs = t0 - (((t0 + sim.cycleOffset) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  const t = cs + Math.floor(dayTicksPourJour(cible) / 2)
  const j = jourDeSaison(sim, t)
  if (j !== cible) throw new Error(`jour ${cible} : le tick ${t} tombe au jour ${j}`)
  return t
}

const TERME = TEMPERATURE.FROID_PAR_ETAGE * (TERRASSES.PALIERS - 1)
const plancherSansEtage = (tick: number): number => {
  const jour = jourDeSaison(sim, tick)
  const cycleTick = (tick + sim.cycleOffset) % TICKS_PER_CYCLE
  return socleDuJour(jour, tourForDay(jour)) - TEMPERATURE.ECART_NUIT(jour) * partDeNuit(cycleTick, dayTicksPourJour(jour))
}
const DATES = [['mi-Éclosion', 15], ['mi-Ardeur', 45], ['cœur des Pluies', 75], ['cœur du Grand Froid', 105]] as const

const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]!

const haut = centreEauHaute()
const REGIONS = [regionAutour('AU FOND DE LA VALLÉE (la naissance)', ou.tx, ou.ty)]
if (haut && haut.palier > 0) REGIONS.push(regionAutour(`EN ALTITUDE (barycentre de l'eau du palier ${haut.palier})`, haut.tx, haut.ty))

console.log(`graine ${SEED} · carte ${map.width}×${map.height} · naissance ${ou.tx},${ou.ty} · ${sim.structures.length} structures`)
console.log(`écran ${ECRAN.w}×${ECRAN.h} → ${chunksX}×${chunksY} = ${chunksX * chunksY} chunks (couronne comprise), ${L}×${L} états chacun`)
if (haut) console.log(`eau la plus haute : palier ${haut.palier}, barycentre ${haut.tx},${haut.ty}`)

// ═══ LA CHAUFFE, UNE FOIS POUR TOUT LE RUN ═══
//   ⚠ Sans elle le PREMIER bloc mesuré portait le JIT : 78 ms là où le régime établi vaut 7,4.
sim.tick = tickPourJour(45)
for (const r of REGIONS) for (let k = 0; k < 120; k++) { for (const i of r.eau) estGele(sim, i % map.width, Math.floor(i / map.width)) }

for (const r of REGIONS) {
  const p0 = r.parPalier.get(0) ?? 0
  console.log(`\n╔══ ${r.nom} ══`)
  console.log(`║ tuiles cuites ${(r.eau.length + r.sec.length).toLocaleString('fr')} · dont EAU ${r.eau.length.toLocaleString('fr')} (un estGele chacune)`)
  console.log(`║ eau par palier : ` + [...r.parPalier.entries()].sort((a, b) => a[0] - b[0]).map(([pp, n]) => `p${pp} ${n}`).join(' · '))
  console.log(`║ → récupérable par une garde À UN SEUL CÔTÉ (« ici rien ne gèle ») : ${p0} tuiles (${((100 * p0) / Math.max(1, r.eau.length)).toFixed(0)} %)`)
  console.log(`║ → le reste (${r.eau.length - p0}) exige l'AUTRE borne (« ici tout gèle », qui rendrait vrai sans lire la température)`)
  const morte = (): number => { let n = 0; for (const i of r.eau) if (estGele(sim, i % map.width, Math.floor(i / map.width))) n++; return n }
  const inerte = (): number => { let n = 0; for (let k = 0; k < r.eau.length; k++) { const i = r.sec[k % r.sec.length]!; if (estGele(sim, i % map.width, Math.floor(i / map.width))) n++ } return n }
  for (const [nom, jour] of DATES) {

    const tick = tickPourJour(jour)
    sim.tick = tick
    const seuil = GEL.SEUIL_GUE + GEL.HYSTERESIS
    const avant = plancherSansEtage(tick)
    const gelees = morte()
    const mortes: number[] = [], inertes: number[] = [], vides: number[] = []
    morte(); inerte()
    for (let k = 0; k < REPETS; k++) {   // A/B ALTERNÉ dans la même passe, en temps CPU
      let t = cpu(); /* porte VIVANTE = zéro appel */ vides.push(cpu() - t)
      t = cpu(); morte(); mortes.push(cpu() - t)
      t = cpu(); inerte(); inertes.push(cpu() - t)
    }
    // ⚠ ON RAPPORTE LE MIN AUTANT QUE LA MÉDIANE : sur un microbanc, le min est la passe la
    //   MOINS contaminée (GC, autre session), la médiane dit ce qu'on vit en moyenne.
    const mM = Math.min(...mortes), mI = Math.min(...inertes), mV = Math.min(...vides)
    const ecart = mM - mV, bruit = Math.max(0.01, mI - mV)
    console.log(`║`)
    console.log(`║ ── ${nom}, midi (jour ${jourDeSaison(sim)}, tick ${tick}) ──`)
    console.log(`║    HEAD : plancher ${avant.toFixed(1)} °C vs seuil ${seuil} → la porte ${avant < seuil ? 'NE COUPAIT PAS' : 'COUPAIT'}`)
    console.log(`║    aujourd'hui : gelPossible=${gelPossible(sim)} (plancher ${(avant - TERME).toFixed(1)} °C) · ${gelees}/${r.eau.length} tuiles d'eau PRISES · partDeNuit ${partDeNuit((tick + sim.cycleOffset) % TICKS_PER_CYCLE, dayTicksPourJour(jour)).toFixed(2)} (0 = plein midi)`)
    console.log(`║    porte MORTE ${mM.toFixed(2)} ms CPU au mieux (médiane ${med(mortes).toFixed(2)}, max ${Math.max(...mortes).toFixed(2)}) · porte VIVANTE ${mV.toFixed(2)} · TÉMOIN INERTE ${mI.toFixed(2)}`)
    console.log(`║    ÉCART ${ecart.toFixed(2)} ms au mieux / ${(med(mortes) - mV).toFixed(2)} ms en médiane  (bruit du témoin ${bruit.toFixed(2)} ms) ${ecart > 4 * bruit ? '✓ au-dessus du bruit' : '✗ DANS LE BRUIT — ne rien conclure'}`)
    console.log(`║    budget : ${((100 * ecart) / 8.3).toFixed(0)} % d'une image à 120 fps pour UN écran recuit d'un coup · régime ${((ecart * 1000) / (PAS_TICKS * 50)).toFixed(3)} ms/s`)
  }
  console.log('╚══')
}
