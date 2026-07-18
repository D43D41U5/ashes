/**
 * LE FANTÔME DE CONSTRUCTION — le mode armé se VOIT (spec recolte.md G3, construction R21).
 *
 * Tant que `placing === null` (l'état de départ), il n'existe pas : poser n'est pas
 * le comportement par défaut du clic. Il s'arme de trois façons — une PIÈCE choisie
 * au menu du marteau, un FEU DE CAMP tenu, ou un COMPOSANT tenu (enclume, four…).
 * Armé, une silhouette translucide suit la tuile visée, ROUGE là où la pose est
 * perdue d'avance (hors portée, occupée).
 *
 * LA COUCHE QUE RUST N'A PAS (spec construction R22) : quand on tient un COMPOSANT,
 * le fantôme PRÉDIT la fonction — « → Forge N2 » AVANT la pose, en simulant la
 * reconnaissance d'amas avec la structure ajoutée. C'est ce qui rend l'émergence
 * lisible : on voit ce qu'on va faire naître.
 *
 * Il ne DÉCIDE rien : la sim revalide la pose (carré, navigabilité, matériaux —
 * invariant §3). Un fantôme vert n'est PAS une promesse — c'est « rien ici ne
 * l'interdit *de ce que le client peut voir* ».
 */
import { COMPONENT_TYPES, recognizeFunctions, type RecognizedFunction, type Structure } from '@braises/sim'
import { tileFeetAnchor, structureDepth } from '../../render/framing'
import { TILE_PX } from '../../render/framing'
import type { Placeable } from '../../hud-state'
import type Phaser from 'phaser'
import type { Warp } from '../../render/warp'
import { FONT } from '../ui/typography'

const OK_TINT = 0x9adf7a
const BAD_TINT = 0xd9614f
const GHOST_ALPHA = 0.55

/** Le nom affiché d'une fonction prédite (spec construction R22). Étendu par tranche. */
const FUNCTION_LABEL: Record<string, string> = { forge: 'Forge', atelier: 'Atelier' }

/** Les types de composants (source unique : la sim) — distingue un composant d'une barrière. */
const COMPONENT_SET = new Set<string>(COMPONENT_TYPES)

export class BuildGhost {
  private readonly sprite: Phaser.GameObjects.Image
  /** L'étiquette prédictive « → Forge N2 » (spec construction R22). */
  private readonly predict: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene) {
    this.sprite = scene.add.image(0, 0, 'st-wall').setOrigin(0.5, 1).setAlpha(GHOST_ALPHA).setVisible(false)
    this.predict = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#e8c66a', stroke: '#14141a', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(1_450_000)
      .setVisible(false)
  }

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
      this.predict.setVisible(false)
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

    // R22 — la PRÉDICTION d'émergence : ce que ce composant ferait naître ou monter.
    const pred = COMPONENT_SET.has(placing) && !occupied ? predictFunction(structures, placing, tx, ty) : null
    if (pred) {
      this.predict.setText(`→ ${FUNCTION_LABEL[pred.functionId] ?? pred.functionId} N${pred.tier}`)
        .setPosition(a.px, a.py - lift - TILE_PX)
        .setVisible(true)
    } else {
      this.predict.setVisible(false)
    }
  }
}

/**
 * Ce que la pose ferait ÉMERGER ou MONTER (spec construction R22) : on rejoue la
 * reconnaissance d'amas AVEC la structure hypothétique, et on retourne la fonction
 * qui apparaît ou grimpe d'un palier. Pur (même moteur que la sim) : le fantôme ne
 * ment pas. `null` = rien de neuf (le composant est isolé, ou n'ajoute aucun palier).
 */
function predictFunction(
  structures: readonly Structure[],
  comp: Placeable,
  tx: number,
  ty: number,
): RecognizedFunction | null {
  const key = (f: RecognizedFunction): string => `${f.functionId}@${f.tx},${f.ty}`
  const before = new Map(recognizeFunctions(structures).map((f) => [key(f), f.tier]))
  const hypo = [...structures, { id: -1, type: comp, tx, ty, villageId: 0 } as Structure]
  const after = recognizeFunctions(hypo)
  // La fonction NOUVELLE ou montée d'un palier grâce à la pose.
  let best: RecognizedFunction | null = null
  for (const f of after) {
    const prev = before.get(key(f)) ?? 0
    if (f.tier > prev && (best === null || f.tier > best.tier)) best = f
  }
  return best
}
