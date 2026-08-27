/**
 * LA FICHE D'UN LIEU (spec `annales.md` R12 + `saison-sans-fin` T5) — la colonne UNIQUE où le
 * pays d'avant et la mémoire du joueur se lisent d'un même œil.
 *
 * Trois natures de garde, et elles ne se remplacent pas :
 *   ① la VOIX est totale par construction (le `Record` sur l'union — le compilateur) ;
 *   ② les CAUSES réellement émises ont chacune leur phrase — prouvé sur une VRAIE carte, parce
 *      qu'une table balayée fabrique ses propres conditions (mémoire `garde-atteignabilite`) ;
 *   ③ la COLONNE est chronologique — affirmé sur le `rang`, jamais sur le texte.
 */
import { describe, expect, it } from 'vitest'
import { chronicleFromEvents, ficheDuLieu, type ChronicleVolume } from './chronicle'
import { ANNALES, lieuDuFait, nomDEre, phraseDuFait } from './annales'
import { createEmptyMap, type FaitDeGeneration, type WorldMap } from './map'
import { carteDeTest } from '../../../tools/carte-cache'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { TICKS_PER_SEASON_DAY } from './time'

/** L'union des types, ÉNUMÉRÉE PAR LE COMPILATEUR : ajouter une variante à `FaitDeGeneration`
 *  casse cette ligne avant de casser un écran (mémoire `enumerer-une-union-par-le-compilateur`). */
const TOUS_LES_TYPES: Record<FaitDeGeneration['type'], true> = {
  fondation: true, gue: true, sort: true, gravure: true, essart: true,
  taille: true, guet: true, porte: true, croisee: true, fosse: true, fuite: true,
}

describe('la voix du visiteur — totale, et distincte', () => {
  it('tout type a une phrase non vide, et deux types ne disent pas la même chose', () => {
    const textes = new Map<string, string>()
    for (const type of Object.keys(TOUS_LES_TYPES) as FaitDeGeneration['type'][]) {
      const { texte, poids } = phraseDuFait({ ere: 1, type, x: 0, y: 0 })
      expect(texte.length, type).toBeGreaterThan(0)
      expect(['recit', 'intime']).toContain(poids)
      textes.set(type, texte)
    }
    // CE QUI FERAIT ROUGIR : une voix copiée-collée d'un type sur l'autre — le défaut exact
    // qu'une table écrite à la main invite. Onze types, onze phrases.
    expect(new Set(textes.values()).size).toBe(textes.size)
  })

  it('la CAUSE change la phrase là où elle porte du sens — et jamais par accident', () => {
    const de = (type: FaitDeGeneration['type'], cause?: string): string =>
      phraseDuFait({ ere: 1, type, x: 0, y: 0, ...(cause ? { cause } : {}) }).texte
    // La fondation dit POURQUOI on s'est mis là — c'est tout le fait.
    expect(de('fondation', 'eau')).not.toBe(de('fondation', 'route'))
    expect(de('fondation')).not.toBe(de('fondation', 'eau'))
    // Le sort : le visiteur a le DROIT de le dire (une ruine brûlée se voit) — R9bis ne borne
    // que la stèle, gravée par des vivants qui ne pouvaient pas savoir.
    expect(de('sort', 'brule')).not.toBe(de('sort', 'intact'))
    // Les directions sont des MOTS, et l'article suit la voyelle (R3).
    expect(de('guet', 'est')).toContain("l'est")
    expect(de('guet', 'sud')).toContain('le sud')
    expect(de('fuite', 'est')).toContain("à l'est")
    // Une cause inconnue ne casse rien : la fonction est TOTALE.
    expect(de('guet', 'zenith').length).toBeGreaterThan(0)
    expect(de('fuite', 'zenith').length).toBeGreaterThan(0)
  })

  it('les ères portent leurs noms — ceux que `map.ts` écrit déjà, pas un baptême neuf', () => {
    expect(nomDEre(0)).toContain('pierre')
    expect(nomDEre(3)).toContain('Cendre')
    expect(new Set([0, 1, 2, 3].map(nomDEre)).size).toBe(4)
    expect(nomDEre(9).length).toBeGreaterThan(0) // totale
  })
})

describe('l’atteignabilité — sur une VRAIE carte, pas sur la table qu’on teste', () => {
  // La vallée ENTIÈRE (le défaut de `generateZonedTerrain`) : c'est la seule carte où les onze
  // types se rencontrent. ⚠ Le monde JOUÉ (`racine`) n'en émet que six — mesuré, et signalé
  // comme un chantier à part : cette garde-ci prouve la VOIX, pas la vitalité du vocabulaire.
  const { map } = carteDeTest(7)

  it('chaque (type, cause) réellement émis par le worldgen a sa phrase', () => {
    const vus = new Map<string, FaitDeGeneration>()
    for (const f of map.annales ?? []) vus.set(`${f.type}:${f.cause ?? ''}`, f)
    expect(vus.size).toBeGreaterThan(4) // la sonde a bien trouvé une carte peuplée
    for (const [clef, f] of vus) {
      const { texte } = phraseDuFait(f)
      // La donnée ne peut pas atteindre l'écran TELLE QUELLE : ce qu'on rend est une PHRASE —
      // majuscule, point final, au moins trois mots. (Le test ne peut pas interdire le MOT du
      // type : `porte`, `fondation`, `taille`, `fosse` sont du français avant d'être des slugs
      // — première écriture, rouge sur « C'était une porte de secours. », et elle avait tort.)
      expect(texte[0], clef).toBe(texte[0]!.toLocaleUpperCase('fr'))
      expect(texte.endsWith('.'), clef).toBe(true)
      expect(texte.split(' ').length, clef).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('la colonne — chronologique, affirmée sur le RANG', () => {
  /** Une carte nue, un lieu, ses faits posés à la main au centre EXACT (la clef de `faitsDuLieu`). */
  function carteAvecLieu(faits: Omit<FaitDeGeneration, 'x' | 'y' | 'lieu'>[]): WorldMap {
    const map = createEmptyMap(60, 60, 0)
    const zone = { name: 'la Ferme ruinée I', x: 10, y: 10, w: 4, h: 4, kind: 'ferme_ruinee' }
    map.zones.push(zone)
    const cx = Math.floor(zone.x + zone.w / 2)
    const cy = Math.floor(zone.y + zone.h / 2)
    map.annales = faits.map((f) => ({ ...f, x: cx, y: cy, lieu: zone.kind }))
    return map
  }

  const volumes: ChronicleVolume[] = [
    { an: 2, entrees: [{ day: 5, text: 'Une horde en est partie.', weight: 'battement', lieu: 0 }] },
    { an: 1, entrees: [
      { day: 40, text: 'On y a laissé quelqu’un.', weight: 'intime', lieu: 0 },
      { day: 12, text: 'La Ferme ruinée I a été atteinte pour la première fois.', weight: 'recit', lieu: 0 },
      { day: 20, text: 'Ailleurs, un Feu s’est allumé.', weight: 'recit' }, // sans lieu : jamais retenue
    ] },
  ]

  it('le pays d’avant précède le joueur, les ères montent, les années montent', () => {
    const map = carteAvecLieu([
      { ere: 3, type: 'sort', cause: 'intact' },
      { ere: 1, type: 'fondation', cause: 'eau' },
      { ere: 0, type: 'gravure' },
    ])
    const col = ficheDuLieu(map, 0, volumes)
    expect(col).toHaveLength(6) // 3 faits + 3 lignes (celle SANS lieu est écartée)

    // ① toutes les ères d'abord, ② dans l'ordre, ③ puis les années dans l'ordre.
    const eres = col.filter((l) => 'ere' in l.rang).map((l) => (l.rang as { ere: number }).ere)
    const ans = col.filter((l) => 'an' in l.rang).map((l) => l.rang as { an: number; jour: number })
    expect(eres).toEqual([0, 1, 3])
    expect(ans).toEqual([{ an: 1, jour: 12 }, { an: 1, jour: 40 }, { an: 2, jour: 5 }])
    // Le pays d'avant est AVANT : aucune ère ne suit une année dans la colonne.
    expect(col.findIndex((l) => 'an' in l.rang)).toBe(eres.length)
  })

  it('la gouttière dit l’ère ou l’année — et jamais un numéro nu', () => {
    const map = carteAvecLieu([{ ere: 0, type: 'gravure' }])
    const col = ficheDuLieu(map, 0, volumes)
    expect(col[0]!.gouttiere).toBe(nomDEre(0))
    expect(col[1]!.gouttiere).toBe('l’an 1 · jour 12')
  })

  it('un lieu sans fait ET sans ligne rend une colonne VIDE — le silence est l’information', () => {
    const map = carteAvecLieu([])
    expect(ficheDuLieu(map, 0, [])).toEqual([])
    // Et un poiId hors carte ne jette pas : la fiche est totale, comme la voix.
    expect(ficheDuLieu(map, 99, volumes)).toEqual([])
  })

  it('les lignes d’un AUTRE lieu ne fuient jamais dans la fiche', () => {
    const map = carteAvecLieu([{ ere: 0, type: 'gravure' }])
    const ailleurs: ChronicleVolume[] = [
      { an: 1, entrees: [{ day: 3, text: 'Cela s’est passé au Charnier.', weight: 'recit', lieu: 7 }] },
    ]
    const col = ficheDuLieu(map, 0, ailleurs)
    expect(col).toHaveLength(1)
    expect(col[0]!.texte).not.toContain('Charnier')
  })
})

describe('la clef de lieu (R13) — « ce qui s’est passé ICI »', () => {
  /** Deux lieux posés à la main, à 100 tuiles l'un de l'autre (bien au-delà du rayon). */
  function deuxLieux(): WorldMap {
    const map = createEmptyMap(300, 300, 0)
    map.zones.push({ name: 'la Ferme ruinée I', x: 48, y: 48, w: 4, h: 4, kind: 'ferme_ruinee' }) // centre (50,50)
    map.zones.push({ name: 'le Charnier I', x: 148, y: 148, w: 4, h: 4, kind: 'charnier' }) // centre (150,150)
    map.zones.push({ name: 'les Prés Bas', x: 0, y: 0, w: 300, h: 300 }) // un TOPONYME : jamais un lieu
    return map
  }

  it('un fait dans le rayon appartient au lieu ; au-delà, à aucun', () => {
    const map = deuxLieux()
    const R = ANNALES.LIEU_RAYON
    expect(lieuDuFait(map, 50, 50)).toBe(0) // sur le centre
    expect(lieuDuFait(map, 50 + R - 1, 50)).toBe(0) // dedans, au bord
    // ⚠ CE QUI FAIT ROUGIR CETTE SONDE : élargir le rayon sans le dire. Un pas au-delà, et la
    // pleine campagne redevient la pleine campagne — sinon toute la carte appartiendrait au
    // lieu le plus proche, et « ICI » ne voudrait plus rien dire.
    expect(lieuDuFait(map, 50 + R + 1, 50)).toBeUndefined()
    expect(lieuDuFait(map, 150, 150)).toBe(1)
  })

  it('un TOPONYME n’est jamais un lieu — même s’il couvre toute la carte', () => {
    const map = deuxLieux()
    // La zone 2 (« les Prés Bas ») contient TOUT. Si elle comptait, ce point lui reviendrait.
    expect(lieuDuFait(map, 260, 20)).toBeUndefined()
  })

  it('le PLUS PROCHE gagne, et l’égalité se tranche par le plus petit poiId', () => {
    const map = createEmptyMap(300, 300, 0)
    map.zones.push({ name: 'A', x: 98, y: 98, w: 4, h: 4, kind: 'cairn' }) // centre (100,100)
    map.zones.push({ name: 'B', x: 118, y: 98, w: 4, h: 4, kind: 'cairn' }) // centre (120,100)
    expect(lieuDuFait(map, 105, 100)).toBe(0)
    expect(lieuDuFait(map, 115, 100)).toBe(1)
    expect(lieuDuFait(map, 110, 100)).toBe(0) // à égalité stricte : le plus petit index
  })

  it('la chronique POSE la clef sur un fait positionné — et la fiche la lit', () => {
    const map = deuxLieux()
    // Une horde partie à cinq tuiles de la Ferme : c'est de la Ferme qu'on parlera.
    const entrees = chronicleFromEvents(
      [{ type: 'horde_spawned', tick: 0, hordeId: 1, size: 99, fireTx: 0, fireTy: 0, tx: 55, ty: 50 }],
      TICKS_PER_SEASON_DAY, 1, {}, map,
    )
    expect(entrees).toHaveLength(1)
    expect(entrees[0]!.lieu).toBe(0)
    // Et la fiche de la Ferme la porte, celle du Charnier non.
    const volumes = [{ an: 1, entrees }]
    expect(ficheDuLieu(map, 0, volumes).some((l) => l.texte.includes('horde'))).toBe(true)
    expect(ficheDuLieu(map, 1, volumes)).toEqual([])
  })

  it('LE RAYON NE MANGE PAS LA CARTE — mesuré sur le monde JOUÉ, pas sur un montage', () => {
    // La garde de VALEUR, et elle ne peut pas être écrite avec la constante qu'elle teste :
    // « ICI » ne veut dire quelque chose que si la pleine campagne reste majoritaire. MESURÉ
    // sur la Racine (seed 2026, un point toutes les 16 tuiles, 5 346 points) :
    //   R=20 → 5,3 % · **R=40 → 20,5 %** · R=80 → 58,9 % · R=160 → 93,0 %.
    // La bande [10 %, 45 %] rougit donc aux DEUX erreurs : un rayon trop serré (la fiche
    // redevient vide) comme un rayon qui avale la vallée (tout appartient au lieu d'à côté).
    const { map } = carteDeTest(2026, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
    let dans = 0
    let total = 0
    for (let y = 0; y < map.height; y += 16) {
      for (let x = 0; x < map.width; x += 16) {
        total += 1
        if (lieuDuFait(map, x, y) !== undefined) dans += 1
      }
    }
    expect(total).toBeGreaterThan(1000) // la sonde a bien balayé une vraie carte
    const part = dans / total
    expect(part).toBeGreaterThan(0.10)
    expect(part).toBeLessThan(0.45)
  })

  it('un fait SANS position ne s’attache à rien — c’est un fait sur la donnée, pas un oubli', () => {
    const map = deuxLieux()
    const entrees = chronicleFromEvents(
      [{ type: 'village_fell', tick: 0, villageId: 1, name: 'le Feu du Gué' }],
      TICKS_PER_SEASON_DAY, 1, {}, map,
    )
    expect(entrees).toHaveLength(1)
    expect(entrees[0]!.lieu).toBeUndefined()
  })
})
