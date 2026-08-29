/**
 * DIAGNOSTIC DU TREMBLEMENT — « les 4 animaux sur l'écran font des avant-arrière en boucle
 * sur 10px » (Alexis, 2026-08-28, capture `tremblement.png`).
 *
 * L'outil joue le VRAI monde (construireMondeDuBanc : MONDE_JOUE, lieux bâtis, villages PNJ)
 * et y ajoute ce que le banc n'a pas : UN AVATAR IMMOBILE — la situation exacte de la capture
 * (le joueur regarde sa carte, la faune vit autour). Il poste cet avatar à des endroits
 * représentatifs (berge en cendre — la capture —, forêt, pré près de l'eau) et à deux heures
 * (plein jour, crépuscule du soir : l'heure des coulées où le gibier descend boire).
 *
 * LA SIGNATURE D'UN TREMBLEMENT : sur une fenêtre glissante de W ticks, la bête a PARCOURU
 * beaucoup (chemin brut ≥ GROSS_MIN) mais n'est ALLÉE nulle part (déplacement net ≤ NET_MAX).
 * Une bête qui broute fait des pas courts (brut faible) ; une bête qui voyage a un net grand.
 * Seule l'oscillation a les deux : du mouvement qui ne mène nulle part.
 *
 * À chaque épisode détecté, on capture l'ÉTAT de la bête (fuite, homing, regroupement,
 * coulée, wander…) — c'est la colonne qui désigne le coupable, pas une supposition.
 *
 *   node --import tsx tools/diag-tremblement.mts [minutes-par-poste] [seeds…]
 */
import { BALANCE, HUNT, TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_SHALLOW_WATER } from '../packages/sim/src/balance'
import { foyersDeLaCarte } from '../packages/sim/src/cendre'
import { terrainAt } from '../packages/sim/src/map'
import type { Monster } from '../packages/sim/src/monsters'
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { spawnEntity, step, type Entity, type SimState } from '../packages/sim/src/sim'
import { getGameTime, TICKS_PER_CYCLE } from '../packages/sim/src/time'

const minutes = Number(process.argv[2] ?? 3)
const seeds = process.argv.slice(3).map(Number)
if (seeds.length === 0) seeds.push(2026)

/** La fenêtre de mesure : 2 s — l'œil voit un tremblement bien avant. */
const W = 2 * BALANCE.TICK_RATE_HZ
/** Chemin brut minimal sur la fenêtre pour parler de mouvement (en tuiles). */
const GROSS_MIN = 1.0
/** Déplacement net maximal : au-delà, la bête est allée quelque part. */
const NET_MAX = 0.4

interface Suivi {
  x: number
  y: number
  ax: number // ancre de fenêtre
  ay: number
  gross: number
  ticks: number
  episodes: number
  enEpisode: boolean
  /** Δ du tick précédent — pour compter les INVERSIONS de cap (dot < 0). */
  pdx: number
  pdy: number
  inversions: number
  /** Écart maximal à l'ancre sur la fenêtre : l'amplitude du tremblement. */
  amp: number
}

function flagsOf(state: SimState, m: Monster, e: Entity, byId: Map<number, Entity>): string {
  const f: string[] = []
  if (m.fleeSince >= 0) f.push('fuite')
  if ((m as Record<string, unknown>).homing) f.push('homing')
  if ((m as Record<string, unknown>).regrouping) f.push('regroup')
  if ((m as Record<string, unknown>).bedded) f.push('tapie')
  if ((m as Record<string, unknown>).rootUntil !== undefined) f.push('fouge')
  if ((m as Record<string, unknown>).drinkUntil !== undefined) f.push('boit')
  if ((m as Record<string, unknown>).couleePas !== undefined && (m as Record<string, unknown>).couleePas !== -1) f.push('coulee')
  if ((m as Record<string, unknown>).baitUntil !== undefined) f.push('appat')
  if ((m as Record<string, unknown>).stalking) f.push('stalk')
  if (m.wanderDx !== 0 || m.wanderDy !== 0) f.push(`wander(${m.wanderDx},${m.wanderDy})`)
  if (m.targetId !== null) f.push('cible')
  const susp = (m as Record<string, unknown>).suspicion
  if (typeof susp === 'number' && susp > 0) f.push(`susp${susp.toFixed(1)}`)
  // Côté loup : le gîte et son emprise — c'est la vie de tanière qu'on soupçonne.
  const homePoi = (m as Record<string, unknown>).homePoi
  if (typeof homePoi === 'number') {
    const z = state.map.zones[homePoi]
    if (z && z.kind === 'louviere') {
      const dx = z.x + z.w / 2 - e.x
      const dy = z.y + z.h / 2 - e.y
      f.push(`den@${Math.sqrt(dx * dx + dy * dy).toFixed(1)}`)
    }
  }
  if ((m as Record<string, unknown>).sortie === true) f.push('sortie')
  if ((m as Record<string, unknown>).alpha === true) f.push('alpha')
  if ((m as Record<string, unknown>).petit === true) f.push('petit')
  const terr = terrainAt(state.map, Math.floor(e.x), Math.floor(e.y))
  f.push(`sol:${TERRAINS[terr]?.name ?? terr}`)
  // Le plus proche AUTRE corps (pression de séparation) et l'eau la plus proche.
  let corps = Infinity
  for (const o of state.monsters) {
    if (o.entityId === m.entityId) continue
    const oe = byId.get(o.entityId)
    if (!oe || oe.hp <= 0) continue
    const d = Math.sqrt((oe.x - e.x) * (oe.x - e.x) + (oe.y - e.y) * (oe.y - e.y))
    if (d < corps) corps = d
  }
  if (corps < 1.5) f.push(`corps@${corps.toFixed(2)}`)
  let eau = Infinity
  for (let r = 0; r <= 4 && eau === Infinity; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue
        const t = terrainAt(state.map, Math.floor(e.x) + ox, Math.floor(e.y) + oy)
        if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) { eau = r; break }
      }
      if (eau !== Infinity) break
    }
  }
  if (eau <= 4) f.push(`eau@${eau}`)
  return f.join('+') || 'nu'
}

/** Cherche une tuile de terrain `voulu` marchable, à ≤ `presDe` tuiles d'eau si demandé. */
function chercherPoste(state: SimState, voulus: number[], presEau: boolean): { x: number; y: number } | null {
  const map = state.map
  for (let ty = 8; ty < map.height - 8; ty += 2) {
    for (let tx = 8; tx < map.width - 8; tx += 2) {
      const t = terrainAt(map, tx, ty)
      if (!voulus.includes(t)) continue
      if (!TERRAINS[t]?.walkable) continue
      if (presEau) {
        let ok = false
        for (let oy = -3; oy <= 3 && !ok; oy++) {
          for (let ox = -3; ox <= 3; ox++) {
            const tt = terrainAt(map, tx + ox, ty + oy)
            if (tt === TERRAIN_SHALLOW_WATER || tt === TERRAIN_DEEP_WATER) { ok = true; break }
          }
        }
        if (!ok) continue
      }
      return { x: tx + 0.5, y: ty + 0.5 }
    }
  }
  return null
}

for (const seed of seeds) {
  const { sim } = construireMondeDuBanc(seed)
  const avatarId = spawnEntity(sim, sim.map.width / 2, sim.map.height / 2)
  const avatar = sim.entities.find((e) => e.id === avatarId)!

  // La cendre est un CHAMP autour des charniers, pas un terrain : le poste « berge-cendre »
  // se cherche depuis un foyer (charnier), au plus près de l'eau — la scène de la capture.
  let bergeCendre: { x: number; y: number } | null = null
  {
    let bestD = Infinity
    for (const f of foyersDeLaCarte(sim.map)) {
      for (let r = 0; r <= 30; r++) {
        let trouve = false
        for (let oy = -r; oy <= r && !trouve; oy++) {
          for (let ox = -r; ox <= r; ox++) {
            if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue
            const t = terrainAt(sim.map, f.tx + ox, f.ty + oy)
            if (t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER) { trouve = true; break }
          }
        }
        if (trouve) {
          if (r < bestD) {
            bestD = r
            bergeCendre = { x: f.tx + 0.5, y: f.ty + 0.5 }
          }
          break
        }
      }
    }
  }
  const postes: { nom: string; p: { x: number; y: number } | null }[] = [
    { nom: 'berge-cendre', p: bergeCendre },
    { nom: 'foret', p: chercherPoste(sim, [TERRAIN_FOREST], false) },
    { nom: 'pre-berge', p: chercherPoste(sim, [TERRAIN_GRASS], true) },
  ]
  const heures = (process.env.HEURES ? process.env.HEURES.split(',').map(Number) : [11, HUNT.COULEE_SOIR_DE + 0.5])

  console.log(`\n═══ seed ${seed} — carte ${sim.map.width}×${sim.map.height}, fenetre ${W} ticks, brut≥${GROSS_MIN} net≤${NET_MAX} ═══`)

  const filtre = process.env.POSTES ? process.env.POSTES.split(',') : null
  for (const { nom, p } of postes) {
    if (filtre && !filtre.includes(nom)) continue
    if (!p) { console.log(`  poste ${nom} : introuvable sur cette carte`); continue }
    for (const heure of heures) {
      // L'heure se choisit par le décalage de cycle — on ne rembobine jamais le tick.
      const now = getGameTime(sim).hourOfCycle
      const delta = ((heure - now) % 24 + 24) % 24
      sim.cycleOffset = (sim.cycleOffset + Math.round((delta / 24) * TICKS_PER_CYCLE)) % TICKS_PER_CYCLE
      avatar.x = p.x
      avatar.y = p.y

      // Chauffe : la faune ambiante se lève autour du poste.
      for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) step(sim, [])

      const suivis = new Map<number, Suivi>()
      const signatures = new Map<string, { episodes: number; ticks: number }>()
      let beteTicks = 0

      const TICKS = Math.round(minutes * 60 * BALANCE.TICK_RATE_HZ)
      for (let t = 0; t < TICKS; t++) {
        avatar.x = p.x // l'avatar est AFK : rien ne le déplace (séparation comprise)
        avatar.y = p.y
        step(sim, [])
        const byId = new Map<number, Entity>()
        for (const e of sim.entities) byId.set(e.id, e)
        for (const m of sim.monsters) {
          const e = byId.get(m.entityId)
          if (!e || e.hp <= 0) { suivis.delete(m.entityId); continue }
          let s = suivis.get(m.entityId)
          if (!s) {
            s = { x: e.x, y: e.y, ax: e.x, ay: e.y, gross: 0, ticks: 0, episodes: 0, enEpisode: false, pdx: 0, pdy: 0, inversions: 0, amp: 0 }
            suivis.set(m.entityId, s)
            continue
          }
          const ddx = e.x - s.x
          const ddy = e.y - s.y
          s.gross += Math.sqrt(ddx * ddx + ddy * ddy)
          if (ddx * s.pdx + ddy * s.pdy < 0) s.inversions += 1
          if (ddx !== 0 || ddy !== 0) { s.pdx = ddx; s.pdy = ddy }
          const ea = Math.sqrt((e.x - s.ax) * (e.x - s.ax) + (e.y - s.ay) * (e.y - s.ay))
          if (ea > s.amp) s.amp = ea
          s.x = e.x
          s.y = e.y
          s.ticks += 1
          beteTicks += 1
          if (s.ticks >= W) {
            const net = Math.sqrt((e.x - s.ax) * (e.x - s.ax) + (e.y - s.ay) * (e.y - s.ay))
            const tremble = s.gross >= GROSS_MIN && net <= NET_MAX
            if (tremble) {
              const sig = `${m.type}:${flagsOf(sim, m, e, byId)}+inv${(s.inversions / 2).toFixed(0)}/s+amp${s.amp.toFixed(2)}`
              const agg = signatures.get(sig) ?? { episodes: 0, ticks: 0 }
              if (!s.enEpisode) agg.episodes += 1
              agg.ticks += W
              signatures.set(sig, agg)
              if (!s.enEpisode) s.episodes += 1
            }
            s.enEpisode = tremble
            s.ax = e.x
            s.ay = e.y
            s.gross = 0
            s.ticks = 0
            s.inversions = 0
            s.amp = 0
          }
        }
      }

      const total = [...signatures.values()].reduce((a, v) => a + v.ticks, 0)
      const part = beteTicks > 0 ? ((total / beteTicks) * 100).toFixed(2) : '0'
      console.log(`\n  ── poste ${nom} @ ${heure}h — ${minutes} min, ${suivis.size} bêtes suivies, tremblement ${part} % des bête-ticks`)
      const tri = [...signatures.entries()].sort((a, b) => b[1].ticks - a[1].ticks)
      for (const [sig, v] of tri.slice(0, 12)) {
        console.log(`     ${(v.ticks / BALANCE.TICK_RATE_HZ).toFixed(1).padStart(7)} s  ×${String(v.episodes).padStart(3)}  ${sig}`)
      }
      if (tri.length === 0) console.log('     (aucun épisode)')
    }
  }
}
