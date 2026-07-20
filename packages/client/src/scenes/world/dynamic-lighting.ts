/**
 * ESSAI ÉCLAIRAGE DYNAMIQUE (DA actée, docs/decisions.md 2026-07-20) — pilotage du
 * LightsManager de Phaser 4 pour la tranche verticale « arbres normal-mappés ».
 *
 * TROIS sources, toutes tirées de l'état sim (jamais inventées ici) :
 *   • LE SOLEIL — une lumière directionnelle SIMULÉE par un point lointain, posé dans
 *     `sunDirection(heure)` (module pur, testé) loin du centre caméra, rayon énorme :
 *     à midi il est quasi au zénith (dôme éclairé à plat), à l'aube/couchant il RASE
 *     (une tranche du houppier s'allume). Intensité ∝ `daylight` : nul la nuit.
 *   • LA LUNE — un voile FROID venu d'en haut, BIEN plus faible que le soleil, actif ∝ 1-day :
 *     la nuit, les houppiers gardent un léger relief bleuté au lieu d'un aplat noir.
 *   • LES FEUX — un point light chaud par structure `fire`, couleur/rayon/intensité de
 *     `fireGlow` (le MÊME module que le halo cosmétique). La nuit, c'est la source qui
 *     DOMINE : la canopée s'allume autour des braises. C'est tout l'argument.
 *
 * N'affecte QUE les objets en `setLighting(true)` (les arbres, quand le toggle est
 * armé) — tout le reste du monde rend comme avant. Inerte tant que `update(active=…)`
 * n'est pas nourri : on le coupe d'un coup avec le flag debug.
 */
import type Phaser from 'phaser'
import type { SnapshotMessage, Structure } from '@braises/sim'
import { fireGlow, sunDirection, lerpColor } from '../../render/lighting'
import { TILE_PX } from '../../render/framing'

const SUN_FAR = 2200 // distance du soleil au centre caméra (px monde) : grand = quasi directionnel
const SUN_RADIUS = 9000 // rayon >> distance → atténuation douce, éclairage ~uniforme à l'écran
const SUN_Z = 620 // hauteur : règle l'angle (rasant à l'aube quand l'offset horizontal domine)
// LE SOLEIL EST EN HAUT et passe de DROITE à GAUCHE sur la journée (demande d'Alexis) : un biais
// NORD fixe (vers le haut de l'écran) → la lumière tombe d'en haut ; le balayage horizontal (est→
// ouest via `sunDirection`) fait glisser le côté éclairé de la droite vers la gauche au fil des heures.
const SUN_NORTH = 1600 // décalage vers le haut de l'écran (nord) : la source est « en haut »
const GOLDEN = 0xffb060 // soleil rasant, chaud
const WHITE = 0xfff2e6 // plein midi
const MOON_COLOR = 0xaec2e6 // clair de lune : bleu pâle et froid
const MOON_INTENSITY = 0.32 // BEAUCOUP plus faible que le soleil (~1.2) — un voile froid, pas un projecteur
const AMBIENT_DAY = 0xb6ad9c // ambiante multiplicative de jour (gris chaud)
const AMBIENT_NIGHT = 0x33415f // ambiante de nuit BLEUTÉE (relevée) : les arbres ne tombent plus au noir
const FEU_MAX = 24 // borne dure de lumières de Feu (le manager plafonne à maxLights=40)

function setLightColor(light: Phaser.GameObjects.Light, rgb: number, scale = 1): void {
  const r = ((rgb >> 16) & 0xff) / 255 * scale
  const g = ((rgb >> 8) & 0xff) / 255 * scale
  const b = (rgb & 0xff) / 255 * scale
  light.color.set(r, g, b)
}

export class DynamicLighting {
  private sun: Phaser.GameObjects.Light
  private moon: Phaser.GameObjects.Light
  private feux = new Map<number, Phaser.GameObjects.Light>()
  private wasActive = false

  constructor(private scene: Phaser.Scene) {
    scene.lights.enable()
    this.sun = scene.lights.addLight(0, 0, SUN_RADIUS, WHITE, 0, SUN_Z)
    this.moon = scene.lights.addLight(0, 0, SUN_RADIUS, MOON_COLOR, 0, SUN_Z)
  }

  /**
   * @param active toggle debug armé ? Sinon on éteint tout (aucun objet n'est lit de
   *   toute façon) et on sort — la scène rend comme avant.
   */
  update(
    active: boolean,
    cam: Phaser.Cameras.Scene2D.Camera,
    structures: Structure[],
    villages: SnapshotMessage['villages'],
    hour: number,
    day: number,
    now: number,
  ): void {
    if (!active) {
      if (this.wasActive) { this.sun.intensity = 0; this.moon.intensity = 0; for (const f of this.feux.values()) f.intensity = 0 }
      this.wasActive = false
      return
    }
    this.wasActive = true

    // Ambiante : lit les arbres même sans lumière directe ; sombre la nuit pour que les Feux ressortent.
    this.scene.lights.setAmbientColor(lerpColor(AMBIENT_NIGHT, AMBIENT_DAY, day))

    // LE SOLEIL — point lointain dans la direction du soleil, centré sur la vue.
    const v = cam.worldView
    const cx = v.x + v.width / 2, cy = v.y + v.height / 2
    const dir = sunDirection(hour) // x est+ (aube) → ouest (couchant) : le balayage droite→gauche
    this.sun.x = cx + dir.x * SUN_FAR
    this.sun.y = cy - SUN_NORTH // EN HAUT : la source reste au nord de la vue (haut de l'écran)
    this.sun.intensity = day * 1.2
    setLightColor(this.sun, lerpColor(GOLDEN, WHITE, day))

    // LA LUNE — un voile FROID venu d'EN HAUT, bien plus faible que le soleil, qui ne vit que la
    // nuit (∝ 1-day). Elle donne aux houppiers un léger relief bleuté au lieu d'un aplat noir.
    this.moon.x = cx
    this.moon.y = cy - SUN_NORTH
    this.moon.intensity = (1 - day) * MOON_INTENSITY

    // LES FEUX — un point light chaud par structure `fire` (réconcilié par id).
    const seen = new Set<number>()
    let count = 0
    for (const s of structures) {
      if (s.type !== 'fire' || count >= FEU_MAX) continue
      count++
      seen.add(s.id)
      const warmth = villages.find((vg) => vg.id === s.villageId)?.warmth ?? 0
      const g = fireGlow(warmth, day, now, s.id * 1.7)
      const engage = Math.min(1, Math.abs(warmth) / 100)
      let light = this.feux.get(s.id)
      if (!light) {
        light = this.scene.lights.addLight(0, 0, 0, 0xffffff, 0, TILE_PX * 0.6)
        this.feux.set(s.id, light)
      }
      light.x = s.tx * TILE_PX + TILE_PX / 2
      light.y = s.ty * TILE_PX + TILE_PX / 2
      light.radius = g.radius * TILE_PX * 2.4 // portée élargie : la canopée s'allume plus loin autour du feu
      // Couleur CHAUDE (pas la couleur politique du Feu) — un peu plus rouge s'il couve fort.
      light.color.set(1.0, 0.5 - 0.14 * engage, 0.22 - 0.13 * engage)
      // BIEN plus forte la nuit (demande d'Alexis : le Feu éclairait trop peu) ; socle de jour pour qu'elle existe au soleil.
      light.intensity = (0.6 + 2.8 * (1 - day)) * (0.8 + 0.2 * engage)
    }
    for (const [id, light] of this.feux) {
      if (seen.has(id)) continue
      this.scene.lights.removeLight(light)
      this.feux.delete(id)
    }
  }

  destroy(): void {
    this.scene.lights.removeLight(this.sun)
    this.scene.lights.removeLight(this.moon)
    for (const f of this.feux.values()) this.scene.lights.removeLight(f)
    this.feux.clear()
  }
}
