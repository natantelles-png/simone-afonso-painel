/* Painel do blog da Simone. Sem bibliotecas: fala direto com a API do Supabase.
   A senha nunca fica no código; o login é validado pelo Supabase. */
(function () {
  'use strict';
  var C = window.SA_CONFIG || {};
  var URL = (C.SUPABASE_URL || '').replace(/\/$/, '');
  var KEY = C.SUPABASE_ANON_KEY || '';
  var CATS = ['Neuroarquitetura', 'Comercial', 'Home Relooking', 'Home Staging', 'Bastidores'];
  var app = document.getElementById('app');
  var topo = document.getElementById('topo');
  var session = null;
  var dirty = false;

  /* ---------- utilidades ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slugify(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/g, ''); }
  function words(s) { s = (s || '').trim(); return s ? s.split(/\s+/).length : 0; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toLocalInput(d) { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /* Cola texto vindo de ChatGPT/Gemini: converte marcações simples (## Título, ### Subtítulo, - lista, 1. lista, > citação,
     **negrito**, *itálico*, [texto](https://link)) em formatação. Sem marcações, devolve '' e o texto entra como veio. */
  function mdToHtml(src) {
    var s = String(src || '').replace(/\r\n?/g, '\n').trim();
    if (!/^(#{2,3} |[-*] |\d+[.)] |> )/m.test(s) && !/\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/.test(s)) return '';
    function e(x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function inl(x) {
      x = e(x);
      x = x.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, a, u) { return '<a href="' + u.replace(/"/g, '%22') + '">' + a + '</a>'; });
      x = x.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
      return x;
    }
    var out = [], list = null, para = [];
    function endPara() { if (para.length) { out.push('<p>' + para.join(' ') + '</p>'); para = []; } }
    function endList() { if (list) { out.push('<' + list.t + '>' + list.i.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</' + list.t + '>'); list = null; } }
    s.split('\n').forEach(function (ln) {
      var l = ln.trim(), m;
      if (!l) { endPara(); endList(); return; }
      if ((m = /^(#{1,3})\s+(.+)$/.exec(l))) { endPara(); endList(); out.push(m[1].length >= 3 ? '<h3>' + inl(m[2]) + '</h3>' : '<h2>' + inl(m[2]) + '</h2>'); return; }
      if ((m = /^[-*]\s+(.+)$/.exec(l))) { endPara(); if (!list || list.t !== 'ul') { endList(); list = { t: 'ul', i: [] }; } list.i.push(inl(m[1])); return; }
      if ((m = /^\d+[.)]\s+(.+)$/.exec(l))) { endPara(); if (!list || list.t !== 'ol') { endList(); list = { t: 'ol', i: [] }; } list.i.push(inl(m[1])); return; }
      if ((m = /^>\s?(.+)$/.exec(l))) { endPara(); endList(); out.push('<blockquote>' + inl(m[1]) + '</blockquote>'); return; }
      endList(); para.push(inl(l));
    });
    endPara(); endList();
    return out.join('');
  }
  function fmt(d) { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function msg(el, text, kind) { el.innerHTML = text ? '<div class="msg ' + kind + '" role="' + (kind === 'erro' ? 'alert' : 'status') + '">' + esc(text) + '</div>' : ''; }

  /* ---------- API ---------- */
  function headers(extra) {
    var h = { apikey: KEY, 'Content-Type': 'application/json' };
    h.Authorization = 'Bearer ' + (session ? session.access_token : KEY);
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }
  function req(path, opt) {
    return fetch(URL + path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
        if (!r.ok) { var e = new Error((j && (j.msg || j.message || j.error_description || j.error)) || ('Erro ' + r.status)); e.status = r.status; e.body = j; throw e; }
        return j;
      });
    });
  }
  function setSession(s) {
    if (s && s.access_token) {
      session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)) };
      store('sa_sess', JSON.stringify(session));
    } else { session = null; store('sa_sess', null); }
  }
  function ensureFresh() {
    if (!session) return Promise.reject(new Error('Sessão encerrada.'));
    if (session.expires_at - 60 > Date.now() / 1000) return Promise.resolve();
    return req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) })
      .then(setSession).catch(function (e) { setSession(null); throw new Error('Sua sessão expirou. Entre de novo.'); });
  }
  function api(path, opt) { return ensureFresh().then(function () { opt = opt || {}; opt.headers = headers(opt.headers); return req(path, opt); }); }

  /* ---------- telas ---------- */
  function setView(html) { app.innerHTML = html; app.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  function needsConfig() { return !URL || URL.indexOf('[INSERIR') >= 0 || !KEY || KEY.indexOf('[INSERIR') >= 0; }

  function viewLogin(note) {
    topo.hidden = true;
    setView('<section class="cartao login"><img src="logo-ameixa.png" alt="Simone Afonso" width="130" height="75"><h1>Entrar no painel</h1>' +
      '<p class="dica">Use o e-mail e a senha cadastrados.</p><div id="m"></div>' +
      '<form id="f" novalidate><label for="em">E-mail</label><input id="em" type="email" autocomplete="username" required>' +
      '<label for="se">Senha</label><input id="se" type="password" autocomplete="current-password" required>' +
      '<div class="acoes"><button class="btn" type="submit" id="go">Entrar</button></div></form>' +
      '<p class="dica"><a href="#" id="esq">Esqueci minha senha</a></p></section>');
    var m = $('#m'); if (note) msg(m, note, 'ok');
    if (needsConfig()) msg(m, 'Falta configurar o painel (config.js). Avise quem montou o site.', 'erro');
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var b = $('#go'); b.disabled = true; msg(m, '');
      req('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#em').value.trim(), password: $('#se').value }) })
        .then(function (s) { setSession(s); viewList(); })
        .catch(function (er) { b.disabled = false; msg(m, er.status === 400 ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + er.message, 'erro'); });
    });
    $('#esq').addEventListener('click', function (e) {
      e.preventDefault(); var em = $('#em').value.trim();
      if (!em) { msg(m, 'Digite seu e-mail acima e clique de novo.', 'erro'); $('#em').focus(); return; }
      req('/auth/v1/recover', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) })
        .then(function () { msg(m, 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.', 'ok'); })
        .catch(function (er) { msg(m, 'Não foi possível enviar agora: ' + er.message, 'erro'); });
    });
  }

  function viewNewPassword(token) {
    topo.hidden = true;
    setView('<section class="cartao login"><img src="logo-ameixa.png" alt="Simone Afonso" width="130" height="75"><h1>Crie sua senha</h1>' +
      '<p class="dica">Use pelo menos 12 caracteres. Uma frase longa é melhor que uma palavra difícil.</p><div id="m"></div>' +
      '<form id="f" novalidate><label for="s1">Nova senha</label><input id="s1" type="password" autocomplete="new-password" minlength="12" required>' +
      '<label for="s2">Repita a senha</label><input id="s2" type="password" autocomplete="new-password" required>' +
      '<div class="acoes"><button class="btn" type="submit" id="go">Salvar senha</button></div></form></section>');
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var m = $('#m'), a = $('#s1').value, b = $('#s2').value;
      if (a.length < 12) { msg(m, 'A senha precisa ter pelo menos 12 caracteres.', 'erro'); return; }
      if (a !== b) { msg(m, 'As duas senhas não são iguais.', 'erro'); return; }
      $('#go').disabled = true;
      req('/auth/v1/user', { method: 'PUT', headers: { apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ password: a }) })
        .then(function () { history.replaceState(null, '', location.pathname); viewLogin('Senha criada. Agora é só entrar.'); })
        .catch(function (er) { $('#go').disabled = false; msg(m, 'Não foi possível salvar: ' + er.message, 'erro'); });
    });
  }

  function statusOf(p) {
    if (p.status !== 'published') return '<span class="sel rasc">Rascunho</span>';
    return new Date(p.publish_at) > new Date() ? '<span class="sel agenda">Agendado</span>' : '<span class="sel pub">No ar</span>';
  }

  function viewList() {
    dirty = false; topo.hidden = false;
    setView('<div class="barra"><h1>Seus textos</h1><button class="btn" id="novo" type="button">Escrever texto novo</button></div><div id="m"></div><div class="cartao" id="lista"><p class="carregando">Carregando…</p></div>' +
      '<p class="dica">Depois de publicar, o texto entra no site em até 30 minutos.</p>');
    $('#novo').addEventListener('click', function () { viewEditor(null); });
    api('/rest/v1/posts?select=id,title,slug,status,publish_at,category,updated_at&order=updated_at.desc').then(function (rows) {
      var box = $('#lista');
      if (!rows.length) { box.innerHTML = '<p>Você ainda não escreveu nenhum texto. Clique em “Escrever texto novo”.</p>'; return; }
      box.innerHTML = '<table><thead><tr><th>Texto</th><th>Assunto</th><th>Situação</th><th>Data</th></tr></thead><tbody>' + rows.map(function (p) {
        return '<tr><td><a href="#" data-id="' + esc(p.id) + '">' + esc(p.title || '(sem título)') + '</a></td><td>' + esc(p.category) + '</td><td>' + statusOf(p) + '</td><td>' + fmt(p.publish_at) + '</td></tr>';
      }).join('') + '</tbody></table>';
      box.addEventListener('click', function (e) { var a = e.target.closest('a[data-id]'); if (a) { e.preventDefault(); viewEditor(a.getAttribute('data-id')); } });
    }).catch(function (er) { handleErr(er, $('#m')); $('#lista').innerHTML = ''; });
  }

  function handleErr(er, m) {
    if (er.status === 401 || /sessão/i.test(er.message)) { setSession(null); viewLogin('Entre de novo para continuar.'); return; }
    msg(m, 'Algo deu errado: ' + er.message, 'erro');
  }

  /* ---------- editor ---------- */
  function viewEditor(id) {
    topo.hidden = false;
    setView('<p class="carregando">Carregando…</p>');
    var done = function (p) { renderEditor(p); };
    if (!id) return done({ title: '', slug: '', category: CATS[0], excerpt: '', answer: '', body_html: '', cover_url: '', cover_alt: '', keywords: '', faq: [], status: 'draft', publish_at: new Date().toISOString() });
    api('/rest/v1/posts?id=eq.' + encodeURIComponent(id) + '&select=*').then(function (r) { if (!r.length) throw new Error('Texto não encontrado.'); done(r[0]); }).catch(function (er) { viewList(); });
  }

  function renderEditor(p) {
    var isNew = !p.id, slugTouched = !isNew, faq = (p.faq || []).slice();
    var published = p.status === 'published' && new Date(p.publish_at) <= new Date();
    setView('<div class="barra"><h1>' + (isNew ? 'Texto novo' : 'Editar texto') + '</h1><button class="btn leve" id="voltar" type="button">Voltar à lista</button></div><div id="m"></div>' +
      '<form id="f" novalidate>' +
      '<div class="cartao"><h2>1. O texto</h2>' +
      '<label for="t">Título</label><input id="t" type="text" maxlength="110" autocomplete="off"><div class="cont" id="ct"></div>' +
      '<p class="dica">Escreva como a pessoa pesquisaria no Google. Ex.: “O que é neuroarquitetura e o que ela muda na casa”.</p>' +
      '<div class="linha"><div><label for="c">Assunto</label><select id="c">' + CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="s">Endereço do texto</label><input id="s" type="text" maxlength="70" autocomplete="off"' + (published ? ' readonly' : '') + '></div></div>' +
      '<p class="dica" id="surl"></p>' +
      '<label for="a">Resposta rápida (de 40 a 60 palavras)</label><textarea id="a" maxlength="500"></textarea><div class="cont" id="ca"></div>' +
      '<p class="dica">Responda a pergunta do título direto, em um parágrafo. É esse trecho que o Google e as inteligências artificiais costumam citar.</p>' +
      '<label for="e">Resumo para o Google (até 155 letras)</label><textarea id="e" maxlength="200"></textarea><div class="cont" id="ce"></div>' +
      '<span class="rot" id="rt">Texto completo</span><div class="ferr" role="toolbar" aria-label="Formatação do texto" aria-controls="ed">' +
      btn('h2', 'Título') + btn('h3', 'Subtítulo') + btn('b', '<b>N</b>', 'Negrito') + btn('i', '<i>I</i>', 'Itálico') + btn('ul', '• Lista') + btn('ol', '1. Lista') + btn('q', '“ Citação') + btn('p', 'Parágrafo') + btn('a', 'Link') + btn('img', 'Foto') + '</div>' +
      '<div id="ed" class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="rt" data-vazio="Comece a escrever aqui. Use “Título” para separar as partes do texto."></div>' +
      '<p class="dica">Dica: use um “Título” a cada 150 a 250 palavras. Isso ajuda a leitura e o Google.</p></div>' +
      '<div class="cartao"><h2>2. Imagem de capa</h2><label for="cf">Foto principal do texto</label><input id="cf" type="file" accept="image/jpeg,image/png,image/webp"><div id="cm" role="status" class="dica"></div><div class="capa-prev" id="cp"></div>' +
      '<label for="ca2">Descreva a foto em uma frase</label><input id="ca2" type="text" maxlength="140" autocomplete="off"><p class="dica">Ex.: “Quarto de bebê com nuvem iluminada sobre o berço”.</p></div>' +
      '<div class="cartao"><h2>3. Perguntas frequentes</h2><p class="dica">De 2 a 5 perguntas que as pessoas fazem sobre o assunto. Aparecem no fim do texto e ajudam a ser encontrada em buscas por voz e por IA.</p><div id="faq"></div><button class="btn leve" id="addfaq" type="button">Adicionar pergunta</button></div>' +
      '<div class="cartao"><h2>4. Publicação</h2><fieldset><legend class="rot">Situação</legend>' +
      '<label class="radio"><input type="radio" name="st" value="draft"> Rascunho (só você vê)</label><label class="radio"><input type="radio" name="st" value="published"> Publicar</label></fieldset>' +
      '<label for="d">Data e hora de publicação</label><input id="d" type="datetime-local"><p class="dica">Escolha uma data futura para agendar.</p>' +
      '<label for="k">Palavras-chave (opcional, separadas por vírgula)</label><input id="k" type="text" maxlength="160" autocomplete="off"></div>' +
      '<div class="cartao"><h2>Checklist antes de publicar</h2><ul class="check" id="ck" aria-live="polite"></ul></div>' +
      '<div class="rodape-acoes"><button class="btn" id="salvar" type="submit">Salvar</button>' +
      (isNew ? '' : '<button class="btn perigo" id="apagar" type="button">Apagar texto</button>') + '</div></form>');

    var f = $('#f'), ed = $('#ed'), m = $('#m');
    function btn(k, label, aria) { return '<button type="button" data-cmd="' + k + '"' + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>'; }
    $('#t').value = p.title; $('#c').value = p.category; $('#s').value = p.slug; $('#a').value = p.answer; $('#e').value = p.excerpt;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (x) { }
    ed.innerHTML = cleanBody(p.body_html); $('#ca2').value = p.cover_alt; $('#k').value = p.keywords;
    $('#d').value = toLocalInput(p.publish_at); f.elements.st.value = p.status;
    var cover = p.cover_url || '';
    function showCover() { $('#cp').innerHTML = cover ? '<img src="' + esc(cover) + '" alt="Prévia da capa">' : ''; }
    showCover();

    function renderFaq() {
      $('#faq').innerHTML = faq.map(function (q, i) {
        return '<div class="faqi"><label for="fq' + i + '">Pergunta ' + (i + 1) + '</label><input id="fq' + i + '" type="text" data-i="' + i + '" data-k="q" maxlength="200" value="' + esc(q.q) + '">' +
          '<label for="fa' + i + '">Resposta</label><textarea id="fa' + i + '" data-i="' + i + '" data-k="a" maxlength="800">' + esc(q.a) + '</textarea>' +
          '<div class="acoes"><button type="button" class="btn perigo" data-rm="' + i + '">Remover</button></div></div>';
      }).join('');
    }
    renderFaq();
    $('#faq').addEventListener('input', function (e) { var t = e.target; if (t.dataset.i) { faq[+t.dataset.i][t.dataset.k] = t.value; touch(); } });
    $('#faq').addEventListener('click', function (e) { var r = e.target.getAttribute('data-rm'); if (r != null) { faq.splice(+r, 1); renderFaq(); touch(); } });
    $('#addfaq').addEventListener('click', function () { if (faq.length >= 6) return; faq.push({ q: '', a: '' }); renderFaq(); touch(); var l = $('#faq').querySelectorAll('input'); l[l.length - 1].focus(); });

    function counters() {
      var t = $('#t').value.trim().length, a = words($('#a').value), e = $('#e').value.trim().length;
      cnt('#ct', t + ' letras (ideal: 30 a 60)', t >= 30 && t <= 60, t > 70);
      cnt('#ca', a + ' palavras (ideal: 40 a 60)', a >= 40 && a <= 60, a > 80 || (a > 0 && a < 25));
      cnt('#ce', e + ' letras (ideal: 120 a 155)', e >= 120 && e <= 155, e > 165);
      $('#surl').textContent = 'Endereço no site: ' + C.SITE_URL + '/blog/' + ($('#s').value || '…') + '/';
    }
    function cnt(sel, text, good, bad) { var el = $(sel); el.textContent = text; el.className = 'cont ' + (good ? 'bom' : bad ? 'ruim' : ''); }
    function checklist() {
      var body = ed.innerText || '', n = words(body), h2 = ed.querySelectorAll('h2').length;
      var items = [
        ['Título entre 30 e 60 letras', $('#t').value.trim().length >= 30 && $('#t').value.trim().length <= 60],
        ['Resposta rápida entre 40 e 60 palavras', words($('#a').value) >= 40 && words($('#a').value) <= 60],
        ['Resumo para o Google entre 120 e 155 letras', $('#e').value.trim().length >= 120 && $('#e').value.trim().length <= 155],
        ['Texto com pelo menos 300 palavras (agora: ' + n + ')', n >= 300],
        ['Pelo menos 3 “Títulos” dentro do texto (agora: ' + h2 + ')', h2 >= 3],
        ['Imagem de capa com descrição', !!cover && $('#ca2').value.trim().length > 5],
        ['Pelo menos 2 perguntas frequentes completas', faq.filter(function (q) { return q.q.trim() && q.a.trim(); }).length >= 2],
        ['Pelo menos um link para outra página (projetos ou WhatsApp)', !!ed.querySelector('a')]
      ];
      $('#ck').innerHTML = items.map(function (i) { return '<li class="' + (i[1] ? 'ok' : '') + '">' + esc(i[0]) + '</li>'; }).join('');
    }
    function vazio() { ed.classList.toggle('vazio', !ed.textContent.trim() && !ed.querySelector('img')); }
    function touch() { dirty = true; vazio(); counters(); checklist(); }
    ed.addEventListener('focus', function () { if (!ed.textContent.trim() && !ed.querySelector('img') && !ed.querySelector('p')) { ed.innerHTML = '<p><br></p>'; var r = document.createRange(); r.setStart(ed.firstChild, 0); r.collapse(true); var sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); } });
    vazio(); counters(); checklist(); dirty = false;
    f.addEventListener('input', function (e) {
      if (e.target.id === 't' && !slugTouched && !published) $('#s').value = slugify($('#t').value);
      if (e.target.id === 's') { slugTouched = true; }
      touch();
    });
    ed.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text/plain');
      var h = mdToHtml(t);
      if (h) document.execCommand('insertHTML', false, h); else document.execCommand('insertText', false, t);
    });
    ed.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); f.requestSubmit(); } });

    /* barra de ferramentas */
    var savedRange = null;
    function keepSel() { var s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); }
    ['keyup', 'mouseup', 'blur'].forEach(function (ev) { ed.addEventListener(ev, keepSel); });
    function restoreSel() { ed.focus(); if (savedRange) { var s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } }
    $('.ferr').addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    $('.ferr').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; var k = b.dataset.cmd; restoreSel();
      var map = { h2: ['formatBlock', 'h2'], h3: ['formatBlock', 'h3'], p: ['formatBlock', 'p'], q: ['formatBlock', 'blockquote'], b: ['bold'], i: ['italic'], ul: ['insertUnorderedList'], ol: ['insertOrderedList'] };
      if (map[k]) { document.execCommand.apply(document, [map[k][0], false].concat(map[k][1] ? [map[k][1]] : [])); touch(); }
      else if (k === 'a') openLink(); else if (k === 'img') openImg();
    });
    function openLink() {
      var dlg = $('#dlg-link'), inp = $('#link-url'); inp.value = 'https://';
      dlg.onclose = function () { if (dlg.returnValue === 'ok' && /^https?:\/\//i.test(inp.value)) { restoreSel(); if (getSelection().isCollapsed) document.execCommand('insertHTML', false, '<a href="' + esc(inp.value) + '">' + esc(inp.value) + '</a>'); else document.execCommand('createLink', false, inp.value); touch(); } dlg.returnValue = ''; };
      dlg.showModal(); inp.focus();
    }
    function openImg() {
      var dlg = $('#dlg-img'), file = $('#img-file'), alt = $('#img-alt'), st = $('#img-msg'); file.value = ''; alt.value = ''; st.textContent = '';
      $('#f-img').onsubmit = function (e) {
        if (e.submitter && e.submitter.value !== 'ok') return;
        e.preventDefault(); if (!file.files[0] || !alt.value.trim()) return;
        st.textContent = 'Enviando a imagem…';
        upload(file.files[0], $('#s').value || 'texto').then(function (url) {
          dlg.close(); restoreSel();
          document.execCommand('insertHTML', false, '<img src="' + esc(url) + '" alt="' + esc(alt.value.trim()) + '">'); touch();
        }).catch(function (er) { st.textContent = 'Não foi possível enviar: ' + er.message; });
      };
      dlg.showModal();
    }
    $('#cf').addEventListener('change', function () {
      var file = this.files[0]; if (!file) return; $('#cm').textContent = 'Enviando a imagem…';
      upload(file, $('#s').value || 'capa').then(function (url) { cover = url; showCover(); $('#cm').textContent = 'Imagem enviada.'; touch(); })
        .catch(function (er) { $('#cm').textContent = 'Não foi possível enviar: ' + er.message; });
    });

    $('#voltar').addEventListener('click', function () { if (!dirty || confirm('Você tem alterações não salvas. Sair mesmo assim?')) viewList(); });
    if ($('#apagar')) $('#apagar').addEventListener('click', function () {
      if (!confirm('Apagar este texto de vez? Isso não pode ser desfeito.')) return;
      api('/rest/v1/posts?id=eq.' + encodeURIComponent(p.id), { method: 'DELETE' }).then(function () { viewList(); }).catch(function (er) { handleErr(er, m); });
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault(); msg(m, '');
      var title = $('#t').value.trim(), slug = slugify($('#s').value);
      var status = f.elements.st.value, pub = status === 'published';
      var errs = [];
      if (!title) errs.push('Escreva o título.'); if (!slug) errs.push('O endereço do texto não pode ficar vazio.');
      if (pub) {
        if (words($('#a').value) < 20) errs.push('Escreva a resposta rápida antes de publicar.');
        if (!$('#e').value.trim()) errs.push('Escreva o resumo para o Google.');
        if (!cover) errs.push('Envie a imagem de capa.'); else if (!$('#ca2').value.trim()) errs.push('Descreva a imagem de capa.');
        if (words(ed.innerText) < 100) errs.push('O texto está muito curto para publicar.');
      }
      if (errs.length) { msg(m, errs.join(' '), 'erro'); window.scrollTo(0, 0); return; }
      var date = $('#d').value ? new Date($('#d').value).toISOString() : new Date().toISOString();
      var row = {
        title: title, slug: slug, category: $('#c').value, excerpt: $('#e').value.trim(), answer: $('#a').value.trim(), body_html: ed.innerHTML,
        cover_url: cover || null, cover_alt: $('#ca2').value.trim(), keywords: $('#k').value.trim(),
        faq: faq.filter(function (q) { return q.q.trim() && q.a.trim(); }).map(function (q) { return { q: q.q.trim(), a: q.a.trim() }; }),
        status: status, publish_at: date
      };
      var b = $('#salvar'); b.disabled = true;
      var call = p.id ? api('/rest/v1/posts?id=eq.' + encodeURIComponent(p.id), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) })
        : api('/rest/v1/posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      call.then(function (r) {
        dirty = false; b.disabled = false; p = r[0]; isNew = false;
        var ok = pub ? (new Date(date) > new Date() ? 'Salvo e agendado. Entra no site na data escolhida, em até 30 minutos depois dela.' : 'Publicado! O texto aparece no site em até 30 minutos.') : 'Rascunho salvo.';
        msg(m, ok, 'ok'); window.scrollTo(0, 0);
      }).catch(function (er) {
        b.disabled = false;
        if (er.status === 409 || /duplicate|unique/i.test(er.message)) msg(m, 'Já existe um texto com esse endereço. Mude o endereço e salve de novo.', 'erro');
        else handleErr(er, m);
        window.scrollTo(0, 0);
      });
    });
  }

  /* corpo do editor: mantém só o que o site aceita */
  function cleanBody(h) {
    var d = document.createElement('div'); d.innerHTML = h || '';
    d.querySelectorAll('script,style,iframe,object,embed,form').forEach(function (n) { n.remove(); });
    d.querySelectorAll('*').forEach(function (n) { for (var i = n.attributes.length - 1; i >= 0; i--) { var a = n.attributes[i].name; if (!{ href: 1, src: 1, alt: 1 }[a]) n.removeAttribute(a); } });
    return d.innerHTML;
  }

  /* envio de imagem: reduz para 1600 px e converte para WebP antes de subir */
  function upload(file, base) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.reject(new Error('Use uma foto JPG, PNG ou WebP.'));
    return resize(file).then(function (blob) {
      var ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      var d = new Date(), path = d.getFullYear() + '/' + slugify(base).slice(0, 40) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      return ensureFresh().then(function () {
        return fetch(URL + '/storage/v1/object/blog-images/' + path, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': blob.type, 'x-upsert': 'false' }, body: blob });
      }).then(function (r) { if (!r.ok) throw new Error('o servidor recusou o arquivo (' + r.status + ').'); return URL + '/storage/v1/object/public/blog-images/' + path; });
    });
  }
  function resize(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = window.URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); window.URL.revokeObjectURL(u);
        c.toBlob(function (b) { if (b && b.type === 'image/webp') return ok(b); c.toBlob(function (j) { j ? ok(j) : no(new Error('não foi possível reduzir a foto.')); }, 'image/jpeg', 0.85); }, 'image/webp', 0.82);
      };
      img.onerror = function () { no(new Error('não foi possível abrir a foto.')); };
      img.src = u;
    });
  }

  /* ---------- início ---------- */
  $('#btn-sair').addEventListener('click', function () {
    if (dirty && !confirm('Você tem alterações não salvas. Sair mesmo assim?')) return;
    if (session) fetch(URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token } }).catch(function () { });
    setSession(null); viewLogin('Você saiu do painel.');
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  (function init() {
    var h = location.hash.replace(/^#/, ''), q = {};
    h.split('&').forEach(function (x) { var p = x.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
    if (q.access_token && (q.type === 'recovery' || q.type === 'invite')) { history.replaceState(null, '', location.pathname); return viewNewPassword(q.access_token); }
    try { session = JSON.parse(load('sa_sess') || 'null'); } catch (e) { session = null; }
    if (session && !needsConfig()) return viewList();
    viewLogin();
  })();
})();
