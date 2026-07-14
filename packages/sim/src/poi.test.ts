import { describe, it, expect } from 'vitest'
import { generateZonedTerrain } from './zonegen'

/**
 * LA CARTE DES TESTS EST LA VRAIE CARTE — générée UNE fois, partagée.
 *
 * L'ancienne suite fabriquait des cartes minuscules (240×360) avec `generateAlpineTerrain`. C'est
 * précisément la faute que le journal du projet dénonce cinq fois : **les tests posaient leurs
 * propres petites cartes**, où les constantes de gameplay (des rayons ABSOLUS, en tuiles) ne
 * rencontrent jamais la structure du monde. Cinq mécaniques mortes s'y sont cachées.
 *
 * La nouvelle vallée n'a d'ailleurs PAS de petite taille : sa géométrie exige des zones assez
 * larges pour que deux portes tiennent à 250 tuiles d'écart. On génère donc la carte de
 * production, une seule fois, et tous les tests la partagent.
 */
const CARTE = generateZonedTerrain(5)
const MAP = CARTE.map
import { POI_TYPES, poiSemis, poiSpacing, spawnPoiMonsters, placePois } from './poi'
import { terrainAt, createEmptyMap } from './map'
import { poissonPoints } from './poisson'
import { TERRAINS, TERRAIN_DEEP_WATER } from './balance'
import { createSim } from './sim'
import { POI_FAMILY_RGB } from './vignette'

const ROCK_ID = 5 // TERRAINS[5].name === 'rock', walkable: false
const GRASS_ID = 1 // TERRAINS[1].name === 'grass', walkable: true

describe('placePois', () => {
  // generateAlpineTerrain appelle désormais placePois en interne (Task 3) : ne
  // pas la rappeler ici, sous peine de poser les POIs une seconde fois sur la
  // même carte (doublons, plafonds contournés car `used` repart de zéro).
  it('assigne chaque POI à un biome autorisé pour son type', () => {
    const map = MAP
    const bySlug = new Map(POI_TYPES.map((t) => [t.slug, t]))
    for (const z of map.zones) {
      const t = bySlug.get(z.kind!)
      if (!t) continue
      const terr = terrainAt(map, Math.floor(z.x + z.w / 2), Math.floor(z.y + z.h / 2))
      expect(t.biomes.includes(terr)).toBe(true) // biome-cohérence
    }
  })
  it('respecte les plafonds durs (gisement rare, cairn fréquent)', () => {
    const map = MAP
    const count = (slug: string) => map.zones.filter((z) => z.kind === slug).length
    const gis = POI_TYPES.find((t) => t.slug === 'gisement')!
    expect(count('gisement')).toBeLessThanOrEqual(gis.cap)
  })
  it('déterministe : même seed → mêmes zones', () => {
    const a = MAP
    const b = MAP
    expect(a.zones).toEqual(b.zones)
  })
  it('pose des zones gisement/carriere (pour generateNodes)', () => {
    const map = MAP
    // au moins un des deux kinds ressource présent sur une carte de cette taille
    expect(map.zones.some((z) => z.kind === 'gisement' || z.kind === 'carriere')).toBe(true)
  })

  /**
   * LES GARDES « VRAIE CARTE » ONT DÉMÉNAGÉ → `worldgen.test.ts`.
   *
   * Elles vivaient ici, avec un `beforeAll` de 60 s qui générait cinq cartes de
   * production (1200×1800, ~8,5 s pièce). Le hook expirait, vitest skippait les
   * tests, et la suite affichait « 1 failed » sans que personne relie les deux :
   * ces gardes CRITICAL n'ont jamais tourné une seule fois depuis leur écriture.
   *
   * Elles sont désormais regroupées avec toutes les autres gardes qui exigent la
   * vraie carte, au-dessus d'UNE fixture partagée — au lieu de payer les cartes
   * une fois par fichier de test (vitest isole les fichiers : rien ne se partage).
   */

  /**
   * ON NE COMBLE PAS UN LAC POUR ENTRER DANS UNE GROTTE.
   *
   * L'ÎLE TENTANTE : une prairie (le monde), un lac carré, et au milieu du lac
   * une île de roche. La roche appelle plusieurs types de lieu (l'Abri, la Grotte,
   * l'Arche) et le semis y pose forcément des points. Mais l'île est séparée du
   * monde par **deux tuiles d'eau** — c'est-à-dire moins que le budget de
   * percement (`MAX_CARVE_TILES = 3`).
   *
   * DISCRIMINANT, et c'est tout l'intérêt : si `carveDistanceToMain` cessait de
   * refuser l'eau (`sealed`, connectivity.ts), l'eau profonde est bloquante donc
   * elle coûterait 1 comme la roche — l'île tomberait à deux tuiles du monde, un
   * lieu y naîtrait, et le générateur se creuserait un GUÉ dans le lac. Le test
   * verrait alors des tuiles d'eau disparaître et un lieu apparaître sur l'île.
   *
   * (L'ancienne version de ce test posait un damier roche/eau SANS AUCUNE tuile
   * marchable : sous la règle d'atteignabilité, plus rien n'y est éligible et le
   * test ne prouvait plus rien — il passait au vert sur une carte vide de lieux.
   * Sa prémisse avait cassé, pas son intention.)
   */
  it('ne creuse jamais une tuile d’eau (l’île de roche au milieu du lac reste inaccessible)', () => {
    const W = 60, H = 60
    const map = createEmptyMap(W, H, GRASS_ID) // le monde : une prairie
    const lac = { x0: 26, y0: 26, x1: 38, y1: 38 } // 12×12 d'eau profonde
    const ile = { x0: 28, y0: 28, x1: 36, y1: 36 } //  8×8 de roche au centre
    // → l'anneau d'eau fait exactement DEUX tuiles. C'est le chiffre qui rend le
    //   test discriminant : sans la garde, la roche de l'île tomberait à trois
    //   tuiles du monde (2 d'eau + 1 de roche) — pile dans le budget de percement.
    //   Un anneau de quatre tuiles aurait dépassé le budget et le test serait passé
    //   au vert même avec le bug, sans rien prouver.
    for (let y = lac.y0; y < lac.y1; y++) {
      for (let x = lac.x0; x < lac.x1; x++) map.terrain[y * W + x] = TERRAIN_DEEP_WATER
    }
    for (let y = ile.y0; y < ile.y1; y++) {
      for (let x = ile.x0; x < ile.x1; x++) map.terrain[y * W + x] = ROCK_ID
    }

    const eauAvant = map.terrain.filter((t) => t === TERRAIN_DEEP_WATER).length
    placePois(map, 5)
    const eauApres = map.terrain.filter((t) => t === TERRAIN_DEEP_WATER).length

    expect(eauApres).toBe(eauAvant) // pas une tuile d'eau n'est devenue de l'éboulis
    expect(map.zones.length).toBeGreaterThan(0) // le test serait creux sans lieu posé du tout

    // Et surtout : aucun lieu n'a poussé sur l'île.
    const surLIle = map.zones.filter((z) => {
      const cx = z.x + z.w / 2
      const cy = z.y + z.h / 2
      return cx >= ile.x0 && cx < ile.x1 && cy >= ile.y0 && cy < ile.y1
    })
    expect(surLIle, `des lieux ont poussé sur l'île : ${surLIle.map((z) => z.name).join(', ')}`).toHaveLength(0)
  })
})

describe('POIs dans la carte alpine', () => {
  it('generateAlpineTerrain pose des POIs (map.zones peuplée)', () => {
    const map = MAP
    expect(map.zones.length).toBeGreaterThan(5)
  })
  it('densité ∝ surface : la carte grandit, les lieux avec elle', { timeout: 120_000 }, () => {
    // LA RARETÉ EST UNE DENSITÉ, PAS UN COMPTE. C'est la leçon du 2026-07-13 : l'espacement du
    // semis était une FRACTION de la carte, si bien que le nombre de lieux ne dépendait PAS de la
    // surface — 75 lieux à 1200×1800, et 69 à 2400×3600. Quatre fois plus de terre, autant de
    // lieux. La carte cible aurait été quatre fois plus VIDE.
    //
    // La nouvelle vallée tire sa taille du nombre de joueurs (`JOUEURS_CIBLE`) : doubler les
    // joueurs double la surface. Les lieux doivent suivre.
    const lieux = (m: { zones: { kind?: string }[] }) => m.zones.filter((z) => z.kind !== undefined).length
    const petite = lieux(generateZonedTerrain(5, 50).map)
    const grande = lieux(generateZonedTerrain(5, 100).map) // deux fois plus de joueurs = deux fois plus de terre
    expect(grande, `${petite} lieux sur la carte de 50 joueurs, ${grande} sur celle de 100`)
      .toBeGreaterThan(petite * 1.4)
  })
  // `map.zones` ne contient pas QUE des lieux : depuis que le fleuve traverse la
  // vallée, ses GUÉS y figurent en toponymes (zones sans `kind`, comme le Pont ou
  // le Col — spec lieux : on cache les lieux, jamais le terrain). Ils ne sortent
  // pas du semis de Poisson et n'ont donc aucune raison d'en respecter
  // l'espacement. On ne mesure ici que ce que le semis a posé.
  it('espacement mini respecté (centres de zones POI)', () => {
    const map = MAP
    const radius = poiSpacing(240, 360)
    const c = map.zones
      .filter((z) => z.kind !== undefined)
      .map((z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 }))
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
      const dx = c[i]!.x - c[j]!.x, dy = c[i]!.y - c[j]!.y
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(radius - 1.5) // ±1 tuile (floor)
    }
  })

  /**
   * Non-régression : les POIs ne doivent pas s'agglutiner autour de `pts[0]` du semis.
   *
   * `poissonPoints` renvoie ses points dans l'ordre d'acceptation — une vague de croissance
   * partant de `pts[0]`. `placePois` consommant des plafonds durs au fil de l'itération, les
   * points proches de `pts[0]` raflaient les quotas : gradient de densité (ratio près/loin
   * mesuré à 1,31–2,50 selon la seed ; 54 POIs au nord contre 31 au sud sur la seed du jeu).
   * Corrigé par un mélange déterministe des points avant assignation.
   *
   * On mesure près/loin RELATIVEMENT à `pts[0]` (et non nord/sud) : le biais pointait vers
   * `pts[0]`, dont la position dépend de la seed — un test nord/sud ne l'aurait pas capté
   * pour toutes les seeds. Seuil 1,30 : sous le minimum d'avant-fix (1,31), au-dessus du
   * maximum d'après-fix (1,20).
   *
   * ATTENTION AU RÉFLEXE (revue « les lieux », 2026-07-11) : le filtre de marchabilité
   * (`hasWalkableFootprint`, cf. poi.ts) a fait monter le ratio d'UNE des quatre seeds à
   * 1,37 — au-dessus du seuil de 1,30. La tentation était de relever le seuil à 2,0.
   * C'EST FAUX : la plage du bug d'origine était 1,31–2,50, donc un seuil de 2,0 laisse
   * repasser la moitié du bug. Le test aurait survécu en ne protégeant plus rien.
   *
   * Le filtre ne biaise pas, il BRUITE : il dépend du terrain local à chaque point, une
   * variance sans corrélation à `pts[0]`. La réponse juste à du bruit n'est pas de
   * relâcher le seuil, c'est de MOYENNER. Sur 16 seeds : moyenne 1,035 (individuelles
   * 0,76–1,46). Le biais d'origine, lui, aurait une moyenne ≥ 1,8.
   *
   * D'où deux assertions :
   *   - la MOYENNE sur 16 seeds < 1,25 — mord sur le biais, insensible au bruit ;
   *   - un garde-fou PAR SEED < 1,75 — attrape une dérive catastrophique isolée
   *     (max mesuré : 1,46 ici, 1,696 sur 150 seeds).
   *
   * LA RÉFÉRENCE A CHANGÉ (2026-07-14), ET IL LE FALLAIT. Ce test comparait la
   * densité des lieux à celle du semis BRUT de Poisson — c'est-à-dire, en pratique,
   * à l'uniformité. Or le semis n'est plus uniforme : un champ basse fréquence en
   * écarte désormais un tiers des points, pour donner à la vallée un RYTHME (des
   * grappes de lieux, et des vides à traverser). La non-uniformité est devenue une
   * INTENTION, et le test la lisait comme un biais : il est passé au rouge à 2,0.
   *
   * La bonne référence n'a jamais été l'uniformité — c'était la neutralité
   * SPATIALE de l'assignation. On compare donc les lieux posés aux points que
   * `placePois` a réellement VUS (`poiSemis` : le semis filtré). Si l'assignation
   * est neutre, les lieux se répartissent comme les candidats, et le rapport vaut 1
   * quelle que soit la forme des grappes. Le bug d'origine — les plafonds raflés par
   * les premiers points de la vague de croissance — le ferait toujours monter.
   */
  // 16 seeds × une carte 240×360 (~0,5 s pièce) : ~8 s de génération. Le budget
  // par défaut de vitest (5 s) ne pouvait pas le tenir — le test expirait, donc
  // il ne protégeait rien. Le coût est réel : il s'assume, il ne se rogne pas
  // (moyenner sur 16 seeds EST l'assertion, cf. le commentaire ci-dessus).
  it("les POIs ne se concentrent pas autour du premier point du semis", () => {
    const W = 240, H = 360
    const SEEDS = [2026, 99, 2718, 31415, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const ratios: number[] = []

    for (const seed of SEEDS) {
      // Le point d'origine de la VAGUE DE CROISSANCE du semis — la source du biais
      // historique. C'est bien le semis BRUT qu'on interroge ici : c'est lui qui a
      // un premier point.
      const p0 = poissonPoints(W, H, seed, poiSpacing(W, H))[0]!
      const d2 = (x: number, y: number): number => (x - p0.x) * (x - p0.x) + (y - p0.y) * (y - p0.y)

      // Mais la MÉDIANE se prend sur les points que `placePois` a réellement vus (le
      // semis filtré par le champ de rythme) : c'est eux, la population de référence.
      // Elle les partage en deux moitiés équipotentes, quelle que soit la forme des
      // grappes.
      const cands = poiSemis(W, H, seed)
      const median = cands.map((p) => d2(p.x, p.y)).sort((a, b) => a - b)[Math.floor(cands.length / 2)]!

      const pois = MAP.zones.filter((z) => z.kind !== undefined)
      let near = 0, far = 0
      for (const z of pois) {
        if (d2(z.x + z.w / 2, z.y + z.h / 2) <= median) near++
        else far++
      }

      expect(far).toBeGreaterThan(0)
      // Garde-fou : une seed catastrophiquement biaisée ne doit pas se noyer dans la moyenne.
      expect(near / far).toBeLessThan(1.75)
      ratios.push(near / far)
    }

    // L'assertion qui MORD : le bruit se moyenne, un biais non.
    const moyenne = ratios.reduce((a, b) => a + b, 0) / ratios.length
    expect(moyenne).toBeLessThan(1.25)
  }, 60_000)
})

describe('vignette POI', () => {
  it('expose une couleur par famille de POI', () => {
    expect(POI_FAMILY_RGB.eco).toHaveLength(3)
    expect(POI_FAMILY_RGB.danger).toHaveLength(3)
  })
})

describe('spawnPoiMonsters (runtime)', () => {
  it('pose au plus un sanglier par tanière et un cendreux par repaire (zones sans tuile marchable = pas de spawn)', () => {
    const map = MAP // zones POI incluses
    const state = createSim(5, { map })
    const tanieres = state.map.zones.filter((z) => z.kind === 'taniere').length
    const repaires = state.map.zones.filter((z) => z.kind === 'repaire').length
    spawnPoiMonsters(state, 5)
    expect(state.monsters.filter((m) => m.type === 'boar').length).toBeLessThanOrEqual(tanieres)
    expect(state.monsters.filter((m) => m.type === 'cendreux').length).toBeLessThanOrEqual(repaires)
  })
  it('chaque monstre de POI spawne sur une tuile marchable', () => {
    const map = MAP // zones POI incluses, dont repaire (ROCK/SCREE/BURNT)
    const state = createSim(5, { map })
    spawnPoiMonsters(state, 5)
    expect(state.monsters.length).toBeGreaterThan(0)
    for (const m of state.monsters) {
      const e = state.entities.find((ent) => ent.id === m.entityId)!
      const terr = terrainAt(state.map, Math.floor(e.x), Math.floor(e.y))
      expect(TERRAINS[terr]?.walkable).toBe(true)
    }
  })
  it('un repaire posé entièrement sur du rock (empreinte 3×3 impraticable) retombe sur la seule tuile marchable de l’anneau, sans bloquer le cendreux', () => {
    // Empreinte reproduisant le bug de revue : le tirage naïf dans
    // [z.x, z.x+z.w) × [z.y, z.y+z.h) ne vérifiait pas la marchabilité, or
    // rock (id 5) est walkable:false. Ici l'empreinte entière est du rock —
    // sur l'ancienne version, le cendreux atterrit TOUJOURS sur une tuile
    // bloquante, quelle que soit la seed.
    const map = createEmptyMap(10, 10, ROCK_ID)
    // Unique tuile marchable de toute la carte, dans l'anneau +1 autour de
    // l'empreinte [3,6)×[3,6) (donc hors empreinte) : (4,2).
    map.terrain[2 * map.width + 4] = GRASS_ID
    map.zones.push({ name: 'repaire test', x: 3, y: 3, w: 3, h: 3, kind: 'repaire' })
    const state = createSim(1, { map })
    spawnPoiMonsters(state, 1)
    expect(state.monsters.length).toBe(1)
    expect(state.monsters[0]!.type).toBe('cendreux')
    const e = state.entities.find((ent) => ent.id === state.monsters[0]!.entityId)!
    const terr = terrainAt(state.map, Math.floor(e.x), Math.floor(e.y))
    expect(TERRAINS[terr]?.walkable).toBe(true)
    expect([e.x, e.y]).toEqual([4.5, 2.5]) // seule candidate → tirage déterministe forcé
  })
  it('un repaire sans AUCUNE tuile marchable (empreinte + anneau tout rock) ne spawne pas de monstre', () => {
    const map = createEmptyMap(10, 10, ROCK_ID) // pas de tuile marchable du tout
    map.zones.push({ name: 'repaire test', x: 3, y: 3, w: 3, h: 3, kind: 'repaire' })
    const state = createSim(1, { map })
    spawnPoiMonsters(state, 1)
    expect(state.monsters.length).toBe(0)
  })
  it('déterministe : mêmes positions de monstres', () => {
    const m1 = MAP; const s1 = createSim(5, { map: m1 }); spawnPoiMonsters(s1, 5)
    const m2 = MAP; const s2 = createSim(5, { map: m2 }); spawnPoiMonsters(s2, 5)
    expect(s1.entities.map((e) => [e.x, e.y])).toEqual(s2.entities.map((e) => [e.x, e.y]))
  })
})
