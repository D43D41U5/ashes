import { describe, expect, it } from 'vitest'
import {
  ALERTE_FADE_MS,
  ALERTE_HOLD_MS,
  CONSEIL_FADE_MS,
  CONSEIL_HOLD_MS,
  DECOUVERTE_ENTREE_MS,
  DECOUVERTE_SORTIE_MS,
  DECOUVERTE_TENUE_MS,
  FILE_MAX,
  avancerCreneau,
  empiler,
  geometrieDecouverte,
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

/**
 * LE CARTON DE DÉCOUVERTE (2026-08-25) — sa géométrie, aux deux bouts et TOUT DU LONG.
 *
 * Ce qui ferait rougir ces tests, énoncé d'abord : une animation posée par PALIERS (le
 * carton apparaît puis se pose), une sortie EN MIROIR de l'entrée (il repart par où il est
 * venu — un yo-yo), une opacité qui n'atteint jamais 1 pendant la tenue, ou un carton qui
 * survit à sa fenêtre. C'est le prix du modèle TLD : les noms ne flottent plus sur le
 * paysage, donc ce carton est le SEUL moment où un lieu se nomme — s'il rate son passage,
 * le joueur n'apprend jamais où il est allé.
 */
describe('la géométrie du carton de découverte', () => {
  const FIN_ENTREE = DECOUVERTE_ENTREE_MS
  const FIN = DECOUVERTE_TENUE_MS + DECOUVERTE_SORTIE_MS

  it('les trois instants clefs : absent, plein, parti', () => {
    const debut = geometrieDecouverte(0, 0)
    expect(debut.opacite).toBe(0)
    expect(debut.dy).toBeGreaterThan(0) // il arrive PAR LE BAS
    expect(debut.filet).toBe(0)

    const plein = geometrieDecouverte(0, FIN_ENTREE)
    expect(plein.opacite).toBe(1)
    expect(plein.dy).toBe(0)
    expect(plein.echelle).toBe(1)
    expect(plein.filet).toBe(1)

    const parti = geometrieDecouverte(0, FIN)
    expect(parti.opacite).toBe(0)
    // ET IL EST PARTI VERS LE HAUT : une sortie en miroir de l'entrée (dy > 0) serait un
    // aller-retour, pas un passage. C'est l'assertion qui attrape le copier-coller.
    expect(parti.dy).toBeLessThan(0)
  })

  it('la pente est CONTINUE sur toute l’entrée, jamais par paliers', () => {
    // Balayage exhaustif de la fenêtre d'entrée : opacité et hauteur doivent avancer à
    // CHAQUE pas. Un seul palier (deux échantillons identiques) fait rougir.
    const PAS = 20
    let precedent = geometrieDecouverte(0, 0)
    for (let t = PAS; t <= FIN_ENTREE; t += PAS) {
      const g = geometrieDecouverte(0, t)
      expect(g.opacite).toBeGreaterThan(precedent.opacite)
      expect(g.dy).toBeLessThan(precedent.dy)
      expect(g.ecart).toBeLessThan(precedent.ecart) // l'interlettre se resserre en arrivant
      precedent = g
    }
  })

  it('la TENUE est pleine encre du début à la fin — on lit un nom propre', () => {
    for (let t = FIN_ENTREE; t <= DECOUVERTE_TENUE_MS; t += 100) {
      expect(geometrieDecouverte(0, t).opacite).toBe(1)
    }
  })

  it('la SORTIE efface tout, et rien ne dépasse la fenêtre', () => {
    let precedent = geometrieDecouverte(0, DECOUVERTE_TENUE_MS)
    for (let t = DECOUVERTE_TENUE_MS + 20; t <= FIN; t += 20) {
      const g = geometrieDecouverte(0, t)
      expect(g.opacite).toBeLessThan(precedent.opacite)
      precedent = g
    }
    // Au-delà, la géométrie reste bornée : pas de dy qui file à l'infini si une frame tarde.
    const bienApres = geometrieDecouverte(0, FIN + 60_000)
    expect(bienApres.opacite).toBe(0)
    expect(bienApres.dy).toBe(geometrieDecouverte(0, FIN).dy)
  })

  it('deux lieux voisins : le second attend son tour, il n’efface pas le premier', () => {
    // Le cas réel : on traverse une Combe brumeuse et on tombe sur une ferme ruinée dans la
    // foulée. Sans file, le nom de la Combe disparaîtrait avant d'avoir été lu.
    const c = creneau()
    empiler(c.file, ['La Combe brumeuse', 'La Ferme des Frênes'])
    avancerCreneau(c, 0, DECOUVERTE_TENUE_MS, DECOUVERTE_SORTIE_MS)
    expect(c.affiche).toBe('La Combe brumeuse')
    avancerCreneau(c, FIN - 1, DECOUVERTE_TENUE_MS, DECOUVERTE_SORTIE_MS)
    expect(c.affiche).toBe('La Combe brumeuse') // il parle encore
    avancerCreneau(c, FIN, DECOUVERTE_TENUE_MS, DECOUVERTE_SORTIE_MS)
    expect(c.affiche).toBe('La Ferme des Frênes')
  })
})
