/**
 * LES GARDES DU CONTENU — spec `worldgen.md` A14 à A18.
 *
 * Ce sont elles qui prouvent que « loin » veut dire quelque chose. Sans A14, la carte est une
 * jolie topologie où l'on trouve du bois partout — et alors aucun seuil ne vaut la peine d'être
 * franchi.
 */
import { describe, expect, it } from 'vitest'
import { NODE_DEFS, TERRAINS } from './balance'
import { distSq } from './geometry'
import { CONTENU, CONTENUS, emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { generateZonedTerrain, type CarteZonee } from './zonegen'
import { MONDE, VRAIES_ZONES, ZONES } from './zonegraph'

const SEEDS = [2026, 7, 42]
const mondes = SEEDS.map((s) => {
  const c: CarteZonee = generateZonedTerrain(s)
  const nodes = placeZoneNodes(c)
  const emplacements = emplacementsDeVillage(c, nodes)
  return { c, nodes, emplacements }
})

const slugDe = (c: CarteZonee, id: number) => c.graphe.zones[id]!.def.slug

describe('la table du contenu', () => {
  it('toute zone déclarée a un contenu — et un SEUIL n\'en a AUCUN (R10.3)', () => {
    for (const z of ZONES) {
      if (z.traverse) {
        // LE NÉVÉ NE NOURRIT RIEN, et c'est ce qui en fait une porte plutôt qu'un pays : *on ne campe
        // pas dans un seuil.* Aucune règle n'interdit d'y bâtir — il n'y a simplement rien à y
        // prendre (spec R17 : zéro code de restriction, zéro frustration). L'absence de contenu est
        // donc une EXIGENCE, pas un oubli, et c'est à ce titre qu'on la teste.
        expect(CONTENUS[z.slug], `${z.nom} est un SEUIL : il ne doit rien nourrir`).toBeUndefined()
        continue
      }
      expect(CONTENUS[z.slug], `${z.nom} n'a pas de contenu déclaré`).toBeDefined()
    }
    // La réciproque : pas une ligne de contenu qui ne corresponde à une VRAIE zone.
    expect(Object.keys(CONTENUS).sort()).toEqual(VRAIES_ZONES.map((z) => z.slug).sort())
  })

  it('la table PROMET ce que la spec déclare : chaque structurante chez elle, et une seule fois', () => {
    const parType = new Map<string, string[]>()
    for (const [slug, def] of Object.entries(CONTENUS)) {
      if (!def.structurant) continue
      const t = def.structurant.type
      parType.set(t, [...(parType.get(t) ?? []), slug])
    }
    for (const [type, zones] of parType) {
      expect(zones, `« ${type} » est structurant dans ${zones.length} zones`).toHaveLength(1)
    }
    // Le charbon est la SEULE liaison, et il naît dans exactement deux zones (décision
    // d'Alexis : au Karst ET au Versant Brûlé — une couture, qui donne un choix de route).
    const charbon = Object.entries(CONTENUS)
      .filter(([, d]) => d.liaison?.some((l) => l.type === 'coal_seam'))
      .map(([s]) => s)
    expect(charbon.sort()).toEqual(['brule', 'karst'])
  })
})

describe('le contenu, sur la vraie carte', () => {
  it('A14 — TOUTE ressource structurante n\'existe QUE dans sa zone (le teaser excepté, et il est UNIQUE)', () => {
    for (const { c, nodes } of mondes) {
      const attendu = new Map<string, string>()
      for (const [slug, def] of Object.entries(CONTENUS)) {
        if (def.structurant) attendu.set(def.structurant.type, slug)
      }
      // LA SEULE EXCEPTION, et elle se NOMME : le teaser. Un filon de fer dans la racine, au
      // stock dérisoire. On ne relâche pas la règle — on la dit en entier. (Et A15 vérifie
      // qu'il n'y en a qu'UN, et qu'il ne sert à rien qu'à informer.)
      let teasers = 0
      for (const n of nodes) {
        const chezElle = attendu.get(n.type)
        if (!chezElle) continue // un commun ou une liaison : il a le droit d'être partout
        const ici = slugDe(c, c.zone[n.ty * c.map.width + n.tx]!)
        if (ici === chezElle) continue
        if (n.type === 'iron_vein' && ici === 'pres_bas' && n.stock === CONTENU.TEASER_STOCK) {
          teasers += 1
          continue
        }
        expect(
          ici,
          `seed ${c.graphe.seed} : un « ${n.type} » pousse dans ${ici}, alors qu'il n'appartient qu'à ${chezElle}`,
        ).toBe(chezElle)
      }
      expect(teasers, `seed ${c.graphe.seed} : ${teasers} teasers (il en faut exactement UN)`).toBe(1)
    }
  }, 120_000)

  it('A14bis — le CHARBON, et lui seul, naît dans DEUX zones : la couture est déclarée', () => {
    for (const { c, nodes } of mondes) {
      const zonesDuCharbon = new Set(
        nodes.filter((n) => n.type === 'coal_seam').map((n) => slugDe(c, c.zone[n.ty * c.map.width + n.tx]!)),
      )
      for (const s of zonesDuCharbon) {
        expect(['karst', 'brule'], `seed ${c.graphe.seed} : du charbon dans ${s}`).toContain(s)
      }
      expect(zonesDuCharbon.size, `seed ${c.graphe.seed}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('A15 — LE TEASER : un seul filon dans la racine, et il est DÉRISOIRE', () => {
    for (const { c, nodes } of mondes) {
      const racine = c.graphe.racine
      const filons = nodes.filter(
        (n) => n.type === 'iron_vein' && c.zone[n.ty * c.map.width + n.tx] === racine,
      )
      expect(filons, `seed ${c.graphe.seed} : ${filons.length} filons dans les Prés Bas`).toHaveLength(1)
      // Dérisoire : il n'équipe personne. Il INFORME. « Ça existe. Pas ici. »
      expect(filons[0]!.stock).toBe(CONTENU.TEASER_STOCK)
      expect(filons[0]!.stock).toBeLessThan(NODE_DEFS.iron_vein.stock)
    }
  })

  it('A15bis — le vrai fer est au KARST, et il y est ABONDANT', () => {
    for (const { c, nodes } of mondes) {
      const auKarst = nodes.filter(
        (n) => n.type === 'iron_vein' && slugDe(c, c.zone[n.ty * c.map.width + n.tx]!) === 'karst',
      )
      // Le teaser en donne 3 unités ; le Karst doit en donner des ordres de grandeur de plus,
      // sinon le voyage ne se paie pas et toute la structure est décorative.
      const stockKarst = auKarst.reduce((s, n) => s + n.stock, 0)
      expect(auKarst.length, `seed ${c.graphe.seed} : ${auKarst.length} filons au Karst`).toBeGreaterThan(100)
      expect(stockKarst).toBeGreaterThan(CONTENU.TEASER_STOCK * 100)
    }
  })

  it('A16 — UN SEUIL NE NOURRIT RIEN : zéro nœud dans un couloir', () => {
    // Ce n'est pas de la saveur. C'est ce qui rend un village impossible DANS une porte, sans
    // qu'aucune règle ne l'interdise — donc sans qu'aucun joueur ne se voie dire non.
    for (const { c, nodes } of mondes) {
      const dedans = nodes.filter((n) => c.rampe[n.ty * c.map.width + n.tx])
      expect(dedans, `seed ${c.graphe.seed} : ${dedans.length} nœuds dans un seuil`).toHaveLength(0)
    }
  })

  it('A17 — la racine porte ses villages, et ils sont ESPACÉS', () => {
    const requis = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)
    for (const { c, emplacements } of mondes) {
      const dansLaRacine = emplacements.filter((e) => e.zone === c.graphe.racine)
      expect(
        dansLaRacine.length,
        `seed ${c.graphe.seed} : ${dansLaRacine.length} emplacements dans les Prés Bas pour ${requis} villages`,
      ).toBeGreaterThanOrEqual(requis)

      const min = MONDE.ESPACEMENT_VILLAGES * MONDE.ESPACEMENT_VILLAGES
      for (let i = 0; i < emplacements.length; i++) {
        for (let j = i + 1; j < emplacements.length; j++) {
          const a = emplacements[i]!
          const b = emplacements[j]!
          expect(distSq(a.tx, a.ty, b.tx, b.ty)).toBeGreaterThanOrEqual(min)
        }
      }
    }
  }, 120_000)

  it('R17 — ON NE DIT JAMAIS NON : les zones stériles s\'excluent TOUTES SEULES', () => {
    // Aucun code n'interdit de fonder un village dans le Glacier. Simplement, on n'y bâtit
    // rien — faute de bois. C'est la trouvaille du brainstorm : **la distribution des
    // ressources EST la règle de peuplement.** Zéro interdit, zéro frustration.
    for (const { c, emplacements } of mondes) {
      const habitees = new Set(emplacements.map((e) => slugDe(c, e.zone)))
      for (const sterile of ['glacier', 'aiguilles', 'gouffre']) {
        expect(
          habitees.has(sterile),
          `seed ${c.graphe.seed} : on peut fonder un village dans ${sterile} — il ne devrait rien y avoir pour bâtir`,
        ).toBe(false)
      }
      // Et la racine, elle, est évidemment habitable.
      expect(habitees.has('pres_bas')).toBe(true)
    }
  })

  it('A18 — le SPAWN est éparpillé : personne ne naît sur la tête du voisin', () => {
    for (const { c, emplacements } of mondes) {
      const n = Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE)
      const spawns = pointsDeSpawn(c, emplacements, n)
      expect(spawns.length, `seed ${c.graphe.seed}`).toBe(n)
      for (const s of spawns) {
        // Tous dans la racine, tous marchables, aucun dans un seuil.
        expect(s.zone).toBe(c.graphe.racine)
        const i = s.ty * c.map.width + s.tx
        expect(TERRAINS[c.map.terrain[i]!]?.walkable).toBe(true)
        expect(c.rampe[i]).toBe(0)
      }
      // Et deux à deux écartés — c'est la demande d'Alexis : « éviter la guerre au lancement ».
      const min = MONDE.ESPACEMENT_VILLAGES * MONDE.ESPACEMENT_VILLAGES
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          expect(distSq(spawns[i]!.tx, spawns[i]!.ty, spawns[j]!.tx, spawns[j]!.ty)).toBeGreaterThanOrEqual(min)
        }
      }
    }
  }, 120_000)

  it('A12 — le contenu est DÉTERMINISTE', () => {
    const a = generateZonedTerrain(42)
    const b = generateZonedTerrain(42)
    expect(placeZoneNodes(a)).toEqual(placeZoneNodes(b))
  }, 60_000)
})
