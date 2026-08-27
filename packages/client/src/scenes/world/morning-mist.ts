/**
 * LA BRUME DU MATIN — elle NAÎT DE L'EAU et MONTE VERS LE RIVAGE comme une marée
 * (spec da-feeling R13-R14, variante V1 « la marée de l'aube » choisie le 2026-07-26).
 *
 * Le MASQUE n'est plus un oui/non dilaté (le diagnostic a montré que sa frontière droite et
 * son intérieur uniforme étaient TOUT le problème) : c'est un CHAMP DE DISTANCE À L'EAU —
 * chanfrein 3-4 en deux passes sur la grille, plafonné à 15 tuiles, écrit dans le canal R
 * (le geste du champ de cendre : calculé une fois au boot, jamais rangé). Le shader
 * (`mist-layer.ts`) y lit la marée : couverture pleine derrière le front, rampe effrangée
 * devant, et l'eau qui fume du premier au dernier instant.
 *
 * Les eaux de la Combe brumeuse ne SÈMENT pas le champ : elle garde SA brume permanente
 * (son identité), on ne double pas l'alpha — et sans éviction rectangulaire, pas de couloir
 * au cordeau (revue du 26/07).
 *
 * Le CALENDRIER : `frontDeBrume(hour)` (fonction pure du module lighting, testée) décide de
 * TOUT — la portée de la marée ET la densité (pleine dès 3 tuiles de front, fondue à ses tout
 * derniers instants). `brumeDuMatin` reste l'enveloppe des autres consommateurs de l'aube
 * (oiseaux, bancs) ; ici, une seule vérité : le front.
 */
import Phaser from 'phaser'
import { TEMPERATURE, TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER, type WorldMap } from '@ashes/sim'
import { frontDeBrume, partDeBrumeMatinale } from '../../render/lighting'
import type { HeureSolaire } from '../../render/lighting'
import { HAUTEUR_NAPPE_PX } from './meteo-layer'
import { DIST_FIELD_MAX, MIST_DEPTH, MistLayer, type ReglageCrans, type ReglageNappe } from './mist-layer'

/** Plafond de densité à brume pleine — la crête du shader monte au-delà (voir ses crans).
 *  0,3 → 0,38 le 26/07 : regardé à 6h12, le sol de l'aube en jeu est plus clair que celui de
 *  la maquette de calibrage — la nappe y restait timide sur la berge.
 *  GARDE-FOU (revue) : JAMAIS ≥ 0,41 — au-delà le plafond de CRANS_MAREE mord, corps et crête
 *  s'y écrasent ensemble et le drap uniforme « toute blanche » revient en silence. */
const DENSITE_MAX = 0.38
/** Vitesse de dérive des nappes (tuiles/s) appliquée au vent lissé unitaire — le PLANCHER,
 *  celui du calme plat (décision consignée : une nappe dérive toujours). */
const DERIVE = 0.32
/** …et de combien le souffle d'ICI l'accélère, en part de ce plancher. Un souffle plein double
 *  presque la dérive — mais à ce souffle-là la nappe est déjà dispersée : ce qu'on voit, c'est
 *  la brume qui FILE juste avant de partir. */
const PRISE_DU_VENT = 0.9

/** LE FROISSEMENT DE LA FRONTIÈRE, en tuiles — choix d'Alexis du 2026-08-22 (« j'aimerais voir
 *  une frontière de brume plus organique et pas simplement droite »), planche F3 retenue.
 *
 *  LE DÉFAUT, MESURÉ (`pnpm smoke --scenario frontiere --dev`, le Gué à 6h12, marée étale à ses
 *  9 tuiles) : le front est une ISO-DISTANCE de la berge, donc au Gué — où la rivière descend au
 *  cordeau — c'était une DROITE au sens mathématique. Sur 248 lignes balayées de la carte de
 *  couverture, le contour déviait de 0 px et son étendue valait 0. Pas « discret » : zéro.
 *
 *      frange   |Δ| moyen   étendue   (part de la largeur du cadre)
 *        0        0,00         0            0 %      ← l'escalier d'angles droits
 *        1,5      0,52       112         17,5 %
 *        3        0,57       112         17,5 %
 *        5        0,67        85         13,3 %      ← ICI
 *
 *  L'étendue de F3 est PLUS BASSE que celle de F2 sans que le contour serpente moins : à 5
 *  tuiles la nappe sort du cadre par endroits, et la mesure ne compte que ce qui reste visible.
 *  La colonne « étendue » cesse d'être comparable au-delà de 3 — dit autrement, à ce réglage on
 *  voit souvent de la brume partout plutôt qu'une frontière. Signalé, tranché, assumé.
 *
 *  La COMBE ne le reçoit PAS : son halo est un rectangle adouci et c'est une autre décision,
 *  encore ouverte — elle garde le défaut 0 de `MistLayer`. */
const FRANGE = 5

/** LES CRANS DE LA MARÉE — plus transparents en HAUT de l'échelle que ceux de la maquette
 *  (0,34 / 0,66 / 0,90, plafond 0,72), sur DEUX retours d'Alexis du 2026-07-26 : « augmente la
 *  transparence des parties les plus blanches », puis « encore plus transparent ».
 *
 *  MESURÉ (`pnpm smoke --scenario blancheur --dev` — Gué 6h12, marée seule, écart pixel à pixel
 *  contre le MÊME monde nu ; le second passage a balayé les candidats sur une seule scène,
 *  heure re-réglée entre chacun, le réglage courant répété en tête ET en queue pour lire le
 *  résidu : ±1,3 sur le p99, donc tout écart au-delà de 2 est réel) :
 *
 *      crans (mince/corps/crête)   médian   p99    >60 % de l'écran
 *      0,34 / 0,66 / 0,90 (départ)  +40,4  +102,3       14,5 %
 *      0,34 / 0,50 / 0,64 (1er cran) +26,6  +74,6        7,9 %
 *      0,34 / 0,42 / 0,50 (ICI)     +21,1  +61,2        1,26 %
 *      0,34 / 0,38 / 0,44 (regardé) +19,0  +52,7        0,16 %  ← la structure de plaques MEURT
 *
 *  On s'arrête donc à 0,50 : un cran de plus et les crêtes ne se détachent plus du corps — la
 *  nappe devient un film pâle uniforme, l'autre façon de perdre la brume.
 *
 *  On baisse l'opacité des DEUX crans hauts, jamais celle du cran MINCE (0,34 inchangé) : les
 *  franges qui effrangent le front sont ce qui fait que la marée n'est pas un mur, et le retour
 *  vise le blanc, pas le bord. La TEINTE ne bouge pas non plus — la crête reste la plus claire
 *  (×1,12) : Alexis demande de la transparence, pas de la grisaille.
 *
 *  L'échelle reste ordonnée (α au pic : 0,284 / 0,351 / 0,418, écarts 0,067 et 0,067). Le rail
 *  0,45 passe juste au-dessus du pic 0,418 : il ne mord pas, il garde. */
const CRANS_MAREE: ReglageCrans = { poids: [0.34, 0.42, 0.5], plafond: 0.45 }

/**
 * ═══ ELLE S'AFFICHE COMME LE BROUILLARD (décision d'Alexis, 2026-08-25) ═══
 *
 * *« La brume doit s'afficher comme le brouillard — entre le sol et le haut du houppier. »*
 *
 * Elle COIFFAIT le monde (`MIST_DEPTH` = 1 020 000, au-dessus des houppiers) — c'était le retour
 * « au-dessus du personnage » de juillet, consigné en R15. Un film posé sur l'image : rien n'y
 * est jamais DEDANS. Depuis, le brouillard météo a résolu le même problème et sa recette est
 * mesurée (`meteo-layer.ts`, scénario `brouillardsol`) : une PILE DE BANDES dans la bande des
 * houppiers, qui coupe les silhouettes à une hauteur, au pixel près. La marée du matin la
 * reprend telle quelle — la brume devient un volume qu'on traverse, et les cimes en sortent.
 *
 * L'ÉPAISSEUR EST CELLE DU BROUILLARD, ET C'EST LE MÊME NOMBRE, PAS UNE COPIE. `HAUTEUR_NAPPE_PX`
 * est dérivé du bouleau (« on ne doit voir que ce qui dépasse du tiers le plus haut du houppier
 * des bouleaux ») : deux brumes qui promettent la même chose doivent la promettre avec la même
 * constante. ⚠ Conséquence à dire : retoucher la hauteur du brouillard déplace AUSSI celle-ci.
 *
 * Le PAS est plus fin que celui du brouillard (12 px) : la nappe du matin est deux fois plus
 * transparente (pic α ~0,42 contre 0,86), et un bord de coupe se lit d'autant plus qu'il traverse
 * du translucide — on achète du fondu là où le brouillard pouvait s'en passer.
 */
const NAPPE_MAREE: ReglageNappe = { hauteur: HAUTEUR_NAPPE_PX, bandePx: 16 }

/** Chanfrein 3-4 : distance à l'eau en tiers de tuile, deux passes (avant/arrière). */
export function champDistanceEau(estSource: (i: number) => boolean, width: number, height: number): Uint16Array {
  const CAP = DIST_FIELD_MAX * 3
  const d = new Uint16Array(width * height).fill(CAP)
  for (let i = 0; i < width * height; i++) if (estSource(i)) d[i] = 0
  // Passe avant (haut-gauche → bas-droite) : gauche, haut, et les deux diagonales hautes.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let v = d[i]!
      if (v === 0) continue
      if (x > 0) v = Math.min(v, d[i - 1]! + 3)
      if (y > 0) {
        v = Math.min(v, d[i - width]! + 3)
        if (x > 0) v = Math.min(v, d[i - width - 1]! + 4)
        if (x < width - 1) v = Math.min(v, d[i - width + 1]! + 4)
      }
      d[i] = Math.min(v, CAP)
    }
  }
  // Passe arrière (bas-droite → haut-gauche) : droite, bas, et les deux diagonales basses.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      let v = d[i]!
      if (v === 0) continue
      if (x < width - 1) v = Math.min(v, d[i + 1]! + 3)
      if (y < height - 1) {
        v = Math.min(v, d[i + width]! + 3)
        if (x < width - 1) v = Math.min(v, d[i + width + 1]! + 4)
        if (x > 0) v = Math.min(v, d[i + width - 1]! + 4)
      }
      d[i] = Math.min(v, CAP)
    }
  }
  return d
}

export class MorningMist {
  private layer: MistLayer | null = null
  private readonly key = 'morning-mist-mask'

  constructor(scene: Phaser.Scene, map: WorldMap) {
    const { width, height, terrain } = map
    const humide = (t: number): boolean =>
      t === TERRAIN_SHALLOW_WATER || t === TERRAIN_DEEP_WATER || t === TERRAIN_MARSH || t === TERRAIN_REED_MARSH

    // ── La Combe garde sa brume à elle : ses eaux et marais NE NOURRISSENT PAS la marée
    //    (exclus des SOURCES du champ). La revue a mesuré l'ancienne éviction rectangulaire
    //    (distance forcée au plafond sur l'empreinte) : elle recréait à pleine marée un
    //    couloir blanc au cordeau autour du rectangle — la « frontière dure et droite » du
    //    retour d'Alexis, ressuscitée au pire endroit. Sans sources dedans, la marée y est
    //    naturellement absente, et si une eau EXTÉRIEURE la frôle, elle s'y effrange. ──
    const combe = map.zones.find((z) => z.kind === 'combe_brumeuse')
    const horsCombe = (i: number): boolean => {
      if (!combe) return true
      const x = i % width
      const y = (i - x) / width
      return x < combe.x - 2 || x >= combe.x + combe.w + 2 || y < combe.y - 2 || y >= combe.y + combe.h + 2
    }
    const dist = champDistanceEau((i) => humide(terrain[i]!) && horsCombe(i), width, height)

    // ── Le champ en texture (1 px/tuile, NEAREST — canal R = dist/15 de tuile) ──
    const cv = document.createElement('canvas')
    cv.width = width
    cv.height = height
    const ctx = cv.getContext('2d', { willReadFrequently: true })!
    const img = ctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      img.data[i * 4] = Math.round((Math.min(dist[i]! / 3, DIST_FIELD_MAX) / DIST_FIELD_MAX) * 255)
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key)
    scene.textures.addCanvas(this.key, cv)
    scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)

    // `MIST_DEPTH` n'est plus qu'un repli : en mode nappe, la pile pose SA profondeur à chaque
    // image dans la bande des houppiers (voir `NAPPE_MAREE`).
    this.layer = new MistLayer(scene, this.key, width, height, MIST_DEPTH, CRANS_MAREE, NAPPE_MAREE)
    this.layer.frange = FRANGE
  }

  /** LA CONDITION du dernier `update`, exposée pour les sondes (smoke `maree`) : 1 = la brume a
   *  tout ce qu'il lui faut, 0 = ce matin-là n'en porte pas. */
  get part(): number {
    return this.dernierePart
  }
  private dernierePart = 0

  /** Chaque frame : la MARÉE décide de tout (pente continue), le vent LISSÉ du monde
   *  (`VentLisse`) porte les nappes — jamais un vecteur nul, jamais un saut de cap.
   *  La densité SUIT LE FRONT (pleine dès que la marée a 3 tuiles, fondue à ses tout
   *  derniers instants) : regardé à 7h36, multiplier par l'enveloppe `brumeDuMatin`
   *  éteignait les dernières flaques du retrait — que la maquette validée gardait
   *  lisibles jusqu'au bout (le burn-off se raconte, il ne s'évapore pas en silence). */
  update(
    nowMs: number,
    hour: HeureSolaire,
    vent: { x: number; y: number },
    day = 1,
    /** Le jour de saison et le tour — l'ÉCART JOUR/NUIT s'y lit par la loi de `/sim`. */
    saison: { seasonDay: number; tour: number } = { seasonDay: 1, tour: 1 },
    /** La part de souffle AU-DESSUS de l'ambiance, au point du joueur (`ventPartIci`). */
    ventPart = 0,
    camera?: Phaser.Cameras.Scene2D.Camera,
  ): void {
    const front = frontDeBrume(hour)
    const densite = DENSITE_MAX * Math.min(1, front / 3)
    // L'ÉCART VIENT DE LA LOI DE `/sim`, pas d'une seconde courbe peinte ici : c'est le même
    // nombre que le froid nocturne retranche (`saisons.md` S5), donc la brume et le froid ne
    // peuvent pas raconter deux automnes différents.
    const ecart = TEMPERATURE.ECART_NUIT(saison.seasonDay, saison.tour)
    this.dernierePart = partDeBrumeMatinale(ecart, ventPart)
    // ── LE PEU DE VENT A PRISE SUR LA NAPPE (demande d'Alexis, 2026-08-25) ──
    // La dérive ne prenait que le CAP du vent lissé, à vitesse fixe : par calme plat comme sous
    // une bourrasque, les nappes glissaient au même pas. On garde ce PLANCHER — c'est une
    // décision consignée (« une nappe de brume doit dériver même par calme plat ») — et on lui
    // ajoute un terme proportionnel au souffle d'ici. La brume qu'on ne disperse pas encore
    // FILE plus vite : le vent se voit sur elle avant de l'emporter.
    const prise = DERIVE * (1 + PRISE_DU_VENT * Math.min(1, Math.max(0, ventPart)))
    const w = { x: vent.x * prise, y: vent.y * prise }
    this.layer?.update(nowMs, densite, front, w, day, this.dernierePart, camera)
  }

  destroy(): void {
    this.layer?.destroy()
    this.layer = null
  }
}
