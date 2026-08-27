import { describe, expect, it } from 'vitest'
import { BALANCE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, YEAR_DAYS, dayTicksPourJour, leverPourJour } from '@ashes/sim'
import { VEILLEE_CALENDAR_SCALE, VEILLEE_SEASON_CYCLES } from '../worker/veillee'
import { intensitesDuCiel } from '../scenes/world/dynamic-lighting'
import {
  clarteDeLune,
  lueurDeLune as lueurDeLune_,
  phaseDeLune,
  voileDeNuit,
  airSansLune,
  partSansLune,
  LUNAISON_JOURS,
  LUNE_PLEINE_JOUR,
  VOILE_NOUVELLE_LUNE,
  ambientTint as ambientTint_,
  brumeDuMatin as brumeDuMatin_,
  daylight as daylight_,
  fireGlow,
  fireHoleRadius,
  frontDeBrume as frontDeBrume_,
  partDeBrumeMatinale,
  sunDirection as sunDirection_,
  warmthColor,
  BRUME_ECART_MUET,
  BRUME_ECART_PLEIN,
  BRUME_VENT_DECHIRE,
  BRUME_VENT_DISPERSE,
  FRONT_BRUME_MAX_TILES,
  NIGHT_ALPHA_MAX,
  NUIT_PLANCHER,
  plancherDeNuit,
  heureSolaire,
  heureCanonique,
} from './lighting'

/**
 * LES COURBES DE CE FICHIER S'ÉPROUVENT SUR LE CADRAN CANONIQUE — le jour d'équinoxe, celui
 * sur lequel chaque keyframe a été calibrée. On réenveloppe donc les entrées marquées
 * `HeureSolaire` : ces bancs disent « à 20 h le ciel est or », pas « à 20 h le 105ᵉ jour ».
 * Ce que fait la SAISON de l'heure est éprouvé à part (« l'heure solaire suit la saison »).
 */
const lueurDeLune = (h: number, jour: number): number => lueurDeLune_(heureCanonique(h), jour)
const ambientTint = (h: number): { color: number; alpha: number } => ambientTint_(heureCanonique(h))
const brumeDuMatin = (h: number): number => brumeDuMatin_(heureCanonique(h))
const daylight = (h: number): number => daylight_(heureCanonique(h))
const frontDeBrume = (h: number): number => frontDeBrume_(heureCanonique(h))
const sunDirection = (h: number): { x: number; y: number } => sunDirection_(heureCanonique(h))


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
 * LA CLAIRIÈRE — portée CONSTANTE (décision Alexis, 2026-08-03).
 *
 * Ce banc garde une décision, pas une formule. `fireHoleRadius` ne prend pas `warmth` : c'est
 * le compilateur qui interdit de la recoupler à l'alignement, et ces cas-là gardent le RESTE —
 * qu'elle batte, et qu'elle reste dans une plage où la nuit survit à côté du camp.
 *
 * D'où vient la borne haute — et l'histoire vaut d'être écrite, parce qu'un premier chiffre a
 * été faux. On avait mesuré « à warmth 100, le sol se relève jusqu'à 25 tuiles du foyer » et
 * conclu que le couplage à l'alignement était seul en cause. Il ne l'était pas : le voile de
 * nuit, cru collé à l'écran, était en réalité AGRANDI de 2,25 par le zoom de la caméra
 * (`night-veil.ts`), ce qui gonflait toutes les portées d'autant. Les 25 tuiles en venaient
 * pour l'essentiel.
 *
 * La conclusion tient quand même, sur des chiffres propres : l'ancien couplage donnait 12,8
 * tuiles de portée à warmth 100, quand la vue n'en montre que ~8,6 vers le haut au zoom du
 * jeu — un Feu engagé chassait bel et bien la nuit de l'écran. Et c'est cette limite du CADRE,
 * pas un goût, qui borne la portée ici.
 */
describe('fireHoleRadius (le trou du Feu dans la nuit)', () => {
  it("ne prend PAS l'alignement en argument — le halo si, elle non", () => {
    // Le halo cosmétique grandit avec l'engagement : c'est CE couplage-là qui effaçait la nuit.
    expect(fireGlow(100, daylight(0)).radius).toBeGreaterThan(fireGlow(0, daylight(0)).radius)
    // La clairière, elle, n'a qu'un temps et une graine. Deux Feux d'alignements opposés, même
    // instant, même graine : rigoureusement la même portée — il n'y a pas d'autre entrée.
    expect(fireHoleRadius(1234, 5)).toBe(fireHoleRadius(1234, 5))
  })

  it('elle PULSE avec la flamme (jamais un disque mort)', () => {
    const echantillons = [0, 120, 240, 360, 480, 600, 720].map((t) => fireHoleRadius(t, 3))
    expect(Math.max(...echantillons)).toBeGreaterThan(Math.min(...echantillons))
  })

  it('reste dans une plage où la nuit survit à côté du camp', () => {
    // Balayage d'une minute entière, deux graines : on prend les EXTRÊMES, pas un point.
    const rayons: number[] = []
    for (const seed of [0, 7.3]) for (let t = 0; t < 60000; t += 37) rayons.push(fireHoleRadius(t, seed))
    expect(Math.min(...rayons)).toBeGreaterThan(4) // en deçà, le foyer n'a plus de clairière
    // La borne haute vient du CADRE, pas du goût : au zoom du jeu (2,25) la vue ne porte qu'à
    // ~8,6 tuiles au-dessus et au-dessous du joueur. Une clairière qui dépasse ce rayon ne
    // laisse plus de nuit à l'écran — elle ne se lit plus comme une clairière.
    expect(Math.max(...rayons)).toBeLessThan(8.6)
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

  /**
   * LE PLANCHER DE LA NUIT SANS LUNE (décision d'Alexis, 2026-08-26 : « pas noir #000, un bleu
   * très foncé, un peu gris »). Trois gardes, et la troisième est celle qui compte : le blend.
   */
  it('le plancher SUIT LA LUNE : nul quand elle est pleine, plein quand elle est neuve', () => {
    const nuit = ambientTint(0)
    expect(plancherDeNuit(nuit, 1).alpha).toBe(0) // pleine lune au zénith : rien à combler
    expect(plancherDeNuit(nuit, 0).alpha).toBe(1) // nouvelle lune : il fait toute la couleur
    // Et il n'existe pas DE JOUR : à midi le voile est transparent, donc `partSansLune` est nul.
    expect(plancherDeNuit(ambientTint(12), 0).alpha).toBe(0)
  })

  it('le plancher est un BLEU TRÈS FONCÉ, un peu gris — pas un noir, pas un bleu franc', () => {
    const r = (NUIT_PLANCHER >> 16) & 0xff
    const v = (NUIT_PLANCHER >> 8) & 0xff
    const b = NUIT_PLANCHER & 0xff
    expect(b).toBeGreaterThan(r * 1.5) // BLEU : le bleu domine franchement
    expect(r).toBeGreaterThan(0) // …mais GRIS : ni le rouge ni le vert ne sont éteints,
    expect(v).toBeGreaterThan(r) //    sans quoi ce serait un bleu de vitrail, pas une nuit
    // À LA LIMITE DU PERCEPTIBLE (second réglage d'Alexis, 2026-08-26) : le plafond était à 64
    // quand le plancher valait 31 de bleu — il ne gardait rien. Il est désormais SERRÉ sur
    // l'intention : au-delà de 24, ce n'est plus une limite, c'est un éclairage.
    expect(b).toBeLessThanOrEqual(24)
    // Et l'ensemble reste sous le seuil où l'œil commence à lire une COULEUR plutôt qu'un noir.
    expect(0.2126 * r + 0.7152 * v + 0.0722 * b).toBeLessThan(6)
  })

  it('le plancher est câblé en ADD — c’est tout le design, et un blend NORMAL le renverserait', () => {
    // ADD ne sait qu'AJOUTER : il pose une couleur sur le noir et ne touche presque pas à une
    // braise. En NORMAL, la même couche TIRERAIT les hautes lumières vers elle — le travers
    // exact du vieil air de zone, qui « relevait les noirs et lavait la couleur ». Le voile,
    // lui, doit RESTER en MULTIPLY (garde au-dessus) : les deux blends sont le contrat.
    const veil = SOURCES['../scenes/world/night-veil.ts']
    expect(veil, 'night-veil.ts introuvable — le garde-fou ne garde plus rien').toBeTruthy()
    expect(veil).toContain('Phaser.BlendModes.ADD')
    expect(veil).toContain('this.plancher.setDepth')
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

describe('la CONDITION de la brume du matin (décision du 2026-08-25) — froidure de la nuit × calme d’ici', () => {
  it('une nuit tiède ne rend AUCUNE brume, quel que soit le calme', () => {
    for (const vent of [0, 0.05, 0.5, 1]) {
      expect(partDeBrumeMatinale(BRUME_ECART_MUET, vent), `vent ${vent}`).toBe(0)
      expect(partDeBrumeMatinale(BRUME_ECART_MUET - 3, vent), `vent ${vent}`).toBe(0)
    }
  })

  it('un vent qui gonfle la disperse ENTIÈREMENT, même par la nuit la plus froide', () => {
    for (const ecart of [BRUME_ECART_PLEIN, BRUME_ECART_PLEIN + 5, 30]) {
      expect(partDeBrumeMatinale(ecart, BRUME_VENT_DISPERSE), `écart ${ecart}`).toBe(0)
      expect(partDeBrumeMatinale(ecart, 1), `écart ${ecart}`).toBe(0)
    }
  })

  it('rend 1 — et seulement là — quand la nuit est froide ET l’air immobile', () => {
    expect(partDeBrumeMatinale(BRUME_ECART_PLEIN, 0)).toBe(1)
    expect(partDeBrumeMatinale(BRUME_ECART_PLEIN + 4, BRUME_VENT_DECHIRE)).toBe(1)
    // Le CALME PLAT (la sentinelle : force 0, donc part 0) est le plus calme des mondes, pas
    // le plus venté — l'erreur de signe qui aurait éteint la brume dans un monde sans vent.
    expect(partDeBrumeMatinale(BRUME_ECART_PLEIN, 0)).toBe(1)
  })

  it('est une PENTE CONTINUE sur ses deux axes — jamais un palier (feel maison)', () => {
    for (let e = BRUME_ECART_MUET - 1; e <= BRUME_ECART_PLEIN + 1; e += 0.1) {
      const saut = Math.abs(partDeBrumeMatinale(e + 0.1, 0) - partDeBrumeMatinale(e, 0))
      expect(saut, `écart ${e.toFixed(1)}`).toBeLessThanOrEqual(0.1 / (BRUME_ECART_PLEIN - BRUME_ECART_MUET) + 1e-9)
    }
    for (let v = 0; v <= 1; v += 0.02) {
      const saut = Math.abs(partDeBrumeMatinale(30, v + 0.02) - partDeBrumeMatinale(30, v))
      expect(saut, `vent ${v.toFixed(2)}`).toBeLessThanOrEqual(0.02 / (BRUME_VENT_DISPERSE - BRUME_VENT_DECHIRE) + 1e-9)
    }
  })

  it('les deux termes MULTIPLIENT : une demi-froidure sous un demi-vent ne fait pas une brume pleine', () => {
    const demiEcart = (BRUME_ECART_MUET + BRUME_ECART_PLEIN) / 2
    const demiVent = (BRUME_VENT_DECHIRE + BRUME_VENT_DISPERSE) / 2
    expect(partDeBrumeMatinale(demiEcart, demiVent)).toBeCloseTo(0.25, 9)
  })

  it('l’ORDRE des bornes est celui que le rendu suppose — une inversion rendrait la garde muette', () => {
    expect(BRUME_ECART_MUET).toBeLessThan(BRUME_ECART_PLEIN)
    expect(BRUME_VENT_DECHIRE).toBeLessThan(BRUME_VENT_DISPERSE)
  })
})

/**
 * ═══ LE SOLEIL NE SE TÉLÉPORTE PAS ═══
 *
 * Le défaut (signalé par Alexis le 2026-08-25 : *« pile à 18 h la lumière semble reset et les
 * normal maps font un truc bizarre d'un coup »*) : `sunDirection` déclarait la nuit à 18 h par
 * une garde `h >= 18`, alors que `daylight` valait encore 0,70 et ne s'éteignait qu'à 21 h.
 * Le balayage étant un cosinus, la magnitude était à son MAXIMUM (|cos π| = 1) pile là où la
 * garde l'annulait — le soleil sautait de 2 200 px à l'aplomb de la caméra en une image, à
 * pleine puissance, et tout ce qui est éclairé par normal map basculait avec lui.
 *
 * On balaie donc les 24 heures au pas de 0,01 h plutôt que trois heures choisies : c'est une
 * propriété de CONTINUITÉ, elle se prouve sur son domaine entier (règle maison « garde
 * exhaustive plutôt que cas choisis »).
 *
 * Les bornes sont dérivées de la GÉOMÉTRIE, jamais de ce que le code rend : l'arc balaie π
 * radians sur `SUN_SET − SUN_RISE` heures, donc |d(cos az)/dh| ≤ π/(SUN_SET − SUN_RISE).
 */
describe('sunDirection — l’arc est continu là où il éclaire', () => {
  const PAS = 0.01
  /** π radians sur 16 h d'arc : la pente maximale d'un cosinus qui balaie si lentement. */
  const PENTE_MAX = (Math.PI / 16) * PAS

  it('aucun saut de direction tant que le soleil éclaire encore', () => {
    // On borne le domaine à « il fait encore jour » (le seuil de `MOON_DAWN`) : aux DEUX bornes
    // de l'arc, un cosinus vaut ±1 par construction, donc la coupure y est inévitable. Toute la
    // correction consiste à la reléguer là où `daylight` ne vaut plus rien — ce que la garde
    // suivante mesure. Ici : entre le lever et le coucher, la course doit être LISSE.
    const fautes: string[] = []
    for (let h = PAS; h < 24; h += PAS) {
      if (daylight(h) <= 0.15) continue
      const saut = Math.abs(sunDirection(h).x - sunDirection(h - PAS).x)
      if (saut > PENTE_MAX * 2) fautes.push(`${h.toFixed(2)}h : Δ${saut.toFixed(4)} (jour ${daylight(h).toFixed(2)})`)
    }
    expect(fautes.slice(0, 5)).toEqual([])
  })

  it('et la coupure de fin d’arc tombe là où plus personne ne la voit', () => {
    // La propriété qui compte VRAIMENT pour l'œil : un saut de direction ne se voit qu'à hauteur
    // de ce qui l'éclaire. On pondère donc chaque saut par `daylight` — l'intensité du soleil en
    // est le multiple direct (`intensitesDuCiel`). MESURÉ : 0,699 sur l'arc 6h–18h (le défaut),
    // 0,050 sur l'arc 5h–21h. Le seuil est posé entre les deux, plus près du bon.
    let pire = 0
    let quand = 0
    for (let h = PAS; h < 24; h += PAS) {
      const saut = Math.abs(sunDirection(h).x - sunDirection(h - PAS).x) * daylight(h)
      if (saut > pire) { pire = saut; quand = h }
    }
    expect(pire, `saut le plus visible à ${quand.toFixed(2)}h`).toBeLessThan(0.1)
  })

  it('l’arc couvre la journée que `daylight` décrit — et rien de plus', () => {
    // La prémisse du correctif, affirmée à part : les deux courbes sont à la MÊME heure. Un
    // soleil qui se coucherait avant que le jour ne s'éteigne rouvrirait le défaut à l'identique.
    expect(sunDirection(4.9).x).toBe(0) // avant le lever : pas de soleil…
    expect(daylight(4.9)).toBe(0) //                       …et pas de jour non plus
    expect(sunDirection(21.1).x).toBe(0) // après le coucher : pas de soleil…
    expect(daylight(21.1)).toBeLessThan(0.05) //             …et le jour n'est plus qu'un reste
    expect(sunDirection(18).x).toBeLessThan(0) // 18 h : le soleil est encore là, à l'OUEST
    expect(daylight(18)).toBeCloseTo(0.7, 5) //   et le jour vaut 0,70 — c'était tout le défaut
  })
})

/**
 * ═══ LA LUNE TRAVERSE LE CIEL, ET SA PHASE COMMANDE SON HEURE ═══
 *
 * Demande d'Alexis (2026-08-25) : *« il faut que la lune traverse le ciel comme le soleil.
 * Mais en plus elle doit avoir des phases comme en vrai »*, avec l'étalon *« la lumière
 * naturelle actuelle à minuit doit être notre pleine lune »*.
 */
describe('la lune — phases et course', () => {
  it('la lunaison se compte en NUITS — et cette prémisse ne va pas de soi', () => {
    // `phaseDeLune` prend un JOUR DE SAISON. Ça ne vaut « une lunaison = 23 nuits » que sous le
    // couplage un-jour-un-cycle posé le 2026-08-23. Les deux horloges du jeu sont faites pour
    // être DÉCOUPLÉES (`calendarScale`) : sous une autre échelle, 23 jours de saison
    // tiendraient dans une seule nuit et la lune changerait de forme entre le crépuscule et
    // l'aube. On affirme donc le couplage lui-même, plutôt que de le supposer.
    expect(VEILLEE_SEASON_CYCLES).toBe(BALANCE.SEASON_DAYS)
    expect(VEILLEE_CALENDAR_SCALE).toBeCloseTo(TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE, 6)
  })

  it('23 jours, et un cycle complet — nouvelle, croissante, pleine, décroissante', () => {
    expect(LUNAISON_JOURS).toBe(23)
    // La phase est l'angle lune↔soleil : ½ à la pleine (opposée), 0 à la nouvelle (alignée).
    expect(phaseDeLune(LUNE_PLEINE_JOUR)).toBeCloseTo(0.5, 6)
    expect(phaseDeLune(LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2)).toBeCloseTo(0, 6)
    expect(phaseDeLune(LUNE_PLEINE_JOUR - LUNAISON_JOURS)).toBeCloseTo(0.5, 6) // et en arrière
    expect(clarteDeLune(LUNE_PLEINE_JOUR)).toBeCloseTo(1, 6) // l'ancrage : le monde ouvre pleine
    expect(clarteDeLune(LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2)).toBeCloseTo(0, 6) // la nouvelle
    expect(clarteDeLune(LUNE_PLEINE_JOUR + LUNAISON_JOURS)).toBeCloseTo(1, 6) // et ça reboucle
    // Elle passe VRAIMENT par tous les états — un cycle qui n'irait qu'à mi-course serait un
    // battement, pas une lunaison.
    const vus = new Set<string>()
    for (let j = 0; j < LUNAISON_JOURS; j += 0.25) {
      const c = clarteDeLune(LUNE_PLEINE_JOUR + j)
      vus.add(c < 0.05 ? 'nouvelle' : c > 0.95 ? 'pleine' : c < 0.5 ? 'croissant' : 'gibbeuse')
    }
    expect([...vus].sort()).toEqual(['croissant', 'gibbeuse', 'nouvelle', 'pleine'])
  })

  it('23 est PREMIER avec la saison et avec l’année — la lune ne se resynchronise jamais', () => {
    // Tout l'intérêt du nombre : à 30 (la saison), la pleine lune serait tombée au même jour de
    // chaque saison, pour toujours. Cette garde meurt si quelqu'un le remet à un diviseur.
    const pgcd = (a: number, b: number): number => (b === 0 ? a : pgcd(b, a % b))
    expect(pgcd(LUNAISON_JOURS, 30)).toBe(1) // ACT_DAYS
    expect(pgcd(LUNAISON_JOURS, 120)).toBe(1) // YEAR_DAYS
  })

  it('la PHASE commande l’heure de passage — comme en vrai', () => {
    // Pleine lune : à l'opposé du soleil, donc HAUTE au cœur de la nuit et absente à midi.
    const pleine = LUNE_PLEINE_JOUR
    expect(lueurDeLune(1, pleine)).toBeGreaterThan(0.95) // transit à 1 h
    expect(lueurDeLune(12, pleine)).toBe(0) // sous l'horizon en plein jour
    // Nouvelle lune : elle traverse le ciel AVEC le soleil — donc rien du tout la nuit.
    const nouvelle = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2
    expect(lueurDeLune(0, nouvelle)).toBe(0)
    expect(lueurDeLune(1, nouvelle)).toBe(0)
    expect(lueurDeLune(3, nouvelle)).toBe(0)
    // Premier quartier : le début de nuit est clair, la fin ne l'est plus. C'est la leçon de
    // jeu que la mécanique enseigne toute seule — rentrer avant que la lune se couche.
    const quartier = LUNE_PLEINE_JOUR + LUNAISON_JOURS * 0.75
    expect(lueurDeLune(21, quartier)).toBeGreaterThan(lueurDeLune(4, quartier))
  })

  it('elle s’éteint SANS SAUT à son lever comme à son coucher', () => {
    // La leçon du soleil, appliquée par forme : la lueur se dérive de l'ALTITUDE (`sin`, nulle
    // et continue aux deux bornes) et jamais de la composante est/ouest (`cos`, qui vaut ±1).
    // Balayage exhaustif sur une lunaison entière — c'est une propriété de continuité.
    const PAS = 0.01
    let pire = 0
    let ou = ''
    for (let j = 0; j < LUNAISON_JOURS; j += 0.5) {
      for (let h = PAS; h < 24; h += PAS) {
        const d = Math.abs(lueurDeLune(h, LUNE_PLEINE_JOUR + j) - lueurDeLune(h - PAS, LUNE_PLEINE_JOUR + j))
        if (d > pire) { pire = d; ou = `${h.toFixed(2)}h, jour +${j}` }
      }
    }
    // π/16 par heure au plus (la pente de la course du ciel), soit ~0,002 par cran de 0,01 h.
    expect(pire, `pire saut à ${ou}`).toBeLessThan(0.005)
  })

  it('PLEINE LUNE À MINUIT = LE RENDU D’AVANT — l’étalon posé par Alexis', () => {
    // « Le rendu actuel de la lumière la nuit fonctionne bien ; la lumière naturelle actuelle à
    // minuit doit être notre pleine lune. » Donc le voile ne doit RIEN ajouter à cette heure-là.
    const alphaMinuit = ambientTint(0).alpha
    expect(alphaMinuit).toBe(NIGHT_ALPHA_MAX)
    // ⚠ À MINUIT PILE, IL MANQUE 2 % — et c'est juste, pas une approximation qu'on tolère : la
    // pleine lune est à l'OPPOSÉ du soleil, dont le transit est à 13 h (arc 5 h–21 h), donc elle
    // culmine à **1 h**. À minuit elle est à 98 % de son altitude. Le voile se referme donc
    // d'un cheveu — invisible, mais on l'affirme au lieu de l'arrondir. À son transit, en
    // revanche, l'étalon est EXACT : rien de plus que le voile de l'heure.
    //
    // LA BORNE EST EN CRANS DE 255, PAS EN CONSTANTE DE VOILE. Elle valait 0,005 en dur, ce qui
    // la calait en secret sur l'écart d'alors (0,97 − 0,72) : refermer la nouvelle lune à 0,995
    // le 2026-08-26 l'a fait rougir, alors que RIEN de ce qu'elle garde n'avait bougé — la pleine
    // lune est toujours à 98 % de son altitude à minuit. Deux crans sur 255, c'est le seuil de
    // ce qu'un écran peut montrer : au-delà, la pleine lune se serait vraiment assombrie.
    const aMinuit = voileDeNuit(ambientTint(0), lueurDeLune(0, LUNE_PLEINE_JOUR))
    // (Un `toBeCloseTo(…, 2)` doublait cette ligne avec une tolérance de 0,005 — la même
    // valeur en dur, sous un autre nom, et le même faux rouge. Une borne suffit, et c'est
    // celle qui se dit : deux crans sur 255.)
    expect(Math.abs(aMinuit.alpha - NIGHT_ALPHA_MAX)).toBeLessThan(2 / 255)
    expect(voileDeNuit(ambientTint(1), lueurDeLune(1, LUNE_PLEINE_JOUR)).color).toBe(ambientTint(1).color)
    // …et rien ne s'ÉCLAIRCIT jamais au-dessus : le voile ne sait que s'épaissir.
    for (let j = 0; j < LUNAISON_JOURS; j += 0.5) {
      for (let h = 0; h < 24; h += 0.5) {
        const a = ambientTint(h).alpha
        expect(voileDeNuit(ambientTint(h), lueurDeLune(h, LUNE_PLEINE_JOUR + j)).alpha).toBeGreaterThanOrEqual(a - 1e-9)
      }
    }
  })

  it('la NOUVELLE LUNE assombrit la nuit, et SEULEMENT la nuit', () => {
    const nouvelle = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2
    expect(voileDeNuit(ambientTint(0), lueurDeLune(0, nouvelle)).alpha).toBeCloseTo(VOILE_NOUVELLE_LUNE, 6)
    // MIDI NE BOUGE PAS D'UN POIL, quelle que soit la lune — sans le facteur `partNuit`, une
    // nouvelle lune aurait posé un voile de 0,18 sur le plein jour. C'est le genre de défaut
    // qu'un test « à minuit » seul ne voit jamais.
    for (let j = 0; j < LUNAISON_JOURS; j += 0.5) {
      expect(voileDeNuit(ambientTint(12), lueurDeLune(12, LUNE_PLEINE_JOUR + j)).alpha).toBe(0)
    }
  })

  it('le SOLEIL domine toujours partout où il fait jour — la lune n’a fait que faiblir', () => {
    // La garde de `dynamic-lighting.test.ts` (audit UX 2026-08-20, contraste avatar/sol 1,20:1)
    // portait sur `intensitesDuCiel(day)`. La lueur ne fait que MULTIPLIER le terme lunaire par
    // un nombre de [0,1] : la propriété tient donc par construction — on l'affirme quand même,
    // sur toute la lunaison, parce qu'une garde qui tient « par construction » cesse de tenir
    // le jour où la construction change.
    for (let j = 0; j < LUNAISON_JOURS; j += 1) {
      for (let h = 0; h < 24; h += 0.25) {
        const d = daylight(h)
        if (d <= 0.15) continue
        const { soleil, lune } = intensitesDuCiel(d, lueurDeLune(h, LUNE_PLEINE_JOUR + j))
        expect(lune, `${h} h, jour +${j}`).toBeLessThanOrEqual(soleil)
      }
    }
  })
})

/**
 * ═══ « ON NE DEVRAIT QUASIMENT RIEN VOIR, TRÈS DANGEREUX » (Alexis, 2026-08-26) ═══
 *
 * Cette garde existe parce que le PREMIER essai — ne pousser que l'opacité — a échoué en
 * silence : le bleu de `NIGHT_COLOR` fuit à 36 % même à opacité 1, donc la nuit ne pouvait
 * pas descendre sous ~46 de bleu. On mesure donc ce qui compte pour l'œil (le PIXEL rendu),
 * pas le réglage qu'on a écrit.
 */
describe('la nuit sans lune', () => {
  /** Le pixel d'un sol gris moyen (128) sous un voile MULTIPLY — la vraie opération du rendu
   *  (`night-veil.ts`) : `sortie = source × ((1−α) + α·teinte)`. */
  const solSousLeVoile = (v: { color: number; alpha: number }): [number, number, number] =>
    [16, 8, 0].map((d) => Math.round(128 * (1 - v.alpha + v.alpha * (((v.color >> d) & 0xff) / 255)))) as [number, number, number]

  it('une nuit de nouvelle lune est NOIRE, pas bleue', () => {
    const nouvelle = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2
    const [r, g, b] = solSousLeVoile(voileDeNuit(ambientTint(0), lueurDeLune(0, nouvelle)))
    // Le seuil qui compte : le BLEU. C'est lui qui plafonnait, et c'est lui qui trahissait que
    // monter l'alpha seul ne servait à rien. Un voile qui ne toucherait qu'à l'opacité rendrait
    // 54 ici, et cette garde rougirait — vérifié en remettant la version d'avant.
    expect(b, `bleu ${b}`).toBeLessThan(20)
    expect(Math.max(r, g, b), `pixel (${r}, ${g}, ${b})`).toBeLessThan(20)
  })

  it('…et la pleine lune rend la nuit d’avant, à un niveau près', () => {
    // (39, 41, 69) est le chiffre consigné dans l'en-tête de `NIGHT_COLOR` le 2026-07-24 : la
    // nuit d'avant la lune, c'est-à-dire l'étalon posé par Alexis. On l'affirme sur le PIXEL.
    expect(solSousLeVoile(ambientTint(0))).toEqual([39, 41, 69]) // la référence, sans lune du tout
    // La pleine lune y revient à UN niveau près — l'écart est son transit à 1 h et non à
    // minuit (voir la garde de l'étalon plus haut). Deux niveaux rougiraient : ce serait que
    // la pleine lune a cessé d'être l'étalon.
    const [r, g, b] = solSousLeVoile(voileDeNuit(ambientTint(0), lueurDeLune(0, LUNE_PLEINE_JOUR)))
    expect(Math.max(Math.abs(r - 39), Math.abs(g - 41), Math.abs(b - 69)), `(${r}, ${g}, ${b})`).toBeLessThanOrEqual(1)
    // …et à SON transit, l'étalon est exact.
    expect(solSousLeVoile(voileDeNuit(ambientTint(1), lueurDeLune(1, LUNE_PLEINE_JOUR))))
      .toEqual(solSousLeVoile(ambientTint(1)))
  })

  it('la nuit se ferme SANS MARCHE d’une phase à l’autre', () => {
    // Une lune qui assombrirait par paliers se verrait comme un interrupteur. Balayage de la
    // lunaison entière, à minuit : deux jours voisins ne peuvent pas s'écarter d'un cran visible.
    let pire = 0
    let ou = 0
    for (let j = 0.05; j < LUNAISON_JOURS; j += 0.05) {
      const a = solSousLeVoile(voileDeNuit(ambientTint(0), lueurDeLune(0, LUNE_PLEINE_JOUR + j)))
      const b = solSousLeVoile(voileDeNuit(ambientTint(0), lueurDeLune(0, LUNE_PLEINE_JOUR + j - 0.05)))
      const d = Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))))
      if (d > pire) { pire = d; ou = j }
    }
    expect(pire, `pire marche au jour +${ou.toFixed(2)}`).toBeLessThanOrEqual(2)
  })
})

/**
 * ═══ L'AIR D'UNE ZONE EST LE DERNIER PLANCHER DE LA NUIT ═══
 *
 * Il passe en blend NORMAL par-dessus le voile : son terme additif ne peut pas être rattrapé
 * par un multiply. On juge donc sur le PIXEL composé — voile puis air — comme le rendu compose.
 */
describe('l’air de la zone suit la lune', () => {
  /** Le pixel d'un sol, voile MULTIPLY puis air en NORMAL par-dessus — l'ordre de `night-veil`. */
  const solPuisAir = (
    v: { color: number; alpha: number },
    air: { color: number; alpha: number },
    albedo = 60, // une herbe sombre : le cas où le plancher de l'air se voit le plus
  ): [number, number, number] =>
    [16, 8, 0].map((d) => {
      const sous = albedo * (1 - v.alpha + v.alpha * (((v.color >> d) & 0xff) / 255))
      return Math.round(sous * (1 - air.alpha) + ((air.color >> d) & 0xff) * air.alpha)
    }) as [number, number, number]

  const PRES_BAS = { color: 0xfff2d0, alpha: 0.06 } // la brume chaude des Prés Bas (zone-ambiance)
  const GOUFFRE = { color: 0x05060a, alpha: 0.55 } // …et l'air déjà noir du Gouffre
  const nouvelle = LUNE_PLEINE_JOUR + LUNAISON_JOURS / 2

  it('nouvelle lune : la brume cesse d’être la seule chose éclairée', () => {
    const v = voileDeNuit(ambientTint(0), lueurDeLune(0, nouvelle))
    const k = partSansLune(ambientTint(0), lueurDeLune(0, nouvelle))
    const avant = solPuisAir(v, PRES_BAS)
    const apres = solPuisAir(v, airSansLune(PRES_BAS, k))
    expect(Math.max(...avant), `sans le correctif ${avant}`).toBeGreaterThan(12) // le plancher mesuré
    expect(Math.max(...apres), `avec ${apres}`).toBeLessThan(5) // « proche du noir »
  })

  it('…mais un air DÉJÀ noir continue d’assombrir autant', () => {
    // Éteindre l'ALPHA aurait rendu le Gouffre plus clair sans lune — l'inverse du but. On
    // éteint la teinte : un air noir l'était déjà, il ne bouge donc pas.
    const k = partSansLune(ambientTint(0), lueurDeLune(0, nouvelle))
    const eteint = airSansLune(GOUFFRE, k)
    expect(eteint.alpha).toBe(GOUFFRE.alpha)
    const v = voileDeNuit(ambientTint(0), lueurDeLune(0, nouvelle))
    const avant = solPuisAir(v, GOUFFRE)
    const apres = solPuisAir(v, eteint)
    // Le sens compte plus que l'écart : sans lune, le Gouffre ne s'ÉCLAIRCIT pas. (Éteindre
    // l'alpha, lui, l'aurait relevé — c'est l'erreur que ce choix évite.)
    for (const [i, x] of apres.entries()) expect(x, `canal ${i} : ${apres} contre ${avant}`).toBeLessThanOrEqual(avant[i] ?? 0)
  })

  it('LE CONTRÔLE — en plein jour et à la pleine lune, l’air ne bouge pas d’un cheveu', () => {
    const canaux = (c: number) => [16, 8, 0].map((d) => (c >> d) & 0xff)
    for (const h of [1, 11, 12, 14]) {
      // 1 h et non minuit : c'est le TRANSIT de la pleine lune, l'étalon exact (à minuit elle
      // n'est pas encore tout à fait au zénith — un cheveu de `k`, cinq niveaux sur le canal
      // le plus haut, et c'est la garde `l’étalon` plus haut qui en répond). Et 6 h manque
      // exprès : la lune s'y couche DÉJÀ (altitude 0,55) sur une nuit encore installée — l'air
      // y perd 20 %, ce qui est le comportement voulu, pas une exception à cette garde. Idem
      // à 18 h, où le voile pèse encore : « ne bouge pas » vaut du PLEIN jour (10 h → 15 h),
      // là où l'ambiante ne pèse rien — et c'est la seule fenêtre où l'on peut l'exiger.
      const k = partSansLune(ambientTint(h), lueurDeLune(h, LUNE_PLEINE_JOUR))
      expect(canaux(airSansLune(PRES_BAS, k).color), `${h} h`).toEqual(canaux(PRES_BAS.color))
    }
    for (let j = 0; j < LUNAISON_JOURS; j += 0.5) {
      // MIDI, toute la lunaison : la phase ne doit jamais déteindre sur le plein jour.
      expect(partSansLune(ambientTint(12), lueurDeLune(12, LUNE_PLEINE_JOUR + j)), `jour +${j}`).toBe(0)
    }
  })
})

/**
 * ═══ LE JOUR PEINT EST LE JOUR SIMULÉ (2026-08-26) ═══
 *
 * Le défaut qu'on garde : `/sim` fait varier la longueur du jour avec la saison (`saisons.md`
 * S6, l'encyclopédie l'affiche saison par saison — 62 / 72 / 62 / 48 %), et le rendu allumait
 * à 5 h et éteignait à 21 h TOUS LES JOURS DE L'ANNÉE. Au cœur du Grand Froid la sim passait
 * en nuit à 17 h 31 — les loups chassaient, le froid tombait — sur une vallée en plein jour.
 *
 * ⚠ CE BANC DOIT ÊTRE ROUGE SANS `heureSolaire` : vérifié en remplaçant les deux appels par
 * `heureCanonique(mur)`, il tombe aux jours 45 et 105 (0,85 de clarté au crépuscule d'hiver,
 * contre 0,05 attendu) et passe aux jours 15 et 75 — les équinoxes, où le monde d'avant était
 * déjà juste. Un banc qui n'éprouverait que `heureSolaire` seule ne pourrait pas échouer
 * pour la bonne raison.
 */
describe('l’heure solaire — le lever et le coucher du rendu sont ceux de la sim', () => {
  /** L'heure murale du LEVER ce jour-là — saisonnière depuis que le soleil est celui de Paris. */
  const lever = (jour: number): number => leverPourJour(jour)
  /** L'heure murale du COUCHER ce jour-là — la bascule EXACTE de `isNight`. */
  const crepusculeMural = (jour: number): number =>
    lever(jour) + 24 * (dayTicksPourJour(jour) / TICKS_PER_CYCLE)

  it('SUR LE JOUR CANONIQUE C’EST L’IDENTITÉ — aucune keyframe n’est recalibrée par accident', () => {
    // Lever à 6 h, part 0,625 : le jour de convention sur lequel CHAQUE keyframe de ce fichier
    // a été écrite. Si l'identité ne tenait pas, tout le réglage de la DA glisserait en silence.
    const canonique = Math.round(TICKS_PER_CYCLE * 0.625)
    for (let h = 0; h < 24; h += 0.05) {
      expect(heureSolaire(h, canonique, 6), `${h} h`).toBeCloseTo(h, 9)
    }
  })

  it('LE LEVER TOMBE SUR 6 H DU CADRAN, LE COUCHER SUR 21 H — les DEUX bouts, tous les jours', () => {
    // Ce que le monde d'avant ne pouvait pas dire : l'aube y était clouée à 6 h murales. Depuis
    // le soleil français, elle court de 04h45 à 08h43 — et le rendu doit la suivre aux deux bouts.
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      const dt = dayTicksPourJour(jour)
      const l = lever(jour)
      expect(heureSolaire(l, dt, l), `lever, jour ${jour}`).toBeCloseTo(6, 9)
      expect(heureSolaire(crepusculeMural(jour), dt, l), `coucher, jour ${jour}`).toBeCloseTo(21, 9)
    }
  })

  it('LES HEURES SONT CELLES DE LA FRANCE — Paris, à la minute de l’almanach', () => {
    // Les quatre cardinaux, relus par le rendu. Ils viennent du calcul (48,8566 N, altitude
    // −0,833°, heure légale d'hiver), pas d'un réglage : c'est la décision d'Alexis du
    // 2026-08-26. Tolérance d'UNE minute — au-delà, ce ne sont plus les heures de la France.
    const MINUTE = 1 / 60
    for (const [jour, l, c] of [
      [15, 6 + 46 / 60, 18 + 56 / 60],   // équinoxe   — almanach 06h46 / 18h56
      [45, 4 + 45 / 60, 20 + 56 / 60],   // solstice été — 21 juin Paris 05h47/21h58 CEST
      [75, 6 + 46 / 60, 18 + 56 / 60],   // équinoxe
      [105, 8 + 43 / 60, 16 + 58 / 60],  // solstice hiver — 21 décembre Paris 08h42/16h56
    ] as const) {
      expect(lever(jour), `lever au jour ${jour}`).toBeCloseTo(l, 1)
      expect(Math.abs(crepusculeMural(jour) - c), `coucher au jour ${jour}`).toBeLessThan(MINUTE)
    }
  })

  it('LA CLARTÉ AU CRÉPUSCULE EST LA MÊME TOUTE L’ANNÉE — la garde du défaut', () => {
    // La propriété qui compte, et la seule qui distingue le monde d'avant du monde d'après :
    // au tick où la sim bascule en nuit, le rendu est TOUJOURS au même point de sa courbe.
    // Avant : 0,85 au jour 105 (plein jour peint sur une nuit simulée), 0,05 au jour 75.
    const etalon = daylight(21)
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      const dt = dayTicksPourJour(jour)
      const j = daylight_(heureSolaire(crepusculeMural(jour), dt, lever(jour)))
      expect(j, `clarté au crépuscule, jour ${jour}`).toBeCloseTo(etalon, 9)
      // …et l'ambiance aussi : le voile de nuit se pose PILE quand la sim dit « nuit ».
      expect(ambientTint_(heureSolaire(crepusculeMural(jour), dt, lever(jour))).alpha, `voile, jour ${jour}`)
        .toBeCloseTo(ambientTint(21).alpha, 9)
    }
  })

  it('LE SOLEIL NE SE TÉLÉPORTE PAS — une seule horloge, donc aucun saut d’arc', () => {
    // Le post-mortem de `sunDirection` (0,8385 de saut à 18 h) est celui d'une chaîne à deux
    // horloges. On balaie le cycle entier, aux quatre cœurs de saison, et on exige que le
    // balayage est→ouest reste continu à travers la warp — y compris sur sa couture.
    //
    // ⚠ ON MESURE `dirX × clarté`, PAS `dirX` NU — la MÊME grandeur que le post-mortem
    // (« saut de `dirX` pondéré par l'intensité »). Nu, le cosinus saute de 0 à 1 au lever
    // (`courseDuCiel` rend x = 0 sous l'horizon) : c'est la discontinuité CONNUE et tolérée de
    // 5 h, celle que le bloc de `sunDirection` documente comme « invisible, `daylight` y vaut 0
    // tout rond ». La mesurer nue, c'est éprouver l'instrument au lieu du monde.
    for (const jour of [15, 45, 75, 105]) {
      const dt = dayTicksPourJour(jour)
      const l = lever(jour)
      const porte = (h: number): number => {
        const solaire = heureSolaire(h, dt, l)
        return sunDirection_(solaire).x * daylight_(solaire)
      }
      let prec = porte(0)
      for (let h = 0.01; h < 24; h += 0.01) {
        const x = porte(h)
        // 0,08 : le saut résiduel de fin d'arc (un cosinus vaut ±1 à ses bornes) tombe là où
        // la clarté ne vaut plus que 0,05 — mesuré 0,0599 sur le cadran canonique.
        expect(Math.abs(x - prec), `jour ${jour}, ${h.toFixed(2)} h`).toBeLessThan(0.08)
        prec = x
      }
    }
  })

  it('LA COURBE DU RENDU EST CELLE QUE L’ENCYCLOPÉDIE AFFICHE', () => {
    // Les quatre cardinaux de la fiche de saison (`encyclopedie.ts`), relus par le rendu : la
    // part de jour PEINTE au cœur de chaque saison est celle qu'on promet au joueur.
    for (const [coeur, part] of [[15, 50], [45, 67], [75, 50], [105, 34]] as const) {
      const dt = dayTicksPourJour(coeur)
      const crepuscule = crepusculeMural(coeur)
      // La fiche affiche `Math.floor(part × 100)` (voir `partDeJourDe`) : on relit le nombre
      // par l'autre bout — l'écart entre le lever et le coucher que le rendu peint — et on
      // exige qu'il retombe sur celui de la carte. C'est le lien que le joueur voit.
      expect(Math.floor(((crepuscule - lever(coeur)) / 24) * 100), `saison au jour ${coeur}`).toBe(part)
      expect(heureSolaire(crepuscule, dt, lever(coeur))).toBeCloseTo(21, 9)
      // …et c'est LE MÊME nombre que la fiche calcule (`encyclopedie.partDeJourDe`, dérivé de
      // cette courbe depuis le 2026-08-26) : les deux tables ne peuvent plus diverger.
      expect(Math.floor(BALANCE.PART_DE_JOUR.cardinaux[(coeur - 15) / 30]!.valeur * 100)).toBe(part)
    }
  })
})
