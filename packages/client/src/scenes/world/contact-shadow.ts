/**
 * L'OMBRE DE CONTACT — la petite flaque sombre sous les pieds qui POSE un acteur au sol.
 *
 * Sans elle, les billboards (joueur, PNJ, bêtes) FLOTTENT : dessinés à plat sur une carte
 * plate (pivot RimWorld, `warp.lift ≡ 0`), rien ne les rattache à la terre. Une ellipse
 * sombre sous les pieds suffit — c'est l'astuce de rendu la plus rentable du top-down.
 *
 * PIXEL, comme tout le jeu (DA, cf. `fire-ground-glow`) : la texture est bakée UNE fois et
 * rendue en NEAREST → des carrés durs, JAMAIS un dégradé lissé qui baverait entre deux styles.
 * Nuance assumée face au Feu : lui fige son grain à 4 px monde (taille d'affichage fixe) ; ici
 * la flaque se dimensionne à l'acteur, donc le grain SUIT sa taille (~2 px sous un humain, la
 * grille de l'art). L'invariant tenu est le NEAREST, pas un nombre de pixels constant.
 *
 * Trois partis pris, calqués sur ce qui marche déjà et sur l'avis du reviewer :
 *   • NOIR en ALPHA NORMAL (~⅓), pas MULTIPLY. Le multiply « correct » a des ratés WebGL et
 *     se cumule avec l'ombrage de pente (`ShadeLayer`) sur les mêmes pixels de sol → des
 *     zones plates-en-ombre imprévisibles. Un noir composité normalement se règle à l'œil.
 *   • CENTRÉE, jamais orientée par le soleil. L'éclairage dynamique est désormais le rendu par
 *     défaut (décision d'Alexis, docs/decisions.md 2026-07-24), mais on garde DÉLIBÉRÉMENT
 *     l'ombre de contact hors du modèle de lumière : c'est une occlusion ambiante cosmétique,
 *     composée en alpha normal, qui doit rendre à l'identique lumière allumée ou éteinte. Une
 *     ombre orientée par `sunDirection(hour)` serait plus riche mais rouvrirait ce couplage —
 *     hors scope ici. On reste pure technique : ellipse de contact, sans angle de lumière.
 *   • CONSTANTE (occlusion ambiante), pas ∝ jour/nuit. L'objet bloque la lumière ambiante
 *     qu'il fasse jour ou nuit ; une ombre stable est plus simple et n'introduit aucune
 *     dépendance au modèle de lumière. Purement cosmétique, ne conditionne rien.
 */
import Phaser from 'phaser'

/** Rayon de la tache EN TEXELS. Volontairement PETIT (≈9 texels de large) : la flaque étant
 *  dimensionnée à l'acteur, peu de texels = un grain franc (~2 px monde sous un humain, la
 *  grille de l'art) au lieu d'un dégradé fin qui passerait pour du lissé. */
const RADIUS_CELLS = 4
const TEX_SIDE = RADIUS_CELLS * 2 + 1
/** Opacité de contact : présente assez pour POSER l'acteur, discrète assez pour ne pas tacher.
 *  (0,32 lu au smoke = quasi invisible sur sol clair ; 0,42 pose sans faire pâté.) */
/** Exporté : l'immersion (spec eau-vivante R4) fond l'ombre en gardant ce plafond. */
export const SHADOW_ALPHA = 0.42
/** L'ellipse est APLATIE : au sol, une flaque plus large que haute (billboard sur carte plate). */
const FLATTEN = 0.5
/** Largeur de l'ombre ∝ emprise de l'acteur. Un poil PLUS LARGE que le footprint logique (×1,2) :
 *  l'art du billboard déborde de sa boîte de collision, l'ombre doit épouser la base VISIBLE. */
const WIDTH_FACTOR = 1.2
/** Bornes de largeur (px monde). Le plancher est un garde-fou contre une emprise dégénérée,
 *  PAS un gonfleur : à 14 il grossissait le lapin (emprise 0,6 tuile = 9,6 px) jusqu'à porter
 *  une flaque 45 % plus large que lui — pire que pas d'ombre. Le plafond tient l'alpha (2
 *  tuiles = 32 px → 38,4). Entre les deux, la taille reste PROPORTIONNELLE à la bête. */
const MIN_WIDTH = 8
const MAX_WIDTH = 40
/** Juste SOUS l'acteur (son tie est 0.8) : l'acteur se dessine par-dessus sa propre ombre,
 *  mais une entité au SUD (feetY plus grand) l'occulte encore — le Y-sort domine ce ε. */
const DEPTH_UNDER = 0.05

const SHADOW_TEX_KEY = 'fx-contact-shadow'

/** Texture PIXEL : disque noir dont l'ALPHA suit un smoothstep (plein au centre, 0 doux au
 *  bord). RVB = 0 partout ; seul l'alpha porte la forme. NEAREST → carrés durs. */
function ensureShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHADOW_TEX_KEY)) return
  const tex = scene.textures.createCanvas(SHADOW_TEX_KEY, TEX_SIDE, TEX_SIDE)
  if (!tex) return
  const ctx = tex.getContext()
  const img = ctx.createImageData(TEX_SIDE, TEX_SIDE)
  for (let j = 0; j < TEX_SIDE; j++) {
    for (let i = 0; i < TEX_SIDE; i++) {
      const dx = i - RADIUS_CELLS
      const dy = j - RADIUS_CELLS
      const t = Math.min(1, Math.sqrt(dx * dx + dy * dy) / RADIUS_CELLS) // 0 centre → 1 bord
      const s = 1 - t
      const a = s * s * (3 - 2 * s) // smoothstep sur (1-t) : plein au centre, 0 au bord
      const k = (j * TEX_SIDE + i) * 4
      img.data[k] = 0
      img.data[k + 1] = 0
      img.data[k + 2] = 0
      img.data[k + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  scene.textures.get(SHADOW_TEX_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST)
}

/** Une ombre neuve, invisible tant que `positionShadow` ne l'a pas posée. À rattacher à son
 *  acteur (`sprite.setData('shadow', …)`) pour que `syncActor` la retrouve, et à détruire
 *  AVEC lui (l'avis reviewer : une ombre orpheline est le seul bug qu'un screenshot ne voit pas). */
export function createContactShadow(scene: Phaser.Scene): Phaser.GameObjects.Image {
  ensureShadowTexture(scene)
  return scene.add.image(0, 0, SHADOW_TEX_KEY).setOrigin(0.5, 0.5).setAlpha(SHADOW_ALPHA).setVisible(false)
}

/** Pose l'ombre aux pieds de l'acteur (mêmes `px/py` que le sprite), aplatie et dimensionnée
 *  à son emprise, juste sous sa profondeur. Appelée chaque frame depuis `syncActor`.
 *
 *  RÈGLE DE PLACEMENT (Alexis) : l'ombre est une ellipse ; on cale son PLUS GRAND DIAMÈTRE (l'axe
 *  horizontal, qui passe par son centre) PILE sur le PIXEL LE PLUS BAS du sprite qu'elle ombre.
 *  Donc centre_y = pixel opaque le plus bas. Pour un acteur, ce pixel EST la ligne de pieds (`py`),
 *  d'où `baseGapWorld = 0`. Pour un prop dont l'art s'arrête au-dessus du bas de tuile, on remonte
 *  le centre de ce gap (en px MONDE = gap en texels × échelle du sprite) — voir les callers. */
export function positionShadow(
  shadow: Phaser.GameObjects.Image,
  feetX: number,
  feetY: number,
  actorDisplayW: number,
  actorDepth: number,
  baseGapWorld = 0,
  /**
   * Largeur imposée (px monde), quand la règle générale ne convient pas.
   *
   * Elle existe pour LE SOCLE MINÉRAL, et la raison est géométrique : la flaque est CENTRÉE sur
   * le pied du sprite, donc sa moitié haute passe DERRIÈRE lui. Tant que l'art était étroit
   * (11 texels sur 16), elle débordait largement et se voyait ; un socle pleine tuile la mange
   * presque entière — `16 × 1,2 = 19,2`, soit 1,6 texel de chaque côté. « L'ombre de la pierre
   * est trop petite maintenant » (Alexis) : ce n'est pas l'ombre qui a rétréci, c'est la pierre
   * qui s'est élargie jusqu'à la couvrir.
   */
  largeurMonde?: number,
): void {
  const w = largeurMonde ?? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, actorDisplayW * WIDTH_FACTOR))
  const h = w * FLATTEN
  shadow.setPosition(feetX, feetY - baseGapWorld)
  shadow.setDisplaySize(w, h)
  shadow.setDepth(actorDepth - DEPTH_UNDER)
  shadow.setVisible(true)
}
