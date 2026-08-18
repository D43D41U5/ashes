import { describe, expect, it } from 'vitest'
import { SHADOW_PROPS, SHADOW_PROP_GAP, SHADOW_PROP_WIDTH } from './prop-shadows'
import { BIOME_CLUTTER, BUTTE_CLUTTER, type PropKind } from './clutter'

/**
 * Le câblage des OMBRES DE CONTACT du décor, en DONNÉES PURES (comme `lit-props.test.ts`). Le piège
 * qu'on épingle : un prop ajouté à `SHADOW_PROPS` sans entrée de gap retombe SILENCIEUSEMENT sur le
 * fallback 2 texels → une flaque mal placée (le bug « 2 px trop bas » déjà vu par Alexis). `tsc` ne
 * le voit pas (deux `Record<string, …>` disjoints) ; on l'attrape ici.
 */
describe('câblage des ombres de contact du décor', () => {
  it('tout prop ombré a un gap MESURÉ (jamais le fallback 2 silencieux)', () => {
    for (const kind of SHADOW_PROPS) expect(typeof SHADOW_PROP_GAP[kind]).toBe('number')
  })

  it("toute largeur d'art déclarée cible un prop réellement ombré (pas d'entrée morte)", () => {
    for (const kind of Object.keys(SHADOW_PROP_WIDTH)) expect(SHADOW_PROPS.has(kind as PropKind)).toBe(true)
  })

  it("tout prop ombré est réellement POSÉ dans un biome (sinon l'ombre ne rend jamais)", () => {
    const placed = new Set<PropKind>()
    for (const cfg of Object.values(BIOME_CLUTTER)) {
      for (const k of cfg.props) placed.add(k)
      if (cfg.groves) placed.add(cfg.groves.kind)
    }
    // Les buttes d'affleurement posent HORS de la table des biomes (par contexte, §2sexies) :
    // leurs tirages, plus le chicot que `clutterAt` plante au sommet, comptent comme posés.
    for (const cfg of Object.values(BUTTE_CLUTTER)) for (const k of cfg.props) placed.add(k)
    placed.add('chicot')
    for (const kind of SHADOW_PROPS) expect(placed.has(kind)).toBe(true)
  })

  it('couvre les DEBOUT retravaillés le 2026-07-24 qui flottaient (pin, mélèze, troncs, congère, fleur)', () => {
    for (const kind of ['big_trunk', 'pine', 'larch', 'burnt_trunk', 'snowdrift', 'flower'] as PropKind[])
      expect(SHADOW_PROPS.has(kind)).toBe(true)
  })

  // ATTENTION en lisant ce qui suit : « sans ombre » veut dire SANS SPRITE D'OMBRE DE CONTACT (la
  // flaque unique posée sous le prop). Les CAILLOUX, eux, ont bien une ombre depuis le 2026-07-25 —
  // mais BAKÉE DANS LEUR TEXTURE, une bande par bloc (`pebbleShadowRects`, render/lit-props.ts) : un
  // tas de 2-3 blocs ne se pose pas avec une flaque unique. Les remettre dans `SHADOW_PROPS` leur en
  // donnerait DEUX ; supprimer la bande bakée les ferait reflotter. Les deux mécanismes coexistent.
  it('laisse SANS SPRITE d\'ombre les brins wispy et les props plats (décision de DA)', () => {
    for (const kind of ['grass_tuft', 'reed', 'pebbles', 'lichen', 'sphagnum'] as PropKind[])
      expect(SHADOW_PROPS.has(kind)).toBe(false)
  })
})
