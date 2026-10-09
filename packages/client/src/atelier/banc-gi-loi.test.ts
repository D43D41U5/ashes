import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LUMIERE } from '@ashes/sim'
import { champRef, facesDuChamp, masqueDAstre, ombrePleineDAstre, type Astre } from '../render/gi/champ-ref'
import { grilleDuMonde } from '../render/gi/grille'
import { GI, longueurDOmbre, LONGUEUR_PAR_HAUTEUR_MAX, profilFeu } from '../render/gi/reglages'
import { TILE_PX } from '../render/framing'
import {
  ASTRE_DU_BANC, GATES_MS, MN_DU_BANC, RECONSTRUCTIONS_PAR_SECONDE, SCENE, budgetDuBanc, cartesDuBanc, classeDuGpu, ecartDe,
  fenetreDuBanc, gateDe, mediane, mondeDuBanc, sourcesDuBanc, tient,
} from './banc-gi-loi'

/**
 * LE BANC GI — SES PRÉMISSES, PROUVÉES PAR L'ORACLE AVANT TOUT GPU (mémoire du projet : « une garde
 * prouve sa prémisse »). Le banc de l'Atelier (`banc-gi.ts`) relit chaque passe contre l'oracle sur la
 * scène fixe de `banc-gi-loi.ts` ; si cette scène n'avait pas de face de bande, pas de rebond ou pas
 * d'ombre d'astre tombant sur de la lumière, une garde verte n'aurait rien éprouvé. On le tient ICI,
 * sans navigateur, sur la même fenêtre que le GPU allouera.
 */
const T = LUMIERE.TEXELS_PAR_TUILE
const PX_PAR_TEXEL = TILE_PX / T

function astreDuBanc(): Astre {
  return {
    derive: ASTRE_DU_BANC.derive,
    longueur: longueurDOmbre(GI.ASTRE.HAUTEUR_MUR_PX, PX_PAR_TEXEL),
    cisaillement: GI.ASTRE.CISAILLEMENT,
    penombre: GI.ASTRE.PENOMBRE,
    longueurParHauteur: GI.ASTRE.LONGUEUR_PAR_HAUTEUR,
  }
}

function champDuBanc() {
  const f = fenetreDuBanc()
  const g = grilleDuMonde(mondeDuBanc(), 0, f)
  const emetteurs = sourcesDuBanc().map((s) => ({
    x: s.worldX / PX_PAR_TEXEL - g.ox,
    y: s.worldY / PX_PAR_TEXEL - g.oy,
    rayon: (s.radiusTiles * TILE_PX) / PX_PAR_TEXEL,
    taille: GI.TAILLE_SOURCE,
    rgb: [GI.TEINTE_FEU[0] * s.force, GI.TEINTE_FEU[1] * s.force, GI.TEINTE_FEU[2] * s.force] as const,
  }))
  const o = champRef(g, emetteurs, { rebond: GI.REBOND, porteeRebond: GI.PORTEE_REBOND, plafondRebond: GI.PLAFOND_REBOND, profil: profilFeu })
  return { f, g, o, emetteurs }
}

describe('la scène fixe du banc GI — ses prémisses (LG-A1)', () => {
  it('la fenêtre du champ tient dans la carte, aux paliers de la chaîne', () => {
    const f = fenetreDuBanc()
    expect(f.x0).toBeGreaterThanOrEqual(0)
    expect(f.y0).toBeGreaterThanOrEqual(0)
    expect(f.x1).toBeLessThan(SCENE.MAP_W)
    expect(f.y1).toBeLessThan(SCENE.MAP_H)
    expect(f.gw % GI.PALIER_TEXELS).toBe(0)
    expect(f.gh % GI.PALIER_TEXELS).toBe(0)
  })

  it('toutes les sortes d’occludeur y sont : bandes, cellules de bâti, terrain plein, nœud plein, fûts', () => {
    const { f, g } = champDuBanc()
    const k = (tx: number, ty: number, sx = 0, sy = 0) => ((ty - f.y0) * T + sy) * g.gw + (tx - f.x0) * T + sx
    // Le coin : six bandes ouest, sept bandes nord (l'angle porte les deux).
    expect(g.murs.length).toBe(SCENE.COIN.ouest + SCENE.COIN.nord)
    expect(g.occ[k(SCENE.COIN.tx, SCENE.COIN.ty + 2, 1, 1)]).toBe(0) // la tuile d'un mur d'arête reste du sol
    expect(g.occ[k(SCENE.PLEIN.tx, SCENE.PLEIN.ty, 3, 3)]).toBe(1)
    expect(g.occ[k(SCENE.ROCHE.tx + 1, SCENE.ROCHE.ty + 1, 0, 0)]).toBe(1)
    expect(g.occ[k(SCENE.PIERRE.tx, SCENE.PIERRE.ty, 2, 2)]).toBe(1)
    for (const a of SCENE.ARBRES) {
      expect(g.occ[k(a.tx, a.ty, 1, 1)]).toBe(1) // le fût
      expect(g.occ[k(a.tx, a.ty, 0, 0)]).toBe(0) // la cime n'occulte pas le sol
    }
  })

  it('les deux feux éclairent, il y a des faces des DEUX sortes, et du rebond', () => {
    const { g, o } = champDuBanc()
    const n = g.gw * g.gh
    let eclaires = 0
    let rebond = 0
    for (let k = 0; k < n; k++) {
      if (g.occ[k] === 1) continue
      if (o.direct[k * 3]! > 0) eclaires++
      if (o.rebond[k * 3]! > 0) rebond++
    }
    expect(eclaires).toBeGreaterThan(1000)
    expect(rebond).toBeGreaterThan(100)
    const faces = facesDuChamp(g, o.direct)
    const cellules = faces.filter((f) => g.occ[Math.floor(f.y) * g.gw + Math.floor(f.x)] === 1).length
    expect(cellules).toBeGreaterThan(0)
    expect(faces.length - cellules).toBeGreaterThan(0)
    // Chaque face regarde un texel VOISIN, libre : c'est ce qui la pose dans une case du raster 2×.
    for (const f of faces) {
      expect(Math.abs(f.vx - f.x) + Math.abs(f.vy - f.y)).toBe(1)
      expect(g.occ[Math.floor(f.vy) * g.gw + Math.floor(f.vx)]).toBe(0)
    }
  })

  it('l’ombre d’astre a de la pénombre, et tombe SUR la lumière (la prémisse de la composition)', () => {
    const { g, o } = champDuBanc()
    const astre = astreDuBanc()
    const cartes = cartesDuBanc().map((c) => ({
      silhouette: { w: SCENE.FUT_W, h: SCENE.FUT_H, opaque: new Uint8Array(SCENE.FUT_W * SCENE.FUT_H).fill(1) },
      x: c.x / PX_PAR_TEXEL - g.ox, y: c.y / PX_PAR_TEXEL - g.oy,
      originX: c.originX, originY: c.originY, rotation: c.rotation, scaleX: c.scaleX, scaleY: c.scaleY, flipX: c.flipX, flipY: c.flipY,
      piedX: c.piedX / PX_PAR_TEXEL - g.ox, piedY: c.piedY / PX_PAR_TEXEL - g.oy,
    }))
    // ⚠ Les cartes se donnent en PX DE GRILLE, l'oracle divise par `pxParTexel` lui-même.
    const enPx = cartes.map((c) => ({ ...c, x: c.x * PX_PAR_TEXEL, y: c.y * PX_PAR_TEXEL, piedX: c.piedX * PX_PAR_TEXEL, piedY: c.piedY * PX_PAR_TEXEL }))
    const pleine = ombrePleineDAstre(g, astre, { cartes: enPx, pxParTexel: PX_PAR_TEXEL })
    const masque = masqueDAstre(g, astre, { cartes: enPx, pxParTexel: PX_PAR_TEXEL })
    let ombres = 0
    let penombre = 0
    let croises = 0
    for (let k = 0; k < g.gw * g.gh; k++) {
      if (g.occ[k] === 1) continue
      if (pleine[k] === 1) ombres++
      if (masque[k]! > 0 && masque[k]! < 1) penombre++
      if (masque[k]! > 0 && o.light[k * 3]! > 0) croises++
    }
    expect(ombres).toBeGreaterThan(50)
    expect(penombre).toBeGreaterThan(20)
    expect(croises).toBeGreaterThan(50)
  })

  it('l’astre du banc porte la force de l’ombre du jeu, et le Mn est un plancher de nuit', () => {
    // `SHADOW_ALPHA` vit dans `contact-shadow.ts`, qui tire Phaser (pas de `window` ici) : on lit la
    // déclaration dans la source, la seule ligne `export const SHADOW_ALPHA = …`.
    const source = readFileSync(new URL('../scenes/world/contact-shadow.ts', import.meta.url), 'utf8')
    const m = /export const SHADOW_ALPHA = ([0-9.]+)/.exec(source)
    expect(m).not.toBeNull()
    expect(ASTRE_DU_BANC.a).toBeCloseTo(Number(m![1]) * 0.8, 6)
    expect(ASTRE_DU_BANC.derive).toBeGreaterThan(0)
    expect(ASTRE_DU_BANC.derive).toBeLessThanOrEqual(1)
    for (const c of MN_DU_BANC) {
      expect(c).toBeGreaterThan(0)
      expect(c).toBeLessThan(1)
    }
  })
})

describe('la comparaison d’une cible relue (LG-A2, les seuils de la spec)', () => {
  it('arrondit l’attendu comme l’octet, et compte la prémisse', () => {
    const ref = [0, 0.5, 1, 0.2]
    const lu = [0, 128, 255, 51]
    const e = ecartDe(4, 1, (k) => lu[k]!, (k) => ref[k]!)
    expect(e).toEqual({ n: 4, moyenne: 0, partSup3: 0, max: 0, nonNuls: 3 })
    expect(tient(e)).toBe(true)
  })
  it('rompt au-delà des seuils, et sur une scène sans rien à comparer', () => {
    expect(tient(ecartDe(10, 1, () => 10, () => 0))).toBe(false) // 10 niveaux partout
    expect(tient(ecartDe(10, 1, () => 0, () => 0))).toBe(false) // rien de non nul : pas de prémisse
    const e = ecartDe(1000, 1, (k) => (k < 5 ? 10 : 100), () => 100 / 255)
    expect(e.partSup3).toBeCloseTo(0.005, 6)
    expect(tient(e)).toBe(true)
    const e2 = ecartDe(1000, 1, (k) => (k < 20 ? 10 : 100), () => 100 / 255)
    expect(tient(e2)).toBe(false)
  })
})

describe('la classe d’un GPU et sa gate (LG-A14)', () => {
  it('lit la classe dans le nom, et ne connaît de gate que pour l’intégré et le dédié', () => {
    expect(classeDuGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('logiciel')
    expect(classeDuGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('dedie')
    expect(classeDuGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integre')
    expect(classeDuGpu('ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integre')
    expect(classeDuGpu('ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('dedie')
    expect(classeDuGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('integre')
    expect(classeDuGpu('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')).toBe('integre')
    expect(classeDuGpu('WebKit WebGL')).toBe('inconnue')
    expect(gateDe('integre')).toBe(GATES_MS.integre)
    expect(gateDe('dedie')).toBe(GATES_MS.dedie)
    expect(gateDe('logiciel')).toBeNull()
    expect(gateDe('inconnue')).toBeNull()
    // Les deux seuils d'Alexis (LG-Q7), tels quels.
    expect(GATES_MS).toEqual({ integre: 2, dedie: 4 })
  })
  it('la médiane de trois est le deuxième', () => {
    expect(mediane([3, 1, 2])).toBe(2)
    expect(mediane([5])).toBe(5)
    expect(mediane([])).toBe(0)
  })
})

/**
 * ═══ LE BUDGET PAR SECONDE — LA GARDE DE L'ERREUR DE LECTURE (2026-10-09, P2) ═══
 *
 * Elle existe parce qu'un chantier a été mal classé en lisant le tableau du banc : j'y avais vu
 * `occludeursMs` = 2,70 à côté de `msParImage` = 2,325 et conclu « les occludeurs sont le plus
 * gros poste ». Les deux ne sont pas dans la même unité. La garde gèle l'arithmétique qui les
 * réconcilie **et le verdict qu'elle rend sur les vrais chiffres d'Alexis**, pour qu'on ne
 * refasse pas le raisonnement de tête.
 */
/**
 * ⚠ **LE DÉPOUILLEUR DE COMMENTAIRES, ET C'EST LA FALSIFICATION QUI L'A EXIGÉ.** Mes gardes de
 * source lisaient la source BRUTE : commenter la ligne cherchée les laissait **vertes**, puisque le
 * texte survit dans le commentaire. Une garde de source qui lit à travers un commentaire ne garde
 * rien — classe de défaut déjà payée ici sur la garde de palette.
 */
const sansCommentaires = (src: string): string =>
  src.split('\n').map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, '')).join('\n')

/**
 * ⚠ **ET SA PRÉMISSE SE DÉRIVE, elle ne se devine pas.** Mon premier jet exigeait « la source
 * dépouillée fait moins de 80 % de la brute » : un ratio choisi, qui tombait PILE sur la frontière
 * (32 871 contre 32 870,4) et rougissait de lui-même. Ce qu'on veut vraiment savoir est plus
 * étroit et exact : le dépouilleur fait-il disparaître la forme COMMENTÉE de la ligne qu'on
 * cherche ? On le lui demande sur la ligne même, pas sur un pourcentage de fichier.
 */
const leDepouilleurMord = (ligne: string): void => {
  expect(sansCommentaires(`  ${ligne}`)).toContain(ligne)
  expect(sansCommentaires(`  // ${ligne}`)).not.toContain(ligne)
}

describe('le budget par seconde réconcilie « par image » et « par reconstruction »', () => {
  it('① L’ARITHMÉTIQUE, GELÉE — et ce n’est pas une tautologie : les deux termes sont posés à la main', () => {
    const b = budgetDuBanc(2, 1, 1)
    // 2 ms × 60 images = 120 ms/s ; (1 + 1) ms × 0,9 reconstruction = 1,8 ms/s.
    expect(b.budgetParSeconde).toBeCloseTo(121.8, 10)
    expect(b.partDesReconstructions).toBeCloseTo((1.8 / 121.8) * 100, 10)
    // LA FRÉQUENCE EST LE SEUL RÉGLAGE, et elle est MESURÉE (après P1, marche diagonale).
    expect(RECONSTRUCTIONS_PAR_SECONDE).toBe(0.9)
  })

  it('② LES CHIFFRES RÉELS D’UNE RTX 4070 — les occludeurs pèsent 1,8 % du budget, pas « le plus gros poste »', () => {
    // Relevé d'Alexis au banc #gi, 2026-10-09 : msParImage 2,325 · grille 0,9 · occludeurs 2,7.
    const b = budgetDuBanc(2.325, 0.9, 2.7)
    expect(b.budgetParSeconde).toBeCloseTo(2.325 * 60 + 3.6 * 0.9, 10)
    // ⚠ LE VERDICT, GELÉ : moins de 3 % du budget. C'est ce nombre-là qui dit que P2 ne vaut pas
    // un diff, et il est ici pour qu'on n'ait pas à refaire la division.
    expect(b.partDesReconstructions).toBeLessThan(3)
    expect(b.partDesReconstructions).toBeCloseTo(2.26, 1)
    // LE CONTRÔLE POSITIF — à la fréquence d'AVANT P1 (5,70/s en diagonale), la part est 6× plus
    // grande. Sans lui, « 2,3 % » pourrait venir d'une arithmétique qui rend toujours petit.
    const avantP1 = (3.6 * 5.7) / (2.325 * 60 + 3.6 * 5.7) * 100
    expect(avantP1 / b.partDesReconstructions).toBeGreaterThan(5)
  })

  it('③ LE TABLEAU DU BANC DIT L’UNITÉ, et il cite la constante au lieu de la recopier', () => {
    // Dépouillé des commentaires, comme ④ : un `toContain` satisfait par un commentaire ne prouve
    // rien, et un `not.toContain` mis en défaut par un commentaire rougirait pour rien.
    leDepouilleurMord('<th>Occludeurs / reconstruction</th>')
    const src = sansCommentaires(readFileSync(new URL('./banc-gi.ts', import.meta.url), 'utf8'))
    // Les deux colonnes portent leur unité dans leur intitulé — c'est l'intitulé que j'avais lu.
    expect(src).toContain('<th>Grille / reconstruction</th>')
    expect(src).toContain('<th>Occludeurs / reconstruction</th>')
    expect(src).toContain('<th>Budget par seconde</th>')
    // ⚠ ET LA PROSE INTERPOLE LA CONSTANTE : un 0,9 écrit à la main aurait dérivé en silence le
    // jour où la fréquence est re-mesurée. Le CSS et le HTML sont des chaînes qu'aucun `tsc` ne lit.
    expect(src).toContain('${RECONSTRUCTIONS_PAR_SECONDE} fois par seconde')
    expect(src).not.toContain('(0,9 fois par seconde')
  })

  it('⓪ LE LEVIER `?lonh=` EST INERTE PAR DÉFAUT — ET « INERTE » SE MESURE SUR LES DEUX BORNES, PAS SUR LA SOURCE', () => {
    /**
     * ⚠ **CETTE CLAUSE EXISTE PARCE QUE J'AI ÉCRIT « inchangé au bit » EN CINQ ENDROITS ALORS QUE
     * C'ÉTAIT FAUX** (2026-10-09). Le levier d'amplitude d'ombre (`?lonh=`) est bien gaté — mais les
     * **deux bornes de compilation** que j'ai dû relever pour qu'il ne tronque pas, elles, ne
     * l'étaient pas : `PAS_OMBRE_MAX` passait de **44 à 517** pas de boucle GLSL et la `MARGE` des
     * cartes de **270 à 1 093 px**, POUR TOUT LE MONDE, levier ou pas. Une boucle 12× trop grande et
     * quatre fois l'emprise à rastériser, payées par le chemin PAR DÉFAUT, pour zéro pixel — dans un
     * lot dont la prémisse est *« le rendu manque de performance »*.
     *
     * **ET AUCUNE DES 150 GARDES DE LONGUEUR D'OMBRE NE L'A VU**, parce qu'elles éprouvent toutes la
     * VALEUR du masque, qui est identique : une borne trop GRANDE ne tronque rien, elle coûte.
     * *Une borne de performance ne se prouve pas par la justesse du pixel qu'elle borne.*
     *
     * Les deux chiffres sont donc GELÉS ici, et la clause ③ dit POURQUOI ils sont ceux-là.
     */
    const gi = sansCommentaires(readFileSync(new URL('../render/gi/champ-gpu.ts', import.meta.url), 'utf8'))
    // ⓐ LA BORNE DE BOUCLE SE TAILLE SUR LE RATIO DE LA PAGE, PLANCHÉ PAR CELUI DE LG-R9 — donc 44
    //    au défaut. Écrite sur `LONGUEUR_PAR_HAUTEUR_MAX`, elle rendrait 517 sans que rien ne rougisse.
    expect(gi).toContain('Math.max(GI.ASTRE.LONGUEUR_PAR_HAUTEUR, RATIO_OMBRE)')
    expect(gi).not.toContain('PX_PAR_TEXEL, LONGUEUR_PAR_HAUTEUR_MAX)')
    const pasParDefaut =
      Math.ceil(
        2 *
          (1 + GI.ASTRE.CISAILLEMENT) *
          // le grain de `champ-gpu`, DÉRIVÉ de ses deux sources et non recopié — sinon un
          // `TEXELS_PAR_TUILE` changé laisserait ce 44 juste en apparence.
          longueurDOmbre(GI.ASTRE.HAUTEUR_MAX_LANCEUR_PX, TILE_PX / LUMIERE.TEXELS_PAR_TUILE, GI.ASTRE.LONGUEUR_PAR_HAUTEUR),
      ) + 2
    expect(pasParDefaut).toBe(44)
    // ⓑ LA MARGE DES CARTES EST PLANCHÉE À 1, et ce plancher EST l'ancienne valeur (270 px) : la
    //    formule d'avant omettait le facteur, ce qui revient au cas ratio = 1.
    expect(gi).toContain('Math.max(1, astre.longueurParHauteur)')
    expect(gi).not.toContain('HAUTEUR_MAX_LANCEUR_PX * LONGUEUR_PAR_HAUTEUR_MAX')
    // ⚠ **AFFIRMÉE PAR IDENTITÉ AVEC LA FORMULE D'AVANT, pas contre un littéral** : mon commentaire
    //   disait « 270 px », qui était l'arrondi — la vraie valeur est 269,714… (96 × 15/7 + 64). Un
    //   littéral arrondi aurait fait rougir une garde JUSTE, ce qu'il a d'ailleurs fait.
    const ancienneMarge = GI.ASTRE.HAUTEUR_MAX_LANCEUR_PX * (1 + GI.ASTRE.CISAILLEMENT) + 64
    const margeParDefaut = GI.ASTRE.HAUTEUR_MAX_LANCEUR_PX * Math.max(1, GI.ASTRE.LONGUEUR_PAR_HAUTEUR) * (1 + GI.ASTRE.CISAILLEMENT) + 64
    expect(margeParDefaut).toBe(ancienneMarge)
    // et le plafond, lui, la quadruplerait — le coût que le plancher évite au chemin par défaut.
    const margeAuPlafond = GI.ASTRE.HAUTEUR_MAX_LANCEUR_PX * LONGUEUR_PAR_HAUTEUR_MAX * (1 + GI.ASTRE.CISAILLEMENT) + 64
    expect(margeAuPlafond / margeParDefaut).toBeGreaterThan(4)
    // ⓒ LE PLAFOND RESTE, ET IL GARDE SON RÔLE : borner ce que le levier peut demander. Sans lui,
    //    `?lonh=50` tronquerait au lieu de refuser — c'est là qu'il sert, pas dans les bornes.
    expect(gi).toContain('Math.min(v, LONGUEUR_PAR_HAUTEUR_MAX)')
    // ⓓ ET LE LEVIER EST GATÉ SUR DEUX CLAUSES : hors navigateur ET hors DEV, il rend la constante.
    expect(gi).toContain("typeof window === 'undefined' || !import.meta.env.DEV")
    expect(gi).toContain('return GI.ASTRE.LONGUEUR_PAR_HAUTEUR')
    // LE CONTRÔLE POSITIF — sans lui, ⓐ et ⓑ seraient vertes sur un fichier qui ne lit plus le ratio
    // du tout : la fonction DOIT bien prendre un troisième argument, et la page DOIT le pousser.
    expect(gi).toContain('longueurParHauteur: RATIO_OMBRE')
    expect(longueurDOmbre(96, 4, 2.95)).toBeCloseTo(70.8, 6)
    expect(longueurDOmbre(96, 4)).toBeCloseTo(9.6, 6)
  })

  it('⑦ LA GATE NE VOIT PAS LES OCCLUDEURS — donc aucun gain sur eux ne peut la déplacer', () => {
    /**
     * ⚠ **CETTE CLAUSE EXISTE PARCE QU'UNE FICHE DE BACKLOG DISAIT LE CONTRAIRE** : « P2 + P3
     * rendraient peut-être 1 ms » sur la gate. **P2 ne peut pas la déplacer d'un microseconde.**
     * La gate se juge sur `msParImage`, que `chrono` mesure en boucle SANS toucher à l'empreinte ;
     * or `ChampGpu.update` ne rebâtit la grille et les occludeurs que `if (empreinte !== this.empreinte)`.
     * Fenêtre fixe, monde fixe ⇒ empreinte fixe ⇒ **la reconstruction n'est jamais dans la mesure**.
     * Seul le travail GPU des passes (P3) peut bouger la gate.
     */
    const gi = sansCommentaires(readFileSync(new URL('../render/gi/champ-gpu.ts', import.meta.url), 'utf8'))
    // ⓐ LA PORTE D'EMPREINTE EXISTE, et elle enferme les deux chronomètres de reconstruction.
    const porte = gi.indexOf('if (empreinte !== this.empreinte) {')
    expect(porte).toBeGreaterThan(0)
    expect(gi.indexOf('this.temps.grille = tO - tG')).toBeGreaterThan(porte)
    expect(gi.indexOf('this.temps.occludeurs = performance.now() - tO')).toBeGreaterThan(porte)
    // ⓑ ET LE CHRONOMÈTRE DE L'IMAGE NE L'OUVRE PAS : `invaliderLaGrille` n'apparaît QUE dans la
    // boucle des reconstructions, jamais dans `image()`. C'est ce qui rend ⓐ portant ici.
    const banc = sansCommentaires(readFileSync(new URL('./banc-gi.ts', import.meta.url), 'utf8'))
    const img = banc.slice(banc.indexOf('const image = (): void => {'), banc.indexOf('const vides: number[] = []'))
    expect(img).toContain('this.rendre()')
    expect(img).not.toContain('invaliderLaGrille')
    // LE CONTRÔLE POSITIF : l'appel existe bel et bien ailleurs dans `chrono` — sinon ⓑ serait
    // verte parce que le banc ne mesure JAMAIS la reconstruction, ce qui est l'inverse du propos.
    expect(banc.match(/gi\.invaliderLaGrille\(\)/g)).toHaveLength(1)
    expect(banc.indexOf('gi.invaliderLaGrille()')).toBeGreaterThan(banc.indexOf('const vides: number[] = []'))
  })

  it('⑤ LE COÛT PAR PASSE (P3) — le balayage est ASCENDANT, borné, et il dit ce qu’il ne mesure pas', () => {
    leDepouilleurMord('const marginalParPasse = cumulParPasse.map')
    const brut = readFileSync(new URL('./banc-gi.ts', import.meta.url), 'utf8')
    const src = sansCommentaires(brut)
    // LE BALAYAGE : de 1 à PASSES_GI, et la demande passe par un BORNEUR nommé — pas un littéral.
    expect(src).toContain('for (let n = 1; n <= PASSES_GI; n++)')
    expect(src).toContain('gi.update(PASSES_GI_BORNE(n),')
    expect(src).toContain('const marginalParPasse = cumulParPasse.map')
    // ⚠ LA DOCTRINE, SUR LA SOURCE BRUTE (elle vit dans un commentaire, que le dépouilleur efface) :
    // la licéité de la soustraction et sa limite doivent être écrites, aux deux endroits qui se
    // lisent seuls — la déclaration du champ et le rendu de la ligne.
    expect(brut).toContain('SÉQUENTIELLES')
    expect(brut.match(/jamais la justesse|ne dit rien de la JUSTESSE/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // Et le marginal est bien une DIFFÉRENCE, pas une copie du cumul : la clause qui l'énonce.
    expect(src).toContain('c - cumulParPasse[k - 1]!')
  })

  it('⑥ LE MARGINAL EST LA DIFFÉRENCE DU CUMUL — l’arithmétique, jouée hors de la scène', () => {
    // La scène n'est pas instanciable headless ; on rejoue la seule ligne qui compte, à l'identique.
    const cumul = [1, 1.5, 1.5, 2.2, 2.2, 2.2, 3]
    const marginal = cumul.map((c, k) => (k === 0 ? c : c - cumul[k - 1]!))
    // ⚠ Pas de `toEqual` sur un littéral : j'y avais écrit le résidu IEEE à la main
    // (`0.7000000000000002`) et la garde rougissait sur ma transcription, pas sur la loi. On
    // compare chaque terme à la valeur ÉCRITE À LA MAIN, à la tolérance près.
    const attendu = [1, 0.5, 0, 0.7, 0, 0, 0.8]
    expect(marginal).toHaveLength(attendu.length)
    marginal.forEach((v, k) => expect(v).toBeCloseTo(attendu[k]!, 12))
    // LA PROPRIÉTÉ QUI EN FAIT UNE DÉCOMPOSITION : la somme des marginaux EST le cumul final.
    expect(marginal.reduce((a, b) => a + b, 0)).toBeCloseTo(cumul[cumul.length - 1]!, 12)
    // LE CONTRÔLE POSITIF : un cumul NON monotone (du bruit de mesure) rend un marginal négatif —
    // c'est le signe à lire au banc, pas un défaut à masquer par un `max(0, …)`.
    const bruite = [1, 0.9]
    expect(bruite.map((c, k) => (k === 0 ? c : c - bruite[k - 1]!))[1]).toBeLessThan(0)
  })

  it('④ LE BALAYAGE D’HEURES EXISTE, et il RESTAURE `this.mn` — sinon le banc peindrait la nuit', () => {
    // PRÉMISSE, DÉRIVÉE : le dépouilleur doit vraiment faire disparaître la ligne commentée —
    // sans quoi la clause ci-dessous resterait verte sur un `// this.mn = mnAvant`, ce qui est
    // exactement ce que ma première version faisait.
    leDepouilleurMord('this.mn = mnAvant')
    const brut = readFileSync(new URL('./banc-gi.ts', import.meta.url), 'utf8')
    const src = sansCommentaires(brut)
    const i = src.indexOf('const mnAvant = this.mn')
    expect(i).toBeGreaterThan(0)
    expect(src.indexOf('this.mn = mnAvant')).toBeGreaterThan(i)
    // Les quatre moments, et `nuit` doit vraiment éteindre l'astre — sans quoi « midi » et « nuit »
    // seraient la même mesure et le rapport serait plat par construction.
    for (const nom of ["nom: 'midi'", "nom: 'après-midi'", "nom: 'couchant'", "nom: 'nuit'"]) expect(src).toContain(nom)
    expect(src).toContain("nom: 'nuit', mn: MN_DU_BANC, astre: { derive: 0, a: 0 }")
    // ⚠ LA CLAUSE QUI COMPTE, ET ELLE SE LIT SUR LA SOURCE **BRUTE** : le balayage ne doit pas
    // prétendre mesurer ce que P8 accuse, et cet aveu-là vit dans un COMMENTAIRE — donc le
    // dépouilleur l'efface. Ma première version le cherchait dans la source dépouillée, et c'était
    // une clause auto-contradictoire. Le structurel se lit dépouillé, la DOCTRINE se lit brute.
    // ⚠ ET ON AFFIRME LE **COMPTE**, PAS LA PRÉSENCE : l'aveu existe à DEUX endroits — la
    // déclaration du champ (`CoutDuBanc.parHeure`) et le rendu de la ligne —, et un `toContain`
    // était donc satisfait par l'une quand on retirait l'autre. Ma falsification n'a rougi qu'une
    // fois le compte exigé ; les deux copies doivent le dire, puisque les deux se lisent seules.
    expect(brut.match(/ne passe pas par `ChampGpu`/g)).toHaveLength(2)
  })
})
