/**
 * LA GARDE A1 ÉTENDUE (spec da-feeling) — « toute texture de sprite monde consommée a sa
 * `_lit` », en DONNÉES PURES, pour les familles que lit-props.test ne couvre pas : les
 * LIEUX (poi-*), les STRUCTURES (st-*) et les HUMAINS (spr-*). La revue du 26/07 a montré
 * le trou : la planche smoke jugeait le rendu, mais aucune garde texte ne tenait le compte.
 */
import { describe, expect, it } from 'vitest'
import { POI, POI_BODY_TYPES } from '@ashes/sim'
import { POI_ART } from '../scenes/world/poi-art'
import { ERRATIQUES, POI_LIT_DEFS, POI_LIT_KINDS, POI_LIT_MIRRORED } from './poi-lit'
import { LIT_STRUCTURE_KEYS, LIT_STRUCTURE_TYPES } from './lit-structures'
import { BATI_KEYS, BATI_LIT_TYPES } from './bati-art'
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

  /**
   * LA COUVERTURE SE COMPTE SUR LES DEUX MODULES, depuis que le mobilier du monde bâti vit
   * dans `bati-art` (avec sa vraie silhouette et son relief gravé). Ne compter que
   * `lit-structures` a fait rougir cette garde quand le COFFRE a déménagé — il n'avait rien
   * perdu, il avait changé d'adresse. Une garde qui suit un module plutôt qu'une PROPRIÉTÉ
   * crie sur les rangements.
   */
  it('les structures basculées ont leurs clés, et le whitelist n’est jamais recopié', () => {
    const tous = new Set([...LIT_STRUCTURE_TYPES, ...BATI_LIT_TYPES])
    expect(tous.size, 'la garde doit d’abord VOIR').toBeGreaterThanOrEqual(20)
    for (const type of LIT_STRUCTURE_TYPES) {
      expect(LIT_STRUCTURE_KEYS.has(`st-${type}_lit`), type).toBe(true)
    }
    for (const type of BATI_LIT_TYPES) {
      expect(BATI_KEYS.includes(`st-${type}_lit`), type).toBe(true)
    }
    // Le COFFRE a sa `_lit` — peu importe lequel des deux modules la produit.
    expect(tous.has('chest'), 'le coffre a perdu sa bascule').toBe(true)
    // Les exceptions consignées ne se glissent dans AUCUN des deux whitelists par accident.
    for (const exclu of ['wall', 'door', 'fire', 'floor', 'roof', 'parcelle', 'terroir', 'roc']) {
      expect(tous.has(exclu), `${exclu} est consigné hors bascule`).toBe(false)
    }
    // LES CORPS DE LIEUX (étage 3) non plus — leur `_lit` est `poi-*`, jamais `st-*` : les
    // y inscrire ferait demander une texture `st-<type>_lit` qui n'existe pas.
    for (const type of POI_BODY_TYPES) {
      expect(tous.has(type), `${type} : un corps de lieu ne bascule jamais via st-*`).toBe(false)
    }
  })

  /**
   * LES CORPS DE LIEUX ONT LEUR ART, ET LEUR NUIT (étage 3) : chaque pièce `art: 'poi'` du
   * registre a son sprite dans POI_ART (la clé de naissance `poi-<slug>` existe), sa `_lit`
   * (poi-lit — ou les trois variantes pour l'erratique), et si l'ART déclare une couronne,
   * la def _lit la déclare AUSSI — sinon la couronne de nuit serait le damier magenta.
   */
  it('chaque corps de lieu a son sprite, sa _lit, et sa couronne alignée', () => {
    const art = new Map(POI_ART.map((a) => [a.slug, a]))
    for (const type of POI_BODY_TYPES) {
      const a = art.get(type)
      expect(a, `${type} : une pièce-corps sans sprite POI ne peut pas naître`).toBeDefined()
      expect(POI_LIT_KINDS.has(type) || type === 'erratique', `${type} : pas de _lit`).toBe(true)
      if (a!.crown !== undefined) {
        const def = POI_LIT_DEFS.find((d) => d.slug === type)
        expect(def?.crown, `${type} : couronne d'ART sans couronne _lit`).toBeDefined()
      }
    }
  })

  it('les humains ont leur _lit ; le miroir des pierres est déclaré', () => {
    expect(LIT_PROP_KEYS.has('spr-player_lit')).toBe(true)
    expect(LIT_PROP_KEYS.has('spr-npc_lit')).toBe(true)
    expect(POI_LIT_MIRRORED.has('pierre_levee')).toBe(true) // les 9 pierres du Cercle (R5)
  })
})
