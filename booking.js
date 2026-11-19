function bookingDateAfter(value, count) {
  const current = new Date(value+'T12:00:00');
  current.setDate(current.getDate()+count);
  return current.getFullYear()+'-'+String(current.getMonth()+1).padStart(2,'0')+'-'+String(current.getDate()).padStart(2,'0');
}

function bookingSlot(day, packageName, calendarDays, today) {
  const weekday = packageName==='midweek'?1:5;
  if (new Date(day.date+'T12:00:00').getDay()!==weekday) return {selectable:false,reason:'other'};
  if (day.date<today) return {selectable:false,reason:'past'};
  const duration = packageName==='midweek'?4:3;
  const departure = bookingDateAfter(day.date,duration);
  for (let offset=0;offset<duration;offset++) {
    const night=calendarDays.get(bookingDateAfter(day.date,offset));
    if (!night) return {selectable:false,reason:'unknown'};
    if (night.state==='occupied') return {selectable:false,reason:'occupied'};
  }
  if (day.cents===null || day.price_basis!=='package') return {selectable:false,reason:'unpriced'};
  return {selectable:true,reason:'available',departure};
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
    const weekday=packageField.value==='midweek'?1:5;
    const first=new Date(today+'T12:00:00');
    const minimum=bookingDateAfter(today,(weekday-first.getDay()+7)%7);
    arrival.min=minimum;arrival.step='7';arrival.setCustomValidity('');
    departure.value='';
    if(arrival.value) {
      const start=new Date(arrival.value+'T12:00:00');
      if(start.getDay()!==weekday)arrival.setCustomValidity(packageField.value==='midweek'?'Choisissez un lundi pour le mid-week.':'Choisissez un vendredi pour le week-end.');
      else if(arrival.value<today)arrival.setCustomValidity('Choisissez une date d’arrivée à venir.');
      else {departure.value=bookingDateAfter(arrival.value,packageField.value==='midweek'?4:3);departure.min=departure.value}
    }
    document.getElementById('package-schedule').textContent=packageField.value==='midweek'?'Arrivée le lundi à 17 h, départ le vendredi à 9 h.':'Arrivée le vendredi à 17 h, départ le lundi à 9 h.';
    document.getElementById('selected-stay').textContent=departure.value
      ?packageLabel()+' du '+prettyDate(arrival.value)+' à 17 h au '+prettyDate(departure.value)+' à 9 h.'
      :'Choisissez '+(packageField.value==='midweek'?'un lundi':'un vendredi')+' dans le calendrier pour sélectionner votre séjour.';
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
      const calendars=await Promise.all([api('/api/availability?year='+year),...(selectedMonth===11&&year<2100?[api('/api/availability?year='+(year+1))]:[])]);
      if(current!==calendarRevision)return;
      const days=new Map(calendars.flatMap(data=>data.days).map(day=>[day.date,day]));
      ['Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.','Dim.'].forEach(label=>{const cell=document.createElement('span');cell.className='calendar-weekday';cell.textContent=label;calendar.append(cell)});
      const offset=(new Date(year,selectedMonth,1).getDay()+6)%7;
      for(let count=0;count<offset;count++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');calendar.append(blank)}
      let available=0;
      calendars[0].days.filter(day=>Number(day.date.slice(5,7))===selectedMonth+1).forEach(day=>{
        const slot=bookingSlot(day,packageField.value,days,today);
        const candidate=slot.reason!=='other';
        const cell=document.createElement(candidate?'button':'span');
        cell.className='calendar-day';
        cell.dataset.state=day.state;
        cell.dataset.date=day.date;
        cell.dataset.arrival=String(candidate);
        cell.dataset.selected=String(Boolean(arrival.value&&departure.value&&day.date>=arrival.value&&day.date<departure.value));
        cell.dataset.checkout=String(day.date===departure.value);
        const number=document.createElement('span');number.className='day-number';number.textContent=Number(day.date.slice(8));cell.append(number);
        if(candidate) {
          cell.type='button';cell.disabled=!slot.selectable;
          cell.setAttribute('aria-pressed',String(day.date===arrival.value));
          const label=document.createElement('small');
          label.textContent={available:'Arrivée',occupied:'Complet',unpriced:'À définir',past:'Passé',unknown:'À vérifier'}[slot.reason];cell.append(label);
          if(slot.selectable)available++;
          cell.setAttribute('aria-label',slot.selectable
            ?packageLabel()+' du '+prettyDate(day.date)+' à 17 h au '+prettyDate(slot.departure)+' à 9 h. Forfait logement '+money(day.cents)+', ménage en supplément. Sélectionner ce séjour.'
            :prettyDate(day.date)+' : '+label.textContent);
          cell.addEventListener('click',()=>{invalidate();arrival.value=day.date;updatePackage();renderCalendar(day.date)});
        } else cell.setAttribute('aria-label',prettyDate(day.date)+(day.date===departure.value?' : départ à 9 h':''));
        cell.title=cell.getAttribute('aria-label');
        calendar.append(cell);
      });
      calendarMessage.textContent=available
        ?'Cliquez sur '+(packageField.value==='midweek'?'un lundi':'un vendredi')+' marqué « Arrivée ». Le séjour complet est sélectionné automatiquement.'
        :'Aucun départ de forfait disponible et tarifé ce mois-ci. Essayez le mois suivant ou l’autre forfait.';
      if(focusDate)calendar.querySelector('[data-date="'+focusDate+'"]')?.focus({preventScroll:true});
    } catch(error) {
      if(current===calendarRevision)calendarMessage.textContent='Calendrier indisponible : '+error.message+'. Réessayez en changeant de mois.';
    } finally {if(current===calendarRevision)calendar.setAttribute('aria-busy','false')}
  }
  document.getElementById('previous-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar()});
  document.getElementById('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar()});
  packageInputs.forEach(input=>input.addEventListener('change',()=>{invalidate();arrival.value='';updatePackage();renderCalendar()}));
  arrival.addEventListener('input',()=>{invalidate();updatePackage()});
  arrival.addEventListener('change',()=>{updatePackage();if(arrival.value){month=new Date(arrival.value+'T12:00:00');month.setDate(1)}renderCalendar()});
  guests.addEventListener('input',invalidate);
  async function calculate() {
    if(![arrival,departure,guests].every(input=>input.reportValidity()))return null;
    const current=++revision;quote=null;result.className='quote-details';result.textContent='Vérification du forfait…';calculateButton.disabled=true;
    try {
      const data=await api('/api/quote',payload());
      if(current!==revision)return null;
      quote=data;result.replaceChildren();
      const total=document.createElement('p');total.className='quote-total';total.textContent=money(data.total_cents)+' pour votre '+data.package_label.toLowerCase();result.append(total);
      const price=document.createElement('p');price.textContent='Logement entier : '+money(data.package_cents)+' + ménage : '+money(data.cleaning_cents)+'.';result.append(price);
      const schedule=document.createElement('p');schedule.textContent=prettyDate(data.arrival)+' à 17 h → '+prettyDate(data.departure)+' à 9 h.';result.append(schedule);
      return data;
    } catch(error){if(current===revision){result.className='quote-details quote-error';result.textContent=error.message}return null}
    finally {calculateButton.disabled=false}
  }
  calculateButton.addEventListener('click',calculate);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
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
