/**
 * LE PORTAIL DES OUTILS — une seule adresse pour tout l'outillage web du projet
 * (demande d'Alexis, 2026-08-27 : « mets-le dans l'atelier. un seul portail pour tous
 * les outils »).
 *
 * POURQUOI. Les outils naissaient chacun avec sa page : `/atelier.html` pour les plans,
 * `/banc-son.html` pour le son. Deux adresses à retenir, aucune ne menant à l'autre — et
 * le troisième outil aurait fait une troisième adresse que personne n'aurait retrouvée.
 * `/atelier.html` devient donc L'ATELIER tout court, et chaque outil y est un onglet.
 *
 * CE QUE LE PORTAIL FAIT, ET RIEN DE PLUS :
 *   · il affiche les onglets et retient lequel est ouvert (dans le HASH — une adresse
 *     comme `/atelier.html#son` se colle dans un message et s'ouvre sur le bon outil) ;
 *   · il MONTE un outil À LA DEMANDE, par `import()` dynamique. C'est ce qui garde le
 *     portail honnête : ouvrir le banc d'écoute ne doit pas booter un `Phaser.Game` et
 *     générer toutes les textures du jeu pour rien, et régler un timbre ne doit pas
 *     attendre l'éditeur de plans.
 *   · il monte l'outil APRÈS l'avoir rendu visible. Un canvas mesuré dans un conteneur
 *     `display:none` se monte à zéro, et le défaut ne se voit qu'au premier tracé.
 *
 * Ce qu'il ne fait PAS : connaître les outils. Chacun garde son module, son DOM et son
 * état ; le portail ne sait que leur nom et où les brancher. Ajouter un outil = une entrée
 * dans `OUTILS` et une section dans `atelier.html`.
 */

interface Outil {
  /** La clé d'URL (`#plans`) et l'identifiant de la section hôte (`#outil-plans`). */
  cle: string
  /** Le libellé de l'onglet. */
  nom: string
  /** Ce qu'on lit sous l'onglet quand il est ouvert — la bande d'aide du portail. */
  propos: string
  /** Le module de l'outil, importé à la PREMIÈRE ouverture seulement. */
  charger: () => Promise<unknown>
}

const OUTILS: Outil[] = [
  {
    cle: 'plans',
    nom: 'PLANS',
    propos: 'L’éditeur du bâti — le rendu est celui du jeu, la validation est celle de la suite.',
    charger: () => import('./main'),
  },
  {
    cle: 'son',
    nom: 'SON',
    propos: 'Le banc d’écoute — le vrai routage sur le vrai moteur, à la distance de votre choix.',
    charger: () => import('../banc-son'),
  },
]

const PAR_DEFAUT = OUTILS[0]!

const montes = new Set<string>()
let courant = ''

const sectionDe = (cle: string): HTMLElement | null => document.getElementById(`outil-${cle}`)

/** Ouvre un outil : on montre d'abord, on monte ensuite (voir l'en-tête), une seule fois. */
async function ouvrir(cle: string): Promise<void> {
  const outil = OUTILS.find((o) => o.cle === cle) ?? PAR_DEFAUT
  if (courant === outil.cle) return
  courant = outil.cle

  for (const o of OUTILS) {
    const sec = sectionDe(o.cle)
    if (sec) sec.style.display = o.cle === outil.cle ? '' : 'none'
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('.p-onglet')) {
    b.classList.toggle('actif', b.dataset.outil === outil.cle)
  }
  const propos = document.getElementById('p-propos')
  if (propos) propos.textContent = outil.propos
  document.title = `ASHES — l’Atelier · ${outil.nom.toLowerCase()}`

  if (montes.has(outil.cle)) return
  montes.add(outil.cle)
  try {
    await outil.charger()
  } catch (e) {
    // Un outil qui refuse de se monter DOIT le dire ici : sans ce message, le portail
    // afficherait une section vide et l'on chercherait la panne dans l'outil ouvert.
    montes.delete(outil.cle)
    const sec = sectionDe(outil.cle)
    if (sec) sec.textContent = `L’outil « ${outil.nom} » n’a pas pu se monter : ${String(e)}`
    throw e
  }
}

const cleDuHash = (): string => window.location.hash.replace(/^#/, '') || PAR_DEFAUT.cle

const barre = document.getElementById('p-onglets')
if (barre) {
  barre.innerHTML = OUTILS.map(
    (o) => `<button class="p-onglet" data-outil="${o.cle}">${o.nom}</button>`,
  ).join('')
  for (const b of barre.querySelectorAll<HTMLButtonElement>('.p-onglet')) {
    // On passe par le HASH et non par un appel direct : l'onglet, le bouton Précédent et
    // un lien collé empruntent alors le MÊME chemin, et ne peuvent pas se contredire.
    b.addEventListener('click', () => {
      window.location.hash = `#${b.dataset.outil}`
    })
  }
}

window.addEventListener('hashchange', () => void ouvrir(cleDuHash()))
void ouvrir(cleDuHash())
