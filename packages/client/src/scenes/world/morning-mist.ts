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
import { TERRAIN_MARSH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER, TERRAIN_DEEP_WATER, type WorldMap } from '@braises/sim'
import { frontDeBrume } from '../../render/lighting'
import { DIST_FIELD_MAX, MIST_DEPTH, MistLayer } from './mist-layer'

/** Plafond de densité à brume pleine — la crête du shader monte au-delà (voir ses crans).
 *  0,3 → 0,38 le 26/07 : regardé à 6h12, le sol de l'aube en jeu est plus clair que celui de
 *  la maquette de calibrage — la nappe y restait timide sur la berge.
 *  GARDE-FOU (revue) : JAMAIS ≥ 0,45 — au-delà les crans du shader fusionnent (corps ≡ crête
 *  à l'alpha plafond) et le drap uniforme « toute blanche » revient en silence. */
const DENSITE_MAX = 0.38
/** Vitesse de dérive des nappes (tuiles/s) appliquée au vent lissé unitaire. */
const DERIVE = 0.32

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
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      img.data[i * 4] = Math.round((Math.min(dist[i]! / 3, DIST_FIELD_MAX) / DIST_FIELD_MAX) * 255)
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (scene.textures.exists(this.key)) scene.textures.remove(this.key)
    scene.textures.addCanvas(this.key, cv)
    scene.textures.get(this.key).setFilter(Phaser.Textures.FilterMode.NEAREST)

    this.layer = new MistLayer(scene, this.key, width, height, MIST_DEPTH)
  }

  /** Chaque frame : la MARÉE décide de tout (pente continue), le vent LISSÉ du monde
   *  (`VentLisse`) porte les nappes — jamais un vecteur nul, jamais un saut de cap.
   *  La densité SUIT LE FRONT (pleine dès que la marée a 3 tuiles, fondue à ses tout
   *  derniers instants) : regardé à 7h36, multiplier par l'enveloppe `brumeDuMatin`
   *  éteignait les dernières flaques du retrait — que la maquette validée gardait
   *  lisibles jusqu'au bout (le burn-off se raconte, il ne s'évapore pas en silence). */
  update(nowMs: number, hour: number, vent: { x: number; y: number }, day = 1): void {
    const front = frontDeBrume(hour)
    const densite = DENSITE_MAX * Math.min(1, front / 3)
    const w = { x: vent.x * DERIVE, y: vent.y * DERIVE }
    this.layer?.update(nowMs, densite, front, w, day)
  }

  destroy(): void {
    this.layer?.destroy()
    this.layer = null
  }
}
