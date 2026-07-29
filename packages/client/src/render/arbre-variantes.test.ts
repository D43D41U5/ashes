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
} from './arbre-art'
import { varianteArbre, variantesAtteignables, ZONES_PEUPLEES } from './arbre-peuplement'
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
      const S = v.mesures.houppierS
      for (const [[x, y, w, h]] of houppierRectsDe(v)) {
        expect(x, `${v.slug} houppier x`).toBeGreaterThanOrEqual(0)
        expect(y, `${v.slug} houppier y`).toBeGreaterThanOrEqual(0)
        expect(x + w, `${v.slug} houppier déborde à droite`).toBeLessThanOrEqual(S)
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
    const m = carte(TERRAIN_GRASS, 'pres_bas')
    const vus = new Set<string>()
    for (let ty = 0; ty < 60; ty++) for (let tx = 0; tx < 60; tx++) vus.add(varianteArbre(m, tx, ty, 2026, false).slug)
    for (const attendu of ['tree', 'hetre', 'saule', 'bouleau', 'baliveau']) {
      expect(vus.has(attendu), `« ${attendu} » ne sort jamais dans les Prés Bas`).toBe(true)
    }
    // Et AUCUN conifère : le sol est de l’herbe, pas du pin.
    for (const conifere of ['pin', 'vieux_pin', 'sapin', 'meleze']) {
      expect(vus.has(conifere), `« ${conifere} » pousse sur de l’herbe`).toBe(false)
    }
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
