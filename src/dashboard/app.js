// src/dashboard/app.js

let chartAtendimentosDia = null;
let chartTransbordosMotivo = null;
let chartTempoResposta = null;
let chartSlaGauge = null;
let chartTransbordosFull = null;
let chartTempoFull = null;
let chartCsatBar = null;

let todosAtendimentos = [];
let statusFiltroAtual = 'todos';

// ── NAVEGAÇÃO ENTRE ABAS ──────────────────────────────────────────────────
function trocarAba(e, abaId) {
  if (e) e.preventDefault();

  // Atualiza nav sidebar
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });

  const targetLink = document.querySelector(`.sidebar-nav .nav-item[onclick*="${abaId}"]`);
  if (targetLink) targetLink.classList.add('active');

  // Atualiza painéis
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });

  const targetPane = document.getElementById(`tab-${abaId}`);
  if (targetPane) targetPane.classList.add('active');

  // Atualiza Títulos do Header
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

  // Carregar dados específicos da aba se necessário
  if (abaId === 'atendimentos') {
    carregarListaAtendimentos();
  } else if (abaId === 'transbordos') {
    renderChartTransbordosFull();
  } else if (abaId === 'sla') {
    renderChartTempoFull();
  } else if (abaId === 'satisfacao') {
    renderChartCsatBar();
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

async function fetchAPI(endpoint) {
  const secret = getSecret();
  const res = await fetch(`${endpoint}?secret=${encodeURIComponent(secret)}`, {
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

// ── INICIALIZAÇÃO ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const secret = getSecret();
  if (secret) {
    carregarDados();
  } else {
    document.getElementById('auth-overlay').style.display = 'flex';
  }
});

async function carregarDados() {
  try {
    const de = document.getElementById('date-from').value;
    const ate = document.getElementById('date-to').value;
    const queryParams = [];
    if (de) queryParams.push(`de=${de}`);
    if (ate) queryParams.push(`ate=${ate}`);
    const qs = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    // 1. Visão Geral (KPIs)
    const visaoGeral = await fetchAPI(`/api/relatorios/visao-geral${qs}`);
    renderKPIs(visaoGeral);

    // 2. Atendimentos por Dia
    const atendimentosDia = await fetchAPI(`/api/relatorios/atendimentos-por-dia${qs}`);
    renderChartAtendimentosDia(atendimentosDia);

    // 3. Transbordos por Motivo
    const transbordosMotivo = await fetchAPI(`/api/relatorios/transbordos-por-motivo${qs}`);
    renderChartTransbordosMotivo(transbordosMotivo);

    // 4. Tempo de Resposta
    const tempoResposta = await fetchAPI(`/api/relatorios/distribuicao-tempo-resposta${qs}`);
    renderChartTempoResposta(tempoResposta);

    // 5. Desempenho Equipe
    const equipe = await fetchAPI(`/api/relatorios/desempenho-equipe${qs}`);
    renderTabelaEquipe(equipe);

    // 6. Alertas
    const alertas = await fetchAPI('/api/relatorios/alertas');
    renderAlertas(alertas);

    // Gauge SLA
    renderGaugeSLA(visaoGeral.slaCumprido);

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
  document.getElementById('kpi-satisfacao').textContent = data.satisfacaoMedia ? `${data.satisfacaoMedia}/10` : '--';
  document.getElementById('kpi-satisfacao-sub').textContent = `Baseado em ${data.totalAvaliacoes} avaliações`;
  
  const bigNum = document.getElementById('csat-big-number');
  if (bigNum) bigNum.textContent = data.satisfacaoMedia ? data.satisfacaoMedia : '4.6';
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
        y: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } }
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
        data: values,
        backgroundColor: '#8b5cf6',
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
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10 } } }
      }
    }
  });
}

function renderTabelaEquipe(equipe) {
  const tbody = document.getElementById('team-table-body');
  const tbodyFull = document.getElementById('desempenho-full-body');
  
  if (tbody) tbody.innerHTML = '';
  if (tbodyFull) tbodyFull.innerHTML = '';

  if (equipe.length === 0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #9ca3af;">Nenhum atendente registrado</td></tr>';
    return;
  }

  equipe.forEach(row => {
    if (tbody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600;">${row.nome}</td>
        <td>${row.atendimentos}</td>
        <td>${row.tempoMedioStr}</td>
        <td><span style="color: ${row.sla >= 90 ? '#10b981' : (row.sla >= 70 ? '#f59e0b' : '#ef4444')}; font-weight: 700;">${row.sla}%</span></td>
        <td><span style="color: #eab308; font-weight: 700;">★ ${row.satisfacao}</span></td>
      `;
      tbody.appendChild(tr);
    }

    if (tbodyFull) {
      const trFull = document.createElement('tr');
      trFull.innerHTML = `
        <td style="font-weight: 600;">${row.nome}</td>
        <td>${row.telefone || '—'}</td>
        <td>${row.atendimentos}</td>
        <td>${row.tempoMedioStr}</td>
        <td><span style="color: ${row.sla >= 90 ? '#10b981' : '#f59e0b'}; font-weight: 700;">${row.sla}%</span></td>
        <td><span style="color: #eab308; font-weight: 700;">★ ${row.satisfacao} / 10</span></td>
      `;
      tbodyFull.appendChild(trFull);
    }
  });
}

function renderGaugeSLA(slaPercent) {
  const ctx = document.getElementById('chart-sla-gauge').getContext('2d');
  document.getElementById('gauge-sla-percent').textContent = `${slaPercent}%`;

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
  document.getElementById('alert-waiting').textContent = alertas.aguardando;
  document.getElementById('alert-sla-fail').textContent = alertas.foraSla;
  document.getElementById('alert-reincident').textContent = alertas.reincidentes;
}

// ── ABA ATENDIMENTOS ─────────────────────────────────────────────────────
async function carregarListaAtendimentos() {
  try {
    const list = await fetchAPI('/api/relatorios/atendimentos');
    
    // Dados de exemplo se vazio
    if (!list || list.length === 0) {
      todosAtendimentos = [
        { id: 'ATD-000184', nome_colaborador: 'João Silva', telefone: '5521999999999', data_inicio: '2026-08-12T09:32:00Z', categoria: 'Ponto Eletrônico', status: 'encerrado' },
        { id: 'ATD-000185', nome_colaborador: 'Maria Souza', telefone: '5521988888888', data_inicio: '2026-08-12T10:15:00Z', categoria: 'Salário e Pagamento', status: 'em_transbordo' },
        { id: 'ATD-000186', nome_colaborador: 'Carlos Eduardo', telefone: '5521977777777', data_inicio: '2026-08-12T11:00:00Z', categoria: 'Benefícios (VT/VR)', status: 'aberto' },
        { id: 'ATD-000187', nome_colaborador: 'Ana Paula', telefone: '5521966666666', data_inicio: '2026-08-12T11:45:00Z', categoria: 'Férias', status: 'encerrado' }
      ];
    } else {
      todosAtendimentos = list;
    }

    renderTabelaAtendimentos(todosAtendimentos);
  } catch (err) {
    console.error('Erro ao carregar lista de atendimentos:', err);
  }
}

function renderTabelaAtendimentos(lista) {
  const tbody = document.getElementById('atendimentos-table-body');
  tbody.innerHTML = '';

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #9ca3af;">Nenhum atendimento encontrado.</td></tr>';
    return;
  }

  lista.forEach(item => {
    const tr = document.createElement('tr');
    const dt = new Date(item.data_inicio).toLocaleString('pt-BR');
    const statusBadge = `<span class="badge ${item.status}">${item.status.replace('_', ' ').toUpperCase()}</span>`;

    tr.innerHTML = `
      <td style="font-weight: 700; color: #818cf8;">${item.id}</td>
      <td style="font-weight: 600;">${item.nome_colaborador || 'Não identificado'}</td>
      <td>${item.telefone}</td>
      <td>${dt}</td>
      <td>${item.categoria || 'Geral'}</td>
      <td>${statusBadge}</td>
      <td><button class="btn-detail" onclick="verDetalhesAtendimento('${item.id}')">Ver Detalhes</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function filtrarStatusTabela(status) {
  statusFiltroAtual = status;
  document.querySelectorAll('.status-filters .filter-chip').forEach(chip => chip.classList.remove('active'));
  event.target.classList.add('active');
  filtrarTabelaPorTexto();
}

function filtrarTabelaPorTexto() {
  const query = document.getElementById('search-atendimentos').value.toLowerCase();
  const filtrados = todosAtendimentos.filter(item => {
    const matchStatus = statusFiltroAtual === 'todos' || item.status === statusFiltroAtual;
    const matchText = (item.id && item.id.toLowerCase().includes(query)) ||
                      (item.nome_colaborador && item.nome_colaborador.toLowerCase().includes(query)) ||
                      (item.telefone && item.telefone.includes(query));
    return matchStatus && matchText;
  });
  renderTabelaAtendimentos(filtrados);
}

// ── VER DETALHES MODAL ────────────────────────────────────────────────────
function verDetalhesAtendimento(id) {
  const item = todosAtendimentos.find(a => a.id === id);
  const modal = document.getElementById('detail-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  title.textContent = `Detalhes de ${id}`;
  
  if (item) {
    content.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div><strong>Colaborador:</strong> ${item.nome_colaborador || 'Não identificado'}</div>
        <div><strong>Telefone:</strong> ${item.telefone}</div>
        <div><strong>Status:</strong> ${item.status}</div>
        <div><strong>Categoria:</strong> ${item.categoria || 'Não classificada'}</div>
        <div><strong>Data Início:</strong> ${new Date(item.data_inicio).toLocaleString('pt-BR')}</div>
        <div><strong>Houve Transbordo:</strong> ${item.houve_transbordo ? 'Sim' : 'Não'}</div>
      </div>
      <h4 style="margin-bottom: 8px;">Timeline de Eventos:</h4>
      <div style="background: #0f1523; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 11px; max-height: 200px; overflow-y: auto;">
        <div>[${new Date(item.data_inicio).toLocaleTimeString('pt-BR')}] - Atendimento iniciado</div>
        ${item.houve_transbordo ? `<div>[Transbordo] - Encaminhado ao RH (${item.motivo_transbordo || 'Solicitação'})</div>` : ''}
        ${item.status === 'encerrado' ? `<div>[Encerramento] - Atendimento finalizado</div>` : ''}
      </div>
    `;
  } else {
    content.innerHTML = '<p>Informações detalhadas carregadas.</p>';
  }

  modal.style.display = 'flex';
}

function fecharModal() {
  document.getElementById('detail-modal').style.display = 'none';
}

// ── OUTROS GRÁFICOS DAS ABAS ─────────────────────────────────────────────
function renderChartTransbordosFull() {
  const ctx = document.getElementById('chart-transbordos-full');
  if (!ctx) return;
  if (chartTransbordosFull) chartTransbordosFull.destroy();

  chartTransbordosFull = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Novo sistema de ponto', 'Salário e pagamento', 'Identificação / Cadastro', 'Benefícios', 'Férias', 'Outros'],
      datasets: [{ data: [18, 15, 12, 6, 4, 8], backgroundColor: '#f59e0b', borderRadius: 6 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}

function renderChartTempoFull() {
  const ctx = document.getElementById('chart-tempo-full');
  if (!ctx) return;
  if (chartTempoFull) chartTempoFull.destroy();

  chartTempoFull = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Até 5 min', '5 a 15 min', '15 a 30 min', '30 a 60 min', 'Mais de 60 min'],
      datasets: [{ data: [15, 20, 14, 8, 6], backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'], borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } }
    }
  });
}

function renderChartCsatBar() {
  const ctx = document.getElementById('chart-csat-bar');
  if (!ctx) return;
  if (chartCsatBar) chartCsatBar.destroy();

  chartCsatBar = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['1★', '2★', '3★', '4★', '5★', '6★', '7★', '8★', '9★', '10★'],
      datasets: [{ label: 'Qtd Avaliações', data: [1, 2, 2, 3, 5, 8, 14, 22, 18, 12], backgroundColor: '#eab308', borderRadius: 4 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } },
        y: { grid: { color: '#232d42' }, ticks: { color: '#9ca3af' } }
      }
    }
  });
}
