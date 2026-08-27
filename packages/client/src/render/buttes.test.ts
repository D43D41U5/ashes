/**
 * LE CONTEXTE DES BUTTES (t0-exploration §2sexies) — pur, donc gardé en headless : les rôles
 * (cœur / sommet / frange), la pente continue vers le sommet, et le sol moucheté déterministe.
 * Le piège épinglé : un sommet posé au CENTRE GÉOMÉTRIQUE d'un rect en L tombe hors rocaille —
 * le chicot flotterait sur l'herbe. Le sommet est la tuile de PIERRIER la plus proche du centre.
 *
 * ⚠ **LE RECT N'EST PLUS LA LOI** (2026-08-27) : il n'est que la boîte englobante, et la butte
 * n'en occupe que 42 à 56 % (MESURÉ, monde joué). Le cœur est donc le PIERRIER connexe qui
 * contient le sommet — d'où la carte de test en L, dont le coin herbeux servait justement à
 * documenter l'ancien contrat (« même le coin herbeux du L : le rect fait foi ») et sert
 * maintenant à documenter le neuf.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS, TERRAIN_SCREE, type WorldMap } from '@ashes/sim'
import { contexteDesButtes, densiteDeMoucheture, fondDeButte, FRANGE_TUILES, MOUCH_PART, tacheDeButte } from './buttes'

/** Une carte minuscule : herbe partout, une butte 8×8 en (8,8) dont le quart NO est resté herbeux
 *  (le rect en L du vrai générateur), déclarée ferreuse. */
function carte(ressource: 'fer' | 'charbon'): WorldMap {
  const width = 32
  const height = 32
  const terrain = new Array<number>(width * height).fill(TERRAIN_GRASS)
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 16; x++) {
      if (x < 12 && y < 12) continue // le coin manquant du L
      terrain[y * width + x] = TERRAIN_SCREE
    }
  }
  return { width, height, terrain, zones: [], affleurements: [{ x: 8, y: 8, w: 8, h: 8, ressource }] } as unknown as WorldMap
}

describe('le contexte des buttes', () => {
  it('le cœur est le PIERRIER, pas le rect — le coin herbeux du L garde son décor', () => {
    const ctx = contexteDesButtes(carte('charbon'))
    // ⚠ LE CŒUR DU CHANTIER : cette tuile est DANS le rect et n'est pas la butte. Elle valait
    // 'coeur' (donc semis vide, donc un carré chauve dans le pré) ; elle ne vaut plus rien.
    expect(ctx.get(9 * 32 + 9)).toBeUndefined()
    expect(ctx.get(13 * 32 + 13)?.role).toBe('coeur') // la rocaille, elle, est bien le cœur
    // Le creux du L touche la rocaille : il est en frange, à deux tuiles près.
    expect(ctx.get(11 * 32 + 11)?.role).toBe('frange')
    expect(contexteDesButtes({ width: 4, height: 4, terrain: [0, 0, 0, 0], zones: [] } as unknown as WorldMap).size).toBe(0)
  })

  it('la frange est une couronne autour du CŒUR, de FRANGE_TUILES, et rien au-delà', () => {
    const ctx = contexteDesButtes(carte('charbon'))
    for (let d = 1; d <= FRANGE_TUILES; d++) expect(ctx.get((8 - d) * 32 + 13)?.role, `à ${d}`).toBe('frange')
    expect(ctx.get((8 - FRANGE_TUILES - 1) * 32 + 13)).toBeUndefined()
    // Et elle suit la FORME : au nord du coin herbeux, il n'y a pas de rocaille à border.
    expect(ctx.get((8 - 1) * 32 + 9)).toBeUndefined()
  })

  it('la pente monte vers le fond de la butte, CONTINUE — 0 au bord, 1 au plus profond', () => {
    const ctx = contexteDesButtes(carte('charbon'))
    const au = (x: number, y: number): number => ctx.get(y * 32 + x)!.grad
    expect(au(15, 15)).toBe(0) // le coin sud-est : le bord
    expect(au(14, 14)).toBeCloseTo(0.5, 5)
    expect(au(13, 13)).toBe(1) // deux tuiles de roche tout autour : le fond
    const grads = [...ctx.values()].filter((c) => c.role === 'coeur').map((c) => c.grad)
    expect(Math.min(...grads)).toBe(0)
    expect(Math.max(...grads)).toBe(1)
  })

  it('le sommet ferreux est SUR la rocaille, au plus près du centre — jamais sur l\'herbe du L', () => {
    const ctx = contexteDesButtes(carte('fer'))
    const sommets = [...ctx.entries()].filter(([, c]) => c.role === 'sommet')
    expect(sommets).toHaveLength(1)
    const [i] = sommets[0]!
    const tx = i % 32
    const ty = (i - tx) / 32
    expect(carte('fer').terrain[i]).toBe(TERRAIN_SCREE)
    // Le centre (11.5, 11.5) est dans le coin herbeux : le sommet s'est décalé sur le pierrier voisin.
    expect(Math.abs(tx - 11.5) + Math.abs(ty - 11.5)).toBeLessThanOrEqual(2)
    // Le charbon reste bas — pas de chicot, c'est SA silhouette.
    expect([...contexteDesButtes(carte('charbon')).values()].some((c) => c.role === 'sommet')).toBe(false)
  })

  it('deux tons par butte, et la DENSITÉ de rouille monte avec la pente', () => {
    for (const r of ['fer', 'charbon'] as const) expect(fondDeButte(r)).not.toBe(tacheDeButte(r))
    // Le fond du fer est le plus clair des deux : la rouille TACHE une roche grise (et non
    // l'inverse) — c'est ce qui fait lire un chapeau de fer plutôt qu'un sol rouge.
    expect(fondDeButte('fer') & 0xff).toBeGreaterThan(tacheDeButte('fer') & 0xff)
    // ⚠ LA PENTE COMMANDE : au pourtour la butte est presque nue, au fond elle est croûtée.
    expect(densiteDeMoucheture(0)).toBeCloseTo(MOUCH_PART * 0.35, 6)
    expect(densiteDeMoucheture(1)).toBeGreaterThan(densiteDeMoucheture(0.5))
    expect(densiteDeMoucheture(0.5)).toBeGreaterThan(densiteDeMoucheture(0))
    expect(densiteDeMoucheture(1)).toBeLessThanOrEqual(1)
  })
})
