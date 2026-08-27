/**
 * LE FONDU DE CIME — les gardes (demande d'Alexis, 2026-08-25 : « une transition lente »).
 *
 * Ce qui doit rester vrai, et dont rien d'autre ne répond :
 *   ① un arbre vu pour la PREMIÈRE fois est déjà dans son état — il ne « devient » pas nu sous
 *      les yeux du joueur qui s'approche ;
 *   ② un changement d'ÉTAT et un changement de SAISON n'ont pas la même durée, et c'est le
 *      module qui choisit, pas l'appelant ;
 *   ③ le fondu est MONOTONE et arrive à 1 — un passage qui n'arrive pas laisse deux cimes
 *      superposées à jamais, et personne ne le verrait ;
 *   ④ les fondus sont indexés par ARBRE : deux arbres ne se les échangent pas ;
 *   ⑤ la carte reste BORNÉE — sinon c'est une fuite qui grandit avec la distance parcourue.
 */
import { describe, expect, it } from 'vitest'
import { FONDU_CIME, FonduDeCime } from './fondu-cime'

describe('le fondu de cime — une cime ne change jamais d’un coup', () => {
  it('① le premier regard ne fond rien : l’arbre est déjà dans son état', () => {
    const f = new FonduDeCime()
    const e = f.etape(1, 'nd-hetre_crown_nu_lit-0', 'nu', 1000)
    expect(e.precedente).toBeNull()
    expect(e.u).toBe(1)
    expect(e.cle).toBe('nd-hetre_crown_nu_lit-0')
  })

  it('② un changement d’ÉTAT dure ETAT_MS, un changement de SAISON dure SAISON_MS', () => {
    const f = new FonduDeCime()
    f.etape(1, 'a', 'feuillu', 0)
    // ÉTAT : feuillu → nu.
    f.etape(1, 'b', 'nu', 0)
    expect(f.etape(1, 'b', 'nu', FONDU_CIME.ETAT_MS / 2).u).toBeCloseTo(0.5, 3)
    expect(f.etape(1, 'b', 'nu', FONDU_CIME.ETAT_MS).u).toBe(1)

    const g = new FonduDeCime()
    g.etape(2, 'a', 'feuillu', 0)
    // SAISON : même état, autre emplacement de parité — donc autre clé.
    g.etape(2, 'a~1', 'feuillu', 0)
    expect(g.etape(2, 'a~1', 'feuillu', FONDU_CIME.ETAT_MS).u).toBeLessThan(0.5)
    expect(g.etape(2, 'a~1', 'feuillu', FONDU_CIME.SAISON_MS / 2).u).toBeCloseTo(0.5, 3)
    expect(g.etape(2, 'a~1', 'feuillu', FONDU_CIME.SAISON_MS).u).toBe(1)
    // Et la saison est FRANCHEMENT plus lente que l'état : c'est la décision, pas un réglage fin.
    expect(FONDU_CIME.SAISON_MS).toBeGreaterThan(FONDU_CIME.ETAT_MS * 3)
  })

  it('③ le fondu est monotone, borné, et il ARRIVE — puis il se referme', () => {
    const f = new FonduDeCime()
    f.etape(1, 'a', 'feuillu', 0)
    f.etape(1, 'b', 'nu', 0)
    let precedent = -1
    for (let t = 0; t <= FONDU_CIME.ETAT_MS; t += 100) {
      const e = f.etape(1, 'b', 'nu', t)
      expect(e.u).toBeGreaterThanOrEqual(precedent)
      expect(e.u).toBeGreaterThanOrEqual(0)
      expect(e.u).toBeLessThanOrEqual(1)
      precedent = e.u
    }
    // Passé la durée, la cime sortante DISPARAÎT : deux sprites superposés à jamais seraient
    // invisibles à l'œil et coûteraient un pool entier.
    const fin = f.etape(1, 'b', 'nu', FONDU_CIME.ETAT_MS + 1)
    expect(fin.precedente).toBeNull()
    expect(fin.u).toBe(1)
  })

  it('③ bis une transition qui en interrompt une autre repart de CE QU’ON VOIT', () => {
    const f = new FonduDeCime()
    f.etape(1, 'a', 'feuillu', 0)
    f.etape(1, 'b', 'nu', 0)
    f.etape(1, 'b', 'nu', FONDU_CIME.ETAT_MS / 2) // à mi-chemin de a → b
    const e = f.etape(1, 'c', 'neige1', FONDU_CIME.ETAT_MS / 2)
    expect(e.cle).toBe('c')
    expect(e.precedente).toBe('b') // la CIBLE d'avant, pas 'a' : c'est ce qui était en train de paraître
    expect(e.u).toBe(0)
  })

  it('④ deux arbres ne s’échangent pas leur transition', () => {
    const f = new FonduDeCime()
    f.etape(1, 'a', 'feuillu', 0)
    f.etape(2, 'a', 'feuillu', 0)
    f.etape(1, 'b', 'nu', 0) // seul l'arbre 1 change
    const e1 = f.etape(1, 'b', 'nu', 100)
    const e2 = f.etape(2, 'a', 'feuillu', 100)
    expect(e1.precedente).toBe('a')
    expect(e2.precedente).toBeNull()
  })

  it('⑥ tout oublier : un changement de PIPELINE ne se fond pas, il se pose', () => {
    // Le défaut réel : `lighting` était posé APRÈS `renderNodes`, donc la première image d'un
    // chargement dessinait les cimes sur l'art PEINT, et la seconde sur le `_lit`. À état
    // constant, ce simple changement de clé arme le fondu de SAISON — trente secondes de vieux
    // houppier posé par-dessus le neuf. Ce n'est pas une transition du monde, et l'appelant le
    // dit en oubliant les suivis.
    const f = new FonduDeCime()
    f.etape(1, 'nd-tree_crown', 'feuillu', 0) // image 1 : lighting encore faux
    const sansOubli = f.etape(1, 'nd-tree_crown_lit-3', 'feuillu', 16)
    expect(sansOubli.precedente).toBe('nd-tree_crown') // le fondu s'arme…
    expect(sansOubli.u).toBeLessThan(0.001) // …et il durerait SAISON_MS
    f.oublieTout()
    expect(f.taille).toBe(0)
    const apres = f.etape(1, 'nd-tree_crown_lit-3', 'feuillu', 32)
    expect(apres.precedente).toBeNull() // plus rien à effacer : l'arbre EST sur sa cime
    expect(apres.u).toBe(1)
  })

  it('⑤ la carte s’oublie : un arbre qu’on ne regarde plus sort du suivi', () => {
    const f = new FonduDeCime()
    for (let id = 0; id < 500; id++) f.etape(id, 'a', 'feuillu', 0)
    expect(f.taille).toBe(500)
    // On n'en regarde plus qu'un, longtemps après.
    const tard = FONDU_CIME.OUBLI_MS * 3
    f.etape(7, 'a', 'feuillu', tard)
    f.menage(tard)
    expect(f.taille).toBe(1)
    // Et le ménage ne balaie pas à chaque image : rappelé aussitôt, il ne refait rien.
    for (let id = 1000; id < 1010; id++) f.etape(id, 'a', 'feuillu', tard)
    f.menage(tard + 1)
    expect(f.taille).toBe(11)
  })
})
