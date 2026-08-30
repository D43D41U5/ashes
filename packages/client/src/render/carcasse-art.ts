/**
 * LES CARCASSES (spec `depecage.md` R1c) — une bête morte se dessine COUCHÉE, par espèce, et
 * selon CE QUI RESTE : pleine, entamée, dépouillée. Pas de jauge : le réservoir se lit sur le
 * corps. L'ordre des parts est tiré (D3), donc l'art suit le COMPTE, pas la couche.
 *
 * Même facture que la faune de `BootScene.makeFauna` (ellipses, triangles, pattes en
 * rectangles, les teintes de chaque robe) : une bête couchée doit se reconnaître comme
 * l'animal qu'on a traqué — le sanglier bas et massif, le cerf long, le loup gris, le lapin
 * minuscule. Pur dessin : aucune règle de jeu ici.
 *
 * Les dessins sont écrits contre `Peintre` (peintre.ts) : le MÊME code peint la texture flat
 * (BootScene, via Graphics) et l'albédo de la paire `_lit` (Canvas2D → normale dérivée) — un
 * cadavre vit dans le monde, donc sous sa lumière, comme les nœuds et les acteurs.
 */
import type Phaser from 'phaser'
import { MONSTER_DEFS, type Corpse, type MonsterType } from '@ashes/sim'
import { newCanvas, registerLitPaire } from './normal-map'
import { PeintreCanvas, type Peintre } from './peintre'

/** L'état d'art d'une carcasse : 0 = pleine, 1 = entamée, 2 = dépouillée (presque rien). */
export type EtatCarcasse = 0 | 1 | 2

/** Les espèces qui ont une carcasse dessinée — les autres (le Cendreux) retombent sur les ossements. */
const ESPECES: readonly MonsterType[] = ['boar', 'deer', 'wolf', 'rabbit', 'tetras']

export function cleCarcasse(species: MonsterType, etat: EtatCarcasse): string {
  return ESPECES.includes(species) ? `spr-carcasse-${species}-${etat}` : 'spr-corpse'
}

/**
 * L'ÉTAT d'une carcasse d'après ce qui lui reste : PLEINE tant que rien n'en est sorti (`parts`,
 * posé à la mort), DÉPOUILLÉE quand il n'y reste plus que l'os de la table de l'espèce (ce que le
 * novice laisse — la bête est bien vidée, même si l'os y est encore), ENTAMÉE entre les deux.
 */
export function etatCarcasse(corpse: Corpse): EtatCarcasse {
  if (corpse.carcass === undefined) return 0
  let reste = 0
  for (const slot of corpse.inventory) if (slot !== null) reste += slot.count
  if (reste >= corpse.carcass.parts) return 0
  const os = MONSTER_DEFS[corpse.carcass.species].loot.bone ?? 0
  if (reste <= os) return 2
  return 1
}

// ── SANGLIER couché : la masse sur le flanc, pattes raides vers la gauche, la hure au sol.
const sanglier = (g: Peintre, etat: EtatCarcasse): void => {
  if (etat < 2) {
    g.fillStyle(0x4a2e1a).fillEllipse(12, 7, 20, 10) // corps, contour sombre
    g.fillStyle(0x8a5a38).fillEllipse(12, 7, 17, 7) // robe
    g.fillStyle(0x6b442a).fillTriangle(2, 6, 2, 10, 8, 8) // hure, posée
    g.fillStyle(0xe8e0cc).fillRect(1, 8, 3, 1) // la défense
    g.fillStyle(0x3a2416).fillRect(14, 10, 4, 2).fillRect(18, 9, 4, 2) // pattes raides, à plat
  } else {
    g.fillStyle(0x4a2e1a).fillEllipse(12, 8, 18, 6) // ce qui reste de la masse, à plat
    g.fillStyle(0x6b442a).fillTriangle(2, 6, 2, 10, 8, 8)
    g.fillStyle(0xe8e0cc).fillRect(1, 8, 3, 1)
  }
  if (etat === 1) {
    g.fillStyle(0x5a1a16).fillRect(9, 4, 7, 5) // le flanc ouvert
    g.fillStyle(0x9c2e28).fillRect(10, 5, 5, 3)
  }
  if (etat === 2) {
    g.fillStyle(0xe6ddc8).fillRect(8, 5, 1, 6).fillRect(11, 5, 1, 6).fillRect(14, 5, 1, 6).fillRect(7, 6, 10, 1) // les côtes
  }
}

// ── CERF couché : long, les pattes fines raides, l'encolure à plat, les bois au sol.
const cerf = (g: Peintre, etat: EtatCarcasse): void => {
  if (etat < 2) {
    g.fillStyle(0x4a3524).fillEllipse(11, 8, 18, 9) // corps
    g.fillStyle(0x9b7448).fillEllipse(11, 8, 15, 6) // robe fauve
    g.fillStyle(0x8a6640).fillRect(18, 7, 6, 3) // encolure à plat
    g.fillStyle(0x9b7448).fillEllipse(24, 8, 5, 3) // tête au sol
    g.fillStyle(0x3a2a1c).fillRect(3, 11, 5, 2).fillRect(8, 12, 5, 2) // pattes raides
  } else {
    g.fillStyle(0x4a3524).fillEllipse(11, 9, 16, 5)
    g.fillStyle(0x8a6640).fillRect(18, 7, 6, 3)
    g.fillStyle(0x9b7448).fillEllipse(24, 8, 5, 3)
  }
  g.fillStyle(0xcfc0a4).fillRect(22, 3, 1, 4).fillRect(25, 3, 1, 4).fillRect(21, 4, 1, 1).fillRect(26, 4, 1, 1) // les bois
  if (etat === 1) {
    g.fillStyle(0x5a1a16).fillRect(7, 5, 8, 5)
    g.fillStyle(0x9c2e28).fillRect(8, 6, 6, 3)
  }
  if (etat === 2) {
    g.fillStyle(0xe6ddc8).fillRect(6, 6, 1, 6).fillRect(9, 6, 1, 6).fillRect(12, 6, 1, 6).fillRect(15, 6, 1, 6).fillRect(5, 7, 12, 1)
  }
}

// ── LOUP couché : la ligne grise à plat, le museau au sol, la queue basse.
const loup = (g: Peintre, etat: EtatCarcasse): void => {
  if (etat < 2) {
    g.fillStyle(0x2e3238).fillEllipse(11, 7, 19, 7) // corps
    g.fillStyle(0x6b7078).fillEllipse(11, 7, 16, 4) // robe grise
    g.fillStyle(0x5c6168).fillTriangle(2, 5, 2, 9, 9, 7) // museau
    g.fillStyle(0xe8e4dc).fillRect(1, 7, 2, 1) // le croc
    g.fillStyle(0x2e3238).fillRect(13, 9, 4, 2).fillRect(17, 8, 4, 2) // pattes à plat
    g.fillStyle(0x6b7078).fillTriangle(19, 6, 22, 3, 21, 8) // la queue
  } else {
    g.fillStyle(0x2e3238).fillEllipse(11, 8, 17, 4)
    g.fillStyle(0x5c6168).fillTriangle(2, 5, 2, 9, 9, 7)
    g.fillStyle(0xe8e4dc).fillRect(1, 7, 2, 1)
  }
  if (etat === 1) {
    g.fillStyle(0x5a1a16).fillRect(9, 4, 6, 4)
    g.fillStyle(0x9c2e28).fillRect(10, 5, 4, 2)
  }
  if (etat === 2) {
    g.fillStyle(0xe6ddc8).fillRect(8, 5, 1, 5).fillRect(11, 5, 1, 5).fillRect(14, 5, 1, 5).fillRect(7, 6, 9, 1)
  }
}

// ── LAPIN couché : la boule à plat, les oreilles étalées, le scut.
const lapin = (g: Peintre, etat: EtatCarcasse): void => {
  if (etat < 2) {
    g.fillStyle(0x6b5a48).fillEllipse(6, 5, 10, 6) // corps
    g.fillStyle(0xa8927a).fillEllipse(6, 5, 8, 4) // robe
    g.fillStyle(0xa8927a).fillCircle(10, 5, 2) // tête
    g.fillStyle(0x6b5a48).fillRect(10, 1, 4, 1).fillRect(11, 2, 4, 1) // oreilles étalées
    g.fillStyle(0xe6e0d4).fillCircle(1, 5, 1) // scut
  } else {
    g.fillStyle(0x6b5a48).fillEllipse(6, 5, 8, 3)
    g.fillStyle(0xa8927a).fillCircle(10, 5, 2)
    g.fillStyle(0x6b5a48).fillRect(10, 1, 4, 1).fillRect(11, 2, 4, 1)
  }
  if (etat === 1) {
    g.fillStyle(0x5a1a16).fillRect(4, 4, 4, 3)
    g.fillStyle(0x9c2e28).fillRect(5, 5, 2, 1)
  }
  if (etat === 2) {
    g.fillStyle(0xe6ddc8).fillRect(4, 4, 1, 3).fillRect(6, 4, 1, 3).fillRect(3, 5, 5, 1)
  }
}

// ── TÉTRAS couché (spec faune R21) : une aile encore ouverte. C'est LA lecture —
// l'oiseau est tombé en vol, et l'aile restée déployée le dit. Un tas de plumes
// refermé se serait confondu avec le lapin à distance.
const tetras = (g: Peintre, etat: EtatCarcasse): void => {
  if (etat < 2) {
    g.fillStyle(0x1e2126).fillEllipse(9, 7, 13, 7) // corps à plat
    g.fillStyle(0x3c4148).fillEllipse(9, 7, 10, 5) // robe ardoise
    g.fillStyle(0x2e3238).fillTriangle(6, 6, 17, 2, 12, 8) // L'AILE restée ouverte
    g.fillStyle(0x3c4148).fillCircle(3, 8, 2) // tête retournée
    g.fillStyle(0xc0392b).fillRect(2, 6, 2, 1) // le sourcil rouge, éteint
    g.fillStyle(0xe8e0cc).fillRect(0, 8, 2, 1) // bec
  } else {
    g.fillStyle(0x1e2126).fillEllipse(9, 8, 10, 3)
    g.fillStyle(0x2e3238).fillTriangle(7, 7, 15, 4, 12, 8) // l'aile reste : c'est de l'os et des plumes
    g.fillStyle(0x3c4148).fillCircle(3, 8, 2)
    g.fillStyle(0xe8e0cc).fillRect(0, 8, 2, 1)
  }
  if (etat === 1) {
    g.fillStyle(0x5a1a16).fillRect(7, 5, 5, 4)
    g.fillStyle(0x9c2e28).fillRect(8, 6, 3, 2)
  }
  if (etat === 2) {
    g.fillStyle(0xe6ddc8).fillRect(7, 6, 1, 4).fillRect(10, 6, 1, 4).fillRect(6, 7, 6, 1)
  }
}

// ── LES OSSEMENTS (la dépouille humaine, et toute espèce sans carcasse dessinée).
const ossements = (g: Peintre): void => {
  g.fillStyle(0xcac2b2).fillRect(3, 7, 10, 2).fillRect(5, 4, 2, 8).fillRect(9, 4, 2, 8)
}

interface Espece {
  species: MonsterType
  w: number
  h: number
  draw: (g: Peintre, etat: EtatCarcasse) => void
}

const DESSINS: readonly Espece[] = [
  { species: 'boar', w: 22, h: 13, draw: sanglier },
  { species: 'deer', w: 28, h: 14, draw: cerf },
  { species: 'wolf', w: 22, h: 11, draw: loup },
  { species: 'rabbit', w: 16, h: 8, draw: lapin },
  { species: 'tetras', w: 18, h: 11, draw: tetras },
]

/** Les seize dessins — les quinze carcasses (5 espèces × 3 états) plus les ossements —
 *  en TABLE : les deux backends (flat et `_lit`) et la garde de couverture balaient la même. */
export const CARCASSE_ART: readonly { key: string; w: number; h: number; draw: (g: Peintre) => void }[] = [
  ...DESSINS.flatMap((e) =>
    ([0, 1, 2] as const).map((etat) => ({
      key: cleCarcasse(e.species, etat),
      w: e.w,
      h: e.h,
      draw: (g: Peintre) => e.draw(g, etat),
    })),
  ),
  { key: 'spr-corpse', w: 16, h: 16, draw: ossements },
]

/** Génère les seize textures flat. Appelée une fois au boot, sur un `Graphics` jetable. */
export function makeCarcasseTextures(g: Phaser.GameObjects.Graphics): void {
  for (const a of CARCASSE_ART) {
    a.draw(g)
    g.generateTexture(a.key, a.w, a.h)
    g.clear()
  }
}

/**
 * LES PAIRES `_lit` — un cadavre est un objet du MONDE : sans `setLighting`, il restait pleine
 * couleur en pleine nuit (l'ambiante ne mord que les sprites basculés, le voile passe sous
 * eux). Le même dessin rejoué sur Canvas2D fait l'albédo ; la normale est la butte lissée par
 * défaut (une dépouille est une masse molle, pas un cube), `dresse:false` (couchée à plat).
 */
export function generateCarcassesLit(scene: Phaser.Scene): void {
  for (const a of CARCASSE_ART) {
    const alb = newCanvas(a.w, a.h)
    a.draw(new PeintreCanvas(alb.ctx))
    registerLitPaire(scene, a.key, { albedo: alb.c, dresse: false })
  }
}
