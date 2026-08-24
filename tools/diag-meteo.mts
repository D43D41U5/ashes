/**
 * ═══ LA MÉTÉO AU BANC — ce que les fronts font vraiment au monde ═══
 *
 * Le critère A8 de `docs/specs/meteo.md` exige « zéro mort PNJ par froid de front ou par
 * foudre ». Un zéro ne prouve rien tout seul : le banc n'a pas de joueur, et une garde
 * satisfaite À VIDE mesure l'instrument, pas le jeu (leçon maison, cf. la sonde de la Brume
 * qui rendait 0 mort avec 0 échantillon sous la nappe). Cette sonde compte donc les morts ET
 * l'EXPOSITION : combien de fois un PNJ s'est trouvé sous un front, sous un orage, sous un
 * blizzard. Elle sépare aussi le froid DU FRONT du froid DU MONDE (l'acte III mord tout seul
 * — c'est le fond du jeu, pas le chantier).
 *
 * Elle mesure en plus ce que l'interrupteur dédié `meteoActive` a été fait pour mesurer : la
 * PRESSION ÉCONOMIQUE, en rejouant le même monde avec et sans météo (combustible des villages,
 * faim, morts) — et la TEXTURE de saison, jour par jour, pour le calibrage à l'œil.
 *
 * Usage : node --import tsx tools/diag-meteo.mts [seeds=1,7,2026] [cycles=6]
 *         COMPARE=1 node --import tsx tools/diag-meteo.mts 2026 6   (+ le jumeau sans météo)
 *
 * LE MONDE DU BANC EST LOURD (son propre en-tête le dit : « 2 jours de banc dépassent » les
 * délais d'une suite). Une graine par processus, en tâche de fond, et la comparaison
 * économique — qui DOUBLE le temps — seulement sur la graine qu'on désigne par `COMPARE=1`.
 */
import { BALANCE, METEO } from '../packages/sim/src/balance'
import { drainEvents } from '../packages/sim/src/events'
import { meteoIntensity, meteoTypeDuCycle, type MeteoType } from '../packages/sim/src/meteo'
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { step } from '../packages/sim/src/sim'
import { jourDeSaison, phaseForDay, TICKS_PER_CYCLE } from '../packages/sim/src/time'

const SEEDS = (process.argv[2] ?? '1,7,2026').split(',').map(Number)
const CYCLES = Number(process.argv[3] ?? 6)
if (SEEDS.some((s) => !Number.isFinite(s)) || !Number.isFinite(CYCLES)) {
  console.error('usage : node --import tsx tools/diag-meteo.mts [seeds=1,7,2026] [cycles=6]')
  process.exit(1)
}

/** L'échantillonnage de l'exposition : un relevé tous les 20 ticks (1 s de jeu). */
const PAS_ECHANTILLON = 20

interface Releve {
  seed: number
  /** Fronts élus, par type. */
  fronts: Record<string, number>
  /** La texture : le type de chaque jour joué (ou null). */
  texture: (MeteoType | null)[]
  /** Événements du blizzard vus dans le flux. */
  annonces: number
  entrees: number
  passages: number
  /** L'EXPOSITION — le dénominateur sans lequel un zéro ne veut rien dire. */
  echPnj: number
  echSousFront: number
  echSousOrage: number
  echSousBlizzard: number
  /** Les morts. */
  mortsPnj: number
  mortsFroidSousFront: number
  mortsFroidHorsFront: number
  mortsFoudre: number
  /** Les détails de chaque mort incriminée par A8. */
  incriminees: string[]
  /** L'économie, en fin de course. */
  fuelBrule: number
  faimMoyenne: number
}

function jouer(seed: number, cycles: number, meteo: boolean): Releve {
  const { sim } = construireMondeDuBanc(seed)
  if (meteo) sim.meteoActive = true

  const r: Releve = {
    seed,
    fronts: {},
    texture: [],
    annonces: 0,
    entrees: 0,
    passages: 0,
    echPnj: 0,
    echSousFront: 0,
    echSousOrage: 0,
    echSousBlizzard: 0,
    mortsPnj: 0,
    mortsFroidSousFront: 0,
    mortsFroidHorsFront: 0,
    mortsFoudre: 0,
    incriminees: [],
    fuelBrule: 0,
  faimMoyenne: 0,
  }

  // Le combustible de départ, pour mesurer ce qui a BRÛLÉ (le drain, pas le solde).
  const fuelDepart = sim.villages.reduce((t, v) => t + v.fuel, 0)
  let fuelDonne = 0

  /** L'ombre du tick précédent : la victime est déjà retirée quand l'événement se lit.
   *  Relevée par INDEX (une passe sur les entités), pas par `find` par PNJ — le quadratique
   *  coûtait des heures sur une saison. */
  let ombres = new Map<number, { x: number; y: number }>()
  const releverOmbres = (): void => {
    const parId = new Map<number, { x: number; y: number; hp: number }>()
    for (const e of sim.entities) parId.set(e.id, e)
    ombres = new Map()
    for (const n of sim.npcs) {
      const e = parId.get(n.entityId)
      if (e && e.hp > 0) ombres.set(n.entityId, { x: e.x, y: e.y })
    }
  }
  releverOmbres()

  let dernierJourVu = 0
  const total = cycles * TICKS_PER_CYCLE
  for (let t = 0; t < total; t++) {
    const fuelAvant = sim.villages.reduce((s, v) => s + v.fuel, 0)
    step(sim, [])
    const fuelApres = sim.villages.reduce((s, v) => s + v.fuel, 0)
    // Une hausse = quelqu'un a rapporté du bois ; on ne compte QUE la baisse (le drain).
    if (fuelApres < fuelAvant) r.fuelBrule += fuelAvant - fuelApres
    else fuelDonne += fuelApres - fuelAvant

    const jour = jourDeSaison(sim)
    // La texture se relève par CYCLE — c'est la cadence d'élection (un tirage par cycle).
    const cycle = Math.floor(sim.tick / TICKS_PER_CYCLE)
    if (cycle !== dernierJourVu) {
      dernierJourVu = cycle
      const type = meteo ? meteoTypeDuCycle(cycle, sim.calendarScale, sim.jourDeDepart) : null
      r.texture.push(type)
      if (type) r.fronts[type] = (r.fronts[type] ?? 0) + 1
    }

    for (const e of drainEvents(sim)) {
      if (e.type === 'blizzard_annonce') r.annonces++
      else if (e.type === 'blizzard_entre') r.entrees++
      else if (e.type === 'blizzard_passe') r.passages++
      else if (e.type === 'entity_died' && !e.wasMonster) {
        r.mortsPnj++
        const o = ombres.get(e.entityId)
        const sousFront = o ? meteoIntensity(sim, o.x, o.y) > 0 : false
        const ou = o ? `(${Math.round(o.x)}, ${Math.round(o.y)})` : '(position perdue)'
        if (e.cause === 'lightning') {
          r.mortsFoudre++
          r.incriminees.push(`FOUDRE · j${jour} · tick ${sim.tick} · ${ou}`)
        } else if (e.cause === 'cold') {
          if (sousFront) {
            r.mortsFroidSousFront++
            const type = sim.meteo?.type ?? '?'
            r.incriminees.push(`FROID SOUS FRONT (${type}) · j${jour} · tick ${sim.tick} · ${ou}`)
          } else r.mortsFroidHorsFront++
        }
      }
    }
    releverOmbres()

    // L'EXPOSITION — le dénominateur de A8.
    if (t % PAS_ECHANTILLON === 0) {
      const type = sim.meteo?.type
      for (const [, o] of ombres) {
        r.echPnj++
        if (meteoIntensity(sim, o.x, o.y) > 0) {
          r.echSousFront++
          if (type === 'orage') r.echSousOrage++
          // Le blizzard n'est plus une CLASSE (R11) : c'est l'aspect d'un orage là où il neige.
          // La sonde compte donc les orages du Grand Froid, la saison où l'aspect bascule.
          if (type === 'orage' && phaseForDay(jour) === 4) r.echSousBlizzard++
        }
      }
    }
  }

  const vivants = sim.npcs
    .map((n) => sim.entities.find((x) => x.id === n.entityId))
    .filter((e): e is NonNullable<typeof e> => !!e && e.hp > 0)
  r.faimMoyenne = vivants.length ? vivants.reduce((s, e) => s + e.hunger, 0) / vivants.length : 0
  // Le bois RAPPORTÉ pendant la course ne fausse pas le drain : on l'a compté à part.
  void fuelDepart
  void fuelDonne
  return r
}

function pourcent(a: number, b: number): string {
  if (b === 0) return a === 0 ? '=' : '+∞'
  const d = ((a - b) / b) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)} %`
}

console.log(`═══ LA MÉTÉO AU BANC — ${SEEDS.length} graine(s) × ${CYCLES} cycles ═══\n`)
console.log(`calibrage courant : COLD ${JSON.stringify(METEO.COLD)}`)
console.log(`                    PAR_SAISON ${JSON.stringify(METEO.PAR_SAISON.paliers.map((p) => p.episode))}\n`)

const tous: Releve[] = []
for (const seed of SEEDS) {
  console.log(`── seed ${seed} ──`)
  const avec = jouer(seed, CYCLES, true)
  const sans = process.env.COMPARE === '1' ? jouer(seed, CYCLES, false) : null
  tous.push(avec)

  const t = avec.texture.map((x, i) => `c${i}:${x ?? '—'}`).join('  ')
  console.log(`  texture   : ${t}`)
  console.log(`  fronts    : ${JSON.stringify(avec.fronts)}`)
  console.log(`  blizzard  : ${avec.annonces} annonce(s), ${avec.entrees} entrée(s), ${avec.passages} passage(s)`)
  console.log(
    `  exposition: ${avec.echSousFront}/${avec.echPnj} échantillons PNJ sous front ` +
      `(${((avec.echSousFront / Math.max(1, avec.echPnj)) * 100).toFixed(1)} %) · ` +
      `orage ${avec.echSousOrage} · blizzard ${avec.echSousBlizzard}`,
  )
  console.log(
    `  morts PNJ : ${avec.mortsPnj} au total · froid SOUS front ${avec.mortsFroidSousFront} ` +
      `· froid hors front ${avec.mortsFroidHorsFront} · foudre ${avec.mortsFoudre}`,
  )
  for (const d of avec.incriminees) console.log(`      ↳ ${d}`)
  if (sans) {
    console.log(
      `  économie  : bois brûlé ${avec.fuelBrule} vs ${sans.fuelBrule} sans météo (${pourcent(avec.fuelBrule, sans.fuelBrule)}) · ` +
        `faim moyenne ${avec.faimMoyenne.toFixed(1)} vs ${sans.faimMoyenne.toFixed(1)} · ` +
        `morts ${avec.mortsPnj} vs ${sans.mortsPnj}`,
    )
  } else {
    console.log(`  économie  : bois brûlé ${avec.fuelBrule} · faim moyenne ${avec.faimMoyenne.toFixed(1)} (COMPARE=1 pour le jumeau sans météo)`)
  }
  console.log('')
}

const somme = (f: (r: Releve) => number): number => tous.reduce((s, r) => s + f(r), 0)
const mortsA8 = somme((r) => r.mortsFroidSousFront) + somme((r) => r.mortsFoudre)
const expo = somme((r) => r.echSousFront)
console.log('═══ VERDICT A8 ═══')
console.log(`  morts par froid de front : ${somme((r) => r.mortsFroidSousFront)}`)
console.log(`  morts par foudre         : ${somme((r) => r.mortsFoudre)}`)
console.log(`  exposition totale        : ${expo} échantillons PNJ sous un front`)
if (expo === 0) {
  console.log(`  → INDÉTERMINÉ : aucun PNJ ne s'est trouvé sous un front. Le zéro mesure l'instrument.`)
} else if (mortsA8 === 0) {
  console.log(`  → A8 TENU : zéro mort imputable à la météo, sur une exposition RÉELLE.`)
} else {
  console.log(`  → A8 VIOLÉ : ${mortsA8} mort(s) imputable(s) à la météo (détails ci-dessus).`)
}
console.log(`\n  (rappel : le froid HORS front — ${somme((r) => r.mortsFroidHorsFront)} mort(s) — est le fond du jeu, hors critère.)`)
console.log(`  (saison de ${BALANCE.SEASON_DAYS} jours ; les fronts sont fonction du JOUR, identiques d'une graine à l'autre.)`)
