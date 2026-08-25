import { describe, expect, it } from 'vitest'
import {
  FISH_SPECIES,
  FOOD_VALUES,
  MONSTER_DEFS,
  NODE_DEFS,
  TERRAINS,
  TOOL_TIERS,
  WEAPON_DAMAGE,
  cleEncyclo,
  type ItemId,
  type LigneEncyclo,
  type MonsterType,
  type NodeType,
  type ToolFamily,
} from '@ashes/sim'
import { ITEM_LABELS } from '../../render/item-art'
import { TERRAIN_NOMS } from '../../render/terrain-labels'
import {
  NOM_INCONNU,
  SECTIONS,
  VALEUR_VIDE,
  cartesDesSaisons,
  railDeLEncyclopedie,
  rangeesDeSection,
  type CarnetsDuJoueur,
  type CaseEncyclo,
} from './encyclopedie'

/**
 * L'ENCYCLOPÉDIE — *une entrée jamais rencontrée ne dit rien* (décision d'Alexis, 2026-08-24).
 *
 * Ce que ces tests gardent est une PROMESSE DE JEU, pas une implémentation, et ils la gardent
 * par un balayage EXHAUSTIF : toutes les sections, toutes les cases, contre TOUT le vocabulaire
 * du domaine (les libellés d'objets, les noms d'espèces, de bêtes, de saisons, de terrains).
 * Une entrée ajoutée demain à `/sim` entre dans le balayage sans qu'on y touche.
 *
 * ⚠ CE QUI FERAIT ROUGIR CE BALAYAGE, ET IL FAUT POUVOIR LE DIRE : si une case muette
 * conservait son nom, son effigie, son id ou sa fiche — même cachée en CSS —, la chaîne
 * apparaîtrait dans le JSON de la case et le test tomberait. Le test « les cases CONNUES
 * portent bien leur nom » prouve que la sonde sait voir : sans lui, un module qui rendrait
 * TOUT muet passerait le balayage sans rien garder du tout.
 */

/** Un carnet VIDE : on n'a rien rencontré. */
const RIEN: CarnetsDuJoueur = { encyclo: [], peche: [] }

/** Le vocabulaire du domaine — tout ce qu'une case muette n'a PAS le droit de dire. */
function motsInterdits(): string[] {
  const mots = [
    ...Object.values(ITEM_LABELS),
    ...FISH_SPECIES.map((sp) => sp.label),
    ...Object.values(TERRAIN_NOMS),
    'Lapin',
    'Cerf',
    'Sanglier',
    'Loup',
    'Cendreux',
    'ÉCLOSION',
    'ARDEUR',
    'PLUIES',
    'GRAND FROID',
  ]
  // Les mots trop courts ou trop communs feraient rougir sur du bruit (« os » est dans
  // « ??? » non, mais « Sel » l'est dans « conseil ») : on ne garde que les mots portants.
  return mots.filter((m) => m.length >= 4)
}

/** UN CARNET QUI SAIT TOUT — bâti depuis les tables de `/sim`, pas depuis le module testé.
 *  Si l'écran inventait une entrée qui n'est dans aucune table, elle resterait muette ici. */
function carnetOmniscient(): CarnetsDuJoueur {
  const encyclo: LigneEncyclo[] = []
  const note = (k: string): void => {
    encyclo.push({ k, n: 3 })
  }
  for (const t of Object.keys(NODE_DEFS) as NodeType[]) note(cleEncyclo('recolte', NODE_DEFS[t].item))
  for (const i of Object.keys(FOOD_VALUES) as ItemId[]) note(cleEncyclo('mange', i))
  for (const f of Object.keys(TOOL_TIERS) as ToolFamily[]) {
    for (const marche of Object.values(TOOL_TIERS[f])) note(cleEncyclo('fabrique', marche))
  }
  note(cleEncyclo('fabrique', 'hammer'))
  for (const i of Object.keys(WEAPON_DAMAGE) as ItemId[]) note(cleEncyclo('fabrique', i))
  note(cleEncyclo('fabrique', 'arrow'))
  for (const t of Object.keys(MONSTER_DEFS) as MonsterType[]) note(cleEncyclo('abat', t))
  for (const phase of [1, 2, 3, 4]) note(cleEncyclo('vecu', String(phase)))
  return {
    encyclo,
    peche: FISH_SPECIES.map((sp) => ({ sp: sp.id, mm: sp.tailleMaxMm, prises: 2 })),
  }
}

/** Toutes les cases d'un carnet donné, toutes sections confondues. */
function toutesLesCases(c: CarnetsDuJoueur): CaseEncyclo[] {
  return SECTIONS.filter((s) => s !== 'saisons').flatMap((s) =>
    rangeesDeSection(s, c).flatMap((r) => [...r.cases]),
  )
}

describe('l’encyclopédie — le muet', () => {
  it('SANS RIEN AVOIR RENCONTRÉ, aucune case ne dit quoi que ce soit', () => {
    const cases = toutesLesCases(RIEN)
    expect(cases.length).toBeGreaterThan(40) // le domaine n'est pas vide (sinon on ne teste rien)
    for (const c of cases) {
      expect(c.id).toBeNull()
      expect(c.nom).toBe(NOM_INCONNU)
      expect(c.valeur).toBe(VALEUR_VIDE)
      expect(c.sous).toBe('')
      expect(c.effigie).toBeNull()
      expect(c.drapeau).toBe(false)
      expect(c.fiche).toBeNull()
    }
  })

  it('BALAYAGE EXHAUSTIF : aucun mot du domaine ne survit dans une case muette', () => {
    const serialise = JSON.stringify(toutesLesCases(RIEN))
    for (const mot of motsInterdits()) {
      expect(serialise, `« ${mot} » fuit dans une case muette`).not.toContain(mot)
    }
  })

  it('LES SAISONS aussi se taisent — pas de température, pas de ciel, pas de fiche', () => {
    const cartes = cartesDesSaisons(RIEN)
    expect(cartes).toHaveLength(4)
    const serialise = JSON.stringify(cartes)
    for (const carte of cartes) {
      expect(carte.phase).toBeNull()
      expect(carte.nom).toBe(NOM_INCONNU)
      expect(carte.jour).toBe('')
      expect(carte.nuit).toBe('')
      expect(carte.fiche).toBeNull()
    }
    // Le RANG reste (« SAISON 1 ») : c'est la place dans l'année, pas un savoir sur la saison.
    for (const mot of ['ÉCLOSION', 'ARDEUR', 'PLUIES', 'GRAND FROID', '°C', 'blizzard']) {
      expect(serialise).not.toContain(mot)
    }
  })

  it('LA SONDE SAIT VOIR : une entrée rencontrée porte bien son nom (sans quoi le balayage passerait à vide)', () => {
    const cases = toutesLesCases(carnetOmniscient())
    const serialise = JSON.stringify(cases)
    // Trois témoins pris dans trois tables différentes : si l'un manquait, le balayage
    // ci-dessus serait vert par accident.
    expect(serialise).toContain(ITEM_LABELS.wood)
    expect(serialise).toContain('Cendreux')
    expect(serialise).toContain(FISH_SPECIES[0]!.label.charAt(0).toUpperCase() + FISH_SPECIES[0]!.label.slice(1))
  })
})

describe('l’encyclopédie — l’atteignabilité', () => {
  it('TOUTE entrée du domaine peut PARLER : un carnet omniscient n’en laisse aucune muette', () => {
    for (const c of toutesLesCases(carnetOmniscient())) {
      expect(c.fiche, `une case reste muette alors que tout est connu : ${c.nom}`).not.toBeNull()
      expect(c.effigie).not.toBeNull()
      expect(c.nom).not.toBe(NOM_INCONNU)
    }
    for (const carte of cartesDesSaisons(carnetOmniscient())) {
      expect(carte.fiche).not.toBeNull()
      expect(carte.phase).not.toBeNull()
    }
  })

  it('CHAQUE SECTION a des entrées — aucune rangée vide qui donnerait un vert par accident', () => {
    for (const s of SECTIONS) {
      if (s === 'saisons') continue
      const rangees = rangeesDeSection(s, carnetOmniscient())
      expect(rangees.length, `la section ${s} n’a aucune rangée`).toBeGreaterThan(0)
      for (const r of rangees) {
        expect(r.cases.length, `la rangée ${r.titre} de ${s} est vide`).toBeGreaterThan(0)
      }
    }
  })
})

describe('l’encyclopédie — la couverture des tables', () => {
  const idsConnus = (): string[] =>
    toutesLesCases(carnetOmniscient())
      .map((c) => c.id)
      .filter((x): x is string => x !== null)

  it('LES DIX-HUIT ESPÈCES de la table de pêche sont toutes dans la section POISSONS', () => {
    const ids = new Set(rangeesDeSection('poissons', carnetOmniscient()).flatMap((r) => r.cases.map((c) => c.id)))
    for (const sp of FISH_SPECIES) expect(ids.has(sp.id), `${sp.label} manque`).toBe(true)
  })

  it('TOUTES LES BÊTES de MONSTER_DEFS sont quelque part — gibier, dangereuses ou morts-vivants', () => {
    const ids = new Set(idsConnus())
    for (const t of Object.keys(MONSTER_DEFS) as MonsterType[]) expect(ids.has(t), `${t} manque`).toBe(true)
  })

  it('TOUTE RESSOURCE d’un nœud récoltable a sa case (les coins de pêche exceptés : ce sont des prises)', () => {
    const ids = new Set(idsConnus())
    for (const t of Object.keys(NODE_DEFS) as NodeType[]) {
      if (NODE_DEFS[t].skill === 'hunting') continue
      expect(ids.has(NODE_DEFS[t].item), `${NODE_DEFS[t].item} (${t}) manque`).toBe(true)
    }
  })

  it('TOUT OUTIL de TOOL_TIERS a sa case, à son palier', () => {
    const ids = new Set(idsConnus())
    for (const f of Object.keys(TOOL_TIERS) as ToolFamily[]) {
      for (const marche of Object.values(TOOL_TIERS[f])) expect(ids.has(marche), `${marche} manque`).toBe(true)
    }
  })

  it('TOUTE ARME du barème de dégâts a sa case', () => {
    const ids = new Set(idsConnus())
    for (const i of Object.keys(WEAPON_DAMAGE) as ItemId[]) expect(ids.has(i), `${i} manque`).toBe(true)
  })

  /**
   * CE QUI EST DÉLIBÉRÉMENT HORS ENCYCLOPÉDIE — matières intermédiaires, semences, pièces de
   * bâti et objets posables. Ce ne sont pas des « entrées » qu'on rencontre : ce sont des
   * MOYENS (un lingot, une corde) ou du BÂTI (un coffre, un four), et le bâti aura sa section
   * le jour où l'on saura en dériver le total.
   *
   * ⚠ CETTE LISTE EST LA MOITIÉ VÉRIFIABLE DE « rien n'est orphelin » : un `ItemId` ajouté à
   * `/sim` doit entrer dans `ITEM_LABELS` (le compilateur l'exige), donc il apparaît dans le
   * balayage ci-dessous — et il fera ROUGIR le test tant que personne n'aura tranché entre
   * « il a une section » et « il est ici ».
   */
  const HORS_ENCYCLOPEDIE: readonly ItemId[] = [
    // Matières intermédiaires : on les fabrique pour fabriquer autre chose.
    // (`components` n'est PAS ici : il se récolte dans les décombres — la garde l'a dit.)
    'rope', 'iron_ingot', 'steel_ingot', 'leather', 'raw_hide', 'bone',
    // Semences : elles se mettent en terre, elles ne se rencontrent pas.
    'graine', 'graine_verte', 'graine_fruit', 'graine_tubercule',
    // Vêtement (aucune section « habits » : l'équipement n'existe pas encore en /sim).
    'tenue_hiver',
    // LE BÂTI et les composants posables — leur section reste à ouvrir.
    'campfire', 'chest', 'sechoir', 'enclume', 'furnace', 'four_acier', 'workshop',
    'tour_meca', 'atelier_lourd', 'silo', 'cave', 'reserve', 'parcelle', 'serre', 'terroir',
  ]

  it('AUCUN OBJET N’EST ORPHELIN PAR ACCIDENT : tout `ItemId` a une section, ou est déclaré hors', () => {
    const couverts = new Set(idsConnus())
    // `ITEM_LABELS` est un `Record<ItemId, string>` : ses clés SONT l'union entière, tenue par
    // le compilateur (mémoire « énumérer une union par le compilateur » — le grep en comptait
    // 37 quand tsc en trouvait 43).
    const tous = Object.keys(ITEM_LABELS) as ItemId[]
    const orphelins = tous.filter((i) => !couverts.has(i) && !HORS_ENCYCLOPEDIE.includes(i))
    expect(orphelins, 'ces objets n’apparaissent dans aucune section et ne sont pas déclarés hors').toEqual([])
    // Et la liste ne ment pas dans l'autre sens : rien n'y est déclaré hors alors qu'il a sa case.
    expect(HORS_ENCYCLOPEDIE.filter((i) => couverts.has(i))).toEqual([])
  })

  it('TOUT HABITAT cité par une bête a un nom FRANÇAIS — jamais un slug anglais à l’écran', () => {
    for (const t of Object.keys(MONSTER_DEFS) as MonsterType[]) {
      for (const terrain of MONSTER_DEFS[t].habitat ?? []) {
        const slug = TERRAINS[terrain]?.name ?? String(terrain)
        expect(TERRAIN_NOMS[slug], `l’habitat « ${slug} » (${t}) n’a pas de nom français`).toBeDefined()
      }
    }
  })
})

describe('l’encyclopédie — la grille et le rail', () => {
  it('LE NOMBRE DE COLONNES est DÉRIVÉ de la rangée la plus peuplée', () => {
    for (const s of SECTIONS) {
      if (s === 'saisons') continue
      const rangees = rangeesDeSection(s, RIEN)
      const plusPeuplee = Math.max(...rangees.map((r) => r.cases.length))
      for (const r of rangees) {
        expect(r.cols, `${s} / ${r.titre}`).toBe(plusPeuplee)
        expect(r.cases.length).toBeLessThanOrEqual(r.cols)
      }
    }
  })

  it('LE RAIL compte ce que la section contient — et part à zéro sur tout', () => {
    const vide = railDeLEncyclopedie(RIEN)
    expect(vide).toHaveLength(SECTIONS.length)
    for (const e of vide) {
      expect(e.su, `${e.id} avoue une entrée connue alors qu’on n’a rien rencontré`).toBe(0)
      expect(e.tot).toBeGreaterThan(0)
    }
    const plein = railDeLEncyclopedie(carnetOmniscient())
    for (const e of plein) expect(e.su, `${e.id}`).toBe(e.tot)
  })

  it('LE COMPTE DU RAIL est celui des cases qui parlent, section par section', () => {
    const c = carnetOmniscient()
    for (const e of railDeLEncyclopedie(c)) {
      if (e.id === 'saisons') {
        expect(e.tot).toBe(4)
        continue
      }
      const cases = rangeesDeSection(e.id, c).flatMap((r) => r.cases)
      expect(e.tot, `${e.id}`).toBe(cases.length)
      expect(e.su).toBe(cases.filter((x) => x.fiche !== null).length)
    }
  })
})
