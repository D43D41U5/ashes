import { describe, expect, it } from 'vitest'
import { TICKS_PER_CYCLE, VENT, YEAR_DAYS, dayTicksPourJour, leverPourJour, type GameTime } from '@ashes/sim'
import {
  BARRE_ALPHA_MIN,
  cielDuJour,
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
    lever: 6,
    seasonDay: 52,
    jourFrac: 0,
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
    vent: undefined,
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

  /**
   * IL COULE, IL NE CLAQUE PAS. Accroché au jour ENTIER, le tapis sautait de 23 px une fois
   * par jour de jeu — un cran toutes les 45 min, et rien entre les deux. La garde tient la
   * propriété qui manquait : la position bouge À L'INTÉRIEUR d'un jour, proportionnellement.
   */
  it('le tapis avance AVEC la journée, pas d’un cran au changement de jour', () => {
    const x = (frac: number): number => jouer(etat({ time: temps({ seasonDay: 52, jourFrac: frac }) })).vue.tapisX
    expect(x(0)).toBeGreaterThan(x(0.25))
    expect(x(0.25)).toBeGreaterThan(x(0.5))
    expect(x(0.5)).toBeGreaterThan(x(0.75))
    // Une demi-journée vaut la moitié d'un jour (11,5 px), à l'arrondi du pixel près — le
    // tapis se pose sur des pixels entiers pour que le texte du ruban reste net.
    expect(Math.abs(x(0) - x(0.5) - 11.5)).toBeLessThanOrEqual(0.5)
    // …et la fin d'un jour rejoint EXACTEMENT le début du suivant : aucun saut à la bascule.
    expect(x(1)).toBe(jouer(etat({ time: temps({ seasonDay: 53, jourFrac: 0 }) })).vue.tapisX)
  })

  /**
   * AUCUN SAUT À LA BASCULE DU JOUR — la garde qu'Alexis a demandée nommément.
   *
   * Le risque est réel et il est double : `seasonDay` s'incrémente pendant que `jourFrac`
   * retombe à zéro (deux champs qui bougent ensemble, une occasion de se décaler d'un jour
   * entier), et le TAPIS est reconstruit à ce moment-là (nouvelle fenêtre de graduations).
   * On balaie donc la bascule pas à pas et on affirme la seule propriété qui compte : entre
   * deux relevés voisins, le ruban n'avance jamais de plus qu'un pas — jamais d'un cran de
   * 23 px. Un balayage, pas trois cas choisis : c'est au bord que les défauts vivent.
   */
  it('la bascule d’un jour au suivant ne fait AUCUN saut', () => {
    const echantillons: number[] = []
    for (let i = 0; i <= 20; i += 1) {
      const t = 0.9 + i * 0.01 // de 0,90 à 1,10 — la bascule est à 1,00
      const jour = 52 + Math.floor(t)
      const frac = t - Math.floor(t)
      echantillons.push(jouer(etat({ time: temps({ seasonDay: jour, jourFrac: frac }) })).vue.tapisX)
    }
    // Le pas nominal entre deux relevés vaut 0,23 px ; l'arrondi au pixel le borne à 1.
    for (let i = 1; i < echantillons.length; i += 1) {
      const pas = echantillons[i - 1]! - echantillons[i]!
      expect(pas, `entre les relevés ${i - 1} et ${i}`).toBeGreaterThanOrEqual(0)
      expect(pas, `entre les relevés ${i - 1} et ${i}`).toBeLessThanOrEqual(1)
    }
    // Et sur toute la traversée, le ruban a bien avancé d'un cinquième de jour — 4,6 px,
    // donc 4 ou 5 selon où tombent les deux arrondis d'extrémité.
    const course = echantillons[0]! - echantillons[echantillons.length - 1]!
    expect(course).toBeGreaterThanOrEqual(4)
    expect(course).toBeLessThanOrEqual(5)
  })

  it('le voile du passé suit la tête, il ne s’arrête pas au jour entier', () => {
    const w = (frac: number): number => jouer(etat({ time: temps({ jourFrac: frac }) })).vue.passeW
    expect(w(0.75)).toBeGreaterThan(w(0.25))
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
    // …et il coule DANS l'heure, comme le ruban dans le jour.
    const demi = jouer(etat({ time: temps({ hourOfCycle: 10.5 }) })).vue.cielX
    expect(a - demi).toBe(11)
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
    'le toponyme en surtitre et l’an (encre effacée)': [139, 132, 116],
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

/**
 * LE CADRAN DU VENT (spec `vent.md` V10, décision d'Alexis 2026-08-24).
 *
 * Deux choses s'y gardent, et une seule est évidente : l'aiguille pointe où le vent VA, et
 * l'angle est DÉROULÉ — sans quoi la transition CSS ferait un tour complet à l'envers chaque
 * fois que le cap franchit l'est.
 */
describe('le cadran du vent (V10)', () => {
  const avecVent = (x: number, y: number, force: number = VENT.AMBIANT): BarreHauteState =>
    etat({ vent: { x, y, force } })

  it('l’aiguille pointe LÀ OÙ LE VENT VA — le même sens que les herbes couchées', () => {
    // Le monde se rend en projection directe : l'angle écran EST l'angle monde. On affirme la
    // DIRECTION, pas le nombre : l'angle est déroulé, donc 180° et −180° sont le même cap et
    // comparer les degrés ferait rougir une garde pour une identité trigonométrique.
    const pointe = (x: number, y: number): void => {
      const deg = jouer(avecVent(x, y)).vue.ventDeg
      // Tolérance 1e-4 : les diagonales de `BEARINGS` sont écrites `0.7071`, tronquées à la
      // précision où l'on place un loup — pas à celle d'un `Math.sqrt`.
      expect(Math.cos((deg * Math.PI) / 180), `x pour (${x},${y})`).toBeCloseTo(x, 4)
      expect(Math.sin((deg * Math.PI) / 180), `y pour (${x},${y})`).toBeCloseTo(y, 4)
    }
    pointe(1, 0) // vers l'est
    pointe(0, 1) // vers le sud (y croît vers le bas)
    pointe(-1, 0)
    pointe(0, -1)
    // Et les diagonales, qui sont la moitié des huit relèvements de la sim.
    pointe(0.7071, 0.7071)
    pointe(-0.7071, 0.7071)
  })

  it('l’angle se DÉROULE : franchir l’est ne fait pas faire un tour à l’envers', () => {
    // 170° → −170° est un pas de +20°, pas de −340°. C'est la propriété qui compte, et elle
    // se lit sur l'ÉCART, jamais sur la valeur absolue.
    const cap = (deg: number) => avecVent(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180))
    const suite = jouer(cap(170), cap(-170), cap(170), cap(-170))
    expect(Math.abs(suite.vue.ventDeg)).toBeGreaterThan(180) // il a continué, il n'est pas revenu
    // Et chaque pas reste court : on rejoue la suite en relevant les écarts.
    let memoire: MemoireDuLieu = MEMOIRE_VIERGE
    let precedent = 0
    for (const deg of [170, -170, 170, -170, 170]) {
      const out = vueDeLaBarre(cap(deg), memoire)
      memoire = out.memoire
      expect(Math.abs(out.vue.ventDeg - precedent), `pas vers ${deg}°`).toBeLessThanOrEqual(180)
      precedent = out.vue.ventDeg
    }
  })

  it('la FORCE se lit en intensité — et le calme plat éteint le cadran', () => {
    expect(jouer(avecVent(1, 0, VENT.AMBIANT)).vue.ventOp).toBe('0.500')
    expect(jouer(avecVent(1, 0, 1)).vue.ventOp).toBe('1.000')
    expect(Number(jouer(avecVent(1, 0, 1)).vue.ventEchelle)).toBeGreaterThan(
      Number(jouer(avecVent(1, 0, VENT.AMBIANT)).vue.ventEchelle),
    )
    // La sentinelle de l'hôte (`wind = {0,0}` → force 0) : rien à montrer, et le clamp la
    // ramène au bas de la plage au lieu de rendre une opacité négative.
    expect(jouer(avecVent(0, 0, 0)).vue.ventVisible).toBe(false)
    expect(jouer(avecVent(1, 0, 0)).vue.ventOp).toBe('0.500')
  })

  it('sans vent transmis, le cadran se cache — il n’invente pas un cap', () => {
    expect(jouer(etat()).vue.ventVisible).toBe(false)
  })
})

/**
 * ═══ LE RUBAN DU CIEL NE S'EFFONDRE PAS (2026-08-26) ═══
 *
 * Le dégradé pose l'ambiance du monde sur une règle en heures MURALES, et le jour suit la
 * saison (`saisons.md` S6). La première forme convertissait chaque keyframe vers son heure
 * murale et les posait dans l'ordre de la table : dès que la journée raccourcit, la liste
 * cesse de croître (MESURÉ au jour 105 : 90,3 % · 19,2 % · 25,0 % …) — et **CSS comme SVG
 * rabattent tout stop sur le plus grand qui précède**, si bien que le ruban devenait une
 * bande de nuit plate, sur toute la moitié sombre de l'année, sans une erreur.
 *
 * ⚠ CE QUI FERAIT ROUGIR CES GARDES, dit avant d'accepter le vert : des arrêts qui reculent,
 * ou un ruban où le point le plus CLAIR ne tombe plus dans le jour de la sim — ce qui est
 * exactement l'état d'un dégradé effondré. Éprouvé en remettant la conversion par keyframe :
 * les deux rougissent dès le jour 76, et restent vertes aux jours d'été.
 */
describe('le ruban du ciel suit la saison', () => {
  /** Les arrêts du dégradé, en pour-cent, dans l'ordre où ils sont émis. */
  const arrets = (css: string): number[] =>
    [...css.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]))
  /** La luminance de chaque arrêt — le ruban est peint sur un sol unique, donc c'est un profil. */
  const clartes = (css: string): number[] =>
    [...css.matchAll(/rgb\((\d+),(\d+),(\d+)\)/g)].map((m) => Number(m[1]) + Number(m[2]) + Number(m[3]))

  it('ses arrêts CROISSENT, tous les jours de l’année', () => {
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      const xs = arrets(cielDuJour(dayTicksPourJour(jour), leverPourJour(jour)))
      expect(xs.length, `jour ${jour}`).toBeGreaterThan(24)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i], `jour ${jour}, arrêt ${i}`).toBeGreaterThan(xs[i - 1]!)
      }
    }
  })

  it('son point le plus CLAIR tombe dans le jour de la sim, le plus SOMBRE dans sa nuit', () => {
    // La propriété que l'effondrement rompait : un ruban rabattu sur une bande de nuit a son
    // maximum n'importe où. On la vérifie sur l'année entière, contre la bascule de la sim.
    for (let jour = 1; jour <= YEAR_DAYS; jour++) {
      const dt = dayTicksPourJour(jour)
      const aube = leverPourJour(jour)
      const css = cielDuJour(dt, aube)
      const xs = arrets(css)
      const l = clartes(css)
      // L'heure MURALE où la sim bascule en nuit, en pour-cent de la règle du ruban.
      const crepuscule = ((aube + 24 * (dt / TICKS_PER_CYCLE)) / 24) * 100
      const clair = xs[l.indexOf(Math.max(...l))]!
      const sombre = xs[l.indexOf(Math.min(...l))]!
      expect(clair, `le plus clair, jour ${jour}`).toBeGreaterThan((aube / 24) * 100)
      expect(clair, `le plus clair, jour ${jour}`).toBeLessThan(crepuscule)
      expect(sombre >= crepuscule || sombre <= (aube / 24) * 100, `le plus sombre, jour ${jour} (${sombre}%)`).toBe(true)
    }
  })
})
