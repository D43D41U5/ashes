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
import { CARRY, TEMPERATURE, carryTier, skillLevel, type CarryTier, type Entity, type SkillId } from '@braises/sim'
import type Phaser from 'phaser'
import { VITAL_ICON_PX, vitalIconKey, type VitalId } from '../../render/vital-art'
import { hotbarBottom } from './hotbar'
import { COL, HEX, VITAL_COL } from './palette'
import { FONT } from './typography'

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
    /** Le POIDS porté (spec portage.md P11) — en unités, pas en fraction : le
     *  survol montre le vrai chiffre, et la fraction se déduit de la capacité. */
    carry: number
    /** Inventaire ouvert → le bloc devient opaque. */
    characterMenuOpen: boolean
  }): void
}

/** Maxima des jauges — posés par `spawnEntity` (packages/sim/src/sim.ts). */
// La charge se remplit sur la CAPACITÉ, pas sur 100 : son médaillon est plein quand
// le sac l'est. Au-delà (surcharge), le disque reste plein — et vire au rouge.
const MAXIMA: Record<VitalId, number> = { hp: 100, stamina: 100, hunger: 100, temperature: 100, carry: CARRY.CAPACITY }

/**
 * LA COULEUR DU POIDS — une par palier (spec portage.md P11). Les seuils, eux, ne
 * sont PAS ici : ils viennent de `carryTier` (/sim). Le HUD ne redéfinit pas les
 * règles du jeu, il les montre — deux jeux de seuils divergeraient au premier
 * ajustement, et le joueur verrait « lourd » en sprintant encore.
 */
const CARRY_COLOR: Record<CarryTier, number> = {
  light: 0x7e8a94, // gris acier : on ne sent rien, et l'icône ne doit pas crier
  medium: COL.ember, // braise : le premier cran, on le voit
  heavy: COL.emberDeep, // braise profonde : plus de sprint
  overloaded: COL.alert, // alerte : on rampe, et l'endurance ne revient plus
}

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

/** Le trait de gravure qui cerne chaque médaillon (encre de la maquette #14141a). */
const INK = COL.ink
/** L'icône est une SILHOUETTE NOIRE (maquette : `filter:brightness(0)`) — elle se lit
 *  sur le remplissage coloré, et s'efface dans le sombre quand la jauge est basse. */
const ICON_INK = 0x000000
/** Le disque VIDÉ : le panneau sombre de la maquette (#1b1b22), pas un parchemin. */
const EMPTY = COL.panel


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
  /** Le liseré clair au NIVEAU du liquide (maquette : `border-top` du remplissage). */
  rim: number
  /** Le libellé de l'infobulle au survol (maquette : « PV 82 / 100 »). */
  label: string
  /** Le max de la jauge, pour l'infobulle. */
  max: number
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
    fontFamily: FONT,
    fontSize: '13px',
    color: '#e8e0c8',
    stroke: '#14141a',
    strokeThickness: 3,
  } as const

  const badges: Badge[] = (['hp', 'stamina', 'hunger', 'temperature', 'carry'] as VitalId[]).map((id, i) => ({
    id,
    cx: X0 + R + i * (D + GAP),
    cy,
    full: {
      hp: VITAL_COL.hp.fill,
      stamina: VITAL_COL.stamina.fill,
      hunger: VITAL_COL.hunger.fill,
      temperature: VITAL_COL.temperature.fill,
      carry: CARRY_COLOR.light,
    }[id],
    rim: {
      hp: VITAL_COL.hp.rim,
      stamina: VITAL_COL.stamina.rim,
      hunger: VITAL_COL.hunger.rim,
      temperature: VITAL_COL.temperature.rim,
      carry: 0xa7b1b8,
    }[id],
    label: { hp: 'PV', stamina: 'ENDURANCE', hunger: 'FAIM', temperature: 'TEMP', carry: 'POIDS' }[id],
    max: MAXIMA[id],
    warn: { hp: undefined, stamina: undefined, hunger: 0, temperature: TEMPERATURE.HYPOTHERMIA, carry: undefined }[id],
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
      .setTint(ICON_INK),
  )

  // L'infobulle du survol (maquette Turn 5A) : une petite boîte AU-DESSUS du médaillon
  // — « PV 82 / 100 » sur fond chaud sombre cerné d'encre. L'icône, elle, reste en place.
  const hoverText = scene.add
    .text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: HEX.body })
    .setOrigin(0.5, 0.5)
  const hoverBg = scene.add.rectangle(0, 0, 10, 10, 0x14100c, 1).setStrokeStyle(2, INK).setOrigin(0.5, 0.5)
  const hover = scene.add.container(0, 0, [hoverBg, hoverText]).setVisible(false)

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
      // L'ombre portée dure de la maquette (`box-shadow:0 3px 0 rgba(0,0,0,.5)`).
      discs.fillStyle(0x000000, 0.5).fillCircle(b.cx, b.cy + 3, R)
      // Le disque VIDÉ : le panneau sombre (#1b1b22).
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
        // Le liseré clair AU NIVEAU du liquide (maquette : `border-top` du remplissage) :
        // une corde 2px à la teinte de rim, sur la largeur de la surface.
        discs.lineStyle(2, b.rim, 1).lineBetween(b.cx - half, b.cy + dy, b.cx + half, b.cy + dy)
      }
      discs.lineStyle(3, INK, 1).strokeCircle(b.cx, b.cy, R) // le trait de gravure, par-dessus
    }
  }

  return {
    setVisible(v) {
      root.setVisible(v)
    },
    update(s) {
      root.setAlpha(s.characterMenuOpen ? ALPHA_OPEN : ALPHA_WORLD)

      const values: Record<VitalId, number> = {
        hp: s.hp,
        stamina: s.stamina,
        hunger: s.hunger,
        temperature: s.temperature,
        carry: s.carry,
      }
      // Le palier vient de /sim : le HUD ne connaît pas les seuils, il les LIT.
      const tier = carryTier(s.carry / CARRY.CAPACITY)

      // On ne redessine QUE si une jauge a bougé d'assez pour se voir : sinon
      // c'est une retessellation de quatre disques à chaque frame, pour rien.
      let dirty = false
      for (const b of badges) {
        const cur = values[b.id]
        const frac = Math.min(1, Math.max(0, cur / MAXIMA[b.id]))
        // La faim et la température qui plongent virent au rouge : un signal, pas un chiffre.
        // Le POIDS, lui, change de couleur à chaque PALIER — c'est sa seule lecture.
        const color =
          b.id === 'carry' ? CARRY_COLOR[tier] : b.warn !== undefined && cur <= b.warn ? COL.alert : b.full
        if (Math.round(frac * 200) !== Math.round(b.frac * 200) || color !== b.color) {
          b.frac = frac
          b.color = color
          dirty = true
        }
      }
      if (dirty) drawDiscs()

      // Le chiffre ne se donne qu'au survol : on lit une forme, pas un nombre. La
      // boîte apparaît AU-DESSUS du médaillon survolé ; l'icône reste en place.
      const p = scene.input.activePointer
      const under = badges.findIndex((b) => (p.x - b.cx) ** 2 + (p.y - b.cy) ** 2 <= R * R)
      if (under >= 0) {
        const b = badges[under]!
        const v = values[b.id]
        hoverText.setText(b.id === 'carry' ? `${b.label} ${v.toFixed(1)} / ${b.max}` : `${b.label} ${Math.ceil(v)} / ${b.max}`)
        hoverBg.setSize(hoverText.width + 12, hoverText.height + 6)
        hover.setPosition(b.cx, b.cy - R - 12).setVisible(true)
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
