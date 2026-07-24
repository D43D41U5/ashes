/**
 * LA DÉRIVE DE PALETTE — le garde-fou qui la rend visible AVANT qu'elle s'installe.
 *
 * L'interface porte ~250 valeurs hexadécimales écrites en dur. Les remplacer toutes d'un coup
 * serait un chantier long, risqué et sans bénéfice immédiat : beaucoup sont des nuances locales
 * parfaitement légitimes (l'ombre d'un bouton, un cadre de vignette) qu'aucun jeton ne mérite.
 *
 * Ce qui NUIT vraiment, ce n'est pas la valeur en dur — c'est la valeur en dur **PARTAGÉE** :
 * une teinte que plusieurs écrans emploient est un jeton qui s'ignore, et une valeur anonyme
 * dérive au premier réglage. C'est exactement ce qui s'est produit : deux ambres et trois rouges
 * ont divergé sans que personne le voie, et `#f2ead0` vivait dans SEPT fichiers sans nom.
 *
 * La règle est donc celle du MÉRITE : au-delà de `SEUIL_PARTAGE` fichiers, une teinte a gagné
 * son nom et doit rejoindre la palette. En deçà, elle reste une nuance locale et on lui fiche
 * la paix. Le garde-fou coûte zéro refactor et attrape la dérive là où elle fait mal.
 */
import { describe, expect, it } from 'vitest'
import { HEX } from './palette'

const SOURCES = import.meta.glob('../../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** Au-delà de ce nombre de fichiers, une teinte n'est plus une nuance locale : c'est un jeton. */
const SEUIL_PARTAGE = 3

describe('la palette', () => {
  it('toute teinte partagée par plusieurs écrans porte un NOM', () => {
    // Le garde-fou doit d'abord VOIR : un glob vide passerait au vert sans rien vérifier.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20)

    const connues = new Set(Object.values(HEX).map((v) => v.toLowerCase()))
    const parTeinte = new Map<string, Set<string>>()
    for (const [chemin, source] of Object.entries(SOURCES)) {
      if (chemin.endsWith('palette.ts') || chemin.endsWith('.test.ts')) continue
      for (const m of source.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const teinte = `#${m[1]!.toLowerCase()}`
        if (connues.has(teinte)) continue // déjà nommée : rien à dire
        const vus = parTeinte.get(teinte) ?? new Set<string>()
        vus.add(chemin)
        parTeinte.set(teinte, vus)
      }
    }

    const anonymesPartagees = [...parTeinte.entries()]
      .filter(([, fichiers]) => fichiers.size >= SEUIL_PARTAGE)
      .map(([teinte, fichiers]) => `${teinte} (${fichiers.size} fichiers)`)
      .sort()

    // Une teinte ici est employée par au moins trois écrans sans porter de nom : elle
    // dérivera. La corriger, c'est l'ajouter à `HEX` et l'y référencer.
    expect(anonymesPartagees).toEqual([])
  })

  it('les quatre encres restent ordonnées du plus fort au plus discret', () => {
    // La hiérarchie d'encre est le seul contrat que la palette doit à l'oeil : si `faint`
    // rattrapait `dim`, on aurait quatre rangs pour trois valeurs perceptibles.
    const luminance = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16)
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    expect(luminance(HEX.title)).toBeGreaterThan(luminance(HEX.bodyBright))
    expect(luminance(HEX.bodyBright)).toBeGreaterThan(luminance(HEX.body))
    expect(luminance(HEX.body)).toBeGreaterThan(luminance(HEX.dim))
    expect(luminance(HEX.dim)).toBeGreaterThan(luminance(HEX.faint))
  })

  it('l’encre la plus discrète reste LISIBLE : `faint` passe le contraste AA', () => {
    // Elle ne le passait pas (3,52:1 sur le voile, 3,19:1 sur un panneau, pour 4,5 exigés) —
    // et ça s'est payé : l'indicateur de sauvegarde a dû fuir cette teinte parce qu'il était
    // illisible sur un sol clair. Un rang d'encre discret n'est pas un rang d'encre invisible.
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16)
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    const contraste = (a: string, b: string): number => {
      const x = lum(a)
      const y = lum(b)
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    for (const fond of [HEX.bgWarm, HEX.panel, HEX.bg]) {
      expect(contraste(HEX.faint, fond), `faint sur ${fond}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
