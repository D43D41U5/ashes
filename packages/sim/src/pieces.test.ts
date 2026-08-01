import { describe, expect, it } from 'vitest'
import { COMPONENTS, FUNCTIONS, SLOTS, STRUCTURE_COSTS, STRUCTURE_HP } from './balance'
import { POSABLE_SUR_EAU, blocksNavigation, isComponent } from './construction'
import {
  BARRIER_TYPES,
  COMPONENT_TYPES,
  FUNCTION_IDS,
  PIECES,
  STRUCTURE_TYPES,
  coutObjet,
  matiereChiffre,
  matieresDe,
  palierDe,
  piece,
} from './pieces'

/**
 * ═══ LES GARDES DU REGISTRE ═══
 *
 * Le registre supprime une CLASSE de défaut : la propriété d'une pièce écrite en prose,
 * loin d'elle, qu'on oublie sans que rien ne le dise. Ce fichier garde ce qu'un type ne
 * peut pas garder tout seul — les accords ENTRE champs, et le fait que les tables
 * historiques ne soient plus que des VUES.
 *
 * Ce qu'il ne teste PAS, parce que le compilateur s'en charge déjà : qu'une pièce ait un
 * coût, des PV, un accès, une famille. Une entrée incomplète ne compile pas — c'est tout
 * l'intérêt de `satisfies Record<string, PieceDef>`.
 */

describe('le registre des pièces — les accords que le type ne garde pas', () => {
  it('les vues dérivées rendent EXACTEMENT le registre (aucune table parallèle)', () => {
    // Si quelqu'un « répare » une valeur dans une vue au lieu du registre, c'est ici que
    // ça rougit — la vue redeviendrait une table, et la dérive recommencerait.
    for (const t of STRUCTURE_TYPES) {
      expect(STRUCTURE_COSTS[t], `coût de ${t}`).toEqual(piece(t).cout)
      expect(STRUCTURE_HP[t], `PV de ${t}`).toBe(piece(t).pv)
    }
    expect(Object.keys(STRUCTURE_COSTS)).toEqual(STRUCTURE_TYPES)
    expect(Object.keys(STRUCTURE_HP)).toEqual(STRUCTURE_TYPES)
    expect(SLOTS.CHEST).toBe(piece('chest').capacite)
    expect(SLOTS.GRENIER).toBe(piece('silo').capacite)
  })

  it('SERVIR UNE FONCTION fait le composant — la famille n’est qu’un rayon (D4)', () => {
    // Les deux lectures coïncident AUJOURD'HUI : les douze composants sont exactement les
    // pièces qui portent une fonction. Ce test le fige — mais il fige aussi la porte que
    // D4 demandait : un MEUBLE qui déclarerait `fonction` entrerait dans le modèle d'amas
    // sans cesser d'être rangé au rayon mobilier.
    for (const t of STRUCTURE_TYPES) {
      expect(isComponent(t), `${t}`).toBe(piece(t).fonction !== undefined)
    }
    expect(STRUCTURE_TYPES.filter(isComponent)).toEqual(STRUCTURE_TYPES.filter((t) => piece(t).fam === 'composant'))
    expect(COMPONENT_TYPES.length).toBe(12)
    expect(Object.keys(COMPONENTS)).toEqual(COMPONENT_TYPES)
    // Et le DORTOIR n'est pas déclaré : le §4bis le donne pour différé, et son effet
    // n'existe pas. Une fonction qui émerge sans rien faire ment au joueur.
    expect(piece('paillasse').fonction).toBeUndefined()
  })

  it('`fonction` et `palier` vont ENSEMBLE, ou pas du tout', () => {
    // C'est l'invariant dont dépend la dérivation de `FUNCTIONS.recipeByTier` : une
    // fonction sans palier ferait un amas au palier 0, une pièce muette dans sa recette.
    for (const t of STRUCTURE_TYPES) {
      const d = piece(t)
      expect(d.fonction === undefined, `${t} : fonction sans palier ou l’inverse`).toBe(d.palier === undefined)
    }
    // Et tout composant en sert une : c'est ce qui le distingue d'un meuble qui bloque.
    for (const t of COMPONENT_TYPES) {
      expect(piece(t).fonction, `${t} sert une fonction`).toBeDefined()
      expect(piece(t).unlockTier, `${t} déclare son palier de Feu`).toBeDefined()
    }
  })

  it('deux composants ne se disputent jamais le même palier d’une même fonction', () => {
    // Sinon `recipeByTier` deviendrait ambigu : deux pièces primaires, deux ancres
    // possibles pour la fonction, donc une identité qui saute d'un amas à l'autre.
    for (const fid of FUNCTION_IDS) {
      const paliers = COMPONENT_TYPES.filter((t) => piece(t).fonction === fid).map(palierDe)
      expect(new Set(paliers).size, `paliers en double pour ${fid}`).toBe(paliers.length)
      expect(paliers, `${fid} n’a pas de composant primaire`).toContain(1)
    }
  })

  it('`recipeByTier` est CUMULATIF et son premier élément est le composant primaire', () => {
    for (const fid of FUNCTION_IDS) {
      const tiers = FUNCTIONS[fid].recipeByTier
      expect(tiers.length, `${fid}`).toBe(3)
      expect(palierDe(tiers[0]![0]!), `${fid} : l’ancre est le palier 1`).toBe(1)
      for (let i = 1; i < tiers.length; i++) {
        // Chaque palier CONTIENT le précédent : c'est ce que « cumulatif » veut dire, et
        // ce dont la reconnaissance d'amas dépend pour ne jamais sauter un cran.
        expect(tiers[i]!.slice(0, tiers[i - 1]!.length), `${fid} palier ${i + 1}`).toEqual(tiers[i - 1])
      }
    }
  })

  it('l’ARÊTE n’existe que sur les pièces qui prennent la tuile', () => {
    // Une pièce MOLLE (sol, toit) n'a pas d'arête à porter : lui en donner une la rendrait
    // invisible à `floorAt`/`roofAt`, qui ne regardent pas `edges`.
    for (const t of STRUCTURE_TYPES) {
      const d = piece(t)
      if (d.occupe !== 'tuile') expect(d.arete, `${t} est mou`).toBe('interdite')
    }
  })

  it('ce qui tient sur l’EAU porte sa propre assise, donc ne bloque rien', () => {
    const surEau = STRUCTURE_TYPES.filter((t) => piece(t).eau)
    expect(POSABLE_SUR_EAU).toEqual(surEau)
    expect(surEau, 'des planches sur l’eau, et rien d’autre pour l’instant').toEqual(['floor'])
    for (const t of surEau) expect(piece(t).bloque, `${t}`).toBe('non')
  })

  it('la NAVIGABILITÉ (R7) est une lecture, plus une liste d’exceptions', () => {
    for (const t of STRUCTURE_TYPES) {
      expect(blocksNavigation(t), `${t}`).toBe(piece(t).bloque === 'oui')
    }
  })

  it('les BARRIÈRES du marteau se dérivent du geste de pose', () => {
    expect(BARRIER_TYPES).toEqual(STRUCTURE_TYPES.filter((t) => piece(t).pose === 'marteau'))
    // Le contrat R20, ÉLARGI par D1 (2026-08-01) : « ce qui EST le bâtiment se bâtit au
    // marteau ». La clôture et l'encadrement l'ont rejoint — ils avaient déjà coût, PV et
    // dessin, il ne leur manquait qu'une route vers le joueur. Ni le coffre ni un composant
    // n'y sont : ceux-là se tiennent et se posent.
    expect(BARRIER_TYPES).toEqual(['wall', 'palissade', 'door', 'floor', 'roof', 'cloture', 'encadrement'])
    for (const t of BARRIER_TYPES) expect(piece(t).fam, `${t}`).toBe('structure')
  })

  it('chaque pièce a un LIBELLÉ, et deux pièces n’en partagent jamais un', () => {
    // Le libellé est ce que le joueur lit dans un menu : deux pièces homonymes seraient
    // indiscernables à l'écran, quel que soit le soin mis au reste.
    const labels = STRUCTURE_TYPES.map((t) => piece(t).label)
    for (const l of labels) expect(l.length, 'libellé vide').toBeGreaterThan(0)
    expect(new Set(labels).size, 'libellés en double').toBe(labels.length)
  })

  it('LA DÉRIVE DU FOUR est nommée, et elle est la SEULE', () => {
    // Le four coûte 8 pierres en PIÈCE (héritage V3, ce que paie un village PNJ et ce
    // qu'on rembourse) et 10 en OBJET (sa recette). Les onze autres composants ont les
    // deux nombres égaux. Tant qu'Alexis n'a pas tranché, ce test fige l'écart pour qu'il
    // ne se « corrige » pas tout seul dans un sens ou dans l'autre — et pour qu'une
    // SECONDE dérive du même genre ne puisse pas s'installer en silence.
    const derivent = STRUCTURE_TYPES.filter((t) => piece(t).coutObjet !== undefined)
    expect(derivent).toEqual(['furnace'])
    expect(piece('furnace').cout).toEqual({ stone: 8 })
    expect(coutObjet('furnace')).toEqual({ stone: 10 })
    // Et pour tous les autres, l'objet coûte la pièce : une seule vérité.
    for (const t of STRUCTURE_TYPES) {
      if (t !== 'furnace') expect(coutObjet(t), `${t}`).toEqual(piece(t).cout)
    }
  })

  it('LA MATIÈRE À DEUX RÉGIMES (D3) — le structurel chiffre, le mobilier teinte', () => {
    // Le régime se DÉCLARE, il ne se devine plus de `type === 'wall' || type === 'door'`.
    for (const t of STRUCTURE_TYPES) {
      const chiffree = matiereChiffre(t)
      // Une pièce à chiffres accepte forcément plusieurs matières — sinon il n'y a rien
      // à chiffrer, et le régime serait un mensonge.
      if (chiffree) expect(matieresDe(t).length, `${t}`).toBeGreaterThan(1)
      // Et rien hors du STRUCTUREL ne chiffre : c'est la décision D3, pas un réglage.
      if (chiffree) expect(piece(t).fam, `${t}`).toBe('structure')
    }
    // Les deux seules pièces à paliers aujourd'hui — celles dont `WALL_TIERS` porte le barème.
    expect(STRUCTURE_TYPES.filter(matiereChiffre)).toEqual(['wall', 'door'])
    // La PALISSADE en est exclue par décision : le bois est son essence.
    expect(matieresDe('palissade')).toEqual(['wood'])
    expect(matiereChiffre('palissade')).toBe(false)
    // Le défaut d'une pièce sans déclaration : une seule matière, et c'est du bois.
    expect(matieresDe('table')).toEqual(['wood'])
  })

  it('le registre reste SÉRIALISABLE — aucune fonction, aucune classe (invariant §3)', () => {
    // L'état de sim voyage par snapshot Worker et par sauvegarde : une fermeture glissée
    // dans une entrée ne lèverait qu'au premier `structuredClone`, très loin d'ici.
    // Un aller-retour JSON doit rendre la table à l'identique : une fermeture, une classe
    // ou un `undefined` explicite s'y perdraient, et l'égalité tomberait.
    expect(JSON.parse(JSON.stringify(PIECES))).toEqual(PIECES)
    for (const t of STRUCTURE_TYPES) {
      const d: Record<string, unknown> = { ...piece(t) }
      for (const [champ, v] of Object.entries(d)) {
        expect(typeof v, `${t}.${champ} n’est pas sérialisable`).not.toBe('function')
      }
    }
  })
})
