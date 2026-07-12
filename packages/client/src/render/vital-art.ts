/**
 * Les icônes des vitales — dessinées EN CODE, comme tout l'art du projet
 * (cf. item-art.ts).
 *
 * Peintes NATIVEMENT à 32 px, et non à 16 px grossies ×2 : elles vivent dans un
 * médaillon de 64 px, où un pixel doublé se voit comme un pavé. Les icônes
 * d'items, elles, restent à 16 px — c'est la taille de leur case.
 *
 * Elles sont rendues EN SILHOUETTE D'ENCRE dans le médaillon (teintées sombre) :
 * c'est donc le CONTOUR qui porte tout le sens. Chacune doit se reconnaître en
 * ombre chinoise, sans compter sur sa couleur — d'où des formes franches, des
 * masses épaisses, aucun détail fin qui disparaîtrait à la teinte. Le modelé
 * interne (lumière au nord-ouest) survit à peine sous l'encre : il donne le grain
 * de la gravure, pas la lecture.
 */
import type Phaser from 'phaser'

export const VITAL_ICON_PX = 32

export type VitalId = 'hp' | 'stamina' | 'hunger' | 'temperature'

export function vitalIconKey(id: VitalId): string {
  return `vt-${id}`
}

type VitalPaint = (g: Phaser.GameObjects.Graphics) => void

/**
 * Un dessin PAR vitale — le `Record<VitalId, …>` est le garde-fou : ajouter une
 * jauge sans lui peindre d'icône ne compile plus (un trou dans le HUD serait
 * sinon silencieux). `generateVitalIcons` boucle là-dessus.
 */
export const VITAL_PAINTS: Record<VitalId, VitalPaint> = {
  // Vie : un cœur plein — deux lobes ronds et une pointe basse franche.
  hp: (g) => {
    g.fillStyle(0xc0503e).fillCircle(10, 11, 7).fillCircle(22, 11, 7).fillTriangle(3, 12, 29, 12, 16, 30)
    g.fillStyle(0xe0796a).fillCircle(9, 8, 2.5) // reflet NO
  },

  // Endurance : un éclair — deux fers LARGES qui se chevauchent en zigzag. Étroit,
  // il flottait dans sa boîte et pesait moins que les autres.
  stamina: (g) => {
    g.fillStyle(0x4e9c5a).fillTriangle(23, 2, 6, 18, 17, 18).fillTriangle(26, 13, 15, 13, 9, 30)
    g.fillStyle(0x7fc78c).fillTriangle(23, 2, 6, 18, 11, 18) // arête éclairée NO
  },

  // Faim : fourchette et couteau, DEBOUT, côte à côte.
  //
  // Deux échecs instructifs avant ça. Les viandes (pilon, gigot, cuisse à l'os) :
  // réduites à une silhouette d'encre, elles ne sont qu'une MASSE, et une masse ne
  // dit rien. Puis les couverts CROISÉS : bonne idée, mauvais poids — à 32 px, deux
  // obliques en trait fin s'emmêlent en gribouillis, quand le cœur et l'éclair, eux,
  // sont des masses grasses. Une icône doit peser autant que ses voisines.
  //
  // Debout et côte à côte, les couverts redeviennent deux formes ÉPAISSES et
  // séparées. C'est le pictogramme le plus banal qui soit — et c'est précisément
  // pour ça qu'il se lit sans qu'on y pense.
  hunger: (g) => {
    // La fourchette : trois dents épaisses, une traverse, un manche.
    g.fillStyle(0xcfc7b4)
    g.fillRect(3.5, 3, 3, 10).fillRect(7.5, 3, 3, 10).fillRect(11.5, 3, 3, 10) // les dents
    g.fillRect(3.5, 12, 11, 4) // la traverse qui les porte
    g.fillStyle(0x8a7a5c).fillRect(7.5, 15, 3.5, 14) // le manche

    // Le couteau : lame au dos droit, tranchant en biais, pointe en haut.
    g.fillStyle(0xcfc7b4).fillTriangle(26, 3, 26, 18, 19, 18)
    g.fillStyle(0x8a7a5c).fillRect(21.5, 17, 4, 12) // le manche
  },

  // Température : un thermomètre — tube LARGE à sommet rond, GROS bulbe, mercure à
  // mi-hauteur. Trop fin, il lisait comme un clou. Pas de graduations : sous
  // l'encre, elles se noieraient dans la masse.
  temperature: (g) => {
    g.fillStyle(0xcfe2f2).fillCircle(16, 23, 8.5).fillRect(11, 5, 10, 18).fillCircle(16, 5, 5) // le verre
    g.fillStyle(0x6aa8d9).fillCircle(16, 23, 5.5).fillRect(13, 12, 6, 11) // le mercure
    g.fillStyle(0xeaf4fb).fillRect(12, 8, 2, 12) // le verre éclairé NO
  },
}

/** Appelée UNE fois par BootScene : peuple le cache de textures — un dessin par vitale. */
export function generateVitalIcons(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 })
  for (const id of Object.keys(VITAL_PAINTS) as VitalId[]) {
    g.clear()
    VITAL_PAINTS[id](g)
    g.generateTexture(vitalIconKey(id), VITAL_ICON_PX, VITAL_ICON_PX)
  }
  g.destroy()
}
