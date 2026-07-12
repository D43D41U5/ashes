/**
 * Les vitales (bas-gauche) : PV, endurance, faim, température — en jauges —,
 * sous elles la ligne des blessures, puis les métiers appris. Remplace le pavé
 * de texte du bas (spec inventaire R18). Purement de l'affichage : les valeurs
 * viennent du snapshot, aucune logique de jeu ici (le niveau de métier est
 * calculé par `skillLevel`, de la sim).
 */
import { TEMPERATURE, skillLevel, type Entity, type SkillId } from '@braises/sim'
import type Phaser from 'phaser'

export interface Vitals {
  update(s: {
    hp: number
    stamina: number
    hunger: number
    temperature: number
    wounds: Entity['wounds']
    skills: Partial<Record<SkillId, number>>
  }): void
}

/** Maxima des jauges — posés par `spawnEntity` (packages/sim/src/sim.ts). */
const HP_MAX = 100
const STAMINA_MAX = 100
const HUNGER_MAX = 100
const TEMP_MAX = 100

/** Les métiers, dans l'ordre où on veut les lire — nom français pour l'affichage. */
const SKILL_LABELS: Record<SkillId, string> = {
  woodcutting: 'Bûcheron',
  mining: 'Mineur',
  foraging: 'Cueilleur',
  crafting: 'Artisan',
}

const BAR_W = 140
const BAR_H = 10
const ROW_H = 16
const ICON = 12

interface Gauge {
  bar: Phaser.GameObjects.Rectangle
  value: Phaser.GameObjects.Text
  full: number
  color: number
}

export function createVitals(scene: Phaser.Scene): Vitals {
  const x = 12
  const iconX = x
  const barX = x + ICON + 6
  const valueX = barX + BAR_W + 8
  // Six rangées : 4 jauges, la ligne des blessures, la ligne des métiers.
  const baseY = scene.scale.height - 12 - 6 * ROW_H

  const style = {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e8e0c8',
    stroke: '#14141a',
    strokeThickness: 3,
  } as const

  const makeRow = (row: number, color: number): Gauge => {
    const y = baseY + row * ROW_H
    scene.add.rectangle(iconX, y, ICON, ICON, color).setOrigin(0, 0) // l'icône = la couleur de la jauge
    scene.add.rectangle(barX - 2, y - 2, BAR_W + 4, BAR_H + 4, 0x14141a).setOrigin(0, 0)
    const bar = scene.add.rectangle(barX, y, BAR_W, BAR_H, color).setOrigin(0, 0)
    const value = scene.add.text(valueX, y - 1, '', style).setOrigin(0, 0)
    return { bar, value, full: color, color }
  }

  const hp = makeRow(0, 0xc0503e)
  const stamina = makeRow(1, 0x4e9c5a)
  const hunger = makeRow(2, 0xd9a441)
  const temperature = makeRow(3, 0x6aa8d9)

  const wounds = scene.add
    .text(x, baseY + 4 * ROW_H, '', { ...style, color: '#ff9a7a' })
    .setOrigin(0, 0)

  // Les métiers appris — la progression émergente, discrète mais visible :
  // on ne montre que les niveaux atteints (level > 0), sinon rien.
  const skills = scene.add
    .text(x, baseY + 5 * ROW_H, '', { ...style, color: '#c8b88a' })
    .setOrigin(0, 0)

  const setGauge = (g: Gauge, cur: number, max: number, warn?: number): void => {
    g.bar.width = (BAR_W * Math.max(0, cur)) / max
    // La faim et la température qui plongent virent au rouge : un signal, pas un chiffre.
    g.bar.fillColor = warn !== undefined && cur <= warn ? 0xc0503e : g.full
    g.value.setText(String(Math.ceil(cur)))
  }

  return {
    update(s) {
      setGauge(hp, s.hp, HP_MAX)
      setGauge(stamina, s.stamina, STAMINA_MAX)
      setGauge(hunger, s.hunger, HUNGER_MAX, 0)
      // Sous TEMPERATURE.HYPOTHERMIA le froid mord : la jauge vire au rouge.
      setGauge(temperature, s.temperature, TEMP_MAX, TEMPERATURE.HYPOTHERMIA)
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
