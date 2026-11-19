from pathlib import Path
from datetime import datetime
from math import radians, sin, cos, asin, sqrt
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import json
import shutil
import subprocess
import sys
import webbrowser

ROOT = Path.home() / "le-noyer-v6"
TRACES = ROOT / "traces"
GPX = TRACES / "promenade-12.gpx"
GEOJSON = TRACES / "promenade-12.geojson"

CIRKWI = (
    "https://www.cirkwi.com/fr/"
    "exporter-gpx/299655_0?mb_use_temp=1"
)

TRACES.mkdir(parents=True, exist_ok=True)

def local_name(tag):
    return tag.split("}")[-1]

def find_segments(root):
    segments = []

    for element in root.iter():
        kind = local_name(element.tag)

        if kind == "trkseg":
            pts = []
            for child in element:
                if local_name(child.tag) == "trkpt":
                    pts.append([
                        float(child.attrib["lon"]),
                        float(child.attrib["lat"])
                    ])
            if len(pts) > 1:
                segments.append(pts)

        elif kind == "rte":
            pts = []
            for child in element:
                if local_name(child.tag) == "rtept":
                    pts.append([
                        float(child.attrib["lon"]),
                        float(child.attrib["lat"])
                    ])
            if len(pts) > 1:
                segments.append(pts)

    return segments

def parse_gpx(path):
    root = ET.parse(path).getroot()
    segments = find_segments(root)

    if not segments:
        raise ValueError(
            "Aucune trace ou route GPS trouvée dans le GPX."
        )

    for segment in segments:
        for lon, lat in segment:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("Coordonnées GPS invalides.")

    return segments

def find_uploaded_file():
    exact = "Cirkwi-Lierneux_-_Promenade_12.gpx"

    folders = [
        Path.home() / "Downloads",
        Path.home() / "Desktop",
        ROOT
    ]

    for folder in folders:
        file = folder / exact
        if file.is_file():
            return file

    for folder in folders:
        if not folder.is_dir():
            continue
        for file in folder.iterdir():
            name = file.name.lower()
            if file.is_file() and name.endswith(".gpx"):
                if (
                    "promenade_12" in name
                    or "promenade-12" in name
                    or "299655" in name
                ):
                    return file

    return None

def obtain_gpx():
    if GPX.is_file():
        parse_gpx(GPX)
        return

    found = find_uploaded_file()
    if found is not None:
        parse_gpx(found)
        shutil.copy2(found, GPX)
        print("GPX importé depuis :", found)
        return

    print("Fichier local absent. Essai depuis Cirkwi...")

    try:
        req = Request(
            CIRKWI,
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urlopen(req, timeout=12) as response:
            data = response.read(8_000_001)

        if len(data) > 8_000_000:
            raise ValueError("GPX trop volumineux")

        candidate = TRACES / "telechargement-temp.gpx"
        candidate.write_bytes(data)
        parse_gpx(candidate)
        candidate.replace(GPX)
        print("GPX téléchargé depuis Cirkwi.")

    except Exception as error:
        raise RuntimeError(
            "GPX introuvable.\n"
            "Télécharge Cirkwi-Lierneux_-_Promenade_12.gpx "
            "dans Téléchargements, puis relance la commande.\n"
            "Détail : " + str(error)
        )

def length_km(segments):
    total = 0.0

    for segment in segments:
        for a, b in zip(segment, segment[1:]):
            lon1, lat1 = map(radians, a)
            lon2, lat2 = map(radians, b)
            delta_lat = lat2 - lat1
            delta_lon = lon2 - lon1
            x = (
                sin(delta_lat / 2) ** 2
                + cos(lat1) * cos(lat2)
                * sin(delta_lon / 2) ** 2
            )
            total += 2 * 6371 * asin(min(1, sqrt(x)))

    return total

CSS = """
/* LN-GPX5 */
#ln-gpx5 {
    margin:22px 0 30px;
    background:#f9f8f3;
    border:1px solid #cad6c9;
    overflow:hidden;
}
#ln-gpx5[hidden] {display:none}
.ln-gpx-head {
    padding:27px 30px 20px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:20px;
}
.ln-gpx-head h3 {
    font-size:clamp(30px,3.5vw,48px);
    color:#1d402b;
    margin-top:8px;
}
.ln-gpx-label {
    font-size:10px;
    color:#916b50;
    letter-spacing:.16em;
    font-weight:700;
}
.ln-gpx-status {
    font-size:11px;
    color:#637b67;
}
#ln-gpx-map {
    height:430px;
    background:#dce5d9;
    z-index:1;
}
.ln-gpx-bottom {
    padding:22px 30px 27px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    flex-wrap:wrap;
    gap:20px;
}
.ln-gpx-bottom>p {
    max-width:530px;
    font-size:12px;
    color:#526b58;
    line-height:1.8;
}
.ln-gpx-buttons {
    display:flex;
    gap:10px;
    flex-wrap:wrap;
}
.ln-gpx-buttons a {
    display:inline-flex;
    align-items:center;
    padding:12px 17px;
    background:#234a32;
    color:white;
    font-size:11px;
    font-weight:700;
}
.ln-gpx-buttons a.secondary {
    background:transparent;
    color:#234a32;
    border:1px solid #adc4af;
}
@media(max-width:600px) {
    #ln-gpx-map {height:340px}
    .ln-gpx-head {padding:23px;display:block}
    .ln-gpx-status {margin-top:10px}
    .ln-gpx-bottom {padding:23px}
    .ln-gpx-buttons {width:100%}
    .ln-gpx-buttons a {justify-content:center}
}
"""

PANEL = """
<!-- LN-GPX5 -->
<section id="ln-gpx5" aria-label="Trace GPS de la promenade 12">
  <div class="ln-gpx-head">
    <div>
      <div class="ln-gpx-label">PROMENADE 12 · TRACE GPS</div>
      <h3>Suivre le chemin.</h3>
    </div>
    <span class="ln-gpx-status" id="ln-gpx-status">
      Chargement du parcours…
    </span>
  </div>

  <div id="ln-gpx-map"
       role="region"
       aria-label="Carte du tracé de la promenade 12">
  </div>

  <div class="ln-gpx-bottom">
    <p>
      Départ publié à <strong>Trou de Bra</strong>.
      Cette trace n'inclut pas une liaison depuis
      le gîte, Rue Bierleux 69A.
      Vérifiez le balisage avant le départ.
    </p>
    <div class="ln-gpx-buttons">
      <a href="/traces/promenade-12.gpx"
         download="Le-Noyer-Promenade-12.gpx">
         Télécharger le GPX ↓
      </a>
      <a class="secondary"
         target="_blank"
         rel="noopener noreferrer"
         href="https://www.cirkwi.com/fr/circuit/299655-lierneux-promenade-12">
         Fiche Cirkwi ↗
      </a>
    </div>
  </div>
</section>
"""

JS = """
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  const panel=document.getElementById('ln-gpx5');
  if(!panel)return;

  const status=document.getElementById('ln-gpx-status');
  const first=document.querySelector('[data-r7="0"]');
  let map=null;
  let started=false;

  async function setupMap(){
    if(started)return;
    started=true;

    if(typeof L==='undefined'){
      status.textContent=
        'Carte indisponible hors connexion. GPX téléchargeable.';
      return;
    }

    try{
      const response=await fetch(
        '/traces/promenade-12.geojson'
      );
      if(!response.ok)throw Error('Trace GPS inaccessible');

      const geojson=await response.json();

      map=L.map('ln-gpx-map',{
        scrollWheelZoom:false
      });

      L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution:'&copy; OpenStreetMap contributors',
          maxZoom:18
        }
      ).addTo(map);

      const track=L.geoJSON(geojson,{
        style:{
          color:'#245d37',
          weight:5,
          opacity:.95,
          lineJoin:'round'
        }
      }).addTo(map);

      const bounds=track.getBounds();

      if(bounds.isValid()){
        map.fitBounds(bounds.pad(.16));
      }

      const coordinates=
        geojson.features[0].geometry.coordinates;

      if(coordinates && coordinates.length){
        const firstPoint=coordinates[0];

        L.circleMarker(
          [firstPoint[1],firstPoint[0]],
          {
            radius:8,
            color:'#fff',
            fillColor:'#b78258',
            fillOpacity:1,
            weight:2
          }
        )
        .addTo(map)
        .bindPopup('Début de la trace GPX');
      }

      status.textContent=
        'Trace GPS chargée · carte interactive';

      setTimeout(()=>map.invalidateSize(),100);
    }catch(error){
      status.textContent=
        'Carte non disponible : '+error.message;
    }
  }

  function sync(){
    const active=first &&
      first.getAttribute('aria-selected')==='true';

    panel.hidden=!active;

    if(active){
      setupMap();
      if(map)setTimeout(()=>map.invalidateSize(),50);
    }
  }

  document.querySelectorAll('[data-r7]').forEach(tab=>{
    tab.addEventListener('click',()=>{
      setTimeout(sync,0);
    });

    tab.addEventListener('keydown',()=>{
      setTimeout(sync,0);
    });
  });

  sync();
})();
</script>
"""

def integrate(html):
    if 'id="ln-gpx5"' in html:
        return html

    if 'id="r7-panel"' not in html:
        raise RuntimeError(
            "Rubrique V7 absente : le sélecteur de distances "
            "doit d'abord être installé."
        )

    anchor = '<div class="r7-final">'
    if anchor not in html:
        raise RuntimeError(
            "Emplacement de la carte introuvable."
        )

    html = html.replace(
        anchor,
        PANEL + "\n" + anchor,
        1
    )

    html = html.replace(
        "</style>",
        CSS + "\n</style>",
        1
    )

    html = html.replace(
        "</head>",
        '<link rel="stylesheet" '
        'href="https://unpkg.com/leaflet@1.9.4/'
        'dist/leaflet.css">\n</head>',
        1
    )

    html = html.replace(
        "</body>",
        JS + "\n</body>",
        1
    )

    return html

def install():
    site=ROOT / "index.html"
    launcher=ROOT / "demarrer.py"

    if not site.is_file() or not launcher.is_file():
        raise RuntimeError(
            "La V6/V7 est introuvable dans ~/le-noyer-v6."
        )

    obtain_gpx()
    segments=parse_gpx(GPX)

    features=[
        {
            "type":"Feature",
            "properties":{"name":"Promenade 12"},
            "geometry":{
                "type":"LineString",
                "coordinates":segment
            }
        }
        for segment in segments
    ]

    GEOJSON.write_text(
        json.dumps({
            "type":"FeatureCollection",
            "features":features
        }),
        encoding="utf-8"
    )

    backup=ROOT / (
        "index-avant-gpx-"
        +datetime.now().strftime("%Y%m%d-%H%M%S")
        +".html"
    )
    shutil.copy2(site,backup)

    original=site.read_text(encoding="utf-8")
    site.write_text(integrate(original),encoding="utf-8")

    code=launcher.read_text(encoding="utf-8")
    marker='(ROOT / "index.html").write_text(HTML, encoding="utf-8")'

    if "from gpx5 import integrate" not in code:
        if marker not in code:
            raise RuntimeError(
                "Page mise à jour, mais impossible de rendre "
                "le changement permanent dans demarrer.py."
            )

        code=code.replace(
            marker,
            "from gpx5 import integrate\n"
            "HTML = integrate(HTML)\n"
            + marker,
            1
        )
        launcher.write_text(code,encoding="utf-8")

    print("\n✓ GPX de la promenade 12 importé")
    print("✓ Segments GPS :",len(segments))
    print("✓ Distance calculée depuis le fichier :",
          round(length_km(segments),2),"km")
    print("✓ Carte interactive ajoutée à la balade 5 km")
    print("✓ Téléchargement du GPX activé")
    print("✓ Sauvegarde :",backup)
    print("✓ Site :",site)

    # Tente d'ouvrir la version déjà servie.
    for port in (8040,8041,8042):
        url=f"http://127.0.0.1:{port}/"
        try:
            with urlopen(url,timeout=1) as response:
                page=response.read(600000).decode(
                    "utf-8",errors="ignore"
                )
            if 'id="ln-gpx5"' in page:
                print("\nSITE :",url)
                webbrowser.open(url)
                return
        except Exception:
            pass

    print("\nDémarrage du site V6/V7...\n")
    subprocess.run([sys.executable,str(launcher)])

if __name__=="__main__":
    try:
        install()
    except Exception as error:
        print("\nERREUR :",error)
        sys.exit(1)
