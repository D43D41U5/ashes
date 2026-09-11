/**
 * ═══ LES OISEAUX — LE DESSIN (Alexis, 2026-09-08 : « c'est pauvre. fais tout ») ═══
 *
 * CE QU'IL Y AVAIT. `fx-bird` : **10×4 px, deux triangles pleins, une seule teinte**
 * (`0x2e2a26`), sans cerne ni arête. Affiché en `displaySize(8,8 × 5,6)` — soit un
 * rééchantillonnage **0,88× en X et 1,4× en Y** d'un sprite dont les traits font un pixel,
 * puis ×2,25 de zoom caméra : les arêtes retombaient en pâtés de 2×3 px, inégaux. Rien
 * d'autre dans le jeu n'était échantillonné comme ça. Et le battement était un
 * `setScale(1, flap)` : tout l'oiseau s'aplatissait — un décalque qui pulse, pas une aile.
 *
 * ═══ LES QUATRE RÈGLES DE CE FICHIER ═══
 *
 * Les trois premières ne sont pas neuves : elles sont écrites dans `BootScene.ts` depuis le
 * grand tétras, qui les a payées en une planche ratée, et elles y sont déclarées valoir « pour
 * TOUTE silhouette d'oiseau ici ». Le chevron les violait toutes les trois.
 *
 *   ① **CE QUI DÉPASSE SE DESSINE PAR-DESSUS**, et plus grand que le corps. D'où l'ordre
 *      queue → ailes → corps → tête, et des ailes plus longues que le corps aux images
 *      tendues : un oiseau dont les ailes tiennent dans sa silhouette n'a l'air que rapide.
 *      *(L'ordre a été corrigé le 2026-09-11 : le corps dessiné EN PREMIER disparaissait sous
 *      la racine des ailes, et un oiseau sans masse centrale se lit comme deux ailes collées.)*
 *   ② **IL FAUT UNE ARÊTE CLAIRE SUR LE DOS.** Sans elle, une silhouette sombre au-dessus
 *      d'une canopée sombre n'a pas de contour, donc pas de forme. C'est aussi le seul pixel
 *      clair du sprite, donc **le seul sur lequel la teinte de l'heure a prise** — la règle
 *      paie deux fois (voir `vol-des-oiseaux.teinteDuVol`).
 *   ③ **UNE QUEUE EST UN ÉVENTAIL**, et un éventail se lit à ses SÉPARATIONS — deux encoches
 *      dans la teinte du corps, arrêtées avant le bord (trois traits clairs rendraient un
 *      code-barres flottant). **ET IL S'OUVRE VERS L'ARRIÈRE** : c'est le seul endroit de la
 *      silhouette qui s'élargit en allant vers la queue, donc la seule chose qui interdise la
 *      lecture « flèche » — une flèche finit en pointe ou en encoche, jamais en éventail.
 *   ④ **L'ÉCHELLE EST ENTIÈRE** — et c'est la règle qui manquait. La source est dessinée à la
 *      taille MONDE finale : l'appelant pose le sprite tel quel (`setScale(1)`), sans un seul
 *      `setDisplaySize`. Le seul redimensionnement qui reste est celui de l'ALTITUDE, continu
 *      et assumé (un oiseau haut est plus petit), jamais un rééchantillonnage subi.
 *
 * ⚠ **AUCUNE SOURCE Light2D ICI.** Le `LightsManager` plafonne à 40 et les Feux en réservent
 * déjà 24, plus le soleil, la lune et les essaims. Un oiseau prend sa nuit par la TEINTE.
 */
import Phaser from 'phaser'
import { IMAGES_AILE, type EspeceOiseau } from './vol-des-oiseaux'

/**
 * LE GABARIT D'UNE ESPÈCE — tout ce qui la distingue, en un endroit. Les nombres sont en
 * PIXELS MONDE (donc `TILE_PX` = 16 pour une tuile) : la source est dessinée à cette taille
 * et posée sans mise à l'échelle (règle ④).
 */
export interface GabaritOiseau {
  /** Côté du canevas source, en px monde. Doit contenir l'envergure la plus grande. */
  cote: number
  /** Le corps : longueur (axe du vol) et hauteur. */
  corpsL: number
  corpsH: number
  /** Demi-envergure par image d'aile — tendue, mi-course, repliée (`IMAGES_AILE` = 3). */
  envergures: readonly [number, number, number]
  /** De combien le bout d'aile recule vers l'arrière à chaque image : une aile qui se replie
   *  se met EN FLÈCHE. Sans ça, elle rentre tout droit et l'oiseau rétrécit au lieu de battre. */
  fleches: readonly [number, number, number]
  /** L'éventail de la queue : longueur et demi-ouverture. */
  queueL: number
  queueDemi: number
  /** Battements par seconde. Un corbeau rame, un passereau vibre, un rapace tient. */
  cadence: number
  /** Vitesse de croisière, en tuiles/s. */
  vitesse: number
  /** Altitude de croisière dans [0, 1] — commande l'écart à l'ombre et le rapetissement. */
  altitude: number
  /** Combien d'oiseaux forment un vol de cette espèce. */
  parVol: number
  /** Alpha de croisière : un oiseau haut est plus délavé qu'un oiseau qui rase. */
  alpha: number
  /** Les trois teintes de la règle ② : l'ombre (contour), le corps, l'arête du dos. */
  ombre: number
  corps: number
  dos: number
}

export const GABARITS: Readonly<Record<EspeceOiseau, GabaritOiseau>> = {
  /** LE PASSEREAU — petit, vif, en nuée serrée. C'est lui qui gicle d'une lisière. */
  passereau: {
    cote: 14,
    corpsL: 6,
    corpsH: 3,
    // ⚠ LA TROISIÈME NE DESCEND PAS SOUS LE CORPS. À 1,8 (le premier jet) l'aile repliée
    // rentrait DANS le fuseau : une image sur quatre, l'oiseau n'était plus qu'une barre — et
    // un battement qui fait disparaître l'aile est un clignotement, pas un battement.
    envergures: [4.5, 3.2, 2.6],
    fleches: [0.5, 1.6, 2.6],
    queueL: 3.5,
    queueDemi: 2,
    cadence: 7.5,
    vitesse: 7,
    altitude: 0.45,
    parVol: 5,
    alpha: 0.85,
    ombre: 0x16130f,
    corps: 0x453a2c,
    dos: 0x8a7859,
  },
  /** LE CORVIDÉ — grand, lent, noir bleuté, par deux ou trois. Le lustre bleu du dos est sa
   *  marque : c'est ce qui empêche « un gros passereau sombre ». */
  corbeau: {
    cote: 20,
    corpsL: 8,
    corpsH: 4,
    // ⚠ LA TROISIÈME À 4 ET NON 3 : à 3, l'aile repliée ne dépassait plus du fuseau (corps
    // haut de 4) et l'image rendait un POISSON — un corps fuselé à bande claire, sans rien qui
    // dise l'oiseau. La règle du passereau vaut ici aussi : l'aile rentre, elle ne disparaît pas.
    envergures: [7, 5, 4],
    fleches: [0.8, 2.4, 4],
    queueL: 6,
    queueDemi: 3.2,
    cadence: 3.4,
    vitesse: 5,
    altitude: 0.6,
    parVol: 3,
    alpha: 0.9,
    ombre: 0x080a10,
    corps: 0x1e2230,
    dos: 0x505c78,
  },
  /** LE RAPACE — seul, haut, en cercles. Il ne traverse pas, il TIENT : son battement est
   *  d'amplitude minuscule (il plane), et c'est le mouvement lent qui le dit, pas les ailes. */
  rapace: {
    cote: 24,
    corpsL: 9.5,
    corpsH: 5,
    envergures: [10, 9, 7.4],
    fleches: [0.6, 1.6, 3],
    queueL: 7,
    queueDemi: 4.2,
    cadence: 1.1,
    vitesse: 3.2,
    altitude: 1,
    parVol: 1,
    alpha: 0.95,
    ombre: 0x1a120c,
    corps: 0x53381f,
    dos: 0xa8834e,
  },
}

/** La clé de texture d'une image d'aile. La source pointe vers +X : l'appelant fait tourner
 *  le sprite sur son cap (`setRotation`), il ne le RETOURNE jamais — un `setFlipX` sur un
 *  oiseau qui pique vers le nord-ouest le fait voler de travers. */
export function cleOiseau(espece: EspeceOiseau, image: number): string {
  return `bird-${espece}-${image}`
}

/** La clé de l'ombre portée d'une espèce — une seule, molle, posée au sol. */
export function cleOmbreOiseau(espece: EspeceOiseau): string {
  return `bird-shadow-${espece}`
}

/**
 * L'OMBRE PORTÉE — une tache molle, et elle est le SEUL indice d'altitude qu'on ait. Vue de
 * dessus, rien ne distingue un oiseau qui rase de un oiseau à trente mètres : même sprite,
 * même vitesse apparente. C'est l'ÉCART à l'ombre qui dit la hauteur — et c'est ce qui fait de
 * l'envol de lisière une chose qui QUITTE le sol au lieu d'un sprite qui apparaît.
 *
 * Molle, donc LINEAR (l'appelant l'exempte du passage NEAREST, comme le halo des Feux) : une
 * ombre à bord dur sur de l'herbe se lit comme un caillou.
 */
function dessinerOmbre(g: Phaser.GameObjects.Graphics, gab: GabaritOiseau): void {
  const c = gab.cote / 2
  const l = gab.corpsL + gab.envergures[0] * 0.6
  for (let i = 4; i >= 1; i--) {
    g.fillStyle(0x000000, 0.07 * i)
    g.fillEllipse(c, c, (l * i) / 4, ((l * 0.55) * i) / 4)
  }
}

/**
 * ═══ UNE AILE EST UNE SURFACE BALAYÉE, PAS UN PIQUANT ═══
 *
 * ⚠ **VU, PUIS REFAIT** (planche `__voir-oiseaux`, 2026-09-08). Le premier jet posait chaque
 * aile en TRIANGLE dont les deux points de base étaient sur la même ligne que le corps et dont
 * la pointe montait droit : deux piquants perpendiculaires à un corps invisible. À ×6, les
 * trois espèces rendaient **une étoile à quatre branches** — la même faute exactement que le
 * premier tétras (« ça rendait un scarabée »), et pour la même raison : on avait dessiné la
 * DIRECTION de l'aile au lieu de sa MASSE.
 *
 * Une aile vue de dessus est un QUADRILATÈRE : une corde large à l'épaule, une corde courte au
 * bout, et **le bout est en arrière de l'épaule** — c'est le BALAYAGE qui fait lire l'aile, et
 * qui donne à l'oiseau entier sa silhouette en boomerang. Sans balayage, deux surfaces
 * perpendiculaires font une croix, quelle que soit leur largeur.
 *
 * Le battement joue sur les deux : l'envergure rentre ET le balayage augmente (l'aile se met en
 * flèche en se repliant). Une aile qui ne ferait que rentrer donnerait un oiseau qui rapetisse.
 */
function dessinerAile(g: Phaser.GameObjects.Graphics, gab: GabaritOiseau, image: number, signe: number): void {
  const c = gab.cote / 2
  const env = gab.envergures[image]!
  // LE BALAYAGE : un fond propre à l'espèce (l'aile est toujours en arrière de l'épaule) plus
  // ce que l'image ajoute en se repliant.
  //
  // ⚠ **DEUX FAUTES SYMÉTRIQUES, VUES L'UNE APRÈS L'AUTRE** (planche `__planche-oiseaux`,
  // 2026-09-11) — et ce qui les sépare n'est PAS un réglage du recul.
  //   · À `0,42` de balayage, le bout d'aile tombait DERRIÈRE la queue : le point le plus en
  //     arrière de la silhouette n'était plus l'oiseau mais l'ENCOCHE entre ses deux ailes, et
  //     les trois espèces rendaient une **pointe de flèche** (le rapace était `fx-arrow`, la
  //     flèche de dépouille, en marron).
  //   · À `0,16`, corrigé trop loin : ailes perpendiculaires, corde presque constante de
  //     l'épaule au bout — deux PLANCHES en croix sur un fuselage, un **avion de tôle**. C'est
  //     l'étoile à quatre branches du premier jet, revenue par l'autre côté.
  // Ce qui fait l'aile n'est donc pas de combien elle recule mais **de combien elle S'EFFILE** :
  // corde large à l'épaule, corde MINUSCULE au bout (0,14 de la longueur du corps, pas 0,30),
  // et un recul moyen. Une aile est un triangle allongé, pas un rectangle qu'on incline.
  // La borne du premier cas reste : le bout d'aile ne dépasse jamais le bord de la queue.
  const bal = gab.corpsL * 0.45 + gab.fleches[image]!
  const epX = c + gab.corpsL * 0.16 // l'épaule, en avant du milieu du corps
  const fuX = c - gab.corpsL * 0.26 // la fuite, en arrière
  const y0 = c + signe * gab.corpsH * 0.25
  const ty = c + signe * env
  const boutAv = epX - bal
  // LA CORDE DU BOUT : c'est ELLE qui fait l'aile (voir le bloc ci-dessus). Minuscule, mais
  // jamais nulle — un bout d'aile en pointe parfaite disparaît au premier arrondi de pixel.
  const corde = Math.max(1.2, gab.corpsL * 0.14)
  const boutAr = boutAv - corde

  /**
   * ① CE QUI DÉPASSE SE DESSINE PLUS GRAND — MAIS LE CERNE SUIT LA FORME, IL NE L'ÉPAISSIT PAS.
   *
   * ⚠ C'ÉTAIT LA VRAIE CAUSE DE L'AVION (2026-09-11). Le cerne était posé en décalant chaque
   * coin d'un `±0,6` FIXE en x. À l'épaule, sur cinq pixels de corde, ça ne se voit pas ; au
   * BOUT, sur `corde` = 1,4 px, ça faisait 2,6 px — le cerne **doublait la corde du bout** et
   * effaçait tout l'effilement. On avait beau réduire `corde`, la silhouette gardait des ailes
   * à bouts carrés : on ne regardait pas la bonne forme. Le contour se gonfle donc DEPUIS LE
   * CENTRE DE L'AILE (chaque coin s'écarte du barycentre), ce qui le rend proportionnel : large
   * là où l'aile est large, mince là où elle s'effile.
   */
  const coins = [
    [epX, y0],
    [boutAv, ty],
    [boutAr, ty],
    [fuX, y0],
  ] as const
  const gx = (epX + boutAv + boutAr + fuX) / 4
  const gy = (y0 * 2 + ty * 2) / 4
  const gonfle = (d: number): number[][] =>
    coins.map(([x, y]) => {
      const dx = x - gx
      const dy = y - gy
      const n = Math.sqrt(dx * dx + dy * dy) || 1
      return [x + (dx / n) * d, y + (dy / n) * d]
    })
  const quad = (p: number[][]): void => {
    g.fillTriangle(p[0]![0]!, p[0]![1]!, p[1]![0]!, p[1]![1]!, p[2]![0]!, p[2]![1]!)
    g.fillTriangle(p[0]![0]!, p[0]![1]!, p[2]![0]!, p[2]![1]!, p[3]![0]!, p[3]![1]!)
  }
  g.fillStyle(gab.ombre)
  quad(gonfle(0.75))
  g.fillStyle(gab.corps)
  quad(gonfle(-0.2))
  // ② LE BORD D'ATTAQUE, dans la teinte du dos — l'arête qui SAUVE la silhouette sur un fond
  // sombre, et le seul endroit du sprite où la teinte de l'heure a prise.
  // ⚠ ÉTROIT — VU PUIS RESSERRÉ. À `corde × 0,45` de large, l'arête ne bordait plus l'aile :
  // elle la REMPLISSAIT, et le rapace rendait une flèche dorée au lieu d'un planeur brun. Une
  // arête est un LISERÉ ; ce qu'elle doit faire, c'est séparer l'aile du fond, pas la peindre.
  //
  // ⚠ ET ELLE S'ARRÊTE AVANT LE BOUT (2026-09-11). Menée jusqu'à la pointe, elle courait sur
  // toute l'envergure — or plus l'aile s'effile, plus le liseré occupe de sa largeur : au
  // dernier tiers il ne bordait plus rien, il ÉTAIT l'aile, et le rapace (dos tan sur corps
  // brun) rendait deux lames dorées. Elle meurt donc aux deux tiers de l'envergure, là où la
  // couverture claire meurt sur l'oiseau.
  g.fillStyle(gab.dos)
  const f = 0.62
  const mx = epX - bal * f
  const my = c + signe * env * f
  const liseré = Math.max(1, corde * 0.5)
  g.fillTriangle(epX - 0.4, y0, mx, my, mx - liseré, my)
  g.fillTriangle(epX - 0.4, y0, mx - liseré, my, epX - Math.max(1, gab.corpsL * 0.16), y0)
  // ⚠ LES RÉMIGES SONT PARTIES (2026-09-11). Le rapace portait deux barres sombres en travers
  // du bout d'aile, « parce qu'à 24 px une aile unie devient une planche ». Une fois l'aile
  // vraiment effilée, son bout ne fait plus qu'un pixel et demi : les barres n'y meublaient
  // plus rien, elles la HACHAIENT — le planeur rendait une aile déchirée. Ce qui empêche la
  // planche, c'est l'effilement, pas le motif. (Le champ `barres` est parti avec elles :
  // un réglage sans effet est pire qu'absent, on le croit responsable.)
}

/**
 * ═══ ③ LA QUEUE — UN ÉVENTAIL S'OUVRE VERS L'ARRIÈRE, IL NE SE FERME PAS ═══
 *
 * ⚠ **REFAITE APRÈS L'AVOIR VUE** (2026-09-11). Le premier jet la dessinait en TRIANGLE dont la
 * pointe partait en arrière — c'est-à-dire l'empennage d'une flèche, exactement la forme dont
 * la règle ③ dit qu'il faut sortir. Et ses « séparations » étaient deux `fillRect` posés à
 * `queueDemi / 2` arrondi, soit ±1 px sur un passereau : à cette distance elles tombaient sur
 * le CERNE, pas dans la chair, et n'ont jamais rien séparé.
 *
 * Une queue d'oiseau vue de dessus est un TRAPÈZE : étroite à la racine (la largeur du corps),
 * LARGE au bord de fuite. C'est le seul endroit de la silhouette qui s'élargit vers l'arrière,
 * et c'est ce qui interdit la lecture « flèche » — une flèche se termine en pointe ou en
 * encoche, jamais en éventail. Les séparations se posent dans la chair, à `±0,45` de la
 * demi-ouverture, et s'arrêtent avant le bord (un trait qui atteint le contour DÉCOUPE).
 */
function dessinerQueue(g: Phaser.GameObjects.Graphics, gab: GabaritOiseau): void {
  const c = gab.cote / 2
  const xR = c - gab.corpsL * 0.34 // la racine, que le corps vient coiffer
  const xT = xR - gab.queueL //      le bord de fuite
  const hR = Math.max(1, gab.corpsH * 0.34)
  const dQ = gab.queueDemi
  // ⚠ **LE BORD DE FUITE EST ÉCHANCRÉ, PAS DROIT** — et c'est ce qui a sorti la silhouette de
  // l'avion (2026-09-11). Un trapèze à bord droit, posé derrière un fuseau, est un EMPENNAGE :
  // le rectangle net qui dépasse à l'arrière se lit comme la dérive d'un appareil, pas comme
  // des plumes. Une fourche de 0,3 × la longueur suffit — c'est une forme que l'ingénierie ne
  // produit pas, donc l'œil la range du côté du vivant.
  const xF = xT + gab.queueL * 0.3 // le fond de l'échancrure
  const demi = (s: number, d: number): void => {
    g.fillTriangle(xR, c + s * (hR + d), xT - d, c + s * (dQ + d), xF + d * 0.5, c + s * d)
    g.fillTriangle(xR, c + s * (hR + d), xF + d * 0.5, c + s * d, xR, c)
  }
  g.fillStyle(gab.ombre)
  demi(-1, 0.7)
  demi(+1, 0.7)
  g.fillStyle(gab.corps)
  demi(-1, -0.5)
  demi(+1, -0.5)
  // LES SÉPARATIONS : deux traits sombres qui s'ouvrent avec l'éventail, arrêtés avant le bord.
  g.fillStyle(gab.ombre)
  for (const s of [-1, 1]) {
    const yT = c + s * dQ * 0.5
    g.fillTriangle(xR + 0.4, c + s * hR * 0.3, xT + 1.8, yT - 0.5, xT + 1.8, yT + 0.5)
  }
}

/** Une espèce, une image d'aile — queue, ailes, corps, tête (voir l'ordre, il est raisonné). */
function dessinerOiseau(g: Phaser.GameObjects.Graphics, gab: GabaritOiseau, image: number): void {
  const c = gab.cote / 2
  // ③ LA QUEUE D'ABORD : elle est derrière tout, et le corps doit la coiffer à la racine.
  dessinerQueue(g, gab)

  // ① LES AILES, qui dépassent : c'est l'envergure qui dit le vol.
  dessinerAile(g, gab, image, -1)
  dessinerAile(g, gab, image, +1)

  // LE CORPS — un FUSEAU, plus long que large : c'est lui qui donne l'axe du vol. Cerne
  // d'abord, chair ensuite.
  //
  // ⚠ IL PASSE PAR-DESSUS LES AILES, et c'est un changement du 2026-09-11. Dessiné avant, sa
  // moitié arrière disparaissait sous la racine des deux ailes : il ne restait du corps que la
  // partie qui déborde en avant, donc un MUSEAU — et une silhouette sans masse centrale se lit
  // comme deux ailes collées l'une à l'autre. La règle ① dit « ce qui dépasse par-dessus » ;
  // elle ne dit pas que le corps doit s'effacer.
  g.fillStyle(gab.ombre).fillEllipse(c, c, gab.corpsL + 1.5, gab.corpsH + 1.5)
  g.fillStyle(gab.corps).fillEllipse(c, c, gab.corpsL, gab.corpsH)
  // LA TÊTE, tendue en avant : un prolongement du fuseau, jamais un disque posé à côté (la
  // leçon du tétras — une tête détachée se lit comme un bloc flottant). Elle aussi passe après
  // les ailes : à 0,42 de la longueur du corps, elle tombait sous l'épaule et l'oiseau n'avait
  // plus d'avant — or c'est l'avant qui dit dans quel sens il vole.
  g.fillStyle(gab.ombre).fillEllipse(c + gab.corpsL * 0.46, c, gab.corpsL * 0.36, gab.corpsH * 0.8)
  g.fillStyle(gab.corps).fillEllipse(c + gab.corpsL * 0.46, c, gab.corpsL * 0.28, gab.corpsH * 0.55)

  // ② ET L'ARÊTE DU DOS EN TOUT DERNIER — un trait clair d'UN pixel le long de l'axe : c'est ce
  // qui recoud les masses en un seul corps. Posé avant, les ailes l'effaçaient.
  //
  // ⚠ **RACCOURCIE À LA LONGUEUR DU CORPS** (2026-09-11). À `0,66 × corpsL` partant de
  // `−0,3 × corpsL`, elle courait de la queue à la tête EN TRAVERSANT la racine des ailes :
  // étant le seul pixel clair du sprite, elle devenait l'élément le plus contrasté de l'objet
  // et se lisait comme une HAMPE — le rapace rendait un arc bandé. Une arête borde un dos ;
  // elle ne traverse pas l'oiseau de part en part.
  g.fillStyle(gab.dos).fillRect(c - gab.corpsL * 0.16, c - 1, gab.corpsL * 0.46, 1)
}

/**
 * Cuit les textures des trois espèces (3 images d'aile chacune) et leurs ombres portées.
 * À appeler dans `BootScene.create()` AVANT le passage NEAREST global.
 *
 * Rend les clés des ombres, que l'appelant doit repasser en LINEAR (voir `dessinerOmbre`).
 */
export function generateBirdTextures(scene: Phaser.Scene): string[] {
  const g = scene.add.graphics()
  const ombres: string[] = []
  for (const [espece, gab] of Object.entries(GABARITS) as [EspeceOiseau, GabaritOiseau][]) {
    for (let i = 0; i < IMAGES_AILE; i++) {
      g.clear()
      dessinerOiseau(g, gab, i)
      g.generateTexture(cleOiseau(espece, i), gab.cote, gab.cote)
    }
    g.clear()
    dessinerOmbre(g, gab)
    const cle = cleOmbreOiseau(espece)
    g.generateTexture(cle, gab.cote, gab.cote)
    ombres.push(cle)
  }
  g.destroy()
  return ombres
}
