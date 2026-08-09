/**
 * LA FLAQUE DE CHALEUR AU SOL — la lumière du Feu qui tombe sur la terre autour de lui.
 *
 * Une seule chose, volontairement simple, isolée dans son fichier pour être réglable ou
 * supprimable d'un bloc : par Feu, une flaque radiale PIXELLISÉE posée à plat sur le sol.
 *
 * PIXEL, comme tout le jeu (demande d'Alexis, DA) : chaque pixel de lumière fait 4×4 px monde
 * — un multiple de la grille de 2 px sur laquelle tout l'art est dessiné (cf. `lit-props`, « le
 * style pixel du jeu »). La texture fait un texel par cellule de 4 px et se rend en NEAREST →
 * des carrés durs, calés sur cette grille. Aucun dégradé lissé qui baverait entre deux styles.
 *
 * ═══ ELLE A CESSÉ D'ÊTRE LA LUMIÈRE DU FEU (2026-08-03) ═══
 *
 * Elle l'a été, faute de mieux : le trou du voile était débranché en mode éclairé, et toute la
 * chaleur du sol reposait sur cette flaque. Un additif ne peut pourtant que DÉLAVER — ajouter
 * de la lumière monte les trois canaux, l'écart entre eux se referme, et le sol perd sa couleur
 * propre. Mesuré à 1,5 tuile d'un feu de camp à minuit : un sol vert (33,38,31) devenait
 * (65,62,54), un kaki plat. Et comme elle est peinte SOUS le voile — un multiplicateur BLEU
 * (mesuré : il remonte le rapport B/R de 1,27×) —, l'ambre y perdait encore son ambre.
 * C'est le « sol tout jaune » qu'Alexis a rapporté.
 *
 * La PORTÉE appartient désormais au trou dans le voile (`night-veil`), qui multiplie au lieu
 * d'ajouter et rend donc au sol sa propre teinte. Il reste ici un CŒUR : deux ou trois tuiles
 * d'incandescence sur les braises, là où un vrai foyer cuit la terre. D'où `POOL_RADIUS_TILES`
 * ramené de 5 à 3 et `GLOW_ALPHA_SCALE` de 1,2 à 0,75.
 *
 * Trois partis pris qui la distinguent des tentatives jetées :
 *   • ADD AMBRE, jamais blanc. L'additif blanc délavait le sol en disque de projecteur ;
 *     une couleur chaude ajoutée à un sol de nuit sombre donne une braise, pas un néon.
 *   • SOUS le voile de nuit (`FIRE_GROUND_DEPTH` = 4, le voile éclairé à 8) : elle est POSÉE
 *     sur la terre, elle n'est pas une lucarne. Ce n'est plus à elle de percer la nuit —
 *     le trou s'en charge, et c'est pourquoi son gain d'alpha a pu redescendre sous 1.
 *   • COSMÉTIQUE. Intensité ∝ nuit (via `fireGlow`) : de jour elle s'efface, on voit
 *     partout comme avant ; la nuit elle réchauffe les abords du foyer. Elle ne masque
 *     rien, ne conditionne aucune visibilité — pure ambiance.
 *
 * Le VACILLEMENT passe par l'ALPHA, jamais par la taille : le rayon (donc la grille de
 * pixels) reste fixe, sinon les carrés se redimensionneraient à chaque frame et grouilleraient.
 *
 * AUCUNE logique de jeu. `fireGlow` (module pur) porte le battement et l'extinction de jour.
 */
import Phaser from 'phaser'
import { fireStateAt, type SnapshotMessage, type Structure } from '@ashes/sim'
import { fireGlow } from '../../render/lighting'
import { FIRE_GROUND_DEPTH, TILE_PX } from '../../render/framing'

/** Le CŒUR de la flaque : chaud et LUMINEUX (près du foyer, demande d'Alexis « plus d'intensité
 *  chaude proche du feu »), mais AMBRE SATURÉ, pas crème. Le B reste bas (0x48) : en ADD, c'est le
 *  bleu qui tire un sol vers le blanc/beige délavé — un cœur pauvre en bleu s'empile en orange
 *  incandescent, pas en projecteur pâle (demande d'Alexis : la flaque lavait le sol en beige moyen). */
const CORE_COLOR: readonly [number, number, number] = [0xff, 0xa8, 0x48]
/** Le BORD de la flaque : ambre de braise saturé (R fort, B quasi nul → l'empilement vire orange,
 *  pas néon). Le dégradé cœur→bord donne la chaleur concentrée au centre. */
const EDGE_COLOR: readonly [number, number, number] = [0xff, 0x5a, 0x14]
/** LE PIXEL DE LUMIÈRE : 4×4 px monde (demande d'Alexis) — un grain franc, multiple de la
 *  grille de 2 px de l'art. */
const LIGHT_PX = 4
/** Rayon du CŒUR EN TUILES (fixe : c'est la grille de pixels). Les Feux engagés respirent en
 *  alpha/teinte, pas en taille (grille stable). Ramené de 5 à 3 le 2026-08-03 : au-delà de
 *  ~3 tuiles ce n'est plus une braise qui cuit la terre, c'est un délavage (voir l'en-tête). */
const POOL_RADIUS_TILES = 3
/** Rayon en CELLULES de 2 px, et côté de la texture (impair → un texel centré sur le foyer). */
const POOL_RADIUS_CELLS = (POOL_RADIUS_TILES * TILE_PX) / LIGHT_PX
const TEX_SIDE = POOL_RADIUS_CELLS * 2 + 1
/** Gain d'alpha du centre. Il valait 1,2 — RELEVÉ au-dessus de 1 pour que la flaque « perce » le
 *  voile qui la multiplie vers le bas. C'était le nœud du défaut : pousser l'alpha à saturation,
 *  c'est pousser le terme additif au maximum, donc le délavage au maximum. Depuis que le trou du
 *  voile porte la portée, la flaque n'a plus rien à percer — 0,75 la ramène à ce qu'elle doit
 *  être, une teinte de braise et non un projecteur. Plafonné à 1 au final. */
const GLOW_ALPHA_SCALE = 0.75

/** Texture PIXEL : un texel par cellule de 4 px. La COULEUR va du cœur cuit vers l'ambre (chaleur
 *  concentrée au centre), l'ALPHA suit un smoothstep. NEAREST → carrés durs calés sur l'art. On
 *  bake la couleur (pas de `setTint`) car un cœur plus clair que le bord exige un vrai dégradé. */
const TEX_KEY = 'fx-fire-ground'
function ensureTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_KEY)) return
  const tex = scene.textures.createCanvas(TEX_KEY, TEX_SIDE, TEX_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(TEX_SIDE, TEX_SIDE)
  for (let j = 0; j < TEX_SIDE; j++) {
    for (let i = 0; i < TEX_SIDE; i++) {
      const dx = i - POOL_RADIUS_CELLS
      const dy = j - POOL_RADIUS_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / POOL_RADIUS_CELLS) // 0 centre → 1 bord
      const s = 1 - t
      const a = s * s * (3 - 2 * s) // smoothstep sur (1-t) : plein au centre, 0 doux au bord
      // Couleur cœur→bord ; le cœur tient plus longtemps (t²) → une vraie tache chaude au centre.
      const ct = t * t
      const k = (j * TEX_SIDE + i) * 4
      img.data[k] = Math.round(CORE_COLOR[0] + (EDGE_COLOR[0] - CORE_COLOR[0]) * ct)
      img.data[k + 1] = Math.round(CORE_COLOR[1] + (EDGE_COLOR[1] - CORE_COLOR[1]) * ct)
      img.data[k + 2] = Math.round(CORE_COLOR[2] + (EDGE_COLOR[2] - CORE_COLOR[2]) * ct)
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  // NEAREST : chaque texel = un carré plein de 4 px (le LINEAR par défaut lisserait la grille).
  scene.textures.get(TEX_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

type Glow = Phaser.GameObjects.Image

export class FireGroundGlow {
  private glows = new Map<number, Glow>()

  constructor(private scene: Phaser.Scene) {
    ensureTexture(scene)
  }

  /** Réconcilie une flaque par Feu et la fait respirer (alpha) avec la flamme (`fireGlow`). */
  update(structures: Structure[], villages: SnapshotMessage['villages'], day: number, now: number, tick: number): void {
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      // Un feu ÉTEINT ne rougeoie plus le sol (spec feu-station S1/S3) : on le saute → la
      // réconciliation détruit sa flaque. (Les braises la gardent, atténuée par `fireGlow`.)
      if (fireStateAt(tick, s) === 'out') continue
      seen.add(s.id)
      const warmth = villages.find((v) => v.id === s.villageId)?.warmth ?? 0
      const g = fireGlow(warmth, day, now, s.id * 1.7)
      let glow = this.glows.get(s.id)
      if (!glow) {
        // Centrée sur le CENTRE de la tuile du foyer — un multiple de 2 px, donc la grille des
        // cellules tombe pile sur la grille de 2 px de l'art (aucun décalage d'un demi-pixel).
        glow = this.scene.add
          .image((s.tx + 0.5) * TILE_PX, (s.ty + 0.5) * TILE_PX, TEX_KEY)
          .setOrigin(0.5, 0.5)
          .setDepth(FIRE_GROUND_DEPTH)
          .setBlendMode('ADD')
          .setDisplaySize(TEX_SIDE * LIGHT_PX, TEX_SIDE * LIGHT_PX) // 1 texel = 4 px monde
        this.glows.set(s.id, glow)
      }
      glow.setAlpha(Math.min(1, g.alpha * GLOW_ALPHA_SCALE))
    }
    for (const [id, glow] of this.glows) {
      if (seen.has(id)) continue
      glow.destroy()
      this.glows.delete(id)
    }
  }

  destroy(): void {
    for (const glow of this.glows.values()) glow.destroy()
    this.glows.clear()
  }
}
