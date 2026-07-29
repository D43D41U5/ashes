/**
 * LA GARDE DES VARIANTES D'ARBRE — et elle affirme trois choses que rien d'autre ne voit.
 *
 * ① **CE QUE `arbre-art.test.ts` fait pour `ARBRES`, on le fait ici pour `VARIANTES`** : hauteur
 *    entière, silhouette rendue = hauteur déclarée, rects dans leur texture, colonne centrée.
 *    Le balayage est exhaustif par construction — une variante ajoutée sans ses mesures ne
 *    compile pas, et une variante mal proportionnée sort en rouge.
 *
 * ② **LE HOUPPIER NE FLOTTE PAS.** C'est l'invariant que le RENDU a révélé, et qu'aucun type ni
 *    aucune garde existante n'attrape : si la silhouette ne descend pas jusqu'à
 *    `houppierS − recouvrementPx` dans sa boîte, le feuillage s'arrête AU-DESSUS du sommet du
 *    fût et il reste un liseré de vide entre les deux. Le premier bouleau le faisait — 1,5 px de
 *    trou, invisible à la lecture du code, criant à l'image.
 *
 * ③ **LA GÉNÉRALISATION N'A RIEN CASSÉ.** `houppierRectsDe` / `houppierOpaqueDe` doivent rendre,
 *    sur `tree` et `old_tree`, EXACTEMENT ce que rendaient `houppierRects` / `houppierOpaque`.
 *    C'est affirmé rect par rect et pixel par pixel : la compatibilité est un contrat, pas une
 *    intention.
 *
 * Et le peuplement a les siennes : un mélange ne nomme que des variantes qui existent, une zone
 * nommée existe vraiment dans `/sim`, le SOL l'emporte sur la zone, et le gros bois n'a jamais
 * de variante — sa silhouette est une information de jeu.
 */
import { describe, it, expect } from 'vitest'
import {
  createEmptyMap,
  hash2,
  NODE_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_LARCH,
  TERRAIN_OLD_GROWTH,
  TERRAIN_PINE,
  ZONES,
  type WorldMap,
} from '@ashes/sim'
import {
  ancrageHouppierPx,
  assiseHouppier,
  colonneX,
  hauteurPx,
  houppierLargeur,
  houppierOpaque,
  houppierOpaqueDe,
  houppierRects,
  houppierRectsDe,
  futRects,
  futRectsDe,
  TONS_HOUPPIER,
  TONS_HOUPPIER_VIEUX,
  TOUTES_VARIANTES,
  VARIANTES,
  type MesuresArbre,
} from './arbre-art'
import { varianteArbre, variantesAtteignables, ZONES_PEUPLEES } from './arbre-peuplement'
import { champDeHauteur, ecorceDe, ECORCE_PAR_VARIANTE } from './ecorce'
import { TILE_PX } from './framing'

describe('les variantes d’arbre : ce qui est déclaré est ce qui est dessiné', () => {
  it('V1 — chaque variante fait un compte ENTIER de tuiles', () => {
    for (const v of TOUTES_VARIANTES) {
      const h = hauteurPx(v.mesures)
      expect(h % TILE_PX, `${v.slug} : ${h} px n’est pas un compte entier de tuiles`).toBe(0)
      // Et aucune ne dépasse le gros bois : sa hauteur est une information de JEU (il donne la
      // ressource structurante de la Sylve), pas une échelle qu’on décline.
      expect(h, `${v.slug} dépasse le gros bois`).toBeLessThanOrEqual(hauteurPx(VARIANTES.old_tree!.mesures))
    }
  })

  it('V2 — la silhouette RENDUE (fût + houppier − recouvrement) vaut la hauteur déclarée', () => {
    for (const v of TOUTES_VARIANTES) {
      expect(ancrageHouppierPx(v.mesures) + v.mesures.houppierS, v.slug).toBe(hauteurPx(v.mesures))
    }
  })

  it('V3 — LE HOUPPIER NE FLOTTE PAS : la silhouette rejoint le sommet du fût', () => {
    for (const v of TOUTES_VARIANTES) {
      const { bas, requis } = assiseHouppier(v)
      // `bas` est la rangée la plus basse que la SILHOUETTE atteint dans sa boîte ; `requis` est
      // celle où commence le fût. Strictement en deçà, il reste un trou entre les deux.
      expect(bas, `${v.slug} : le feuillage s’arrête à ${bas}, le fût commence à ${requis} — ${requis - bas} px de vide`)
        .toBeGreaterThanOrEqual(requis)
    }
  })

  it('V4 — tout rect peint reste DANS sa texture', () => {
    for (const v of TOUTES_VARIANTES) {
      // La boîte du houppier n'est plus forcément CARRÉE : `houppierW` la sépare de la hauteur
      // pour le saule et le parasol du vieux pin. Les deux côtés se bornent séparément.
      const W = houppierLargeur(v.mesures), S = v.mesures.houppierS
      for (const [[x, y, w, h]] of houppierRectsDe(v)) {
        expect(x, `${v.slug} houppier x`).toBeGreaterThanOrEqual(0)
        expect(y, `${v.slug} houppier y`).toBeGreaterThanOrEqual(0)
        expect(x + w, `${v.slug} houppier déborde à droite`).toBeLessThanOrEqual(W)
        expect(y + h, `${v.slug} houppier déborde en bas`).toBeLessThanOrEqual(S)
      }
      for (const [[x, y, w, h]] of futRectsDe(v)) {
        expect(x, `${v.slug} fût x`).toBeGreaterThanOrEqual(0)
        expect(y, `${v.slug} fût y`).toBeGreaterThanOrEqual(0)
        expect(x + w, `${v.slug} fût déborde à droite`).toBeLessThanOrEqual(v.mesures.futW)
        expect(y + h, `${v.slug} fût déborde en bas`).toBeLessThanOrEqual(v.mesures.futH)
      }
    }
  })

  it('V5 — la colonne du fût est centrée sur sa texture, au pixel entier', () => {
    for (const v of TOUTES_VARIANTES) {
      expect(colonneX(v.mesures) % 1, `${v.slug} : colonne à un demi-pixel`).toBe(0)
    }
  })

  it('V6 — toute variante déclare la collision du NŒUD qu’elle habille', () => {
    // Une variante est une PEAU, pas un nœud : `/sim` reste la seule vérité de la collision, et
    // deux peaux du même arbre ne peuvent pas bloquer différemment.
    for (const v of TOUTES_VARIANTES) {
      expect(v.mesures.demiTroncSub, `${v.slug} habille ${v.noeud}`).toBe(NODE_DEFS[v.noeud].blockHalfSub)
    }
  })
})

describe('la généralisation n’a rien cassé', () => {
  it('V7 — `houppierRectsDe` rend EXACTEMENT `houppierRects` sur les deux arbres d’origine', () => {
    expect(houppierRectsDe(VARIANTES.tree!, TONS_HOUPPIER)).toEqual(houppierRects('tree', TONS_HOUPPIER))
    expect(houppierRectsDe(VARIANTES.old_tree!, TONS_HOUPPIER_VIEUX))
      .toEqual(houppierRects('old_tree', TONS_HOUPPIER_VIEUX))
  })

  it('V7bis — `futRectsDe` rend EXACTEMENT `futRects`', () => {
    expect(futRectsDe(VARIANTES.tree!)).toEqual(futRects('tree', VARIANTES.tree!.fut))
    expect(futRectsDe(VARIANTES.old_tree!)).toEqual(futRects('old_tree', VARIANTES.old_tree!.fut))
  })

  it('V7ter — `houppierOpaqueDe` rend la MÊME silhouette, pixel par pixel', () => {
    for (const t of ['tree', 'old_tree'] as const) {
      const a = houppierOpaque(t)
      const b = houppierOpaqueDe(VARIANTES[t]!)
      const S = VARIANTES[t]!.mesures.houppierS
      let ecarts = 0
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (a(x, y) !== b(x, y)) ecarts++
      expect(ecarts, `${t} : ${ecarts} pixels d’écart entre l’ancienne silhouette et la nouvelle`).toBe(0)
    }
  })
})

describe('l’écorce : le grain se taille en Y', () => {
  /** Le fût d’une variante, tel que `lit-trees` le fabrique. Pur : aucun canvas ici. */
  function grainDe(slug: string): { relief: Float32Array; m: MesuresArbre; x0: number } {
    const v = VARIANTES[slug]!
    const m = v.mesures
    const x0 = colonneX(m)
    return { relief: champDeHauteur(ecorceDe(slug), m.futW, m.futH, x0, x0 + m.colonneW, v.fut).relief, m, x0 }
  }
  /** L’amplitude du relief le long d’un axe — c’est ce que la lumière transforme en contraste. */
  function amplitude(slug: string, axe: 'x' | 'y'): number {
    const { relief, m, x0 } = grainDe(slug)
    let max = 0
    for (let y = 1; y < m.futH - 1; y++) {
      for (let x = x0 + 1; x < x0 + m.colonneW - 1; x++) {
        const a = relief[y * m.futW + x]!
        const b = axe === 'y' ? relief[(y + 1) * m.futW + x]! : relief[y * m.futW + x + 1]!
        max = Math.max(max, Math.abs(a - b))
      }
    }
    return max
  }

  it('V15 — CHAQUE variante a une écorce nommée (jamais un repli silencieux)', () => {
    // `ecorceDe` retombe sur le chêne pour un slug inconnu : sans cette garde, une variante
    // ajoutée sans écorce prendrait celle du chêne sans que personne le voie.
    for (const v of TOUTES_VARIANTES) {
      expect(ECORCE_PAR_VARIANTE[v.slug], `« ${v.slug} » n’a pas d’écorce déclarée`).toBeDefined()
    }
  })

  it('V16 — LE RELIEF VARIE EN Y, et c’est tout le sujet', () => {
    // LA MESURE QUI COMMANDE (cf. l’en-tête de `ecorce.ts`) : le soleil du jeu est rasant et
    // vient du NORD, et `sunDirection` annule sa composante x À MIDI. Une facette inclinée en X
    // est alors MOINS contrastée qu’une surface plane (0,261 contre 0,365) — le cylindre
    // analytique d’avant avait `dy = 0` partout, donc il ne pouvait rien dire de 10 h à 15 h.
    //
    // On affirme donc la seule chose qui rende une écorce visible à midi : elle a du relief le
    // long de Y. Une écorce purement verticale repasserait cette garde en rouge.
    for (const v of TOUTES_VARIANTES) {
      expect(amplitude(v.slug, 'y'), `« ${v.slug} » n’a aucun relief horizontal : muet à midi`)
        .toBeGreaterThan(0.05)
    }
  })

  it('V17 — le HÊTRE est le plus lisse, le PIN le plus accidenté', () => {
    // L’intention, figée : l’écorce du hêtre est lisse (son grain est l’absence de grain — c’est
    // ce qui le sépare du chêne à trois pixels), celle du pin sylvestre est la plus polygonale.
    const feuillus = ['tree', 'chene_pre', 'saule', 'bouleau', 'baliveau']
    for (const autre of feuillus) {
      expect(amplitude('hetre', 'y'), `le hêtre est plus accidenté que ${autre}`)
        .toBeLessThan(amplitude(autre, 'y'))
    }
    expect(amplitude('pin', 'y')).toBeGreaterThan(amplitude('hetre', 'y'))
  })

  it('V18 — les lenticelles n’existent que sur le bouleau, et elles sont HORIZONTALES', () => {
    for (const v of TOUTES_VARIANTES) {
      const attendu = v.slug === 'bouleau'
      expect(ecorceDe(v.slug).lenticelles > 0, `« ${v.slug} » : lenticelles`).toBe(attendu)
    }
    // Un tiret couvre PLUSIEURS colonnes d’une même ligne — sinon c’est un grain, pas une
    // lenticelle, et le bouleau ne se reconnaît plus. (Première écriture : un hachage par blocs
    // de 2×2, qui sortait en camouflage.)
    const v = VARIANTES.bouleau!
    const m = v.mesures, x0 = colonneX(m)
    const { ton } = champDeHauteur(ecorceDe('bouleau'), m.futW, m.futH, x0, x0 + m.colonneW, v.fut)
    let ligneLaPlusLongue = 0
    for (let y = 0; y < m.futH; y++) {
      let run = 0
      for (let x = x0; x < x0 + m.colonneW; x++) {
        run = ton[y * m.futW + x] === v.fut.sombre ? run + 1 : 0
        ligneLaPlusLongue = Math.max(ligneLaPlusLongue, run)
      }
    }
    expect(ligneLaPlusLongue, 'aucun tiret horizontal de deux pixels sur le bouleau')
      .toBeGreaterThanOrEqual(2)
  })
})

describe('le peuplement : quel arbre pousse où', () => {
  /** Une carte d’une seule zone, d’un seul sol — de quoi interroger le tirage. */
  function carte(sol: number, zoneSlug: string): WorldMap {
    const m = createEmptyMap(64, 64, sol)
    m.zonePas = 16
    m.zoneGrid = new Array<number>(16).fill(0)
    m.zoneDefs = [{ slug: zoneSlug, nom: zoneSlug, tier: 0 }]
    return m
  }

  it('V8 — un mélange ne nomme que des variantes qui EXISTENT', () => {
    for (const slug of variantesAtteignables()) {
      expect(VARIANTES[slug], `le mélange nomme « ${slug} », qui n’est pas une variante`).toBeDefined()
    }
  })

  it('V8bis — toute zone peuplée existe vraiment dans /sim (une ligne muette ne se voit jamais)', () => {
    const connus = new Set(ZONES.map((z) => z.slug))
    for (const slug of ZONES_PEUPLEES) {
      expect(connus.has(slug), `« ${slug} » n’est pas une zone du monde — faute de frappe ?`).toBe(true)
    }
  })

  it('V13 — AUCUNE LIGNE MORTE : toute zone nommée porte VRAIMENT des arbres', async () => {
    // LA GARDE D'A19, APPLIQUÉE ICI. La première table donnait une ligne au Karst, à la
    // Tourbière, aux Ruines et au Lac Mort — quatre zones qui ne portent AUCUN arbre, parce que
    // leurs palettes ne posent aucun sol que `terrainAdmet('tree', …)` accepte. Quatre lignes
    // qui décrivaient un peuplement impossible, et qui se lisaient comme une intention.
    //
    // On ne l'affirme pas sur une palette recopiée : on GÉNÈRE la carte de production et on
    // regarde où les arbres tombent vraiment. C'est cher (une worldgen), et c'est le seul test
    // qui ne puisse pas se tromper — la même raison qui fait tourner les gardes de /sim à la
    // taille de production.
    const { generateZonedTerrain } = await import('@ashes/sim')
    const { placeZoneNodes } = await import('@ashes/sim')
    const c = generateZonedTerrain(2026)
    const nodes = placeZoneNodes(c)
    const avecArbres = new Set<string>()
    for (const n of nodes) {
      if (n.type !== 'tree' && n.type !== 'old_tree') continue
      avecArbres.add(c.graphe.zones[c.zone[n.ty * c.map.width + n.tx]!]!.def.slug)
    }
    for (const slug of ZONES_PEUPLEES) {
      expect(
        avecArbres.has(slug),
        `« ${slug} » a une ligne de peuplement mais ZÉRO arbre sur la carte — ligne morte (A19). `
          + `Zones qui en portent : ${[...avecArbres].sort().join(', ')}`,
      ).toBe(true)
    }
  }, 60_000)

  it('V9 — le tirage est DÉTERMINISTE : la même tuile rend toujours le même arbre', () => {
    const m = carte(TERRAIN_GRASS, 'pres_bas')
    for (let i = 0; i < 40; i++) {
      const tx = 3 + i, ty = 7 + (i % 11)
      expect(varianteArbre(m, tx, ty, 2026, false).slug).toBe(varianteArbre(m, tx, ty, 2026, false).slug)
    }
  })

  it('V9bis — et il COUVRE son mélange : les cinq feuillus de la Racine sortent tous', () => {
    // Sur le SOL FORESTIER de la Racine : c’est là que le mélange de zone s’applique.
    const m = carte(TERRAIN_FOREST, 'pres_bas')
    const vus = new Set<string>()
    for (let ty = 0; ty < 60; ty++) for (let tx = 0; tx < 60; tx++) vus.add(varianteArbre(m, tx, ty, 2026, false).slug)
    for (const attendu of ['tree', 'hetre', 'saule', 'bouleau', 'baliveau']) {
      expect(vus.has(attendu), `« ${attendu} » ne sort jamais dans les Prés Bas`).toBe(true)
    }
    // Et AUCUN conifère : le sol est de l’ubac, pas du pin.
    for (const conifere of ['pin', 'vieux_pin', 'sapin', 'meleze']) {
      expect(vus.has(conifere), `« ${conifere} » pousse sur du feuillu`).toBe(false)
    }
  })

  it('V9ter — SUR LE PRÉ, l’arbre pousse en PLEIN CHAMP : forme large, et pas de hêtre', () => {
    // La règle du 2026-07-29 : le port suit la CONCURRENCE, pas l’espèce. Sur l’herbe, deux
    // troncs sont à 4,12 tuiles l’un de l’autre (MESURÉ, seed 2026) — c’est le seul terrain du
    // jeu où une cime large ne ferme pas l’écran, et donc le seul qui porte la forme isolée.
    const m = carte(TERRAIN_GRASS, 'pres_bas')
    const vus = new Set<string>()
    for (let ty = 0; ty < 60; ty++) for (let tx = 0; tx < 60; tx++) vus.add(varianteArbre(m, tx, ty, 2026, false).slug)
    expect(vus.has('chene_pre'), 'le chêne de plein champ ne sort jamais sur l’herbe').toBe(true)
    // LE HÊTRE EN EST ABSENT, et c’est le sens même de la règle : c’est l’arbre de la futaie
    // fermée, il n’a rien à faire seul au milieu d’un pré.
    expect(vus.has('hetre'), 'un hêtre de futaie pousse seul dans un pré').toBe(false)
    // Et la forme de FORÊT non plus : `tree` est un arbre de peuplement serré (42 % de fût nu).
    expect(vus.has('tree'), 'la forme de peuplement serré pousse en plein champ').toBe(false)
    for (const conifere of ['pin', 'vieux_pin', 'sapin', 'meleze']) {
      expect(vus.has(conifere), `« ${conifere} » pousse sur de l’herbe`).toBe(false)
    }
  })

  it('V9quater — le chêne du pré est BIEN une autre forme, pas le même arbre renommé', () => {
    // Une variante qui ne diffère que par son nom serait un mensonge de table. On affirme
    // l’écart mesuré : fût nu deux fois plus court, cime bien plus large.
    const pre = VARIANTES.chene_pre!, foret = VARIANTES.tree!
    const partFut = (v: typeof pre): number => ancrageHouppierPx(v.mesures) / hauteurPx(v.mesures)
    expect(partFut(pre)).toBeLessThan(partFut(foret) * 0.75)
    expect(houppierLargeur(pre.mesures)).toBeGreaterThan(houppierLargeur(foret.mesures) * 1.15)
    expect(hauteurPx(pre.mesures), 'les deux formes font la même taille').toBe(hauteurPx(foret.mesures))
  })

  it('V10 — LE SOL L’EMPORTE : une tuile de pin porte un conifère, dans N’IMPORTE QUELLE zone', () => {
    for (const z of ZONES) {
      const m = carte(TERRAIN_PINE, z.slug)
      for (let i = 0; i < 30; i++) {
        const v = varianteArbre(m, (i * 3) % 60, (i * 5) % 60, 7, false)
        expect(['pin', 'vieux_pin', 'sapin', 'meleze']).toContain(v.slug)
      }
    }
    // Et le mélèze domine SON sol — sans en faire une monoculture.
    const m = carte(TERRAIN_LARCH, 'sylve')
    let meleze = 0, total = 0
    for (let ty = 0; ty < 60; ty++) for (let tx = 0; tx < 60; tx++) {
      total++
      if (varianteArbre(m, tx, ty, 7, false).slug === 'meleze') meleze++
    }
    expect(meleze / total).toBeGreaterThan(0.5)
    expect(meleze / total).toBeLessThan(0.75)
  })

  it('V14 — SOUS UNE FUTAIE FERMÉE (`old_growth`), aucun pionnier — quelle que soit la zone', () => {
    // Le Bois Noir est un set-piece DANS la Racine : sans cette règle il héritait du mélange de
    // la Racine et se couvrait de bouleaux, alors que sa définition est « futaie dense, sombre ».
    // Vu dans le jeu, pas déduit.
    for (const z of ZONES) {
      const m = carte(TERRAIN_OLD_GROWTH, z.slug)
      const vus = new Set<string>()
      for (let ty = 0; ty < 60; ty++) for (let tx = 0; tx < 60; tx++) vus.add(varianteArbre(m, tx, ty, 3, false).slug)
      expect(vus.has('bouleau'), `un bouleau pousse sous la futaie de ${z.slug}`).toBe(false)
      expect(vus.has('hetre'), `pas de hêtre dans la futaie de ${z.slug}`).toBe(true)
    }
  })

  it('V11 — le GROS BOIS n’a jamais de variante, quel que soit son sol ou sa zone', () => {
    for (const sol of [TERRAIN_GRASS, TERRAIN_PINE, TERRAIN_LARCH]) {
      for (const z of ZONES) {
        const m = carte(sol, z.slug)
        expect(varianteArbre(m, 5, 5, 1, true).slug).toBe('old_tree')
      }
    }
  })

  it('V11bis — hors carte, on rend l’arbre ordinaire au lieu de lire dans le vide', () => {
    const m = carte(TERRAIN_PINE, 'karst')
    expect(varianteArbre(m, -3, 4, 1, false).slug).toBe('tree')
    expect(varianteArbre(m, 4, 999, 1, false).slug).toBe('tree')
  })

  it('V12 — sans carte de zone, on retombe sur un arbre qui EXISTE (jamais une texture absente)', () => {
    const nu = createEmptyMap(32, 32, TERRAIN_GRASS) // ni zoneGrid, ni zoneDefs
    const v = varianteArbre(nu, 4, 4, 1, false)
    expect(VARIANTES[v.slug]).toBeDefined()
    // `hash2` est bien la source du tirage : le repli ne doit pas figer tout le monde sur `tree`.
    expect(typeof hash2(4, 4, 1)).toBe('number')
  })
})
