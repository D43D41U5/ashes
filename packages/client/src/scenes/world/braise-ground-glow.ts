/**
 * LA FLAQUE DE LA BRAISE — la lueur qu'un porteur de braise jette à ses pieds (B-R13c).
 *
 * MÊME RECETTE QUE LA FLAQUE DE LA TORCHE (`torche-ground-glow.ts`) et pour la même raison
 * décisive : **le sol n'est pas sur la pipeline Light2D** — un point light ne lui apporte que
 * ~+8 de rouge (mesuré). Le point light allume les fûts et les corps ; c'est cette flaque, et le
 * trou du voile, qui mettent la TERRE en lumière.
 *
 * ⚠ **UNE SEULE DIFFÉRENCE, ET C'EST LA RAISON D'ÊTRE DU FICHIER : SON RAYON BOUGE.**
 *
 * Les trois autres flaques du jeu (Feu, torche, lucioles) ont un rayon FIXE, et l'en-tête de
 * `fire-ground-glow` dit pourquoi : *« un disque qui respire fait grouiller ses carrés, parce
 * qu'il les RÉÉCHELONNE »*. Or le rayon de la braise est le second canal de la charge (B-A18 ②)
 * — il doit se voir fondre. Les deux exigences sont tenues ensemble par un seul choix :
 *
 *   **UNE TEXTURE CUITE PAR RAYON EN CELLULES ENTIÈRES, jamais un `setDisplaySize` continu.**
 *
 * `1 texel = LIGHT_PX px monde` reste vrai à tout rayon : la grille de pixels ne bouge JAMAIS,
 * elle ne change pas d'échelle, le disque mange simplement moins de ses cases. Ce qui changerait
 * d'échelle — et grouillerait — c'est d'étirer une texture unique ; ce qu'on fait ici, c'est
 * d'en échanger une contre une autre, au même grain. Le rayon ne peut prendre que `QUANTA`
 * valeurs (`partQuantifiee`), donc la bascule arrive au plus 8 fois sur une décharge entière,
 * et chaque texture est cuite UNE fois pour toute la partie (`setFilter` une seule fois, la
 * leçon de `phaser4-setfilter-televerse`).
 *
 * L'alpha, lui, suit la charge CONTINUE et le battement (`forceDeBraise`) : le halo faiblit sans
 * à-coup, et seule son emprise descend par marches.
 *
 * ⚠ ELLE NE QUANTIFIE PAS SA POSITION, comme la flaque de la torche et pour la raison mesurée
 * dans son en-tête : un texel de lumière fait `LIGHT_PX × zoom` px d'écran (relevé entier à
 * 1280×800), donc décaler le sprite d'un sous-texel décale toutes ses frontières de la MÊME
 * fraction — un glissement d'ensemble, pas un battement interne.
 *
 * AUCUNE logique de jeu — la loi, elle, est dans `/sim` (`bulleDeBraise`) et commande la parade.
 */
import Phaser from 'phaser'
import { FIRE_GROUND_DEPTH } from '../../render/framing'
import { LIGHT_PX, cellulesDeFlaque, forceDeBraise } from '../../render/braise-halo'
import { TORCHE_ALPHA_SCALE } from './torche-ground-glow'
import type { Braise } from '@ashes/sim'

/** Un porteur de braise à l'image. Le miroir de `PorteurDeTorche` : mêmes champs, même sens —
 *  la position est INTERPOLÉE (px monde dessinés), `strate` est celle du CORPS (E-R22) et
 *  `yLogique`/`niveau` sont ce que le champ de la GI lit (LG-R14). */
export interface PorteurDeBraise {
  id: number
  x: number
  y: number
  strate: number
  /** La braise portée (`Entity.braise`) : c'est elle, et non une fraction déjà calculée, qui
   *  voyage — le rayon se dérive de `rayonDeBraise(braise)` dans `/sim`, jamais ici. */
  braise: Braise
  yLogique: number
  niveau: number
}

/** Le cœur : une masse incandescente, plus rouge et plus saturée que l'ambre d'une flamme —
 *  c'est ce qui distingue à l'œil une braise portée d'une torche (palette de `fx-torche-ground`
 *  décalée vers le rouge, le bleu en moins). */
const CORE_COLOR: readonly [number, number, number] = [0xff, 0x9e, 0x4a]
/** Le bord : le même rouge, profond, sans bleu — il fond dans le noir sans délaver. */
const EDGE_COLOR: readonly [number, number, number] = [0xc8, 0x3c, 0x10]
/**
 * Gain d'alpha — **celui de la torche, importé**, et non un nombre à soi.
 *
 * ⚠ J'y avais mis 0,24 « sous les 0,28 de la torche, pour que la hiérarchie se lise ». C'est le même
 * faux raisonnement que le plafond du voile (voir `render/braise-halo.ts`) : au CONTACT les deux
 * sources sont égales dans la sim (`bulleDeBraise(b, 0)` = 1 à charge pleine, comme `1 − d/P` en
 * d = 0), et ce qui les sépare est leur PORTÉE — ici la flaque de la braise est trois fois plus
 * petite. Deux nombres à régler là où il n'y a qu'une loi, c'était s'offrir une divergence.
 */
const GLOW_ALPHA_SCALE = TORCHE_ALPHA_SCALE

/** La clé d'une flaque de `cells` cellules de rayon — une texture par rayon possible (voir
 *  l'en-tête), toutes au même grain. */
function cleDeTexture(cells: number): string {
  return `fx-braise-ground-${cells}`
}

/** Cuit la flaque de rayon `cells` si elle n'existe pas encore. Le profil est celui de la flaque
 *  de la torche (smoothstep plein au centre, 0 doux au bord, cœur qui tient par `t²`). */
function ensureTexture(scene: Phaser.Scene, cells: number): string {
  const key = cleDeTexture(cells)
  if (scene.textures.exists(key)) return key
  const side = cells * 2 + 1
  const tex = scene.textures.createCanvas(key, side, side)
  if (!tex) return key
  const ctx = tex.getContext()
  const img = ctx.createImageData(side, side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const dx = i - cells
      const dy = j - cells
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / cells) // 0 centre → 1 bord
      const s = 1 - t
      const a = s * s * (3 - 2 * s) // smoothstep : plein au centre, 0 doux au bord
      const ct = t * t // le cœur tient plus longtemps → une vraie tache chaude sous les pieds
      const k = (j * side + i) * 4
      img.data[k] = Math.round(CORE_COLOR[0] + (EDGE_COLOR[0] - CORE_COLOR[0]) * ct)
      img.data[k + 1] = Math.round(CORE_COLOR[1] + (EDGE_COLOR[1] - CORE_COLOR[1]) * ct)
      img.data[k + 2] = Math.round(CORE_COLOR[2] + (EDGE_COLOR[2] - CORE_COLOR[2]) * ct)
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
  return key
}

export class BraiseGroundGlow {
  private glows = new Map<number, Phaser.GameObjects.Image>()
  /** Le rayon en cellules de chaque flaque vivante — pour ne rebasculer la texture QUE quand il
   *  change (une bascule coûte un `setTexture` ; sans ce souvenir on le paierait chaque image). */
  private rayons = new Map<number, number>()

  constructor(private scene: Phaser.Scene) {}

  /** Réconcilie une flaque par porteur, la déplace sur ses pas, et fait fondre son emprise avec
   *  la charge (par marches) tandis que son alpha faiblit en continu. */
  update(porteurs: PorteurDeBraise[], day: number, now: number): void {
    const seen = new Set<number>()
    for (const p of porteurs) {
      const force = forceDeBraise(p.braise, day, now, p.id * 2.9)
      const cells = cellulesDeFlaque(p.braise)
      // ⚠ C'EST LA FORCE QUI PORTE LE JOUR, PAS LE RAYON (le patron de la flaque de la torche,
      // dont le rayon est fixe) : de jour `forceDeBraise` rend 0 et la flaque disparaît ici même.
      // Mettre la nuit dans le rayon faisait balayer le compte de cellules à chaque crépuscule.
      if (force <= 0 || cells <= 0) continue
      seen.add(p.id)
      const key = ensureTexture(this.scene, cells)
      let glow = this.glows.get(p.id)
      if (!glow) {
        glow = this.scene.add.image(p.x, p.y, key).setOrigin(0.5, 0.5).setBlendMode('ADD')
        this.glows.set(p.id, glow)
        this.rayons.set(p.id, -1) // force la pose de la taille juste ci-dessous
      }
      if (this.rayons.get(p.id) !== cells) {
        const side = cells * 2 + 1
        glow.setTexture(key).setDisplaySize(side * LIGHT_PX, side * LIGHT_PX) // 1 texel = 4 px monde
        this.rayons.set(p.id, cells)
      }
      // La strate suit le corps à chaque image : un porteur qui gravit une rampe change de monde
      // à mi-pente (`strateDuCorps`), et sa flaque avec lui.
      glow.setPosition(p.x, p.y).setDepth(p.strate + FIRE_GROUND_DEPTH)
      glow.setAlpha(Math.min(1, force * GLOW_ALPHA_SCALE))
    }
    for (const [id, glow] of this.glows) {
      if (seen.has(id)) continue
      glow.destroy()
      this.glows.delete(id)
      this.rayons.delete(id)
    }
  }

  destroy(): void {
    for (const glow of this.glows.values()) glow.destroy()
    this.glows.clear()
    this.rayons.clear()
  }
}
