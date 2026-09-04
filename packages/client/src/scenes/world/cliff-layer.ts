/**
 * LA COUCHE DES FALAISES — le dessus d'ardoise, les parois de face, et leur ombre au pied.
 *
 * Le sol est cuit à 1 px/tuile : aucun détail ne peut y vivre. Les falaises sont donc des sprites,
 * posés chaque frame sur la fenêtre visible (~900 tuiles), depuis un pool réutilisé — le même
 * régime que les nœuds et le décor. Coût borné à la vue, jamais à la carte.
 *
 * Depuis le 2026-08-31 (décision d'Alexis, proposition « P2 · la marche ») la falaise n'est plus
 * plate : les deux dernières rangées SUD d'une masse se dressent en PAROI, et le reste garde le
 * dessus vu du ciel. Tout se lit du terrain (`roleDeFalaise`) — cette couche ne décide rien, elle
 * n'a même pas besoin de savoir combien de rangées la masse compte.
 *
 * Le hors-carte compte comme falaise : l'anneau de bordure en est, le bord du monde se peint donc
 * en roche comme le reste — et surtout, la dernière rangée du monde ne se dresse pas en paroi
 * devant le vide.
 *
 * ═══ LA ROCHE DE LISIÈRE EN EST AUSSI — décision d'Alexis, 2026-08-31 ═══
 *
 * *« je ne vois pas de falaise ingame »*, et il avait raison : MESURÉ sur le monde joué, la lisière
 * du pays est faite à **77 % d'eau profonde et à 23 % de roche — 0 % de falaise**. Les 57 816
 * tuiles de `TERRAIN_CLIFF` du monde réduit ne touchent PAS une seule tuile marchable ; le mur
 * qu'on longe vraiment, c'est le VIDE inter-régions, que la passe 1a peint en `TERRAIN_ROCK`. La
 * falaise n'était donc au rendez-vous nulle part.
 *
 * La roche prend donc la même grammaire : dessus, paroi, ombre, dans l'ardoise — *« le squelette
 * doit se reconnaître PARTOUT au premier regard »*. Rien à changer dans `/sim` : ces masses font
 * déjà douze tuiles d'épaisseur (MESURÉ), et 1 424 de leurs bords sont tournés au sud.
 *
 * ⚠ **UNE MASSE, PAS UN CAILLOU.** La roche sert AUSSI d'accent semé dans cinq palettes de zone
 * (Karst, Cendrière, Glacier, Aiguilles, Gouffre — 2 à 3 % de leurs tuiles). Dresser un bloc isolé
 * en falaise ferait un caillou à liseré, pas un mur. On n'habille donc que ce qui a de quoi se
 * dresser : une colonne de roche d'au moins `PAROI_RANGEES + 1` tuiles. En dessous, le sol garde
 * son aplat — c'est un caillou, et il en a l'air.
 *
 * ═══ LA PAROI DE TERRASSE, ET CELLE DE LA MESA : UNE SEULE PAROI (spec `terrasses.md`, T-R8) ═══
 *
 * Depuis les terrasses, le sol lui-même a des PALIERS, et chaque tuile se dessine à sa HAUTEUR
 * (`Relief.hauteur` = palier + chapeau de mesa), `LIFT_TUILES` rangées plus haut par cran. Entre
 * une tuile de hauteur `h` et sa voisine SUD de hauteur `hs < h`, il y a `(h − hs) × LIFT_TUILES`
 * rangées d'écran que rien ne peint : c'est LA PAROI, tirée du même `cliff-art` que la roche.
 * Elle vivait dans `etage-layer` pour la seule mesa ; elle est ici depuis que le pré en a aussi,
 * et une seule écriture sert les deux — deux dessins d'un même mur divergent toujours.
 *
 * ⚠ **CHAQUE BANDE DE LA PAROI TRIE DANS SA STRATE.** La bande `j` (`hs ≤ j < h`) couvre les
 * rangées d'écran de la tuile `ty` vue depuis le palier `j` : elle se peint dans `strateDEtage(j)`
 * (+ `CLIFF_DEPTH`, sous les corps de ce palier), et pas dans celle du haut — montée là-haut, elle
 * avalerait le corps collé à son pied ; restée en bas, un corps du palier intermédiaire passerait
 * devant une paroi qui est derrière lui. C'est la correction de T-R8 (« à la strate de p »).
 *
 * ═══ LA CASCADE — la paroi cède la place à l'eau (T-A9, décision d'Alexis du 2026-09-04) ═══
 *
 * Là où la tuile haute ET la tuile du pied sont de l'eau, à UN cran d'écart (T-A3), ce n'est pas
 * de la roche qui sépare les deux nappes : c'est la chute. La colonne prend alors les sprites de
 * `chute-art` — la nappe qui tombe, AU PAS DE TEMPS du shader d'eau (`CHUTE_HZ`) — et son pied
 * reçoit l'écume au lieu de l'ombre portée. La couche ne fait que POSER ; ce qui vit au pied
 * (les gouttes, la brume, la lueur) est à `cascade-fx`, qui relit `chutes` après chaque rendu.
 */
import type Phaser from 'phaser'
import { hash2, TERRAIN_CLIFF, TERRAIN_ROCK, type Connecteur, type WorldMap } from '@ashes/sim'
import { CHUTE_FRAMES, CHUTE_HZ, CHUTE_PHASES, ECUME_FRAMES } from '../../render/chute-art'
import { cliffKey, levreDe, PAROI_RANGEES, PHASES_PAROI, roleDeFalaise, varianteDeChute, varianteDEcume, varianteDeLevre, VARIANTES_DESSUS } from '../../render/cliff-art'
import { CLIFF_DEPTH, CLIFF_OMBRE_DEPTH, LIFT_TUILES, strateDEtage, TILE_PX } from '../../render/framing'
import { cranDeDerive } from '../../render/ombre-socle'
import { estEau } from '../../render/paves'
import type { Relief } from '../../render/relief'
import { epinglerLaTuile } from '../../render/tuile-epinglee'


/** Une chute VISIBLE à cette image : la tuile haute `(tx, ty)`, le palier `hs` de l'eau du pied
 *  `(tx, ty + 1)` — ce que `cascade-fx` habille. */
export interface ChuteVue {
  tx: number
  ty: number
  hs: number
}

export class CliffLayer {
  private tops: Phaser.GameObjects.Image[] = []
  private ombres: Phaser.GameObjects.Image[] = []
  /** Les chutes posées au dernier `render` — vidé et rempli à chaque image, dans l'ordre de balayage. */
  readonly chutes: ChuteVue[] = []
  /** Les rampes par tuile (`y * width + x`) : une paroi ne se peint pas là où une rampe l'entaille. */
  private readonly rampes = new Map<number, Connecteur>()
  /**
   * LA NUIT DES PALIERS HAUTS. Le voile de nuit éclairé ne couvre que la bande du sol
   * (`AMBIENT_DEPTH_LIT`) ; une paroi ou un dessus posé dans une strate ≥ 1 lui échappe. La couche
   * porte donc sa nuit ELLE-MÊME, par une teinte plate sur ce qui se pose au-dessus de la strate 0
   * — la même que la scène pousse aux pavés et au chapeau de mesa (`PaveLayer.teinte`,
   * `EtageLayer.teinte`), donc la même nuit d'un palier à l'autre. Blanc = jour.
   *
   * ⚠ **« AU-DESSUS DE LA STRATE 0 » SE LIT AU NIVEAU, PAS À LA PROFONDEUR.** `CLIFF_DEPTH` est
   * NÉGATIF (la paroi est tout en bas de sa strate, sous son sol) : `strateDEtage(1) + CLIFF_DEPTH`
   * vaut 99 999,32 — dans la strate 0 pour `floor`, et sous `ETAGE_STRATE` pour un `>=`. Jugée à la
   * profondeur, aucune paroi n'a jamais pris la nuit (MESURÉ, `smoke --scenario terrasses`, 2026-09-03 :
   * 100 % des sprites de falaise à `ffffff` à 1 h du matin, teinte `55598e` posée ; les parois 2→1
   * d'un lac luisaient en plein jour dans une nuit bleue). Le niveau de la bande est ce que sait
   * l'appelant — c'est lui qu'on passe.
   */
  teinte = 0xffffff
  /**
   * L'ASTRE QUI JETTE L'OMBRE — les deux mêmes nombres que les socles minéraux reçoivent
   * (`view.deriveOmbre`/`view.forceOmbre`), poussés par `WorldScene` depuis la MÊME ligne, à la
   * même heure. `force` est l'alpha du pied et du flanc : 1 à midi comme sous la pleine lune,
   * 0 au crépuscule et à la nouvelle lune — l'ombre s'éteint avec ce qui la jette, exactement
   * comme la coulée d'un rocher (`forceDeLOmbre`). `derive` choisit le FLANC : négative (l'astre
   * à l'est, le matin) l'ombre part à l'ouest, positive (le soir) à l'est, et sa largeur suit
   * le cran (`cranDeDerive`, le même que le cisaillement des socles) — au zénith, aucun flanc.
   * Sans snapshot : plein, centré — le rendu d'avant, flanc compris.
   */
  forceOmbre = 1
  deriveOmbre = 0

  constructor(
    private scene: Phaser.Scene,
    private map: WorldMap,
    private relief: Relief,
  ) {
    for (const c of map.connecteurs ?? []) if (c.type === 'rampe') this.rampes.set(c.y * map.width + c.x, c)
  }

  /** Une tuile est-elle de la roche à dresser ? Falaise ou roche, et le hors-carte en est
   *  (l'anneau de bordure) — sans quoi la dernière rangée du monde ferait une paroi sur le vide. */
  private cliff = (tx: number, ty: number): boolean => {
    const { width, height, terrain } = this.map
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true
    const t = terrain[ty * width + tx]
    return t === TERRAIN_CLIFF || t === TERRAIN_ROCK
  }

  /** La colonne de roche qui passe par cette tuile a-t-elle de quoi se DRESSER ? (voir l'en-tête :
   *  un accent isolé reste un caillou). On compte au-dessus et au-dessous, et on s'arrête tôt. */
  private massif(tx: number, ty: number): boolean {
    let n = 1
    for (let k = 1; k < PAROI_RANGEES + 1 && n < PAROI_RANGEES + 1; k++) {
      if (!this.cliff(tx, ty - k)) break
      n += 1
    }
    for (let k = 1; k < PAROI_RANGEES + 1 && n < PAROI_RANGEES + 1; k++) {
      if (!this.cliff(tx, ty + k)) break
      n += 1
    }
    return n >= PAROI_RANGEES + 1
  }

  /** `nowMs` : l'horloge de rendu (celle du shader d'eau) — la nappe des cascades saute au pas
   *  `CHUTE_HZ` dessus ; sans elle, la cascade est figée au pas 0. */
  render(camera: Phaser.Cameras.Scene2D.Camera, nowMs = 0): void {
    const v = camera.worldView
    const { width, height } = this.map
    const L = LIFT_TUILES
    const pas = Math.floor(nowMs / (1000 / CHUTE_HZ))
    const pasChute = ((pas % CHUTE_FRAMES) + CHUTE_FRAMES) % CHUTE_FRAMES
    const pasEcume = ((pas % ECUME_FRAMES) + ECUME_FRAMES) % ECUME_FRAMES
    this.chutes.length = 0
    const tx0 = Math.max(0, Math.floor(v.x / TILE_PX) - 1)
    const ty0 = Math.max(0, Math.floor(v.y / TILE_PX) - 1)
    const tx1 = Math.min(width - 1, Math.ceil((v.x + v.width) / TILE_PX) + 1)
    // Une rangée de marge au sud : l'ombre portée d'une paroi hors cadre tombe DANS le cadre.
    // ⚠ ET LE LIFT : une tuile de hauteur `h` est VISIBLE `h × LIFT` rangées plus haut que sa
    // position logique. Sans cette marge, le haut d'une terrasse disparaîtrait par le bas de
    // l'écran avant sa propre surface.
    const ty1 = Math.min(height - 1, Math.ceil((v.y + v.height) / TILE_PX) + 2 + this.relief.hauteurMax * L)

    let nTop = 0
    let nOmbre = 0
    // Le flanc que l'astre ombre à cette image : côté, largeur (le cran), et la clé de sa texture.
    const cran = cranDeDerive(this.deriveOmbre)
    const dxFlanc = cran < 0 ? -1 : 1
    const keyFlanc = cliffKey('flanc', Math.abs(cran), 0)

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const h = this.relief.hauteur(tx, ty)
        const p = this.relief.palier(tx, ty)
        const lift = p * L
        // ── LA ROCHE DRESSÉE : dessus et face, à sa position liftée, dans la strate de son palier.
        //
        // ⚠ **UN CHAPEAU D'ÉTAGE NE SE DESSINE PAS ICI** (spec `etages.md`) : la surface d'un
        // plateau est LIFTÉE d'un cran de plus et `EtageLayer` possède son dessus. Les mêmes tuiles
        // habillées deux fois donneraient l'ardoise à sa position logique SOUS le plateau à sa
        // position dessinée : deux mesas pour une. La roche reste de la roche pour le RÔLE
        // (`roleDeFalaise` compte les voisines, y compris celles-là) — pas de sprite dessus.
        // Sa PAROI, elle, est celle de toute tuile haute : le bloc commun, plus bas.
        let rocheDressee = false
        if (this.cliff(tx, ty) && !this.relief.chapeau(tx, ty) && this.massif(tx, ty)) {
          rocheDressee = true
          const f = roleDeFalaise(this.cliff, tx, ty)
          // Le liseré s'allume sur les bords ouverts (nord/est/ouest) — le trait qu'on longe.
          const e = !this.cliff(tx + 1, ty)
          const w = !this.cliff(tx - 1, ty)
          // Le PIED de la roche ne se dit qu'au contact du sol qui la suit : si la voisine sud est
          // plus BASSE, la paroi de terrasse continue sous la face, et le pied est en bas de celle-là.
          const memeHauteurAuSud = this.relief.hauteur(tx, ty + 1) === h
          let key: string
          if (f.role === 'dessus') {
            const n = !this.cliff(tx, ty - 1)
            const variant = hash2(tx, ty) < 0.5 ? 0 : 1
            key = cliffKey('top', (n ? 1 : 0) | (e ? 2 : 0) | (w ? 4 : 0), variant % VARIANTES_DESSUS)
          } else {
            // La PHASE vient de `tx` — c'est elle qui fait courir les colonnes d'une tuile à l'autre
            // (sans quoi la paroi rend un appareillage de briques) ; le semis de strate, du hash.
            const variant = (((tx % PHASES_PAROI) + PHASES_PAROI) % PHASES_PAROI)
              + PHASES_PAROI * (hash2(tx, ty) < 0.5 ? 0 : 1)
            const pied = f.pied && memeHauteurAuSud
            key = cliffKey('face', (f.arete ? 1 : 0) | (e ? 2 : 0) | (w ? 4 : 0) | (pied ? 8 : 0), variant)
          }
          nTop = this.poser(this.tops, nTop, key, tx, ty - lift, strateDEtage(p) + CLIFF_DEPTH, p)

          // L'ombre que la paroi jette sur le sol qui la suit. Jamais sur de la roche : le pied,
          // par définition, n'en a pas sous lui.
          if (f.role === 'paroi' && f.pied && memeHauteurAuSud && ty + 1 < height) {
            nOmbre = this.poserLOmbre(nOmbre, tx, ty + 1 - lift, strateDEtage(p) + CLIFF_OMBRE_DEPTH, p)
          }
        }
        if (h === 0) continue
        const hs = this.relief.hauteur(tx, ty + 1)
        const hE = this.relief.hauteur(tx + 1, ty)
        const hW = this.relief.hauteur(tx - 1, ty)
        // La rampe ENTAILLE la paroi : là où le connecteur du sud monte jusqu'à cette hauteur,
        // c'est `EtageLayer` qui peint le plan incliné, sur toute la hauteur du mur — et la lèvre
        // s'y ouvre aussi : la rampe est le passage, pas un bord.
        const rampe = this.rampes.get((ty + 1) * width + tx)
        const rampeMonte = rampe !== undefined && Math.max(rampe.de, rampe.vers) === h
        // L'eau ne se borde pas : ce qui tombe d'un palier, c'est le shader d'eau qui le dit
        // (ses chutes) — une lèvre de roche autour d'un lac ferait un bassin maçonné.
        // ⚠ L'EAU SEULE, pas `estSurface` : le marais et la tourbière sont des surfaces pour les
        // PAVÉS (sans épaisseur, pas de frange), mais ce sont des TERRES pour le pas — un marais
        // au palier 1 est un mur, et le shader d'eau ne dessine rien sur lui. Jugée à `estSurface`,
        // la lèvre manquait sur tout bord nord/est/ouest de marais : MESURÉ le 2026-09-04
        // (`tools/diag-falaises.mts`, graines 2026/7/4242/909), 4 300 à 6 000 pas refusés par
        // graine sans un pixel pour le dire — 80 % des falaises invisibles du monde joué, et le
        // « marais contre haut-fond » qu'Alexis butait.
        const surface = estEau(this.map.terrain[ty * width + tx]!)
        // ── LA LÈVRE : le bord du palier, sur tout son pourtour (`cliff-art`, 2026-09-04). Pas
        //    sur la roche dressée (elle a ses propres arêtes), pas sur un chapeau (`EtageLayer` la
        //    pose à la profondeur de son plancher, qui trie avec les corps).
        if (!rocheDressee && !surface && !this.relief.chapeau(tx, ty)) {
          const levre = levreDe((dx, dy) =>
            !(dx === 0 && dy === 1 && rampeMonte) && this.relief.hauteur(tx + dx, ty + dy) < h)
          const vl = varianteDeLevre(tx, ty)
          const profondeur = strateDEtage(h) + CLIFF_DEPTH
          if (levre.cotes !== 0) nTop = this.poser(this.tops, nTop, cliffKey('levre', levre.cotes, vl), tx, ty - lift, profondeur, h)
          for (let c = 0; c < 4; c++) {
            if ((levre.coins & (1 << c)) !== 0) nTop = this.poser(this.tops, nTop, cliffKey('coin', c, vl), tx, ty - lift, profondeur, h)
          }
        }
        // ── L'OMBRE DU FLANC, sur le sol du bas — du côté OPPOSÉ à l'astre (`cran`, voir
        //    `deriveOmbre`) : au ras de la lèvre, à la rangée d'écran du dessus — puis le long de
        //    chaque bande de paroi dont la joue est exposée, plus bas.
        const hF = dxFlanc < 0 ? hW : hE
        if (cran !== 0 && hF < h && !surface) nOmbre = this.poserLeFlanc(nOmbre, tx + dxFlanc, ty - h * L, hF, keyFlanc, cran < 0)
        // ── LA PAROI COMMUNE : sous toute tuile plus haute que sa voisine sud (T-R8).
        if (hs >= h) continue
        if (rampeMonte) continue
        // ── LA CASCADE (voir l'en-tête) : de l'eau en haut, de l'eau au pied, un cran — la
        //    nappe remplace la roche, l'écume remplace l'ombre.
        if (h - hs === 1 && ty + 1 < height && estEau(this.map.terrain[ty * width + tx]!) && estEau(this.map.terrain[(ty + 1) * width + tx]!)) {
          const phase = ((tx % CHUTE_PHASES) + CHUTE_PHASES) % CHUTE_PHASES
          const strate = strateDEtage(hs) + CLIFF_DEPTH
          for (let k = 0; k < L; k++) {
            nTop = this.poser(this.tops, nTop, cliffKey('chute', k, varianteDeChute(phase, pasChute)), tx, ty - h * L + 1 + k, strate, hs)
          }
          nTop = this.poser(this.tops, nTop, cliffKey('ecume', 0, varianteDEcume(phase, pasEcume)), tx, ty + 1 - hs * L, strate, hs)
          this.chutes.push({ tx, ty, hs })
          continue
        }
        let premiere = true
        for (let j = h - 1; j >= hs; j--) {
          const strate = strateDEtage(j) + CLIFF_DEPTH
          // Les joues : le côté est exposé quand la voisine ne monte pas jusqu'à cette bande.
          const e = hE <= j ? 2 : 0
          const w = hW <= j ? 4 : 0
          for (let k = 0; k < L; k++) {
            // L'arête ouvre la paroi — sauf sous une roche dressée, dont la face descend déjà.
            const arete = premiere && !rocheDressee
            premiere = false
            const pied = j === hs && k === L - 1
            const variant = (((tx % PHASES_PAROI) + PHASES_PAROI) % PHASES_PAROI)
              + PHASES_PAROI * (hash2(tx, ty + (h - j) * L + k) < 0.5 ? 0 : 1)
            const key = cliffKey('face', (arete ? 1 : 0) | e | w | (pied ? 8 : 0), variant)
            nTop = this.poser(this.tops, nTop, key, tx, ty - (j + 1) * L + 1 + k, strate, j)
            const joueOmbree = dxFlanc < 0 ? w !== 0 : e !== 0
            if (cran !== 0 && joueOmbree && !surface) nOmbre = this.poserLeFlanc(nOmbre, tx + dxFlanc, ty - (j + 1) * L + 1 + k, hF, keyFlanc, cran < 0)
          }
        }
        // L'ombre au pied, sur le sol du palier bas — à sa hauteur à lui.
        if (ty + 1 < height) nOmbre = this.poserLOmbre(nOmbre, tx, ty + 1 - hs * L, strateDEtage(hs) + CLIFF_OMBRE_DEPTH, hs)
      }
    }

    for (let i = nTop; i < this.tops.length; i++) this.tops[i]!.setVisible(false)
    for (let i = nOmbre; i < this.ombres.length; i++) this.ombres[i]!.setVisible(false)
  }

  /** `niveau` : la strate où vit le sprite (palier du dessus, bande `j` d'une paroi, palier du sol
   *  sous une ombre) — ≥ 1 échappe au voile de nuit et prend la teinte (voir `teinte`). */
  private poser(pool: Phaser.GameObjects.Image[], n: number, key: string, tx: number, ty: number, depth: number, niveau: number): number {
    let img = pool[n]
    if (!img) {
      img = epinglerLaTuile(this.scene.add.image(0, 0, key).setOrigin(0).setDepth(depth))
      pool[n] = img
    }
    img.setTexture(key)
    // ⚠ LA PROFONDEUR SE REPOSE À CHAQUE FRAME : le même emplacement du pool sert une face au
    // palier 0 puis une bande au palier 2 d'une image à l'autre, selon ce que la vue contient.
    img.setDepth(depth)
    img.setTint(niveau >= 1 ? this.teinte : 0xffffff)
    img.setPosition(tx * TILE_PX, ty * TILE_PX)
    img.setVisible(true)
    return n + 1
  }

  /** Une ombre (pied ou flanc) : posée comme le reste, puis À LA FORCE DE L'ASTRE — et retournée
   *  pour le flanc ouest (`miroir`). Force nulle : rien à poser, pas même un sprite invisible.
   *  ⚠ Alpha et miroir se REPOSENT à chaque image, comme la profondeur : le pool est partagé. */
  private poserUneOmbre(n: number, key: string, tx: number, ty: number, depth: number, niveau: number, miroir: boolean): number {
    if (this.forceOmbre <= 0) return n
    const n1 = this.poser(this.ombres, n, key, tx, ty, depth, niveau)
    this.ombres[n]!.setAlpha(this.forceOmbre).setFlipX(miroir)
    return n1
  }

  private poserLOmbre(n: number, tx: number, ty: number, depth: number, niveau: number): number {
    return this.poserUneOmbre(n, cliffKey('ombre', 0, 0), tx, ty, depth, niveau, false)
  }

  /**
   * L'ombre du flanc, à la RANGÉE D'ÉCRAN `sy` de la colonne `sx` (la voisine du côté de
   * l'ombre) — sur le sol qui s'y DESSINE, et dans SA strate. Ce sol n'est pas forcément celui de
   * la voisine : à cette rangée d'écran, ce qui se dessine est la tuile `(sx, sy + q × LIFT)` du
   * palier `q` le plus haut qui y monte — jamais plus haut que la voisine (`qMax`), sinon on
   * ombrerait un sol qui domine le flanc. Rien ne s'y dessine à ce niveau : pas d'ombre.
   */
  private poserLeFlanc(n: number, sx: number, sy: number, qMax: number, key: string, miroir: boolean): number {
    if (sx < 0 || sx >= this.map.width) return n
    const L = LIFT_TUILES
    for (let q = qMax; q >= 0; q--) {
      const ly = sy + q * L
      if (ly < 0 || ly >= this.map.height || this.relief.hauteur(sx, ly) !== q) continue
      return this.poserUneOmbre(n, key, sx, sy, strateDEtage(q) + CLIFF_OMBRE_DEPTH, q, miroir)
    }
    return n
  }

  destroy(): void {
    for (const s of this.tops) s.destroy()
    for (const s of this.ombres) s.destroy()
  }
}
