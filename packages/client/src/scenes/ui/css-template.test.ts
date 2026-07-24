/**
 * LE PIÈGE DU BACKTICK — un garde-fou mécanique, parce que la mémoire ne suffit pas.
 *
 * Les modules d'UI DOM posent leur CSS dans un TEMPLATE LITTÉRAL (`root.innerHTML = ` … ``).
 * Or on commente en français en citant les identifiants entre backticks, par réflexe. Un
 * backtick dans un commentaire CSS **ferme la chaîne** et casse le build.
 *
 * Ça s'est produit TROIS fois en deux jours (pause-menu ×2, hud-core ×1). Deux fois le
 * symptôme fut un `pnpm build` en échec — donc un smoke qui meurt sur « build a échoué »,
 * message qui envoie chercher la panne au mauvais endroit. La discipline n'a pas tenu ;
 * on la remplace donc par un test.
 *
 * On ne juge que les commentaires CSS (`/* … *​/`) SITUÉS DANS un template littéral : c'est
 * exactement là que le backtick est fatal. Les commentaires JS (`//`) et le code n'ont
 * évidemment pas cette contrainte.
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/**
 * Les commentaires CSS, repérés par les balises `<style>` … `</style>` — PAS en analysant
 * les templates littéraux.
 *
 * Première version de ce test : elle cherchait les commentaires À L'INTÉRIEUR d'un template
 * littéral. Elle passait au vert sur le bug réintroduit exprès — parce que le raisonnement
 * est circulaire : dès qu'on insère le backtick fautif, il DEVIENT un délimiteur et découpe
 * le template autrement ; le commentaire coupable n'est alors plus « dans » un template.
 * Un test qu'on n'a pas vu ÉCHOUER sur le vrai bug ne prouve rien.
 *
 * Les balises `<style>`, elles, restent du texte quoi qu'il arrive à la syntaxe JS.
 */
function cssComments(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  for (const bloc of source.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    const corps = bloc[1] ?? ''
    const debut = bloc.index + bloc[0].indexOf(corps)
    for (const c of corps.matchAll(/\/\*[\s\S]*?\*\//g)) {
      out.push({ line: source.slice(0, debut + c.index).split('\n').length, text: c[0] })
    }
  }
  return out
}

describe('le CSS en template littéral', () => {
  it('ne contient aucun backtick dans ses commentaires', () => {
    // Le garde-fou doit d'abord VOIR (un glob vide passerait au vert en ne gardant rien).
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)

    const coupables: string[] = []
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts')) continue
      for (const c of cssComments(source)) {
        if (c.text.includes('`')) coupables.push(`${path}:${c.line}`)
      }
    }

    // Un fichier ici casse le build : le backtick ferme la chaîne CSS.
    // Correction : citer l'identifiant SANS backticks dans ce commentaire.
    expect(coupables).toEqual([])
  })
})
