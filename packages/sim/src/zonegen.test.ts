/**
 * LES GARDES DU TERRAIN — spec `worldgen.md` A2, A5, A9, A10, A11, A13.
 *
 * À LA TAILLE DE PRODUCTION, sur la VRAIE carte. C'est la règle de méthode du projet, et elle
 * a été payée cinq fois : « les tests posaient leurs propres petites cartes », où les constantes
 * de gameplay (des rayons ABSOLUS, en tuiles) ne rencontrent jamais la structure du monde. Le
 * coût est réel (chaque carte coûte quelques secondes) ; il s'assume, il ne se rogne pas.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_CLIFF, TERRAINS } from './balance'
import { POI_TYPES } from './poi'
import { generateZonedTerrain, type CarteZonee } from './zonegen'

const SEEDS = [2026, 7, 42]
const cartes: CarteZonee[] = SEEDS.map((s) => generateZonedTerrain(s))

const marchable = (c: CarteZonee, i: number) => TERRAINS[c.map.terrain[i]!]?.walkable === true

/**
 * Les tuiles marchables atteignables depuis un point, en 4-connexité.
 *
 * 4-CONNEXITÉ, ET CE N'EST PAS UNE COMMODITÉ : c'est le modèle du pathfinder (A* à 4 directions)
 * ET de la collision (deux bloquants en diagonale ne laissent qu'un coin de largeur nulle,
 * qu'une AABB de 0,6 ne franchit pas). Compter les diagonales fabriquerait des passages que
 * personne ne peut emprunter — et c'est exactement le genre de mensonge qui ne se voit qu'en
 * jouant.
 */
function inonder(c: CarteZonee, depart: number, bouches: ReadonlySet<number> = new Set()): Uint8Array {
  const { width, height } = c.map
  const vu = new Uint8Array(width * height)
  if (!marchable(c, depart) || bouches.has(depart)) return vu
  vu[depart] = 1
  const file = [depart]
  for (let h = 0; h < file.length; h++) {
    const i = file[h]!
    const x = i % width
    const y = (i - x) / width
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const j = ny * width + nx
      if (vu[j] || bouches.has(j) || !marchable(c, j)) continue
      vu[j] = 1
      file.push(j)
    }
  }
  return vu
}

/** Un point marchable au cœur d'une zone — le plus proche de son site. */
function coeurDe(c: CarteZonee, id: number): number {
  const { width, height } = c.map
  const z = c.graphe.zones[id]!
  let best = -1
  let bestD = Infinity
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = y * width + x
      if (c.zone[i] !== id || !marchable(c, i) || c.rampe[i]) continue
      const dx = x - z.x
      const dy = y - z.y
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = i }
    }
  }
  return best
}

describe('le terrain, à la taille de production', () => {
  /**
   * A13 — LE BUDGET DE GÉNÉRATION, gardé PAR LE TIMEOUT lui-même.
   *
   * On ne peut pas chronométrer dans `/sim` : `Date` y est interdit par lint (invariant n°2 —
   * le temps est le numéro de tick, et un test impur finit toujours par contaminer le code
   * qu'il teste ; le journal du projet porte déjà un commit « /sim reste PUR, même dans ses
   * tests »). Le timeout de vitest fait donc office de chronomètre : si une carte de production
   * met plus de quinze secondes à naître, ce test échoue — et c'est exactement le contrat.
   */
  it('A13 — une carte de production naît en moins de 15 s', { timeout: 15_000 }, () => {
    const c = generateZonedTerrain(909)
    expect(c.map.terrain.length).toBe(c.map.width * c.map.height)
  })

  it('A2 — TOUTE zone est atteignable à pied depuis la racine', () => {
    for (const c of cartes) {
      const depart = coeurDe(c, c.graphe.racine)
      expect(depart, `seed ${c.graphe.seed} : la racine n'a pas un seul cœur marchable`).toBeGreaterThanOrEqual(0)
      const monde = inonder(c, depart)
      for (const z of c.graphe.zones) {
        const coeur = coeurDe(c, z.id)
        expect(coeur, `seed ${c.graphe.seed} : ${z.def.nom} n'a aucune tuile marchable`).toBeGreaterThanOrEqual(0)
        expect(
          monde[coeur],
          `seed ${c.graphe.seed} : on ne peut PAS marcher jusqu'à ${z.def.nom} depuis les Prés Bas`,
        ).toBe(1)
      }
    }
  }, 120_000)

  it('A5 — LE TEST DESTRUCTIF : on rebouche les seuils d\'une zone, elle devient une ÎLE', () => {
    // C'est le seul test qui prouve qu'une porte en est une, et il est le cœur de toute la
    // spec. L'ANCIENNE carte perdait **0,2 %** de son marchable quand on bouchait ses onze
    // « verrous » : les portes n'en étaient pas, et personne ne s'en était aperçu — parce que
    // personne n'avait songé à les boucher pour voir.
    for (const c of cartes) {
      const { width } = c.map
      const depart = coeurDe(c, c.graphe.racine)
      for (const z of c.graphe.zones) {
        if (z.id === c.graphe.racine) continue
        // On rebouche : toute tuile de RAMPE des seuils qui touchent cette zone.
        const bouches = new Set<number>()
        for (let i = 0; i < c.map.terrain.length; i++) {
          if (!c.rampe[i]) continue
          const x = i % width
          const y = (i - x) / width
          for (const s of c.graphe.seuils) {
            if (s.a !== z.id && s.b !== z.id) continue
            const dx = x - s.x
            const dy = y - s.y
            // Le couloir d'un seuil est borné : épaisseur + débord, plus le méandre.
            if (dx * dx + dy * dy < 80 * 80) { bouches.add(i); break }
          }
        }
        const monde = inonder(c, depart, bouches)
        const coeur = coeurDe(c, z.id)
        expect(
          monde[coeur],
          `seed ${c.graphe.seed} : ${z.def.nom} reste JOINTE malgré ses seuils rebouchés — ce n'est pas une gate`,
        ).toBe(0)
      }
    }
  }, 180_000)

  it('A9/A10 — ON NE MONTE QUE PAR UNE RAMPE, et jamais deux paliers d\'un coup', () => {
    for (const c of cartes) {
      const { width, height } = c.map
      let fautes = 0
      let sauts = 0
      for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
          const i = y * width + x
          if (!marchable(c, i)) continue
          for (const j of [i + 1, i + width]) {
            if (!marchable(c, j)) continue
            const d = Math.abs(c.palier[i]! - c.palier[j]!)
            if (d === 0) continue
            // Deux marchables voisines de paliers différents : l'une AU MOINS doit être une
            // rampe. Sans cette règle, on escaladerait une falaise de plain-pied.
            if (!c.rampe[i] && !c.rampe[j]) fautes++
            // Et une rampe ne saute jamais deux paliers : c'est une marche, pas un ascenseur.
            if (d > 1) sauts++
          }
        }
      }
      expect(fautes, `seed ${c.graphe.seed} : ${fautes} passages de palier hors rampe`).toBe(0)
      expect(sauts, `seed ${c.graphe.seed} : ${sauts} sauts de deux paliers ou plus`).toBe(0)
    }
  }, 120_000)

  it('A11 — l\'anneau de bordure est intégralement bloquant, après TOUTES les passes', () => {
    for (const c of cartes) {
      const { width, height, terrain } = c.map
      for (let x = 0; x < width; x++) {
        expect(terrain[x]).toBe(TERRAIN_CLIFF)
        expect(terrain[(height - 1) * width + x]).toBe(TERRAIN_CLIFF)
      }
      for (let y = 0; y < height; y++) {
        expect(terrain[y * width]).toBe(TERRAIN_CLIFF)
        expect(terrain[y * width + width - 1]).toBe(TERRAIN_CLIFF)
      }
    }
  })

  /**
   * ═══ A26 EST RETIRÉE — et il faut dire pourquoi, sinon elle reviendra hanter le projet ═══
   *
   * Elle exigeait qu'« une paroi soit à moins de quatre écrans, depuis n'importe quel point
   * marchable ». Elle était née d'un grief d'Alexis sur la carte rendue (*« il n'y a aucune falaise
   * alors que c'était prévu — wtf ? »*), et elle n'a JAMAIS été tenue par les frontières : une zone
   * fait six cents tuiles de côté, la première frontière est à huit écrans. **Elle n'était tenue que
   * par les BUTTES**, le relief intrazone.
   *
   * Les buttes sont retirées (décision d'Alexis, 2026-07-14 : *« ne garde que les frontières en
   * falaises, on gérera l'élévation intrazone plus tard »*). La garde tombe donc avec elles — on ne
   * garde pas un critère que le design ne vise plus : il ne mesurerait rien, il ne ferait
   * qu'échouer.
   *
   * **ELLE REVIENDRA AVEC L'ÉLÉVATION INTRAZONE**, et c'est elle qui dira si celle-ci est
   * suffisante. C'est le bon ordre : le critère d'abord, le système ensuite.
   */

  it('la falaise SÉPARE sans dévorer la carte', () => {
    for (const c of cartes) {
      const n = c.map.terrain.length
      const falaise = c.map.terrain.filter((t) => t === TERRAIN_CLIFF).length
      const walk = c.map.terrain.filter((t) => TERRAINS[t]?.walkable === true).length
      const pctF = (falaise / n) * 100
      const pctW = (walk / n) * 100
      // ═══ LES BORNES ONT CHANGÉ, ET C'EST LE SUJET ═══
      //
      // Elles disaient « entre 4 % et 22 % de falaise ». C'était la mesure d'une carte où chaque
      // frontière était une BANDE de 44 tuiles — un no man's land rocheux qui dévorait 16 % du
      // monde. L'arête fine (spec R33) l'a supprimée : la falaise n'est plus qu'une LIGNE d'une
      // tuile au bord des plateaux, plus l'anneau de bordure. **Elle pèse désormais ~3 %, et les
      // treize points qu'elle rendait sont du sol qu'on joue.**
      //
      // La borne basse reste une vraie garde : à zéro falaise, il n'y a plus de topologie du tout
      // (plus de gates, plus de seuils, A5 s'effondrerait). Elle vérifie que le squelette EXISTE.
      expect(pctF, `seed ${c.graphe.seed} : ${pctF.toFixed(1)} % de falaise`).toBeGreaterThan(1.5)
      expect(pctF, `seed ${c.graphe.seed} : ${pctF.toFixed(1)} % de falaise`).toBeLessThan(12)
      expect(pctW, `seed ${c.graphe.seed} : ${pctW.toFixed(1)} % de marchable`).toBeGreaterThan(80)
    }
  })

  /**
   * A19 — LA TABLE DES LIEUX NE MENT PAS : aucun type n'est une ligne morte.
   *
   * LE PROJET A DÉJÀ PAYÉ TROIS FOIS POUR CETTE GARDE. Le 2026-07-13, trois lignes de la table
   * étaient mortes, chacune pour une raison différente : la Fondrière (ses biomes n'existaient
   * nulle part), le Champ de crevasses (176 000 tuiles de glacier, aucune à moins de trois tuiles
   * du monde), le Belvédère (`minElev` au-dessus du plafond du marchable — un point de vue où
   * l'on ne peut pas se tenir).
   *
   * En donnant une ADRESSE aux lieux (la Grotte au Karst, l'Arbre remarquable dans la Sylve), on
   * a créé exactement la même classe de faute : il suffit qu'un lieu demande un biome que sa zone
   * ne porte pas — une cascade de roche dans une vieille forêt qui n'a pas une pierre — pour
   * qu'il disparaisse en silence. La garde porte donc sur la PROPRIÉTÉ, pas sur les cas.
   */
  it('A19 — CHAQUE type de lieu naît vraiment sur la carte : aucune ligne morte', () => {
    for (const c of cartes) {
      const poses = new Set(
        c.map.zones.filter((z) => z.kind !== undefined).map((z) => z.kind!.replace(/ .*/, '')),
      )
      // `Zone.kind` porte le slug du type. On compte les types RÉELLEMENT posés.
      const parNom = new Map<string, number>()
      for (const z of c.map.zones) {
        if (z.kind === undefined) continue
        parNom.set(z.kind, (parNom.get(z.kind) ?? 0) + 1)
      }
      for (const t of POI_TYPES) {
        expect(
          parNom.get(t.slug) ?? 0,
          `seed ${c.graphe.seed} : « ${t.name} » (zones : ${t.zones?.join(', ') ?? 'toutes'} ; ` +
            `biomes : ${t.biomes.join(',')}) ne naît NULLE PART — c'est une ligne morte.`,
        ).toBeGreaterThan(0)
      }
      expect(poses.size).toBeGreaterThan(0)
    }
  }, 120_000)

  it('A12 — le terrain est DÉTERMINISTE : même seed, même carte, au bit près', () => {
    const a = generateZonedTerrain(42)
    const b = generateZonedTerrain(42)
    expect(a.map.terrain).toEqual(b.map.terrain)
    expect([...a.palier]).toEqual([...b.palier])
    expect([...a.zone]).toEqual([...b.zone])
  }, 60_000)
})
