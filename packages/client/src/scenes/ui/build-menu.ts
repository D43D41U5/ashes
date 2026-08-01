/**
 * LE MENU DU MARTEAU (spec construction R20) — SÉPARÉ du panneau d'artisanat.
 *
 * Le marteau EN MAIN ouvre ce menu ; on y choisit une PIÈCE STRUCTURELLE (mur,
 * porte, sol, toit) qui ARME le fantôme (`selected`). Ranger le marteau le referme et
 * désarme (R21) — les fantômes structurels disparaissent avec l'outil. Les COMPOSANTS
 * (enclume, four…) n'y sont PAS : ce sont des objets qu'on tient et pose.
 *
 * Pour mur/porte, une barre choisit le PALIER DE MATÉRIAU (bois → pierre → métal, R8) :
 * la pose neuve prend ce matériau, et cliquer un mur existant l'AMÉLIORE vers lui.
 *
 * Rendu ISO à la maquette Turn 4A, en DOM (voir `hud-dom.ts`) : panneau vertical au
 * bord GAUCHE, 4 pièces (armé / faisable / grisé), la barre de matériau à 3 onglets.
 * Le fantôme, lui, reste dans le monde (Phaser) : il est ancré à la TUILE. Comme tout
 * le HUD, ce panneau ne DÉCIDE rien : il arme une intention, la sim revalide la pose.
 */
import { BARRIER_TYPES, STRUCTURE_COSTS, WALL_TIERS, hasItems, matiereChiffre, matieresDe, piece, type Famille, type Inventory, type ItemBag, type Matiere, type WallMaterial } from '@ashes/sim'
import { createCatalogue } from './catalogue'
import { coutJetons } from './craft-panel'
import type { Buildable } from '../../hud-state'

/**
 * Les pièces du menu du marteau (spec construction R20) — DÉRIVÉES du registre
 * (`pieces.ts`, geste de pose `marteau`), plus écrites ici.
 *
 * C'était l'une des « six listes écrites à la main que le compilateur ne gardait pas »
 * du commit de la palissade : ajouter une barrière obligeait à venir la nommer ici, et
 * à lui redonner un libellé français qui vivait déjà à côté de son coût. Une barrière
 * neuve apparaît désormais toute seule, avec son nom.
 */
export const BUILDABLES = BARRIER_TYPES
export const BUILDABLE_LABEL: Record<Buildable, string> = Object.fromEntries(
  BARRIER_TYPES.map((t) => [t, piece(t).label]),
) as Record<Buildable, string>
const MATERIALS: readonly WallMaterial[] = ['wood', 'stone', 'metal']
const MATERIAL_LABEL: Record<WallMaterial, string> = { wood: 'BOIS', stone: 'PIERRE', metal: 'MÉTAL' }

/**
 * Le coût d'une pièce, matière comprise (spec construction R8, D3).
 *
 * C'EST LA PIÈCE QUI DIT si sa matière compte (`matiereChiffre`, registre) — plus une
 * condition écrite ici. Le sol, le toit et la palissade retombent donc sur leur coût de
 * base sans être nommés, et une pièce structurelle neuve à paliers entre toute seule.
 */
export function pieceCost(p: Buildable, material: Matiere): ItemBag {
  if (matiereChiffre(p) && (p === 'wall' || p === 'door')) return WALL_TIERS[material][p].cost
  return STRUCTURE_COSTS[p]
}

export interface BuildMenu {
  /** Rafraîchit l'affichage (grisé selon la bourse). */
  update(inv: Inventory): void
  setVisible(v: boolean): void
  /** La pièce armée (le fantôme la suit), ou `null`. */
  armed(): Buildable | null
  /** Le palier de matériau choisi pour mur/porte. */
  material(): WallMaterial
  /** LE MODE DÉMOLIR est-il armé ? Exclusif de `armed()` (l'un éteint l'autre). */
  demolir(): boolean
  /** Ranger le marteau : désarme et referme (R21). */
  disarm(): void
}

export function createBuildMenu(board: HTMLElement): BuildMenu {
  let armed: Buildable | null = null
  let demolir = false
  let materialIdx = 0
  let inv: Inventory = []

  const root = document.createElement('div')
  root.className = 'bmn'
  root.innerHTML = markup()
  board.appendChild(root)

  // LE CATALOGUE PARTAGÉ (2026-08-01) : le marteau y gagne d'un coup les rayons, la
  // recherche et le défilement, qui n'existaient que côté artisanat. Sans eux, un
  // catalogue de housing (des dizaines de pièces) serait injouable — et il arrive.
  const cat = createCatalogue(root.querySelector<HTMLElement>('.bmn-cat')!, {
    titre: 'CONSTRUCTION',
    sousTitre: 'RANGER LE MARTEAU POUR DÉSARMER',

    // ON ARME MÊME CE QU'ON NE PEUT PAS PAYER : le fantôme montre alors ce qui manque, et
    // c'est la façon la plus courte d'apprendre le coût d'une pièce.
    clicSiIndisponible: true,
    onChoix: (cle) => {
      const piece = cle as Buildable
      armed = armed === piece ? null : piece // bascule : recliquer désarme
      demolir = false // les deux modes s'excluent : armer une pièce éteint la démolition
      draw()
    },
  })

  // LE MODE DÉMOLIR (décision d'Alexis, 2026-08-01) : le marteau défait ce qu'il a fait.
  // Un BOUTON, pas une touche ni un clic droit — le geste doit se VOIR (le clic droit avait
  // justement été débranché le 2026-07-12 avec tous les verbes invisibles, cf. `keymap.ts`).
  const dem = root.querySelector<HTMLElement>('.bmn-dem')!
  dem.addEventListener('click', () => {
    demolir = !demolir
    if (demolir) armed = null // …et l'inverse : on ne pose pas en cassant
    draw()
  })

  const tabs = MATERIALS.map((mat, i) => {
    const el = document.createElement('div')
    el.className = 'bmn-tab hud-click'
    el.textContent = MATERIAL_LABEL[mat]
    el.addEventListener('click', () => {
      materialIdx = i
      draw()
    })
    root.querySelector('.bmn-tabs')!.appendChild(el)
    return el
  })
  const palier = root.querySelector<HTMLElement>('.bmn-palier')!

  const draw = (): void => {
    const material = MATERIALS[materialIdx]!
    cat.update(
      BUILDABLES.map((p) => {
        const cost = pieceCost(p, material)
        const ready = hasItems(inv, cost)
        return {
          cle: p,
          nom: piece(p).label,
          // LE RAYON VIENT DU REGISTRE (`fam`) : un lot de pièces neuves apporte son
          // propre rayon sans qu'on touche à cette UI.
          rayon: RAYON_LABEL[piece(p).fam] ?? piece(p).fam.toUpperCase(),
          couts: coutJetons(cost, inv),
          detail: piece(p).arete === 'requise' ? 'sur une arête' : undefined,
          etat: ready ? ('faisable' as const) : ('manque' as const),
          armee: armed === p,
        }
      }),
    )
    tabs.forEach((t, i) => t.classList.toggle('bmn-tab-on', i === materialIdx))
    dem.classList.toggle('bmn-dem-on', demolir)
    dem.innerHTML = `<div class="bmn-dem-t">⛏ DÉMOLIR${demolir ? ' — ARMÉ' : ''}</div>
      <div class="bmn-dem-s">${demolir ? 'CLIQUER MA CONSTRUCTION POUR LA DÉTRUIRE' : 'DÉFAIRE MES CONSTRUCTIONS · MOITIÉ RENDUE'}</div>`
    // QUI SUIT LE PALIER se LIT du registre : la barre nomme les pièces concernées au
    // lieu de les supposer, donc une pièce neuve à paliers s'y annonce d'elle-même.
    const suivent = BUILDABLES.filter((p) => matieresDe(p).length > 1).map((p) => piece(p).label)
    palier.textContent = `PALIER ${materialIdx + 1} / ${MATERIALS.length} · ${suivent.join(' & ')} ${suivent.length > 1 ? 'suivent' : 'suit'} le palier`
  }
  draw()

  return {
    update(nextInv) {
      inv = nextInv
      draw()
    },
    setVisible(v) {
      // Explicite `flex` (pas `''`) : la règle CSS `.bmn{display:none}` reprendrait sinon.
      root.style.display = v ? 'flex' : 'none'
    },
    armed: () => armed,
    material: () => MATERIALS[materialIdx]!,
    demolir: () => demolir,
    disarm() {
      armed = null
      // RANGER LE MARTEAU ÉTEINT AUSSI LA DÉMOLITION (R21) : un mode destructeur qui
      // survivrait à l'outil se rallumerait au prochain marteau en main, sans qu'on l'ait
      // demandé — et le premier clic casserait quelque chose.
      demolir = false
      draw()
    },
  }
}

/** Le nom d'un rayon à l'écran. Une famille absente retombe sur son identifiant en capitales. */
const RAYON_LABEL: Partial<Record<Famille, string>> = {
  ancre: 'LE FEU',
  structure: 'STRUCTURE',
  composant: 'COMPOSANTS',
  mobilier: 'MOBILIER',
  ferme: 'FERME',
  vestige: 'VESTIGES',
  heritage: 'ANCIEN',
}

function markup(): string {
  return `
  <style>
    /* SOUS LE BANDEAU DE JOUR (MESURÉ, 2026-08-01) : le titre du panneau et « JOUR 1 —
       ACTE I — 09H » tombaient tous deux à y=56, l'un par-dessus l'autre, et « VILLAGE :
       4 MEMBRES » sous « RANGER LE MARTEAU ». Deux textes superposés ne se lisent ni l'un
       ni l'autre. Le décalage part du BAS mesuré du bandeau (67 px dans le repère du
       plateau), pas d'un nombre choisi à l'œil. */
    .bmn{position:absolute;left:0;top:72px;bottom:150px;width:340px;background:rgba(20,16,12,.86);
      border-right:3px solid #14141a;border-bottom:3px solid #14141a;padding:24px 20px;display:none;flex-direction:column;pointer-events:auto;}
    .bmn-cat{flex:1;min-height:0;display:flex;flex-direction:column;}
    .bmn-mat{margin-top:16px;border:2px solid #6b5a3a;background:rgba(107,90,58,.12);padding:13px;flex:0 0 auto;}
    .bmn-mat-h{font-size:11px;color:#9a8f78;letter-spacing:1px;margin-bottom:10px;}
    .bmn-tabs{display:flex;gap:0;border:2px solid #14141a;}
    .bmn-tab{flex:1;text-align:center;font-size:12px;padding:8px 0;background:#1b1b22;color:#8b8474;letter-spacing:1px;}
    .bmn-tab.bmn-tab-on{background:#e8c66a;color:#14100c;font-weight:700;}
    .bmn-palier{font-size:11px;color:#8b8474;letter-spacing:1px;margin-top:8px;}
    /* LE MODE DÉMOLIR — bloc FRÈRE du matériau, pas une vignette du catalogue : le catalogue
       liste ce qu'on POSE, et il se dérive du registre (une entrée factice y salirait la
       liste). Rouge éteint tant qu'il dort, plein quand il est armé — un mode destructeur
       doit se voir d'un coup d'œil, de la même façon que l'onglet de matériau actif. */
    .bmn-dem{margin-top:12px;border:2px solid #7a3b32;background:rgba(217,97,79,.10);padding:11px 13px;flex:0 0 auto;cursor:pointer;}
    .bmn-dem-t{font-size:12px;color:#d98a7a;letter-spacing:1px;font-weight:700;}
    .bmn-dem-s{font-size:11px;color:#8b8474;letter-spacing:1px;margin-top:5px;}
    .bmn-dem.bmn-dem-on{background:#d9614f;border-color:#d9614f;}
    .bmn-dem.bmn-dem-on .bmn-dem-t{color:#14100c;}
    /* #2a0f0a et pas #3b1a14 : sur le rouge plein, le second ne tenait que 4,3:1 — sous les
       4,5:1 exigés d'un petit texte. Celui-ci monte à 4,9:1. */
    .bmn-dem.bmn-dem-on .bmn-dem-s{color:#2a0f0a;}
  </style>
  <div class="bmn-cat"></div>
  <div class="bmn-mat">
    <div class="bmn-mat-h">MATÉRIAU — CLIQUER POUR CYCLER</div>
    <div class="bmn-tabs"></div>
    <div class="bmn-palier"></div>
  </div>
  <div class="bmn-dem hud-click"></div>`
}
