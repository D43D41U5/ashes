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
 *   • CENTRÉE PAR DÉFAUT, et hors du modèle de lumière. L'éclairage dynamique est le rendu par
 *     défaut (décision d'Alexis, docs/decisions.md 2026-07-24), mais l'ombre de contact garde
 *     son alpha constant et sa composition normale : c'est une occlusion ambiante cosmétique,
 *     qui rend à l'identique lumière allumée ou éteinte.
 *     ⚠ UNE SEULE ENTORSE, le 2026-08-27 : le paramètre `deriveX` fait GLISSER la flaque en X,
 *     à l'opposé de l'astre (demande d'Alexis, pour le socle minéral). Ce n'est toujours pas un
 *     couplage au modèle de lumière — l'appelant passe des PIXELS, ce module ne connaît ni
 *     l'heure ni la lune — et le défaut de 0 rend le comportement d'avant, au pixel près.
 *   • CONSTANTE (occlusion ambiante), pas ∝ jour/nuit. L'objet bloque la lumière ambiante
 *     qu'il fasse jour ou nuit ; une ombre stable est plus simple et n'introduit aucune
 *     dépendance au modèle de lumière. Purement cosmétique, ne conditionne rien.
 */
import Phaser from 'phaser'
import { alphaDOmbre, cleOmbreSocle, CRANS, OMBRE_SOCLE, TEX_H, TEX_W, type FormeOmbre } from '../../render/ombre-socle'

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
  /**
   * DÉRIVE EN X (px monde), SIGNÉE — de combien la flaque glisse à l'opposé de l'astre.
   * *(demande d'Alexis, 2026-08-27 ; par défaut 0, donc rien ne bouge pour qui ne la passe pas.)*
   *
   * C'est la seule entorse au « CENTRÉE, jamais orientée par le soleil » de l'en-tête, et elle
   * est bornée : l'appelant reste maître du côté (`lighting.deriveDOmbre`) et de l'amplitude,
   * l'ombre garde son alpha constant et sa composition normale. On ne rouvre pas le couplage au
   * modèle de lumière — on décale une ellipse. Aujourd'hui seul le SOCLE MINÉRAL s'en sert.
   */
  deriveX = 0,
): void {
  // ⚠ **ON REPOSE LA TEXTURE ET L'ORIGINE.** Le pool des ombres de nœuds est réattribué à chaque
  // image, et un socle a pu passer par CET objet la frame d'avant (`poserOmbreDeSocle` lui met
  // une coulée et l'origine en haut). Sans ce retour au propre, un arbre hériterait de l'ombre
  // du bloc voisin selon l'ordre dans lequel le pool a été servi — le défaut que l'en-tête de
  // `renderNodes` documente déjà pour le houppier. L'ALPHA, lui, n'est PAS touché : l'appelant
  // le règle après coup (l'immersion le fond, spec eau-vivante R4).
  if (shadow.texture.key !== SHADOW_TEX_KEY) shadow.setTexture(SHADOW_TEX_KEY)
  if (shadow.originY !== 0.5) shadow.setOrigin(0.5, 0.5)
  const w = largeurMonde ?? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, actorDisplayW * WIDTH_FACTOR))
  const h = w * FLATTEN
  // ARRONDI AU PIXEL MONDE : la flaque est une texture NEAREST étirée sur ~30 px ; une
  // destination fractionnaire ferait sautiller ses arêtes internes à contretemps pendant que
  // l'astre rampe. Même raison que les crans du pavement (`CRANS_SOLEIL`).
  //
  // ⚠ **SYMÉTRIQUE, PAS `Math.round`.** JS arrondit les demis vers +∞ : `round(-3.5) = -3` mais
  // `round(3.5) = 4`. Or la dérive est ANTISYMÉTRIQUE autour du zénith — matin et après-midi de
  // même force tomberaient à un pixel l'un de l'autre, et l'ombre irait « plus loin d'un côté ».
  const pas = Math.sign(deriveX) * Math.round(Math.abs(deriveX))
  shadow.setPosition(feetX + pas, feetY - baseGapWorld)
  shadow.setDisplaySize(w, h)
  shadow.setDepth(actorDepth - DEPTH_UNDER)
  shadow.setVisible(true)
}

/**
 * ═══ L'OMBRE DU SOCLE — la mécanique de rendu de la COULÉE ═══
 * *(la géométrie, elle, est pure et vit dans `render/ombre-socle.ts` — voir son en-tête pour le
 * pourquoi : une empreinte à angles droits sous une pierre taillée, pas une lentille molle.)*
 *
 * ⚠ **LA FORME EST UN CHOIX D'ALEXIS, PAS UNE CONSTANTE DE CODE** : `FORME_DU_SOCLE` pilote les
 * trois variantes qu'il a vues sur planche. `ellipse` retombe MOT POUR MOT sur l'ombre de
 * contact générique — aucun chemin de code en plus, aucune texture cuite — ce qui rend le
 * retour en arrière gratuit et le témoin de la planche honnête.
 */
export const FORME_DU_SOCLE: FormeOmbre = 'coulee'

/** Cuit les `2 × CRANS + 1` coulées (une par texel de cisaillement) — une fois, au premier socle
 *  rencontré. 17 textures de 32×14 : le coût est celui d'un sprite. */
function assurerOmbresDeSocle(scene: Phaser.Scene): void {
  if (FORME_DU_SOCLE === 'ellipse') return
  // ⚠ UN SEUL `exists` EN RÉGIME ÉTABLI. Cette fonction est appelée par socle ET par image :
  // boucler sur les 17 crans pour les trouver tous déjà cuits, c'est 17 lookups × N blocs à
  // l'écran, chaque frame. Le cran 0 existe toujours dès que la cuisson est passée.
  if (scene.textures.exists(cleOmbreSocle(0))) return
  for (let cran = -CRANS; cran <= CRANS; cran++) {
    const cle = cleOmbreSocle(cran)
    if (scene.textures.exists(cle)) continue
    const tex = scene.textures.createCanvas(cle, TEX_W, TEX_H)
    if (!tex) return
    const ctx = tex.getContext()
    const img = ctx.createImageData(TEX_W, TEX_H)
    for (let j = 0; j < TEX_H; j++) {
      for (let i = 0; i < TEX_W; i++) {
        const k = (j * TEX_W + i) * 4
        img.data[k] = 0
        img.data[k + 1] = 0
        img.data[k + 2] = 0
        img.data[k + 3] = Math.round(alphaDOmbre(FORME_DU_SOCLE, cran, i, j) * 255)
      }
    }
    ctx.putImageData(img, 0, 0)
    tex.refresh()
    scene.textures.get(cle).setFilter(Phaser.Textures.FilterMode.NEAREST)
  }
}

/**
 * Pose la coulée sous un socle. `feetY` est la LIGNE DE PIED (le bord bas de sa tuile : le socle
 * est flush, cf. `nodeArtGap`) ; la coulée REMONTE de `OMBRE_SOCLE.REMONTE` texels au-dessus,
 * pour se glisser sous la pierre — sans quoi un liseré de sol nu s'ouvre entre la base et son
 * ombre. Origine en HAUT-CENTRE, donc c'est bien le CONTACT qui est ancré, jamais la pointe.
 *
 * Rend `false` si la forme retenue est l'ellipse : l'appelant retombe alors sur `positionShadow`.
 */
export function poserOmbreDeSocle(
  shadow: Phaser.GameObjects.Image,
  feetX: number,
  feetY: number,
  cran: number,
  echelleX: number,
  echelleY: number,
  actorDepth: number,
  /** Part de l'alpha nominal, dans [0, 1] — `dynamic-lighting.forceDeLOmbre`. Une ombre PORTÉE
   *  n'existe que tant qu'un astre la jette : au crépuscule elle s'éteint, et à la nouvelle lune
   *  elle n'est plus là du tout. (Défaut à 1 : le comportement d'avant.) */
  force = 1,
): boolean {
  if (FORME_DU_SOCLE === 'ellipse') return false
  assurerOmbresDeSocle(shadow.scene)
  shadow.setTexture(cleOmbreSocle(cran))
  shadow.setOrigin(0.5, 0)
  shadow.setDisplaySize(TEX_W * echelleX, TEX_H * echelleY)
  shadow.setPosition(feetX, feetY - OMBRE_SOCLE.REMONTE * echelleY)
  shadow.setAlpha(SHADOW_ALPHA * Math.max(0, Math.min(1, force)))
  shadow.setDepth(actorDepth - DEPTH_UNDER)
  shadow.setVisible(true)
  return true
}
