/**
 * LES CINQ CIELS — le front météo, peint (spec `meteo.md` R1-R7, tranche de rendu).
 *
 * La sim fait traverser la vallée par une BANDE (`frontMeteoPos`) dont l'intensité monte en
 * rampe du bord vers le cœur (`meteoIntensityAt`). Sept tranches l'ont rendue mordante — le
 * froid, la faim du feu, le silence du gibier, le pas alourdi, les yeux voilés, la foudre —
 * et RIEN ne se voyait. Voici ce qui se voit.
 *
 * ═══ LA BANDE EST UNE GÉOMÉTRIE DU MONDE, PAS UN FILTRE PLEIN ÉCRAN ═══
 *
 * C'est tout le design du contrat « annoncé, pas surprise » : le mur de pluie à l'horizon EST
 * l'annonce. Le fragment lit donc sa position MONDE, en déduit `d = min(c − lo, hi − c)` et
 * l'intensité par la MÊME loi que la sim — `meteoIntensityAt`, importée de `/sim`, pas
 * recopiée : on voit la lisière approcher, on la traverse, on la regarde s'éloigner derrière
 * soi, et le sol sous la pluie est exactement le sol que la sim refroidit. Une seconde formule
 * écrite ici aurait divergé au premier calibrage.
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
 * ═══ LA RECETTE EST CELLE DE LA MAISON ═══
 *
 *   • UN seul objet `Shader` plein-monde, une passe — pas de post-FX (il rendrait blanc sous
 *     swiftshader, et coûterait le seul juge visuel du projet), pas de nuée de sprites (la
 *     machine n'a pas de GPU : tout est logiciel) ;
 *   • tout se décide par cellule de 4 px monde — LE GRAIN DE L'ART. Gouttes, flocons et
 *     voile sont des CARRÉS DURS alignés sur la grille, jamais un dégradé lissé ;
 *   • le hash est le polynôme de permutation de la brume (34x²+x mod 289), jamais un
 *     `fract(sin·43758)` : c'est le seul risque réel de divergence swiftshader/GPU ;
 *   • le temps est REPLIÉ côté CPU et la dérive INTÉGRÉE (`off += vitesse·dt`) — un `uT`
 *     multiplié par un vent variable accélère sans borne (bug MESURÉ de la brume, ×15 à
 *     10 min d'uptime) ;
 *   • sortie PRÉMULTIPLIÉE : `vec4(teinte·a, a)` — le contrat du pipeline Phaser 4 (blend
 *     NORMAL = ONE, ONE_MINUS_SRC_ALPHA, du fixed-function). Non prémultiplié = le mur blanc ;
 *   • blend NORMAL et pas MULTIPLY, DÉLIBÉRÉMENT : la doctrine du voile de nuit partage la
 *     lumière (qui multiplie) de la MATIÈRE en suspension (qui se mêle et a le droit de
 *     relever les noirs). La pluie, la neige et le brouillard sont de la matière entre l'œil
 *     et le monde — exactement l'air d'une zone. C'est la nuit qui les assombrit, par `uDay`,
 *     comme la brume s'assombrit elle-même.
 *
 * ═══ CINQ CIELS QUI SE NOMMENT SANS HUD ═══
 *
 * Deux joueurs doivent pouvoir se dire « c'est de la neige ». On sépare donc sur TROIS axes à
 * la fois, jamais sur la seule teinte : la FORME du grain (traits étirés / points carrés /
 * rien), sa VITESSE (la pluie file, le flocon flâne, le blizzard rase), et le VOILE de fond
 * (sombre bleuté pour la pluie et l'orage, gris pâle pour le brouillard, blanc pour la neige,
 * blanc opaque pour le blizzard).
 */
import Phaser from 'phaser'
import { METEO, frontMeteoPos, meteoIntensityAt, type MeteoFront, type MeteoType } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'

/**
 * ENTRE L'ŒIL ET TOUT LE RESTE. Au-dessus du voile d'ambiance dans ses DEUX modes (8 en
 * éclairé, 1 100 000 sinon) : la pluie tombe devant le monde, pas dans une strate du monde.
 * Elle s'assombrit donc elle-même la nuit (`uDay`), comme la brume — sous le voile, elle aurait
 * été éteinte par le multiply au lieu d'être une matière qu'on regarde à travers.
 * Sous les lucioles (1 250 000) et loin sous l'overlay du HUD.
 */
export const METEO_DEPTH = 1_120_000

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
uniform vec2 uDrift;    // derive INTEGREE cote CPU (cellules) — jamais vitesse x uptime
uniform vec2 uSouffle;  // derive LENTE du voile, integree et repliee de meme
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

  bool pluie = uType < 0.5;
  bool brouillard = uType > 0.5 && uType < 1.5;
  bool neige = uType > 1.5 && uType < 2.5;
  bool orage = uType > 2.5 && uType < 3.5;
  bool blizzard = uType > 3.5;
  bool mouille = pluie || orage;          // ce qui TOMBE en traits
  bool flocon = neige || blizzard;        // ce qui tombe en points

  // ── LE VOILE : la matiere en suspension, propre a chaque ciel. ──
  // Il RESPIRE par grandes plaques — sans quoi c'est un aplat mort. Sur sa PROPRE derive
  // (uSouffle, lente), pas sur celle de la pluie : les nappes d'un ciel ne filent pas a la
  // vitesse des gouttes, et les accrocher au meme compteur aurait fait respirer le
  // brouillard (qui ne tombe pas) au rythme du blizzard.
  float houle = vnoise(cell / 26.0 + uSouffle);
  vec3 teinteVoile;
  float voile;
  if (brouillard) {
    // LE BROUILLARD : dense, PALE, sans grain qui tombe — c'est son signalement. Il mange
    // la distance, il n'assombrit pas (COLD.brouillard = 0 : le ciel dit la meme chose).
    teinteVoile = vec3(0.78, 0.80, 0.82);
    voile = (0.34 + 0.20 * houle) * I;
  } else if (blizzard) {
    // LE BLIZZARD : le blanc qui efface. Le voile le plus lourd des cinq — on ne voit plus
    // ou l'on va, et c'est la CONSEQUENCE DE JEU du type le plus letal (COLD 55).
    teinteVoile = vec3(0.88, 0.90, 0.94);
    voile = (0.40 + 0.18 * houle) * I;
  } else if (neige) {
    teinteVoile = vec3(0.80, 0.84, 0.90);
    voile = (0.16 + 0.09 * houle) * I;
  } else if (orage) {
    // L'ORAGE : le plus SOMBRE des cinq — l'ardoise sous laquelle la foudre se lit.
    teinteVoile = vec3(0.11, 0.13, 0.19);
    voile = (0.40 + 0.12 * houle) * I;
  } else {
    // LA PLUIE : une ardoise bleutee, plus claire que l'orage.
    teinteVoile = vec3(0.18, 0.21, 0.29);
    voile = (0.30 + 0.10 * houle) * I;
  }

  vec3 teinte = teinteVoile;
  float a = voile;

  // ── LE GRAIN QUI TOMBE : des CARRES DURS sur la grille de l'art, jamais un degrade. ──
  //
  // Pas de bruit LISSE ici — vnoise interpole entre ses cellules et rend des taches molles
  // (MESURE sur la premiere planche : la neige lisait « nappe de brume », pas « flocons »).
  // On hache la CELLULE ELLE-MEME : chaque cellule de 4 px tire son propre nombre, donc
  // chaque grain est un carre plein a bord franc.
  //
  // LA LONGUEUR DU TRAIT vient du REGROUPEMENT : LY cellules alignees partagent un hash,
  // donc une colonne de LY carres s'allume ensemble — un trait de pluie. Le blizzard
  // regroupe en X (il RASE), la neige ne regroupe pas (des points). C'est ce qui nomme le
  // ciel de loin, avant meme la couleur.
  //
  // Le motif DERIVE en translatant la grille entiere (cell + uDrift, puis floor) : il
  // avance d'une cellule d'art a la fois — la seule facon honnete de faire tomber de la
  // pluie en pixel art, et la garantie qu'aucun grain ne grouille sur place.
  if (mouille || flocon) {
    vec2 p = floor(cell + uDrift);
    float LX = blizzard ? 7.0 : 1.0;             // le blizzard couche ses flocons
    float LY = mouille ? 7.0 : 1.0;              // la pluie etire ses gouttes en traits
    float TAILLE = flocon ? 2.0 : 1.0;           // le flocon est plus gros que la goutte
    vec2 bloc = vec2(floor(p.x / (LX * TAILLE)), floor(p.y / (LY * TAILLE)));
    float h = cellHash(bloc);

    // Le seuil FAIT la densite : la couverture vaut exactement 1 − seuil (le hash est
    // uniforme). Il MONTE quand l'intensite tombe : sur la rampe, quelques traits epars ;
    // au coeur, le rideau plein. Une pente, jamais un interrupteur.
    //
    // CES NOMBRES SONT MESURES, PAS CHOISIS. Premiere planche : la pluie couvrait 48 % de
    // l'ecran de traits CLAIRS, et son eclaircissement annulait exactement l'assombrissement
    // du voile — Δµ = −0,4 contre le sol nu, σ/µ 0,222 contre 0,229 : une pluie rigoureusement
    // invisible aux nombres comme a l'oeil. On rarefie (16 % pour la pluie) et on baisse
    // l'opacite du trait : le voile redevient ce qui porte le type, le grain ce qui le nomme.
    float base = blizzard ? 0.62 : (orage ? 0.80 : (neige ? 0.86 : 0.84));
    float seuil = base + (1.0 - I) * (1.0 - base) * 0.85;
    if (h > seuil) {
      // DEUX CRANS D'OPACITE, pas une rampe : le grain proche est franc, le lointain
      // s'efface — c'est la profondeur, et ca reste des carres pleins (patron des crans
      // de la brume, qui posterise pour la meme raison).
      float fort = step(seuil + (1.0 - seuil) * 0.55, h);
      float aGrain = (mouille ? 0.24 + 0.30 * fort : 0.44 + 0.44 * fort) * I;
      vec3 tGrain = mouille ? vec3(0.70, 0.78, 0.92) : vec3(0.98, 0.99, 1.0);
      // COMPOSITION « OVER » du grain SUR le voile — le grain est devant la matiere.
      // En non-premultiplie : a' = ag + av(1-ag) ; C' = (Cg·ag + Cv·av(1-ag)) / a'.
      // (La premultiplication n'arrive qu'au gl_FragColor final, une seule fois.)
      float na = aGrain + a * (1.0 - aGrain);
      teinte = (tGrain * aGrain + teinte * a * (1.0 - aGrain)) / max(0.001, na);
      a = na;
    }
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

/** La vitesse de chute par type, en cellules/s (x = dérive latérale, y = chute). Le blizzard
 *  RASE (latéral > chute), le flocon flâne, la goutte file. C'est le deuxième axe de
 *  reconnaissance après la forme : on nomme un ciel à sa vitesse. */
const VITESSE: Record<MeteoType, { x: number; y: number }> = {
  pluie: { x: 2.4, y: 26 },
  brouillard: { x: 0.4, y: 0.6 },
  neige: { x: 1.2, y: 4.2 },
  orage: { x: 3.6, y: 31 },
  blizzard: { x: 26, y: 7 },
}

export class MeteoLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  private drift = { x: 0, y: 0 }
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
            setUniform('uDrift', [this.drift.x, this.drift.y])
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
  }

  /**
   * Chaque frame. `front` est le RECORD D'ÉLECTION du snapshot (ou rien) ; la bande, elle,
   * se RECALCULE du tick par `frontMeteoPos` — la même fonction que la sim interroge pour
   * décider qui a froid. `flash` vient de la foudre (voir `foudre-fx`), `joueur` sert la
   * sonde d'intensité.
   */
  update(
    nowMs: number,
    front: MeteoFront | null,
    tick: number,
    day: number,
    flash: number,
    joueur: { x: number; y: number },
  ): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000))
    this.lastMs = nowMs

    const bande = front ? frontMeteoPos(front, tick, this.mapWidth, this.mapHeight) : null
    if (!front || !bande) {
      this.intensiteAuJoueur = 0
      this.bande = null
      this.shader?.setVisible(false)
      return
    }
    this.bande = bande

    this.axis = bande.axis === 'x' ? 0 : 1
    this.lo = bande.lo
    this.hi = bande.hi
    this.rampe = METEO.RAMPE * METEO.LARGEUR[front.type]
    this.type = TYPE_INDEX[front.type]
    this.day = day
    this.flash = flash

    // LA DÉRIVE EST INTÉGRÉE ET REPLIÉE — jamais `vitesse × uptime` (voir l'en-tête).
    const v = VITESSE[front.type]
    const plie = (u: number): number => ((u % PERIODE) + PERIODE) % PERIODE
    this.drift.x = plie(this.drift.x + v.x * dt)
    this.drift.y = plie(this.drift.y + v.y * dt)
    // Le voile dérive lentement, replié sur la MÊME période exacte du bruit (289 cellules) :
    // sans couture, et borné pour une session illimitée. Un repli sur une valeur arbitraire
    // (« modulo 1 s ») ferait sauter le champ à chaque tour — le bruit n'est périodique QUE
    // sur 289.
    this.souffle.x = plie(this.souffle.x + 0.55 * dt)
    this.souffle.y = plie(this.souffle.y + 0.31 * dt)

    // La sonde : LA fonction de la sim, pas une copie — c'est le même nombre qui décide
    // du froid qu'il prend et du rideau qu'il voit.
    this.intensiteAuJoueur = meteoIntensityAt(front, tick, this.mapWidth, this.mapHeight, joueur.x, joueur.y)

    this.shader?.setVisible(true)
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
  }
}
