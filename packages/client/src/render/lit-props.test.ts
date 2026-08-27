import { describe, expect, it } from 'vitest'
import {
  LIT_CLUTTER_KINDS, LIT_NODE_TYPES, LIT_PROP_KEYS, litClutterTextureKey,
  FLOWERS, PEBBLES, PEBBLE_SHADOW, pebbleShadowRects, VARIANT_COUNTS, variantBase,
} from './lit-props'
import { BIOME_CLUTTER } from './clutter'
import { cleDeSocle, estUnSocle, SOCLE_KEYS, SOCLE_TYPES } from './socle-mineral'

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

  it('CHAQUE bloc de caillou a son ombre au pied, dans la tuile (une variété plus basse clipperait)', () => {
    for (const p of PEBBLES) {
      const shadows = pebbleShadowRects(p)
      expect(shadows.length).toBe(p.rects.length) // un bloc = une ombre, aucun oublié
      shadows.forEach(([sx, sy, sw, sh], i) => {
        const [bx, by, bw, bh] = p.rects[i]!
        expect(sy).toBe(by + bh) // collée SOUS le bloc, jamais flottante
        expect(sx + sw / 2).toBe(bx + bw / 2) // CENTRÉE : pas de décalage soleil, le miroir reste juste
        // Le débord latéral est ce qui fait lire « flaque au sol » et non « rangée basse du cube ».
        expect(sw).toBe(bw + 2 * (bw >= PEBBLE_SHADOW.minW ? PEBBLE_SHADOW.overhang : 0))
        expect(sx).toBeGreaterThanOrEqual(0)
        expect(sx + sw).toBeLessThanOrEqual(16)
        expect(sy + sh).toBeLessThanOrEqual(16) // la tuile fait 16 px : un bloc au ras du bas clipperait
      })
    }
  })

  it('chaque type de nœud câblé a sa texture `nd-<type>_lit` générée (whitelist ≠ préfixe nd-)', () => {
    // `LIT_NODE_TYPES` est une liste EXPLICITE de `n.type`, pas une dérivation du namespace `nd-`
    // (qui contient aussi des sprites non-nœuds). On vérifie qu'aucun membre n'est sans texture.
    for (const type of LIT_NODE_TYPES) expect(LIT_PROP_KEYS.has(`nd-${type}_lit`)).toBe(true)
  })

  it('LES SIX SOCLES sont câblés — trois hauteurs chacun, et AUCUN ne reste dans la masse pâteuse', () => {
    // Le socle minéral (`socle-mineral.ts`) a quitté `PROPS` : ses clés vivent dans SOCLE_KEYS,
    // à trois hauteurs. La garde attrape les deux moitiés de l'erreur possible : une matière
    // oubliée à la cuisson, et une matière restée en double dans `LIT_NODE_TYPES` — auquel cas
    // SnapshotView demanderait `nd-rock_lit`, qui n'existe plus, et Phaser peindrait son carré vert.
    for (const type of SOCLE_TYPES) {
      expect(estUnSocle(type)).toBe(true)
      expect(LIT_NODE_TYPES.has(type), `${type} : le socle ne passe pas par la masse pâteuse`).toBe(false)
      for (const taille of [0, 1, 2]) {
        expect(SOCLE_KEYS.has(cleDeSocle(type, taille)), `${type}-${taille}`).toBe(true)
        expect(SOCLE_KEYS.has(`${cleDeSocle(type, taille)}_lit`), `${type}-${taille}_lit`).toBe(true)
      }
      expect(LIT_PROP_KEYS.has(`nd-${type}_lit`), `${type} : l'ancienne clé plate ne doit plus exister`).toBe(false)
    }
  })

  it('LA VAGUE A (da-feeling R3) : les nœuds restants ont leur _lit — et le câblage par BRANCHES est documenté', () => {
    // Les 4 états du buisson à baies, la pousse, la fibre, les gravats, la souche, la cicatrice.
    for (const key of ['nd-berry_bush-0', 'nd-berry_bush-1', 'nd-berry_bush-2', 'nd-berry_bush-3', 'nd-sapling', 'nd-fiber_plant', 'nd-stump', 'nd-scar']) {
      expect(LIT_PROP_KEYS.has(`${key}_lit`), key).toBe(true)
      expect(LIT_PROP_KEYS.has(`${key}_lit_m`), `${key} : un nœud ne se miroite pas`).toBe(false)
    }
    // fiber_plant passe par le whitelist générique ; berry_bush et sapling passent par leurs
    // BRANCHES SPÉCIALES de SnapshotView (berryDots, repousse) — les mettre ici serait du câblage
    // mort et trompeur (note d'intégration de la vague A). Les gravats, eux, ont rejoint le SOCLE.
    expect(LIT_NODE_TYPES.has('fiber_plant')).toBe(true)
    expect(estUnSocle('rubble')).toBe(true)
    expect(LIT_NODE_TYPES.has('berry_bush')).toBe(false)
    expect(LIT_NODE_TYPES.has('sapling')).toBe(false)
  })
})
