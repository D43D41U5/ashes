/**
 * LES GARDES DES AFFLEUREMENTS — spec `t0-exploration.md` §2sexies (décision d'Alexis,
 * 2026-08-18 : « zones de production naturelle », reco suivie).
 *
 * Quatre choses, et rien d'autre :
 *   A28 — les PLANCHERS (R51) tiennent : fer, charbon, carrières, vieux fûts — sur les graines
 *         de production ET à l'échelle du banc. Aucune seed ne naît sans économie.
 *   A29 — CONTENANT/CONTENU (R48-R50) : chaque nœud neuf est LÀ où sa dérivation le met — le
 *         minerai sur la rocaille registrée, la carrière contre la roche hors d'atteinte du
 *         front, le vieux fût au cœur (et hors Bois Noir).
 *   A30 — un affleurement = UNE identité, les buttes s'écartent, et aucun village dessus (R52).
 *   A31 — le monde COMPLET est intact : zéro nœud neuf sur le plan `'vallee'` — l'exclusivité
 *         R9 (A14/A15bis) reste gardée par ses propres gardes, celle-ci épingle le périmètre.
 */
import { describe, expect, it } from 'vitest'
import { NODE_DEFS, TERRAINS, TERRAIN_BOULDERS, TERRAIN_ROCK, TERRAIN_SCREE } from './balance'
import { placeHuntingGrounds } from './faune'
import { profondeurAt } from './map'
import { nidsAMonstre } from './poi'
import { estCoeur } from './profondeur'
import { BLOC_STOCKS, CONTENU, emplacementsDeVillage, placeZoneNodes, tailleDeBloc } from './zone-content'
import { carteDeTest } from '../../../tools/carte-cache'
import { CREUX } from './racine-relief'
import { distAuRect, MONDE } from './zonegraph'
import type { ResourceNode } from './economy'

const SEEDS = [2026, 7]
const mondes = SEEDS.map((s) => {
  const c = carteDeTest(s, MONDE.JOUEURS_CIBLE, 'racine')
  return { s, c, nodes: placeZoneNodes(c) }
})

/** Les nœuds NEUFS d'un type dans la racine — le teaser (stock dérisoire) reste hors compte. */
const neufs = (m: (typeof mondes)[number], type: ResourceNode['type']): ResourceNode[] =>
  m.nodes.filter((n) => n.type === type && n.stock !== CONTENU.TEASER_STOCK
    && m.c.zone[n.ty * m.c.map.width + n.tx] === m.c.graphe.racine)

describe('A28 — les planchers de R51 : aucune seed ne naît sans économie', () => {
  it('fer, charbon, carrières et vieux fûts existent sur les graines de production', () => {
    for (const m of mondes) {
      expect(m.c.affleurements.filter((a) => a.ressource === 'fer').length, `seed ${m.s} : buttes ferreuses`).toBeGreaterThanOrEqual(1)
      expect(m.c.affleurements.filter((a) => a.ressource === 'charbon').length, `seed ${m.s} : buttes charbonneuses`).toBeGreaterThanOrEqual(1)
      expect(neufs(m, 'iron_vein').length, `seed ${m.s} : filons`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'coal_seam').length, `seed ${m.s} : charbon`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'quarry').length, `seed ${m.s} : carrières`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'old_tree').length, `seed ${m.s} : vieux fûts`).toBeGreaterThanOrEqual(1)
    }
  })

  it('et à l\'échelle du banc aussi — le monde qu\'on calibre porte la même économie', () => {
    for (const s of [2026, 31]) {
      const c = carteDeTest(s, 6, 'racine')
      const nodes = placeZoneNodes(c)
      const m = { s, c, nodes }
      expect(m.c.affleurements.length, `seed ${s} (banc)`).toBeGreaterThanOrEqual(2)
      expect(neufs(m, 'iron_vein').length, `seed ${s} (banc) : filons`).toBeGreaterThanOrEqual(1)
      expect(neufs(m, 'quarry').length, `seed ${s} (banc) : carrières`).toBeGreaterThanOrEqual(1)
      expect(neufs(m, 'old_tree').length, `seed ${s} (banc) : vieux fûts`).toBeGreaterThanOrEqual(1)
    }
  }, 60_000)
})

describe('A29 — contenant/contenu : chaque nœud neuf est LÀ où sa dérivation le met', () => {
  it('le minerai est SUR la rocaille d\'un affleurement registré, de la bonne identité', () => {
    for (const m of mondes) {
      const { width, terrain } = m.c.map
      for (const type of ['iron_vein', 'coal_seam'] as const) {
        const attendu = type === 'iron_vein' ? 'fer' : 'charbon'
        for (const n of neufs(m, type)) {
          expect(terrain[n.ty * width + n.tx], `seed ${m.s} : ${type}@${n.tx},${n.ty} hors rocaille`).toBe(TERRAIN_SCREE)
          const butte = m.c.affleurements.find((a) =>
            n.tx >= a.rect.x && n.tx < a.rect.x + a.rect.w && n.ty >= a.rect.y && n.ty < a.rect.y + a.rect.h)
          expect(butte, `seed ${m.s} : ${type}@${n.tx},${n.ty} hors de toute butte registrée`).toBeDefined()
          expect(butte!.ressource, `seed ${m.s} : identité de la butte @${butte!.rect.x},${butte!.rect.y}`).toBe(attendu)
        }
      }
    }
  })

  // (La clause « hors d'atteinte du front » est tombée le 2026-08-24 avec le front : il ne reste
  //  que la paroi, qui est la vraie raison d'être d'une carrière.)
  it('la carrière touche la roche', () => {
    for (const m of mondes) {
      const { width, terrain } = m.c.map
      for (const n of neufs(m, 'quarry')) {
        const i = n.ty * width + n.tx
        const contreLaRoche = terrain[i - 1] === TERRAIN_ROCK || terrain[i + 1] === TERRAIN_ROCK
          || terrain[i - width] === TERRAIN_ROCK || terrain[i + width] === TERRAIN_ROCK
        expect(contreLaRoche, `seed ${m.s} : quarry@${n.tx},${n.ty} sans paroi`).toBe(true)
      }
    }
  })

  it('le vieux fût est au CŒUR d\'un massif, et jamais dans le Bois Noir', () => {
    for (const m of mondes) {
      const bois = m.c.map.zones.find((z) => z.kind === 'bois_noir')
      for (const n of neufs(m, 'old_tree')) {
        expect(estCoeur(profondeurAt(m.c.map, n.tx, n.ty)), `seed ${m.s} : old_tree@${n.tx},${n.ty} hors cœur`).toBe(true)
        if (bois) {
          const dedans = n.tx >= bois.x && n.tx < bois.x + bois.w && n.ty >= bois.y && n.ty < bois.y + bois.h
          expect(dedans, `seed ${m.s} : old_tree@${n.tx},${n.ty} dans le Bois Noir — son teaser perd son récit`).toBe(false)
        }
        expect(n.stock, `seed ${m.s}`).toBe(NODE_DEFS.old_tree.stock)
      }
    }
  })

  it('les BLOCS sont des nœuds `bloc` pleine tuile, sur la caillasse, à la taille de leur stock', () => {
    // « un bloc = une tuile pleine de non traversable… plusieurs tailles » (Alexis, 2026-08-18) :
    // le type dédié REMPLIT sa tuile (`blockHalfSub: 4`), et son stock EST sa taille
    // (`tailleDeBloc`, la même fonction pure que l'art côté client — deux lectures, une vérité).
    //
    // ⚠ **« QUE SUR LES BUTTES » EST TOMBÉ LE 2026-08-27** (`roche-mere.md` R6ter — Alexis :
    // « ok pour qu'il y ait des gros blocs de pierre… on leur donne un hitbox »). Le chaos de
    // blocs du lapiaz en porte désormais aussi, et il est le gros bataillon. La garde se scinde
    // donc en DEUX populations, chacune avec son contenant, et rien d'autre n'est admis : un
    // bloc sur de l'herbe resterait un échec.
    expect(NODE_DEFS.bloc.blockHalfSub).toBe(4)
    for (const m of mondes) {
      const { width, terrain } = m.c.map
      const blocs = m.nodes.filter((n) => n.type === 'bloc')
      const surUneButte = (n: ResourceNode): boolean => m.c.affleurements.some((a) =>
        n.tx >= a.rect.x && n.tx < a.rect.x + a.rect.w && n.ty >= a.rect.y && n.ty < a.rect.y + a.rect.h)
      for (const n of blocs) {
        const t = terrain[n.ty * width + n.tx]
        const butte = surUneButte(n)
        // Une butte est peinte en PIERRIER, le chaos en CHAOS DE BLOCS : le contenant se lit au
        // terrain, et chaque bloc appartient à l'un ou à l'autre — jamais à ni l'un ni l'autre.
        expect(butte ? t : TERRAIN_BOULDERS, `seed ${m.s} : bloc hors caillasse @${n.tx},${n.ty} (terrain ${t})`)
          .toBe(butte ? TERRAIN_SCREE : TERRAIN_BOULDERS)
        expect(t === TERRAIN_SCREE || t === TERRAIN_BOULDERS, `seed ${m.s} : bloc sur un sol qui n'est pas minéral @${n.tx},${n.ty}`).toBe(true)
        // LE STOCK SUIT LA TAILLE — mais la taille se lit à DEUX endroits selon le contenant
        // (R6septies) : sur une butte elle est PORTÉE par le nœud (elle dépend de la forme de la
        // butte, pas de la tuile) ; dans le chaos elle se redérive de la tuile. Les deux voies
        // sont affirmées ici, et l'absence de `size` sur un bloc de butte serait un échec.
        expect(n.stock, `seed ${m.s} : stock ≠ taille @${n.tx},${n.ty}`)
          .toBe(BLOC_STOCKS[butte ? n.size! : tailleDeBloc(n.tx, n.ty)])
        expect(butte ? n.size !== undefined : n.size === undefined,
          `seed ${m.s} : bloc @${n.tx},${n.ty} — taille ${butte ? 'absente sur une butte' : 'portée hors butte'}`).toBe(true)
      }
      for (const a of m.c.affleurements) {
        const surButte = blocs.filter((n) =>
          n.tx >= a.rect.x && n.tx < a.rect.x + a.rect.w && n.ty >= a.rect.y && n.ty < a.rect.y + a.rect.h)
        expect(surButte.length, `seed ${m.s} : butte @${a.rect.x},${a.rect.y} sans chaos de blocs`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('R6ter — le chaos MURE, jusqu\'à sa rive, et se traverse sans détour', () => {
    // Deux affirmations, et elles disent la forme voulue plutôt qu'un compte : c'est de la
    // PIERRE (au cœur comme au bord), et l'on NAVIGUE quand même (« il faut juste qu'on puisse
    // naviguer vite fait »).
    //
    // ⚠ **LA CLAUSE DE RIVE EST TOMBÉE le 2026-08-27** — *« retire l'érosion de boulders dans
    // tous les cas »* (Alexis). Elle exigeait l'inverse de ce qui est voulu maintenant : une
    // rive deux fois plus ouverte que le cœur. Le chaos est plein jusqu'à son bord, et c'est le
    // contour du lapiaz — dentelé à la tuile — qui lui donne sa forme. La densité est donc
    // affirmée sur TOUT le champ, cœur et rive confondus.
    //
    // ⚠ **CE N'EST PLUS « TOUT EST JOINT ».** La première écriture exigeait 99 % du vide du
    // chaos d'un seul tenant ; Alexis a levé la contrainte — *« ce n'est pas grave si certaines
    // structures enferment une partie des boulders. Ces blocs sont cassables. »* Une garde qui
    // exigerait la connexité parfaite ferait rougir un monde qu'il vient de déclarer bon, et
    // contraindrait le générateur pour rien. Ce qui se garde, c'est le **détour**.
    for (const m of mondes) {
      const { width, height, terrain } = m.c.map
      const chaos: number[] = []
      for (let i = 0; i < width * height; i++) if (terrain[i] === TERRAIN_BOULDERS) chaos.push(i)
      // PRÉMISSE re-épinglée 2000 → 900 le 2026-08-30 (pays endoréique) : le lapiaz naît sur le
      // calcaire ET le relief, tous deux redessinés par l'érosion. MESURÉ à la taille de
      // production — boulders : 2026 → 3 765, 7 → **1 146**, 42 → 11 552. La graine 7 est pauvre
      // en chaos, elle ne l'est pas devenue de zéro ; mille tuiles suffisent largement à ce que
      // le détour mesuré plus bas veuille dire quelque chose.
      expect(chaos.length, `seed ${m.s} : pas de chaos de blocs — la garde ne prouve rien`).toBeGreaterThan(900)
      const dansLeChaos = new Set(chaos)

      const bloque = new Uint8Array(width * height)
      for (let i = 0; i < width * height; i++) if (TERRAINS[terrain[i]!]?.walkable !== true) bloque[i] = 1
      for (const n of m.nodes) if (n.type === 'bloc') bloque[n.ty * width + n.tx] = 1

      // ① C'EST DE LA PIERRE — sur TOUT le champ, rive comprise (l'érosion est tombée). Le
      //    seuil est bas exprès : ce qui se garde ici, c'est qu'un chaos MURE quelque part ; sa
      //    densité exacte est un réglage qu'on lit sur une carte, pas un contrat.
      const partBloc = chaos.filter((i) => bloque[i] === 1).length / chaos.length
      expect(partBloc, `seed ${m.s} : part du chaos qui bloque`).toBeGreaterThan(0.2)

      // ② ON NAVIGUE VITE FAIT — le DÉTOUR : longueur du chemin réel ÷ distance à vol d'oiseau,
      //    en travers du plus gros chaos. C'est la formulation d'Alexis, mesurable telle quelle.
      const vu = new Uint8Array(width * height)
      let plusGros: number[] = []
      for (const i of chaos) {
        if (vu[i]) continue
        const pile = [i]
        vu[i] = 1
        const amas = [i]
        while (pile.length) {
          const k: number = pile.pop()!
          const kx = k % width
          const ky = (k - kx) / width
          for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < width ? k + 1 : -1, ky > 0 ? k - width : -1, ky + 1 < height ? k + width : -1]) {
            if (v < 0 || vu[v] || !dansLeChaos.has(v)) continue
            vu[v] = 1
            pile.push(v)
            amas.push(v)
          }
        }
        if (amas.length > plusGros.length) plusGros = amas
      }
      let x0 = width, y0 = height, x1 = 0, y1 = 0
      for (const i of plusGros) {
        const x = i % width
        const y = (i - x) / width
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      // Re-épinglée 40 → 30 le 2026-08-30, même cause que la prémisse du dessus (le lapiaz naît
      // sur un relief que l'érosion a redessiné) : MESURÉ, le plus gros amas de la graine 7 fait
      // 35 tuiles de large. Trente tuiles, c'est encore une traversée d'un écran et demi.
      expect(x1 - x0, `seed ${m.s} : le plus gros chaos est trop petit pour qu'une traversée dise quoi que ce soit`).toBeGreaterThan(30)
      // Dijkstra à coûts entiers (10 / 14) — 8-connexe, comme le déplacement réel.
      const cheminer = (sx: number, sy: number): Int32Array => {
        const d = new Int32Array(width * height).fill(-1)
        const f: number[] = [sy * width + sx]
        d[sy * width + sx] = 0
        for (let t = 0; t < f.length; t++) {
          const k: number = f[t]!
          const kx = k % width
          const ky = (k - kx) / width
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = kx + dx
              const ny = ky + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              const v = ny * width + nx
              if (d[v]! >= 0 || bloque[v] === 1) continue
              d[v] = d[k]! + (dx !== 0 && dy !== 0 ? 14 : 10)
              f.push(v)
            }
          }
        }
        return d
      }
      const libreProche = (x: number, y: number): [number, number] | null => {
        for (let r = 0; r < 40; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              if (bloque[ny * width + nx] === 0) return [nx, ny]
            }
          }
        }
        return null
      }
      const cy = Math.floor((y0 + y1) / 2)
      const cx = Math.floor((x0 + x1) / 2)
      const bouts: [[number, number] | null, [number, number] | null][] = [[libreProche(x0, cy), libreProche(x1, cy)], [libreProche(cx, y0), libreProche(cx, y1)]]
      for (const [a, b] of bouts) {
        if (!a || !b) continue
        const d = cheminer(a[0], a[1])
        const cout = d[b[1] * width + b[0]]!
        expect(cout, `seed ${m.s} : traversée (${a}) → (${b}) impossible`).toBeGreaterThanOrEqual(0)
        const vx = b[0] - a[0]
        const vy = b[1] - a[1]
        const vol = Math.sqrt(vx * vx + vy * vy) * 10
        const detour = cout / vol
        // 1,6 : on marche au plus 60 % de plus qu'à vol d'oiseau. MESURÉ à 1,11-1,38 sur trois
        // graines — la garde laisse de la marge, elle épingle « vite fait », pas le réglage.
        expect(detour, `seed ${m.s} : détour ${detour.toFixed(2)}× en travers du chaos`).toBeLessThan(1.6)
      }

      // ③ LA RÉCOLTE RESTE SUR LES JOINTS — les poches sont permises (« ces blocs sont
      //    cassables »), mais un nœud sur trois emmuré voudrait dire que le masque stérile est
      //    tombé et que le semis commun repeuple les dalles. Une tolérance, pas un absolu.
      const comp = new Int32Array(width * height).fill(-1)
      let nc = 0, plusGrande = -1, taillePlusGrande = 0
      for (let d0 = 0; d0 < width * height; d0++) {
        if (comp[d0]! >= 0 || bloque[d0] === 1) continue
        const pile: number[] = [d0]
        comp[d0] = nc
        let taille = 0
        while (pile.length) {
          const k: number = pile.pop()!
          taille++
          const kx = k % width
          const ky = (k - kx) / width
          for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < width ? k + 1 : -1, ky > 0 ? k - width : -1, ky + 1 < height ? k + width : -1]) {
            if (v < 0 || comp[v]! >= 0 || bloque[v] === 1) continue
            comp[v] = nc
            pile.push(v)
          }
        }
        if (taille > taillePlusGrande) { taillePlusGrande = taille; plusGrande = nc }
        nc++
      }
      // ⚠ « récoltable » se dit par TYPE, pas par boîte : le rocher est PLEINE TUILE lui aussi
      // (`blockHalfSub: 4`, comme le bloc) — un critère par boîte viderait la population testée.
      const recolte = m.nodes.filter((n) => terrain[n.ty * width + n.tx] === TERRAIN_BOULDERS && n.type !== 'bloc')
      // Re-épinglée 50 → 12 le 2026-08-30 : troisième prémisse de la même famille, même cause
      // (le lapiaz suit un relief redessiné par l'érosion). MESURÉ sur la graine 7, la pauvre en
      // chaos : 16 nœuds récoltables sur ses 1 146 tuiles de blocs. Douze suffisent à ce que la
      // clause ③ — « ce qui se récolte dans le chaos s'atteint sans casser un bloc » — porte.
      expect(recolte.length, `seed ${m.s} : rien à récolter dans le chaos — ③ ne prouve rien`).toBeGreaterThan(12)
      const emmures = recolte.filter((n) => {
        const i = n.ty * width + n.tx
        if (comp[i] === plusGrande) return false
        const kx = n.tx, ky = n.ty
        for (const v of [kx > 0 ? i - 1 : -1, kx + 1 < width ? i + 1 : -1, ky > 0 ? i - width : -1, ky + 1 < height ? i + width : -1]) {
          if (v >= 0 && comp[v] === plusGrande) return false
        }
        return true
      })
      expect(emmures.length / recolte.length, `seed ${m.s} : ${emmures.length}/${recolte.length} nœuds derrière un mur de blocs`).toBeLessThan(0.05)
    }
  }, 30_000)

  it('R6sexies — la MINE a la forme des autres biomes, et son minerai s\'atteint sans creuser', () => {
    // *« tu vas appliquer le même traitement sur les frontières et la structure sur les mines de
    // charbon et de fer »* (Alexis, 2026-08-27). Trois affirmations, une par moitié de la demande
    // plus celle qui les relie :
    //   ① LA FRONTIÈRE N'EST PLUS AU CARRÉ — la butte empilait 2 à 5 motifs de 8×8, donc
    //      **100 % de ses segments de bord faisaient ≥ 8 tuiles** (3/3, 5/5, 6/6 mesurés) ;
    //   ② ELLE MURE — c'est un dédale, à la densité du chaos du lapiaz, pas dix plots épars ;
    //   ③ ET LE MINERAI S'Y ATTEINT SANS CASSER UN BLOC. C'est la clause qui compte : un bloc
    //      emmuré dans un champ de caillasse est un caillou, un FILON emmuré est la mine entière
    //      qui ment. D'où 100 %, là où R6ter tolère 5 % pour la pierre du chaos.
    for (const m of mondes) {
      const { width, height, terrain } = m.c.map
      const bloque = new Uint8Array(width * height)
      for (let i = 0; i < width * height; i++) if (TERRAINS[terrain[i]!]?.walkable !== true) bloque[i] = 1
      for (const n of m.nodes) if (n.type === 'bloc') bloque[n.ty * width + n.tx] = 1

      for (const a of m.c.affleurements) {
        const r = a.rect
        const dedans = (x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
        const tuiles: number[] = []
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) if (terrain[y * width + x] === TERRAIN_SCREE) tuiles.push(y * width + x)
        }
        expect(tuiles.length, `seed ${m.s} : butte @${r.x},${r.y} vide`).toBeGreaterThan(100)

        // ① Les segments de bord, comptés sur les DEUX orientations : une ligne de niveau en a
        //    de longues par accident, un empilement de motifs n'a QUE ça.
        let longs = 0
        let total = 0
        const compter = (horizontal: boolean): void => {
          const [na, nb] = horizontal ? [r.h + 2, r.w + 2] : [r.w + 2, r.h + 2]
          for (let a0 = 0; a0 < na; a0++) {
            let suite = 0
            for (let b0 = 0; b0 < nb; b0++) {
              const x = horizontal ? r.x - 1 + b0 : r.x - 1 + a0
              const y = horizontal ? r.y - 1 + a0 : r.y - 1 + b0
              const j = horizontal ? (y + 1) * width + x : y * width + x + 1
              const ok = x >= 0 && y >= 0 && x + 1 < width && y + 1 < height
              const arete = ok && (terrain[y * width + x] === TERRAIN_SCREE) !== (terrain[j] === TERRAIN_SCREE)
              if (arete) { suite++; continue }
              if (suite >= 8) longs++
              if (suite > 0) total++
              suite = 0
            }
            if (suite >= 8) longs++
            if (suite > 0) total++
          }
        }
        compter(true)
        compter(false)
        expect(total, `seed ${m.s} : bord introuvable @${r.x},${r.y}`).toBeGreaterThan(10)
        expect(longs / total, `seed ${m.s} : butte @${r.x},${r.y} — ${longs}/${total} segments de bord droits ≥ 8`).toBeLessThan(0.3)

        // ①bis ET ELLE RESTE COMPACTE. La croissance « toujours la plus haute » suit la crête :
        //      sans `AFFL_COMPACITE`, la butte s'étirait en ruban — VU en jeu, puis mesuré à
        //      **18 % de remplissage de sa boîte** (320 tuiles dans 28×62), un filet noyé entre
        //      les arbres là où la spec demande « un genou de roche qu'on remarque dans le pré ».
        //      Mesuré après : 31 % au pire, 57 % en moyenne.
        const remplissage = tuiles.length / (r.w * r.h)
        expect(remplissage, `seed ${m.s} : butte @${r.x},${r.y} ${r.w}×${r.h} — ${(100 * remplissage).toFixed(0)} % de sa boîte, elle s'étire en ruban`).toBeGreaterThan(0.25)

        // ② Elle MURE.
        const mure = tuiles.filter((i) => bloque[i] === 1).length / tuiles.length
        expect(mure, `seed ${m.s} : part murée de la butte @${r.x},${r.y}`).toBeGreaterThan(0.12)

        // ③ Le minerai s'atteint depuis le DEHORS, 8-connexe, sans casser un bloc. Le flood part
        //    de ce qui borde la butte et reste dans une couronne de 2 tuiles autour d'elle — un
        //    chemin qui devrait faire le tour du pays ne compterait pas comme « accessible ».
        const vu = new Uint8Array(width * height)
        const file: number[] = []
        const x0 = Math.max(0, r.x - 2)
        const y0 = Math.max(0, r.y - 2)
        const x1 = Math.min(width, r.x + r.w + 2)
        const y1 = Math.min(height, r.y + r.h + 2)
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * width + x
            if (dedans(x, y) || bloque[i] === 1) continue
            vu[i] = 1
            file.push(i)
          }
        }
        for (let t = 0; t < file.length; t++) {
          const k = file[t]!
          const kx = k % width
          const ky = (k - kx) / width
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = kx + dx
              const y = ky + dy
              if (x < x0 || y < y0 || x >= x1 || y >= y1) continue
              const v = y * width + x
              if (vu[v] === 1 || bloque[v] === 1) continue
              vu[v] = 1
              file.push(v)
            }
          }
        }
        const minerais = m.nodes.filter((n) => (n.type === 'iron_vein' || n.type === 'coal_seam') && dedans(n.tx, n.ty))
        expect(minerais.length, `seed ${m.s} : butte @${r.x},${r.y} sans minerai`).toBeGreaterThanOrEqual(1)
        for (const n of minerais) {
          let atteint = false
          for (let dy = -1; dy <= 1 && !atteint; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = n.tx + dx
              const y = n.ty + dy
              if (x < 0 || y < 0 || x >= width || y >= height) continue
              if (vu[y * width + x] === 1) { atteint = true; break }
            }
          }
          expect(atteint, `seed ${m.s} : ${n.type}@${n.tx},${n.ty} EMMURÉ — il faut casser un bloc pour l'atteindre`).toBe(true)
        }
      }
    }
  }, 30_000)

  it('R6septies — la pierre de la butte se range par HAUTEUR, de l\'échine vers le bord', () => {
    // *« une colonne vertébrale pour la butte avec les pierres les plus hautes, un dégradé de 2 ou
    // 3 tuiles vers les pierres basses, puis le minerai / petite pierre autour »* (Alexis,
    // 2026-08-27). Ce qui se garde, c'est l'ORDRE — pas des comptes, qui sont un réglage :
    //   ① chaque bloc de butte PORTE sa taille (`size`), et son stock la suit ;
    //   ② les trois tailles existent, et la HAUTE est la plus rare (c'est une échine, pas un
    //      plateau) ;
    //   ③ la pierre est d'autant plus haute qu'elle est LOIN DU BORD — profondeur moyenne des
    //      hautes et des moyennes > celle des basses. C'est ce qui distingue ce rangement d'un
    //      tirage : un hash de tuile rendrait les trois profondeurs égales.
    //
    // ⚠ **③ NE COMPARE PAS LES HAUTES AUX MOYENNES, ET C'EST MESURÉ, PAS PRUDENT.** L'échine est
    // le SQUELETTE de la butte (maxima locaux de la distance au bord), pas son cœur : le
    // squelette d'un appendice étroit court au milieu de cet appendice, donc à faible profondeur.
    // Sur 10 buttes, l'écart hautes/moyennes s'inverse une fois — **2,75 contre 2,84**, sur une
    // butte qui n'a que huit blocs hauts. L'affirmer ferait rougir un monde parfaitement rangé.
    // Hautes et moyennes contre BASSES tient partout, et largement (2,75 · 2,84 contre 1,80).
    for (const m of mondes) {
      const { width, height, terrain } = m.c.map
      const estRocaille = (i: number): boolean => i >= 0 && i < width * height && terrain[i] === TERRAIN_SCREE
      for (const a of m.c.affleurements) {
        const r = a.rect
        const blocs = m.nodes.filter((n) => n.type === 'bloc'
          && n.tx >= r.x && n.tx < r.x + r.w && n.ty >= r.y && n.ty < r.y + r.h)
        expect(blocs.length, `seed ${m.s} : butte @${r.x},${r.y} sans blocs`).toBeGreaterThan(20)

        // ① la taille voyage, et le stock la suit
        for (const b of blocs) {
          expect(b.size, `seed ${m.s} : bloc de butte @${b.tx},${b.ty} sans taille portée`).toBeDefined()
          expect(b.stock, `seed ${m.s} : stock ≠ taille @${b.tx},${b.ty}`).toBe(BLOC_STOCKS[b.size!])
        }

        // La profondeur dans le pierrier, recalculée ici — c'est l'ÉTALON indépendant : la garde
        // ne relit pas `dEchine`, elle vérifie que le rangement se voit dans la géométrie.
        const prof = new Map<number, number>()
        const file: number[] = []
        for (let ty = r.y; ty < r.y + r.h; ty++) {
          for (let tx = r.x; tx < r.x + r.w; tx++) {
            const i = ty * width + tx
            if (!estRocaille(i)) continue
            if (!estRocaille(i - 1) || !estRocaille(i + 1) || !estRocaille(i - width) || !estRocaille(i + width)) {
              prof.set(i, 1)
              file.push(i)
            }
          }
        }
        for (let t = 0; t < file.length; t++) {
          const k = file[t]!
          const p = prof.get(k)! + 1
          const kx = k % width
          for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < width ? k + 1 : -1, k - width, k + width]) {
            if (v < 0 || !estRocaille(v) || prof.has(v)) continue
            prof.set(v, p)
            file.push(v)
          }
        }

        // ② LES TROIS TAILLES EXISTENT, ET LA HAUTE FAIT UNE LIGNE — pas une tache.
        const par = [0, 1, 2].map((s) => blocs.filter((b) => b.size === s))
        for (const s of [0, 1, 2]) {
          expect(par[s]!.length, `seed ${m.s} : butte @${r.x},${r.y} sans pierre de taille ${s}`).toBeGreaterThan(0)
        }
        // ⚠ **CE N'EST PLUS « LA HAUTE EST LA PLUS RARE »**, et le changement est voulu : depuis
        // que l'échine porte sa pierre sans condition, elle est DENSE (93-97 % de ses tuiles)
        // quand le flanc reste troué par les galeries — la part des hautes monte donc à 20-50 %
        // des blocs. Ce qui fait d'elle une vertèbre n'est pas sa rareté, c'est sa MINCEUR et sa
        // CONTINUITÉ, et ce sont ces deux-là qu'on garde.
        const tuiles = [...prof.keys()]
        // 0,35 : mesuré **12 à 28 %** sur 15 buttes de trois graines — dont une à 28 sur une
        // graine que ce test ne joue PAS. Un seuil à 25 aurait été vert ici et rouge chez le
        // joueur ; ce qu'on veut exclure, c'est le plateau, et un plateau passe la moitié.
        expect(par[2]!.length / tuiles.length, `seed ${m.s} : butte @${r.x},${r.y} — l'échine couvre ${(100 * par[2]!.length / tuiles.length).toFixed(0)} % du pierrier, ce n'est plus une ligne`)
          .toBeLessThan(0.35)
        // LA CONTINUITÉ — la plus longue chaîne 8-connexe de pierres hautes. **Cette garde aurait
        // rougi avant l'échine sans condition** : mesuré alors, 1 à 8 (36 tuiles de crête d'un
        // seul tenant ne rendaient qu'UN bloc haut) ; mesuré après, **12 à 32**.
        const hautes = new Set(par[2]!.map((b) => b.ty * width + b.tx))
        const vuH = new Set<number>()
        let plusLongue = 0
        for (const i of hautes) {
          if (vuH.has(i)) continue
          const pile = [i]
          vuH.add(i)
          let n = 0
          while (pile.length) {
            const k: number = pile.pop()!
            n++
            const kx = k % width
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue
                const v = k + dy * width + dx
                if (Math.abs((v % width) - kx) > 1) continue
                if (hautes.has(v) && !vuH.has(v)) { vuH.add(v); pile.push(v) }
              }
            }
          }
          if (n > plusLongue) plusLongue = n
        }
        expect(plusLongue, `seed ${m.s} : butte @${r.x},${r.y} — la plus longue arête de pierres hautes fait ${plusLongue} tuiles : c'est du gravier, pas une colonne vertébrale`)
          .toBeGreaterThanOrEqual(10)

        // ③ l'ORDRE : plus la pierre est haute, plus elle est au cœur
        const moyenne = (l: typeof blocs): number =>
          l.reduce((s, b) => s + (prof.get(b.ty * width + b.tx) ?? 0), 0) / l.length
        const [pBas, pMoy, pHaut] = [moyenne(par[0]!), moyenne(par[1]!), moyenne(par[2]!)]
        expect(pHaut, `seed ${m.s} : butte @${r.x},${r.y} — hautes à ${pHaut.toFixed(1)} de profondeur, basses à ${pBas.toFixed(1)}`).toBeGreaterThan(pBas)
        expect(pMoy, `seed ${m.s} : butte @${r.x},${r.y} — moyennes à ${pMoy.toFixed(1)}, basses à ${pBas.toFixed(1)}`).toBeGreaterThan(pBas)
      }
    }
  }, 30_000)

  it('la tuile du SOMMET reste nue de tout nœud — le chicot du client s\'y dresse', () => {
    // Deux codes, une règle (« la tuile de pierrier la plus proche du centre ») : le sim la
    // réserve, le client y plante le chicot — cette garde répète la règle pour épingler les deux.
    for (const m of mondes) {
      const { width, height, terrain } = m.c.map
      for (const a of m.c.affleurements) {
        const cx = a.rect.x + a.rect.w / 2
        const cy = a.rect.y + a.rect.h / 2
        let sommet = -1
        let bestD = Infinity
        for (let ty = a.rect.y; ty < a.rect.y + a.rect.h; ty++) {
          for (let tx = a.rect.x; tx < a.rect.x + a.rect.w; tx++) {
            if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
            if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
            const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
            if (d < bestD) { bestD = d; sommet = ty * width + tx }
          }
        }
        expect(sommet, `seed ${m.s} : butte sans rocaille ?`).toBeGreaterThanOrEqual(0)
        const stx = sommet % width
        const sty = (sommet - stx) / width
        expect(
          m.nodes.some((n) => n.tx === stx && n.ty === sty),
          `seed ${m.s} : un nœud squatte le sommet @${stx},${sty}`,
        ).toBe(false)
      }
    }
  })

  // (« et les buttes elles-mêmes sont hors d'atteinte du front (R47) » : retiré le 2026-08-24 —
  //  il n'y a plus de front à mettre hors d'atteinte.)
})

describe('A30 — une identité par butte, des buttes écartées, et personne n\'y fonde', () => {
  it('les buttes s\'écartent entre elles — deux gisements dans un écran seraient un seul qui ment', () => {
    for (const m of mondes) {
      const affs = m.c.affleurements
      for (let i = 0; i < affs.length; i++) {
        for (let j = i + 1; j < affs.length; j++) {
          const a = affs[i]!.rect
          const b = affs[j]!.rect
          const d = distAuRect(a.x + a.w / 2, a.y + a.h / 2, b)
          expect(d, `seed ${m.s} : buttes ${i} et ${j} trop proches`).toBeGreaterThanOrEqual(150)
        }
      }
    }
  })

  it('aucun emplacement de village sur une butte (R52) — la distance fait le prix', () => {
    for (const m of mondes) {
      const grounds = placeHuntingGrounds(m.c.map, m.s)
      const emplacements = emplacementsDeVillage(m.c, m.nodes, { coinsDeChasse: grounds, nids: nidsAMonstre(m.c.map) })
      for (const e of emplacements) {
        for (const a of m.c.affleurements) {
          const d = distAuRect(e.tx, e.ty, a.rect)
          expect(d, `seed ${m.s} : village @${e.tx},${e.ty} sur la butte @${a.rect.x},${a.rect.y}`)
            .toBeGreaterThanOrEqual(CONTENU.DEGAGEMENT)
        }
      }
    }
  })
})

describe('la donnée de premier ordre — WorldMap.affleurements (patron « seuils → bornes »)', () => {
  it('la carte porte EXACTEMENT le registre de génération — le client ne devinera rien', () => {
    for (const m of mondes) {
      expect(m.c.map.affleurements).toEqual(
        m.c.affleurements.map((a) => ({ ...a.rect, ressource: a.ressource })),
      )
    }
  })

  /**
   * ⚠ **LA PRÉMISSE DU CLIENT, AFFIRMÉE ICI PARCE QU'ELLE EST UNE PROPRIÉTÉ DU GÉNÉRATEUR.**
   *
   * Le rect registré n'est qu'une BOÎTE ENGLOBANTE — la butte n'en occupe que 42 à 56 %. Le
   * client (`render/buttes.ts`) retrouve donc sa forme en PROPAGEANT sur le pierrier depuis le
   * sommet, borné au rect, et cela n'est exact que si deux choses tiennent : la butte est
   * CONNEXE (la croissance part du sommet et ne franchit que des voisines), et aucun pierrier
   * ÉTRANGER ne la touche dans sa boîte. La seconde est vraie aujourd'hui parce que les buttes
   * naissent dans le pré ; le jour où l'une d'elles naîtra dans un Karst, la propagation
   * déborderait EN SILENCE — la teinte de rouille gagnerait la caillasse voisine. C'est ce test
   * qui rougira, et il dit pourquoi.
   */
  it('la butte est une composante CONNEXE de pierrier, seule dans sa boîte — ce que le client propage', () => {
    for (const m of mondes) {
      const { width, terrain } = m.c.map
      for (const a of m.c.affleurements) {
        const r = a.rect
        // Le départ du client : la tuile de pierrier la plus proche du centre du rect.
        const cx = r.x + r.w / 2
        const cy = r.y + r.h / 2
        let depart = -1
        let best = Infinity
        let pierrier = 0
        for (let ty = r.y; ty < r.y + r.h; ty++) {
          for (let tx = r.x; tx < r.x + r.w; tx++) {
            if (terrain[ty * width + tx] !== TERRAIN_SCREE) continue
            pierrier++
            const d = (tx + 0.5 - cx) * (tx + 0.5 - cx) + (ty + 0.5 - cy) * (ty + 0.5 - cy)
            if (d < best) { best = d; depart = ty * width + tx }
          }
        }
        expect(depart, `seed ${m.s} : une boîte sans un pixel de rocaille`).toBeGreaterThanOrEqual(0)
        const vus = new Set<number>([depart])
        const file = [depart]
        for (let q = 0; q < file.length; q++) {
          const i = file[q]!
          const ix = i % width
          const iy = (i - ix) / width
          for (const v of [ix > r.x ? i - 1 : -1, ix + 1 < r.x + r.w ? i + 1 : -1,
            iy > r.y ? i - width : -1, iy + 1 < r.y + r.h ? i + width : -1]) {
            if (v < 0 || vus.has(v) || terrain[v] !== TERRAIN_SCREE) continue
            vus.add(v)
            file.push(v)
          }
        }
        // ① CONNEXE ET ENTIÈRE : la propagation retrouve toute la butte, ni plus ni moins.
        expect(vus.size, `seed ${m.s} : butte ${r.w}×${r.h}`).toBe(CREUX.AFFL_TUILES)
        // ② SEULE DANS SA BOÎTE : pas un pierrier étranger dans le rect (sinon ① aurait déjà
        //    dépassé s'il TOUCHAIT la butte — celle-ci attrape aussi celui qui ne la touche pas,
        //    et qui prendrait la teinte de rouille du bake).
        expect(pierrier, `seed ${m.s} : pierrier étranger dans la boîte`).toBe(CREUX.AFFL_TUILES)
      }
    }
  })
})

describe('A31 — le monde complet est INTACT : le périmètre est le monde réduit, exactement', () => {
  it('zéro affleurement, zéro nœud neuf dans la racine du plan complet', () => {
    const c = carteDeTest(2026)
    expect(c.affleurements).toEqual([])
    expect(c.map.affleurements, 'la vallée complète ne porte pas la donnée — additive, jamais vide').toBeUndefined()
    const nodes = placeZoneNodes(c)
    const racine = c.graphe.racine
    const enRacine = (n: ResourceNode): boolean => c.zone[n.ty * c.map.width + n.tx] === racine
    // Le teaser du Filon (stock dérisoire) est la SEULE exception déclarée — comme avant.
    expect(nodes.filter((n) => n.type === 'iron_vein' && enRacine(n) && n.stock !== CONTENU.TEASER_STOCK).length).toBe(0)
    expect(nodes.filter((n) => n.type === 'coal_seam' && enRacine(n)).length).toBe(0)
    expect(nodes.filter((n) => n.type === 'quarry' && enRacine(n)).length).toBe(0)
    expect(nodes.filter((n) => n.type === 'bloc').length, 'le bloc n\'existe QUE sur une butte').toBe(0)
    expect(nodes.filter((n) => n.type === 'old_tree' && enRacine(n) && n.stock !== CONTENU.TEASER_STOCK).length).toBe(0)
  }, 60_000)
})
