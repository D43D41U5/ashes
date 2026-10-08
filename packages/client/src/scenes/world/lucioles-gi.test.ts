/**
 * ═══ LES LUCIOLES DANS LE CHAMP DE LA GI — LG-R20, correction du 2026-10-06 ═══
 *
 * *« Btw les lucioles ne sont pas en gi, corrige ça »* (Alexis). C'était vrai à la lettre : un
 * essaim n'éclairait les corps que par son POINT LIGHT, c'est-à-dire par la pipeline que la GI a
 * remplacée pour toutes les autres sources. Light2D n'atteint que ce qui porte une carte de
 * normales ; un ACTEUR, lui, lit le CHAMP sous ses pieds (branche E). Sous la GI, les lucioles
 * étaient donc la seule lumière du jeu à ne pas atteindre un corps.
 *
 * ⚠ **CE QUE CES GARDES ÉPROUVENT, ET POURQUOI C'EST LA TEINTE QUI PORTE LE RISQUE.** La panne
 * naturelle de ce branchement ne lève rien et ne change aucun type : `rgb` se perd quelque part
 * entre l'essaim et le champ, le `?? GI.TEINTE_FEU` reprend la main, et le sous-bois se met à
 * briller en AMBRE. Un essaim ambre a l'air d'un rendu qui marche. Toute la chaîne de la couleur
 * est donc éprouvée PAR SES VRAIES FONCTIONS — `sourceDuChamp` et `teinteDeLaSource` ont été
 * extraites pour ça — et non par une copie recopiée dans le test, qui n'éprouverait que la copie.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LUMIERE } from '@ashes/sim'
import { champRef, type GrilleGi } from '../../render/gi/champ-ref'
import { GI, profilFeu } from '../../render/gi/reglages'
import { TILE_PX } from '../../render/framing'
import { sourceDuChamp, teinteDeLaSource } from '../../render/gi/source-du-champ'
import { FIREFLY_GI_FORCE, FIREFLY_GI_TINT } from '../../render/lucioles-gi'

const lire = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')
const luminance = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('LES LUCIOLES ÉCLAIRENT DANS LE CHAMP (LG-R20)', () => {
  it('① la teinte de l’essaim est VERTE et pèse exactement une teinte de flamme', () => {
    const [r, v, b] = FIREFLY_GI_TINT
    // VERTE, et dans l'ordre de la luciole : le vert domine, le bleu est pauvre (c'est lui qui
    // délaverait un sol en additif — la leçon de la flaque ambre, reprise telle quelle).
    expect(v).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
    // …ET DU POIDS D'UNE FLAMME. Sans cette normalisation, « force 1 » voudrait dire deux choses
    // différentes selon la source, puisque le champ multiplie la teinte PAR la force — et toute
    // comparaison d'amplitude entre un essaim et un Feu deviendrait fausse en silence.
    expect(luminance(FIREFLY_GI_TINT)).toBeCloseTo(luminance(GI.TEINTE_FEU), 12)
    // La parité d'amplitude est un 1 DÉRIVÉ (« l'essaim éclaire ses alentours comme un Feu de
    // camp éclaire les siens », 2026-08-26), pas un réglage posé à la main.
    expect(FIREFLY_GI_FORCE).toBe(1)
  })

  it('② la teinte TRAVERSE la conversion du voile vers le champ — et un feu garde la sienne', () => {
    const essaim = { worldX: 320, yLogique: 640, radiusTiles: 8.16, forceGi: 0.5, niveau: 2, rgb: FIREFLY_GI_TINT }
    const src = sourceDuChamp(essaim)
    // LE VRAI CHEMIN, de bout en bout : la conversion porte `rgb`, et le champ le relit.
    expect(teinteDeLaSource(src)).toEqual(FIREFLY_GI_TINT)
    // …à sa place LOGIQUE, jamais dessinée (LG-R14) : c'est `yLogique` qui sort, pas un `worldY`.
    expect(src.worldY).toBe(640)
    // …et avec la force DU CHAMP, pas celle du voile.
    expect(src.force).toBe(0.5)
    expect(src.palier).toBe(2)
    // LE CONTRÔLE NÉGATIF, sans quoi la clause du dessus serait vraie d'un `?? ` toujours pris :
    // une flamme n'a pas de `rgb`, et c'est la teinte du feu qui lui revient.
    const feu = sourceDuChamp({ worldX: 0, yLogique: 0, radiusTiles: 3, forceGi: 1, niveau: 0 })
    expect(feu.rgb).toBeUndefined()
    expect(teinteDeLaSource(feu)).toEqual(GI.TEINTE_FEU)
  })

  it('③ le champ dépose bien du VERT sous un essaim — mesuré sur l’oracle, par la vraie conversion', () => {
    // La grille nue de l'oracle (le même montage que les gardes de la braise) : 65² texels, rien
    // d'opaque, source au centre. On n'éprouve pas une constante, on éprouve ce que le champ REND.
    const T = LUMIERE.TEXELS_PAR_TUILE
    const PX_PAR_TEXEL = TILE_PX / T
    const G = 65
    const CENTRE = (G - 1) / 2 + 0.5
    const grille: GrilleGi = { gw: G, gh: G, occ: new Uint8Array(G * G), murs: [], albedo: new Float32Array(G * G * 3), albedoMurs: [] }

    /** Le champ au centre, pour une source convertie PAR `sourceDuChamp` — teinte comprise. */
    const auCentre = (rgb?: readonly [number, number, number]): readonly [number, number, number] => {
      const src = sourceDuChamp({ worldX: 0, yLogique: 0, radiusTiles: 8.16, forceGi: 0.8, niveau: 0, ...(rgb ? { rgb } : {}) })
      const teinte = teinteDeLaSource(src)
      const e = {
        x: CENTRE,
        y: CENTRE,
        rayon: (src.radiusTiles * TILE_PX) / PX_PAR_TEXEL,
        taille: GI.TAILLE_SOURCE,
        // ⚠ LA MÊME EXPRESSION QUE `champ-gpu` : la teinte DÉJÀ multipliée par la force.
        rgb: [teinte[0] * src.force, teinte[1] * src.force, teinte[2] * src.force] as const,
      }
      const o = champRef(grille, [e], { rebond: GI.REBOND, porteeRebond: GI.PORTEE_REBOND, plafondRebond: GI.PLAFOND_REBOND, profil: profilFeu })
      const k = (Math.round(CENTRE - 0.5) * G + Math.round(CENTRE - 0.5)) * 3
      return [o.light[k]!, o.light[k + 1]!, o.light[k + 2]!]
    }

    const [r, v, b] = auCentre(FIREFLY_GI_TINT)
    expect(v).toBeGreaterThan(0)
    // ON EST DANS LE VERT : c'est la clause qui rougit si `rgb` se perd en chemin.
    expect(v).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
    // …et le contrôle : la MÊME source sans teinte ressort AMBRE (R > V), c'est-à-dire exactement
    // ce qu'on verrait à l'écran si la plomberie lâchait. L'écart n'est donc pas une tautologie.
    const [rf, vf] = auCentre(undefined)
    expect(rf).toBeGreaterThan(vf)
  })

  it('④ un essaim N’OUVRE PAS le voile, et son point light s’éteint quand le champ compose (garde de SOURCE)', () => {
    // ⚠ GARDE DE SOURCE, et elle est nécessaire : ces deux lignes vivent dans `WorldScene.update`
    // et dans une boucle Phaser, deux endroits qu'aucun test headless n'atteint. Elles encodent
    // pourtant deux décisions, et leur perte serait SILENCIEUSE (une nuit trouée, un fût éclairé
    // deux fois) — la classe de défaut que les gardes de source de `braise-halo` existent pour
    // attraper.
    const ws = lire('../WorldScene.ts')
    const al = lire('./ambient-life.ts')

    // ① LE VOILE RESTE INTACT (décision du 2026-08-26 : « le Feu creuse le voile, un essaim non »).
    const bloc = ws.slice(ws.indexOf('LES ESSAIMS DE LUCIOLES'), ws.indexOf('LES TORCHES (spec `torche.md`)'))
    expect(bloc).toContain('sourcesGi()')
    expect(bloc).toContain('force: 0,')
    expect(bloc).toContain('forceGi: e.force,')
    expect(bloc).toContain('rgb: e.rgb,')
    // …et le PALIER se lit comme celui d'un Feu, jamais la strate de DESSIN.
    // ⚠ La clause négative porte sur le CODE et non sur le bloc entier : ma première version
    // rougissait sur mon propre commentaire, qui explique justement pourquoi ce n'est pas la
    // strate — une garde de source qui lit ses propres commentaires ne lit pas le code.
    const code = bloc
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    expect(code).toContain('palierDuSol(')
    expect(code).not.toContain('strate')

    // ② LE POINT LIGHT S'ÉTEINT SOUS LA GI — sinon tout ce qui a une carte de normales près d'un
    // essaim serait éclairé deux fois, par Light2D ET par le champ.
    expect(al).toContain('s.light.intensity = lit && !composeGi ? FIREFLY_LIGHT_INTENSITY * s.eclat : 0')
    // ③ UNE enveloppe pour les trois lecteurs : la source du champ, le point light et la flaque.
    expect(al).toContain('s.eclat = nuit * souffle * fondu')
    expect(al).toContain('FIREFLY_POOL_ALPHA * s.eclat')
    expect(al).toContain('force: FIREFLY_GI_FORCE * s.eclat')
    // ④ …et la source part à sa place LOGIQUE : le `lift` est du dessin, le champ ne le voit pas.
    const sources = al
      // ⚠ Le corps de la MÉTHODE, pas « jusqu'à la méthode suivante » : `updateFireflies` vit
      // 300 lignes plus bas et la tranche ramassait tout ce qu'il y a entre les deux, `lift`
      // compris — c'est le trou que ma garde de la barre de crans avait déjà eu le 2026-10-04.
      .slice(al.indexOf('sourcesGi(): SourceEssaim[]'))
      .split('\n  }')[0]!
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n')
    expect(sources).toContain('worldY: s.y * TILE_PX,')
    expect(sources).not.toContain('lift')
  })
})
