/**
 * ═══ LE SOLEIL ET LA LUNE, AU TRAIT — UNE SEULE ÉCRITURE ═══════════════════════════════════
 *
 * (Alexis, 2026-08-27 : « pourquoi ne pas utiliser les mêmes icônes que celles dans la barre
 * en haut. Les icônes sont bien je trouve. »)
 *
 * Ces deux tracés vivaient dans `icones()` de `barre-haute.ts`, au milieu des sept temps. Le
 * cadran jour/nuit de l'encyclopédie en a besoin des deux — et un pictogramme recopié, c'est
 * la même dérive que deux tables du même nombre : le jour où l'un s'affine, l'autre reste.
 * D'où ce module : la barre haute et l'encyclopédie tirent du MÊME trait.
 *
 * Grille de 16 (`viewBox="0 0 16 16"`), au TRAIT et non en glyphes — le jeu n'a pas d'émoji,
 * et un trait se recolore ; c'est cette dernière propriété qui rend le partage possible, car
 * les deux écrans ne les posent pas sur le même fond (un panneau sombre là, une bande d'or ou
 * d'ardoise ici).
 */

/** Les corps SVG, sans enveloppe : chaque appelant pose la sienne (taille, classe, teinte). */
export const ASTRES = {
  soleil:
    `<circle cx="8" cy="8" r="3.1"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3` +
    `M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3" stroke-linecap="round"/>`,
  lune: `<path d="M11.4 10.6A5 5 0 0 1 5.4 4.6a5 5 0 1 0 6 6Z" stroke-linejoin="round"/>`,
} as const

export type Astre = keyof typeof ASTRES

/**
 * L'astre en SVG autonome — avec son `xmlns`, donc valide hors du DOM (dans une `url()` de
 * CSS, ce que la barre haute n'avait jamais eu à faire : ses icônes sont des nœuds du document).
 */
export function astreSvg(nom: Astre, teinte: string, trait = 1.4): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" ` +
    `stroke="${teinte}" stroke-width="${trait}">${ASTRES[nom]}</svg>`
  )
}

/**
 * Le même, en `data:` — pour un `background-image`.
 *
 * ⚠ `encodeURIComponent` ET NON le SVG brut : une teinte est un `#rrggbb`, et un `#` non
 * échappé dans une `url()` ouvre un fragment — le navigateur tronque la source à cet endroit
 * et n'affiche RIEN, sans un mot dans la console.
 */
export function astreUrl(nom: Astre, teinte: string, trait = 1.4): string {
  return `data:image/svg+xml,${encodeURIComponent(astreSvg(nom, teinte, trait))}`
}
