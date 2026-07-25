import { describe, expect, it } from 'vitest'
import {
  LIT_CLUTTER_KINDS, LIT_NODE_TYPES, LIT_PROP_KEYS, litClutterTextureKey,
  FLOWERS, PEBBLES, VARIANT_COUNTS, variantBase,
} from './lit-props'
import { BIOME_CLUTTER } from './clutter'

/**
 * Le câblage `_lit`/`_lit_m`, testé en DONNÉES PURES (pas de scène Phaser). Un `kind` dans
 * `LIT_CLUTTER_KINDS` sans texture générée fait rendre le carré vert `__MISSING` de Phaser — que
 * `tsc` ne voit pas (deux chaînes) et qu'aucun autre test ne pinçait. On l'attrape ici plutôt que
 * par une capture d'écran (la session précédente a brûlé un smoke entier pour l'établir à la main).
 */
describe('câblage des variantes cubiques (_lit / _lit_m)', () => {
  it('chaque kind câblé a SES DEUX textures générées — la clé demandée par ClutterLayer existe', () => {
    for (const kind of LIT_CLUTTER_KINDS) {
      // Le stem de texture que ClutterLayer va POSER : une famille (flower, pebbles) a N variétés, les
      // autres un seul. Même calcul que la couche de rendu (VARIANT_COUNTS / variantBase).
      const count = VARIANT_COUNTS[kind]
      const bases = count !== undefined ? Array.from({ length: count }, (_, i) => variantBase(kind, i)) : [kind]
      for (const base of bases) {
        expect(LIT_PROP_KEYS.has(litClutterTextureKey(base, false))).toBe(true) // `cl-<base>_lit`
        expect(LIT_PROP_KEYS.has(litClutterTextureKey(base, true))).toBe(true) //  `cl-<base>_lit_m`
      }
    }
  })

  it('fleurs ET cailloux ont plusieurs variétés DISTINCTES (pas un pré/sol cloné)', () => {
    expect(VARIANT_COUNTS.flower).toBeGreaterThanOrEqual(3)
    expect(new Set(FLOWERS.map((f) => f.bloom)).size).toBe(FLOWERS.length) // couleurs toutes différentes
    expect(new Set(FLOWERS.map((f) => JSON.stringify(f.rects))).size).toBeGreaterThanOrEqual(3)
    expect(VARIANT_COUNTS.pebbles).toBeGreaterThanOrEqual(3)
    expect(new Set(PEBBLES.map((p) => JSON.stringify(p.rects))).size).toBe(PEBBLES.length) // configs toutes différentes
  })

  it('couvre les features nommées par Alexis (fleurs, mousse, touffes) + la masse pâteuse', () => {
    for (const kind of ['grass_tuft', 'flower', 'lichen', 'sphagnum', 'bush', 'low_bush', 'boulder', 'reed', 'pebbles'])
      expect(LIT_CLUTTER_KINDS.has(kind)).toBe(true)
  })

  it('TOUT-OU-RIEN : aucun prop de clutter des biomes rendus ne reste plat (tous ont un `_lit`)', () => {
    const rendered = new Set<string>()
    for (const cfg of Object.values(BIOME_CLUTTER)) {
      for (const k of cfg.props) rendered.add(k)
      if (cfg.groves) rendered.add(cfg.groves.kind)
    }
    for (const kind of rendered) expect(LIT_CLUTTER_KINDS.has(kind)).toBe(true)
  })

  it('chaque type de nœud câblé a sa texture `nd-<type>_lit` générée (whitelist ≠ préfixe nd-)', () => {
    // `LIT_NODE_TYPES` est une liste EXPLICITE de `n.type`, pas une dérivation du namespace `nd-`
    // (qui contient aussi des sprites non-nœuds). On vérifie qu'aucun membre n'est sans texture.
    for (const type of LIT_NODE_TYPES) expect(LIT_PROP_KEYS.has(`nd-${type}_lit`)).toBe(true)
  })

  it('le nœud roche est câblé, sans variante miroir (les nœuds ne se miroitent pas)', () => {
    expect(LIT_NODE_TYPES.has('rock')).toBe(true)
    expect(LIT_PROP_KEYS.has('nd-rock_lit')).toBe(true)
    expect(LIT_PROP_KEYS.has('nd-rock_lit_m')).toBe(false)
  })
})
