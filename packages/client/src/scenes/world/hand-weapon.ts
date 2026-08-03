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
 *   · un ARC      → il touche à onze tuiles, et il ne peut RIEN au contact. Deux
 *                   informations opposées dans une seule silhouette, et c'est
 *                   précisément la décision qu'on veut donner à lire : fermer, ou mourir
 *                   loin. La corde qui se tend dit en plus QUAND — un arc bandé à fond
 *                   est un tir qui part (spec `tir.md` T2).
 *
 * Rien à ajouter au protocole pour ça : le snapshot transporte l'`Entity` COMPLÈTE,
 * donc son sac et sa case active. `weaponKind()` (de /sim) lit la main de n'importe
 * qui — la règle est celle de la sim, le client ne la réinvente pas.
 *
 * On dessine à la ceinture (le sprite est ancré aux PIEDS), orienté sur le `facing`
 * de la sim, écrasé en Y comme tout ce qui se pose dans ce monde vu de dessus.
 */
import Phaser from 'phaser'
import type { WeaponKind } from '@ashes/sim'

/** Un corps, ce qu'il tient, et où il regarde. */
export interface HandView {
  /** Position du sprite, en px monde (ancre PIEDS). */
  x: number
  y: number
  /** Direction du regard (normalisée par la sim). */
  fx: number
  fy: number
  kind: WeaponKind
  /**
   * LA CORDE, DE 0 (molle) À 1 (bandée à fond) — arcs seulement. C'est `Entity.charge`
   * rapporté à `chargeTicks`, la même jauge que le télégraphe au sol : on ne fabrique
   * pas une seconde vérité pour l'animation.
   */
  draw?: number
}

/** Hauteur de la main au-dessus des pieds, en px. */
const HAND_Y = -11
/** Le monde est vu de dessus : ce qui pointe vers le sud se raccourcit. */
const SQUASH = 0.55

const WOOD = 0x8f6f45
const STONE = 0xa8adb3
const IRON = 0xd9e0e8
const STEEL = 0xeef3f7 // l'acier : plus clair, poli

const CORDE = 0xe6dcc0

/**
 * L'ART D'UNE ARME — deux formes, et le compilateur exige que toute arme choisisse.
 *
 * `Record<Exclude<WeaponKind,'unarmed'>, …>` est le garde-fou : une arme ajoutée à /sim
 * sans art ne compile plus, et une main vide serait un mensonge silencieux à l'écran.
 * L'union tagguée est venue avec l'arc — un arc n'a ni manche ni fer, et le décrire avec
 * les champs de la lance aurait demandé d'inventer un « manche de 0 » que le dessin
 * aurait dû réinterpréter. Ce qui a deux formes se déclare en deux formes.
 */
type ArtArme =
  /** Manche + fer : l'échelle du GESTE, pas de la portée (la portée se lit au sol). */
  | { forme: 'manche'; shaft: number; head: number; width: number; metal: number }
  /** L'arc : `limb` = demi-hauteur du bois, `bulge` = ce dont il se cambre vers l'avant,
   *  `pull` = ce dont la corde recule à pleine bande. */
  | { forme: 'arc'; limb: number; bulge: number; width: number; pull: number }

const ART: Record<Exclude<WeaponKind, 'unarmed'>, ArtArme> = {
  crude_spear: { forme: 'manche', shaft: 17, head: 4, width: 1.6, metal: STONE },
  spear: { forme: 'manche', shaft: 23, head: 5, width: 2, metal: IRON },
  iron_axe: { forme: 'manche', shaft: 12, head: 6, width: 2.4, metal: IRON },
  steel_axe: { forme: 'manche', shaft: 12, head: 7, width: 2.6, metal: STEEL },
  // L'arc de fortune est PETIT et sa corde recule peu : un arc court, vite au bout de
  // sa bande. L'arc long est haut, se cambre plus, et tire la corde bien plus loin —
  // à l'œil, on doit voir lequel des deux va faire mal AVANT que le trait parte.
  crude_bow: { forme: 'arc', limb: 7, bulge: 3, width: 1.6, pull: 4 },
  bow: { forme: 'arc', limb: 11, bulge: 4, width: 2, pull: 7 },
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
        const def = ART[h.kind]
        const len = Math.sqrt(h.fx * h.fx + h.fy * h.fy)
        if (len < 0.0001) continue
        const dx = h.fx / len
        const dy = (h.fy / len) * SQUASH
        // La main est décalée du corps : l'arme part du flanc, pas du nombril.
        const hx = h.x + dx * 3
        const hy = h.y + HAND_Y + dy * 3

        if (def.forme === 'arc') {
          // ═══ L'ARC, ET SA CORDE QUI SE TEND ═══
          //
          // Le bois est TRAVERS à la visée (c'est ce qui le distingue d'un bâton en
          // ombre chinoise), cambré vers l'avant ; la corde ferme la courbe et RECULE
          // vers l'archer à mesure que la bande mûrit. La tension est donc lisible sur
          // la seule chose qui bouge — exactement comme la jauge au sol, et sans elle
          // un adversaire ne saurait jamais quand le trait part.
          const px = -dy
          const py = dx
          const ax = hx + dx * 2
          const ay = hy + dy * 2
          const hautX = ax + px * def.limb
          const hautY = ay + py * def.limb
          const basX = ax - px * def.limb
          const basY = ay - py * def.limb
          // Le galbe : deux segments par branche, cambrés vers l'avant. Pas de courbe —
          // à cette échelle, quatre segments SONT la courbe.
          const midX = ax + dx * def.bulge
          const midY = ay + dy * def.bulge
          g.lineStyle(def.width, WOOD, 1)
          g.beginPath()
          g.moveTo(hautX, hautY)
          g.lineTo(midX + px * def.limb * 0.45, midY + py * def.limb * 0.45)
          g.lineTo(midX - px * def.limb * 0.45, midY - py * def.limb * 0.45)
          g.lineTo(basX, basY)
          g.strokePath()

          // LA CORDE. Molle : une droite entre les pointes. Bandée : un chevron dont
          // l'encoche recule — et la flèche encochée avec elle.
          const bande = Math.max(0, Math.min(1, h.draw ?? 0))
          const nockX = ax - dx * def.pull * bande
          const nockY = ay - dy * def.pull * bande
          g.lineStyle(1, CORDE, 1)
          g.beginPath()
          g.moveTo(hautX, hautY)
          g.lineTo(nockX, nockY)
          g.lineTo(basX, basY)
          g.strokePath()

          if (bande > 0) {
            // LE TRAIT ENCOCHÉ : il DÉPASSE franchement du bois, dans l'axe. Il ne
            // s'allonge pas — c'est l'encoche qui recule, donc la flèche paraît se charger
            // d'elle-même. La longueur est réglée SUR CAPTURE (`smoke --scenario tir`, la
            // prise rapprochée) : à trois pixels de dépassement, la pointe se confondait
            // avec la branche et l'on ne voyait plus qu'un arc vide.
            const trait = def.pull + def.bulge + 7
            g.lineStyle(1.4, STONE, 1)
            g.beginPath()
            g.moveTo(nockX, nockY)
            g.lineTo(nockX + dx * trait, nockY + dy * trait)
            g.strokePath()
          }
          continue
        }

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
