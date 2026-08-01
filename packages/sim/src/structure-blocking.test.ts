import { describe, expect, it } from 'vitest'
import { STRUCTURE_HP } from './balance'
import { PIECES } from './pieces'
import { blocksNavigation } from './construction'
import { structureBlocks, type Structure } from './village'
import type { StructureType } from './items'

/**
 * « CETTE PIÈCE FERME-T-ELLE LE PASSAGE ? » — la même question, posée à deux endroits.
 *
 * Deux fonctions y répondent, et elles ne se connaissent pas :
 *
 *   • `structureBlocks(s, mover)` (village.ts) — LA VÉRITÉ DU DÉPLACEMENT. C'est elle que
 *     la collision consulte : ce qu'elle dit, le joueur le SENT sous ses pieds.
 *   • `blocksNavigation(type)` (construction.ts) — la vue ABSOLUE, qui alimente deux
 *     gardes invisibles : l'invariant de navigabilité R7 (« on ne peut pas murer son
 *     propre Feu, ni piéger un PNJ ») et la détection d'enceinte R13-R14 (le bonus de
 *     conservation du Grenier).
 *
 * Elles n'ont PAS à répondre pareil partout — voir `door` ci-dessous, où la différence est
 * le cœur du modèle. Mais quand elles diffèrent SANS raison, la seconde se trompe en
 * silence, et son propre en-tête prévient : « se tromper ici ne se verrait qu'en partie ».
 *
 * Ce fichier fige donc l'accord des deux sur les 33 types, et NOMME chaque écart avec son
 * verdict. Un type de plus, ou un écart de plus, rougit ici — au lieu de se découvrir en
 * playtest six mois plus tard.
 */

const TYPES = Object.keys(STRUCTURE_HP) as StructureType[]

/** Une structure PUBLIQUE minimale du type voulu — assez pour interroger les prédicats. */
const piece = (type: StructureType): Structure =>
  ({ id: 1, type, tx: 0, ty: 0, villageId: 0, ownerId: 0, access: 'public', hp: 10 }) as unknown as Structure

/**
 * LA SEULE DIVERGENCE LÉGITIME, et il faut la dire pour ne pas la « corriger » un jour.
 *
 * Une PORTE CLOSE arrête TOUT LE MONDE (spec construction R26, 2026-07-30) — pas seulement
 * l'étranger : c'est ce qui donne un sens à l'ouvrir. Pour R7, elle ne bloque PAS, et c'est
 * exactement ce qui rend une enceinte navigable — « on entre dans sa forge », parce qu'on
 * POUSSE la porte. Les faire s'accorder ici reviendrait à traiter la porte comme un mur et à
 * interdire de clore un village. C'est un accord qu'il NE FAUT PAS chercher.
 *
 * ⚠ CE QUI A CHANGÉ LE 2026-07-30, et pourquoi ce test a dû bouger : la porte ne dépend plus du
 * VILLAGE du déplaceur mais de son ÉTAT (`open`) et de la capacité à l'actionner (`opensDoors`,
 * que seuls les PNJ du village portent). L'ancienne formulation — « elle laisse passer les
 * siens » — est devenue fausse : le joueur est des siens, et il doit pousser sa porte.
 */
const DIVERGENCES_VOULUES: readonly StructureType[] = ['door']

/**
* ═══ LES SIX ÉCARTS SONT REFERMÉS (2026-08-01) — et la liste reste, VIDE ═══
 *
 * Elle nommait six pièces basses du monde bâti — `banc`, `friche`, `terre`, `encadrement`,
 * `poutre`, `mur_bas` — que `structureBlocks` laissait ENJAMBER et que `blocksNavigation`
 * comptait pour des MURS, par simple péremption : sa liste de quatre exceptions (`door`,
 * `floor`, `roof`, `house`) avait été écrite avant que ces pièces n'existent.
 *
 * Le remède prescrit ici a été appliqué mot pour mot : la géométrie est désormais une
 * DONNÉE déclarée une fois par pièce (`pieces.ts`, champ `bloque`), et les deux prédicats
 * n'en sont plus que des lectures. `bloqueNavigation` tient en une ligne — `bloque ===
 * 'oui'` — donc la divergence n'est plus seulement corrigée : elle est devenue
 * INEXPRIMABLE, sauf pour la porte, dont le cas est porté par le champ lui-même.
 *
 * MESURÉ : sur les 34 pièces, la refonte du registre ne change EXACTEMENT que ces six
 * verdicts de navigabilité (relevé avant/après, tranche T1). Rien d'autre n'a bougé.
 *
 * La liste reste, VIDE, pour que le test garde sa forme : si un écart réapparaît, c'est
 * ici qu'il se déclare — et il faudra alors une raison écrite, comme en a la porte.
 */
const ECARTS_A_CORRIGER: readonly StructureType[] = []

describe('« ça bloque ? » — les deux réponses du dépôt, et leurs écarts nommés', () => {
  it('les deux prédicats s\'accordent partout, sauf sur les écarts nommés', () => {
    const divergents = TYPES.filter((t) => structureBlocks(piece(t), null, false) !== blocksNavigation(t))
    expect(divergents.sort()).toEqual([...DIVERGENCES_VOULUES, ...ECARTS_A_CORRIGER].sort())
  })

  it('la PORTE dépend de son ÉTAT et de qui l’actionne — et elle est la seule', () => {
    // C'est ce qui distingue les deux questions : sans ça, les faire s'accorder serait juste.
    //
    // ELLE NE DÉPEND PLUS DU VILLAGE SEUL (R26) : close, elle arrête aussi les siens. Ce qui la
    // rend « relative », c'est désormais la CAPACITÉ à la pousser — et un seul type la respecte.
    const relatifs = TYPES.filter(
      (t) => structureBlocks(piece(t), 0, false) !== structureBlocks(piece(t), 0, true),
    )
    expect(relatifs).toEqual(['door'])
    // CLOSE (le défaut) : elle arrête le joueur comme le pillard. C'est le cœur de R26.
    expect(structureBlocks(piece('door'), 0, false), 'close, elle arrête même les siens').toBe(true)
    expect(structureBlocks(piece('door'), null, false), 'close, elle arrête l’étranger').toBe(true)
    // OUVERTE : elle ne retient plus personne — ami comme pillard. C'est le prix de l'oubli.
    const ouverte = { ...piece('door'), open: true }
    expect(structureBlocks(ouverte, 0, false), 'ouverte, les siens passent').toBe(false)
    expect(structureBlocks(ouverte, null, false), 'ouverte, l’étranger passe AUSSI').toBe(false)
    // QUI L'ACTIONNE (les PNJ du village) passe une porte close — mais SEULEMENT la sienne.
    expect(structureBlocks(piece('door'), 0, true), 'son PNJ la pousse').toBe(false)
    expect(structureBlocks(piece('door'), 99, true), 'le PNJ d’un autre village, non').toBe(true)
    // Et pour R7 elle ne ferme pas : c'est elle qui rend une enceinte navigable.
    expect(blocksNavigation('door')).toBe(false)
  })

  it('tout ce qui s\'ENJAMBE est transparent aux DEUX questions — plus de péremption possible', () => {
    // La vérité que le joueur ressent est la bonne, et `blocksNavigation` l'a rejointe : les
    // deux lisent le même champ. On balaie donc l'espace ENTIER plutôt qu'une liste choisie —
    // une pièce basse ajoutée demain tombe dans ce test sans qu'on ait à l'y inscrire.
    const enjambables = TYPES.filter((t) => PIECES[t].bloque === 'enjambe')
    expect(enjambables.length, 'le test doit voir de vraies pièces basses').toBeGreaterThan(5)
    for (const t of enjambables) {
      expect(structureBlocks(piece(t), null, false), `${t} s'enjambe (déplacement)`).toBe(false)
      expect(blocksNavigation(t), `${t} s'enjambe (navigabilité R7)`).toBe(false)
    }
  })

  it('les pièces MOLLES ne bloquent nulle part (R14), et la maison se franchit', () => {
    for (const t of ['floor', 'roof', 'house'] as StructureType[]) {
      expect(structureBlocks(piece(t), null, false), `${t} (déplacement)`).toBe(false)
      expect(blocksNavigation(t), `${t} (navigation)`).toBe(false)
    }
  })

  it('un mur bloque des deux côtés — le témoin qui prouve que ce test peut échouer', () => {
    expect(structureBlocks(piece('wall'), null, false)).toBe(true)
    expect(blocksNavigation('wall')).toBe(true)
    expect(TYPES.length).toBeGreaterThan(30) // et qu'il balaie bien tout l'espace
  })

  it('les listes nommées ne parlent que de types RÉELS (garde de la garde)', () => {
    for (const t of [...DIVERGENCES_VOULUES, ...ECARTS_A_CORRIGER]) {
      expect(TYPES, `${t} n'est plus un StructureType`).toContain(t)
    }
  })
})
