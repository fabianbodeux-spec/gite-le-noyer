
(function(){
const q=s=>document.querySelector(s), qa=s=>Array.from(document.querySelectorAll(s));
if(!q('#booking-form'))return;
const gallery=qa('.gallery-item');
const modal=q('#lightbox');
let visible=gallery.slice(),position=0,lastFocus=null;
qa('img[data-fallback]').forEach(img=>{
  img.addEventListener('error',function(){
    if(this.src!==this.dataset.fallback){
      this.src=this.dataset.fallback;
    }
  });
});
function showPhoto(index){
  position=(index+visible.length)%visible.length;
  const image=visible[position].querySelector('img');
  q('#large-photo').src=image.src;
  q('#large-photo').alt=image.alt;
  q('#photo-title').textContent=image.alt+' · '+(position+1)+' / '+visible.length;
}
gallery.forEach(tile=>tile.addEventListener('click',()=>{
  const index=visible.indexOf(tile);
  if(index<0)return;
  lastFocus=document.activeElement;
  showPhoto(index);
  modal.showModal();
  q('#photo-close').focus();
}));
q('#photo-close').addEventListener('click',()=>modal.close());
q('#prev').addEventListener('click',()=>showPhoto(position-1));
q('#next').addEventListener('click',()=>showPhoto(position+1));
modal.addEventListener('close',()=>lastFocus?.focus());
modal.addEventListener('keydown',e=>{
  if(e.key==='ArrowLeft')showPhoto(position-1);
  if(e.key==='ArrowRight')showPhoto(position+1);
});
qa('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  const filter=button.dataset.filter;
  visible=[];
  gallery.forEach(tile=>{
    const match=filter==='all'||tile.dataset.group===filter;
    tile.hidden=!match;
    if(match)visible.push(tile);
  });
  qa('[data-filter]').forEach(item=>{
    const active=item===button;
    item.classList.toggle('active',active);
    item.setAttribute('aria-pressed',String(active));
  });
}));

if(new URLSearchParams(location.search).get('sejour')==='midweek')q('#stay-type').value='Groupe de randonnée / mid-week';
const distance=new URLSearchParams(location.search).get('distance');
if(['5','10','15','20','30'].includes(distance))q('textarea[name=message]').value='Nous souhaitons un mid-week avec des randonnées autour de '+distance+' km.';

})();


(function(){
  const routes = [{"target": 5, "distance": "4,5 km", "time": "1 h 15", "level": "Modéré", "title": "Les sentiers de Trou de Bra", "description": "Une balade courte à travers le secteur de Trou de Bra, entre campagne et forêt. Une première sortie idéale pour prendre ses repères.", "departure": "Trou de Bra", "departurl": "https://www.google.com/maps/search/?api=1&query=%C3%89glise%20Notre-Dame%20de%20l%27Assomption%2C%20Fond%20Lienne%2C%20Trou%20de%20Bra%2C%20Lierneux%2C%20Belgique", "departure_label": "Localiser le départ", "trail": "https://www.cirkwi.com/fr/circuit/299655-lierneux-promenade-12", "source": "Promenade 12 · Maison du tourisme Haute Ardenne", "photo": "26924"}, {"target": 10, "distance": "10 km", "time": "2 h 30", "level": "Modéré", "title": "Entre Bra et la vallée de la Lienne", "description": "Une randonnée au départ de Bra, entre paysages de campagne, forêt et abords de l'eau. Un choix particulièrement intéressant à proximité du gîte.", "departure": "Bra-sur-Lienne", "departurl": "https://www.google.com/maps/search/?api=1&query=%C3%89glise%20Notre-Dame%20de%20l%27Assomption%2C%20La%20Coul%C3%A9e%2C%20Bra-sur-Lienne%2C%20Lierneux%2C%20Belgique", "departure_label": "Localiser le départ", "trail": "https://www.cirkwi.com/fr/circuit/299601-lierneux-promenade-11", "source": "Promenade 11 · Maison du tourisme Haute Ardenne", "photo": "84550"}, {"target": 15, "distance": "14 km", "time": "3 h", "level": "Modéré", "title": "Les panoramas de la Lienne", "description": "Une boucle plus soutenue depuis Trou de Bra, réputée pour ses points de vue sur la vallée et ses changements de relief.", "departure": "Trou de Bra", "departurl": "https://www.google.com/maps/search/?api=1&query=%C3%89glise%20Notre-Dame%20de%20l%27Assomption%2C%20Fond%20Lienne%2C%20Trou%20de%20Bra%2C%20Lierneux%2C%20Belgique", "departure_label": "Localiser le départ", "trail": "https://www.cirkwi.com/fr/circuit/299602-lierneux-promenade-13", "source": "Promenade 13 · Maison du tourisme Haute Ardenne", "photo": "26924"}, {"target": 20, "distance": "20 km", "time": "Journée", "level": "Soutenu", "title": "La grande boucle de Trou de Bra", "description": "Une randonnée à la journée d'environ 20 km et 499 m de dénivelé positif, pour les groupes qui souhaitent prendre le temps d'explorer la région.", "departure": "Trou de Bra", "departurl": "https://www.google.com/maps/search/?api=1&query=%C3%89glise%20Notre-Dame%20de%20l%27Assomption%2C%20Fond%20Lienne%2C%20Trou%20de%20Bra%2C%20Lierneux%2C%20Belgique", "departure_label": "Localiser le départ", "trail": "https://www.cirkwi.com/fr/circuit/919944-trou-de-bra-boucle-20km", "source": "Boucle de Trou de Bra · Cirkwi / Nimmjac", "photo": "84550"}, {"target": 30, "distance": "30,5 km", "time": "9 h 23 estimées", "level": "Exigeant", "title": "La grande traversée de la vallée", "description": "Une longue boucle dans le secteur de Lierneux, avec environ 666 m de dénivelé positif. Réservée à un groupe entraîné, avec un départ à vérifier sur la fiche de l'auteur.", "departure": "Secteur de Lierneux", "departurl": "https://www.google.com/maps/search/?api=1&query=Lierneux%2C%20Belgique", "departure_label": "Voir le secteur", "trail": "https://www.openrunner.com/route-details/17057852-lierneux-la-vallee-de-la-lienne", "source": "La vallée de la Lienne · OpenRunner", "photo": "26924"}];
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
    const url=new URL(location.href);url.searchParams.set('distance',routes[index].target);history.replaceState(null,'',url);
    const r=routes[index];

    el('r7-category').textContent=
      'Envie de '+r.target+' km';

    el('r7-title').textContent=r.title;
    el('r7-book').href='/?sejour=midweek&distance='+r.target+'#reserver';
    el('r7-description').textContent=r.description;
    el('r7-length').textContent=r.distance;
    el('r7-duration').textContent=r.time;
    el('r7-level').textContent=r.level;
    el('r7-depart').textContent=r.departure;
    el('r7-source').textContent='Source : '+r.source;

    el('r7-official').href=r.trail;
    el('r7-map').href=r.departurl;
    el('r7-map').textContent=r.departure_label;

    usedFallback=false;
    photo.src='/photos/'+r.photo+'.jpg';

    tabs.forEach((b,i)=>{
      b.id='distance-'+routes[i].target;
      b.setAttribute('aria-selected',String(i===index));
      b.tabIndex=i===index?0:-1;
    });
    el('r7-panel').setAttribute('aria-labelledby','distance-'+r.target);
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

  el('r7-book').addEventListener('click',()=>{el('r7-book').href='/?sejour=midweek&distance='+routes[selected].target+'#reserver';});

  const distance=Number(new URLSearchParams(location.search).get('distance'));
  show(Math.max(0,routes.findIndex(route=>route.target===distance)));
})();


(function(){
 document.querySelectorAll('.mobile-nav a').forEach(link=>link.addEventListener('click',()=>link.closest('details').removeAttribute('open')));
 const map=document.getElementById('trace-map');if(!map)return;
 fetch('/traces/promenade-12.geojson').then(response=>{if(!response.ok)throw Error();return response.json()}).then(data=>{
  const geometry=data.features?data.features.find(feature=>feature.geometry?.type==='LineString')?.geometry:data.geometry||data;
  if(!geometry||geometry.type!=='LineString')throw Error();
  const coords=geometry.coordinates,longitude=coords.map(point=>point[0]),latitude=coords.map(point=>point[1]);
  const minX=Math.min(...longitude),maxX=Math.max(...longitude),minY=Math.min(...latitude),maxY=Math.max(...latitude);
  const ratio=Math.cos((minY+maxY)/2*Math.PI/180),scale=Math.min(440/((maxX-minX)*ratio),260/(maxY-minY));
  const points=coords.map(point=>[(point[0]-(minX+maxX)/2)*ratio*scale+250,160-(point[1]-(minY+maxY)/2)*scale]);
  const path=document.createElementNS('http://www.w3.org/2000/svg','polyline');path.setAttribute('points',points.map(point=>point.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#183628');path.setAttribute('stroke-width','3');path.setAttribute('stroke-linejoin','round');map.append(path);
  const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',points[0][0]);dot.setAttribute('cy',points[0][1]);dot.setAttribute('r','6');dot.setAttribute('fill','#aa8061');map.append(dot);
  document.getElementById('trace-status').textContent='Aperçu du GPX · point cuivre : début de la trace. Sans fond de carte.';
 }).catch(()=>{document.getElementById('trace-status').textContent='Aperçu indisponible. Téléchargez le GPX ou consultez la fiche du circuit.'});
})();
