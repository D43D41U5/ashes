/**
 * LE BATTANT QUI PIVOTE — les gardes du pilote d'animation (spec construction R26).
 *
 * Ce qu'on éprouve ici n'est pas « ça bouge » (la géométrie des frames est gardée dans
 * `bati-art.test`), c'est la MACHINE À ÉTATS : quand animer, quand sauter, et ce qui se passe
 * quand les deux sources de vérité se contredisent. C'est cette dernière qui casse en silence —
 * une porte qui rejoue son geste à chaque reconnexion, ou qui reste coincée à mi-course parce
 * que l'horloge a sauté, ne lève rien et ne se voit qu'en jouant.
 */
import { describe, expect, it } from 'vitest'
import { PORTE_ANIM_MS, PORTE_NB_FRAMES, creerPortesAnimees } from './porte-anim'

const OUVERTE = PORTE_NB_FRAMES - 1
const PORTE = 42

describe('le battant qui pivote', () => {
  it('AU REPOS, la frame se lit sur l’état — sans aucun geste en mémoire', () => {
    const a = creerPortesAnimees()
    expect(a.frame(PORTE, false, 1000), 'close').toBe(0)
    expect(a.frame(PORTE, true, 1000), 'ouverte').toBe(OUVERTE)
    expect(a.enCours(1000)).toBe(0)
  })

  it('POUSSÉE, elle traverse TOUTES les frames, dans l’ordre, et s’arrête au bout', () => {
    const a = creerPortesAnimees()
    a.pousse(PORTE, true, 0)
    const vues: number[] = []
    for (let t = 0; t <= PORTE_ANIM_MS; t += PORTE_ANIM_MS / (PORTE_NB_FRAMES - 1)) {
      vues.push(a.frame(PORTE, true, t))
    }
    expect(vues, 'les cinq positions, dans l’ordre').toEqual([0, 1, 2, 3, OUVERTE])
    // Et elle ne dépasse jamais : le temps qui continue ne fait pas sortir le battant de ses gonds.
    expect(a.frame(PORTE, true, PORTE_ANIM_MS * 10)).toBe(OUVERTE)
    expect(a.enCours(PORTE_ANIM_MS * 10)).toBe(0)
  })

  it('REFERMÉE, elle les traverse À L’ENVERS', () => {
    const a = creerPortesAnimees()
    a.pousse(PORTE, false, 0)
    const vues: number[] = []
    for (let t = 0; t <= PORTE_ANIM_MS; t += PORTE_ANIM_MS / (PORTE_NB_FRAMES - 1)) {
      vues.push(a.frame(PORTE, false, t))
    }
    expect(vues).toEqual([OUVERTE, 3, 2, 1, 0])
  })

  it('UNE HORLOGE QUI SAUTE ne perd que des frames, jamais l’état final', () => {
    // Le rendu headless avale des secondes entières (mesuré à plusieurs reprises sur ce dépôt).
    // Un pilote programmé sur un FRONT se ferait enjamber et resterait coincé à mi-course ; celui
    // -ci se DÉDUIT de l'horloge, donc un saut ne coûte que des images intermédiaires.
    const a = creerPortesAnimees()
    a.pousse(PORTE, true, 0)
    expect(a.frame(PORTE, true, 5_000)).toBe(OUVERTE)
  })

  it('DOUBLE APPUI : elle REVIENT SUR SES PAS, elle ne se téléporte pas', () => {
    const a = creerPortesAnimees()
    a.pousse(PORTE, true, 0)
    const mi = a.frame(PORTE, true, PORTE_ANIM_MS / 2)
    expect(mi, 'à mi-course').toBeGreaterThan(0)
    expect(mi).toBeLessThan(OUVERTE)
    // On referme depuis là : la frame suivante doit REPARTIR de `mi`, pas de l'extrémité.
    a.pousse(PORTE, false, PORTE_ANIM_MS / 2)
    expect(a.frame(PORTE, false, PORTE_ANIM_MS / 2), 'on repart d’où l’on en est').toBe(mi)
    expect(a.frame(PORTE, false, PORTE_ANIM_MS / 2 + PORTE_ANIM_MS)).toBe(0)
  })

  it('L’ÉTAT CONTREDIT LE GESTE : on saute, on ne rejoue pas', () => {
    // LE CAS QUI CASSE EN SILENCE. À la reconnexion, le snapshot arrive avec des portes déjà
    // ouvertes et aucun `door_toggled` ne les accompagne. Si le pilote animait la différence,
    // tout un village s'ouvrirait en fanfare devant un joueur qui vient seulement de charger.
    const a = creerPortesAnimees()
    a.pousse(PORTE, true, 0)
    // Le snapshot dit « close » alors qu'on jouait une ouverture : on abandonne et on se cale.
    expect(a.frame(PORTE, false, PORTE_ANIM_MS / 2)).toBe(0)
    expect(a.enCours(PORTE_ANIM_MS / 2), 'le geste est bien abandonné').toBe(0)
    // Et la fois d'après, on part de l'état, pas d'un reliquat.
    expect(a.frame(PORTE, false, PORTE_ANIM_MS)).toBe(0)
  })

  it('CHAQUE PORTE a son battant — deux voisines ne se marchent pas dessus', () => {
    const a = creerPortesAnimees()
    a.pousse(1, true, 0)
    a.pousse(2, false, 0)
    expect(a.frame(1, true, PORTE_ANIM_MS / 2)).toBeGreaterThan(0)
    expect(a.frame(2, false, PORTE_ANIM_MS / 2)).toBeLessThan(OUVERTE)
    expect(a.frame(1, true, PORTE_ANIM_MS)).toBe(OUVERTE)
    expect(a.frame(2, false, PORTE_ANIM_MS)).toBe(0)
  })

  it('NE FUIT PAS : un battant arrivé n’occupe plus de mémoire', () => {
    // Un village en tient des dizaines, ouvertes et fermées mille fois sur une saison.
    const a = creerPortesAnimees()
    for (let id = 0; id < 50; id++) a.pousse(id, true, 0)
    for (let id = 0; id < 50; id++) a.frame(id, true, PORTE_ANIM_MS)
    expect(a.enCours(PORTE_ANIM_MS)).toBe(0)
  })

  it('la durée est PARTAGÉE avec le son — une seule constante, pas deux jumelles', () => {
    // La garde est maigre exprès : ce qu'elle protège, c'est que la valeur soit IMPORTABLE et
    // qu'un seul endroit la décide. `sound.ts` la lit ; deux nombres se désaccorderaient à la
    // première retouche, et un grincement plus long que le geste s'entend tout de suite.
    expect(PORTE_ANIM_MS).toBeGreaterThan(0)
    expect(PORTE_ANIM_MS % (PORTE_NB_FRAMES - 1), 'un pas entier, sinon la dernière frame traîne').toBe(0)
  })
})
