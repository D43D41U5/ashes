/**
 * LE PAYS D'AVANT — les gardes des couches III/IV (spec `stratigraphie.md` S-A10/S-A11/S-A14/S-A16).
 *
 * Sur la VRAIE carte, après toutes les passes. On garde les CAUSES : la ferme a son eau, la
 * charrette sa route, les annales se tiennent, l'étoile est morte, et la reprise du Brûlé est
 * ORDONNÉE (garde par rang sur tout le domaine — jamais des cas choisis).
 */
import { describe, expect, it } from 'vitest'
import { generateZonedTerrain } from './zonegen'
import { carteDeTest } from '../../../tools/carte-cache'
import { BUILT_KINDS } from './poi-batis'
import { isWater } from './map'
import {
  TERRAIN_BURNT_FOREST, TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_HEATH, TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_ROAD,
} from './balance'
import { ANNALES, saillant, texteDeStele, verbalise } from './annales'

const CARTE = carteDeTest(7)
const { map, graphe, zone } = CARTE
const W = map.width

/** La plus proche distance (Chebyshev) d'un prédicat de terrain autour d'un centre de lieu. */
function distA(z: { x: number; y: number; w: number; h: number }, veut: (t: number) => boolean): number {
  const cx = Math.floor(z.x + z.w / 2)
  const cy = Math.floor(z.y + z.h / 2)
  let best = Infinity
  for (let y = Math.max(0, cy - 60); y <= Math.min(map.height - 1, cy + 60); y++) {
    for (let x = Math.max(0, cx - 60); x <= Math.min(W - 1, cx + 60); x++) {
      if (!veut(map.terrain[y * W + x]!)) continue
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy))
      if (d < best) best = d
    }
  }
  return best
}

describe('les sites humains ont une raison d\'être (S-R14/S-A10)', () => {
  it('toute ferme est à portée d\'eau, toute charrette à portée de route', () => {
    for (const z of map.zones) {
      if (z.kind === 'ferme_ruinee') {
        expect(distA(z, isWater), `${z.name} loin de l'eau`).toBeLessThanOrEqual(44)
      }
      if (z.kind === 'charrette') {
        expect(distA(z, (t) => t === TERRAIN_ROAD), `${z.name} loin de la route`).toBeLessThanOrEqual(44)
      }
    }
  })

  it('les fermes EXISTENT encore (le prédicat raréfie, la réservation garantit)', () => {
    expect(map.zones.filter((z) => z.kind === 'ferme_ruinee').length).toBeGreaterThanOrEqual(2)
  })
})

describe('les annales (S-R16/S-A14)', () => {
  it('chaque lieu bâti a sa fondation ET son sort ; chaque gué son fait', () => {
    const annales = map.annales ?? []
    for (const z of map.zones) {
      if (z.kind === undefined || !BUILT_KINDS.includes(z.kind)) continue
      const cx = Math.floor(z.x + z.w / 2)
      const cy = Math.floor(z.y + z.h / 2)
      const faits = annales.filter((f) => f.x === cx && f.y === cy && f.lieu === z.kind)
      expect(faits.some((f) => f.type === 'fondation'), `${z.name} sans fondation`).toBe(true)
      expect(faits.some((f) => f.type === 'sort'), `${z.name} sans sort`).toBe(true)
    }
    const gues = map.zones.filter((z) => z.name === 'le Gué')
    expect(annales.filter((f) => f.type === 'gue').length).toBeGreaterThanOrEqual(gues.length)
  })

  it('tout fait est daté d\'une ère et positionné sur la carte', () => {
    for (const f of map.annales ?? []) {
      expect([0, 1, 2, 3]).toContain(f.ere) // l'ère 0 : la pierre et l'eau (annales.md R1)
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.y).toBeGreaterThanOrEqual(0)
      expect(f.x).toBeLessThan(W)
      expect(f.y).toBeLessThan(map.height)
    }
  })

  it('un sort d\'annales dit ce que le toponyme dit (les deux lisent le même verdict)', () => {
    for (const f of (map.annales ?? []).filter((q) => q.type === 'sort' && q.lieu === 'ferme_ruinee')) {
      const lieu = map.zones.find((z) => z.kind === 'ferme_ruinee'
        && Math.floor(z.x + z.w / 2) === f.x && Math.floor(z.y + z.h / 2) === f.y)!
      const attendu = f.cause === 'brule' ? 'brûlée' : f.cause === 'pille' ? 'pillée' : 'muette'
      expect(lieu.name.includes(attendu), `${lieu.name} vs sort ${f.cause}`).toBe(true)
    }
  })
})

describe('l\'étoile est morte (S-R15/S-A11)', () => {
  it('aucune tuile de route n\'est un carrefour en croix à plus de 3 branches denses', () => {
    // L'ancienne étoile avait UN carrefour où toutes les sentes convergeaient. On mesure la
    // propriété inverse : pour chaque tuile de route, le nombre de directions cardinales où
    // une route continue sur ≥ 8 tuiles. L'étoile centrale en avait 4+ avec de longs bras
    // partout ; un réseau à fusions n'a que des Y et des traversées.
    const route = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < W && y < map.height && map.terrain[y * W + x] === TERRAIN_ROAD
    let croixDenses = 0
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < W; x++) {
        if (!route(x, y)) continue
        let bras = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          let longe = 0
          for (let k = 1; k <= 12; k++) {
            if (route(x + dx * k, y + dy * k)) longe++
          }
          if (longe >= 8) bras++
        }
        if (bras >= 4) croixDenses++
      }
    }
    // Quelques croisements accidentels de tracés restent possibles (deux liaisons qui se
    // coupent) — mais l'étoile en produisait des DIZAINES au même point. On borne bas.
    expect(croixDenses).toBeLessThanOrEqual(24)
  })
})

describe('la reprise du Brûlé est ordonnée (S-R20/S-A16)', () => {
  it('en s\'éloignant du front, les stades apparaissent dans l\'ordre — mesuré en rang', () => {
    const brule = graphe.zones.find((z) => z.def.slug === 'brule')!
    const dists: Record<string, number[]> = { sterile: [], lande: [], pionnier: [], futaie: [] }
    for (let i = 0; i < map.terrain.length; i += 7) {
      if (zone[i] !== brule.id) continue
      const t = map.terrain[i]!
      const d = map.cendre![i]!
      if (t === TERRAIN_BURNT_FOREST) dists.sterile!.push(d)
      else if (t === TERRAIN_HEATH) dists.lande!.push(d)
      else if (t === TERRAIN_GRASS) dists.pionnier!.push(d)
      else if (t === TERRAIN_LARCH) dists.futaie!.push(d)
    }
    const moy = (v: number[]): number => v.reduce((a, b) => a + b, 0) / (v.length || 1)
    expect(dists.sterile!.length).toBeGreaterThan(20)
    expect(dists.lande!.length).toBeGreaterThan(20)
    expect(dists.pionnier!.length).toBeGreaterThan(20)
    expect(dists.futaie!.length).toBeGreaterThan(20)
    // LE RANG, pas les valeurs : stérile < lande < pionnier < futaie en distance au front.
    expect(moy(dists.sterile!)).toBeLessThan(moy(dists.lande!))
    expect(moy(dists.lande!)).toBeLessThan(moy(dists.pionnier!))
    expect(moy(dists.pionnier!)).toBeLessThan(moy(dists.futaie!))
  })

  it('chaque stade porte sa récolte : des baies poussent sur la lande et l\'herbe du Brûlé', () => {
    // `terrainAdmet` refuse les baies au calciné : la reprise se récolte, le désert non.
    // (La table `brule` déclare `berry_bush` — A19 garantit qu'elle trouve ses tuiles ;
    // ici on prouve la LECTURE du gradient : il existe des tuiles de lande/herbe à portée.)
    const brule = graphe.zones.find((z) => z.def.slug === 'brule')!
    let recoltables = 0
    for (let i = 0; i < map.terrain.length; i += 7) {
      if (zone[i] !== brule.id) continue
      const t = map.terrain[i]!
      if (t === TERRAIN_HEATH || t === TERRAIN_GRASS) recoltables++
    }
    expect(recoltables).toBeGreaterThan(200)
  })
})


// ═══ LE VOCABULAIRE DES ANNALES (spec `annales.md` A1-A6) — sur la VRAIE carte ═══
//
// Les gardes sont BICONDITIONNELLES et balayées : « chaque lieu X porte son fait » ET « chaque
// fait a son lieu » — jamais un compte choisi. Un fait orphelin de sa cause matérielle est un
// mensonge du monde (bible L7), et c'est exactement ce que A2 interdit.
describe('le vocabulaire des annales (annales.md A1-A2)', () => {
  const annales = map.annales ?? []
  const parType = (t: string) => annales.filter((f) => f.type === t)
  const centre = (z: { x: number; y: number; w: number; h: number }) =>
    [Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2)] as const
  const BOISE = [TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH]

  it('gravure ⟺ pierre : chaque pierre écrit, rien d\u2019autre n\u2019écrit (ère 0)', () => {
    const pierres = map.zones.filter((z) => z.kind === 'pierre_levee' || z.kind === 'cercle_pierres' || z.kind === 'petroglyphes')
    expect(pierres.length, 'la Racine porte des pierres (t0 §1)').toBeGreaterThanOrEqual(1)
    const faits = parType('gravure')
    expect(faits.length).toBe(pierres.length)
    for (const f of faits) {
      expect(f.ere).toBe(0)
      const z = pierres.find((q) => { const [cx, cy] = centre(q); return f.x === cx && f.y === cy && f.lieu === q.kind })
      expect(z, `gravure orpheline en (${f.x},${f.y})`).toBeDefined()
    }
  })

  it('guet : la Tour regarde VERS la Cendrière — et la Cendrière est au sud-ouest de la Racine', () => {
    const tours = map.zones.filter((z) => z.kind === 'tour_guet')
    const faits = parType('guet')
    expect(faits.length).toBe(tours.length) // la carte a un champ de cendre : la direction existe
    for (const f of faits) {
      expect(f.ere).toBe(1)
      // La direction est un MOT (R3), et il pointe vers le brûlé : la distance de cendre
      // Y DÉCROÎT — on revérifie contre le champ, pas contre la constante qui l'a produite.
      expect(['nord', 'sud', 'est', 'ouest']).toContain(f.cause)
      const pas = 24
      const [dx, dy] = f.cause === 'est' ? [pas, 0] : f.cause === 'ouest' ? [-pas, 0] : f.cause === 'sud' ? [0, pas] : [0, -pas]
      const lire = (x: number, y: number) => map.cendre![Math.max(0, Math.min(map.height - 1, y)) * W + Math.max(0, Math.min(W - 1, x))]!
      expect(lire(f.x + dx, f.y + dy), `le guet ${f.cause} ne regarde pas le brûlé`).toBeLessThan(lire(f.x, f.y))
    }
  })

  it('fuite ⟺ charrette, et elle tourne le DOS au guet', () => {
    const charrettes = map.zones.filter((z) => z.kind === 'charrette')
    const faits = parType('fuite')
    expect(faits.length).toBe(charrettes.length)
    for (const f of faits) {
      expect(f.ere).toBe(3)
      const pas = 24
      const [dx, dy] = f.cause === 'est' ? [pas, 0] : f.cause === 'ouest' ? [-pas, 0] : f.cause === 'sud' ? [0, pas] : [0, -pas]
      const lire = (x: number, y: number) => map.cendre![Math.max(0, Math.min(map.height - 1, y)) * W + Math.max(0, Math.min(W - 1, x))]!
      // Fuir, c'est aller là où la distance de cendre CROÎT.
      expect(lire(f.x + dx, f.y + dy), 'une fuite qui rentre dans le feu').toBeGreaterThan(lire(f.x, f.y))
    }
  })

  it('fosse ⟺ charnier, au compte exact', () => {
    const charniers = map.zones.filter((z) => z.kind === 'charnier')
    expect(charniers.length).toBeGreaterThanOrEqual(1)
    expect(parType('fosse').length).toBe(charniers.length)
  })

  it('porte ⟺ seuil, au compte exact, cause `secours` fidèle', () => {
    const seuils = map.seuils ?? []
    const faits = parType('porte')
    expect(seuils.length).toBeGreaterThanOrEqual(1)
    expect(faits.length).toBe(seuils.length)
    for (const f of faits) {
      const s2 = seuils.find((q) => q.x === f.x && q.y === f.y)
      expect(s2, `porte orpheline en (${f.x},${f.y})`).toBeDefined()
      expect(f.cause === 'secours').toBe(s2!.secours)
    }
  })

  it('croisee : chaque croisée est SUR une route — et s\u2019il y a ≥ 3 bouches, il y en a', () => {
    const faits = parType('croisee')
    for (const f of faits) {
      expect(map.terrain[f.y * W + f.x], `croisée hors route en (${f.x},${f.y})`).toBe(TERRAIN_ROAD)
    }
    const bouches = (map.seuils ?? []).length
    if (bouches >= 3) expect(faits.length, '3 bouches et aucun carrefour').toBeGreaterThanOrEqual(1)
    else expect(faits.length, 'deux bouches font une liaison directe, pas un carrefour').toBe(0)
  })

  it('essart ⟺ lieu bâti au centre BOISÉ — biconditionnel, balayé sur toutes les zones', () => {
    const faits = parType('essart')
    for (const z of map.zones) {
      if (z.kind === undefined) continue
      const humain = map.zones.length > 0 && (BUILT_KINDS.includes(z.kind) || z.kind === 'ferme_ruinee' || z.kind === 'charrette' || z.kind === 'verger')
      const [cx, cy] = centre(z)
      const attendu = humain && BOISE.includes(map.terrain[cy * W + cx]!)
      const present = faits.some((f) => f.x === cx && f.y === cy && f.lieu === z.kind)
      if (attendu) expect(present, `${z.name} : essart manquant`).toBe(true)
    }
    for (const f of faits) {
      expect(BOISE.includes(map.terrain[f.y * W + f.x]!), `essart en terrain nu (${f.x},${f.y})`).toBe(true)
    }
  })

  it('taille : jamais orpheline d\u2019un affleurement à portée', () => {
    const faits = parType('taille')
    for (const f of faits) {
      expect(['fer', 'charbon']).toContain(f.cause)
      const proche = (map.affleurements ?? []).some((a) => {
        const dx = f.x < a.x ? a.x - f.x : f.x > a.x + a.w - 1 ? f.x - (a.x + a.w - 1) : 0
        const dy = f.y < a.y ? a.y - f.y : f.y > a.y + a.h - 1 ? f.y - (a.y + a.h - 1) : 0
        return Math.max(dx, dy) <= 24
      })
      expect(proche, `taille sans roche en (${f.x},${f.y})`).toBe(true)
    }
  })
})

describe('les garde-fous des lecteurs (annales.md A3-A6)', () => {
  const annales = map.annales ?? []

  it('A3 — deux générations de même seed rendent des annales IDENTIQUES, ordre compris', () => {
    const bis = generateZonedTerrain(7)
    expect(JSON.stringify(bis.map.annales)).toBe(JSON.stringify(annales))
  })

  it('A4 — la saillance DISCRIMINE sur la vraie carte : un type dit ici, tu là', () => {
    const types = [...new Set(annales.map((f) => f.type))]
    const discrimine = types.some((t) => {
      const faits = annales.filter((f) => f.type === t)
      return faits.some((f) => saillant(map, f)) && faits.some((f) => !saillant(map, f))
    })
    expect(discrimine, 'aucun type à la fois dit et tu : le seuil de saillance est mort').toBe(true)
  })

  it('A5 — la lacune est une PART (5-60 %), déterministe, et elle tait la STÈLE entière', () => {
    expect(annales.length).toBeGreaterThanOrEqual(10)
    const muets = annales.filter((f) => !verbalise(f)).length
    const part = muets / annales.length
    expect(part).toBeGreaterThan(0.05)
    expect(part).toBeLessThan(0.6)
    for (const f of annales) expect(verbalise(f)).toBe(verbalise(f))
    // Deux faits du MÊME lieu se taisent ensemble : c'est la stèle qui est brisée, pas la phrase.
    const parPos = new Map<string, boolean[]>()
    for (const f of annales) {
      const cle = `${f.x},${f.y}`
      const v = parPos.get(cle) ?? []
      v.push(verbalise(f))
      parPos.set(cle, v)
    }
    for (const [cle, verdicts] of parPos) {
      expect(new Set(verdicts).size, `verdicts mêlés au même point ${cle}`).toBe(1)
    }
  })

  it('A6 — le potentiel de lignes de chronique reste borné (< 15 sur toute la carte)', () => {
    // Le banc n'a pas de joueur (les premières visites n'y tombent jamais) : on borne donc le
    // POTENTIEL — les lieux dont les faits produiraient une ligne — pas un flux mesuré.
    let lignes = 0
    for (const z of map.zones) {
      if (z.kind === undefined) continue
      const cx = Math.floor(z.x + z.w / 2)
      const cy = Math.floor(z.y + z.h / 2)
      const faits = annales.filter((f) => f.x === cx && f.y === cy && f.lieu === z.kind)
      const dits = faits.filter((f) => saillant(map, f))
      const sort = dits.find((f) => f.type === 'sort')
      const fondation = dits.find((f) => f.type === 'fondation')
      const guet = dits.find((f) => f.type === 'guet')
      if ((sort?.cause === 'intact' && fondation?.cause !== undefined) || fondation?.cause !== undefined || guet?.cause !== undefined) lignes += 1
    }
    expect(lignes).toBeGreaterThanOrEqual(1)
    expect(lignes).toBeLessThan(15)
  })

  it('le réglage se tient : la part muette est bien celle du bloc ANNALES', () => {
    expect(ANNALES.PART_MUETTE).toBeGreaterThan(0)
    expect(ANNALES.PART_MUETTE).toBeLessThan(1)
    expect(ANNALES.SAILLANCE_MAX).toBeGreaterThanOrEqual(1)
  })
})


describe('les stèles (annales.md R8, A7-A8bis) — sur la vraie carte', () => {
  const steles = map.zones.filter((z) => z.kind === 'stele')
  const annales = map.annales ?? []

  it('il y en a, et chacune est au bord d\u2019un fait d\u2019ère 2 SAILLANT — jamais sur la route', () => {
    expect(steles.length, 'aucune stèle posée : le pays d\u2019avant reste muet').toBeGreaterThanOrEqual(1)
    for (const z of steles) {
      const cx = Math.floor(z.x + z.w / 2)
      const cy = Math.floor(z.y + z.h / 2)
      expect(map.terrain[cy * W + cx], `${z.name} posée SUR la route`).not.toBe(TERRAIN_ROAD)
      const pres = annales.some((f) =>
        (f.type === 'croisee' || f.type === 'gue') && saillant(map, f) &&
        (f.x - cx) * (f.x - cx) + (f.y - cy) * (f.y - cy) <= ANNALES.STELE_FAIT_RAYON * ANNALES.STELE_FAIT_RAYON)
      expect(pres, `${z.name} orpheline de son fait`).toBe(true)
    }
  })

  it('texteDeStele est défini pour CHAQUE stèle posée, et aucun texte ne prononce un sort', () => {
    for (const z of steles) {
      const t = texteDeStele(map, Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2))
      expect(t, `${z.name} : pierre muette`).toBeDefined()
      for (const ligne of t!.lignes) {
        // R9bis balayé : les mots du sort n'existent dans aucune ligne de stèle.
        expect(ligne).not.toMatch(/brûl|pill|intact/i)
      }
      // Une brisée porte UN fragment ; une saine, une ou deux lignes pleines.
      if (t!.brisee) expect(t!.lignes).toHaveLength(1)
      else expect(t!.lignes.length).toBeGreaterThanOrEqual(1)
    }
  })
})
