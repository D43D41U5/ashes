import { describe, expect, it } from 'vitest'

/**
 * LE GARDE-FOU DE LA SURFACE DEBUG — un outil qu'on ne peut pas ATTEINDRE n'existe pas.
 *
 * `debug_set_season_day` vivait dans `/sim` depuis V0-9, avec une docstring qui expliquait
 * très bien pourquoi la saison est intestable sans lui… et **aucune surface côté client** :
 * ni touche, ni bouton, ni scénario. Personne ne pouvait l'atteindre en jouant. Rien ne l'a
 * vu — ni `pnpm check` (l'action est bien typée, elle n'est simplement jamais construite), ni
 * les tests de `/sim` (ils l'appellent directement), ni le smoke.
 *
 * Ce que ça a coûté se chiffre : le monde ouvre à l'ouverture des Pluies (`saisons.md` S2), et
 * l'aridité demande de la CHALEUR autant que de la sécheresse — le premier jour où la vallée
 * est vraiment à sec est le **jour 154, soit h 46,5 de jeu**. Les trois régimes du niveau
 * d'eau (S10) et l'art qui les peint n'étaient donc visibles dans AUCUNE séance de playtest.
 *
 * La garde est écrite dans le patron de `hud-pointeur.test.ts` : on lit le CODE, jamais les
 * commentaires — et ce décapage n'est pas théorique ici non plus, puisque le panneau porte
 * une longue docstring qui NOMME l'action. Sans lui, la garde se satisferait de la prose qui
 * décrit l'outil au lieu du code qui le branche.
 *
 * ⚠ PORTÉE : le glob part de ce fichier, il ne voit donc que `scenes/**` — là où vit toute la
 * surface debug aujourd'hui (panneau, raccourcis, overlay, WorldScene). Le jour où une action
 * serait pilotée depuis `worker/` ou `render/`, la garde rougirait alors que la surface existe :
 * c'est le glob qu'il faudrait élargir, pas le branchement qu'il faudrait déplacer.
 */
const SOURCES = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** Le CODE de tout ce qui vit dans les scènes, commentaires ôtés — la surface réelle. */
function codeDesScenes(): string {
  return Object.entries(SOURCES)
    .filter(([chemin]) => !chemin.endsWith('.test.ts'))
    .map(([, source]) => sansCommentaires(source))
    .join('\n')
}

/** Une action de debug est-elle CONSTRUITE quelque part (et pas seulement citée) ? */
function estBranchee(action: string): boolean {
  return new RegExp(`type:\\s*'${action}'`).test(codeDesScenes())
}

describe('la surface du mode debug', () => {
  it('le SAUT DE CALENDRIER est atteignable à la main', () => {
    expect(estBranchee('debug_set_season_day')).toBe(true)
  })

  /**
   * LE JOUR VISÉ SE CALCULE DANS `/sim`, PAS ICI (invariant d'architecture n°3 : le client est
   * bête). Le cœur d'une saison est du CALENDRIER — les cardinaux des courbes annuelles y sont
   * posés, et une seconde copie côté client dériverait le jour où `ACT_DAYS` bouge. Le panneau
   * doit donc appeler `coeurDeLaSaisonSuivante`, jamais refaire l'arithmétique.
   */
  it('et il vise un jour CALCULÉ PAR /sim, pas par le client', () => {
    // ⚠ ON EXIGE L'APPEL, PAS L'IMPORT : `/coeurDeLaSaisonSuivante/` seul serait satisfait par
    // la ligne d'`import` d'un symbole que plus personne n'appelle — la parenthèse est ce qui
    // sépare les deux. Garde de DIRECTION, plus faible que la précédente et assumée telle : le
    // panneau appelle la fonction à DEUX endroits (le saut et son libellé), donc en muter un
    // seul ne la fait pas tomber. Ce qu'elle tient, c'est qu'aucune refonte ne remplace le
    // calendrier de `/sim` par une arithmétique locale.
    expect(/coeurDeLaSaisonSuivante\s*\(/.test(codeDesScenes())).toBe(true)
  })

  /**
   * ET ELLE TOMBE SUR LE DÉFAUT QU'ELLE EXISTE POUR ATTRAPER (protocole `ui-access` : une
   * règle qu'on ne voit jamais tomber n'est pas une règle). On rejoue l'état exact d'avant le
   * 2026-08-24 — l'action documentée, jamais construite — et on exige que la détection
   * l'attrape. C'est aussi la preuve que le décapage des commentaires sert à quelque chose.
   */
  it('un module qui ne fait qu’en PARLER ne compte pas', () => {
    const documenteeSeulement = `
      // Voir aussi { type: 'debug_set_season_day' } dans /sim : le saut de calendrier.
      /* On pourrait câbler debug_set_season_day au panneau un jour. */
      export function rien(): void {}`
    const code = sansCommentaires(documenteeSeulement)
    expect(/type:\s*'debug_set_season_day'/.test(code)).toBe(false)
  })
})
