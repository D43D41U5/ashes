/**
 * LES LIEUX BÂTIS — le plan doit être honnête, et le bâti doit rester traversable.
 *
 * Ces gardes ne remplacent pas l'œil (un lieu se juge en jeu), elles protègent contre les
 * fautes qu'on ne verrait QU'en jeu, sur une seed particulière : un plan qui déborde de son
 * empreinte, une exception de contour qui ne perce rien, et surtout un bâtiment SCELLÉ — un
 * dedans où l'on n'entre pas se voit de loin, se contourne, et ne se comprend jamais.
 */
import { describe, expect, it } from 'vitest'
import { BUILT_KINDS, PLANS, buildPoiStructures, regionDe, verifierPlans } from './poi-batis'
import { POI_TYPES } from './poi'
import { createEmptyMap } from './map'
import { TERRAIN_GRASS } from './balance'
import { createSim } from './sim'

const footprintDe = (kind: string): number | undefined => POI_TYPES.find((t) => t.slug === kind)?.footprint

describe('les plans', () => {
  it('sont carrés, à la taille de leur empreinte, et n’emploient que des pièces connues', () => {
    expect(verifierPlans(footprintDe)).toEqual([])
  })

  it('n’ont de plan que pour des lieux qui existent', () => {
    const slugs = new Set(POI_TYPES.map((t) => t.slug))
    for (const kind of BUILT_KINDS) expect(slugs.has(kind), `${kind} n’est pas un lieu`).toBe(true)
  })

  /**
   * LE DEDANS SE REJOINT, ET REJOINT LE DEHORS.
   *
   * On rejoue la dérivation du poseur : chaque arête du contour d'une région porte une
   * barrière, SAUF si le plan la déclare brèche, seuil (un encadrement, qui laisse passer) ou
   * passage. On inonde alors depuis le dehors à travers les franchissements ouverts, et on
   * exige que toute tuile de région soit atteinte.
   *
   * C'est le MÊME calcul que `buildPoiStructures` — s'il diverge, la garde ne garde plus rien.
   */
  it('laissent le dedans rejoindre le dehors', () => {
    for (const [kind, plan] of Object.entries(PLANS)) {
      const n = plan.grille.length
      const reg = (x: number, y: number): 'salle' | 'cour' | undefined =>
        (x < 0 || y < 0 || x >= n || y >= n ? undefined : regionDe(plan.grille[y]![x]!))
      const ouvertes = new Set([...(plan.breches ?? []), ...(plan.seuils ?? []), ...(plan.passages ?? [])])
      const DIRS: readonly [string, number, number][] = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['O', -1, 0]]
      const INV: Record<string, string> = { N: 'S', S: 'N', E: 'O', O: 'E' }
      /** Le franchissement (x,y) → voisin est-il barré ? */
      const barre = (x: number, y: number, d: string, dx: number, dy: number): boolean => {
        const ici = reg(x, y)
        const la = reg(x + dx, y + dy)
        if (ici === la) return false //                       même pièce : rien entre les deux
        if (ici === 'cour' && la === 'salle') return false //  on ne clôture pas contre son mur
        if (la === 'cour' && ici === 'salle') return !ouvertes.has(`${x + dx},${y + dy},${INV[d]}`)
        if (ici !== undefined) return !ouvertes.has(`${x},${y},${d}`)
        if (la !== undefined) return !ouvertes.has(`${x + dx},${y + dy},${INV[d]}`)
        return false //                                       dehors ↔ dehors : libre
      }
      // Depuis le coin (−1,−1), qui est forcément dehors.
      const vus = new Set(['-1,-1'])
      const file: [number, number][] = [[-1, -1]]
      for (let h = 0; h < file.length; h++) {
        const [x, y] = file[h]!
        for (const [d, dx, dy] of DIRS) {
          const nx = x + dx
          const ny = y + dy
          if (nx < -1 || ny < -1 || nx > n || ny > n) continue
          const k = `${nx},${ny}`
          if (vus.has(k) || barre(x, y, d, dx, dy)) continue
          vus.add(k)
          file.push([nx, ny])
        }
      }
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (reg(x, y) === undefined) continue
          expect(vus.has(`${x},${y}`), `${kind} : la tuile (${x},${y}) est murée — un dedans injoignable`).toBe(true)
        }
      }
    }
  })
})

describe('buildPoiStructures', () => {
  const monde = (kind: string) => {
    const map = createEmptyMap(64, 64, TERRAIN_GRASS)
    const fp = footprintDe(kind)!
    map.zones.push({ name: 'essai', x: 10, y: 10, w: fp, h: fp, kind })
    return createSim(7, { map })
  }

  it('bâtit la ferme, et n’y met aucun composant (aucune fonction fantôme)', () => {
    const sim = monde('ferme_ruinee')
    buildPoiStructures(sim, 7)
    expect(sim.structures.length).toBeGreaterThan(30)
    expect(sim.functions).toEqual([])
  })

  it('pose tout en `public` et sans village — donc pillable, et indémolissable', () => {
    const sim = monde('ferme_ruinee')
    buildPoiStructures(sim, 7)
    for (const s of sim.structures) {
      expect(s.villageId).toBe(0)
      expect(s.ownerId).toBe(0)
      expect(s.access).toBe('public')
    }
  })

  /**
   * LES MURS SONT MINCES, ET SUR LA TUILE DU DEHORS. C'est l'invariant du modèle : si une
   * barrière naissait sans `edges`, elle prendrait sa tuile entière et rognerait la salle —
   * exactement ce qu'on vient de quitter.
   */
  it('ne pose que des barrières à ARÊTES, jamais des tuiles pleines', () => {
    const sim = monde('ferme_ruinee')
    buildPoiStructures(sim, 7)
    for (const s of sim.structures) {
      if (s.type !== 'wall' && s.type !== 'cloture' && s.type !== 'encadrement') continue
      expect(s.edges, `${s.type} en (${s.tx},${s.ty}) n’a pas d’arêtes`).toBeGreaterThan(0)
    }
  })

  /**
   * UNE SEULE BARRIÈRE PAR TUILE — l'invariant qui protège `structureAt` (appelé à 35 endroits)
   * et, avec lui, toute la collision indexée. Un angle est un mur à deux BITS, jamais deux murs
   * empilés.
   *
   * NB — sur ce plan, aucun mur ne porte deux bits, et c'est normal : la salle et la cour sont
   * des RECTANGLES. Une tuile extérieure ne borde deux tuiles d'une même région qu'à un coin
   * RENTRANT, et un rectangle n'en a pas. Le cas à deux bits est couvert par le test suivant,
   * sur une région en L.
   */
  it('ne pose qu’UNE barrière par tuile', () => {
    const sim = monde('ferme_ruinee')
    buildPoiStructures(sim, 7)
    const parTuile = new Map<string, number>()
    for (const s of sim.structures) {
      if (s.type !== 'wall' && s.type !== 'cloture' && s.type !== 'encadrement') continue
      const k = `${s.tx},${s.ty}`
      parTuile.set(k, (parTuile.get(k) ?? 0) + 1)
    }
    for (const [k, n] of parTuile) expect(n, `${n} barrières empilées en ${k}`).toBe(1)
  })

  it('un COIN RENTRANT donne un mur à DEUX arêtes, sur une seule structure', () => {
    // Une salle en L : la tuile extérieure au creux du L borde deux tuiles de salle, donc
    // porte deux bits. C'est le cas que le modèle doit savoir fusionner — sans quoi on
    // empilerait deux murs sur une tuile et `structureAt` n'en verrait qu'un.
    const map = createEmptyMap(32, 32, TERRAIN_GRASS)
    map.zones.push({ name: 'L', x: 4, y: 4, w: 5, h: 5, kind: 'ferme_ruinee' })
    const sim = createSim(7, { map })
    const original = PLANS.ferme_ruinee!
    ;(PLANS as Record<string, unknown>).ferme_ruinee = {
      usure: 1,
      grille: ['·····', '·..··', '·..··', '·....', '·····'],
      seuils: ['1,3,S'],
    }
    try {
      buildPoiStructures(sim, 7)
      const bits = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)
      const doubles = sim.structures.filter((s) => s.type === 'wall' && bits(s.edges ?? 0) >= 2)
      expect(doubles.length, 'le creux du L doit porter un mur à deux arêtes').toBeGreaterThan(0)
    } finally {
      ;(PLANS as Record<string, unknown>).ferme_ruinee = original
    }
  })

  it('la salle garde son dallage : autant de sols que de tuiles de salle', () => {
    const sim = monde('ferme_ruinee')
    buildPoiStructures(sim, 7)
    const sols = sim.structures.filter((s) => s.type === 'floor').length
    const salle = PLANS.ferme_ruinee!.grille.join('').split('').filter((c) => regionDe(c) === 'salle').length
    expect(sols).toBe(salle)
  })

  it('use le bâti de la ruine, jamais celui de la cabane debout', () => {
    const ruine = monde('ferme_ruinee')
    buildPoiStructures(ruine, 7)
    const murRuine = ruine.structures.find((s) => s.type === 'wall')!
    const debout = monde('cabane')
    buildPoiStructures(debout, 7)
    const murCabane = debout.structures.find((s) => s.type === 'wall')!
    expect(murRuine.hp).toBeLessThan(murCabane.hp)
  })

  it('est déterministe : deux générations posent exactement les mêmes pièces — sur TOUS les plans', () => {
    for (const kind of BUILT_KINDS) {
      const a = monde(kind)
      const b = monde(kind)
      buildPoiStructures(a, 7)
      buildPoiStructures(b, 7)
      const cle = (s: { type: string; tx: number; ty: number; hp: number; edges?: number }) =>
        `${s.type}@${s.tx},${s.ty}:${s.hp}:${s.edges ?? '-'}`
      expect(a.structures.map(cle), kind).toEqual(b.structures.map(cle))
      expect(
        a.nodes.map((n) => `${n.type}@${n.tx},${n.ty}:${n.stock}`),
        kind,
      ).toEqual(b.nodes.map((n) => `${n.type}@${n.tx},${n.ty}:${n.stock}`))
    }
  })

  /**
   * LA FOUILLE EXISTE PARTOUT (spec lieux-batis A3) : chaque plan de l'étage 1 sème au moins
   * un nœud `rubble` — le lieu ne DONNE rien, mais il y a toujours quelque chose à y fouiller.
   * Sur le vrai objet (les nœuds semés), pas sur les caractères du plan.
   */
  it('chaque plan de l’étage 1 sème au moins un nœud rubble', () => {
    for (const kind of ['ferme_ruinee', 'ruines', 'abri', 'mine', 'oratoire', 'bivouac', 'charrette', 'epave']) {
      const sim = monde(kind)
      buildPoiStructures(sim, 7)
      const rubble = sim.nodes.filter((n) => n.type === 'rubble')
      expect(rubble.length, `${kind} ne sème aucun rubble`).toBeGreaterThan(0)
    }
  })

  /** Et la fouille la plus riche est celle de la mine (spec lieux-batis, tableau des plans). */
  it('la mine porte trois tas de gravats — la fouille la plus riche du périmètre', () => {
    const sim = monde('mine')
    buildPoiStructures(sim, 7)
    expect(sim.nodes.filter((n) => n.type === 'rubble').length).toBe(3)
  })

  /**
   * LA COUR EST VERS LE BAS, PARTOUT (décision d'Alexis, 2026-07-27).
   *
   * La ferme est un plan `fixe` : elle ne prend pas le quart de tour positionnel. La garde le
   * dit en géométrie, pas en lisant le drapeau — on vérifie que TOUTE tuile de cour tombe au
   * sud de TOUTE tuile de salle, à quatre emplacements dont les quarts diffèrent.
   */
  it('la ferme ne tourne pas : sa cour reste au SUD de sa salle, où qu’elle se pose', () => {
    const fp = footprintDe('ferme_ruinee')!
    for (const [x, y] of [[3, 3], [10, 10], [17, 41], [40, 22]] as const) {
      const map = createEmptyMap(64, 64, TERRAIN_GRASS)
      map.zones.push({ name: 'essai', x, y, w: fp, h: fp, kind: 'ferme_ruinee' })
      const sim = createSim(7, { map })
      buildPoiStructures(sim, 7)
      const salle = sim.structures.filter((s) => s.type === 'floor')
      const cour = sim.structures.filter((s) => s.type === 'terre')
      expect(salle.length).toBeGreaterThan(0)
      expect(cour.length).toBeGreaterThan(0)
      const basDeLaSalle = Math.max(...salle.map((s) => s.ty))
      const hautDeLaCour = Math.min(...cour.map((s) => s.ty))
      expect(hautDeLaCour, `en (${x},${y}) la cour n’est pas sous la salle`).toBeGreaterThan(basDeLaSalle)
    }
  })

  /** Et ce qui n'est PAS `fixe` tourne toujours : la cabane se présente autrement selon où elle tombe. */
  it('un plan sans `fixe` prend toujours son quart de tour positionnel', () => {
    const paillasse = (x: number, y: number): string => {
      const map = createEmptyMap(64, 64, TERRAIN_GRASS)
      map.zones.push({ name: 'essai', x, y, w: 5, h: 5, kind: 'cabane' })
      const sim = createSim(7, { map })
      buildPoiStructures(sim, 7)
      const s = sim.structures.find((st) => st.type === 'paillasse')!
      return `${s.tx - x},${s.ty - y}`
    }
    const vus = new Set([3, 10, 17, 24, 31, 38, 45].map((d) => paillasse(d, d)))
    expect(vus.size, 'la cabane devrait se présenter d’au moins deux façons').toBeGreaterThan(1)
  })

  it('ne bâtit rien sur un lieu sans plan', () => {
    const sim = monde('cairn')
    buildPoiStructures(sim, 7)
    expect(sim.structures).toEqual([])
  })
})
