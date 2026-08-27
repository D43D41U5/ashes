/**
 * ═══ LA GARDE DU CACHE DES CARTES — ce qui rend le raccourci honnête ═══════════════════════════
 *
 * 19 fichiers de test lisent désormais leur carte de production depuis `tools/carte-cache.ts`
 * plutôt que de la générer (59 générations pour 21 résultats distincts, mesuré : 37 % du coût de
 * la suite). Tout l'édifice repose sur UNE affirmation : **une carte relue est bit pour bit une
 * carte générée**. Si elle est fausse, les 19 fichiers deviennent verts contre un monde qui
 * n'existe pas — la panne la plus silencieuse qui soit.
 *
 * Ce fichier l'affirme, à chaque exécution de la suite, et il l'affirme au bon niveau :
 *
 *   • pas par `JSON.stringify` — c'est exactement le comparateur qui MENTAIT pendant la mise au
 *     point : il transforme un `Int32Array` en objet à N clés, donc il ne distingue pas un
 *     tableau typé d'un tableau ordinaire, ni un `Uint8Array` d'un `Float64Array` ;
 *   • champ par champ, en exigeant le MÊME CONSTRUCTEUR et la même valeur à chaque index.
 *
 * ⚠ Ce test appelle `generateZonedTerrain` EN DIRECT — c'est son étalon. Il ne doit jamais
 * passer par `carteDeTest`, sous peine de comparer le cache à lui-même.
 */
import { describe, expect, it } from 'vitest'
import { carteDeTest, encoderCarte, decoderCarte } from '../../../tools/carte-cache'
import { generateZonedTerrain } from './zonegen'

/** La carte du MONDE JOUÉ : la moins chère (0,24 Mtuiles), et celle qui porte tous les genres
 *  de tableaux — Uint8 pour le terrain, Int32 pour le coût de cendre, tableaux typés de
 *  premier niveau (`zone`, `rampe`). */
const ARGS = [2026, 8, 'racine'] as const

/** `String(-0)` rend « 0 » : le message d'écart doit dire ce que la comparaison a vu. */
function nommer(v: unknown): string {
  return Object.is(v, -0) ? '-0' : String(v)
}

/**
 * L'égalité STRUCTURELLE : même forme, mêmes clés DANS LE MÊME ORDRE, mêmes constructeurs,
 * mêmes valeurs. Rend le chemin du premier écart — un « ce n'est pas égal » sur 235 104 tuiles
 * n'apprend rien.
 */
function ecart(a: unknown, b: unknown, chemin = ''): string | null {
  // ⚠ `Object.is`, ET SURTOUT PAS `===` : c'est par là que cette garde a menti. Un `===` en tête
  //   rend `true` pour `-0 === 0` et court-circuite tout le reste — la sonde répondait « aucun
  //   écart » sur une carte dont un seuil avait perdu le signe de son zéro, pendant que `toEqual`
  //   de vitest, lui, le voyait. Une garde qui compare plus mollement que le test qu'elle
  //   protège ne protège rien.
  if (Object.is(a, b)) return null
  if (typeof a !== typeof b) return `${chemin} : types (${typeof a} vs ${typeof b})`
  if (a === null || b === null || typeof a !== 'object') {
    return `${chemin} : ${nommer(a)} ≠ ${nommer(b)}`
  }
  const ctorA = (a as object).constructor?.name
  const ctorB = (b as object).constructor?.name
  if (ctorA !== ctorB) return `${chemin} : constructeur ${ctorA} ≠ ${ctorB}`
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const ta = a as unknown as ArrayLike<number>
    const tb = b as unknown as ArrayLike<number>
    if (ta.length !== tb.length) return `${chemin} : longueur ${ta.length} ≠ ${tb.length}`
    for (let i = 0; i < ta.length; i++) {
      if (!Object.is(ta[i], tb[i])) return `${chemin}[${i}] : ${nommer(ta[i])} ≠ ${nommer(tb[i])}`
    }
    return null
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${chemin} : longueur ${a.length} ≠ ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const e = ecart(a[i], b[i], `${chemin}[${i}]`)
      if (e) return e
    }
    return null
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.join() !== kb.join()) return `${chemin} : clés « ${ka.join()} » ≠ « ${kb.join()} »`
  for (const k of ka) {
    const e = ecart((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${chemin}.${k}`)
    if (e) return e
  }
  return null
}

describe('le cache des cartes de test', () => {
  const fraiche = generateZonedTerrain(...ARGS)

  it('A1 — un aller-retour par le format binaire ne change RIEN', () => {
    const relue = decoderCarte(encoderCarte(fraiche))
    expect(ecart(relue, fraiche, 'carte')).toBeNull()
  })

  it('A2 — `carteDeTest` rend la carte de `generateZonedTerrain`, au bit près', () => {
    // DEUX APPELS, ET C'EST TOUT LE TEST. Sur un cache FROID, le premier appel génère et rend
    // l'objet frais sans jamais passer par le format binaire : le comparer à `fraiche` ne prouve
    // alors rien du tout (vérifié — la sonde restait verte avec un décodeur cassé). Le SECOND
    // appel, lui, ne peut venir que du disque : `carteDeTest` ne garde rien en mémoire.
    const premier = carteDeTest(...ARGS)
    const second = carteDeTest(...ARGS)
    expect(ecart(premier, fraiche, 'carte (1er appel)')).toBeNull()
    expect(ecart(second, fraiche, 'carte (relue du cache)')).toBeNull()
  })

  it('A3 — deux lectures du cache ne se partagent aucun tableau', () => {
    // Chaque appelant est propriétaire de sa carte : une carte partagée entre fichiers de test
    // serait mutée par le premier qui pose ses POIs, et les suivants liraient ses dégâts.
    const a = carteDeTest(...ARGS)
    const b = carteDeTest(...ARGS)
    expect(a.map.terrain).not.toBe(b.map.terrain)
    a.map.terrain[0] = 99
    expect(b.map.terrain[0]).not.toBe(99)
  })

  /**
   * A1bis — LE FORMAT, ÉPROUVÉ SUR CE QUE JSON ABÎME. Écrit APRÈS coup, et c'est son histoire :
   * A1 tournait sur la carte du monde joué, dont les `seuils` sont VIDES. Le zéro négatif qui a
   * fait rougir `A12` vit précisément là — dans les seuils de la vallée, que A1 ne visitait pas.
   * Une garde qui ne visite qu'une carte ne garde que cette carte.
   *
   * Celle-ci ne génère rien : elle éprouve le FORMAT sur un objet fabriqué qui porte, à la main,
   * chaque valeur dont on sait qu'un aller-retour peut la perdre. Coût : une milliseconde.
   */
  it('A1bis — `-0`, NaN, les infinis et tous les genres de tableaux traversent le format', () => {
    const n = 5000 // au-dessus du seuil binaire : ces tableaux-là partent en blob
    const cobaye = {
      // les nombres que JSON ne sait pas dire
      moinsZero: -0, zero: 0, nan: NaN, inf: Infinity, moinsInf: -Infinity,
      // … y compris enfouis dans un petit tableau, qui reste dans l'entête JSON
      petit: [-0, 0, NaN, Infinity, -Infinity, 1.5, -7],
      // … et dans un GRAND tableau, qui doit alors passer en Float64 malgré des entiers
      grandAvecMoinsZero: Array.from({ length: n }, (_, i) => (i === 42 ? -0 : i)),
      // chaque genre étroit, avec ses bornes exactes
      u8: Array.from({ length: n }, (_, i) => i % 256),
      i8: Array.from({ length: n }, (_, i) => (i % 256) - 128),
      u16: Array.from({ length: n }, (_, i) => i * 13 % 65536),
      i16: Array.from({ length: n }, (_, i) => (i * 13 % 65536) - 32768),
      i32: Array.from({ length: n }, (_, i) => i * 1_000_003 - 2_000_000_000),
      flottants: Array.from({ length: n }, (_, i) => i / 3),
      // les tableaux TYPÉS de premier niveau, dont le constructeur doit revenir intact
      ta8: new Uint8Array(n).fill(7),
      taI8: new Int8Array(n).fill(-7),
      ta16: new Uint16Array(n).fill(700),
      taI16: new Int16Array(n).fill(-700),
      ta32: new Int32Array(n).fill(-70_000),
      taF64: Float64Array.from({ length: n }, (_, i) => (i === 3 ? -0 : i / 7)),
      // la structure ordinaire autour
      texte: 'le Névé Blanc', vrai: true, rien: null,
      imbrique: { liste: [{ ax: -0, ay: -1 }, { ax: 1, ay: 0 }] },
      vide: [] as number[],
    }
    const relu = decoderCarte(encoderCarte(cobaye as never)) as unknown
    expect(ecart(relu, cobaye, 'cobaye')).toBeNull()
  })

  /**
   * A5 — UN CACHE ABÎMÉ SE PLAINT, IL NE MENT PAS. C'est la prémisse de tout le chemin de secours
   * de `carteDeTest` : il enveloppe la relecture d'un `try` et régénère si elle échoue. Ça ne vaut
   * que si un fichier tronqué (écriture interrompue, disque plein, fichier balayé entre le
   * `existsSync` et le `readFileSync`) LÈVE au lieu de rendre une carte plausible et fausse.
   */
  it('A5 — un cache tronqué lève, il ne rend jamais une carte à moitié', () => {
    const complet = encoderCarte(fraiche)
    for (const part of [0.999, 0.5, 0.01]) {
      // `new Uint8Array(...)` COPIE — et c'est le cœur du test : un `subarray` garderait le
      // buffer d'origine derrière lui, donc les octets manquants seraient toujours là, et le
      // décodeur les lirait sans rien remarquer. Un vrai fichier tronqué, lui, s'arrête pour de bon.
      const tronque = new Uint8Array(complet.subarray(0, Math.floor(complet.length * part)))
      expect(() => decoderCarte(tronque), `tronqué à ${part * 100} %`).toThrow()
    }
    expect(() => decoderCarte(new Uint8Array(64).fill(0xff)), 'octets au hasard').toThrow()
  })

  it('A4 — le format porte les genres étroits ET les tableaux typés', () => {
    // La garde de la garde : si `encoderCarte` retombait sur du JSON pour tout, A1 passerait
    // encore et le cache pèserait 171 Mo au lieu de 30. On vérifie qu'il a bien SÉPARÉ.
    const octets = encoderCarte(fraiche).length
    const tuiles = fraiche.map.width * fraiche.map.height
    // terrain (1 o) + profondeur (1) + distEau (1) + natureEau (1) + cendreCout (4) + zone (4)
    // + rampe (1) ≈ 13 o/tuile. Large, mais très loin des ~45 o/tuile d'un JSON de nombres.
    expect(octets / tuiles).toBeLessThan(20)
  })
})
