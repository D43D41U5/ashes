/**
 * ═══ LE CATALOGUE — UN SEUL COMPOSANT, DEUX MENUS ═══
 *
 * Le menu du marteau et le panneau d'artisanat affichaient la MÊME ligne — icône, nom,
 * coût avec le manquant en rouge, état — écrite deux fois, avec deux règles de groupage
 * et une seule recherche. Deux copies d'une règle finissent toujours par diverger : le
 * marteau grisait ce qu'on ne pouvait pas payer, l'artisanat CACHAIT ce dont la station
 * manquait, et sa note « stations absentes » était restée à trois entrées sur cinq.
 *
 * Ici, une liste, nourrie par des DESCRIPTEURS. Elle apporte du même geste au marteau ce
 * que seul l'artisanat avait : les rayons, la recherche et le défilement — ce sans quoi
 * un catalogue de quarante pièces de housing serait injouable.
 *
 * CE QU'ELLE NE FAIT PAS : décider. Elle ne connaît ni recette, ni pièce, ni sac — elle
 * peint ce qu'on lui donne et rend les clics. Les deux appelants gardent leur logique,
 * pure et testée de leur côté (`craftRows`, `pieceCost`).
 */

/** L'état d'une entrée — trois, et le troisième est le nouveau (D2/D3). */
export type EtatEntree =
  /** On peut le faire ici et maintenant. */
  | 'faisable'
  /** Le lieu convient, la bourse non — une invitation à aller chercher ce qui manque. */
  | 'manque'
  /** Le lieu ne convient pas encore : la ligne reste, avec sa RAISON en toutes lettres. */
  | 'verrouille'

export interface EntreeCatalogue {
  /** Identifiant stable — c'est lui que le clic rend. */
  cle: string
  nom: string
  /** Le rayon sous lequel la ranger. Les rayons vides ne s'affichent pas. */
  rayon: string
  /** Le coût, jeton par jeton — celui qui manque se peint en rouge (`coutJetons`). */
  couts: readonly { texte: string; manque: boolean }[]
  /** Où et comment : « au Feu », « à un Atelier N1 », « sur une arête ». */
  detail?: string | undefined
  etat: EtatEntree
  /** Pourquoi c'est verrouillé — affiché à la place de l'état. */
  raison?: string | undefined
  /** L'entrée est ARMÉE (le fantôme la suit). Le marteau s'en sert, l'artisanat non. */
  armee?: boolean
  /** URL d'icône, si l'appelant en a une. */
  icone?: string | undefined
}

export interface Catalogue {
  /** Remplace le contenu. Ne redessine QUE si la signature a changé. */
  update(entrees: readonly EntreeCatalogue[]): void
  setVisible(v: boolean): void
  /** La recherche a-t-elle le clavier ? (le déplacement se coupe alors) */
  saisitDuTexte(): boolean
  racine(): HTMLElement
}

export interface OptionsCatalogue {
  titre: string
  sousTitre?: string
  /**
   * À partir de combien d'entrées la recherche apparaît. Un champ au-dessus de sept
   * pièces est du bruit : on ne cherche pas dans ce qu'on voit d'un coup d'œil.
   * `0` = jamais. Défaut : 12.
   */
  seuilRecherche?: number
  /** Appelé au clic sur une entrée cliquable (`faisable`, ou armable). */
  onChoix: (cle: string) => void
  /** Une entrée `manque`/`verrouille` est-elle cliquable ? (le marteau arme quand même) */
  clicSiIndisponible?: boolean
}

export function createCatalogue(hote: HTMLElement, opts: OptionsCatalogue): Catalogue {
  const root = document.createElement('div')
  root.className = 'cat'
  root.innerHTML = markup(opts)
  hote.appendChild(root)

  root.querySelector<HTMLElement>('.cat-t')!.textContent = opts.titre
  const sousEl = root.querySelector<HTMLElement>('.cat-sous')
  if (sousEl !== null && opts.sousTitre !== undefined) sousEl.textContent = opts.sousTitre
  const listEl = root.querySelector<HTMLElement>('.cat-liste')!
  const search = root.querySelector<HTMLInputElement>('.cat-q')
  const seuil = opts.seuilRecherche ?? 12
  let entrees: readonly EntreeCatalogue[] = []
  let signature = ''

  const dessiner = (): void => {
    const q = fold(search?.value ?? '')
    const vues = q === '' ? entrees : entrees.filter((e) => fold(e.nom).includes(q))
    // LE DÉFILEMENT SURVIT à la reconstruction : sans ça, taper une lettre ramènerait la
    // liste en haut à chaque frappe.
    // La recherche n'apparaît qu'au-delà du seuil — et jamais quand elle est déjà en cours
    // (sinon filtrer jusqu'à six résultats la ferait disparaître sous les doigts).
    if (search !== null) search.style.display = entrees.length >= seuil || q !== '' ? '' : 'none'
    const scroll = listEl.scrollTop
    listEl.innerHTML = ''
    // UN SEUL RAYON N'EST PAS UN RAYON : afficher « STRUCTURE » au-dessus de sept pièces
    // qui sont toutes structurelles ne range rien, ça ajoute une ligne de bruit. L'en-tête
    // n'apparaît qu'à partir de deux groupes — comme un sommaire.
    const plusieurs = new Set(vues.map((e) => e.rayon)).size > 1
    let rayonCourant: string | null = null
    let groupe: HTMLElement | null = null
    for (const e of vues) {
      if (e.rayon !== rayonCourant) {
        rayonCourant = e.rayon
        groupe = document.createElement('div')
        groupe.className = 'cat-grp'
        groupe.innerHTML = `<div class="cat-rayon"></div><div class="cat-lignes"></div>`
        groupe.querySelector<HTMLElement>('.cat-rayon')!.textContent = plusieurs ? e.rayon : ''
        listEl.appendChild(groupe)
      }
      groupe!.querySelector('.cat-lignes')!.appendChild(ligne(e, opts))
    }
    if (vues.length === 0) {
      const vide = document.createElement('div')
      vide.className = 'cat-vide'
      // LE MESSAGE QUI MANQUAIT : à la découverte (D2), le catalogue part VIDE, et un
      // panneau vide sans un mot se lit comme une panne, pas comme un début.
      vide.textContent =
        q === '' ? 'Rien ici pour l’instant — les recettes se découvrent en touchant leurs matières.' : 'Aucun résultat.'
      listEl.appendChild(vide)
    }
    listEl.scrollTop = scroll
  }

  search?.addEventListener('input', dessiner)

  return {
    update(next) {
      // Signature : on ne reconstruit que si quelque chose a bougé. `drawList` détruit et
      // recrée les lignes ; le rappeler à chaque frame recréerait la ligne entre le
      // `mousedown` et le `mouseup`, et le navigateur n'émettrait aucun `click`.
      const sig = next
        .map((e) => `${e.cle}|${e.etat}|${e.couts.map((c) => `${c.texte}${c.manque ? '!' : ''}`).join(',')}|${e.armee ? 1 : 0}|${e.raison ?? ''}`)
        .join(';')
      if (sig === signature) return
      signature = sig
      entrees = next
      dessiner()
    },
    setVisible(v) {
      root.style.display = v ? 'flex' : 'none'
    },
    saisitDuTexte: () => document.activeElement === search,
    racine: () => root,
  }
}

function ligne(e: EntreeCatalogue, opts: OptionsCatalogue): HTMLElement {
  const cliquable = e.etat === 'faisable' || opts.clicSiIndisponible === true
  const el = document.createElement('div')
  el.className = `cat-l cat-${e.etat}${e.armee === true ? ' cat-armee' : ''}${cliquable ? ' hud-click' : ''}`
  const droite = e.etat === 'verrouille' ? (e.raison ?? 'verrouillé') : e.etat === 'manque' ? 'MANQUE' : 'FAISABLE'
  el.innerHTML =
    (e.icone !== undefined ? `<div class="cat-ic"><img alt="" src="${e.icone}"></div>` : '') +
    `<div class="cat-mid"><div class="cat-nom"></div><div class="cat-cout"></div></div>` +
    `<div class="cat-etat"></div>`
  el.querySelector<HTMLElement>('.cat-nom')!.textContent = e.nom + (e.armee === true ? ' — ARMÉ' : '')
  const cout = el.querySelector<HTMLElement>('.cat-cout')!
  for (const [i, j] of e.couts.entries()) {
    if (i > 0) cout.append(' · ')
    const bout = document.createElement('span')
    if (j.manque) bout.className = 'cat-miss'
    bout.textContent = j.texte
    cout.append(bout)
  }
  if (e.detail !== undefined) cout.append(` — ${e.detail}`)
  el.querySelector<HTMLElement>('.cat-etat')!.textContent = droite
  if (cliquable) el.addEventListener('click', () => opts.onChoix(e.cle))
  return el
}

/** Sans accents ni casse : taper « epieu » doit trouver « Épieu taillé ». */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

function markup(opts: OptionsCatalogue): string {
  const q = `<input class="cat-q hud-click" type="text" placeholder="rechercher…" style="display:none">`
  const sous = opts.sousTitre === undefined ? '' : `<div class="cat-sous"></div>`
  return `
  <style>
    .cat{display:flex;flex-direction:column;min-height:0;pointer-events:auto;}
    .cat-t{font-size:15px;font-weight:700;color:#ffffff;letter-spacing:1px;margin-bottom:4px;}
    .cat-sous{font-size:11px;color:#8b8474;letter-spacing:1px;margin-bottom:12px;}
    .cat-q{width:100%;box-sizing:border-box;background:#14141a;border:1px solid #3a3a44;color:#e8e0c8;
      font:inherit;font-size:12px;padding:6px 8px;margin-bottom:10px;outline:none;}
    .cat-q:focus{border-color:#6b5a3a;}
    .cat-liste{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;}
    .cat-rayon{font-size:11px;color:#8b8474;letter-spacing:1px;margin-bottom:5px;}
    .cat-lignes{display:flex;flex-direction:column;gap:6px;}
    .cat-l{display:flex;align-items:center;gap:9px;border:2px solid #6b5a3a;background:rgba(107,90,58,.08);padding:8px 11px;}
    .cat-l.cat-manque,.cat-l.cat-verrouille{border-color:#3a3a44;background:rgba(27,27,34,.4);}
    .cat-l.cat-armee{border-color:#e8c66a;background:rgba(232,198,106,.1);}
    .cat-ic{width:22px;height:22px;flex:0 0 auto;}
    .cat-ic img{width:100%;height:100%;image-rendering:pixelated;}
    .cat-mid{flex:1;min-width:0;}
    .cat-nom{font-size:13px;color:#e8e0c8;}
    .cat-l.cat-armee .cat-nom{color:#ffffff;}
    .cat-l.cat-manque .cat-nom,.cat-l.cat-verrouille .cat-nom{color:#8b8474;}
    .cat-cout{font-size:11px;color:#9a8f78;margin-top:2px;}
    .cat-miss{color:#e05a4a;}
    .cat-etat{font-size:10px;letter-spacing:1px;color:#9a8f78;text-align:right;flex:0 0 auto;max-width:11ch;}
    .cat-l.cat-faisable .cat-etat{color:#c98b3a;}
    .cat-l.cat-verrouille .cat-etat{color:#6f93a0;}
    .cat-vide{font-size:11px;color:#8b8474;line-height:1.6;}
  </style>
  <div class="cat-t"></div>${sous}${q}
  <div class="cat-liste"></div>`
}
