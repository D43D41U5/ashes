/**
 * LE FEU, VIVANT — une lueur qui IRRADIE (un shader), des langues de flamme, des
 * braises qui montent, et de la fumée.
 *
 * Remplace l'ancien `fire-glow` (un simple sprite additif) par quatre couches, une
 * par structure `fire`, réconciliées au diff `seen` comme les sprites de snapshot :
 *
 *   1. LA LUEUR — un `Phaser.GameObjects.Shader` additif : un halo radial DOUX qui
 *      VACILLE (bruit temporel) comme la lumière d'un feu de bois. Sa couleur
 *      (l'alignement, bleu ↔ chaud) vient du module pur `lighting.fireGlow`. C'est
 *      une lueur de braises, pas un projecteur : elle ne sature jamais en blanc.
 *   2. LES FLAMMES — de petites particules chaudes, ÉMISES SUR UNE PETITE LARGEUR
 *      (jamais toutes au même point, sinon ça s'empile en un disque blanc), qui
 *      montent, rétrécissent, s'éteignent.
 *   3. LES BRAISES — quelques étincelles vives et rares qui filent vers le haut.
 *   4. LA FUMÉE — grise, plus lente, elle monte plus haut et gonfle en se dissipant.
 *
 * AUCUNE logique de jeu : pur habillage. Le `now` (ms) anime, il ne simule rien.
 */
import Phaser from 'phaser'
import type { Structure } from '@braises/sim'
import { fireGlow } from '../../render/lighting'
import { GLOW_DEPTH, SPARK_DEPTH, TILE_PX } from '../../render/framing'
import type { SnapshotMessage } from '../../protocol'

/** Une petite braise ronde et douce (24 px) — le grain des flammes et des étincelles.
 *  Générée une fois ; l'énorme `glow` (256 px) saturait dès qu'on en empilait deux. */
const EMBER_KEY = 'fx-ember'
function ensureEmberTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(EMBER_KEY)) return
  const S = 24
  const tex = scene.textures.createCanvas(EMBER_KEY, S, S)
  if (!tex) return
  const ctx = tex.getContext()
  const c = S / 2
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, S, S)
  tex.refresh()
}

/**
 * La lueur : un halo DOUX (pas un disque plein) qui décroît dès le centre et ne
 * sature jamais en blanc, avec un vacillement à deux fréquences. Additif : on sort
 * la couleur PRÉMULTIPLIÉE par l'alpha, pour que le mode ADD l'ajoute juste.
 */
const FIRE_GLOW_FRAGMENT = /* glsl */ `
#pragma phaserTemplate(shaderName)

#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 outTexCoord;

uniform float uTime;       // secondes
uniform vec3 uColor;       // la couleur du feu (chaud, ou bleu Meute) — 0..1
uniform float uIntensity;  // ~0.15 (jour) .. ~0.4 (pleine nuit)

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash(i), hash(i + 1.0), smoothstep(0.0, 1.0, f));
}

void main() {
  vec2 p = outTexCoord - 0.5;        // -0.5 .. 0.5
  float r = length(p) * 2.0;          // 0 au centre .. 1 au bord
  float flick = 0.80 + 0.14 * vnoise(uTime * 6.5) + 0.06 * sin(uTime * 17.0 + p.x * 6.0);
  float halo = smoothstep(1.0, 0.0, r);
  float core = smoothstep(0.5, 0.0, r);
  float a = (halo * 0.58 + core * 0.12) * flick * uIntensity;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, vec3(1.0, 0.82, 0.5), core * 0.25);
  gl_FragColor = vec4(col * a, a); // PRÉMULTIPLIÉ : le mode ADD ajoute col·a au fond
}
`

/** L'intensité de la lueur : un socle de jour (les flammes rougeoient même au soleil)
 *  + la nuit qui révèle le halo ; un peu plus si le Feu est « engagé » (alignement). */
function glowIntensity(warmth: number, day: number): number {
  const engage = Math.min(1, Math.abs(warmth) / 100)
  return (0.16 + 0.55 * (1 - day)) * (0.8 + 0.2 * engage)
}

interface FireUnit {
  glow: Phaser.GameObjects.Shader
  /** État lu par `setupUniforms` à chaque frame (Phaser rappelle la closure au rendu). */
  u: { time: number; color: number[]; intensity: number }
  flame: Phaser.GameObjects.Particles.ParticleEmitter
  ember: Phaser.GameObjects.Particles.ParticleEmitter
  smoke: Phaser.GameObjects.Particles.ParticleEmitter
}

export class FireFx {
  private units = new Map<number, FireUnit>()

  constructor(private scene: Phaser.Scene) {
    ensureEmberTexture(scene)
  }

  /** Réconcilie les effets avec les Feux du snapshot, à l'heure `day` (0 nuit → 1 jour). */
  update(structures: Structure[], villages: SnapshotMessage['villages'], day: number, now: number): void {
    const seen = new Set<number>()
    for (const s of structures) {
      if (s.type !== 'fire') continue
      seen.add(s.id)
      const cx = s.tx * TILE_PX + TILE_PX / 2
      const cy = s.ty * TILE_PX + TILE_PX / 2
      let unit = this.units.get(s.id)
      if (!unit) {
        unit = this.spawn(cx, cy)
        this.units.set(s.id, unit)
      }
      const warmth = villages.find((v) => v.id === s.villageId)?.warmth ?? 0
      const g = fireGlow(warmth, day, now, s.id * 1.7)
      // La LUMIÈRE est CHAUDE (orange) — PAS la couleur politique du Feu, qui est
      // BLANCHE au neutre (`warmthColor(0)`) et que porte déjà le sprite. Une lueur
      // blanche ne dit pas « feu de bois » : c'est ce qui la faisait rater la nuit.
      // On la tire un peu vers le rouge quand le Feu couve fort (une Meute).
      const engage = Math.min(1, Math.abs(warmth) / 100)
      unit.u.color = [1.0, 0.5 - 0.14 * engage, 0.22 - 0.13 * engage]
      unit.u.intensity = glowIntensity(warmth, day)
      unit.u.time = now / 1000
      // Une lumière d'ENVIRONNEMENT : large (~6 tuiles), elle repousse la nuit autour du feu.
      const size = g.radius * TILE_PX * 2.0
      unit.glow.setDisplaySize(size, size)
    }
    for (const [id, unit] of this.units) {
      if (seen.has(id)) continue
      unit.glow.destroy()
      unit.flame.destroy()
      unit.ember.destroy()
      unit.smoke.destroy()
      this.units.delete(id)
    }
  }

  private spawn(cx: number, cy: number): FireUnit {
    const u = { time: 0, color: [1, 0.6, 0.25], intensity: 0 }
    const glow = this.scene.add
      .shader(
        {
          name: 'braises-fire-glow',
          fragmentSource: FIRE_GLOW_FRAGMENT,
          setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
            setUniform('uTime', u.time)
            setUniform('uColor', u.color)
            setUniform('uIntensity', u.intensity)
          },
        },
        cx,
        cy,
        TILE_PX * 6,
        TILE_PX * 6,
      )
      .setOrigin(0.5, 0.5)
      .setDepth(GLOW_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)

    // LES FLAMMES : de petites braises chaudes (texture menue, jamais l'énorme `glow`,
    // qui saturait en disque blanc), qui montent en s'écartant un peu et se resserrent
    // en pointe. Additif — elles éclairent le foyer.
    const flame = this.scene.add
      .particles(cx, cy - 1, EMBER_KEY, {
        speedY: { min: -40, max: -22 },
        speedX: { min: -7, max: 7 },
        scale: { start: 0.5, end: 0.03 },
        alpha: { start: 0.42, end: 0 },
        lifespan: { min: 340, max: 620 },
        frequency: 34,
        quantity: 1,
        tint: [0xffe27a, 0xffa842, 0xf05a1e],
        blendMode: 'ADD',
      })
      .setDepth(SPARK_DEPTH)

    // LES BRAISES : rares, vives, minuscules — elles filent vers le haut et meurent vite.
    const ember = this.scene.add
      .particles(cx, cy - 2, EMBER_KEY, {
        speedY: { min: -58, max: -34 },
        speedX: { min: -13, max: 13 },
        scale: { start: 0.12, end: 0 },
        alpha: { start: 0.75, end: 0 },
        lifespan: { min: 460, max: 900 },
        frequency: 200,
        quantity: 1,
        tint: [0xffe9a0, 0xffc258],
        blendMode: 'ADD',
      })
      .setDepth(SPARK_DEPTH + 1)

    // LA FUMÉE : de petites volutes grises qui FILENT vers le haut et disparaissent
    // TRÈS VITE (décision utilisateur). Fondu normal, alpha faible, grain menu : elle
    // n'OFFUSQUE rien — on la devine plus qu'on ne la voit, et elle est déjà partie.
    const smoke = this.scene.add
      .particles(cx, cy - 4, EMBER_KEY, {
        speedY: { min: -50, max: -30 },
        speedX: { min: -6, max: 6 },
        scale: { start: 0.4, end: 0.9 },
        alpha: { start: 0.12, end: 0 },
        lifespan: { min: 400, max: 740 },
        frequency: 150,
        quantity: 1,
        tint: [0x5a554d, 0x6f6a61],
        blendMode: 'NORMAL',
      })
      .setDepth(SPARK_DEPTH - 1)

    return { glow, u, flame, ember, smoke }
  }

  destroy(): void {
    for (const unit of this.units.values()) {
      unit.glow.destroy()
      unit.flame.destroy()
      unit.ember.destroy()
      unit.smoke.destroy()
    }
    this.units.clear()
  }
}
