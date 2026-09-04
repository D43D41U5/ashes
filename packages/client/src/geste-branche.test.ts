import { describe, expect, it } from 'vitest'

/**
 * UN GESTE DÉCLARÉ EST UN GESTE BRANCHÉ.
 *
 * `death-veil.ts` exposait `onRelever(cb)` — le geste par lequel le joueur choisit de se
 * relever, la SEULE sortie voulue de l'écran de mort depuis la décision du 2026-08-20. Le
 * bouton était peint, stylé, mis au focus pour ENTRÉE et ESPACE… et **personne n'appelait
 * `onRelever`**. Cliquer « SE RELEVER » ne faisait rien. Le joueur restait devant le voile
 * les trente secondes du filet, puis se retrouvait au Feu sans l'avoir demandé — c'est-à-dire
 * exactement le rythme que la décision corrigeait, avec l'écran en plus.
 *
 * Rien ne pouvait le voir : `pnpm check` est content d'une méthode publique non appelée,
 * aucun test ne monte le voile, et le smoke ne clique pas ce bouton. Le seul témoin possible
 * est la garde ci-dessous, et elle est EXHAUSTIVE PAR CONSTRUCTION : elle ne connaît aucun
 * nom de fichier ni de geste. Elle cherche le PATRON — un membre d'interface `onX(cb: (…) =>
 * void): void`, la signature d'un module DOM qui offre une prise à qui le monte — et exige
 * qu'un autre fichier s'y branche. Le prochain geste oublié tombera ici.
 *
 * NB — on ne garde ici que les REGISTRARS (le paramètre est un rappel). Les champs
 * `onResume(): void` / `onContinue(slot: number): void` des options de `pause-menu` et
 * `menu-dom` sont l'inverse : c'est l'appelant qui les FOURNIT, le module qui les appelle.
 */
const SOURCES = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** On lit le CODE, pas la prose : ce fichier-ci cite `onRelever` dans son propre en-tête. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** `  onNom(cb: (…) => void): void` — le membre d'interface qui offre une prise. */
const REGISTRAR = /^\s{2}(on[A-Z][A-Za-z]*)\(\s*\w+\s*:\s*\(.*?\)\s*=>\s*void\s*\)\s*:\s*void$/gm

const registrars: { fichier: string; geste: string }[] = []
for (const [fichier, brut] of Object.entries(SOURCES)) {
  if (fichier.endsWith('.test.ts')) continue
  for (const m of sansCommentaires(brut).matchAll(REGISTRAR)) {
    const geste = m[1]
    if (geste) registrars.push({ fichier, geste })
  }
}

describe('tout geste offert par un module client trouve son appelant', () => {
  // La garde prouve sa prémisse : si le patron cessait de matcher (une refonte de style,
  // une signature élargie), la boucle ci-dessous ne tournerait sur rien et rendrait vert
  // sans rien garder. On affirme donc d'abord que le domaine existe.
  it('le patron trouve bien des gestes à garder', () => {
    expect(registrars.length).toBeGreaterThanOrEqual(3)
  })

  it.each(registrars.map((r) => [r.geste, r.fichier] as const))('« %s » (%s) est appelé quelque part', (geste, ou) => {
    const appelants = Object.entries(SOURCES).filter(
      ([f, brut]) => f !== ou && sansCommentaires(brut).includes(`.${geste}(`),
    )
    expect(appelants.length, `${geste} est déclaré dans ${ou} mais personne ne s'y branche`).toBeGreaterThan(0)
  })
})
