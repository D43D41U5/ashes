/**
 * LE FANTÔME DE CONSTRUCTION — le mode armé se VOIT (spec recolte.md G3).
 *
 * Tant que `placing === null` (l'état de départ), il n'existe pas : poser n'est
 * pas le comportement par défaut du clic. Il s'arme de deux façons — une
 * CONSTRUCTION choisie au panneau (marteau en main), ou un FEU DE CAMP tenu dans
 * la ceinture. Armé, une silhouette translucide de la structure suit la tuile
 * visée, et vire au ROUGE là où la pose est perdue d'avance (hors portée, occupée).
 *
 * Il ne DÉCIDE rien : la sim revalide la pose (village, ressources, terrain,
 * emprise — invariant §3). Il ne fait qu'éviter au joueur de cliquer dans le
 * vide. Un fantôme vert n'est donc PAS une promesse — c'est « rien ici ne
 * l'interdit *de ce que le client peut voir* ».
 *
 * Le minimum vital, sciemment : le vrai plan de construction (coût affiché,
 * tiers de matériaux, rotation) est le chantier 3, « le marteau ».
 */
import { tileFeetAnchor, structureDepth } from '../../render/framing'
import { TILE_PX } from '../../render/framing'
import type { Placeable } from '../../hud-state'
import type { Structure } from '@braises/sim'
import type Phaser from 'phaser'
import type { Warp } from '../../render/warp'

const OK_TINT = 0x9adf7a
const BAD_TINT = 0xd9614f
const GHOST_ALPHA = 0.55

export class BuildGhost {
  private readonly sprite: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene) {
    // Amorcé sur une texture connue puis caché : `setTexture` sur une clé absente
    // laisserait le sprite figé sur la texture manquante.
    this.sprite = scene.add.image(0, 0, 'st-wall').setOrigin(0.5, 1).setAlpha(GHOST_ALPHA).setVisible(false)
  }

  /**
   * `selected === null` → le fantôme disparaît. Sinon il se pose sur la tuile
   * visée, ancré aux PIEDS et soulevé par le relief, exactement comme la vraie
   * structure le sera : ce qu'on voit est ce qu'on pose.
   */
  update(
    placing: Placeable | null,
    tx: number,
    ty: number,
    inRange: boolean,
    structures: readonly Structure[],
    warp: Warp | undefined,
  ): void {
    if (placing === null) {
      this.sprite.setVisible(false)
      return
    }
    const occupied = structures.some((s) => s.tx === tx && s.ty === ty)
    const a = tileFeetAnchor(tx, ty, TILE_PX)
    const lift = warp?.lift(tx + 0.5, ty + 1) ?? 0
    this.sprite
      .setTexture(`st-${placing}`)
      .setPosition(a.px, a.py - lift)
      .setDepth(structureDepth(ty, TILE_PX))
      .setTint(inRange && !occupied ? OK_TINT : BAD_TINT)
      .setVisible(true)
  }
}
