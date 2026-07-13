/**
 * LE PANNEAU DE CRAFT — à droite de l'écran d'inventaire (spec craft-file F14).
 *
 * Une vignette par recette : l'icône de ce qui sort, son nom, son coût. Un clic
 * = un ordre. Cliquer cinq fois = cinq ordres, que la sim GROUPE en une ligne
 * « ×5 » (F3) — le client ne compte rien, il clique.
 *
 * La vignette se grise quand on ne peut pas lancer : intrants manquants, ou
 * station absente. Ce grisé est un MIROIR (comme le surlignage de visée), jamais
 * une règle : la sim reste seule juge, et si elle refuse malgré tout, elle a
 * raison (invariant §3). Le client n'anticipe RIEN — pas d'ordre optimiste dans
 * la file : il attend le snapshot (F16).
 */
import { RECIPES, hasItems, type Inventory, type PlayerAction, type RecipeId } from '@braises/sim'
import type Phaser from 'phaser'
import type { StationId } from '../../hud-state'
import { ITEM_ICON_PX, ITEM_LABELS, itemIconKey } from '../../render/item-art'

const ROW_H = 44
const ROW_W = 260
const PANEL_DEPTH = 900 // même plan que l'inventaire

const TITLE = { fontFamily: 'Georgia, serif', fontSize: '15px', color: '#c9b892' } as const
const NAME = { fontFamily: 'Georgia, serif', fontSize: '14px', color: '#e8e0cc' } as const
const COST = { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#9a8f78' } as const

/** Le nom des stations, tel qu'on le dit au joueur. */
const STATION_LABEL: Record<StationId, string> = {
  fire: 'au Feu',
  workshop: "à l'atelier",
  furnace: 'au four',
}

/**
 * L'ordre des recettes à l'écran : la couche 1 (à la main) EN PREMIER — c'est ce
 * qu'on fait à la minute 0, et une liste qui l'enterre sous les recettes de forge
 * la rendrait invisible. Puis par station.
 */
const ORDER: Record<string, number> = { null: 0, fire: 1, workshop: 2, furnace: 3 }
const RECIPE_IDS = (Object.keys(RECIPES) as RecipeId[]).sort(
  (a, b) => (ORDER[String(RECIPES[a].station)] ?? 9) - (ORDER[String(RECIPES[b].station)] ?? 9),
)

/** Le coût, en une ligne lisible : « bois 2 · pierre 3 · corde 1 ». */
function costLine(id: RecipeId): string {
  const inputs = RECIPES[id].inputs
  return (Object.keys(inputs) as (keyof typeof inputs)[])
    .map((item) => `${ITEM_LABELS[item].toLowerCase()} ${inputs[item]}`)
    .join(' · ')
}

export interface CraftPanel {
  update(inv: Inventory, stations: StationId[]): void
  setVisible(v: boolean): void
}

export function createCraftPanel(
  scene: Phaser.Scene,
  send: (a: PlayerAction) => void,
  x: number,
  bottomY: number,
): CraftPanel {
  const rows: { id: RecipeId; bg: Phaser.GameObjects.Rectangle; icon: Phaser.GameObjects.Image; name: Phaser.GameObjects.Text; cost: Phaser.GameObjects.Text }[] = []
  const nodes: Phaser.GameObjects.GameObject[] = []

  const height = RECIPE_IDS.length * ROW_H
  const title = scene.add.text(0, -26, 'ARTISANAT', TITLE).setOrigin(0, 0)
  nodes.push(title)

  RECIPE_IDS.forEach((id, i) => {
    const y = i * ROW_H + ROW_H / 2
    const bg = scene.add
      .rectangle(ROW_W / 2, y, ROW_W, ROW_H - 4, 0x1b1b22, 0.9)
      .setStrokeStyle(1, 0x3a3a44)
      .setInteractive({ useHandCursor: true })
    const icon = scene.add.image(24, y, itemIconKey(RECIPES[id].output)).setDisplaySize(ITEM_ICON_PX * 1.6, ITEM_ICON_PX * 1.6)
    const station = RECIPES[id].station
    const suffix = station === null ? 'à la main' : STATION_LABEL[station]
    const name = scene.add.text(48, y - 12, `${ITEM_LABELS[RECIPES[id].output]}`, NAME).setOrigin(0, 0)
    const cost = scene.add.text(48, y + 4, `${costLine(id)}  —  ${suffix}`, COST).setOrigin(0, 0)

    // On envoie l'ordre MÊME si la vignette est grisée ? Non : le grisé dit qu'on
    // ne peut pas, et un clic qui part se faire refuser pollue le flux
    // d'événements (`action_rejected` n'est pas une poubelle — recolte.md G7).
    bg.on('pointerdown', () => {
      if (bg.getData('ready') !== true) return
      send({ type: 'craft', recipeId: id })
    })
    bg.on('pointerover', () => bg.setFillStyle(0x2a2a34, 0.95))
    bg.on('pointerout', () => bg.setFillStyle(0x1b1b22, 0.9))

    rows.push({ id, bg, icon, name, cost })
    nodes.push(bg, icon, name, cost)
  })

  const root = scene.add.container(x, bottomY - height, nodes).setDepth(PANEL_DEPTH).setScrollFactor(0).setVisible(false)

  return {
    update(inv, stations) {
      for (const row of rows) {
        const recipe = RECIPES[row.id]
        const hasStation = recipe.station === null || stations.includes(recipe.station)
        const ready = hasStation && hasItems(inv, recipe.inputs)
        row.bg.setData('ready', ready)
        // Grisé = « pas ici, pas maintenant ». On garde la vignette LISIBLE : une
        // recette qu'on ne peut pas encore lancer doit rester une invitation.
        row.icon.setAlpha(ready ? 1 : 0.35)
        row.name.setColor(ready ? '#e8e0cc' : '#7a7268')
        row.cost.setColor(ready ? '#9a8f78' : '#5f5a50')
        row.bg.setStrokeStyle(1, ready ? 0x6b5a3a : 0x3a3a44)
      }
    },
    setVisible(v) {
      root.setVisible(v)
    },
  }
}
