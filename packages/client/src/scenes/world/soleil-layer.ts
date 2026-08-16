/**
 * LES TACHES DE SOLEIL — la lumière du sous-bois (spec forets-vivantes §5 R6).
 *
 * Le jour, le sol des bois se mouchette de lumière : DENSE en lisière, éteint vers le cœur
 * (pente continue sur la profondeur — le canal existant de l'assombrissement, RENFORCÉ,
 * jamais un second langage), PLEIN dans les clairières (les chambres de lumière que A22
 * protège déjà de l'assombrissement). La recette est celle des brumes (`mist-layer`) :
 *
 *   • un MASQUE 1 px/tuile (canal R = densité de taches, bâti UNE fois au boot depuis
 *     `map.profondeur` + `clairiereForet` — le geste du champ de cendre) ;
 *   • tout se décide par cellule de 4 px monde (le grain de l'art), masque NEAREST ;
 *   • le hash est le polynôme de permutation de la brume (34x²+x mod 289) — jamais un
 *     `fract(sin·43758)` : le même archipel sur tout GPU ;
 *   • le FRÉMISSEMENT est une respiration d'ALPHA par tache (onde triangulaire sur un temps
 *     replié CPU-côté), JAMAIS un rayon qui bouge — la leçon des halos ;
 *   • la nuit éteint tout (fenêtre pure sur `uDay`, pente continue aux crépuscules) ;
 *   • sortie PRÉMULTIPLIÉE — le contrat du pipeline, le même que la brume.
 */
import Phaser from 'phaser'
import type { WorldMap } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'
import { masqueSoleil, type ArbreCouvert } from './soleil-masque'

/** Sur le sol, sous tout ce qui se pose dessus (FIRE_GROUND_DEPTH 4 < ici < FLOOR_DEPTH 6). */
export const SOLEIL_DEPTH = 5

const FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform sampler2D uMask;   // R : densité de taches (0 = pas de couvert, 1 = clairière)
uniform vec2 uWorldPx;
uniform vec2 uMapTiles;
uniform float uTilePx;
uniform float uSouffle;    // temps replié CPU-côté (0..1) — la respiration des taches
uniform float uDay;        // 0 nuit · 1 plein jour — la fenêtre de la lumière

const float GRAIN = 4.0;

vec2 texUv(vec2 tile) { return vec2(tile.x / uMapTiles.x, 1.0 - tile.y / uMapTiles.y); }
float densite(vec2 tile) { return texture2D(uMask, texUv(floor(tile) + 0.5)).r; }

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
  if (uDay <= 0.02) discard;
  vec2 worldPx = vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uWorldPx;
  vec2 flatPx = floor(worldPx / GRAIN) * GRAIN;
  vec2 tile = flatPx / uTilePx;

  float d = densite(tile);
  if (d <= 0.01) discard;

  // LES TACHES : un champ de bruit fin, seuillé par la densité — plus le couvert est épais,
  // plus le seuil monte et plus les taches se raréfient (et rapetissent : le seuil coupe
  // dans les mêmes collines de bruit). Le champ est STATIQUE — c'est la canopée, elle ne
  // marche pas — seule la respiration bouge.
  vec2 cell = flatPx / GRAIN;
  float champ = vnoise(cell / 3.2);
  float seuil = 1.0 - 0.38 * d; // d=1 (clairière) : seuil 0,62 ; d→0 : plus rien ne passe
  if (champ < seuil) discard;

  // LA RESPIRATION : chaque tache a sa phase (le hash de sa grappe), l'onde est TRIANGULAIRE
  // (abs(fract)-0,5) — pas de sinus, même raison que la brume. L'alpha respire, jamais la taille.
  float phase = cellHash(floor(cell / 6.0));
  float onde = 1.0 - 0.35 * abs(fract(uSouffle + phase) * 2.0 - 1.0);

  float force = (champ - seuil) / max(0.001, 1.0 - seuil); // 0 au bord de la tache, 1 au cœur
  float a = min(0.30, (0.10 + 0.16 * force) * onde) * uDay * (0.55 + 0.45 * d);
  vec3 teinte = vec3(1.0, 0.94, 0.72); // la lumière chaude qui perce le feuillage
  gl_FragColor = vec4(teinte * a, a);
}
`

export class SoleilLayer {
  private shader: Phaser.GameObjects.Shader | null = null
  private souffle = 0
  private lastMs: number | null = null

  private canvas: Phaser.Textures.CanvasTexture | null = null

  constructor(scene: Phaser.Scene, private readonly map: WorldMap, private readonly seed: number) {
    // ── LE MASQUE : la densité de lumière par tuile. Il naît ÉTEINT (aucun arbre connu :
    // on ne peint pas une forêt entièrement trouée le temps d'un snapshot) — c'est
    // `majArbres`, au premier peuplement puis à chaque changement (abattage, dérive,
    // front de cendre), qui le bâtit depuis la CANOPÉE RÉELLE (`soleil-masque`). ──
    const { width, height } = map
    const canvas = scene.textures.createCanvas('soleil-mask', width, height)
    if (!canvas) return
    this.canvas = canvas
    const ctx = canvas.getContext()
    const img = ctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) img.data[i * 4 + 3] = 255
    ctx.putImageData(img, 0, 0)
    canvas.refresh()
    canvas.setFilter(Phaser.Textures.FilterMode.NEAREST)

    const worldW = width * TILE_PX
    const worldH = height * TILE_PX
    this.shader = scene.add
      .shader(
        {
          name: 'braises-soleil',
          fragmentSource: FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uMask', 0)
            setUniform('uWorldPx', [worldW, worldH])
            setUniform('uMapTiles', [width, height])
            setUniform('uTilePx', TILE_PX)
            setUniform('uSouffle', this.souffle)
            setUniform('uDay', this.day)
          },
        },
        0,
        0,
        worldW,
        worldH,
        ['soleil-mask'],
      )
      .setOrigin(0, 0)
      .setDepth(SOLEIL_DEPTH)
  }

  private day = 1

  /**
   * LA CANOPÉE A CHANGÉ (premier peuplement, abattage, dérive, cendre) : le masque se
   * REBÂTIT depuis les couronnes réelles. Coût : un balayage de la carte plus un tampon
   * par arbre — à réserver aux CHANGEMENTS (l'appelant throttle), jamais à la frame.
   */
  majArbres(arbres: readonly ArbreCouvert[]): void {
    if (!this.canvas) return
    const dens = masqueSoleil(this.map, this.seed, arbres)
    const ctx = this.canvas.getContext()
    const img = ctx.createImageData(this.map.width, this.map.height)
    for (let i = 0; i < dens.length; i++) {
      img.data[i * 4] = dens[i]!
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    this.canvas.refresh()
  }

  /** Chaque frame : la respiration avance (repliée — pas d'uptime qui déborde), le jour décide. */
  update(nowMs: number, day: number): void {
    const dt = this.lastMs === null ? 0 : Math.min(0.25, Math.max(0, (nowMs - this.lastMs) / 1000))
    this.lastMs = nowMs
    this.souffle = (this.souffle + dt * 0.12) % 1 // une respiration ~8 s
    this.day = day
    this.shader?.setVisible(day > 0.02)
  }

  destroy(): void {
    this.shader?.destroy()
    this.shader = null
  }
}
