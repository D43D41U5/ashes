/**
 * LA TABLE D'AMBIANCE DOIT ÊTRE EXHAUSTIVE — sinon une zone naît sans identité.
 *
 * Le Névé Blanc a vécu sans entrée : `ambianceDe` retombait silencieusement sur `NEUTRE`
 * (sol [1,1,1], air alpha 0), c'est-à-dire AUCUNE identité visuelle — sur la zone déjà la
 * plus pâle du jeu et la plus proche du Glacier. Personne ne l'a vu, parce qu'un repli
 * silencieux ne se signale jamais : il rend une valeur parfaitement valide.
 *
 * Le repli reste NÉCESSAIRE à l'exécution (une carte sans zones, un slug inconnu) ; ce qui
 * ne doit pas exister, c'est une zone du jeu qui l'emprunte. D'où ce test : la table se
 * confronte à la liste des zones que `/sim` déclare vraiment, jamais à une liste recopiée.
 */
import { describe, expect, it } from 'vitest'
import { ZONES } from '@braises/sim'
import { ambianceDe, ZONE_AMBIANCE } from './zone-ambiance'

describe('l’ambiance des zones', () => {
  it('chaque zone du jeu a SON entrée — aucune ne tombe sur le neutre', () => {
    // Le garde-fou doit d'abord VOIR : une liste vide passerait au vert sans rien vérifier.
    expect(ZONES.length).toBeGreaterThanOrEqual(12)

    const orphelines = ZONES.map((z) => z.slug).filter((slug) => ZONE_AMBIANCE[slug] === undefined)
    expect(orphelines, 'ces zones n’ont aucune identité visuelle et rendent en neutre').toEqual([])
  })

  it('la table ne décrit AUCUNE zone fantôme', () => {
    // L'inverse : une entrée sans zone est du réglage mort qu'on croira actif.
    const slugs = new Set(ZONES.map((z) => z.slug))
    const fantomes = Object.keys(ZONE_AMBIANCE).filter((slug) => !slugs.has(slug))
    expect(fantomes, 'ces entrées ne correspondent à aucune zone du jeu').toEqual([])
  })

  it('le repli neutre existe toujours pour un slug inconnu', () => {
    // On ne l'a pas supprimé : une carte sans zones doit rester rendable.
    const n = ambianceDe(undefined)
    expect(n.sol).toEqual([1, 1, 1])
    expect(n.air.alpha).toBe(0)
  })
})
