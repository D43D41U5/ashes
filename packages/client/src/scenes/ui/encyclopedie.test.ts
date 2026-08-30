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
  carnetComplet,
  cartesDesSaisons,
  type CarteSaison,
  type FicheEncyclo,
  railDeLEncyclopedie,
  rangeesDeSection,
  type CarnetsDuJoueur,
  type CaseEncyclo,
  HORS_FAMILLE,
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
  // DÉRIVÉ de `HORS_FAMILLE`, plus écrit à la main : c'était `note(… 'hammer')`, une ligne
  // recopiée — et la torche, entrée dans la même liste, a laissé sa case MUETTE sur un carnet
  // omniscient (le test l'a dit). Un outil sans famille ajouté demain est couvert d'office.
  for (const i of HORS_FAMILLE) note(cleEncyclo('fabrique', i))
  for (const i of Object.keys(WEAPON_DAMAGE) as ItemId[]) note(cleEncyclo('fabrique', i))
  note(cleEncyclo('fabrique', 'arrow'))
  for (const t of Object.keys(MONSTER_DEFS) as MonsterType[]) note(cleEncyclo('abat', t))
  for (const phase of [1, 2, 3, 4]) note(cleEncyclo('vecu', String(phase)))
  // LES RELEVÉS de saison : le plus froid et le plus chaud endurés (des degrés, pas un compte).
  for (const phase of [1, 2, 3, 4]) {
    encyclo.push({ k: cleEncyclo('froid', String(phase)), n: -6 }, { k: cleEncyclo('chaud', String(phase)), n: 14 })
  }
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
      expect(carte.froid).toBe('')
      expect(carte.chaud).toBe('')
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
    // Semences : elles se mettent en terre, elles ne se rencontrent pas. La graine de braise
    // (agriculture.md J1) est du même sang — le murmure la donne, la suie la boit.
    'graine', 'graine_verte', 'graine_fruit', 'graine_tubercule', 'graine_de_braise',
    // ⚠ LE CHARBON DE BOIS EST SORTI D'ICI LE 2026-08-27, et la garde l'a exigé toute seule.
    // Il y était parce que la section « ressources » se dérive de `NODE_DEFS` — ce qui se
    // RÉCOLTE — et qu'il ne se récoltait pas : il tombait dans les sorties d'un feu entretenu.
    // Depuis **R25** (`cendre.md`), la CHARBONNIÈRE est un nœud qui le rend : il se récolte
    // donc, il entre dans la section, et la seconde clause du test (« rien n'est déclaré hors
    // alors qu'il a sa case ») a rougi le jour même. C'est exactement son travail.
    // LA TORCHE ALLUMÉE (`torche.md`) : ce n'est pas une SECONDE entrée, c'est l'ÉTAT de la
    // première. `torche` a sa case (outils / fortune) ; lui en donner une aussi ferait deux
    // fiches pour un seul objet, dont l'une ne se fabrique pas.
    'torche_vive',
    // Vêtement (aucune section « habits » : l'équipement n'existe pas encore en /sim).
    'tenue_hiver',
    // LE BÂTI et les composants posables — leur section reste à ouvrir.
    'campfire', 'chest', 'sechoir', 'enclume', 'furnace', 'four_acier', 'workshop',
    'tour_meca', 'atelier_lourd', 'silo', 'cave', 'reserve', 'parcelle', 'serre', 'terroir',
    'parcelle_de_suie',
    // LA BRAISE-MÈRE (cendre.md R28) est du bâti posable, comme le séchoir ; LE CŒUR DE BRAISE
    // (R29) est une matière intermédiaire — un composant d'Ouvrage, pas une rencontre. Le jour
    // où le bestiaire notera les butins des morts, la garde exigera sa sortie d'ici.
    'braise_mere', 'coeur_de_braise',
    // LE CUIR CENDRÉ (R30c) : matière intermédiaire, comme la peau brute — l'ingrédient de
    // la tenue cendrée (R29b), pas une rencontre.
    'cuir_cendre',
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

/**
 * LE DÉVERROUILLAGE DE RELECTURE (DEV) — `carnetComplet()`.
 *
 * « Complètement » est une affirmation sur CHAQUE case, et un déverrouillage partiel est
 * SILENCIEUX : la section s'ouvre, quelques cases restent à `???`, et on ne le voit qu'en
 * comptant. Les sorties de cuisson et de séchage (`COOK_SLOT`/`DRY_SLOT`) sont les premières
 * à manquer si l'on énumère les objets de tête. Le garde est donc `su === tot` sur CHAQUE
 * entrée du rail — la seule assertion qui dise « complètement » plutôt que « à l'œil ».
 *
 * ⚠ CE QUI LE FERAIT ROUGIR : une entrée ajoutée à une section sans être ajoutée au carnet
 * complet (une case muette de plus, `su < tot`), ou un chiffre laissé à zéro (la case parle
 * mais affiche `—`, et on relirait une fiche qui ment).
 */
describe('l’encyclopédie — le déverrouillage de relecture (DEV)', () => {
  it('TOUTES LES CASES PARLENT — su === tot sur chaque entrée du rail', () => {
    const c = carnetComplet()
    for (const e of railDeLEncyclopedie(c)) {
      expect(e.su, `la section ${e.id} garde ${e.tot - e.su} case(s) muette(s)`).toBe(e.tot)
    }
  })

  it('CHAQUE CASE porte son id, son nom, son effigie et sa fiche', () => {
    const c = carnetComplet()
    for (const s of SECTIONS) {
      if (s === 'saisons') continue
      for (const r of rangeesDeSection(s, c)) {
        for (const k of r.cases) {
          expect(k.id, `${s} / ${r.titre}`).not.toBeNull()
          expect(k.nom, `${s} / ${r.titre}`).not.toBe(NOM_INCONNU)
          expect(k.effigie, `${s} / ${r.titre} / ${k.nom}`).not.toBeNull()
          expect(k.fiche, `${s} / ${r.titre} / ${k.nom}`).not.toBeNull()
          // Un chiffre à `—` sur une case ouverte, c'est une fiche qu'on relirait de travers.
          expect(k.valeur, `${s} / ${k.nom} n’affiche aucun chiffre`).not.toBe(VALEUR_VIDE)
        }
      }
    }
  })

  it('LES QUATRE SAISONS sont vécues, avec leur nom et leur fiche', () => {
    const cartes = cartesDesSaisons(carnetComplet())
    expect(cartes).toHaveLength(4)
    for (const carte of cartes) {
      expect(carte.phase).not.toBeNull()
      expect(carte.nom).not.toBe(NOM_INCONNU)
      expect(carte.fiche).not.toBeNull()
      expect(carte.vecue).not.toBe('')
    }
  })

  it('IL NE TOUCHE À RIEN : un carnet vide se tait toujours autant', () => {
    carnetComplet()
    for (const k of toutesLesCases(RIEN)) expect(k.fiche).toBeNull()
  })
})

/**
 * LES FICHES SONT COURTES, ET ELLES PARLENT (décision d'Alexis, 2026-08-25 : « trop d'infos
 * techniques dans les tooltips — réduis la taille ET la nature des infos »).
 *
 * DEUX PROMESSES, DEUX GARDES, et elles se prennent par le haut : on ne vérifie pas que telle
 * ligne a disparu de telle fiche (il en resterait toujours une), on balaie TOUTES les fiches de
 * TOUTES les sections, saisons comprises.
 *
 * ⚠ CE QUI LES FERAIT ROUGIR : un bloc de plus (le filet réapparaîtrait, et avec lui l'envie de
 * le remplir), une cinquième ligne, ou n'importe quel mot de moteur qui revient — une durée en
 * secondes, un cône en degrés, une portée en tuiles, une durabilité chiffrée.
 */
describe('l’encyclopédie — des mots, pas des nombres de moteur', () => {
  /** Toutes les fiches du livre, cases ET cartes de saison. */
  const toutesLesFiches = (): FicheEncyclo[] => {
    const c = carnetComplet()
    const desCases = toutesLesCases(c)
      .map((k) => k.fiche)
      .filter((f): f is FicheEncyclo => f !== null)
    const desSaisons = cartesDesSaisons(c)
      .map((s) => s.fiche)
      .filter((f): f is FicheEncyclo => f !== null)
    return [...desCases, ...desSaisons]
  }

  it('AUCUNE FICHE ne passe UN bloc ni QUATRE lignes', () => {
    const fiches = toutesLesFiches()
    expect(fiches.length).toBeGreaterThan(40)
    for (const f of fiches) {
      expect(f.blocs.length, `${f.nom} : ${f.blocs.length} blocs`).toBe(1)
      expect(f.blocs[0]!.length, `${f.nom} : ${f.blocs[0]!.length} lignes`).toBeLessThanOrEqual(4)
      expect(f.blocs[0]!.length).toBeGreaterThan(0)
    }
  })

  it('AUCUN MOT DE MOTEUR ne survit dans une fiche', () => {
    const serialise = JSON.stringify(toutesLesFiches())
    const interdits = [
      'wind-up',
      'endurance',
      'cône',
      'arcCos',
      'stock',
      'pile',
      'ferrage',
      'portions',
      'durabilité',
      'usure',
      'péremption',
      'clarté',
      'tuiles',
      'à vide',
      'métier',
      'station',
    ]
    for (const mot of interdits) {
      expect(serialise, `« ${mot} » est revenu dans une fiche`).not.toContain(mot)
    }
    // Et aucune DURÉE : ni « 0,40 s », ni un compte de ticks.
    expect(serialise, 'une durée en secondes est revenue').not.toMatch(/\d+,\d+\s?s\b/)
    expect(serialise, 'un compte de ticks est revenu').not.toMatch(/\bticks?\b/)
  })

  it('LES SAISONS montrent LE RELEVÉ DU JOUEUR, pas les cardinaux de la table', () => {
    // Un carnet qui a tout vécu SANS relevé : la saison parle, mais elle n'a pas de température
    // à donner. Si la fiche affichait la table, elle mentirait ici — et le test le verrait.
    const sansReleve: CarnetsDuJoueur = {
      encyclo: [1, 2, 3, 4].map((p) => ({ k: cleEncyclo('vecu', String(p)), n: 1 })),
      peche: [],
    }
    for (const carte of cartesDesSaisons(sansReleve)) {
      expect(carte.fiche).not.toBeNull()
      expect(carte.froid, `saison ${carte.phase}`).toBe(VALEUR_VIDE)
      expect(carte.chaud).toBe(VALEUR_VIDE)
      expect(carte.fiche!.gauche[1]).toBe(VALEUR_VIDE)
      expect(carte.fiche!.droite[1]).toBe(VALEUR_VIDE)
    }
    // Avec un relevé, c'est LUI qu'on lit — froid à gauche, chaud à droite.
    const avec: CarnetsDuJoueur = {
      encyclo: [
        { k: cleEncyclo('vecu', '3'), n: 2 },
        { k: cleEncyclo('froid', '3'), n: -4.2 },
        { k: cleEncyclo('chaud', '3'), n: 11.7 },
      ],
      peche: [],
    }
    const carte = cartesDesSaisons(avec)[2]!
    expect(carte.froid).toBe('-4 °C')
    expect(carte.chaud).toBe('+12 °C')
    expect(carte.fiche!.gauche).toEqual(['le plus froid', '-4 °C'])
    expect(carte.fiche!.droite).toEqual(['le plus chaud', '+12 °C'])
  })
})

/**
 * ═══ LA FICHE DIT LE SOLEIL DE LA SAISON, PAS CELUI D'UN JOUR (2026-08-26) ═══
 *
 * Alexis : « On ne peut pas avoir les mêmes heures tout au long d'une saison. Dans ce cas,
 * l'encyclopédie doit montrer les plages pour les 2 : levé et couché du soleil. »
 *
 * ⚠ CE QUI FERAIT ROUGIR CES GARDES, dit avant d'accepter le vert : une fiche qui n'annonce
 * qu'un horaire ; une plage prise sur les DEUX BOUTS de la saison au lieu de ses extrêmes —
 * la première forme écrite ici, et elle donnait « 05h41 → 05h45 » pour l'Ardeur, cachant le
 * 04h45 du solstice, c'est-à-dire tout l'été ; ou des heures qui cesseraient d'être celles
 * de la France.
 */
describe('l’encyclopédie — le soleil de chaque saison', () => {
  const heures = (carte: CarteSaison, cle: string): string =>
    carte.fiche!.blocs.flat().find((l) => l.k === cle)!.v
  /** « 04h45 – 05h45 » → [4.75, 5.75] ; un horaire seul → deux fois la même heure. */
  const bornes = (v: string): [number, number] => {
    const hs = [...v.matchAll(/(\d{2})h(\d{2})/g)].map((m) => Number(m[1]) + Number(m[2]) / 60)
    return [hs[0]!, hs[hs.length - 1]!]
  }

  it('annonce une PLAGE, et elle contient le solstice — pas seulement les bords de saison', () => {
    const cartes = cartesDesSaisons(carnetComplet())
    // L'ARDEUR ENJAMBE LE SOLSTICE D'ÉTÉ : ses deux bouts valent presque la même heure, et le
    // vrai extrême est en son milieu. C'est le cas qui distingue « bornes » de « extrêmes ».
    const [tot, tard] = bornes(heures(cartes[1]!, 'lever'))
    expect(tot).toBeCloseTo(4 + 45 / 60, 1) // le solstice, au CŒUR de la saison
    expect(tard - tot).toBeGreaterThan(0.5) // une vraie plage, pas deux bouts confondus
    const [ct, ctard] = bornes(heures(cartes[1]!, 'coucher'))
    expect(ctard).toBeCloseTo(20 + 56 / 60, 1) // 20h56, le coucher du solstice
    expect(ctard - ct).toBeGreaterThan(0.5)
  })

  it('les quatre saisons portent les heures de la France, et elles GLISSENT', () => {
    const cartes = cartesDesSaisons(carnetComplet())
    for (const [i, carte] of cartes.entries()) {
      const l = bornes(heures(carte, 'lever'))
      const c = bornes(heures(carte, 'coucher'))
      // Aucune saison n'a un horaire figé : le soleil bouge tous les jours de l'année.
      expect(l[1] - l[0], `lever, saison ${i + 1}`).toBeGreaterThan(0)
      expect(c[1] - c[0], `coucher, saison ${i + 1}`).toBeGreaterThan(0)
      // Et le jour est toujours entre le lever et le coucher — l'ordre ne s'inverse jamais.
      expect(c[0], `saison ${i + 1}`).toBeGreaterThan(l[1])
    }
    // L'EXTRÊME DE L'ANNÉE, aux deux bouts : 04h45 en été, 08h43 en hiver (Paris).
    expect(bornes(heures(cartes[1]!, 'lever'))[0]).toBeCloseTo(4 + 45 / 60, 1)
    expect(bornes(heures(cartes[3]!, 'lever'))[1]).toBeCloseTo(8 + 43 / 60, 1)
  })

  /**
   * ═══ LA BARRE EST UNE HORLOGE, ET SON ORIGINE EST MINUIT (2026-08-27) ═══
   *
   * Ce qui rendrait ce test rouge, dit avant de l'accepter vert :
   *  · la barre d'AVANT (une largeur calée à gauche, `lever` toujours nul) — les quatre midis
   *    solaires vaudraient alors 25 · 34 · 25 · 17 % au lieu d'un seul et même nombre ;
   *  · le `Math.floor` d'avant sur la part de jour — le midi de l'hiver tomberait à 12h46
   *    quand celui de l'été tombe à 12h50 ;
   *  · une origine posée sur l'aube, ou sur n'importe quelle heure autre que minuit.
   *
   * Le midi solaire NE BOUGE PAS de l'année : les deux courbes sont linéaires entre quatre
   * cardinaux tirés d'un seul modèle solaire. Il ne tombe pas sur 12h00 mais sur **12h50,6**,
   * et ces cinquante minutes ne sont pas une erreur — c'est l'écart de Paris à son fuseau,
   * `1 − 2,3522/15` h, écrit ici tel quel plutôt qu'arrondi à la minute : le même écart qui
   * fait que le soleil du Finistère se couche après celui de Strasbourg. Une barre qui
   * commence à minuit doit le montrer.
   */
  it('la barre part de MINUIT — les quatre saisons partagent le même midi solaire', () => {
    const cartes = cartesDesSaisons(carnetComplet())
    const midis = cartes.map((c) => ((c.lever + c.coucher) / 2 / 100) * 24)
    const midiDeParis = 12 + (1 - 2.3522 / 15) // 12h50,6 — la longitude, pas le fuseau
    for (const [i, midi] of midis.entries()) {
      expect(midi, `midi solaire, saison ${i + 1}`).toBeCloseTo(midiDeParis, 3)
    }
    // Et la nuit borde la barre DES DEUX CÔTÉS : aucune saison ne commence par du jour.
    for (const [i, c] of cartes.entries()) {
      expect(c.lever, `nuit d'avant l'aube, saison ${i + 1}`).toBeGreaterThan(15)
      expect(100 - c.coucher, `nuit d'après le crépuscule, saison ${i + 1}`).toBeGreaterThan(10)
    }
  })

  it('les deux bouts de la barre SONT les heures que la fiche écrit', () => {
    // Une seule écriture du même instant : la barre est bornée par le lever et le coucher du
    // CŒUR de la saison, et la fiche encadre ce cœur dans sa plage. Un arrondi sur l'un des
    // deux les ferait diverger — c'est ce qui est arrivé, et ce que ce test interdit.
    for (const [i, c] of cartesDesSaisons(carnetComplet()).entries()) {
      const l = (c.lever / 100) * 24
      const co = (c.coucher / 100) * 24
      const pl = bornes(heures(c, 'lever'))
      const pc = bornes(heures(c, 'coucher'))
      expect(l, `lever, saison ${i + 1}`).toBeGreaterThanOrEqual(pl[0] - 0.01)
      expect(l, `lever, saison ${i + 1}`).toBeLessThanOrEqual(pl[1] + 0.01)
      expect(co, `coucher, saison ${i + 1}`).toBeGreaterThanOrEqual(pc[0] - 0.01)
      expect(co, `coucher, saison ${i + 1}`).toBeLessThanOrEqual(pc[1] + 0.01)
    }
  })
})
