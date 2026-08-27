/**
 * LE CAP DES CENDREUX — la part de pas OBLIQUES, mesurée, branche par branche.
 *
 * *« Les cendreux se déplacent quasi exclusivement en X et Y toujours. »* (Alexis, 2026-08-25,
 * après un premier correctif qui n'a porté que sur la descente de champ.)*
 *
 * On ne discute pas d'un cap : on le compte. Cet instrument joue une nuit de vraie carte
 * (`construireMondeDuBanc`, comme `diag-cendreux.mts`) avec un corps qui marche pour attirer les
 * goules, et relève À CHAQUE TICK, pour chaque Cendreux vivant :
 *
 *   • le DÉPLACEMENT réel (Δx, Δy) — la seule vérité : `moveToward` quantifie en huit secteurs,
 *     mais c'est la collision qui tranche, et un axe refusé par un mur ne se voit que là ;
 *   • la BRANCHE qui l'a produit, relevée AVANT le pas (elles sont exclusives dans `cendreuxStep`) :
 *       horde      — `hordeStep` → `descendreLeChamp` (le champ partagé du feu visé)
 *       chemin     — un waypoint d'A* (`monster.path[0]`), donc une TUILE VOISINE ORTHOGONALE
 *       proie      — droit sur la cible (`target.x/y`), le seul cap libre depuis toujours
 *       marche     — la longue marche : `descendreLeChamp` sur le champ des feux
 *   • et, pour la horde, le drapeau `separating` — l'oblique lui cède le pas (voir `monsters.ts`).
 *
 * Un pas est OBLIQUE quand ses DEUX composantes bougent dans le même tick. Le seuil est à
 * 1e-9 : `moveAvatar` rend l'axe INCHANGÉ quand il vaut zéro, il n'y a rien à arbitrer.
 *
 *   node --import tsx tools/diag-cendreux-cap.mts [--seeds=2026,77] [--jours=30,50] [--minutes=12]
 *
 * Rien n'est écrit dans /sim : on lit l'état avant et après `step`, comme le smoke lit l'écran.
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { spawnEntity, step, type MoveInput, type SimState } from '../packages/sim/src/sim'
import { walkableSpawn } from '../packages/sim/src/connectivity'
import { BALANCE } from '../packages/sim/src/balance'
import { dayTicksPourJour, getGameTime, jourDeSaison, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from '../packages/sim/src/time'
import { deserializeSim, serializeSim } from '../packages/sim/src/persistence'
import { drainEvents } from '../packages/sim/src/events'
import { planifierHorde } from '../packages/sim/src/worldevents'

function arg(nom: string, defaut: string): string {
  return process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut
}
const SEEDS = arg('seeds', '2026,77').split(',').map(Number)
const JOURS = arg('jours', '30,50').split(',').map(Number)
const MINUTES = Number(arg('minutes', '12'))
const NUIT_TICKS = Math.min(TICKS_PER_CYCLE - dayTicksPourJour(BALANCE.JOUR_DE_DEPART), Math.round(MINUTES * 60 * BALANCE.TICK_RATE_HZ))
const EPS = 1e-9
/** La horde est la scène que le joueur REGARDE la nuit : on l'arme, sauf `--sans-horde`. */
const AVEC_HORDE = !process.argv.includes('--sans-horde')

type Branche = 'horde' | 'horde~ecart' | 'chemin' | 'proie' | 'marche'
const BRANCHES: Branche[] = ['horde', 'horde~ecart', 'chemin', 'proie', 'marche']

interface Compte { pas: number; obliques: number }
type Table = Record<Branche, Compte> & { hordesVues: number; geo: Compte[] }

function table(): Table {
  return {
    ...Object.fromEntries(BRANCHES.map((b) => [b, { pas: 0, obliques: 0 }])),
    hordesVues: 0,
    geo: [{ pas: 0, obliques: 0 }, { pas: 0, obliques: 0 }, { pas: 0, obliques: 0 }],
  } as Table
}

function poserLaNuit(sim: SimState, jour: number): void {
  sim.calendarScale = 1
  sim.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  // LA TOMBÉE DE LA NUIT, DÉRIVÉE DE LA LOI QUI LA DÉFINIT (`isNight` = `cycleTick >= dayTicks`).
  // Elle se calculait par `cycleOffsetForStartHour(DAWN + 24 * BALANCE.CYCLE_DAY_FRACTION)` — or
  // cette constante N'EXISTE PAS (ni ici, ni à HEAD) : l'expression valait NaN, l'offset avec, et
  // l'instrument jouait un plein JOUR en croyant jouer une nuit. `tools/` n'est dans aucun
  // tsconfig, donc `pnpm check` ne pouvait pas le dire. (Vu le 2026-08-25.)
  //
  // ⚠ ON SE POSE DEUX TICKS AVANT LE CRÉPUSCULE, PAS DESSUS. `planifierHorde` s'accroche à
  // l'ÉVÉNEMENT `night_started`, qu'`advanceTime` n'émet qu'au tick exact du basculement : posé
  // À la tombée, on l'a déjà manqué — et la colonne `horde` de cet instrument comptait 0 pas
  // pour cette seule raison. On entre donc par le jour, et la nuit tombe SOUS l'instrument.
  //
  // ⚠ ET LA LONGUEUR DU JOUR SE LIT AU DÉBUT DU CYCLE, pas au tick où l'on se pose : `estCrepuscule`
  // interroge `dayTicksPourJour(jourDeSaison(debutDeCycle))`, et un cycle qui commence la veille
  // n'a pas la longueur de jour du lendemain (S6 : le jour raccourcit avec la saison). Poser
  // `dayTicksPourJour(jour)` tel quel plaçait le montage APRÈS la tombée — nuit déjà tombée,
  // événement manqué, zéro horde. On résout donc le point fixe, puis ON VÉRIFIE.
  let D = dayTicksPourJour(jour)
  for (let k = 0; k < 8; k++) {
    const D2 = dayTicksPourJour(jourDeSaison(sim, sim.tick - (D - 2)))
    if (D2 === D) break
    D = D2
  }
  sim.cycleOffset = (((D - 2 - sim.tick) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
  if (getGameTime(sim).isNight) console.error(`!! la nuit est DÉJÀ tombée au montage (jour ${jour}) — le crépuscule ne sera pas franchi, aucune horde`)
}

/** La branche que `cendreuxStep` va prendre pour ce monstre, lue AVANT le pas. */
function brancheDe(sim: SimState, m: { entityId: number; targetId: number | null; path?: { tx: number; ty: number }[]; separating?: true }): Branche {
  const enHorde = sim.hordes.some((h) => h.memberEntityIds.includes(m.entityId))
  // L'ordre reproduit celui de `cendreuxStep` : la horde d'abord (sans proie), puis le chemin,
  // puis la proie, puis la longue marche.
  if (enHorde && m.targetId === null) return m.separating === true ? 'horde~ecart' : 'horde'
  if ((m.path?.length ?? 0) > 0) return 'chemin'
  if (m.targetId !== null) return 'proie'
  return 'marche'
}

function jouer(base: string, jour: number): Table {
  const sim = deserializeSim(base)
  poserLaNuit(sim, jour)
  drainEvents(sim)
  const spot = walkableSpawn(sim.map)
  const joueurId = spawnEntity(sim, spot.x, spot.y)
  // UN FEU ALLUMÉ À CÔTÉ DE LUI — c'est la PRÉMISSE DE LA HORDE, pas un décor : `planifierHorde`
  // rend `null` dès que `feuxAllumes` est vide (« rien à assiéger : la nuit n'a pas de horde »),
  // et les foyers du banc ne brûlent pas. Le contrat de `fire.ts` : poussé sans `fuel`, il brûle.
  sim.structures.push({ type: 'fire', tx: Math.floor(spot.x) + 1, ty: Math.floor(spot.y), villageId: 0 } as never)
  // ET LE PRÉSAGE, ARMÉ PAR LE PLANIFICATEUR DU JEU — pas par une horde écrite à la main. Le
  // présage se tire à l'AUBE de la veille (décision ⑱) et s'exécute au crépuscule : un montage
  // qui se pose le soir n'en a aucun, et la colonne `horde` restait vide sans que rien ne le
  // dise. On appelle donc `planifierHorde` avec le tick de la tombée, exactement comme l'aube.
  if (AVEC_HORDE) sim.presage = planifierHorde(sim, sim.tick + 2)
  const t = table()

  // Le corps fait le tour d'un carré de 12 tuiles : il se montre, il se fait suivre.
  const R = 12
  const circuit = [
    { x: spot.x + R, y: spot.y }, { x: spot.x + R, y: spot.y + R }, { x: spot.x, y: spot.y + R }, { x: spot.x, y: spot.y },
  ]
  let etape = 0
  let hordesVues = 0 // LA PRÉMISSE DE LA COLONNE `horde` : sans horde formée, son 0 mesure l'instrument
  const avant = new Map<number, { x: number; y: number; b: Branche; ratio: number }>()

  let nuitCommencee = false
  for (let i = 0; i < NUIT_TICKS + 2; i++) {
    const nuit = getGameTime(sim).isNight
    if (nuit) nuitCommencee = true
    else if (nuitCommencee) break // l'aube : la nuit est finie, on a tout compté
    const j = sim.entities.find((e) => e.id === joueurId)!
    j.hp = 1000 // il ne meurt pas : on mesure des caps, pas un respawn
    const but = circuit[etape]!
    const dx = but.x - j.x
    const dy = but.y - j.y
    if (dx * dx + dy * dy < 1) etape = (etape + 1) % circuit.length
    const norme = Math.max(1e-6, Math.hypot(dx, dy))
    const input: MoveInput = { entityId: joueurId, dx: dx / norme, dy: dy / norme }

    avant.clear()
    for (const m of sim.monsters) {
      if (m.type !== 'cendreux') continue
      const e = sim.entities.find((q) => q.id === m.entityId)
      if (!e || e.hp <= 0) continue
      // LA GÉOMÉTRIE DU BUT, pour la horde : un cap cardinal est JUSTE quand le feu est dans
      // l'axe. Sans ce partage, un taux d'obliques bas accuserait le code alors qu'il décrirait
      // le terrain. `ratio` = min(|dx|,|dy|)/max(...) : 0 = plein axe, 1 = 45° franc.
      const h = sim.hordes.find((q) => q.memberEntityIds.includes(m.entityId))
      let ratio = -1
      if (h) {
        const ax = Math.abs(h.fireTx + 0.5 - e.x)
        const ay = Math.abs(h.fireTy + 0.5 - e.y)
        const mx = Math.max(ax, ay)
        ratio = mx < 1 ? 1 : Math.min(ax, ay) / mx
      }
      avant.set(m.entityId, { x: e.x, y: e.y, b: brancheDe(sim, m), ratio })
    }

    step(sim, [input], [])
    if (sim.hordes.length > hordesVues) hordesVues = sim.hordes.length

    for (const [id, a] of avant) {
      const e = sim.entities.find((q) => q.id === id)
      if (!e) continue
      const bx = Math.abs(e.x - a.x) > EPS
      const by = Math.abs(e.y - a.y) > EPS
      if (!bx && !by) continue // il n'a pas bougé : ni cardinal ni oblique, rien à compter
      t[a.b].pas++
      if (bx && by) t[a.b].obliques++
      if (a.ratio >= 0) {
        const seau = a.ratio < 0.2 ? 0 : a.ratio < 0.6 ? 1 : 2
        t.geo[seau]!.pas++
        if (bx && by) t.geo[seau]!.obliques++
      }
    }
  }
  t.hordesVues = hordesVues
  return t
}

function pct(c: Compte): string {
  return c.pas === 0 ? '   —  ' : `${((100 * c.obliques) / c.pas).toFixed(1).padStart(5)} %`
}

console.log(`\n═══ Le cap des Cendreux — graines ${SEEDS.join(',')} · jours ${JOURS.join(',')} · ${NUIT_TICKS} ticks de nuit ═══`)
const total = table()
for (const seed of SEEDS) {
  const { sim } = construireMondeDuBanc(seed)
  const base = serializeSim(sim)
  for (const jour of JOURS) {
    const t = jouer(base, jour)
    const pas = BRANCHES.reduce((s, b) => s + t[b].pas, 0)
    const obl = BRANCHES.reduce((s, b) => s + t[b].obliques, 0)
    console.log(
      `  seed ${String(seed).padStart(4)} j${String(jour).padStart(2)} · ${String(pas).padStart(6)} pas · obliques ${pct({ pas, obliques: obl })}` +
        `   ${BRANCHES.map((b) => `${b} ${pct(t[b])} (${t[b].pas})`).join(' · ')}`,
    )
    for (const b of BRANCHES) { total[b].pas += t[b].pas; total[b].obliques += t[b].obliques }
    total.hordesVues = Math.max(total.hordesVues, t.hordesVues)
    for (let g = 0; g < 3; g++) { total.geo[g]!.pas += t.geo[g]!.pas; total.geo[g]!.obliques += t.geo[g]!.obliques }
  }
}
const pasT = BRANCHES.reduce((s, b) => s + total[b].pas, 0)
const oblT = BRANCHES.reduce((s, b) => s + total[b].obliques, 0)
console.log(`\n  TOUTES BRANCHES : ${pasT} pas, ${pct({ pas: pasT, obliques: oblT })} obliques · hordes formées (max) : ${total.hordesVues}`)
for (const b of BRANCHES) console.log(`    ${b.padEnd(12)} ${pct(total[b])}  sur ${String(total[b].pas).padStart(6)} pas`)
console.log('\n  EN HORDE, PAR GÉOMÉTRIE DU BUT (le feu est-il dans l’axe ?) — un cap cardinal y est JUSTE :')
const LIB = ['plein axe (<0,2)', 'oblique (0,2-0,6)', '45° franc (>0,6)']
for (let g = 0; g < 3; g++) console.log(`    ${LIB[g]!.padEnd(18)} ${pct(total.geo[g]!)}  sur ${String(total.geo[g]!.pas).padStart(6)} pas`)
console.log(
  '\n  (Repère : une marche libre vers un point quelconque donnerait beaucoup d’obliques ; une\n' +
  '   descente de champ 4-connexe sans correction de cap en donne ZÉRO, par construction.)',
)
