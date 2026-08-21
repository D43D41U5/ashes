/**
 * LE TEXTE DES STÈLES (spec `annales.md` R9-R10) — sur données FORGÉES : chaque propriété du
 * texte s'affirme sur une carte dont on connaît chaque fait, pas sur la loterie du worldgen
 * (les stèles de la vraie carte ont leurs gardes dans `pays-d-avant.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { ANNALES, texteDeStele, verbalise } from './annales'
import { createEmptyMap, type FaitDeGeneration, type WorldMap } from './map'

/** Une carte nue + des annales posées à la main. */
function carte(faits: FaitDeGeneration[], zones: WorldMap['zones'] = []): WorldMap {
  const map = createEmptyMap(300, 300, 0)
  map.annales = faits
  map.zones.push(...zones)
  return map
}

/** Une position (x, y=0) dont la lacune rend le verdict voulu — cherchée, pas supposée. */
function positionVerbalisee(veut: boolean): { x: number; y: number } {
  for (let x = 0; x < 2000; x++) {
    if (verbalise({ ere: 2, type: 'croisee', x, y: 0 }) === veut) return { x: x % 280, y: 0 }
  }
  throw new Error('hash uniforme sur 2000 positions — impossible')
}

describe('texteDeStele — la grammaire (R9)', () => {
  it('deux lignes : le fait sous la stèle à l’imparfait, le lieu désigné dans sa voix', () => {
    // Une croisée saine + une Tour qui guettait le sud, à portée.
    const sous = positionVerbalisee(true)
    const map = carte(
      [
        { ere: 2, type: 'croisee', x: sous.x, y: sous.y },
        { ere: 1, type: 'guet', x: sous.x + 40, y: sous.y, lieu: 'tour_guet', cause: 'sud' },
      ],
      [{ name: 'la Tour de guet effondrée I', x: sous.x + 39, y: sous.y - 1, w: 3, h: 3, kind: 'tour_guet' }],
    )
    const t = texteDeStele(map, sous.x, sous.y)
    expect(t).toBeDefined()
    expect(t!.brisee).toBe(false)
    expect(t!.lignes).toEqual(['Ici les chemins se répondaient.', 'Nous guettions le sud.'])
    // Et la révélation désigne EXACTEMENT le lieu du texte (R11 : l'écrivain unique).
    expect(t!.lieuVise).toBe(0)
  })

  it('l’article suit la direction : « l’est », jamais « le est »', () => {
    const sous = positionVerbalisee(true)
    const map = carte([
      { ere: 2, type: 'gue', x: sous.x, y: sous.y },
      { ere: 3, type: 'fuite', x: sous.x + 30, y: sous.y, lieu: 'charrette', cause: 'est' },
    ])
    const t = texteDeStele(map, sous.x, sous.y)!
    expect(t.lignes[1]).toBe("Nous partons à l'est.")
  })

  it('sans candidat à portée, la ligne 2 est ABSENTE — le silence est l’information', () => {
    const sous = positionVerbalisee(true)
    const map = carte([
      { ere: 2, type: 'croisee', x: sous.x, y: sous.y },
      // Un guet HORS de portée : la stèle n'en sait rien.
      { ere: 1, type: 'guet', x: sous.x + ANNALES.STELE_PORTEE + 50, y: sous.y, lieu: 'tour_guet', cause: 'sud' },
    ])
    const t = texteDeStele(map, sous.x, sous.y)!
    expect(t.lignes).toEqual(['Ici les chemins se répondaient.'])
    expect(t.lieuVise).toBeUndefined()
  })

  it('R9bis — une stèle ne connaît JAMAIS le sort, ni l’essart', () => {
    const sous = positionVerbalisee(true)
    const map = carte([
      { ere: 2, type: 'croisee', x: sous.x, y: sous.y },
      // Un sort et un essart COLLÉS à la stèle : s'ils étaient candidats, ils gagneraient.
      { ere: 3, type: 'sort', x: sous.x + 2, y: sous.y, lieu: 'ferme_ruinee', cause: 'brule' },
      { ere: 1, type: 'essart', x: sous.x + 3, y: sous.y, lieu: 'ruines' },
      { ere: 1, type: 'guet', x: sous.x + 60, y: sous.y, lieu: 'tour_guet', cause: 'nord' },
    ])
    const t = texteDeStele(map, sous.x, sous.y)!
    expect(t.lignes[1]).toBe('Nous guettions le nord.')
  })

  it('pas de fait d’ère 2 sous la pierre : pas de stèle — undefined, jamais une pierre muette', () => {
    const map = carte([{ ere: 1, type: 'guet', x: 50, y: 50, lieu: 'tour_guet', cause: 'sud' }])
    expect(texteDeStele(map, 50, 50)).toBeUndefined()
  })
})

describe('texteDeStele — la stèle brisée (R10)', () => {
  it('UN fragment, tiré de la ligne la plus parlante, et lieuVise ABSENT : la lacune a un coût', () => {
    const sous = positionVerbalisee(false) // une position que la lacune tait
    const map = carte(
      [
        { ere: 2, type: 'croisee', x: sous.x, y: sous.y },
        { ere: 1, type: 'guet', x: sous.x + 40, y: sous.y, lieu: 'tour_guet', cause: 'sud' },
      ],
      [{ name: 'la Tour de guet effondrée I', x: sous.x + 39, y: sous.y - 1, w: 3, h: 3, kind: 'tour_guet' }],
    )
    const t = texteDeStele(map, sous.x, sous.y)!
    expect(t.brisee).toBe(true)
    expect(t.lignes).toEqual(['… le sud …']) // le fragment reste un indice qu'on peut suivre
    expect(t.lieuVise).toBeUndefined() // et la charge ne révélera rien
  })

  it('brisée SANS ligne 2 : le fragment vient du fait sous la pierre', () => {
    const sous = positionVerbalisee(false)
    const map = carte([{ ere: 2, type: 'gue', x: sous.x, y: sous.y }])
    const t = texteDeStele(map, sous.x, sous.y)!
    expect(t.lignes).toEqual(["… l'eau …"])
  })
})
