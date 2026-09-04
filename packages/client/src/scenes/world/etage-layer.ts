/**
 * LA COUCHE DES ÉTAGES — le sol du plateau, et la rampe qui l'ouvre (spec `etages.md` §5).
 *
 * Le pendant exact de `cliff-layer.ts`, et c'est délibéré : la falaise DONNE déjà son flanc au
 * plateau (E-R12 — le chapeau de mesa est de la roche à l'étage 0, `roleDeFalaise` en tire une
 * paroi et son ombre sans une ligne de plus). Il ne manquait que deux choses, et cette couche ne
 * fait qu'elles : **poser le sol marchable par-dessus le dessus d'ardoise**, et **entailler la
 * paroi là où une rampe monte**.
 *
 * ═══ POURQUOI DES SPRITES ET PAS UNE RenderTexture (déviation à E-R10, assumée) ═══
 *
 * E-R10 demandait « une RenderTexture dessinée comme un seul objet, à une profondeur unique », et
 * son argument est le bon : **102 `setDepth` dans 44 fichiers**, aucun container — insérer une
 * couche dans ce budget *objet par objet* est le chemin sûr vers la régression invisible. Mais le
 * risque qu'il nomme est celui de N objets à N PROFONDEURS. Un pool dont tous les sprites
 * partagent **une** constante n'ajoute qu'une profondeur, exactement comme une RT — et le dépôt
 * en a le précédent : `cliff-layer.ts` est né le jour même où cette mesure a été prise, avec deux
 * constantes, et vit dans ce budget sans le toucher. Employer un autre mécanisme pour le SOL
 * d'une roche que pour son FLANC aurait par-dessus le marché fait diverger deux dessins du même
 * objet — ce que tout `cliff-art.ts` s'applique à éviter.
 *
 * **Conséquence sur E-R11 et E-A7** : aucun chunk de pavé n'est cuit ici. Le budget que la spec
 * demandait de mesurer avant de le supposer tenable (« un second jeu de chunks ») n'existe donc
 * pas — le coût est N sprites bornés par la VUE, du même régime que la falaise et les nœuds, et
 * zéro octet de texture par plateau. Les textures sont générées une fois au boot (8 masques × 2
 * semis pour le sol, 3 rangées × 4 joues pour la rampe : 28 images de 16×16).
 *
 * AUCUNE logique de jeu ici — rendu pur d'état reçu. La couche ne DÉCIDE rien : le sol se lit de
 * `map.etages`, la rampe de `map.connecteurs`, et le rôle de chaque tuile de `roleDeFalaise`.
 */
import Phaser from 'phaser'
import {
  hash2, marchableAEtage, rampeQuiMonte, TERRAIN_SCREE, terrainAEtage,
  type Connecteur, type WorldMap,
} from '@ashes/sim'
import {
  caveKey, DEHORS_KEY, GUEULE_KEY, JOUR_KEY, PERIODE_CAVE, ROCHE_CAVE_KEY,
  SIGNES_DE_CAVE, TERRAINS_DE_CAVE, VARIANTES_LUEUR,
} from '../../render/cave-art'
import { PHASES_PAROI, VARIANTES_PAROI } from '../../render/cliff-art'
import {
  alphaDeDecouvert, CLIFF_DEPTH, LIFT_TUILES, niveauSurLaRampe, ROCHE_DEPTH,
  SOUTERRAIN_STRATE, strateDEtage, TIE_SOCLE, TILE_PX, ySortDepth, type Decouvert,
} from '../../render/framing'
import { PERIODE_DALLE, plateauKey, RAMPE_RANGEES, SOCLE_TEINTE } from '../../render/plateau-art'
import type { Relief } from '../../render/relief'
import { CaveFx, type TuileDeCave } from './cave-fx'
import { CaveVeil, type LumiereDeCave } from './cave-veil'
import { epinglerLaTuile } from '../../render/tuile-epinglee'

/**
 * ═══ DEPUIS LES TERRASSES (spec `terrasses.md`, T-R7) : TOUT SE COMPTE DEPUIS LE PALIER DU SOL ═══
 *
 * Le chapeau d'une mesa posée au palier `p` est au niveau `p + 1`, sa cave au niveau `p − 1` ; la
 * tuile se dessine à sa HAUTEUR (`Relief.hauteur` = palier + chapeau), `LIFT_TUILES` rangées plus
 * haut par cran. Les constantes `NIVEAU = 1` / `SOUS = −1` d'avant sont devenues des DÉCALAGES
 * relatifs au palier ; sur une carte sans palier (≡ 0 partout) c'est le nombre d'avant, au bit près.
 * La PAROI, elle, a quitté cette couche : `cliff-layer` la peint pour toute tuile plus haute que sa
 * voisine sud, mesa ou terrasse — une seule écriture du même mur.
 */
const SOUS = -1
/**
 * ═══ CE QUE LA CAVE POSE PAR TUILE, ET À QUEL RANG ═══
 *
 * Tout ce qui est SOUS le voile (`CAVE_VEIL_DEPTH`) prend la lumière du voile : sol, signes,
 * parois, ombres, la nappe de jour. Tout ce qui est AU-DESSUS reste visible dans le noir : la
 * lèvre (la silhouette de la salle — *une forme, pas un contenu*) et les lichens (qui font leur
 * propre lumière). Les ties se lisent du sol vers le haut, dans la rangée logique de la tuile.
 */
const TIE_SIGNE = 0.02
const TIE_OMBRE = 0.05
const TIE_JOUR = 0.06
/** La paroi trie sur la rangée du PIED de la roche (`ty − 1`) : un corps sur le sol passe devant. */
const TIE_PAROI = 0.3
/** La part des tuiles de salle qui portent un signe (os, éboulis, flaque). Assez rare pour que
 *  chacun se remarque : trois ou quatre par salle de quarante tuiles. */
const SIGNE_PART = 0.1
/** La part des tuiles SANS CIEL qui portent un lichen : la lumière du fond, celle qui n'éclaire rien. */
const LUEUR_PART = 0.11
/** Ce que la lèvre garde dans le noir complet. */
const LEVRE_ALPHA = 0.5
/** La lèvre se peint au-dessus de l'ombre portée, sous le voile — voir `poserLaLevre`. */
const TIE_LEVRE = 0.055
/** Les sels de `hash2` : un par tirage, sinon deux tirages sur la même tuile sont le même tirage. */
const SEL_SIGNE = 71
const SEL_LUEUR = 113
const SEL_PAROI = 29
/** Ce que le sol ne dit pas (rien) : la salle est peinte en pierrier, faute d'un terrain de cave. */
const TERRAIN_DE_CAVE_DEFAUT = TERRAIN_SCREE

/**
 * ═══ LA PROFONDEUR D'UN PLATEAU — SA STRATE, PUIS SA RANGÉE LOGIQUE ═══
 *
 * *Refonte du 2026-09-01, sur le constat d'Alexis : « je vois l'arrière de la mesa… on le voit
 * comme s'il était SUR la mesa par transparence ».* Ces pièces vivaient entre 0 et 1, c'est-à-dire
 * dans la bande du SOL, avec le bake et les pavés — parce que la couche était née « le sol d'une
 * mesa ». Depuis le lift ce n'en est plus un : c'est une MASSE qui se dresse, et elle était restée
 * rangée avec les tapis. Tout ce qui a des pieds trie à partir de 1 000 : **le plateau n'occultait
 * rien**, ni le joueur au pied de la façade nord, ni le clutter, ni les nœuds, ni les cadavres.
 *
 * Deux nombres, donc, et pas un :
 *
 *  • **La STRATE** (`strateDEtage`) — un étage se peint par-dessus l'étage du dessous, en entier.
 *    C'est la seule façon de tenir les deux exigences contradictoires du tri en Y : cacher un
 *    corps du BAS posé au nord, sans passer devant un corps du HAUT posé dessus.
 *  • **La RANGÉE LOGIQUE** `ty`, PAS la rangée dessinée `ty − lift` — la masse pose ses pieds où
 *    la carte la met, elle ne fait que déborder vers le haut de l'écran. C'est exactement la
 *    convention du houppier (« il n'occulte que ce qui est au nord de son tronc, qui est bien
 *    derrière lui »), et c'est ce qui trie juste un bord dentelé.
 *
 * `ty` et non `ty + 1` : un corps posé SUR la tuile a les pieds en `ty + 0,19` au minimum
 * (`AVATAR_HITBOX_DEPTH_TILES / 2`), donc trois unités de profondeur au-dessus de son plancher.
 * Sur `ty + 1`, le plancher passerait devant celui qui se tient dessus.
 */
const TIE_SOL = 0
const TIE_LISERE = 0.1
function profondeurDuPlancher(hauteur: number, ty: number, tie: number): number {
  return strateDEtage(hauteur) + ySortDepth(ty, TILE_PX, tie)
}

/**
 * ═══ LE SOCLE — LE DESSOUS DE LA MASSE, DERRIÈRE CELUI QU'ON DÉCOUVRE ═══
 *
 * *Alexis, 2026-09-01 : « le socle de l'étage doit être noir lorsque je suis en transparence. »*
 * Le fondu ne montrait pas le dessous du plateau : il montrait **le pré qui est DERRIÈRE la
 * mesa** — de l'herbe et des fleurs à l'intérieur d'une masse de roche. On glisse donc, sous
 * chaque tuile fondue, la MÊME image du sol teintée presque au noir (`SOCLE_TEINTE`), opaque :
 * elle bouche ce qui est derrière, et le plancher translucide se compose par-dessus elle.
 *
 * Elle vit dans la strate du BAS et trie sur la rangée DESSINÉE — c'est ce qui la met derrière le
 * corps quand le plancher, lui, est devant. Les deux encadrent le personnage : c'est ce qui fait
 * qu'on le voit *dans* la roche et non *sur* le pré.
 *
 * Aucune teinte de nuit : elle est déjà à 10 % de la pierre, et c'est une OMBRE — une ombre ne
 * s'assombrit pas quand le jour tombe, elle se confond avec lui.
 */
function profondeurDuSocle(hauteur: number, yDessine: number): number {
  return strateDEtage(hauteur - 1) + ySortDepth(yDessine, TILE_PX, TIE_SOCLE)
}

/**
 * La PAROI et son ombre ne sont plus ici (voir `cliff-layer`, « une seule paroi ») ; seule la
 * RAMPE reste, dans la bande du mur qu'elle entaille (`CLIFF_DEPTH` + la strate du palier bas) :
 * le grimpeur, encore au palier du bas tant que le connecteur n'a pas commuté, passe devant elle.
 */

export class EtageLayer {
  /** Publics pour la SONDE seulement (E-A7 : le budget se relève, il ne se suppose pas). */
  readonly sols: Phaser.GameObjects.Image[] = []
  readonly rampes: Phaser.GameObjects.Image[] = []
  /** La cave — sol, signes, parois, ombres, lèvres, nappe de jour : un pool, plusieurs ties. */
  readonly cave: Phaser.GameObjects.Image[] = []
  /** La roche qui efface le dehors quand on est dedans. Une seule image tuilée. */
  private roche: Phaser.GameObjects.TileSprite | undefined
  /** Le voile de la cave et ses trous de lumière — `null` dans un monde sans cave. */
  private veil: CaveVeil | null = null
  /** Les gouttes, la poussière, le souffle — même condition. */
  private fx: CaveFx | null = null
  /** Les tuiles de salle vues à cette image (les gouttes y tombent) — réutilisé, jamais réalloué. */
  private readonly tuilesVues: TuileDeCave[] = []
  /** Les gueules vues à cette image, en tuiles, et leurs centres en px monde (pour le voile). */
  private readonly gueulesVues: TuileDeCave[] = []
  /** Les gueules visibles de la salle, en px monde — lues par `DynamicLighting` (le jour y entre). */
  readonly gueulesPx: { x: number; y: number }[] = []
  /** `partDuCiel` par tuile de cave, mémorisé : la géométrie d'une cave ne change jamais. */
  private readonly cielMemo = new Map<number, number>()
  /** L'horloge des lichens : ils respirent, lentement. */
  private tLueur = 0
  /**
   * ═══ LE REGARD EST-IL SOUS LA ROCHE ? — posé par `WorldScene`, comme `teinte` ═══
   *
   * ⚠ **C'EST LE SEUL INTERRUPTEUR DE TOUTE LA COUCHE SOUTERRAINE, et il est délibéré.** Depuis
   * dehors, **une cave n'existe pas à l'écran** : la butte est pleine, exactement comme E-R1 le
   * dit de la carte. Dedans, on peint la salle par-dessus le monde qu'on a quitté et l'on efface
   * le dehors sous une roche opaque. C'est le *cull des étages au-dessus du regard* des moteurs à
   * paliers, réduit à sa plus simple expression : un booléen, parce qu'il n'y a que deux états.
   */
  souterrain = false
  /**
   * ═══ LA LUMIÈRE D'UNE CAVE — posée par `WorldScene`, qui tient la façade d'état ═══
   *
   * C'est E-R13 RENDU VISIBLE, en deux données et pas une fermeture par tuile :
   *
   *  • `partDuCielAt` : la loi de /sim (`partDuCiel`) — le jour n'entre que par la gueule, et
   *    meurt `CIEL_PENETRATION` tuiles plus loin. La couche s'en sert pour savoir OÙ le noir est
   *    complet (les lichens n'y poussent que là) ; la NAPPE de jour, elle, est une brosse du voile
   *    centrée sur la gueule, de la même portée — deux lectures d'une même loi, par la même
   *    constante.
   *  • `lumiere` : ce qui change à chaque image — la force du ciel à cette heure, sa couleur, la
   *    torche et le corps. Le voile (`CaveVeil`) en fait ses trous.
   *
   * `null` : on peint à plein (avant la première façade).
   */
  partDuCielAt: ((tx: number, ty: number) => number) | null = null
  lumiere: LumiereDeCave | null = null
  /** Les rampes et gueules par tuile : `y * width + x` de chaque tuile de connecteur. */
  private portes: Map<number, Connecteur>
  /**
   * ⚠ **LA NUIT DU PLATEAU SE PEINT À LA MAIN DEPUIS QU'IL A QUITTÉ LA BANDE DU SOL.**
   *
   * Le voile d'ambiance passe SOUS les sprites en rendu éclairé (`AMBIENT_DEPTH_LIT = 8`) : il
   * n'assombrit que le fond, et les sprites prennent leur nuit de l'éclairage dynamique via leurs
   * paires `_lit`. En montant dans la bande de tri, le plateau est sorti de la portée du voile —
   * sans rien de plus, **la mesa serait restée en plein jour à minuit**.
   *
   * On lui repose donc, en teinte plate, le multiplicateur que le voile lui appliquait : il se
   * DÉRIVE du voile (`multiplicateurDuVoile`), il ne s'écrit pas à côté de lui — sans quoi les
   * deux chaînes cesseraient de parler de la même nuit à la première retouche. Ce qu'on ne gagne
   * pas ainsi, c'est la torche et le feu sur la paroi : il y faudrait une paire `_lit` (albédo +
   * normale), et la roche porte déjà son ombrage cuit dans son dessin.
   *
   * ⚠ **AU PALIER 0, ELLE NE VAUT QUE POUR LE PLANCHER.** La rampe et la gueule d'un palier 0
   * sont restées sous le voile (`CLIFF_DEPTH`) : les teinter aussi les assombrirait DEUX FOIS.
   * Mais une rampe ou une gueule LEVÉE d'un palier (terrasses, T-R8bis) sort du voile avec sa
   * strate et prend la teinte — la règle se juge au NIVEAU de ce qu'on pose (`bas >= 1`), jamais
   * à la profondeur, `CLIFF_DEPTH` étant négatif. Aux paliers hauts, c'est `pave-layer` qui porte
   * la nuit du sol, avec la même teinte.
   * Et l'appelant la remet à blanc en rendu à plat (debug), où le voile recouvre toute la scène.
   */
  teinte = 0xffffff

  constructor(
    private scene: Phaser.Scene,
    private map: WorldMap,
    /** Le relief cuit (`render/relief.ts`) : palier, chapeau, salle — une lecture de tableau par
     *  tuile, là où la dichotomie de `/sim` sur `idx` coûtait douze comparaisons, 900 fois par image. */
    private relief: Relief,
  ) {
    this.portes = new Map()
    for (const c of map.connecteurs ?? []) this.portes.set(c.y * map.width + c.x, c)
    // Le voile et ses FX ne coûtent que s'il y a une cave à voir : une vallée sans butte creuse
    // n'alloue ni RenderTexture ni pool de grains.
    if (relief.aDesSalles) {
      this.veil = new CaveVeil(scene)
      this.fx = new CaveFx(scene)
    }
  }

  /** Cette couche a-t-elle quoi que ce soit à dire de ce monde ? (une vallée plate : non) */
  get actif(): boolean {
    return this.relief.actif
  }

  /**
   * ═══ LA HAUTEUR À LAQUELLE ON DESSINE UN CORPS POSÉ LÀ ═══
   *
   * ⚠ **ELLE SE DÉRIVE DE LA TUILE OÙ LE CORPS EST DESSINÉ, PAS DU SEUL ENTIER DE L'AUTORITÉ —
   * et c'est le second saut, celui qui ne se voit sur aucune image fixe** (*Alexis, 2026-09-01 :
   * « il y a un saut pendant le changement d'étage »*).
   *
   * Le client dessine à la position PRÉDITE et avec l'étage de l'AUTORITÉ : `etageJoueur` n'est
   * posé qu'à la réconciliation (« la prédiction ne le calcule pas, elle le LIT », `WorldScene`).
   * Il y a donc au moins un tick entre les deux. À l'image où la position prédite quitte la rampe
   * pour le chapeau, la pente n'a plus lieu d'être et l'étage vaut encore 0 : le corps retombait
   * de tout le lift, puis remontait quand l'autorité rattrapait. **MESURÉ : 25,6 px d'aller-retour
   * pour UN tick de retard**, au moment précis du changement d'étage.
   *
   * ⚠ **CE N'EST PAS PRÉDIRE L'ÉTAGE, et la distinction est celle de l'invariant n°3.** La
   * prédiction, elle, continue de LIRE l'autorité : sa collision, son pas, son `predictionWorld`
   * ne changent pas d'un bit. Ce qu'on répond ici est une question de RENDU — *« à quelle hauteur
   * dessine-t-on un corps qui est à CET endroit ? »* — et la carte y répond seule : un corps posé
   * sur le chapeau d'une mesa ne peut être qu'à +1, la roche ne porte personne à l'étage 0.
   *
   * La règle est celle d'`etageApresLePas` de /sim, mot pour mot : *on garde l'étage qu'on nous
   * donne tant que la tuile le PORTE ; sinon on prend celui qui porte.* Deux écritures d'une même
   * loi finissent toujours par diverger — celle-ci est la même phrase, appliquée au dessin.
   *
   * Depuis les terrasses, « celui qui porte » se lit du relief : le chapeau s'il y en a un, sinon
   * le palier du sol — la hauteur à laquelle la tuile se dessine, et rien d'autre.
   */
  niveauDuCorps(x: number, y: number, etageAutorite: number): number {
    const tx = Math.floor(x)
    const ty = Math.floor(y)
    const pente = this.penteAt(tx, ty)
    if (pente !== undefined) return niveauSurLaRampe(y, pente.bas, pente.haut)
    if (marchableAEtage(this.map, etageAutorite, tx, ty)) return etageAutorite
    return this.relief.hauteur(tx, ty)
  }

  /**
   * ═══ LA PENTE SOUS LES PIEDS — les deux planchers qu'une rampe raccorde, ou rien ═══
   *
   * C'est la couche qui répond, et c'est délibéré : elle est le SEUL endroit du client qui tienne
   * à la fois l'empreinte de l'étage et ses portes, et c'est ELLE qui peint la rampe. La hauteur
   * marchée et la hauteur peinte sortent donc de la même lecture — le contraire de deux dessins
   * du même objet, qui divergent toujours (`cliff-art`, même argument).
   *
   * ⚠ **UNE COLONNE DE FLANC NE MONTE NULLE PART, ET N'INCLINE DONC RIEN.** La rampe fait
   * `CREUX.RAMPE_LARGEUR` tuiles mais seule celle du milieu est élue AU CONTACT du chapeau (voir
   * `zonegen.ts` : *« les flancs n'ont pas à toucher le chapeau »*) — sur la mesa (577..579, 377)
   * de la graine 2026, la colonne 577 a du pierrier au nord, pas de la roche. On y marche tout
   * droit sans jamais monter. Incliner cette colonne-là fabriquerait la téléportation qu'on vient
   * de retirer, à l'envers : le corps s'élèverait le long de la pente puis retomberait d'un coup
   * en la quittant par le nord. On exige donc que le VOISIN NORD soit une tuile de plateau — la
   * pente n'existe que là où elle mène quelque part.
   */
  penteAt(tx: number, ty: number): { bas: number; haut: number } | undefined {
    // ⚠ ON DÉLÈGUE À /sim, on ne recopie pas : la MÊME `rampeQuiMonte` décide de la pente qu'on
    // dessine et du pas qu'on ralentit (`BALANCE.RAMPE_VITESSE`, `moveAvatar`). Deux écritures de
    // cette géométrie, et le corps glisserait à côté de la pente qu'il gravit.
    return rampeQuiMonte(this.map, tx, ty)
  }

  /**
   * `decouvert` — le CENTRE DESSINÉ du joueur et son niveau (spec `etages.md` ; décision d'Alexis
   * du 2026-09-01, « disque de découvert »). Seules les pièces d'un niveau PLUS HAUT que le sien
   * cèdent (`alphaDeDecouvert`) : l'appelant tranche le niveau, la couche ne DÉCIDE rien.
   */
  render(camera: Phaser.Cameras.Scene2D.Camera, decouvert?: Decouvert, dtMs = 0): void {
    let nSol = 0
    let nRampe = 0
    // ── LE SOUTERRAIN PREND TOUTE LA PLACE, ou n'existe pas ────────────────────────────────
    if (this.souterrain) {
      this.rendreLaCave(camera, dtMs)
      for (const im of this.sols) im.setVisible(false)
      for (const im of this.rampes) im.setVisible(false)
      return
    }
    this.roche?.setVisible(false)
    this.veil?.cacher()
    for (const im of this.cave) im.setVisible(false)
    this.gueulesVues.length = 0
    if (this.relief.actif) {
      const v = camera.worldView
      const { width, height } = this.map
      const L = LIFT_TUILES
      const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
      // ⚠ LA MARGE DU SUD PORTE LE LIFT : une tuile de hauteur `h` dessinée `h × LIFT` rangées
      // plus haut est VISIBLE alors que sa position logique est hors cadre. Sans cette marge, le
      // haut du plateau disparaîtrait par le bas de l'écran avant sa propre surface.
      const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
      const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
      const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 1 + this.relief.hauteurMax * L)

      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const porte = this.portes.get(ty * width + tx)
          if (porte !== undefined && porte.type === 'rampe') {
            // ── LA RAMPE : elle n'est pas du sol, elle est ce qui y mène. Elle vit à la position
            //    LOGIQUE (elle part du sol du bas — la tuile du connecteur, au palier BAS) et
            //    monte jusqu'à la surface liftée du haut.
            nRampe = this.poserLaRampe(tx, ty, Math.min(porte.de, porte.vers), nRampe)
            continue
          }
          if (!this.relief.chapeau(tx, ty)) continue
          const p = this.relief.palier(tx, ty)
          const h = p + 1
          const lift = h * L
          // ── LE SOL, SUR TOUTES SES TUILES. C'est le lift qui l'autorise : les rangées sud ne
          //    sont plus sacrifiées à la paroi, puisque la paroi occupe les rangées d'écran que
          //    le décalage vient de libérer. Un corps posé là se tient DESSUS, plus devant.
          const t = terrainAEtage(this.map, h, tx, ty)
          const phase = (((tx % PERIODE_DALLE) + PERIODE_DALLE) % PERIODE_DALLE)
            + PERIODE_DALLE * (((ty % PERIODE_DALLE) + PERIODE_DALLE) % PERIODE_DALLE)
          // ── L'ALPHA DU DÉCOUVERT. La distance se prend au CENTRE DESSINÉ de la tuile
          //    (`ty - lift`), pas à sa position logique : c'est là qu'elle recouvre pour de bon,
          //    et c'est ce recouvrement-là qu'on vient défaire. Le SOL et son LISERÉ cèdent
          //    ensemble — une seule valeur, sinon le pourtour se lirait comme une découpe.
          const a = alphaDeDecouvert(decouvert, tx + 0.5, ty - lift + 0.5, h)
          const cleSol = plateauKey('sol', t, phase)
          // ═══ LE SOCLE — SOUS LA BASE DE L'ÉTAGE, ET SOUS ELLE SEULEMENT ═══
          //
          // *Alexis, 2026-09-01 : « ça ne doit être que la BASE de l'étage qui gêne la vue qui doit
          // être noir ».* Le fondu découvre, au palier du dessous, DEUX choses très différentes, et
          // la première version les traitait pareil :
          //
          //  • sous les `LIFT` rangées les plus au NORD, il y a le vrai sol — le pré que la masse
          //    cachait. Il EST là : on a le droit de le voir, et c'est même tout l'intérêt.
          //  • sous tout le reste, il y a la BASE de la mesa, c'est-à-dire la roche sur laquelle
          //    elle repose. Y voir de l'herbe et des fleurs, c'est regarder l'intérieur d'une masse.
          //
          // La question se pose donc à la tuile du sol qui se DESSINE sous la pièce — celle qui,
          // `LIFT` rangées au nord et au MÊME palier, se lève juste sous elle : `(tx, ty − LIFT)` —
          // et pas au fondu : est-elle, elle aussi, du chapeau ? Alors on bouche, au noir. Sinon
          // on laisse voir. Un seul prédicat, celui qui définit l'étage.
          if (a < 1 && this.relief.chapeau(tx, ty - L) && this.relief.palier(tx, ty - L) === p) {
            nSol = this.poser(this.sols, nSol, cleSol, tx, ty - lift, profondeurDuSocle(h, ty - L), 1, SOCLE_TEINTE)
          }
          nSol = this.poser(this.sols, nSol, cleSol, tx, ty - lift, profondeurDuPlancher(h, ty, TIE_SOL), a, this.teinte)
          // ── LE LISERÉ, sur le POURTOUR : la silhouette du plateau vue d'en bas — là où la
          //    voisine ne monte pas aussi haut (une terrasse du même niveau s'y raccorde sans trait).
          for (const [bit, dx, dy] of [[1, 0, -1], [2, 1, 0], [4, -1, 0]] as const) {
            if (this.relief.hauteur(tx + dx, ty + dy) >= h) continue
            nSol = this.poser(this.sols, nSol, plateauKey('lisere', t, bit), tx, ty - lift, profondeurDuPlancher(h, ty, TIE_LISERE), a, this.teinte)
          }
          // La PAROI sud et son ombre : `cliff-layer`, pour toute tuile plus haute que sa voisine.
        }
      }
      // ── LES GUEULES — UNE PASSE À PART, ET IL LE FAUT ────────────────────────────────────
      //
      // ⚠ La boucle ci-dessus ne pose que les chapeaux et les rampes : **une gueule n'en est
      // pas** (elle appartient au sol et à l'étage du dessous). Rangée là, elle ne se dessinait
      // jamais — la butte restait lisse et la cave était introuvable, vu à la capture. On balaie
      // donc les connecteurs, qui sont quelques dizaines sur toute la carte.
      for (const c of this.portes.values()) {
        if (c.type !== 'gueule') continue
        if (c.x < tx0 || c.x > tx1 || c.y < ty0 - L || c.y > ty1) continue
        const p = this.relief.palier(c.x, c.y)
        this.gueulesVues.push({ tx: c.x, ty: c.y, lift: p * L })
        // Une gueule est une PAIRE de connecteurs (`creuserLaCave`) : l'image de 32 px se pose
        // depuis la tuile OUEST, et la tuile est de la paire ne pose rien.
        if (this.estOuestDeGueule(c.x, c.y)) nRampe = this.poserLaGueule(c.x, c.y, p, nRampe)
      }
    }
    // Le souffle froid sort des gueules qu'on voit — et de rien d'autre, dehors.
    this.fx?.update(dtMs, false, this.tuilesVues, this.gueulesVues, this.lumiere?.ciel ?? 1)
    for (let i = nSol; i < this.sols.length; i++) this.sols[i]!.setVisible(false)
    for (let i = nRampe; i < this.rampes.length; i++) this.rampes[i]!.setVisible(false)
  }

  /** Une tuile de salle (l'étage sous le palier) ? Le hors-carte n'en est pas. */
  private salle = (tx: number, ty: number): boolean => this.relief.salle(tx, ty)

  /** La part du ciel d'une tuile de cave, mémorisée (la loi de /sim, lue une fois par tuile). */
  private cielDe(tx: number, ty: number): number {
    const idx = ty * this.map.width + tx
    const m = this.cielMemo.get(idx)
    if (m !== undefined) return m
    if (this.partDuCielAt === null) return 1
    const c = this.partDuCielAt(tx, ty)
    this.cielMemo.set(idx, c)
    return c
  }

  /**
   * ═══ ON EST DEDANS : LA SALLE, LA ROCHE QUI EFFACE LE DEHORS, ET LA LUMIÈRE QUI LA CREUSE ═══
   *
   * *Alexis, 2026-09-02 : « la grotte doit susciter autant la curiosité que l'inquiétude… le
   * rendu vide doit être époustouflant ».* La première livraison teintait chaque tuile de sa
   * clarté : des carrés gris sur du noir, sans un volume, et une torche qui allumait des TUILES.
   * Une cave n'est pas une grille éclairée, c'est une MASSE dans laquelle on porte un peu de
   * lumière. Tout ici découle de cette phrase, dans l'ordre où l'œil le rencontre :
   *
   * ① **LA ROCHE** — une image tuilée opaque à l'échelle de la vue (`ROCHE_DEPTH`), qui efface
   *    le pré sous la butte. Elle est plus claire qu'avant (la moitié de la pierre, avec ses
   *    plaques et ses fentes) : ce n'est plus le voile qui peint le noir tuile par tuile, c'est
   *    le VOILE ② qui l'éteint d'un bloc — et la torche, en le perçant, révèle la masse autour de
   *    la salle. On voit qu'on est DANS quelque chose.
   * ② **LE VOILE** (`CaveVeil`) — un `MULTIPLY` au-dessus de toute la strate, percé de trous :
   *    le jour à chaque gueule (force = clarté du ciel à cette heure), la torche (portée courte,
   *    battement sur l'alpha), le souffle autour du corps. C'est le patron du voile de nuit, avec
   *    la différence que dit E-R13 : l'obscurité d'une cave est LOCALE, la nuit est horaire.
   * ③ **LE SOL** — de la pierre humide et froide (`cave-art`), plaques, flaques, gravier, pas du
   *    plateau repeint. Et ses SIGNES, rares : des os, un éboulis, une flaque plus large — ce qui
   *    fait qu'une salle vide est un LIEU où quelque chose s'est passé.
   * ④ **LES PAROIS** — la roche au NORD d'une tuile de sol porte une face, comme la falaise porte
   *    la sienne : le même dessin (`dessinDeParoi`), refroidi, avec ses coulures et ses dents.
   *    Les autres côtés, que la projection ne peut pas montrer, se disent par l'OMBRE que la
   *    roche jette sur le sol (`ombre`, E/O/S) : la salle a un creux, pas un contour.
   * ⑤ **LA LÈVRE** — au-dessus du voile : le fil clair du pourtour, ce qui reste d'une salle
   *    quand toute lumière est partie. *Une forme, pas un contenu* — la leçon du liseré, gardée.
   * ⑥ **LA NAPPE DE JOUR** à la gueule, et LE DEHORS vu par le trou — teintés de l'heure. Depuis
   *    le fond, la gueule est une fente de lumière au sud : c'est ce vers quoi on revient.
   * ⑦ **LES LICHENS** — au-dessus du voile, seulement là où `partDuCiel` vaut zéro : une lueur
   *    froide qui n'éclaire rien, et qui respire. Le fond n'est pas vide, il est habité.
   *
   * ⑧ Et ce qui BOUGE (`CaveFx`) : les gouttes, la poussière dans le jour.
   */
  private rendreLaCave(camera: Phaser.Cameras.Scene2D.Camera, dtMs: number): void {
    const v = camera.worldView
    const { width, height } = this.map
    // ① LA ROCHE
    if (this.roche === undefined) {
      // ⚠ **UN `TileSprite`, PAS UN RECTANGLE** : un aplat uni faisait flotter la salle dans le
      // vide (vu à la capture). Ce noir-là n'est pas du vide, c'est la BUTTE vue du dedans, et
      // une masse a du grain. Une seule image tuilée : un objet, une profondeur.
      this.roche = this.scene.add.tileSprite(0, 0, 1, 1, ROCHE_CAVE_KEY).setOrigin(0)
      this.roche.setDepth(ROCHE_DEPTH)
    }
    const rx = v.x - TILE_PX
    const ry = v.y - TILE_PX
    this.roche.setPosition(rx, ry)
    this.roche.setSize(v.width + TILE_PX * 2, v.height + TILE_PX * 2)
    // ⚠ LA TUILE SUIT LE MONDE, PAS L'ÉCRAN : sans ce décalage, le grain GLISSE sous la caméra —
    // la roche nagerait au lieu de tenir en place, et c'est le genre de mouvement qu'on voit sans
    // savoir le nommer.
    this.roche.setTilePosition(rx, ry)
    this.roche.setVisible(true)

    const lum: LumiereDeCave = this.lumiere ?? { ciel: 1, teinteDuJour: 0xffffff, couleurDuJour: 0xffffff, torche: null, joueur: null }
    this.tLueur += Math.min(100, Math.max(0, dtMs)) / 1000
    this.tuilesVues.length = 0
    this.gueulesVues.length = 0
    this.gueulesPx.length = 0

    let n = 0
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    // ⚠ LA MARGE DU SUD PORTE LA PAROI : une tuile de sol hors cadre par le bas a sa paroi deux
    // rangées plus haut, dans le cadre. Sans elle, les murs du bas de l'écran manqueraient.
    // …ET LE LIFT DU PALIER : la salle d'une mesa posée au palier `p` se dessine `p × LIFT`
    // rangées plus haut, comme le corps qui s'y tient (T-R7 — la roche efface tout le reste).
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 1 + (1 + this.relief.hauteurMax) * LIFT_TUILES)
    // `strateDEtage(p − 1, p)` vaut le même nombre pour tout `p` : LA strate du souterrain.
    const strate = strateDEtage(SOUS)
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.salle(tx, ty)) continue
        const p = this.relief.palier(tx, ty)
        const lift = p * LIFT_TUILES
        const t = terrainAEtage(this.map, p + SOUS, tx, ty)
        const tt = TERRAINS_DE_CAVE.includes(t) ? t : TERRAIN_DE_CAVE_DEFAUT
        const phase = (((tx % PERIODE_CAVE) + PERIODE_CAVE) % PERIODE_CAVE)
          + PERIODE_CAVE * (((ty % PERIODE_CAVE) + PERIODE_CAVE) % PERIODE_CAVE)
        const estGueule = this.portes.get(ty * width + tx)?.type === 'gueule'
        const sol = strate + ySortDepth(ty, TILE_PX, TIE_SOL)
        this.tuilesVues.push({ tx, ty, lift })
        // ③ LE SOL, et son signe.
        n = this.poser(this.cave, n, caveKey('sol', tt, phase), tx, ty - lift, sol, 1, 0xffffff)
        if (!estGueule) {
          const hs = hash2(tx, ty, SEL_SIGNE)
          if (hs < SIGNE_PART) {
            const signe = SIGNES_DE_CAVE[Math.floor((hs / SIGNE_PART) * SIGNES_DE_CAVE.length) % SIGNES_DE_CAVE.length]!
            n = this.poser(this.cave, n, caveKey('signe', signe), tx, ty - lift, strate + ySortDepth(ty, TILE_PX, TIE_SIGNE), 1, 0xffffff)
          }
        }
        // ④ LA PAROI, au nord — la roche (tx, ty − 1) montre sa face. Deux rangées si la roche
        //    est épaisse, une seule (arête et pied confondus) si c'est une crête d'une tuile entre
        //    deux salles : la rangée du dessus est alors du sol, et on ne le couvre pas.
        if (!this.salle(tx, ty - 1)) {
          const e = this.salle(tx + 1, ty - 1) ? 2 : 0
          const w = this.salle(tx - 1, ty - 1) ? 4 : 0
          const variant = (((tx % PHASES_PAROI) + PHASES_PAROI) % PHASES_PAROI)
            + PHASES_PAROI * (hash2(tx, ty - 1, SEL_PAROI) < 0.5 ? 0 : 1)
          const dParoi = strate + ySortDepth(ty - 1, TILE_PX, TIE_PAROI)
          if (this.salle(tx, ty - 2)) {
            n = this.poser(this.cave, n, caveKey('paroi', 1 | 8 | e | w, variant % VARIANTES_PAROI), tx, ty - 1 - lift, dParoi, 1, 0xffffff)
          } else {
            n = this.poser(this.cave, n, caveKey('paroi', 1 | e | w, variant % VARIANTES_PAROI), tx, ty - 2 - lift, dParoi, 1, 0xffffff)
            n = this.poser(this.cave, n, caveKey('paroi', 8 | e | w, variant % VARIANTES_PAROI), tx, ty - 1 - lift, dParoi, 1, 0xffffff)
          }
        }
        // ④ L'OMBRE que chaque roche voisine jette sur la tuile, et ⑤ LA LÈVRE au même bord.
        for (const [cote, dx, dy] of [[1, 0, -1], [2, 1, 0], [4, -1, 0], [8, 0, 1]] as const) {
          if (this.salle(tx + dx, ty + dy)) continue
          // Le seuil de la gueule s'ouvre au sud : ni ombre ni lèvre de ce côté-là, c'est le jour.
          if (estGueule && cote === 8) continue
          n = this.poser(this.cave, n, caveKey('ombre', cote), tx, ty - lift, strate + ySortDepth(ty, TILE_PX, TIE_OMBRE), 1, 0xffffff)
          // SOUS LE VOILE, depuis la capture du 2026-09-02 : au-dessus, elle traçait le contour
          // ENTIER de la salle en pleine clarté, à dix tuiles de toute lumière — un plan, pas une
          // cave. Dessous, elle n'existe que là où la lumière atteint : un rebord qui accroche le
          // jour au seuil, la torche autour de soi, et rien du tout dans le noir. Plus forte, en
          // échange : c'est le seul trait dur d'un lieu mou, il doit mordre quand on le voit.
          n = this.poser(this.cave, n, caveKey('levre', cote), tx, ty - lift, strate + ySortDepth(ty, TILE_PX, TIE_LEVRE), LEVRE_ALPHA, 0xffffff)
        }
        // ⑥ LA GUEULE, vue du dedans : la nappe de jour qui remonte vers le nord, et le dehors
        //    par le trou. Les deux prennent la couleur de l'heure — à minuit c'est de la nuit
        //    qu'on voit par la fente, pas du blanc.
        //    La gueule est une PAIRE de tuiles : la nappe, le dehors et le centre de lumière se
        //    posent UNE fois, depuis la tuile ouest, sur 32 px.
        if (estGueule) {
          this.gueulesVues.push({ tx, ty, lift })
          if (this.estOuestDeGueule(tx, ty)) {
            this.gueulesPx.push({ x: (tx + 1) * TILE_PX, y: (ty - lift + 0.5) * TILE_PX })
            n = this.poser(this.cave, n, JOUR_KEY, tx, ty - 2 - lift, strate + ySortDepth(ty, TILE_PX, TIE_JOUR),
              lum.ciel, lum.couleurDuJour, Phaser.BlendModes.SCREEN)
            n = this.poser(this.cave, n, DEHORS_KEY, tx, ty + 1 - lift, ROCHE_DEPTH + 1, 1, lum.couleurDuJour)
          }
        }
        // ⑦ LES LICHENS — là où le ciel n'entre jamais, et là seulement.
        if (!estGueule && this.cielDe(tx, ty) === 0) {
          const hl = hash2(tx, ty, SEL_LUEUR)
          if (hl < LUEUR_PART) {
            const variant = Math.floor((hl / LUEUR_PART) * VARIANTES_LUEUR) % VARIANTES_LUEUR
            const souffle = 0.55 + 0.35 * Math.sin(this.tLueur * 0.9 + hl * 40)
            n = this.poser(this.cave, n, caveKey('lueur', variant), tx, ty - lift, SOUTERRAIN_STRATE - 0.4, souffle, 0xffffff, Phaser.BlendModes.ADD)
          }
        }
      }
    }
    for (let i = n; i < this.cave.length; i++) this.cave[i]!.setVisible(false)
    // ② LE VOILE, et ⑧ ce qui bouge.
    this.veil?.update(lum, this.gueulesPx, camera)
    this.fx?.update(dtMs, true, this.tuilesVues, this.gueulesVues, lum.ciel)
  }

  /**
   * L'ENTAILLE — elle part du SOL DU BAS (la tuile du connecteur, au palier `bas`) et monte
   * jusqu'à la surface liftée. Sa hauteur n'est donc plus celle du mur qu'elle coupe : c'est le
   * LIFT, plus son tablier au sol. `RAMPE_RANGEES` en dérive, et les deux ne peuvent pas diverger.
   * Une rampe de terrasse est la même rampe, levée du palier bas et triée dans sa strate.
   */
  private poserLaRampe(tx: number, ty: number, bas: number, n: number): number {
    const ouest = !this.portes.has(ty * this.map.width + tx - 1)
    const est = !this.portes.has(ty * this.map.width + tx + 1)
    const cotes = (ouest ? 4 : 0) | (est ? 2 : 0)
    const lift = bas * LIFT_TUILES
    const depth = strateDEtage(bas) + CLIFF_DEPTH
    // La nuit, comme les parois (T-R8bis) : au palier 0 le voile la couvre ; levée d'un palier,
    // elle en sort et porte sa nuit elle-même — jugé au NIVEAU, jamais à la profondeur
    // (`CLIFF_DEPTH` est négatif). MESURÉ 2026-09-03 : la rampe 1→2 de la graine 2026 luisait
    // blanche à 0 h entre des parois bleues.
    const teinte = bas >= 1 ? this.teinte : 0xffffff
    for (let rang = 0; rang < RAMPE_RANGEES; rang++) {
      // rang 0 = le haut (contre la surface liftée), le dernier = le tablier sur le sol du bas.
      const y = ty - lift - (RAMPE_RANGEES - 1 - rang)
      n = this.poser(this.rampes, n, plateauKey('rampe', cotes, rang), tx, y, depth, 1, teinte)
    }
    return n
  }

  /**
   * ═══ LA GUEULE — LE SEUL SIGNE, DE DEHORS, QU'UNE BUTTE EST CREUSE ═══
   *
   * ⚠ **SANS ELLE, UNE CAVE EST INTROUVABLE.** La première livraison peignait la salle et la
   * roche, et rien du tout à l'extérieur : la butte restait pleine (E-R1, c'est juste) mais rien
   * ne disait qu'on pouvait y entrer. Un lieu qu'aucun signe n'annonce n'existe pas.
   *
   * La seconde en faisait une fente noire, une tuile de large, à angles droits : une tache. Ce
   * qu'on voit maintenant (`cave-art`, `dessinDeLaGueule`) est une OUVERTURE dans la roche : le
   * linteau qui déborde, la fente qui s'évase vers le bas, une lèvre claire à l'ouest (le jour
   * la frappe) et un noir profond dedans — pas un noir plat : il s'éclaircit vers le bas, là où
   * le seuil prend encore un peu de jour. Au sol, le SEUIL : la tache d'humidité qui sort du
   * trou et quelques cailloux. Et sur les deux tuiles de mur qui l'encadrent, le FLANC : l'ombre
   * que le trou porte sur la paroi, avec ses fissures — c'est ce qui fait de la fente un creux
   * dans une masse et non un rectangle collé dessus.
   *
   * Tout est dans la bande du mur (`CLIFF_DEPTH`), à un cheveu au-dessus de la paroi qu'elle
   * troue : c'est la même roche.
   */
  private poserLaGueule(tx: number, ty: number, palier: number, n: number): number {
    // `tx` est la tuile OUEST de la paire. Les rangées du mur (`ty − lift … ty`) : le trou
    // traverse la paroi entière, linteau compris — en UNE image (32×48), sans couture entre les
    // rangées (voir `dessinDeLaGueuleEntiere`). Les flancs encadrent la paire : à l'ouest de
    // l'ouest, à l'est de l'est. Le tout levé du palier de la butte, dans sa strate.
    const yl = ty - palier * LIFT_TUILES
    const depth = strateDEtage(palier) + CLIFF_DEPTH
    const teinte = palier >= 1 ? this.teinte : 0xffffff // même règle que la rampe : la nuit au niveau
    n = this.poser(this.rampes, n, GUEULE_KEY, tx, yl - LIFT_TUILES, depth + 0.01, 1, teinte)
    for (let k = 0; k < LIFT_TUILES; k++) {
      n = this.poser(this.rampes, n, caveKey('flanc', 4), tx - 1, yl - LIFT_TUILES + k, depth + 0.015, 1, teinte)
      n = this.poser(this.rampes, n, caveKey('flanc', 2), tx + 2, yl - LIFT_TUILES + k, depth + 0.015, 1, teinte)
    }
    return n
  }

  /** La tuile OUEST d'une paire de gueule : celle dont la voisine de gauche n'en est pas une.
   *  (Une gueule isolée — carte d'avant la paire — se pose aussi depuis elle-même.) */
  private estOuestDeGueule(tx: number, ty: number): boolean {
    return this.portes.get(ty * this.map.width + tx - 1)?.type !== 'gueule'
  }

  private poser(
    pool: Phaser.GameObjects.Image[], n: number, key: string, tx: number, ty: number,
    depth: number, alpha: number, teinte: number, blend: number = Phaser.BlendModes.NORMAL,
  ): number {
    let img = pool[n]
    if (!img) {
      img = epinglerLaTuile(this.scene.add.image(0, 0, key).setOrigin(0).setDepth(depth))
      pool[n] = img
    }
    img.setTexture(key)
    // Le mode de fondu aussi : le même emplacement sert un sol (NORMAL), une nappe (SCREEN) et
    // un lichen (ADD) d'une image à l'autre.
    img.setBlendMode(blend)
    // ⚠ ALPHA ET TEINTE SE REPOSENT À CHAQUE FRAME, pour la raison exacte que la profondeur ci-
    // dessous : un emplacement du pool change de rôle d'une image à l'autre. Posés une fois, on
    // aurait des tuiles fantômes qui se PROMÈNENT sur le plateau au fil de la caméra — et une
    // couche entière restée en nuit à midi. Invisible en test, visible en jeu.
    img.setAlpha(alpha)
    img.setTint(teinte)
    // ⚠ LA PROFONDEUR SE REPOSE À CHAQUE FRAME, et il le faut : le même pool sert le SOL (+0,33)
    // et son LISERÉ (+0,335), et un emplacement change de rôle d'une frame à l'autre selon ce que
    // la vue contient. La poser à la création seulement, c'est un liseré qui passe sous son sol
    // dès qu'on bouge la caméra — invisible en test, visible en jeu.
    img.setDepth(depth)
    img.setPosition(tx * TILE_PX, ty * TILE_PX)
    img.setVisible(true)
    return n + 1
  }

  destroy(): void {
    for (const s of this.sols) s.destroy()
    for (const s of this.rampes) s.destroy()
    for (const s of this.cave) s.destroy()
    this.roche?.destroy()
    this.veil?.destroy()
    this.fx?.destroy()
  }
}
