// Le Noyer : un membre invité choisit son code personnel à 6 chiffres.
// Le jeton d'invitation est lu dans l'ancre de l'adresse (#...), jamais envoyée dans les journaux du serveur.
(() => {
  const $ = (id) => document.getElementById(id);
  const token = decodeURIComponent(location.hash.slice(1));
  const form = $('invite-form'), status = $('invite-status');
  const fail = (message) => { $('invite-intro').textContent = message; form.hidden = true; };

  async function load() {
    if (!token) return fail('Ce lien est incomplet. Ouvrez le lien reçu en entier, ou demandez-en un nouveau au propriétaire.');
    try {
      const response = await fetch('/api/account/invitation?token=' + encodeURIComponent(token));
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Lien invalide.');
      $('invite-role').textContent = data.role_label;
      $('invite-title').textContent = 'Bonjour ' + data.name;
      $('invite-intro').textContent = 'Choisissez votre code personnel à 6 chiffres. Vous l’utiliserez avec votre prénom pour vous connecter.';
      form.hidden = false;
      $('pin').focus();
    } catch (error) { fail(error.message); }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    const pin = $('pin').value.trim(), confirm = $('pin-confirm').value.trim();
    if (!/^\d{6}$/.test(pin)) { status.textContent = 'Le code doit contenir exactement 6 chiffres.'; return; }
    if (pin !== confirm) { status.textContent = 'Les deux codes ne sont pas identiques.'; return; }
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const response = await fetch('/api/account/invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, pin }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Enregistrement impossible.');
      history.replaceState(null, '', '/invitation');
      status.textContent = 'Code enregistré. Ouverture de votre espace…';
      setTimeout(() => { location.href = data.role === 'owner' ? '/admin' : '/equipe-menage'; }, 900);
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });

  load();
})();
