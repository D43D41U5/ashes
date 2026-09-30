import { describe, expect, it } from 'vitest'
import { BALANCE, TICKS_PER_CYCLE, TICKS_PER_SEASON_DAY, seasonDayAtTick } from '@ashes/sim'
import { VEILLEE_CALENDAR_SCALE, VEILLEE_SEASON_CYCLES } from './veillee'

/**
 * L'HORLOGE DE LA VEILLÉE (décision d'Alexis 2026-08-23, cycle porté à 30 min le 2026-08-24).
 *
 * Ce que garde ce bloc, c'est la CONSTANTE EXPORTÉE — pas la formule qui la calcule. Le
 * défaut vivait très exactement là : `calendarScaleForSeasonCycles` était juste, et la
 * Veillée lui passait 6.
 */
describe('la Veillée compte ses jours sur le cycle', () => {
  it('un jour de saison = un cycle jour/nuit', () => {
    expect(VEILLEE_SEASON_CYCLES).toBe(BALANCE.SEASON_DAYS)
    expect(VEILLEE_CALENDAR_SCALE).toBe(TICKS_PER_SEASON_DAY / TICKS_PER_CYCLE)
    // Dit autrement, et c'est la phrase du joueur : au bout d'un cycle, le compteur a
    // avancé de UN. À l'ancienne échelle (300), il avançait de dix. Le jour d'ouverture
    // (S2) n'entre pas dans l'affaire — c'est un ÉCART qu'on mesure, il s'annule — mais on
    // le passe tel que la Veillée le passe, pour que la mesure soit celle du vrai monde.
    const jour = (tick: number): number => seasonDayAtTick(tick, VEILLEE_CALENDAR_SCALE, BALANCE.JOUR_DE_DEPART)
    expect(jour(TICKS_PER_CYCLE) - jour(0)).toBe(1)
  })
})

/*
 * ⚠ ═══ PEUPLER LA VEILLÉE (V1-10, racine R-A) N'A PLUS DE GARDE ═══
 * ⚠ V-A2 A VÉCU ICI — « fonde ses voisins PNJ, à portée du joueur, pas au pas de sa porte »
 * (spec `ascension.md`). Gelée par `FEATURES.VILLAGES_PNJ` le 2026-09-26, SUPPRIMÉE le
 * 2026-09-29 avec la fondation elle-même (tranche 4 du retrait des villages PNJ).
 *
 * ⚠ CE QU'ELLE MESURAIT ET QUE PLUS PERSONNE NE MESURE : **« on rencontre un village »**, avec
 * ses deux bornes, toutes deux payées par un défaut réel — un PLANCHER à 40 tuiles (l'Ermitage,
 * décision du 2026-07-22 : pas de raid au pas de la porte) et un PLAFOND à deux écarts de
 * village (`MONDE.ESPACEMENT_VILLAGES`), au-delà duquel le joueur pouvait jouer une saison
 * entière sans en croiser un — « ce qui est très exactement ce qui se passait ».
 *
 * `createVeillee` élit toujours les sites et trace toujours les sentes ; il ne fonde plus rien
 * au bout. La promesse revient avec les BALISES (`braise.md`), et c'est là qu'il faudra
 * réécrire la garde avec ses deux bornes : ce qu'on rencontre en montant n'est plus un
 * village, c'est un feu qu'on rallume — mais « ni sur le seuil, ni hors d'atteinte » vaudra
 * mot pour mot.
 */
