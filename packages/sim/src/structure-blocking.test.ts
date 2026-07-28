import { describe, expect, it } from 'vitest'
import { STRUCTURE_HP } from './balance'
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
 * Une PORTE arrête un étranger (`structureBlocks(door, null) === true`) et laisse passer
 * les siens (`structureBlocks(door, 0) === false`) : elle dépend du déplaceur. Pour R7 elle
 * ne bloque PAS, et c'est exactement ce qui rend une enceinte navigable — « on entre dans
 * sa forge ». Les faire s'accorder ici reviendrait à traiter la porte comme un mur et à
 * interdire de clore un village. C'est un accord qu'il NE FAUT PAS chercher.
 */
const DIVERGENCES_VOULUES: readonly StructureType[] = ['door']

/**
 * LES SIX ÉCARTS QUI SONT DES BUGS — nommés, pas corrigés ici, et voici pourquoi.
 *
 * Ce sont les pièces BASSES du monde bâti (`poi-batis.ts`). `structureBlocks` les exempte
 * avec sa raison écrite : « on les ENJAMBE — un banc, une poutre tombée, un carré de
 * friche ne ferment rien, et une ruine dont chaque débris bloque devient un labyrinthe où
 * l'on se coince, pas un lieu où l'on entre ». `blocksNavigation`, elle, est une liste de
 * QUATRE exceptions (`door`, `floor`, `roof`, `house`) écrite AVANT que ces types
 * n'existent : elle les compte donc comme des murs, par simple péremption.
 *
 * CE QUE ÇA COÛTE quand ça mordra : le remplissage de R7 verrait un « dehors » plus petit
 * que la réalité, donc REFUSERAIT MOINS qu'il ne doit (l'échec est ouvert, pas fermé), et
 * un PNJ debout sur une de ces tuiles ne serait jamais protégé. Côté R13-R14, un banc
 * pourrait clore une enceinte et offrir le bonus de conservation à un espace ouvert.
 *
 * POURQUOI PAS CORRIGÉ ICI : la correction juste n'est pas « faire s'accorder les deux »
 * (`door` prouve que ce serait faux) mais faire de la géométrie une donnée déclarée UNE
 * fois par type — un `Record<StructureType, { bloque, clôt, couvre }>` dont les trois
 * lecteurs (`structureBlocks`, `blocksNavigation`, `isEnclosed`) ne seraient plus que des
 * lectures. C'est un chantier de coût moyen dans trois fichiers, à faire À FROID : le
 * défaut est aujourd'hui LATENT (ces six types ne sont posés que par le worldgen, et les
 * zones de lieu sont écartées du carré d'un Feu), mais `items.ts` annonce la tranche qui
 * les rendra posables au marteau. C'est AVANT celle-là qu'il faut refermer.
 */
const ECARTS_A_CORRIGER: readonly StructureType[] = ['banc', 'friche', 'terre', 'encadrement', 'poutre', 'mur_bas']

describe('« ça bloque ? » — les deux réponses du dépôt, et leurs écarts nommés', () => {
  it('les deux prédicats s\'accordent partout, sauf sur les écarts nommés', () => {
    const divergents = TYPES.filter((t) => structureBlocks(piece(t), null) !== blocksNavigation(t))
    expect(divergents.sort()).toEqual([...DIVERGENCES_VOULUES, ...ECARTS_A_CORRIGER].sort())
  })

  it('la PORTE dépend du déplaceur — et elle est la seule', () => {
    // C'est ce qui distingue les deux questions : sans ça, les faire s'accorder serait juste.
    const relatifs = TYPES.filter((t) => structureBlocks(piece(t), null) !== structureBlocks(piece(t), 0))
    expect(relatifs).toEqual(['door'])
    // Et pour R7 elle ne ferme pas : c'est elle qui rend une enceinte navigable.
    expect(blocksNavigation('door')).toBe(false)
  })

  it('les pièces basses du monde bâti s\'ENJAMBENT — côté déplacement, c\'est déjà vrai', () => {
    // La vérité que le joueur ressent est la bonne ; c'est `blocksNavigation` qui doit la rejoindre.
    for (const t of ECARTS_A_CORRIGER) {
      expect(structureBlocks(piece(t), null), `${t} devrait s'enjamber`).toBe(false)
    }
  })

  it('les pièces MOLLES ne bloquent nulle part (R14), et la maison se franchit', () => {
    for (const t of ['floor', 'roof', 'house'] as StructureType[]) {
      expect(structureBlocks(piece(t), null), `${t} (déplacement)`).toBe(false)
      expect(blocksNavigation(t), `${t} (navigation)`).toBe(false)
    }
  })

  it('un mur bloque des deux côtés — le témoin qui prouve que ce test peut échouer', () => {
    expect(structureBlocks(piece('wall'), null)).toBe(true)
    expect(blocksNavigation('wall')).toBe(true)
    expect(TYPES.length).toBeGreaterThan(30) // et qu'il balaie bien tout l'espace
  })

  it('les listes nommées ne parlent que de types RÉELS (garde de la garde)', () => {
    for (const t of [...DIVERGENCES_VOULUES, ...ECARTS_A_CORRIGER]) {
      expect(TYPES, `${t} n'est plus un StructureType`).toContain(t)
    }
  })
})
