/**
 * RECENSEMENT DES CENDREUX — « combien y en a-t-il sur la carte, et d'où viennent-ils ? »
 *
 * La question se pose à la FIN DE SAISON, et elle a cinq robinets qui n'ont ni la même
 * cadence ni la même borne (`cendreux.md` R8, `plafond-compte-ce-qu-il-borne`) :
 *
 *   repaire  — un résident par lieu `repaire` (`populateDen` en pose UN), borné par le SEMIS
 *   convoi   — 2 gardes par carcasse, `expiresAt` = +2 CYCLES RÉELS
 *   horde    — `HORDE_SIZE[acte]` au crépuscule, dissipée à l'aube (donc nuit seulement)
 *   nuit     — les rôdeurs de `advanceNightHunt`, AUTOUR D'UN AVATAR, `ambient`
 *   levée    — les morts qui se relèvent, seuls et loin du feu, bornés par `MAX_ALIVE`
 *
 * ═══ LE CALENDRIER EST LA MOITIÉ DE LA RÉPONSE ═══
 *
 * `runScenario` joue à `calendarScale = 30` (un jour de saison par cycle) : ce n'est PAS le
 * calendrier du jeu, qui tient la saison en six cycles (`calendarScaleForSeasonCycles(6)` =
 * 300). Or la cadence des convois est en JOURS DE SAISON et la péremption de leurs gardes en
 * CYCLES RÉELS : les deux horloges sont découplées par `calendarScale`, et le terme « convoi »
 * change d'un facteur dix selon l'instrument qu'on pointe. On joue donc le calendrier RÉEL.
 *
 * Il vit dans `tools/` et non dans `/sim` : le lint y interdit `performance`.
 *
 *   node --import tsx tools/recensement-cendreux.mts [joueurs] [seeds] [--avatar] [--carte]
 *
 *   joueurs  taille du monde (6 = celle du banc ; 50 = la carte solo de production)
 *   seeds    liste séparée par des virgules (défaut 2026)
 *   --avatar plante un avatar IMMOBILE et INCASSABLE loin des feux : sans lui, le terme
 *            « nuit » vaut 0 par construction (`preys()` ne retient que les avatars) —
 *            voir la mémoire `banc-sans-avatar-ne-mesure-pas-le-joueur`.
 *   --carte  ne simule rien : compte les lieux du monde (le terme « repaire » se lit là,
 *            et lui seul dépend de la TAILLE de la carte).
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { spawnEntity, step, type SimState } from '../packages/sim/src/sim'
import { calendarScaleForSeasonCycles, getGameTime, seasonDayAtTick, TICKS_PER_CYCLE } from '../packages/sim/src/time'
import { generateZonedTerrain } from '../packages/sim/src/zonegen'
import { MONDE_JOUE } from '../packages/sim/src/zonegraph'
import { walkableSpawn } from '../packages/sim/src/connectivity'
import { BALANCE } from '../packages/sim/src/balance'

const joueurs = Number(process.argv[2] ?? 6)
const seeds = String(process.argv[3] ?? '2026').split(',').map(Number)
const avecAvatar = process.argv.includes('--avatar')
const carteSeule = process.argv.includes('--carte')

/** Les six cycles de la Veillée : la saison RÉELLE, pas celle du banc. */
const CYCLES = 6
const ECHELLE = calendarScaleForSeasonCycles(CYCLES)
/** `--cycles=N` n'existe que pour ÉTALONNER l'instrument (coût, classification) sur un préfixe :
 *  la saison, elle, en fait six, et un rapport tiré d'un préfixe ne serait pas une fin de saison. */
const cyclesJoues = Number(process.argv.find((a) => a.startsWith('--cycles='))?.slice(9) ?? CYCLES)
const TOTAL = Math.round(cyclesJoues * TICKS_PER_CYCLE)
/** Un relevé toutes les 3 secondes de jeu : ~5 800 échantillons sur la saison. */
const PAS = 60
/** La fenêtre « fin de saison » : les dix derniers jours (l'acte III est bien installé). */
const FIN_DEPUIS = BALANCE.SEASON_DAYS - 9

type Source = 'repaire' | 'convoi' | 'horde' | 'nuit' | 'levée' | 'autre'
const SOURCES: Source[] = ['repaire', 'convoi', 'horde', 'nuit', 'levée', 'autre']

/** Un échantillon : combien de Cendreux VIVANTS, par source, et sous quel ciel. */
interface Releve {
  jour: number
  nuit: boolean
  parSource: Record<Source, number>
  total: number
}

function recenser(sim: SimState): Releve {
  const enHorde = new Set<number>()
  for (const h of sim.hordes) for (const id of h.memberEntityIds) enHorde.add(id)
  const vivants = new Map<number, boolean>()
  for (const e of sim.entities) vivants.set(e.id, e.hp > 0)

  const parSource = { repaire: 0, convoi: 0, horde: 0, nuit: 0, 'levée': 0, autre: 0 } as Record<Source, number>
  let total = 0
  for (const m of sim.monsters) {
    if (m.type !== 'cendreux') continue
    if (vivants.get(m.entityId) !== true) continue // mort ou déjà retiré : il ne marche plus
    // L'ORDRE EST CELUI DE LA NAISSANCE, et les marques sont disjointes par construction :
    // `risen` (levée), `homePoi` (lieu), l'appartenance à une horde, `expiresAt` (convoi),
    // `ambient` (rôdeur). `autre` doit rester à zéro — s'il monte, un canal m'a échappé.
    let source: Source
    if (m.risen === true) source = 'levée'
    else if (m.homePoi !== undefined) source = 'repaire'
    else if (enHorde.has(m.entityId)) source = 'horde'
    else if (m.expiresAt !== undefined) source = 'convoi'
    else if (m.ambient === true) source = 'nuit'
    else source = 'autre'
    parSource[source] += 1
    total += 1
  }
  return {
    jour: seasonDayAtTick(sim.tick, sim.calendarScale),
    nuit: getGameTime(sim).isNight,
    parSource,
    total,
  }
}

/** Moyenne d'un champ sur un sous-ensemble d'échantillons (0 si l'échantillon est vide). */
function moyenne(rs: Releve[], f: (r: Releve) => number): number {
  if (rs.length === 0) return 0
  let s = 0
  for (const r of rs) s += f(r)
  return s / rs.length
}

function compterLieux(seed: number): Record<string, number> {
  const carte = generateZonedTerrain(seed, joueurs, MONDE_JOUE)
  const compte: Record<string, number> = {}
  for (const z of carte.map.zones) compte[z.kind] = (compte[z.kind] ?? 0) + 1
  return compte
}

if (carteSeule) {
  console.log(`\n═══ Les lieux du monde — ${joueurs} joueurs cibles ═══`)
  for (const seed of seeds) {
    const t0 = performance.now()
    const compte = compterLieux(seed)
    const interessants = ['repaire', 'taniere', 'charnier']
    console.log(
      `  seed ${seed} (${((performance.now() - t0) / 1000).toFixed(0)} s) : ` +
        interessants.map((k) => `${k} ${compte[k] ?? 0}`).join(' · ') +
        ` · lieux au total ${Object.values(compte).reduce((a, b) => a + b, 0)}`,
    )
  }
} else {
  console.log(
    `\n═══ Recensement des Cendreux — ${joueurs} joueurs, calendrier RÉEL (échelle ${ECHELLE},` +
      ` ${cyclesJoues} cycles sur ${CYCLES} = ${Math.round((cyclesJoues / CYCLES) * BALANCE.SEASON_DAYS)} jours, ${TOTAL} ticks)` +
      `${avecAvatar ? ', AVEC avatar' : ', sans avatar'} ═══`,
  )

  const finales: { seed: number; jour: Record<'jour' | 'nuit', Releve[]> }[] = []

  for (const seed of seeds) {
    const t0 = performance.now()
    const { sim, monde } = construireMondeDuBanc(seed, joueurs)
    // LE CALENDRIER DU JEU, pas celui du banc — c'est tout l'objet de cet outil.
    sim.calendarScale = ECHELLE

    let avatarId = -1
    if (avecAvatar) {
      // Loin de tout feu (sinon `fireBubble > 0` et la nuit ne chasse pas) : on part du
      // centre marchable et on VÉRIFIE l'écart aux Feux — un avatar posé dans la bulle
      // mesurerait la parade, pas la menace.
      const spot = walkableSpawn(sim.map)
      avatarId = spawnEntity(sim, spot.x, spot.y)
      const ecart = Math.min(
        ...sim.villages.map((v) => Math.sqrt((v.fireTx - spot.x) ** 2 + (v.fireTy - spot.y) ** 2)),
      )
      console.log(`  avatar posé en (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)}), à ${ecart.toFixed(0)} tuiles du Feu le plus proche`)
    }

    const releves: Releve[] = []
    let hordes = 0
    let convois = 0
    let levees = 0
    for (let t = 0; t < TOTAL; t++) {
      step(sim, [])
      for (const e of drainEvents(sim)) {
        if (e.type === 'horde_spawned') hordes += 1
        if (e.type === 'convoy_spawned') convois += 1
        if (e.type === 'cendreux_risen') levees += 1
      }
      if (avatarId >= 0) {
        // IL NE MEURT PAS. Un avatar tué cesse d'être une proie (`preys()` filtre `hp > 0`) et
        // le terme « nuit » s'éteindrait à la première nuit — on mesurerait la mort du témoin,
        // pas la population. C'est donc un PLAFOND du terme « nuit » : un joueur qui ne rend
        // jamais un coup et ne fait jamais de feu.
        const a = sim.entities.find((en) => en.id === avatarId)
        if (a) a.hp = 100
      }
      if (t % PAS === 0) releves.push(recenser(sim))
    }

    const dernierJour = releves.filter((r) => r.jour >= FIN_DEPUIS)
    const parCiel = {
      jour: dernierJour.filter((r) => !r.nuit),
      nuit: dernierJour.filter((r) => r.nuit),
    }
    finales.push({ seed, jour: parCiel })

    console.log(
      `\n  ── seed ${seed} — monde ${monde.width}×${monde.height} (${((monde.width * monde.height) / 1e6).toFixed(2)} M tuiles),` +
        ` ${((performance.now() - t0) / 1000).toFixed(0)} s`,
    )
    console.log(`     événements sur la saison : ${hordes} hordes · ${convois} convois · ${levees} levées`)
    // La trajectoire, par jour de saison : c'est elle qui dit si ça s'accumule.
    const parJour = new Map<number, Releve[]>()
    for (const r of releves) {
      const l = parJour.get(r.jour) ?? []
      l.push(r)
      parJour.set(r.jour, l)
    }
    const jours = [...parJour.keys()].sort((a, b) => a - b)
    const echantillon = jours.filter((j) => j % 5 === 0 || j === 1 || j === BALANCE.SEASON_DAYS)
    for (const j of echantillon) {
      const rs = parJour.get(j)!
      const d = rs.filter((r) => !r.nuit)
      const n = rs.filter((r) => r.nuit)
      console.log(
        `     jour ${String(j).padStart(2)} : moyenne ${moyenne(rs, (r) => r.total).toFixed(1)}` +
          ` (jour ${moyenne(d, (r) => r.total).toFixed(1)} · nuit ${moyenne(n, (r) => r.total).toFixed(1)})` +
          `  [${SOURCES.filter((s) => moyenne(rs, (r) => r.parSource[s]) >= 0.05)
            .map((s) => `${s} ${moyenne(rs, (r) => r.parSource[s]).toFixed(1)}`)
            .join(' · ')}]`,
      )
    }
    for (const ciel of ['jour', 'nuit'] as const) {
      const rs = parCiel[ciel]
      console.log(
        `     FIN DE SAISON (j${FIN_DEPUIS}-${BALANCE.SEASON_DAYS}), ${ciel} : ` +
          `${moyenne(rs, (r) => r.total).toFixed(1)} Cendreux  ` +
          `[${SOURCES.map((s) => `${s} ${moyenne(rs, (r) => r.parSource[s]).toFixed(1)}`).join(' · ')}]` +
          `  pic ${Math.max(0, ...rs.map((r) => r.total))}`,
      )
    }
  }

  if (finales.length > 1) {
    console.log(`\n  ══ MOYENNE SUR ${finales.length} SEEDS — fin de saison (jours ${FIN_DEPUIS}-${BALANCE.SEASON_DAYS}) ══`)
    for (const ciel of ['jour', 'nuit'] as const) {
      const tous = finales.flatMap((f) => f.jour[ciel])
      console.log(
        `     ${ciel} : ${moyenne(tous, (r) => r.total).toFixed(1)} Cendreux  ` +
          `[${SOURCES.map((s) => `${s} ${moyenne(tous, (r) => r.parSource[s]).toFixed(1)}`).join(' · ')}]`,
      )
    }
  }
}
