/**
 * LES GARDES DES AFFLEUREMENTS — spec `t0-exploration.md` §2sexies (décision d'Alexis,
 * 2026-08-18 : « zones de production naturelle », reco suivie).
 *
 * Quatre choses, et rien d'autre :
 *   A28 — les PLANCHERS (R51) tiennent : fer, charbon, carrières, vieux fûts — sur les graines
 *         de production ET à l'échelle du banc. Aucune seed ne naît sans économie.
 *   A29 — CONTENANT/CONTENU (R48-R50) : chaque nœud neuf est LÀ où sa dérivation le met — le
 *         minerai sur la rocaille registrée, la carrière contre la roche hors d'atteinte du
 *         front, le vieux fût au cœur (et hors Bois Noir).
 *   A30 — un affleurement = UNE identité, les buttes s'écartent, et aucun village dessus (R52).
 *   A31 — le monde COMPLET est intact : zéro nœud neuf sur le plan `'vallee'` — l'exclusivité
 *         R9 (A14/A15bis) reste gardée par ses propres gardes, celle-ci épingle le périmètre.
 */
import { describe, expect, it } from 'vitest'
import { NODE_DEFS, TERRAIN_ROCK, TERRAIN_SCREE } from './balance'
import { placeHuntingGrounds } from './faune'
import { profondeurAt } from './map'
import { nidsAMonstre } from './poi'
import { estCoeur } from './profondeur'
import { BLOC_STOCKS, CONTENU, emplacementsDeVillage, placeZoneNodes, tailleDeBloc } from './zone-content'
import { generateZonedTerrain } from './zonegen'
import { distAuRect, MONDE } from './zonegraph'
import type { ResourceNode } from './economy'

const SEEDS = [2026, 7]
const mondes = SEEDS.map((s) => {
  const c = generateZonedTerrain(s, MONDE.JOUEURS_CIBLE, 'racine')
  return { s, c, nodes: placeZoneNodes(c) }
})

/** Les nœuds NEUFS d'un type dans la racine — le teaser (stock dérisoire) reste hors compte. */
const neufs = (m: (typeof mondes)[number], type: ResourceNode['type']): ResourceNode[] =>
  m.nodes.filter((n) => n.type === type && n.stock !== CONTENU.TEASER_STOCK
    && m.c.zone[n.ty * m.c.map.width + n.tx] === m.c.graphe.racine)

describe('A28 — les planchers de R51 : aucune seed ne naît sans économie', () => {
  it('fer, charbon, carrières et vieux fûts existent sur les graines de production', () => {
    for (const m of mondes) {
      expect(m.c.affleurements.filter((a) => a.ressource === 'fer').length, `seed ${m.s} : buttes ferreuses`).toBeGreaterThanOrEqual(1)
      expect(m.c.affleurements.filter((a) => a.ressource === 'charbon').length, `seed ${m.s} : buttes charbonneuses`).toBeGreaterThanOrEqual(1)
      expect(neufs(m, 'iron_vein').length, `seed ${m.s} : filons`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'coal_seam').length, `seed ${m.s} : charbon`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'quarry').length, `seed ${m.s} : carrières`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'old_tree').length, `seed ${m.s} : vieux fûts`).toBeGreaterThanOrEqual(1)
    }
  })

  it('et à l\'échelle du banc aussi — le monde qu\'on calibre porte la même économie', () => {
    for (const s of [2026, 31]) {
      const c = generateZonedTerrain(s, 6, 'racine')
      const nodes = placeZoneNodes(c)
      const m = { s, c, nodes }
      expect(m.c.affleurements.length, `seed ${s} (banc)`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'iron_vein').length, `seed ${s} (banc) : filons`).toBeGreaterThanOrEqual(1)
      expect(neufs(m, 'quarry').length, `seed ${s} (banc) : carrières`).toBeGreaterThanOrEqual(1)
      expect(neufs(m, 'old_tree').length, `seed ${s} (banc) : vieux fûts`).toBeGreaterThanOrEqual(1)
    }
  }, 60_000)
})

describe('A29 — contenant/contenu : chaque nœud neuf est LÀ où sa dérivation le met', () => {
  it('le minerai est SUR la rocaille d\'un affleurement registré, de la bonne identité', () => {
    for (const m of mondes) {
      const { width, terrain } = m.c.map
      for (const type of ['iron_vein', 'coal_seam'] as const) {
        const attendu = type === 'iron_vein' ? 'fer' : 'charbon'
        for (const n of neufs(m, type)) {
          expect(terrain[n.ty * width + n.tx], `seed ${m.s} : ${type}@${n.tx},${n.ty} hors rocaille`).toBe(TERRAIN_SCREE)
          const butte = m.c.affleurements.find((a) =>
            n.tx >= a.rect.x && n.tx < a.rect.x + a.rect.w && n.ty >= a.rect.y && n.ty < a.rect.y + a.rect.h)
          expect(butte, `seed ${m.s} : ${type}@${n.tx},${n.ty} hors de toute butte registrée`).toBeDefined()
          expect(butte!.ressource, `seed ${m.s} : identité de la butte @${butte!.rect.x},${butte!.rect.y}`).toBe(attendu)
        }
      }
    }
  })

  it('la carrière touche la roche, hors d\'atteinte du front — le feu ne la confisque pas', () => {
    for (const m of mondes) {
      const { width, terrain, cendre, cendreMax } = m.c.map
      for (const n of neufs(m, 'quarry')) {
        const i = n.ty * width + n.tx
        const contreLaRoche = terrain[i - 1] === TERRAIN_ROCK || terrain[i + 1] === TERRAIN_ROCK
          || terrain[i - width] === TERRAIN_ROCK || terrain[i + width] === TERRAIN_ROCK
        expect(contreLaRoche, `seed ${m.s} : quarry@${n.tx},${n.ty} sans paroi`).toBe(true)
        expect(cendre![i]!, `seed ${m.s} : quarry@${n.tx},${n.ty} sous le front final`).toBeGreaterThan(cendreMax!)
      }
    }
  })

  it('le vieux fût est au CŒUR d\'un massif, et jamais dans le Bois Noir', () => {
    for (const m of mondes) {
      const bois = m.c.map.zones.find((z) => z.kind === 'bois_noir')
      for (const n of neufs(m, 'old_tree')) {
        expect(estCoeur(profondeurAt(m.c.map, n.tx, n.ty)), `seed ${m.s} : old_tree@${n.tx},${n.ty} hors cœur`).toBe(true)
        if (bois) {
          const dedans = n.tx >= bois.x && n.tx < bois.x + bois.w && n.ty >= bois.y && n.ty < bois.y + bois.h
          expect(dedans, `seed ${m.s} : old_tree@${n.tx},${n.ty} dans le Bois Noir — son teaser perd son récit`).toBe(false)
        }
        expect(n.stock, `seed ${m.s}`).toBe(NODE_DEFS.old_tree.stock)
      }
    }
  })

  it('les BLOCS sont des nœuds `bloc` pleine tuile, sur la rocaille, à la taille de leur stock', () => {
    // « un bloc = une tuile pleine de non traversable… plusieurs tailles » (Alexis, 2026-08-18) :
    // le type dédié REMPLIT sa tuile (`blockHalfSub: 4`) et n'existe QUE sur les buttes — tout
    // `bloc` du monde vit sur une rocaille registrée, et son stock EST sa taille (`tailleDeBloc`,
    // la même fonction pure que l'art côté client — deux lectures, une vérité).
    expect(NODE_DEFS.bloc.blockHalfSub).toBe(4)
    for (const m of mondes) {
      const { width, terrain } = m.c.map
      const blocs = m.nodes.filter((n) => n.type === 'bloc')
      for (const n of blocs) {
        expect(terrain[n.ty * width + n.tx], `seed ${m.s} : bloc hors rocaille @${n.tx},${n.ty}`).toBe(TERRAIN_SCREE)
        const butte = m.c.affleurements.find((a) =>
          n.tx >= a.rect.x && n.tx < a.rect.x + a.rect.w && n.ty >= a.rect.y && n.ty < a.rect.y + a.rect.h)
        expect(butte, `seed ${m.s} : bloc hors de toute butte @${n.tx},${n.ty}`).toBeDefined()
        expect(n.stock, `seed ${m.s} : stock ≠ taille @${n.tx},${n.ty}`).toBe(BLOC_STOCKS[tailleDeBloc(n.tx, n.ty)])
      }
      for (const a of m.c.affleurements) {
        const surButte = blocs.filter((n) =>
          n.tx >= a.rect.x && n.tx < a.rect.x + a.rect.w && n.ty >= a.rect.y && n.ty < a.rect.y + a.rect.h)
        expect(surButte.length, `seed ${m.s} : butte @${a.rect.x},${a.rect.y} sans chaos de blocs`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('la tuile du SOMMET reste nue de tout nœud — le chicot du client s\'y dresse', () => {
    // Deux codes, une règle (« la tuile de pierrier la plus proche du centre ») : le sim la
    // réserve, le client y plante le chicot — cette garde répète la règle pour épingler les deux.
    for (const m of mondes) {
      const { width, height, terrain } = m.c.map
      for (const a of m.c.affleurements) {
        const cx = a.rect.x + a.rect.w / 2
        const cy = a.rect.y + a.rect.h / 2
        let sommet = -1
        let bestD = Infinity
        for (let ty = a.rect.y; ty < a.rect.y + a.rect.h; ty++) {
          for (let tx = a.rect.x; tx < a.rect.x + a.rect.w; tx++) {
            if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
            if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
            const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
            if (d < bestD) { bestD = d; sommet = ty * width + tx }
          }
        }
        expect(sommet, `seed ${m.s} : butte sans rocaille ?`).toBeGreaterThanOrEqual(0)
        const stx = sommet % width
        const sty = (sommet - stx) / width
        expect(
          m.nodes.some((n) => n.tx === stx && n.ty === sty),
          `seed ${m.s} : un nœud squatte le sommet @${stx},${sty}`,
        ).toBe(false)
      }
    }
  })

  it('et les buttes elles-mêmes sont hors d\'atteinte du front (R47)', () => {
    for (const m of mondes) {
      const { cendre, cendreMax, width } = m.c.map
      for (const a of m.c.affleurements) {
        const cx = Math.floor(a.rect.x + a.rect.w / 2)
        const cy = Math.floor(a.rect.y + a.rect.h / 2)
        expect(cendre![cy * width + cx]!, `seed ${m.s} : butte @${a.rect.x},${a.rect.y}`).toBeGreaterThan(cendreMax!)
      }
    }
  })
})

describe('A30 — une identité par butte, des buttes écartées, et personne n\'y fonde', () => {
  it('les buttes s\'écartent entre elles — deux gisements dans un écran seraient un seul qui ment', () => {
    for (const m of mondes) {
      const affs = m.c.affleurements
      for (let i = 0; i < affs.length; i++) {
        for (let j = i + 1; j < affs.length; j++) {
          const a = affs[i]!.rect
          const b = affs[j]!.rect
          const d = distAuRect(a.x + a.w / 2, a.y + a.h / 2, b)
          expect(d, `seed ${m.s} : buttes ${i} et ${j} trop proches`).toBeGreaterThanOrEqual(150)
        }
      }
    }
  })

  it('aucun emplacement de village sur une butte (R52) — la distance fait le prix', () => {
    for (const m of mondes) {
      const grounds = placeHuntingGrounds(m.c.map, m.s)
      const emplacements = emplacementsDeVillage(m.c, m.nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(m.c.map) })
      for (const e of emplacements) {
        for (const a of m.c.affleurements) {
          const d = distAuRect(e.tx, e.ty, a.rect)
          expect(d, `seed ${m.s} : village @${e.tx},${e.ty} sur la butte @${a.rect.x},${a.rect.y}`)
            .toBeGreaterThanOrEqual(CONTENU.DEGAGEMENT)
        }
      }
    }
  })
})

describe('la donnée de premier ordre — WorldMap.affleurements (patron « seuils → bornes »)', () => {
  it('la carte porte EXACTEMENT le registre de génération — le client ne devinera rien', () => {
    for (const m of mondes) {
      expect(m.c.map.affleurements).toEqual(
        m.c.affleurements.map((a) => ({ ...a.rect, ressource: a.ressource })),
      )
    }
  })
})

describe('A31 — le monde complet est INTACT : le périmètre est le monde réduit, exactement', () => {
  it('zéro affleurement, zéro nœud neuf dans la racine du plan complet', () => {
    const c = generateZonedTerrain(2026)
    expect(c.affleurements).toEqual([])
    expect(c.map.affleurements, 'la vallée complète ne porte pas la donnée — additive, jamais vide').toBeUndefined()
    const nodes = placeZoneNodes(c)
    const racine = c.graphe.racine
    const enRacine = (n: ResourceNode): boolean => c.zone[n.ty * c.map.width + n.tx] === racine
    // Le teaser du Filon (stock dérisoire) est la SEULE exception déclarée — comme avant.
    expect(nodes.filter((n) => n.type === 'iron_vein' && enRacine(n) && n.stock !== CONTENU.TEASER_STOCK).length).toBe(0)
    expect(nodes.filter((n) => n.type === 'coal_seam' && enRacine(n)).length).toBe(0)
    expect(nodes.filter((n) => n.type === 'quarry' && enRacine(n)).length).toBe(0)
    expect(nodes.filter((n) => n.type === 'bloc').length, 'le bloc n\'existe QUE sur une butte').toBe(0)
    expect(nodes.filter((n) => n.type === 'old_tree' && enRacine(n) && n.stock !== CONTENU.TEASER_STOCK).length).toBe(0)
  }, 60_000)
})
