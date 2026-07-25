/**
 * LA BRUME — un shader de NAPPES, parce qu'une image plate ne suffisait pas.
 *
 * Retour d'Alexis (2026-07-25, en voyant la première nappe) : « on doit sentir que ça BOUGE
 * et qu'il y a du VOLUME. » La spec da-feeling R15 (« aucun shader si l'image suffit ») tombe
 * donc par son propre critère : l'image ne suffisait pas — c'est consigné.
 *
 * LA RECETTE, et c'est celle de l'eau (le seul autre shader du jeu — même langage) :
 *   • un champ CONTINU de deux couches de bruit-valeur qui DÉRIVENT à des vitesses et des
 *     directions différentes (le vent, et sa perpendiculaire) — c'est la parallaxe interne
 *     qui fait le VOLUME : les grosses nappes glissent lentement, les volutes fines filent ;
 *   • le champ est POSTÉRISÉ en crans francs (comme le clapot) : des TROUS où l'on voit le
 *     sol, un corps, des CRÊTES plus claires et plus denses — l'épaisseur qui prend la
 *     lumière. Les contours des crans GLISSENT continûment : on VOIT la brume marcher ;
 *   • tout se calcule par cellule de 4 px monde (le grain de l'art), masque NEAREST : les
 *     bords des nappes sont des marches, jamais un dégradé ;
 *   • près du bord du masque (la terre sèche), le champ s'amincit : la nappe s'effrange en
 *     plaques éparses au lieu de se couper au cutter.
 *
 * Deux consommatrices : la BRUME DU MATIN (masque = eaux+marais dilatés, densité pilotée par
 * l'heure) et la COMBE BRUMEUSE (masque = son empreinte, densité constante — son identité).
 */
import Phaser from 'phaser'
import { TILE_PX } from '../../render/framing'

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uMask;   // R : 1 = la brume a le droit d'exister ici
uniform vec2 uWorldPx;
uniform vec2 uMapTiles;
uniform float uTilePx;
uniform float uTime;       // secondes
uniform float uDensity;    // 0..1 — l'heure (ou l'identité du lieu) décide
uniform vec2 uWind;        // tuiles/s, lent — la direction du monde (fireFx la partage)

const float GRAIN = 4.0;   // le pixel de l'art : toute la brume se décide par cellule de 4 px

vec2 texUv(vec2 tile) { return vec2(tile.x / uMapTiles.x, 1.0 - tile.y / uMapTiles.y); }
float maskAt(vec2 tile) { return texture2D(uMask, texUv(tile)).r; }

float cellHash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }

/** Bruit-valeur lissé : le CHAMP est continu (les contours des crans glissent sans sauter) ;
 *  c'est la POSTÉRISATION qui rend les marches — même partage des rôles que le clapot. */
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
  // Le monde à l'endroit (V texture monte, ty descend), PLANCHÉ au grain : cellules de 4 px.
  vec2 worldPx = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uWorldPx;
  vec2 flatPx = floor(worldPx / GRAIN) * GRAIN;
  vec2 tile = flatPx / uTilePx;

  if (uDensity <= 0.003) discard;
  float m = maskAt(tile);

  // L'ASSISE — le masque sondé sur DEUX couronnes (±2 et ±5 tuiles) en plus du point : une
  // rampe en marches sur ~7 tuiles, qui DÉBORDE des deux côtés de la frontière du masque.
  // La première écriture coupait au couteau (discard à 0,5) — jugé trop franc (Alexis) :
  // plus de couteau, la brume MEURT en s'effrangeant, plaque à plaque.
  float pres = (maskAt(tile + vec2(2.0, 0.0)) + maskAt(tile - vec2(2.0, 0.0))
              + maskAt(tile + vec2(0.0, 2.0)) + maskAt(tile - vec2(0.0, 2.0))) * 0.25;
  float loin = (maskAt(tile + vec2(5.0, 0.0)) + maskAt(tile - vec2(5.0, 0.0))
              + maskAt(tile + vec2(0.0, 5.0)) + maskAt(tile - vec2(0.0, 5.0))
              + maskAt(tile + vec2(3.5, 3.5)) + maskAt(tile - vec2(3.5, 3.5))
              + maskAt(tile + vec2(3.5, -3.5)) + maskAt(tile - vec2(3.5, -3.5))) * 0.125;
  float assise = m * 0.4 + pres * 0.35 + loin * 0.25;
  if (assise < 0.08) discard;

  float t = uTime;
  // DEUX COUCHES QUI NE VONT PAS DU MÊME PAS — le volume vient de là :
  //   les grosses nappes suivent le vent, lentement ; les volutes fines filent plus vite,
  //   déportées vers la perpendiculaire (la brume roule sur elle-même).
  vec2 perp = vec2(-uWind.y, uWind.x);
  float nappes = vnoise((tile + uWind * t * 0.55) / 5.5);
  float volutes = vnoise((tile + uWind * t * 1.1 + perp * t * 0.7 + vec2(17.3, 9.1)) / 2.3);
  float h = nappes * 0.62 + volutes * 0.38;
  h += (assise - 1.0) * 0.7; // le pourtour s'amincit : les plaques y tombent une à une

  // LES CRANS : trous (on voit le sol), voile mince, corps, CRÊTE claire et dense.
  float lvl = floor(h * 4.0 + 0.5) / 4.0;
  if (lvl < 0.25) discard;
  float crete = step(0.72, lvl);
  float corps = step(0.48, lvl) * (1.0 - crete);
  float mince = (1.0 - corps - crete);

  vec3 teinte = vec3(0.84, 0.87, 0.91) * (0.93 + 0.07 * corps + 0.19 * crete);
  float a = uDensity * (0.5 * mince + 0.85 * corps + 1.2 * crete) * (0.35 + 0.65 * assise);
  a = clamp(a, 0.0, 0.6);
  // PRÉMULTIPLIÉ — le contrat du pipeline Phaser (prouvé à l'écran : la sortie non
  // prémultipliée rendait un MUR BLANC, le src ajouté brut). L'eau s'en tire sans le savoir
  // parce que son alpha frôle 1 ; à 0,3, nous, on le paie plein pot.
  gl_FragColor = vec4(teinte * a, a);
}
`

export class MistLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  private density = 0
  private timeS = 0
  private wind = { x: 0.35, y: 0.12 }

  constructor(scene: Phaser.Scene, maskKey: string, width: number, height: number, depth: number) {
    const worldW = width * TILE_PX
    const worldH = height * TILE_PX
    this.shader = scene.add
      .shader(
        {
          name: `braises-mist-${maskKey}`,
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uMask', 0)
            setUniform('uWorldPx', [worldW, worldH])
            setUniform('uMapTiles', [width, height])
            setUniform('uTilePx', TILE_PX)
            setUniform('uTime', this.timeS)
            setUniform('uDensity', this.density)
            setUniform('uWind', [this.wind.x, this.wind.y])
          },
        },
        0,
        0,
        worldW,
        worldH,
        [maskKey],
      )
      .setOrigin(0, 0)
      .setDepth(depth)
  }

  /** Chaque frame : le temps fait dériver les nappes, la densité vient de l'appelant. */
  update(nowMs: number, density: number, wind?: { x: number; y: number }): void {
    this.timeS = nowMs / 1000
    this.density = density
    if (wind) this.wind = wind
    this.shader?.setVisible(density > 0.003)
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
  }
}

/** LA BRUME COIFFE LE MONDE (retour d'Alexis : « au-dessus du personnage ») : au-dessus des
 *  houppiers, SOUS les oiseaux et le voile de nuit — la nuit l'assombrit comme le reste, et
 *  l'aube bleutée la teinte d'elle-même. */
export const MIST_DEPTH = 1_020_000
