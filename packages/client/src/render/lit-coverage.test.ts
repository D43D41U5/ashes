/**
 * LA GARDE A1 ÉTENDUE (spec da-feeling) — « toute texture de sprite monde consommée a sa
 * `_lit` », en DONNÉES PURES, pour les familles que lit-props.test ne couvre pas : les
 * LIEUX (poi-*), les STRUCTURES (st-*) et les HUMAINS (spr-*). La revue du 26/07 a montré
 * le trou : la planche smoke jugeait le rendu, mais aucune garde texte ne tenait le compte.
 */
import { describe, expect, it } from 'vitest'
import { POI } from '@braises/sim'
import { POI_ART } from '../scenes/world/poi-art'
import { ERRATIQUES, POI_LIT_DEFS, POI_LIT_KINDS, POI_LIT_MIRRORED } from './poi-lit'
import { LIT_STRUCTURE_KEYS, LIT_STRUCTURE_TYPES } from './lit-structures'
import { LIT_PROP_KEYS } from './lit-props'

describe('la couverture _lit (garde A1)', () => {
  it('chaque lieu de la table ART est basculé, set-piece, ou l’erratique aux trois variantes', () => {
    expect(POI_ART.length).toBeGreaterThan(25) // la garde doit d'abord VOIR
    const restes = POI_ART.map((a) => a.slug).filter(
      (slug) => !POI_LIT_KINDS.has(slug) && !POI.SET_PIECE_KINDS.includes(slug) && slug !== 'erratique',
    )
    expect(restes, 'ces lieux consommés n’ont ni _lit ni exemption').toEqual([])
    expect(ERRATIQUES).toHaveLength(3)
  })

  it('chaque forme de lieu tient dans son cadre (rects, accents, fissures)', () => {
    for (const d of POI_LIT_DEFS) {
      for (const b of [...d.blocks, ...(d.accents ?? []), ...(d.details ?? [])]) {
        const [x, y, w, h] = b.rect
        expect(x >= 0 && y >= 0 && x + w <= d.w && y + h <= d.h, `${d.slug} : rect [${b.rect}] hors cadre ${d.w}×${d.h}`).toBe(true)
      }
      for (const c of d.cracks ?? []) {
        for (const [x, y] of c.path) {
          expect(x >= 0 && y >= 0 && x <= d.w && y <= d.h, `${d.slug} : fissure (${x},${y}) hors cadre`).toBe(true)
        }
      }
      if (d.crown !== undefined) expect(d.crown, `${d.slug} : couronne hors hauteur`).toBeLessThan(d.h)
    }
  })

  it('les structures basculées ont leurs clés, et le whitelist n’est jamais recopié', () => {
    expect(LIT_STRUCTURE_TYPES.size).toBeGreaterThanOrEqual(12)
    for (const type of LIT_STRUCTURE_TYPES) {
      expect(LIT_STRUCTURE_KEYS.has(`st-${type}_lit`), type).toBe(true)
    }
    // Les exceptions consignées ne se glissent pas dans le whitelist par accident.
    for (const exclu of ['wall', 'door', 'fire', 'floor', 'roof', 'parcelle', 'terroir']) {
      expect(LIT_STRUCTURE_TYPES.has(exclu), `${exclu} est consigné hors bascule`).toBe(false)
    }
  })

  it('les humains ont leur _lit ; le miroir des pierres est déclaré', () => {
    expect(LIT_PROP_KEYS.has('spr-player_lit')).toBe(true)
    expect(LIT_PROP_KEYS.has('spr-npc_lit')).toBe(true)
    expect(POI_LIT_MIRRORED.has('pierre_levee')).toBe(true) // les 9 pierres du Cercle (R5)
  })
})
