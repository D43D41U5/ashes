import { describe, expect, it } from 'vitest'
import { createVeillee } from './veillee'

/**
 * PEUPLER LA VEILLÉE (V1-10, racine R-A) — le geste qui allume le pilier n°1.
 * Sans un second village, `isOutsider()` renvoie toujours faux et le moteur
 * d'alignement tourne à vide en solo. On vérifie ici, HEADLESS (pas de navigateur),
 * que la Veillée naît avec deux voisins PNJ — un Foyer et une Meute.
 */
describe('createVeillee — peupler la Veillée (V1-10)', () => {
  it('fonde DEUX voisins PNJ (un Foyer, une Meute), loin du joueur', () => {
    const { sim, spawn } = createVeillee()

    // Deux villages voisins (le joueur n'a PAS encore de foyer — il naît survivant).
    expect(sim.villages.length).toBe(2)

    // Un caractère ensemencé CHAUD (Foyer) et un FROID (Meute) : les villageois portent
    // la graine (warmth ±60), l'archétype ÉMERGE ensuite des actes.
    const villageWarmth = (villageId: number): number => {
      const w = sim.npcs
        .filter((n) => n.villageId === villageId)
        .map((n) => sim.entities.find((e) => e.id === n.entityId)?.warmth ?? 0)
      return w.reduce((a, b) => a + b, 0) / Math.max(1, w.length)
    }
    const warmths = sim.villages.map((v) => villageWarmth(v.id))
    expect(warmths.some((x) => x > 0)).toBe(true) // le Foyer
    expect(warmths.some((x) => x < 0)).toBe(true) // la Meute

    // CONFORME AU GDD (Ermitage tranquille) : les voisins naissent LOIN — pas de raid au
    // pas de la porte. Chaque Feu est à bonne distance du spawn du joueur.
    for (const v of sim.villages) {
      const dx = v.fireTx + 0.5 - spawn.x
      const dy = v.fireTy + 0.5 - spawn.y
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(40) // au moins ~40 tuiles
    }
  }, 30000) // `createVeillee` fait toute la worldgen alpine (~10 s) : timeout large
})
