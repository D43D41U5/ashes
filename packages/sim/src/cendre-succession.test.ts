/**
 * LES GARDES DE LA SUCCESSION ET DU CARACTÈRE DE FOYER (spec `cendre.md` A17-A24).
 *
 * Deux décisions d'Alexis du 2026-08-27 :
 *   R20 — le cœur de la cendre se coupe en TROIS bandes de plus, comptées en TUILES et non en
 *         jours (un seuil en jours donne un anneau qui maigrit : mesuré 37 tuiles au j.120,
 *         3,1 au j.1200, et 1 sur la roche).
 *   R21 — les dix fosses ne rendent pas la même cendre : quatre portent un caractère UNIQUE.
 *
 * Elles tournent sur le VRAI monde partout où la propriété est géographique — une carte uniforme
 * ne dirait rien de la roche qui raccourcit les bandes ni de la part réelle d'un foyer.
 */
import { describe, expect, it } from 'vitest'
import {
  BANDE_CROUTE, BANDE_FRANGE, BANDE_HORS, BANDE_NUE, BANDE_VIEILLE,
  CARACTERES_DE_FOYER, CENDRE, ORDRE_DES_CARACTERES,
  auCoeurDeLaCendre, avanceesDepuisAges, bandeDeCendre, cadranDeFoyer, caracteresDeLaCarte,
  caracteresDesFoyers, coutDe, estCendre, foyerDe, foyerDeLaTuile, foyerDuSol, foyersDeLaCarte,
  froidDeCendre, profondeurDeCendre, profondeurNueDeCendre, rampeDeSuccession,
  type CaractereDeFoyer, type EffetsDeFoyer,
} from './cendre'
import { BALANCE, MORTS, NIGHT_HUNT, TEMPERATURE, TERRAIN_GRASS } from './balance'
import { FUMEROLLE, toutesLesFumerolles } from './fumerolle'
import { AMBIANT_HYPOTHERMIE, baselineTemperatureAt } from './temperature'
import { createSim, type SimState } from './sim'
import { createEmptyMap } from './map'
import { advanceLieuxBrules, densiteDeBase, densiteDesMorts, rodeursPortes } from './morts'
import { cycleOffsetForStartHour, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY } from './time'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
const monde = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
const map = monde.map
const foyers = foyersDeLaCarte(map)
const REVEIL = (CENDRE.ACTE_DEPART - 1) * BALANCE.ACT_DAYS + 1

const auJour = (jour: number): number[] =>
  avanceesDepuisAges(foyers.map(() => Math.max(0, jour - REVEIL)), foyers.length)

/** La part de chaque bande, au pas de 2 — la carte fait 1,3 M de tuiles. */
function parBande(jour: number): { part: number[]; total: number } {
  const av = auJour(jour)
  const part = [0, 0, 0, 0]
  let total = 0
  for (let ty = 0; ty < map.height; ty += 2) {
    for (let tx = 0; tx < map.width; tx += 2) {
      const b = bandeDeCendre(map, tx, ty, av, SEED)
      if (b === BANDE_HORS) continue
      part[b] = (part[b] ?? 0) + 1
      total += 1
    }
  }
  return { part, total }
}

describe('A17 — les bandes sont un ORDRE, et il ne peut pas se contredire', () => {
  it('les seuils sont strictement croissants', () => {
    expect(CENDRE.FRANGE_TUILES).toBeLessThan(CENDRE.NUE_TUILES)
    expect(CENDRE.NUE_TUILES).toBeLessThan(CENDRE.CROUTE_TUILES)
  })

  it('la bande est une fonction MONOTONE de la profondeur, balayée sur tout le domaine', () => {
    // Garde EXHAUSTIVE (mémoire : géométrie = balayer l'espace, pas des cas choisis). On relève
    // le couple (profondeur, bande) sur toute la carte et on affirme UNE propriété : plus
    // profond ne rend jamais une bande plus jeune.
    const av = auJour(600)
    const pireParBande = [-Infinity, -Infinity, -Infinity, -Infinity]
    const minParBande = [Infinity, Infinity, Infinity, Infinity]
    let vus = 0
    for (let ty = 0; ty < map.height; ty += 3) {
      for (let tx = 0; tx < map.width; tx += 3) {
        const b = bandeDeCendre(map, tx, ty, av, SEED)
        if (b === BANDE_HORS) continue
        const p = profondeurDeCendre(map, tx, ty, av, SEED)
        vus += 1
        if (p > pireParBande[b]!) pireParBande[b] = p
        if (p < minParBande[b]!) minParBande[b] = p
      }
    }
    expect(vus, 'la carte doit porter de la cendre au jour 600').toBeGreaterThan(1000)
    // La plus profonde tuile d'une bande est toujours moins profonde que la moins profonde de la
    // suivante. Une seule affirmation, et elle ferme les quatre bandes d'un coup.
    for (let b = 0; b < 3; b++) {
      expect(pireParBande[b], `bande ${b} déborde sur ${b + 1}`).toBeLessThanOrEqual(minParBande[b + 1]!)
    }
  })

  it('hors de la cendre, la bande vaut HORS — et jamais une bande', () => {
    const av = auJour(120)
    let hors = 0
    for (let ty = 0; ty < map.height; ty += 7) {
      for (let tx = 0; tx < map.width; tx += 7) {
        const b = bandeDeCendre(map, tx, ty, av, SEED)
        const c = estCendre(map, tx, ty, av, SEED)
        expect(b === BANDE_HORS, `(${tx},${ty})`).toBe(!c)
        if (b === BANDE_HORS) hors += 1
      }
    }
    expect(hors, 'au jour 120 la vallée est très majoritairement vivante').toBeGreaterThan(0)
  })

  it('⚠ LA PORTE DES FUMEROLLES N’A PAS BOUGÉ : au cœur ⟺ bande ≥ NUE', () => {
    // Le resserrement ×4 des fumerolles (2026-08-25) tenait à ce seuil. Les bandes le COUPENT,
    // elles ne le DÉPLACENT pas — sans quoi on défaisait une demande explicite d'Alexis.
    const av = auJour(360)
    let coeurs = 0
    for (let ty = 0; ty < map.height; ty += 3) {
      for (let tx = 0; tx < map.width; tx += 3) {
        const coeur = auCoeurDeLaCendre(map, tx, ty, av, SEED)
        const b = bandeDeCendre(map, tx, ty, av, SEED)
        expect(coeur, `(${tx},${ty})`).toBe(b >= BANDE_NUE)
        if (coeur) coeurs += 1
      }
    }
    expect(coeurs, 'il faut un cœur pour que la garde ait mordu').toBeGreaterThan(1000)
  })
})

describe('A18 — la zone se DÉPLOIE : deux bandes au jour 1, quatre ensuite, le mûr finit par dominer', () => {
  it("au jour d'ouverture, la tache initiale ne porte que la frange et la cendre nue", () => {
    const { part, total } = parBande(BALANCE.ACT_DAYS + 1)
    expect(total, 'R3 : chaque fosse porte sa cendre dès le premier jour').toBeGreaterThan(0)
    expect(part[BANDE_FRANGE]).toBeGreaterThan(0)
    expect(part[BANDE_NUE]).toBeGreaterThan(0)
    expect(part[BANDE_CROUTE], 'la croûte demande de la durée').toBe(0)
    expect(part[BANDE_VIEILLE], 'la vieille cendre demande de la durée').toBe(0)
  })

  it('les quatre bandes existent au jour 120, et la plus mûre CROÎT jusqu’à dominer', () => {
    const j120 = parBande(120)
    for (let b = 0; b < 4; b++) expect(j120.part[b], `bande ${b} au jour 120`).toBeGreaterThan(0)

    const parts = [120, 240, 600, 1200].map((j) => {
      const { part, total } = parBande(j)
      return part[BANDE_VIEILLE]! / total
    })
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i], `la vieille cendre recule entre les relevés ${i - 1} et ${i}`).toBeGreaterThan(parts[i - 1]!)
    }
    expect(parts[parts.length - 1], 'à l’an 10 la cendrière mûre EST la cendre').toBeGreaterThan(0.7)
  })
})

describe('A19 — le caractère : quatre fosses, quatre caractères, tous distincts', () => {
  it('exactement quatre fosses sur dix, et jamais deux fois le même', () => {
    const c = caracteresDesFoyers(SEED, 10)
    const portes = c.filter((x): x is CaractereDeFoyer => x !== undefined)
    expect(portes.length).toBe(4)
    expect(new Set(portes).size, 'un caractère est un LIEU, pas une texture').toBe(4)
    expect(new Set(portes)).toEqual(new Set(ORDRE_DES_CARACTERES))
  })

  it('le nombre suit la PART, et une carte sans fosse ne casse pas', () => {
    expect(caracteresDesFoyers(SEED, 0)).toEqual([])
    expect(caracteresDesFoyers(SEED, 1).filter(Boolean).length).toBe(0) // round(0,4) = 0
    expect(caracteresDesFoyers(SEED, 9).filter(Boolean).length).toBe(4) // round(3,6) = 4
    expect(caracteresDesFoyers(SEED, 40).filter(Boolean).length)
      .toBe(ORDRE_DES_CARACTERES.length) // borné par le nombre de caractères
  })

  it('c’est un HACHAGE : pur, stable, et il bouge avec la graine', () => {
    expect(caracteresDesFoyers(SEED, 10)).toEqual(caracteresDesFoyers(SEED, 10))
    const oualee = (s: number): number => caracteresDesFoyers(s, 10).indexOf('salee')
    const rangs = new Set([2026, 7, 42, 1789, 1515, 33].map(oualee))
    expect(rangs.size, 'la Salée doit changer de fosse selon la graine').toBeGreaterThan(2)
  })

  it('⚠ AUCUN CADRAN `vitesse` — R2 dit que tous les foyers avancent à la MÊME allure', () => {
    // Garde exhaustive PAR CONSTRUCTION : la table des cadrans autorisés est énumérée par le
    // compilateur, et toute clé ajoutée à un caractère devra passer ici.
    const AUTORISES: (keyof EffetsDeFoyer)[] = ['fumerolles', 'sel', 'morts', 'froid', 'gel']
    for (const c of ORDRE_DES_CARACTERES) {
      for (const k of Object.keys(CARACTERES_DE_FOYER[c])) {
        expect(AUTORISES, `${c} tourne un cadran interdit : ${k}`).toContain(k)
      }
    }
    expect(AUTORISES).not.toContain('vitesse')
  })

  it('un cadran non tourné, une fosse nue ou hors bornes valent 1 — balayage complet', () => {
    const c = caracteresDesFoyers(SEED, 10)
    const CADRANS: (keyof EffetsDeFoyer)[] = ['fumerolles', 'sel', 'morts', 'froid', 'gel']
    for (const cadran of CADRANS) {
      expect(cadranDeFoyer(c, -1, cadran), 'hors cendre').toBe(1)
      expect(cadranDeFoyer(c, 999, cadran), 'index hors bornes').toBe(1)
      const nue = c.indexOf(undefined)
      expect(cadranDeFoyer(c, nue, cadran), 'fosse nue').toBe(1)
    }
    // …et chaque caractère rend bien SON réglage là où il en a un.
    for (const car of ORDRE_DES_CARACTERES) {
      const k = c.indexOf(car)
      expect(k, `${car} doit être attribué`).toBeGreaterThanOrEqual(0)
      for (const cadran of CADRANS) {
        const attendu = CARACTERES_DE_FOYER[car][cadran] ?? 1
        expect(cadranDeFoyer(c, k, cadran), `${car}.${cadran}`).toBe(attendu)
      }
    }
  })
})

describe('A20 — la carte de PRODUCTION porte vraiment ses quatre caractères', () => {
  it('les quatre existent sur le monde joué, chacun sur une fosse distincte', () => {
    // ⚠ Une table ne prouve pas l'atteignabilité (mémoire : la garde du marais injoignable). On
    // le relève sur le monde qui se joue, pas sur `caracteresDesFoyers(seed, 10)`.
    const c = caracteresDeLaCarte(map, SEED)
    expect(c.length).toBe(foyers.length)
    const index = ORDRE_DES_CARACTERES.map((car) => c.indexOf(car))
    expect(index.every((k) => k >= 0), 'un caractère sans fosse est un caractère mort').toBe(true)
    expect(new Set(index).size).toBe(ORDRE_DES_CARACTERES.length)
  })

  it('le cache mémoïsé rend la MÊME chose que le calcul nu', () => {
    expect([...caracteresDeLaCarte(map, SEED)]).toEqual(caracteresDesFoyers(SEED, foyers.length))
    expect(caracteresDeLaCarte(map, SEED)).toBe(caracteresDeLaCarte(map, SEED)) // même objet : il a servi
  })
})

describe('A21 — deux lectures du foyer, et la différence est ce qui empêche les bouches de clignoter', () => {
  it('foyerDeLaTuile est STATIQUE : il ne dépend ni du jour ni de l’avancée', () => {
    // C'est CE qui rend le caractère d'un foyer stable : le territoire est posé au worldgen.
    let dedans = 0
    let dehors = 0
    for (let ty = 0; ty < map.height; ty += 5) {
      for (let tx = 0; tx < map.width; tx += 5) {
        const k = foyerDeLaTuile(map, tx, ty)
        if (k < 0) { dehors += 1; continue }
        dedans += 1
        expect(k).toBe(foyerDe(map.cendreCout, ty * map.width + tx))
      }
    }
    expect(dedans, 'la terre est revendiquée').toBeGreaterThan(1000)
    expect(dehors, 'l’eau et le vide ne le sont pas').toBeGreaterThan(100)
  })

  it('⚠ UNE BOUCHE OUVERTE NE SE REFERME JAMAIS — le défaut que le territoire statique ferme', () => {
    // La première écriture gatait la part des fumerolles sur « la cendre est-elle arrivée » :
    // une bouche pouvait s'ouvrir puis disparaître, son nœud restant posé. On affirme ici la
    // propriété qui l'interdit — l'ensemble des bouches ne fait que CROÎTRE avec le temps.
    let precedent = new Set<string>()
    let ouvertes = 0
    for (const jour of [120, 240, 360, 600, 1200]) {
      const av = auJour(jour)
      const vues = new Set<string>()
      for (const b of toutesLesFumerolles(map, av, SEED)) vues.add(`${b.tx},${b.ty}`)
      for (const p of precedent) {
        expect(vues.has(p), `la bouche ${p} s'est refermée au jour ${jour}`).toBe(true)
      }
      precedent = vues
      ouvertes = vues.size
    }
    expect(ouvertes, 'sans bouche, la garde ne prouve rien').toBeGreaterThan(10)
  })

  it('foyerDuSol, lui, EXIGE que le front soit passé — et il est monotone', () => {
    const state = (jour: number): { map: typeof map; cendreAge: number[]; seed: number } =>
      ({ map, cendreAge: foyers.map(() => Math.max(0, jour - REVEIL)), seed: SEED })
    let pris = 0
    for (let ty = 0; ty < map.height; ty += 11) {
      for (let tx = 0; tx < map.width; tx += 11) {
        const tot = foyerDeLaTuile(map, tx, ty)
        const tot120 = foyerDuSol(state(120), tx, ty)
        const tot600 = foyerDuSol(state(600), tx, ty)
        // Le sol pris l'est pour toujours, et c'est TOUJOURS son propriétaire statique.
        if (tot120 >= 0) { expect(tot120).toBe(tot); expect(tot600).toBe(tot); pris += 1 }
        if (tot600 >= 0) expect(tot600).toBe(tot)
      }
    }
    expect(pris, 'au jour 120 la cendre a déjà pris du terrain').toBeGreaterThan(50)
  })

  it('⚠ tout désaccord avec estCendre tient DANS la bande de grain — jamais ailleurs', () => {
    // C'est la propriété qui justifie d'économiser quatre `fbm2` sur un chemin chaud : le seuil
    // nu et le seuil grainé ne peuvent différer que là où le grain les sépare.
    const jour = 360
    const ages = foyers.map(() => Math.max(0, jour - REVEIL))
    const av = avanceesDepuisAges(ages, foyers.length)
    const st = { map, cendreAge: ages, seed: SEED }
    let desaccords = 0
    for (let ty = 0; ty < map.height; ty += 3) {
      for (let tx = 0; tx < map.width; tx += 3) {
        const i = ty * map.width + tx
        const c = coutDe(map.cendreCout, i)
        if (c < 0) continue
        const k = foyerDe(map.cendreCout, i)
        const seuilNu = (av[k] ?? 0) * CENDRE.ORTHO
        if ((foyerDuSol(st, tx, ty) >= 0) === estCendre(map, tx, ty, av, SEED)) continue
        desaccords += 1
        expect(Math.abs(c - seuilNu), `(${tx},${ty}) désaccord hors de la bande de grain`)
          .toBeLessThanOrEqual(seuilNu * CENDRE.WARP_PART + 1)
      }
    }
    expect(desaccords, 'sans désaccord, la garde ne prouve rien').toBeGreaterThan(0)
  })
})


describe('A26 — le cadran MORD : la Docile se tient deux fois plus longtemps', () => {
  /**
   * Une table de multiplicateurs peut être juste et n'avoir AUCUN effet (mémoire : « une loi
   * livrée sans appelant »). On brûle donc deux fosses pour de vrai — une Docile, une nue — et
   * on compare les durées de gel. Carte nue : `cendreCout` y est absent, donc le cadran `morts`
   * est inerte et seul le `gel` parle.
   */
  const midiAvecFosses = (): SimState => {
    const state = createSim(1, {
      map: createEmptyMap(96, 96, TERRAIN_GRASS),
      cycleOffset: cycleOffsetForStartHour(12, 1),
      calendarScale: 1,
    })
    state.tick = 29 * TICKS_PER_SEASON_DAY
    state.tick -= state.tick % TICKS_PER_CYCLE
    state.tick += 20 // la cadence du brûlage, hors frontière d'aube
    // Dix charniers en ligne, espacés : `foyersDeLaCarte` les rend dans l'ordre des zones.
    for (let k = 0; k < 10; k++) state.map.zones.push({ x: 8 * k + 4, y: 40, w: 2, h: 2, kind: 'charnier' } as never)
    return state
  }

  it('un feu sur la Docile gèle deux fois plus longtemps qu’un feu sur une fosse nue', () => {
    const state = midiAvecFosses()
    const c = caracteresDeLaCarte(state.map, state.seed)
    const docile = c.indexOf('docile')
    const nue = c.indexOf(undefined)
    expect(docile, 'la carte de test doit porter une Docile').toBeGreaterThanOrEqual(0)
    expect(nue, 'et une fosse nue').toBeGreaterThanOrEqual(0)

    const zD = state.map.zones[docile]!
    const zN = state.map.zones[nue]!
    state.structures.push({ id: 9200, type: 'fire', tx: zD.x + 1, ty: zD.y + 1, villageId: 0, hp: 100 } as never)
    state.structures.push({ id: 9201, type: 'fire', tx: zN.x + 1, ty: zN.y + 1, villageId: 0, hp: 100 } as never)
    advanceLieuxBrules(state)

    const dureeDe = (zi: number): number => {
      const lb = state.lieuxBrules.find((x) => x.zone === zi)
      expect(lb, `la fosse ${zi} doit être marquée brûlée`).toBeDefined()
      return lb!.until - state.tick
    }
    // ⚠ ON AFFIRME LE RAPPORT, PAS LES DEUX DURÉES. Le caractère de la SAISON (R18, `cendreGel`)
    // multiplie les deux de la même façon : épingler la valeur absolue ferait rougir la garde le
    // jour où le tirage de saison tombe sur `orages_secs` ou `deluge`, pour une raison qui n'a
    // rien à voir avec ce qu'elle mesure.
    expect(dureeDe(nue), 'une fosse nue doit tenir un temps positif').toBeGreaterThan(0)
    expect(dureeDe(docile) / dureeDe(nue), 'la Docile double le gel')
      .toBeCloseTo(CARACTERES_DE_FOYER.docile.gel!, 5)
    expect(dureeDe(nue), 'et la base reste celle de MORTS.BRULE_DUREE_JOURS, au caractère près')
      .toBeLessThanOrEqual(Math.round(2 * MORTS.BRULE_DUREE_JOURS * TICKS_PER_SEASON_DAY))
  })
})

/**
 * ═══ R22 / R23 — LE FROID DE LA VIEILLE CENDRE, ET LA HANTISE RÉ-ARMÉE ═══
 *
 * Décision d'Alexis du 2026-08-27 (piste ⑥, « hantise + cendre froide »). Ce qui a rendu la
 * décision nécessaire est un relevé : ⑥ prétendait qu'aucun mécanisme n'était à écrire — le
 * cœur serait DÉJÀ le territoire des morts, par les fumerolles et l'éveil thermique. Mesuré
 * (`tools/diag-cendre-eveil.mts`, monde joué) : **vue ×1,01 et champ des morts ±1 %**. Faux.
 *
 * Les deux lois partagent une seule rampe (`rampeDeSuccession`) et un seul ancrage
 * (`CROUTE_TUILES`) : le sol se refroidit et se peuple des morts au même rythme.
 */
describe('A27 — la rampe de succession, balayée sur tout son domaine', () => {
  it('0 sur la frange, 1 au-delà du plateau, et jamais décroissante entre les deux', () => {
    // Garde EXHAUSTIVE plutôt que trois cas choisis : on balaie de -1 à 60 au dixième de tuile
    // et on affirme UNE propriété (mémoire `garde-exhaustive-plutot-que-cas`).
    let precedent = -1
    let vusStrictementEntre = 0
    for (let p = -10; p <= 600; p++) {
      const prof = p / 10
      const r = rampeDeSuccession(prof)
      expect(r, `rampe(${prof})`).toBeGreaterThanOrEqual(0)
      expect(r, `rampe(${prof})`).toBeLessThanOrEqual(1)
      if (prof <= CENDRE.FRANGE_TUILES) expect(r, `frange à ${prof}`).toBe(0)
      if (prof >= CENDRE.CROUTE_TUILES) expect(r, `plateau à ${prof}`).toBe(1)
      if (r > 0 && r < 1) vusStrictementEntre++
      expect(r, `monotone en ${prof}`).toBeGreaterThanOrEqual(precedent)
      precedent = r
    }
    // …et la prémisse : il EXISTE une pente. Sans ça, une rampe partout à 0 passerait tout.
    expect(vusStrictementEntre, 'la rampe doit avoir un intérieur').toBeGreaterThan(100)
  })

  it('le froid en découle, et il reste FRANCHEMENT sous le souffle d’une fumerolle', () => {
    // Les bouches sont les PICS du cœur (R22) : un fond aussi froid qu'elles les effacerait.
    expect(CENDRE.FROID_COEUR).toBeGreaterThan(0)
    expect(CENDRE.FROID_COEUR * 2).toBeLessThanOrEqual(FUMEROLLE.FROID)
  })
})

describe('A28 — sur le monde JOUÉ, le froid suit les bandes (et la frange reste travaillable)', () => {
  const etat = (jour: number): { map: typeof map; cendreAge: number[]; seed: number } =>
    ({ map, cendreAge: foyers.map(() => Math.max(0, jour - REVEIL)), seed: SEED })

  it('la frange ne porte JAMAIS de froid, et le cœur en porte — balayé, pas échantillonné', () => {
    const st = etat(600)
    const av = auJour(600)
    let frangesVues = 0
    let coeursFroids = 0
    for (let ty = 0; ty < map.height; ty += 3) {
      for (let tx = 0; tx < map.width; tx += 3) {
        const froid = froidDeCendre(st, tx, ty)
        const p = profondeurNueDeCendre(st, tx, ty)
        if (p < 0) {
          expect(froid, `hors cendre en ${tx},${ty}`).toBe(0)
          continue
        }
        if (p <= CENDRE.FRANGE_TUILES) {
          expect(froid, `frange en ${tx},${ty} (profondeur ${p})`).toBe(0)
          frangesVues++
        } else if (froid > 0) coeursFroids++
        expect(froid, `plafond en ${tx},${ty}`).toBeLessThanOrEqual(CENDRE.FROID_COEUR)
      }
    }
    // Les deux prémisses : la carte a bien des franges ET des cœurs froids à ce jour-là.
    expect(frangesVues, 'la carte doit porter de la frange').toBeGreaterThan(50)
    expect(coeursFroids, 'et de la cendre plus profonde qu’elle').toBeGreaterThan(500)
    // …et la bande de grain : la lecture NUE et la lecture VUE ne coïncident pas exactement,
    // c'est assumé (R22) — mais le désaccord doit rester DANS la bande de grain.
    let desaccords = 0
    for (let ty = 0; ty < map.height; ty += 7) {
      for (let tx = 0; tx < map.width; tx += 7) {
        const nue = profondeurNueDeCendre(st, tx, ty) >= 0
        const vue = profondeurDeCendre(map, tx, ty, av, SEED) >= 0
        if (nue !== vue) desaccords++
      }
    }
    expect(desaccords, 'le grain doit produire des désaccords — sinon la garde ne garde rien')
      .toBeGreaterThan(0)
  })

  it('le froid MORD la température du monde, en pente d’une bande à l’autre', () => {
    // On lit le VRAI froid du monde (`baselineTemperatureAt`, à découvert), pas la seule table :
    // c'est le branchement qu'on éprouve, pas la constante (mémoire `loi-livree-sans-appelant`).
    const sim = createSim(SEED, { map, calendarScale: 1 })
    sim.cendreAge = foyers.map(() => Math.max(0, 600 - REVEIL))
    const av = auJour(600)
    const somme = [0, 0, 0, 0, 0]
    const compte = [0, 0, 0, 0, 0]
    for (let ty = 0; ty < map.height; ty += 6) {
      for (let tx = 0; tx < map.width; tx += 6) {
        const b = bandeDeCendre(map, tx, ty, av, SEED)
        const i = b === BANDE_HORS ? 4 : b
        somme[i] = (somme[i] ?? 0) + baselineTemperatureAt(sim, tx + 0.5, ty + 0.5, sim.tick)
        compte[i] = (compte[i] ?? 0) + 1
      }
    }
    const moy = somme.map((s, i) => s / Math.max(1, compte[i]!))
    for (const i of [BANDE_FRANGE, BANDE_NUE, BANDE_CROUTE, BANDE_VIEILLE]) {
      expect(compte[i], `la carte doit porter de la bande ${i}`).toBeGreaterThan(20)
    }
    expect(moy[BANDE_NUE]!, 'la nue est plus froide que la frange').toBeLessThan(moy[BANDE_FRANGE]!)
    expect(moy[BANDE_CROUTE]!, 'la croûte plus que la nue').toBeLessThan(moy[BANDE_NUE]!)
    expect(moy[BANDE_VIEILLE]!, 'et la vieille plus que la croûte').toBeLessThan(moy[BANDE_CROUTE]!)
    expect(moy[BANDE_VIEILLE]!, 'la vieille cendre pèse au moins la moitié du cadran')
      .toBeLessThan(moy[4]! - CENDRE.FROID_COEUR / 2)
  })

  it('⚠ NI LA TENUE NI LE FEU NE PEUVENT ÊTRE DÉFAITS PAR LE FROID DE LA CENDRE', () => {
    // La moitié SÛRE de la décision, et elle est structurelle : l'ambiant est un `max`, donc
    // la tenue d'hiver plancher le ressenti à `TENUE_FLOOR`. Si un jour ce plancher passait
    // sous la ligne d'hypothermie, un joueur VÊTU mourrait dans la cendre — cette garde
    // rougirait. (Le feu, lui, plancher bien plus haut : `FIRE_WARMTH`.)
    expect(TEMPERATURE.TENUE_FLOOR).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
    expect(TEMPERATURE.FIRE_WARMTH).toBeGreaterThan(AMBIANT_HYPOTHERMIE)
  })

  it('un FAUX SimState — sans champ, sans âges — ne jette pas et ne refroidit rien', () => {
    // Le client fabrique des `SimState` par double cast pour ses façades (`etat-gel.ts`) : un
    // champ neuf y est `undefined`. Le même piège avait déjà fait tomber la scène entière.
    const nu = { map: createEmptyMap(32, 32, TERRAIN_GRASS) }
    expect(froidDeCendre(nu, 10, 10)).toBe(0)
    expect(profondeurNueDeCendre(nu, 10, 10)).toBe(-1)
    expect(froidDeCendre({ map }, 100, 100)).toBe(0) // le champ existe, les âges non
  })
})

describe('A29 — la hantise ré-armée : la cendre redevient le pire sol de la vallée', () => {
  it('le champ des morts monte bande après bande, et le hors-cendre garde son socle', () => {
    const sim = createSim(SEED, { map, calendarScale: 1 })
    sim.cendreAge = foyers.map(() => Math.max(0, 600 - REVEIL))
    const av = auJour(600)
    const somme = [0, 0, 0, 0, 0]
    const compte = [0, 0, 0, 0, 0]
    let sature = 0
    for (let ty = 0; ty < map.height; ty += 6) {
      for (let tx = 0; tx < map.width; tx += 6) {
        const b = bandeDeCendre(map, tx, ty, av, SEED)
        const i = b === BANDE_HORS ? 4 : b
        const d = densiteDesMorts(sim, tx, ty)
        expect(d, `borne haute en ${tx},${ty}`).toBeLessThanOrEqual(1)
        expect(d, `borne basse en ${tx},${ty}`).toBeGreaterThan(0)
        if (i === BANDE_VIEILLE && d >= 0.999) sature++
        somme[i] = (somme[i] ?? 0) + d
        compte[i] = (compte[i] ?? 0) + 1
      }
    }
    const moy = somme.map((s, i) => s / Math.max(1, compte[i]!))
    expect(moy[BANDE_FRANGE]!, 'la frange est déjà pleine de morts').toBeGreaterThan(moy[4]! + MORTS.PART_CENDRE / 2)
    expect(moy[BANDE_NUE]!).toBeGreaterThan(moy[BANDE_FRANGE]!)
    expect(moy[BANDE_CROUTE]!).toBeGreaterThan(moy[BANDE_NUE]!)
    expect(moy[BANDE_VIEILLE]!).toBeGreaterThan(moy[BANDE_CROUTE]!)
    // Le pire sol de la vallée SATURE quelque part — c'est ce que `HANTISE_MAX` promettait,
    // combiné au tier 2 de la Cendrière.
    expect(sature, 'la vieille cendre doit saturer par endroits').toBeGreaterThan(0)
  })

  it('elle MODULE, elle n’autorise jamais : hors cendre, rien n’a bougé', () => {
    // La règle centrale du champ (R16 de `cendreux.md`) et la mémoire
    // `geographie-module-jamais-autorise`. Sur une carte NUE — ni zones, ni champ de cendre —
    // le champ vaut exactement son socle, au bit près : un banc headless est préservé.
    const nue = createSim(SEED, { map: createEmptyMap(64, 64, TERRAIN_GRASS), calendarScale: 1 })
    for (let t = 0; t < 64; t += 7) {
      expect(densiteDesMorts(nue, t, t)).toBe(densiteDeBase(nue.map, t, t))
    }
  })

  it('et le nombre de rôdeurs suit : dormir dans la vieille cendre coûte plus qu’au village', () => {
    // Le bout de la chaîne — ce que le joueur VOIT. `rodeursPortes` est ce qui convertit le
    // champ en nuit vécue ; sans cette garde, la densité pourrait monter sans rien changer.
    const sim = createSim(SEED, { map, calendarScale: 1 })
    sim.cendreAge = foyers.map(() => Math.max(0, 600 - REVEIL))
    const av = auJour(600)
    let vieille: { tx: number; ty: number } | undefined
    let dehors: { tx: number; ty: number } | undefined
    for (let ty = 0; ty < map.height && (!vieille || !dehors); ty += 5) {
      for (let tx = 0; tx < map.width && (!vieille || !dehors); tx += 5) {
        const b = bandeDeCendre(map, tx, ty, av, SEED)
        if (b === BANDE_VIEILLE && !vieille) vieille = { tx, ty }
        if (b === BANDE_HORS && !dehors && densiteDesMorts(sim, tx, ty) < 0.3) dehors = { tx, ty }
      }
    }
    expect(vieille, 'la carte doit porter de la vieille cendre au jour 600').toBeDefined()
    expect(dehors, 'et du sol ordinaire').toBeDefined()
    const plafond = NIGHT_HUNT.UNDEAD_MAX_FIN // le toit de fin de saison, celui de `nighthunt.ts`
    expect(rodeursPortes(sim, vieille!.tx, vieille!.ty, plafond))
      .toBeGreaterThan(rodeursPortes(sim, dehors!.tx, dehors!.ty, plafond))
  })
})
