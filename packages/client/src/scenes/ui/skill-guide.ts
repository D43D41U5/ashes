/**
 * LA FICHE DE CHAQUE MÉTIER — le geste, les paliers débloqués au niveau, les passifs.
 *
 * Contenu PUR, DÉRIVÉ de /sim : chaque seuil de niveau est calculé en SONDANT les
 * fonctions du sim (`maxTierByLevel`, `fellGreenWidth`, `mineTolerance`) ou lu des paliers
 * de `BALANCE` (cueillette), jamais recopié d'une constante ni d'un commentaire. Si un nombre bouge
 * dans `balance.ts`, la fiche suit — elle ne peut pas mentir au joueur. Le test
 * (`skill-guide.test.ts`) verrouille cet accord palier↔sim.
 *
 * PIÈGE À ÉVITER (garde du test) : les quatre métiers NE PARTAGENT PAS la même échelle.
 *  - L'échelle d'outil (atelier→fer→acier) est INERTE pour le Cueilleur (récolte à mains
 *    nues, `tool: null`) et ABSENTE pour l'Artisan (aucun nœud n'a `skill: 'crafting'`).
 *  - Le palier de NIVEAU débloque le RENDEMENT d'un outil qu'on tient, PAS son ACCÈS :
 *    miner le fer / abattre le vieux chêne exige un outil forgé EN MAIN (`minTool`), ce
 *    qui est une affaire d'OUTIL, pas de niveau. La fiche ne parle que de ce que le NIVEAU
 *    change ; l'accès est une note à part.
 */
import { keymapEffectif } from '../world/keymap-perso'
import { libelleTouches } from '../world/touches'
import {
  BALANCE,
  TOOL_RANK,
  TOOL_YIELD,
  fellGreenWidth,
  maxTierByLevel,
  mineTolerance,
  type SkillId,
  type ToolTier,
} from '@ashes/sim'
import { SKILL_LABELS } from './skill-labels'

export interface SkillPalier {
  /** Niveau où ce gain s'ouvre. */
  level: number
  /** Ce qui se débloque, en une ligne. */
  text: string
}

export interface SkillGuide {
  id: SkillId
  label: string
  /** Le fonctionnement du geste, une phrase — ce que le joueur FAIT. */
  gesture: string
  /** Ce que le NIVEAU débloque, palier par palier (trié par niveau croissant). */
  paliers: SkillPalier[]
  /** Les gains CONTINUS (pas un palier net) : micro-marches, bonus de coup propre… */
  passifs: string[]
  /** Une réserve à part : ce qui dépend de l'OUTIL en main, pas du niveau (ou null). */
  outilNote: string | null
}

// ── Dérivations : on SONDE le sim, on ne recopie pas les constantes ──────────

/** Le plus petit niveau où un outil de ce palier rend à PLEIN (n'est plus rabattu au
 *  palier maîtrisé). Lu du comportement de `maxTierByLevel`, donc suit tout déplacement
 *  du gate dans `balance.ts`. `Infinity` si jamais (garde du test). */
export function tierUncapLevel(tier: ToolTier): number {
  for (let l = 0; l <= 64; l++) {
    if (TOOL_RANK[maxTierByLevel(l)] >= TOOL_RANK[tier]) return l
  }
  return Infinity
}

/** Le plus petit niveau où le vert d'abattage atteint sa largeur MAX (« autopilote »). */
export function fellAutopilotLevel(): number {
  const max = fellGreenWidth(1024)
  for (let l = 0; l <= 64; l++) if (fellGreenWidth(l) >= max) return l
  return Infinity
}

/** Le plus petit niveau où la tolérance de minage atteint `target` (1 = flancs voisins,
 *  2 = tous les flancs). Lu de `mineTolerance`. */
export function mineToleranceLevel(target: 1 | 2): number {
  for (let l = 0; l <= 64; l++) if (mineTolerance(l) >= target) return l
  return Infinity
}

/** Le plus petit niveau où un artisan façonne au moins `factor`× plus vite (débit). */
export function craftSpeedLevel(factor: number): number {
  for (let l = 0; l <= 64; l++) if (1 + BALANCE.CRAFT_SPEED_BONUS * l >= factor) return l
  return Infinity
}

// ── Petits formateurs (le français des nombres) ─────────────────────────────

const pct = (frac: number): string => {
  const v = frac * 100
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')
  return `${s} %` // « 50 % », « 1,5 % » — virgule française, pas de décimale inutile
}
const YIELD_STEP = BALANCE.SKILL_YIELD_STEP

/** La ligne « +1 rendement tous les N niveaux » — la micro-marche de `harvestStrike`. */
const yieldStepLine = (): string => `+1 de rendement tous les ${YIELD_STEP} niveaux`

/** La ligne « coup propre » — le bonus DOUX partagé par l'abattage et le minage. */
const cleanLine = (extra: string): string =>
  `Coup propre : +${pct(BALANCE.CLEAN_YIELD_BONUS)} de rendement${extra}`

/** Un palier « l'outil de ce palier rend à plein », avec le rendement en clair (×N). */
const toolTierPalier = (tier: ToolTier, label: string): SkillPalier => ({
  level: tierUncapLevel(tier),
  text: `${label} rend à plein (×${TOOL_YIELD[tier]})`,
})

// Par palier croissant — le tri final range les collisions (fer & autopilote au même niveau).
const byLevel = (a: SkillPalier, b: SkillPalier): number => a.level - b.level

// ── LES QUATRE FICHES ───────────────────────────────────────────────────────

/** Bûcheron : le TIMING. Charger la hache, relâcher au bon instant. */
function woodcuttingGuide(): SkillGuide {
  return {
    id: 'woodcutting',
    label: SKILL_LABELS.woodcutting,
    gesture: "Clic maintenu sur l'arbre : une jauge se remplit. Relâche dans le VERT pour un coup propre.",
    paliers: [
      { level: fellAutopilotLevel(), text: 'Le vert est au plus large — tu abats presque sans viser' },
      toolTierPalier('basic', "La hache d'atelier"),
      toolTierPalier('iron', 'La hache de fer'),
      toolTierPalier('steel', "La hache d'acier"),
    ].sort(byLevel),
    passifs: [yieldStepLine(), cleanLine(', usure moindre')],
    outilNote: "Le vieux chêne (bois dur) exige au moins une hache d'atelier EN MAIN — question d'outil, pas de niveau.",
  }
}

/** Mineur : le POINT FAIBLE SPATIAL. Frapper le flanc qui luit. */
function miningGuide(): SkillGuide {
  return {
    id: 'mining',
    label: SKILL_LABELS.mining,
    gesture: 'Clic maintenu, curseur sur le flanc qui LUIT. Le bon flanc saute à chaque coup.',
    paliers: [
      { level: mineToleranceLevel(1), text: "L'acceptation déborde sur les flancs voisins" },
      { level: mineToleranceLevel(2), text: 'Tous les flancs portent — autopilote' },
      toolTierPalier('basic', "La pioche d'atelier"),
      toolTierPalier('iron', 'La pioche de fer'),
      toolTierPalier('steel', "La pioche d'acier"),
    ].sort(byLevel),
    passifs: [yieldStepLine(), cleanLine(', et le filon cède plus vite')],
    outilNote: 'Le fer, le charbon et la pierre taillée exigent une pioche forgée EN MAIN — question d\'outil, pas de niveau.',
  }
}

/** Cueilleur : la PERCEPTION. Savoir où sont les bons coins. Aucune échelle d'outil. */
function foragingGuide(): SkillGuide {
  return {
    id: 'foraging',
    label: SKILL_LABELS.foraging,
    // LA TOUCHE SE DÉRIVE, ELLE NE S'ÉCRIT PLUS. Cette fiche a annoncé « presse E »
    // pendant 23 jours après que la cueillette est passée de E à F (2026-07-27, E est
    // devenue la rotation d'arête). Un joueur lisait une fiche officielle du jeu,
    // pressait E devant un buisson, et n'obtenait ni geste ni refus. Le menu pause,
    // lui, disait vrai — il dérive de `keymapEffectif`. C'était la troisième surface
    // d'apprentissage, celle que la décision de découvrabilité n'avait pas couverte.
    // (Audit UX 2026-08-20, D5-2 / P0.5. Gardé par `skill-guide.test`.)
    gesture: `Vise le buisson et presse ${libelleTouches(keymapEffectif().forage)} : il tombe ENTIER dans le sac, sans cadence.`,
    paliers: [
      { level: BALANCE.FORAGE_SEED_LEVEL, text: 'Un coin riche peut rendre une SEMENCE — de quoi lancer le potager' },
      { level: BALANCE.FORAGE_QUALITY_LEVEL, text: 'Tu sais lire les patches de CHAMPIGNONS — l\'humide, l\'ombre' },
    ],
    passifs: [yieldStepLine()],
    outilNote: 'La cueillette est à mains nues : aucun outil, donc aucun palier d\'outil.',
  }
}

/** Artisan : le TEMPS DES AUTRES. Aucun palier net — deux pentes continues. */
function craftingGuide(): SkillGuide {
  const wearPerLevel = pct(BALANCE.SKILL_WEAR_REDUCTION)
  return {
    id: 'crafting',
    label: SKILL_LABELS.crafting,
    gesture: "La file de craft façonne avec le temps. Ton niveau raccourcit chaque fabrication.",
    paliers: [], // rien ne s'ouvre d'un coup : l'Artisan est une pente, pas des marches
    passifs: [
      `Chaque niveau raccourcit la fabrication (au niveau ${craftSpeedLevel(2)}, deux fois plus vite)`,
      `Tes outils s'usent moins en récoltant : −${wearPerLevel} par niveau, jusqu'au plancher`,
    ],
    outilNote: null,
  }
}

/** Les quatre fiches, dans l'ordre du paperdoll. Reconstruites à l'appel (pures, bon marché). */
export function skillGuides(): SkillGuide[] {
  return [woodcuttingGuide(), miningGuide(), foragingGuide(), craftingGuide()]
}

export function skillGuideOf(id: SkillId): SkillGuide {
  return skillGuides().find((g) => g.id === id)!
}
