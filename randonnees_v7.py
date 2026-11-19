from pathlib import Path
from datetime import datetime
from urllib.parse import quote
from urllib.request import urlopen
from html import escape
import json
import re
import shutil
import subprocess
import sys
import webbrowser

ROOT = Path.home() / "le-noyer-v6"

ADDRESS = "Rue Bierleux 69A, 4990 Bra-sur-Lienne, Lierneux, Belgique"

def maps(place):
    return "https://www.google.com/maps/search/?api=1&query=" + quote(place)

ROUTES = [
    {
        "target": 5,
        "distance": "4,5 km",
        "time": "1 h 15",
        "level": "Modéré",
        "title": "Les sentiers de Trou de Bra",
        "description": "Une balade courte à travers le secteur de Trou de Bra, entre campagne et forêt. Une première sortie idéale pour prendre ses repères.",
        "departure": "Trou de Bra",
        "departurl": maps("Église Notre-Dame de l'Assomption, Fond Lienne, Trou de Bra, Lierneux, Belgique"),
        "departure_label": "Localiser le départ",
        "trail": "https://www.cirkwi.com/fr/circuit/299655-lierneux-promenade-12",
        "source": "Promenade 12 · Maison du tourisme Haute Ardenne",
        "photo": "26924"
    },
    {
        "target": 10,
        "distance": "10 km",
        "time": "2 h 30",
        "level": "Modéré",
        "title": "Entre Bra et la vallée de la Lienne",
        "description": "Une randonnée au départ de Bra, entre paysages de campagne, forêt et abords de l'eau. Un choix particulièrement intéressant à proximité du gîte.",
        "departure": "Bra-sur-Lienne",
        "departurl": maps("Église Notre-Dame de l'Assomption, La Coulée, Bra-sur-Lienne, Lierneux, Belgique"),
        "departure_label": "Localiser le départ",
        "trail": "https://www.cirkwi.com/fr/circuit/299601-lierneux-promenade-11",
        "source": "Promenade 11 · Maison du tourisme Haute Ardenne",
        "photo": "84550"
    },
    {
        "target": 15,
        "distance": "14 km",
        "time": "3 h",
        "level": "Modéré",
        "title": "Les panoramas de la Lienne",
        "description": "Une boucle plus soutenue depuis Trou de Bra, réputée pour ses points de vue sur la vallée et ses changements de relief.",
        "departure": "Trou de Bra",
        "departurl": maps("Église Notre-Dame de l'Assomption, Fond Lienne, Trou de Bra, Lierneux, Belgique"),
        "departure_label": "Localiser le départ",
        "trail": "https://www.cirkwi.com/fr/circuit/299602-lierneux-promenade-13",
        "source": "Promenade 13 · Maison du tourisme Haute Ardenne",
        "photo": "26924"
    },
    {
        "target": 20,
        "distance": "20 km",
        "time": "Journée",
        "level": "Soutenu",
        "title": "La grande boucle de Trou de Bra",
        "description": "Une randonnée à la journée d'environ 20 km et 499 m de dénivelé positif, pour les groupes qui souhaitent prendre le temps d'explorer la région.",
        "departure": "Trou de Bra",
        "departurl": maps("Église Notre-Dame de l'Assomption, Fond Lienne, Trou de Bra, Lierneux, Belgique"),
        "departure_label": "Localiser le départ",
        "trail": "https://www.cirkwi.com/fr/circuit/919944-trou-de-bra-boucle-20km",
        "source": "Boucle de Trou de Bra · Cirkwi / Nimmjac",
        "photo": "84550"
    },
    {
        "target": 30,
        "distance": "30,5 km",
        "time": "9 h 23 estimées",
        "level": "Exigeant",
        "title": "La grande traversée de la vallée",
        "description": "Une longue boucle dans le secteur de Lierneux, avec environ 666 m de dénivelé positif. Réservée à un groupe entraîné, avec un départ à vérifier sur la fiche de l'auteur.",
        "departure": "Secteur de Lierneux",
        "departurl": maps("Lierneux, Belgique"),
        "departure_label": "Voir le secteur",
        "trail": "https://www.openrunner.com/route-details/17057852-lierneux-la-vallee-de-la-lienne",
        "source": "La vallée de la Lienne · OpenRunner",
        "photo": "26924"
    }
]

CSS = r"""
/* NOYER-V7-RANDONNEES */
.r7-address {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:20px;
  padding:19px 6%;
  background:#f4f1e8;
  border-bottom:1px solid #d7ded2;
  color:#284432;
}
.r7-address span {
  font-size:11px;
  font-weight:700;
  letter-spacing:.035em;
}
.r7-address a {
  white-space:nowrap;
  font-size:11px;
  border-bottom:1px solid #829b86;
}
.r7-section {
  padding:110px 0 120px;
  background:#f3f0e8;
  color:#243d2b;
}
.r7-top {
  display:flex;
  justify-content:space-between;
  align-items:end;
  gap:35px;
  margin-bottom:44px;
}
.r7-top h2 {
  font-size:clamp(53px,6.5vw,100px);
  line-height:.95;
  margin-top:23px;
  letter-spacing:-.055em;
}
.r7-top h2 em {
  color:#708d74;
}
.r7-top>p {
  max-width:340px;
  font-size:13px;
  line-height:1.9;
  color:#576e5d;
}
.r7-prompt {
  font-size:10px;
  color:#725b48;
  letter-spacing:.13em;
  font-weight:700;
  text-transform:uppercase;
  margin-bottom:12px;
}
.r7-tabs {
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:9px;
  margin-bottom:16px;
}
.r7-tabs button {
  text-align:left;
  border:1px solid #bdcdbb;
  padding:19px 15px 17px;
  background:#fcfbf6;
  color:#24422e;
  transition:background .2s,color .2s,transform .2s;
}
.r7-tabs button:hover {
  transform:translateY(-2px);
  border-color:#496f4d;
}
.r7-tabs button[aria-selected="true"] {
  background:#1c3c29;
  color:#f9f7ef;
  border-color:#1c3c29;
}
.r7-tabs strong {
  display:block;
  font:400 clamp(31px,4vw,55px)/1
    "Cormorant Garamond",Georgia,serif;
}
.r7-tabs small {
  display:block;
  margin-top:8px;
  font-size:10px;
  font-weight:700;
  letter-spacing:.06em;
}
.r7-feature {
  display:grid;
  grid-template-columns:1.05fr 1fr;
  min-height:530px;
  background:#e4e6dd;
}
.r7-picture {
  position:relative;
  min-height:530px;
  overflow:hidden;
  background:#718d70;
}
.r7-picture img {
  width:100%;
  height:100%;
  object-fit:cover;
}
.r7-picture:after {
  content:"";
  position:absolute;
  inset:65% 0 0;
  background:linear-gradient(transparent,#122b18a3);
}
.r7-photo-credit {
  position:absolute;
  z-index:1;
  bottom:22px;
  left:25px;
  color:white;
  font-size:10px;
  letter-spacing:.14em;
}
.r7-detail {
  display:flex;
  flex-direction:column;
  justify-content:center;
  align-items:flex-start;
  padding:clamp(30px,5vw,70px);
}
.r7-detail>small {
  color:#9b775a;
  font-size:10px;
  font-weight:700;
  letter-spacing:.17em;
}
.r7-detail h3 {
  font-size:clamp(39px,4.5vw,65px);
  line-height:1;
  margin:19px 0 22px;
}
.r7-detail>p {
  font-size:13px;
  color:#526b58;
  line-height:1.9;
}
.r7-facts {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:15px;
  width:100%;
  border-top:1px solid #bfccbc;
  border-bottom:1px solid #bfccbc;
  margin:27px 0 21px;
  padding:16px 0;
}
.r7-facts strong {
  display:block;
  font:400 clamp(20px,2.5vw,33px)/1.2
    "Cormorant Garamond",Georgia,serif;
}
.r7-facts span {
  display:block;
  margin-top:5px;
  font-size:10px;
  color:#627665;
}
.r7-start {
  margin-bottom:20px;
  font-size:11px;
  color:#566e5a;
}
.r7-actions {
  display:flex;
  gap:13px;
  flex-wrap:wrap;
  align-items:center;
}
.r7-actions>a {
  font-size:11px;
  font-weight:700;
}
.r7-actions .r7-official {
  padding:13px 16px;
  background:#234932;
  color:white;
  text-decoration:none;
}
.r7-actions .r7-map {
  border-bottom:1px solid #a2b5a4;
  padding-bottom:7px;
}
.r7-source {
  font-size:10px;
  line-height:1.6;
  color:#617663;
  margin-top:24px;
}
.r7-final {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:25px;
  margin-top:32px;
}
.r7-final p {
  max-width:620px;
  color:#657967;
  font-size:12px;
}
.r7-final a {
  flex-shrink:0;
}
@media(max-width:850px) {
  .r7-feature {grid-template-columns:1fr}
  .r7-picture {min-height:350px;height:390px}
  .r7-final {align-items:flex-start;flex-direction:column}
}
@media(max-width:600px) {
  .r7-address {padding:15px 23px;align-items:flex-start;flex-direction:column;gap:7px}
  .r7-section {padding:80px 0}
  .r7-top {display:block}
  .r7-top>p {margin-top:19px}
  .r7-top h2 {font-size:62px}
  .r7-tabs {gap:5px}
  .r7-tabs button {padding:11px 4px;text-align:center}
  .r7-tabs strong {font-size:27px}
  .r7-tabs small {font-size:8px}
  .r7-detail {padding:33px 24px}
  .r7-detail h3 {font-size:47px}
  .r7-facts {gap:8px}
  .r7-facts strong {font-size:23px}
  .r7-picture {min-height:300px;height:340px}
}
"""

def ameliorer(html):
    if 'NOYER-V7-RANDONNEES' in html:
        return html

    start = html.find('<section class="trails section" id="balades">')
    if start < 0:
        raise RuntimeError(
            "La section des balades V6 est introuvable."
        )
    finish = html.find("</section>", start)
    if finish < 0:
        raise RuntimeError("Fin de section introuvable.")
    finish += len("</section>")

    route = ROUTES[0]
    img = "/photos/" + route["photo"] + ".jpg"

    block = """
<section class="r7-section" id="balades">
<div class="wrap">
  <div class="r7-top">
    <div>
      <div class="eyebrow">Randonnées autour du Noyer</div>
      <h2>Cinq envies.<br><em>Mille chemins.</em></h2>
    </div>
    <p>Choisissez votre distance pour découvrir
    une randonnée dans les environs de Bra-sur-Lienne
    et de Lierneux.</p>
  </div>
  <div class="r7-prompt">Quelle distance souhaitez-vous marcher ?</div>
  <div class="r7-tabs" role="tablist" aria-label="Choisir une distance">
""" + "\n".join(
    '<button type="button" role="tab" data-r7="' + str(i) +
    '" aria-controls="r7-panel" aria-selected="' +
    ('true' if i == 0 else 'false') +
    '" tabindex="' + ('0' if i == 0 else '-1') +
    '"><strong>' + str(r["target"]) +
    '</strong><small>KM ENVIRON</small></button>'
    for i, r in enumerate(ROUTES)
) + """
  </div>
  <article class="r7-feature" id="r7-panel"
      role="tabpanel" aria-live="polite">
    <div class="r7-picture">
      <img id="r7-img" src="""" + escape(img, quote=True) + """"
      alt="Photographie des paysages autour du Noyer">
      <span class="r7-photo-credit">
        LE NOYER · SENTIERS DES ARDENNES
      </span>
    </div>
    <div class="r7-detail">
      <small id="r7-category">DISTANCE CIBLE · 5 KM</small>
      <h3 id="r7-title">Les sentiers de Trou de Bra</h3>
      <p id="r7-description">Une randonnée dans les environs.</p>
      <div class="r7-facts">
        <div><strong id="r7-length">4,5 km</strong>
             <span>Parcours publié</span></div>
        <div><strong id="r7-duration">1 h 15</strong>
             <span>Temps annoncé</span></div>
        <div><strong id="r7-level">Modéré</strong>
             <span>Niveau indicatif</span></div>
      </div>
      <div class="r7-start">
        Départ indiqué : <strong id="r7-depart">Trou de Bra</strong>
      </div>
      <div class="r7-actions">
        <a class="r7-official" id="r7-official"
           target="_blank" rel="noopener noreferrer"
           href="https://www.cirkwi.com/fr/circuit/299655-lierneux-promenade-12">
           Voir le tracé officiel ↗
        </a>
        <a class="r7-map" id="r7-map"
           target="_blank" rel="noopener noreferrer"
           href="#">Localiser le départ ↗</a>
      </div>
      <p class="r7-source" id="r7-source"></p>
    </div>
  </article>
  <div class="r7-final">
    <p>Les catégories 5, 10, 15, 20 et 30 km
    correspondent à des distances recherchées.
    Le kilométrage exact est indiqué pour chaque circuit.
    Les liaisons depuis le gîte ne sont pas comprises.
    Consultez la fiche de randonnée avant votre départ.</p>
    <a class="btn" href="#reserver" id="r7-book">
       Préparer un séjour randonnée <span>↗</span>
    </a>
  </div>
</div>
</section>
"""

    html = html[:start] + block + html[finish:]

    address_bar = """
<div class="r7-address">
  <span>LE NOYER · RUE BIERLEUX 69A · BRA-SUR-LIENNE · 4990 LIERNEUX</span>
  <a target="_blank" rel="noopener noreferrer"
     href="""" + escape(maps(ADDRESS), quote=True) + """">
     Localiser le gîte ↗
  </a>
</div>
"""
    html = html.replace(
        '<section class="story section" id="maison">',
        address_bar + '<section class="story section" id="maison">',
        1
    )

    html = html.replace(
        '<div class="eyebrow">Lierneux · Ardenne belge</div>',
        '<div class="eyebrow">Bra-sur-Lienne · Ardenne belge</div>',
        1
    )

    html = html.replace(
        '<div class="footer-bottom">',
        '<p style="margin-top:30px;font-size:12px;color:#c4d7c5">'
        'Rue Bierleux 69A · 4990 Bra-sur-Lienne (Lierneux), Belgique'
        '</p><div class="footer-bottom">',
        1
    )

    html = html.replace(
        "</style>",
        CSS + "\n</style>",
        1
    )

    routes_json = json.dumps(
        ROUTES, ensure_ascii=False
    ).replace("</", "<\\/")

    js = r"""
<script>
(function(){
  const routes = __ROUTES__;
  const tabs = Array.from(
    document.querySelectorAll('[data-r7]')
  );
  if(!tabs.length)return;

  const el = id => document.getElementById(id);
  let selected = 0;
  let usedFallback = false;

  const photo = el('r7-img');
  photo.addEventListener('error',()=>{
    if(!usedFallback){
      usedFallback=true;
      photo.src='https://media.villaforyou.com/photo/1920/1440/7898/31914.jpg';
    }
  });

  function show(index){
    selected=index;
    const r=routes[index];

    el('r7-category').textContent=
      'DISTANCE CIBLE · '+r.target+' KM';

    el('r7-title').textContent=r.title;
    el('r7-description').textContent=r.description;
    el('r7-length').textContent=r.distance;
    el('r7-duration').textContent=r.time;
    el('r7-level').textContent=r.level;
    el('r7-depart').textContent=r.departure;
    el('r7-source').textContent='Source : '+r.source;

    el('r7-official').href=r.trail;
    el('r7-map').href=r.departurl;
    el('r7-map').textContent=r.departure_label+' ↗';

    usedFallback=false;
    photo.src='/photos/'+r.photo+'.jpg';

    tabs.forEach((b,i)=>{
      b.setAttribute('aria-selected',String(i===index));
      b.tabIndex=i===index?0:-1;
    });
  }

  tabs.forEach((button,index)=>{
    button.addEventListener('click',()=>show(index));
    button.addEventListener('keydown',event=>{
      let next=index;
      if(event.key==='ArrowRight')
        next=(index+1)%tabs.length;
      else if(event.key==='ArrowLeft')
        next=(index+tabs.length-1)%tabs.length;
      else if(event.key==='Home')
        next=0;
      else if(event.key==='End')
        next=tabs.length-1;
      else return;
      event.preventDefault();
      show(next);
      tabs[next].focus();
    });
  });

  el('r7-book').addEventListener('click',()=>{
    const type=el('stay-type');
    if(type)
      type.value='Groupe de randonnée / mid-week';

    const field=document.querySelector(
      '#booking-form textarea[name="message"]'
    );
    if(field){
      const mention=
        'Randonnée souhaitée : environ '+
        routes[selected].target+' km ('+
        routes[selected].distance+' sur le circuit proposé).';
      if(!field.value.includes('Randonnée souhaitée :'))
        field.value=(field.value?field.value+'\n':'')+mention;
    }
  });

  show(0);
})();
</script>
"""
    html = html.replace(
        "</body>",
        js.replace("__ROUTES__", routes_json) + "\n</body>",
        1
    )

    return html

if __name__ == "__main__":
    site = ROOT / "index.html"
    launcher = ROOT / "demarrer.py"

    if not site.exists() or not launcher.exists():
        sys.exit(
            "La V6 n'a pas été trouvée dans ~/le-noyer-v6.\n"
            "Vérifie que la version précédente est installée."
        )

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    shutil.copy2(
        site,
        ROOT / ("sauvegarde-site-" + timestamp + ".html")
    )
    shutil.copy2(
        launcher,
        ROOT / ("sauvegarde-serveur-" + timestamp + ".py")
    )

    current = site.read_text(encoding="utf-8")
    site.write_text(ameliorer(current), encoding="utf-8")

    code = launcher.read_text(encoding="utf-8")
    marker = '(ROOT / "index.html").write_text(HTML, encoding="utf-8")'

    if "from randonnees_v7 import ameliorer" not in code:
        if marker not in code:
            sys.exit(
                "Site HTML actualisé, mais l'installation du "
                "correctif permanent est impossible : "
                "emplacement non trouvé dans demarrer.py."
            )

        code = code.replace(
            marker,
            "from randonnees_v7 import ameliorer\n"
            "HTML = ameliorer(HTML)\n" + marker,
            1
        )
        launcher.write_text(code, encoding="utf-8")

    print("\n✓ Le Noyer : balades 5 / 10 / 15 / 20 / 30 km")
    print("✓ Adresse exacte ajoutée")
    print("✓ Rubrique randonnée interactive")
    print("✓ Correction conservée aux prochains démarrages")
    print("✓ Anciennes versions sauvegardées\n")

    existing = None
    for port in (8040, 8041, 8042):
        try:
            with urlopen(
                f"http://127.0.0.1:{port}/", timeout=1
            ) as response:
                page = response.read(3000).decode(
                    "utf-8", errors="ignore"
                )
                if "Le Noyer" in page:
                    existing = port
                    break
        except Exception:
            pass

    if existing is not None:
        url = f"http://127.0.0.1:{existing}/"
        print("SITE :", url)
        webbrowser.open(url)
        print("Actualise la page si nécessaire.")
    else:
        print("Lancement du site...\n")
        subprocess.run([sys.executable, str(launcher)])
