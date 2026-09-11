/**
 * LES LOIS DU VOL — les gardes du chantier « oiseaux » (Alexis, 2026-09-08 : « fais tout »).
 *
 * Ce qui est éprouvé ici n'est PAS « la fonction rend un nombre » : c'est que chaque loi tienne
 * la promesse pour laquelle elle a été écrite, et chacune peut casser sans que rien d'autre ne
 * rougisse —
 *   · l'heure du VOL est celle du CHANT (le défaut d'origine était l'écart entre les deux) ;
 *   · le ciel est VIDE la nuit, franchement, et la pente n'a aucune cassure ;
 *   · l'aube n'appartient qu'aux passereaux, et le rapace ne plane pas au-dessus d'un lac ;
 *   · une aile fait l'aller-retour, jamais la boucle (une boucle est un claquement) ;
 *   · une nuée levée part du SOL — c'est ce qui la distingue d'un sprite qui apparaît.
 */
import { describe, expect, it } from 'vitest'
import { TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_HEATH, TERRAIN_GRASS, TERRAIN_OLD_GROWTH } from '@ashes/sim'
import { chantsDensite } from '../audio/aube'
import { GABARITS } from './oiseau-art'
import {
  altitudeDeMontee,
  densiteDeVol,
  especeDuVol,
  imageDAile,
  IMAGES_AILE,
  MONTEE_S,
  RAPACE_A,
  RAPACE_DE,
  teinteDuVol,
  VOL_AUBE_DE,
  VOL_AUBE_FIN,
  VOL_AUBE_PLEIN,
  VOL_JOUR,
  VOL_NUIT_A,
  type EspeceOiseau,
} from './vol-des-oiseaux'

const PAS = 1 / 512 // le balayage : 12 288 échantillons sur les 24 heures

describe('① l’heure — combien le ciel porte de vols', () => {
  it('LA NUIT EST VIDE, franchement — et c’est ce qui fait exister le passage', () => {
    for (let h = VOL_NUIT_A; h < 24; h += PAS) expect(densiteDeVol(h), `h=${h}`).toBe(0)
    for (let h = 0; h <= VOL_AUBE_DE; h += PAS) expect(densiteDeVol(h), `h=${h}`).toBe(0)
  })

  it('L’AUBE EST LE PLEIN, le jour un régime calme, le soir un regain', () => {
    expect(densiteDeVol(VOL_AUBE_PLEIN)).toBe(1)
    expect(densiteDeVol(VOL_AUBE_FIN)).toBe(1)
    expect(densiteDeVol(12)).toBeCloseTo(VOL_JOUR, 6)
    // Le regain du dortoir : plus dense que le plein jour, moins que le chœur du matin.
    const soir = densiteDeVol(19)
    expect(soir).toBeGreaterThan(densiteDeVol(12))
    expect(soir).toBeLessThan(densiteDeVol(VOL_AUBE_PLEIN))
  })

  it('LES BORNES DU MATIN SONT CELLES DE L’AUDIO — la promesse entière du chantier ③', () => {
    // Le défaut d'origine : on ENTENDAIT les oiseaux à l'aube et on les VOYAIT passer à trois
    // heures du matin. Cette garde affirme l'accord des deux horloges au point où il compte —
    // l'ouverture et le plein du chœur. Elle rougit si l'un des deux fichiers bouge seul.
    for (const h of [VOL_AUBE_DE, VOL_AUBE_PLEIN, VOL_AUBE_FIN]) {
      expect(densiteDeVol(h) > 0, `h=${h}`).toBe(chantsDensite(h) > 0)
    }
    // Et le noyau du chœur est plein des deux côtés.
    for (let h = VOL_AUBE_PLEIN; h <= VOL_AUBE_FIN; h += PAS) {
      expect(chantsDensite(h), `chant h=${h}`).toBe(1)
      expect(densiteDeVol(h), `vol h=${h}`).toBe(1)
    }
    // ⚠ LÀ OÙ ELLES DIVERGENT, ET C'EST VOULU : le chant s'éteint à 8h45, le vol non — un
    // oiseau vole encore quand il a fini de chanter. C'est la seule divergence permise, et
    // l'affirmer ici empêche qu'on « répare » l'accord en vidant le ciel du jour.
    expect(chantsDensite(12)).toBe(0)
    expect(densiteDeVol(12)).toBeGreaterThan(0)
  })

  it('LA PENTE N’A AUCUNE CASSURE, sur les 24 heures — balayage exhaustif', () => {
    // Une garde exhaustive plutôt que quatre points choisis : deux échantillons voisins ne
    // peuvent pas s'écarter de plus que la pente la plus raide du profil (celle de l'aube,
    // 1 en 1,2 h), avec une marge d'un pour mille.
    const PENTE_MAX = (1 / (VOL_AUBE_PLEIN - VOL_AUBE_DE)) * PAS * 1.001
    let precedent = densiteDeVol(0)
    for (let h = PAS; h < 24; h += PAS) {
      const d = densiteDeVol(h)
      expect(Math.abs(d - precedent), `saut à h=${h}`).toBeLessThanOrEqual(PENTE_MAX)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
      precedent = d
    }
  })

  it('l’heure se replie : 25 h vaut 1 h, −1 h vaut 23 h', () => {
    expect(densiteDeVol(25)).toBe(densiteDeVol(1))
    expect(densiteDeVol(-1)).toBe(densiteDeVol(23))
  })
})

describe('② la teinte — de quel moment l’oiseau est habillé', () => {
  it('l’aube est FROIDE, le couchant CHAUD, et midi neutre', () => {
    const froid = teinteDuVol(5.5)
    const chaud = teinteDuVol(20)
    const r = (c: number): number => (c >> 16) & 0xff
    const b = (c: number): number => c & 0xff
    expect(b(froid), 'l’aube doit tirer sur le bleu').toBeGreaterThan(r(froid))
    expect(r(chaud), 'le couchant doit tirer sur le rouge').toBeGreaterThan(b(chaud))
    expect(teinteDuVol(12)).toBe(0xffffff)
  })

  it('elle ne SAUTE jamais — aucun canal ne bouge de plus de 2 entre deux instants voisins', () => {
    const canaux = (c: number): [number, number, number] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
    let p = canaux(teinteDuVol(0))
    for (let h = PAS; h < 24; h += PAS) {
      const c = canaux(teinteDuVol(h))
      for (let k = 0; k < 3; k++) expect(Math.abs(c[k]! - p[k]!), `saut de teinte à h=${h}`).toBeLessThanOrEqual(2)
      p = c
    }
  })
})

describe('③ l’espèce — le lieu et l’heure la choisissent', () => {
  const tousLesTerrains = Object.keys(TERRAINS).map(Number)

  it('L’AUBE N’APPARTIENT QU’AUX PASSEREAUX — sur les 31 terrains et tous les tirages', () => {
    // Sans cette priorité, le chœur du matin serait un vol de corvidés au-dessus du moindre pré.
    for (const t of tousLesTerrains) {
      for (let x = 0; x < 1; x += 0.05) {
        for (const h of [5, 6, 7, 8, 8.7]) {
          expect(especeDuVol(t, h, x), `terrain ${t} h=${h} tirage=${x}`).toBe('passereau')
        }
      }
    }
  })

  it('LE RAPACE NE PLANE QUE SUR LE HAUT PAYS NU, et seulement quand l’air porte', () => {
    // Une règle, pas une liste : on balaie les 31 terrains, et pour chacun on affirme que le
    // rapace n'apparaît QUE là où le relief nu l'autorise. Un terrain neuf classé « pierre »
    // entre de lui-même ; un terrain neuf ailleurs ne peut pas faire apparaître de planeur.
    const admis = new Set<number>()
    for (const t of tousLesTerrains) {
      if (especeDuVol(t, 12, 0) === 'rapace') admis.add(t)
    }
    expect(admis.size, 'aucun terrain n’admet le rapace — la règle est morte').toBeGreaterThan(0)
    expect(admis.has(TERRAIN_HEATH), 'la lande doit porter le planeur').toBe(true)
    expect(admis.has(TERRAIN_DEEP_WATER), 'un lac ne porte pas de planeur').toBe(false)
    expect(admis.has(TERRAIN_OLD_GROWTH), 'une futaie fermée ne porte pas de planeur').toBe(false)
    // ET LA FENÊTRE MORD : hors des ascendances, le même sol et le même tirage ne rendent rien.
    for (const t of admis) {
      expect(especeDuVol(t, RAPACE_DE - 0.1, 0), `terrain ${t} avant la fenêtre`).not.toBe('rapace')
      expect(especeDuVol(t, RAPACE_A + 0.1, 0), `terrain ${t} après la fenêtre`).not.toBe('rapace')
      expect(especeDuVol(t, (RAPACE_DE + RAPACE_A) / 2, 0), `terrain ${t} dans la fenêtre`).toBe('rapace')
    }
  })

  it('LE SOL NE DÉCIDE JAMAIS SEUL : chaque lieu laisse sa part au passereau', () => {
    // Un ciel qui ne montrerait QUE des corbeaux au-dessus d'un pré serait un motif, pas un
    // lieu. On affirme donc que le tirage haut rend toujours le passereau, partout.
    for (const t of tousLesTerrains) {
      expect(especeDuVol(t, 12, 0.999), `terrain ${t}`).toBe('passereau')
    }
    // …et que le pré, lui, sait bien porter un corvidé.
    expect(especeDuVol(TERRAIN_GRASS, 12, 0)).toBe('corbeau')
  })

  it('les trois espèces ont toutes un gabarit, et aucune n’est injoignable', () => {
    // La garde d'ATTEIGNABILITÉ du tétras, transposée : une espèce licite et que rien ne peut
    // élire serait du code mort qui a l'air vivant.
    const vues = new Set<EspeceOiseau>()
    for (const t of tousLesTerrains) for (const h of [6, 12, 14, 18]) for (const x of [0, 0.6, 0.99]) vues.add(especeDuVol(t, h, x))
    expect([...vues].sort()).toEqual(['corbeau', 'passereau', 'rapace'])
    for (const e of vues) expect(GABARITS[e], `gabarit manquant pour ${e}`).toBeDefined()
  })
})

describe('④ le battement — une aile bat en changeant d’envergure', () => {
  it('l’aile fait l’ALLER-RETOUR, jamais la boucle : 2 ne suit jamais 0', () => {
    // Une boucle 0-1-2-0 saute du replié au tendu : un claquement. La garde balaie un cycle
    // complet à pas fin et affirme qu'aucune transition ne saute d'image.
    const vus: number[] = []
    for (let t = 0; t < 4; t += 1 / 4096) vus.push(imageDAile(t, 1, 0))
    for (let i = 1; i < vus.length; i++) {
      expect(Math.abs(vus[i]! - vus[i - 1]!), `saut ${vus[i - 1]} → ${vus[i]}`).toBeLessThanOrEqual(1)
    }
    expect(new Set(vus).size, 'les trois images doivent servir').toBe(IMAGES_AILE)
    expect(Math.min(...vus)).toBe(0)
    expect(Math.max(...vus)).toBe(IMAGES_AILE - 1)
  })

  it('l’index reste dans les images existantes, même sur un temps négatif ou une phase folle', () => {
    for (const t of [-100, -1.7, 0, 3.3, 1e5]) {
      for (const ph of [-3, 0, 0.5, 17]) {
        const i = imageDAile(t, 5, ph)
        expect(Number.isInteger(i), `t=${t} ph=${ph}`).toBe(true)
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(IMAGES_AILE)
      }
    }
  })

  it('LE GABARIT DIT UN BATTEMENT, pas un rétrécissement : l’aile se REPLIE en flèche', () => {
    // La garde exhaustive sur les trois espèces. Deux propriétés, et les deux comptent : une
    // envergure qui décroît (l'aile rentre) ET une flèche qui croît (elle part en arrière).
    // Sans la seconde, l'aile rentrerait tout droit et l'oiseau rapetisserait au lieu de battre.
    for (const [nom, g] of Object.entries(GABARITS)) {
      expect(g.envergures.length, nom).toBe(IMAGES_AILE)
      for (let i = 1; i < IMAGES_AILE; i++) {
        expect(g.envergures[i]!, `${nom} envergure ${i}`).toBeLessThan(g.envergures[i - 1]!)
        expect(g.fleches[i]!, `${nom} flèche ${i}`).toBeGreaterThan(g.fleches[i - 1]!)
      }
      // ET L'ENVERGURE TIENT DANS LE CANEVAS : une aile coupée par le bord de la texture est
      // un oiseau amputé, et rien à l'écran ne dirait d'où vient la coupe.
      expect(g.envergures[0]! * 2 + 2, `${nom} déborde de sa texture`).toBeLessThanOrEqual(g.cote)
      expect(g.corpsL + g.queueL, `${nom} : corps + queue déborde`).toBeLessThanOrEqual(g.cote)
      // ① CE QUI DÉPASSE DÉPASSE VRAIMENT : ailes tendues plus longues que la demi-longueur
      // du corps — « un oiseau dont les ailes tiennent dans sa silhouette n'a l'air que rapide ».
      expect(g.envergures[0]!, `${nom} : des ailes qui ne dépassent pas`).toBeGreaterThan(g.corpsL / 2)
    }
  })
})

describe('⑤ l’altitude — ce qui pose l’oiseau dans le monde', () => {
  it('une nuée levée part du SOL et atteint sa hauteur au bout de la montée', () => {
    expect(altitudeDeMontee(0)).toBe(0)
    expect(altitudeDeMontee(-1)).toBe(0)
    expect(altitudeDeMontee(MONTEE_S)).toBe(1)
    expect(altitudeDeMontee(MONTEE_S * 10)).toBe(1)
  })

  it('elle MONTE sans jamais redescendre, et sans cassure — balayage', () => {
    const p = MONTEE_S / 4096
    const PENTE_MAX = 1.5 * (p / MONTEE_S) * 1.001 // le smoothstep culmine à 1,5 en pente
    let precedent = altitudeDeMontee(0)
    for (let t = p; t <= MONTEE_S; t += p) {
      const a = altitudeDeMontee(t)
      expect(a, `t=${t}`).toBeGreaterThanOrEqual(precedent)
      expect(a - precedent, `saut à t=${t}`).toBeLessThanOrEqual(PENTE_MAX)
      precedent = a
    }
  })

  it('elle DÉMARRE et S’ARRÊTE en douceur : les deux bouts ont une pente nulle', () => {
    // C'est le sens du smoothstep (même raison que `fondu-essaim.adoucir`) : ce sont les
    // CASSURES de pente que l'œil attrape, pas la vitesse. Une rampe linéaire se verrait
    // démarrer — et l'envol partirait comme un ascenseur.
    const eps = MONTEE_S / 1000
    expect(altitudeDeMontee(eps)).toBeLessThan(0.01)
    expect(1 - altitudeDeMontee(MONTEE_S - eps)).toBeLessThan(0.01)
    // …contre le milieu, qui lui avance vraiment.
    expect(altitudeDeMontee(MONTEE_S / 2)).toBeCloseTo(0.5, 6)
  })

  it('chaque espèce vole à SA hauteur, et le planeur est le plus haut', () => {
    expect(GABARITS.rapace.altitude).toBeGreaterThan(GABARITS.corbeau.altitude)
    expect(GABARITS.corbeau.altitude).toBeGreaterThan(GABARITS.passereau.altitude)
    for (const [nom, g] of Object.entries(GABARITS)) {
      expect(g.altitude, `${nom}`).toBeGreaterThan(0)
      expect(g.altitude, `${nom}`).toBeLessThanOrEqual(1)
    }
  })
})
