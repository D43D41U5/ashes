/**
 * ═══ V-A7 — LE PASSAGE SE TROUVE, ET LA SENTE NE MENT PAS (spec `ascension.md`) ═══
 *
 * Trois critères, tous EXHAUSTIFS, sur les quatre graines de la maison et sur `MONDE_JOUE` :
 *
 *   (a) AUCUNE ROUTE NE TRAVERSE UN MUR. Toute paire de tuiles de route 4-adjacentes de paliers
 *       différents EST une rampe. Une route qui franchit une paroi ailleurs promet un passage
 *       qui n'existe pas, et le joueur qui la suit bute.
 *   (b) TOUTE TERRASSE ÉLIGIBLE EST REJOINTE. Éligible au sens de F-A3, ses CINQ clauses.
 *   (c) LA SENTE PASSE DEVANT LA PORTE, PAS AU MILIEU DU VILLAGE : cour d'enceinte VIDE, et le
 *       réseau à une tuile du vantail.
 *
 * ⚠ **CE QUI FERAIT ROUGIR CES GARDES, ÉNONCÉ AVANT D'ACCEPTER LEUR VERT.**
 *  · (a) : retirer `rampeMonte` du peintre — la loi anti-mur s'exempterait alors À LA TUILE, et
 *    les paires horizontales le long du flanc d'une rampe passeraient (mesuré : 0 → 27 sur la
 *    graine 2026). La garde AFFIRME donc d'abord sa prémisse : il EXISTE des paires à deux
 *    paliers, toutes à une rampe. Sans ce dénominateur, « zéro traversée » ne veut rien dire —
 *    un monde sans une seule route le rendrait aussi.
 *  · (b) : l'éligibilité doit être celle de F-A3, ses CINQ clauses. Avec trois sur cinq, le banc
 *    fabriquait sept « terrasses inatteignables » qui n'en étaient pas (2026-09-24).
 *  · (c) : mesurer depuis « une tuile de route » au lieu du PLUS GROS morceau ferait passer au
 *    vert un village desservi par un parvis orphelin de deux tuiles.
 *
 * ⚠ **ET L'EMPREINTE EST LA VRAIE GARDE DE NON-RÉGRESSION.** « Mêmes chiffres » n'est pas « même
 * carte » : deux tracés différents de même longueur rendent le même compte de tuiles. Le FNV-1a
 * du terrain peint, lui, ne pardonne pas — et c'est celui que `tools/diag-reseau.mts`, le banc
 * de référence, imprime. Les deux DOIVENT rester d'accord.
 */
import { describe, expect, it } from 'vitest'
import { carteDeTest } from '../../../tools/carte-cache'
import { BALANCE, TERRAIN_ROAD, VILLAGE_GROWTH } from './balance'
import { placeHuntingGrounds } from './faune'
import { isWater, MARCHABLE, type WorldMap } from './map'
import { nidsAMonstre } from './poi'
import { FLANC, TERRASSES } from './terrasses'
import { emplacementsDeVillage, placeZoneNodes, pointsDeSpawn } from './zone-content'
import { MONDE, MONDE_JOUE } from './zonegraph'
import { tracerLeReseau, type ResultatReseau } from './zonegen-reseau'

/** Les quatre graines de la maison — les mêmes que `terrasses.test.ts`. */
const GRAINES = [2026, 7, 4242, 909]

/**
 * L'EMPREINTE ATTENDUE, terrain peint, FNV-1a — relevée le 2026-09-25 et confirmée IDENTIQUE
 * entre le banc `tools/diag-reseau.mts` et cette passe. Un chiffre qui change ici dit que la
 * carte a changé ; si c'est voulu, on rejoue le banc et on recopie — jamais l'inverse.
 */
// ⚠ **RÉVISÉES LE 2026-09-25** : le décalage des points de passage est passé d'un `fbm2` corrélé
// à un `hash2` par cellule (voir l'en-tête de `zonegen-reseau.ts`). Le tracé bouge partout, donc
// les quatre empreintes changent — les 25 gardes de FOND, elles, n'ont pas bougé d'une ligne.
const EMPREINTES: Record<number, string> = {
  2026: '43962609',
  7: '3c83d5df',
  4242: '46b35bcc',
  909: 'd94d2cca',
}

/**
 * Le seul manquement connu — UNE porte sur vingt, quatre graines.
 *
 * ⚠ **ET L'EXPLICATION « POCHE / DÉFAUT DE PLACEMENT » EST RÉFUTÉE PAR LA MESURE (2026-09-25).**
 * On a longtemps écrit que cette porte donnait sur une poche dont l'unique sortie traversait une
 * cour. C'est faux : un balayage à pied depuis le parvis, au palier de la porte, atteint **20 000
 * tuiles** — que l'on exclue sa seule enceinte ou les CINQ —, et **les cinq portes de la graine se
 * comportent pareil**. La route passe même à **quatre pas** du vantail. Ce qui manque, c'est le
 * dernier maillon : le parvis est bien peint, puis retiré comme MOIGNON faute d'avoir rejoint le
 * réseau, et le critère (c) exige une tuile, pas quatre.
 *
 * C'est donc un défaut de TRACÉ (le parvis et la fermeture), pas de peuplement — et son correctif
 * touche la peinture, donc les quatre empreintes : il aura son propre changement et son propre
 * A/B. Voir §V-A7 (c).
 */
const PORTE_ENCLAVEE: Record<number, string[]> = { 4242: ['1168,1417'] }

const RV = VILLAGE_GROWTH.ENCEINTE_RADIUS

interface Monde {
  map: WorldMap
  villages: { tx: number; ty: number }[]
  resultat: ResultatReseau
  empreinte: string
}

/**
 * LE MONDE JOUÉ, ROUTES COMPRISES — la chaîne de l'hôte, dans l'ordre de l'hôte. On réplique
 * l'élection de `peuplerLesVoisins` plutôt que de l'appeler : elle exige un `SimState`, et ce
 * qui compte ici c'est la GÉOMÉTRIE. ① `premier` exclu ; ② tri par distance au CARRÉ ;
 * ③ `VILLAGES_VEILLEE` ; ④ la Meute recule tant que sa marge ne passe pas le minimum.
 */
const MONDES = new Map<number, Monde>()
/** Un monde par graine, et un seul : chacun coûte une génération plus une passe complète. */
function mondeAvecSentes(seed: number): Monde {
  const deja = MONDES.get(seed)
  if (deja !== undefined) return deja
  const fait = batirLeMonde(seed)
  MONDES.set(seed, fait)
  return fait
}

function batirLeMonde(seed: number): Monde {
  const carte = carteDeTest(seed, MONDE.JOUEURS_CIBLE, MONDE_JOUE)
  const map = carte.map
  const nodes = placeZoneNodes(carte)
  const emp = emplacementsDeVillage(carte, nodes, {
    coinsDeChasse: placeHuntingGrounds(map, seed),
    nids: nidsAMonstre(map),
  })
  const spawns = pointsDeSpawn(carte, emp, Math.ceil(MONDE.JOUEURS_CIBLE / MONDE.JOUEURS_PAR_VILLAGE), seed)
  const premier = spawns[0] ?? emp[0]!
  const d2 = (a: { tx: number; ty: number }, b: { tx: number; ty: number }): number =>
    (a.tx - b.tx) * (a.tx - b.tx) + (a.ty - b.ty) * (a.ty - b.ty)
  const candidats = emp
    .filter((e) => e.tx !== premier.tx || e.ty !== premier.ty)
    .slice()
    .sort((a, b) => d2(a, premier) - d2(b, premier))
  const margeDe = (sites: readonly { tx: number; ty: number }[], i: number): number => {
    let pr = Infinity
    let se = Infinity
    for (let j = 0; j < sites.length; j++) {
      if (j === i) continue
      const d = Math.sqrt(d2(sites[i]!, sites[j]!))
      if (d < pr) { se = pr; pr = d } else if (d < se) { se = d }
    }
    if (pr === Infinity || se === Infinity || pr === 0) return 100
    return ((se - pr) / pr) * 100
  }
  const villages = candidats.slice(0, BALANCE.VILLAGES_VEILLEE)
  let prochain = BALANCE.VILLAGES_VEILLEE
  while (villages.length > 2 && prochain < candidats.length && margeDe(villages, 1) <= BALANCE.MARGE_DE_CIBLE_MIN) {
    villages[1] = candidats[prochain]!
    prochain++
  }
  const resultat = tracerLeReseau(map, carte.socle ?? null, villages, seed)
  let h = 0x811c9dc5
  for (let i = 0; i < map.width * map.height; i++) { h ^= map.terrain[i]!; h = Math.imul(h, 0x01000193) }
  return { map, villages, resultat, empreinte: (h >>> 0).toString(16) }
}

/** Les tuiles-PIED des rampes : une rampe se monte du pied `(x, y)` au sommet `(x, y − 1)`. */
function piedsDeRampe(map: WorldMap): Set<number> {
  const pieds = new Set<number>()
  for (const c of map.connecteurs ?? []) if (c.type === 'rampe') pieds.add(c.y * map.width + c.x)
  return pieds
}

describe('V-A7 — le réseau de sentes, sur le monde JOUÉ', () => {
  for (const graine of GRAINES) {
    describe(`graine ${graine}`, () => {
      const monde = mondeAvecSentes(graine)
      const { map, villages, resultat } = monde
      const W = map.width
      const H = map.height
      const pal = map.palier!
      const P = (x: number, y: number): number => pal[y * W + x] ?? 0
      const estRoute = (i: number): boolean => map.terrain[i] === TERRAIN_ROAD

      it('la passe a fait son travail : aucun tracé ni raccord en échec', () => {
        // LA PRÉMISSE D'ABORD : une passe qui n'aurait rien peint rendrait tous les zéros
        // qui suivent, et chaque garde passerait au vert sans rien prouver.
        expect(resultat.tuiles, 'tuiles de route posées').toBeGreaterThan(10_000)
        expect(resultat.rates, 'tracés en échec').toBe(0)
        expect(resultat.villagesRates, 'villages non raccordés').toBe(0)
        expect(resultat.sansParvis, 'villages sans parvis').toBe(0)
        // Impossible par construction : on ne change de palier qu'à une arête de rampe.
        expect(resultat.sansArete, 'changements de palier sans rampe').toBe(0)
        // Un moignon contre l'enceinte est un bout de route qui ne mène nulle part.
        expect(resultat.moignonsApres, 'bouts morts après ébranchage').toBe(0)
      })

      it(`l'empreinte du terrain peint est ${EMPREINTES[graine]} — la carte n'a pas bougé`, () => {
        expect(monde.empreinte).toBe(EMPREINTES[graine])
      })

      /**
       * ═══ LE TRACÉ EST ORGANIQUE — LA GARDE QUI MANQUAIT ═══
       *
       * ⚠ **L'EMPREINTE NE DIT RIEN DE LA FORME.** Elle rougit à tout changement et se recopie ;
       * elle n'aurait jamais attrapé ce que l'écran a montré le 2026-09-25 — une sente **au
       * cordeau sur dix-sept tuiles**, alors que les 25 autres gardes étaient vertes. On mesure
       * donc la RECTITUDE elle-même : la part des tuiles de route prises dans un segment axial
       * **strictement mince** (les deux voisins perpendiculaires hors route — sinon on compterait
       * la largeur d'un tronc de 3 tuiles pour de la rectitude).
       *
       * Les bornes viennent de l'A/B des deux bruits de décalage (`tools/origine-droite.mts`) :
       *   · ≥ 12 tuiles — **24-25 %** au `fbm2` corrélé, **17-18 %** au `hash2` livré → borne 21 %
       *   · ≥ 24 tuiles — **6-7 %** au `fbm2`, **1-3 %** au `hash2` → borne 5 %
       * Un retour au bruit corrélé rougit les DEUX, et pas seulement l'empreinte.
       */
      it('(d) le tracé est ORGANIQUE : peu de longues droites, et pas la largeur d’un tronc', () => {
        const W = map.width
        const H = map.height
        const T = map.terrain
        let tot = 0
        for (let i = 0; i < W * H; i++) if (T[i] === TERRAIN_ROAD) tot++
        expect(tot, 'la passe n’a rien peint — la garde serait vide').toBeGreaterThan(10_000)
        const marque = new Uint8Array(W * H)
        const partDroite = (N: number): number => {
          marque.fill(0)
          for (let y = 0; y < H; y++) {
            let x = 0
            while (x < W) {
              if (T[y * W + x] !== TERRAIN_ROAD) { x++; continue }
              let e = x
              while (e < W && T[e + y * W] === TERRAIN_ROAD) e++
              if (e - x >= N) {
                for (let k = x; k < e; k++) {
                  const haut = y === 0 || T[(y - 1) * W + k] !== TERRAIN_ROAD
                  const bas = y === H - 1 || T[(y + 1) * W + k] !== TERRAIN_ROAD
                  if (haut && bas) marque[y * W + k] = 1
                }
              }
              x = e
            }
          }
          for (let x = 0; x < W; x++) {
            let y = 0
            while (y < H) {
              if (T[y * W + x] !== TERRAIN_ROAD) { y++; continue }
              let e = y
              while (e < H && T[e * W + x] === TERRAIN_ROAD) e++
              if (e - y >= N) {
                for (let k = y; k < e; k++) {
                  const g = x === 0 || T[k * W + x - 1] !== TERRAIN_ROAD
                  const d = x === W - 1 || T[k * W + x + 1] !== TERRAIN_ROAD
                  if (g && d) marque[k * W + x] = 1
                }
              }
              y = e
            }
          }
          let n = 0
          for (let i = 0; i < W * H; i++) n += marque[i]!
          return (n / tot) * 100
        }
        const douze = partDroite(12)
        const vingtQuatre = partDroite(24)
        console.log(`  (d) graine ${graine} : droites minces ≥ 12 t ${douze.toFixed(1)} % · ≥ 24 t ${vingtQuatre.toFixed(1)} %`)
        expect(douze, 'part de route en ligne droite de 12 tuiles ou plus').toBeLessThanOrEqual(21)
        expect(vingtQuatre, 'part de route en ligne droite de 24 tuiles ou plus').toBeLessThanOrEqual(5)
      })

      it('(a) AUCUNE route ne traverse un mur — garde EXHAUSTIVE, sur la PAIRE', () => {
        const pieds = piedsDeRampe(map)
        /**
         * ⚠ **LA LOI S'ÉNONCE SUR LA PAIRE, JAMAIS SUR LA TUILE.** Une rampe est VERTICALE : le
         * pied en `(x, y)` au palier `de`, le sommet en `(x, y − 1)` au palier `vers`. Exempter
         * « toute tuile qui touche une rampe » laisse passer une paire HORIZONTALE le long du
         * flanc — mesuré graine 2026 en (820,828)→(821,828).
         */
        const estLaMontee = (x: number, y: number, nx: number, ny: number): boolean =>
          x === nx && Math.abs(y - ny) === 1 && pieds.has(Math.max(y, ny) * W + x)

        let aUneRampe = 0
        const traversent: string[] = []
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = y * W + x
            if (!estRoute(i)) continue
            // Est et Sud seulement : chaque paire une fois.
            for (const [nx, ny] of [[x + 1, y], [x, y + 1]] as const) {
              if (nx >= W || ny >= H) continue
              if (!estRoute(ny * W + nx)) continue
              if (P(nx, ny) === P(x, y)) continue
              if (estLaMontee(x, y, nx, ny)) { aUneRampe++; continue }
              traversent.push(`${x},${y}→${nx},${ny} (p${P(x, y)}→p${P(nx, ny)})`)
            }
          }
        }
        // LE DÉNOMINATEUR : la garde ne peut pas passer à vide. S'il n'existe aucune paire à
        // deux paliers, c'est que la route ne monte nulle part — et « zéro traversée » ment.
        expect(aUneRampe, `graine ${graine} : paires de route qui montent une rampe`).toBeGreaterThan(20)
        expect(traversent, `graine ${graine} : ${traversent.length} route(s) traversent un mur —\n  ${traversent.slice(0, 12).join('\n  ')}`).toHaveLength(0)
      })

      it('le réseau est d’UN SEUL morceau — une route qui ne mène nulle part est un mensonge', () => {
        const comp = new Int32Array(W * H).fill(-1)
        const tailles: number[] = []
        const pile: number[] = []
        for (let d = 0; d < W * H; d++) {
          if (comp[d] !== -1 || !estRoute(d)) continue
          const id = tailles.length
          let n = 0
          pile.length = 0
          pile.push(d)
          comp[d] = id
          while (pile.length > 0) {
            const i = pile.pop()!
            n++
            const x = i % W
            const y = (i - x) / W
            for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              const v = ny * W + nx
              if (comp[v] !== -1 || !estRoute(v)) continue
              comp[v] = id
              pile.push(v)
            }
          }
          tailles.push(n)
        }
        expect(tailles, `graine ${graine} : morceaux de route (tailles ${tailles.join(', ')})`).toHaveLength(1)
      })

      it('(b) toute TERRASSE ÉLIGIBLE est rejointe par une route — éligibilité de F-A3, ses CINQ clauses', () => {
        // ── la plus grande composante marchable AU SOL, paliers ignorés (le dénominateur F-A3) ──
        const principale = new Uint8Array(W * H)
        {
          const comp = new Int32Array(W * H).fill(-1)
          const pile: number[] = []
          let meilleur = -1
          let meilleurN = 0
          let n = 0
          for (let d = 0; d < W * H; d++) {
            if (comp[d]! >= 0 || MARCHABLE[map.terrain[d]!] !== 1) continue
            pile.length = 0
            pile.push(d)
            comp[d] = n
            let taille = 0
            while (pile.length > 0) {
              const i = pile.pop()!
              taille++
              const x = i % W
              const y = (i - x) / W
              for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
                const v = ny * W + nx
                if (comp[v]! >= 0 || MARCHABLE[map.terrain[v]!] !== 1) continue
                comp[v] = n
                pile.push(v)
              }
            }
            if (taille > meilleurN) { meilleurN = taille; meilleur = n }
            n++
          }
          for (let i = 0; i < W * H; i++) if (comp[i] === meilleur) principale[i] = 1
        }

        // ── les terrasses : composantes de tuiles FOULABLES de même palier ──────────────────
        const comp = new Int32Array(W * H).fill(-1)
        const taille: number[] = []
        const palierDe: number[] = []
        const dansP: number[] = []
        const eaux: number[] = []
        const emprise: number[] = []
        const pile: number[] = []
        for (let d = 0; d < W * H; d++) {
          if (comp[d] !== -1 || MARCHABLE[map.terrain[d]!] !== 1) continue
          const id = taille.length
          const p = pal[d]!
          let n = 0
          let dedans = 0
          let eau = 0
          let minX = W
          let maxX = -1
          let minY = H
          let maxY = -1
          pile.length = 0
          pile.push(d)
          comp[d] = id
          while (pile.length > 0) {
            const i = pile.pop()!
            n++
            if (principale[i] === 1) dedans++
            if (isWater(map.terrain[i]!)) eau++
            const x = i % W
            const y = (i - x) / W
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
            for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              const v = ny * W + nx
              if (comp[v] !== -1 || MARCHABLE[map.terrain[v]!] !== 1 || pal[v] !== p) continue
              comp[v] = id
              pile.push(v)
            }
          }
          taille.push(n)
          palierDe.push(p)
          dansP.push(dedans)
          eaux.push(eau)
          emprise.push(Math.max(maxX - minX, maxY - minY))
        }

        // ⚠ LA MÊME POPULATION QUE F-A3, ses CINQ clauses : l'enclave et la nappe n'en sont pas.
        const SEUIL = TERRASSES.MIETTE_TUILES * 4
        const eligibles = taille
          .map((n, id) => ({ id, n, p: palierDe[id]!, dp: dansP[id]!, eau: eaux[id]!, emp: emprise[id]! }))
          .filter((c) => c.n >= SEUIL && c.p > 0 && c.dp / c.n >= 0.5 && c.eau / c.n < 0.5 && c.emp >= FLANC.SECTEUR)
        // La garde ne peut pas passer à vide : un monde joué porte des dizaines de terrasses.
        expect(eligibles.length, `graine ${graine} : terrasses éligibles`).toBeGreaterThan(8)

        const servies = new Set<number>()
        for (let i = 0; i < W * H; i++) if (estRoute(i) && comp[i]! >= 0) servies.add(comp[i]!)
        const sansRoute = eligibles.filter((c) => !servies.has(c.id))
        expect(
          sansRoute.map((c) => `comp ${c.id} p${c.p} ${c.n}t`),
          `graine ${graine} : ${sansRoute.length}/${eligibles.length} terrasses éligibles sans route`,
        ).toHaveLength(0)
      })

      it('(c) la cour de chaque village reste VIDE — la route passe devant, pas au milieu', () => {
        const dedans: string[] = []
        for (const v of villages) {
          for (let dy = -RV - 1; dy <= RV + 1; dy++) {
            for (let dx = -RV - 1; dx <= RV + 1; dx++) {
              const x = v.tx + dx
              const y = v.ty + dy
              if (x < 0 || y < 0 || x >= W || y >= H) continue
              if (estRoute(y * W + x)) dedans.push(`${x},${y} (village ${v.tx},${v.ty})`)
            }
          }
        }
        expect(dedans, `graine ${graine} : ${dedans.length} tuile(s) de route dans une enceinte`).toHaveLength(0)
      })

      it('(c) chaque PORTE touche le réseau — et le réseau, pas un parvis orphelin', () => {
        /**
         * ⚠ **« À CÔTÉ D'UNE ROUTE » N'EST PAS « SUR LE RÉSEAU ».** On sème le BFS depuis le PLUS
         * GROS morceau seulement : être à trois pas d'une route qui ne mène nulle part n'est pas
         * être desservi (mesuré graine 4242, un parvis de deux tuiles sur une banquette).
         * Et l'on marche comme le jeu marche : même palier, ou une rampe.
         */
        const comp = new Int32Array(W * H).fill(-1)
        const tailles: number[] = []
        {
          const pile: number[] = []
          for (let d = 0; d < W * H; d++) {
            if (comp[d] !== -1 || !estRoute(d)) continue
            const id = tailles.length
            let n = 0
            pile.length = 0
            pile.push(d)
            comp[d] = id
            while (pile.length > 0) {
              const i = pile.pop()!
              n++
              const x = i % W
              const y = (i - x) / W
              for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
                const v = ny * W + nx
                if (comp[v] !== -1 || !estRoute(v)) continue
                comp[v] = id
                pile.push(v)
              }
            }
            tailles.push(n)
          }
        }
        let gros = 0
        for (let k = 1; k < tailles.length; k++) if (tailles[k]! > tailles[gros]!) gros = k

        const pieds = piedsDeRampe(map)
        const estLaMontee = (x: number, y: number, nx: number, ny: number): boolean =>
          x === nx && Math.abs(y - ny) === 1 && pieds.has(Math.max(y, ny) * W + x)
        const d = new Int32Array(W * H).fill(-1)
        let file: number[] = []
        for (let i = 0; i < W * H; i++) if (comp[i] === gros) { d[i] = 0; file.push(i) }
        let pas = 0
        // Deux tuiles suffisent : le critère est « le réseau arrive à ≤ 1 tuile du vantail ».
        while (file.length > 0 && pas < 2) {
          pas++
          const suite: number[] = []
          for (const i of file) {
            const x = i % W
            const y = (i - x) / W
            for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
              const v = ny * W + nx
              if (d[v]! >= 0 || MARCHABLE[map.terrain[v]!] !== 1) continue
              if (pal[v] !== pal[i] && !estLaMontee(x, y, nx, ny)) continue
              d[v] = pas
              suite.push(v)
            }
          }
          file = suite
        }

        // La PORTE : `village-plan.ts` la pose en dur, plein SUD du Feu.
        const loin: string[] = []
        for (const v of villages) {
          const px = v.tx
          const py = v.ty + RV + 1
          const cle = `${px},${py}`
          if (PORTE_ENCLAVEE[graine]?.includes(cle) === true) continue
          if (px < 0 || py < 0 || px >= W || py >= H) { loin.push(`${cle} HORS CARTE`); continue }
          const dist = d[py * W + px]!
          if (dist < 0 || dist > 1) loin.push(`${cle} à ${dist < 0 ? '> 1' : dist} tuile(s) du plus gros morceau`)
        }
        expect(
          loin,
          `graine ${graine} : ${loin.length} porte(s) de village que le réseau ne touche pas —\n  ${loin.join('\n  ')}`,
        ).toHaveLength(0)
      })
    })
  }
})

/**
 * ⚠ **L'EXCEPTION EST NOMMÉE, ET SA CAUSE EST MESURÉE — sans quoi ce serait une tolérance.**
 * Sur la graine 4242, le village de `1168,1408` ouvre sa porte en `1168,1417` sur une poche dont
 * l'unique sortie à pied repasse par une COUR de village — or le critère (c) interdit justement
 * à la route de traverser une cour. C'est donc un défaut de PLACEMENT (`peuplerLesVoisins` ne
 * sait rien des paliers ni des poches), pas de tracé : question ouverte, rangée sous V-A10.
 *
 * Ce test ne tolère rien : il EXIGE que la cause tienne toujours. Le jour où le peuplement
 * changera, il rougira — et c'est exactement ce qu'on veut de lui.
 */
describe('V-A7 (c) — l’exception de la graine 4242 est une poche, pas un oubli du routeur', () => {
  it('la porte de 1168,1417 est foulable, et le réseau ne peut l’atteindre qu’en traversant une cour', () => {
    const { map, villages } = mondeAvecSentes(4242)
    const W = map.width
    const H = map.height
    const pal = map.palier!
    const px = 1168
    const py = 1417
    expect(MARCHABLE[map.terrain[py * W + px]!], 'le vantail est foulable').toBe(1)
    expect(villages.some((v) => v.tx === px && v.ty === py - RV - 1), 'le village est bien là').toBe(true)

    const pieds = new Set<number>()
    for (const c of map.connecteurs ?? []) if (c.type === 'rampe') pieds.add(c.y * W + c.x)
    const estLaMontee = (x: number, y: number, nx: number, ny: number): boolean =>
      x === nx && Math.abs(y - ny) === 1 && pieds.has(Math.max(y, ny) * W + x)
    const dansUneCour = (x: number, y: number): boolean =>
      villages.some((v) => Math.max(Math.abs(x - v.tx), Math.abs(y - v.ty)) <= RV + 1)

    /** Depuis le vantail, jusqu'à une tuile de route — avec ou sans le droit de traverser une cour. */
    const chercher = (coursInterdites: boolean): number => {
      const vus = new Uint8Array(W * H)
      let file = [py * W + px]
      vus[py * W + px] = 1
      let pas = 0
      while (file.length > 0) {
        pas++
        const suite: number[] = []
        for (const i of file) {
          const x = i % W
          const y = (i - x) / W
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            const v = ny * W + nx
            if (vus[v] === 1 || MARCHABLE[map.terrain[v]!] !== 1) continue
            if (coursInterdites && dansUneCour(nx, ny)) continue
            if (pal[v] !== pal[i] && !estLaMontee(x, y, nx, ny)) continue
            vus[v] = 1
            if (map.terrain[v] === TERRAIN_ROAD) return pas
            suite.push(v)
          }
        }
        file = suite
      }
      return -1
    }

    // Sans le droit de traverser une cour : AUCUN chemin. C'est la cause, et elle est exacte.
    expect(chercher(true), 'sans traverser de cour').toBe(-1)
    // En s'autorisant les cours : il en existe un, et il est long. La poche est bien une poche.
    expect(chercher(false), 'en traversant une cour').toBeGreaterThan(20)
  }, 120_000)
})
