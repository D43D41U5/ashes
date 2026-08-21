/**
 * DIAGNOSTIC DES CENDREUX — ce que les règles du 2026-08-21 FONT à un joueur, mesuré.
 *
 * Le banc (`pnpm scenario`) n'a pas de joueur ; les tests headless ont des montages d'une
 * tuile. Entre les deux, vingt-cinq règles ont été livrées en une journée (la pression
 * croissante ①-⑲, les sens honnêtes R24-R25, le rampant R26, la mémoire R28) sans qu'une
 * nuit d'acte III ait été jouée avec un corps qui marche, se tait, coupe ou bâtit. Cet
 * instrument joue CE corps, scripté, sur la vraie carte (`construireMondeDuBanc`), une nuit
 * entière par acte, et relève ce que chaque règle promet :
 *
 *   R24  — à quelle distance un Cendreux acquiert le joueur, par ALLURE (marche, pas lent,
 *          sprint, immobile au feu) ; et combien de morsures l'immobile au feu encaisse — la
 *          conséquence NON TRANCHÉE du chantier des sens, chiffrée au lieu de supposée.
 *   R25  — combien de Cendreux une hache ou un chantier DÉTOURNENT (dernier lieu = l'impact).
 *   R26  — la part réelle de rampants parmi les réveils, en pré et près d'un sol mort.
 *   R28  — combien d'extrapolations tombent JUSTE (le joueur repasse à 2 tuiles du point).
 *   ⑳    — l'occupation du plafond global, nuit par nuit, et le coût par tick.
 *
 *   node --import tsx tools/diag-cendreux.mts [--seeds=2026,77] [--jours=10,30,50]
 *        [--minutes=18] [--comportements=feu-immobile,marche,pas-lent,sprint,bucheron,batisseur]
 *
 * LE JOUEUR NE MEURT PAS, ET C'EST DÉLIBÉRÉ : ses PV sont remis à 1 000 avant chaque tick, la
 * perte du tick est relevée (morsure = ≥ 20 PV d'un coup, le reste est le froid). Un joueur
 * mort respawne et l'instrument mesurerait le respawn. Sa TEMPÉRATURE, elle, court — c'est le
 * vol de chaleur (⑯) qu'on veut voir.
 *
 * Rien n'est écrit dans /sim ; on LIT l'état, on n'en fabrique pas (patron du smoke).
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { spawnEntity, step, type MoveInput, type PlayerAction, type SimState } from '../packages/sim/src/sim'
import { walkableSpawn } from '../packages/sim/src/connectivity'
import { BALANCE } from '../packages/sim/src/balance'
import { cycleOffsetForStartHour, DAY_TICKS_PER_CYCLE, getGameTime, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from '../packages/sim/src/time'
import { densiteDesMorts } from '../packages/sim/src/morts'
import { plafondGlobal } from '../packages/sim/src/monsters'
import { deserializeSim, serializeSim } from '../packages/sim/src/persistence'
import { grantItems } from '../packages/sim/src/village'
import { drainEvents } from '../packages/sim/src/events'

type Comportement = 'feu-immobile' | 'marche' | 'pas-lent' | 'sprint' | 'bucheron' | 'batisseur'
const TOUS: Comportement[] = ['feu-immobile', 'marche', 'pas-lent', 'sprint', 'bucheron', 'batisseur']

function arg(nom: string, defaut: string): string {
  return process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut
}
const SEEDS = arg('seeds', '2026,77').split(',').map(Number)
const JOURS = arg('jours', '10,30,50').split(',').map(Number)
const MINUTES = Number(arg('minutes', '18'))
const COMPORTEMENTS = arg('comportements', TOUS.join(',')).split(',') as Comportement[]
const NUIT_TICKS = Math.min(TICKS_PER_CYCLE - DAY_TICKS_PER_CYCLE, Math.round(MINUTES * 60 * BALANCE.TICK_RATE_HZ))
const PV_INFINIS = 1000
const EVENTS = process.argv.includes('--events')

interface Releve {
  seed: number
  jour: number
  comportement: Comportement
  ticks: number
  reveils: number
  cris: number
  etouffes: number
  rampants: number
  rampantsPre: number
  reveilsPre: number
  rampantsMort: number
  reveilsMort: number
  /** Acquisitions du joueur : une par Cendreux, à la distance et l'allure du moment. */
  acquisitions: { dist: number; gait: string; rampant: boolean }[]
  impacts: number
  detournes: number
  distDetournes: number[]
  extrapolations: number
  extrapolationsJustes: number
  morsures: number
  degats: number
  tempMin: number
  picVivants: number
  plafond: number
  plafondPlein: number
  /** Tick (relatif au début de la nuit) où les vivants ont atteint le plafond pour la première fois — -1 jamais. */
  pleinA: number
  rejets: Record<string, number>
  msTick: number
  msTickMax: number
  coinces: number
}

function sign(v: number): -1 | 0 | 1 {
  return v > 0.2 ? 1 : v < -0.2 ? -1 : 0
}

function poserLaNuit(sim: SimState, jour: number): void {
  // Le patron des tests A13 : calendrier réel (échelle 1), le tick posé sur le jour visé,
  // l'heure posée par la phase du cycle (`debug_set_hour`, sans le debug).
  sim.calendarScale = 1
  sim.tick = (jour - 1) * TICKS_PER_SEASON_DAY
  const cible = cycleOffsetForStartHour(BALANCE.CYCLE_DAWN_HOUR + 24 * BALANCE.CYCLE_DAY_FRACTION) // la tombée de la nuit
  sim.cycleOffset = (((cible - sim.tick) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
}

function jouer(base: string, seed: number, jour: number, comportement: Comportement): Releve {
  const sim = deserializeSim(base)
  poserLaNuit(sim, jour)
  drainEvents(sim)

  // LE CORPS. Posé au spawn des joueurs (Prés Bas) — ou, pour le bâtisseur, au pied du Feu
  // du village le plus proche, où `build` a le droit de poser (carré du Feu, R2).
  let spot = walkableSpawn(sim.map)
  let villageId: number | undefined
  if (comportement === 'batisseur') {
    const v = sim.villages
      .map((v) => ({ v, d: (v.fireTx - spot.x) ** 2 + (v.fireTy - spot.y) ** 2 }))
      .sort((a, b) => a.d - b.d)[0]?.v
    if (v) {
      villageId = v.id
      spot = { x: v.fireTx + 3.5, y: v.fireTy + 3.5 }
    }
  }
  const joueurId = spawnEntity(sim, spot.x, spot.y)
  const joueur = () => sim.entities.find((e) => e.id === joueurId)!
  if (villageId !== undefined) {
    sim.villages.find((v) => v.id === villageId)!.memberIds.push(joueurId)
    grantItems(sim, joueurId, { hammer: 1, wood: 80 })
    const slot = joueur().inventory.findIndex((s) => s?.item === 'hammer')
    if (slot >= 0) joueur().activeSlot = slot
  }
  if (comportement === 'feu-immobile') {
    // Un feu ALLUMÉ à côté de lui (le contrat de `fire.ts` : poussé sans `fuel`, il brûle).
    sim.structures.push({ type: 'fire', tx: Math.floor(spot.x) + 1, ty: Math.floor(spot.y), villageId: 0 } as never)
  }
  // Les arbres du bûcheron : les plus proches du spawn.
  const arbres = sim.nodes
    .filter((n) => (n.type === 'tree' || n.type === 'old_tree') && n.stock > 0)
    .map((n) => ({ n, d: (n.tx + 0.5 - spot.x) ** 2 + (n.ty + 0.5 - spot.y) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map((a) => a.n)

  const r: Releve = {
    seed, jour, comportement, ticks: 0, reveils: 0, cris: 0, etouffes: 0,
    rampants: 0, rampantsPre: 0, reveilsPre: 0, rampantsMort: 0, reveilsMort: 0,
    acquisitions: [], impacts: 0, detournes: 0, distDetournes: [],
    extrapolations: 0, extrapolationsJustes: 0, morsures: 0, degats: 0, tempMin: 100,
    picVivants: 0, plafond: plafondGlobal(sim), plafondPlein: 0, pleinA: -1, rejets: {}, msTick: 0, msTickMax: 0, coinces: 0,
  }

  // Le circuit du marcheur : un carré de 12 tuiles autour du spawn.
  const R = 12
  const circuit = [
    { x: spot.x + R, y: spot.y }, { x: spot.x + R, y: spot.y + R }, { x: spot.x, y: spot.y + R }, { x: spot.x, y: spot.y },
  ]
  let etape = 0
  let immobileDepuis = 0
  let arbre = 0
  let prochainePose = 0
  let poseIdx = 0
  const vus = new Set<number>()
  const acquis = new Set<number>()
  const suivi = new Map<number, { x: number; y: number; v: boolean }>()
  const pointsExtrapoles: { x: number; y: number; tick: number; juste: boolean }[] = []
  let impact: { x: number; y: number; comptes: Set<number> } | null = null
  let msTotal = 0
  const evenements: Record<string, number> = {}

  for (let t = 0; t < NUIT_TICKS; t++) {
    const j = joueur()
    if (!getGameTime(sim).isNight) break
    j.hp = PV_INFINIS
    const avant = { x: j.x, y: j.y }

    // ── LE GESTE DU TICK ──────────────────────────────────────────────────────────────
    const input: MoveInput = { entityId: joueurId, dx: 0, dy: 0 }
    let action: PlayerAction | undefined
    let impactTick: { x: number; y: number } | null = null
    if (comportement === 'marche' || comportement === 'pas-lent' || comportement === 'sprint') {
      const w = circuit[etape]!
      if ((w.x - j.x) ** 2 + (w.y - j.y) ** 2 < 1) etape = (etape + 1) % circuit.length
      input.dx = sign(w.x - j.x)
      input.dy = sign(w.y - j.y)
      if (comportement === 'pas-lent') input.sneak = true
      if (comportement === 'sprint') input.sprint = true
    } else if (comportement === 'bucheron') {
      const n = arbres[arbre % Math.max(1, arbres.length)]
      if (n) {
        if (n.stock <= 0) arbre += 1
        const cx = n.tx + 0.5
        const cy = n.ty + 0.5
        const d2 = (cx - j.x) ** 2 + (cy - j.y) ** 2
        if (d2 > 1.2 * 1.2) {
          input.dx = sign(cx - j.x)
          input.dy = sign(cy - j.y)
        } else if (sim.tick >= j.cooldownUntil) {
          action = { type: 'harvest', nodeId: n.id }
          impactTick = { x: cx, y: cy }
        }
      }
    } else if (comportement === 'batisseur' && villageId !== undefined) {
      if (t >= prochainePose) {
        const v = sim.villages.find((x) => x.id === villageId)!
        // Un anneau de murs à 3 tuiles du Feu, posé mur après mur, toutes les 3 secondes.
        const anneau: { tx: number; ty: number }[] = []
        for (let d = -3; d <= 3; d++) {
          anneau.push({ tx: v.fireTx + d, ty: v.fireTy - 3 }, { tx: v.fireTx + d, ty: v.fireTy + 3 })
          if (Math.abs(d) < 3) anneau.push({ tx: v.fireTx - 3, ty: v.fireTy + d }, { tx: v.fireTx + 3, ty: v.fireTy + d })
        }
        const cible = anneau[poseIdx % anneau.length]!
        poseIdx += 1
        prochainePose = t + 3 * BALANCE.TICK_RATE_HZ
        const d2 = (cible.tx + 0.5 - j.x) ** 2 + (cible.ty + 0.5 - j.y) ** 2
        if (d2 <= (BALANCE.BUILD_RANGE - 0.5) ** 2) {
          action = { type: 'build', structure: 'wall', tx: cible.tx, ty: cible.ty } as PlayerAction
          impactTick = { x: cible.tx + 0.5, y: cible.ty + 0.5 }
        }
      }
    }
    if (action) input.action = action

    const t0 = performance.now()
    step(sim, [input])
    const ms = performance.now() - t0
    msTotal += ms
    if (ms > r.msTickMax) r.msTickMax = ms
    r.ticks += 1

    // ── CE QUE LE TICK A FAIT ─────────────────────────────────────────────────────────
    const apres = joueur()
    const perte = PV_INFINIS - apres.hp
    if (perte > 0) {
      r.degats += perte
      if (perte >= 20) r.morsures += 1
    }
    if (apres.temperature < r.tempMin) r.tempMin = apres.temperature
    if ((input.dx !== 0 || input.dy !== 0) && apres.x === avant.x && apres.y === avant.y) {
      immobileDepuis += 1
      if (immobileDepuis === 3 * BALANCE.TICK_RATE_HZ) {
        r.coinces += 1
        etape = (etape + 1) % circuit.length // on se décoince en changeant de cap
        if (comportement === 'bucheron') arbre += 1
      }
    } else immobileDepuis = 0

    let rejeteCeTick = false
    for (const ev of drainEvents(sim)) {
      if (EVENTS) evenements[ev.type] = (evenements[ev.type] ?? 0) + 1
      if (ev.type === 'cendreux_risen') r.reveils += 1
      if (ev.type === 'cendreux_cri') r.cris += 1
      if (ev.type === 'reveil_etouffe') r.etouffes += 1
      if (ev.type === 'action_rejected' && ev.entityId === joueurId) {
        rejeteCeTick = true
        r.rejets[ev.reason] = (r.rejets[ev.reason] ?? 0) + 1
      }
    }
    if (impactTick && !rejeteCeTick) {
      // Le coup a PORTÉ (aucun rejet ce tick) : on compte les détournés depuis CET impact.
      r.impacts += 1
      impact = { x: impactTick.x, y: impactTick.y, comptes: new Set() }
    }

    let vivants = 0
    for (const m of sim.monsters) {
      if (m.type !== 'cendreux') continue
      const e = sim.entities.find((en) => en.id === m.entityId)
      if (!e || e.hp <= 0) continue
      vivants += 1
      if (!vus.has(m.entityId)) {
        vus.add(m.entityId)
        if (m.ambient === true) {
          const mort = densiteDesMorts(sim, Math.floor(e.x), Math.floor(e.y)) >= 0.5
          if (mort) r.reveilsMort += 1
          else r.reveilsPre += 1
          if (m.rampant === true) {
            r.rampants += 1
            if (mort) r.rampantsMort += 1
            else r.rampantsPre += 1
          }
        }
      }
      // L'ACQUISITION PAR LES YEUX, et rien d'autre : un réveil NAÎT déjà ciblé sur sa proie
      // (`targetId` = `huntTargetId`) et la chaleur désigne un corps sans le voir — seule la
      // vue écrit la POSITION EXACTE du joueur dans `lastSeen` (R24). C'est elle qu'on lit.
      if (!acquis.has(m.entityId) && m.lastSeenX === apres.x && m.lastSeenY === apres.y) {
        acquis.add(m.entityId)
        r.acquisitions.push({ dist: Math.sqrt((e.x - apres.x) ** 2 + (e.y - apres.y) ** 2), gait: apres.gait, rampant: m.rampant === true })
      }
      if (impact && m.lastSeenX === impact.x && m.lastSeenY === impact.y && !impact.comptes.has(m.entityId)) {
        impact.comptes.add(m.entityId)
        if (m.targetId !== joueurId) {
          r.detournes += 1
          r.distDetournes.push(Math.sqrt((e.x - impact.x) ** 2 + (e.y - impact.y) ** 2))
        }
      }
      const prev = suivi.get(m.entityId)
      const lx = m.lastSeenX
      const ly = m.lastSeenY
      if (prev && prev.v && m.lastSeenVx === undefined && lx !== undefined && ly !== undefined && (lx !== prev.x || ly !== prev.y)
        && !(impact && lx === impact.x && ly === impact.y)) {
        r.extrapolations += 1
        pointsExtrapoles.push({ x: lx, y: ly, tick: sim.tick, juste: false })
      }
      suivi.set(m.entityId, { x: lx ?? NaN, y: ly ?? NaN, v: m.lastSeenVx !== undefined })
    }
    if (vivants > r.picVivants) r.picVivants = vivants
    if (t % 60 === 0 && vivants >= plafondGlobal(sim)) r.plafondPlein += 1
    if (r.pleinA < 0 && vivants - 7 >= plafondGlobal(sim)) r.pleinA = t // 7 de sédiment hors plafond (Repaires, convois)
    for (const p of pointsExtrapoles) {
      if (!p.juste && sim.tick - p.tick <= 30 * BALANCE.TICK_RATE_HZ && (p.x - apres.x) ** 2 + (p.y - apres.y) ** 2 <= 4) {
        p.juste = true
        r.extrapolationsJustes += 1
      }
    }
  }
  r.msTick = r.ticks > 0 ? msTotal / r.ticks : 0
  r.plafond = plafondGlobal(sim)
  if (EVENTS) console.log(`      événements : ${JSON.stringify(evenements)}`)
  return r
}

function moy(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}
function f(v: number, d = 1): string {
  return Number.isFinite(v) ? v.toFixed(d) : '—'
}

console.log(`\n═══ Diagnostic des Cendreux — graines ${SEEDS.join(',')} · jours ${JOURS.join(',')} · nuit de ${NUIT_TICKS} ticks (${f(NUIT_TICKS / BALANCE.TICK_RATE_HZ / 60, 0)} min) · comportements ${COMPORTEMENTS.join(', ')} ═══`)
const releves: Releve[] = []
for (const seed of SEEDS) {
  const t0 = performance.now()
  const { sim } = construireMondeDuBanc(seed)
  const base = serializeSim(sim)
  console.log(`\n  seed ${seed} — monde ${sim.map.width}×${sim.map.height} bâti en ${f((performance.now() - t0) / 1000, 0)} s`)
  for (const jour of JOURS) {
    for (const c of COMPORTEMENTS) {
      const t1 = performance.now()
      const r = jouer(base, seed, jour, c)
      releves.push(r)
      const acq = r.acquisitions
      console.log(
        `    j${jour} ${c.padEnd(12)} ${f((performance.now() - t1) / 1000, 0).padStart(3)} s · réveils ${String(r.reveils).padStart(2)} (rampants ${r.rampants}) · cris ${r.cris}` +
          ` · acquis ${String(acq.length).padStart(2)} à ${f(moy(acq.map((a) => a.dist)))} t · impacts ${r.impacts} → détournés ${r.detournes}` +
          ` · extrapol. ${r.extrapolationsJustes}/${r.extrapolations} · morsures ${r.morsures} (${r.degats} PV) · T°min ${f(r.tempMin, 0)}` +
          ` · pic ${r.picVivants}/${r.plafond}${r.pleinA >= 0 ? ` (plein à ${f(r.pleinA / BALANCE.TICK_RATE_HZ / 60, 1)} min)` : ''} · ${f(r.msTick, 2)} ms/tick (max ${f(r.msTickMax, 0)})` +
          (r.coinces ? ` · coincé ×${r.coinces}` : '') +
          (Object.keys(r.rejets).length ? ` · rejets ${JSON.stringify(r.rejets)}` : ''),
      )
    }
  }
}

console.log(`\n═══ Synthèse (moyennes sur ${SEEDS.length} graine(s)) ═══`)
console.log('  jour  comportement   réveils  rampants(pré/mort)  acquis  dist.acq  détournés/impacts  extrap.justes  morsures  dégâts  T°min  pic/plafond  ms/tick')
for (const jour of JOURS) {
  for (const c of COMPORTEMENTS) {
    const rs = releves.filter((r) => r.jour === jour && r.comportement === c)
    const acq = rs.flatMap((r) => r.acquisitions)
    const rampPre = rs.reduce((n, r) => n + r.rampantsPre, 0)
    const revPre = rs.reduce((n, r) => n + r.reveilsPre, 0)
    const rampMort = rs.reduce((n, r) => n + r.rampantsMort, 0)
    const revMort = rs.reduce((n, r) => n + r.reveilsMort, 0)
    const part = (a: number, b: number) => (b > 0 ? `${f((100 * a) / b, 0)} %` : '—')
    console.log(
      `  ${String(jour).padStart(3)}   ${c.padEnd(13)} ${f(moy(rs.map((r) => r.reveils)), 1).padStart(6)}  ${(part(rampPre, revPre) + ' / ' + part(rampMort, revMort)).padStart(17)}` +
        `  ${f(moy(rs.map((r) => r.acquisitions.length)), 1).padStart(6)}  ${f(moy(acq.map((a) => a.dist)), 1).padStart(8)}` +
        `  ${(f(moy(rs.map((r) => r.detournes)), 1) + ' / ' + f(moy(rs.map((r) => r.impacts)), 0)).padStart(17)}` +
        `  ${(rs.reduce((n, r) => n + r.extrapolationsJustes, 0) + '/' + rs.reduce((n, r) => n + r.extrapolations, 0)).padStart(13)}` +
        `  ${f(moy(rs.map((r) => r.morsures)), 1).padStart(8)}  ${f(moy(rs.map((r) => r.degats)), 0).padStart(6)}  ${f(moy(rs.map((r) => r.tempMin)), 0).padStart(5)}` +
        `  ${(f(moy(rs.map((r) => r.picVivants)), 1) + '/' + f(moy(rs.map((r) => r.plafond)), 0)).padStart(11)}  ${f(moy(rs.map((r) => r.msTick)), 2).padStart(7)}`,
    )
  }
}
const allures = new Map<string, number[]>()
for (const r of releves) for (const a of r.acquisitions) allures.set(a.gait, [...(allures.get(a.gait) ?? []), a.dist])
console.log('\n  Distance d\'acquisition par ALLURE du joueur (toutes nuits, toutes graines) :')
for (const [g, ds] of allures) console.log(`    ${g.padEnd(7)} n=${String(ds.length).padStart(3)}  moyenne ${f(moy(ds))} t  max ${f(Math.max(...ds))} t`)
const detours = releves.flatMap((r) => r.distDetournes)
if (detours.length) console.log(`  Distance des DÉTOURNÉS : n=${detours.length}, moyenne ${f(moy(detours))} t, max ${f(Math.max(...detours))} t`)
