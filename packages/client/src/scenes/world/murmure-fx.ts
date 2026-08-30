/**
 * ═══ LE FANTÔME DU MURMURE (spec `cendre.md` R27d) — la vieille cendre se souvient, et ça se voit ═══
 *
 * La nuit, aux sites que la loi élit (`sitesDeCycle` — la MÊME loi que la sim, jamais une
 * recopie), une silhouette pâle se tient : elle vacille par PALIERS d'alpha (la grammaire des
 * FX de lumière — quantifiés, jamais lissés) et s'efface au jour. C'est l'invitation : on
 * approche DOUCEMENT, et la sim — elle seule — décide si le murmure se donne.
 *
 * ⚠ UNE APPROXIMATION, DOCUMENTÉE : le client passe `lieuxBrules: []` (la liste ne voyage pas
 * dans le snapshot). Autour d'un charnier fraîchement brûlé, la densité des morts que la sim
 * lit peut tomber sous le seuil pendant `BRULE_DUREE_JOURS` : un fantôme peut s'y montrer que
 * la sim ne donnera pas. Divergence COSMÉTIQUE et bornée — la collecte reste autoritative.
 */
import Phaser from 'phaser'
import { MURMURE, sitesDeCycle, TICKS_PER_CYCLE, type EtatDeMurmure } from '@ashes/sim'
import { TILE_PX } from '../../render/framing'

/** Les paliers d'alpha du vacillement — trois crans, jamais un fondu continu. */
const PALIERS = [0.16, 0.3, 0.42] as const
/** La cadence du vacillement (ms par cran) — lente : un mort ne clignote pas, il respire. */
const CRAN_MS = 640

const TEX = 'fx-murmure'

export class MurmureFx {
  private sprites = new Map<number, Phaser.GameObjects.Image>()
  private cycleConnu = Number.NaN
  private sites: { tx: number; ty: number; id: number }[] = []

  constructor(private readonly scene: Phaser.Scene) {
    if (!scene.textures.exists(TEX)) {
      // LA SILHOUETTE (12×22) : une figure debout, pâle et froide — la tête, les épaules, le
      // corps qui s'efface vers le sol. Des rects, la grammaire cubique ; le bas est plus
      // clair semé que plein : le fantôme ne touche pas terre.
      const g = scene.make.graphics({ x: 0, y: 0 }, false)
      g.fillStyle(0xcfd4dc, 0.9).fillRect(4, 1, 4, 4) // la tête
      g.fillStyle(0xbfc6d0, 0.85).fillRect(3, 5, 6, 3) // les épaules
      g.fillStyle(0xb4bcc8, 0.8).fillRect(3, 8, 6, 7) // le corps
      g.fillStyle(0xaab2c0, 0.6).fillRect(4, 15, 4, 3) // il s'efface…
      g.fillStyle(0xaab2c0, 0.35).fillRect(4, 19, 1, 2).fillRect(7, 18, 1, 2) // …en lambeaux
      g.fillStyle(0xe4e8ee, 0.9).fillRect(5, 6, 2, 1) // le cœur froid, un cran plus clair
      g.generateTexture(TEX, 12, 22)
      g.destroy()
      scene.textures.get(TEX).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
  }

  /** La passe de frame : les sites du CYCLE (recalculés à la bascule seulement), et pour ceux
   *  au cadre une silhouette qui vacille. De jour : tout s'éteint. */
  update(camera: Phaser.Cameras.Scene2D.Camera, etat: EtatDeMurmure, isNight: boolean, time: number): void {
    if (!isNight || !etat.map.cendreCout) {
      for (const s of this.sprites.values()) s.setVisible(false)
      return
    }
    const cycle = Math.floor(etat.tick / TICKS_PER_CYCLE)
    if (cycle !== this.cycleConnu) {
      this.cycleConnu = cycle
      this.sites = sitesDeCycle(etat, cycle)
      for (const s of this.sprites.values()) s.destroy()
      this.sprites.clear()
    }
    const vue = camera.worldView
    const marge = MURMURE.MAILLE * TILE_PX
    for (const site of this.sites) {
      const wx = (site.tx + 0.5) * TILE_PX
      const wy = (site.ty + 1) * TILE_PX
      const dedans =
        wx > vue.x - marge && wx < vue.right + marge && wy > vue.y - marge && wy < vue.bottom + marge
      let spr = this.sprites.get(site.id)
      if (!dedans) {
        spr?.setVisible(false)
        continue
      }
      if (!spr) {
        spr = this.scene.add.image(wx, wy - 11, TEX)
        spr.setDepth(wy) // le tri Y des billboards : il se tient, on passe devant et derrière
        this.sprites.set(site.id, spr)
      }
      spr.setVisible(true)
      // LE VACILLEMENT : paliers d'alpha, phase par site (le hachage du semis a déjà écarté
      // les sites — leur id suffit à désynchroniser), et un pas de dérive d'UN pixel.
      const phase = (site.id % 7) * 97
      const cran = Math.floor((time + phase) / CRAN_MS)
      spr.setAlpha(PALIERS[cran % PALIERS.length]!)
      spr.setX(wx + (cran % 2 === 0 ? 0 : 1))
    }
  }
}
