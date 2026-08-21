import { describe, expect, it } from 'vitest'

/**
 * LE GARDE-FOU DU POINTEUR SUR LA PLANCHE DU HUD.
 *
 * On s'est fait avoir, et le prix était le plus élevé de tout l'audit UX du 2026-08-20 :
 * les trois boutons des réfugiés — RECRUTER / NOURRIR / DÉPOUILLER — n'ont JAMAIS pu
 * recevoir un clic. Pas un bug de logique : `.hud-overlay` et `.hud-board` sont
 * `pointer-events:none` (hud-dom.ts, et c'est voulu — la planche couvre tout l'écran et
 * doit laisser passer les gestes vers le monde), et chaque contrôle cliquable RALLUME le
 * pointeur sur lui-même. Six modules sur sept le faisaient. Le septième, non — et comme
 * `refugee-prompt.ts` est le seul émetteur de `recruit_refugees` / `feed_refugees` /
 * `rob_refugees`, le seul dilemme d'alignement à trois voies de la Veillée était
 * INJOUABLE. Il se soldait toujours par « refouler », par défaut.
 *
 * Rien ne l'avait vu : ni `pnpm check` (le CSS est une chaîne), ni un test (aucun ne monte
 * de panneau), ni le smoke (aucun scénario ne clique un bouton de réfugiés).
 *
 * LA RÈGLE GARDÉE ICI est donc celle du dépôt, rendue mécanique : **tout module monté sur
 * la planche du HUD qui porte un contrôle cliquable doit rallumer le pointeur** — par la
 * classe partagée `.hud-click` (hud-dom.ts) ou par son propre `pointer-events:auto`
 * (le patron de `fire-panel` et `build-menu`, pour un panneau qui prend tout son cadre).
 *
 * Elle est EXHAUSTIVE PAR CONSTRUCTION : elle ne connaît aucun nom de fichier, elle
 * découvre les modules par leur signature (`board: HTMLElement`). Le prochain panneau qui
 * oubliera tombera ici, sans qu'on ait à y penser.
 */
const SOURCES = import.meta.glob('../../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/**
 * ON LIT LE CODE, PAS LES COMMENTAIRES — et cette précaution n'est pas théorique : le
 * commentaire qui explique le correctif ci-dessus contient lui-même les mots
 * `pointer-events:auto`. Sans ce décapage, la garde se serait satisfaite de la PROSE qui
 * décrit la règle au lieu du CODE qui l'applique. C'est exactement le genre de garde qui
 * rend vert en ne gardant rien.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** Un module monté sur la planche : sa fabrique reçoit `board: HTMLElement`. */
function surLaPlanche([, source]: [string, string]): boolean {
  return /board:\s*HTMLElement/.test(sansCommentaires(source))
}

/** Porte-t-il quelque chose qu'on CLIQUE ? (un bouton, ou un écouteur de clic) */
function estCliquable(source: string): boolean {
  const code = sansCommentaires(source)
  return /<button/.test(code) || /addEventListener\(\s*['"]click['"]/.test(code)
}

/** Rallume-t-il le pointeur, par l'une ou l'autre des deux façons admises ? */
function rallumeLePointeur(source: string): boolean {
  const code = sansCommentaires(source)
  return /hud-click/.test(code) || /pointer-events\s*:\s*auto/.test(code)
}

describe('le pointeur sur la planche du HUD', () => {
  it('la garde VOIT quelque chose — sinon elle ne garde rien', () => {
    // Un glob vide, ou une signature qui a changé de forme, rendraient cette suite verte
    // en ne testant plus personne. On exige donc que la population soit peuplée AVANT
    // d'affirmer quoi que ce soit sur elle.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)
    const montes = Object.entries(SOURCES).filter(surLaPlanche)
    expect(montes.length).toBeGreaterThanOrEqual(6)
  })

  it('tout panneau cliquable monté sur la planche rallume le pointeur', () => {
    const muets = Object.entries(SOURCES)
      .filter(surLaPlanche)
      .filter(([, source]) => estCliquable(source))
      .filter(([, source]) => !rallumeLePointeur(source))
      .map(([path]) => path)

    // Un fichier ici = un panneau qu'on VOIT et qu'on ne peut pas CLIQUER. Le correctif
    // n'est pas d'écouter le clic ailleurs : c'est d'ajouter `.hud-click` au contrôle, ou
    // `pointer-events:auto` à la carte qui le contient.
    expect(muets).toEqual([])
  })

  /**
   * LA GARDE SE PROUVE DANS LES DEUX SENS (protocole `ui-access`) : une règle qu'on ne
   * voit jamais tomber n'est pas une règle. On rejoue ici le défaut EXACT du 2026-08-20 —
   * la source de `refugee-prompt` telle qu'elle était, avec ses boutons et son seul
   * `pointer-events:none` de halo — et on exige que la détection l'attrape.
   */
  it('et elle TOMBE sur le défaut qu\'elle existe pour attraper', () => {
    const avantCorrectif = `
      export function createRefugeePrompt(board: HTMLElement) {
        const root = document.createElement('div')
        root.innerHTML = \`<style>
          .rfp-halo{pointer-events:none;}
          .rfp-btn{background:rgba(201,139,58,.14);border:2px solid #c98b3a;}
        </style><button class="rfp-btn" data-verb="recruit">RECRUTER</button>\`
        board.appendChild(root)
      }`
    expect(surLaPlanche(['refugee-prompt.ts', avantCorrectif])).toBe(true)
    expect(estCliquable(avantCorrectif)).toBe(true)
    expect(rallumeLePointeur(avantCorrectif)).toBe(false) // ← le défaut, vu par la garde
  })

  /**
   * ET ELLE NE SE LAISSE PAS PAYER DE MOTS : un fichier qui se contente de PARLER de
   * `pointer-events:auto` dans un commentaire, sans le déclarer, doit rester coupable.
   */
  it('un commentaire qui parle du pointeur ne vaut pas une déclaration', () => {
    const quiEnParleSeulement = `
      export function faux(board: HTMLElement) {
        // On pense à poser pointer-events:auto un jour, promis.
        /* Voir .hud-click dans hud-dom.ts pour la convention. */
        board.appendChild(document.createElement('button'))
      }`
    expect(rallumeLePointeur(quiEnParleSeulement)).toBe(false)
  })
})
