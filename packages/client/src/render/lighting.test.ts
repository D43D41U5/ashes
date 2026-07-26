import { describe, expect, it } from 'vitest'
import {
  ambientTint,
  brumeDuMatin,
  daylight,
  fireGlow,
  frontDeBrume,
  warmthColor,
  FRONT_BRUME_MAX_TILES,
  NIGHT_ALPHA_MAX,
} from './lighting'

/** Les sources du rendu, pour le garde-fou de CÂBLAGE du blend (voir le dernier banc). */
const SOURCES = import.meta.glob('../scenes/world/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const r = (c: number): number => (c >> 16) & 0xff
const b = (c: number): number => c & 0xff

describe('warmthColor (convention Feu existante)', () => {
  it('warmth positif → bleu (Foyer)', () => {
    const c = warmthColor(80)
    expect(b(c)).toBeGreaterThan(r(c))
  })
  it('warmth négatif → rouge (Meute)', () => {
    const c = warmthColor(-80)
    expect(r(c)).toBeGreaterThan(b(c))
  })
  it('warmth nul → blanc', () => {
    expect(warmthColor(0)).toBe(0xffffff)
  })
})

describe('daylight (facteur de lumière du jour)', () => {
  it('borné dans [0,1]', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = daylight(h)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
  it('≈ 0 à minuit, ≈ 1 à midi', () => {
    expect(daylight(0)).toBeCloseTo(0, 5)
    expect(daylight(12)).toBeCloseTo(1, 5)
  })
  it('croît (au sens large) de minuit vers midi', () => {
    let prev = -1
    for (const h of [0, 3, 6, 9, 12]) {
      const d = daylight(h)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })
})

describe('ambientTint (teinte selon l\'heure)', () => {
  it('midi : aucune teinte (alpha ≈ 0)', () => {
    expect(ambientTint(12).alpha).toBeCloseTo(0, 2)
  })
  it('nuit profonde : alpha au plafond, couleur bleue froide', () => {
    const t = ambientTint(0)
    expect(t.alpha).toBeCloseTo(NIGHT_ALPHA_MAX, 5)
    expect(t.color & 0xff).toBeGreaterThan((t.color >> 16) & 0xff) // bleu > rouge
  })
  it('alpha ne dépasse jamais le plafond de nuit', () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(ambientTint(h).alpha).toBeLessThanOrEqual(NIGHT_ALPHA_MAX + 1e-9)
    }
  })
  it('aube (6 h) et crépuscule (20 h) : teinte chaude, alpha intermédiaire', () => {
    for (const h of [6, 20]) {
      const t = ambientTint(h)
      expect((t.color >> 16) & 0xff).toBeGreaterThan(t.color & 0xff) // rouge > bleu (chaud)
      expect(t.alpha).toBeGreaterThan(0)
      expect(t.alpha).toBeLessThan(NIGHT_ALPHA_MAX)
    }
  })
})

describe('fireGlow (halo des Feux)', () => {
  it("brille la nuit, s'éteint à midi", () => {
    const night = fireGlow(0, daylight(0))
    const noon = fireGlow(0, daylight(12))
    expect(night.alpha).toBeGreaterThan(noon.alpha)
    expect(noon.alpha).toBeCloseTo(0, 5)
  })
  it('couleur = alignement (Foyer bleu, Meute rouge)', () => {
    const foyer = fireGlow(80, daylight(0)).color
    const meute = fireGlow(-80, daylight(0)).color
    expect(foyer & 0xff).toBeGreaterThan((foyer >> 16) & 0xff) // bleu > rouge
    expect((meute >> 16) & 0xff).toBeGreaterThan(meute & 0xff) // rouge > bleu
  })
  it('un Feu plus engagé rayonne plus loin', () => {
    expect(fireGlow(90, daylight(0)).radius).toBeGreaterThan(fireGlow(10, daylight(0)).radius)
  })
})

/**
 * L'ÉTALONNAGE — « la brume s'AJOUTE, la lumière se MULTIPLIE ».
 *
 * Ce banc ne teste pas du code : il teste une DÉCISION DE RENDU, celle du blend. Les deux
 * opérations sont donc écrites ici telles que la carte graphique les calcule, et on montre
 * NOIR SUR BLANC ce que chacune fait au contraste — parce que c'était invisible à l'œil et que
 * ça expliquait le seul vrai défaut de lisibilité du jeu (« le voile écrase le contraste de
 * tout, y compris de l'avatar », note du Névé).
 *
 * Ces bancs prouvent le MODÈLE. Le dernier, lui, vérifie le CÂBLAGE — sans quoi on aurait la
 * démonstration sans la garantie qu'elle s'applique au jeu.
 */
describe("l'étalonnage : la lumière MULTIPLIE, elle ne se mélange pas", () => {
  /** Blend NORMAL (l'ancien voile) : `sortie = source·(1-α) + teinte·α`. Par canal. */
  const melange = (src: number, tint: { color: number; alpha: number }, c: number): number => {
    const s = (src >> c) & 0xff
    const t = (tint.color >> c) & 0xff
    return s * (1 - tint.alpha) + t * tint.alpha
  }
  /** Blend MULTIPLY (le voile actuel) : `sortie = source · ((1-α) + α·teinte/255)`. Par canal.
   *  C'est l'équation de `gl.blendFunc(DST_COLOR, ONE_MINUS_SRC_ALPHA)` avec une source
   *  prémultipliée — Phaser ne fait rien d'autre, on n'a aucun calcul à écrire côté CPU. */
  const multiplie = (src: number, tint: { color: number; alpha: number }, c: number): number => {
    const s = (src >> c) & 0xff
    const t = (tint.color >> c) & 0xff
    return s * (1 - tint.alpha + (tint.alpha * t) / 255)
  }

  // Décalages d'octet dans `0xRRGGBB` — nommés, parce que le rouge est le poids FORT.
  const ROUGE = 16
  const VERT = 8 // canal dominant de la luminance perçue : celui qui porte le contraste
  const BLEU = 0
  const nuit = ambientTint(0)

  it('MINUIT : le contraste de Weber de l’avatar traverse la nuit INTACT', () => {
    // Un acteur sur son sol. Weber = |acteur - sol| / sol : ce qui décide qu'on le VOIT.
    const sol = 0x6a7a52 // une herbe
    const acteur = 0xb08040 // un avatar
    const weber = (a: number, b: number): number => Math.abs(a - b) / b

    const avant = weber((acteur >> 8) & 0xff, (sol >> 8) & 0xff)
    const apresMultiply = weber(multiplie(acteur, nuit, VERT), multiplie(sol, nuit, VERT))
    const apresMelange = weber(melange(acteur, nuit, VERT), melange(sol, nuit, VERT))

    // Le multiply est un GAIN : il divise numérateur ET dénominateur par le même facteur, donc
    // le rapport ne bouge pas d'un chouïa. Ce n'est pas « mieux réglé », c'est INVARIANT.
    expect(apresMultiply).toBeCloseTo(avant, 10)
    // Le mélange, lui, en mange un quart (mesuré : 0,0368 contre 0,0492, soit 75 % de l'original)
    // — et c'est le cas FAVORABLE, la nuit étant sombre. Plus la teinte du voile est CLAIRE, plus
    // son plancher additif pèse : c'est pourquoi l'avatar disparaissait sur le Névé.
    expect(apresMelange).toBeLessThan(avant * 0.8)
  })

  it('MINUIT : un noir reste NOIR — le mélange lui posait un plancher', () => {
    for (const c of [ROUGE, VERT, BLEU]) {
      expect(multiplie(0x000000, nuit, c)).toBeCloseTo(0, 10)
    }
    // L'ancien voile relevait le noir absolu à un bleu nuit franc : plus rien dans le jeu ne
    // pouvait être plus sombre que ça, et toute la plage se tassait au-dessus.
    expect(melange(0x000000, nuit, BLEU)).toBeGreaterThan(20)
  })

  it('MIDI : le multiply est l’IDENTITÉ EXACTE — le plein jour n’est pas étalonné', () => {
    const midi = ambientTint(12)
    for (const src of [0x000000, 0x6a7a52, 0xb08040, 0xffffff]) {
      for (const c of [ROUGE, VERT, BLEU]) {
        expect(multiplie(src, midi, c)).toBeCloseTo((src >> c) & 0xff, 6)
      }
    }
  })

  it('la nuit garde sa FROIDEUR : le multiplicateur laisse passer plus de bleu que de rouge', () => {
    // Le multiply supprime le terme additif d'où venait la moitié du bleu : sans rehausser
    // NIGHT_COLOR, la nuit virait au gris. Le contrat, c'est que la nuit reste BLEUE.
    const gris = 0x808080
    expect(multiplie(gris, nuit, BLEU)).toBeGreaterThan(multiplie(gris, nuit, ROUGE) * 1.5)
  })

  it('le voile de l’heure est CÂBLÉ en MULTIPLY — la démonstration ci-dessus s’applique au jeu', () => {
    // Les bancs précédents prouvent une ÉQUATION ; celui-ci prouve qu'on l'a bien branchée. Sans
    // lui, retirer le `setBlendMode` laisserait toute la suite au vert avec un jeu redevenu délavé.
    // (Instancier `NightVeil` demanderait un Phaser complet : on lit la source, comme le garde-fou
    // de palette et celui des CSS en template literal.)
    const veil = SOURCES['../scenes/world/night-veil.ts']
    expect(veil, 'night-veil.ts introuvable — le garde-fou ne garde plus rien').toBeTruthy()
    expect(veil).toContain('Phaser.BlendModes.MULTIPLY')
  })

  it('l’HEURE DORÉE ne teinte plus que ce qu’elle ÉCLAIRE : les ombres restent neutres', () => {
    const doree = ambientTint(20)
    const ombre = 0x0a0a0a // un creux d'ombre, presque noir
    const chaleur = (f: typeof melange): number => f(ombre, doree, ROUGE) - f(ombre, doree, BLEU)
    // Sous le mélange, l'ombre virait à l'orange comme le reste — le filtre posé sur l'objectif.
    expect(chaleur(melange)).toBeGreaterThan(40)
    // Sous le multiply, le virage est PROPORTIONNEL à la lumière reçue : une ombre n'en reçoit
    // presque pas, elle ne vire donc presque pas. Mesuré : 25 fois moins que le mélange.
    expect(chaleur(multiplie)).toBeLessThan(chaleur(melange) / 20)
  })
})

describe('la brume du matin (da-feeling R14) — un événement, pas un état', () => {
  it('dort la nuit et le jour : zéro avant 4h30, zéro après 8h30, zéro à midi et minuit', () => {
    for (const h of [0, 2, 4.5, 8.75, 12, 18, 23.9]) {
      expect(brumeDuMatin(h), `à ${h}h`).toBe(0)
    }
  })

  it('est pleine quand le jour point (5h30-6h30), et sur une PENTE CONTINUE de part et d’autre', () => {
    expect(brumeDuMatin(5.5)).toBe(1)
    expect(brumeDuMatin(6.5)).toBe(1)
    // La montée et la dissolution sont continues : chaque pas d'un quart d'heure borne le saut.
    for (let h = 4; h < 9.5; h += 0.25) {
      const saut = Math.abs(brumeDuMatin(h + 0.25) - brumeDuMatin(h))
      expect(saut, `saut à ${h}h`).toBeLessThanOrEqual(0.26)
    }
    // Strictement croissante dans la levée, strictement décroissante dans la dissolution.
    expect(brumeDuMatin(5)).toBeGreaterThan(brumeDuMatin(4.6))
    expect(brumeDuMatin(7.5)).toBeGreaterThan(brumeDuMatin(8.2))
  })
})

describe('le front de la marée (brume V1, décision du 2026-07-26) — il monte de l’eau, le soleil le repousse', () => {
  it('dort hors fenêtre : zéro tuile avant 4h30, après 8h30, à midi et minuit', () => {
    for (const h of [0, 3, 4.5, 8.5, 12, 20, 23.9]) {
      expect(frontDeBrume(h), `à ${h}h`).toBe(0)
    }
  })

  it('culmine à FRONT_BRUME_MAX_TILES sur l’étale (6h-6h48)', () => {
    expect(frontDeBrume(6)).toBeCloseTo(FRONT_BRUME_MAX_TILES, 9)
    expect(frontDeBrume(6.4)).toBeCloseTo(FRONT_BRUME_MAX_TILES, 9)
    expect(frontDeBrume(6.8)).toBeCloseTo(FRONT_BRUME_MAX_TILES, 9)
  })

  it('monte et recule en PENTE CONTINUE — jamais un saut de plus d’un quart d’heure de marche', () => {
    for (let h = 4; h < 9.5; h += 0.25) {
      const saut = Math.abs(frontDeBrume(h + 0.25) - frontDeBrume(h))
      expect(saut, `saut à ${h}h`).toBeLessThanOrEqual(FRONT_BRUME_MAX_TILES / 4)
    }
    // La montée est plus vive que le retrait (1h30 contre 1h42) — et chacune strictement monotone.
    expect(frontDeBrume(5.2)).toBeGreaterThan(frontDeBrume(4.8))
    expect(frontDeBrume(7.2)).toBeGreaterThan(frontDeBrume(8))
  })

  it('recule VERS l’eau : à 7h36 le front est plus près de la berge qu’à l’étale', () => {
    const retrait = frontDeBrume(7.6)
    expect(retrait).toBeGreaterThan(0)
    expect(retrait).toBeLessThan(frontDeBrume(6.8) * 0.65)
  })
})
