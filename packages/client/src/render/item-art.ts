/**
 * Les icônes d'items — dessinées EN CODE, comme tout l'art du projet
 * (cf. poi-art.ts). À 16 px, on lit une SILHOUETTE, jamais une texture : chaque
 * icône doit être reconnaissable en ombre chinoise. Lumière au nord-ouest,
 * face claire en haut-à-gauche. Palette alignée sur le monde (bois chaud,
 * pierre froide, fer bleuté).
 */
import type Phaser from 'phaser'
import type { ItemId } from '@braises/sim'

export const ITEM_ICON_PX = 16

export const ITEM_LABELS: Record<ItemId, string> = {
  wood: 'Bois',
  stone: 'Pierre',
  fiber: 'Fibre',
  berries: 'Baies',
  stew: 'Ragoût',
  iron_ore: 'Minerai de fer',
  coal: 'Charbon',
  iron_ingot: 'Lingot de fer',
  axe: 'Hache',
  pickaxe: 'Pioche',
  iron_axe: 'Hache de fer',
  iron_pickaxe: 'Pioche de fer',
  spear: 'Lance',
  hammer: 'Marteau de construction',
  raw_meat: 'Viande crue',
  cooked_meat: 'Viande cuite',
  components: 'Composants',
}

export function itemIconKey(item: ItemId): string {
  return `it-${item}`
}

type ItemPaint = (g: Phaser.GameObjects.Graphics) => void

/**
 * Un dessin PAR item — la clé `Record<ItemId, …>` est le garde-fou : ajouter un
 * item à la sim sans lui peindre d'icône ne compile plus (une case vide à
 * l'écran serait sinon silencieuse). `generateItemIcons` boucle là-dessus.
 */
export const ITEM_PAINTS: Record<ItemId, ItemPaint> = {
  // Deux bûches croisées, cœur clair en bout (au NO).
  wood: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(2, 9, 12, 4)
    g.fillStyle(0x7a5a34).fillRect(2, 5, 12, 4)
    g.fillStyle(0x8d6b40).fillRect(2, 5, 12, 1)
    g.fillStyle(0xc3a678).fillRect(2, 5, 2, 4) // le cœur du bois, en bout
  },

  // Trois galets gris empilés — froids, pas de teinte chaude.
  stone: (g) => {
    g.fillStyle(0x5a5a60).fillCircle(6, 11, 4)
    g.fillStyle(0x6a6a72).fillCircle(11, 11, 3)
    g.fillStyle(0x7c7c86).fillCircle(8, 6, 4)
    g.fillStyle(0x9a9aa4).fillCircle(6, 4, 1) // éclat NO
  },

  // Botte d'herbe nouée : brins verts, un lien plus clair au milieu.
  fiber: (g) => {
    g.fillStyle(0x6f9c3a).fillRect(4, 2, 2, 12)
    g.fillStyle(0x7fae44).fillRect(7, 1, 2, 13)
    g.fillStyle(0x6f9c3a).fillRect(10, 2, 2, 12)
    g.fillStyle(0xb89a52).fillRect(3, 8, 10, 2) // le lien
  },

  // Trois baies rouges sur tige.
  berries: (g) => {
    g.fillStyle(0x2f5e33).fillRect(7, 1, 2, 6) // tige
    g.fillStyle(0xc0392b).fillCircle(5, 9, 3)
    g.fillStyle(0xc0392b).fillCircle(11, 9, 3)
    g.fillStyle(0xd4564a).fillCircle(8, 12, 3)
    g.fillStyle(0xe88a80).fillCircle(4, 8, 1) // reflet NO
  },

  // Bol fumant : coupe brune, ragoût, deux volutes.
  stew: (g) => {
    g.fillStyle(0xcac2b2).fillRect(6, 2, 1, 3).fillRect(9, 1, 1, 4) // vapeur
    g.fillStyle(0x5a3f28).fillEllipse(8, 11, 12, 7) // le bol
    g.fillStyle(0x8a5a30).fillEllipse(8, 9, 9, 4) // la surface du ragoût
    g.fillStyle(0xb07c40).fillCircle(6, 8, 1) // reflet NO
  },

  // Minerai de fer : roche grise à mouchetures ocre.
  iron_ore: (g) => {
    g.fillStyle(0x565660).fillCircle(8, 9, 6)
    g.fillStyle(0x6c6c76).fillCircle(6, 7, 3)
    g.fillStyle(0xb0632e).fillRect(9, 6, 2, 2).fillRect(6, 11, 2, 2).fillRect(11, 10, 1, 1)
  },

  // Charbon : éclats noirs anguleux.
  coal: (g) => {
    g.fillStyle(0x1c1c22).fillTriangle(3, 12, 8, 4, 11, 12)
    g.fillStyle(0x121216).fillTriangle(8, 13, 12, 6, 14, 13)
    g.fillStyle(0x3a3a42).fillTriangle(5, 6, 7, 5, 6, 9) // arête réfléchissante NO
  },

  // Lingot de fer : trapèze bleuté, dessus clair.
  iron_ingot: (g) => {
    g.fillStyle(0x53616e).fillTriangle(2, 12, 4, 6, 14, 12) // masse
    g.fillRect(4, 6, 8, 6)
    g.fillStyle(0x53616e).fillTriangle(12, 12, 12, 6, 14, 12)
    g.fillStyle(0x8996a2).fillRect(4, 6, 8, 2) // dessus éclairé
  },

  // Hache : manche bois + fer triangulaire.
  axe: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(9, 3, 2, 11) // manche
    g.fillStyle(0x8d6b40).fillRect(9, 3, 1, 11)
    g.fillStyle(0x8a8a92).fillTriangle(4, 2, 11, 2, 11, 8) // fer
    g.fillStyle(0xb4b4bc).fillTriangle(4, 2, 8, 2, 8, 4) // tranchant clair
  },

  // Pioche : manche + tête en T (deux pointes).
  pickaxe: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(7, 4, 2, 11) // manche
    g.fillStyle(0x8d6b40).fillRect(7, 4, 1, 11)
    g.fillStyle(0x8a8a92).fillRect(2, 4, 12, 2) // barre de tête
    g.fillStyle(0x8a8a92).fillTriangle(1, 5, 3, 3, 3, 7).fillTriangle(15, 5, 13, 3, 13, 7) // pointes
    g.fillStyle(0xb4b4bc).fillRect(2, 4, 12, 1) // arête claire
  },

  // Hache de fer : la hache, bleutée, avec un liseré clair.
  iron_axe: (g) => {
    g.fillStyle(0x53616e).fillRect(9, 3, 2, 11) // manche sombre bleuté
    g.fillStyle(0x6f7d8a).fillRect(9, 3, 1, 11)
    g.fillStyle(0x6f7d8a).fillTriangle(4, 2, 11, 2, 11, 8) // fer
    g.fillStyle(0xaeb9c4).fillTriangle(4, 2, 8, 2, 8, 4) // tranchant / liseré clair
  },

  // Pioche de fer : la pioche, bleutée, liseré clair.
  iron_pickaxe: (g) => {
    g.fillStyle(0x53616e).fillRect(7, 4, 2, 11)
    g.fillStyle(0x6f7d8a).fillRect(7, 4, 1, 11)
    g.fillStyle(0x6f7d8a).fillRect(2, 4, 12, 2)
    g.fillStyle(0x6f7d8a).fillTriangle(1, 5, 3, 3, 3, 7).fillTriangle(15, 5, 13, 3, 13, 7)
    g.fillStyle(0xaeb9c4).fillRect(2, 4, 12, 1)
  },

  // Lance : hampe en diagonale + pointe claire.
  spear: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(6, 5, 2, 10) // hampe
    g.fillStyle(0x8d6b40).fillRect(6, 5, 1, 10)
    g.fillStyle(0x8a8a92).fillTriangle(3, 5, 10, 5, 7, 0) // pointe
    g.fillStyle(0xb4b4bc).fillTriangle(3, 5, 6, 5, 6, 1) // arête claire NO
  },

  // Marteau de construction : manche bois, tête de fer massive en travers.
  // Silhouette volontairement TRAPUE — on doit le distinguer de la hache d'un
  // coup d'œil dans la ceinture (même famille de couleurs, tout autre masse).
  hammer: (g) => {
    g.fillStyle(0x6a4c2c).fillRect(7, 6, 2, 9) // manche
    g.fillStyle(0x8d6b40).fillRect(7, 6, 1, 9)
    g.fillStyle(0x6c6c76).fillRect(3, 2, 10, 5) // la tête, en travers
    g.fillStyle(0x8996a2).fillRect(3, 2, 10, 2) // dessus éclairé (lumière au NO)
    g.fillStyle(0x53616e).fillRect(11, 2, 2, 5) // la panne, plus sombre
  },

  // Viande crue : pièce rouge avec os clair.
  raw_meat: (g) => {
    g.fillStyle(0xa8352e).fillEllipse(8, 9, 12, 9)
    g.fillStyle(0xc25a50).fillEllipse(6, 7, 6, 4) // gras / reflet NO
    g.fillStyle(0xe6ddc8).fillRect(11, 2, 2, 5) // l'os
    g.fillStyle(0xe6ddc8).fillCircle(12, 2, 2)
  },

  // Viande cuite : même pièce, brun doré.
  cooked_meat: (g) => {
    g.fillStyle(0x7a4a26).fillEllipse(8, 9, 12, 9)
    g.fillStyle(0xa9743a).fillEllipse(6, 7, 6, 4) // dorure / reflet NO
    g.fillStyle(0xe6ddc8).fillRect(11, 2, 2, 5) // l'os
    g.fillStyle(0xe6ddc8).fillCircle(12, 2, 2)
  },

  // Composants : un engrenage de ferraille.
  components: (g) => {
    g.fillStyle(0x6c6c76).fillCircle(8, 8, 6)
    g.fillStyle(0x8996a2).fillRect(7, 0, 2, 3).fillRect(7, 13, 2, 3).fillRect(0, 7, 3, 2).fillRect(13, 7, 3, 2) // dents
    g.fillStyle(0x53616e).fillCircle(8, 8, 3)
    g.fillStyle(0x2b2b30).fillCircle(8, 8, 2) // moyeu
  },
}

/** Appelée UNE fois par BootScene : peuple le cache de textures — un dessin par ItemId. */
export function generateItemIcons(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 })
  for (const item of Object.keys(ITEM_PAINTS) as ItemId[]) {
    g.clear()
    ITEM_PAINTS[item](g)
    g.generateTexture(itemIconKey(item), ITEM_ICON_PX, ITEM_ICON_PX)
  }
  g.destroy()
}
