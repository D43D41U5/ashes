/**
 * LE BESTIAIRE — CE QUE L'ÉCRAN A LE DROIT DE DIRE (spec `peche.md` R11, B5).
 *
 * Ce module DÉRIVE, depuis `FISH_SPECIES` et le carnet de l'avatar, exactement ce que l'onglet
 * BESTIAIRE affiche — et rien de plus. Il ne dessine pas : `hud-character.ts` pose le DOM à
 * partir de ce qu'il rend ici. La séparation existe pour UNE raison, et c'est une règle de jeu :
 *
 *   **UNE ESPÈCE JAMAIS PRISE NE DIT RIEN.** (décision d'Alexis, 2026-08-24)
 *
 * Pas son nom, pas son eau, pas sa saison, pas sa taille, pas sa silhouette — et surtout pas de
 * fiche au survol : `fiche` vaut `null`, donc le rendu n'a rien à poser sous le curseur. Une
 * fiche « vide » qu'on cacherait en CSS serait la même fuite, à un inspecteur près.
 *
 * Cette promesse ne se garde pas à l'œil : elle se prouve par un balayage EXHAUSTIF de la table
 * (`bestiaire.test.ts`), qui cherche dans la case muette la moindre chaîne révélatrice. Une
 * espèce ajoutée demain est couverte par construction — c'est tout l'intérêt de dériver ici
 * plutôt que de se souvenir, dans un `if` du rendu, de ne pas parler.
 */
import { BALANCE, FISH_SPECIES, ZONES, type ClasseDePrise, type FishSpecies } from '@ashes/sim'

/** Les quatre saisons, en court : la fiche fait 274 px et porte déjà l'eau, l'heure et le pays. */
const SAISON_COURTE = ['éclosion', 'ardeur', 'pluies', 'grand froid'] as const

/** LES TROIS RANGÉES. La classe décide des portions, du cuit et du séché (D12) : la rangée
 *  enseigne ce qu'une case ne peut pas dire, et le sous-titre le rappelle en clair. */
export const CLASSES_DE_PRISE: readonly { classe: ClasseDePrise; titre: string; sous: string }[] = [
  { classe: 'petit', titre: 'LES PETITS', sous: 'une portion · fenêtre large' },
  { classe: 'moyen', titre: 'LES MOYENS', sous: 'deux portions · il faut regarder' },
  { classe: 'gros', titre: 'LES GROS', sous: 'quatre portions · la prise dont on parle' },
]

/** LA LARGEUR DE LA GRILLE — DÉRIVÉE de la table : c'est la classe la plus peuplée. Une espèce
 *  ajoutée à `FISH_SPECIES` élargit la rangée toute seule, au lieu de déborder d'un 7 écrit ici. */
export const BEST_COLS = Math.max(
  ...CLASSES_DE_PRISE.map((c) => FISH_SPECIES.filter((sp) => sp.classe === c.classe).length),
)

/** Ce que le rendu écrit dans une case muette, à la place du nom. */
export const NOM_INCONNU = '???'
/** Ce que le rendu écrit dans une case muette, à la place du record. */
export const RECORD_VIDE = '—'

/** Le nom d'un pays, DÉRIVÉ du graphe de zones et jamais recopié : une zone renommée se renomme
 *  ici toute seule, au lieu d'afficher un nom que plus rien ne porte. */
const nomDeZone = (slug: string): string => ZONES.find((z) => z.slug === slug)?.nom ?? slug

/** LA FENÊTRE DE FERRAGE et la RARETÉ, en jauges. Les deux nombres bruts ne veulent rien dire au
 *  joueur : l'un est un compte de ticks, l'autre un poids de tirage qui n'a de sens que rapporté
 *  à la somme des lignes retenues par le filtre du moment. */
const cransFerrage = (ticks: number): number => Math.max(1, Math.min(6, Math.round((ticks - 4) / 2)))
const motFerrage = (ticks: number): string =>
  ticks <= 6 ? 'éclair' : ticks <= 9 ? 'court' : ticks <= 13 ? 'large' : 'très large'
const cransRarete = (poids: number): number => (poids >= 6 ? 1 : poids >= 4 ? 2 : poids >= 2 ? 3 : 4)
const motRarete = (poids: number): string =>
  poids >= 6 ? 'commune' : poids >= 4 ? 'assez commune' : poids >= 2 ? 'rare' : 'très rare'

/** Les millimètres de la sim en centimètres qu'on lit, virgule française. */
const enCm = (mm: number): string => `${(mm / 10).toFixed(1).replace('.', ',')} cm`

/** Une jauge : combien de crans allumés sur combien. */
export interface Jauge {
  crans: number
  total: number
  mot: string
}

/** LA FICHE au survol — elle n'existe QUE pour une espèce déjà prise. */
export interface FicheEspece {
  nom: string
  classe: ClasseDePrise
  record: string
  prises: string
  /** Les quatre conditions, libellé + valeur. Une condition ABSENTE se dit en clair
   *  (« toute l'année ») plutôt que de laisser un trou : le joueur doit pouvoir conclure. */
  conditions: readonly (readonly [string, string])[]
  /** ⚑ E3 : sans cette ligne, la fiche laisse croire que le sandre mord sur n'importe quel lac. */
  coinSeul: boolean
  ferrage: Jauge
  /** La durée de la fenêtre, au NIVEAU 0 de Chasse — la maîtrise l'élargit (D5/D6). */
  ferrageSecondes: string
  rarete: Jauge
  taille: string
}

/** UNE CASE de la grille. `fiche === null` veut dire MUETTE : le rendu ne pose rien dessus. */
export interface CaseBestiaire {
  /** L'id de l'espèce — `null` sur une case muette. Le rendu ne s'en sert pas (il peint
   *  `icone`), et pour treize des dix-huit espèces l'id EST le nom français : le laisser là
   *  aurait posé le mot « vairon » dans l'objet d'une case censée n'en rien dire. */
  id: string | null
  classe: ClasseDePrise
  /** Le nom AFFICHÉ — `NOM_INCONNU` tant que l'espèce n'a pas été sortie de l'eau. */
  nom: string
  record: string
  /** `×7`, ou la chaîne vide : une case muette ne compte rien. */
  prises: string
  /** L'icône à peindre, ou `null` — une case muette n'en a pas, pas même une silhouette. */
  icone: string | null
  coinSeul: boolean
  fiche: FicheEspece | null
}

/** Une rangée de classe, avec ses cases dans l'ordre de la table. */
export interface RangeeBestiaire {
  classe: ClasseDePrise
  titre: string
  sous: string
  cases: readonly CaseBestiaire[]
}

/** Une ligne du carnet de l'avatar, telle que le snapshot la porte. */
export interface LigneCarnet {
  sp: string
  mm: number
  prises: number
}

function ficheDe(sp: FishSpecies, l: LigneCarnet): FicheEspece {
  return {
    nom: sp.label.toUpperCase(),
    classe: sp.classe,
    record: enCm(l.mm),
    prises: `×${l.prises}`,
    conditions: [
      ['eau', sp.eaux.map((e) => (e === 'riviere' ? 'rivière' : e)).join(' · ')],
      ['saison', sp.saisons ? sp.saisons.map((n) => SAISON_COURTE[n - 1] ?? '').join(' · ') : 'toute l’année'],
      [
        'heure',
        sp.creneaux ? sp.creneaux.map((c) => (c === 'crepuscule' ? 'crépuscule' : c)).join(' · ') : 'à toute heure',
      ],
      ['pays', sp.zones ? sp.zones.map(nomDeZone).join(' · ') : 'partout'],
    ],
    coinSeul: sp.coinSeul === true,
    ferrage: { crans: cransFerrage(sp.windowTicks), total: 6, mot: motFerrage(sp.windowTicks) },
    ferrageSecondes: `${(sp.windowTicks / BALANCE.TICK_RATE_HZ).toFixed(2).replace('.', ',')} s`,
    rarete: { crans: cransRarete(sp.weight), total: 4, mot: motRarete(sp.weight) },
    taille: `${Math.round(sp.tailleMinMm / 10)} – ${Math.round(sp.tailleMaxMm / 10)} cm`,
  }
}

/**
 * LE BESTIAIRE ENTIER, rangée par rangée, tel qu'il s'affiche.
 *
 * Toute espèce absente du carnet ressort MUETTE — c'est ici, et nulle part dans le rendu, que
 * la promesse se tient : pas d'icône, pas de nom, pas de fiche.
 */
export function rangeesDuBestiaire(carnet: readonly LigneCarnet[]): RangeeBestiaire[] {
  const parEspece = new Map(carnet.map((l) => [l.sp, l]))
  return CLASSES_DE_PRISE.map(({ classe, titre, sous }) => ({
    classe,
    titre,
    sous,
    cases: FISH_SPECIES.filter((sp) => sp.classe === classe).map((sp): CaseBestiaire => {
      const l = parEspece.get(sp.id)
      if (l === undefined) {
        return {
          id: null,
          classe: sp.classe,
          nom: NOM_INCONNU,
          record: RECORD_VIDE,
          prises: '',
          icone: null,
          coinSeul: false,
          fiche: null,
        }
      }
      return {
        id: sp.id,
        classe: sp.classe,
        nom: sp.label.charAt(0).toUpperCase() + sp.label.slice(1),
        record: enCm(l.mm),
        prises: `×${l.prises}`,
        icone: sp.id,
        coinSeul: sp.coinSeul === true,
        fiche: ficheDe(sp, l),
      }
    }),
  }))
}

/** Le compteur du haut : combien d'espèces connues sur combien, et combien de prises en tout. */
export function sommeDuBestiaire(carnet: readonly LigneCarnet[]): string {
  const especes = new Set(carnet.map((l) => l.sp)).size
  const prises = carnet.reduce((t, l) => t + l.prises, 0)
  return `${especes} / ${FISH_SPECIES.length} espèces · ${prises} prise${prises > 1 ? 's' : ''}`
}
