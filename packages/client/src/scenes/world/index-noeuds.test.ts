import { describe, expect, it } from 'vitest'
import type { ResourceNode } from '@ashes/sim'
import { noeudDefriche, poseLibre } from '@ashes/sim'
import { cleDeTuile, indexerParTuile } from './index-noeuds'

const noeud = (id: number, tx: number, ty: number, stock: number, type = 'tree'): ResourceNode =>
  ({ id, tx, ty, stock, type, regrowAt: 0 }) as ResourceNode

/**
 * Un Feu de village au centre de la fenêtre : c'est son EMPRISE (carré de `rayonEmprise()` = 16
 * en Chebyshev) qui rend un nœud défrichable, donc qui sépare « épuisé » (la tuile reste prise)
 * et « défriché » (la tuile se libère). Sans lui, la moitié du domaine de `poseLibre` serait
 * hors d'atteinte et la garde passerait au vert sans jamais l'avoir traversé.
 *
 * ⚠ `fireTx`/`fireTy`, pas `tx`/`ty` — écrit avec les mauvais noms, l'objet est structurellement
 *   inerte : `dansEmprise` compare à `undefined`, RIEN n'est défrichable, et l'égalité qu'on
 *   cherche à prouver devient vraie par vacuité. C'est arrivé en écrivant ce fichier.
 */
// (`FoyerDeVillage` n'est pas réexporté par l'index de /sim — on en décrit la forme, qui EST
//  le contrat structurel de `poseLibre` : « où brûle son Feu », et rien d'autre.)
const VILLAGES: { fireTx: number; fireTy: number }[] = [{ fireTx: 20, fireTy: 20 }]

describe('indexerParTuile — premier gagnant, comme /sim', () => {
  it('garde le PREMIER nœud d’une tuile, pas le dernier', () => {
    const a = noeud(1, 5, 5, 10)
    const b = noeud(2, 5, 5, 10)
    expect(indexerParTuile([a, b]).get(cleDeTuile(5, 5))).toBe(a)
  })

  it('la clé ne collisionne pas sur une carte de production (1 581 × 2 372)', () => {
    expect(cleDeTuile(1580, 2371)).not.toBe(cleDeTuile(1581, 1371))
    expect(cleDeTuile(0, 999_999)).not.toBe(cleDeTuile(1, 0))
  })
})

/**
 * ═══ LA GARDE QUI COMPTE : LA RÈGLE DE POSE DU CLIENT EST CELLE DE /sim ═══
 *
 * `WorldScene.placeable` lisait `poseLibre` de /sim, qui BALAIE tout le tableau des nœuds —
 * 1 016 µs par image, marteau en main, sur les ~62 000 nœuds de la carte jouée. Il lit
 * désormais l'index et applique la même règle à la main :
 *
 *     const n = view.noeudALaTuile(tx, ty)
 *     if (n !== undefined && !noeudDefriche(villages, n)) return false
 *
 * Ce test affirme que les deux formes rendent la MÊME réponse — pas sur trois cas choisis,
 * mais sur toute une fenêtre, avec un peuplement qui contient exprès ce qui pourrait les
 * séparer : deux nœuds sur une même tuile (le départage), des nœuds épuisés DANS et HORS de
 * l'emprise du village (défriché ou simplement vide), et des tuiles nues.
 */
describe('la règle de pose du client == poseLibre de /sim', () => {
  const NOEUDS: ResourceNode[] = [
    noeud(1, 18, 18, 10), // plein, dans l'emprise → PRISE
    noeud(2, 19, 19, 0), // épuisé DANS l'emprise, non renouvelable → DÉFRICHÉ, la tuile se libère
    noeud(3, 40, 40, 0), // épuisé HORS emprise (Chebyshev 20 > 16) → PRISE : rien ne le défriche
    noeud(4, 21, 21, 10), // plein → PRISE
    noeud(5, 22, 22, 0), // épuisé dans l'emprise…
    noeud(6, 22, 22, 10), // …et PLEIN sur la MÊME TUILE : c'est le départage qu'on éprouve
    noeud(7, 30, 15, 3), // plein, hors emprise → PRISE
    // ÉPUISÉ MAIS RENOUVELABLE, et dans l'emprise : `noeudDefrichable` le refuse (il repousse),
    // donc la tuile reste PRISE. C'est le seul cas où « stock 0 dans l'emprise » ne libère pas.
    noeud(8, 15, 30, 0, 'berry_bush'),
  ]
  const index = indexerParTuile(NOEUDS)

  it('coïncide sur toute la fenêtre 10..45 × 10..45', () => {
    let prises = 0
    let libres = 0
    for (let ty = 10; ty <= 45; ty++) {
      for (let tx = 10; tx <= 45; tx++) {
        const attendu = poseLibre(VILLAGES, NOEUDS, tx, ty)
        const n = index.get(cleDeTuile(tx, ty))
        const obtenu = !(n !== undefined && !noeudDefriche(VILLAGES, n))
        expect(`${tx},${ty}:${obtenu}`).toBe(`${tx},${ty}:${attendu}`)
        if (attendu) libres++
        else prises++
      }
    }
    // LA GARDE DE LA GARDE — le domaine est-il vraiment traversé ? Sans tuile PRISE, l'égalité
    // ne dirait que « les deux rendent toujours vrai ». Et il faut les deux natures de « prise »
    // et les deux natures de « libre » (nue, et défrichée) : c'est le décompte ci-dessous.
    expect(libres).toBeGreaterThan(0)
    // Sept tuiles portent un nœud ; DEUX se libèrent — (19,19) et (22,22), toutes deux
    // défrichées —, donc CINQ restent prises. Le chiffre n'est pas décoratif : c'est lui qui
    // garde le DÉPARTAGE. (22,22) porte deux nœuds ; premier gagnant, c'est le nœud 5, épuisé
    // et dans l'emprise, donc défriché → la tuile est LIBRE. Si l'index basculait sur le
    // dernier, elle tomberait sur le nœud 6, plein, donc PRISE, et ce compte passerait à six.
    expect(prises).toBe(5)
    // ET LES TROIS NATURES DU DOMAINE SONT BIEN TRAVERSÉES — sans quoi l'égalité ci-dessus ne
    // dirait que « les deux formes rendent toujours la même chose sur des tuiles nues ».
    expect(poseLibre(VILLAGES, NOEUDS, 11, 11)).toBe(true) // ① tuile NUE
    expect(poseLibre(VILLAGES, NOEUDS, 19, 19)).toBe(true) // ② libre par DÉFRICHAGE…
    expect(index.get(cleDeTuile(19, 19))).toBeDefined() //    …et pourtant un nœud y est bien
    expect(poseLibre(VILLAGES, NOEUDS, 40, 40)).toBe(false) // ③ épuisé HORS emprise : prise
    expect(poseLibre(VILLAGES, NOEUDS, 15, 30)).toBe(false) // ③bis épuisé mais RENOUVELABLE : prise
  })
})
