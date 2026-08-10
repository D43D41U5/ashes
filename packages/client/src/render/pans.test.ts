/**
 * LES PANS — la garde de la règle d'effacement (décisions d'Alexis, 2026-07-27).
 *
 * On teste la RÈGLE, pas le rendu : un pan est un côté de bâtiment, il tombe d'un bloc, et il
 * tombe pour les raisons décidées — la distance (des deux côtés) et le dedans (pour la façade).
 * Le décor de test est une petite salle bâtie à la main, plus lisible que la vraie Ferme et qui
 * porte exactement les cas qui comptent : un seuil, une brèche, une cour mitoyenne.
 */
import { describe, expect, it } from 'vitest'
import { calculerNappe, calculerPans, pansTombes, type StructureLike } from './pans'

const N = 1, E = 2, S = 4, O = 8
let id = 0
const sol = (tx: number, ty: number, type = 'floor'): StructureLike => ({ id: id++, tx, ty, type })
const mur = (tx: number, ty: number, edges: number, type = 'wall'): StructureLike => ({ id: id++, tx, ty, type, edges })

/**
 * LA SALLE D'ESSAI — 4×3 de dallage en (10..13, 10..12), ceinte de murs posés DEHORS avec le
 * bit qui regarde la salle (la convention du monde bâti). Au sud, un seuil ; à l'est, une
 * BRÈCHE (une tuile sans mur). Au sud encore, une cour de terre battue et sa clôture.
 */
function salle(): { structures: StructureLike[] } {
  id = 0
  const s: StructureLike[] = []
  for (let x = 10; x <= 13; x++) for (let y = 10; y <= 12; y++) s.push(sol(x, y))
  for (let x = 10; x <= 13; x++) s.push(mur(x, 9, S)) //             pan NORD de la salle
  for (let x = 10; x <= 13; x++) {
    // pan SUD : le seuil en fait partie (il porte la même arête)
    s.push(mur(x, 13, N, x === 11 ? 'encadrement' : 'wall'))
  }
  for (let y = 10; y <= 12; y++) s.push(mur(9, y, E)) //             pan OUEST
  for (let y = 10; y <= 12; y++) if (y !== 11) s.push(mur(14, y, O)) // pan EST, PERCÉ en y=11
  // La cour, au sud, et sa clôture — un autre sol, donc une autre région.
  for (let x = 10; x <= 13; x++) for (let y = 14; y <= 15; y++) s.push(sol(x, y, 'terre'))
  for (let x = 10; x <= 13; x++) s.push(mur(x, 16, N, 'cloture'))
  return { structures: s }
}

describe('les pans', () => {
  const { structures } = salle()
  const pans = calculerPans(structures)
  const panDe = (tx: number, ty: number, cote: string): number | undefined => {
    const s = structures.find((q) => q.tx === tx && q.ty === ty && q.edges !== undefined)
    return pans.parBarriere.get(s!.id)?.find((i) => pans.liste[i]!.cote === cote)
  }

  it('regroupe un CÔTÉ entier en un seul pan — seuil compris', () => {
    const gauche = panDe(10, 13, 'S')
    const seuil = panDe(11, 13, 'S')
    const droite = panDe(13, 13, 'S')
    expect(gauche).toBeDefined()
    expect(seuil, 'le seuil appartient au pan qu’il perce').toBe(gauche)
    expect(droite, 'le pan court d’un bout à l’autre').toBe(gauche)
  })

  it('une BRÈCHE ne coupe pas le pan : les deux tronçons sont le même côté', () => {
    const haut = panDe(14, 10, 'E')
    const bas = panDe(14, 12, 'E')
    expect(haut).toBeDefined()
    expect(bas, 'la brèche du milieu ne fait pas deux pans').toBe(haut)
    expect(pans.liste[haut!]!.debut).toBe(10)
    expect(pans.liste[haut!]!.fin).toBe(12)
  })

  it('la salle et la cour sont DEUX régions, donc deux jeux de pans', () => {
    const murSud = panDe(10, 13, 'S') //      borde la salle par le sud
    const cloture = panDe(10, 16, 'S') //     borde la cour par le sud
    expect(murSud).not.toBe(cloture)
    expect(pans.liste[murSud!]!.region).not.toBe(pans.liste[cloture!]!.region)
  })

  it('un mur d’ANGLE appartient aux DEUX pans qu’il tient', () => {
    const coin: StructureLike = { id: 999, tx: 9, ty: 9, type: 'wall', edges: E | S }
    const p = calculerPans([...structures, coin])
    expect(p.parBarriere.get(999)?.length, 'l’angle tient l’ouest ET le nord').toBe(2)
  })

  describe('quand un pan tombe', () => {
    const tombe = (x: number, y: number, tx: number, ty: number, cote: string): boolean => {
      const t = pansTombes(pans, { x, y }, 2)
      const i = panDe(tx, ty, cote)
      return i !== undefined && t.has(i)
    }

    it('LE DEDANS : la façade du sud tombe dès qu’on est dans la salle, même au fond', () => {
      // Au NORD de la salle (10,5), donc à 3 tuiles du pan du sud : la distance ne suffirait pas.
      expect(tombe(11.5, 10.5, 10, 13, 'S')).toBe(true)
    })

    it('LA DISTANCE : le pan du nord tombe à 2 tuiles, pas à 3', () => {
      expect(tombe(11.5, 11.9, 10, 9, 'N'), 'à 1,9 tuile du nord').toBe(true)
      expect(tombe(11.5, 12.5, 10, 9, 'N'), 'à 2,5 tuiles du nord').toBe(false)
    })

    it('LES CÔTÉS tombent aussi — c’est tout l’intérêt de la règle de distance', () => {
      expect(tombe(11.0, 11.5, 9, 10, 'O'), 'à 1 tuile du pan ouest').toBe(true)
      expect(tombe(13.5, 11.5, 9, 10, 'O'), 'à 3,5 tuiles du pan ouest').toBe(false)
      expect(tombe(13.5, 11.5, 14, 10, 'E'), 'à 1 tuile du pan est').toBe(true)
    })

    it('DES DEUX CÔTÉS : depuis le dehors aussi, le pan tombe', () => {
      expect(tombe(11.5, 8.0, 10, 9, 'N'), 'au nord du mur nord, dehors').toBe(true)
      expect(tombe(11.5, 15.0, 10, 13, 'S'), 'au sud du mur sud, dehors').toBe(true)
    })

    it('mais PAS quand on est à côté sans le longer : l’emprise compte', () => {
      // Même Y que le pan nord, mais huit tuiles à l'est : hors emprise (élargie de D).
      expect(tombe(22, 9.5, 10, 9, 'N')).toBe(false)
    })

    it('et un pan LOINTAIN ne tombe jamais', () => {
      expect(pansTombes(pans, { x: 40, y: 40 }, 2).size).toBe(0)
    })
  })
})

/**
 * LA NAPPE — « dedans » veut dire SOUS UN TOIT (calage du 2026-08-10).
 *
 * Le décor : une salle couverte 2×2 en (10..11, 10..11), sa TERRASSE dallée mais à ciel
 * ouvert en (12, 10..11), et plus loin un dallage isolé (la cour de la Ferme, en petit).
 * Les murs ne jouent aucun rôle ici — la nappe ne les regarde pas, c'est sa robustesse.
 */
describe('calculerNappe', () => {
  const toit = (tx: number, ty: number): StructureLike => ({ id: id++, tx, ty, type: 'roof' })
  const decor = (): StructureLike[] => {
    id = 100
    const s: StructureLike[] = []
    for (let x = 10; x <= 11; x++) for (let y = 10; y <= 11; y++) { s.push(sol(x, y)); s.push(toit(x, y)) }
    for (let y = 10; y <= 11; y++) s.push(sol(12, y)) //   la terrasse : dallée, jamais couverte
    for (let x = 20; x <= 21; x++) s.push(sol(x, 10)) //   la cour lointaine, à ciel ouvert
    return s
  }

  it('ne s’arme que sous un toit — le dallage à ciel ouvert est DEHORS', () => {
    const s = decor()
    // Sur la cour lointaine : le pied est sur un sol bâti, la tête est sous le ciel.
    expect(calculerNappe(s, { x: 20.5, y: 10.5 })).toBeNull()
    // Sur la terrasse : CONTIGUË à la salle couverte, et dehors quand même.
    expect(calculerNappe(s, { x: 12.5, y: 10.5 })).toBeNull()
    // Dans l'herbe, et sans joueur : rien non plus.
    expect(calculerNappe(s, { x: 5.5, y: 5.5 })).toBeNull()
    expect(calculerNappe(s, undefined)).toBeNull()
  })

  it('sous le toit, la nappe est la composante ENTIÈRE — terrasse comprise, herbe exclue', () => {
    const nappe = calculerNappe(decor(), { x: 10.5, y: 10.5 })!
    expect(nappe).not.toBeNull()
    // Le remplissage traverse sol ET toit : la terrasse fait partie du même bâtiment…
    for (const k of ['10,10', '10,11', '11,10', '11,11', '12,10', '12,11']) expect(nappe.has(k), k).toBe(true)
    // …mais il s'arrête à l'herbe : la cour lointaine n'en est pas.
    expect(nappe.has('20,10')).toBe(false)
    expect(nappe.size).toBe(6)
  })

  it('reste robuste à un TROU de dallage : le toit suffit à porter le remplissage', () => {
    // La même salle, dont on arrache le dallage central — le toit, lui, est toujours là.
    const s = decor().filter((q) => !(q.type === 'floor' && q.tx === 11 && q.ty === 10))
    const nappe = calculerNappe(s, { x: 10.5, y: 10.5 })!
    expect(nappe.has('11,10')).toBe(true)
  })
})
