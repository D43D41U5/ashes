/**
 * LE TIROIR DU REGISTRE — sa seule promesse mécanique : **il n'écrit rien**.
 *
 * Toutes les phrases de la fiche viennent de `/sim` (`ficheDuLieu` → `phraseDuFait`,
 * `nomDEre`). C'est la doctrine de l'écrivain unique : deux écrans qui décriraient le même
 * fait avec deux textes écrits deux fois finissent par se contredire — c'est le défaut que le
 * module `annales.ts` existe pour empêcher, et un panneau client est l'endroit exact où la
 * tentation du copier-coller se présente.
 *
 * La garde est EXHAUSTIVE PAR CONSTRUCTION : elle balaie tout le vocabulaire de `/sim` et
 * cherche chaque phrase dans la SOURCE du module. Un type ajouté demain est couvert.
 */
import { describe, expect, it } from 'vitest'
import { nomDEre, phraseDuFait, type FaitDeGeneration } from '@ashes/sim'
import { ligneHtml, RIEN_ENCORE } from './fiche-lieu'

const SOURCE = import.meta.glob('./fiche-lieu.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** L'union des types, énumérée par le COMPILATEUR (pas par un grep). */
const TOUS_LES_TYPES: Record<FaitDeGeneration['type'], true> = {
  fondation: true, gue: true, sort: true, gravure: true, essart: true,
  taille: true, guet: true, porte: true, croisee: true, fosse: true, fuite: true,
}
const CAUSES = [undefined, 'eau', 'route', 'brule', 'pille', 'intact', 'fer', 'charbon', 'nord', 'sud', 'est', 'ouest', 'secours']

describe('le tiroir n’écrit rien — l’écrivain unique', () => {
  const src = Object.values(SOURCE)[0]!

  it('aucune phrase du pays d’avant n’est recopiée dans le client', () => {
    let balayees = 0
    for (const type of Object.keys(TOUS_LES_TYPES) as FaitDeGeneration['type'][]) {
      for (const cause of CAUSES) {
        const { texte } = phraseDuFait({ ere: 1, type, x: 0, y: 0, ...(cause ? { cause } : {}) })
        expect(src, `${type}:${cause ?? ''}`).not.toContain(texte)
        balayees += 1
      }
    }
    for (const ere of [0, 1, 2, 3]) expect(src).not.toContain(nomDEre(ere))
    // CE QUI FERAIT ROUGIR UNE SONDE VIDE : si le balayage ne voyait rien, il passerait tout
    // seul. On affirme donc qu'il a bien tourné sur un domaine peuplé.
    expect(balayees).toBe(Object.keys(TOUS_LES_TYPES).length * CAUSES.length)
    expect(src.length).toBeGreaterThan(1000) // la source a bien été lue, pas une chaîne vide
  })

  it('la SEULE phrase du module est celle du silence — et elle dit un constat', () => {
    expect(src).toContain(RIEN_ENCORE)
    expect(RIEN_ENCORE.endsWith('.')).toBe(true)
    // Le module importe le lecteur de /sim plutôt que de relire la carte lui-même.
    expect(src).toContain('ficheDuLieu')
  })
})

describe('la ligne posée', () => {
  it('porte la gouttière, le texte et le POIDS en classe', () => {
    const html = ligneHtml({ gouttiere: 'l’an 2 · jour 5', texte: 'Une horde en est partie.', poids: 'battement', rang: { an: 2, jour: 5 } })
    expect(html).toContain('fl-battement')
    expect(html).toContain('l’an 2 · jour 5')
    expect(html).toContain('Une horde en est partie.')
  })

  it('échappe le texte : un toponyme est une chaîne, jamais du balisage', () => {
    const html = ligneHtml({ gouttiere: '<b>x</b>', texte: 'la Ferme <script>alert(1)</script>', poids: 'recit', rang: { ere: 1 } })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
  })
})
