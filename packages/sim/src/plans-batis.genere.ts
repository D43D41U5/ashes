/**
 * ═══ GÉNÉRÉ PAR tools/plans-compile.mts — NE PAS ÉDITER À LA MAIN ═══
 *
 * La source de chaque plan est packages/sim/src/plans/<kind>.plan (la prose du lieu y vit,
 * en lignes #). Régénérer : `pnpm plans` — ou sauvegarder depuis l'Atelier, qui relance le
 * même émetteur. La garde `plans-batis.test.ts` rougit si ce fichier diverge des .plan.
 */
import type { Plan } from './plan-format'

export const PLANS: Record<string, Plan> = {
  abri: {
    usure: 0.8,
    grille: [
      '····',
      '·::·',
      '·L:·',
      '·G··',
    ],
    breches: ['1,2,S', '2,2,S'],
  },
  bivouac: {
    usure: 0.8,
    grille: [
      'l··',
      '·Ft',
      '·G·',
    ],
  },
  cabane: {
    usure: 1,
    grille: [
      '·····',
      '·:::·',
      '·L:K·',
      '·:::·',
      '·····',
    ],
    seuils: ['2,3,S'],
  },
  charrette: {
    usure: 0.7,
    grille: [
      '··G',
      '·C·',
      '·t·',
    ],
  },
  epave: {
    usure: 0.35,
    grille: [
      '····',
      '·Cp·',
      '·pG·',
      'G···',
    ],
  },
  ferme_ruinee: {
    usure: 0.45,
    fixe: true,
    grille: [
      '··················',
      '··················',
      '·.A....E....·xxx··',
      '·L.........o·xxxx·',
      '·L..Tb......·xxxx·',
      '·...Tb.....K·xxx··',
      '·..P.......E··xxx·',
      '·...........·xxxx·',
      '·,M,,,,a,,,,·xxx··',
      '·,,g,,,,,,,,··xx··',
      '·,,,,,,,g,,,···x··',
      '·,,,,,,,,,,,······',
      '·,,,,,,,,,,,······',
      '··················',
      '···xxxxx··········',
      '··xxxxxx··········',
      '···xxxx···········',
      '··················',
    ],
    breches: ['11,4,E', '11,5,E'],
    seuils: ['4,7,S', '5,7,S'],
    passages: ['4,12,S', '5,12,S'],
  },
  grotte: {
    usure: 1,
    grille: [
      '·HHHHH·',
      '·HrrrH·',
      '·HrrrH·',
      '·HrrrH·',
      '·HH·HH·',
      '··e·e··',
      '·······',
    ],
    passages: ['3,3,S'],
  },
  mine: {
    usure: 0.55,
    grille: [
      '·HHHH··',
      '·HrrH··',
      '·HrrH·D',
      '·HHnH·w',
      '··G··I·',
      '·G··G·p',
      '·······',
    ],
    passages: ['3,2,S'],
  },
  oratoire: {
    usure: 0.6,
    grille: [
      'm·m',
      '·U·',
      'm·G',
    ],
  },
  ruines: {
    usure: 0.25,
    grille: [
      '······',
      '·....·',
      '·.P..m',
      '·....·',
      '·....·',
      '··G··G',
    ],
    breches: ['4,2,E', '2,4,S'],
  },
}
