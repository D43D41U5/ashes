/**
 * Les vitales (bas-gauche) : PV, endurance, faim, température — en MÉDAILLONS,
 * façon Don't Starve. Au-dessus d'eux la ligne des blessures, puis les métiers
 * appris. Purement de l'affichage : les valeurs viennent du snapshot, aucune
 * logique de jeu ici (le niveau de métier est calculé par `skillLevel`, de la sim).
 *
 * LE PRINCIPE : une jauge est une FORME, pas un chiffre. Chaque vitale est un
 * disque cerclé d'encre, qui se vide comme un LIQUIDE — un niveau horizontal qui
 * descend. On lit d'un coup d'œil « il m'en reste un quart » sans jamais lire de
 * nombre — le chiffre exact n'apparaît qu'au SURVOL. C'est la même règle que le
 * Feu du village : prévisible dans le sens, flou dans la magnitude.
 *
 * L'icône est posée au centre EN SILHOUETTE D'ENCRE (teintée sombre) : sur un
 * disque de couleur, une icône colorée disparaîtrait. Le disque vidé garde un
 * ton de parchemin terni — assez clair pour que la silhouette y reste lisible,
 * assez sourd pour que la couleur de la jauge, elle, saute aux yeux.
 *
 * Le bloc est BAS-ALIGNÉ sur les cases de ceinture (`hotbarBottom`) : le bas de
 * l'écran lit comme une seule bande. Il est SEMI-TRANSPARENT en jeu et redevient
 * OPAQUE quand l'inventaire est ouvert — là, on ne regarde plus le monde.
 */
import { TEMPERATURE, skillLevel, type Entity, type SkillId } from '@braises/sim'
import type Phaser from 'phaser'
import { VITAL_ICON_PX, vitalIconKey, type VitalId } from '../../render/vital-art'
import { hotbarBottom } from './hotbar'

export interface Vitals {
  /** Cachées tant que la vallée n'est pas générée : une jauge vide sur un écran
   *  noir n'informe de rien (voir UIScene, `reveal`). */
  setVisible(v: boolean): void
  update(s: {
    hp: number
    stamina: number
    hunger: number
    temperature: number
    wounds: Entity['wounds']
    skills: Partial<Record<SkillId, number>>
    /** Inventaire ouvert → le bloc devient opaque. */
    inventoryOpen: boolean
  }): void
}

/** Maxima des jauges — posés par `spawnEntity` (packages/sim/src/sim.ts). */
const MAXIMA: Record<VitalId, number> = { hp: 100, stamina: 100, hunger: 100, temperature: 100 }

/** Les métiers, dans l'ordre où on veut les lire — nom français pour l'affichage. */
const SKILL_LABELS: Record<SkillId, string> = {
  woodcutting: 'Bûcheron',
  mining: 'Mineur',
  foraging: 'Cueilleur',
  crafting: 'Artisan',
}

/** Le disque fait le DOUBLE de l'icône : il faut qu'il reste un large anneau de
 *  couleur autour d'elle, sinon le remplissage n'a plus la place de se lire —
 *  c'est la jauge qu'on regarde, l'icône ne fait que la nommer. */
const R = 32
const D = R * 2
const GAP = 12
const X0 = 12
/** Les icônes sont peintes à VITAL_ICON_PX (32) et affichées à leur taille NATIVE :
 *  aucune mise à l'échelle, donc aucun pixel doublé. */
const ICON = VITAL_ICON_PX

/** Le trait de gravure qui cerne chaque médaillon, et la silhouette de l'icône. */
const INK = 0x14100c
/** Teinte de l'icône : encre, mais pas noir pur — un souffle d'ombre y survit. */
const INK_TINT = 0x2b2419
/** Le disque VIDÉ : parchemin terni. Ni assez clair pour crier, ni assez sombre
 *  pour avaler la silhouette. */
const EMPTY = 0x6e675b


const TEXT_ROW_H = 18
/** En jeu, le HUD s'efface un peu ; inventaire ouvert, il se donne à lire. */
const ALPHA_WORLD = 0.82
const ALPHA_OPEN = 1

interface Badge {
  id: VitalId
  cx: number
  cy: number
  /** La couleur pleine de la vitale — celle du disque quand tout va bien. */
  full: number
  /** Seuil sous lequel le disque vire au rouge (faim à zéro, froid qui mord) —
   *  `undefined` pour les vitales qui n'ont pas d'alarme (PV, endurance). */
  warn: number | undefined
  frac: number
  color: number
}

export function createVitals(scene: Phaser.Scene): Vitals {
  const cy = hotbarBottom(scene) - R // bord bas du médaillon = bord bas de la ceinture
  const badgeTop = cy - R

  const style = {
    fontFamily: 'monospace',
    fontSize: '13px',
    color: '#e8e0c8',
    stroke: '#14141a',
    strokeThickness: 3,
  } as const

  const badges: Badge[] = (['hp', 'stamina', 'hunger', 'temperature'] as VitalId[]).map((id, i) => ({
    id,
    cx: X0 + R + i * (D + GAP),
    cy,
    full: { hp: 0xc0503e, stamina: 0x4e9c5a, hunger: 0xd9a441, temperature: 0x6aa8d9 }[id],
    warn: { hp: undefined, stamina: undefined, hunger: 0, temperature: TEMPERATURE.HYPOTHERMIA }[id],
    frac: -1, // rien n'est encore dessiné
    color: 0,
  }))

  // UN seul Graphics pour les quatre disques : ils se redessinent ensemble, et
  // seulement quand une valeur a bougé (cf. `dirty` plus bas).
  const discs = scene.add.graphics()

  // Les icônes PAR-DESSUS les disques — teintées encre : leur dessin devient la
  // silhouette, aucun art à refaire.
  const icons = badges.map((b) =>
    scene.add
      .image(b.cx, b.cy, vitalIconKey(b.id))
      .setDisplaySize(ICON, ICON)
      .setTint(INK_TINT),
  )

  // Le chiffre du survol — DANS la bulle, pas au-dessus : blanc cerné de noir, il
  // se lit sur n'importe quel remplissage. Il PREND LA PLACE de l'icône (qu'on
  // masque) : superposés, les deux se mangeraient.
  const hover = scene.add
    .text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 5,
    })
    .setOrigin(0.5, 0.5)
    .setVisible(false)

  // Au-dessus des médaillons, ancrés par le BAS : ils poussent vers le haut sans
  // jamais déplacer les jauges. Les blessures collent aux médaillons — c'est
  // l'alarme, elle doit tomber sous l'œil en premier.
  const wounds = scene.add
    .text(X0, badgeTop - 6, '', { ...style, color: '#ff9a7a' })
    .setOrigin(0, 1)

  // Les métiers appris — la progression émergente, discrète mais visible :
  // on ne montre que les niveaux atteints (level > 0), sinon rien.
  const skills = scene.add
    .text(X0, badgeTop - 6 - TEXT_ROW_H, '', { ...style, color: '#c8b88a' })
    .setOrigin(0, 1)

  // Tout le bloc dans UN conteneur : l'alpha (semi-transparent / opaque) se pose
  // alors d'un seul geste, et l'ordre d'affichage reste celui de la construction.
  const root = scene.add.container(0, 0, [discs, ...icons, hover, wounds, skills])

  /**
   * Redessine les quatre disques : assise d'encre, fond vidé, NIVEAU, cerne.
   *
   * Le remplissage monte et descend comme un LIQUIDE dans un verre rond — un
   * niveau horizontal, pas une part de camembert. C'est ce que fait Don't Starve,
   * et c'est plus juste : une vitale qui baisse doit *descendre*, pas tourner.
   *
   * Le segment de disque sous le niveau se trace en un arc refermé par sa corde :
   * on prend les deux points du cercle à la hauteur du niveau, et on relie par le
   * BAS. Pas de masque, pas de deuxième texture.
   */
  const drawDiscs = (): void => {
    discs.clear()
    for (const b of badges) {
      discs.fillStyle(INK, 0.5).fillCircle(b.cx, b.cy + 2, R + 2) // l'assise, sous le disque
      discs.fillStyle(EMPTY, 1).fillCircle(b.cx, b.cy, R)
      if (b.frac >= 1) {
        discs.fillStyle(b.color, 1).fillCircle(b.cx, b.cy, R)
      } else if (b.frac > 0) {
        const dy = R - 2 * R * b.frac // hauteur du niveau, depuis le centre (+ = sous le centre)
        const half = Math.sqrt(Math.max(0, R * R - dy * dy)) // demi-corde à cette hauteur
        discs.fillStyle(b.color, 1)
        discs.beginPath()
        // du point droit au point gauche EN PASSANT PAR LE BAS ; `closePath` tire la corde.
        discs.arc(b.cx, b.cy, R, Math.atan2(dy, half), Math.atan2(dy, -half), false)
        discs.closePath()
        discs.fillPath()
      }
      discs.lineStyle(3, INK, 1).strokeCircle(b.cx, b.cy, R) // le trait de gravure
    }
  }

  return {
    setVisible(v) {
      root.setVisible(v)
    },
    update(s) {
      root.setAlpha(s.inventoryOpen ? ALPHA_OPEN : ALPHA_WORLD)

      const values: Record<VitalId, number> = {
        hp: s.hp,
        stamina: s.stamina,
        hunger: s.hunger,
        temperature: s.temperature,
      }

      // On ne redessine QUE si une jauge a bougé d'assez pour se voir : sinon
      // c'est une retessellation de quatre disques à chaque frame, pour rien.
      let dirty = false
      for (const b of badges) {
        const cur = values[b.id]
        const frac = Math.min(1, Math.max(0, cur / MAXIMA[b.id]))
        // La faim et la température qui plongent virent au rouge : un signal, pas un chiffre.
        const color = b.warn !== undefined && cur <= b.warn ? 0xc0503e : b.full
        if (Math.round(frac * 200) !== Math.round(b.frac * 200) || color !== b.color) {
          b.frac = frac
          b.color = color
          dirty = true
        }
      }
      if (dirty) drawDiscs()

      // Le chiffre ne se donne qu'au survol : on lit une forme, pas un nombre.
      const p = scene.input.activePointer
      const under = badges.findIndex((b) => (p.x - b.cx) ** 2 + (p.y - b.cy) ** 2 <= R * R)
      badges.forEach((b, i) => icons[i]!.setVisible(i !== under))
      if (under >= 0) {
        const b = badges[under]!
        hover
          .setText(String(Math.ceil(values[b.id])))
          .setPosition(b.cx, b.cy)
          .setVisible(true)
      } else {
        hover.setVisible(false)
      }

      const labels = [
        s.wounds.leg ? 'jambe blessée' : null,
        s.wounds.arm ? 'bras blessé' : null,
        s.wounds.bleeding ? 'SAIGNEMENT (X : bander)' : null,
      ].filter(Boolean)
      wounds.setText(labels.join(' · '))
      const skillsText = (Object.keys(SKILL_LABELS) as SkillId[])
        .map((id) => ({ id, level: skillLevel(s.skills[id] ?? 0) }))
        .filter(({ level }) => level > 0)
        .map(({ id, level }) => `${SKILL_LABELS[id]} ${level}`)
        .join(' · ')
      skills.setText(skillsText)
    },
  }
}
