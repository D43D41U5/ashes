import { describe, it, expect } from 'vitest'
import {
  nextOnboardingHint,
  BASICS_DELAY_MS,
  MAKE_FIRE_DELAY_MS,
  type OnboardingHintId,
  type OnboardingState,
} from './onboarding'

/** Un état neutre : rien de spécial, au tout début. Chaque test n'en change que ce qu'il teste. */
const base = (o: Partial<OnboardingState> = {}): OnboardingState => ({
  msAlive: 0,
  hasFire: false,
  fireLow: false,
  hasWeapon: false,
  weaponRanged: false,
  hasWood: true, // par défaut : le septième conseil ne se déclenche que sur un manque RÉEL
  // Des libellés FIXES et reconnaissables : le résolveur reste pur, et les tests n'ont pas
  // à connaître le réglage de touches du joueur. Ce sont les valeurs livrées par défaut.
  touches: { cueillir: 'F', sac: 'TAB', parade: 'ESPACE' },
  neighborNear: false,
  ...o,
})

const none = new Set<OnboardingHintId>()
const shown = (...ids: OnboardingHintId[]) => new Set<OnboardingHintId>(ids)

describe('onboarding — piloté par l’état', () => {
  it('ne dit RIEN dans le tout premier souffle (avant le délai des bases)', () => {
    expect(nextOnboardingHint(base({ msAlive: BASICS_DELAY_MS - 1 }), none)).toBeNull()
  })

  it('dit LES BASES une fois le souffle passé', () => {
    const h = nextOnboardingHint(base({ msAlive: BASICS_DELAY_MS }), none)
    expect(h?.id).toBe('basics')
    // Le premier geste enseigné, c'est CUEILLIR — passée de E à F le 2026-07-27 pour libérer
    // E : A et E tournent désormais ce qu'on pose (décision d'Alexis). Le geste est le même —
    // ce n'est plus « clic gauche : récolter ». Cf. onboarding.ts HINT_TEXT.basics.
    expect(h?.text).toMatch(/cueillir/i)
  })

  it('ne répète JAMAIS un conseil déjà montré', () => {
    // Les bases montrées, rien d'autre à dire pour l'instant → null (pas de re-basics).
    expect(nextOnboardingHint(base({ msAlive: BASICS_DELAY_MS }), shown('basics'))).toBeNull()
  })

  it('RAPPELLE le feu après le délai, tant qu’on n’en a pas', () => {
    const h = nextOnboardingHint(base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: false }), shown('basics'))
    expect(h?.id).toBe('make-fire')
  })

  it('NE rappelle PAS le feu si l’on en a déjà un (le bug de l’horloge)', () => {
    // C'est tout le sens du pilotage par état : un joueur qui a fait son feu
    // ne doit plus s'entendre dire d'en faire un.
    const h = nextOnboardingHint(base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: true }), shown('basics'))
    expect(h?.id).not.toBe('make-fire')
  })

  it('enseigne la VALEUR du feu à l’instant où il naît', () => {
    const h = nextOnboardingHint(base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: true }), shown('basics'))
    expect(h?.id).toBe('fire-purpose')
  })

  it('enseigne le COMBAT dès qu’une arme est en main — et ça prime sur tout', () => {
    // Arme en main ET feu qui vient de naître : le combat (mortel, fugace) passe devant.
    const h = nextOnboardingHint(
      base({ msAlive: MAKE_FIRE_DELAY_MS, hasFire: true, hasWeapon: true }),
      shown('basics'),
    )
    expect(h?.id).toBe('weapon')
    expect(h?.text).toMatch(/parez/i)
  })

  it('enseigne le DON quand un voisin approche', () => {
    const h = nextOnboardingHint(base({ msAlive: 3000, neighborNear: true }), shown('basics', 'make-fire'))
    expect(h?.id).toBe('give-neighbor')
    expect(h?.text).toMatch(/donner/i)
  })

  it('enseigne à NOURRIR le Feu quand il faiblit (geste câblé le 2026-07-23)', () => {
    const h = nextOnboardingHint(
      base({ msAlive: 1e6, hasFire: true, fireLow: true }),
      shown('basics', 'fire-purpose'),
    )
    expect(h?.id).toBe('feed-fire')
    expect(h?.text).toMatch(/nourrir/i)
  })

  it('ne parle PAS de nourrir le Feu tant qu’il ne faiblit pas (au moment utile, pas avant)', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasFire: true, fireLow: false }), shown('basics', 'fire-purpose'))
    expect(h?.id).not.toBe('feed-fire')
  })

  it('une fois TOUT montré, ne dit plus rien', () => {
    const all = shown('basics', 'make-fire', 'fire-purpose', 'feed-fire', 'give-neighbor', 'weapon')
    const state = base({ msAlive: 1e6, hasFire: true, fireLow: true, hasWeapon: true, neighborNear: true })
    expect(nextOnboardingHint(state, all)).toBeNull()
  })
})

/**
 * DEUX FAÇONS DE MENTIR, CORRIGÉES ENSEMBLE (audit UX 2026-08-20, P0.5 et D5-3).
 *
 * Le conseil est le premier professeur du jeu. Il enseignait deux choses fausses :
 *  — la touche, écrite en dur, alors que les trois se rebindent ;
 *  — le geste de combat, servi à un porteur d'ARC dont le clic gauche est inerte.
 * Un conseil qui ment est pire qu'un silence : il est consommé une fois, il ne repasse
 * jamais, et le joueur en conclut que le jeu est cassé.
 */
describe('le conseil ne ment pas sur les touches', () => {
  it('DIT LES TOUCHES DU JOUEUR, pas celles du code', () => {
    const remappe = base({ msAlive: BASICS_DELAY_MS, touches: { cueillir: 'K', sac: 'I', parade: 'MAJ' } })
    const h = nextOnboardingHint(remappe, none)
    expect(h?.id).toBe('basics')
    expect(h?.text).toContain('K')
    expect(h?.text).toContain('I')
    // Et surtout : plus aucune trace des touches LIVRÉES, qui ne feraient plus rien.
    expect(h?.text).not.toContain('TAB')
  })

  it('la règle de PARADE porte elle aussi la touche réglée', () => {
    const h = nextOnboardingHint(
      base({ msAlive: 1e6, hasWeapon: true, touches: { cueillir: 'F', sac: 'TAB', parade: 'MAJ' } }),
      none,
    )
    expect(h?.id).toBe('weapon')
    expect(h?.text).toContain('MAJ')
  })
})

describe('le conseil de combat se TAIT devant un arc', () => {
  it('ARME DE MÊLÉE en main → il dit la parade, comme avant', () => {
    expect(nextOnboardingHint(base({ msAlive: 1e6, hasWeapon: true }), none)?.id).toBe('weapon')
  })

  it('ARC en main → il ne dit RIEN : « MAINTENEZ le clic » ne ferait rien', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasWeapon: true, weaponRanged: true }), none)
    expect(h?.id).not.toBe('weapon')
  })

  it('et il n’est pas CONSOMMÉ : il dira vrai le jour où une lance arrive en main', () => {
    // Le vrai coût du défaut n'était pas le silence — c'était que le conseil, marqué
    // « montré » au passage, ne repassait jamais. On rejoue la séquence complète.
    const avecArc = base({ msAlive: 1e6, hasWeapon: true, weaponRanged: true })
    const rien = nextOnboardingHint(avecArc, none)
    expect(rien?.id).not.toBe('weapon')
    const vus = new Set<OnboardingHintId>(rien ? [rien.id] : [])
    const avecLance = base({ msAlive: 1e6, hasWeapon: true, weaponRanged: false })
    expect(nextOnboardingHint(avecLance, vus)?.id).toBe('weapon')
  })
})

/**
 * L'ORDRE D'OUVERTURE, RATIFIÉ PAR ALEXIS LE 2026-08-20 (question ② de l'audit UX) :
 * **les deux conseils, et dans cet ordre** — `basics` (les verbes) puis `make-fire`
 * (l'échéance mortelle de la première nuit).
 *
 * Il n'a fallu AUCUNE branche nouvelle pour l'obtenir : l'ordre tombe de la chronologie, une
 * fois l'horloge repartie de `worldReady` (P0.6). C'est même la bonne façon de l'obtenir — le
 * réfuteur de l'audit l'avait relevé : l'ordre de la cascade est un départage de SIMULTANÉITÉ,
 * la chronologie ce sont les deux délais.
 *
 * MAIS L'ORDRE EST FRAGILE, et c'est pour ça qu'on le garde. Dans la cascade, `make-fire` est
 * testé AVANT `basics` : si `basics` n'était pas encore passé à la douzième seconde, le rappel
 * du feu prendrait sa place et l'ordre s'inverserait. Ce qui l'empêche est une MARGE, pas une
 * règle écrite : le canal ne peut être préempté qu'une fois avant la douzième seconde (seul
 * `give-neighbor` peut tomber au spawn — `weapon` demande une arme, `fire-purpose` et
 * `feed-fire` un Feu), et une occupation dure moins que le délai du rappel.
 *
 * On n'a PAS rendu la dépendance dure (« make-fire attend que basics soit passé ») : si
 * `basics` venait à ne jamais sortir, le joueur ne s'entendrait plus jamais dire qu'il lui
 * faut un feu avant la nuit. Taire la seule contrainte mortelle du début coûterait plus cher
 * qu'un ordre inversé. On garde donc la marge, et on la surveille.
 */
describe('l’ordre d’ouverture — décision d’Alexis, 2026-08-20', () => {
  /**
   * Rejoue une vraie timeline. Depuis que le canal est une FILE (`conseils`, audit P0.2), il
   * n'y a plus de garde de cadence : on publie librement, le bandeau sort les messages un par
   * un. La chronologie ne tient donc plus qu'aux DÉLAIS — ce qui est plus simple et plus sûr.
   */
  const jouer = (jusquA: number, etat: (ms: number) => Partial<OnboardingState>): OnboardingHintId[] => {
    const vus = new Set<OnboardingHintId>()
    const sortis: OnboardingHintId[] = []
    for (let ms = 0; ms <= jusquA; ms += 100) {
      const h = nextOnboardingHint(base({ msAlive: ms, ...etat(ms) }), vus)
      if (!h) continue
      vus.add(h.id)
      sortis.push(h.id)
    }
    return sortis
  }

  it('une partie neuve entend LES BASES, puis LE FEU — dans cet ordre', () => {
    expect(jouer(20000, () => ({}))).toEqual(['basics', 'make-fire'])
  })

  it('et l’ordre tient même si un VOISIN préempte le canal au spawn', () => {
    // Le seul conseil qui peut passer devant au tout début. Il décale `basics`, sans
    // l'enjamber : c'est exactement la marge que le cas suivant surveille.
    const avecVoisin = jouer(30000, (ms) => ({ neighborNear: ms < 500 }))
    expect(avecVoisin[0]).toBe('give-neighbor')
    expect(avecVoisin.indexOf('basics')).toBeLessThan(avecVoisin.indexOf('make-fire'))
  })

  it('CE QUI TIENT L’ORDRE : les bases se disent avant que le rappel du feu ne mûrisse', () => {
    // Dans la cascade, `make-fire` est testé AVANT `basics` — l'ordre ratifié ne vient donc
    // PAS de là, il vient des délais. Si quelqu'un raccourcit le rappel du feu sous le souffle
    // des bases, l'ordre s'inverse en silence. Ce test est là pour que ça ne passe pas.
    expect(BASICS_DELAY_MS).toBeLessThan(MAKE_FIRE_DELAY_MS)
  })

  it('un joueur qui a DÉJÀ un feu n’entend jamais le rappel — seulement les bases', () => {
    expect(jouer(20000, () => ({ hasFire: true }))).toEqual(['fire-purpose', 'basics'])
  })
})

/**
 * LE SEPTIÈME CONSEIL — décision d'Alexis, 2026-08-20 (question ④).
 *
 * L'arbre est le seul nœud qui ne s'allume PAS au survol, et c'est délibéré : l'abattage
 * n'est pas un clic simple, il arme une jauge. Mais le joueur a appris « ce qui s'allume,
 * je peux le toucher » sur les buissons, les piles et le Feu — il en déduit que les arbres
 * ne se touchent pas. C'est le premier mur de la première Veillée, et il est logique.
 *
 * L'arbitrage a été « le conseil, pas le contour » : on n'ouvre pas le langage du survol
 * (ce serait rouvrir une décision tranchée, et contourner le résolveur unique), on enseigne
 * le geste — mais SEULEMENT quand le joueur a réellement buté dessus.
 */
describe('le septième conseil : couper du bois', () => {
  it('ne se dit PAS avant que le rappel du feu soit passé', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasWood: false }), shown('basics'))
    expect(h?.id).toBe('make-fire') // le rappel d'abord ; on n'explique rien avant d'avoir buté
  })

  it('se dit quand on a dit « ramassez du bois » et qu’il n’en a toujours pas', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasWood: false }), shown('basics', 'make-fire'))
    expect(h?.id).toBe('couper-bois')
    expect(h?.text).toMatch(/maintenez/i) // il dit que le geste se TIENT, pas qu'il se clique
  })

  it('se TAIT dès qu’il a du bois — il a trouvé tout seul', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasWood: true }), shown('basics', 'make-fire'))
    expect(h?.id).not.toBe('couper-bois')
  })

  it('et se tait aussi une fois le Feu fondé — la question ne se pose plus', () => {
    const h = nextOnboardingHint(base({ msAlive: 1e6, hasWood: false, hasFire: true }), shown('basics', 'make-fire', 'fire-purpose'))
    expect(h?.id).not.toBe('couper-bois')
  })
})
