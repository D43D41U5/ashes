import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@ashes/sim'
import { SONORES } from './inventaire'
import { dangerProche, MUSIQUE, type Piste, ThemeAmbiance } from './musique'
import { soundForEvent } from './sound'

/**
 * CE QUE CE FICHIER GARDE — le contrat tel qu'Alexis l'a posé le 2026-08-27 :
 * un passage espacé au hasard, deux fondus de longueurs DIFFÉRENTES, une coupure sur le
 * danger, et surtout : la musique ne revient PAS tant que le calme n'a pas duré.
 *
 * Le son ne s'entend pas en test — c'est la `Piste` de papier qui est la surface éprouvable,
 * exactement comme `chirps` l'est pour les oiseaux de l'aube.
 */

/** Une bande sonore de papier : elle NOTE ce qu'on lui demande. */
function pisteDePapier(dureeS = 136) {
  const gestes: string[] = []
  let rampes: { v: number; s: number }[] = []
  let reste = dureeS
  const piste: Piste = {
    jouer: (niveau, fonduS) => {
      // ⚠ UN SEUL GESTE : la lecture PORTE son fondu, parce que la rampe doit attendre que la
      //    bande roule vraiment (voir `Piste.jouer`). Deux appels séparés, et l'entrée se
      //    jouerait sur du silence.
      gestes.push(`jouer:${niveau}/${fonduS}`)
      reste = dureeS
    },
    arreter: () => gestes.push('arreter'),
    rampe: (v, s) => {
      gestes.push(`rampe:${v}/${s}`)
      rampes.push({ v, s })
    },
    resteS: () => reste,
  }
  return {
    piste,
    gestes,
    get rampes() {
      return rampes
    },
    vider: () => {
      gestes.length = 0
      rampes = []
    },
    /** Fait avancer la bande (ce que le `<audio>` ferait tout seul). */
    consommer: (s: number) => {
      reste -= s
    },
  }
}

/** Le thème et sa bande, avec un tirage FIGÉ : on veut des instants, pas du hasard.
 *  ⚠ IL N'OUVRE PAS TOUT SEUL : depuis qu'`OUVERTURE_MS` vaut 0, la PREMIÈRE image EST le
 *  premier passage — chaque test la conduit lui-même, pour qu'on voie où elle tombe. */
function monter(alea = 0.5, dureeS = 136) {
  const bande = pisteDePapier(dureeS)
  const theme = new ThemeAmbiance(() => bande.piste, () => alea)
  return { theme, bande }
}

/** Ouvre la run et rend la main juste après, la bande remise à zéro. */
function ouvrir(m: ReturnType<typeof monter>): void {
  m.theme.update(0, false)
  m.bande.vider()
}

/**
 * LE PIC RÉEL DU REGISTRE — mesuré sur `soundForEvent` pour TOUS les faits sonores, jamais
 * recopié. Un nombre écrit à la main ici deviendrait faux à la première retouche d'un SFX,
 * et la garde du niveau ne garderait plus rien.
 */
function picDuRegistre(): number {
  let pic = 0
  for (const type of SONORES) {
    for (const onMe of [true, false]) {
      const e = { type, tick: 0, entityId: onMe ? 1 : 2, byEntityId: 9, targetEntityId: onMe ? 1 : 2 } as unknown as SimEvent
      const spec = soundForEvent(e, onMe)
      if (spec) pic = Math.max(pic, spec.gain)
    }
  }
  return pic
}


describe('le thème d’ambiance', () => {
  it('OUVRE LA RUN — le premier passage n’est pas espacé', () => {
    // Alexis, 2026-08-27 : « je n'entends pas la musique au lancement de la run… il faudrait au
    // moins ça avant le reste des passages aléatoires ». Le thème part à la PREMIÈRE image
    // jouable ; seuls les passages SUIVANTS sont tirés au hasard.
    const { theme, bande } = monter(0.5)
    theme.update(0, false)
    expect(theme.passages).toBe(1)
    expect(bande.gestes).toEqual([`jouer:${MUSIQUE.NIVEAU}/${MUSIQUE.FONDU_ENTREE_S}`])
    expect(theme.phase).toBe('joue')
  })

  it('le niveau reste un DÉCOR : il ne masque pas le SFX le plus fort du jeu', () => {
    // « La musique ne doit pas masquer le reste » (Alexis, 2026-08-27). Le thème est une nappe
    // TENUE ; un SFX est un transitoire. À gain crête égal, la nappe l'emporte déjà largement à
    // l'oreille — alors le thème passe SOUS le pic du registre, mesuré et non recopié.
    const pic = picDuRegistre()
    expect(pic).toBeGreaterThan(0) // la sonde doit pouvoir échouer : un registre muet ne prouve rien
    expect(MUSIQUE.NIVEAU).toBeLessThan(pic)
  })

  it('fond à la FIN du morceau — et le fondu de sortie s’amorce AVANT la fin de la bande', () => {
    const m = monter(0.5)
    const { theme, bande } = m
    ouvrir(m)

    // Il reste plus que le fondu : on ne touche à rien.
    bande.consommer(136 - MUSIQUE.FONDU_SORTIE_S - 1)
    theme.update(1000, false)
    expect(bande.gestes).toEqual([])

    bande.consommer(1)
    const t = 2000
    theme.update(t, false)
    expect(bande.gestes).toEqual([`rampe:0/${MUSIQUE.FONDU_SORTIE_S}`])
    expect(theme.phase).toBe('sort')

    // La piste ne s'arrête qu'une fois le fondu CONSOMMÉ, pas au moment où on l'ordonne.
    theme.update(t + MUSIQUE.FONDU_SORTIE_S * 1000 - 1, false)
    expect(theme.phase).toBe('sort')
    theme.update(t + MUSIQUE.FONDU_SORTIE_S * 1000, false)
    expect(bande.gestes).toContain('arreter')
    expect(theme.phase).toBe('attente')
  })

  it('le danger COUPE, et la coupure est bien plus courte que la sortie de fin', () => {
    const m = monter(0.5)
    const { theme, bande } = m
    ouvrir(m)

    theme.update(1000, true)
    expect(theme.coupures).toBe(1)
    expect(bande.gestes).toEqual([`rampe:0/${MUSIQUE.FONDU_COUPURE_S}`])
    // Une coupure qui dure autant qu'une fin de morceau ne se lit plus comme une réaction.
    expect(MUSIQUE.FONDU_COUPURE_S).toBeLessThan(MUSIQUE.FONDU_SORTIE_S / 4)
  })

  it('NE REVIENT PAS pendant le combat — l’apaisement se mesure en niveau, pas sur un front', () => {
    const m = monter(0) // tirages au plancher : l'espacement vaudra ECART_MIN
    const { theme } = m
    theme.update(0, false) // l'ouverture de la run = passage 1
    expect(theme.passages).toBe(1)

    const coupeA = 1000
    theme.update(coupeA, true)
    theme.update(coupeA + MUSIQUE.FONDU_COUPURE_S * 1000, true) // le fondu est consommé
    expect(theme.phase).toBe('attente')
    const silenceA = coupeA + MUSIQUE.FONDU_COUPURE_S * 1000 // d'ici part l'espacement

    // L'IA des monstres pense à 2 Hz : `targetId` CLIGNOTE. On rejoue ce clignotement pendant
    // tout l'espacement — sur un FRONT, le thème repartirait dans un trou, en plein combat.
    let dernierDanger = silenceA
    let t = silenceA
    const fin = silenceA + MUSIQUE.ECART_MIN_MS + MUSIQUE.APAISEMENT_MS * 2
    for (; t <= fin; t += 500) {
      const danger = t % 1000 === 0
      if (danger) dernierDanger = t
      theme.update(t, danger)
    }
    expect(theme.passages).toBe(1) // toujours un seul : la musique s'est tue et le reste

    // Le calme s'installe pour de bon. Il faut ENCORE l'apaisement COMPLET depuis le dernier
    // instant de danger — pas depuis la fin du combat telle qu'un observateur la daterait.
    theme.update(dernierDanger + MUSIQUE.APAISEMENT_MS - 1, false)
    expect(theme.passages).toBe(1)
    theme.update(dernierDanger + MUSIQUE.APAISEMENT_MS, false)
    expect(theme.passages).toBe(2)
  })

  it('un espacement plus long que le morceau : deux passages ne se touchent jamais', () => {
    expect(MUSIQUE.ECART_MIN_MS).toBeGreaterThan(136_000)
  })

  it('tant que l’audio dort, le thème patiente sans se consommer', () => {
    // Le navigateur n'accorde l'audio qu'au premier geste : l'ouverture de la run ne doit pas
    // se CONSOMMER dans le vide en attendant, sinon le joueur ne l'entend jamais.
    let bande: ReturnType<typeof pisteDePapier> | null = null
    const theme = new ThemeAmbiance(() => bande?.piste ?? null, () => 0.5)
    for (let t = 0; t <= 60_000; t += 1000) theme.update(t, false)
    expect(theme.passages).toBe(0) // pas de contexte : rien n'a été gaspillé
    bande = pisteDePapier()
    theme.update(61_000, false)
    expect(theme.passages).toBe(1) // …et l'ouverture a bien lieu, au premier geste accordé
  })
})

describe('le danger qui coupe', () => {
  const moi = { x: 100, y: 100 }
  const pos =
    (id: number, x: number, y: number) =>
    (q: number): { x: number; y: number } | undefined =>
      q === id ? { x, y } : undefined
  const nulPart = (): undefined => undefined

  it('un monstre qui a MA cible coupe ; un monstre qui chasse autre chose, non', () => {
    expect(dangerProche(moi, 7, [{ entityId: 9, targetId: 7 }], pos(9, 103, 100), [])).toBe(true)
    expect(dangerProche(moi, 7, [{ entityId: 9, targetId: 42 }], pos(9, 103, 100), [])).toBe(false)
    expect(dangerProche(moi, 7, [{ entityId: 9, targetId: null }], pos(9, 100, 100), [])).toBe(false)
  })

  it('un traqueur à l’autre bout de la carte ne tient pas la musique en otage', () => {
    const loin = MUSIQUE.PORTEE_AGGRO + 5
    expect(dangerProche(moi, 7, [{ entityId: 9, targetId: 7 }], pos(9, 100 + loin, 100), [])).toBe(false)
  })

  it('UN RÉVEIL À PORTÉE COUPE — même sans aucun monstre (le monstre n’existe pas encore)', () => {
    const pres = { x: 100 + MUSIQUE.PORTEE_REVEIL - 1, y: 100 }
    const loin = { x: 100 + MUSIQUE.PORTEE_REVEIL + 1, y: 100 }
    expect(dangerProche(moi, 7, [], nulPart, [pres])).toBe(true)
    expect(dangerProche(moi, 7, [], nulPart, [loin])).toBe(false)
  })

  it('la portée du réveil tient DANS LE CADRE : ce qui coupe la musique se voit', () => {
    // L'étalon est la hauteur visible (20 tuiles) : un rayon qui la déborderait ferait taire
    // le thème pour un sol qui se soulève hors de l'image.
    expect(MUSIQUE.PORTEE_REVEIL).toBeLessThan(20 / 2 + 6)
  })

  it('sans avatar, aucun danger — on ne coupe pas sur un monde qu’on ne situe pas', () => {
    expect(dangerProche(undefined, 7, [{ entityId: 9, targetId: 7 }], pos(9, 100, 100), [moi])).toBe(false)
  })
})
