import { describe, expect, it } from 'vitest'
import { RECIPES, TERRAIN_GRASS, type RecipeId } from './balance'
import { estDecouverte } from './decouverte'
import { drainEvents } from './events'
import { createEmptyMap } from './map'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { addStructure, grantItems } from './village'

/**
 * LA DÉCOUVERTE DES RECETTES (D2, décision d'Alexis 2026-08-01).
 *
 * *Une recette apparaît la première fois qu'on touche sa matière* — et, D2-bis (ma
 * proposition, non encore arbitrée), quand la station qui la sert est à portée.
 *
 * Ce que ces tests gardent, c'est la PROMESSE de jeu, pas l'implémentation : le catalogue
 * part vide, il s'ouvre par ce qu'on ramasse, il n'oublie rien, et la chaîne profonde
 * reste atteignable (sans quoi le four d'acier n'aurait jamais de raison d'être bâti).
 */

function monde(): SimState {
  return createSim(7, { map: createEmptyMap(64, 64, TERRAIN_GRASS) })
}

function tick(sim: SimState): void {
  step(sim, [])
}

const reveals = (sim: SimState): RecipeId[] =>
  drainEvents(sim).flatMap((e) => (e.type === 'recipe_revealed' ? [e.recipeId] : []))

const moi = (sim: SimState, id: number) => sim.entities.find((e) => e.id === id)!

describe('la découverte des recettes (D2)', () => {
  it('on ne connaît RIEN au départ — le catalogue s’ouvre par ce qu’on ramasse', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    tick(sim)
    expect(moi(sim, id).seen ?? []).toEqual([])
  })

  it('LA MATIÈRE révèle ce qui se fait AVEC — et rien d’autre', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    tick(sim)
    drainEvents(sim)
    grantItems(sim, id, { fiber: 3 })
    tick(sim)
    const vus = reveals(sim)
    // La fibre entre dans la corde… et la corde n'exige aucune station (couche 1).
    expect(vus).toContain('rope')
    // …mais elle n'ouvre pas ce qui ne la consomme pas.
    expect(vus).not.toContain('cooked_meat')
    expect(estDecouverte(moi(sim, id), 'rope')).toBe(true)
    expect(estDecouverte(moi(sim, id), 'cooked_meat')).toBe(false)
  })

  it('« un cran en aval » : tenir un LINGOT DE FER annonce l’acier, donc le four d’acier', () => {
    // C'est le trou que D2-bis referme. Sans lui, l'acier resterait invisible tant qu'on
    // n'en aurait pas déjà — et la raison de bâtir le four d'acier avec.
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    tick(sim)
    drainEvents(sim)
    grantItems(sim, id, { iron_ingot: 2 })
    tick(sim)
    expect(reveals(sim)).toContain('steel_ingot')
    expect(RECIPES.steel_ingot.requiert).toEqual({ fonction: 'forge', niveau: 3 })
  })

  it('LA STATION à portée révèle ce qu’elle sait faire (D2-bis)', () => {
    const sim = monde()
    spawnEntity(sim, 10.5, 10.5)
    tick(sim)
    drainEvents(sim)
    // Un établi posé à côté : l'Atelier N1 s'annonce, sac vide.
    addStructure(sim, 'workshop', 11, 10, 0, 0)
    tick(sim)
    const vus = reveals(sim)
    expect(vus).toContain('axe')
    expect(vus).toContain('spear')
    // Mais pas l'acier : c'est un Atelier N3, l'établi n'y répond pas.
    expect(vus).not.toContain('steel_axe')
  })

  it('un palier SUPÉRIEUR révèle les inférieurs — l’atelier lourd annonce aussi la hache', () => {
    const sim = monde()
    const id = spawnEntity(sim, 20.5, 20.5)
    tick(sim)
    drainEvents(sim)
    addStructure(sim, 'atelier_lourd', 21, 20, 0, 0)
    tick(sim)
    const vus = reveals(sim)
    expect(vus).toContain('steel_axe') // N3
    expect(vus).toContain('axe') // N1, servi par le rang au-dessus
    expect(estDecouverte(moi(sim, id), 'axe')).toBe(true)
  })

  it('CE QUI EST APPRIS NE SE REPREND PAS — et ne s’annonce qu’une fois', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 3 })
    tick(sim)
    expect(reveals(sim)).toContain('rope')
    // Le sac se vide : la recette RESTE connue, et aucun second événement n'est émis.
    moi(sim, id).inventory.fill(null)
    tick(sim)
    tick(sim)
    expect(reveals(sim)).not.toContain('rope')
    expect(estDecouverte(moi(sim, id), 'rope')).toBe(true)
  })

  it('un PNJ n’a pas de catalogue — on ne fait pas grossir le snapshot pour personne', () => {
    const sim = monde()
    const id = spawnEntity(sim, 10.5, 10.5)
    grantItems(sim, id, { fiber: 3 })
    tick(sim)
    // L'avatar, lui, a appris.
    expect(moi(sim, id).seen?.length).toBeGreaterThan(0)
    // Aucune entité de PNJ ne porte de `seen` (il n'y en a pas dans ce monde nu, mais la
    // garde vaut pour le jour où il y en aura — et elle échouerait si on retirait le
    // filtre `estAvatar`).
    for (const npc of sim.npcs) {
      expect(sim.entities.find((e) => e.id === npc.entityId)?.seen).toBeUndefined()
    }
  })

  it('DÉTERMINISME : même graine, mêmes gestes ⇒ même `seen`, dans le même ORDRE', () => {
    // L'ordre compte : `seen` voyage dans le snapshot et la sauvegarde, donc deux moteurs
    // qui l'ordonneraient différemment feraient diverger le rejeu au bit près.
    const jouer = (): RecipeId[] => {
      const sim = monde()
      const id = spawnEntity(sim, 10.5, 10.5)
      addStructure(sim, 'workshop', 11, 10, 0, 0)
      grantItems(sim, id, { fiber: 3, iron_ingot: 2, wood: 5 })
      tick(sim)
      tick(sim)
      return moi(sim, id).seen ?? []
    }
    const a = jouer()
    const b = jouer()
    expect(a).toEqual(b)
    expect(a.length, 'le test doit voir de vraies découvertes').toBeGreaterThan(3)
  })
})
