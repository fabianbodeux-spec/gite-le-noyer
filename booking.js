function bookingDateAfter(value, count) {
  const current = new Date(value+'T12:00:00');
  current.setDate(current.getDate()+count);
  return current.getFullYear()+'-'+String(current.getMonth()+1).padStart(2,'0')+'-'+String(current.getDate()).padStart(2,'0');
}

function bookingSlot(day, packageName, calendarDays, today) {
  const weekday = new Date(day.date+'T12:00:00').getDay();
  const validArrival=packageName==='midweek'?[1,2,3].includes(weekday):[5,6].includes(weekday);
  if (!validArrival) return {selectable:false,reason:'other',departures:[]};
  if (day.date<today) return {selectable:false,reason:'past'};
  if (day.cents===null || day.price_basis!=='package') return {selectable:false,reason:'unpriced',departures:[]};
  const maxNights=packageName==='midweek'?5-weekday:(weekday===5?3:2);
  const departures=[];
  for(let nights=2;nights<=maxNights;nights++) {
    let free=true;
    for(let offset=0;offset<nights;offset++) {
      const night=calendarDays.get(bookingDateAfter(day.date,offset));
      if(!night){free=false;break}
      if(night.state==='occupied'){free=false;break}
    }
    if(free)departures.push(bookingDateAfter(day.date,nights));
  }
  if(!departures.length)return {selectable:false,reason:'occupied',departures:[]};
  return {selectable:true,reason:'available',departures};
}

function bookingDateChoice(selection, value, packageName, calendarDays, today) {
  const start=calendarDays.get(selection.arrival);
  if(selection.arrival&&!selection.departure&&start) {
    const slot=bookingSlot(start,packageName,calendarDays,today);
    if(slot.selectable&&slot.departures.includes(value))return {arrival:selection.arrival,departure:value};
  }
  const day=calendarDays.get(value);
  if(day&&bookingSlot(day,packageName,calendarDays,today).selectable)return {arrival:value,departure:''};
  return {arrival:selection.arrival,departure:selection.departure};
}

(() => {
  const form=document.getElementById('booking-form');
  if (!form) return;
  const arrival=form.elements.arrival,departure=form.elements.departure,guests=form.elements.guests;
  const packageField=form.elements.package;
  const packageInputs=Array.from(form.querySelectorAll('input[name="package"]'));
  const calendar=document.getElementById('guest-calendar');
  const calendarMessage=document.getElementById('calendar-message');
  const result=document.getElementById('quote-result');
  const status=document.getElementById('status');
  const submit=document.getElementById('submit');
  const calculateButton=document.getElementById('calculate-quote');
  const now=new Date();
  const today=bookingDateAfter(now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0'),0);
  let month=new Date(now.getFullYear(),now.getMonth(),1);
  let quote=null,revision=0,calendarRevision=0;
  const money=value=>new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(value/100);
  const prettyDate=value=>new Intl.DateTimeFormat('fr-BE',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
  const packageLabel=()=>packageField.value==='midweek'?'Mid-week':'Week-end';
  const payload=()=>Object.fromEntries(new FormData(form));
  function invalidate() {quote=null;revision++;result.replaceChildren();status.textContent='';status.className=''}
  function updatePackage() {
    arrival.min=today;arrival.step='1';arrival.setCustomValidity('');departure.setCustomValidity('');
    if(arrival.value) {
      const start=new Date(arrival.value+'T12:00:00');
      const weekday=start.getDay(),valid=packageField.value==='midweek'?[1,2,3].includes(weekday):[5,6].includes(weekday);
      if(!valid)arrival.setCustomValidity(packageField.value==='midweek'?'Choisissez une arrivée entre lundi et mercredi.':'Choisissez une arrivée le vendredi ou le samedi.');
      else if(arrival.value<today)arrival.setCustomValidity('Choisissez une date d’arrivée à venir.');
      const maxNights=packageField.value==='midweek'?5-weekday:(weekday===5?3:2);
      departure.min=bookingDateAfter(arrival.value,2);departure.max=bookingDateAfter(arrival.value,maxNights);
      if(departure.value) {
        const nights=(new Date(departure.value+'T12:00:00')-start)/86400000;
        if(nights<2||nights>maxNights)departure.setCustomValidity('Le séjour doit durer au moins deux nuits et respecter la période choisie.');
      }
    }
    document.getElementById('package-schedule').textContent=packageField.value==='midweek'?'Arrivée du lundi au mercredi à 17 h, départ au plus tard vendredi à 9 h. Minimum 2 nuits, tarif ajusté selon la durée.':'Arrivée vendredi ou samedi à 17 h, départ au plus tard lundi à 9 h. Minimum 2 nuits, tarif week-end fixe.';
    document.getElementById('selected-stay').textContent=departure.value
      ?packageLabel()+' du '+prettyDate(arrival.value)+' à 17 h au '+prettyDate(departure.value)+' à 9 h.'
      :arrival.value
        ?'Arrivée le '+prettyDate(arrival.value)+' à 17 h. Choisissez un départ parmi les dates proposées (minimum 2 nuits).'
        :'Cliquez sur votre arrivée, puis sur votre départ dans le calendrier.';
  }
  async function api(path,data) {
    const response=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});
    const body=await response.json();
    if(!response.ok)throw Error(body.error||'Réessayez dans un instant.');
    return body;
  }
  async function renderCalendar(focusDate) {
    const current=++calendarRevision;
    const year=month.getFullYear(),selectedMonth=month.getMonth();
    document.getElementById('month-title').textContent=new Intl.DateTimeFormat('fr-BE',{month:'long',year:'numeric'}).format(month);
    calendar.setAttribute('aria-busy','true');calendar.replaceChildren();
    calendarMessage.textContent='Chargement des disponibilités…';
    document.getElementById('previous-month').disabled=year===now.getFullYear()&&selectedMonth===now.getMonth();
    document.getElementById('next-month').disabled=year===2100&&selectedMonth===11;
    try {
      const years=new Set([year]);
      if(selectedMonth===11&&year<2100)years.add(year+1);
      if(arrival.value)years.add(Number(arrival.value.slice(0,4)));
      const calendars=await Promise.all([...years].map(value=>api('/api/availability?year='+value)));
      if(current!==calendarRevision)return;
      const days=new Map(calendars.flatMap(data=>data.days).map(day=>[day.date,day]));
      const selection={arrival:arrival.value,departure:departure.value};
      const selectedStart=days.get(selection.arrival);
      const pendingSlot=selection.arrival&&!selection.departure&&selectedStart?bookingSlot(selectedStart,packageField.value,days,today):null;
      ['Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.','Dim.'].forEach(label=>{const cell=document.createElement('span');cell.className='calendar-weekday';cell.textContent=label;calendar.append(cell)});
      const offset=(new Date(year,selectedMonth,1).getDay()+6)%7;
      for(let count=0;count<offset;count++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');calendar.append(blank)}
      let available=0;
      calendars.find(data=>data.year===year).days.filter(day=>Number(day.date.slice(5,7))===selectedMonth+1).forEach(day=>{
        const slot=bookingSlot(day,packageField.value,days,today);
        const endChoice=Boolean(pendingSlot?.selectable&&pendingSlot.departures.includes(day.date));
        const candidate=slot.reason!=='other'||endChoice;
        const cell=document.createElement(candidate?'button':'span');
        cell.className='calendar-day';
        cell.dataset.state=day.state;
        cell.dataset.date=day.date;
        cell.dataset.arrival=String(candidate);
        cell.dataset.selected=String(Boolean(day.date===arrival.value||arrival.value&&departure.value&&day.date>=arrival.value&&day.date<=departure.value));
        cell.dataset.endChoice=String(endChoice);
        cell.dataset.checkout=String(day.date===departure.value);
        const number=document.createElement('span');number.className='day-number';number.textContent=Number(day.date.slice(8));cell.append(number);
        if(candidate) {
          cell.type='button';cell.disabled=!slot.selectable&&!endChoice;
          cell.setAttribute('aria-pressed',String(day.date===arrival.value||day.date===departure.value));
          const label=document.createElement('small');
          label.textContent=endChoice?'Départ':day.date===arrival.value?'Arrivée':{available:'Arrivée',occupied:'Complet',unpriced:'À définir',past:'Passé',unknown:'À vérifier'}[slot.reason];cell.append(label);
          if(slot.selectable)available++;
          cell.setAttribute('aria-label',endChoice
            ?'Choisir le départ le '+prettyDate(day.date)+' à 9 h et valider les dates de votre '+packageLabel()+'.'
            :slot.selectable
            ?'Choisir l’arrivée le '+prettyDate(day.date)+' à 17 h. Départs possibles : '+slot.departures.map(prettyDate).join(', ')+'. Minimum deux nuits.'
            :prettyDate(day.date)+' : '+label.textContent);
          cell.addEventListener('click',()=>{
            invalidate();
            const next=bookingDateChoice({arrival:arrival.value,departure:departure.value},day.date,packageField.value,days,today);
            arrival.value=next.arrival;departure.value=next.departure;updatePackage();
            const newStart=days.get(next.arrival),newSlot=newStart?bookingSlot(newStart,packageField.value,days,today):null;
            const focus=next.departure||newSlot?.departures?.[0]||next.arrival;
            if(!next.departure){month=new Date(focus+'T12:00:00');month.setDate(1)}
            renderCalendar(focus);
          });
        } else {
          cell.setAttribute('aria-label',prettyDate(day.date)+(day.date===departure.value?' : départ à 9 h':''));
          if(day.date===departure.value){cell.tabIndex=-1;const label=document.createElement('small');label.textContent='Départ';cell.append(label)}
        }
        cell.title=cell.getAttribute('aria-label');
        calendar.append(cell);
      });
      calendarMessage.textContent=selection.arrival&&!selection.departure
        ?pendingSlot?.selectable
            ?'Arrivée choisie. Choisissez un des départs marqués « Départ » (au moins 2 nuits).'
          :'Cette arrivée n’est plus disponible. Choisissez une nouvelle arrivée ou effacez les dates.'
        :selection.departure
          ?'Vos deux dates sont choisies. Elles sont affichées dans le récapitulatif du séjour.'
          :available
            ?'Choisissez une arrivée puis un départ au choix, avec un minimum de 2 nuits dans la période indiquée.'
            :'Aucune arrivée disponible et tarifée ce mois-ci. Essayez le mois suivant ou l’autre forfait.';
      if(focusDate)calendar.querySelector('[data-date="'+focusDate+'"]')?.focus({preventScroll:true});
    } catch(error) {
      if(current===calendarRevision)calendarMessage.textContent='Calendrier indisponible : '+error.message+'. Réessayez en changeant de mois.';
    } finally {if(current===calendarRevision)calendar.setAttribute('aria-busy','false')}
  }
  document.getElementById('previous-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar()});
  document.getElementById('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar()});
  function clearSelection() {invalidate();arrival.value='';departure.value='';updatePackage();renderCalendar()}
  packageInputs.forEach(input=>input.addEventListener('change',clearSelection));
  document.getElementById('clear-booking-dates').addEventListener('click',clearSelection);
  guests.addEventListener('input',invalidate);
  async function calculate() {
    if(!arrival.value||!departure.value){result.className='quote-details quote-error';result.textContent='Cliquez sur votre arrivée puis sur votre départ dans le grand calendrier.';return null}
    if(![arrival,departure,guests].every(input=>input.reportValidity()))return null;
    const current=++revision;quote=null;result.className='quote-details';result.textContent='Vérification du forfait…';calculateButton.disabled=true;
    try {
      const data=await api('/api/quote',payload());
      if(current!==revision)return null;
      quote=data;result.replaceChildren();
      const total=document.createElement('p');total.className='quote-total';total.textContent=money(data.total_cents)+' pour votre '+data.package_label.toLowerCase();result.append(total);
      const price=document.createElement('p');price.textContent='Logement entier : '+money(data.package_cents)+(data.package==='midweek'?' (tarif ajusté sur '+data.nights+' nuits, référence '+money(data.base_package_cents)+' pour 4 nuits)':' (tarif week-end fixe)')+' + ménage : '+money(data.cleaning_cents)+' + charges fixes de saison : '+money(data.charges_cents)+'.';result.append(price);
      const schedule=document.createElement('p');schedule.textContent=prettyDate(data.arrival)+' à 17 h → '+prettyDate(data.departure)+' à 9 h.';result.append(schedule);
      return data;
    } catch(error){if(current===revision){result.className='quote-details quote-error';result.textContent=error.message}return null}
    finally {calculateButton.disabled=false}
  }
  calculateButton.addEventListener('click',calculate);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!arrival.value||!departure.value){await calculate();return}
    if(!form.reportValidity())return;
    if(!quote){const data=await calculate();status.textContent=data?'Vérifiez le forfait affiché, puis cliquez à nouveau sur « Demander ce séjour ».':'Vérifiez les dates et le message indiqué avant de continuer.';return}
    const data=payload();data.quote_token=quote.token;submit.disabled=true;submit.textContent='Enregistrement…';
    try {
      const response=await api('/api/requests',data);
      status.className='';status.textContent='Demande n° '+response.id+' enregistrée pour '+money(response.total_cents)+'. En attente de confirmation du propriétaire. Aucun paiement effectué ni e-mail envoyé.';
      quote=null;revision++;form.reset();updatePackage();result.replaceChildren();renderCalendar();
    }catch(error){quote=null;status.className='error';status.textContent=error.message}
    finally{submit.disabled=false;submit.textContent='Demander ce séjour'}
  });
  updatePackage();renderCalendar();
})();
