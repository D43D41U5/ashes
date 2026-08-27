/**
 * LA GARDE A1 ÉTENDUE (spec da-feeling) — « toute texture de sprite monde consommée a sa
 * `_lit` », en DONNÉES PURES, pour les familles que lit-props.test ne couvre pas : les
 * LIEUX (poi-*), les STRUCTURES (st-*) et les HUMAINS (spr-*). La revue du 26/07 a montré
 * le trou : la planche smoke jugeait le rendu, mais aucune garde texte ne tenait le compte.
 */
import { describe, expect, it } from 'vitest'
import { POI, STRUCTURE_TYPES } from '@ashes/sim'
import { POI_ART } from '../scenes/world/poi-art'
import { ERRATIQUES, POI_LIT_DEFS, POI_LIT_DRESSES, POI_LIT_KINDS, poiLitCrownKey, poiLitKey } from './poi-lit'
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
    for (const exclu of Object.keys(SANS_BASCULE)) {
      expect(tous.has(exclu), `${exclu} est consigné hors bascule`).toBe(false)
    }
  })

  /**
   * ═══ LA COUVERTURE SE DÉRIVE DU REGISTRE — ELLE NE SE COMPTE PLUS ═══
   *
   * La garde d'à côté affirme `tous.size >= 20` : un COMPTE. Une entrée ajoutée au registre
   * `PIECES` compilait donc, passait le lint, passait cette garde — et partait en DAMIER
   * MAGENTA au rendu (`snapshot-view` pose `st-${'$'}{s.type}` sans repli, et aucun
   * `Record<StructureType, …>` côté client ne ferait rougir `tsc`). C'est verbatim le mode
   * d'échec que la décision du 2026-08-01 voulait fermer en créant le registre : le chantier
   * s'est arrêté à la frontière de /sim et n'a pas franchi le côté art.
   *
   * La complétude était donc vraie PAR CHANCE. Ici elle l'est par construction : le registre
   * est PARTITIONNÉ, chaque type est soit basculé, soit exempté AVEC SA RAISON. Ajouter une
   * pièce force une décision explicite au lieu d'un oubli silencieux.
   *
   * Et la partition se garde DANS LES DEUX SENS : une exemption qui gagne sa `_lit` doit
   * quitter cette table, sinon elle finit par documenter un monde disparu.
   */
  const SANS_BASCULE: Record<string, string> = {
    wall: 'le mur se peint en PANS autotuilés, pas en sprite',
    door: 'idem, plus son animation propre (`porte-anim`)',
    palissade: 'chemin dédié dans snapshot-view (elle borde la tuile, elle ne l’occupe pas)',
    fire: 'chemin dédié dans snapshot-view — le feu a son FX, pas un sprite éclairé',
    floor: 'couche MOLLE : elle n’a pas de corps à éclairer',
    roof: 'idem',
    parcelle: 'le potager se rend par son stade de pousse (`cropStage`), pas par un sprite fixe',
    terroir: 'idem',
    friche: 'clé PLATE de BATI_KEYS, gardée par bati-art.test',
    terre: 'idem',
    roc: 'idem',
  }

  it('A1bis — le registre est PARTITIONNÉ : aucun type sans art, aucune exemption périmée', () => {
    const bascules = new Set<string>([...LIT_STRUCTURE_TYPES, ...BATI_LIT_TYPES])
    expect(STRUCTURE_TYPES.length, 'la garde doit d’abord VOIR le registre').toBeGreaterThanOrEqual(40)

    // ① Aucun orphelin : un type neuf sans `_lit` doit être exempté SCIEMMENT.
    const orphelins = STRUCTURE_TYPES.filter((t) => !bascules.has(t) && SANS_BASCULE[t] === undefined)
    expect(orphelins, 'ces pièces du registre n’ont ni bascule _lit ni exemption motivée').toEqual([])

    // ② Aucune exemption périmée : si la pièce a gagné sa `_lit`, la ligne doit partir.
    const perimees = Object.keys(SANS_BASCULE).filter((t) => bascules.has(t))
    expect(perimees, 'ces exemptions décrivent un monde disparu : la pièce a désormais sa _lit').toEqual([])

    // ③ Aucune exemption FANTÔME : une pièce retirée du registre ne se documente plus.
    const fantomes = Object.keys(SANS_BASCULE).filter((t) => !(STRUCTURE_TYPES as readonly string[]).includes(t))
    expect(fantomes, 'ces exemptions ne correspondent à aucune pièce du registre').toEqual([])
  })

  it('les humains ont leur _lit ; le miroir des pierres est déclaré', () => {
    expect(LIT_PROP_KEYS.has('spr-player_lit')).toBe(true)
    expect(LIT_PROP_KEYS.has('spr-npc_lit')).toBe(true)
    expect(POI_LIT_DRESSES.has('pierre_levee')).toBe(true) // les 9 pierres du Cercle (R5)
  })

  /**
   * ═══ LES LIEUX DRESSÉS SE RETOURNENT (2026-08-27) ═══
   *
   * La liste des PLATS est écrite à la main, et c'est le seul moyen que la garde ait de pouvoir
   * échouer : la relire dans `plat` reviendrait à comparer la table à elle-même. Ce qui est ici
   * est un jugement de géométrie — un tarn est une nappe d'eau, une crevasse une fente dans le
   * sol : ni l'un ni l'autre ne se tient debout.
   */
  it('vingt-neuf lieux sur trente-trois sont DRESSÉS, et les quatre autres sont nommés', () => {
    const PLATS = ['crevasses', 'fondriere', 'saline', 'tarn']
    for (const slug of PLATS) {
      expect(POI_LIT_DRESSES.has(slug), `${slug} est au ras du sol`).toBe(false)
      // Et sa clé « retournée » retombe sur la droite — jamais sur une texture absente.
      expect(poiLitKey(slug, true)).toBe(poiLitKey(slug, false))
    }
    for (const d of POI_LIT_DEFS) {
      if (PLATS.includes(d.slug)) continue
      expect(POI_LIT_DRESSES.has(d.slug), `${d.slug} se tient debout : il lui faut son retourné`).toBe(true)
      expect(poiLitKey(d.slug, true)).toBe(`poi-${d.slug}_lit_m`)
      if (d.crown !== undefined) expect(poiLitCrownKey(d.slug, true)).toBe(`poi-${d.slug}-crown_lit_m`)
    }
    expect(POI_LIT_DRESSES.size).toBe(POI_LIT_DEFS.length - PLATS.length)
  })
})
