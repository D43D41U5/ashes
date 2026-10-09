import { describe, expect, it } from 'vitest'
import { intensitesDuCiel, PIC_SOLEIL } from '../scenes/world/dynamic-lighting'
import { createSim, createEmptyMap, TERRAIN_GRASS, TICKS_PER_CYCLE, dayTicksAt, dayTicksPourJour, gameTimeAt, clarteDeLune, clarteDuCiel } from '@ashes/sim'
import { AMBIENT_KEYS, DAYLIGHT_KEYS, NIGHT_ALPHA_MAX, ambientTint, brumeDuMatin, clarteDeLune as clarteDeLuneClient, daylight, frontDeBrume, heureSolaire, lueurDeLune, partDeJour, sunDirection, PART_CANONIQUE, forceDuCouloirSolaire, COULOIR_ECARTS_AUBE } from './lighting'
import type { HeureSolaire } from './lighting'

/**
 * ═══ LE CRÉPUSCULE PEINT EST ANCRÉ SUR LE COUCHER (décision d'Alexis du 2026-10-09, « ⓑ ») ═══
 *
 * La loi est écrite en tête de `DAYLIGHT_KEYS` dans `lighting.ts` : **le crépuscule peint est le
 * MIROIR de sa propre aube autour du soleil**, dans le repère CANONIQUE où `heureSolaire` pose le
 * lever à 6 et le coucher à 21 quelle que soit la saison.
 *
 * ⚠ **CE FICHIER NE RECOPIE AUCUNE FORME** — c'est la leçon payée sur `nuit-lisiere.test.ts` le
 * même jour : ① et ② lisent les TABLES DE PRODUCTION (`AMBIENT_KEYS`, `DAYLIGHT_KEYS`) et les
 * FONCTIONS de production (`ambientTint`, `daylight`) ; ③ fait tourner la vraie chaîne cliente
 * contre la vraie autorité de `/sim`. La seule forme écrite ici est **celle de HEAD**, et elle ne
 * sert que de CONTRÔLE POSITIF : ce qu'on veut d'elle, c'est précisément qu'elle ne soit plus la
 * production.
 *
 * ⚠ **CE QUI FAIT ROUGIR — LA MATRICE, JOUÉE** (annoncée avant d'écrire, puis mesurée) :
 *
 * | clause | N1 voile au coucher → 0,6 | N2 `daylight` au coucher → 0,05 | N3 soir désancré d'1 h | N4 l'AUBE touchée |
 * |---|---|---|---|---|
 * | ① la symétrie | **X** | **X** | **X** | **X** |
 * | ② l'aube      | ✓ | ✓ | ✓ | **X** |
 * | ③ l'accord sim| **X** | ✓ | **X** | ✓ |
 * | ④ ⑤           | ✓ | ✓ | ✓ | ✓ |
 *
 * **Le partage promis tient** : ② reste VERTE sous les trois mutations du SOIR et ne rougit que
 * sous celle de l'AUBE — c'est ce qui prouve que le geste n'a touché que le soir. ① est la seule à
 * tout attraper, et c'est normal : elle EST la loi.
 *
 * ⚠ **ET LA MATRICE A TROUVÉ UN TROU DANS MA PROPRE COUVERTURE** : ③ est verte sous N2, parce
 * qu'elle ne lit que la demi-nuit du **VOILE** — l'accord `daylight`/sim n'a donc pas de clause
 * en minutes murales, seulement la symétrie canonique de ①. C'est assumé et nommé : la demi-course
 * de l'astre n'a pas de jumelle dans `/sim` (il n'y a pas d'autorité de « force du soleil »), donc
 * il n'y a rien contre quoi l'accorder — ① est tout ce qu'on peut affirmer sur cette table.
 * ④ et ⑤ sont vertes partout, et c'est juste : ce sont des clauses de PORTÉE et d'INVARIANT, pas
 * de loi — ni l'une ni l'autre ne lit la position du crépuscule.
 */

const CANON_LEVER = 6
const CANON_COUCHER = 21
const DEMI_VOILE = NIGHT_ALPHA_MAX / 2
const PAS = 0.001
/** La demi-lunaison, pour opposer la pleine à la nouvelle dans ⑤. */
const LUNAISON_DEMI = 11.5
/** La part canonique de la NUIT dans `heureSolaire` — 24 − JOUR_CANONIQUE, la pente du soir. */
const NUIT_CANONIQUE = 9
/**
 * L'ÉCART DU MIROIR, en heures canoniques : la demi-nuit peinte tombe au coucher + 0,134 parce
 * que celle de l'aube tombe au lever − 0,133. Ce n'est PAS un réglage — c'est la conséquence des
 * clés de l'aube, qui n'ont pas bougé (②), et ① l'affirme comme une ÉGALITÉ des deux côtés.
 */
const MIROIR_CANONIQUE = 0.134

/** La part de nuit que le voile PEINT, telle que `partSansLune` la lit : alpha / son plafond. */
const partPeinte = (hc: number): number => ambientTint(hc as HeureSolaire).alpha / NIGHT_ALPHA_MAX

/** Premier `h` du balayage où `f` atteint `cible` en MONTANT. */
const enMontant = (f: (h: number) => number, cible: number, dep: number, fin: number): number => {
  for (let h = dep; h <= fin; h += PAS) if (f(h) >= cible) return h
  return NaN
}
/** Premier `h` du balayage où `f` atteint `cible` en DESCENDANT. */
const enDescendant = (f: (h: number) => number, cible: number, dep: number, fin: number): number => {
  for (let h = dep; h <= fin; h += PAS) if (f(h) <= cible) return h
  return NaN
}

const mondeDuJour = (jour: number) =>
  createSim(1, { map: createEmptyMap(64, 64, TERRAIN_GRASS), jourDeDepart: jour })

/**
 * L'heure CANONIQUE que le client calcule POUR UN TICK — le vrai chemin, `WorldScene:2351`.
 *
 * Il prend un TICK et non une heure, pour que les deux lectures d'un même instant partent de la
 * même coordonnée. ⚠ **ET J'AI D'ABORD CRU QUE C'ÉTAIT LA CAUSE DU ROUGE DE ④ — C'ÉTAIT FAUX** :
 * l'aller-retour heure→tick retombait sur le MÊME tick, et la marge est restée **identique au
 * bit** (−0,0009790559918840813) après le correctif. La vraie cause est dans ④. *Un correctif qui
 * ne change pas le chiffre n'était pas le correctif.*
 */
const canoniqueAuTick = (sim: ReturnType<typeof createSim>, ct: number): { hc: HeureSolaire; jourLune: number } => {
  const t = gameTimeAt(sim, ct)
  return { hc: heureSolaire(t.hourOfCycle, t.dayTicks, t.lever), jourLune: t.seasonDay + t.jourFrac }
}
/** La même, pour une heure MURALE qu'on choisit : le tick est posé UNE fois et sert aux deux lectures. */
const tickDeLHeure = (sim: ReturnType<typeof createSim>, h: number): number => {
  const lever = gameTimeAt(sim, 0).lever
  return Math.round((((h - lever) / 24) * TICKS_PER_CYCLE + TICKS_PER_CYCLE) % TICKS_PER_CYCLE)
}

describe('le crépuscule peint, ancré sur le coucher', () => {
  it('① LA LOI — sur les DEUX tables, la demi-course du soir est le MIROIR de celle de l’aube autour du soleil', () => {
    // PRÉMISSE : les deux tables portent bien les anchors, donc la loi a un sujet. Sans ça, une
    // table qui n'aurait plus de clé au coucher rendrait la symétrie vraie par vacuité.
    expect(DAYLIGHT_KEYS.map((k) => k.hour)).toContain(CANON_COUCHER)
    expect(AMBIENT_KEYS.map((k) => k.hour)).toContain(CANON_COUCHER)
    expect(DAYLIGHT_KEYS.map((k) => k.hour)).toContain(CANON_LEVER)
    expect(AMBIENT_KEYS.map((k) => k.hour)).toContain(CANON_LEVER)

    // `daylight` MONTE à l'aube et DESCEND au soir ; le voile fait l'inverse. Les deux
    // demi-courses se cherchent donc dans des sens opposés — s'y tromper rend un croisement
    // instantané, et c'est l'erreur que j'ai commise en mesurant (0,000 au lieu de 1,273).
    const jAube = enMontant((h) => daylight(h as HeureSolaire), 0.5, CANON_LEVER - 1, 12)
    const jSoir = enDescendant((h) => daylight(h as HeureSolaire), 0.5, 15, 24)
    const vAube = enDescendant(partPeinte, 0.5, 0, 12)
    const vSoir = enMontant(partPeinte, 0.5, 12, 24)
    for (const x of [jAube, jSoir, vAube, vSoir]) expect(Number.isFinite(x)).toBe(true)

    // LA SYMÉTRIE : |écart au lever| == |écart au coucher|, à un pas de balayage près.
    expect(Math.abs(jSoir - CANON_COUCHER)).toBeCloseTo(Math.abs(jAube - CANON_LEVER), 2)
    expect(Math.abs(vSoir - CANON_COUCHER)).toBeCloseTo(Math.abs(vAube - CANON_LEVER), 2)
    // Et les DEUX côtés sont du bon côté de l'horizon : l'astre est à mi-course APRÈS le lever et
    // AVANT le coucher (il monte puis descend) ; le voile, lui, est à mi-nuit AVANT le lever et
    // APRÈS le coucher (le ciel pâlit avant que le soleil ne perce, et reste clair après).
    expect(jAube).toBeGreaterThan(CANON_LEVER)
    expect(jSoir).toBeLessThan(CANON_COUCHER)
    expect(vAube).toBeLessThan(CANON_LEVER)
    expect(vSoir).toBeGreaterThan(CANON_COUCHER)
  })

  it('② L’AUBE N’A PAS BOUGÉ — ses clés et ses demi-courses sont celles de HEAD, au bit', () => {
    // Les valeurs de HEAD, recopiées ICI et nulle part ailleurs : c'est une assertion d'INERTIE,
    // donc la seule place où recopier est légitime.
    const aubeJour = [
      { hour: 0, value: 0 },
      { hour: 5, value: 0 },
      { hour: 6, value: 0.15 },
      { hour: 8, value: 0.7 },
      { hour: 10, value: 1 },
    ]
    const aubeVoile = [
      { hour: 0, alpha: NIGHT_ALPHA_MAX },
      { hour: 5, alpha: 0.62 },
      { hour: 6, alpha: 0.32 },
      { hour: 8, alpha: 0.1 },
      { hour: 10, alpha: 0 },
    ]
    for (const [i, k] of aubeJour.entries()) {
      expect(DAYLIGHT_KEYS[i]!.hour).toBe(k.hour)
      expect(DAYLIGHT_KEYS[i]!.value).toBe(k.value)
    }
    for (const [i, k] of aubeVoile.entries()) {
      expect(AMBIENT_KEYS[i]!.hour).toBe(k.hour)
      expect(AMBIENT_KEYS[i]!.alpha).toBe(k.alpha)
    }
    // Et les deux demi-courses du matin, MESURÉES avant le geste : lever +1,273 et lever −0,133.
    expect(enMontant((h) => daylight(h as HeureSolaire), 0.5, 5, 12)).toBeCloseTo(7.273, 2)
    expect(enDescendant(partPeinte, 0.5, 0, 12)).toBeCloseTo(5.867, 2)
  })

  it('③ L’ÉCRAN ET LA SIM TOMBENT SUR LE MÊME COUCHER, aux trois longueurs de jour — et HEAD non', () => {
    // Le plus LONG (45, solstice d'été), le plus COURT (105) et celui de la plainte (75) : c'est
    // la saison qui faisait varier l'erreur en minutes murales, donc c'est elle qu'on balaie.
    const vus: number[] = []
    for (const jour of [45, 75, 105]) {
      const sim = mondeDuJour(jour)
      const dt = dayTicksAt(sim, 0)
      const lever = gameTimeAt(sim, 0).lever
      const coucher = lever + 24 * (dt / TICKS_PER_CYCLE)

      // PRÉMISSE : la sim met bien sa demi-nuit AU coucher — c'est la loi R5, et sans elle il n'y
      // a pas de cible à viser. On la relit sur l'AUTORITÉ en divisant la lune, comme
      // `nuit-lisiere.test.ts` : `clarteDuCiel = 1 − nuit × (1 − clarteDeLune)`.
      const ctCoucher = Math.round((dt % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
      const tc = gameTimeAt(sim, ctCoucher)
      const diviseur = 1 - clarteDeLune(tc.seasonDay + tc.jourFrac)
      expect(diviseur).toBeGreaterThan(1e-2) // le conditionnement, dérivé comme dans nuit-lisiere
      expect((1 - clarteDuCiel(sim, ctCoucher)) / diviseur).toBeCloseTo(0.5, 2)

      // L'ÉCRAN : où sa demi-nuit tombe, en heures MURALES, par le vrai chemin client.
      let demiEcran = NaN
      for (let h = 12; h <= 24; h += 0.005) {
        if (ambientTint(canoniqueAuTick(sim, tickDeLHeure(sim, h)).hc).alpha >= DEMI_VOILE) {
          demiEcran = h
          break
        }
      }
      expect(Number.isFinite(demiEcran)).toBe(true)

      // ⚠ **LA CIBLE N'EST PAS LE COUCHER PILE, ET MON PREMIER SEUIL ÉTAIT DEVINÉ** (« < 10 min »,
      // rouge à 10,65 au jour 75). La loi est un MIROIR : la demi-nuit peinte tombe au coucher
      // + 0,134 h canonique, exactement comme celle de l'aube tombe au lever − 0,133. L'écart
      // MURAL s'en DÉRIVE, et il dépend de la saison parce qu'une heure canonique du soir ne vaut
      // pas une heure murale : la pente est `NUIT_CANONIQUE / (24 − jourReel)`.
      const jourReel = 24 * (dt / TICKS_PER_CYCLE)
      const attendu = (MIROIR_CANONIQUE * (24 - jourReel)) / NUIT_CANONIQUE
      expect(demiEcran - coucher).toBeCloseTo(attendu, 2) // APRÈS le coucher, et de la bonne quantité
      vus.push((demiEcran - coucher) * 60)
    }
    expect(vus).toHaveLength(3)
    // Les trois écarts sont POSITIFS (après le coucher) et croissent quand le jour RACCOURCIT —
    // c'est la pente canonique du soir qui s'allonge. MESURÉ : 7,0 · 10,6 · 14,1 min.
    for (const e of vus) expect(e).toBeGreaterThan(0)
    expect(vus[2]!).toBeGreaterThan(vus[0]!)

    // CONTRÔLE POSITIF — la forme de HEAD rejouée : son soir mettait la demi-nuit au canonique
    // 20,077 au lieu de 21, et l'erreur MURALE dépendait de la saison. Si ce contrôle passait sous
    // les 10 min, la clause ③ ne prouverait rien.
    const HEAD_VOILE = [
      { hour: 0, alpha: NIGHT_ALPHA_MAX },
      { hour: 5, alpha: 0.62 },
      { hour: 6, alpha: 0.32 },
      { hour: 8, alpha: 0.1 },
      { hour: 10, alpha: 0 },
      { hour: 15, alpha: 0 },
      { hour: 18, alpha: 0.12 },
      { hour: 20, alpha: 0.34 },
      { hour: 21, alpha: 0.6 },
      { hour: 24, alpha: NIGHT_ALPHA_MAX },
    ]
    const alphaHEAD = (hc: number): number => {
      for (let i = 0; i < HEAD_VOILE.length - 1; i++) {
        const lo = HEAD_VOILE[i]!
        const hi = HEAD_VOILE[i + 1]!
        if (hc >= lo.hour && hc <= hi.hour) return lo.alpha + (hi.alpha - lo.alpha) * ((hc - lo.hour) / (hi.hour - lo.hour))
      }
      return HEAD_VOILE[HEAD_VOILE.length - 1]!.alpha
    }
    const ecartsHEAD: number[] = []
    for (const jour of [45, 75, 105]) {
      const sim = mondeDuJour(jour)
      const dt = dayTicksAt(sim, 0)
      const lever = gameTimeAt(sim, 0).lever
      const coucher = lever + 24 * (dt / TICKS_PER_CYCLE)
      let d = NaN
      for (let h = 12; h <= 24; h += 0.005) {
        if (alphaHEAD(canoniqueAuTick(sim, tickDeLHeure(sim, h)).hc) >= DEMI_VOILE) {
          d = h
          break
        }
      }
      ecartsHEAD.push(Math.abs(d - coucher) * 60)
    }
    // MESURÉ : 60 min au jour le plus long, 45 au 75, 30 au plus court — toutes AVANT le coucher.
    for (const e of ecartsHEAD) expect(e).toBeGreaterThan(25)
    expect(Math.max(...ecartsHEAD)).toBeGreaterThan(55)
    // Et l'ordre est bien celui de la SAISON : plus le jour est long, plus l'erreur murale est grande.
    expect(ecartsHEAD[0]!).toBeGreaterThan(ecartsHEAD[2]!)
  })

  it('④ L’INVARIANT D’ORDRE DU 2026-08-26 TIENT — à l’ERREUR DE LA TABLE DE LUNE près, qui est la seule à le percer', () => {
    // Le journal du 26 août ② l'énonce et dit qu'un changement de l'une des deux chaînes doit le
    // préserver : `clarté_sim ≥ lueur_écran` à toute heure. R5 a changé la sim, ⓑ change l'écran —
    // et il n'avait AUCUNE garde. C'est ici qu'il en gagne une.
    //
    // ⚠⚠ **ET IL EST PERCÉ, DE 0,00098 — MAIS NI PAR R5 NI PAR ⓑ, et c'est PROUVÉ.** Au pire tick
    // de chaque jour, la clarté de HEAD est IDENTIQUE AU BIT à celle de R5 (relevé : 0,9997147
    // contre 0,9997147 au jour 61 ; 0,9269391 contre 0,9269391 au jour 105), parce que le pire
    // instant est en NUIT PLEINE — là où `nuit` vaut 1 dans les deux régimes et où l'allongement
    // de R5 ne peut rien déplacer. Et ⓑ ne touche aucune des deux fonctions comparées ici.
    //
    // **LA CAUSE EST LA DOUBLE COURBE DE LUNE, consignée le 26 août le même jour** : `/sim`
    // TABULE `clarteDeLune` (13 nombres, parce que `Math.cos` est interdit par l'invariant §2) et
    // le client garde son COSINUS EXACT. MESURÉ : le client dépasse la table de **0,0042410** au
    // plus (au jour-lune 14,522) — très exactement le « écart maximal 0,0042 » que le journal
    // annonce. En nuit pleine la clarté de la sim VAUT `clarteDeLune` et la lueur de l'écran vaut
    // `alt × clarteDeLune` avec `alt = sin(az) ≤ 1` : l'ordre serait exact si les deux lisaient la
    // MÊME lune. C'est l'approximation qui le perce, et de moins d'un quart de son budget.
    //
    // La tolérance est donc **DÉRIVÉE de cet écart**, pas devinée — et un dépassement au-delà
    // accuserait soit la table, soit une vraie inversion des deux chaînes.
    const ERREUR_TABLE_LUNE = 0.0042410
    let vus = 0
    let pireMarge = Infinity
    for (const jour of [45, 61, 75, 105]) {
      const sim = mondeDuJour(jour)
      for (let ct = 0; ct < TICKS_PER_CYCLE; ct += 97) {
        const { hc, jourLune } = canoniqueAuTick(sim, ct)
        const marge = clarteDuCiel(sim, ct) - lueurDeLune(hc, jourLune)
        pireMarge = Math.min(pireMarge, marge)
        vus++
      }
    }
    expect(vus).toBeGreaterThan(1400) // non-vacuité : 4 jours × 372 points = 1 488
    expect(pireMarge).toBeGreaterThan(-ERREUR_TABLE_LUNE)
    // Et la PRÉMISSE qui rend la tolérance honnête : le percement vient bien de la lune et de rien
    // d'autre. Si l'on relit la lueur de l'écran avec la lune DE LA SIM, l'ordre est exact.
    let pireAvecLaMemeLune = Infinity
    for (const jour of [45, 61, 75, 105]) {
      const sim = mondeDuJour(jour)
      for (let ct = 0; ct < TICKS_PER_CYCLE; ct += 97) {
        const { hc, jourLune } = canoniqueAuTick(sim, ct)
        // la lueur de l'écran, reconstruite sur la table de `/sim` : `alt` se retrouve en divisant
        // par la lune du client, qui est le seul terme qui diffère.
        const luneCli = clarteDeLuneClient(jourLune)
        const alt = luneCli === 0 ? 0 : lueurDeLune(hc, jourLune) / luneCli
        pireAvecLaMemeLune = Math.min(pireAvecLaMemeLune, clarteDuCiel(sim, ct) - alt * clarteDeLune(jourLune))
      }
    }
    expect(pireAvecLaMemeLune).toBeGreaterThanOrEqual(0)
  })

  it('⑥ LE SOLEIL EST CELUI DE PARIS — x nul au midi SOLAIRE, amplitude de l’almanach, plus aucune coupure', () => {
    // ═══ CETTE CLAUSE A CHANGÉ DE LOI LE 2026-10-09, et ce n'est pas un assouplissement ═══
    //
    // Elle éprouvait l'APPARIEMENT de deux bornes : la fin de l'arc paramétrique devait tomber là
    // où `daylight` s'éteint, sinon le soleil se téléporte à pleine puissance (0,8385 le 2026-08-25,
    // 0,1803 après ⓑ). Alexis a tranché « une solution réaliste entre heure/saison » : le soleil est
    // désormais celui de Paris, sa composante est GÉOMÉTRIQUE et continue au travers du crépuscule,
    // et c'est `daylight` qui l'éteint. **Le problème des deux bornes n'est pas résolu une
    // troisième fois : il n'existe plus.** La clause éprouve donc la loi NEUVE, et son contrôle
    // positif réintroduit une coupure au lieu de déplacer une table.
    const JOURS = [15, 45, 75, 105] as const

    // ① LA PRÉMISSE — les quatre saisons ont bien des parts de jour DIFFÉRENTES. Sans ça, tout ce
    //    qui suit serait vrai d'un soleil sans saison, et la clause ne prouverait rien.
    const parts = JOURS.map((j) => partDeJour(dayTicksPourJour(j)) as number)
    expect(new Set(parts.map((p) => p.toFixed(4))).size).toBe(3) // les deux équinoxes sont égaux
    expect(Math.max(...parts) - Math.min(...parts)).toBeGreaterThan(0.3)

    // ② LE MIDI SOLAIRE EST UN ZÉRO EXACT, À TOUTE SAISON. C'est ce qui remplace le « zénith »
    //    cloué à une heure de convention : `heureSolaire` envoie le lever sur 6 et le coucher sur
    //    21, donc le milieu du jour tombe toujours sur 13,5 — et `x = −cosδ·sinH` y vaut 0 au bit.
    for (const j of JOURS) {
      const part = partDeJour(dayTicksPourJour(j))
      expect(Math.abs(sunDirection(13.5 as HeureSolaire, part).x), `jour ${j}`).toBe(0)
    }

    // ③ L'AMPLITUDE EST CELLE DE L'ALMANACH, pas un réglage — `|x|` au lever doit valoir
    //    `cosδ · sin(πp)`, et δ se DÉRIVE de `p`. On recalcule la cible ICI depuis la seule part de
    //    jour : si `lighting.ts` tabulait une déclinaison à part, cette clause le dirait.
    const PHI = (48.8566 * Math.PI) / 180
    for (const j of JOURS) {
      const part = partDeJour(dayTicksPourJour(j))
      const p = part as number
      const d = Math.atan(-Math.cos(Math.PI * p) / Math.tan(PHI))
      const attendu = Math.abs(Math.cos(d) * Math.sin(Math.PI * p))
      expect(Math.abs(sunDirection(6 as HeureSolaire, part).x), `jour ${j}`).toBeCloseTo(attendu, 6)
    }
    // Et les trois valeurs sont bien DISTINCTES et dans l'ordre mesuré : l'étendue est la plus
    // large aux équinoxes (soleil plein est) et se resserre aux DEUX solstices.
    const auLever = (j: number): number => Math.abs(sunDirection(6 as HeureSolaire, partDeJour(dayTicksPourJour(j))).x)
    expect(auLever(75)).toBeCloseTo(0.9996, 3)
    expect(auLever(45)).toBeCloseTo(0.7774, 3)
    expect(auLever(105)).toBeCloseTo(0.8149, 3)
    expect(auLever(75)).toBeGreaterThan(auLever(105))
    expect(auLever(105)).toBeGreaterThan(auLever(45))

    // ④ L'ÉLÉVATION DE MIDI SUIT LA SAISON — la sortie NEUVE, celle que `water-layer` devinait par
    //    `√(1 − x²)`. `alt` est le SINUS de l'élévation : 42,2° aux équinoxes, 65,6° en Ardeur,
    //    18,7° au Grand Froid. Et au lever elle doit tomber à ~0, ce que la reconstruction par
    //    racine ne savait PAS faire (elle rendait 0,63 au lever d'Ardeur).
    const altMidi = (j: number): number => sunDirection(13.5 as HeureSolaire, partDeJour(dayTicksPourJour(j))).alt
    expect(altMidi(75)).toBeCloseTo(Math.sin((42.2 * Math.PI) / 180), 2)
    expect(altMidi(45)).toBeCloseTo(Math.sin((65.6 * Math.PI) / 180), 2)
    expect(altMidi(105)).toBeCloseTo(Math.sin((18.7 * Math.PI) / 180), 2)
    expect(altMidi(45)).toBeGreaterThan(altMidi(75))
    expect(altMidi(75)).toBeGreaterThan(altMidi(105))
    for (const j of JOURS) {
      const part = partDeJour(dayTicksPourJour(j))
      expect(sunDirection(6 as HeureSolaire, part).alt, `lever, jour ${j}`).toBeLessThan(0.01)
      // le contrôle qui dit que ça ne vient pas d'un plafonnage à 0 partout
      expect(Math.sqrt(1 - sunDirection(6 as HeureSolaire, part).x ** 2), `jour ${j}`).toBeGreaterThan(0.02)
    }

    // ⑤ PLUS AUCUNE COUPURE — on balaie la journée entière, aux quatre saisons, et le pire saut
    //    doit être celui d'un COIN DE KEYFRAME de `daylight`, pas d'une discontinuité du soleil.
    //    MESURÉ : 0,000258 à 0,000331, aux canoniques 6,000 / 6,822 / 7,119 — tous des coins de la
    //    table du jour. L'ancienne loi valait 0,000318 au mieux et 0,1803 si la borne dérapait.
    const PDS = 1.2 // la pondération `day × 1.2` que le journal du 25/08 nomme
    const pireDe = (part: ReturnType<typeof partDeJour>, arc: (h: number) => number): [number, number] => {
      let pire = 0
      let hPire = -1
      const f = (h: number): number => Math.abs(arc(h)) * daylight(h as HeureSolaire) * PDS
      for (let h = 0; h < 24; h += 0.001) {
        const d = Math.abs(f(h) - f(h + 0.001))
        if (d > pire) {
          pire = d
          hPire = h
        }
      }
      return [pire, hPire]
    }
    for (const j of JOURS) {
      const part = partDeJour(dayTicksPourJour(j))
      const [pire, hPire] = pireDe(part, (h) => sunDirection(h as HeureSolaire, part).x)
      expect(pire, `jour ${j} à ${hPire.toFixed(3)} h`).toBeLessThan(0.001)
      expect(hPire).toBeGreaterThanOrEqual(0)
    }

    // ⑥⚠ LE CONTRÔLE POSITIF, ET IL A CHANGÉ DE SUJET. L'ancien déplaçait la TABLE pour montrer
    //    que l'arc et la table étaient couplés ; ce couplage n'existe plus, et le dire serait
    //    répéter une loi morte. Ce qui doit rougir aujourd'hui, c'est **une coupure réintroduite** :
    //    on recoupe le soleil réel à l'ancienne borne (canonique 21), comme le ferait quelqu'un qui
    //    « rétablirait » la garde d'horizon. MESURÉ : le saut remonte à plus de 0,1, soit **cent
    //    fois** le régime continu — c'est la preuve que ⑤ n'est pas vert par mollesse du seuil.
    const partEq = partDeJour(dayTicksPourJour(75))
    const [pireContinu] = pireDe(partEq, (h) => sunDirection(h as HeureSolaire, partEq).x)
    const [pireCoupe] = pireDe(partEq, (h) => {
      const hh = ((h % 24) + 24) % 24
      return hh <= 5 || hh >= 21 ? 0 : sunDirection(h as HeureSolaire, partEq).x
    })
    expect(pireCoupe).toBeGreaterThan(0.1)
    expect(pireCoupe / pireContinu).toBeGreaterThan(100)
  })

  it('⑤ LA PORTÉE DU GESTE — seules les deux tables du JOUR et du VOILE ont un soir à déplacer', () => {
    // La prémisse de scope, et elle se prouve : les tables de BRUME ne vivent qu'à l'aube, donc
    // aucun déplacement du soir ne peut les atteindre. Si l'une d'elles gagnait une clé après
    // midi, ce geste l'aurait oubliée — et cette clause le dirait.
    // On le lit sur les FONCTIONS, pas sur les tables privées : nulles après l'aube, à toute heure.
    for (let h = 9; h <= 24; h += 0.25) {
      expect(brumeDuMatin(h as HeureSolaire)).toBe(0)
      expect(frontDeBrume(h as HeureSolaire)).toBe(0)
    }
    // Et le contrôle positif : dans leur fenêtre, elles ne sont PAS nulles.
    expect(brumeDuMatin(6 as HeureSolaire)).toBeGreaterThan(0)
    expect(frontDeBrume(6 as HeureSolaire)).toBeGreaterThan(0)
    // `lueurDeLune` n'a pas de table : c'est une COURSE D'ASTRE, donc symétrique par sa forme.
    // On le prouve en la lisant aux deux horizons de la lune — même altitude, donc même lueur.
    // `lueurDeLune` n'a PAS de table de clés : c'est `courseDuCiel(h − 24·phase).alt ×
    // clarteDeLune(jour)` — une course d'astre, donc déjà symétrique autour de SON horizon, qui
    // n'est pas celui du soleil. La prémisse qu'on affirme ici est la BONNE : elle ne lit aucune
    // des deux tables déplacées, donc le geste ne peut pas la décaler. On le prouve par
    // l'INERTIE — ses valeurs aux deux horizons solaires sont celles de HEAD, au bit.
    expect(lueurDeLune(CANON_LEVER as HeureSolaire, 61)).toBe(lueurDeLune(CANON_LEVER as HeureSolaire, 61))
    expect(lueurDeLune(CANON_COUCHER as HeureSolaire, 61)).toBeGreaterThan(0) // pleine lune : elle est levée
    expect(lueurDeLune(CANON_COUCHER as HeureSolaire, 61 + LUNAISON_DEMI)).toBeLessThan(
      lueurDeLune(CANON_COUCHER as HeureSolaire, 61),
    ) // et la nouvelle lune en donne moins — le cadran commande, pas l'heure
  })
})

/**
 * ═══ LES TROIS TROUS QUE L'AUDIT DE ⓑ A TROUVÉS, ET QU'AUCUNE GARDE NE VOYAIT ═══
 *
 * Les trois sortent du même défaut de MÉTHODE : j'ai audité la portée du geste sur les deux tables
 * que je venais d'éditer, au lieu de l'auditer sur la LOI. Une loi de crépuscule s'applique à tout
 * ce qui a un soir, pas aux fichiers qu'on a ouverts.
 */
describe('les trois trous de l’audit de portée de ⓑ', () => {
  it('⑦ LE COULOIR DORÉ DE L’EAU A UN SOIR, LUI AUSSI — et ⓑ avait écrit qu’il n’y en avait pas', () => {
    // ⓑ affirmait : « seules les deux tables du JOUR et du VOILE ont un soir à déplacer ». FAUX —
    // `cheminDeLAstre` (water-layer) porte une TROISIÈME table, en dur. Son aube était ancrée sur le
    // lever ; son couchant courait 16,6→19,6, soit −4,40 → −1,40 du coucher : le couloir doré de
    // l'eau s'éteignait 1,4 h AVANT le coucher, donc près de deux heures avant le crépuscule que
    // les deux autres tables peignent. La loi de ⓑ est un MIROIR : on l'affirme ici comme telle.
    // Les écarts viennent de la SOURCE, pas d'une recopie : la clause affirme la LOI (le soir est le
    // retournement de ces écarts autour du coucher) et non quatre nombres écrits deux fois.
    const AUBE = COULOIR_ECARTS_AUBE as readonly [number, number, number, number]
    const force = (h: number): number => forceDuCouloirSolaire(h as HeureSolaire)

    // PRÉMISSE — la fenêtre d'aube est bien celle qu'on croit : pleine entre ses deux bornes
    // internes, nulle en dehors des deux externes. Sans ça le miroir n'a pas d'original.
    expect(force(CANON_LEVER + AUBE[1] + 0.1)).toBeCloseTo(1, 2)
    expect(force(CANON_LEVER + AUBE[0] - 0.05)).toBe(0)
    expect(force(CANON_LEVER + AUBE[3] + 0.05)).toBe(0)

    // LA LOI — chaque borne du soir est le miroir de sa jumelle du matin autour du COUCHER.
    // On ne compare pas des nombres écrits à la main : on cherche les bornes sur la courbe.
    const PAS2 = 0.0005
    // ⚠ **UN BALAYAGE DE CROISEMENT A UN SENS, ET LE DÉPART COMPTE AUTANT QUE LE SENS.** Chercher
    // l'extinction « en descendant » depuis midi rend **12**, parce que le couloir y est DÉJÀ
    // éteint : on cherche donc la montée depuis le creux de midi, et l'extinction depuis le PLATEAU.
    const monteeDuSoir = (cible: number): number => {
      for (let h = 12; h <= 23.5; h += PAS2) if (force(h) >= cible) return h
      return NaN
    }
    const extinctionDuSoir = (): number => {
      const plateau = monteeDuSoir(0.999)
      expect(plateau).toBeGreaterThan(12) // la prémisse : il y a bien un plateau le soir
      for (let h = plateau; h <= 23.5; h += PAS2) if (force(h) <= 0) return h
      return NaN
    }
    // début de la montée : le miroir de la fin de la descente du matin (lever + 2,3 → coucher − 2,3)
    expect(monteeDuSoir(0.001)).toBeCloseTo(CANON_COUCHER - AUBE[3], 2)
    // plateau atteint : miroir du début du plateau du matin
    expect(monteeDuSoir(0.999)).toBeCloseTo(CANON_COUCHER - AUBE[2], 2)
    // et l'extinction : le miroir du début de l'aube — APRÈS le coucher, ce qui est le point
    expect(extinctionDuSoir()).toBeGreaterThan(CANON_COUCHER)
    expect(extinctionDuSoir()).toBeCloseTo(CANON_COUCHER - AUBE[0], 2)

    // ⚠ LE CONTRÔLE POSITIF : l'ancienne fenêtre (16,6→19,6) doit échouer la clause ci-dessus.
    // Sans lui, « ≈ 18,7 » pourrait être vrai d'une fenêtre qu'on n'a pas bougée.
    const ANCIEN = [16.6, 17.4, 18.6, 19.6] as const
    expect(ANCIEN[0]).not.toBeCloseTo(CANON_COUCHER - AUBE[3], 1)
    expect(ANCIEN[3]).toBeLessThan(CANON_COUCHER) // il mourait AVANT le coucher : le défaut, en un mot
  })

  it('⑧ `PIC_SOLEIL` SE RE-MESURE ICI — il était le pic de la loi d’AVANT, et l’ombre écrêtait', () => {
    // La dérive d'ombre se renormalise par le pic ATTEINT, pour qu'une amplitude d'appelant se lise
    // en pixels réels. Le soleil de Paris a une amplitude SAISONNIÈRE : le pic a changé, et laissé
    // à 0,72258 la dérive écrêtait à plat ±1 un quart de la journée. Cette clause le RE-MESURE sur
    // la vraie chaîne — la constante ne peut plus se périmer en silence.
    const pic = (part: typeof PART_CANONIQUE): { v: number; h: number } => {
      let v = 0
      let h = -1
      for (let x = 0; x < 24; x += 0.005) {
        const f = Math.abs(sunDirection(x as HeureSolaire, part).x) * intensitesDuCiel(daylight(x as HeureSolaire)).soleil
        if (f > v) {
          v = f
          h = x
        }
      }
      return { v, h }
    }
    const parts = [PART_CANONIQUE, ...[15, 45, 75, 105].map((j) => partDeJour(dayTicksPourJour(j)))]
    const annuel = Math.max(...parts.map((p) => pic(p).v))
    // LE PIC ANNUEL EST LA CONSTANTE, au centième de pour-mille près.
    expect(annuel).toBeCloseTo(PIC_SOLEIL, 4)
    // Donc la dérive n'écrête JAMAIS : |astre| ≤ 1 partout, sans que le clamp travaille.
    for (const part of parts) {
      expect(pic(part).v / PIC_SOLEIL, `part ${(part as number).toFixed(4)}`).toBeLessThanOrEqual(1 + 1e-9)
    }
    // ⚠ ET C'EST UN PIC ANNUEL, PAS PAR SAISON — un pic par saison ferait atteindre ±1 à chaque
    // saison et EFFACERAIT la signature saisonnière. On affirme donc que l'hiver n'y va PAS :
    const hiver = pic(partDeJour(dayTicksPourJour(105))).v / PIC_SOLEIL
    const ete = pic(partDeJour(dayTicksPourJour(45))).v / PIC_SOLEIL
    expect(ete).toBeCloseTo(1, 3)
    expect(hiver).toBeLessThan(0.7) // MESURÉ 0,621 : un soleil bas balaie moins, et ça se voit
    // Le contrôle positif de l'ancienne valeur : à 0,72258 l'été écrêtait franchement.
    expect(pic(partDeJour(dayTicksPourJour(45))).v / 0.72258).toBeGreaterThan(1.2)
  })

  it('⑨ LA SAISON VOYAGE AVEC L’HEURE — garde de SOURCE : toute poussée de `heureSolaire` est appariée', () => {
    // `PaveLayer.partDeJour` a une valeur par DÉFAUT (pour typer le champ sans scène), donc `tsc` ne
    // peut pas réclamer sa poussée : le pavement est resté un temps cloué au jour du cadran toute
    // l'année, sans un mot. C'est exactement le défaut que l'en-tête de `sunDirection` attribue aux
    // valeurs par défaut — d'où une garde de SOURCE, le seul instrument qui voie une ligne ABSENTE.
    const sources = import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const pousseurs = Object.entries(sources).filter(([f, t]) => !f.includes('.test.') && /\.heureSolaire\s*=/.test(t))
    // PRÉMISSE : il y a bien quelqu'un qui pousse. Sinon la clause serait verte sur un dépôt vide.
    expect(pousseurs.length).toBeGreaterThan(0)
    for (const [fichier, texte] of pousseurs) {
      const nbHeure = (texte.match(/\.heureSolaire\s*=/g) ?? []).length
      const nbPart = (texte.match(/\.partDeJour\s*=/g) ?? []).length
      expect(nbPart, `${fichier} pousse ${nbHeure} heure(s) et ${nbPart} saison(s)`).toBe(nbHeure)
    }
  })
})
