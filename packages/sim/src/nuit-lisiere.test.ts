/**
 * ═══ LA LISIÈRE DU CRÉPUSCULE EST LE MIROIR DE CELLE DE L'AUBE (R5, 2026-10-09) ═══
 *
 * `nuitPourLOeil` porte DEUX termes, et il a fallu les deux :
 *   · une **translation** d'une demi-rampe (`+ NIGHT_RAMP_TICKS / 2`), antérieure, qui centre
 *     l'AUBE : la nuit vaut ½ à l'instant du lever, le jour est plein une demi-rampe après ;
 *   · un **allongement** du jour d'une rampe entière (`+ NIGHT_RAMP_TICKS`, R5), sans lequel la
 *     lisière du soir reste épinglée sur `dayTicks` — donc en avance d'une rampe ENTIÈRE, la
 *     translation en ayant déjà mangé la moitié de ce côté-là. ⚠ **Ce n'est donc pas `+R/2`.**
 *
 * ⚠ **CE FICHIER EXISTE PARCE QUE R5 N'AVAIT AUCUNE GARDE** : les 2 500 gardes de `/sim` sont
 * restées vertes avec le correctif comme sans lui, aucune ne lisant la lisière du soir. Il est
 * À PART de `nuit.test.ts`, qu'une autre session amendait le même jour.
 *
 * ⚠ **ET J'AI PUBLIÉ UN RÉCIT FAUX DE CE DÉFAUT AVANT D'ÉCRIRE CE FICHIER** : « la rampe était
 * entièrement dans le jour, AUX DEUX BORDS ». Faux — ma sonde prenait pour AVANT la forme **nue**
 * `partDeNuit(ct, dayTicks)`, qui n'a jamais été livrée, au lieu du HEAD qui portait déjà la
 * translation. D'où le choix de rejouer ICI la forme de HEAD comme **contrôle positif** plutôt
 * que de la décrire : une garde qui décrit l'avant se trompe, une garde qui le rejoue ne peut pas.
 *
 * ⚠ **CE QUI LE FAIT ROUGIR — LA MATRICE, JOUÉE.** Mon premier en-tête ANNONÇAIT un contrat
 * (« retirer `+ NIGHT_RAMP_TICKS` casse ①②⑤ et laisse ③④ VERTS ») : il est **périmé par la
 * réécriture de ④** (voir ④ — la première ne pouvait pas échouer), et un contrat annoncé n'est pas
 * un contrat tenu. Cinq mutants, chacun rejoué contre la production, **comptes MESURÉS** :
 *
 * | clause | M0 `−R` (= HEAD) | M1 `+R/2` | M2 `+2R` | M3 transl. `+1` | M4 transl. `0` |
 * |---|---|---|---|---|---|
 * | ①     | X | X | X | ✓ | X |
 * | ②     | X | X | X | ✓ | X |
 * | ③     | ✓ | ✓ | ✓ | **X** | X |
 * | ④     | X | ✓ | X | ✓ | X |
 * | ⑤     | X | X | X | X | X |
 * | *total* | *6* | *5* | *6* | *3* | *8* |
 *
 * Ce qu'elle dit, et c'est le partage qui compte : **①② et ⑤ gardent l'ALLONGEMENT** (M0 son
 * absence, M1 la sous-correction écartée en tête de ce fichier, M2 la sur-correction) ; **③ garde
 * la TRANSLATION** — seule clause à rougir sous M3 pendant que ①②④ restent vertes, donc seule à
 * LOCALISER le défaut dans l'autre terme ; **④ garde le SUPPORT**, et sa colonne M1 verte est
 * JUSTE et non un trou : M1 RÉTRÉCIT le support, que ④ borne par l'extérieur. **Aucune clause
 * n'est verte partout** — c'était le défaut de la précédente, qui ne touchait pas la production.
 *
 * ⚠⚠ **ET MON PREMIER JET NE POUVAIT PAS TENIR CE CONTRAT : IL NE TOUCHAIT PAS LA PRODUCTION.**
 * ①②③④ lisaient `LIVREE`, une forme RECOPIÉE à la main ici — donc retirer le terme de `nuit.ts`
 * les laissait toutes les quatre vertes, et seule ⑤ rougissait. Elles prouvaient l'arithmétique
 * de deux formules écrites dans le test, jamais que le jeu porte la bonne. **Tout ce qui affirme
 * la loi livrée passe désormais par `nuitDeLAutorite`**, qui la relit sur `clarteDuCiel` en lui
 * divisant la lune ; `LIVREE` ne sert plus à rien et sort, `HEAD` ne survit que comme **contrôle
 * positif** — ce qu'on veut de lui, justement, c'est qu'il NE soit PAS la production.
 */
import { describe, expect, it } from 'vitest'
import { TERRAIN_GRASS } from './balance'
import { BALANCE } from './balance'
import { createEmptyMap } from './map'
import { createSim, type SimState } from './sim'
import { clarteDeLune, clarteDuCiel } from './nuit'
import { NIGHT_RAMP_TICKS, TICKS_PER_CYCLE, dayTicksAt, debutDeCycle, gameTimeAt, jourDeSaison, partDeNuit } from './time'

/** Une carte nue : la lisière ne dépend que du calendrier, jamais du terrain. */
const makeSim = (jourDeDepart: number): SimState =>
  createSim(1, { map: createEmptyMap(96, 96, TERRAIN_GRASS), jourDeDepart })

/**
 * LA FORME DE HEAD, rejouée — **le contrôle positif, et lui seul**. Il ne doit SURTOUT pas être
 * la production : c'est le `+ NIGHT_RAMP_TICKS` qui l'en sépare, et c'est ce que la garde mesure.
 */
const HEAD = (ct: number, dt: number): number => partDeNuit((ct + NIGHT_RAMP_TICKS / 2) % TICKS_PER_CYCLE, dt)

/**
 * LA NUIT TELLE QUE L'AUTORITÉ L'APPLIQUE — `nuitPourLOeil` n'est pas exportée, mais
 * `clarteDuCiel` vaut `1 − nuit × (1 − lune)` : on INVERSE la loi au lieu de la recopier.
 *
 * ⚠ **Deux pièges payés ici, aucun des deux dans le jeu.** ⓐ La phase de lune avance DANS la
 * journée (`jourFrac`), donc deux instants de nuit pleine ne rendent pas la même clarté : d'où la
 * division par `1 − clarteDeLune`, exacte, plutôt qu'une comparaison entre deux heures (mon
 * premier jet se trompait de **0,079**). ⓑ On POSE LE TICK et on laisse `cycleOffset` à 0 : un
 * offset non nul fait partir `debutDeCycle` en **négatif** au tick 0, donc `dayTicksAt` rend la
 * longueur du jour **d'AVANT** et la loi se mesure sur la rampe d'un autre jour (**0,089**).
 */
const nuitDeLAutorite = (sim: SimState, tick: number): number => {
  const t = gameTimeAt(sim, tick)
  const lune = clarteDeLune(t.seasonDay + t.jourFrac)
  // ⚠ **LA PRÉMISSE DE CONDITIONNEMENT, ET ELLE EST DÉRIVÉE DE LA TOLÉRANCE, PAS CHOISIE.**
  // L'inversion divise par `1 − lune` : sous une lune presque PLEINE le diviseur s'effondre et
  // l'erreur du quotient explose — un ulp de `clarteDuCiel` (1,1 × 10⁻¹⁶) devient `1,1e-16 / d`.
  // Pour rester sous le 5 × 10⁻¹³ d'un `toBeCloseTo(…, 12)` il faut `d ≫ 2,2 × 10⁻⁴` ; le seuil
  // 10⁻² laisse **45× de marge** (erreur ≤ 1,1 × 10⁻¹⁴). MESURÉ : **115** jours sur 120 le
  // passent — échouent les jours 15, 38, 61, 84 et 107, les cinq nouvelles lunes de l'année.
  // ⚠ J'avais écrit 114, un compte annoncé MESURÉ qui ne l'était pas (relevé à l'audit du
  // 2026-10-09, puis rebalayé ici).
  // ⚠ **Et c'est exactement ce qui manquait** : la clause ④ jouait le jour 61, dont le pire
  // diviseur vaut 9,5 × 10⁻⁵ — erreur **1,15 × 10⁻¹², AU-DESSUS de la tolérance**. Elle ne
  // passait que parce qu'à midi `nuit` vaut exactement 0, donc le quotient aussi ; à 0 h et 23 h
  // la marge n'était que de 1,2×. Une garde verte par chance est une garde qui ne garde rien.
  expect(1 - lune).toBeGreaterThan(1e-2)
  return (1 - clarteDuCiel(sim, tick)) / (1 - lune)
}

const leverDe = (jour: number): number => BALANCE.LEVER_DU_JOUR(jour)
const coucherDe = (jour: number): number => leverDe(jour) + 24 * BALANCE.PART_DE_JOUR(jour)
/** L'heure du monde → `cycleTick`. ⚠ **L'origine du cycle est le LEVER, jamais minuit.** */
const tickDe = (jour: number, h: number): number =>
  (((h - leverDe(jour)) / 24) * TICKS_PER_CYCLE + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
/** La première heure (balayée au tick) où `f` atteint `cible`, depuis le milieu du jour.
 *  ⚠ `cycleOffset` étant 0, le `ct` balayé **est** le tick du monde : c'est ce qui permet de
 *  passer soit une forme rejouée, soit l'autorité elle-même. */
const bord = (f: (ct: number) => number, dt: number, jour: number, cible: number): number => {
  for (let ct = Math.floor(dt * 0.4); ct < TICKS_PER_CYCLE; ct++) if (f(ct) >= cible) return leverDe(jour) + (ct / TICKS_PER_CYCLE) * 24
  return NaN
}
/** La demi-rampe, en heures de monde. */
const DEMI_H = (NIGHT_RAMP_TICKS / 2 / TICKS_PER_CYCLE) * 24

describe('la lisière de nuit, pour l’œil (R5)', () => {
  // DEUX JOURS DE LONGUEURS TRÈS DIFFÉRENTES — un long (75, Pluies) et un court (105, Grand
  // Froid). Une loi écrite sur une durée de jour supposée serait prise en défaut par le second.
  for (const jour of [75, 105]) {
    it(`① jour ${jour} — la DEMI-NUIT tombe PILE au coucher du soleil, et HEAD la manquait d’une rampe`, () => {
      const sim = makeSim(jour)
      const dt = dayTicksAt(sim, 0)
      const coucher = coucherDe(jour)
      // PRÉMISSES : la rampe fait bien 90 min (sinon « pile » n'a pas de sens au centième), les
      // deux jours ne se ressemblent pas (sinon la boucle ne vaut qu'une épreuve), et l'autorité
      // est bien lue sur le cycle de CE jour-là (le piège ⓑ de `nuitDeLAutorite`).
      expect(DEMI_H * 2 * 60).toBeCloseTo(90, 6)
      expect(coucher).toBeGreaterThan(leverDe(jour) + 6)
      expect(sim.cycleOffset).toBe(0)
      expect(dayTicksAt(sim, TICKS_PER_CYCLE - 1)).toBe(dt)
      // LA LOI, LUE SUR L'AUTORITÉ — et non sur une formule recopiée dans ce fichier.
      expect(bord((ct) => nuitDeLAutorite(sim, ct), dt, jour, 0.5)).toBeCloseTo(coucher, 2)
      // LE CONTRÔLE POSITIF, REJOUÉ et non décrit : HEAD manque le coucher d'une rampe ENTIÈRE.
      expect(coucher - bord((ct) => HEAD(ct, dt), dt, jour, 0.5)).toBeCloseTo(DEMI_H * 2, 2)
    })

    it(`② jour ${jour} — la NUIT PLEINE tombe une demi-rampe APRÈS le coucher, là où HEAD la mettait AVANT`, () => {
      const sim = makeSim(jour)
      const dt = dayTicksAt(sim, 0)
      expect(bord((ct) => nuitDeLAutorite(sim, ct), dt, jour, 1)).toBeCloseTo(coucherDe(jour) + DEMI_H, 2)
      expect(bord((ct) => HEAD(ct, dt), dt, jour, 1)).toBeCloseTo(coucherDe(jour) - DEMI_H, 2)
    })

    it(`③ jour ${jour} — LE MATIN NE BOUGE PAS : ½ au lever, et tout l’avant-midi identique à 10⁻¹²`, () => {
      const sim = makeSim(jour)
      const dt = dayTicksAt(sim, 0)
      expect(nuitDeLAutorite(sim, Math.round(tickDe(jour, leverDe(jour))))).toBeCloseTo(0.5, 10)
      // L'AUTORITÉ ÉGALE HEAD SUR TOUT L'AVANT-MIDI : c'est cette inertie qui dit que R5 ne touche
      // QUE le soir — et elle compare bien la PRODUCTION à la forme d'avant, non deux formules.
      // ⚠ Douze décimales et non « au bit » : la division de la lune n'est pas l'identité en
      // IEEE754. ⚠ Le pas 13 et le seuil 300 sont des CHOIX ; ce qui est MESURÉ, c'est qu'ils
      // donnent 562 points au jour 75 et 381 au jour 105. Mon premier jet balayait par 97 et
      // exigeait « > 100 » sans avoir compté : `dt × 0,4 / 97` n'en donne que 76 et 51 — la garde
      // rougissait sur son propre seuil, pas sur la loi.
      let vus = 0
      for (let ct = 0; ct <= Math.floor(dt * 0.4); ct += 13) { expect(nuitDeLAutorite(sim, ct)).toBeCloseTo(HEAD(ct, dt), 12); vus++ }
      expect(vus).toBeGreaterThan(300) // non-vacuité : 562 au jour 75, 381 au jour 105 (rebalayés)
    })
  }

  it('④ LE SUPPORT EST BORNÉ — hors de la fenêtre du soir, rien ne bouge AU BIT, et un point DEDANS le prouve', () => {
    /**
     * ⚠⚠ **CETTE CLAUSE A ÉTÉ RÉÉCRITE : LA PREMIÈRE NE POUVAIT PAS ÉCHOUER** (relevé par
     * `determinisme-sim` à l'audit de fusion, D1). Elle comparait minuit, 3 h, midi et 23 h sur
     * cinq jours — et **20 points sur 20 sont SATURÉS** : la nuit y vaut exactement 0 ou exactement
     * 1 dans les deux régimes. Elle restait donc verte sous CINQ mutants, `+ 0` et `+ 2R` compris,
     * et même en défaisant la translation. Elle portait en plus un filler (`toBeTypeOf('function')`)
     * qui ne peut jamais rougir. *Une clause d'inertie posée sur des points saturés n'affirme rien.*
     *
     * La forme juste affirme ce qui est vraiment en jeu : **le support du changement est BORNÉ**.
     * MESURÉ par l'audit sur 8 640 000 points, la différence est confinée à
     * `ct − dt ∈ [−3374 ; 1124]`, soit l'intervalle ouvert `(dt − 3R/2, dt + R/2)`. On éprouve donc
     * les deux bords PAR L'EXTÉRIEUR — là où la loi POURRAIT différer et ne doit pas —, et **un
     * point DEDANS sert de contrôle positif** : sans lui, « identique » serait vrai d'un diff vide.
     */
    const R = NIGHT_RAMP_TICKS
    let vus = 0
    let dedansVus = 0
    for (const jour of [68, 75, 90, 105, 120]) {
      const sim = makeSim(jour)
      const dt = dayTicksAt(sim, 0)
      // JUSTE HORS DU SUPPORT, des deux côtés, et à une heure franche au-delà.
      for (const d of [-3 * R / 2 - 1, -3 * R / 2 - 1500, R / 2, R / 2 + 1500, -R * 4, R * 4]) {
        const ct = ((Math.round(dt + d) % TICKS_PER_CYCLE) + TICKS_PER_CYCLE) % TICKS_PER_CYCLE
        expect(nuitDeLAutorite(sim, ct)).toBeCloseTo(HEAD(ct, dt), 12)
        vus++
      }
      // LE CONTRÔLE POSITIF — au cœur du support, la prod et HEAD DOIVENT différer.
      const dedans = Math.round(dt - R / 2)
      expect(Math.abs(nuitDeLAutorite(sim, dedans) - HEAD(dedans, dt))).toBeGreaterThan(0.2)
      dedansVus++
    }
    expect(vus).toBe(30)
    expect(dedansVus).toBe(5)
  })


  it('⑤ LA LOI ARRIVE À `clarteDuCiel` — ½ au coucher, et les quatre bornes qui l’encadrent', () => {
    const jour = 75
    const sim = makeSim(jour)
    const dt = dayTicksAt(sim, 0)
    expect(sim.cycleOffset).toBe(0) // PRÉMISSE du piège ⓑ : sinon le tick posé ne vise plus ce jour
    const nuit = (h: number): number => {
      const tick = Math.round(tickDe(jour, h))
      // PRÉMISSES : le tick posé tombe dans le cycle de CE jour, et la lune n'est pas PLEINE —
      // sinon le diviseur s'annule et le ciel ne porte plus aucune information sur la nuit.
      expect(jourDeSaison(sim, debutDeCycle(sim, tick))).toBe(jour)
      expect(dayTicksAt(sim, tick)).toBe(dt)
      const t = gameTimeAt(sim, tick)
      expect(1 - clarteDeLune(t.seasonDay + t.jourFrac)).toBeGreaterThan(0.1)
      return nuitDeLAutorite(sim, tick)
    }
    const coucher = coucherDe(jour)
    // LA LOI : au coucher il reste exactement une demi-nuit. ⚠ Sous HEAD elle vaut 1 — nuit pleine
    // à l'instant du coucher. C'est là que ça rougit, et le contrôle positif le dit au chiffre.
    expect(nuit(coucher)).toBeCloseTo(0.5, 6)
    expect(HEAD(Math.round(tickDe(jour, coucher)), dt)).toBeCloseTo(1, 6)
    // Les deux bornes qui l'encadrent le soir : rien avant, tout après.
    expect(nuit(coucher - DEMI_H)).toBeCloseTo(0, 6)
    expect(nuit(coucher + DEMI_H)).toBeCloseTo(1, 6)
    // LE MIROIR DU MATIN, par la même porte : une demi-nuit au lever, rien une demi-rampe après.
    expect(nuit(leverDe(jour))).toBeCloseTo(0.5, 6)
    expect(nuit(leverDe(jour) + DEMI_H)).toBeCloseTo(0, 6)
  })
})
