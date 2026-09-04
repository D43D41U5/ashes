/**
 * ═══ LES TERRASSES INTRAZONE — le sol lui-même a des paliers (spec `terrasses.md` §5) ═══
 *
 * Ce que ces gardes éprouvent, dans l'ordre de la spec : la donnée et son absence hors du
 * monde réduit (T-A1), **la connexité en étages, mesurée contre le monde à plat** (T-A2 — la
 * garde qui a fait réécrire la passe trois fois : 7 579 tuiles perdues à la première écriture),
 * la règle du ±1 et les nappes (T-A3), les assises plates (T-A4), les corps et les nœuds qui
 * savent où ils sont (T-A5), le mur qui retient et la rampe qui passe (T-A6), la carte générale
 * qui ignore tout (T-A7).
 *
 * ⚠ **CE QUI FERAIT ROUGIR T-A2, énoncé AVANT d'accepter son vert** : remplacer le corps de
 * `garantir()` par `return 0` dans `terrasses.ts` — la marche en (tuile, niveau) doit alors
 * laisser des tuiles de la composante principale hors d'atteinte (vérifié à la main le
 * 2026-09-03 : 3 562 composantes perdues sur la graine 2026 sans la garantie) ; ou débrancher la
 * descente creusée (§6b) — la banquette entre un lac et son plateau reste sans rampe et le point
 * fixe bat jusqu'à la borne (422 tuiles de terre perdues, graine 4242). Un point fixe qui ne
 * converge pas se voit ICI, pas ailleurs : ce qu'il laisse en battant est de la terre perdue.
 * Et ce qui ferait rougir T-A3 : mettre `TERRASSES.MARCHE` à 0 — les bords des cellules
 * d'`altLarge` sautent alors deux paliers d'un coup ; ou laisser `fondre` toucher l'eau d'une
 * nappe — le bord d'un lac monte d'un cran sur son milieu.
 *
 * Le déterminisme de la passe (T-A1, deux générations directes) vit avec celui des étages,
 * `etages.test.ts` E-A2 — la même paire de générations compare `palier`, on ne paie pas
 * vingt secondes de plus pour le redire ici.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, FAUNA, TERRAIN_GRASS, TICK_DT_S } from './balance'
import { carteDeTest } from '../../../tools/carte-cache'
import { moveAvatar, type MoveWorld } from './collision'
import {
  etageApresLePas, etagesDuPas, franchitUneJoue, marchableAEtage, niveauDeLaTuile, niveauDuCorps, palierDuSol, terrainAEtage,
} from './etages'
import { placeHuntingGrounds } from './faune'
import { MARCHABLE, createEmptyMap, isWater, type WorldMap } from './map'
import { computeFlowFieldMulti, findPath, lisserLeChemin } from './pathfinding'
import { buildPoiStructures } from './poi-batis'
import { nidsAMonstre, spawnPoiMonsters } from './poi'
import { createSim, spawnEntity, step, type SimState } from './sim'
import { TERRASSES } from './terrasses'
import { cycleOffsetForStartHour } from './time'
import { renderVignette } from './vignette'
import { CONTENU, emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { MONDE, MONDE_JOUE } from './zonegraph'

const SEED = 2026
/** Les graines du monde joué déjà en cache — chacune coûte une génération, une fois. */
const GRAINES = [SEED, 7, 4242, 909]

/* ═══════════════════════════ LES INSTRUMENTS ═══════════════════════════ */

/** La plus grande composante marchable AU SOL, paliers ignorés — le monde d'avant les terrasses. */
function composantePrincipale(map: WorldMap): Uint8Array {
  const { width, height, terrain } = map
  const N = width * height
  const comp = new Int32Array(N).fill(-1)
  const file: number[] = []
  let meilleur = -1
  let meilleurN = 0
  let n = 0
  for (let dep = 0; dep < N; dep++) {
    if (comp[dep]! >= 0 || MARCHABLE[terrain[dep]!] !== 1) continue
    file.length = 0
    file.push(dep)
    comp[dep] = n
    let taille = 0
    for (let h = 0; h < file.length; h++) {
      const i = file[h]!
      taille++
      const x = i % width
      const y = (i - x) / width
      for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
        const j = vy * width + vx
        if (comp[j]! >= 0 || MARCHABLE[terrain[j]!] !== 1) continue
        comp[j] = n
        file.push(j)
      }
    }
    if (taille > meilleurN) { meilleurN = taille; meilleur = n }
    n++
  }
  const dedans = new Uint8Array(N)
  for (let i = 0; i < N; i++) if (comp[i] === meilleur) dedans[i] = 1
  return dedans
}

/**
 * La marche en (tuile, niveau) — LA règle du jeu, mot pour mot : `etagesDuPas` dit où le pas
 * peut aller, `etageApresLePas` dit où l'on atterrit. Rend, par tuile, si UN niveau au moins
 * l'a atteinte. Départ : la première tuile de la composante principale, à son palier.
 */
function atteintEnEtages(map: WorldMap, depart: number): Uint8Array {
  const { width, height } = map
  const N = width * height
  const NIVEAUX = TERRASSES.PALIERS + 2 // −1 (les caves) … PALIERS (le chapeau du palier haut)
  const vu = new Uint8Array(N * NIVEAUX)
  const cle = (i: number, n: number): number => (n + 1) * N + i
  const atteint = new Uint8Array(N)
  const x0 = depart % width
  const n0 = palierDuSol(map, x0, (depart - x0) / width)
  const file: number[] = [depart, n0]
  vu[cle(depart, n0)] = 1
  for (let h = 0; h < file.length; h += 2) {
    const i = file[h]!
    const n = file[h + 1]!
    atteint[i] = 1
    const x = i % width
    const y = (i - x) / width
    const etages = etagesDuPas(map, n, x, y) ?? [n]
    for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
      if (!etages.some((e) => marchableAEtage(map, e, vx, vy))) continue
      const apres = etageApresLePas(map, etages, n, vx, vy)
      const j = vy * width + vx
      const k = cle(j, apres)
      if (vu[k] === 1) continue
      vu[k] = 1
      file.push(j, apres)
    }
  }
  return atteint
}

/** L'eau qui COULE — toute eau que `map.lacs` ne revendique pas : LA MÊME lecture que la passe
 *  (elle reçoit la même liste), qui ne devine plus rien à la tuile. */
function masqueRiviere(map: WorldMap): Uint8Array {
  const riviere = new Uint8Array(map.width * map.height)
  for (let i = 0; i < riviere.length; i++) if (isWater(map.terrain[i]!)) riviere[i] = 1
  for (const i of map.lacs ?? []) riviere[i] = 0
  return riviere
}

/* ─────────────────────────── T-A1 — LA DONNÉE ─────────────────────────── */

describe('T-A1 — le monde réduit porte ses paliers, le monde complet n’en sait rien', () => {
  it('la vallée (chemin `vallee`) rend un `palier` ABSENT : une carte d’avant, sans un bit de plus', () => {
    const map = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, 'vallee').map
    expect(map.palier).toBeUndefined()
    expect(palierDuSol(map, 100, 100)).toBe(0)
  })

  for (const graine of GRAINES) {
    // 60 s : le premier test d'une graine paie sa génération quand le cache des cartes est froid.
    it(`graine ${graine} : un palier par tuile, dans 0..${TERRASSES.PALIERS - 1}, et les trois sont peuplés`, { timeout: 60_000 }, () => {
      const map = carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      expect(map.palier).toBeDefined()
      expect(map.palier).toHaveLength(map.width * map.height)
      const compte = new Array<number>(TERRASSES.PALIERS).fill(0)
      let marchable = 0
      for (let i = 0; i < map.palier!.length; i++) {
        const p = map.palier![i]!
        expect(p >= 0 && p < TERRASSES.PALIERS, `palier ${p} en ${i}`).toBe(true)
        if (MARCHABLE[map.terrain[i]!] === 1) { marchable++; compte[p]!++ }
      }
      // Trois terciles d'`altLarge` : aucun palier n'est une miette du pays, aucun ne l'avale.
      for (let p = 0; p < TERRASSES.PALIERS; p++) {
        expect(compte[p]! / marchable, `part du palier ${p}`).toBeGreaterThan(0.1)
        expect(compte[p]! / marchable, `part du palier ${p}`).toBeLessThan(0.7)
      }
      // Et la donnée est FAITE DE NOMBRES PLATS — snapshot, Worker et persistance en dépendent.
      expect(Array.isArray(map.palier)).toBe(true)
      expect(JSON.parse(JSON.stringify(map.palier))).toEqual(map.palier)
    })
  }
})

/* ─────────────── T-A2 — LA CONNEXITÉ EN ÉTAGES, CONTRE LE MONDE À PLAT ─────────────── */

describe('T-A2 — rien de ce qui se marchait ne se perd : la marche en étages couvre le monde à plat', () => {
  // LA TERRE ET L'EAU SE COMPTENT À PART, ET L'EAU EN DEUX. L'eau d'un lac ne bouge jamais (§2 :
  // une nappe tient sur un palier, c'est la surface du lac) ; sa ceinture de haut-fonds, sous une
  // rive haute au sud, à l'est ou à l'ouest, n'a donc pas de rampe possible (une rampe descend
  // vers le SUD, §5) et reste hors d'atteinte : c'est de l'eau à un cran sous la berge, on la
  // voit, on ne s'y baigne pas. Mesuré le 2026-09-03 : 3 087 / 3 483 / 2 901 / 2 190 tuiles de
  // haut-fond de lac sur les graines 2026 / 7 / 4242 / 909, soit 5 à 9 % des haut-fonds de lac —
  // la borne est à 10 %. LA RIVIÈRE suit ses berges par côtes (§2b) : un haut-fond sous une
  // berge haute, sans rampe qui y descende, se perd de même — 520 / 1 013 / 1 080 / 437 tuiles,
  // 2 à 4 % des haut-fonds de rivière, même borne.
  // LA TERRE, elle, ne se perd pas — à un ÎLOT près : la graine 909 en a un de 14 tuiles au
  // milieu d'un lac, dont la seule ceinture donne sur une rive au sud ; rien ne peut le rejoindre
  // (un lac ne se soulève pas, une rampe ne descend pas vers le nord) ; la 2026 de même (14 + 1).
  // La borne de terre est une poignée de tuiles, pas un pourcentage : une région entière qui se
  // perd (la garantie débranchée : 3 562 composantes sur la graine 2026 ; la descente creusée §6b
  // absente : 422 tuiles et un point fixe qui bat sur la graine 4242 ; la fermeture de `monter`
  // absente : une presqu'île de 988 tuiles et une île de 2 863 sur la graine 2026) passe la
  // borne d'un ordre de grandeur.
  const TERRE_PERDUE_MAX = 20
  const PART_EAU_PERDUE_MAX = 0.1
  for (const graine of GRAINES) {
    it(`graine ${graine} : perte de terre marchable ≤ ${TERRE_PERDUE_MAX} tuiles (un îlot), perte de haut-fonds de lac et de rivière < 10 % chacune`, () => {
      const map = carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      const principale = composantePrincipale(map)
      let depart = -1
      for (let i = 0; i < principale.length; i++) if (principale[i] === 1) { depart = i; break }
      expect(depart).toBeGreaterThanOrEqual(0)
      const atteint = atteintEnEtages(map, depart)
      const lac = new Uint8Array(principale.length)
      for (const i of map.lacs ?? []) lac[i] = 1
      const perduesTerre: number[] = []
      let perduesLac = 0
      let perduesRiviere = 0
      let hautsFondsDeLac = 0
      let hautsFondsDeRiviere = 0
      let total = 0
      for (let i = 0; i < principale.length; i++) {
        if (principale[i] !== 1) continue
        total++
        const eau = isWater(map.terrain[i]!)
        if (eau) { if (lac[i] === 1) hautsFondsDeLac++; else hautsFondsDeRiviere++ }
        if (atteint[i] === 1) continue
        if (!eau) perduesTerre.push(i)
        else if (lac[i] === 1) perduesLac++
        else perduesRiviere++
      }
      expect(total).toBeGreaterThan(100_000) // la garde ne peut pas passer à vide
      expect(hautsFondsDeLac).toBeGreaterThan(10_000)
      expect(hautsFondsDeRiviere).toBeGreaterThan(10_000)
      const w = map.width
      expect(
        perduesTerre.length,
        `${perduesTerre.length} tuiles de terre perdues, p.ex. ${perduesTerre.slice(0, 5).map((i) => `(${i % w},${(i - (i % w)) / w}) p${map.palier![i]}`).join(' ')}`,
      ).toBeLessThanOrEqual(TERRE_PERDUE_MAX)
      expect(perduesLac, `${perduesLac} haut-fonds de lac perdus sur ${hautsFondsDeLac}`).toBeLessThan(hautsFondsDeLac * PART_EAU_PERDUE_MAX)
      expect(perduesRiviere, `${perduesRiviere} haut-fonds de rivière perdus sur ${hautsFondsDeRiviere}`).toBeLessThan(hautsFondsDeRiviere * PART_EAU_PERDUE_MAX)
    }, 30_000)
  }

  // LE GUÉ (§5) : une rampe peut poser son pied dans les haut-fonds — c'est ainsi qu'on descend
  // dans un lac ou qu'on en sort ; sa tête, jamais (on ne monte pas sur l'eau).
  it('graine 2026 : des rampes ont le pied dans l’eau (le gué), aucune n’a la tête dans l’eau', () => {
    const map = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
    const rampes = (map.connecteurs ?? []).filter((c) => c.type === 'rampe' && palierDuSol(map, c.x, c.y - 1) === c.vers)
    const pieds = rampes.filter((c) => isWater(map.terrain[c.y * map.width + c.x]!))
    expect(pieds.length, 'des gués').toBeGreaterThan(0)
    for (const c of rampes) {
      expect(isWater(map.terrain[(c.y - 1) * map.width + c.x]!), `(${c.x},${c.y - 1}) : tête de rampe sur l’eau`).toBe(false)
    }
  })

  it('graine 2026 : les rampes de terrasse existent, chacune sur une tuile marchable au sol ET en haut', () => {
    const map = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
    // ⚠ TOUS LES CONNECTEURS D'ABORD, sans trier : une porte est marchable des deux côtés, ou ce
    // n'est pas une porte. La première écriture ne retenait que les rampes dont le sol était déjà
    // à `de` — et c'est exactement le vivier qui cachait le défaut (23 flancs de rampe qui se
    // disaient `de: 1` sur une tuile de palier 0, graine 2026 : trois colonnes jugées chacune sur
    // son propre bas).
    for (const c of map.connecteurs ?? []) {
      expect(marchableAEtage(map, c.de, c.x, c.y), `(${c.x},${c.y}) marchable en ${c.de}`).toBe(true)
      expect(marchableAEtage(map, c.vers, c.x, c.y), `(${c.x},${c.y}) marchable en ${c.vers}`).toBe(true)
    }
    // Une rampe de TERRASSE : on débouche au nord sur le SOL du palier `vers` (le chapeau d'une
    // mesa, lui, vit au-dessus du palier de son assise et n'est le sol de personne).
    const rampes = (map.connecteurs ?? []).filter((c) => c.type === 'rampe' && palierDuSol(map, c.x, c.y - 1) === c.vers)
    expect(rampes.length, 'des rampes de terrasse').toBeGreaterThan(50)
    for (const r of rampes) {
      expect(r.vers, `(${r.x},${r.y}) monte d’un cran`).toBe(r.de + 1)
      expect(palierDuSol(map, r.x, r.y), `(${r.x},${r.y}) se tient sur le sol de son \`de\``).toBe(r.de)
      expect(marchableAEtage(map, r.vers, r.x, r.y - 1), `(${r.x},${r.y - 1}) : la tuile où l’on débouche`).toBe(true)
      // Le terrain de la rampe est CELUI DU SOL — on n'a pas repeint la tuile, on l'a partagée.
      expect(terrainAEtage(map, r.vers, r.x, r.y)).toBe(terrainAEtage(map, r.de, r.x, r.y))
    }
  })
})

/* ─────────────────────────── T-A3 — ±1 ET LES NAPPES ─────────────────────────── */

describe('T-A3 — deux voisines marchables diffèrent d’un palier au plus, et une nappe n’en a qu’un', () => {
  for (const graine of GRAINES) {
    it(`graine ${graine} : aucune paire orthogonale de marchables à |Δ| > 1`, () => {
      const map = carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      const { width, height, terrain } = map
      const p = map.palier!
      const fautes: string[] = []
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (MARCHABLE[terrain[i]!] !== 1) continue
          if (x + 1 < width && MARCHABLE[terrain[i + 1]!] === 1 && Math.abs(p[i]! - p[i + 1]!) > 1) fautes.push(`(${x},${y})→E`)
          if (y + 1 < height && MARCHABLE[terrain[i + width]!] === 1 && Math.abs(p[i]! - p[i + width]!) > 1) fautes.push(`(${x},${y})→S`)
        }
      }
      expect(fautes, fautes.slice(0, 8).join(' ')).toHaveLength(0)
    })

    // UNE NAPPE EST À UN SEUL PALIER, EXACTEMENT — le profond ET les haut-fonds : c'est la surface
    // du lac, elle est plate, et rien ne déplace l'eau d'un lac (§2 : ni une miette, ni la garantie
    // — l'eau est un BLOC que seuls `niveler` et le ±1 en bloc touchent). Une première écriture
    // laissait la garantie déplacer un haut-fond « que rien ne rejoint » : 10 tuiles versantes sur
    // la graine 909, un bord de lac un cran au-dessus de son milieu. Mesuré 2026-09-03 : 0 sur
    // les quatre graines.
    it(`graine ${graine} : toute nappe hors rivière tient sur UN palier — le profond et les haut-fonds, exactement`, () => {
      const map = carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      const { width, height, terrain } = map
      const p = map.palier!
      const riviere = masqueRiviere(map)
      const vu = new Uint8Array(width * height)
      const file: number[] = []
      let nappes = 0
      let hautsFonds = 0
      let versants = 0
      const fautes: string[] = []
      for (let dep = 0; dep < vu.length; dep++) {
        if (vu[dep] === 1 || !isWater(terrain[dep]!) || riviere[dep] === 1) continue
        nappes++
        file.length = 0
        file.push(dep)
        vu[dep] = 1
        for (let h = 0; h < file.length; h++) {
          const i = file[h]!
          const x = i % width
          const y = (i - x) / width
          for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
            if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
            const j = vy * width + vx
            if (vu[j] === 1 || !isWater(terrain[j]!) || riviere[j] === 1) continue
            vu[j] = 1
            file.push(j)
          }
        }
        // Le palier de la nappe : celui de son profond (sinon, sans profond, le plus bas).
        let palier = -1
        for (const i of file) if (MARCHABLE[terrain[i]!] !== 1) { palier = p[i]!; break }
        if (palier < 0) for (const i of file) palier = palier < 0 ? p[i]! : Math.min(palier, p[i]!)
        for (const i of file) {
          if (MARCHABLE[terrain[i]!] !== 1) {
            if (p[i] !== palier) fautes.push(`profond (${i % width},${(i - (i % width)) / width}) : ${p[i]} dans une nappe à ${palier}`)
            continue
          }
          hautsFonds++
          if (p[i] === palier) continue
          if (Math.abs(p[i]! - palier) > 1) fautes.push(`haut-fond (${i % width},${(i - (i % width)) / width}) : ${p[i]} sur une nappe à ${palier}`)
          else versants++
        }
      }
      expect(nappes).toBeGreaterThan(5)
      expect(fautes, fautes.slice(0, 8).join(' | ')).toHaveLength(0)
      expect(hautsFonds).toBeGreaterThan(1000)
      expect(versants, `${versants} haut-fonds versants sur ${hautsFonds}`).toBe(0)
    })
  }
})

describe('T-A3bis — pas de digue en pleine eau : une cascade est courte', () => {
  // Indépendant de `lacs` et du masque de la rivière, exprès. L'ancien masque découpait dans le
  // grand lac un ruban « rivière » au palier de son sol (graine 2026 : un coin de 13 × 12 tuiles
  // d'eau profonde à 2 dans un lac à 1, une digue en pleine eau) ; et « chaque composante d'eau
  // libre sur UN palier » était FAUX comme garde : une rivière large de douze tuiles est de l'eau
  // libre, et elle suit ses berges par côtes (§2b), donc elle cascade — courte, la largeur du lit.
  // Ce qu'on garde : LA LONGUEUR DE LA MARCHE. Une tuile profonde qui a une profonde plus basse à
  // côté est une marche ; les marches se lient en lignes (8-connexes). Une cascade fait la largeur
  // d'un lit ; une digue court en long sur des dizaines de tuiles. Mesuré le 2026-09-03, la plus
  // longue ligne sur les quatre graines : 19 tuiles (graine 7, une rivière qui longe une rive de
  // lac à un cran au-dessus) — la borne est à 24 ; le coin de 13 × 12 en faisait 25.
  const MARCHE_MAX = 24
  for (const graine of GRAINES) {
    it(`graine ${graine} : aucune ligne de marche en eau profonde de plus de ${MARCHE_MAX} tuiles`, () => {
      const map = carteDeTest(graine, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
      const { width, height, terrain } = map
      const p = map.palier!
      const N = width * height
      const profonde = (i: number): boolean => isWater(terrain[i]!) && MARCHABLE[terrain[i]!] !== 1
      const marche = new Uint8Array(N)
      let marches = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (!profonde(i)) continue
          for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
            if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
            const j = vy * width + vx
            if (profonde(j) && p[j]! < p[i]!) { marche[i] = 1; marches++; break }
          }
        }
      }
      const vu = new Uint8Array(N)
      const file: number[] = []
      const longues: string[] = []
      let lignes = 0
      for (let dep = 0; dep < N; dep++) {
        if (marche[dep] !== 1 || vu[dep] === 1) continue
        lignes++
        file.length = 0
        file.push(dep)
        vu[dep] = 1
        for (let h = 0; h < file.length; h++) {
          const i = file[h]!
          const x = i % width
          const y = (i - x) / width
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const vx = x + dx
              const vy = y + dy
              if (vx < 0 || vy < 0 || vx >= width || vy >= height) continue
              const j = vy * width + vx
              if (marche[j] !== 1 || vu[j] === 1) continue
              vu[j] = 1
              file.push(j)
            }
          }
        }
        if (file.length > MARCHE_MAX) longues.push(`${file.length} tuiles depuis (${dep % width},${(dep - (dep % width)) / width})`)
      }
      // La garde ne peut pas passer à vide : les rivières cascadent bien (§2b), en lignes courtes.
      expect(marches).toBeGreaterThan(20)
      expect(lignes).toBeGreaterThan(10)
      expect(longues, longues.join(' | ')).toHaveLength(0)
    })
  }
})

/* ─────────────────────────── T-A4 — LES ASSISES SONT PLATES ─────────────────────────── */

describe('T-A4 — un lieu ne se coupe pas d’une falaise : chaque assise tient sur un palier', () => {
  const carte = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const map = carte.map

  it('chaque lieu (zone à `kind`) tient sur un seul palier, sur tout son marchable', () => {
    const lieux = map.zones.filter((z) => z.kind !== undefined)
    expect(lieux.length).toBeGreaterThan(5)
    for (const z of lieux) {
      const paliers = new Set<number>()
      for (let y = z.y; y < z.y + z.h; y++) {
        for (let x = z.x; x < z.x + z.w; x++) {
          if (MARCHABLE[map.terrain[y * map.width + x]!] === 1) paliers.add(palierDuSol(map, x, y))
        }
      }
      expect(paliers.size, `${z.name} (${z.kind}) @${z.x},${z.y} : paliers ${[...paliers].join(',')}`).toBeLessThanOrEqual(1)
    }
  })

  it('chaque mesa se tient sur une assise plate : sa jupe est au palier de son chapeau − 1 (T-R4)', () => {
    const portes = new Set((map.connecteurs ?? []).map((c) => c.y * map.width + c.x))
    let jupes = 0
    for (const e of map.etages ?? []) {
      if (e.niveau <= 0) continue
      const dedans = new Set(e.idx)
      for (const i of e.idx) {
        if (portes.has(i)) continue
        const x = i % map.width
        const y = (i - x) / map.width
        // Un CHAPEAU se tient AU-DESSUS du sol de sa tuile ; au niveau du sol, c'est le sol de ce
        // palier ; en dessous, une cave (niveau base − 1) — ni l'un ni l'autre n'a de jupe.
        if (palierDuSol(map, x, y) >= e.niveau) continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * map.width + x + dx
            if (dedans.has(j) || MARCHABLE[map.terrain[j]!] !== 1) continue
            jupes++
            expect(palierDuSol(map, x + dx, y + dy), `jupe (${x + dx},${y + dy}) du chapeau ${e.niveau}`).toBe(e.niveau - 1)
          }
        }
      }
    }
    expect(jupes).toBeGreaterThan(500)
  })

  it('le point de naissance est dégagé sur un seul palier, dans la composante principale', () => {
    const nodes = placeZoneNodes(carte)
    const grounds = placeHuntingGrounds(map, SEED)
    const emplacements = emplacementsDeVillage(carte, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(map) })
    const spawns = pointsDeSpawn(carte, emplacements, 3, SEED)
    expect(spawns.length).toBeGreaterThan(0)
    const principale = composantePrincipale(map)
    for (const s of spawns) {
      const palier = palierDuSol(map, s.tx, s.ty)
      for (let y = s.ty - CONTENU.DEGAGEMENT; y <= s.ty + CONTENU.DEGAGEMENT; y++) {
        for (let x = s.tx - CONTENU.DEGAGEMENT; x <= s.tx + CONTENU.DEGAGEMENT; x++) {
          expect(palierDuSol(map, x, y), `spawn (${s.tx},${s.ty}), tuile (${x},${y})`).toBe(palier)
        }
      }
      expect(principale[s.ty * map.width + s.tx]).toBe(1)
    }
  })
})

/* ─────────────── T-A5 — LES CORPS ET LES NŒUDS SAVENT OÙ ILS SONT ─────────────── */

describe('T-A5 — à l’amorce et après un banc, chaque chose se tient sur une tuile qui existe à son niveau', () => {
  const carte = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const map = carte.map

  it('tout nœud semé se tient sur une tuile qui existe à son niveau — et un nœud du sol n’écrit rien', () => {
    const nodes = placeZoneNodes(carte)
    expect(nodes.length).toBeGreaterThan(1000)
    let surLeSol = 0
    for (const n of nodes) {
      const niveau = niveauDeLaTuile(map, n)
      expect(terrainAEtage(map, niveau, n.tx, n.ty), `nœud ${n.type} (${n.tx},${n.ty}) niveau ${niveau}`).not.toBe(0)
      // T-R3 : « au sol, là où il est » ne s'écrit pas — le champ n'existe que hors du sol.
      if (n.etage === undefined) { surLeSol++; continue }
      expect(n.etage, `nœud ${n.type} (${n.tx},${n.ty}) marqué ${n.etage} sur un sol de palier ${palierDuSol(map, n.tx, n.ty)}`)
        .not.toBe(palierDuSol(map, n.tx, n.ty))
    }
    expect(surLeSol).toBeGreaterThan(nodes.length / 2)
  })

  it('le monde assemblé comme la Veillée, joué 600 ticks : aucun corps n’est à un niveau où sa tuile ne porte pas', () => {
    const nodes = placeZoneNodes(carte)
    const grounds = placeHuntingGrounds(map, SEED)
    const emplacements = emplacementsDeVillage(carte, nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(map) })
    const spawn = pointsDeSpawn(carte, emplacements, 1, SEED)[0] ?? emplacements[0]!
    const sim: SimState = createSim(SEED, {
      map,
      nodes,
      grounds,
      faunaCap: FAUNA.CAP,
      home: { x: spawn.tx + 0.5, y: spawn.ty + 0.5 },
      jourDeDepart: BALANCE.JOUR_DE_DEPART,
      cycleOffset: cycleOffsetForStartHour(9, BALANCE.JOUR_DE_DEPART),
    })
    spawnPoiMonsters(sim, SEED)
    buildPoiStructures(sim, SEED)
    const id = spawnEntity(sim, spawn.tx + 0.5, spawn.ty + 0.5)
    expect(sim.entities.length).toBeGreaterThan(10)

    const verifier = (quand: string): void => {
      for (const e of sim.entities) {
        const tx = Math.floor(e.x)
        const ty = Math.floor(e.y)
        const niveau = niveauDuCorps(map, e)
        expect(marchableAEtage(map, niveau, tx, ty), `${quand} : entité #${e.id} en (${tx},${ty}) au niveau ${niveau}`).toBe(true)
      }
    }
    verifier('à l’amorce')
    // L'avatar marche — vers le nord, là où les rampes montent — le reste du monde vit.
    for (let t = 0; t < 600; t++) step(sim, [{ entityId: id, dx: t % 40 < 20 ? 0 : 1, dy: -1 }])
    verifier('après 600 ticks')
  }, 60_000)
})

/* ─────────────── T-A6 — LE MUR RETIENT, LA RAMPE PASSE ─────────────── */

/**
 * LA TERRASSE DE LABORATOIRE — le modèle T-R1/T-R2 en petit : un pré de 24×24, le nord au palier 1,
 * le sud au palier 0, et UNE rampe de terrasse en (12,10) : une tuile du palier 0 partagée avec
 * l'étage 1, un connecteur `{de:0, vers:1}` — exactement ce que `zonegen` pose.
 */
const BORD = 10
const RAMPE = { x: 12, y: BORD }

function terrasseDeLabo(): WorldMap {
  const map = createEmptyMap(24, 24, TERRAIN_GRASS)
  map.palier = Array.from({ length: map.width * map.height }, (_, i) => ((i - (i % map.width)) / map.width < BORD ? 1 : 0))
  const i = RAMPE.y * map.width + RAMPE.x
  map.etages = [{ niveau: 1, idx: [i], terrain: [TERRAIN_GRASS], x0: RAMPE.x, y0: RAMPE.y, x1: RAMPE.x + 1, y1: RAMPE.y + 1 }]
  map.connecteurs = [{ x: RAMPE.x, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' }]
  return map
}

describe('T-A6 — un marcheur du palier 0 face au palier 1 est retenu ; par la rampe, il monte', () => {
  function marche(sim: SimState, id: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1, ticks: number): void {
    for (let t = 0; t < ticks; t++) step(sim, [{ entityId: id, dx, dy }])
  }

  it('la terrasse de laboratoire lit comme le modèle : le sol est l’étage de son palier, et de lui seul', () => {
    const map = terrasseDeLabo()
    expect(marchableAEtage(map, 0, 5, 15)).toBe(true)
    expect(marchableAEtage(map, 1, 5, 15)).toBe(false)
    expect(marchableAEtage(map, 1, 5, 5)).toBe(true)
    expect(marchableAEtage(map, 0, 5, 5)).toBe(false)
    expect(marchableAEtage(map, 0, RAMPE.x, RAMPE.y)).toBe(true)
    expect(marchableAEtage(map, 1, RAMPE.x, RAMPE.y)).toBe(true)
  })

  it('contre le mur : il pousse vers le nord trois secondes et reste au sud du bord, au palier 0', () => {
    const sim = createSim(SEED, { map: terrasseDeLabo() })
    const id = spawnEntity(sim, 5.5, 14.5)
    marche(sim, id, 0, -1, 3 * BALANCE.TICK_RATE_HZ)
    const e = sim.entities[0]!
    expect(Math.floor(e.y)).toBeGreaterThanOrEqual(BORD)
    expect(niveauDuCorps(sim.map, e)).toBe(0)
    expect(e.etage).toBeUndefined()
  })

  it('du haut : il pousse vers le sud et reste au nord du bord — une terrasse ne se saute pas', () => {
    const sim = createSim(SEED, { map: terrasseDeLabo() })
    const id = spawnEntity(sim, 5.5, 5.5)
    marche(sim, id, 0, 1, 3 * BALANCE.TICK_RATE_HZ)
    const e = sim.entities[0]!
    expect(Math.floor(e.y)).toBeLessThan(BORD)
    expect(niveauDuCorps(sim.map, e)).toBe(1)
  })

  it('par la rampe : le même pas vers le nord monte, et le corps est « au sol, là où il est » en haut', () => {
    const sim = createSim(SEED, { map: terrasseDeLabo() })
    const id = spawnEntity(sim, RAMPE.x + 0.5, 14.5)
    marche(sim, id, 0, -1, 3 * BALANCE.TICK_RATE_HZ)
    const e = sim.entities[0]!
    expect(Math.floor(e.y)).toBeLessThan(BORD)
    expect(niveauDuCorps(sim.map, e)).toBe(1)
    // T-R3 : le sol de sa tuile EST le palier 1 — rien à écrire.
    expect(e.etage).toBeUndefined()
    // Et il redescend par le même chemin.
    marche(sim, id, 0, 1, 6 * BALANCE.TICK_RATE_HZ)
    expect(Math.floor(e.y)).toBeGreaterThan(BORD)
    expect(niveauDuCorps(sim.map, e)).toBe(0)
  })
})

/* ─────────────── T-A7 — LA CARTE GÉNÉRALE IGNORE LES PALIERS ─────────────── */

describe('T-A7 — la vignette ne sait rien des paliers', () => {
  it('même vignette, pixel pour pixel, avec et sans `palier`', () => {
    const map = carteDeTest(SEED, MONDE.JOUEURS_CIBLE, MONDE_JOUE).map
    const avec = renderVignette(map)
    const { palier: _palier, ...sans } = map
    expect(_palier).toBeDefined()
    expect(renderVignette(sans as WorldMap)).toEqual(avec)
  })
})

/* ─────────────── T-A6bis — LA JOUE : LE CHEMIN N'ABORDE PAS UNE RAMPE PAR LE FLANC ─────────────── */

/**
 * Le défaut MESURÉ (banc A8, graine 2026, jour 2) : deux PNJ du Clan du Levant morts de faim à
 * x = 35,375 et x = 34,625 — collés au bord EST de la rampe (32-34, 200), chemin en poche, depuis
 * 800 ticks. La collision ferme les joues d'une rampe (`brideDeLaJoue`) ; l'A*, le gradient de
 * horde et le lissage ne le savaient pas, et promettaient le pas que le corps ne peut pas faire.
 *
 * La terrasse de laboratoire, avec une rampe LARGE (11-13, BORD) comme celles de `zonegen`.
 */
function terrasseALargeRampe(): WorldMap {
  const map = createEmptyMap(24, 24, TERRAIN_GRASS)
  map.palier = Array.from({ length: map.width * map.height }, (_, i) => ((i - (i % map.width)) / map.width < BORD ? 1 : 0))
  const xs = [RAMPE.x - 1, RAMPE.x, RAMPE.x + 1]
  map.etages = [{ niveau: 1, idx: xs.map((x) => RAMPE.y * map.width + x), terrain: [TERRAIN_GRASS, TERRAIN_GRASS, TERRAIN_GRASS], x0: RAMPE.x - 1, y0: RAMPE.y, x1: RAMPE.x + 2, y1: RAMPE.y + 1 }]
  map.connecteurs = xs.map((x) => ({ x, y: RAMPE.y, de: 0, vers: 1, type: 'rampe' as const }))
  return map
}

/** Un pas de côté entre deux jalons consécutifs franchit-il une joue ? — la lettre de la règle. */
function franchitUneJoueLeChemin(map: WorldMap, depart: { tx: number; ty: number }, chemin: readonly { tx: number; ty: number }[]): boolean {
  let prev = depart
  for (const w of chemin) {
    if (w.ty === prev.ty && w.tx !== prev.tx && franchitUneJoue(map, prev.tx, prev.ty, Math.sign(w.tx - prev.tx))) return true
    prev = w
  }
  return false
}

describe('T-A6bis — la joue : l’A*, le gradient et le lissage abordent une rampe par le sud ou le nord, jamais par le flanc', () => {
  const monde = (map: WorldMap): MoveWorld => ({ map, structures: [], nodes: [], moverVillageId: null })

  it('la prémisse : la collision refuse le pas de côté vers la rampe (le corps se colle à la joue)', () => {
    const map = terrasseALargeRampe()
    // Un corps à l'est de la rampe, sur sa rangée, qui pousse vers l'ouest : il s'arrête au bord.
    let x = RAMPE.x + 3.5
    for (let t = 0; t < 40; t++) x = moveAvatar(monde(map), x, RAMPE.y + 0.5, -1, 0, TICK_DT_S).x
    expect(x).toBeGreaterThanOrEqual(RAMPE.x + 2) // jamais dedans (la joue est en x = RAMPE.x + 2)
    expect(x).toBeLessThan(RAMPE.x + 2.5) // et il y est bien venu se coller
  })

  it('l’A* : de l’est de la rampe (palier 0) au nord (palier 1), le chemin entre par le SUD de la rampe', () => {
    const map = terrasseALargeRampe()
    const depart = { tx: RAMPE.x + 3, ty: RAMPE.y }
    const chemin = findPath(monde(map), depart, { tx: RAMPE.x, ty: RAMPE.y - 2 })!
    expect(chemin).not.toBeNull()
    expect(franchitUneJoueLeChemin(map, depart, chemin)).toBe(false)
    // Il est passé par la rangée du sud pour entrer : une tuile de rampe est précédée d'une tuile
    // de la rangée d'en dessous (ou d'une autre tuile de rampe), jamais d'une tuile de côté.
    const idx = chemin.findIndex((w) => w.ty === RAMPE.y && w.tx >= RAMPE.x - 1 && w.tx <= RAMPE.x + 1)
    expect(idx).toBeGreaterThan(0)
    expect(chemin[idx - 1]!.ty).toBe(RAMPE.y + 1)
  })

  it('le lissage : il n’invente pas la ligne droite qui longerait la rangée de la rampe à travers ses joues', () => {
    const map = terrasseALargeRampe()
    const depart = { tx: RAMPE.x + 4, ty: RAMPE.y }
    const brut = findPath(monde(map), depart, { tx: RAMPE.x - 4, ty: RAMPE.y })!
    expect(brut).not.toBeNull()
    // La prémisse : le chemin brut contourne bien par le sud (sinon le lissage n'a rien à défaire).
    expect(brut.some((w) => w.ty === RAMPE.y + 1)).toBe(true)
    const lisse = lisserLeChemin(monde(map), depart.tx + 0.5, depart.ty + 0.5, brut)
    expect(franchitUneJoueLeChemin(map, depart, lisse)).toBe(false)
    // ET LE CORPS ARRIVE : on suit le chemin lissé au pas de la collision, comme `followPath`.
    let x = depart.tx + 0.5
    let y = depart.ty + 0.5
    const jalons = [...lisse]
    for (let t = 0; t < 40 * BALANCE.TICK_RATE_HZ && jalons.length > 0; t++) {
      const w = jalons[0]!
      const dx = w.tx + 0.5 - x
      const dy = w.ty + 0.5 - y
      const r = jalons.length > 1 ? BALANCE.WAYPOINT_RADIUS : BALANCE.WAYPOINT_RADIUS_LAST
      if (dx * dx + dy * dy < r * r) { jalons.shift(); continue }
      const zm = 0.05
      const pas = moveAvatar(monde(map), x, y, (dx > zm ? 1 : dx < -zm ? -1 : 0), (dy > zm ? 1 : dy < -zm ? -1 : 0), TICK_DT_S)
      x = pas.x
      y = pas.y
    }
    expect(jalons, `bloqué en (${x.toFixed(2)}, ${y.toFixed(2)})`).toHaveLength(0)
  })

  it('le gradient de horde : la tuile à l’est de la rampe descend par le sud, pas par la joue', () => {
    const map = terrasseALargeRampe()
    const champ = computeFlowFieldMulti(map, [], [], [{ tx: RAMPE.x, ty: RAMPE.y - 3 }])
    const at = (tx: number, ty: number): number => champ[ty * map.width + tx]!
    const rampe = at(RAMPE.x + 1, RAMPE.y)
    expect(rampe).toBeGreaterThan(0)
    expect(at(RAMPE.x + 1, RAMPE.y + 1)).toBe(rampe + 1) // par le sud : un pas
    expect(at(RAMPE.x + 2, RAMPE.y + 1)).toBe(rampe + 2)
    expect(at(RAMPE.x + 2, RAMPE.y)).toBe(rampe + 3) // par le flanc, ce serait un ; par le sud, trois
  })
})
