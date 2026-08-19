/**
 * LE PAYSAGE GELÉ — la neige au sol (G7) et la glace (G5), peintes.
 *
 * La spec `gel.md` a été livrée côté sim et **rien ne se voyait** : un monde qui change
 * d'état sans qu'on le voie ne change pas d'état. Voici ce qui se voit.
 *
 * ═══ LE CLIENT NE DÉCIDE RIEN — IL RELIT ═══
 *
 * `neigeAuSol(state, tx, ty)` et `estGele(state, tx, ty)` sont les fonctions de `/sim`,
 * appelées telles quelles. Il n'y a PAS de seconde loi ici : pas de « et si la température
 * est basse alors », pas de mémoire client, pas un octet d'état. Ce que la glace autorise
 * (marcher dessus) et ce que cette couche peint sont **le même appel**. Le `SimState` que
 * les fonctions attendent est reconstitué par `etat-gel.ts`, qui nomme aussi les champs que
 * le snapshot ne porte pas (`brume` — un trou déclaré, pas un oubli).
 *
 * ═══ POURQUOI UNE COUCHE À PART, ET PAS LE SHADER DE L'EAU ═══
 *
 * L'eau est un shader plein-monde dont les quatre samplers sont cuits UNE fois au boot et
 * jamais reconstruits. Y injecter le gel demanderait soit un uniforme par tuile (impossible),
 * soit de recuire `uField` (une texture de la taille de la carte, sous swiftshader). Et
 * surtout : ce shader est la pièce la plus fragile du rendu sur cette machine — un post-FX
 * rend blanc ici, et personne ne veut découvrir ce qu'un cinquième sampler fait. On peint
 * donc PAR-DESSUS, ce qui a l'avantage de rendre la glace et la neige d'un seul geste : ce
 * sont deux états d'une même tuile, ils se disputeraient le même pixel de toute façon.
 *
 * ═══ COMMENT C'EST QUANTIFIÉ (et pourquoi pas un aplat par tuile) ═══
 *
 * On cuit une texture à **`SUB` = 4 pixels par tuile** — soit exactement la grille de 4 px
 * MONDE, le grain de l'art —, posée sur la FENÊTRE VISIBLE et étirée en NEAREST. Chaque
 * pixel de cette texture est donc une cellule de 4 px du monde, et il est PLEIN ou VIDE :
 * bords francs, jamais un dégradé.
 *
 * Un aplat par tuile aurait été plus simple et aurait lu comme un damier : la couverture est
 * un nombre continu dans [0,1], et une tuile à 0,4 doit se lire « à moitié blanche », pas
 * « blanche à 40 % d'opacité ». On TRAME donc : la couverture décide COMBIEN des 16 cellules
 * de la tuile sont blanches, et un hash stable par cellule décide LESQUELLES. D'où trois
 * propriétés qu'un aplat n'aurait pas :
 *
 *   • la silhouette du terrain reste lisible dessous — l'herbe, la roche et la route passent
 *     par les trous, et on voit encore SUR QUOI la neige est tombée (c'est la demande) ;
 *   • la lisière du front se lit comme une vraie lisière, mouchetée, et pas comme une marche ;
 *   • ça reste du pixel art : des carrés de 4 px, pleins, sur la grille de l'art.
 *
 * L'ordre de remplissage vient d'un hash par cellule (`ordreDeCellule`), stable dans le
 * temps et dans l'espace : une tuile ne re-tire jamais son motif, donc la neige ne
 * scintille pas d'une recuisson à l'autre — le piège classique d'une trame aléatoire.
 *
 * ═══ LA GLACE SE VOIT D'UN COUP D'ŒIL (G5) ═══
 *
 * C'est une promesse de la spec, pas un ornement : « on ne s'engage jamais sur la glace par
 * surprise ». La glace est donc PLEINE (les 16 cellules), pas tramée — on ne voit pas l'eau
 * à travers —, et les deux profondeurs ne portent pas la même teinte :
 *
 *   • le GUÉ gelé est blanc-bleuté clair : sous lui, il y avait un fond qu'on voyait ;
 *   • le LAC gelé est plus SOMBRE et plus bleu : c'est de la glace sur du noir, et c'est
 *     elle qui vaut une décision (elle rend praticable ce qui bloquait).
 *
 * Les deux portent une MOUCHETURE claire (givre, fractures) tirée du même hash : sans elle,
 * un aplat parfait lit « trou dans le rendu » plutôt que « surface gelée ».
 *
 * ═══ CE QUE ÇA COÛTE, ET COMMENT ON LE SAIT ═══
 *
 * `estGele` appelle `baselineTemperature`, qui appelle `isSheltered`, qui BALAIE
 * `state.structures` — O(structures) par tuile. Et `neigeAuSol` rembobine trois cycles.
 * On ne recuit donc pas à chaque image : seulement quand la caméra a bougé d'au moins une
 * tuile, ou quand assez de ticks ont passé. Le chronomètre est DANS la couche
 * (`sonde.msRecuisson`), comme celui de `meteo-layer` — sur cette machine le compte d'images
 * ne mesure pas le rendu (un ciel NU relevé à 937 ms/image), seul le temps passé ici est
 * lisible sous charge.
 *
 * `gelPossible(state)` est la porte d'entrée : fausse (tout l'acte I, l'essentiel de
 * l'acte II), il n'y a pas une tuile à interroger — on éteint la couche et on sort en O(1).
 * Mais elle ne garde QUE la glace : la neige au sol, elle, peut survivre à un redoux, donc
 * `neigeAuSol` est interrogée même quand plus rien ne gèle.
 */
import Phaser from 'phaser'
import {
  TERRAIN_DEEP_WATER,
  TERRAIN_SHALLOW_WATER,
  estGele,
  gelPossible,
  neigeAuSol,
  terrainAt,
  type SimState,
  type WorldMap,
} from '@ashes/sim'
import { GROUND_MAP_DEPTH, TILE_PX } from '../../render/framing'

/**
 * LE GRAIN — 4 px monde, la grille des FX de l'art. `SUB` en découle : combien de cellules
 * par côté de tuile, donc la résolution de la texture cuite.
 */
export const GRAIN_PX = 4
export const SUB = TILE_PX / GRAIN_PX // 4

/**
 * AU-DESSUS DE L'EAU ET DE LA CENDRE, sous les feuilles à la dérive.
 *
 * Le créneau est encombré : l'eau ET la cendre sont toutes deux à `GROUND_MAP_DEPTH + 0,25`,
 * départagées par leur seul ordre de création — on ne rajoute pas un troisième client à cette
 * ambiguïté. `+0,3` est donc franc, et il porte DEUX conséquences voulues :
 *   • la neige recouvre la cendre (un pré brûlé sous la neige est blanc, pas noir) ;
 *   • la glace recouvre l'eau, donc l'eau gelée ne miroite plus — c'est ce qui la nomme.
 * Les feuilles à la dérive (+0,32) restent au-dessus : elles flottent sur l'eau LIBRE, et
 * là où la glace a pris, elles se posent dessus sans que ça choque.
 */
export const GEL_DEPTH = GROUND_MAP_DEPTH + 0.3

/**
 * LA MARGE DE LA FENÊTRE CUITE, en tuiles. Le monde bouge sous la caméra entre deux
 * recuissons : sans marge, un bord de neige apparaîtrait au ras de l'écran à chaque pas.
 * Deux tuiles couvrent le seuil de recuisson (une tuile) avec de quoi ne pas clignoter.
 */
const MARGE_TUILES = 2

/** On ne recuit pas pour un pixel : la caméra doit avoir franchi au moins ça, en tuiles. */
const PAS_CAMERA_TUILES = 1

/**
 * … OU assez de ticks : la neige fond et la glace prend AVEC LE TEMPS, caméra immobile.
 * `FONTE_CYCLES` vaut 3 cycles (172 800 ticks) pour passer de 1 à 0 : 400 ticks font donc
 * au pire 0,23 % de couverture, très en dessous d'une marche de trame (1/16 = 6 %). On ne
 * peut pas voir la neige sauter, et on recuit vingt fois par minute de jeu au lieu de
 * soixante fois par seconde.
 */
const PAS_TICKS = 400

/** Les crans de couverture — la trame en a `SUB²` + 1 par construction (0 à 16 cellules). */
const CELLULES_PAR_TUILE = SUB * SUB

/** En dessous, on ne peint rien : une cellule sur seize n'est pas de la neige, c'est du bruit. */
const COUVERTURE_MIN = 1 / CELLULES_PAR_TUILE

/**
 * COMBIEN DE CELLULES LA NEIGE PEUT PRENDRE **SUR DE LA GLACE**, au plus.
 *
 * ═══ C'EST UNE RÈGLE DE LISIBILITÉ, ET ELLE A UNE CONSÉQUENCE DE JEU ═══
 *
 * MESURÉ, et c'est ce qui l'a imposée : de nuit en acte III (jour 59, `smoke --scenario
 * enneige`), la couverture de neige monte à **0,93 de moyenne** — 15 cellules sur 16. Le lac
 * gelé disparaissait donc SOUS la neige et devenait rigoureusement indiscernable du pré : on
 * ne voyait plus où était l'eau. Or c'est exactement l'heure où le lac est PRATICABLE
 * (`SEUIL_PROFOND` ne mord que la nuit), donc l'heure où il faut le voir.
 *
 * G5 est une promesse de la spec — « on ne s'engage jamais sur la glace par surprise » —, et
 * elle vaut dans les DEUX sens : ne pas marcher sur la glace sans le savoir, et ne pas rater
 * le raccourci qu'elle ouvre. La neige ne prend donc jamais plus de la moitié d'une tuile de
 * glace. Le prétexte physique existe (la glace est balayée par le vent, elle garde mal la
 * neige) mais ce n'est pas la raison : la raison est qu'on doit LIRE la carte.
 *
 * CE QU'IL FAUT DIRE À ALEXIS : c'est un choix de rendu qui change ce qu'on voit venir. Une
 * rivière gelée reste dessinée comme une rivière au lieu de se fondre dans la plaine — la
 * vallée garde donc son relief lisible même sous le Grand Froid, alors qu'un manteau uniforme
 * l'aurait effacé. Si l'effacement était voulu (une vallée que la neige rend méconnaissable),
 * c'est ce plafond qu'il faut lever, et lui seul.
 */
const NEIGE_SUR_GLACE_MAX = CELLULES_PAR_TUILE / 2

/**
 * L'ORDRE DE REMPLISSAGE D'UNE CELLULE dans sa tuile — un rang stable dans `[0, 16)`.
 *
 * C'est ce qui fait que la neige TIENT en place : la cellule de rang 3 blanchit dès que la
 * couverture dépasse 3/16 et ne re-noircit qu'en repassant dessous. Rien ne scintille, parce
 * que rien n'est tiré au sort à l'exécution — c'est un hash de la position, pas un PRNG.
 *
 * Le hash est celui de la maison (entier, `Math.imul`, pas de transcendante) ; il vit ICI et
 * pas dans `/sim` parce qu'il ne décide d'aucune règle : c'est du grain, pas de la loi.
 */
export function ordreDeCellule(cx: number, cy: number): number {
  let h = Math.imul(cx | 0, 0x27d4_eb2d) ^ Math.imul(cy | 0, 0x1656_67b1)
  h = Math.imul(h ^ (h >>> 15), 0x2545_f491)
  h ^= h >>> 13
  return (h >>> 0) % CELLULES_PAR_TUILE
}

/** Le motif de givre de la glace : une cellule sur cinq, stable, tirée du même hash. */
function givre(cx: number, cy: number): boolean {
  return ordreDeCellule(cx + 7919, cy + 104_729) < 3
}

/** Une couleur RGBA, en canaux 0-255. */
type Teinte = readonly [number, number, number, number]

/**
 * LES QUATRE MATIÈRES. Elles sont ici, en clair, parce que c'est de la DA — pas de
 * l'équilibrage : on les règle en REGARDANT, jamais en jouant (la ligne de partage de
 * l'en-tête de `balance.ts`).
 */
/**
 * La neige : blanche à peine bleutée, opaque à 91 %.
 *
 * ELLE A ÉTÉ MONTÉE DE 82 À 91 % SUR PHOTO. À 82 % sur de l'herbe d'acte III, le sol rendait
 * (211, 225, 220) — pâle, mais pas blanc : ça lisait « pré givré », pas « pré sous la neige ».
 * Ce qui reste de transparence n'est PAS ce qui laisse voir le terrain — c'est la TRAME qui
 * s'en charge, et elle le fait mieux (des trous francs plutôt qu'un voile). L'opacité peut
 * donc monter sans rien perdre de la lisibilité du sol.
 */
const NEIGE: Teinte = [244, 248, 255, 232]
/** Le gué gelé : bleu clair — nettement plus BLEU que la neige, qui est à côté et par-dessus.
 *  Un blanc-bleuté trop pâle se confondait avec elle sur la berge, et c'est justement là
 *  qu'il faut distinguer « on marche » de « on glisse ». */
const GLACE_GUE: Teinte = [168, 205, 228, 244]
/** Le lac gelé : nettement plus sombre et plus bleu — de la glace sur du noir. C'est CELLE-CI
 *  qui vaut une décision de jeu (elle rend praticable ce qui bloquait) : elle doit se
 *  distinguer du gué autant que de l'eau libre. */
const GLACE_LAC: Teinte = [112, 152, 190, 250]
/** Le givre / la fracture : le rehaut clair posé sur les deux glaces. */
const GIVRE: Teinte = [232, 245, 252, 255]

export class GelLayer {
  private img: Phaser.GameObjects.Image | null = null
  private readonly cle: string
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private data: ImageData | null = null
  /** La fenêtre CUITE, en tuiles (bornes incluses côté bas, exclues côté haut). */
  private tx0 = 0
  private ty0 = 0
  private tw = 0
  private th = 0
  private dernierTick = -Infinity
  private dernierCamTx = Infinity
  private dernierCamTy = Infinity
  /**
   * LA PHASE DU CYCLE de la dernière recuisson.
   *
   * ELLE EST INDISPENSABLE, ET ÇA S'EST VU : `debug_set_hour` déplace `cycleOffset` SANS
   * toucher au tick — c'est tout son intérêt (viser une heure sans bouger le calendrier).
   * Un seuil qui ne regarde que le tick et la caméra ne voit donc RIEN passer, et la couche
   * a rendu deux relevés rigoureusement identiques à midi et à une heure du matin, alors que
   * le lac gèle entre les deux (`SEUIL_PROFOND` ne mord que la nuit en acte III). Ce n'est
   * pas un artefact de debug : le passage de l'heure est ce qui fait geler la vallée.
   */
  private dernierOffset = Number.NaN

  /**
   * LA SONDE — lue par le smoke, par rien d'autre. `tuilesNeige` et `tuilesGlace` disent ce
   * que la couche a VRAIMENT peint : une capture qui ne montre rien et une couche qui n'a
   * rien à montrer sont deux pannes différentes, et il faut pouvoir les séparer.
   */
  readonly sonde = {
    actif: false,
    gelPossible: false,
    tuilesBalayees: 0,
    tuilesNeige: 0,
    tuilesGlace: 0,
    tuilesGlaceProfonde: 0,
    couvertureMax: 0,
    couvertureMoyenne: 0,
    recuissons: 0,
    /** Ce que la dernière recuisson a pris sur le fil principal, en ms. */
    msRecuisson: 0,
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: WorldMap,
    suffixe = '',
  ) {
    this.cle = `gel-${map.width}-${suffixe}`
  }

  /**
   * Chaque frame — mais ne recuit que si la caméra a bougé d'une tuile ou si `PAS_TICKS`
   * ticks ont passé. `etat` est la façade de `etat-gel.ts` ; `tick` en vient aussi, il est
   * passé à part pour que le seuil de recuisson ne dépende pas d'un champ caché.
   */
  update(etat: SimState | null, tick: number, camera: Phaser.Cameras.Scene2D.Camera): void {
    if (!etat) { this.eteindre(); return }
    const vue = camera.worldView
    const camTx = Math.floor(vue.x / TILE_PX)
    const camTy = Math.floor(vue.y / TILE_PX)
    const bougee = Math.abs(camTx - this.dernierCamTx) >= PAS_CAMERA_TUILES
      || Math.abs(camTy - this.dernierCamTy) >= PAS_CAMERA_TUILES
    const vieilli = Math.abs(tick - this.dernierTick) >= PAS_TICKS
    const offset = (etat as unknown as { cycleOffset: number }).cycleOffset
    const rephasee = offset !== this.dernierOffset
    if (!bougee && !vieilli && !rephasee) return
    this.dernierCamTx = camTx
    this.dernierCamTy = camTy
    this.dernierTick = tick
    this.dernierOffset = offset
    this.recuire(etat, vue)
  }

  private recuire(etat: SimState, vue: Phaser.Geom.Rectangle): void {
    const t0 = performance.now()
    const tx0 = Math.max(0, Math.floor(vue.x / TILE_PX) - MARGE_TUILES)
    const ty0 = Math.max(0, Math.floor(vue.y / TILE_PX) - MARGE_TUILES)
    const tx1 = Math.min(this.map.width, Math.ceil((vue.x + vue.width) / TILE_PX) + MARGE_TUILES)
    const ty1 = Math.min(this.map.height, Math.ceil((vue.y + vue.height) / TILE_PX) + MARGE_TUILES)
    const tw = tx1 - tx0
    const th = ty1 - ty0
    if (tw <= 0 || th <= 0) { this.eteindre(); return }

    const glacePossible = gelPossible(etat)
    this.assurerCanvas(tw, th)
    const data = this.data!
    const px = data.data
    px.fill(0)

    let tuilesNeige = 0
    let tuilesGlace = 0
    let tuilesGlaceProfonde = 0
    let couvertureMax = 0
    let sommeCouverture = 0
    const largeurPx = tw * SUB

    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const terrain = terrainAt(this.map, tx, ty)
        const eau = terrain === TERRAIN_SHALLOW_WATER || terrain === TERRAIN_DEEP_WATER
        // LA GLACE D'ABORD : une eau gelée est de la glace, pas de l'eau enneigée — et la
        // neige, elle, se pose DESSUS (voir plus bas). Une eau LIBRE ne porte jamais de
        // neige : un flocon qui tombe dedans fond, c'est tout ce que ça veut dire.
        const gelee = eau && glacePossible && estGele(etat, tx, ty)
        if (eau && !gelee) continue

        const couverture = neigeAuSol(etat, tx, ty)
        if (couverture > couvertureMax) couvertureMax = couverture
        sommeCouverture += couverture
        if (!gelee && couverture < COUVERTURE_MIN) continue

        if (gelee) {
          tuilesGlace++
          if (terrain === TERRAIN_DEEP_WATER) tuilesGlaceProfonde++
        }
        if (couverture >= COUVERTURE_MIN) tuilesNeige++

        // Combien de cellules blanchissent : la couverture, quantifiée sur les 16 crans de
        // la trame. Jamais une opacité continue — c'est la règle, et c'est ce qui laisse la
        // silhouette du terrain lisible dessous.
        const cellules = gelee
          ? Math.min(NEIGE_SUR_GLACE_MAX, Math.round(couverture * CELLULES_PAR_TUILE))
          : Math.round(couverture * CELLULES_PAR_TUILE)
        const glace = terrain === TERRAIN_DEEP_WATER ? GLACE_LAC : GLACE_GUE
        const bx = (tx - tx0) * SUB
        const by = (ty - ty0) * SUB
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const cx = tx * SUB + sx
            const cy = ty * SUB + sy
            let teinte: Teinte | null = null
            if (gelee) teinte = givre(cx, cy) ? GIVRE : glace
            // La neige se pose SUR la glace comme sur la terre : la trame la recouvre là où
            // elle a des cellules. Une berge gelée sous la neige est blanche au bord et
            // bleue au milieu — c'est exactement ce qu'on veut voir.
            if (ordreDeCellule(cx, cy) < cellules) teinte = NEIGE
            if (!teinte) continue
            const o = ((by + sy) * largeurPx + bx + sx) * 4
            px[o] = teinte[0]
            px[o + 1] = teinte[1]
            px[o + 2] = teinte[2]
            px[o + 3] = teinte[3]
          }
        }
      }
    }

    this.ctx!.putImageData(data, 0, 0)
    this.poser(tx0, ty0, tw, th)

    this.sonde.actif = tuilesNeige > 0 || tuilesGlace > 0
    this.sonde.gelPossible = glacePossible
    this.sonde.tuilesBalayees = tw * th
    this.sonde.tuilesNeige = tuilesNeige
    this.sonde.tuilesGlace = tuilesGlace
    this.sonde.tuilesGlaceProfonde = tuilesGlaceProfonde
    this.sonde.couvertureMax = couvertureMax
    this.sonde.couvertureMoyenne = sommeCouverture / Math.max(1, tw * th)
    this.sonde.recuissons++
    this.sonde.msRecuisson = performance.now() - t0
  }

  /** (Re)fabrique le canvas et sa texture quand la fenêtre change de TAILLE seulement. */
  private assurerCanvas(tw: number, th: number): void {
    if (this.canvas && this.tw === tw && this.th === th) return
    this.tw = tw
    this.th = th
    if (this.scene.textures.exists(this.cle)) this.scene.textures.remove(this.cle)
    const tex = this.scene.textures.createCanvas(this.cle, tw * SUB, th * SUB)
    if (!tex) return
    this.canvas = tex.getSourceImage() as HTMLCanvasElement
    this.ctx = tex.getContext()
    this.data = this.ctx.createImageData(tw * SUB, th * SUB)
    this.img?.destroy()
    this.img = null
  }

  private poser(tx0: number, ty0: number, tw: number, th: number): void {
    this.tx0 = tx0
    this.ty0 = ty0
    if (!this.img) {
      this.img = this.scene.add.image(0, 0, this.cle).setOrigin(0, 0).setDepth(GEL_DEPTH)
    }
    this.img
      .setPosition(tx0 * TILE_PX, ty0 * TILE_PX)
      .setDisplaySize(tw * TILE_PX, th * TILE_PX)
      .setVisible(true)
    const tex = this.scene.textures.get(this.cle)
    if ('refresh' in tex && typeof tex.refresh === 'function') tex.refresh()
    // ── NEAREST, ET APRÈS LE `refresh`, PAS AVANT ──────────────────────────────────────
    //
    // La neige a une ARÊTE. Un filtrage bilinéaire fait de la trame un dégradé, c'est-à-dire
    // exactement ce que la DA interdit — et il l'avait fait : au plan rapproché (zoom 6), les
    // cellules de 4 px sortaient FLOUES, avec des transitions douces entre la neige, la glace
    // et l'eau. Le filtre était pourtant posé… à la CRÉATION du canvas. `refresh()` réenvoie
    // la source à la GPU et lui rend son mode d'échelle par défaut, si bien que chaque
    // recuisson défaisait le réglage. On le repose donc APRÈS, à chaque fois : c'est une
    // ligne, et c'est la différence entre du pixel art et une aquarelle.
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
  }

  private eteindre(): void {
    this.img?.setVisible(false)
    this.sonde.actif = false
    this.sonde.tuilesNeige = 0
    this.sonde.tuilesGlace = 0
    this.sonde.tuilesGlaceProfonde = 0
  }

  destroy(): void {
    this.img?.destroy()
    this.img = null
    if (this.scene.textures.exists(this.cle)) this.scene.textures.remove(this.cle)
  }
}
