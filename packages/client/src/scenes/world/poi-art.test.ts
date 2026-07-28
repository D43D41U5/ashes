/**
 * TOUT LIEU DU JEU DOIT AVOIR UN CORPS — sinon il existe sans se voir.
 *
 * Le Grand Chêne a été ajouté à `POI_TYPES` (côté `/sim`) et à la table d'art, mais son
 * DESSIN manquait : `makePoiTextures` est une suite d'appels `tex('slug', …)` écrits à la
 * main, donc une entrée de table sans fonction de dessin ne produit aucune texture. Le lieu
 * était bel et bien placé dans la vallée, et rigoureusement invisible. Seul le smoke l'a vu.
 *
 * Ce test rattrape la classe entière de ce bug, dans les deux sens — un type sans art, et un
 * art sans type — en se confrontant à `POI_TYPES`, la liste que `/sim` déclare vraiment, et
 * jamais à une liste recopiée qui dériverait au premier ajout.
 */
import { describe, expect, it } from 'vitest'
import { POI_TYPES } from '@ashes/sim'
import { POI_ART, TREE_H } from './poi-art'

describe('l’art des lieux', () => {
  it('chaque lieu du jeu a son art — aucun n’existe sans corps', () => {
    // Le garde-fou doit d'abord VOIR : une liste vide passerait au vert sans rien vérifier.
    expect(POI_TYPES.length).toBeGreaterThan(20)

    const dessines = new Set(POI_ART.map((a) => a.slug))
    const sansCorps = POI_TYPES.map((t) => t.slug).filter((slug) => !dessines.has(slug))
    expect(sansCorps, 'ces lieux sont placés dans la vallée mais ne se dessinent pas').toEqual([])
  })

  it('l’art ne décrit AUCUN lieu fantôme', () => {
    const slugs = new Set(POI_TYPES.map((t) => t.slug))
    const fantomes = POI_ART.map((a) => a.slug).filter((slug) => !slugs.has(slug))
    expect(fantomes, 'ces dessins ne correspondent à aucun lieu du jeu').toEqual([])
  })

  it('un lieu à COURONNE la fait vraiment dépasser la canopée', () => {
    // Une couronne n'a de sens que si elle perce : `crown` est la bande capturée depuis le HAUT
    // du sprite, et elle doit tomber DANS la hauteur du sprite. Un `crown` ≥ `h` ne serait pas
    // une cime qui dépasse, ce serait le sprite entier redessiné par-dessus les arbres.
    for (const a of POI_ART) {
      if (a.crown === undefined) continue
      expect(a.crown, `${a.slug} : sa couronne ne tient pas dans sa hauteur`).toBeLessThan(a.h)
      expect(a.crown, `${a.slug} : couronne nulle ou négative`).toBeGreaterThan(0)
    }
  })

  it('le Grand Chêne est un REPÈRE : il dépasse franchement la cime des arbres', () => {
    // C'est toute sa raison d'être — la Racine était la seule zone sans skyline. Un « repère »
    // plus bas que la canopée n'en est pas un : il se noierait dans les bosquets.
    const chene = POI_ART.find((a) => a.slug === 'chene')
    expect(chene, 'le Grand Chêne n’a plus d’art — la Racine redevient sans horizon').toBeDefined()
    expect(chene!.h).toBeGreaterThan(TREE_H * 1.5)
    expect(chene!.crown, 'sans couronne, il ne perce pas la canopée').toBeGreaterThan(TREE_H / 2)
  })
})
