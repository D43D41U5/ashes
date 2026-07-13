/**
 * L'ARME DANS LA MAIN — pour qu'on sache CE QUI VA ARRIVER, avant que ça arrive.
 *
 * Le télégraphe dit ce qui arrive MAINTENANT (la zone au sol, `attack-fx.ts`). Il
 * arrive une demi-seconde trop tard pour décider quoi que ce soit d'important : à cet
 * instant, on ne choisit plus, on esquive. La vraie décision — s'approcher ou tenir
 * la distance, engager ou fuir — se prend AVANT, et elle se prend sur une seule
 * information : QU'EST-CE QUE L'AUTRE TIENT ?
 *
 *   · rien        → il touche à un bras. On peut le tourner.
 *   · une lance   → il touche à deux mètres. Rester devant lui, c'est mourir.
 *   · une hache   → il balaie large. Ne pas amener d'ami à côté de soi.
 *
 * Rien à ajouter au protocole pour ça : le snapshot transporte l'`Entity` COMPLÈTE,
 * donc son sac et sa case active. `weaponKind()` (de /sim) lit la main de n'importe
 * qui — la règle est celle de la sim, le client ne la réinvente pas.
 *
 * On dessine à la ceinture (le sprite est ancré aux PIEDS), orienté sur le `facing`
 * de la sim, écrasé en Y comme tout ce qui se pose dans ce monde vu de dessus.
 */
import Phaser from 'phaser'
import type { WeaponKind } from '@braises/sim'

/** Un corps, ce qu'il tient, et où il regarde. */
export interface HandView {
  /** Position du sprite, en px monde (ancre PIEDS). */
  x: number
  y: number
  /** Direction du regard (normalisée par la sim). */
  fx: number
  fy: number
  kind: WeaponKind
}

/** Hauteur de la main au-dessus des pieds, en px. */
const HAND_Y = -11
/** Le monde est vu de dessus : ce qui pointe vers le sud se raccourcit. */
const SQUASH = 0.55

const WOOD = 0x8f6f45
const STONE = 0xa8adb3
const IRON = 0xd9e0e8

/** Longueur du manche et taille du fer, en px — l'échelle du GESTE, pas de la portée
 *  (la portée, elle, se lit dans la zone au sol : elle est la seule à faire foi). */
const SHAFTS: Record<Exclude<WeaponKind, 'unarmed'>, { shaft: number; head: number; width: number; metal: number }> = {
  crude_spear: { shaft: 17, head: 4, width: 1.6, metal: STONE },
  spear: { shaft: 23, head: 5, width: 2, metal: IRON },
  iron_axe: { shaft: 12, head: 6, width: 2.4, metal: IRON },
}

export interface HandWeapons {
  /** Une fois par frame : efface, puis repeint toutes les mains armées. */
  render(hands: readonly HandView[]): void
}

export function createHandWeapons(scene: Phaser.Scene, depth: number): HandWeapons {
  const g = scene.add.graphics().setDepth(depth)

  return {
    render(hands) {
      g.clear()
      for (const h of hands) {
        if (h.kind === 'unarmed') continue
        const def = SHAFTS[h.kind]
        const len = Math.sqrt(h.fx * h.fx + h.fy * h.fy)
        if (len < 0.0001) continue
        const dx = h.fx / len
        const dy = (h.fy / len) * SQUASH
        // La main est décalée du corps : l'arme part du flanc, pas du nombril.
        const hx = h.x + dx * 3
        const hy = h.y + HAND_Y + dy * 3
        const tx = hx + dx * def.shaft
        const ty = hy + dy * def.shaft

        g.lineStyle(def.width, WOOD, 1)
        g.beginPath()
        g.moveTo(hx, hy)
        g.lineTo(tx, ty)
        g.strokePath()

        if (h.kind === 'iron_axe') {
          // LE FER, EN TRAVERS DU MANCHE : c'est ce qui rend la hache reconnaissable
          // d'un coup d'œil — et ce qui annonce le balayage large qu'elle va porter.
          const px = -dy
          const py = dx
          g.lineStyle(def.head, def.metal, 1)
          g.beginPath()
          g.moveTo(tx - px * def.head * 0.6, ty - py * def.head * 0.6)
          g.lineTo(tx + px * def.head * 0.6, ty + py * def.head * 0.6)
          g.strokePath()
          continue
        }
        // LA POINTE : un fer effilé dans l'axe — la lance dit son pic avant de le porter.
        g.lineStyle(def.width * 0.9, def.metal, 1)
        g.beginPath()
        g.moveTo(tx, ty)
        g.lineTo(tx + dx * def.head, ty + dy * def.head)
        g.strokePath()
      }
    },
  }
}
