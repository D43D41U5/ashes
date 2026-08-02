/**
 * CE QUE LA BÊTE MONTRE — les deux plaintes d'Alexis du 2026-08-01, en gardes.
 *
 *   « ils bougent allongés »   → la silhouette couchée se choisissait sur L'HEURE seule,
 *                                alors que le repos est la DERNIÈRE branche de la bête :
 *                                rentrer chez soi, regagner son canton, recoller à la harde
 *                                passent avant, et chacune la fait MARCHER.
 *   « parfois ils tremblent »  → le miroir claquait à chaque tick quand le regard rasait
 *                                une frontière de secteur.
 */
import { describe, expect, it } from 'vitest'
import type { Monster } from '@ashes/sim'
import { BEAST_TINTS, COUCHER_DELAI_MS, MIROIR_DELAI_MS, beastTexture, beastTint, majMiroir, majRepos, nouveauMiroir, nouveauRepos } from './beast-posture'

/** Un cerf nu : ni levé, ni tapi, ni méfiant. */
function cerf(patch: Partial<Monster> = {}): Monster {
  return {
    entityId: 1,
    type: 'deer',
    targetId: null,
    thinkAt: 0,
    wanderDx: 0,
    wanderDy: 0,
    fleeing: false,
    lastAttackerId: null,
    fleeSince: -1,
    suspicion: 0,
    ...patch,
  }
}

const NUIT = 21 // hors des heures du cerf (diurne : 6 h → 20 h)
const JOUR = 12

describe('la posture (R9bis / C19)', () => {
  it('un cerf qui MARCHE de nuit est debout — pas couché', () => {
    expect(beastTexture(cerf(), false, NUIT, false)).toBe('spr-deer')
  })

  it('…et il se couche dès qu’il est posé', () => {
    expect(beastTexture(cerf(), false, NUIT, true)).toBe('spr-deer-bed')
  })

  it('de jour, posé ou non, il broute', () => {
    expect(beastTexture(cerf(), false, JOUR, true)).toBe('spr-deer-graze')
    expect(beastTexture(cerf(), false, JOUR, false)).toBe('spr-deer-graze')
  })

  it('la bête TAPIE (C11) reste couchée quelle que soit l’heure — elle ne marche pas', () => {
    expect(beastTexture(cerf({ bedded: true }), false, JOUR, true)).toBe('spr-deer-bed')
  })

  it('elle lève la tête sur le VERROU de la sim, pas sur la jauge nue', () => {
    // Jauge haute mais verrou ouvert (la sim ne l'a pas encore levé) : elle broute.
    expect(beastTexture(cerf({ suspicion: 0.9 }), false, JOUR, false)).toBe('spr-deer-graze')
    // Verrou fermé : tête haute — et ça prime sur l'heure du coucher.
    expect(beastTexture(cerf({ wary: true }), false, JOUR, false)).toBe('spr-deer')
    expect(beastTexture(cerf({ wary: true }), false, NUIT, true)).toBe('spr-deer')
  })

  it('la fuite prime sur tout le reste', () => {
    expect(beastTexture(cerf({ fleeSince: 4, wary: true }), true, NUIT, true)).toBe('spr-deer-flee')
  })
})

describe('le verrou du couché', () => {
  it('se lever est IMMÉDIAT, se coucher demande du temps', () => {
    const l = nouveauRepos(0)
    expect(majRepos(l, true, 0)).toBe(false) // première vue : elle marche, donc debout
    expect(majRepos(l, false, 50)).toBe(false) // elle s'arrête… on ne la couche pas encore
    // Le délai court depuis son DERNIER PAS, pas depuis l'arrêt constaté.
    expect(majRepos(l, false, COUCHER_DELAI_MS - 1)).toBe(false)
    expect(majRepos(l, false, COUCHER_DELAI_MS)).toBe(true) // posée
    expect(majRepos(l, true, COUCHER_DELAI_MS + 50)).toBe(false) // un pas : debout, tout de suite
  })

  it('une bête qui APPARAÎT déjà immobile est couchée TOUT DE SUITE', () => {
    // Le cas qui compte : charger une partie de nuit, se reconnecter, ou entrer dans
    // la zone d'intérêt d'une harde endormie. Un verrou qui démarre « debout » ferait
    // peindre toute la harde debout, puis la coucherait 600 ms plus tard — la plainte
    // d'origine par une autre porte.
    expect(majRepos(nouveauRepos(10_000), false, 10_000)).toBe(true)
    // …et celle qui apparaît EN MOUVEMENT est debout, elle aussi tout de suite.
    expect(majRepos(nouveauRepos(10_000), true, 10_000)).toBe(false)
  })

  it('un brouteur qui s’arrête un tick sur deux ne se couche jamais', () => {
    const l = nouveauRepos(0)
    let posee = false
    for (let t = 0; t < 200; t++) posee ||= majRepos(l, t % 2 === 0, t * 50)
    expect(posee).toBe(false)
  })
})

describe('le miroir ne claque pas', () => {
  it('un regard qui alterne à chaque tick ne retourne JAMAIS le sprite', () => {
    const l = nouveauMiroir(false, 0)
    const adopte = majMiroir(l, false, 0) // première vue : elle regarde à droite
    let change = false
    for (let t = 1; t < 400; t++) change ||= majMiroir(l, t % 2 === 0, t * 50) !== adopte
    expect(change).toBe(false)
  })

  it('…mais une vraie volte-face le retourne', () => {
    const l = nouveauMiroir(false, 0)
    expect(majMiroir(l, false, 0)).toBe(false) // première vue : on adopte, on n'attend pas
    expect(majMiroir(l, true, 10)).toBe(false) // elle vient de se tourner : là, on attend
    expect(majMiroir(l, true, MIROIR_DELAI_MS + 9)).toBe(false)
    expect(majMiroir(l, true, MIROIR_DELAI_MS + 10)).toBe(true)
  })

  it('une bête qui APPARAÎT tournée à gauche est dessinée à gauche, sans délai', () => {
    expect(majMiroir(nouveauMiroir(false, 0), true, 0)).toBe(true)
  })
})

describe('le bond du loup se VOIT (R19)', () => {
  /** Un loup nu, ni rampant ni alpha. */
  function loup(patch: Partial<Monster> = {}): Monster {
    return { ...cerf(), type: 'wolf', ...patch }
  }

  it('un loup en plein bond porte la teinte de MENACE — un bond qu’on ne voit pas ne s’esquive pas', () => {
    expect(beastTint(loup({ leapUntil: 100 }), false, false, 50)).toBe(BEAST_TINTS.menace)
  })

  it('…et il RETOMBE en teinte de souffle : la fenêtre pour le frapper', () => {
    expect(beastTint(loup({ windedUntil: 100 }), false, false, 50)).toBe(BEAST_TINTS.winded)
  })

  it('le bond prime sur la traque : un loup qui bondit n’est plus tapi', () => {
    expect(beastTint(loup({ leapUntil: 100, stalking: true }), false, false, 50)).toBe(BEAST_TINTS.menace)
  })

  it('…mais le SANG prime sur le bond : ce qu’on traque reste l’information la plus chère', () => {
    expect(beastTint(loup({ leapUntil: 100, bleedMortal: true }), false, false, 50)).toBe(BEAST_TINTS.bleeding)
  })
})
