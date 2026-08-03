import { describe, expect, it } from 'vitest'
import { BALANCE } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'
import { corpsSousCurseur, directionDeVisee, silhouetteDepuisSprite, surSilhouette } from './visee-corps'

/** L'emprise d'art d'un zombie (`ACTOR_FOOTPRINTS`, snapshot-view) — la plus HAUTE du
 *  jeu, donc celle qui dévoyait le plus la visée. */
const ZOMBIE = { w: 0.75, h: 1.5 }

/** Le sprite d'un corps à (x, y), tel que `syncActor` le pose : origine PIEDS, pieds à
 *  `y + AVATAR_HITBOX_DEPTH_TILES/2`, hauteur d'affichage = emprise × TILE_PX. */
function silhouetteDe(id: number, x: number, y: number, art = ZOMBIE) {
  const piedsPx = (y + BALANCE.AVATAR_HITBOX_DEPTH_TILES / 2) * TILE_PX
  return silhouetteDepuisSprite(id, x, y, x * TILE_PX, piedsPx, art.w * TILE_PX, art.h * TILE_PX, TILE_PX)
}

/** Le point de SOL que le curseur désigne quand il est posé sur le TORSE (mi-hauteur du
 *  billboard) — c'est-à-dire ce que `pointerToWorld` rendait, et qui partait à la sim. */
function solSousLeTorse(c: ReturnType<typeof silhouetteDe>): { wx: number; wy: number } {
  return { wx: (c.gauche + c.droite) / 2, wy: (c.haut + c.bas) / 2 }
}

const angleEntre = (ax: number, ay: number, bx: number, by: number): number => {
  const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

describe('viser un corps et non le sol derrière lui', () => {
  const joueur = { x: 20, y: 20 }
  /** Tout le tour, à toutes les distances utiles : une garde de géométrie se balaie,
   *  elle ne se choisit pas (leçon consignée — « garde exhaustive plutôt que cas »). */
  const positions: { x: number; y: number }[] = []
  for (let a = 0; a < 72; a++) {
    for (const d of [0.8, 1.1, 1.5, 2.0, 2.3, 2.9]) {
      const rad = (a / 72) * Math.PI * 2
      positions.push({ x: joueur.x + Math.cos(rad) * d, y: joueur.y + Math.sin(rad) * d })
    }
  }

  it('le curseur posé sur le torse vise le CORPS — exactement, tout autour du joueur', () => {
    let pireÉcart = 0
    for (const p of positions) {
      const c = silhouetteDe(1, p.x, p.y)
      const { wx, wy } = solSousLeTorse(c)
      const visé = corpsSousCurseur([c], wx, wy)
      expect(visé, `aucun corps trouvé sous le curseur en (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).not.toBeNull()
      const { dx, dy } = directionDeVisee(joueur, wx, wy, visé)
      pireÉcart = Math.max(pireÉcart, angleEntre(dx, dy, p.x - joueur.x, p.y - joueur.y))
    }
    // « Exactement » : la direction pointe le centre logique, pas un point voisin. Le
    // seuil n'est pas zéro parce que la silhouette fait l'aller-retour par les PIXELS
    // (c'est là que le curseur vit) — il reste un dix-millième de degré, soit trois
    // ordres de grandeur sous le plus fin des arcs du jeu.
    expect(pireÉcart).toBeLessThan(1e-4)
  })

  it('…et sans lui, le sol sous le torse dévoyait le coup au-delà de l’arc d’une lance', () => {
    // LA GARDE PROUVE SA PRÉMISSE : si l'ancien comportement n'avait pas dévoyé, le test
    // ci-dessus ne garderait rien. On rejoue donc la visée d'AVANT (le point de sol) et
    // l'on montre qu'elle sortait de l'arc — le demi-arc de la lance est de 22°.
    let pireÉcart = 0
    for (const p of positions) {
      const { wx, wy } = solSousLeTorse(silhouetteDe(1, p.x, p.y))
      const { dx, dy } = directionDeVisee(joueur, wx, wy, null)
      pireÉcart = Math.max(pireÉcart, angleEntre(dx, dy, p.x - joueur.x, p.y - joueur.y))
    }
    expect(pireÉcart).toBeGreaterThan(22)
  })

  it('hors de toute silhouette, on vise le SOL — la règle ne s’étend pas', () => {
    const c = silhouetteDe(1, 24, 20)
    const { dx, dy } = directionDeVisee(joueur, 21, 23, corpsSousCurseur([c], 21, 23))
    expect({ dx, dy }).toEqual({ dx: 1, dy: 3 })
  })

  it('deux corps qui se chevauchent : le plus proche du curseur, et toujours le même', () => {
    const proche = silhouetteDe(7, 22, 20)
    const loin = silhouetteDe(3, 22.3, 20)
    const surLeProche = solSousLeTorse(proche)
    expect(surSilhouette(loin, surLeProche.wx, surLeProche.wy)).toBe(true) // ils se recouvrent bien
    // Stable d'un appel à l'autre : une visée qui vacille entre deux corps à chaque frame
    // ferait osciller la direction envoyée pendant tout un maintien de charge.
    expect(corpsSousCurseur([proche, loin], surLeProche.wx, surLeProche.wy)?.id).toBe(7)
    expect(corpsSousCurseur([loin, proche], surLeProche.wx, surLeProche.wy)?.id).toBe(7)
  })

  it('la marge élargit la silhouette (l’hystérésis du verrou de charge)', () => {
    const c = silhouetteDe(1, 22, 20)
    const justeÀCôté = { wx: c.droite + 0.2, wy: (c.haut + c.bas) / 2 }
    expect(corpsSousCurseur([c], justeÀCôté.wx, justeÀCôté.wy)).toBeNull()
    expect(corpsSousCurseur([c], justeÀCôté.wx, justeÀCôté.wy, 0.35)?.id).toBe(1)
  })
})
