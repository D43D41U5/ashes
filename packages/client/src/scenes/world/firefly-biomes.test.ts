import { describe, expect, it } from 'vitest'
import { TERRAINS } from '@ashes/sim'
import { FIREFLY_TERRAINS } from './firefly-biomes'

/**
 * ═══ « SANS ARBRES, SANS NEIGE, SANS CENDRE » — la garde qui balaie TOUT le domaine ═══
 *
 * Alexis, 2026-08-26 : *« déplace les lucioles vers les biomes sans arbres, sans neige et sans
 * cendre »*. Une garde qui vérifierait les neuf ids qu'on a écrits ne garderait rien : elle
 * relirait la liste. Celle-ci parcourt **les 31 terrains de `TERRAINS`** et affirme la règle
 * sur chacun — le jour où un terrain neuf entre dans une famille exclue, il faut le SORTIR
 * explicitement du jeu des lucioles, ou ce fichier rougit.
 *
 * Les familles sont nommées ICI, par leur nom de terrain et non par leur id : c'est la seule
 * écriture qui survive à une renumérotation, et la seule qui se relise comme la phrase
 * d'Alexis.
 */

/** Ce sur quoi des arbres poussent — la saulaie comprise (des saules restent des arbres), et
 *  la futaie morte, qui est ce que la cendre laisse debout. */
const AVEC_ARBRES = new Set(['forest', 'pine', 'larch', 'old_growth', 'willow', 'burnt_forest'])
/** La neige, et le haut pays qu'elle cerne : un pré alpin est un pré, mais c'est le pré du Névé. */
const NEIGE = new Set(['snow', 'glacier', 'alpine_meadow', 'alpine_flowers'])
/** Les trois cendres, plus le chaos de blocs que la Cendrière recycle au cœur. */
const CENDRE = new Set(['cendre_pre', 'cendre_bois', 'cendre_min', 'boulders'])

const nom = (t: number) => TERRAINS[t]?.name ?? `#${t}`
const IDS = Object.keys(TERRAINS).map(Number)

describe('les biomes des lucioles', () => {
  it('le domaine balayé est bien le domaine entier, pas un échantillon', () => {
    // Sans quoi tout ce qui suit pourrait passer sur une table vide.
    expect(IDS.length).toBeGreaterThanOrEqual(30)
    expect(FIREFLY_TERRAINS.size).toBeGreaterThan(0)
  })

  it('aucun terrain qui porte des arbres', () => {
    for (const t of IDS) {
      if (!AVEC_ARBRES.has(nom(t))) continue
      expect(FIREFLY_TERRAINS.has(t), `${nom(t)} (#${t}) porte des arbres`).toBe(false)
    }
    // La prémisse : la famille existe vraiment dans la table, chaque nom compris.
    for (const n of AVEC_ARBRES) expect(IDS.map(nom), `${n} a disparu de TERRAINS`).toContain(n)
  })

  it('aucun terrain de neige ni de haut pays', () => {
    for (const t of IDS) {
      if (!NEIGE.has(nom(t))) continue
      expect(FIREFLY_TERRAINS.has(t), `${nom(t)} (#${t}) est de la neige`).toBe(false)
    }
    for (const n of NEIGE) expect(IDS.map(nom), `${n} a disparu de TERRAINS`).toContain(n)
  })

  it('aucun terrain de cendre', () => {
    for (const t of IDS) {
      if (!CENDRE.has(nom(t))) continue
      expect(FIREFLY_TERRAINS.has(t), `${nom(t)} (#${t}) est de la cendre`).toBe(false)
    }
    for (const n of CENDRE) expect(IDS.map(nom), `${n} a disparu de TERRAINS`).toContain(n)
  })

  it('rien qui ne se marche pas — ni roche, ni falaise, ni eau profonde, ni mur', () => {
    // Une nuée d'insectes au-dessus d'une paroi ou au milieu du lac se lit comme un bug.
    for (const t of FIREFLY_TERRAINS) {
      expect(TERRAINS[t], `#${t} n'est pas un terrain connu`).toBeDefined()
      expect(TERRAINS[t]?.walkable, `${nom(t)} (#${t}) ne se marche pas`).toBe(true)
    }
  })

  it('les biomes du DÉCOUVERT sont bien là, et les prés d\'abord', () => {
    // L'autre moitié de la règle : une garde qui n'exige que des exclusions serait verte
    // sur un jeu VIDE, et les lucioles auraient disparu du jeu sans que rien ne rougisse.
    for (const n of ['grass', 'flower_meadow', 'wet_meadow', 'juniper_heath', 'marsh', 'reed_marsh']) {
      const t = IDS.find((i) => nom(i) === n)
      expect(t, `${n} a disparu de TERRAINS`).toBeDefined()
      expect(FIREFLY_TERRAINS.has(t!), `${n} devrait accueillir des lucioles`).toBe(true)
    }
  })
})
