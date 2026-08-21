import { describe, expect, it } from 'vitest'
import { WALL_MATERIAL_ORDER } from '@ashes/sim'
import { BAD_TINT, GHOST_ALPHA_BAD, GHOST_ALPHA_OK, OK_TINT, prochainPalier } from './build-ghost'

/**
 * LE REFUS DE POSE DOIT SE LIRE SANS DISTINGUER LE VERT DU ROUGE.
 *
 * Le fantôme de construction est le seul endroit du jeu où le joueur reçoit un refus par la
 * TEINTE seule. Mesuré (simulation Viénot–Brettel–Mollon + ΔE2000) : l'écart entre les deux
 * états tombe de 60,7 en vision normale à **17,0 en deutéranopie (−72 %)** et 30,4 en
 * protanopie — les deux teintes deviennent deux olives voisines. Un joueur deutéranope voyait
 * un fantôme et devait deviner s'il disait oui ou non. (Audit UX 2026-08-20, D10-11.)
 *
 * On mesure donc l'écart APRÈS simulation, sur le canal qui reste : la CLARTÉ, opacité
 * comprise. C'est ce qui empêche la règle de redevenir une affaire de teinte le jour où
 * quelqu'un « harmonise » les deux couleurs.
 */

/** Une matrice de simulation, appliquée en linéaire — la forme usuelle de Viénot 1999. */
type Filtre = readonly [number, number, number, number, number, number, number, number, number]
const DEUTERANOPIE: Filtre = [0.625, 0.375, 0.0, 0.7, 0.3, 0.0, 0.0, 0.3, 0.7]
const PROTANOPIE: Filtre = [0.567, 0.433, 0.0, 0.558, 0.442, 0.0, 0.0, 0.242, 0.758]

const canaux = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]

function simule(hex: number, m: Filtre): [number, number, number] {
  const [r, g, b] = canaux(hex)
  return [
    Math.min(255, m[0] * r + m[1] * g + m[2] * b),
    Math.min(255, m[3] * r + m[4] * g + m[5] * b),
    Math.min(255, m[6] * r + m[7] * g + m[8] * b),
  ]
}

/** Luminance relative WCAG, sur un triplet 0-255. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * CE QUE LE FANTÔME AJOUTE AU MONDE : sa clarté PONDÉRÉE PAR SON OPACITÉ. C'est la grandeur
 * qui compte — un fantôme deux fois plus transparent lève deux fois moins le fond, quelle que
 * soit sa teinte. C'est aussi le canal que le daltonisme ne touche pas.
 */
const poids = (hex: number, alpha: number, m: Filtre): number => luminance(simule(hex, m)) * alpha

describe('le fantôme de pose se lit sans distinguer les couleurs', () => {
  it('la TEINTE SEULE ne porte RIEN en deutéranopie — et c’est pire que l’audit ne le disait', () => {
    // L'audit annonçait « l'écart ne survit qu'en clarté ». Mesuré ici : il ne survit PAS.
    // Les deux teintes rendent la MÊME luminance à 0,1 % près une fois simulées — le canal
    // couleur transmet exactement zéro bit à un deutéranope. C'est la prémisse du correctif,
    // et elle doit être prouvée, sinon on « répare » quelque chose qui allait bien.
    const ok = luminance(simule(OK_TINT, DEUTERANOPIE))
    const bad = luminance(simule(BAD_TINT, DEUTERANOPIE))
    expect(Math.max(ok, bad) / Math.min(ok, bad)).toBeLessThan(1.05)
  })

  /**
   * LE SEUIL, ET POURQUOI CELUI-LÀ. Ce n'est pas un contraste de TEXTE : les deux états ne
   * sont jamais à l'écran en même temps — le joueur voit UN fantôme, qui suit son curseur.
   * La tâche est donc de RECONNAISSANCE (« celui-ci est-il le refus ? »), pas de
   * discrimination côte à côte, et un rapport de 2,5 sur une grande surface se voit d'un
   * coup d'œil. On ne vise pas 3:1 en deutéranopie parce que l'atteindre exigerait une
   * opacité « oui » de 0,75 — le fantôme cesserait d'être un fantôme, et on aurait échangé
   * un défaut d'accessibilité contre un défaut de lisibilité du monde.
   */
  it('l’écart RÉEL — opacité comprise — porte le refus en deutéranopie', () => {
    const ok = poids(OK_TINT, GHOST_ALPHA_OK, DEUTERANOPIE)
    const bad = poids(BAD_TINT, GHOST_ALPHA_BAD, DEUTERANOPIE)
    expect(ok / bad).toBeGreaterThan(2.5)
  })

  it('et en protanopie, où la teinte aide un peu, il est plus franc encore', () => {
    const ok = poids(OK_TINT, GHOST_ALPHA_OK, PROTANOPIE)
    const bad = poids(BAD_TINT, GHOST_ALPHA_BAD, PROTANOPIE)
    expect(ok / bad).toBeGreaterThan(3)
  })

  it('en vision normale, les deux canaux s’AJOUTENT au lieu de se remplacer', () => {
    // On n'a pas déplacé le signal de la couleur vers l'opacité : on l'a doublé. Pour qui
    // voit les teintes, le vert et le rouge restent le signal principal, et l'opacité les
    // renforce — l'écart passe de 2,56 (teinte seule) à plus de 6.
    const ok = luminance(canaux(OK_TINT)) * GHOST_ALPHA_OK
    const bad = luminance(canaux(BAD_TINT)) * GHOST_ALPHA_BAD
    expect(ok / bad).toBeGreaterThan(6)
  })

  it('le refus est le plus EFFACÉ des deux — « ce n’est pas vraiment là »', () => {
    expect(GHOST_ALPHA_BAD).toBeLessThan(GHOST_ALPHA_OK)
  })

  it('et le fantôme reste un fantôme : jamais opaque, jamais invisible', () => {
    for (const a of [GHOST_ALPHA_OK, GHOST_ALPHA_BAD]) {
      expect(a).toBeGreaterThan(0.25)
      expect(a).toBeLessThan(0.8)
    }
  })
})

/**
 * LE FANTÔME NE MENT PLUS SUR L'AMÉLIORATION D'UN MUR (audit UX 2026-08-20, D5-R1).
 *
 * Deux mensonges, dans le même geste.
 *
 * ① **La couleur.** Le fantôme rougissait dès qu'une barrière existait sur l'arête visée —
 *    mais le résolveur de clic, lui, en fait un `upgrade_structure` : une action LÉGALE, et
 *    qui COÛTE. Le joueur voyait rouge, cliquait, et son inventaire se vidait. C'est le défaut
 *    du carré de village pris à l'envers, et il est pire dans ce sens : il fait PAYER.
 *
 * ② **L'étiquette.** Le menu du marteau a des onglets de matériau, donc on croit choisir la
 *    cible. La sim monte d'UN palier — c'est sa spec (R8, « palier de matériau SUIVANT »).
 *    Onglet MÉTAL sur un mur de bois : on obtient de la PIERRE, et rien ne le disait.
 *
 * On n'a pas touché à la règle : on a cessé de laisser croire autre chose. Ce test garde le
 * miroir — s'il dérive de la sim d'un cran, les deux mensonges reviennent.
 */
describe('ce qu’une amélioration de mur donnera vraiment', () => {
  it('bois → pierre, pierre → métal : le pas de UN, comme la sim', () => {
    expect(prochainPalier('wood')).toBe('stone')
    expect(prochainPalier('stone')).toBe('metal')
  })

  it('un mur SANS matériau écrit compte comme du bois — même défaut que la sim', () => {
    expect(prochainPalier(undefined)).toBe('stone')
  })

  it('AU DERNIER PALIER, plus rien : là, le rouge du fantôme redevient la vérité', () => {
    // C'est le seul cas où la sim refuse pour de bon (« palier de matériau maximal ») — et
    // donc le seul où l'arête doit rester comptée comme occupée.
    expect(prochainPalier('metal')).toBeUndefined()
  })

  it('et on ne promet RIEN sur un matériau inconnu', () => {
    // Un `material` inattendu (donnée corrompue, palier neuf pas encore câblé) ne doit pas
    // produire une promesse au hasard : mieux vaut se taire que mentir une troisième fois.
    expect(prochainPalier('adamantium')).toBeUndefined()
  })

  it('LE MIROIR EST COMPLET : chaque palier de la table a une suite, sauf le dernier', () => {
    // Balayage du domaine plutôt que trois cas choisis — si la table gagne un palier, ce test
    // le couvre sans qu'on y pense.
    for (let i = 0; i < WALL_MATERIAL_ORDER.length - 1; i++) {
      expect(prochainPalier(WALL_MATERIAL_ORDER[i]), WALL_MATERIAL_ORDER[i]).toBe(WALL_MATERIAL_ORDER[i + 1])
    }
    expect(prochainPalier(WALL_MATERIAL_ORDER[WALL_MATERIAL_ORDER.length - 1])).toBeUndefined()
  })
})
