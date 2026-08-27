/**
 * LE VENT DANS LE DÉCOR — ce que les brins disent du vent, et ce qu'ils ne peuvent pas dire.
 *
 * `windSway` est une fonction pure du lieu, de l'instant, du cap et de la FORCE. Chacune de ces
 * quatre entrées porte une promesse de jeu, et chacune se démontre : le calme plat ne remue
 * rien (C17 en dépend — un monde sans vent ne trahit personne), le brin penche du côté où le
 * vent pousse, et depuis le 2026-08-25 il plie D'AUTANT PLUS QUE LE VENT EST FORT.
 */
import { describe, expect, it } from 'vitest'
import { VENT } from '@ashes/sim'
import { windStretch, windSway, WIND_TAKE } from './wind'
import { VentLisse } from '../scenes/world/vent-lisse'

const EST = { x: 1, y: 0 }
const OUEST = { x: -1, y: 0 }
/** Une touffe d'herbe : la prise de référence. */
const TAKE = WIND_TAKE.grass_tuft!

/**
 * L'inclinaison MOYENNE — l'oscillation s'y annule, l'assiette reste.
 *
 * ⚠ LA FENÊTRE DOIT COUVRIR LES DEUX PÉRIODES. Sur une seconde, l'onde (≈ 3 s) et la bouffée
 * (≈ 18 s) laissent un résidu de 0,05 rad — plus gros que l'assiette qu'on veut mesurer, et le
 * signe en dépend de l'instant choisi. On balaie 180 s : soixante ondes, dix bouffées.
 */
function assiette(wind: { x: number; y: number }, force: number, take = TAKE): number {
  let somme = 0
  const N = 6000
  const FENETRE_MS = 180_000
  for (let i = 0; i < N; i++) somme += windSway(12.5, 7.25, (i * FENETRE_MS) / N, take, wind, force)
  return somme / N
}

describe('la force du vent plie le décor (2026-08-25)', () => {
  it('à L’AMBIANCE, le décor est celui d’avant — au bit près', () => {
    // La garde qui protège la modification : hors front, `windForce` vaut exactement `AMBIANT`,
    // donc la part est nulle et le facteur vaut 1. Un monde sans météo ne doit pas bouger d'un
    // pixel — sans quoi on ne saurait pas si un écart vu ailleurs vient du vent.
    for (let t = 0; t < 5000; t += 137) {
      const avant = windSway(12.5, 7.25, t, TAKE, EST, VENT.AMBIANT)
      const parDefaut = windSway(12.5, 7.25, t, TAKE, EST)
      expect(avant, `t = ${t}`).toBeCloseTo(parDefaut, 12)
    }
  })

  it('plus le vent est fort, plus le brin penche — sur TOUTE la pente, pas à deux points', () => {
    let precedent = -Infinity
    for (let f = VENT.AMBIANT; f <= 1.0001; f += 0.02) {
      const a = assiette(EST, Math.min(1, f))
      expect(a, `force ${f.toFixed(2)}`).toBeGreaterThanOrEqual(precedent - 1e-9)
      precedent = a
    }
    // Et l'écart se VOIT : au cœur d'une bande, l'assiette dépasse d'au moins moitié celle de
    // l'ambiance. Une pente monotone mais imperceptible ne serait pas la demande.
    expect(assiette(EST, 1)).toBeGreaterThan(assiette(EST, VENT.AMBIANT) * 1.4)
  })

  it('le brin penche du côté où le vent POUSSE, à toute force', () => {
    for (const f of [VENT.AMBIANT, 0.7, 1]) {
      expect(assiette(EST, f), `est, force ${f}`).toBeGreaterThan(0)
      expect(assiette(OUEST, f), `ouest, force ${f}`).toBeLessThan(0)
    }
  })

  it('CALME PLAT : rien ne penche, rien n’oscille — quelle que soit la force annoncée', () => {
    // Le contrat que la chasse consomme (C17) : un monde dont le vent est le vecteur nul n'a pas
    // de vent, et l'odorat n'y trahit personne. La force ne doit pas pouvoir le rouvrir.
    for (const f of [0, VENT.AMBIANT, 1]) {
      for (let t = 0; t < 4000; t += 311) {
        expect(windSway(3, 4, t, TAKE, { x: 0, y: 0 }, f), `force ${f}, t = ${t}`).toBe(0)
      }
    }
  })

  it('ce qui ne prend pas le vent ne bouge JAMAIS — un caillou ne frémit pas sous un front', () => {
    for (const f of [VENT.AMBIANT, 1]) {
      for (let t = 0; t < 4000; t += 291) expect(windSway(9, 9, t, 0, EST, f)).toBe(0)
    }
  })

  it('un vent plein nord ne penche aucun brin — c’est le STRETCH qui le dit, pas la rotation', () => {
    // Une rotation de billboard ne sait pencher qu'à gauche ou à droite : un cap nord-sud n'a
    // pas de composante horizontale à montrer. Ce zéro n'est donc pas un défaut, c'est un
    // PARTAGE : la hauteur apparente porte le nord-sud (`windStretch`, gardé plus bas), la
    // rotation porte l'est-ouest. Les deux ne doivent jamais parler du même cap à la fois.
    // Le seuil se lit contre ce qu'on mesure : à pleine force, l'assiette d'un cap d'est vaut
    // ~0,14 rad. Dix fois moins, c'est « aucune assiette ».
    expect(Math.abs(assiette({ x: 0, y: 1 }, 1))).toBeLessThan(assiette(EST, 1) / 10)
    expect(Math.abs(assiette({ x: 0, y: -1 }, 1))).toBeLessThan(assiette(EST, 1) / 10)
    // Mais il OSCILLE toujours : la rafale traverse la carte dans son sens, elle ne s'arrête pas.
    let bouge = false
    for (let t = 0; t < 4000; t += 97) if (Math.abs(windSway(12.5, 7.25, t, TAKE, { x: 0, y: 1 }, 1)) > 1e-3) bouge = true
    expect(bouge, 'un cap nord fige le décor : ce n’est pas la limite qu’on accepte').toBe(true)
  })
})

describe('le stretch — ce qu’un billboard dit d’un vent nord-sud (essai, 2026-08-25)', () => {
  const NORD_VERS_SUD = { x: 0, y: 1 }   // le vent POUSSE vers le bas de l'écran
  const SUD_VERS_NORD = { x: 0, y: -1 }

  it('vers le BAS ça tasse, vers le HAUT ça tire — et les deux se distinguent', () => {
    // Toute la raison d'être de ce facteur : un raccourci PAIR (le vrai cosinus) ne dirait rien
    // d'une direction, or c'est une direction qu'on demande de montrer.
    expect(windStretch(TAKE, NORD_VERS_SUD, 1)).toBeLessThan(1)
    expect(windStretch(TAKE, SUD_VERS_NORD, 1)).toBeGreaterThan(1)
  })

  it('un vent d’EST ou d’OUEST ne touche pas la hauteur — c’est la rotation qui le dit', () => {
    // Sans quoi les deux gestes se cumuleraient sur le même cap et le brin plierait deux fois.
    for (const f of [VENT.AMBIANT, 0.7, 1]) {
      expect(windStretch(TAKE, EST, f), `est, force ${f}`).toBe(1)
      expect(windStretch(TAKE, OUEST, f), `ouest, force ${f}`).toBe(1)
    }
  })

  it('la FORCE creuse l’écart — sur toute la pente, pas à deux points', () => {
    let precedent = Infinity
    for (let f = VENT.AMBIANT; f <= 1.0001; f += 0.02) {
      const e = windStretch(TAKE, NORD_VERS_SUD, Math.min(1, f))
      expect(e, `force ${f.toFixed(2)}`).toBeLessThanOrEqual(precedent + 1e-9)
      precedent = e
    }
    expect(windStretch(TAKE, NORD_VERS_SUD, 1)).toBeLessThan(windStretch(TAKE, NORD_VERS_SUD, VENT.AMBIANT))
  })

  it('CALME PLAT et PRISE NULLE rendent 1 tout rond — un caillou ne s’étire pas', () => {
    for (const f of [0, VENT.AMBIANT, 1]) {
      expect(windStretch(TAKE, { x: 0, y: 0 }, f), `calme, force ${f}`).toBe(1)
      expect(windStretch(0, NORD_VERS_SUD, f), `prise 0, force ${f}`).toBe(1)
    }
  })

  it('BORNÉ sur TOUT le domaine — aucune prise, aucun cap, aucune force n’écrase le brin', () => {
    // Le roseau prend 1,3 et la force multiplie encore : sans borne, l'illusion sort du domaine
    // où elle tient (un brin deux fois plus haut n'est plus un brin couché, c'est un défaut).
    // On balaie les prises réelles du registre × 16 caps × la pente de force.
    for (const take of Object.values(WIND_TAKE)) {
      for (let a = 0; a < 16; a++) {
        const wind = { x: Math.cos((a * Math.PI) / 8), y: Math.sin((a * Math.PI) / 8) }
        for (let f = VENT.AMBIANT; f <= 1.0001; f += 0.05) {
          const e = windStretch(take, wind, Math.min(1, f))
          expect(e, `take ${take}, cap ${a}, force ${f.toFixed(2)}`).toBeGreaterThanOrEqual(0.7)
          expect(e).toBeLessThanOrEqual(1.3)
        }
      }
    }
  })
})


/**
 * ═══ LE TREMBLEMENT SE COMPTE EN IMAGES (Alexis, 2026-08-25) ═══
 *
 * *« Les houppiers et les plantes tremblent encore plus qu'avant dès qu'il y a un changement de
 * direction du vent. »* — sur le premier correctif du jour, qui donnait au décor un cap RALLIÉ.
 *
 * ⚠ CE FICHIER EST LA LEÇON. La garde écrite le matin mesurait le CAP (`vent-lisse.test.ts` :
 * `cap.x` ne saute pas d'une image à l'autre) et elle était VERTE pendant qu'Alexis regardait la
 * carte trembler. Un cap continu ne fait pas une assiette continue : entre les deux il y a une
 * projection de la position ABSOLUE sur ce cap, et loin de l'origine elle amplifie tout. **Ce qui
 * se juge, c'est le SWAY** — la valeur que le sprite reçoit — et il faut le juger LÀ OÙ LE JEU SE
 * JOUE, pas à l'origine du repère.
 *
 * Et on compte les IMAGES AGITÉES, pas le pic : un pic d'une image est un tic, deux cents images
 * d'affilée sont un tremblement. MESURÉ au centre du plateau (790, 426) pendant un virage :
 * 1 image agitée avant le chantier · **227 avec le cap rallié partout** · 1 avec le partage.
 */
describe('le décor ne tremble pas quand le vent tourne', () => {
  const NORD_EST = { x: Math.SQRT1_2, y: -Math.SQRT1_2 }
  /** Au-delà de cet écart entre deux images, l'œil voit la tige BOUGER (rad). */
  const AGITE = 0.01
  /** Le centre du plateau joué (1581 × 852) — l'endroit où le défaut se voyait. Pas l'origine :
   *  à (8, 8) la projection est nulle et TOUTES les lois se valent (la garde ne garderait rien). */
  const [CX, CY] = [790, 426]

  /** Le cap rallié image par image, tel que `VentLisse` le rend — la vraie loi, pas une rampe. */
  function capsRallies(n: number): { x: number; y: number }[] {
    const v = new VentLisse()
    for (let i = 0; i < 400; i++) v.update(i * 16, 16, EST, 1)
    const out: { x: number; y: number }[] = []
    for (let i = 0; i < n; i++) { v.update(i * 16, 16, i < 60 ? EST : NORD_EST, 1); out.push({ ...v.cap }) }
    return out
  }

  function imagesAgitees(tx: number, ty: number, take: number): number {
    const N = 1500
    const caps = capsRallies(N)
    const onde = (i: number): { x: number; y: number } => (i < 60 ? EST : NORD_EST) // le cap de la sim, par crans
    let prec = windSway(tx, ty, 0, take, caps[0]!, 1, onde(0))
    let n = 0
    for (let i = 1; i < N; i++) {
      const s = windSway(tx, ty, i * 16, take, caps[i]!, 1, onde(i))
      if (Math.abs(s - prec) > AGITE) n += 1
      prec = s
    }
    return n
  }

  it('au centre du plateau, un virage n’agite pas plus de quelques images', () => {
    // Le houppier (`CROWN_WIND_TAKE`) et le roseau (la prise la plus forte de la table) :
    // c'est la prise qui multiplie l'écart, donc c'est elle qui décide du pire cas.
    expect(imagesAgitees(CX, CY, 0.5), 'un houppier tremble').toBeLessThan(5)
    expect(imagesAgitees(CX, CY, WIND_TAKE.reed!), 'un roseau tremble').toBeLessThan(5)
    // ET PLUS LOIN ENCORE — le défaut CROISSAIT avec la distance à l'origine.
    expect(imagesAgitees(1500, 800, WIND_TAKE.reed!), 'le lointain tremble').toBeLessThan(5)
  })

  it('LA PRÉMISSE : sans le partage des deux caps, ces mêmes images sont bien agitées', () => {
    // ⚠ SANS CETTE GARDE, LA PRÉCÉDENTE PEUT DEVENIR VERTE PAR ACCIDENT — il suffirait que le
    //   montage cesse de faire tourner le vent. On affirme donc que le défaut est REPRODUCTIBLE
    //   dès qu'on rend son cap continu à l'onde : c'est la seule preuve que le test a un sujet.
    const N = 1500
    const caps = capsRallies(N)
    let prec = windSway(CX, CY, 0, WIND_TAKE.reed!, caps[0]!, 1, caps[0]!)
    let n = 0
    for (let i = 1; i < N; i++) {
      const s = windSway(CX, CY, i * 16, WIND_TAKE.reed!, caps[i]!, 1, caps[i]!)
      if (Math.abs(s - prec) > AGITE) n += 1
      prec = s
    }
    expect(n, 'le défaut ne se reproduit plus : ce test ne prouve plus rien').toBeGreaterThan(100)
  })

  it('et l’ASSIETTE, elle, reste continue — c’est le défaut du matin, il ne revient pas', () => {
    // L'inclinaison de fond seule (`take` porté par un prop sans oscillation mesurable) : on la
    // lit à l'instant 0 pour neutraliser l'onde, et on suit sa pente le long du virage.
    const caps = capsRallies(1500)
    let prec = BASE_LEAN_TEST(caps[0]!)
    let pire = 0
    for (let i = 1; i < 1500; i++) {
      const cur = BASE_LEAN_TEST(caps[i]!)
      pire = Math.max(pire, Math.abs(cur - prec))
      prec = cur
    }
    expect(pire, 'l’assiette saute encore').toBeLessThan(0.002)
  })

  /** L'inclinaison de fond que `windSway` applique : `BASE_LEAN × take × wx × prise`. On la
   *  reconstruit ici plutôt que d'exporter la constante — ce qu'on garde est la CONTINUITÉ. */
  function BASE_LEAN_TEST(cap: { x: number; y: number }): number {
    const n = Math.sqrt(cap.x * cap.x + cap.y * cap.y) || 1
    return (cap.x / n) * WIND_TAKE.reed!
  }
})
