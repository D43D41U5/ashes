/**
 * ═══ LA CAVE — l'étage −1 sous une mesa (spec `etages.md`, branche B1) ═══
 *
 * *Décision d'Alexis du 2026-09-02 : « ce qu'on voit d'un étage voisin, c'est ce que la LUMIÈRE
 * atteint », puis « pars sur la cave ».* C'est le premier étage NÉGATIF du jeu, et il se creuse
 * dans ce qu'on avait déjà : une butte a un chapeau de roche, une paroi tournée au sud et une
 * jupe où l'on marche. On lui ajoute une **gueule** dans la paroi et **une salle sous le chapeau**.
 * La mesa cesse d'avoir une seule réponse (*on la monte*) pour en avoir deux (*on la monte, ou on
 * y entre*).
 *
 * ⚠ **CES GARDES SE JOUENT SUR LE MONDE JOUÉ, pas sur un montage** — c'est là que la question se
 * pose, et le montage de laboratoire ne dirait rien du worldgen.
 */
import { describe, expect, it } from 'vitest'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { CREUX } from './racine-relief'
import { NUIT, TEMPERATURE, TERRAIN_ROCK } from './balance'
import { connecteurAt, marchableAEtage, niveauDuCorps, palierDuSol } from './etages'
import { MARCHABLE, terrainAt } from './map'
import { partDuCiel, clarteSurSoiAt } from './nuit'
import { createSim, spawnEntity, step, type SimState } from './sim'

const SEED = 2026
const carte = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = carte.map

/**
 * Les salles, en composantes connexes — UN CRAN SOUS LE SOL, quel que soit le sol. Depuis les
 * terrasses (T-R4), une mesa posée au palier 2 a sa cave au niveau 1 : « la cave » n'est plus
 * l'étage −1, c'est toute tuile d'étage dont le sol est un cran plus HAUT (le chapeau au-dessus
 * de la tête). Chaque salle porte son niveau, et les gardes le lisent au lieu de dire −1.
 */
function salles(): { niveau: number; idx: number[] }[] {
  const out: { niveau: number; idx: number[] }[] = []
  for (const et of map.etages ?? []) {
    const dedans = new Set<number>()
    for (const i of et.idx) {
      const x = i % map.width
      if (palierDuSol(map, x, (i - x) / map.width) === et.niveau + 1) dedans.add(i)
    }
    const vu = new Set<number>()
    for (const depart of dedans) {
      if (vu.has(depart)) continue
      const pile = [depart]
      vu.add(depart)
      const comp: number[] = []
      while (pile.length > 0) {
        const j = pile.pop()!
        comp.push(j)
        const x = j % map.width
        const y = (j - x) / map.width
        for (const [vx, vy] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]] as const) {
          const k = vy * map.width + vx
          if (!dedans.has(k) || vu.has(k)) continue
          vu.add(k)
          pile.push(k)
        }
      }
      out.push({ niveau: et.niveau, idx: comp })
    }
  }
  return out
}

describe('la cave — le premier étage NÉGATIF', () => {
  it('LE MONDE JOUÉ EN PORTE, et chacune a UNE gueule — de DEUX tuiles, côte à côte', () => {
    const s = salles()
    expect(s.length, 'des caves existent').toBeGreaterThan(4)
    const gueules = (map.connecteurs ?? []).filter((c) => c.type === 'gueule')
    // Une gueule = une PAIRE de connecteurs (Alexis, 2026-09-02 : une fente d'une tuile se lisait
    // comme une fissure, et le corps qui la franchit en heurtait les joues).
    expect(gueules.length, 'deux connecteurs de gueule par salle').toBe(s.length * 2)
    expect(s.map((c) => c.niveau), 'la cave du monde joué vit sous les trois paliers').toEqual(
      expect.arrayContaining([-1, 0, 1]),
    )
    for (const { idx: comp } of s) {
      const portes = comp.filter((j) => connecteurAt(map, j % map.width, (j - (j % map.width)) / map.width)?.type === 'gueule')
      expect(portes.length, 'exactement une porte par salle, large de deux').toBe(2)
      const [a, b] = portes.map((j) => ({ x: j % map.width, y: (j - (j % map.width)) / map.width }))
      expect(a!.y, 'les deux tuiles de la gueule sont sur la même rangée').toBe(b!.y)
      expect(Math.abs(a!.x - b!.x), 'et voisines').toBe(1)
      // ⚠ ET ELLE A DE QUOI ÊTRE SOMBRE : une salle plus petite que la pénétration du jour
      // serait un porche, pas une cave (voir `CREUX.CAVE_TUILES`).
      expect(comp.length).toBeGreaterThan(TEMPERATURE.CIEL_PENETRATION * 2)
      expect(comp.length).toBe(CREUX.CAVE_TUILES + 2) // la salle, plus les deux tuiles de sa gueule
    }
  })

  it('E-R1 — L’ÉTAGE 0 NE BOUGE PAS : la butte reste pleine vue de dehors', () => {
    for (const { niveau, idx: comp } of salles()) {
      for (const j of comp) {
        const x = j % map.width
        const y = (j - x) / map.width
        const estGueule = connecteurAt(map, x, y)?.type === 'gueule'
        if (estGueule) {
          // La porte : marchable au sol AVANT qu'on en fasse une porte, et marchable dedans.
          expect(MARCHABLE[terrainAt(map, x, y)], `gueule (${x},${y}) au sol`).toBe(1)
          expect(marchableAEtage(map, niveau, x, y), `gueule (${x},${y}) dedans`).toBe(true)
        } else {
          // La salle : de la ROCHE au sol, exactement comme avant qu'on la creuse.
          expect(terrainAt(map, x, y), `salle (${x},${y})`).toBe(TERRAIN_ROCK)
        }
      }
    }
  })

  it('DEUX PORTES NE PARTAGENT JAMAIS UNE TUILE — sinon l’une devient muette', () => {
    // `connecteurAt` rend le PREMIER : une rampe et une gueule sur la même tuile, et c'est
    // l'une des deux qui cesse d'exister, en silence.
    const vues = new Set<number>()
    for (const c of map.connecteurs ?? []) {
      const k = c.y * map.width + c.x
      expect(vues.has(k), `(${c.x},${c.y}) porte deux connecteurs`).toBe(false)
      vues.add(k)
    }
  })

  it('IL Y FAIT NOIR À MIDI, ET LE SEUIL EST CLAIR — la profondeur se gagne', () => {
    const P = TEMPERATURE.CIEL_PENETRATION
    let fonds = 0
    for (const { niveau, idx: comp } of salles()) {
      const porte = comp.find((j) => connecteurAt(map, j % map.width, (j - (j % map.width)) / map.width) !== undefined)!
      const px = porte % map.width
      const py = (porte - px) / map.width
      const sim = createSim(SEED, { map, worldEvents: false, faunaCap: 0 })
      // SUR la gueule : on voit comme dehors.
      expect(partDuCiel(sim, px, py, niveau), 'sur le seuil').toBe(1)
      // AU FOND : la tuile de la salle la plus loin de la porte.
      let loin = porte
      let dMax = -1
      for (const j of comp) {
        const x = j % map.width
        const y = (j - x) / map.width
        const d = Math.max(Math.abs(x - px), Math.abs(y - py))
        if (d > dMax) { dMax = d; loin = j }
      }
      if (dMax <= P) continue // une salle trop tassée : elle n'a pas de fond, on ne l'invente pas
      fonds++
      const lx = loin % map.width
      const ly = (loin - lx) / map.width
      expect(partDuCiel(sim, lx, ly, niveau), `le fond de la salle (${lx},${ly}) à ${dMax} tuiles`).toBe(0)
      // …et le corps qui s'y tient est SOUS le seuil du noir, à midi comme à minuit.
      expect(clarteSurSoiAt(sim, sim.tick, lx + 0.5, ly + 0.5, false, niveau)).toBeLessThan(NUIT.SEUIL_NOIR)
      // La torche le répare — c'est ce qui en fait un outil.
      expect(clarteSurSoiAt(sim, sim.tick, lx + 0.5, ly + 0.5, true, niveau)).toBe(1)
    }
    expect(fonds, 'la garde ne peut pas passer à vide : des salles ont un vrai fond').toBeGreaterThan(3)
  })

  it('ON Y ENTRE, ET ON EN RESSORT — par la gueule, et par elle seule', () => {
    const { niveau, idx: comp } = salles()[0]!
    const porte = comp.find((j) => connecteurAt(map, j % map.width, (j - (j % map.width)) / map.width) !== undefined)!
    const px = porte % map.width
    const py = (porte - px) / map.width
    const sim: SimState = createSim(SEED, { map, worldEvents: false, faunaCap: 0, meteoActive: false })
    // On se pose sur le seuil, au sol, et on pousse vers le NORD (la salle est sous le chapeau).
    const id = spawnEntity(sim, px + 0.5, py + 0.9)
    for (let t = 0; t < 60; t++) step(sim, [{ entityId: id, dx: 0, dy: -1 }])
    const dedans = sim.entities.find((e) => e.id === id)!
    expect(dedans.etage, 'on est descendu dans la cave').toBe(niveau)
    expect(dedans.y, 'et on a bien franchi le seuil').toBeLessThan(py)
    // …puis on ressort par où l'on est venu.
    for (let t = 0; t < 120; t++) step(sim, [{ entityId: id, dx: 0, dy: 1 }])
    const dehors = sim.entities.find((e) => e.id === id)!
    expect(dehors.etage, 'on est ressorti au sol — et « au sol » ne s’écrit pas (T-R3)').toBeUndefined()
    expect(niveauDuCorps(map, dehors), 'au palier de la gueule').toBe(niveau + 1)
    expect(dehors.y, 'et on a repassé le seuil vers le sud').toBeGreaterThan(py)
  })
})
