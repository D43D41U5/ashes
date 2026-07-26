/**
 * LA BRUME — un shader de NAPPES porté par une MARÉE (V1 « la marée de l'aube »,
 * choisie par Alexis le 2026-07-26 parmi trois variantes documentées).
 *
 * Le retour qui a tout réécrit : « toute blanche, elle ne progresse pas depuis l'eau vers le
 * rivage, frontière dure et droite autour de l'eau. » Le diagnostic (MESURÉ) : l'ancienne
 * assise ne connaissait que le bord du masque dilaté — jamais la distance à l'EAU — et posait
 * 98 % des cellules au-dessus du seuil : un drap laiteux uniforme, coupé au couteau.
 *
 * LA RECETTE NOUVELLE :
 *   • le masque porte un CHAMP DE DISTANCE À L'EAU (canal R, en quinzièmes de tuile, bâti au
 *     boot par l'appelant — le geste du champ de cendre : calculé une fois, jamais rangé).
 *     UNE lecture de texture par fragment, là où l'assise en sondait TREIZE ;
 *   • `uFront` est la MARÉE : la couverture est une rampe de ~2,5 tuiles derrière le front
 *     (`frontDeBrume(hour)` — fonction pure, testée), trouée par le bruit : le bord est un
 *     archipel de plaques qui épouse chaque méandre (c'est une iso-distance de la berge),
 *     jamais une droite. L'eau elle-même fume tant que le front vit ;
 *   • DEUX couches de bruit-valeur dérivent au vent (et sa perpendiculaire — la parallaxe
 *     interne fait le VOLUME), champ POSTÉRISÉ en crans francs : trous, corps, crêtes claires.
 *     Les seuils sont CALIBRÉS SUR LA MAQUETTE validée à l'œil (l'artefact aux 3 variantes) ;
 *   • le hash est un POLYNÔME DE PERMUTATION (34x²+x mod 289) — pas de `fract(sin·43758)` :
 *     c'était le seul risque réel de divergence SwiftShader/GPU identifié (range-reduction du
 *     sin sur de grands arguments). Le temps est replié CPU-côté pour la même raison ;
 *   • tout se décide par cellule de 4 px monde (le grain de l'art), masque NEAREST ;
 *   • sortie PRÉMULTIPLIÉE — le contrat du pipeline, PROUVÉ dans la source de Phaser 4.2.0
 *     (blend NORMAL = ONE, ONE_MINUS_SRC_ALPHA — du fixed-function, identique sur tout GPU).
 *
 * Deux consommatrices : la BRUME DU MATIN (champ = distance aux eaux/marais, front = la marée
 * horaire) et la COMBE BRUMEUSE (champ = distance à son empreinte, front constant — son halo).
 */
import Phaser from 'phaser'
import { TILE_PX } from '../../render/framing'

/** Le canal R du masque encode min(distance, DIST_FIELD_MAX)/DIST_FIELD_MAX — tuiles. */
export const DIST_FIELD_MAX = 15

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uMask;   // R : distance à l'eau (0 = l'eau), en 1/15 de tuile
uniform vec2 uWorldPx;
uniform vec2 uMapTiles;
uniform float uTilePx;
uniform vec2 uOff1;        // dérive INTÉGRÉE des nappes (tuiles) — ∫vent·dt côté CPU, replié
uniform vec2 uOff2;        // dérive intégrée des volutes (vent + perpendiculaire), replié
uniform float uDensity;    // 0..1 — l'heure (ou l'identité du lieu) décide
uniform float uFront;      // la MARÉE : tuiles gagnées depuis l'eau (0 = eau seule)
uniform float uDay;        // 0 nuit · 1 plein jour — LA NUIT ASSOMBRIT LA BRUME (revue du 26/07)

const float GRAIN = 4.0;    // le pixel de l'art : toute la brume se décide par cellule de 4 px
const float DIST_MAX = 15.0;
const float RAMPE = 2.5;    // la rampe du front, en tuiles — plus raide, il redevient une ligne

vec2 texUv(vec2 tile) { return vec2(tile.x / uMapTiles.x, 1.0 - tile.y / uMapTiles.y); }
// Au CENTRE du texel (revue : la première rangée de grain d'une tuile pouvait échantillonner
// le texel voisin en v, selon l'arrondi du GPU) — floor est la sémantique voulue (champ par
// tuile), +0,5 met le sample hors de portée de tout arrondi.
float distEau(vec2 tile) { return texture2D(uMask, texUv(floor(tile) + 0.5)).r * DIST_MAX; }

/** Hash SANS sinus : polynôme de permutation (34x²+x mod 289), domaine replié — le même
 *  résultat sur tout GPU, là où fract(sin·43758) divergeait selon la range-reduction.
 *  TROIS étages croisés (revue, MESURÉ) : à deux, 34 ≡ 0 (mod 17) rend le champ exactement
 *  invariant sous (+17, −17) cellules — le même archipel dupliqué en anti-diagonale toutes
 *  les 39 tuiles ; le troisième étage, resalé par p.x, brise l'invariance. */
float permute(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float cellHash(vec2 c) {
  vec2 p = mod(c, 289.0);
  return fract(permute(permute(permute(p.x) + p.y) + p.x) / 289.0);
}

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

  // LA MARÉE : couverture = rampe derrière le front. L'eau (dist < 0,5) garde un plancher —
  // elle fume du premier au dernier instant de la fenêtre, c'est la SOURCE, visible comme telle.
  float dist = distEau(tile);
  float couv = clamp((uFront - dist) / RAMPE, 0.0, 1.0);
  couv = min(1.0, couv + (1.0 - step(0.5, dist)) * 0.35);
  float d = uDensity * couv;
  if (d <= 0.008) discard;

  // DEUX COUCHES QUI NE VONT PAS DU MÊME PAS — le volume vient de là :
  //   les grosses nappes suivent le vent, lentement ; les volutes fines filent plus vite,
  //   déportées vers la perpendiculaire (la brume roule sur elle-même). Les offsets sont
  //   INTÉGRÉS côté CPU (revue, MESURÉ : uWind·t avec un vent VARIABLE faisait défiler le
  //   champ à w + t·dw/dt — 15× la consigne dès 10 min d'uptime, pire d'heure en heure).
  float nappes = vnoise((tile + uOff1) / 5.5);
  float volutes = vnoise((tile + uOff2 + vec2(17.3, 9.1)) / 2.3);
  float champ = nappes * 0.62 + volutes * 0.38;

  // LES CRANS — coefficients de la MAQUETTE validée : la densité de la marée OUVRE les
  // plaques (min(1, d·2,6)·0,55), le champ les DÉCOUPE (·0,65). Vers le front, d chute →
  // seules les cellules de champ fort survivent : le bord s'effrange plaque à plaque.
  float v = champ * 0.65 + min(1.0, d * 2.6) * 0.55 - 0.28;
  float lvl = floor(v * 4.0 + 0.5) / 4.0;
  if (lvl < 0.25) discard;
  float crete = step(0.72, lvl);
  float corps = step(0.48, lvl) * (1.0 - crete);
  float mince = 1.0 - corps - crete;

  vec3 teinte = vec3(0.84, 0.87, 0.91) * (0.93 + 0.07 * corps + 0.19 * crete);
  // LA NUIT L'ASSOMBRIT ICI — pas par le voile : en mode éclairé (le défaut), le voile descend
  // SOUS les sprites, donc sous la brume. MAIS l'aube éclaire la brume AVANT le sol (le ciel
  // l'allume par au-dessus) : l'éclat suit la RACINE du jour — mesuré à 6h12 : la version
  // linéaire (mix dès uDay=0,2) rendait la marée iso-luminante avec le sol de l'aube, delta
  // ~13 niveaux RGB, invisible à l'œil dans SA propre fenêtre. Le plancher nocturne reste
  // bleuté et au-dessus du noir pour que la Combe demeure une présence à 23h, pas un amer.
  float eclat = sqrt(clamp(uDay, 0.0, 1.0));
  teinte *= mix(vec3(0.42, 0.46, 0.60), vec3(1.0), eclat);
  // GARDE-FOU (revue, MESURÉ) : au-delà de d ≈ 0,45, min(1, d·2,6) sature ET corps rejoint
  // le plafond 0,72 — les crans fusionnent, le drap uniforme (« toute blanche ») revient.
  // Toute retouche de DENSITE_MAX (morning-mist) doit rester SOUS 0,45.
  float a = min(0.72, d * 2.2 * (0.34 * mince + 0.66 * corps + 0.9 * crete));
  // PRÉMULTIPLIÉ — le contrat du pipeline Phaser (prouvé dans la source : le blend NORMAL
  // du Shader GO est ONE, ONE_MINUS_SRC_ALPHA). Non prémultiplié = le mur blanc d'origine.
  gl_FragColor = vec4(teinte * a, a);
}
`

/** Périodes de repli des offsets, en TUILES : le bruit est périodique 289 cellules par axe,
 *  et une cellule vaut 5,5 (nappes) ou 2,3 (volutes) tuiles — le repli est SANS couture. */
const PERIODE_NAPPES = 289 * 5.5
const PERIODE_VOLUTES = 289 * 2.3

export class MistLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  private density = 0
  private front = 0
  private day = 1
  private wind = { x: 0.28, y: 0.1 }
  /** Dérives INTÉGRÉES (∫vent·dt, en tuiles) — voir la revue du 26/07 : multiplier un vent
   *  VARIABLE par l'uptime faisait défiler le champ de plus en plus vite, sans borne. */
  private off1 = { x: 0, y: 0 }
  private off2 = { x: 0, y: 0 }
  private lastMs: number | null = null

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
            setUniform('uOff1', [this.off1.x, this.off1.y])
            setUniform('uOff2', [this.off2.x, this.off2.y])
            setUniform('uDensity', this.density)
            setUniform('uFront', this.front)
            setUniform('uDay', this.day)
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

  /** Chaque frame : le vent fait dériver les nappes par INTÉGRATION (off += vent·dt, replié
   *  modulo la période exacte du bruit — sans couture, coordonnées bornées ~1 600 tuiles :
   *  la précision fp32 et le hash tiennent sur une session illimitée), la marée et la
   *  densité viennent de l'appelant, le jour (daylight) décide de la teinte. */
  update(nowMs: number, density: number, front: number, wind?: { x: number; y: number }, day = 1): void {
    // dt borné : une frame hoquetée (onglet en arrière-plan) ne téléporte pas le champ.
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000))
    this.lastMs = nowMs
    if (wind) this.wind = wind
    const w = this.wind
    const plie = (v: number, periode: number): number => ((v % periode) + periode) % periode
    this.off1.x = plie(this.off1.x + w.x * 0.55 * dt, PERIODE_NAPPES)
    this.off1.y = plie(this.off1.y + w.y * 0.55 * dt, PERIODE_NAPPES)
    // Les volutes : plus vite que les nappes, déportées vers la perpendiculaire du vent.
    this.off2.x = plie(this.off2.x + (w.x * 1.1 - w.y * 0.7) * dt, PERIODE_VOLUTES)
    this.off2.y = plie(this.off2.y + (w.y * 1.1 + w.x * 0.7) * dt, PERIODE_VOLUTES)
    this.density = density
    this.front = front
    this.day = day
    this.shader?.setVisible(density > 0.003)
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
  }
}

/** LA BRUME COIFFE LE MONDE (retour d'Alexis : « au-dessus du personnage ») : au-dessus des
 *  houppiers, SOUS les oiseaux et le voile de nuit — la nuit l'assombrit comme le reste, et
 *  l'aube bleutée la teinte d'elle-même. Les BANCS voyageurs (V2), eux, vivent dans la bande
 *  des houppiers : c'est leur raison d'être — passer devant un arbre, derrière l'autre. */
export const MIST_DEPTH = 1_020_000
