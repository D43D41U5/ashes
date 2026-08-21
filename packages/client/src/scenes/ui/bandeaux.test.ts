import { describe, expect, it } from 'vitest'
import {
  ALERTE_FADE_MS,
  ALERTE_HOLD_MS,
  CONSEIL_FADE_MS,
  CONSEIL_HOLD_MS,
  FILE_MAX,
  avancerCreneau,
  empiler,
  opacite,
} from './bandeaux'

/**
 * LE DÉFAUT CARDINAL, EN UN TEST (audit UX 2026-08-20, P0.2).
 *
 * Le canal d'alerte était **une case unique**. `publishError` écrivait une VALEUR, et HUIT
 * émetteurs se la partageaient : le refus d'une action, la nuit qui tombe, le hurlement du
 * loup, le raclement dans le noir, le télégraphe de la Cendre — et le départ de l'Arche.
 * Deux faits dans la même fenêtre de 2,5 s, et le second effaçait le premier avant lecture.
 *
 * La mécanique est extraite et pure pour être prouvée ici : c'est elle qui porte la
 * correction, donc c'est elle qu'on garde. La règle tient en une phrase — **on ne remplace
 * jamais un message avant qu'il ait fini son temps.**
 */
const creneau = () => ({ file: [] as string[], affiche: null as string | null, depuis: 0 })

describe('le créneau d’un bandeau', () => {
  it('LE DÉFAUT : deux messages coup sur coup — le second n’efface plus le premier', () => {
    const c = creneau()
    // C'est exactement le cas qui faisait disparaître le départ de l'Arche derrière un
    // refus de pose : les deux tombent dans le même souffle.
    empiler(c.file, ['Une arche s’est ouverte. Embarquez.', 'trop proche d’un autre Feu'])
    avancerCreneau(c, 1000, ALERTE_HOLD_MS, ALERTE_FADE_MS)
    expect(c.affiche).toBe('Une arche s’est ouverte. Embarquez.') // le PREMIER, et il tient

    // Et il tient VRAIMENT : tant qu'il n'a pas fini, rien ne prend sa place.
    avancerCreneau(c, 1000 + ALERTE_HOLD_MS - 1, ALERTE_HOLD_MS, ALERTE_FADE_MS)
    expect(c.affiche).toBe('Une arche s’est ouverte. Embarquez.')

    // Puis le second sort, à son tour. Rien n'est perdu.
    avancerCreneau(c, 1000 + ALERTE_HOLD_MS + ALERTE_FADE_MS, ALERTE_HOLD_MS, ALERTE_FADE_MS)
    expect(c.affiche).toBe('trop proche d’un autre Feu')
  })

  it('le créneau se libère quand la file est vide', () => {
    const c = creneau()
    empiler(c.file, ['seul'])
    avancerCreneau(c, 0, ALERTE_HOLD_MS, ALERTE_FADE_MS)
    expect(c.affiche).toBe('seul')
    avancerCreneau(c, ALERTE_HOLD_MS + ALERTE_FADE_MS, ALERTE_HOLD_MS, ALERTE_FADE_MS)
    expect(c.affiche).toBeNull()
  })

  it('une rafale ne fait pas lire le PASSÉ : la file est bornée, et garde les récents', () => {
    // Sans plafond, une horde qui arrive pendant qu'on rate trois poses ferait défiler des
    // messages périmés une demi-minute durant. Ce qui compte est ce qui vient de se passer.
    const file: string[] = []
    empiler(file, ['1', '2', '3', '4', '5', '6', '7'])
    expect(file.length).toBe(FILE_MAX)
    expect(file[file.length - 1]).toBe('7') // le plus RÉCENT survit
    expect(file[0]).toBe('4') // les plus vieux sont tombés
  })

  it('l’ordre est celui d’arrivée — un bandeau n’est pas une pile', () => {
    const c = creneau()
    empiler(c.file, ['a', 'b', 'c'])
    const sortis: (string | null)[] = []
    for (let t = 0; t <= 3 * (ALERTE_HOLD_MS + ALERTE_FADE_MS); t += ALERTE_HOLD_MS + ALERTE_FADE_MS) {
      avancerCreneau(c, t, ALERTE_HOLD_MS, ALERTE_FADE_MS)
      sortis.push(c.affiche)
    }
    expect(sortis.slice(0, 3)).toEqual(['a', 'b', 'c'])
  })
})

describe('le fondu', () => {
  it('pleine encre pendant la tenue, puis descente linéaire, puis rien', () => {
    expect(opacite(0, 0, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)).toBe(1)
    expect(opacite(0, CONSEIL_HOLD_MS, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)).toBe(1)
    expect(opacite(0, CONSEIL_HOLD_MS + CONSEIL_FADE_MS / 2, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)).toBeCloseTo(0.5, 5)
    expect(opacite(0, CONSEIL_HOLD_MS + CONSEIL_FADE_MS, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)).toBe(0)
    expect(opacite(0, 1e9, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)).toBe(0)
  })
})

describe('les deux registres restent distincts', () => {
  /**
   * On répare le CANAL, on ne fusionne pas les registres : le conseil ENSEIGNE, l'alerte
   * CRIE (audit UI/UX P2-7). Deux places, deux encres — et deux durées, parce qu'on LIT une
   * règle alors qu'on SUBIT un refus.
   */
  it('le conseil se tient bien plus longtemps que l’alerte', () => {
    expect(CONSEIL_HOLD_MS).toBeGreaterThan(ALERTE_HOLD_MS * 2)
    expect(CONSEIL_FADE_MS).toBeGreaterThan(ALERTE_FADE_MS)
  })

  it('et leurs files n’interfèrent pas — un refus ne mange pas une leçon', () => {
    const alerte = creneau()
    const conseil = creneau()
    empiler(alerte.file, ['hors de portée', 'trop tôt', 'matériaux insuffisants'])
    empiler(conseil.file, ['Ramassez du bois : il vous faut un FEU avant la nuit.'])
    avancerCreneau(alerte, 0, ALERTE_HOLD_MS, ALERTE_FADE_MS)
    avancerCreneau(conseil, 0, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)
    // Trois refus se bousculent ; la leçon, elle, tient sa place tout du long.
    for (let t = 0; t <= CONSEIL_HOLD_MS; t += 500) {
      avancerCreneau(alerte, t, ALERTE_HOLD_MS, ALERTE_FADE_MS)
      avancerCreneau(conseil, t, CONSEIL_HOLD_MS, CONSEIL_FADE_MS)
    }
    // La leçon tient sa place tout du long — c'est ce qui compte.
    expect(conseil.affiche).toBe('Ramassez du bois : il vous faut un FEU avant la nuit.')
    // Et l'alerte a tourné de son côté, à SON rythme : sur les 6 s du conseil, son cycle de
    // 3,1 s en laisse passer deux. Elle n'est ni bloquée par la leçon, ni synchronisée sur
    // elle — deux canaux, deux horloges.
    expect(alerte.affiche).toBe('trop tôt')
    expect(alerte.file).toEqual(['matériaux insuffisants']) // le troisième attend son tour
  })
})
