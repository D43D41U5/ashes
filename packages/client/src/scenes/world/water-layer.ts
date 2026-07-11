/**
 * L'EAU — un vrai shader, sur un quad à l'échelle du monde.
 *
 * Le sol est un maillage dont les sommets sont SOULEVÉS par l'élévation
 * (`screenY = worldY·TILE − elev·H`, voir render/warp.ts). Un shader, lui, part
 * d'un pixel écran et doit retrouver la tuile dont il parle : il DÉFAIT donc le
 * cisaillement, par point fixe sur `ty = (screenY + elev(tx, ty)·H) / TILE`.
 *
 * Cette itération CONVERGE, et pas par chance : le warp garantit déjà qu'il ne se
 * replie pas (`assertNoFold`), c'est-à-dire que `screenY` est strictement
 * croissant en `ty` — ce qui revient exactement à dire que la dérivée de
 * l'itération est < 1. La garde qui protégeait le rendu du sol paie ici une
 * seconde fois. Près de l'eau, l'élévation est plate : deux tours suffiraient, on
 * en fait cinq.
 *
 * Le quad couvre le MONDE ENTIER (pas la vue) : plus rien à repositionner par
 * frame, et le GPU ne colorie de toute façon que les pixels à l'écran. Hors de
 * l'eau, le shader `discard` — on ne paie que la surface mouillée.
 *
 * AUCUNE logique de jeu ici : de l'habillage, et rien d'autre.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@braises/sim'
import { GROUND_MAP_DEPTH, RELIEF_H, TILE_PX } from '../../render/framing'
import { buildWaterField } from '../../render/water-field'

/** Juste au-dessus du sol (−1), sous l'ombre du relief (−0,5) : le versant qui
 *  tombe dans l'eau l'assombrit, comme il assombrit la berge. */
const WATER_DEPTH = GROUND_MAP_DEPTH + 0.25

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uField;    // R masque (binaire) · G élévation · B profondeur
uniform sampler2D uSeabed;   // le bake du terrain : le FOND, vu à travers l'eau
uniform vec2 uWorldPx;       // taille du monde, en pixels
uniform vec2 uMapTiles;      // taille du monde, en tuiles
uniform float uTilePx;
uniform float uReliefH;
uniform float uTime;         // secondes
uniform vec3 uSun;           // le soleil, en 3D — voir sunVector()
uniform float uDay;          // 0 nuit · 1 plein jour

/**
 * LA PERSPECTIVE. Le monde ne se lit PAS à la verticale : les arbres sont debout,
 * les acteurs sont des billboards, le relief est un cisaillement — tout dit une
 * caméra oblique, autour de 45°. Le plan de l'eau est donc vu EN FUITE, et une
 * ride circulaire doit y apparaître ÉCRASÉE de moitié sur l'axe Y.
 *
 * Un clapot isotrope se lit comme vu d'aplomb, et contredit tout le reste de
 * l'image — c'est le genre de faute qu'on ne sait pas nommer mais qu'on voit.
 * On évalue donc la houle dans un espace où Y est DILATÉ : les motifs, une fois
 * rendus, s'y retrouvent comprimés d'autant.
 */
const float YSQUASH = 2.0;
const vec2 PLANE = vec2(1.0, YSQUASH);

float maskAt(vec2 tile) { return texture2D(uField, tile / uMapTiles).r; }
float elevAt(vec2 tile) { return texture2D(uField, tile / uMapTiles).g; }

/**
 * LE LARGE. Le masque est binaire : sondé sur un anneau de quelques tuiles, sa
 * moyenne dit à quel point on est loin de la terre — 1 au milieu de l'eau, 0
 * contre la berge. C'est une distance au rivage, mais qui suit la berge au lieu
 * de suivre une grille, et elle ne coûte pas un canal de texture.
 *
 * Deux anneaux SERRÉS (1,2 et 2,4 tuiles), et c'est délibéré : la première
 * version mesurait sur cinq tuiles, si bien que dans une rivière large de dix
 * TOUT était « rivage » — l'écume couvrait la rivière entière et l'eau virait au
 * lait. Une berge est une ligne, pas un dégradé.
 */
float openness(vec2 tile) {
  const int N = 8;
  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    float a = 6.2831853 * float(i) / float(N);
    vec2 d = vec2(cos(a), sin(a));
    sum += maskAt(tile + d * 1.2) * 0.6;
    sum += maskAt(tile + d * 2.4) * 0.4;
  }
  return sum / float(N);
}

/**
 * LE CLAPOT. Pas une houle : un lac de montagne ne roule pas des vagues d'océan.
 * Six octaves courtes (longueurs d'onde de la demi-tuile à quelques tuiles) sous
 * un domaine deux fois déformé — c'est la déformation qui casse la grille. La
 * première version empilait quatre grandes ondes : on lisait des bandes en
 * diagonale, et l'œil repère une somme de sinusoïdes en une seconde.
 */
float chop(vec2 p, float t) {
  vec2 q = p + 0.30 * vec2(sin(p.y * 1.7 + t * 0.7), cos(p.x * 1.5 - t * 0.6));
  q += 0.16 * vec2(sin(q.y * 4.1 - t * 1.4), cos(q.x * 3.7 + t * 1.2));
  float h = 0.0;
  h += 0.50 * sin(dot(q, vec2(0.92, 0.39)) * 2.6 + t * 1.7);
  h += 0.34 * sin(dot(q, vec2(-0.44, 0.90)) * 4.3 - t * 2.3);
  h += 0.22 * sin(dot(q, vec2(0.31, -0.95)) * 7.1 + t * 3.1);
  h += 0.14 * sin(dot(q, vec2(0.80, 0.60)) * 11.3 - t * 4.2);
  h += 0.08 * sin(dot(q, vec2(-0.87, -0.49)) * 17.9 + t * 5.6);
  // TENU COURT. Une eau calme est d'abord une COULEUR ; le clapot est une texture
  // qu'on devine, pas un marbre qu'on lit. Toute la difficulté de cet effet est
  // là : chaque terme pris isolément semblait raisonnable, et leur somme peignait
  // des veines blanches. On divise donc à la sortie, une bonne fois.
  return h * 0.55;
}

void main() {
  // Pixel écran → position monde PLATE (le quad couvre le monde entier).
  vec2 flatPx = outTexCoord * uWorldPx;
  float tx = flatPx.x / uTilePx; // X n'est jamais cisaillé : exact.

  // On DÉFAIT le cisaillement du relief pour retrouver la tuile réelle.
  float ty = flatPx.y / uTilePx;
  for (int i = 0; i < 5; i++) {
    ty = (flatPx.y + elevAt(vec2(tx, ty)) * uReliefH) / uTilePx;
  }
  vec2 tile = vec2(tx, ty);
  vec2 uv = tile / uMapTiles;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec4 field = texture2D(uField, uv);
  float mask = field.r;

  // LE TRAIT DE RIVE. Le masque est binaire : en filtrage linéaire il croise 0,5
  // pile sur la frontière des tuiles. On y pose donc le bord de l'eau, net, et
  // l'eau ne déborde plus d'un demi-texel sur l'herbe.
  if (mask < 0.42) discard;
  float edge = smoothstep(0.42, 0.60, mask);

  float open = openness(tile);            // 0 contre la berge · 1 au large
  float deep = field.b * smoothstep(0.05, 0.55, open);
  float t = uTime;

  // Le clapot meurt sur les hauts-fonds : on ne clapote pas dans deux doigts d'eau.
  float amp = 0.35 + 0.65 * smoothstep(0.0, 0.45, open);
  vec2 p = tile * PLANE; // le plan de l'eau, redressé (voir YSQUASH)
  float h = chop(p, t) * amp;

  // La normale, par différences finies — prises DANS LE PLAN de l'eau, puis
  // ramenées à l'écran : la pente en Y y est vue de biais, donc raccourcie.
  float e = 0.06;
  float hx = (chop(p + vec2(e, 0.0), t) - chop(p - vec2(e, 0.0), t)) * amp;
  float hy = (chop(p + vec2(0.0, e), t) - chop(p - vec2(0.0, e), t)) * amp;
  vec3 n = normalize(vec3(-hx * 0.85, -hy * 0.85 / YSQUASH, 1.0));

  // LA RÉFRACTION. On rééchantillonne le FOND (le bake du terrain) décalé par la
  // normale : le fond ondule sous la surface. Le décalage s'annule contre la
  // berge — sinon il irait chercher l'herbe d'à côté et la peindrait dans l'eau.
  vec2 refr = tile + (n.xy / PLANE) * 0.55 * (1.0 - deep) * smoothstep(0.0, 0.4, open);
  vec3 bed = texture2D(uSeabed, refr / uMapTiles).rgb;

  vec3 shallowCol = vec3(0.17, 0.46, 0.53);
  vec3 deepCol = vec3(0.03, 0.12, 0.26);
  vec3 col = mix(shallowCol, deepCol, deep);
  col = mix(col, bed * 0.80, (1.0 - deep) * 0.28); // le fond transparaît, sans blanchir

  // Le VOLUME : une crête est plus claire qu'un creux. Presque rien, mais c'est ce
  // qui donne du relief à la surface avant même qu'on l'éclaire.
  col *= 1.0 + h * 0.09;

  // LE SOLEIL SUR L'EAU. Deux lobes — un large (le miroitement), un très serré
  // (les éclats). Et surtout : ILS NE BRILLENT QUE SUR LES CRÊTES.
  //
  // Sans cette porte, le spéculaire suit fidèlement les lignes de niveau des
  // ondes et peint de longues VEINES blanches continues — un marbre, pas une eau.
  // Le scintillement d'une vraie surface est fait de points brefs, là où une crête
  // présente sa face au soleil. La porte est ce qui transforme l'un en l'autre.
  vec3 L = normalize(vec3(uSun.x, uSun.y / YSQUASH, uSun.z));
  float lambert = max(dot(n, L), 0.0);
  float crest = smoothstep(0.30, 0.80, h);
  float sheen = pow(lambert, 40.0) * 0.035;
  float glint = pow(lambert, 300.0) * 0.34 * crest;
  col += vec3(1.0, 0.97, 0.88) * (sheen + glint) * uDay;

  // L'ÉCUME, et elle vient DE LA BERGE. Des lignes parallèles au rivage qui
  // avancent vers la terre : le clapot qui vient mourir sur la rive, et non un
  // liseré blanc collé au bord. C'est open qui sert d'abscisse — il croît
  // quand on s'éloigne de la berge, donc une phase en open donne des bandes qui
  // épousent la rive quelle que soit sa forme.
  float band = sin(open * 26.0 - t * 2.1 + h * 1.4);
  float lap = smoothstep(0.55, 1.0, band) * (1.0 - smoothstep(0.06, 0.30, open));
  float rim = 1.0 - smoothstep(0.0, 0.10, open); // le tout dernier centimètre
  col = mix(col, vec3(0.88, 0.93, 0.95), clamp(rim * 0.55 + lap * 0.60, 0.0, 0.8));

  // Translucide sur le gué, opaque au large : on voit où l'on passe.
  float a = mix(0.80, 0.95, deep) * edge;
  gl_FragColor = vec4(col, a);
}
`

/**
 * LE SOLEIL, EN TROIS DIMENSIONS. `lighting.sunDirection` ne rend qu'un vecteur
 * PLAN (et son `y` vaut toujours zéro) : il sert à savoir quel versant est à
 * l'ombre, pas à faire briller une surface. Nourrir un spéculaire avec lui
 * donnerait, à midi, une nappe intégralement blanche — le soleil au zénith y est
 * réduit au vecteur nul, que le shader lit comme « lumière droit devant ».
 *
 * Ici il faut une VRAIE direction : un azimut (d'où vient la lumière) ET une
 * hauteur. Au ras du matin, le soleil rase l'eau et la traîne d'éclats s'étire ;
 * à midi il tombe d'aplomb et toute la surface pétille. C'est la même heure qui
 * pilote les deux, mais ce n'est pas la même grandeur.
 */
function sunVector(hour: number): { x: number; y: number; z: number } {
  const h = ((hour % 24) + 24) % 24
  if (h <= 6 || h >= 18) return { x: 0, y: 0, z: 1 } // nuit : inerte (uDay l'éteint)
  const az = Math.PI * ((h - 6) / 12) // 0 = est (aube) → π = ouest (couchant)
  const alt = Math.sin(az) // 0 à l'horizon, 1 au zénith
  const grazing = 1 - 0.7 * alt
  return {
    x: Math.cos(az) * grazing,
    y: -0.3 * grazing, // le soleil est au sud : la lumière descend vers nous
    z: 0.3 + 0.85 * alt,
  }
}

export class WaterLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  private fieldKey: string | null = null

  constructor(
    private readonly scene: Phaser.Scene,
    map: WorldMap,
    /** La texture du terrain baké (1 px/tuile) — elle sert de FOND réfracté. */
    seabedKey: string,
  ) {
    const { width, height } = map
    const field = buildWaterField(map.terrain, map.elevation, width, height)
    if (!field.hasWater) return // une carte sèche ne paie pas une couche d'eau

    // Le champ vit dans une texture canvas : 1 px/tuile, comme le bake du sol.
    const key = 'water-field'
    this.fieldKey = key
    const tex = this.scene.textures.createCanvas(key, width, height)
    if (!tex) return
    const ctx = tex.getContext()
    const img = ctx.createImageData(width, height)
    img.data.set(field.data)
    ctx.putImageData(img, 0, 0)
    tex.refresh()
    // LINÉAIRE, contrairement au sol : ici on VEUT que le masque et l'élévation
    // s'interpolent. La berge devient une transition douce au lieu d'un escalier
    // de tuiles, et ça ne coûte rien — c'est le filtrage qui le fait.
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR)

    const worldW = width * TILE_PX
    const worldH = height * TILE_PX

    this.shader = this.scene.add
      .shader(
        {
          name: 'braises-water',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uField', 0)
            setUniform('uSeabed', 1)
            setUniform('uWorldPx', [worldW, worldH])
            setUniform('uMapTiles', [width, height])
            setUniform('uTilePx', TILE_PX)
            setUniform('uReliefH', RELIEF_H)
            setUniform('uTime', this.timeS)
            setUniform('uSun', [this.sun.x, this.sun.y, this.sun.z])
            setUniform('uDay', this.day)
          },
        },
        0,
        0,
        worldW,
        worldH,
        [key, seabedKey],
      )
      .setOrigin(0, 0)
      .setDepth(WATER_DEPTH)
  }

  private timeS = 0
  private sun = { x: 0, y: 0.3, z: 1 }
  private day = 1

  /** L'heure décide du soleil sur l'eau : d'où il vient, et à quelle hauteur. */
  update(nowMs: number, hour: number, daylight: number): void {
    if (!this.shader) return
    this.timeS = nowMs / 1000
    this.sun = sunVector(hour)
    this.day = daylight
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
    if (this.fieldKey) this.scene.textures.remove(this.fieldKey)
  }
}
