import { describe, expect, it } from 'vitest'
import { COMBAT, WEAPON_PROFILES, inStrikeZone, type Strike } from '@ashes/sim'
import { contourZone, type Point } from './zone-frappe'

/**
 * CE QUI FERAIT ROUGIR, énoncé avant tout vert :
 *  · un point que la sim TOUCHE et que le contour laisse dehors (le dessin ment en
 *    étant plus strict que la règle — le défaut d'origine, mesuré à +16/+36 %) ;
 *  · un point que la sim ÉPARGNE et que le contour enferme (le dessin promet trop) ;
 *  · les deux branches dégénérées oubliées : le tourbillon (360°) et le corps qui
 *    ENGLOBE le frappeur — c'est au contact, cerné, que le mensonge coûterait le plus.
 */

/** Le contour est-il, en tant que polygone, en accord avec `inStrikeZone` partout ? */
function dansLePolygone(pts: readonly Point[], x: number, y: number): boolean {
  let dedans = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans
  }
  return dedans
}

/** Toutes les formes du jeu, simples et chargées — on ne choisit pas trois cas. */
const FORMES: { nom: string; strike: Strike }[] = Object.entries(WEAPON_PROFILES).flatMap(([arme, p]) => [
  { nom: `${arme} simple`, strike: p.light },
  { nom: `${arme} chargé`, strike: p.charged },
])

describe('le télégraphe dessine la zone RÉSOLUE (item 1)', () => {
  it.each(FORMES)('$nom — le contour et `inStrikeZone` disent la même chose partout', ({ strike }) => {
    const pts = contourZone(strike, COMBAT.HIT_BODY_RADIUS)
    // Balayage CARTÉSIEN sur tout ce que la zone peut atteindre, au quarantième de tuile.
    // Une grille polaire aurait sur-échantillonné l'apex et raté les flancs lointains —
    // or c'est là, aux flancs, que l'élargissement angulaire vit.
    const R = strike.range + strike.radius + COMBAT.HIT_BODY_RADIUS + 0.3
    const pas = 1 / 40
    let desaccords = 0
    let dedans = 0
    let premier = ''
    for (let x = -R; x <= R; x += pas) {
      for (let y = -R; y <= R; y += pas) {
        const sim = inStrikeZone(strike, 0, 0, 1, 0, x, y)
        const dessin = dansLePolygone(pts, x, y)
        if (sim) dedans++
        if (sim === dessin) continue
        // ⚠ ON PARDONNE LA BANDE DU BORD, et seulement elle : un polygone est une CORDE
        // là où la règle a un ARC, et la flèche d'une corde de N segments est un écart de
        // dessin, pas de géométrie. On borne cet écart au pas du balayage — au-delà, c'est
        // la forme qui est fausse.
        if (distanceAuContour(pts, x, y) <= 2 * pas) continue
        desaccords++
        if (premier === '') premier = `(${x.toFixed(3)}, ${y.toFixed(3)}) sim=${sim} dessin=${dessin}`
      }
    }
    expect(dedans, 'la garde prouve sa prémisse : la zone n’est pas vide').toBeGreaterThan(50)
    expect(desaccords, premier).toBe(0)
  })

  it('À CORPS NUL, on retrouve EXACTEMENT le contour nominal d’avant', () => {
    // La règle est éteignable : c'est ce qui prouve que l'élargissement est bien ce qu'on
    // a ajouté, et rien d'autre. Un cône nominal passe par l'apex ; le contour élargi, non.
    const strike = WEAPON_PROFILES.spear.light
    const nu = contourZone(strike, 0)
    expect(nu[0]).toEqual({ x: 0, y: 0 })
    const bout = nu[Math.floor(nu.length / 2)]!
    expect(Math.sqrt(bout.x * bout.x + bout.y * bout.y)).toBeCloseTo(strike.range, 6)
  })

  it('LE CORPS QUI ENGLOBE LE FRAPPEUR : aucun angle mort au contact', () => {
    // La branche `d2 <= corps*corps` de la sim — au contact, la cible est touchée quelle
    // que soit la direction. Un contour qui s'arrêterait aux deux flancs dessinerait un
    // angle mort de trois pixels dans le dos, très exactement là où un joueur cerné
    // cherche à savoir s'il touche.
    const strike = WEAPON_PROFILES.spear.light // le cône le plus ÉTROIT : le pire cas
    const pts = contourZone(strike, COMBAT.HIT_BODY_RADIUS)
    const r = COMBAT.HIT_BODY_RADIUS * 0.5 // bien à l'intérieur du corps
    for (let i = 0; i < 32; i++) {
      const a = (i * 2 * Math.PI) / 32
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      expect(inStrikeZone(strike, 0, 0, 1, 0, x, y), `angle ${i}`).toBe(true)
      expect(dansLePolygone(pts, x, y), `angle ${i} — DERRIÈRE le frappeur`).toBe(true)
    }
  })

  it('LE TOURBILLON fait tout le tour, et il est PLUS LARGE que le disque des poings', () => {
    // La promesse de R4ter : « ce qui sépare deux coups, c'est ce qu'on VOIT au sol ».
    const tourbillon = contourZone(WEAPON_PROFILES.iron_axe.charged, COMBAT.HIT_BODY_RADIUS)
    const rayonMax = (pts: Point[]): number =>
      Math.max(...pts.map((p) => Math.sqrt(p.x * p.x + p.y * p.y)))
    // Tout le tour : aucun point du contour n'est plus près du centre qu'un autre.
    const rayons = tourbillon.map((p) => Math.sqrt(p.x * p.x + p.y * p.y))
    expect(Math.min(...rayons)).toBeCloseTo(Math.max(...rayons), 6)
    expect(rayonMax(tourbillon)).toBeGreaterThan(rayonMax(contourZone(WEAPON_PROFILES.unarmed.charged, COMBAT.HIT_BODY_RADIUS)))
  })
})

/** La distance d'un point au contour, pour pardonner la corde d'un arc. */
function distanceAuContour(pts: readonly Point[], x: number, y: number): number {
  let best = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const l2 = vx * vx + vy * vy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2))
    const dx = x - (a.x + t * vx)
    const dy = y - (a.y + t * vy)
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy))
  }
  return best
}
