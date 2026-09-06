/**
 * ═══ LES GROTTES DE TERRASSE — le karst est la Grotte (spec `grottes.md`) ═══
 *
 * Les gardes G-A1..G-A11. Elles se jouent sur le MONDE JOUÉ (`MONDE_JOUE`) : c'est là que la
 * question se pose, et un montage de laboratoire ne dirait rien du worldgen. Les gardes de
 * GÉNÉRATION (G-A1, G-A2) appellent `generateZonedTerrain` en direct — jamais le cache.
 */
import { describe, expect, it } from 'vitest'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { BALANCE, TEMPERATURE } from './balance'
import { atteignableEntreEtages, connecteurAt, niveauDuCorps, palierDuSol, terrainAEtage } from './etages'
import { isWater, MARCHABLE, poisAt, type WorldMap } from './map'
import { TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import { generateZonedTerrain, type CarteZonee } from './zonegen'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { KARST, pierreDuKarst, type Karst } from './zonegen-karst'
import { fondDuLieu, nidsAMonstre, spawnPoiMonsters } from './poi'
import { placeHuntingGrounds } from './faune'
import { creuserLePlancher } from './grottes-plancher'
import { isOnPoiKind } from './poi-discovery'
import { ambientTemperature, baselineTemperatureAt, isSheltered } from './temperature'
import { partDuCiel } from './nuit'
import { createSim, spawnEntity, step } from './sim'
import { PIECES, STRUCTURE_TYPES, type BarrierType } from './pieces'
import { createVillage, evaluateBuild, fireRadius, roofAt, structureAt } from './village'
import { fullTileAt } from './construction'
import { isBlockedAt } from './collision'
import type { ItemId } from './items'
import type { PlayerAction } from './sim'
import { marchableAEtage } from './etages'
import { zoneAt } from './map'
import { EDGE_N } from './geometry'

const GRAINES = [2026, 7, 99, 1234] as const

/** Toute tuile d'une grille creuse dont le niveau est SOUS le sol de sa tuile : un souterrain. */
function souterrains(map: WorldMap): { niveau: number; x: number; y: number }[] {
  const out: { niveau: number; x: number; y: number }[] = []
  for (const et of map.etages ?? []) {
    for (const i of et.idx) {
      const x = i % map.width
      const y = (i - x) / map.width
      if (et.niveau < palierDuSol(map, x, y)) out.push({ niveau: et.niveau, x, y })
    }
  }
  return out
}

describe('G-A3 — « −H » ferme la roche', () => {
  /**
   * ⚠ CETTE GARDE DOIT ROUGIR SUR LE CODE D'AVANT G-R1 (une garde prouve sa prémisse) : une cave
   * de mesa posée au palier 1 vivait au niveau 0 — l'entier de TOUT le sol du palier 0 — et E-R5
   * sortait sur `ae === be` : le loup l'atteignait à travers la roche. MESURÉ graine 2026 : 6 caves
   * sur 7 au niveau ≥ 0 avaient du sol de leur palier à 1-8 tuiles.
   *
   * L'énoncé : depuis toute tuile de SURFACE à ≤ 8 tuiles, un souterrain n'est atteignable que
   * par une gueule — un connecteur de la paire à portée (`ETAGE_PORTEE_CONNECTEUR`) de l'un des
   * deux points. Sans gueule à portée, la roche est fermée.
   */
  it.each(GRAINES)('graine %i — aucun souterrain n’est atteignable depuis la surface sans une gueule à portée', (seed) => {
    const map = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
    const sous = souterrains(map)
    expect(sous.length, 'le monde joué porte des souterrains').toBeGreaterThan(0)
    // Tout niveau de souterrain est NÉGATIF (G-R1) : l'identité `−H` ne partage aucun entier
    // avec un palier du sol, qui sont tous ≥ 0.
    for (const s of sous) expect(s.niveau, `souterrain (${s.x},${s.y})`).toBeLessThan(0)
    const R = 8
    const N = BALANCE.ETAGE_PORTEE_CONNECTEUR
    let paires = 0
    let fautes = 0
    for (const s of sous) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = s.x + dx
          const y = s.y + dy
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue
          const p = palierDuSol(map, x, y)
          const atteint = atteignableEntreEtages(map, x + 0.5, y + 0.5, p, s.x + 0.5, s.y + 0.5, s.niveau)
          if (!atteint) continue
          paires++
          // Atteint : il DOIT y avoir une gueule de la paire (p, niveau) à portée de l'un des deux.
          let gueule = false
          for (const c of map.connecteurs ?? []) {
            if (c.type !== 'gueule') continue
            if (!((c.de === p && c.vers === s.niveau) || (c.vers === p && c.de === s.niveau))) continue
            const d1 = Math.max(Math.abs(c.x - x), Math.abs(c.y - y))
            const d2 = Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
            if (d1 <= N || d2 <= N) { gueule = true; break }
          }
          if (!gueule) fautes++
        }
      }
    }
    expect(paires, 'la garde ne passe pas à vide : des couples sont atteints par la gueule').toBeGreaterThan(0)
    expect(fautes, 'couples (surface, souterrain) atteints À TRAVERS LA ROCHE').toBe(0)
  })

  it('chaque gueule joint un palier du sol à un souterrain NÉGATIF, sur sa tuile', () => {
    const map = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
    const gueules = (map.connecteurs ?? []).filter((c) => c.type === 'gueule')
    expect(gueules.length).toBeGreaterThan(0)
    for (const c of gueules) {
      expect(c.de, `gueule (${c.x},${c.y}) part du sol`).toBe(palierDuSol(map, c.x, c.y))
      expect(c.vers, `gueule (${c.x},${c.y}) descend sous zéro`).toBeLessThan(0)
      expect(connecteurAt(map, c.x, c.y)).toBe(c)
    }
  })
})

/* ─────────── LES KARSTS DE TERRASSE (G-R2, G-R3, G-R4, G-R9) ─────────── */

const xyDe = (map: WorldMap, i: number): [number, number] => [i % map.width, (i - (i % map.width)) / map.width]
const cheb = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))

describe('G-A1 — déterminisme des karsts', () => {
  it('deux générations directes rendent les mêmes karsts, grilles creuses, connecteurs, zones et traces', () => {
    const a = generateZonedTerrain(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const b = generateZonedTerrain(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    expect(a.karsts.length).toBeGreaterThan(0)
    expect(a.karsts).toEqual(b.karsts)
    expect(a.map.etages).toEqual(b.map.etages)
    expect(a.map.connecteurs).toEqual(b.map.connecteurs)
    expect(a.map.zones).toEqual(b.map.zones)
    expect(a.map.terrain).toEqual(b.map.terrain)
  }, 60_000)

  it('le chemin « vallee » (sans palier) ne porte aucun karst', () => {
    const c = generateZonedTerrain(2026, MONDE.JOUEURS_CIBLE, 'vallee')
    expect(c.karsts).toHaveLength(0)
    expect(c.map.zones.filter((z) => z.kind === 'grotte' && z.etage !== undefined)).toHaveLength(0)
  }, 60_000)
})

describe('G-A2 — le flux du PRNG ne bouge pas', () => {
  /**
   * MESURÉ le 2026-09-06, HEAD contre l'arbre (`tools/__g-a2.mts`, même exécution, graines
   * 2026 / 7 / 99) : état du PRNG après `createSim` + `spawnPoiMonsters` IDENTIQUE ; lieux tirés
   * 90 / 81 / 86 → les mêmes ; bêtes 78 → 78, aux mêmes tuiles. Nœuds du SOL : 81 624 → 81 572,
   * 74 502 → 74 468, 72 410 → 72 347 — l'écart est la stérilité des traces et des gueules (74 / 51 /
   * 74 retirés, dont des herbes et des arbres sur l'eau neuve), et le glanage qui se décale d'un
   * voisin quand sa place devient stérile (22 / 17 / 11 ajoutés). Ce qui reste GARDÉ ici : le
   * semis du karst est positionnel — deux appels sur la même carte rendent les mêmes nœuds.
   */
  it('la pierre des grottes est positionnelle : même carte, mêmes nœuds, estampillés de leur étage', () => {
    const c = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const a = placeZoneNodes(c).filter((n) => (n.etage ?? 0) < 0)
    const b = placeZoneNodes(c).filter((n) => (n.etage ?? 0) < 0)
    expect(a.length).toBeGreaterThan(0)
    expect(a).toEqual(b)
    const tuilesDeKarst = new Set(c.karsts.flatMap((k) => k.tuiles))
    for (const n of a) {
      expect(n.type === 'rock' || n.type === 'bloc', `${n.type} à (${n.tx},${n.ty})`).toBe(true)
      expect(tuilesDeKarst.has(n.ty * c.map.width + n.tx), `nœud (${n.tx},${n.ty}) hors du creusé`).toBe(true)
    }
    // Et rien du sol ne pousse sur une trace (G-R9) ni sur une gueule.
    const steriles = new Set([...c.karsts.flatMap((k) => k.trace), ...c.karsts.flatMap((k) => k.gueules.flat())])
    const sol = placeZoneNodes(c).filter((n) => (n.etage ?? 0) === 0 && steriles.has(n.ty * c.map.width + n.tx))
    expect(sol.map((n) => `${n.type}@${n.tx},${n.ty}`)).toHaveLength(0)
  })
})

/**
 * LES FAUTES DE STRUCTURE d'une carte (G-A4 ①-⑦) — sur ses karsts, TOUS : ceux de la génération
 * et ceux que le plancher (G-A7) creuse après coup, qui doivent tenir les mêmes promesses.
 */
function fautesDeStructure(c: CarteZonee): string[] {
  const { map } = c
  const { width } = map
  const autres = new Set<number>()
  for (const et of map.etages ?? []) if (et.niveau >= 0) for (const i of et.idx) autres.add(i)
  const portes = new Set((map.connecteurs ?? []).filter((k) => k.type === 'rampe').map((k) => k.y * width + k.x))
  const fautes: string[] = []
  for (const k of c.karsts) {
    const nom = `karst (${xyDe(map, k.gueules[0]![0]).join(',')})`
    const creuse = new Set(k.tuiles)
    expect(k.tuiles.length, nom).toBeLessThanOrEqual(KARST.TUILES)
    expect(k.gueules.length, nom).toBeGreaterThanOrEqual(1)
    expect(k.gueules.length, nom).toBeLessThanOrEqual(KARST.GUEULES_MAX)
    const et = (map.etages ?? []).find((e) => e.niveau === k.niveau)
    expect(et, `${nom} : un étage au niveau ${k.niveau}`).toBeDefined()
    const idx = new Set(et!.idx)
    // ① Chaque tuile creusée vit dans l'étage, et pas dans un dessus, une cave de mesa ni une rampe.
    for (const t of k.tuiles) {
      if (!idx.has(t)) fautes.push(`${nom} : tuile ${xyDe(map, t)} absente de l'étage`)
      if (autres.has(t) || c.rampe[t] || portes.has(t)) fautes.push(`${nom} : tuile ${xyDe(map, t)} sous un autre étage ou une rampe`)
    }
    // ② ≥ BOYAU_LARGEUR partout : toute tuile a un voisin creusé en X ET un en Y.
    for (const t of k.tuiles) {
      const h = creuse.has(t - 1) || creuse.has(t + 1)
      const v = creuse.has(t - width) || creuse.has(t + width)
      if (!h || !v) fautes.push(`${nom} : tuile ${xyDe(map, t)} large d'une seule tuile`)
    }
    // ③ Toute salle joignable depuis TOUTE gueule par des tuiles creusées MARCHABLES.
    const terrainDe = new Map<number, number>()
    k.tuiles.forEach((t, i) => terrainDe.set(t, k.terrain[i]!))
    for (const paire of k.gueules) {
      const vu = new Set<number>([paire[1]!])
      const file = [paire[1]!]
      while (file.length > 0) {
        const t = file.pop()!
        for (const v of [t - 1, t + 1, t - width, t + width]) {
          if (vu.has(v) || !creuse.has(v) || MARCHABLE[terrainDe.get(v)!] !== 1) continue
          vu.add(v)
          file.push(v)
        }
      }
      for (const s of k.salles) {
        if (!s.tuiles.some((t) => vu.has(t))) fautes.push(`${nom} : ${s.role} injoignable depuis la gueule ${xyDe(map, paire[1]!)}`)
      }
      if (!vu.has(k.fond)) fautes.push(`${nom} : fond injoignable depuis la gueule ${xyDe(map, paire[1]!)}`)
    }
    // ④ Le fond à ≥ FOND_DISTANCE (Chebyshev) de toute gueule.
    for (const paire of k.gueules) for (const g of paire) {
      if (cheb(xyDe(map, k.fond), xyDe(map, g)) < KARST.FOND_DISTANCE) fautes.push(`${nom} : fond à ${cheb(xyDe(map, k.fond), xyDe(map, g))} de la gueule`)
    }
    // ⑤ Chaque gueule marchable des deux côtés : la tuile au SUD (le palier, sur `map.terrain`)
    //    et la tuile au NORD (le creusé) — T-A2bis étendu au souterrain.
    for (const paire of k.gueules) for (const g of paire) {
      const [gx, gy] = xyDe(map, g)
      if (palierDuSol(map, gx, gy) !== k.palier) fautes.push(`${nom} : gueule ${[gx, gy]} hors du palier ${k.palier}`)
      // Au sud : le palier, ou l'eau PEU PROFONDE (la trace, une rive) — marchable, jamais du profond.
      if (MARCHABLE[map.terrain[g + width]!] !== 1) fautes.push(`${nom} : gueule ${[gx, gy]} sans sol marchable au sud`)
      if (!creuse.has(g - width) || MARCHABLE[terrainDe.get(g - width)!] !== 1) fautes.push(`${nom} : gueule ${[gx, gy]} sans creusé marchable au nord`)
      const conn = (map.connecteurs ?? []).find((q) => q.x === gx && q.y === gy)
      if (!conn || conn.type !== 'gueule' || conn.de !== k.palier || conn.vers !== k.niveau) fautes.push(`${nom} : gueule ${[gx, gy]} sans connecteur (${k.palier}→${k.niveau})`)
    }
    // ⑥ Les gueules d'un même karst sont écartées.
    for (let i = 0; i < k.gueules.length; i++) for (let j = i + 1; j < k.gueules.length; j++) {
      if (cheb(xyDe(map, k.gueules[i]![0]), xyDe(map, k.gueules[j]![0])) < KARST.GUEULES_ECART) fautes.push(`${nom} : deux gueules à moins de ${KARST.GUEULES_ECART}`)
    }
    // ⑦ Le lieu : une zone `grotte` à l'étage, dont (x, y) est la gueule principale ouest.
    const z = map.zones.find((q) => q.kind === 'grotte' && q.etage === k.niveau && q.y * width + q.x === k.gueules[0]![0])
    if (!z) fautes.push(`${nom} : pas de zone grotte sur sa gueule`)
    else if (z.tuiles?.length !== k.tuiles.length) fautes.push(`${nom} : la zone ne porte pas l'empreinte`)
  }
  return fautes
}

describe('G-A4 — l’arbre à tronc', () => {
  it.each(GRAINES)('graine %i — joignable de toute gueule, ≥ 2 de large, fond loin, ≤ TUILES, hors des autres étages, gueules marchables', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    expect(c.karsts.length).toBeGreaterThan(0)
    const fautes = fautesDeStructure(c)
    expect(fautes.slice(0, 12), fautes.join('\n')).toHaveLength(0)
  })

  it.each(GRAINES)('graine %i — ≤ 1 boucle : au plus un îlot de roche enclos par karst', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { width } = c.map
    const boucles: string[] = []
    for (const k of c.karsts) {
      const creuse = new Set(k.tuiles)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (const t of k.tuiles) { const [x, y] = xyDe(c.map, t); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
      // La roche qui touche le cadre (élargi d'une tuile) est le monde ; ce qui n'y touche pas est
      // un îlot enclos — une boucle du réseau. Une boucle au plus (G-R3).
      x0 -= 1; y0 -= 1; x1 += 1; y1 += 1
      const vu = new Set<number>()
      const cle = (x: number, y: number): number => y * width + x
      const file: number[] = []
      for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (!creuse.has(cle(x, y))) { vu.add(cle(x, y)); file.push(cle(x, y)) }
      for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) if (!creuse.has(cle(x, y)) && !vu.has(cle(x, y))) { vu.add(cle(x, y)); file.push(cle(x, y)) }
      while (file.length > 0) {
        const t = file.pop()!
        const [x, y] = xyDe(c.map, t)
        for (const [vx, vy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (vx < x0 || vx > x1 || vy < y0 || vy > y1) continue
          const v = cle(vx, vy)
          if (vu.has(v) || creuse.has(v)) continue
          vu.add(v)
          file.push(v)
        }
      }
      let ilots = 0
      const dansIlot = new Set<number>()
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = cle(x, y)
        if (creuse.has(t) || vu.has(t) || dansIlot.has(t)) continue
        ilots += 1
        const f = [t]; dansIlot.add(t)
        while (f.length > 0) {
          const u = f.pop()!
          for (const v of [u - 1, u + 1, u - width, u + width]) if (!creuse.has(v) && !vu.has(v) && !dansIlot.has(v)) { dansIlot.add(v); f.push(v) }
        }
      }
      if (ilots > 1) boucles.push(`karst (${xyDe(c.map, k.gueules[0]![0])}) : ${ilots} îlots`)
    }
    expect(boucles, boucles.join(' | ')).toHaveLength(0)
  })
})

describe('G-A6 — la nappe suit la famille de roche', () => {
  it.each(GRAINES)('graine %i — calcaire : profond + couronne, d’un seul tenant ; granite/argile : jamais de profond', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { width } = c.map
    const fautes: string[] = []
    let noyes = 0
    for (const k of c.karsts) {
      const nom = `karst (${xyDe(c.map, k.gueules[0]![0])}) fam ${k.famille}`
      const terrainDe = new Map<number, number>()
      k.tuiles.forEach((t, i) => terrainDe.set(t, k.terrain[i]!))
      const profondes = k.tuiles.filter((t) => terrainDe.get(t) === TERRAIN_DEEP_WATER)
      const eaux = k.tuiles.filter((t) => isWater(terrainDe.get(t)!))
      expect(k.noye, nom).toBe(k.famille < 0)
      if (k.famille < 0) {
        noyes += 1
        if (profondes.length === 0) fautes.push(`${nom} : aucune tuile profonde`)
        for (const t of profondes) for (const v of [t - 1, t + 1, t - width, t + width]) {
          if (!isWater(terrainDe.get(v) ?? -1)) fautes.push(`${nom} : profonde ${xyDe(c.map, t)} sans couronne`)
        }
        // D'UN SEUL TENANT : toute l'eau du karst se rejoint (4-voisinage) — les bassins sont reliés
        // par le fil d'eau, et le fil sort par la gueule principale.
        const eau = new Set(eaux)
        const vu = new Set<number>([eaux[0]!])
        const file = [eaux[0]!]
        while (file.length > 0) { const t = file.pop()!; for (const v of [t - 1, t + 1, t - width, t + width]) if (eau.has(v) && !vu.has(v)) { vu.add(v); file.push(v) } }
        if (vu.size !== eau.size) fautes.push(`${nom} : ${eau.size - vu.size} tuiles d'eau isolées du fil`)
        if (!eau.has(k.gueules[0]![0]! - width)) fautes.push(`${nom} : le fil ne sort pas par la gueule`)
      } else {
        if (profondes.length > 0) fautes.push(`${nom} : ${profondes.length} profondes en ${k.famille === 0 ? 'granite' : 'argile'}`)
        if (k.famille > 0 && eaux.length > 0) fautes.push(`${nom} : ${eaux.length} tuiles d'eau en argile`)
      }
    }
    expect(noyes, 'la garde ne passe pas à vide').toBeGreaterThan(0)
    expect(fautes.slice(0, 12), fautes.join('\n')).toHaveLength(0)
  })
})

describe('G-A10 — la trace', () => {
  it.each(GRAINES)('graine %i — la résurgence d’un karst noyé : ≥ 3 haut-fonds au pied de la gueule, sur map.terrain, sans dominer une terre', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    const { width, height, terrain } = map
    const p = map.palier!
    const fautes: string[] = []
    for (const k of c.karsts) {
      const nom = `karst (${xyDe(map, k.gueules[0]![0])})`
      if (!k.noye) { if (k.trace.length !== 0) fautes.push(`${nom} : une trace sur un karst sec`); continue }
      if (k.trace.length < 3) fautes.push(`${nom} : trace de ${k.trace.length} tuiles`)
      const gueule = new Set(k.gueules[0]!)
      const trace = new Set(k.trace)
      for (const t of k.trace) {
        if (terrain[t] !== TERRAIN_SHALLOW_WATER) fautes.push(`${nom} : trace ${xyDe(map, t)} n'est pas du haut-fond`)
        if (p[t] !== k.palier) fautes.push(`${nom} : trace ${xyDe(map, t)} hors du palier`)
        // T-A11 avec la trace : aucune terre marchable plus basse à côté.
        const [x, y] = xyDe(map, t)
        for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
          if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
          const j = vy * width + vx
          if (isWater(terrain[j]!) || MARCHABLE[terrain[j]!] !== 1) continue
          if (p[j]! < p[t]!) fautes.push(`${nom} : trace ${[x, y]} domine la terre ${[vx, vy]}`)
        }
      }
      // AU PIED DE LA GUEULE : la trace touche la paire de la gueule principale et se tient.
      const touche = k.trace.some((t) => [t - 1, t + 1, t - width, t + width].some((v) => gueule.has(v)))
      if (!touche) fautes.push(`${nom} : la trace ne touche pas la gueule`)
      const vu = new Set<number>([k.trace[0]!])
      const file = [k.trace[0]!]
      while (file.length > 0) { const t = file.pop()!; for (const v of [t - 1, t + 1, t - width, t + width]) if (trace.has(v) && !vu.has(v)) { vu.add(v); file.push(v) } }
      if (vu.size !== trace.size) fautes.push(`${nom} : trace en ${trace.size - vu.size + 1} morceaux`)
    }
    expect(fautes.slice(0, 12), fautes.join('\n')).toHaveLength(0)
  })

  it.each(GRAINES)('graine %i — un karst sec a une coulée qui touche sa gueule (rapporté : ceux qui n’en ont pas)', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { width } = c.map
    const coulee = new Set((c.map.coulees ?? []).filter((i) => i >= 0))
    const secs = c.karsts.filter((k) => !k.noye)
    const sans: string[] = []
    for (const k of secs) {
      const g = k.gueules[0]![1]!
      if (![g, g - 1, g + 1, g + width, g + width - 1].some((t) => coulee.has(t))) sans.push(`(${xyDe(c.map, g)})`)
    }
    expect(secs.length).toBeGreaterThan(0)
    // Une coulée ne se trace que si l'eau est à ≤ PORTEE_EAU (60) — un karst sec loin de toute
    // eau reste sans trace, et c'est rapporté, pas caché.
    expect(sans.length, `karsts secs sans coulée : ${sans.join(' ')}`).toBeLessThanOrEqual(Math.floor(secs.length / 2))
  })
})

describe('G-A5 — un lieu : la Grotte est le karst', () => {
  it.each(GRAINES)('graine %i — chaque karst est UNE zone `grotte` (x, y = sa gueule ouest), et le compte est rapporté', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    const grottes = map.zones.filter((z) => z.kind === 'grotte')
    // G-R10 : la Grotte de surface est retirée — toute Grotte est un karst, avec son étage.
    for (const z of grottes) expect(z.etage, `${z.name} sans étage`).toBeDefined()
    expect(grottes.length, 'une Grotte par karst').toBe(c.karsts.length)
    for (const k of c.karsts) {
      const [gx, gy] = xyDe(map, k.gueules[0]![0])
      const z = grottes.find((g) => g.x === gx && g.y === gy)
      expect(z, `karst (${gx},${gy}) sans Grotte`).toBeDefined()
      expect(z!.etage).toBe(k.niveau)
      expect(z!.tuiles).toEqual(k.tuiles)
      // Le fond relu sur la ZONE (ce que l'état porte) est le fond du karst (ce que le worldgen a creusé).
      expect(fondDuLieu(map, z!), `fond de ${z!.name}`).toBe(k.fond)
    }
    // RAPPORTÉ, pas plafonné (pas de cap ; un plancher, G-A7).
    console.log(`G-A5 graine ${seed} : ${grottes.length} Grottes (${c.karsts.filter((k) => k.noye).length} noyées)`)
  })

  it.each(GRAINES)('graine %i — l’abri : `isSheltered` vrai sur toute tuile creusée, faux une tuile dehors', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    const { width } = map
    const sim = createSim(seed, { map, worldEvents: false, faunaCap: 0 })
    const fautes: string[] = []
    for (const k of c.karsts) {
      const dedans = new Set(k.tuiles)
      for (const t of k.tuiles) {
        const [x, y] = xyDe(map, t)
        if (!isSheltered(sim, x, y, k.niveau)) fautes.push(`(${x},${y}) à l'étage ${k.niveau} n'abrite pas`)
        // …et c'est bien SUR l'emprise du lieu qu'on se tient (les effets de lieu, la découverte).
        if (!isOnPoiKind(sim, x + 0.5, y + 0.5, 'grotte', k.niveau)) fautes.push(`(${x},${y}) hors de la Grotte à son étage`)
        // Une tuile dehors, au même étage : la roche — personne ne s'y tient, et elle n'abrite pas.
        for (const v of [t - 1, t + 1, t - width, t + width]) {
          if (dedans.has(v)) continue
          const [vx, vy] = xyDe(map, v)
          if (terrainAEtage(map, k.niveau, vx, vy) !== 0) continue // un autre creux voisin (cave de mesa) : pas « dehors »
          if (isSheltered(sim, vx, vy, k.niveau)) fautes.push(`(${vx},${vy}) : la roche abrite`)
        }
      }
      // Au SOL, une tuile dehors devant la gueule : à l'air libre.
      for (const [o, e] of k.gueules) {
        for (const g of [o, e]) {
          const [x, y] = xyDe(map, g)
          if (isSheltered(sim, x, y + 1)) fautes.push(`(${x},${y + 1}) devant la gueule : abrité`)
          if (isOnPoiKind(sim, x + 0.5, y + 1.5, 'grotte')) fautes.push(`(${x},${y + 1}) devant la gueule : sur la Grotte`)
        }
      }
      // Et le seuil de la gueule principale, au sol, EST le lieu : c'est là qu'on l'atteint (G-R2).
      const [ox, oy] = xyDe(map, k.gueules[0]![0])
      if (!isOnPoiKind(sim, ox + 0.5, oy + 0.5, 'grotte')) fautes.push(`(${ox},${oy}) : le seuil n'est pas la Grotte`)
      // Sous la roche, aucun rectangle du sol ne compte : la stèle au-dessus de la tête n'est pas sous les pieds.
      for (const id of poisAt(map, ox + 0.5, oy + 0.5, k.niveau)) {
        if (map.zones[id]!.kind !== 'grotte') fautes.push(`(${ox},${oy}) à l'étage ${k.niveau} foule ${map.zones[id]!.name}`)
      }
    }
    expect(fautes.slice(0, 12), fautes.join('\n')).toHaveLength(0)
  })

  it('l’abri est une température STABLE, et le fond est noir à midi : la conséquence voulue de G-R5', () => {
    const c = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    const sim = createSim(2026, { map, worldEvents: false, faunaCap: 0 })
    let vus = 0
    for (const k of c.karsts) {
      const [fx, fy] = xyDe(map, k.fond)
      const [gx, gy] = xyDe(map, k.gueules[0]![0])
      // L'abri : le froid du monde y est amorti par `SHELTER_FACTOR` — LA MÊME LOI que sous un
      // toit, au bit près : lire le fond à son étage, c'est lire cette tuile avec l'abri posé.
      // Et le même corps lu AU SOL de cette tuile (le dessus de la terrasse) est à découvert.
      const dedans = ambientTemperature(sim, fx + 0.5, fy + 0.5, k.niveau)
      expect(dedans, `fond de (${gx},${gy})`).toBe(baselineTemperatureAt(sim, fx + 0.5, fy + 0.5, sim.tick, { abri: TEMPERATURE.SHELTER_FACTOR }))
      expect(ambientTemperature(sim, fx + 0.5, fy + 0.5), `dessus de (${gx},${gy})`).toBe(baselineTemperatureAt(sim, fx + 0.5, fy + 0.5, sim.tick, { abri: 1 }))
      // Le fond est à ≥ FOND_DISTANCE de toute gueule : le jour n'y entre pas (E-R13).
      expect(partDuCiel(sim, fx, fy, k.niveau), `fond de (${gx},${gy}) à ${cheb([fx, fy], [gx, gy])} tuiles`).toBe(0)
      vus++
    }
    expect(vus).toBeGreaterThan(0)
  })

  it.each(GRAINES)('graine %i — la tanière : `populateDen` pose UN sanglier au fond de 100 % des karsts, à l’étage', (seed) => {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    const sim = createSim(seed, { map, worldEvents: false, faunaCap: 0 })
    spawnPoiMonsters(sim, seed)
    const fautes: string[] = []
    for (const k of c.karsts) {
      const [gx, gy] = xyDe(map, k.gueules[0]![0])
      const zone = map.zones.findIndex((z) => z.kind === 'grotte' && z.x === gx && z.y === gy)
      const betes = sim.monsters.filter((m) => m.homePoi === zone)
      if (betes.length !== 1) { fautes.push(`karst (${gx},${gy}) : ${betes.length} bêtes`); continue }
      const m = betes[0]!
      if (m.type !== 'boar') fautes.push(`karst (${gx},${gy}) : ${m.type}`)
      const e = sim.entities.find((x) => x.id === m.entityId)!
      if (niveauDuCorps(map, e) !== k.niveau) fautes.push(`karst (${gx},${gy}) : la bête est à l'étage ${niveauDuCorps(map, e)}`)
      const [fx, fy] = xyDe(map, k.fond)
      if (Math.floor(e.x) !== fx || Math.floor(e.y) !== fy) fautes.push(`karst (${gx},${gy}) : la bête est en (${Math.floor(e.x)},${Math.floor(e.y)}), le fond en (${fx},${fy})`)
      for (const [o, ee] of k.gueules) {
        if (cheb([fx, fy], xyDe(map, o)) < KARST.FOND_DISTANCE || cheb([fx, fy], xyDe(map, ee)) < KARST.FOND_DISTANCE) fautes.push(`karst (${gx},${gy}) : le fond à < FOND_DISTANCE d'une gueule`)
      }
      if (!sim.dens.includes(zone)) fautes.push(`karst (${gx},${gy}) : pas un lieu peuplé (dens)`)
    }
    expect(fautes.slice(0, 12), fautes.join('\n')).toHaveLength(0)
    // Aucune Louvière ne loge dans un karst (G-R5 : le sanglier au régime d'aujourd'hui ; la
    // Louvière reste un lieu à elle, en lisière d'un coin de chasse).
    for (const z of map.zones) if (z.kind === 'louviere') expect(z.etage).toBeUndefined()
  })
})

describe('G-A7 — le plancher : une Grotte à portée de chaque naissance et de chaque site', () => {
  const GRAINES_PLANCHER = [2026, 42, 7, 99, 1234] as const
  const nomDe = (f: number): string => (f < 0 ? 'calcaire' : f === 0 ? 'granite' : 'argile')

  /** Le monde comme les hôtes le bâtissent : semis, coins, sites, naissances, puis le plancher. */
  function mondeAvecPlancher(seed: number) {
    const c = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const nodes = placeZoneNodes(c)
    const avant = c.karsts.length
    const grounds = placeHuntingGrounds(c.map, seed)
    const emplacements = emplacementsDeVillage(c, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(c.map) })
    const spawns = pointsDeSpawn(c, emplacements, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE), seed)
    const points = [...spawns, ...emplacements]
    const rapport = creuserLePlancher(c, nodes, points)
    return { c, nodes, avant, spawns, emplacements, points, rapport }
  }

  const grotteLaPlusProche = (c: CarteZonee, p: { tx: number; ty: number }): { d: number; k: Karst } => {
    let best = { d: Infinity, k: c.karsts[0]! }
    for (const k of c.karsts) {
      const [gx, gy] = xyDe(c.map, k.gueules[0]![0])
      const d = Math.sqrt((gx - p.tx) * (gx - p.tx) + (gy - p.ty) * (gy - p.ty))
      if (d < best.d) best = { d, k }
    }
    return best
  }

  it.each(GRAINES_PLANCHER)('graine %i — après la passe, tout point a une Grotte à ≤ PLANCHER_RAYON, sauf ceux dont la paroi la plus proche est elle-même hors rayon (rapportés)', (seed) => {
    const { c, avant, spawns, emplacements, points, rapport } = mondeAvecPlancher(seed)
    const R = KARST.PLANCHER_RAYON
    expect(points.length).toBeGreaterThan(0)
    // ⚠ CETTE GARDE DOIT ROUGIR SANS LA PASSE : MESURÉ avant elle, 3 à 10 naissances sur 17 et 13
    // à 25 sites sur 40-49 étaient à plus de 100 t de toute Grotte, sur les cinq graines.
    expect(rapport.creuses.length, 'le plancher a creusé').toBeGreaterThan(0)
    for (const k of rapport.creuses) expect(k.plancher).toBe(true)
    // Le rapport dit exactement les points hors rayon — ni plus ni moins — et chacun est JUSTIFIÉ :
    // la première paroi éligible essayée était hors rayon (ou aucune n'était plus proche que la
    // Grotte déjà là), ou la roche n'y a pas cédé.
    const horsRayon = points.filter((p) => grotteLaPlusProche(c, p).d > R)
    const rapportes = new Set(rapport.horsRayon.map((h) => `${h.tx},${h.ty}`))
    for (const p of horsRayon) expect(rapportes.has(`${p.tx},${p.ty}`), `point (${p.tx},${p.ty}) hors rayon non rapporté`).toBe(true)
    for (const h of rapport.horsRayon) {
      expect(grotteLaPlusProche(c, h).d, `(${h.tx},${h.ty}) rapporté hors rayon`).toBeGreaterThan(R)
      expect(h.paroi > R || h.refusees > 0, `(${h.tx},${h.ty}) : paroi à ${h.paroi.toFixed(0)} t, ${h.refusees} refusée(s)`).toBe(true)
    }
    const couverts = points.length - horsRayon.length
    const proche = grotteLaPlusProche(c, spawns[0]!)
    console.log(
      `G-A7 graine ${seed} : ${avant} Grottes de la roche + ${rapport.creuses.length} du plancher` +
      ` (${rapport.creuses.filter((k) => k.noye).length} noyées) · ${couverts}/${points.length} points couverts` +
      ` (${spawns.length} naissances, ${emplacements.length} sites ; ${horsRayon.length} hors rayon)` +
      ` · Grotte la plus proche de la naissance : ${proche.d.toFixed(0)} t, ${nomDe(proche.k.famille)}${proche.k.plancher ? ' (plancher)' : ''}`,
    )
  })

  it.each(GRAINES_PLANCHER)('graine %i — une Grotte du plancher tient les promesses de G-A4, et la carte reste saine', (seed) => {
    const { c, nodes, rapport } = mondeAvecPlancher(seed)
    const { map } = c
    const { width } = map
    expect(fautesDeStructure(c)).toHaveLength(0)
    // Les grilles creuses restent triées, alignées, et deux karsts ne partagent aucune tuile.
    const vues = new Set<number>()
    for (const et of map.etages ?? []) {
      expect(et.terrain.length).toBe(et.idx.length)
      for (let i = 1; i < et.idx.length; i++) expect(et.idx[i]!).toBeGreaterThan(et.idx[i - 1]!)
    }
    for (const k of c.karsts) for (const t of k.tuiles) {
      expect(vues.has(t), `tuile ${xyDe(map, t)} dans deux karsts`).toBe(false)
      vues.add(t)
    }
    // La pierre du cœur est là, à l'étage ; rien ne pousse sur une gueule ni sur la trace (G-R9).
    const ids = new Set<number>()
    for (const n of nodes) {
      expect(ids.has(n.id), `id ${n.id} en double`).toBe(false)
      ids.add(n.id)
    }
    const auSol = new Set<number>()
    for (const n of nodes) if (n.etage === undefined) auSol.add(n.ty * width + n.tx)
    const chemins = (map.coulees ?? []).join(',').split(',-1,')
    for (const k of rapport.creuses) {
      const tuiles = new Set(k.tuiles)
      const attendue = pierreDuKarst(k, width).length
      const pierre = nodes.filter((n) => n.etage === k.niveau && tuiles.has(n.ty * width + n.tx))
      expect(pierre.length, `karst (${xyDe(map, k.gueules[0]![0])}) : pierre du cœur`).toBe(attendue)
      expect(attendue).toBeGreaterThan(0)
      for (const t of [...k.trace, ...k.gueules.flat()]) expect(auSol.has(t), `nœud au sol en ${xyDe(map, t)} sur une gueule ou la trace`).toBe(false)
      // Un karst sec a au plus une coulée depuis sa gueule principale (G-R9).
      if (!k.noye) {
        const g = String(k.gueules[0]![1])
        expect(chemins.filter((ch) => ch.split(',')[0] === g).length, `karst sec (${xyDe(map, k.gueules[0]![1])}) : coulées`).toBeLessThanOrEqual(1)
      }
    }
    // Jamais de Louvière dans une Grotte du plancher.
    for (const z of map.zones) if (z.kind === 'louviere') expect(z.etage).toBeUndefined()
  })

  it('la passe est déterministe et idempotente : deux fois le même monde, et une seconde passe ne creuse rien', () => {
    const a = mondeAvecPlancher(2026)
    const b = mondeAvecPlancher(2026)
    expect(b.rapport).toEqual(a.rapport)
    expect(b.c.map.etages).toEqual(a.c.map.etages)
    expect(b.c.map.zones).toEqual(a.c.map.zones)
    expect(b.nodes).toEqual(a.nodes)
    const encore = creuserLePlancher(a.c, a.nodes, a.points)
    expect(encore.creuses).toHaveLength(0)
  })
})

describe('G-A13 — le TP de debug sait viser un étage : le fond se photographie, il ne se marche pas', () => {
  it('avec `etage`, l’avatar atterrit SOUS la roche ; sans, sur le sol de la tuile — le jeu d’avant', () => {
    const c = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    const sim = createSim(2026, { map, worldEvents: false, faunaCap: 0, debug: true })
    const k = c.karsts[0]!
    const [fx, fy] = xyDe(map, k.fond)
    const [gx, gy] = xyDe(map, k.gueules[0]![0])
    const player = spawnEntity(sim, gx + 0.5, gy + 2.5)
    const e = sim.entities.find((x) => x.id === player)!
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'debug_teleport', x: fx + 0.5, y: fy + 0.5, etage: k.niveau } }])
    expect(niveauDuCorps(map, e)).toBe(k.niveau)
    expect([Math.floor(e.x), Math.floor(e.y)]).toEqual([fx, fy])
    // Sans `etage` : le sol de la tuile (la terrasse qui coiffe la salle) — jamais la salle.
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'debug_teleport', x: fx + 0.5, y: fy + 0.5 } }])
    expect(niveauDuCorps(map, e)).toBe(palierDuSol(map, fx, fy))
    // Un étage qui ne porte AUCUN sol à cette tuile est ignoré : l'atterrissage d'avant.
    step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'debug_teleport', x: gx + 0.5, y: gy + 2.5, etage: k.niveau } }])
    expect(niveauDuCorps(map, e)).toBe(palierDuSol(map, gx, gy + 2))
  })
})

/* ─────────── LE BIVOUAC (G-R7) ─────────── */

describe('G-A9 — le bivouac : chaque pièce dit si elle se pose sous la roche, et la surface ne voit rien', () => {
  /**
   * Le montage : un joueur chef d'un village de surface (palier 3, le carré le plus large), debout
   * SOUS la terrasse dans la salle d'un karst, une tuile sèche devant lui. Le carré du Feu n'a pas
   * d'étage : c'est le SEUL rayon qui compte, et il enjambe la roche — c'est ce qui rend le
   * bivouac possible sans ouvrir une porte spéciale.
   */
  function montage() {
    const c = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    const { map } = c
    for (const k of c.karsts) {
      const g = k.gueules[0]![0]
      const [gx, gy] = xyDe(map, g)
      const gueules = new Set(k.gueules.flat())
      const sec = (i: number): boolean => {
        const [x, y] = xyDe(map, i)
        return !gueules.has(i) && marchableAEtage(map, k.niveau, x, y) && !isWater(terrainAEtage(map, k.niveau, x, y))
      }
      for (const i of k.tuiles) {
        if (!sec(i)) continue
        const [tx, ty] = xyDe(map, i)
        // Sous la TERRASSE (pas sous la tuile de la gueule), dans le carré, hors de tout landmark.
        if (palierDuSol(map, tx, ty) !== k.palier + 1) continue
        if (cheb([tx, ty], [gx, gy]) > fireRadius(BALANCE.FIRE_RADIUS_BY_TIER.length) || cheb([tx, ty], [gx, gy]) < 2) continue
        if (zoneAt(map, tx + 0.5, ty + 0.5) !== undefined) continue
        const voisin = [i - 1, i + 1, i - map.width, i + map.width].find((j) => sec(j) && palierDuSol(map, ...xyDe(map, j)) === k.palier + 1)
        if (voisin === undefined) continue
        const [sx, sy] = xyDe(map, voisin)
        const sim = createSim(2026, { map, worldEvents: false, faunaCap: 0, debug: true })
        const player = spawnEntity(sim, gx + 0.5, gy + 2.5)
        const e = sim.entities.find((x) => x.id === player)!
        // Le Feu du village À LA GUEULE : c'est de lui que se mesure le carré, et la salle en fait partie.
        const village = createVillage(sim, { chiefId: player, tx: gx, ty: gy, npcsArrived: true })
        village.tier = BALANCE.FIRE_RADIUS_BY_TIER.length
        step(sim, [{ entityId: player, dx: 0, dy: 0, action: { type: 'debug_teleport', x: sx + 0.5, y: sy + 0.5, etage: k.niveau } }])
        expect(niveauDuCorps(map, e)).toBe(k.niveau)
        return { sim, map, k, player, e, tx, ty, village }
      }
    }
    throw new Error('aucun karst ne porte une tuile sèche sous la terrasse à portée du carré — le montage est faux, pas le jeu')
  }
  const agir = (sim: ReturnType<typeof createSim>, player: number, action: PlayerAction): void => {
    step(sim, [{ entityId: player, dx: 0, dy: 0, action }])
  }
  const vider = (e: { inventory: (unknown | null)[] }): void => { for (let i = 0; i < e.inventory.length; i++) e.inventory[i] = null }

  it('exhaustive sur PIECES : `sousRoche` est un booléen sur chaque entrée, et la pose le lit', () => {
    const { sim, k, player, e, tx, ty } = montage()
    const chez = (): ReturnType<typeof structureAt> => structureAt(sim.structures, tx, ty, k.niveau)
    let poses = 0
    let refus = 0
    for (const type of STRUCTURE_TYPES) {
      const def = PIECES[type]
      expect(typeof def.sousRoche, `PIECES.${type}.sousRoche`).toBe('boolean')
      if (def.pose === 'monde') continue // posé à l'amorce par les plans, jamais par un bras
      vider(e)
      if (def.pose === 'objet') {
        agir(sim, player, { type: 'debug_grant', item: type as ItemId })
        agir(sim, player, { type: 'place_component', tx, ty })
        const s = chez()
        expect(s !== undefined, `${type} posé sous la roche`).toBe(def.sousRoche)
        if (s) {
          expect(s.type).toBe(type)
          expect(s.etage, `${type} porte son étage`).toBe(k.niveau)
          sim.structures.splice(sim.structures.indexOf(s), 1)
        }
      } else if (def.pose === 'marteau') {
        agir(sim, player, { type: 'debug_grant', item: 'hammer' })
        const ev = evaluateBuild(sim, player, type as BarrierType, tx, ty, undefined, def.arete === 'requise' ? EDGE_N : undefined)
        expect(ev.ok, `${type} au marteau sous la roche`).toBe(def.sousRoche)
        if (!ev.ok) expect(ev.reason).toBe('sous_roche')
      } else {
        agir(sim, player, { type: 'debug_grant', item: 'campfire' })
        agir(sim, player, { type: 'place_campfire', tx, ty })
        const s = chez()
        expect(s !== undefined, 'le feu de camp sous la roche').toBe(def.sousRoche)
        if (s) {
          expect(s.etage).toBe(k.niveau)
          sim.structures.splice(sim.structures.indexOf(s), 1)
        }
      }
      if (def.sousRoche) poses++
      else refus++
    }
    // La garde ne passe pas à vide : des deux côtés, des pièces ont été jugées.
    expect(poses).toBeGreaterThan(0)
    expect(refus).toBeGreaterThan(0)
  })

  it('une structure à `etage < 0` n’existe pas pour la surface — ni à l’œil des accesseurs, ni pour la collision', () => {
    const { sim, map, k, player, tx, ty } = montage()
    const surface = { map, structures: sim.structures }
    const salle = { map, structures: sim.structures, etages: [k.niveau] }
    const avant = isBlockedAt(surface, tx, ty)
    expect(isBlockedAt(salle, tx, ty), 'la tuile visée est libre dans la salle').toBe(false)
    agir(sim, player, { type: 'debug_grant', item: 'chest' })
    agir(sim, player, { type: 'place_component', tx, ty })
    const s = structureAt(sim.structures, tx, ty, k.niveau)
    expect(s?.type).toBe('chest')
    // La vue de SURFACE (sans étage) : rien, sur les trois lectures que le jeu fait d'une tuile.
    expect(structureAt(sim.structures, tx, ty)).toBeUndefined()
    expect(roofAt(sim.structures, tx, ty)).toBeUndefined()
    expect(fullTileAt(sim.structures, tx, ty)).toBeUndefined()
    expect(fullTileAt(sim.structures, tx, ty, k.niveau)).toBe(s)
    // La collision : le coffre bloque celui qui marche dans la salle, et ne change rien au sol.
    expect(isBlockedAt(salle, tx, ty)).toBe(true)
    expect(isBlockedAt(surface, tx, ty)).toBe(avant)
  })

  it('un feu sous la roche est un bivouac : il ne fonde pas de village', () => {
    const { sim, map, k, tx, ty, e } = montage()
    // Un SECOND joueur, sans foyer : c'est lui que « déjà un foyer » ne peut pas arrêter.
    const autre = spawnEntity(sim, e.x, e.y)
    const a = sim.entities.find((x) => x.id === autre)!
    step(sim, [{ entityId: autre, dx: 0, dy: 0, action: { type: 'debug_teleport', x: e.x, y: e.y, etage: k.niveau } }])
    expect(niveauDuCorps(map, a)).toBe(k.niveau)
    agir(sim, autre, { type: 'debug_grant', item: 'campfire' })
    agir(sim, autre, { type: 'place_campfire', tx, ty })
    const feu = structureAt(sim.structures, tx, ty, k.niveau)
    expect(feu?.type).toBe('fire')
    expect(feu!.etage).toBe(k.niveau)
    expect(feu!.villageId).toBe(0)
    const villages = sim.villages.length
    agir(sim, autre, { type: 'found_village', structureId: feu!.id })
    expect(sim.villages.length).toBe(villages)
    expect(feu!.villageId).toBe(0)
  })
})
