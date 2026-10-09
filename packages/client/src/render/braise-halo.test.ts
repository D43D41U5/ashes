/**
 * ═══ B-A18 — LE HALO DE LA BRAISE À L'ÉCRAN (`braise.md`, `nuit-noire.md` N2bis, LG-R13) ═══
 *
 * La clause ④ de B-A18 (*« l'écran n'est jamais plus clair que la sim »*) vit ICI et NULLE PART
 * AILLEURS, et `lumiere.test.ts` dit pourquoi en toutes lettres : l'écrire dans `/sim` y aurait
 * exigé une seconde courbe, celle de l'écran — la redondance exacte que N2bis interdit.
 *
 * ⚠ **CE QUI FERAIT ROUGIR CE FICHIER**, énoncé avant de le lire (`sonde-qui-ne-peut-pas-échouer`) :
 *   • un rayon d'écran repris en `Math.sqrt` comme celui de la torche (④, et la falsification ⑫
 *     prouve que cette branche-là est bien interdite, pas seulement écartée) ;
 *   • un palier de quantification qui tombe entre deux cellules de lumière (⑩) ;
 *   • `BRAISE.RAYON_GAIN_PAR_NIVEAU` monté au point que la braise dépasse la torche (⑪) ;
 *   • le battement passé dans la TAILLE au lieu de l'alpha (⑬).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRAISE, LUMIERE, type Braise, braiseNeuve, bulleDeBraise, chargePleine, cransMax, fractionDeCharge, multDuRayon, rayonDeBraise } from '@ashes/sim'
import { BATTEMENT, CAVE_RATIO, FLAQUE_RATIO, LIGHT_PX, LIGHT_RATIO, QUANTA, TROU_RATIO, braiseHoleRadius, cellulesDeFlaque, forceDeBraise, forceDuTrouDeBraise, partQuantifiee, rayonEcranDeBraise } from './braise-halo'

import { TORCHE_HOLE_FORCE, TORCHE_HOLE_TILES } from './torche'
import { avecCeQuOnPorte } from './gi/passe-corps'
import { TILE_PX } from './framing'
import { HOLE_RADIUS_TILES } from './lighting'
import { champRef, type GrilleGi } from './gi/champ-ref'
import { GI, profilFeu } from './gi/reglages'
import { expositionAuFeu, suitLaRegleDesFaces } from './gi/sol-du-corps'

/** Le niveau le plus haut que l'arbre puisse atteindre (B-R14) — dérivé, jamais écrit : la garde
 *  doit suivre l'arbre quand il grandira, pas le figer à l'état de 2026-10-05. */
const NIVEAU_MAX = BRAISE.CRANS_MAX - BRAISE.CRANS_DEPART
const NIVEAUX = Array.from({ length: NIVEAU_MAX + 1 }, (_, n) => n)
/** La nuit : `day` 0. (Le facteur de nuit est le même que celui de la torche — voir ⑧.) */
const NUIT = 0
const RATIOS = [TROU_RATIO, FLAQUE_RATIO, LIGHT_RATIO, CAVE_RATIO] as const

function braise(niveau: number, f: number): Braise {
  return { niveau, charge: Math.round(chargePleine(niveau) * f) }
}

describe('B-A18 ④ — N2bis : le support de l’écran est INCLUS dans celui de la sim', () => {
  it('④ aucun rayon d’écran ne dépasse `rayonDeBraise`, à tout niveau, toute charge, toute couche', () => {
    let cas = 0
    let stricts = 0 // les couches à ratio < 1 : l'écran doit être STRICTEMENT dedans
    for (const niveau of NIVEAUX) {
      for (let i = 0; i <= 200; i++) {
        const f = i / 200
        const b = braise(niveau, f)
        const sim = rayonDeBraise(b)
        for (const ratio of RATIOS) {
          const ecran = rayonEcranDeBraise(b, ratio)
          expect(ecran).toBeLessThanOrEqual(sim + 1e-12)
          cas++
          if (ratio < 1 && sim > 0 && ecran < sim - 1e-9) stricts++
        }
      }
    }
    expect(cas).toBe(NIVEAUX.length * 201 * RATIOS.length)
    // ⚠ ANTI-VACUITÉ, et elle a changé de forme quand la quantification a déménagé dans la seule
    // flaque : à ratio 1 l'égalité est désormais ATTENDUE et c'est l'énoncé même (le trou de
    // Light2D porte exactement la portée de l'autorité). Ce qui reste à prouver ici, c'est que
    // les couches à ratio < 1 (le voile, la cave) sont bien STRICTEMENT dedans — sinon un
    // `TROU_RATIO` monté à 1 passerait sans un mot. La marge de quantification, elle, est
    // affirmée par ④ bis, qui est la garde de la flaque.
    const aRatioStrict = RATIOS.filter((r) => r < 1).length
    expect(aRatioStrict).toBeGreaterThan(0)
    expect(stricts).toBe(NIVEAUX.length * 200 * aRatioStrict) // toutes les charges NON NULLES
  })

  it('④ bis la FLAQUE aussi, une fois ses cellules reconverties en tuiles — c’est elle qui peint', () => {
    // ⚠ CETTE CLAUSE RELIT LE RAYON DANS L'UNITÉ OÙ IL EST RÉELLEMENT POSÉ. ④ balaie des tuiles ;
    // la flaque, elle, est la seule couche qui CUIT le rayon, en CELLULES — et un arrondi est
    // exactement l'endroit où N2bis peut casser.
    //
    // ⚠ **ET ELLE A DES DENTS, MAIS PAS AUX RÉGLAGES D'AUJOURD'HUI — mesuré, pas supposé.**
    // Remplacer `floor` par `ceil` dans `cellulesDeFlaque` ne fait rougir AUCUNE garde à
    // `QUANTA = 8`, et ce n'est pas un trou : `cellules = 16 × k/QUANTA` est alors TOUJOURS
    // entier (16 est divisible par 8, voir ⑩), donc les deux arrondis sont le même code. La
    // clause suivante l'affirme, pour que ce « no-op » soit écrit au lieu d'être pris pour une
    // couverture. À `QUANTA = 32`, en revanche, `ceil` la fait rougir (0,25 tuile rendue contre
    // 0,14 autorisée) et `floor` tient : c'est ce qui justifie `floor` comme choix DÉFENSIF, pour
    // le jour où la quantification se raffinera.
    let serres = 0
    for (const niveau of NIVEAUX) {
      for (let i = 0; i <= 200; i++) {
        const b = braise(niveau, i / 200)
        const enTuiles = (cellulesDeFlaque(b) * LIGHT_PX) / TILE_PX
        expect(enTuiles).toBeLessThanOrEqual(rayonDeBraise(b) + 1e-12)
        if (enTuiles < rayonDeBraise(b) - 1e-9) serres++
      }
    }
    expect(serres).toBeGreaterThan(NIVEAUX.length * 150) // anti-vacuité, comme ④
    // Pile sur un palier, le compte de cellules est ENTIER avant tout arrondi — d'où le no-op
    // ci-dessus. C'est `QUANTA | 16` qui le donne (⑩), et rien d'autre.
    for (const niveau of NIVEAUX) {
      for (let q = 0; q <= QUANTA; q++) {
        const brut = (rayonEcranDeBraise(braise(niveau, q / QUANTA), FLAQUE_RATIO) * TILE_PX) / LIGHT_PX
        expect(Math.abs(brut - Math.round(brut))).toBeLessThan(1e-9)
      }
    }
  })

  it('⑫ la falsification : la courbe de la TORCHE (√) violerait ④ — la branche est interdite, pas écartée', () => {
    // `torcheHoleRadius` prend `Math.sqrt(agonie)`. Transposée ici, elle rendrait `√f > f` donc un
    // rayon d'écran AU-DESSUS de celui de la sim à toute charge partielle. On ne teste pas mon
    // code : on prouve que l'alternative que l'en-tête écarte est bien fausse.
    let violations = 0
    for (let i = 1; i < 200; i++) {
      const f = i / 200
      const b = braise(0, f)
      const sim = rayonDeBraise(b)
      const avecRacine = BRAISE.RAYON_BASE * multDuRayon(0) * Math.sqrt(fractionDeCharge(b))
      if (avecRacine > sim + 1e-9) violations++
    }
    expect(violations).toBe(199) // TOUTES, sans exception — ce n'est pas un cas de bord
  })

  it('⑬ le rayon ne vacille PAS : il n’a aucune entrée de temps, alors que la force en a une', () => {
    const b = braise(0, 0.7)
    // L'ARITÉ EST LA PREUVE (la leçon de `sousLaRoche` à trois arguments) : `rayonEcranDeBraise`
    // ne prend pas `timeMs`, donc aucun battement ne peut y entrer. La garde affirme l'autre
    // moitié — que le battement est bien VIVANT quelque part, dans la force.
    expect(rayonEcranDeBraise.length).toBe(2) // (braise, ratio) : ni temps NI JOUR
    const forces = [0, 250, 500, 750, 1000, 1500].map((t) => forceDeBraise(b, NUIT, t, 1.3))
    const min = Math.min(...forces)
    const max = Math.max(...forces)
    expect(max - min).toBeGreaterThan(0.01) // CONTRÔLE POSITIF : la flamme respire
    // …et elle respire MOINS qu'une torche : `BATTEMENT` amortit vers 1.
    expect(BATTEMENT).toBeGreaterThan(0)
    expect(BATTEMENT).toBeLessThan(1)
  })
})

describe('B-A18 ⑩ — les paliers tombent sur des CELLULES ENTIÈRES de lumière', () => {
  it('⑩ le rayon plein fait un nombre entier de cellules, divisible par QUANTA', () => {

    for (const niveau of NIVEAUX) {
      const cellules = (BRAISE.RAYON_BASE * multDuRayon(niveau) * TILE_PX) / LIGHT_PX
      expect(Number.isInteger(cellules)).toBe(true)
      expect(cellules % QUANTA).toBe(0)
    }
  })

  it('⑩ bis la flaque descend par marches ÉGALES, et s’éteint pile à charge nulle', () => {
    const vus: number[] = []
    for (let q = QUANTA; q >= 0; q--) {
      // Une charge pile sur le palier `q` : la flaque doit y valoir exactement `q` marches.
      const b = braise(0, q / QUANTA)
      vus.push(cellulesDeFlaque(b))
    }
    expect(vus[0]).toBe(16) // RAYON_BASE 4 tuiles × 16 px / 4 px = 16 cellules
    expect(vus[QUANTA]).toBe(0) // une braise vide n'éclaire RIEN (B-A15 à l'écran)
    // Des marches égales : chaque palier retire le même nombre entier de cellules.
    const pas = vus.slice(1).map((c, i) => vus[i]! - c)
    expect(new Set(pas).size).toBe(1)
    expect(pas[0]).toBe(16 / QUANTA)
  })

  it('⑩ quater la flaque ne prend QUE `QUANTA` rayons sur toute une décharge — le vrai but', () => {
    // ⚠ CETTE CLAUSE A ÉTÉ AJOUTÉE APRÈS UNE FALSIFICATION PASSÉE AU VERT : retirer la
    // quantification de `cellulesDeFlaque` ne faisait rougir AUCUNE garde. ④ bis n'affirme
    // qu'une inégalité (`écran ≤ sim`), or elle est vraie sans quantification aussi — elle ne
    // pouvait donc pas voir disparaître ce dont la flaque a besoin. Ce qui se garde ici n'est pas
    // une borne, c'est un COMPTE : combien de fois la texture bascule sur une décharge entière,
    // puisque c'est exactement ce que la quantification achète (le grain qui ne grouille pas).
    for (const niveau of NIVEAUX) {
      const plein = chargePleine(niveau)
      const vus = new Set<number>()
      // Toute la décharge, tick par tick : le vrai parcours, pas un échantillon.
      for (let charge = plein; charge >= 0; charge--) vus.add(cellulesDeFlaque({ niveau, charge }))
      // `QUANTA` paliers non nuls, plus le zéro — et pas un de plus.
      expect(vus.size).toBeLessThanOrEqual(QUANTA + 1)
      expect(vus.size).toBe(QUANTA + 1) // ni moins : chaque palier doit être ATTEINT
      expect(vus.has(0)).toBe(true)
      // ⚠ CONTRÔLE POSITIF : sans quantification, la décharge en traverserait bien plus — sinon
      // la clause ci-dessus serait vraie pour une raison qui n'a rien à voir avec `QUANTA`.
      const sansQuantif = new Set<number>()
      for (let charge = plein; charge >= 0; charge--) {
        sansQuantif.add(Math.floor((rayonDeBraise({ niveau, charge }) * FLAQUE_RATIO * TILE_PX) / LIGHT_PX))
      }
      expect(sansQuantif.size).toBeGreaterThan(QUANTA + 1)
    }
  })

  it('⑩ ter la quantification est un MINORANT, monotone, et sourde au NaN', () => {
    for (let i = 0; i <= 500; i++) {
      const f = i / 500
      expect(partQuantifiee(f)).toBeLessThanOrEqual(f)
    }
    let prec = -1
    for (let i = 0; i <= 500; i++) {
      const q = partQuantifiee(i / 500)
      expect(q).toBeGreaterThanOrEqual(prec)
      prec = q
    }
    expect(partQuantifiee(NaN)).toBe(0)
    expect(partQuantifiee(-1)).toBe(0)
    expect(partQuantifiee(2)).toBe(1) // borné en haut : une charge > plein ne grandit pas
  })
})

describe('B-A18 ⑭ — l’AMPLITUDE du halo est PROPORTIONNELLE à celle de la sim, à la parité torche', () => {
  // ⚠ CETTE CLAUSE A CHANGÉ TROIS FOIS DANS LA JOURNÉE, et les trois fois le défaut était un
  // nombre à moi dans l'amplitude :
  //   ① `force: TROU_FORCE` CONSTANT (le patron de la torche, qui en a le droit : son sommet dans
  //      la sim vaut toujours 1, celui de la braise vaut `f`). À charge basse la sim refusait la
  //      parade pendant que le voile restait creusé à fond.
  //   ② `TROU_FORCE × f`, soit un plafond de 0,34 — relevé par Alexis à l'œil (« la braise doit
  //      aussi éclairer le joueur »).
  //   ③ `bulleDeBraise(b, 0)` TEL QUEL, au motif que la sim rend 1 à charge pleine comme une torche
  //      et comme un Feu. ⚠ Vrai des profils de /sim, FAUX du rendu : dans `veilFires` un Feu pousse
  //      `force` 1 et une torche `TORCHE_HOLE_FORCE` = 0,5. Pousser 1 donnait à une braise pleine le
  //      creusement d'un FEU — j'avais inversé la hiérarchie que je prétendais défendre.
  // LA FORME JUSTE N'A AUCUN NOMBRE À MOI : le sommet de l'autorité × l'échelle du rendu de la
  // torche. La garde affirme donc une PROPORTIONNALITÉ au bit ET la parité torche à charge pleine.
  it('⑭ l’amplitude est `TORCHE_HOLE_FORCE × bulleDeBraise`, AU BIT, à tout niveau et toute charge', () => {
    let cas = 0
    for (const niveau of NIVEAUX) {
      for (let i = 0; i <= 200; i++) {
        const b = braise(niveau, i / 200)
        expect(forceDuTrouDeBraise(b)).toBe(TORCHE_HOLE_FORCE * bulleDeBraise(b, 0)) // au bit
        cas++
      }
    }
    expect(cas).toBe(NIVEAUX.length * 201)
    expect(forceDuTrouDeBraise(undefined)).toBe(0)
    expect(forceDuTrouDeBraise(braise(0, 0))).toBe(0)
  })

  it('⑭ quinquies PARITÉ TORCHE à charge pleine, et JAMAIS au-dessus — c’est là qu’était l’inversion', () => {
    // La clause qui aurait attrapé ③ : l'écran ne doit ni sous-éclairer la braise (le plafond de
    // 0,34, 1,47× sous la torche) ni la sur-éclairer (le sommet à 1, 2× au-dessus de la torche).
    // ⚠ PRÉMISSE AFFIRMÉE, sans quoi l'égalité ne dirait rien : le rendu a bien sa propre échelle
    // d'amplitude, DISTINCTE de celle de la sim, où les trois sources valent 1 au contact.
    expect(TORCHE_HOLE_FORCE).toBeLessThan(1) // le Feu pousse 1 dans `veilFires` (WorldScene)
    expect(bulleDeBraise(braise(0, 1), 0)).toBe(BRAISE.CLARTE_PLEINE) // la sim, elle, rend 1
    for (const niveau of NIVEAUX) {
      expect(forceDuTrouDeBraise(braise(niveau, 1))).toBe(TORCHE_HOLE_FORCE) // parité, au bit
      for (const f of [0.05, 0.2, 0.5, 0.75, 0.99]) {
        expect(forceDuTrouDeBraise(braise(niveau, f))).toBeLessThan(TORCHE_HOLE_FORCE)
      }
    }
  })

  it('⑭ bis sous le SEUIL_NOIR, le halo est MOINS profond qu’à charge pleine', () => {
    const fSeuil = 0.3 / BRAISE.CLARTE_PLEINE
    const basse = braise(0, fSeuil * 0.5)
    expect(bulleDeBraise(basse, 0)).toBeLessThan(0.3) // PRÉMISSE : la sim refuse bien la parade
    expect(forceDuTrouDeBraise(basse)).toBeLessThan(forceDuTrouDeBraise(braise(0, 1)) * 0.6)
    expect(bulleDeBraise(braise(0, 1), 0)).toBeGreaterThanOrEqual(0.3) // CONTRÔLE POSITIF
  })

  it('⑭ ter la HIÉRARCHIE vit dans la PORTÉE : braise < torche < Feu, et nulle part ailleurs', () => {
    // C'est la forme juste de l'intuition que ② avait mal écrite. Dans la sim les trois valent 1 au
    // contact, et à l'écran la braise pleine égale la torche (⑭ quinquies) : ce qui les sépare est
    // ce qu'elles PORTENT — et c'est ça qu'il faut garder.
    const braisePortee = BRAISE.RAYON_BASE * TROU_RATIO
    expect(braisePortee).toBeLessThan(TORCHE_HOLE_TILES)
    expect(TORCHE_HOLE_TILES).toBeLessThan(HOLE_RADIUS_TILES) // le Feu
    // …et le cône de la braise tombe donc PLUS VITE que celui de la torche : à mi-portée de la
    // torche, la braise ne donne plus rien, à charge pleine comprise.
    expect(bulleDeBraise(braise(0, 1), TORCHE_HOLE_TILES / 2)).toBeLessThan(1 - TORCHE_HOLE_TILES / 2 / LUMIERE.TORCHE_PORTEE_TUILES)
  })

  it('⑭ quater le compte de cellules reste ENTIER À TOUTE HEURE, pas seulement la nuit', () => {
    // ⚠ Pas affirmable avant le retrait du facteur de nuit du rayon : avec lui,
    // `cellules = 16 × k/8 × (1 − day)` balayait toutes ses valeurs au crépuscule, et ④ bis ne
    // valait qu'à `day = 0` — la seule heure que les gardes éprouvaient.
    for (const day of [0, 0.17, 0.3, 0.5, 0.63, 0.81, 0.99]) {
      for (const niveau of NIVEAUX) {
        for (let q = 0; q <= QUANTA; q++) {
          const brut = (rayonEcranDeBraise(braise(niveau, q / QUANTA), FLAQUE_RATIO) * TILE_PX) / LIGHT_PX
          expect(Math.abs(brut - Math.round(brut))).toBeLessThan(1e-9)
        }
      }
      expect(forceDeBraise(braise(0, 1), day, 0, 0)).toBeCloseTo(1 - day, 1)
    }
  })
})

describe('B-A18 ⑪ — une torche vive DOMINE la braise (ce qui autorise la liste disjointe)', () => {
  it('⑪ les deux inégalités de CONSTANTES qui portent la preuve', () => {
    // Le sommet : la torche vaut 1 au contact dans la sim (`1 − d/P` en d = 0).
    expect(BRAISE.CLARTE_PLEINE).toBeLessThanOrEqual(1)
    // La portée, au niveau le PLUS HAUT de l'arbre — c'est là que l'inégalité est la plus serrée.
    expect(BRAISE.RAYON_BASE * multDuRayon(NIVEAU_MAX)).toBeLessThanOrEqual(LUMIERE.TORCHE_PORTEE_TUILES)
  })

  it('⑪ bis la domination, vérifiée POINT PAR POINT sur les deux profils de la sim', () => {
    const P = LUMIERE.TORCHE_PORTEE_TUILES
    let cas = 0
    let stricts = 0
    for (const niveau of NIVEAUX) {
      for (let i = 1; i <= 40; i++) {
        const b = braise(niveau, i / 40)
        for (let d = 0; d < P; d += 0.25) {
          const torche = 1 - d / P
          expect(bulleDeBraise(b, d)).toBeLessThanOrEqual(torche + 1e-12)
          cas++
          if (bulleDeBraise(b, d) < torche - 1e-9) stricts++
        }
      }
    }
    expect(cas).toBeGreaterThan(4000)
    // ⚠ ANTI-VACUITÉ : l'égalité n'arrive qu'au contact d'une braise pleine ; partout ailleurs la
    // torche est STRICTEMENT devant. Sans ce compte, un `bulleDeBraise` rendant 0 partout passerait.
    expect(stricts).toBeGreaterThan(cas * 0.9)
  })

  it('⑪ ter la marge de portée que la braise tient par son ratio', () => {
    expect(TROU_RATIO).toBeLessThan(1) // la marge que la torche tient par ses nombres
    // (La hiérarchie des trois sources, elle, vit dans ⑭ ter : elle est de PORTÉE, pas d'amplitude.)
  })
})

describe('B-A18 ⑧ — le jour éteint le halo, la charge le fait fondre', () => {
  it('⑧ en plein jour, ni force ni rayon — comme la torche (`torcheHoleRadius`)', () => {
    const b = braise(0, 1)
    expect(forceDeBraise(b, 1, 1234, 0)).toBe(0)
    expect(braiseHoleRadius(b, 1)).toBe(0) // le TROU DU VOILE s'éteint par son rayon…
    // …mais la FLAQUE et le point light gardent leur rayon et s'effacent par la force, comme
    // ceux de la torche. C'est ce qui garde le compte de cellules entier à toute heure (④ bis).
    expect(cellulesDeFlaque(b)).toBeGreaterThan(0)
    // CONTRÔLE POSITIF : la même braise, la nuit, éclaire.
    expect(forceDeBraise(b, NUIT, 1234, 0)).toBeGreaterThan(0.5)
    expect(braiseHoleRadius(b, NUIT)).toBeGreaterThan(0)
  })

  it('⑧ bis une braise vide, et une braise absente, ne rendent rien', () => {
    const vide = braise(0, 0)
    expect(forceDeBraise(vide, NUIT, 500, 0)).toBe(0)
    expect(braiseHoleRadius(vide, NUIT)).toBe(0)
    expect(forceDeBraise(undefined, NUIT, 500, 0)).toBe(0)
    expect(rayonEcranDeBraise(undefined, 1)).toBe(0)
  })

  it('⑧ ter la force est monotone en charge, et bornée à [0, 1]', () => {
    let prec = -1
    for (let i = 0; i <= 100; i++) {
      // Temps figé : on mesure la CHARGE, pas le battement.
      const f = forceDeBraise(braise(0, i / 100), NUIT, 0, 0)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(1)
      expect(f).toBeGreaterThanOrEqual(prec - 1e-12)
      prec = f
    }
    // Le plafond tient même quand `flicker` dépasse 1 (il culmine à ~1,175 avant amortissement).
    for (const t of [0, 120, 300, 640, 900, 1337, 2500]) {
      expect(forceDeBraise(braise(0, 1), NUIT, t, 0)).toBeLessThanOrEqual(1)
    }
  })
})

describe('B-A18 — l’échelle de la cave est celle de la sim, pas un second nombre', () => {
  it('la portée en cave ne dépasse jamais celle de la sim, à tout niveau et toute charge', () => {
    for (const niveau of NIVEAUX) {
      for (let i = 0; i <= 50; i++) {
        const b = braise(niveau, i / 50)
        expect(rayonEcranDeBraise(b, CAVE_RATIO)).toBeLessThanOrEqual(rayonDeBraise(b) + 1e-12)
      }
    }
  })

  it('un niveau d’arbre de plus ÉLARGIT le halo — l’arbre a bien un effet visible (B-R14)', () => {
    // À charge PLEINE, chaque niveau doit porter plus loin que le précédent, sinon
    // `RAYON_GAIN_PAR_NIVEAU` est inerte à l'écran et le second canal de B-A18 ② n'existe pas.
    const rayons = NIVEAUX.map((n) => braiseHoleRadius(braise(n, 1), NUIT))
    for (let i = 1; i < rayons.length; i++) expect(rayons[i]!).toBeGreaterThan(rayons[i - 1]!)
    // …et les crans suivent le même arbre (une seule échelle, `cransMax`).
    expect(cransMax(NIVEAU_MAX)).toBe(BRAISE.CRANS_MAX)
  })
})

describe('B-R13d — UN PORTEUR EST ÉCLAIRÉ PAR CE QU’IL PORTE (décision d’Alexis, 2026-10-05)', () => {
  /**
   * ⚠ **CETTE GARDE PASSE PAR L'ORACLE DU CHAMP, PAS PAR MES CONSTANTES**, et c'est tout son intérêt :
   * ce qu'Alexis demande (*« il doit être éclairé par sa torche ou une braise qu'il porte lui-même »*)
   * n'est pas une valeur d'amplitude mais **une propriété de la CHAÎNE** — la poussée dans `veilFires`,
   * le passage en `sourcesGi`, et le terme DIRECT du champ lu sous les pieds du corps.
   *
   * ⚠ **ET LA CHAÎNE N'EST PAS CELLE QUE J'AVAIS ÉCRITE DANS LA SPEC.** J'y avais nommé l'ordre de
   * `view.feuxGi` (dérivé avant les poussées des lumières portées) comme cause possible du symptôme.
   * **C'est faux pour un ACTEUR** : `snapshot-view.ts:1596` le pose avec `arete: 0`, donc
   * `suitLaRegleDesFaces` rend faux, donc `expositionAuFeu` rend `null`, donc `sac.expo = −1` — la
   * **branche E**. Un acteur ne lit JAMAIS le feu élu : il lit le champ sous ses pieds. `feuxGi` ne
   * touche que les corps régis par la règle des faces (fûts, socles, bâti). Et `view.clarteAt` vaut
   * `null` partout depuis LG-R3 (*« c'est le voile qui les éteint, pas une teinte recopiée. Un homme au
   * fond d'une salle noire est noir, et sa torche le sort du noir avec le sol qu'il foule »*) : le champ
   * et le trou du voile sont donc les DEUX seuls chemins, et les deux portent déjà la braise.
   *
   * Le terme direct de `champRef` n'a aucune exclusion de soi (`profil(0) = 1`, `partVisible` ≈ 1 en
   * terrain libre) : le texel du porteur reçoit le sommet de sa propre source. C'est ça qu'on affirme.
   */
  const T = LUMIERE.TEXELS_PAR_TUILE
  const PX_PAR_TEXEL = TILE_PX / T
  const G = 65
  const CENTRE = (G - 1) / 2 + 0.5

  /** La clarté moyenne que le champ dépose à `dTuiles` du porteur, source au centre d'une grille nue. */
  function clarteDuChamp(rayonTuiles: number, force: number, dTuiles: number): number {
    const g: GrilleGi = { gw: G, gh: G, occ: new Uint8Array(G * G), murs: [], albedo: new Float32Array(G * G * 3), albedoMurs: [] }
    const e = {
      x: CENTRE, y: CENTRE, rayon: (rayonTuiles * TILE_PX) / PX_PAR_TEXEL, taille: GI.TAILLE_SOURCE,
      rgb: [GI.TEINTE_FEU[0] * force, GI.TEINTE_FEU[1] * force, GI.TEINTE_FEU[2] * force] as const,
    }
    const o = champRef(g, [e], { rebond: GI.REBOND, porteeRebond: GI.PORTEE_REBOND, plafondRebond: GI.PLAFOND_REBOND, profil: profilFeu })
    const x = Math.round(CENTRE - 0.5 + dTuiles * T)
    const k = (Math.round(CENTRE - 0.5) * G + x) * 3
    return (o.light[k]! + o.light[k + 1]! + o.light[k + 2]!) / 3
  }

  const soiDeLaBraise = (b: Braise): number => {
    const r = rayonEcranDeBraise(b, TROU_RATIO)
    const f = forceDuTrouDeBraise(b)
    return r > 0 && f > 0 ? clarteDuChamp(r, f, 0) : 0
  }

  it('⑮ le texel du PORTEUR reçoit bien sa propre braise — et rien quand elle est vide', () => {
    const pleine = braiseNeuve(0)
    const soi = soiDeLaBraise(pleine)
    expect(soi).toBeGreaterThan(0) // LA DEMANDE D'ALEXIS, affirmée sur la chaîne et non sur un réglage
    // ANTI-VACUITÉ : sans source il ne reçoit rien — sinon le `> 0` ci-dessus serait un fond de champ.
    expect(soiDeLaBraise({ niveau: 0, charge: 0 })).toBe(0)
    // …et la charge le COMMANDE : à moitié de charge, moitié de clarté sur soi (le profil est linéaire
    // et son sommet est `f`, donc le sommet suit la charge exactement).
    const demi = { niveau: 0, charge: Math.floor(chargePleine(0) / 2) }
    expect(soiDeLaBraise(demi)).toBeCloseTo(soi / 2, 6)
  })

  it('⑮ bis à charge pleine, le porteur reçoit de sa braise EXACTEMENT ce qu’il recevrait d’une torche', () => {
    // La parité de ⑭ quinquies, mais mesurée À TRAVERS LE CHAMP : c'est elle qui dit que la hiérarchie
    // ne se joue pas sur la luminosité du corps. Au contact, les deux profils valent leur force, et les
    // deux forces sont `TORCHE_HOLE_FORCE` — donc l'égalité est exacte, pas approchée.
    const braisePleine = soiDeLaBraise(braiseNeuve(0))
    const torche = clarteDuChamp(TORCHE_HOLE_TILES, TORCHE_HOLE_FORCE, 0)
    expect(braisePleine).toBe(torche)
    // ET LA HIÉRARCHIE EST DANS LA PORTÉE, pas sur le corps : à 3 tuiles la braise ne donne plus rien,
    // la torche si. C'est la forme mesurable de ⑭ ter.
    expect(clarteDuChamp(rayonEcranDeBraise(braiseNeuve(0), TROU_RATIO), TORCHE_HOLE_FORCE, 3)).toBe(0)
    expect(clarteDuChamp(TORCHE_HOLE_TILES, TORCHE_HOLE_FORCE, 3)).toBeGreaterThan(0)
  })

  it('⑮ ter LA PRÉMISSE : un acteur est en branche E — il lit le champ, jamais le feu élu', () => {
    // Sans cette clause, ⑮ et ⑮ bis prouveraient une propriété du champ sans prouver que le CORPS la
    // lit. ⚠ C'est aussi la clause qui dément ce que j'avais écrit dans `braise.md` : l'ordre de
    // `feuxGi` est hors sujet pour un acteur. `arete: 0` ⇒ pas de règle des faces ⇒ `expo = −1`.
    const acteur = { x: 100, y: 100, arete: 0 as const, lift: 0 }
    expect(suitLaRegleDesFaces(acteur)).toBe(false)
    expect(expositionAuFeu(acteur, { x: 108, y: 100 })).toBeNull()
    // CONTRÔLE POSITIF : un fût, lui, EST régi — donc `expositionAuFeu` rend un nombre, et c'est bien
    // la règle des faces qui fait le tri, pas un `null` rendu à tout le monde.
    expect(expositionAuFeu({ x: 100, y: 100, arete: 1, lift: 0, fut: true }, { x: 108, y: 100 })).not.toBeNull()
    // …et le corps n'a plus de teinte de clarté à part : le champ et le voile sont les deux seuls
    // chemins (LG-R3). Une garde de SOURCE, le CSS du tri étant hors de portée de `tsc`.
    const src = readFileSync(new URL('../scenes/WorldScene.ts', import.meta.url), 'utf8')
    expect(src).toContain('this.view.clarteAt = null')
  })
})

describe('B-A18 — LES CINQ POINTS DE CÂBLAGE sont branchés (garde de SOURCE)', () => {
  // ⚠ Le titre disait QUATRE jusqu'au 2026-10-05 : les quatre premiers points mettent la TERRE
  // en lumière, et aucun ne touchait le CORPS — c'est ⑤ (B-R13d) qui est le cinquième.
  // ⚠ POURQUOI UNE GARDE DE SOURCE ET NON UN TEST DE COMPORTEMENT : retirer
  // `this.braiseGround?.update(...)` ou la poussée dans `veilFires` COMPILE sans un mot, et
  // monter une `WorldScene` complète en headless demande Phaser, un canvas et une carte. La loi
  // est éprouvée par les gardes ci-dessus et par `/sim` ; ce qui reste à prouver, c'est qu'elle
  // est bien APPELÉE aux quatre endroits que `braise.md` étape 7 nomme. Le même patron que la
  // garde L6 d'`etat-gel-lumiere.test.ts`, et pour la même raison : une chaîne qu'aucun `tsc`
  // ne relit. ⚠ C'est une garde de PRÉSENCE : elle dit que le câble existe, jamais qu'il porte
  // la bonne lumière — ça, c'est la mesure à l'image (`da-rendu`).
  const lire = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8')

  it('① le voile de nuit ET la GI de surface — la même liste `veilFires`, comme les torches', () => {
    const src = lire('../scenes/WorldScene.ts')
    expect(src).toContain('const porteursBraise = this.porteursDeBraise()')
    expect(src).toContain('braiseHoleRadius(p.braise, day)')
    // La poussée se fait dans `veilFires`, et c'est cette liste que lisent le trou du voile ET
    // `sourcesGi` (le CHAMP de la GI) — donc un seul `push` sert les deux couches.
    const iPousse = src.indexOf('const prof = forceDuTrouDeBraise(p.braise)')
    const iSourcesGi = src.indexOf('const sourcesGi:')
    expect(iPousse).toBeGreaterThan(0)
    expect(iSourcesGi).toBeGreaterThan(iPousse) // le champ lit la liste APRÈS la poussée
    // ⚠ ET CE QUE CETTE GARDE NE DEMANDE PAS, PARCE QUE C'EST UNE FOURCHE OUVERTE ET NON UNE LOI.
    // `this.view.feuxGi` — la liste de la passe des CORPS (LG-R7) — est dérivée AVANT les poussées
    // des lumières portées, délibérément (« la même liste, en logique, avant les torches »). Donc
    // le corps d'un porteur ne reçoit AUCUN terme directionnel de ce qu'il porte : il n'a que le
    // champ plat. ⚠ J'avais écrit ici que cet ordre « met la braise dans le voile ET dans le champ
    // sans la compter deux fois » — c'est vrai du champ de SURFACE et FAUX de la passe des corps,
    // qui est la seule à lire `feuxGi`. **Le trou vaut pour la TORCHE autant que pour la braise**,
    // donc le corriger est une décision de JEU (un porteur de torche devient visible de nuit) et
    // elle est pour Alexis. La garde affirme donc l'ordre tel qu'il est, sans le prescrire :
    const iFeuxGi = src.indexOf('this.view.feuxGi =')
    expect(iFeuxGi).toBeGreaterThan(0)
    expect(iFeuxGi).toBeLessThan(iPousse) // l'état CONSTATÉ, à rouvrir si la fourche se tranche
  })

  it('② la flaque au sol — la seule couche qui CUIT le rayon', () => {
    expect(lire('../scenes/WorldScene.ts')).toContain('this.braiseGround?.update(porteursBraise, day, time)')
  })

  it('③ le voile de cave ET la GI du creux — à `day` 0, sous terre il fait nuit à toute heure', () => {
    const ws = lire('../scenes/WorldScene.ts')
    expect(ws).toContain('rayonEcranDeBraise(moi.braise, CAVE_RATIO)')
    expect(ws).toContain('forceDeBraise(moi.braise, 0, time, moi.id * 2.9)')
    expect(ws).toContain('if (lum.braise && lum.braise.force > 0)')
    const cv = lire('../scenes/world/cave-veil.ts')
    expect(cv).toContain('percer(this.torche, lum.braise.x, lum.braise.y, TORCHE_PIC * lum.braise.force, lum.braise.echelle)')
  })

  it('④ Light2D — et le `0` de sous terre, sans quoi la source est éteinte à midi dans une salle', () => {
    const dl = lire('../scenes/world/dynamic-lighting.ts')
    expect(dl).toContain('const jour = sousTerre ? 0 : day')
    expect(dl).toContain('rayonEcranDeBraise(p.braise, LIGHT_RATIO)')
    // Le budget du `LightsManager` est ENTIÈREMENT réparti : la borne doit exister.
    expect(dl).toContain('const BRAISE_MAX = 3')
    expect(dl).toContain('if (nB >= BRAISE_MAX) break')
  })

  it('⑤ LE CORPS DU PORTEUR (B-R13d) — la loi vient de `/sim`, et le shader ne peut pas dériver de l’oracle', () => {
    // ⚠ **LE CINQUIÈME POINT DE CÂBLAGE, et il a été écrit APRÈS les quatre autres** : les quatre
    // premiers mettent la TERRE en lumière, aucun ne touche le CORPS. D'où *« non le personnage
    // est sombre comme s'il n'était pas éclairé »* (Alexis, 2026-10-05) sur une chaîne par
    // ailleurs juste. La valeur, elle, est éprouvée dans `gi/passe-corps.test.ts` ⑯→⑱ ; ici on
    // garde LE CÂBLE, et le câble a quatre maillons.
    //
    // ① LA SOURCE DU NOMBRE EST L'AUTORITÉ, et le rendu ne le recalcule pas : c'est la promesse
    // « zéro constante neuve » de l'option qu'Alexis a choisie, et c'est ce qui rend N2bis vrai
    // par construction (un minorant pris sur l'autorité ne peut pas la dépasser).
    const ws = lire('../scenes/WorldScene.ts')
    expect(ws).toContain('clarteDeCeQuOnPorte(torcheVive(e) !== null, e.braise)')
    expect(ws).toContain('this.view.soiParCorps =')
    // ② IL N'EST ALIMENTÉ QUE SUR LA POSE D'UN ACTEUR — c'est là, et NULLE PART dans la passe,
    // que la loi se restreint aux porteurs (voir `passe-corps.test.ts` ⑱, qui a démenti mon
    // énoncé d'origine : le plancher se pose en ②bis, avant le choix de branche).
    const sv = lire('../scenes/world/snapshot-view.ts')
    expect(sv).toContain('this.soiParCorps?.get(corpsId) ?? 0') // résolu PAR LA VUE (voir ⑥)
    expect(sv).toContain('arete: 0, lift, soi }')
    expect(sv).toContain('sac.soi = corps.soi ?? 0')
    // ③ IL VOYAGE SANS COÛTER UN ATTRIBUT : le quatrième composant d'`inGiB` était un `0` de
    // bourrage. Si quelqu'un y remet un `0`, le corps redevient noir SANS QU'AUCUN `tsc` ne le
    // voie — et la garde de valeur, qui appelle l'oracle CPU, resterait verte.
    expect(lire('./gi/noeud-corps.ts')).toContain('F[o++] = c.soi')
    expect(lire('./gi/corps-gpu.ts')).toContain('float soi = outGiB.w;')
    // ④ LE SHADER ET L'ORACLE NE PEUVENT PAS DÉRIVER — et c'est le maillon qui se garde le plus
    // mal, parce que le GLSL ne tourne pas ici : `pixelDuCorps` est un MIROIR CPU du shader, et
    // deux écritures d'une même loi divergent dès qu'on retouche l'une. On ne se contente donc
    // pas d'un `toContain` : on relit la TEINTE écrite dans le GLSL et on la compare chiffre à
    // chiffre à celle que l'oracle emploie.
    const gpu = lire('./gi/corps-gpu.ts')
    expect(gpu).toContain('L = max(L, vec3(${TEINTE_FEU_GLSL}) * soi);') // `max` par canal, comme `/sim`
    expect(gpu).toContain("const TEINTE_FEU_GLSL = GI.TEINTE_FEU.map((v) => v.toFixed(6)).join(', ')")
    // La teinte compilée, telle qu'un GPU la lirait — six décimales, point décimal obligatoire en
    // GLSL ES 1.0, et le MÊME tableau que l'oracle.
    const compilee = GI.TEINTE_FEU.map((v) => v.toFixed(6)).join(', ')
    expect(compilee).toBe('1.150000, 0.920000, 0.620000')
    for (const n of compilee.split(', ')) expect(n).toContain('.') // sinon le shader ne compile pas
    expect(avecCeQuOnPorte([0, 0, 0], 1)).toEqual([...GI.TEINTE_FEU]) // l'oracle emploie la même
  })


  it('⑦ LA PORTE DU PLANCHER NE COMPTE QUE LE SOLEIL (§ 5.28 ⓒ) — et c’est une garde de SOURCE parce que la porte vit dans une boucle Phaser', () => {
    // ⚠ POURQUOI UNE GARDE DE SOURCE, et pourquoi elle est nécessaire ici : la porte se calcule
    // dans `WorldScene.update`, qu'aucun test headless ne fait tourner. La LOI, elle, est dans
    // `/sim` et y est éprouvée pour de vrai (`nuit.test.ts` C3 bis/ter/quater, dont la
    // falsification « la lune revient » rougit) ; ce qui ne peut se garder qu'ICI, c'est le
    // CÂBLE — et c'est exactement la classe de défaut du 2026-10-05, où la loi était juste et ne
    // parvenait pas au seul corps qui existe en solo.
    const ws = lire('../scenes/WorldScene.ts')
    // ① La porte lit le SOLEIL SEUL. Si quelqu'un remet `clarteDuCiel` ici, la pleine lune
    //   rachète le plancher et le porteur redevient sombre 13 nuits sur 30 — sans qu'un `tsc`
    //   ni aucune garde de valeur ne s'en aperçoive (les deux lectures coïncident à midi, la
    //   seule heure qu'un test de rendu regarde d'habitude).
    expect(ws).toContain('clarteDuSoleil(gel, this.lastSnapshotTick)')
    // ② …et c'est bien CETTE ligne-là, celle qui nourrit `soiParCorps`, et pas une autre lecture
    //   du ciel : le bloc est découpé entre l'affectation et sa publication.
    const bloc = ws.slice(ws.indexOf('const cielDeLHeure ='), ws.indexOf('this.view.soiParCorps ='))
    expect(bloc).toContain('cielDeLHeure * partDuCiel(')
    expect(bloc).not.toContain('clarteDuCiel(')
    // ③ ⚠ ET L'AUTORITÉ DE LA VISION NE BOUGE PAS : `clarteDuCiel` reste ce que lisent le voile
    //   et la gueule des caves — une pleine lune éclaire, et la parade le sait. Le fichier doit
    //   donc continuer à l'employer AILLEURS ; s'il ne le faisait plus, c'est que la correction
    //   aurait débordé de la porte sur toute la nuit du jeu.
    //   Le lecteur qui doit SURVIVRE est nommé : la lumière du dehors vue par la gueule d'une
    //   cave, où la pleine lune compte à juste titre.
    expect(ws).toContain('ciel: this.etatGel ? clarteDuCiel(this.etatGel, this.lastSnapshotTick) : 1')
  })

  it('⑥ TOUS LES CORPS POSÉS DISENT QUI ILS SONT — l’exhaustivité, parce qu’un appelant sur trois avait oublié', () => {
    // ⚠⚠ **C'EST LA GARDE QUI MANQUAIT, ET SON ABSENCE A COÛTÉ LA LIVRAISON.** ⑤ ci-dessus suit
    // le chemin `others` maillon par maillon — production, consommation, attribut, GLSL — et il
    // était JUSTE. Mais l'avatar local ne passe pas par `others` (prédiction locale,
    // `playerSprite`), et ses **trois** appels de `syncActor` omettaient le paramètre de queue :
    // `soiParCorps` contenait bien l'entrée du joueur (**0,9611** à minuit, braise pleine, relevé
    // en page par `da-rendu`), `syncActor` la jetait. **B-R13d atteignait tous les corps sauf le
    // seul qui existe en solo**, et c'était littéralement le symptôme d'Alexis.
    //
    // **La leçon, qui dépasse la braise** : *une garde de source qui suit UN chemin verdit sur une
    // loi livrée avec un appelant sur deux* — et le chemin non couvert est souvent le seul joué.
    // D'où une garde d'**EXHAUSTIVITÉ** : on ne suit plus un chemin, on énumère **tous** les
    // sites de pose et on exige que chacun DISE quel corps il pose. Un site neuf qui se taira
    // fera rougir ici, et non à l'image six heures plus tard.
    //
    // *(Le correctif, lui, est structurel : la vue RÉSOUT `soi` elle-même depuis l'id — un
    // appelant ne peut plus se tromper que d'une façon, en ne disant pas quel corps il pose, ce
    // qui est un énoncé et non un oubli silencieux.)*
    const sv = lire('../scenes/world/snapshot-view.ts')
    const ws = lire('../scenes/WorldScene.ts')
    expect(sv).toContain('const soi = corpsId !== undefined ? this.soiParCorps?.get(corpsId) ?? 0 : 0')
    // L'ÉNUMÉRATION : chaque appel de `syncActor`, dans les deux fichiers, avec son 9ᵉ argument.
    //
    // ⚠ Le découpage se fait à la PROFONDEUR ZÉRO : un argument comme
    // `this.reveilFx?.enfouissementDe(id, now) ?? 0` contient une virgule, et un `split(',')`
    // naïf comptait dix arguments pour neuf — ma première version a rougi là-dessus.
    const appelsDe = (src: string): string[][] => {
      const out: string[][] = []
      const re = /\bsyncActor\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        let i = m.index + m[0].length
        let prof = 1
        const args: string[] = []
        let cur = ''
        for (; i < src.length && prof > 0; i++) {
          const c = src[i]!
          if (c === '(' || c === '[') prof++
          else if (c === ')' || c === ']') { prof--; if (prof === 0) break }
          if (prof === 1 && c === ',') { args.push(cur.trim()); cur = '' } else cur += c
        }
        if (cur.trim() !== '') args.push(cur.trim())
        // La DÉCLARATION (et les mentions en commentaire) n'ont pas de premier argument-sprite.
        if (args.length > 1 && !args[0]!.includes(':')) out.push(args)
      }
      return out
    }
    //
    // ⚠⚠ ET LE BALAYAGE PORTE SUR TOUT `packages/client/src`, PAS SUR DEUX FICHIERS NOMMÉS.
    // Ma première version ne lisait que `snapshot-view` et `WorldScene` — c'est-à-dire qu'elle
    // reproduisait, dans la garde censée fermer le défaut, **l'angle mort exact du défaut** :
    // un appel dans un troisième fichier aurait le même silence. Il en existe un
    // (`atelier/scene.ts`), et il est LÉGITIME : voir la clause des exceptions plus bas.
    const racine = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '') // ⚠ sinon un `//` double
    const fichiers: string[] = []
    const descendre = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const chemin = `${dir}/${e.name}`
        if (e.isDirectory()) descendre(chemin)
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) fichiers.push(chemin)
      }
    }
    descendre(racine)
    expect(fichiers.length).toBeGreaterThan(100) // PRÉMISSE : l'arbre a bien été parcouru
    const parFichier = fichiers
      .map((f) => ({ f, appels: appelsDe(readFileSync(f, 'utf8')) }))
      .filter((x) => x.appels.length > 0)
    // PRÉMISSE du balayage : les fichiers qui appellent `syncActor`, nommément. Un quatrième
    // fichier fait rougir ICI — c'est le point : on ne peut pas en ajouter un en silence.
    expect(new Set(parFichier.map((x) => x.f.replace(`${racine}/`, '')))).toEqual(
      new Set(['scenes/world/snapshot-view.ts', 'scenes/WorldScene.ts', 'atelier/scene.ts']),
    )
    const appels = parFichier.flatMap((x) => x.appels.map((a) => ({ fichier: x.f.replace(`${racine}/`, ''), args: a })))
    for (const { fichier, args } of appels) {
      if (fichier === 'atelier/scene.ts') {
        // ⚠ LA SEULE EXCEPTION, ET ELLE EST UN ÉNONCÉ : le pion de l'Atelier n'est pas une
        // entité de la sim — il n'a pas d'id, donc rien à porter. `corpsId` absent ≡ pas de
        // plancher, exactement ce que dit la signature. Qu'il soit SEUL dans ce cas est affirmé.
        expect(args.length).toBeLessThan(9)
        expect(args[3]).toBe("'spr-player'")
        continue
      }
      expect(args.length).toBe(9) // aucun ne s'arrête avant de dire QUI
      // …et le dernier est un id de corps, pas un nombre posé à la main.
      expect(args[8]).toMatch(/^(id|entityId|entity\.id|this\.playerId)$/)
    }
    expect(appels.filter((a) => a.args.length === 9).length).toBe(7) // 4 dans la vue, 3 pour le joueur
    // …et l'exception est COMPTÉE, sinon le commentaire ci-dessus affirmerait ce que rien ne lit.
    expect(appels.filter((a) => a.fichier === 'atelier/scene.ts').length).toBe(1)
    // LES TROIS DU JOUEUR, NOMMÉMENT — c'est eux qui manquaient, et le défaut était invisible
    // parce qu'AUCUN test du client ne mentionne `playerSprite`.
    expect([...ws.matchAll(/this\.view\.syncActor\(this\.playerSprite[^;]*?this\.playerId\)/g)].length).toBe(3)
  })

})
