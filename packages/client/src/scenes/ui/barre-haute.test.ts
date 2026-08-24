import { describe, expect, it } from 'vitest'
import type { GameTime } from '@ashes/sim'
import {
  BARRE_ALPHA_MIN,
  BARRE_SOL_ARRETS,
  BARRE_SOL_ENCRE,
  LIEU_GRACE_MS,
  LIEU_RANG_H,
  MEMOIRE_VIERGE,
  opaciteDuSol,
  vueDeLaBarre,
  type BarreHauteState,
  type MemoireDuLieu,
} from './barre-haute'

/** L'horloge de jeu, réduite à ce que la barre en lit. */
function temps(p: Partial<GameTime> = {}): GameTime {
  return {
    tick: 0,
    hourOfCycle: 14,
    isNight: false,
    nuit: 0,
    dayTicks: 0,
    seasonDay: 52,
    act: 2,
    tour: 1,
    phase: 2,
    ...p,
  }
}

function etat(p: Partial<BarreHauteState> = {}): BarreHauteState {
  return {
    time: temps(),
    toponyme: 'la Vieille Sylve',
    lieu: undefined,
    ambiant: 14,
    ciel: null,
    caractere: undefined,
    now: 0,
    ...p,
  }
}

/** La barre telle qu'elle est jouée : une suite d'états, la mémoire qui suit. */
function jouer(...etats: BarreHauteState[]): ReturnType<typeof vueDeLaBarre> {
  let memoire: MemoireDuLieu = MEMOIRE_VIERGE
  let sortie = vueDeLaBarre(etats[0]!, memoire)
  for (const e of etats) {
    sortie = vueDeLaBarre(e, memoire)
    memoire = sortie.memoire
  }
  return sortie
}

describe('la barre haute — où je suis', () => {
  it('nomme la région, et le lieu seulement quand on en foule un', () => {
    expect(jouer(etat()).vue.zone).toBe('LA VIEILLE SYLVE')
    expect(jouer(etat()).vue.lieuH).toBe('0px')

    const dedans = jouer(etat({ lieu: 'la Mine pillée' })).vue
    expect(dedans.lieuNom).toBe('LA MINE PILLÉE')
    expect(dedans.lieuH).toBe(`${LIEU_RANG_H}px`)
  })

  /**
   * LE MOUVEMENT EST UNE PROPRIÉTÉ DES DEUX ÉTATS, jamais une image intermédiaire : la
   * transition de 220 ms appartient au navigateur, on ne la photographie pas en vol. Ce qui se
   * garde ici, ce sont les deux bouts qu'elle interpole.
   */
  it('les deux bouts : le lieu glisse VERS LA DROITE, la zone se réduit VERS LE HAUT', () => {
    const dehors = jouer(etat()).vue
    const dedans = jouer(etat({ lieu: "l'Abri sous roche" })).vue

    expect(dehors.lieuX).toBe('translateX(-16px)') // il attend hors champ, à gauche
    expect(dehors.lieuOp).toBe('0')
    expect(dedans.lieuX).toBe('translateX(0)') // …et il est venu vers la droite
    expect(dedans.lieuOp).toBe('1')
    // La zone RÉTRÉCIT : elle cède le premier rôle au lieu et remonte.
    expect(parseFloat(dedans.zoneTaille)).toBeLessThan(parseFloat(dehors.zoneTaille))
    expect(parseFloat(dedans.zoneLs)).toBeGreaterThan(parseFloat(dehors.zoneLs))
  })

  it('LA GRÂCE : le lieu tient 500 ms après la sortie, puis s’en va', () => {
    const dedans = etat({ lieu: 'la Tanière', now: 1000 })
    const juste = jouer(dedans, etat({ now: 1000 + LIEU_GRACE_MS - 1 })).vue
    expect(juste.lieuH).toBe(`${LIEU_RANG_H}px`) // c'est le bord de l'empreinte, la barre ne bronche pas
    expect(juste.lieuNom).toBe('LA TANIÈRE')

    const apres = jouer(dedans, etat({ now: 1000 + LIEU_GRACE_MS })).vue
    expect(apres.lieuH).toBe('0px')
    // …en portant ENCORE son nom : c'est ce qui lui permet de s'en aller en glissant.
    expect(apres.lieuNom).toBe('LA TANIÈRE')
  })

  it('RENTRER dans le même lieu pendant la grâce la fait repartir de zéro', () => {
    const vue = jouer(
      etat({ lieu: 'la Tanière', now: 0 }),
      etat({ now: 200 }),
      etat({ lieu: 'la Tanière', now: 400 }),
      etat({ now: 600 }), // 200 ms après la SECONDE entrée : toujours tenu
    ).vue
    expect(vue.lieuH).toBe(`${LIEU_RANG_H}px`)
  })

  it('entrer dans un AUTRE lieu montre le nouveau tout de suite, sans passer par le vide', () => {
    const vue = jouer(
      etat({ lieu: 'les Ruines brûlées', now: 0 }),
      etat({ lieu: 'la Tanière', now: 50 }),
    ).vue
    expect(vue.lieuNom).toBe('LA TANIÈRE')
    expect(vue.lieuH).toBe(`${LIEU_RANG_H}px`)
  })

  it('l’air se dit en degrés SIGNÉS, et se tait tant que le monde n’a rien dit', () => {
    expect(jouer(etat({ ambiant: undefined })).vue.airVisible).toBe(false)
    expect(jouer(etat({ ambiant: 21.6 })).vue.airTxt).toBe('+22 °C')
    expect(jouer(etat({ ambiant: -16 })).vue.airTxt).toBe('-16 °C')
    expect(jouer(etat({ ambiant: 0 })).vue.airTxt).toBe('0 °C')
  })

  it('l’encre de l’air suit le froid, et le gel a la sienne', () => {
    const encre = (c: number): string => jouer(etat({ ambiant: c })).vue.airEncre
    expect(encre(26)).not.toBe(encre(12))
    expect(encre(12)).not.toBe(encre(4))
    expect(encre(4)).not.toBe(encre(-2))
    expect(encre(-2)).toBe(encre(-16)) // sous zéro, une seule encre : le gel
  })
})

describe('la barre haute — le ruban et le ciel', () => {
  it('dit l’an et le jour, et ne parle plus en chiffres romains', () => {
    const vue = jouer(etat({ time: temps({ seasonDay: 52, tour: 1 }) })).vue
    expect(vue.an).toBe('AN 1')
    expect(vue.jour).toBe('JOUR 52')
  })

  it('le tapis GLISSE d’un jour à l’autre ; la tête, elle, ne bouge jamais', () => {
    const a = jouer(etat({ time: temps({ seasonDay: 52 }) })).vue.tapisX
    const b = jouer(etat({ time: temps({ seasonDay: 53 }) })).vue.tapisX
    // Un jour de plus = 23 px de moins : c'est le monde qui recule sous une tête immobile.
    expect(a - b).toBe(23)
  })

  it('le caractère de la saison paraît quand il y en a un, et se tait sinon', () => {
    expect(jouer(etat({ caractere: undefined })).vue.caractere).toBeNull()
    expect(jouer(etat({ caractere: 'la Canicule' })).vue.caractere).toBe('LA CANICULE')
  })

  /** La bande porte la couleur que le SOL portera : quatre saisons, quatre teintes, prises
   *  dans `teinte-saison.ts` — jamais recopiées ici. */
  it('chaque saison a sa teinte, et elles sont toutes différentes', () => {
    const teintes = [1, 2, 3, 4].map((phase) => jouer(etat({ time: temps({ phase }) })).vue.caractereEncre)
    expect(new Set(teintes).size).toBe(4)
    for (const t of teintes) expect(t).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('l’heure se lit à deux chiffres, et le ciel glisse avec elle', () => {
    expect(jouer(etat({ time: temps({ hourOfCycle: 7.9 }) })).vue.heureTxt).toBe('07H')
    expect(jouer(etat({ time: temps({ hourOfCycle: 0 }) })).vue.heureTxt).toBe('00H')
    const a = jouer(etat({ time: temps({ hourOfCycle: 10 }) })).vue.cielX
    const b = jouer(etat({ time: temps({ hourOfCycle: 11 }) })).vue.cielX
    expect(a - b).toBe(22)
  })

  it('l’icône dit le temps qu’il fait ici — soleil ou lune quand le ciel est dégagé', () => {
    expect(jouer(etat({ ciel: null, time: temps({ isNight: false }) })).vue.ico).toBe('soleil')
    expect(jouer(etat({ ciel: null, time: temps({ isNight: true }) })).vue.ico).toBe('lune')
    for (const aspect of ['pluie', 'neige', 'orage', 'blizzard', 'brouillard', 'vent_de_cendre'] as const) {
      expect(jouer(etat({ ciel: aspect })).vue.ico).toBe(aspect)
    }
  })
})

/**
 * LE SOL DE LA BARRE, EN NOMBRES — l'extension de `hud-plaque.test` au fond qu'elle introduit.
 *
 * La barre déplace le texte le plus important du HUD sur un dégradé vertical que personne
 * n'avait mesuré. La garde d'origine serait restée verte sans plus rien garder de celui-là :
 * on rejoue donc son calcul — les mêmes fonds relevés au banc, la même composition — contre
 * l'opacité la plus MINCE sous une lettre de la barre.
 */
describe('le sol de la barre haute', () => {
  const SOL_MIDI: [number, number, number] = [167, 181, 86]
  const TACHE_SOLEIL: [number, number, number] = [201, 201, 190]
  const FONDS = { 'le sol de midi': SOL_MIDI, 'une tache de soleil': TACHE_SOLEIL }
  const [er = 0, ev = 0, eb = 0] = BARRE_SOL_ENCRE.split(',').map(Number)

  const luminance = ([r, g, b]: [number, number, number]): number => {
    const lin = (c: number): number => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const contraste = (a: [number, number, number], b: [number, number, number]): number => {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }
  const sousLeSol = (fond: [number, number, number], alpha: number): [number, number, number] => [
    alpha * er + (1 - alpha) * fond[0],
    alpha * ev + (1 - alpha) * fond[1],
    alpha * eb + (1 - alpha) * fond[2],
  ]

  /** Les encres de la barre, telles qu'elle les déclare. */
  const ENCRES: Record<string, [number, number, number]> = {
    'l’heure (titre)': [255, 255, 255],
    'le nom du lieu': [242, 234, 208],
    'le toponyme (encre atténuée)': [154, 143, 120],
    'les numéros de jour (encre effacée)': [139, 132, 116],
  }

  it('LA PRÉMISSE : sans sol, ces encres seraient illisibles sur le monde de midi', () => {
    for (const [nom, teinte] of Object.entries(ENCRES)) {
      expect(contraste(teinte, SOL_MIDI), nom).toBeLessThan(3)
    }
  })

  it('sous le sol le PLUS MINCE de la barre, tout passe AA — et le titre, AAA', () => {
    for (const [nomFond, fond] of Object.entries(FONDS)) {
      const dessous = sousLeSol(fond, BARRE_ALPHA_MIN)
      for (const [nom, teinte] of Object.entries(ENCRES)) {
        expect(contraste(teinte, dessous), `${nom} sur ${nomFond}`).toBeGreaterThan(4.5)
      }
      expect(contraste(ENCRES['l’heure (titre)']!, dessous), nomFond).toBeGreaterThan(7)
    }
  })

  it('et le sol reste un VOILE : il s’éclaircit vers le bas, jamais sous le texte', () => {
    expect(opaciteDuSol(0)).toBe(BARRE_SOL_ARRETS[0]![1])
    expect(opaciteDuSol(1)).toBe(BARRE_SOL_ARRETS[BARRE_SOL_ARRETS.length - 1]![1])
    // Le bas du texte est un peu plus mince que le haut de la barre, et jamais trop.
    expect(BARRE_ALPHA_MIN).toBeLessThan(opaciteDuSol(0))
    expect(BARRE_ALPHA_MIN).toBeGreaterThan(0.85)
  })
})
