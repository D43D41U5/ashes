import { describe, expect, it } from 'vitest'
import { SUN_NORTH, SUN_Z } from '../scenes/world/dynamic-lighting'
import {
  cleDeSocle, EMERGENCE, estUnSocle, formeDeSocle, hauteurDeTexture, MATIERES_MINERALES,
  MARGE_HAUT, normalesDeSocle, SOCLE, SOCLE_KEYS, SOCLE_TYPES, SOCLE_W, tailleDeSocle,
} from './socle-mineral'

/**
 * LE SOCLE MINÉRAL, éprouvé en DONNÉES PURES (pas de scène Phaser, pas de canvas).
 *
 * Les deux erreurs que ce fichier existe pour attraper :
 *   ① une silhouette qui cesserait d'être pleine largeur — l'art recommencerait à MENTIR sur la
 *     collision, et c'est la raison d'être du chantier ;
 *   ② une INVERSION DE SIGNE sur la normale. C'est le piège du repère : `y` va vers le BAS, donc
 *     le ciel est en `ny` NÉGATIF, et `packNormals` applique encore `FLIP_G` par-dessus. Une
 *     inversion resterait plausible à l'œil (une face claire, une face sombre) tout en étant
 *     exactement à l'envers de ce qu'Alexis a validé. On l'affirme donc contre la VRAIE géométrie
 *     du soleil (`SUN_NORTH`, `SUN_Z`, importés — pas recopiés), et non contre un nombre écrit ici.
 */
describe('socle minéral', () => {
  it('LA RANGÉE DU SOL FAIT 16/16 TEXELS — la silhouette dit la hitbox (blockHalfSub 4)', () => {
    for (const taille of [0, 1, 2]) {
      const f = formeDeSocle(taille)
      let n = 0
      for (let x = 0; x < f.w; x++) if (f.alpha[(f.h - 1) * f.w + x]) n++
      expect(n, `taille ${taille}`).toBe(SOCLE_W)
      expect(f.h).toBe(hauteurDeTexture(taille))
      expect(f.h - f.y0).toBe(EMERGENCE[taille]) // l'émergence, au texel près
      // LA MARGE DU HAUT : la rangée 0 est vide, sinon le sprite se borde d'un liseré d'un pixel
      // à un zoom fractionnaire (NEAREST sans marge). Elle vaut MARGE_HAUT, pas « au moins 1 » :
      // une marge qui grandirait à l'insu de tous décalerait l'ancrage du sprite.
      expect(f.y0).toBe(MARGE_HAUT)
      for (let x = 0; x < f.w; x++) expect(f.alpha[x], `rangée 0, x=${x}`).toBe(0)
    }
  })

  it('le DESSUS regarde le ciel, le CORPS regarde la lampe — et c’est le soleil qui l’arbitre', () => {
    // La direction VERS le soleil, dans le repère de l'écran (x, y vers le BAS, z vers la caméra),
    // à midi : le soleil est au nord (`cy - SUN_NORTH`) et à `SUN_Z` de haut.
    const l = Math.sqrt(SUN_NORTH * SUN_NORTH + SUN_Z * SUN_Z)
    const soleil = [0, -SUN_NORTH / l, SUN_Z / l] as const
    const f = formeDeSocle(2)
    const n = normalesDeSocle(f)
    const dot = (i: number): number => n[i * 3]! * soleil[0] + n[i * 3 + 1]! * soleil[1] + n[i * 3 + 2]! * soleil[2]

    const dessus = f.y0 + 1, corps = f.h - 2, x = 8
    // Le dessus PREND le soleil, franchement — c'est lui la face éclairée.
    expect(dot(dessus * f.w + x)).toBeGreaterThan(0.7)
    expect(n[(dessus * f.w + x) * 3 + 1]!).toBeLessThan(0) // ny < 0 = vers le nord = vers le ciel
    // Le corps ne le voit PLUS JAMAIS : sa pente (30°) dépasse l'élévation du soleil (21,2°).
    expect(dot(corps * f.w + x)).toBeLessThanOrEqual(0)
    expect(n[(corps * f.w + x) * 3 + 1]!).toBeGreaterThan(0) // ny > 0 = vers le sud = vers la lampe
    // Et ce seuil n'est pas un réglage : il EST l'élévation du soleil.
    const elevation = (Math.atan2(SUN_Z, SUN_NORTH) * 180) / Math.PI
    expect(SOCLE.degCorps).toBeGreaterThan(elevation)
    expect(elevation).toBeCloseTo(21.2, 1)
  })

  it('LE DESSUS EST UN PLAN — sauf son texel de bord, qui porte l’azimut du soleil', () => {
    for (const taille of [0, 1, 2]) {
      const f = formeDeSocle(taille)
      const n = normalesDeSocle(f)
      const xmins = new Int32Array(f.h).fill(999), xmaxs = new Int32Array(f.h).fill(-1)
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.alpha[y * f.w + x]) {
        if (x < xmins[y]!) xmins[y] = x
        if (x > xmaxs[y]!) xmaxs[y] = x
      }
      const dessus: number[][] = []
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const i = y * f.w + x
          // Le texel de bord (`biseauDessus`) est EXCLU : c'est lui, et lui seul, qui roule.
          const bord = x < xmins[y]! + SOCLE.biseauDessus || x > xmaxs[y]! - SOCLE.biseauDessus
          if (f.alpha[i] && f.relief[i] === 1 && !bord) dessus.push([n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!])
        }
      }
      expect(dessus.length, `taille ${taille} : le dessus existe`).toBeGreaterThan(8)
      // Un PLAN : pas une valeur médiane, pas un écart « faible » — le MÊME vecteur partout.
      // Les coins et le bord nord compris : ce sont des arêtes de silhouette, rien à raccorder.
      for (const v of dessus) {
        expect(v[0]).toBeCloseTo(dessus[0]![0]!, 6)
        expect(v[1]).toBeCloseTo(dessus[0]![1]!, 6)
        expect(v[2]).toBeCloseTo(dessus[0]![2]!, 6)
      }
      // Et la face avant, elle, n'est PAS constante : le biseau latéral et le grain y travaillent.
      const bas = (f.h - 1) * f.w
      expect(n[(bas + 1) * 3]).not.toBeCloseTo(n[(bas + 8) * 3]!, 3)
      // LE BORD DU DESSUS PORTE L'AZIMUT : ses deux colonnes ont un `nx` NON NUL et OPPOSÉ —
      // sans quoi le balayage est→ouest du soleil n'aurait nulle part où s'inscrire (le centre
      // du plan a `nx` = 0 par construction). C'est la garde de la demande d'Alexis.
      const yTop = f.y0 + 1
      const nxG = n[(yTop * f.w + xmins[yTop]!) * 3]!
      const nxD = n[(yTop * f.w + xmaxs[yTop]!) * 3]!
      expect(Math.abs(nxG), 'le bord ouest du dessus regarde à l’ouest').toBeGreaterThan(0.4)
      expect(nxG * nxD, 'les deux bords regardent en sens OPPOSÉ').toBeLessThan(0)
      expect(dessus[0]![0], 'le centre du plan, lui, reste à nx = 0').toBeCloseTo(0, 6)
    }
  })

  it('LE LISERÉ DE BASE assombrit le pied SANS toucher la normale ni le dessus', () => {
    // Le liseré est de l'albédo pur : la normale du pied doit rester celle de la face avant,
    // sinon la lumière croirait à une facette tournée vers le bas. On l'affirme sur le champ de
    // normales, qui ne connaît pas le liseré, et sur les constantes qui le bornent.
    expect(SOCLE.lisereRangs).toBeGreaterThan(0)
    expect(SOCLE.lisereForce).toBeGreaterThan(0)
    expect(SOCLE.lisereForce).toBeLessThan(1)
    const f = formeDeSocle(2)
    const n = normalesDeSocle(f)
    // La rangée du PIED et une rangée du milieu de la face appartiennent au MÊME plan : leur
    // inclinaison moyenne doit coïncider. (Pixel à pixel, le grain les sépare — comparer deux
    // texels isolés mesurerait le bruit, pas la géométrie.)
    const pente = (y: number): number => {
      let s = 0, c = 0
      for (let x = SOCLE.biseau; x < f.w - SOCLE.biseau; x++) {
        const i = y * f.w + x
        if (!f.alpha[i]) continue
        s += n[i * 3 + 1]!; c++
      }
      return s / c
    }
    // Les deux rangées valent `sin(pente du corps)` : elles sont le MÊME plan, à la moucheture
    // du grain près. Le liseré, lui, n'a rien changé — il vit dans l'albédo.
    const attendu = Math.sin((SOCLE.degCorps * Math.PI) / 180)
    for (const [nom, v] of [['pied', pente(f.h - 1)], ['milieu', pente(f.h - 5)]] as const) {
      expect(v, `${nom} : regarde le sud`).toBeGreaterThan(0)
      expect(Math.abs(v - attendu), `${nom} : sur le plan du corps`).toBeLessThan(0.06)
    }
    // Et il s'éteint sur le dessus : le bloc BAS n'a qu'une rangée de corps, son plan doit vivre.
    const b = formeDeSocle(0)
    let plan = 0
    for (let i = 0; i < b.w * b.h; i++) if (b.alpha[i] && b.relief[i] === 1) plan++
    expect(plan, 'le bloc bas garde un dessus').toBeGreaterThan(8)
  })

  it('chaque matière est cuite aux trois hauteurs, et les six types sont couverts', () => {
    expect(SOCLE_TYPES.length).toBe(6)
    for (const type of SOCLE_TYPES) {
      expect(MATIERES_MINERALES[type]).toBeDefined()
      expect(estUnSocle(type)).toBe(true)
      for (const taille of [0, 1, 2]) {
        expect(SOCLE_KEYS.has(cleDeSocle(type, taille))).toBe(true)
        expect(SOCLE_KEYS.has(`${cleDeSocle(type, taille)}_lit`)).toBe(true)
      }
    }
    expect(estUnSocle('tree')).toBe(false)
    expect(estUnSocle('pierre_au_sol')).toBe(false) // le glanage ne bloque pas : il n'est pas un socle
  })

  it('la taille est une FONCTION PURE de la tuile, et les trois sont atteignables', () => {
    // Le bloc porte sa taille quand la butte la lui donne, la redérive sinon.
    expect(tailleDeSocle('bloc', 3, 7, 2)).toBe(2)
    const vues = new Set<number>()
    for (let tx = 0; tx < 40; tx++) {
      for (let ty = 0; ty < 40; ty++) {
        const t = tailleDeSocle('iron_vein', tx, ty)
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(2)
        expect(tailleDeSocle('iron_vein', tx, ty)).toBe(t) // pure : deux appels, un résultat
        vues.add(t)
      }
    }
    expect(vues.size, 'les trois hauteurs sortent vraiment du hash').toBe(3)
  })

  it('LE FILON SUIT LA TAILLE : ses taches restent DANS la silhouette, à toutes les hauteurs', () => {
    // Le bug d'origine : des taches à décalage fixe depuis le haut du bloc tombaient hors du bloc
    // BAS (huit rangées), qui montrait donc moins de minerai que le haut, sans que ce soit décidé.
    for (const type of ['iron_vein', 'coal_seam'] as const) {
      for (const taille of [0, 1, 2]) {
        const f = formeDeSocle(taille)
        const rects = MATIERES_MINERALES[type].filon!(f, taille)
        expect(rects.length, `${type}-${taille}`).toBeGreaterThanOrEqual(2)
        let peints = 0
        for (const [x, y, w, h] of rects) {
          expect(y, `${type}-${taille} : la tache commence dans le bloc`).toBeGreaterThanOrEqual(f.y0)
          expect(y + h, `${type}-${taille} : et elle s'y termine`).toBeLessThanOrEqual(f.h)
          for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
            if (f.alpha[(y + dy) * f.w + (x + dx)]) peints++
          }
        }
        // La DENSITÉ, pas le compte : chaque hauteur porte sa part de minerai visible.
        const surface = f.alpha.reduce<number>((a, v) => a + v, 0)
        expect(peints / surface, `${type}-${taille} : part de minerai`).toBeGreaterThan(0.05)
        expect(peints / surface, `${type}-${taille} : part de minerai`).toBeLessThan(0.35)
      }
    }
  })
})
