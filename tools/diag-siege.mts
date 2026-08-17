/**
 * ═══ COMMENT LA HORDE ENTRE-T-ELLE ? — la nuit de siège instrumentée ═══
 *
 * L'autopsie (`diag-mort-pnj`) a établi que les cendreux tuent DANS le carré du village.
 * Reste la question dont dépend le levier α du rapport (`calibration-saison.md` § question
 * ②) : entrent-ils par une BRÈCHE qu'ils ont battue (les murs comptent, il faut les tenir),
 * par la PORTE, par un TROU d'enceinte inachevée (les murs comptent mais n'existent pas
 * encore), ou À TRAVERS (les murs ne comptent pas du tout) ?
 *
 * Pour chaque siège (`horde_spawned` → sa horde n'est plus dans `state.hordes`) :
 *   · l'INVENTAIRE DU BÂTI du village visé au premier tick (murs/palissades/clôtures/portes
 *     + PV totaux, état d'ouverture des portes — la porte rituelle ferme au crépuscule) ;
 *   · l'ENTRÉE de chaque membre dans le périmètre bâti (la bbox des murs s'il y en a ≥ 8,
 *     sinon le carré du Feu) : position, et les 3 structures du village les plus proches
 *     avec leur PV — entre deux murs VIVANTS = passe-muraille ; à côté d'un mur DÉTRUIT ce
 *     siège-ci = brèche battue ; rien à moins de 2 tuiles = trou d'enceinte ;
 *   · les DÉGÂTS par type de structure (PV perdus, destructions) et au FEU pendant le siège ;
 *   · les MORTS de villageois pendant la fenêtre, et l'issue (dispersée/anéantie, durée).
 *
 * Usage : node --import tsx tools/diag-siege.mts <seed> [joursMax=26] [siegesMax=5]
 */
import { construireMondeDuBanc } from '../packages/sim/src/scenario'
import { drainEvents } from '../packages/sim/src/events'
import { step } from '../packages/sim/src/sim'
import { TICKS_PER_CYCLE } from '../packages/sim/src/time'
import { BALANCE } from '../packages/sim/src/balance'

const SEED = Number(process.argv[2])
const JOURS_MAX = Number(process.argv[3] ?? 26)
const SIEGES_MAX = Number(process.argv[4] ?? 5)
if (!Number.isFinite(SEED)) {
  console.error('usage : node --import tsx tools/diag-siege.mts <seed> [joursMax=26] [siegesMax=5]')
  process.exit(1)
}

const { sim, monde } = construireMondeDuBanc(SEED)
console.log(`seed ${SEED} : marge ${monde.margeDeCible} % — on suit jusqu'à ${SIEGES_MAX} sièges sur ${JOURS_MAX} jours\n`)

const ENCEINTE = new Set(['wall', 'palissade', 'cloture', 'door', 'encadrement'])

interface Entree {
  tickOffset: number
  x: number
  y: number
  proches: string[] // les 3 structures du village les plus proches, « type@dist (hp) »
  fraiche: boolean //  une destruction de ce siège à ≤ 2 tuiles du point d'entrée
}
interface Siege {
  hordeId: number
  villageId: number
  nom: string
  jour: number
  startTick: number
  rayon: number
  bbox: { x0: number; y0: number; x1: number; y1: number } | null
  murs0: Record<string, { n: number; hp: number }>
  portes0: string
  membres: Set<number>
  dedans: Set<number>
  entrees: Entree[]
  detruites: { type: string; tx: number; ty: number; tickOffset: number }[]
  mortsVillageois: number
  feuHp0: number
  structId2Type: Map<number, { type: string; tx: number; ty: number }>
}
const sieges: Siege[] = []
const actifs = new Map<number, Siege>()
let finis = 0
/** L'ombre des positions de PNJ au tick précédent — la victime est déjà retirée à la mort. */
let ombrePnj = new Map<number, { x: number; y: number }>()

function inventaire(villageId: number): { murs: Record<string, { n: number; hp: number }>; portes: string; bbox: Siege['bbox']; ids: Map<number, { type: string; tx: number; ty: number }>; feuHp: number } {
  const murs: Record<string, { n: number; hp: number }> = {}
  const ids = new Map<number, { type: string; tx: number; ty: number }>()
  let portes = ''
  let feuHp = 0
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  let nMurs = 0
  for (const s of sim.structures) {
    if (s.villageId !== villageId) continue
    if (s.type === 'fire') feuHp = s.hp
    if (!ENCEINTE.has(s.type)) continue
    ids.set(s.id, { type: s.type, tx: s.tx, ty: s.ty })
    const m = (murs[s.type] ??= { n: 0, hp: 0 })
    m.n += 1
    m.hp += s.hp
    if (s.type === 'door') portes += s.open === true ? 'O' : 'F'
    if (s.type !== 'door' && s.type !== 'encadrement') {
      nMurs += 1
      x0 = Math.min(x0, s.tx); y0 = Math.min(y0, s.ty)
      x1 = Math.max(x1, s.tx); y1 = Math.max(y1, s.ty)
    }
  }
  return { murs, portes, bbox: nMurs >= 8 ? { x0, y0, x1, y1 } : null, ids, feuHp }
}

const total = JOURS_MAX * TICKS_PER_CYCLE
for (let t = 0; t < total && finis < SIEGES_MAX; t++) {
  step(sim, [])
  const jour = Math.floor(t / TICKS_PER_CYCLE) + 1

  for (const e of drainEvents(sim)) {
    if (e.type === 'horde_spawned') {
      const v = sim.villages.find((x) => x.id === e.targetVillageId)
      if (!v) continue
      const inv = inventaire(v.id)
      const s: Siege = {
        hordeId: e.hordeId,
        villageId: v.id,
        nom: v.name,
        jour,
        startTick: sim.tick,
        rayon: BALANCE.FIRE_RADIUS_BY_TIER[Math.min(v.tier, 3) - 1]!,
        bbox: inv.bbox,
        murs0: inv.murs,
        portes0: inv.portes,
        membres: new Set(sim.hordes.find((h) => h.id === e.hordeId)?.memberEntityIds ?? []),
        dedans: new Set(),
        entrees: [],
        detruites: [],
        mortsVillageois: 0,
        feuHp0: inv.feuHp,
        structId2Type: inv.ids,
      }
      actifs.set(e.hordeId, s)
      sieges.push(s)
      const desc = Object.entries(inv.murs).map(([k, m]) => `${m.n} ${k} (${m.hp} PV)`).join(', ') || 'AUCUNE enceinte'
      console.log(`── siège ${sieges.length} · j${jour} · ${v.name} (palier ${v.tier}) · ${s.membres.size} cendreux · bâti : ${desc} · portes [${inv.portes || '—'}] · ${s.bbox ? `bbox murs ${s.bbox.x1 - s.bbox.x0 + 1}×${s.bbox.y1 - s.bbox.y0 + 1}` : 'pas de périmètre (carré du Feu)'}`)
    }
    if (e.type === 'structure_destroyed' || e.type === 'structure_removed') {
      for (const s of actifs.values()) {
        const st = s.structId2Type.get(e.structureId)
        if (st) s.detruites.push({ type: st.type, tx: st.tx, ty: st.ty, tickOffset: sim.tick - s.startTick })
      }
    }
    if (e.type === 'entity_died' && !e.wasMonster) {
      for (const s of actifs.values()) {
        s.mortsVillageois += 1
        // La victime par rapport à la GÉOMÉTRIE : dans les murs, ou dehors ? C'est le lien
        // entre le siège et l'autopsie — l'ombre du tick précédent porte sa position.
        const o = ombrePnj.get(e.entityId)
        const v = sim.villages.find((x) => x.id === s.villageId)
        if (o && v) {
          const dFeu = Math.max(Math.abs(o.x - (v.fireTx + 0.5)), Math.abs(o.y - (v.fireTy + 0.5)))
          const dansMurs = s.bbox
            ? o.x >= s.bbox.x0 + 0.5 && o.x <= s.bbox.x1 + 0.5 && o.y >= s.bbox.y0 + 0.5 && o.y <= s.bbox.y1 + 0.5
            : false
          console.log(`   MORT de villageois (siège ${sieges.indexOf(s) + 1}, +${Math.round((sim.tick - s.startTick) / 20)} s) à ${Math.round(dFeu * 10) / 10} t du Feu — ${s.bbox ? (dansMurs ? 'DANS les murs' : 'HORS des murs') : 'pas de murs'}`)
        }
      }
    }
  }
  ombrePnj = new Map()
  for (const n of sim.npcs) {
    const en = sim.entities.find((x) => x.id === n.entityId)
    if (en && en.hp > 0) ombrePnj.set(n.entityId, { x: en.x, y: en.y })
  }

  for (const [hordeId, s] of actifs) {
    const v = sim.villages.find((x) => x.id === s.villageId)
    const horde = sim.hordes.find((h) => h.id === hordeId)
    for (const id of s.membres) {
      if (s.dedans.has(id)) continue
      const e = sim.entities.find((x) => x.id === id)
      if (!e || e.hp <= 0) continue
      const dansBbox = s.bbox
        ? e.x >= s.bbox.x0 + 0.5 && e.x <= s.bbox.x1 + 0.5 && e.y >= s.bbox.y0 + 0.5 && e.y <= s.bbox.y1 + 0.5
        : v !== undefined && Math.max(Math.abs(e.x - (v.fireTx + 0.5)), Math.abs(e.y - (v.fireTy + 0.5))) <= s.rayon
      if (!dansBbox) continue
      s.dedans.add(id)
      const dists: { d: number; txt: string }[] = []
      for (const [sid, st] of s.structId2Type) {
        const vivante = sim.structures.find((x) => x.id === sid)
        const d = Math.max(Math.abs(e.x - (st.tx + 0.5)), Math.abs(e.y - (st.ty + 0.5)))
        dists.push({ d, txt: `${st.type}@${Math.round(d * 10) / 10}${vivante ? ` (${Math.round(vivante.hp)} PV)` : ' (DÉTRUITE)'}` })
      }
      dists.sort((a, b) => a.d - b.d)
      const fraiche = s.detruites.some((dd) => Math.max(Math.abs(e.x - (dd.tx + 0.5)), Math.abs(e.y - (dd.ty + 0.5))) <= 2)
      s.entrees.push({
        tickOffset: sim.tick - s.startTick,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        proches: dists.slice(0, 3).map((x) => x.txt),
        fraiche,
      })
      console.log(`   ENTRÉE (siège ${sieges.indexOf(s) + 1}, +${Math.round((sim.tick - s.startTick) / 20)} s) en (${e.x.toFixed(1)}, ${e.y.toFixed(1)})${fraiche ? ' — PAR UNE BRÈCHE DE CE SIÈGE' : ''} · proches : ${dists.slice(0, 3).map((x) => x.txt).join(' · ') || 'AUCUNE structure'}`)
    }
    if (!horde || [...s.membres].every((id) => !sim.entities.some((x) => x.id === id && x.hp > 0))) {
      const inv = inventaire(s.villageId)
      const perdu = Object.entries(s.murs0)
        .map(([k, m0]) => {
          const m1 = inv.murs[k] ?? { n: 0, hp: 0 }
          return `${k}: ${m0.n - m1.n} détruites, ${Math.round(m0.hp - m1.hp)} PV perdus`
        })
        .join(' · ')
      console.log(`   FIN (siège ${sieges.indexOf(s) + 1}, ${Math.round((sim.tick - s.startTick) / TICKS_PER_CYCLE * 24)} h) : ${s.dedans.size}/${s.membres.size} entrés (${s.entrees.filter((x) => x.fraiche).length} par brèche fraîche) · morts villageois ${s.mortsVillageois} · dégâts : ${perdu || '—'} · Feu ${s.feuHp0} → ${inv.feuHp} PV · portes [${s.portes0}] → [${inv.portes || '—'}]\n`)
      actifs.delete(hordeId)
      finis += 1
    }
  }
}

console.log(`\n═══ ${finis} sièges suivis — seed ${SEED} ═══`)
for (const s of sieges.slice(0, finis)) {
  console.log(
    `  j${s.jour} ${s.nom} : ${s.dedans.size}/${s.membres.size} entrés · ${s.entrees.filter((e) => e.fraiche).length} par brèche · ` +
      `${s.detruites.length} structures d'enceinte détruites · ${s.mortsVillageois} morts`,
  )
}
