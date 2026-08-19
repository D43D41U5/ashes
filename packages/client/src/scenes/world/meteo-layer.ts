/**
 * LES CINQ CIELS — le front météo, peint (spec `meteo.md` R1-R7, tranche de rendu).
 *
 * La sim fait traverser la vallée par une BANDE (`frontMeteoPos`) dont l'intensité monte en
 * rampe du bord vers le cœur (`meteoIntensityAt`). Sept tranches l'ont rendue mordante — le
 * froid, la faim du feu, le silence du gibier, le pas alourdi, les yeux voilés, la foudre —
 * et RIEN ne se voyait. Voici ce qui se voit.
 *
 * ═══ LE PARTAGE : LES PARTICULES PORTENT LE GRAIN, LE SHADER PORTE LE VOILE ═══
 *
 * Deux choses tombent sous les yeux d'un joueur, et elles n'ont pas la même nature :
 *
 *   • LE VOILE — la teinte atmosphérique, la matière en suspension. C'est un CHAMP : il
 *     couvre tout le cadre, il porte le gradient spatial de la bande et la lecture du type.
 *     Un `Shader` plein-monde le rend en une passe pour un coût quasi nul, et il reste ici.
 *   • LE GRAIN — les gouttes et les flocons. Ce sont des OBJETS : ils ont une masse, une
 *     vitesse limite, une phase propre, et ils touchent le sol. Ils vivent désormais dans
 *     `meteo-particules.ts` (physique pure, testée headless) et se peignent ici.
 *
 * ═══ POURQUOI ON EST REVENU SUR « PAS DE SPRITES » ═══
 *
 * La première recette évitait les sprites, et pour une raison SÉRIEUSE : cette machine n'a
 * pas de GPU (swiftshader, rendu logiciel). Le grain était donc un motif de shader — un hash
 * par cellule de 4 px, une grille translatée. Ça tombait droit, tout à la même vitesse, sans
 * masse et sans air, et la longueur du trait venait d'un REGROUPEMENT de cellules, pas d'une
 * vitesse.
 *
 * CE QUI EST **MESURÉ** (2026-08-19) — deux instruments, et il en fallait deux :
 *
 *   • CE QUE LA COUCHE PREND SUR LE FIL PRINCIPAL (`smoke --scenario meteocout`, chronomètre
 *     interne `sonde.msPhysique` / `.msPeinture`). Au budget livré (650, marge 1,5 tuile) :
 *     **la pluie tient 543 particules pour 0,775 ms/image** (0,525 de physique + 0,25 de
 *     peinture, 543 rectangles), et elle n'est PAS plafonnée. Au budget d'avant (900, marge
 *     3 tuiles), la même pluie coûtait **2,2 ms/image** — le plafond que la demande fixait —
 *     et trois types sur quatre TAPAIENT le budget, donc peignaient un rideau que le budget
 *     décidait au lieu du front. C'est ce relevé qui a fait baisser les deux constantes.
 *     (Neige 662 particules → 0,75 ms ; orage 900 → 0,60 ms pour 1 800 rectangles ;
 *     blizzard 900 → 0,25 ms — mesures prises à l'ancien budget, à refaire au besoin.)
 *
 *   • CE QUE ÇA DONNE À L'ÉCRAN (`smoke --scenario meteo`, TROIS étalons au même endroit et
 *     à la même heure — ciel nu / voile seul / voile + particules ; deux n'auraient pas
 *     suffi, voir le scénario). Sous la pluie, au cœur, à midi : **µ 117,7 contre 135,3 au
 *     ciel nu (Δ −17,6), σ/µ 0,266 contre 0,252** — le ciel assombrit ET contraste. Contre
 *     le VOILE SEUL, le grain pèse **Δµ +5,4** : il ÉCLAIRCIT, comme il doit (des traits
 *     pâles sur une ardoise), et c'est ce troisième étalon qui le prouve — contre le sol nu
 *     seul, les deux effets se seraient partiellement annulés, exactement le piège que la
 *     recette précédente avait payé (Δµ = −0,4, « une pluie invisible aux nombres »).
 *     La LISIÈRE se voit : marche de luminance −11,9 (−16,2 dedans, −4,3 dehors).
 *
 * CE QU'ON N'A PAS PU MESURER ICI, et il faut le dire : le COÛT EN IMAGES PAR SECONDE. Sur
 * ce poste, pendant que d'autres sessions compilaient, un ciel NU a été relevé à **937 ms
 * par image** — un surcoût de deux millisecondes s'y noie, et le relevé a rendu « voile
 * 1 041 contre plein 1 011 », c'est-à-dire des particules au coût NÉGATIF. D'où le
 * chronomètre interne, qui mesure la couche et non la machine.
 *
 * CE QUI N'EST QUE **SUSPECTÉ**, et qu'il faut dire : que retirer la branche de grain du
 * fragment ait RENDU du temps. L'interrupteur de mesure (`grainActif`) éteint les
 * PARTICULES, pas l'ancien fragment — celui-ci n'existe plus, et personne n'a remesuré la
 * branche de `main`. Le raisonnement (le fragment shadait ~920 000 fragments par image avec
 * un hash de permutation ET un `vnoise` par pixel, quand le rideau de particules en couvre
 * deux ordres de grandeur de moins) est de l'ARITHMÉTIQUE, pas un relevé. Le budget
 * (`BUDGET_PARTICULES`) reste la constante qu'on baisse si le chiffre mesuré remonte.
 *
 * ═══ CE QUI RESTE DE LA RECETTE DE LA MAISON ═══
 *
 *   • pas de post-FX (il rendrait blanc sous swiftshader, et coûterait le seul juge visuel
 *     du projet) — ni pour le voile ni pour le grain ;
 *   • TOUT est quantifié sur la grille de 4 px MONDE — le grain de l'art. Gouttes, flocons,
 *     éclaboussures et voile sont des CARRÉS DURS, jamais un dégradé lissé, jamais un
 *     rectangle tourné (qui baverait en bords lissés : la traînée inclinée se peint en
 *     ESCALIER, voir `traineeEnRuns`). CE QUE ÇA COÛTE, et c'est le nombre qui décide du
 *     budget : la pluie rend **UN** rectangle par goutte (MESURÉ : `rects` = `vivantes`,
 *     863 pour 863) parce que sa pente `vent/vLimite` vaut 0,09 — sur quatre cellules,
 *     l'escalier ne change jamais de colonne. Monter `vent` casserait ça en silence : le
 *     test `meteo-particules.test.ts` plafonne à TROIS rectangles par goutte pour les
 *     quatre profils réels, c'est là que ça se verra ;
 *   • l'opacité va par CRANS — deux, lointain et proche — jamais en rampe : le patron de la
 *     brume, qui postérise pour la même raison ;
 *   • le hash du voile est le polynôme de permutation de la brume (34x²+x mod 289), jamais un
 *     `fract(sin·43758)` : c'est le seul risque réel de divergence swiftshader/GPU ;
 *   • le souffle du voile est REPLIÉ côté CPU et INTÉGRÉ (`off += vitesse·dt`) — un `uT`
 *     multiplié par un vent variable accélère sans borne (bug MESURÉ de la brume, ×15 à
 *     10 min d'uptime) ;
 *   • sortie PRÉMULTIPLIÉE : `vec4(teinte·a, a)` — le contrat du pipeline Phaser 4 (blend
 *     NORMAL = ONE, ONE_MINUS_SRC_ALPHA, du fixed-function). Non prémultiplié = le mur blanc ;
 *   • blend NORMAL et pas MULTIPLY, DÉLIBÉRÉMENT : la doctrine du voile de nuit partage la
 *     lumière (qui multiplie) de la MATIÈRE en suspension (qui se mêle et a le droit de
 *     relever les noirs). La pluie, la neige et le brouillard sont de la matière entre l'œil
 *     et le monde — exactement l'air d'une zone. C'est la nuit qui les assombrit, par `uDay`,
 *     comme la brume s'assombrit elle-même ; le grain, lui, est assombri ICI par la MÊME
 *     formule, écrite une seconde fois en connaissance de cause (`teinteDeNuit`) parce qu'il
 *     est au-dessus du voile d'ambiance et que rien d'autre ne l'éteindrait.
 *
 * ═══ UNE LIMITE, MESURÉE, QU'IL FAUT DIRE ═══
 *
 * La rampe vaut `RAMPE × LARGEUR` : 9 tuiles pour la pluie (la lisière traverse l'écran en
 * un quart de sa largeur — elle se VOIT venir), mais 240 pour le blizzard, dont la bande fait
 * la carte entière. L'écran en montre ~35 : le blizzard n'a donc PAS de lisière lisible, par
 * construction et non par défaut de rendu — c'est le « carte entière par calibrage » de R1, et
 * R9 le compense en l'annonçant la veille au crépuscule. Les autres types, eux, tiennent le
 * contrat géométriquement.
 *
 * ═══ CINQ CIELS QUI SE NOMMENT SANS HUD ═══
 *
 * Deux joueurs doivent pouvoir se dire « c'est de la neige ». On sépare donc sur TROIS axes à
 * la fois, jamais sur la seule teinte : la FORME du grain (traits étirés dans le sens de la
 * vitesse / carrés qui tanguent / rien), sa PHYSIQUE (la goutte file à 9 tuiles/s quasi
 * verticale, le flocon flâne à 1,2 en flottant, le blizzard RASE — son vent dépasse sa
 * chute), et le VOILE de fond (sombre bleuté pour la pluie et l'orage, gris pâle pour le
 * brouillard, blanc pour la neige, blanc opaque pour le blizzard).
 */
import Phaser from 'phaser'
import { frontMeteoPos, meteoIntensityAt, type MeteoFront, type MeteoType } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'
import {
  BUDGET_PARTICULES,
  ChampParticules,
  ECLABOUSSURE_MS,
  GRAIN_PX,
  PROFILS,
  rampeDe,
  traineeEnRuns,
  type ProfilChute,
  type Run,
} from './meteo-particules'

/**
 * ENTRE L'ŒIL ET TOUT LE RESTE. Au-dessus du voile d'ambiance dans ses DEUX modes (8 en
 * éclairé, 1 100 000 sinon) : la pluie tombe devant le monde, pas dans une strate du monde.
 * Elle s'assombrit donc elle-même la nuit (`uDay`), comme la brume — sous le voile, elle aurait
 * été éteinte par le multiply au lieu d'être une matière qu'on regarde à travers.
 * Sous les lucioles (1 250 000) et loin sous l'overlay du HUD.
 */
export const METEO_DEPTH = 1_120_000

/** LE GRAIN EST DEVANT LE VOILE — il tombe *dans* la matière, pas derrière elle. Un cran
 *  au-dessus, et toujours sous les lucioles. */
export const METEO_GRAIN_DEPTH = METEO_DEPTH + 500

/** L'ordre des types dans l'uniforme `uType` — le fragment branche dessus. */
const TYPE_INDEX: Record<MeteoType, number> = { pluie: 0, brouillard: 1, neige: 2, orage: 3, blizzard: 4 }

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform vec2 uWorldPx;
uniform float uTilePx;
uniform float uAxis;    // 0 = la bande traverse en X · 1 = en Y
uniform float uLo;      // bord bas de la bande sur cet axe, en TUILES
uniform float uHi;      // bord haut
uniform float uRampe;   // RAMPE x LARGEUR, en tuiles — la pente bord vers coeur
uniform float uType;    // 0 pluie · 1 brouillard · 2 neige · 3 orage · 4 blizzard
uniform vec2 uSouffle;  // derive LENTE du voile, integree et repliee cote CPU
uniform float uDay;     // 0 nuit · 1 plein jour
uniform float uFlash;   // 0..1 — l'embrasement de l'eclair (l'orage seul)

const float GRAIN = 4.0;

float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float cellHash(vec2 c) {
  vec2 p = mod(c, 289.0);
  return fract(permute(permute(permute(p.x) + p.y) + p.x) / 289.0);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i);
  float b = cellHash(i + vec2(1.0, 0.0));
  float c = cellHash(i + vec2(0.0, 1.0));
  float d = cellHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  // Le monde a l'endroit (V texture monte, ty descend), PLANCHE au grain de l'art.
  vec2 worldPx = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uWorldPx;
  vec2 flatPx = floor(worldPx / GRAIN) * GRAIN;
  vec2 tile = flatPx / uTilePx;
  vec2 cell = flatPx / GRAIN;

  // ── L'INTENSITE : la loi de meteoIntensityAt, au mot pres (0 dehors, 1 au coeur). ──
  float c = uAxis < 0.5 ? tile.x : tile.y;
  float d = min(c - uLo, uHi - c);
  if (d <= 0.0) discard;
  float I = uRampe <= 0.0 ? 1.0 : min(1.0, d / uRampe);
  if (I <= 0.004) discard;

  bool brouillard = uType > 0.5 && uType < 1.5;
  bool neige = uType > 1.5 && uType < 2.5;
  bool orage = uType > 2.5 && uType < 3.5;
  bool blizzard = uType > 3.5;

  // ── LE VOILE, ET RIEN QUE LUI : la matiere en suspension, propre a chaque ciel.
  //
  // LE GRAIN N'EST PLUS ICI. Gouttes et flocons sont de VRAIES PARTICULES (module
  // meteo-particules.ts) : une branche de grain dans ce fragment les dessinerait une
  // SECONDE fois, et les deux motifs se battraient — l'un physique, l'autre translate.
  // (Pas d'accent grave dans ce commentaire : le fragment EST un template literal, et un
  //  backtick le fermerait — le build casse chez vite, pas chez tsc. Piege deja paye.)
  //
  // Il RESPIRE par grandes plaques — sans quoi c'est un aplat mort. Sur sa PROPRE derive
  // (uSouffle, lente) : les nappes d'un ciel ne filent pas a la vitesse des gouttes.
  float houle = vnoise(cell / 26.0 + uSouffle);
  vec3 teinte;
  float a;
  if (brouillard) {
    // LE BROUILLARD : dense, PALE, sans grain qui tombe — c'est son signalement, et c'est
    // pour ca qu'il n'a AUCUNE particule. Il mange la distance, il n'assombrit pas
    // (COLD.brouillard = 0 : le ciel dit la meme chose).
    teinte = vec3(0.78, 0.80, 0.82);
    a = (0.34 + 0.20 * houle) * I;
  } else if (blizzard) {
    // LE BLIZZARD : le blanc qui efface. Le voile le plus lourd des cinq — on ne voit plus
    // ou l'on va, et c'est la CONSEQUENCE DE JEU du type le plus letal (COLD 55).
    teinte = vec3(0.88, 0.90, 0.94);
    a = (0.40 + 0.18 * houle) * I;
  } else if (neige) {
    teinte = vec3(0.80, 0.84, 0.90);
    a = (0.16 + 0.09 * houle) * I;
  } else if (orage) {
    // L'ORAGE : le plus SOMBRE des cinq — l'ardoise sous laquelle la foudre se lit.
    teinte = vec3(0.11, 0.13, 0.19);
    a = (0.40 + 0.12 * houle) * I;
  } else {
    // LA PLUIE : une ardoise bleutee, plus claire que l'orage.
    teinte = vec3(0.18, 0.21, 0.29);
    a = (0.30 + 0.10 * houle) * I;
  }

  // ── LA NUIT ASSOMBRIT LE CIEL LUI-MEME (patron de la brume, meme raison) : la couche est
  // AU-DESSUS du voile d'ambiance, donc rien d'autre ne l'eteindrait. La racine du jour, pas
  // le jour : la pluie de l'aube s'allume avant le sol, comme la brume. ──
  float eclat = sqrt(clamp(uDay, 0.0, 1.0));
  teinte *= mix(vec3(0.30, 0.34, 0.46), vec3(1.0), eclat);

  // ── L'EMBRASEMENT DE L'ECLAIR : un CADRAGE, pas un FX de lumiere — il n'est donc pas
  // quantifie (un embrasement au grain baverait en bandes, exception assumee de la DA).
  // Il ne joue QUE sous l'orage, et il porte le ciel entier d'un coup. ──
  if (uFlash > 0.001) {
    float f = uFlash * (0.30 + 0.70 * I);
    teinte = mix(teinte, vec3(0.86, 0.89, 1.0), min(1.0, f * 1.6));
    a = a + (1.0 - a) * min(0.62, f * 0.72);
  }

  if (a <= 0.004) discard;
  gl_FragColor = vec4(teinte * a, a); // PREMULTIPLIE — le contrat du pipeline
}
`

/** Période de repli de la dérive, en CELLULES : le bruit est périodique 289 cellules par
 *  axe — replier là-dessus est sans couture, et borne les coordonnées pour l'éternité. */
const PERIODE = 289

/**
 * Le cadre d'émission est élargi de cette marge, en tuiles : une traînée dépasse par le haut,
 * et une particule qu'on ferait naître pile sur le bord y clignoterait.
 *
 * ELLE A ÉTÉ RÉDUITE DE 3 À 1,5 (MESURÉ) : à 3 tuiles, le cadre d'émission faisait 1 082
 * tuiles² pour 712 tuiles² VISIBLES — un tiers des particules tombait hors champ, payé plein
 * tarif en physique et en rectangles pour n'être jamais vu. 1,5 tuile couvre la plus longue
 * traînée (5 cellules de 4 px, soit 1,25 tuile) avec de quoi ne pas clignoter, et rien de plus.
 */
const MARGE_TUILES = 1.5

/** La fenêtre du chronomètre de la couche, en ms : assez longue pour lisser une image
 *  malheureuse, assez courte pour qu'un relevé du smoke n'attende pas. */
const CHRONO_FENETRE_MS = 1000

/**
 * LA NUIT SUR LE GRAIN — la MÊME formule que le fragment (`mix(nuit, blanc, sqrt(day))`),
 * écrite une seconde fois en connaissance de cause : le grain est peint par le CPU, il ne
 * traverse pas le shader, et il est au-dessus du voile d'ambiance qui aurait pu l'éteindre.
 * Deux écrivains pour une formule est une dette : elle est ici, nommée, et le test la garde.
 */
export function teinteDeNuit(teinte: readonly [number, number, number], day: number): number {
  const eclat = Math.sqrt(Math.max(0, Math.min(1, day)))
  const nuit = [0.3, 0.34, 0.46] as const
  let couleur = 0
  for (let i = 0; i < 3; i++) {
    const f = nuit[i]! + (1 - nuit[i]!) * eclat
    couleur = (couleur << 8) | Math.max(0, Math.min(255, Math.round(teinte[i]! * f)))
  }
  return couleur
}

export class MeteoLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  /** Le grain, peint en rectangles durs : un seul objet, deux crans d'opacité par ciel —
   *  donc deux `fillStyle` par image, pas neuf cents. */
  private grain: Phaser.GameObjects.Graphics
  private readonly champ = new ChampParticules()
  private readonly runs: Run[] = []
  private souffle = { x: 0, y: 0 }
  private lastMs: number | null = null
  private axis = 0
  private lo = 0
  private hi = 0
  private rampe = 1
  private type = 0
  private day = 1
  private flash = 0
  /** La dernière intensité calculée au point du joueur — la sonde du smoke, et rien d'autre
   *  ne la lit : le rendu se juge sur des pixels, pas sur une variable. */
  intensiteAuJoueur = 0
  /** LA BANDE EFFECTIVEMENT DESSINÉE ce frame, en tuiles — relue par le smoke pour aller SE
   *  PLACER dedans (au cœur) ou dessus (sur la lisière). C'est la couche qui rend compte de
   *  ce qu'elle peint : le harnais n'a pas à recalculer une géométrie qu'il ne dessine pas. */
  bande: { axis: 'x' | 'y'; lo: number; hi: number } | null = null
  /**
   * LA SONDE DU GRAIN — lue par le smoke, par rien d'autre. Une gerbe de deux images ne se
   * photographie pas : elle se COMPTE. `budget` est rappelé pour qu'un relevé dise contre
   * quoi il se juge, et `plafonne` dit si la cible a tapé le plafond (auquel cas le rideau
   * n'est plus proportionnel à l'intensité : c'est le budget qui parle).
   */
  readonly sonde = {
    vivantes: 0, cible: 0, rects: 0, eclaboussures: 0, eclabsTotal: 0,
    budget: BUDGET_PARTICULES, plafonne: false,
    /**
     * CE QUE LA COUCHE PREND SUR LE FIL PRINCIPAL, en ms par image — moyenne glissante sur
     * `FENETRE_MS` de physique (`champ.update`) et de peinture (les `fillRect`).
     *
     * POURQUOI SE CHRONOMÉTRER SOI-MÊME PLUTÔT QUE COMPTER LES IMAGES. Le relevé d'intervalles
     * d'images (`cadence`) mesure la MACHINE autant que la couche : sur ce poste, un ciel NU
     * a été relevé à 883 ms/image pendant que deux autres sessions compilaient — un surcoût de
     * 50 ms s'y noie, et un surcoût de 1 100 ms n'y veut rien dire. Le temps passé DANS la
     * couche, lui, reste lisible sous charge : c'est le nombre qui commande `BUDGET_PARTICULES`.
     * (Il ne couvre pas la rastérisation, qui vit chez swiftshader — d'où les deux instruments.)
     */
    msPhysique: 0,
    msPeinture: 0,
    images: 0,
  }
  /**
   * L'INTERRUPTEUR DU GRAIN — toujours vrai en jeu, BAISSÉ PAR LE SMOKE et par rien d'autre.
   *
   * Sans lui, on ne saurait pas ce que les particules coûtent : comparer « pas de ciel » à
   * « ciel complet » crédite les particules du temps que le VOILE prend (et du temps que la
   * branche de grain retirée du fragment a RENDU). Il faut trois étalons, pas deux — ciel nu,
   * voile seul, voile + grain — et c'est ce bouton qui donne le deuxième. Il sert aussi de
   * témoin optique : à même endroit et même heure, σ/µ doit MONTER quand on le relève.
   */
  grainActif = true

  constructor(
    scene: Phaser.Scene,
    private readonly mapWidth: number,
    private readonly mapHeight: number,
  ) {
    const worldW = mapWidth * TILE_PX
    const worldH = mapHeight * TILE_PX
    this.shader = scene.add
      .shader(
        {
          name: 'braises-meteo',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uWorldPx', [worldW, worldH])
            setUniform('uTilePx', TILE_PX)
            setUniform('uAxis', this.axis)
            setUniform('uLo', this.lo)
            setUniform('uHi', this.hi)
            setUniform('uRampe', this.rampe)
            setUniform('uType', this.type)
            setUniform('uSouffle', [this.souffle.x, this.souffle.y])
            setUniform('uDay', this.day)
            setUniform('uFlash', this.flash)
          },
        },
        0,
        0,
        worldW,
        worldH,
      )
      .setOrigin(0, 0)
      .setDepth(METEO_DEPTH)
      .setVisible(false)
    this.grain = scene.add.graphics().setDepth(METEO_GRAIN_DEPTH).setVisible(false)
  }

  /**
   * Chaque frame. `front` est le RECORD D'ÉLECTION du snapshot (ou rien) ; la bande, elle,
   * se RECALCULE du tick par `frontMeteoPos` — la même fonction que la sim interroge pour
   * décider qui a froid. `flash` vient de la foudre (voir `foudre-fx`), `joueur` sert la
   * sonde d'intensité, `camera` borne l'émission au cadre visible.
   */
  update(
    nowMs: number,
    front: MeteoFront | null,
    tick: number,
    day: number,
    flash: number,
    joueur: { x: number; y: number },
    camera: Phaser.Cameras.Scene2D.Camera,
  ): void {
    const dtMs = this.lastMs === null ? 0 : Math.min(250, Math.max(0, nowMs - this.lastMs))
    const dt = dtMs / 1000
    this.lastMs = nowMs

    const bande = front ? frontMeteoPos(front, tick, this.mapWidth, this.mapHeight) : null
    if (!front || !bande) {
      this.intensiteAuJoueur = 0
      this.bande = null
      this.shader?.setVisible(false)
      this.eteindreLeGrain()
      return
    }
    this.bande = bande

    this.axis = bande.axis === 'x' ? 0 : 1
    this.lo = bande.lo
    this.hi = bande.hi
    this.rampe = rampeDe(front.type)
    this.type = TYPE_INDEX[front.type]
    this.day = day
    this.flash = flash

    // Le voile dérive lentement, replié sur la période exacte du bruit (289 cellules) :
    // sans couture, et borné pour une session illimitée. Un repli sur une valeur arbitraire
    // (« modulo 1 s ») ferait sauter le champ à chaque tour — le bruit n'est périodique QUE
    // sur 289. La dérive INTÉGRÉE, jamais `vitesse × uptime` (voir l'en-tête).
    const plie = (u: number): number => ((u % PERIODE) + PERIODE) % PERIODE
    this.souffle.x = plie(this.souffle.x + 0.55 * dt)
    this.souffle.y = plie(this.souffle.y + 0.31 * dt)

    // La sonde : LA fonction de la sim, pas une copie — c'est le même nombre qui décide
    // du froid qu'il prend et du rideau qu'il voit. Une fois par image, pas par particule.
    this.intensiteAuJoueur = meteoIntensityAt(front, tick, this.mapWidth, this.mapHeight, joueur.x, joueur.y)

    this.shader?.setVisible(true)

    // ── LE GRAIN : de vraies particules, émises DANS LE CADRE seulement. ──
    const profil = PROFILS[front.type]
    if (!profil || !this.grainActif) { this.eteindreLeGrain(); return }
    const vue = camera.worldView
    const cadre = {
      x0: vue.x / TILE_PX - MARGE_TUILES,
      y0: vue.y / TILE_PX - MARGE_TUILES,
      x1: (vue.x + vue.width) / TILE_PX + MARGE_TUILES,
      y1: (vue.y + vue.height) / TILE_PX + MARGE_TUILES,
    }
    const t0 = performance.now()
    this.champ.update(dt, dtMs, profil, cadre, bande, this.rampe)
    const t1 = performance.now()
    this.peindre(profil, day)
    this.chronometrer(t1 - t0, performance.now() - t1, dtMs)
  }

  /** La moyenne glissante des deux temps, sur une fenêtre de `CHRONO_FENETRE_MS`. */
  private chronoPhysique = 0
  private chronoPeinture = 0
  private chronoImages = 0
  private chronoAge = 0
  private chronometrer(msPhysique: number, msPeinture: number, dtMs: number): void {
    this.chronoPhysique += msPhysique
    this.chronoPeinture += msPeinture
    this.chronoImages += 1
    this.chronoAge += dtMs
    if (this.chronoAge < CHRONO_FENETRE_MS) return
    const n = Math.max(1, this.chronoImages)
    this.sonde.msPhysique = this.chronoPhysique / n
    this.sonde.msPeinture = this.chronoPeinture / n
    this.sonde.images = this.chronoImages
    this.chronoPhysique = 0
    this.chronoPeinture = 0
    this.chronoImages = 0
    this.chronoAge = 0
  }

  private eteindreLeGrain(): void {
    if (this.sonde.vivantes === 0 && this.sonde.eclaboussures === 0 && !this.grain.visible) return
    this.champ.vider()
    this.grain.clear().setVisible(false)
    this.sonde.vivantes = 0
    this.sonde.cible = 0
    this.sonde.rects = 0
    this.sonde.eclaboussures = 0
    this.sonde.plafonne = false
    this.sonde.msPhysique = 0
    this.sonde.msPeinture = 0
    this.chronoPhysique = 0
    this.chronoPeinture = 0
    this.chronoImages = 0
    this.chronoAge = 0
  }

  /**
   * PEINDRE — des rectangles à bords francs alignés sur la grille de 4 px MONDE, groupés
   * par cran d'opacité (deux `fillStyle` par ciel, pas un par particule : chaque changement
   * de style rompt le lot).
   */
  private peindre(profil: ProfilChute, day: number): void {
    const g = this.grain.clear().setVisible(true)
    const couleur = teinteDeNuit(profil.teinte, day)
    const parTuile = TILE_PX / GRAIN_PX
    let rects = 0
    const crans: readonly (0 | 1)[] = [0, 1]
    for (const cran of crans) {
      g.fillStyle(couleur, profil.alpha[cran]!)
      const epaisseur = profil.taille[cran]!
      for (const p of this.champ.particules) {
        if (!p.vive || p.cran !== cran) continue
        // La QUANTIFICATION : la tête tombe sur la grille de l'art, en cellules de 4 px.
        const cx = Math.floor(p.x * parTuile)
        const cy = Math.floor(p.y * parTuile)
        // LA TRAÎNÉE EST PROPORTIONNELLE À LA VITESSE — `trainee` secondes de mouvement.
        // Le flocon (trainee = 0) reste un carré : le même nombre fait les deux.
        const L = profil.trainee === 0
          ? 1
          : Math.max(1, Math.round(Math.sqrt(p.vx * p.vx + p.vy * p.vy) * profil.trainee * parTuile))
        const n = traineeEnRuns(cx, cy, p.vx, p.vy, L, epaisseur, this.runs, 0)
        for (let i = 0; i < n; i++) {
          const r = this.runs[i]!
          g.fillRect(r.cx * GRAIN_PX, r.cy * GRAIN_PX, r.w * GRAIN_PX, r.h * GRAIN_PX)
        }
        rects += n
      }
    }

    // ── L'ÉCLABOUSSURE : deux pixels qui repartent À L'OPPOSÉ du point de chute (vers lui,
    //    ils se tasseraient sur la goutte), pendant deux ou trois images. Deux crans d'âge,
    //    jamais un fondu : c'est la DA, et à 90 ms un fondu ne se verrait pas de toute façon.
    for (const pas of [0, 1]) {
      g.fillStyle(couleur, pas === 0 ? profil.alpha[1]! : profil.alpha[0]!)
      for (const e of this.champ.eclaboussures) {
        if (!e.vive) continue
        const jeune = e.age * 2 < ECLABOUSSURE_MS
        if ((pas === 0) !== jeune) continue
        const cx = Math.floor(e.x * parTuile)
        const cy = Math.floor(e.y * parTuile)
        // Jeune : deux gouttelettes serrées. Vieille : plus écartées et remontées — la
        // couronne s'ouvre. Deux états, pas une interpolation.
        const d = jeune ? 1 : 2
        const h = jeune ? 0 : 1
        g.fillRect((cx - d) * GRAIN_PX, (cy - h) * GRAIN_PX, GRAIN_PX, GRAIN_PX)
        g.fillRect((cx + d) * GRAIN_PX, (cy - h) * GRAIN_PX, GRAIN_PX, GRAIN_PX)
        rects += 2
      }
    }

    this.sonde.vivantes = this.champ.vivantes
    this.sonde.cible = this.champ.cible
    this.sonde.rects = rects
    this.sonde.eclaboussures = this.champ.eclabsVivantes
    this.sonde.eclabsTotal = this.champ.eclabsTotal
    this.sonde.plafonne = this.champ.cible >= BUDGET_PARTICULES
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
    this.grain.destroy()
  }
}
