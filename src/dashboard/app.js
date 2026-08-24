// src/dashboard/app.js

let chartAtendimentosDia = null;
let chartTransbordosMotivo = null;
let chartTempoResposta = null;
let chartSlaGauge = null;
let chartTransbordosFull = null;
let chartTempoFull = null;
let chartCsatBar = null;

// Estado de paginação da aba Atendimentos
let paginaAtual = 1;
let totalPaginas = 1;
let totalAtendimentos = 0;
let statusFiltroAtual = 'todos';
let searchQuery = '';

// Cache dos últimos dados carregados (para tabs secundárias)
let dadosTransbordos = [];
let dadosTempoResposta = [];
let abaAtiva = 'visao-geral';

const TZ_BRASIL = 'America/Sao_Paulo';
const fmtDataBr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_BRASIL });

function formatarDataHoraBr(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { timeZone: TZ_BRASIL });
}

function getAbaAtiva() {
  const pane = document.querySelector('.tab-pane.active');
  if (!pane) return abaAtiva;
  return pane.id.replace('tab-', '');
}

// ── RESPONSIVIDADE & SIDEBAR MOBILE ──────────────────────────────────────
function toggleSidebar(forcarAberto) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const estaAberto = sidebar.classList.contains('open');
  const novoEstado = forcarAberto !== undefined ? forcarAberto : !estaAberto;

  if (novoEstado) {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
    document.body.classList.add('sidebar-mobile-open');
  } else {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('sidebar-mobile-open');
  }
}

function atualizarAbaAtiva() {
  const aba = getAbaAtiva();
  abaAtiva = aba;

  if (aba === 'atendimentos') {
    carregarListaAtendimentos(paginaAtual);
  } else if (aba === 'transbordos') {
    renderChartTransbordosFull(dadosTransbordos);
    carregarOrigemTransbordos();
    carregarRecentesTransbordos();
  } else if (aba === 'sla') {
    renderChartTempoFull(dadosTempoResposta);
  } else if (aba === 'satisfacao') {
    carregarSatisfacao();
    carregarRecentesSatisfacao();
  } else if (aba === 'motivos') {
    carregarMotivos();
    carregarRecentesMotivos();
  }
}

// ── NAVEGAÇÃO ENTRE ABAS ──────────────────────────────────────────────────
function trocarAba(e, abaId) {
  if (e) e.preventDefault();

  toggleSidebar(false);

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  const targetLink = document.querySelector(`.sidebar-nav .nav-item[onclick*="${abaId}"]`);
  if (targetLink) targetLink.classList.add('active');

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  const targetPane = document.getElementById(`tab-${abaId}`);
  if (targetPane) targetPane.classList.add('active');
  abaAtiva = abaId;

  const titulos = {
    'visao-geral': ['Dashboard Geral', 'Visão completa do atendimento de RH'],
    'atendimentos': ['Gestão de Atendimentos', 'Listagem detalhada de todas as interações'],
    'transbordos': ['Análise de Transbordos', 'Motivos e origens dos encaminhamentos ao RH'],
    'desempenho': ['Desempenho da Equipe', 'Produtividade e velocidade da equipe humana'],
    'sla': ['SLA e Tempo de Resposta', 'Acompanhamento de prazos de atendimento'],
    'motivos': ['Motivos e Assuntos', 'Categorização de dúvidas recorrentes'],
    'satisfacao': ['Pesquisa de Satisfação', 'Avaliação do atendimento pelos colaboradores']
  };

  if (titulos[abaId]) {
    document.getElementById('page-title').textContent = titulos[abaId][0];
    document.getElementById('page-subtitle').textContent = titulos[abaId][1];
  }

  if (abaId === 'atendimentos') {
    paginaAtual = 1;
    carregarListaAtendimentos();
  } else if (abaId === 'transbordos') {
    renderChartTransbordosFull(dadosTransbordos);
    carregarOrigemTransbordos();
    carregarRecentesTransbordos();
  } else if (abaId === 'sla') {
    renderChartTempoFull(dadosTempoResposta);
  } else if (abaId === 'satisfacao') {
    carregarSatisfacao();
    carregarRecentesSatisfacao();
  } else if (abaId === 'motivos') {
    carregarMotivos();
    carregarRecentesMotivos();
  }
}

// ── AUTENTICAÇÃO ─────────────────────────────────────────────────────────
function getSecret() {
  return localStorage.getItem('rh_admin_secret') || '';
}
function setSecret(secret) {
  localStorage.setItem('rh_admin_secret', secret);
}
function logout() {
  localStorage.removeItem('rh_admin_secret');
  document.getElementById('auth-overlay').style.display = 'flex';
}
function handleLogin(e) {
  e.preventDefault();
  const secret = document.getElementById('admin-secret').value;
  setSecret(secret);
  carregarDados();
}

// ── HELPERS DE DATA ───────────────────────────────────────────────────────
function getDefaultDates() {
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);
  return {
    de: fmtDataBr.format(seteDiasAtras),
    ate: fmtDataBr.format(hoje)
  };
}

function getFiltrosDatas() {
  const de = document.getElementById('date-from').value;
  const ate = document.getElementById('date-to').value;
  const qs = [];
  if (de) qs.push(`de=${de}`);
  if (ate) qs.push(`ate=${ate}`);
  return qs.length ? '?' + qs.join('&') : '';
}

// ── FETCH COM AUTH ────────────────────────────────────────────────────────
async function fetchAPI(endpoint) {
  const secret = getSecret();
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await fetch(`${endpoint}${sep}secret=${encodeURIComponent(secret)}`, {
    headers: { 'x-admin-secret': secret }
  });

  if (res.status === 401) {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('auth-error').style.display = 'block';
    throw new Error('Não autorizado');
  }

  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('auth-error').style.display = 'none';
  return res.json();
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Preenche datas com últimos 7 dias por padrão
  const { de, ate } = getDefaultDates();
  document.getElementById('date-from').value = de;
  document.getElementById('date-to').value = ate;

  const secret = getSecret();
  if (secret) {
    carregarDados();
  } else {
    document.getElementById('auth-overlay').style.display = 'flex';
  }
});

async function carregarDados() {
  try {
    const qs = getFiltrosDatas();

    const [visaoGeral, atendimentosDia, transbordosMotivo, tempoResposta, equipe, alertas] = await Promise.all([
      fetchAPI(`/api/relatorios/visao-geral${qs}`),
      fetchAPI(`/api/relatorios/atendimentos-por-dia${qs}`),
      fetchAPI(`/api/relatorios/transbordos-por-motivo${qs}`),
      fetchAPI(`/api/relatorios/distribuicao-tempo-resposta${qs}`),
      fetchAPI(`/api/relatorios/desempenho-equipe${qs}`),
      fetchAPI('/api/relatorios/alertas'),
    ]);

    // Cache para abas secundárias
    dadosTransbordos = transbordosMotivo;
    dadosTempoResposta = tempoResposta;

    renderKPIs(visaoGeral);
    renderChartAtendimentosDia(atendimentosDia);
    renderChartTransbordosMotivo(transbordosMotivo);
    renderChartTempoResposta(tempoResposta);
    renderTabelaEquipe(equipe);
    renderAlertas(alertas);
    renderGaugeSLA(visaoGeral.slaCumprido);

    atualizarAbaAtiva();

  } catch (err) {
    console.error('Erro ao carregar dados:', err);
  }
}

// ── RENDERIZADORES DE VISÃO GERAL ─────────────────────────────────────────
function renderKPIs(data) {
  document.getElementById('kpi-total').textContent = data.total || 0;
  document.getElementById('kpi-bot').textContent = data.resolvidosBot || 0;
  document.getElementById('kpi-bot-sub').textContent = `${data.taxaAutomacao}% do total`;

  document.getElementById('kpi-transbordo').textContent = data.transbordos || 0;
  const percTransbordo = data.total > 0 ? Math.round((data.transbordos / data.total) * 100) : 0;
  document.getElementById('kpi-transbordo-sub').textContent = `${percTransbordo}% do total`;

  document.getElementById('kpi-taxa-automacao').textContent = `${data.taxaAutomacao}%`;

  if (data.tempoMedio) {
    const totalSecs = Math.round(data.tempoMedio);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    document.getElementById('kpi-tempo-medio').textContent = `${mins}m ${secs}s`;
  } else {
    document.getElementById('kpi-tempo-medio').textContent = '--';
  }

  document.getElementById('kpi-sla').textContent = `${data.slaCumprido}%`;

  // CSAT agora é escala 1-5
  const csatDisplay = data.satisfacaoMedia ? `${data.satisfacaoMedia}/5` : '--';
  document.getElementById('kpi-satisfacao').textContent = csatDisplay;
  document.getElementById('kpi-satisfacao-sub').textContent = `Baseado em ${data.totalAvaliacoes} avaliações`;

  const bigNum = document.getElementById('csat-big-number');
  if (bigNum) bigNum.textContent = data.satisfacaoMedia || '--';
}

function renderChartAtendimentosDia(data) {
  const ctx = document.getElementById('chart-atendimentos-dia').getContext('2d');
  const labels = data.map(d => d.dia);
  const values = data.map(d => d.count);

  if (chartAtendimentosDia) chartAtendimentosDia.destroy();

  chartAtendimentosDia = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Atendimentos',
        data: values,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } },
        y: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' }, beginAtZero: true }
      }
    }
  });
}

function renderChartTransbordosMotivo(data) {
  const ctx = document.getElementById('chart-transbordos-motivo').getContext('2d');
  const labels = data.map(d => d.motivo);
  const values = data.map(d => d.count);

  if (chartTransbordosMotivo) chartTransbordosMotivo.destroy();

  chartTransbordosMotivo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ocorrências',
        data: values,
        backgroundColor: '#f59e0b',
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } },
        y: { grid: { display: false }, ticks: { color: '#9ca3af' } }
      }
    }
  });
}

function renderChartTempoResposta(data) {
  const ctx = document.getElementById('chart-tempo-resposta').getContext('2d');
  const labels = data.map(d => d.label);
  const values = data.map(d => d.count);

  if (chartTempoResposta) chartTempoResposta.destroy();

  chartTempoResposta = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } }
    }
  });
}

function renderTabelaEquipe(data) {
  const tbody = document.getElementById('team-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af">Nenhum dado disponível.</td></tr>';
  } else {
    data.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600;">${row.nome}</td>
        <td>${row.atendimentos}</td>
        <td>${row.tempoMedioStr}</td>
        <td><span style="color: ${row.sla >= 90 ? '#10b981' : '#f59e0b'}; font-weight: 700;">${row.sla}%</span></td>
        <td><span style="color: #eab308; font-weight: 700;">★ ${row.satisfacao} / 5</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  const tbodyFull = document.getElementById('desempenho-full-body');
  if (!tbodyFull) return;
  tbodyFull.innerHTML = '';

  if (!data || data.length === 0) {
    tbodyFull.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9ca3af">Nenhum dado disponível.</td></tr>';
    return;
  }

  data.forEach(row => {
    const trFull = document.createElement('tr');
    trFull.innerHTML = `
      <td style="font-weight: 600;">${row.nome}</td>
      <td>${row.telefone || '—'}</td>
      <td>${row.atendimentos}</td>
      <td>${row.tempoMedioStr}</td>
      <td><span style="color: ${row.sla >= 90 ? '#10b981' : '#f59e0b'}; font-weight: 700;">${row.sla}%</span></td>
      <td><span style="color: #eab308; font-weight: 700;">★ ${row.satisfacao} / 5</span></td>
    `;
    tbodyFull.appendChild(trFull);
  });
}

function renderGaugeSLA(slaPercent) {
  const ctx = document.getElementById('chart-sla-gauge').getContext('2d');
  const el = document.getElementById('gauge-sla-percent');
  if (el) el.textContent = `${slaPercent}%`;

  if (chartSlaGauge) chartSlaGauge.destroy();

  chartSlaGauge = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Dentro SLA', 'Fora SLA'],
      datasets: [{
        data: [slaPercent, 100 - slaPercent],
        backgroundColor: ['#10b981', '#232d42'],
        borderWidth: 0
      }]
    },
    options: {
      rotation: -90,
      circumference: 180,
      cutout: '75%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}

function renderAlertas(alertas) {
  document.getElementById('alert-waiting').textContent = alertas.aguardando || 0;
  document.getElementById('alert-sla-fail').textContent = alertas.foraSla || 0;
  document.getElementById('alert-reincident').textContent = alertas.reincidentes || 0;
}

// ── ABA ATENDIMENTOS (paginada) ───────────────────────────────────────────
function nomeColaboradorExibicao(item) {
  return item.nome_colaborador || item.telefone || '—';
}

async function carregarListaAtendimentos(pagina) {
  try {
    paginaAtual = pagina || paginaAtual;
    const qs = getFiltrosDatas();
    const sep = qs ? '&' : '?';
    let url = `/api/relatorios/atendimentos${qs}${sep}page=${paginaAtual}`;

    if (statusFiltroAtual && statusFiltroAtual !== 'todos') {
      url += `&status=${encodeURIComponent(statusFiltroAtual)}`;
    }
    if (searchQuery.trim()) {
      url += `&q=${encodeURIComponent(searchQuery.trim())}`;
    }

    const resp = await fetchAPI(url);
    totalPaginas = resp.totalPages || 1;
    totalAtendimentos = resp.total || 0;

    renderTabelaAtendimentos(resp.data || []);
    renderPaginacao();
  } catch (err) {
    console.error('Erro ao carregar lista de atendimentos:', err);
  }
}

function renderTabelaAtendimentos(lista) {
  const tbody = document.getElementById('atendimentos-table-body');
  tbody.innerHTML = '';

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #9ca3af;">Nenhum atendimento encontrado.</td></tr>';
    renderPaginacao();
    return;
  }

  lista.forEach(item => {
    const tr = document.createElement('tr');
    const dtInicio = formatarDataHoraBr(item.data_inicio);
    const dtEncerramento = item.data_encerramento
      ? formatarDataHoraBr(item.data_encerramento)
      : '<span style="color:#6b7280">—</span>';

    const statusBadge = `<span class="badge ${item.status}">${(item.status || '').replace(/_/g, ' ').toUpperCase()}</span>`;
    const categoria = item.categoria_display || item.categoria || 'Geral';
    const atendente = item.atendente_nome || item.encerrado_por === 'inatividade' ? 'Inativo' : '—';

    tr.innerHTML = `
      <td style="font-weight: 700; color: #818cf8;">${item.id}</td>
      <td style="font-weight: 600;">${nomeColaboradorExibicao(item)}</td>
      <td>${dtInicio}</td>
      <td>${dtEncerramento}</td>
      <td>${categoria}</td>
      <td>${statusBadge}</td>
      <td>${atendente}</td>
      <td><button class="btn-detail" onclick="verDetalhesAtendimento('${item.id}', ${JSON.stringify(item).replace(/"/g, '&quot;')})">Ver</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPaginacao() {
  const container = document.getElementById('paginacao-container');
  if (!container) return;
  container.innerHTML = '';

  if (totalPaginas <= 1) return;

  const info = document.createElement('span');
  info.style.cssText = 'color:#9ca3af;font-size:13px;margin-right:12px;';
  info.textContent = `${totalAtendimentos} atendimento(s)`;
  container.appendChild(info);

  const btn = (label, pg, disabled) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'btn-pag' + (pg === paginaAtual ? ' btn-pag-active' : '');
    b.disabled = disabled;
    b.onclick = () => carregarListaAtendimentos(pg);
    return b;
  };

  container.appendChild(btn('←', paginaAtual - 1, paginaAtual === 1));

  const range = 2;
  for (let i = 1; i <= totalPaginas; i++) {
    if (i === 1 || i === totalPaginas || (i >= paginaAtual - range && i <= paginaAtual + range)) {
      container.appendChild(btn(i, i, false));
    } else if (i === paginaAtual - range - 1 || i === paginaAtual + range + 1) {
      const dots = document.createElement('span');
      dots.textContent = '…';
      dots.style.cssText = 'color:#6b7280;padding:0 4px;';
      container.appendChild(dots);
    }
  }

  container.appendChild(btn('→', paginaAtual + 1, paginaAtual === totalPaginas));
}

function filtrarStatusTabela(status, el) {
  statusFiltroAtual = status;
  document.querySelectorAll('.status-filters .filter-chip').forEach(chip => chip.classList.remove('active'));
  if (el) el.classList.add('active');
  paginaAtual = 1;
  carregarListaAtendimentos(1);
}

function filtrarTabelaPorTexto() {
  searchQuery = document.getElementById('search-atendimentos').value;
  paginaAtual = 1;
  carregarListaAtendimentos(1);
}

// ── VER DETALHES MODAL ────────────────────────────────────────────────────
function verDetalhesAtendimento(id, itemJSON) {
  const item = typeof itemJSON === 'string' ? JSON.parse(itemJSON) : itemJSON;
  const modal = document.getElementById('detail-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  title.textContent = `Detalhes — ${id}`;

  const formatDt = dt => dt ? formatarDataHoraBr(dt) : '—';
  const avaliacao = item.avaliacao_nota
    ? `${item.avaliacao_nota}/5 ⭐`
    : (item.avaliacao_respondida === false ? 'Não avaliado' : '—');
  const etiquetasNota = { 1: 'Péssimo 😞', 2: 'Ruim 😕', 3: 'Regular 😐', 4: 'Bom 🙂', 5: 'Excelente 😊' };
  const avaliacaoLabel = item.avaliacao_nota ? etiquetasNota[item.avaliacao_nota] || avaliacao : '—';

  content.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px;">
      <div><strong>Colaborador:</strong> ${nomeColaboradorExibicao(item)}</div>
      <div><strong>Telefone:</strong> ${item.telefone || '—'}</div>
      <div><strong>Status:</strong> ${(item.status || '').replace(/_/g, ' ')}</div>
      <div><strong>Categoria:</strong> ${item.categoria_display || item.categoria || 'Geral'}</div>
      <div><strong>Iniciado em:</strong> ${formatDt(item.data_inicio)}</div>
      <div><strong>Encerrado em:</strong> ${formatDt(item.data_encerramento)}</div>
      <div><strong>Encerrado por:</strong> ${item.encerrado_por || '—'}</div>
      <div><strong>Atendente:</strong> ${item.atendente_nome || '—'}</div>
      <div><strong>Transbordo:</strong> ${item.houve_transbordo ? 'Sim' : 'Não'}</div>
      <div><strong>Avaliação:</strong> ${avaliacaoLabel}</div>
      ${item.atraso_sla ? '<div style="color:#ef4444;font-weight:700;grid-column:span 2">⚠️ Atraso no SLA registrado</div>' : ''}
      ${item.motivo_transbordo ? `<div style="grid-column:span 2"><strong>Motivo Transbordo:</strong> ${item.motivo_transbordo}</div>` : ''}
    </div>
    <h4 style="margin-bottom: 8px;">Timeline:</h4>
    <div style="background: #0f1523; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 11px; max-height: 200px; overflow-y: auto;">
      <div>[${formatDt(item.data_inicio)}] Atendimento iniciado</div>
      ${item.data_transbordo ? `<div>[${formatDt(item.data_transbordo)}] Transbordo acionado${item.motivo_transbordo ? ` — ${item.motivo_transbordo}` : ''}</div>` : ''}
      ${item.data_primeira_resposta ? `<div>[${formatDt(item.data_primeira_resposta)}] Primeira resposta humana</div>` : ''}
      ${item.data_encerramento ? `<div>[${formatDt(item.data_encerramento)}] Atendimento encerrado por ${item.encerrado_por || 'sistema'}</div>` : ''}
    </div>
  `;

  modal.style.display = 'flex';
}

function fecharModal() {
  document.getElementById('detail-modal').style.display = 'none';
}

// ── ABA SATISFAÇÃO (real, 1-5) ────────────────────────────────────────────
async function carregarSatisfacao() {
  try {
    const qs = getFiltrosDatas();
    const dados = await fetchAPI(`/api/relatorios/satisfacao${qs}`);
    renderSatisfacao(dados);
  } catch (err) {
    console.error('Erro ao carregar satisfação:', err);
  }
}

function renderSatisfacao(data) {
  const bigNum = document.getElementById('csat-big-number');
  if (bigNum) bigNum.textContent = data.media || '--';

  const ctx = document.getElementById('chart-csat-bar');
  if (!ctx) return;
  if (chartCsatBar) chartCsatBar.destroy();

  const labels = (data.distribuicao || []).map(d => d.label);
  const values = (data.distribuicao || []).map(d => d.count);
  const cores = ['#ef4444', '#f59e0b', '#6b7280', '#3b82f6', '#10b981'];

  chartCsatBar = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avaliações',
        data: values,
        backgroundColor: cores,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } },
        y: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' }, beginAtZero: true }
      }
    }
  });
}

// ── OUTROS GRÁFICOS DAS ABAS ─────────────────────────────────────────────
function renderChartTransbordosFull(data) {
  const ctx = document.getElementById('chart-transbordos-full');
  if (!ctx) return;
  if (chartTransbordosFull) chartTransbordosFull.destroy();

  const labels = (data || []).map(d => d.motivo);
  const values = (data || []).map(d => d.count);

  // Popula o select de filtro por motivo na tabela de transbordos recentes
  const select = document.getElementById('filtro-transbordo-select');
  if (select && data && data.length) {
    const valorAtual = select.value;
    select.innerHTML = '<option value="todos">Todos os Motivos</option>';
    data.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.motivo;
      opt.textContent = `${item.motivo} (${item.count})`;
      if (item.motivo === valorAtual) opt.selected = true;
      select.appendChild(opt);
    });
  }

  chartTransbordosFull = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['Sem dados'],
      datasets: [{ data: values.length ? values : [0], backgroundColor: '#f59e0b', borderRadius: 6 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } },
        y: { grid: { display: false }, ticks: { color: '#9ca3af' } }
      }
    }
  });
}

function renderChartTempoFull(data) {
  const ctx = document.getElementById('chart-tempo-full');
  if (!ctx) return;
  if (chartTempoFull) chartTempoFull.destroy();

  const labels = (data || []).map(d => d.label);
  const values = (data || []).map(d => d.count);

  chartTempoFull = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['Sem dados'],
      datasets: [{
        data: values.length ? values : [1],
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } }
    }
  });
}

const LABELS_ORIGEM = {
  llm: { titulo: 'Identificado pela LLM', sub: 'Assuntos sensíveis/financeiros', icon: 'IA', cor: 'purple' },
  keyword: { titulo: 'Palavra-chave do Usuário', sub: 'Solicitação explícita de humano', icon: 'KW', cor: 'orange' },
  usuario: { titulo: 'Solicitado pelo Usuário', sub: 'Pedido direto de atendimento', icon: 'US', cor: 'orange' },
  erro_tecnico: { titulo: 'Erro Técnico', sub: 'Falhas de sistema ou validação', icon: 'ER', cor: 'orange' },
  sistema: { titulo: 'Regra do Sistema', sub: 'Transbordo automático', icon: 'SY', cor: 'purple' },
  desconhecido: { titulo: 'Origem Desconhecida', sub: 'Sem classificação registrada', icon: '?', cor: 'purple' },
};

async function carregarOrigemTransbordos() {
  try {
    const qs = getFiltrosDatas();
    const dados = await fetchAPI(`/api/relatorios/origem-transbordos${qs}`);
    renderOrigemTransbordos(dados);
  } catch (err) {
    console.error('Erro ao carregar origem dos transbordos:', err);
  }
}

function renderOrigemTransbordos(dados) {
  const container = document.getElementById('origem-transbordos-grid');
  if (!container) return;

  if (!dados || dados.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;padding:16px;">Nenhum transbordo no período selecionado.</p>';
    return;
  }

  container.innerHTML = dados.map(row => {
    const meta = LABELS_ORIGEM[row.origem] || LABELS_ORIGEM.desconhecido;
    return `
      <div class="kpi-card">
        <div class="kpi-icon-bg ${meta.cor}">${meta.icon}</div>
        <div class="kpi-details">
          <span class="kpi-title">${meta.titulo}</span>
          <h3 class="kpi-value">${row.count}</h3>
          <span class="kpi-sub">${meta.sub}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function carregarMotivos() {
  try {
    const qs = getFiltrosDatas();
    const dados = await fetchAPI(`/api/relatorios/motivos-assuntos${qs}`);
    renderMotivos(dados);
  } catch (err) {
    console.error('Erro ao carregar motivos:', err);
  }
}

function renderMotivos(dados) {
  const container = document.getElementById('motivos-topics-grid');
  if (!container) return;

  const items = dados?.items || [];
  if (items.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;padding:16px;">Nenhum assunto registrado no período selecionado.</p>';
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="topic-box">
      <h4>${item.assunto}</h4>
      <p>${item.count} atendimento(s) (${item.percentual}%)</p>
      <div class="progress-bar"><div class="progress-fill" style="width: ${item.percentual}%;"></div></div>
    </div>
  `).join('');

  // Popula o select de filtro por assunto na tabela de recentes
  const select = document.getElementById('filtro-motivo-select');
  if (select) {
    const valorAtual = select.value;
    select.innerHTML = '<option value="todos">Todos os Assuntos</option>';
    items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.assunto;
      opt.textContent = `${item.assunto} (${item.count})`;
      if (item.assunto === valorAtual) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

// ── ABA MOTIVOS: ATENDIMENTOS RECENTES ─────────────────────────────────────
async function carregarRecentesMotivos() {
  try {
    const select = document.getElementById('filtro-motivo-select');
    const motivo = select ? select.value : 'todos';
    const qs = getFiltrosDatas();
    const sep = qs ? '&' : '?';
    const dados = await fetchAPI(`/api/relatorios/atendimentos-motivos${qs}${sep}motivo=${encodeURIComponent(motivo)}`);
    renderTabelaRecentesMotivos(dados);
  } catch (err) {
    console.error('Erro ao carregar atendimentos recentes de motivos:', err);
  }
}

function renderTabelaRecentesMotivos(lista) {
  const tbody = document.getElementById('motivos-recentes-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #9ca3af;">Nenhum atendimento recente encontrado para este assunto.</td></tr>';
    return;
  }

  lista.forEach(item => {
    const tr = document.createElement('tr');
    const dt = formatarDataHoraBr(item.data_inicio);
    const statusBadge = `<span class="badge ${item.status}">${(item.status || '').replace(/_/g, ' ').toUpperCase()}</span>`;
    tr.innerHTML = `
      <td style="font-weight: 700; color: #818cf8;">${item.id}</td>
      <td style="font-weight: 600;">${item.nome_colaborador || item.telefone || '—'}</td>
      <td>${item.telefone || '—'}</td>
      <td>${dt}</td>
      <td>${item.assunto || 'Outros'}</td>
      <td>${item.atendente_nome || '—'}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── ABA SATISFAÇÃO: ATENDIMENTOS AVALIADOS RECENTES ────────────────────────
let notaSatisfacaoFiltro = 'todas';

function filtrarNotaSatisfacao(nota, el) {
  notaSatisfacaoFiltro = nota;
  document.querySelectorAll('#filtros-nota-satisfacao .filter-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  carregarRecentesSatisfacao(nota);
}

async function carregarRecentesSatisfacao(nota) {
  try {
    const notaParam = nota !== undefined ? nota : notaSatisfacaoFiltro;
    const qs = getFiltrosDatas();
    const sep = qs ? '&' : '?';
    const dados = await fetchAPI(`/api/relatorios/atendimentos-avaliados${qs}${sep}nota=${encodeURIComponent(notaParam)}`);
    renderTabelaRecentesSatisfacao(dados);
  } catch (err) {
    console.error('Erro ao carregar atendimentos recentes avaliados:', err);
  }
}

function renderTabelaRecentesSatisfacao(lista) {
  const tbody = document.getElementById('satisfacao-recentes-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #9ca3af;">Nenhum atendimento avaliado encontrado.</td></tr>';
    return;
  }

  const etiquetasNota = { 1: '1 ⭐ Péssimo', 2: '2 ⭐ Ruim', 3: '3 ⭐ Regular', 4: '4 ⭐ Bom', 5: '5 ⭐ Excelente' };

  lista.forEach(item => {
    const tr = document.createElement('tr');
    const dt = formatarDataHoraBr(item.data_inicio);
    const notaLabel = etiquetasNota[item.avaliacao_nota] || `${item.avaliacao_nota} ⭐`;
    tr.innerHTML = `
      <td style="font-weight: 700; color: #818cf8;">${item.id}</td>
      <td style="font-weight: 600;">${item.nome_colaborador || item.telefone || '—'}</td>
      <td>${item.telefone || '—'}</td>
      <td>${dt}</td>
      <td>${item.assunto || 'Outros'}</td>
      <td>${item.atendente_nome || '—'}</td>
      <td><span class="badge encerrado" style="background: #1e293b; color: #f59e0b; font-weight: 700;">${notaLabel}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── ABA TRANSBORDOS: ATENDIMENTOS RECENTES ─────────────────────────────────
async function carregarRecentesTransbordos() {
  try {
    const select = document.getElementById('filtro-transbordo-select');
    const motivo = select ? select.value : 'todos';
    const qs = getFiltrosDatas();
    const sep = qs ? '&' : '?';
    const dados = await fetchAPI(`/api/relatorios/atendimentos-transbordos${qs}${sep}motivo=${encodeURIComponent(motivo)}`);
    renderTabelaRecentesTransbordos(dados);
  } catch (err) {
    console.error('Erro ao carregar atendimentos recentes de transbordos:', err);
  }
}

function renderTabelaRecentesTransbordos(lista) {
  const tbody = document.getElementById('transbordos-recentes-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #9ca3af;">Nenhum transbordo recente encontrado para este motivo.</td></tr>';
    return;
  }

  lista.forEach(item => {
    const tr = document.createElement('tr');
    const dt = formatarDataHoraBr(item.data_transbordo || item.data_inicio);
    const statusBadge = `<span class="badge ${item.status}">${(item.status || '').replace(/_/g, ' ').toUpperCase()}</span>`;
    const origemMeta = LABELS_ORIGEM[item.origem_transbordo] || { titulo: item.origem_transbordo || '—' };
    tr.innerHTML = `
      <td style="font-weight: 700; color: #818cf8;">${item.id}</td>
      <td style="font-weight: 600;">${item.nome_colaborador || item.telefone || '—'}</td>
      <td>${item.telefone || '—'}</td>
      <td>${dt}</td>
      <td>${item.motivo || 'Outros'}</td>
      <td><span style="font-size:12px;color:#cbd5e1;">${origemMeta.titulo}</span></td>
      <td>${item.atendente_nome || '—'}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}
