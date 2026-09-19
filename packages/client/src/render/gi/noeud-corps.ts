/**
 * ═══ LE NŒUD DE RENDU DES CORPS — CE QUI PORTE `corps-gpu` JUSQU'AU FRAGMENT ═══
 *
 * `corps-gpu.ts` écrit la LOI en GLSL. Ce module-ci ne fait que l'amener au bon endroit avec les
 * bonnes valeurs : il n'y a pas une ligne de lumière ici, et il ne doit jamais y en avoir.
 *
 * ═══ POURQUOI DEUX NŒUDS ET NON UN ═══
 * MESURÉ, et c'est ce qui commande toute la forme du fichier : **`BatchHandlerQuad.batch()` ne reçoit
 * JAMAIS le GameObject.** Sa signature s'arrête à `tint2BR` (`BatchHandlerQuad.js:696-712`) ; la queue
 * `@param {...*} [args]` de sa doc n'est remplie par personne. Le seul endroit qui voit à la fois le
 * corps et son lot est `SubmitterQuad.run()`, qui résout le handler par
 * `gameObject.customRenderNodes[this.batchHandler]` (`SubmitterQuad.js:182`).
 *
 * D'où : un SUBMITTER qui lit le sac du corps et le tend au handler, un HANDLER qui porte le shader.
 * J'avais d'abord cru pouvoir tout faire dans le handler — c'était faux, et le défaut aurait été que
 * `renderNodeData` reste vide sans que rien ne le dise.
 *
 * ═══ ET POURQUOI LES SIX VALEURS NE PASSENT PAS PAR `renderOptions` ═══
 * La route paraissait élégante : `renderOptions` traverse déjà la frontière, et `batch()` vide le lot
 * tout seul quand elles changent. Deux mesures l'abattent :
 *   · `updateRenderOptions` (`:404-459`) est une liste de SEPT champs écrite à la main — un huitième
 *     serait ignoré en silence ;
 *   · et même surchargée, `batch()` enchaîne `this.run()` **avec `this.updateShaderConfig()`**
 *     (`:719-723`) : je reconstruirais le programme de shader une fois par corps.
 * La vidange se fait donc à la main, dans `poserCorps` — et c'est l'idiome de Phaser lui-même, qui
 * appelle `this.run(currentContext)` au milieu de son propre `batch()`.
 */
import Phaser from 'phaser'
import { UNIFORMES_CORPS, faireAdditionCorps } from './corps-gpu'
import { SANS_DESSUS, type CorpsPose } from './sol-du-corps'

const BatchHandlerQuad = Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuad
const SubmitterQuad = Phaser.Renderer.WebGL.RenderNodes.SubmitterQuad

/**
 * LES NOMS SONT DES ADRESSES, pas des étiquettes.
 *
 * `NOM_NOEUD` indexe `renderNodeData` (`RenderNodes.js:145` : `renderNodeData[renderNode.name]`) ET
 * la table des constructeurs de `game.config.renderNodes`. Le changer casse les deux d'un coup.
 */
export const NOM_NOEUD = 'GiCorpsBatch'
export const NOM_SUBMITTER = 'GiCorpsSubmitter'

/**
 * LES CLÉS DE RÔLE — mesurées, pas devinées (`DefaultImageNodes.js:10-11`).
 *
 * ⚠ La clé du handler est **`'BatchHandler'`**, le RÔLE, et non `'BatchHandlerQuad'`, le nom de la
 * classe. Les deux existent dans Phaser, à deux endroits différents, et se ressemblent assez pour
 * qu'on prenne l'un pour l'autre : `RenderNodeManager.js:175` enregistre bien un
 * `BatchHandlerQuad: BatchHandlerQuad` — mais c'est la table des CONSTRUCTEURS, pas celle des rôles.
 * Une clé fausse ne lève rien : `customRenderNodes['BatchHandlerQuad']` ne serait lu par personne, le
 * nœud par défaut resterait en place, et les corps sortiraient éclairés comme avant. Le symptôme se
 * lirait comme « l'interrupteur GI est éteint ».
 */
export const ROLE_HANDLER = 'BatchHandler'
export const ROLE_SUBMITTER = 'Submitter'

/** Les quatre textures du champ, telles que `ChampGpu` les publie — trois pour un corps, `champ` pour un sol. */
export interface TexturesDuChamp {
  readonly lumiere: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
  readonly faceDirecte: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
  readonly ombre: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
  /** `gi-champ` — le `M` composé, celui du quad de sol ; un SOL (LG-R14) le lit tel quel. */
  readonly champ: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper
}

/**
 * CE QUI NE CHANGE PAS D'UN CORPS À L'AUTRE — posé une fois par image par `WorldScene`.
 * Le cadre du champ, le ciel de l'heure (`CielDeLHeure`) et les deux sources (`SourcesDuPixel`).
 */
export interface ChampDeLImage {
  readonly textures: TexturesDuChamp
  /** `[x, y, gw, gh]` — l'origine du raster en px MONDE, sa taille en TEXELS. */
  readonly cadre: readonly [number, number, number, number]
  /** Le pas du raster, en px monde par texel. */
  readonly pas: number
  readonly mn: readonly [number, number, number]
  readonly a: number
  readonly ambiante: number
  /** `[x, y, z, présente]` en px MONDE — `z` est la hauteur au-dessus du sol. */
  readonly astre: readonly [number, number, number, number]
  readonly feu: readonly [number, number, number, number]
}

/**
 * CE QUI CHANGE À CHAQUE CORPS — le sac que `snapshot-view` mute à chaque image.
 *
 * ⚠ **MUTABLE, ET C'EST LA CONDITION POUR QU'IL RESTE VRAI.** `setRenderNodeRole` range le sac
 * PAR RÉFÉRENCE tant que `copyData` est faux (`RenderNodes.js:143-149`) : le poser une fois et muter
 * ses champs suffit. Passer `copyData: true` ferait une copie profonde À LA CRÉATION, et le corps
 * serait juste sur l'image de sa naissance puis faux pour toujours — `ligneDuPied` bouge avec le
 * `lift`, `expositionAuFeu` avec le feu. Le défaut serait lent et silencieux.
 */
export interface CorpsPourLeShader {
  /** `ligneDuPied(c)`, en px monde. */
  pied: number
  /** `c.x` — le feu se lit au pied À L'ANCRE, jamais à l'abscisse du pixel. */
  ancreX: number
  /** `hauteurDeCrete(c)` — de combien plus bas un DESSUS lit le sol. */
  crete: number
  /** `seuilDuDessus(c)`, en px monde : un pixel de bande nord/sud (ou de socle) au-dessus est un
   *  dessus. `-∞` (un très grand négatif) pour un corps qui n'a pas de dessus — un fût. */
  seuil: number
  /** 1 si `suitLaRegleDesFaces(c)`, sinon 0. */
  dresse: number
  /** 1 si `estRuban(c)`. */
  ruban: number
  /** `expositionAuFeu(c, feu)`, ou **−1** pour son `null`. */
  expo: number
  /** `c.lift`, en px (LG-R14) : le fragment dessiné se remonte d'autant pour se juger à sa place logique. */
  lift: number
  /** 1 si `c.ciel` — un corps sous le ciel seul (un toit) : ni lumière ni ombre du champ, le plancher et l'astre entiers. */
  ciel: number
  /** `CorpsPose.sol` (LG-R14) : 0 un corps, 1 `tuile`, 2 `pied`, 3 `piedSousLeVoile` — voir `UNIFORMES_CORPS.sol`. */
  sol: number
}

/** Un corps qu'on n'a pas encore renseigné : plat, sans feu direct, au sol. Jamais un `null` dans le shader. */
const CORPS_NEUTRE: CorpsPourLeShader = { pied: 0, ancreX: 0, crete: 0, seuil: SANS_DESSUS, dresse: 0, ruban: 0, expo: -1, lift: 0, ciel: 0, sol: 0 }

/**
 * LES UNITÉS DE TEXTURE — 0 et 1 sont à Phaser, 2/3/4 sont à nous.
 *
 * MESURÉ dans la branche d'éclairage de `batchTextures` (`BatchHandlerQuad.js:1001-1021`) : elle ne
 * remplit que `texture[0]` (le quad) et `texture[1]` (la normal map), et `finalizeTextureCount`
 * (`:366-372`) force `count = 1` sous éclairage — « the normal map is included in the textures array,
 * but it's attached to another texture unit, so we shouldn't count it ». Les rangs suivants du tableau
 * sont donc libres, et `bindUnits` (`WebGLTextureUnitsWrapper.js:148-155`) lie par POSITION en sautant
 * les trous. Quatre de plus tiennent partout : WebGL1 garantit 8 unités au minimum.
 */
const UNITE_LUMIERE = 2
const UNITE_FACE_DIRECTE = 3
const UNITE_OMBRE = 4
const UNITE_CHAMP = 5

/**
 * ═══ LE HANDLER — le lot, le shader, et les uniformes ═══
 */
export class NoeudCorpsGi extends BatchHandlerQuad {
  /** Le champ de l'image. `null` tant que `WorldScene` n'a rien posé — le nœud rend alors sans GI. */
  private champ: ChampDeLImage | null = null

  /** Le corps du draw en cours. Voir `poserCorps` pour la garde de vidange. */
  private corps: CorpsPourLeShader = CORPS_NEUTRE

  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(manager, { name: NOM_NOEUD } as Phaser.Types.Renderer.WebGL.RenderNodes.BatchHandlerConfig)

    // ─── LA SUBSTITUTION DE L'ADDITION ───
    //
    // On N'ÉNUMÈRE PAS la liste : `defaultConfig` en porte DOUZE (`BatchHandlerQuad.js:125-138`), et
    // sept d'entre elles font l'échantillonnage de texture lui-même. J'en avais noté cinq — en
    // reconstruire une liste de cinq aurait rendu des corps sans texture du tout.
    //
    // Et ce n'est pas seulement la meilleure route, c'est la SEULE : le champ `exports` de `phaser`
    // est clos sur `"."` et `"./package.json"`, donc les fabriques `Make*` — qui ne sont exportées
    // par aucun index — sont hors d'atteinte d'un import.
    //
    // ⚠ **`replaceAddition` NE FAIT RIEN, EN SILENCE, QUAND LE NOM EST ABSENT** (`ProgramManager.js:355-366` :
    // `if (index !== -1)`). Si Phaser renommait `'ApplyLighting'`, mon addition ne serait jamais posée,
    // les corps garderaient l'éclairage de Phaser, et le symptôme (« les corps sont comme avant ») se
    // lirait comme un interrupteur éteint. D'où l'assertion : c'est la troisième de cette famille dans
    // ce chantier, après la redéclaration d'`uCamera` et celle d'`uGiRuban`.
    const rang = this.programManager.getAdditionIndex('ApplyLighting')
    if (rang === -1) {
      throw new Error(
        `GI corps : l'addition « ApplyLighting » a disparu de BatchHandlerQuad — la substitution ` +
          `serait muette et les corps sortiraient avec l'éclairage de Phaser. Voir noeud-corps.ts.`,
      )
    }
    this.programManager.replaceAddition('ApplyLighting', faireAdditionCorps(true))

    // ⚠ ET ON NE L'ARME PAS ICI. L'armement se fait PAR TAG, pas par nom : `updateShaderConfig`
    // (`:523-528`) balaie `getAdditionsByTag('LIGHTING')` et pose `disable = !lighting` sur chacune.
    // `faireAdditionCorps` porte déjà `tags: ['LIGHTING']`, donc elle suit l'éclairage du corps toute
    // seule — et c'est pour cela que `snapshot-view` ne doit SURTOUT PAS couper `setLighting` : sans
    // lui, ni mon addition ni `uNormSampler` n'existent.
  }

  /** Le champ de l'image — `WorldScene` le pose une fois par image, avant le rendu des corps. */
  poserChamp(champ: ChampDeLImage | null): void {
    this.champ = champ
  }

  /**
   * ═══ LA GARDE DE VIDANGE — LE POINT OÙ CE NŒUD SE CASSERAIT EN SILENCE ═══
   *
   * Les huit valeurs d'un corps sont des UNIFORMES, et un uniforme vaut pour tout le lot. Sans cette
   * vidange, le second corps d'un lot prendrait le `pied`, la `crete` et l'`expo` du premier : deux
   * murs voisins liraient le même texel du champ, et ça ressemblerait à un défaut du shader.
   *
   * `run()` rend la main tout de suite si `instanceCount === 0` (`:595`), donc l'appel est gratuit sur
   * le premier corps. Et il est SÛR : `setCurrentBatchNode` (`RenderNodeManager.js:395-410`) ne relance
   * un nœud que s'il CHANGE — le mien reste le courant, à zéro instance, et le `batch()` suivant le
   * ré-arme sans double vidange.
   *
   * ⚠ Et l'inverse caméra n'a RIEN à repousser à la main : `setupUniforms` est appelé DANS la boucle
   * des sous-lots de `run()` (`:622-627`), donc à chaque vidange.
   */
  poserCorps(drawingContext: Phaser.Renderer.WebGL.DrawingContext, corps: CorpsPourLeShader): void {
    if (this.instanceCount > 0) {
      // ⚠ **ON VIDE AVEC LE CONTEXTE DES INSTANCES EN ATTENTE, PAS AVEC CELUI QU'ON REÇOIT.**
      // Les instances déjà dans le lot ont été empilées contre le contexte courant À CE MOMENT-LÀ ;
      // celui que le submitter nous tend est celui du corps SUIVANT. `setCurrentBatchNode` ne vide
      // que sur un changement de NŒUD (`RenderNodeManager.js:397`), donc un changement de CONTEXTE
      // sous le même nœud ne l'a pas couvert. `currentBatchDrawingContext` est précisément ce que
      // Phaser garde pour vider lui-même (`:402`).
      const ctx = this.manager.currentBatchDrawingContext ?? drawingContext
      this.run(ctx)
    }
    this.corps = corps
  }

  /**
   * LES UNIFORMES — ceux de Phaser d'abord, les nôtres ensuite.
   *
   * `super` pose `uResolution`, `uProjectionMatrix` et, si l'éclairage est armé, tout le bloc de
   * `updateLightingUniforms` dont `uNormSampler` (`BatchHandlerQuad.js:276-306`). On n'écrase rien :
   * tous nos noms sont préfixés `uGi`.
   */
  override setupUniforms(drawingContext: Phaser.Renderer.WebGL.DrawingContext): void {
    super.setupUniforms(drawingContext)

    const pm = this.programManager
    const champ = this.champ
    if (!champ) return

    // ─── L'INVERSE DE LA CAMÉRA ───
    //
    // Les six coefficients de `getWorldPoint` (`BaseCamera.js:876-914`), TRANSCRITS et non réinventés.
    // Le fragment ne divise rien : il applique `x·ima + y·imc + ime`, `x·imb + y·imd + imf`.
    //
    // ⚠ **LA CAMÉRA VIENT DU `drawingContext`, JAMAIS DE LA SCÈNE.** C'est ce qui rend la garde LG-A8
    // possible : une `DynamicTexture` a SA PROPRE caméra (`DrawingContext.js:66`), et c'est elle qui
    // doit gouverner quand on y dessine un corps pour le comparer à `pixelDuCorps`. « Optimiser » ceci
    // en `this.manager.renderer.scene.cameras.main` rendrait la garde muette tout en la laissant verte
    // au jeu — écrit ici pour que ce soit reconnaissable comme une régression.
    const camera = drawingContext.camera
    if (!camera) return
    // Les défauts à 0 ne servent jamais — `matrix` est un `Float32Array` de six — mais ils évitent
    // une assertion de non-nullité que `noUncheckedIndexedAccess` exigerait sinon.
    const [mva = 0, mvb = 0, mvc = 0, mvd = 0, mve = 0, mvf = 0] = camera.matrixCombined.matrix
    const det = 1 / (mva * mvd - mvb * mvc)
    pm.setUniform(UNIFORMES_CORPS.invA, [mvd * det, -mvb * det, -mvc * det, mva * det])
    pm.setUniform(UNIFORMES_CORPS.invB, [(mvc * mvf - mvd * mve) * det, (mvb * mve - mva * mvf) * det])

    // ─── LE CHAMP DE L'IMAGE ───
    pm.setUniform(UNIFORMES_CORPS.lumiere, UNITE_LUMIERE)
    pm.setUniform(UNIFORMES_CORPS.faceDirecte, UNITE_FACE_DIRECTE)
    pm.setUniform(UNIFORMES_CORPS.ombre, UNITE_OMBRE)
    pm.setUniform(UNIFORMES_CORPS.champ, UNITE_CHAMP)
    pm.setUniform(UNIFORMES_CORPS.cadre, [...champ.cadre])
    pm.setUniform(UNIFORMES_CORPS.pas, champ.pas)
    pm.setUniform(UNIFORMES_CORPS.mn, [...champ.mn])
    pm.setUniform(UNIFORMES_CORPS.a, champ.a)
    pm.setUniform(UNIFORMES_CORPS.ambiante, champ.ambiante)
    pm.setUniform(UNIFORMES_CORPS.astre, [...champ.astre])
    pm.setUniform(UNIFORMES_CORPS.feu, [...champ.feu])

    // ─── LE CORPS DU DRAW ───
    const c = this.corps
    pm.setUniform(UNIFORMES_CORPS.pied, c.pied)
    pm.setUniform(UNIFORMES_CORPS.ancreX, c.ancreX)
    pm.setUniform(UNIFORMES_CORPS.crete, c.crete)
    pm.setUniform(UNIFORMES_CORPS.seuil, c.seuil)
    pm.setUniform(UNIFORMES_CORPS.dresse, c.dresse)
    pm.setUniform(UNIFORMES_CORPS.ruban, c.ruban)
    pm.setUniform(UNIFORMES_CORPS.expo, c.expo)
    pm.setUniform(UNIFORMES_CORPS.lift, c.lift)
    pm.setUniform(UNIFORMES_CORPS.ciel, c.ciel)
    pm.setUniform(UNIFORMES_CORPS.sol, c.sol)
  }

  /**
   * LES TROIS TEXTURES DU CHAMP, GREFFÉES AU LOT.
   *
   * `super` remplit `texture[0]` et `texture[1]` ; on ajoute les rangs 2 à 4. `bindUnits` les liera
   * par position, et `finalizeTextureCount` continue de compter 1 (la branche d'éclairage l'y force),
   * donc le shader multi-texture reste à une seule texture de lot — ce qu'il est.
   */
  override batchTextures(
    glTexture: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper,
    renderOptions: object,
  ): number {
    const datum = super.batchTextures(glTexture, renderOptions)
    const champ = this.champ
    if (champ) {
      const t = this.currentBatchEntry.texture
      t[UNITE_LUMIERE] = champ.textures.lumiere
      t[UNITE_FACE_DIRECTE] = champ.textures.faceDirecte
      t[UNITE_OMBRE] = champ.textures.ombre
      t[UNITE_CHAMP] = champ.textures.champ
    }
    return datum
  }
}

/**
 * ═══ LE SUBMITTER — le seul qui voit le corps ═══
 *
 * Il ne fait qu'UNE chose de plus que celui de Phaser : lire le sac du corps et le tendre au handler
 * avant de soumettre le quad. Tout le reste est `super`.
 */
export class SubmitterCorpsGi extends SubmitterQuad {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    // ⚠ `batchHandler` reste **`'BatchHandler'`** : c'est le RÔLE que le submitter va chercher sur le
    // GameObject, pas le nom de mon nœud. Y mettre `NOM_NOEUD` ferait chercher un rôle qui n'existe
    // sur aucun objet, et `SubmitterQuad.js:182-183` retomberait sur `defaultRenderNodes[…]`
    // — c'est-à-dire `undefined`, et un `.batch()` sur `undefined`.
    super(manager, {
      name: NOM_SUBMITTER,
      batchHandler: ROLE_HANDLER,
    } as Phaser.Types.Renderer.WebGL.RenderNodes.SubmitterQuadConfig)
  }

  override run(
    drawingContext: Phaser.Renderer.WebGL.DrawingContext,
    gameObject: Phaser.GameObjects.GameObject,
    ...reste: unknown[]
  ): void {
    const handler = (gameObject as unknown as { customRenderNodes: Record<string, unknown> })
      .customRenderNodes[this.batchHandler]
    if (handler instanceof NoeudCorpsGi) {
      const sac = (gameObject as unknown as { renderNodeData: Record<string, unknown> })
        .renderNodeData[NOM_NOEUD]
      // Un sac absent n'est PAS une erreur : `setRenderNodeRole` en pose un vide quand l'appelant ne
      // lui en donne pas. On vide quand même le lot — le corps suivant ne doit pas hériter du
      // précédent, même mal renseigné.
      handler.poserCorps(drawingContext, (sac as CorpsPourLeShader | undefined) ?? CORPS_NEUTRE)
    }
    ;(super.run as (...a: unknown[]) => void)(drawingContext, gameObject, ...reste)
  }
}

/**
 * LA TABLE À DONNER À `game.config.render.renderNodes`.
 *
 * ⚠ La clé de config est **`renderNodes`**, pas `customRenderNodes` (`Config.js:486` :
 * `GetValue(renderConfig, 'renderNodes', {}, config)`, puis `RenderNodeManager.js:235` qui en fait des
 * `addNodeConstructor`). Les deux noms existent dans Phaser et désignent des choses différentes :
 * `customRenderNodes` est le sac PAR OBJET. Ma note de travail portait le mauvais des deux.
 *
 * `getNode(nom)` construit à la demande, avec le manager pour seul argument.
 */
export const NOEUDS_GI = {
  [NOM_NOEUD]: NoeudCorpsGi,
  [NOM_SUBMITTER]: SubmitterCorpsGi,
  // ⚠ **LE TYPE DÉCLARÉ ET L'IMPLÉMENTATION SONT EN DÉSACCORD, ET C'EST LE RUNTIME QUI FAIT FOI.**
  // Le `.d.ts` annonce `{[clé]: {key?: string, function?: any}}` — un objet à deux champs. Or
  // `RenderNodeManager.js:235-241` lit `Object.entries(...)` et passe la valeur BRUTE à
  // `addNodeConstructor(nom, constructeur)`, que `getNode` fait ensuite `new ...(manager)`
  // (`:353-366`). Passer un `{key, function}` donnerait donc un `new {…}()`. Le cast suit ce que le
  // code FAIT ; si Phaser corrige son type un jour, `tsc` le dira en rendant le cast inutile.
} as unknown as Record<string, Phaser.Types.Core.RenderNodesConfig>

/**
 * POSER LES DEUX RÔLES SUR UN SPRITE DE CORPS, et rendre son sac pour que l'appelant le mute.
 *
 * Idempotent : appelé chaque image sur un sprite pooled, il ne repose les rôles que la première fois.
 * L'appelant garde le sac rendu et en mute les champs — voir `CorpsPourLeShader`.
 */
export function armerLeCorps(sprite: Phaser.GameObjects.Image): CorpsPourLeShader {
  // ⚠ **`renderNodeData` NAÎT À `null`, PAS À `{}`** (`RenderNodes.js:60`). Il ne devient un objet
  // que dans `initRenderNodes:78`, appelé quand l'objet ENTRE DANS UNE SCÈNE — et cette ligne-là
  // précède le test du renderer, donc tout sprite ajouté l'a. Le `?.` couvre l'ordre inverse : un
  // sprite fabriqué puis armé AVANT son `scene.add`. Et il ne fait que déplacer la levée, il ne la
  // supprime pas — `setRenderNodeRole:147` écrit dans `this.renderNodeData[...]` et lèverait deux
  // lignes plus bas. C'est Phaser qui l'exige, pas moi : **armer un corps hors scène n'a pas de sens**.
  const data = (sprite as unknown as { renderNodeData: Record<string, unknown> | null }).renderNodeData
  const existant = data?.[NOM_NOEUD] as CorpsPourLeShader | undefined
  if (existant && 'expo' in existant) return existant

  const sac: CorpsPourLeShader = { ...CORPS_NEUTRE }
  // Le sac va au HANDLER (c'est son nom qui indexe `renderNodeData`), le submitter n'en a pas.
  // Et PAS de `copyData` : voir l'avertissement de `CorpsPourLeShader`.
  sprite.setRenderNodeRole(ROLE_HANDLER, NOM_NOEUD, sac)
  sprite.setRenderNodeRole(ROLE_SUBMITTER, NOM_SUBMITTER)
  return sac
}

/** Rendre un sprite au rendu de Phaser — l'interrupteur GI, dans l'autre sens. */
export function desarmerLeCorps(sprite: Phaser.GameObjects.Image): void {
  sprite.setRenderNodeRole(ROLE_HANDLER, null)
  sprite.setRenderNodeRole(ROLE_SUBMITTER, null)
}

/**
 * ═══ UN SOL DANS LE NŒUD DES CORPS (LG-R14) ═══
 *
 * OÙ une image de sol lit le champ : `lift` — sous le pixel, `lift` px sous sa place dessinée (une part
 * de terrasse, une écume) ; `pied` — à cette ligne, en px monde LOGIQUES, sur toute sa hauteur (une
 * paroi, une rampe levée, une chute) ; `sousLeVoile` — la même, pour une image de STRATE 0 que le quad
 * multiplie déjà (`CorpsPose.sol`, `sol-du-corps.ts`).
 */
export type SolDuChamp = { readonly lift: number } | { readonly pied: number; readonly sousLeVoile?: boolean }

/**
 * LA POSE de chaque image de sol armée, pour la garde (LG-A8, dev seulement) — le pendant du
 * `WeakMap` de `snapshot-view` pour les corps : le sac ne porte que ce que le fragment lit, la
 * référence veut la pose. Une image désarmée en sort ; une image qui meurt l'emporte.
 */
const POSES_DU_SOL = new WeakMap<Phaser.GameObjects.Image, CorpsPose>()

/**
 * ARMER UNE IMAGE DE SOL — les deux rôles, le sac, et l'ÉCLAIRAGE.
 *
 * ⚠ **`setLighting(true)` EST LA CONDITION, PAS UN DÉTAIL.** L'addition qui porte `appliquerGi` est
 * taguée `LIGHTING` et `updateShaderConfig` la désarme sur un objet non éclairé : une image de sol
 * armée sans éclairage serait dessinée par mon nœud avec le shader de Phaser NU, et le symptôme
 * (« la terrasse est comme avant ») se lirait comme un interrupteur éteint. Une image sans normal map
 * prend la `__NORMAL` plate de Phaser, que le bloc `uGiSol` ne lit de toute façon pas.
 *
 * À APPELER À CHAQUE IMAGE sur un emplacement poolé : le même slot sert une paroi de strate 2 puis une
 * lèvre de strate 0 d'une image à l'autre, et le sac persiste par référence.
 */
export function armerLeSol(image: Phaser.GameObjects.Image, sol: SolDuChamp): void {
  const sac = armerLeCorps(image)
  if ('lift' in sol) {
    sac.sol = 1
    sac.lift = sol.lift
    sac.pied = 0
  } else {
    sac.sol = sol.sousLeVoile === true ? 3 : 2
    sac.lift = 0
    sac.pied = sol.pied
  }
  image.setLighting(true)
  if (import.meta.env.DEV) {
    POSES_DU_SOL.set(
      image,
      'lift' in sol
        ? { x: image.x, y: image.y + sol.lift, arete: 0, lift: sol.lift, sol: 'tuile' }
        : { x: image.x, y: sol.pied, arete: 0, sol: sol.sousLeVoile === true ? 'piedSousLeVoile' : 'pied' },
    )
  }
}

/**
 * DÉSARMER UNE IMAGE DE SOL — et lui rendre son rendu SANS éclairage, celui que les couches de sol
 * ont toujours eu. Bon marché quand il n'y a rien à défaire : c'est l'appel de chaque image sur
 * chaque slot non armé.
 */
export function desarmerLeSol(image: Phaser.GameObjects.Image): void {
  const data = (image as unknown as { renderNodeData: Record<string, unknown> | null }).renderNodeData
  if (data?.[NOM_NOEUD] !== undefined) {
    desarmerLeCorps(image)
    if (import.meta.env.DEV) POSES_DU_SOL.delete(image)
  }
  if (image.lighting) image.setLighting(false)
}

/** La pose d'une image de sol armée (dev), ou `undefined` — pour la garde LG-A8. */
export function poseDuSol(image: Phaser.GameObjects.Image): CorpsPose | undefined {
  return POSES_DU_SOL.get(image)
}
