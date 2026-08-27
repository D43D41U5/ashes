/**
 * ═══ LES CLAIRIÈRES SONT PETITES, ET ELLES SONT VIVANTES ═══
 *
 * Deux promesses tenues à Alexis le 2026-08-25, et deux défauts qu'on interdit de revenir.
 *
 * **① « TROP GRANDES ».** L'ancien champ était un seuil sur du fbm, et un ensemble de
 * sur-niveau de bruit fractal n'a AUCUNE borne de taille — ce n'est pas un réglage à corriger,
 * c'est la nature de l'objet. MESURÉ avant le chantier (monde joué) : 1332 tuiles d'emprise
 * **56×88** sur la graine 2026, pour un écran de 20 tuiles de haut. Le nouveau générateur borne
 * PAR CONSTRUCTION ; ce fichier l'affirme en balayant la carte ENTIÈRE, sur plusieurs graines —
 * une propriété géométrique ne se garde pas sur trois cas choisis (`garde-exhaustive-plutot-que-cas`).
 *
 * **② « ON DIRAIT QUE C'EST RASÉ ».** Le défaut n'était pas que la taille. Le semis commun
 * sautait la clairière EN ENTIER : pas d'arbre — voulu — mais pas de baie, pas de fibre, pas un
 * nœud. Litière brune, zéro prop, zéro récolte. La garde §3 exige donc qu'une clairière PORTE,
 * et elle rougirait le jour où quelqu'un remettrait un `continue` dans le semis.
 *
 * ═══ CE QUI FERAIT ROUGIR CE FICHIER ═══
 *
 * Baisser `MARGE` à 0 (deux clairières de mailles voisines fusionnent → emprise doublée) ;
 * monter `TAILLE_MAX` sans qu'Alexis ait tranché ; laisser l'emprise mordre l'herbe (des tuiles
 * de clairière hors massif, donc à profondeur 0) ; retirer `clairiere` de `terrainAdmet` pour
 * les baies ; ou remettre un saut de clairière dans `placeZoneNodes`. Aucun de ces cinq gestes
 * ne casse une autre assertion de la suite : c'est pour eux que ce fichier existe.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_CLAIRIERE, TERRAIN_FOREST, TERRAINS } from './balance'
import { CLAIRIERE, peindreLesClairieres } from './clairieres'
import { TERRAINS_BOISES_MASSIF } from './profondeur'
import { CREUX } from './racine-relief'
import { BANC_JOUEURS } from './scenario'
import { generateZonedTerrain } from './zonegen'
import { MONDE_JOUE } from './zonegraph'
import { placeZoneNodes } from './zone-content'

/** ⚠ Le monde est GÉNÉRÉ ici, jamais tiré du cache : c'est la génération qu'on éprouve. */
const SEEDS = [2026, 7, 31]
const mondes = SEEDS.map((seed) => {
  const c = generateZonedTerrain(seed, BANC_JOUEURS, MONDE_JOUE)
  return { seed, c, nodes: placeZoneNodes(c) }
})

/** Les composantes connexes (4-voisins) du terrain de clairière, avec leur emprise. */
function composantes(terrain: readonly number[], width: number, height: number): { n: number; w: number; h: number; x: number; y: number }[] {
  const vu = new Uint8Array(width * height)
  const out: { n: number; w: number; h: number; x: number; y: number }[] = []
  const pile: number[] = []
  for (let s = 0; s < width * height; s++) {
    if (terrain[s] !== TERRAIN_CLAIRIERE || vu[s]) continue
    pile.length = 0
    pile.push(s)
    vu[s] = 1
    let n = 0, x0 = width, x1 = -1, y0 = height, y1 = -1
    while (pile.length > 0) {
      const i = pile.pop()!
      const tx = i % width
      const ty = (i - tx) / width
      n++
      if (tx < x0) x0 = tx
      if (tx > x1) x1 = tx
      if (ty < y0) y0 = ty
      if (ty > y1) y1 = ty
      const vois = [tx > 0 ? i - 1 : -1, tx < width - 1 ? i + 1 : -1, ty > 0 ? i - width : -1, ty < height - 1 ? i + width : -1]
      for (const j of vois) if (j >= 0 && terrain[j] === TERRAIN_CLAIRIERE && !vu[j]) { vu[j] = 1; pile.push(j) }
    }
    out.push({ n, w: x1 - x0 + 1, h: y1 - y0 + 1, x: x0, y: y0 })
  }
  return out
}

describe('les clairières — §1 la borne de taille', () => {
  /**
   * LA CONDITION DE NON-FUSION, énoncée à part parce qu'elle est la RAISON de la borne et non
   * sa conséquence : sans une marge de chaque côté de la maille, deux ancres posées de part et
   * d'autre d'une arête commune donneraient une trouée de deux fois `TAILLE_MAX`. C'est le
   * piège qui tue toutes les versions naïves de ce générateur.
   */
  it('la maille laisse une marge de chaque côté — la clause de non-fusion', () => {
    expect(CLAIRIERE.MAILLE).toBeGreaterThanOrEqual(CLAIRIERE.TAILLE_MAX + 2 * CLAIRIERE.MARGE)
    expect(CLAIRIERE.MARGE).toBeGreaterThanOrEqual(1)
  })

  /**
   * LA FORME RESTE DANS SON CADRE. Le contour ondule (`ONDULATION`) autour du rayon nominal ;
   * si l'amplitude pouvait pousser le bord au-delà du cadre, la clairière déborderait de son
   * emprise — et les deux contrats ci-dessus, qui reposent tous les deux sur « la trouée est
   * INCLUSE dans son emprise », tomberaient ensemble et en silence.
   */
  it('l\'ondulation ne peut pas pousser le bord hors du cadre', () => {
    expect(CLAIRIERE.RAYON + CLAIRIERE.ONDULATION / 2).toBeLessThanOrEqual(1)
  })

  /**
   * ⚠ **16 EST ÉCRIT EN TOUTES LETTRES, exprès.** Une garde rédigée avec la constante qu'elle
   * teste ne garde rien : `TAILLE_MAX * MOTIF` suivrait docilement le jour où quelqu'un monte
   * `TAILLE_MAX` à 6. C'est la DÉCISION d'Alexis qu'on grave — « petite zone » d'abord, puis
   * « il faudrait qu'elles soient en moyenne beaucoup plus petite » : 24 tuiles remplissaient
   * la hauteur de l'écran (20). À 16 la plus grande en occupe les quatre cinquièmes, et
   * l'ordinaire — une emprise d'un bloc — moins de la moitié. La remonter est légitime : ça se
   * fait EN TOUCHANT CETTE LIGNE, donc en le disant.
   */
  const BORNE_TUILES = 16

  it.each(SEEDS)('graine %i : aucune clairière ne dépasse la borne, sur toute la carte', (seed) => {
    const { c } = mondes.find((m) => m.seed === seed)!
    const comps = composantes(c.map.terrain, c.map.width, c.map.height)
    expect(comps.length).toBeGreaterThan(0) // sinon la garde ne garde rien : le monde EN A
    const pire = comps.reduce((a, b) => (Math.max(b.w, b.h) > Math.max(a.w, a.h) ? b : a))
    expect(Math.max(pire.w, pire.h),
      `la plus grande fait ${pire.w}×${pire.h} en (${pire.x},${pire.y})`).toBeLessThanOrEqual(BORNE_TUILES)
    expect(CLAIRIERE.TAILLE_MAX * CREUX.MOTIF).toBe(BORNE_TUILES) // la constante DIT la décision
  })

  /**
   * ⚠ LE PLANCHER SE MESURE SUR LA PASSE, PAS SUR LA CARTE FINIE — et c'est une leçon, pas une
   * facilité. Mesuré d'abord sur le monde joué : une composante de **5 tuiles** sur la graine 7.
   * Ce n'était pas un éclat de la passe, c'était une SENTE : les routes se tracent après (passe
   * 1.7) et peuvent couper une clairière en deux, dont un moignon. Un chemin qui traverse une
   * trouée est un fait du monde, pas un défaut du générateur — l'affirmer sur la carte finie
   * aurait obligé à relever le plancher, donc à taire le vrai contrat.
   *
   * On fait donc tourner la passe SEULE sur un bois plein, où rien d'autre ne peut découper.
   */
  it('aucun éclat : la passe seule ne pose jamais de composante sous MIN_TUILES', () => {
    const W = 400
    const H = 400
    const terrain = new Array<number>(W * H).fill(TERRAIN_FOREST)
    const zone = new Int32Array(W * H) // tout est la Racine (id 0)
    peindreLesClairieres(terrain, zone, 0, W, H, 2026)
    const comps = composantes(terrain, W, H)
    expect(comps.length).toBeGreaterThan(20) // sinon le balayage ne prouve rien
    const plusPetite = comps.reduce((a, b) => (b.n < a.n ? b : a))
    expect(plusPetite.n, `la plus petite fait ${plusPetite.n} tuiles en (${plusPetite.x},${plusPetite.y})`)
      .toBeGreaterThanOrEqual(CLAIRIERE.MIN_TUILES)
    // ET LA BORNE HAUTE TIENT AUSSI SUR CE BOIS PLEIN — sur la carte réelle, la forêt découpe
    // les trouées et ne peut que les rapetisser : c'est ici qu'elles ont la place de déborder.
    const pire = comps.reduce((a, b) => (Math.max(b.w, b.h) > Math.max(a.w, a.h) ? b : a))
    expect(Math.max(pire.w, pire.h), `${pire.w}×${pire.h} en (${pire.x},${pire.y})`).toBeLessThanOrEqual(16)
  })
})

describe('les clairières — §2 elles ne mordent que le bois', () => {
  /**
   * LA GARDE QUI PROTÈGE `profondeur`. Une clairière est une chambre DANS la masse, jamais une
   * trouée de lisière : sa tuile appartient encore au masque d'érosion du massif. Deux choses
   * en découlent, et c'est la même assertion qui les tient — si l'emprise avait mordu l'herbe,
   * cette herbe serait entrée dans le masque, tout le champ de profondeur aurait bougé, et avec
   * lui `stockDArbre`, les vieux fûts des cœurs et le tracé des coulées, EN SILENCE.
   */
  it.each(SEEDS)('graine %i : toute tuile de clairière est dans la Racine et dans un massif', (seed) => {
    const { c } = mondes.find((m) => m.seed === seed)!
    const { width, height, terrain, profondeur } = c.map
    let vues = 0
    for (let i = 0; i < width * height; i++) {
      if (terrain[i] !== TERRAIN_CLAIRIERE) continue
      vues++
      expect(c.zone[i]).toBe(c.graphe.racine)
      expect(profondeur?.[i] ?? 0).toBeGreaterThanOrEqual(1)
    }
    expect(vues).toBeGreaterThan(0)
  })
})

describe('les clairières — §3 elles PORTENT (le défaut « on dirait que c\'est rasé »)', () => {
  it.each(SEEDS)('graine %i : pas un arbre dans une clairière — c\'est sa définition', (seed) => {
    const { c, nodes } = mondes.find((m) => m.seed === seed)!
    const arbres = nodes.filter((n) => (n.type === 'tree' || n.type === 'old_tree')
      && c.map.terrain[n.ty * c.map.width + n.tx] === TERRAIN_CLAIRIERE)
    expect(arbres).toHaveLength(0)
  })

  /**
   * LE PLANCHER QUI DIT « CE N'EST PAS UNE COUPE RASE ». Avant le 2026-08-25 ce compte valait
   * ZÉRO — le semis commun sautait la clairière entière. Le plancher est délibérément BAS (un
   * nœud pour 60 tuiles de clairière) : on garde la PRÉSENCE, pas un volume, parce que le
   * volume, lui, se règle et se remesure. Ce qui rougirait : remettre un `continue` de
   * clairière dans `placeZoneNodes`, ou retirer `clairiere` de `terrainAdmet` pour les baies.
   */
  it.each(SEEDS)('graine %i : une clairière porte de quoi récolter', (seed) => {
    const { c, nodes } = mondes.find((m) => m.seed === seed)!
    const { width, terrain } = c.map
    const tuiles = terrain.filter((t) => t === TERRAIN_CLAIRIERE).length
    const dedans = nodes.filter((n) => terrain[n.ty * width + n.tx] === TERRAIN_CLAIRIERE)
    expect(dedans.length, `${dedans.length} nœuds pour ${tuiles} tuiles de clairière`)
      .toBeGreaterThanOrEqual(Math.floor(tuiles / 60))
    // ET SURTOUT DES BAIES, en nombre : c'est la demande d'Alexis du 2026-08-25 (« je veux
    // qu'il y ait plus de buisson à baies dans ce biome ») et c'est ce qui fait d'une trouée
    // une destination. Un buisson pour 20 tuiles au moins — soit une petite clairière d'un
    // bloc (~30 tuiles) qui en porte au minimum un, et l'ordinaire deux ou trois.
    const baies = dedans.filter((n) => n.type === 'berry_bush').length
    expect(baies, `${baies} buissons pour ${tuiles} tuiles`).toBeGreaterThanOrEqual(Math.floor(tuiles / 20))
  })

  /**
   * L'AUTRE MOITIÉ DE LA MÊME DÉCISION : *« on retire les buissons baies dans le biome
   * forest »*. La ronce est une plante de lumière — elle tient les bords, les coupes et les
   * trouées, jamais l'ombre d'une futaie. Balayé sur la carte ENTIÈRE : c'est une propriété du
   * monde, pas d'un échantillon.
   */
  it.each(SEEDS)('graine %i : pas un buisson à baies sous un couvert', (seed) => {
    const { c, nodes } = mondes.find((m) => m.seed === seed)!
    const sousCouvert = nodes.filter((n) => n.type === 'berry_bush'
      && TERRAINS_BOISES_MASSIF.includes(c.map.terrain[n.ty * c.map.width + n.tx]!))
    expect(sousCouvert.map((n) => `${n.tx},${n.ty}`)).toEqual([])
  })
})

describe('les clairières — §4 le biome est déclaré partout où il doit l\'être', () => {
  it('le terrain existe, il est marchable et À DÉCOUVERT', () => {
    const def = TERRAINS[TERRAIN_CLAIRIERE]
    expect(def?.name).toBe('clairiere')
    expect(def?.walkable).toBe(true)
    // `cover: 1` — la conséquence de jeu du biome : on y voit venir, et on s'y fait voir.
    expect(def?.cover).toBe(1)
  })

  /** Une bête doit pouvoir y vivre : sans ça, faire de la clairière un terrain RETIRE de
   *  l'habitat à la faune du massif, en silence — un compte n'est pas un contrat. */
  it('la faune du massif garde la clairière dans son habitat', async () => {
    const { MONSTER_DEFS } = await import('./balance')
    for (const espece of ['boar', 'deer', 'wolf', 'rabbit'] as const) {
      expect(MONSTER_DEFS[espece].habitat, espece).toContain(TERRAIN_CLAIRIERE)
    }
  })
})
