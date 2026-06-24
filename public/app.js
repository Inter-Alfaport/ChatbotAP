// public/app.js

// Estado da Aplicação
let colaboradores = [];
let colaboradorAtivo = null;

// Elementos do DOM
const contactsList = document.getElementById('contacts-list');
const searchInput = document.getElementById('search-input');
const btnRefreshList = document.getElementById('btn-refresh-list');
const chatPlaceholder = document.getElementById('chat-placeholder');
const chatActive = document.getElementById('chat-active');
const activeAvatar = document.getElementById('active-avatar');
const activeName = document.getElementById('active-name');
const activeRoleDept = document.getElementById('active-role-dept');
const activeStatus = document.getElementById('active-status');
const btnReleaseBot = document.getElementById('btn-release-bot');
const btnClearHistory = document.getElementById('btn-clear-history');
const messagesContainer = document.getElementById('messages-container');
const typingIndicator = document.getElementById('typing-indicator');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  carregarColaboradores();
  inicializarEventos();
});

// Inicialização dos Eventos
function inicializarEventos() {
  // Atualiza botão de envio ao digitar
  messageInput.addEventListener('input', () => {
    sendButton.disabled = messageInput.value.trim() === '';
  });

  // Envio de Mensagem
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    enviarMensagem();
  });

  // Pesquisa de contatos
  searchInput.addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();
    filtrarContatos(termo);
  });

  // Atualizar lista
  btnRefreshList.addEventListener('click', () => {
    carregarColaboradores();
  });

  // Liberar Bot do Transbordo
  btnReleaseBot.addEventListener('click', () => {
    liberarBot();
  });

  // Limpar histórico/Reiniciar sessão
  btnClearHistory.addEventListener('click', () => {
    if (confirm(`Deseja reiniciar a conversa de ${colaboradorAtivo.nome}? O histórico de mensagens será apagado.`)) {
      reiniciarConversa();
    }
  });
}

// Carrega a lista de colaboradores da API
async function carregarColaboradores() {
  try {
    contactsList.innerHTML = `
      <div class="contacts-loading">
        <div class="spinner"></div>
        <span>Buscando colaboradores...</span>
      </div>
    `;
    
    const res = await fetch('/api/test/colaboradores');
    colaboradores = await res.json();
    
    renderizarContatos(colaboradores);
  } catch (err) {
    console.error('Erro ao carregar colaboradores:', err);
    contactsList.innerHTML = `<div class="contacts-loading">❌ Erro ao carregar colaboradores.</div>`;
  }
}

// Renderiza os contatos na barra lateral
function renderizarContatos(lista) {
  contactsList.innerHTML = '';
  
  if (lista.length === 0) {
    contactsList.innerHTML = `<div class="contacts-loading">Nenhum colaborador cadastrado.</div>`;
    return;
  }
  
  lista.forEach(colab => {
    const iniciais = getInitials(colab.nome);
    const bgAvatar = getAvatarBgColor(colab.nome);
    
    // Verifica se já temos sessão ativa no Redis para esse contato
    // buscando rapidamente o status em background ou definindo padrão
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.id = `contact-${colab.telefone}`;
    if (colaboradorAtivo && colaboradorAtivo.telefone === colab.telefone) {
      item.classList.add('active');
    }
    
    // Para simplificar o mockup, assumimos "Online" padrão
    item.innerHTML = `
      <div class="avatar contact-avatar" style="background-color: ${bgAvatar}">${iniciais}</div>
      <div class="contact-info">
        <div class="contact-name-row">
          <span class="contact-name">${colab.nome}</span>
          <span class="contact-time">Agora</span>
        </div>
        <div class="contact-detail-row">
          <span class="contact-role">${colab.cargo}</span>
          <span class="contact-badge badge-online" id="badge-${colab.telefone}">Online</span>
        </div>
      </div>
    `;
    
    item.addEventListener('click', () => selecionarColaborador(colab));
    contactsList.appendChild(item);
    
    // Atualiza o badge de transbordo caso o colaborador esteja em transbordo
    verificarStatusBackground(colab.telefone);
  });
  
  // Recarrega os ícones Lucide
  lucide.createIcons();
}

// Verifica se está em transbordo para atualizar os badges na barra lateral
async function verificarStatusBackground(telefone) {
  try {
    const res = await fetch(`/api/test/historico/${telefone}`);
    const data = await res.json();
    const badge = document.getElementById(`badge-${telefone}`);
    if (badge) {
      if (data.emTransbordo) {
        badge.textContent = 'Transbordo 🔄';
        badge.className = 'contact-badge badge-transbordo';
      } else {
        badge.textContent = 'Online';
        badge.className = 'contact-badge badge-online';
      }
    }
  } catch (e) {
    // Silencioso
  }
}

// Seleciona um colaborador para iniciar chat
async function selecionarColaborador(colab) {
  colaboradorAtivo = colab;
  
  // Atualiza classe active na barra lateral
  document.querySelectorAll('.contact-item').forEach(item => {
    item.classList.remove('active');
  });
  const activeItem = document.getElementById(`contact-${colab.telefone}`);
  if (activeItem) activeItem.classList.add('active');
  
  // Transiciona a UI
  chatPlaceholder.style.display = 'none';
  chatActive.style.display = 'flex';
  
  // Configura cabeçalho
  activeAvatar.innerHTML = getInitials(colab.nome);
  activeAvatar.style.backgroundColor = getAvatarBgColor(colab.nome);
  activeName.textContent = colab.nome;
  activeRoleDept.textContent = `${colab.cargo} — ${colab.departamento}`;
  
  // Carrega histórico
  await carregarHistorico(colab.telefone);
}

// Busca o histórico de mensagens da sessão
async function carregarHistorico(telefone) {
  try {
    messagesContainer.innerHTML = '';
    typingIndicator.style.display = 'none';
    
    const res = await fetch(`/api/test/historico/${telefone}`);
    const data = await res.json();
    
    // Configura status
    atualizarStatusUI(data.emTransbordo);
    
    // Renderiza mensagens do histórico
    if (data.historico && data.historico.length > 0) {
      data.historico.forEach(msg => {
        appendMessageBubble(msg.role === 'assistant' ? 'in' : 'out', msg.content);
      });
    } else {
      // Chat vazio
      appendSystemBubble('Início da conversa com o RH Bot. Digite "Oi" para começar.');
    }
    
    scrollChatBottom();
  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    appendSystemBubble('Erro ao carregar o histórico de conversas.', true);
  }
}

// Envia mensagem digitada para o bot
async function enviarMensagem() {
  const texto = messageInput.value.trim();
  if (!texto || !colaboradorAtivo) return;
  
  // Adiciona balão do usuário na UI imediatamente
  appendMessageBubble('out', texto);
  messageInput.value = '';
  sendButton.disabled = true;
  scrollChatBottom();
  
  // Exibe indicador de digitação
  exibirDigitando(true);
  
  try {
    const res = await fetch('/api/test/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefone: colaboradorAtivo.telefone,
        mensagem: texto
      })
    });
    
    const data = await res.json();
    
    // Oculta indicador
    exibirDigitando(false);
    
    if (data.error) {
      appendSystemBubble(`Erro: ${data.error}`, true);
      return;
    }
    
    // Adiciona resposta do bot
    appendMessageBubble('in', data.texto);
    
    // Atualiza status de transbordo
    atualizarStatusUI(data.emTransbordo);
    
    // Se entrou em transbordo agora, exibe mensagem do sistema
    if (data.emTransbordo) {
      appendSystemBubble('Atendimento transferido para o RH Humano 🔄');
    }
    
    scrollChatBottom();
  } catch (err) {
    exibirDigitando(false);
    console.error('Erro ao enviar mensagem:', err);
    appendSystemBubble('Erro ao processar mensagem do chatbot.', true);
  }
}

// Libera o bot do transbordo
async function liberarBot() {
  if (!colaboradorAtivo) return;
  
  try {
    const res = await fetch('/api/test/liberar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone: colaboradorAtivo.telefone })
    });
    const data = await res.json();
    
    if (data.ok) {
      atualizarStatusUI(false);
      appendSystemBubble('Atendimento humano concluído. Bot reativado.');
      appendMessageBubble('in', data.texto);
      scrollChatBottom();
    }
  } catch (err) {
    console.error('Erro ao liberar bot:', err);
  }
}

// Reinicia a conversa limpando o Redis
async function reiniciarConversa() {
  if (!colaboradorAtivo) return;
  
  try {
    const res = await fetch('/api/test/limpar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone: colaboradorAtivo.telefone })
    });
    
    if (res.ok) {
      messagesContainer.innerHTML = '';
      atualizarStatusUI(false);
      appendSystemBubble('Sessão reiniciada. Envie uma mensagem para iniciar.');
      scrollChatBottom();
    }
  } catch (err) {
    console.error('Erro ao reiniciar conversa:', err);
  }
}

// Atualiza a interface gráfica do status do contato
function atualizarStatusUI(emTransbordo) {
  const badge = document.getElementById(`badge-${colaboradorAtivo.telefone}`);
  
  if (emTransbordo) {
    activeStatus.textContent = 'Em Transbordo 🔄';
    activeStatus.className = 'status-badge transbordo';
    btnReleaseBot.style.display = 'flex';
    
    if (badge) {
      badge.textContent = 'Transbordo 🔄';
      badge.className = 'contact-badge badge-transbordo';
    }
  } else {
    activeStatus.textContent = 'Online';
    activeStatus.className = 'status-badge online';
    btnReleaseBot.style.display = 'none';
    
    if (badge) {
      badge.textContent = 'Online';
      badge.className = 'contact-badge badge-online';
    }
  }
  
  lucide.createIcons();
}

// Insere balão de mensagem no chat
function appendMessageBubble(direcao, texto) {
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${direcao}`;
  
  const formattedText = formatWhatsAppText(texto);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  bubble.innerHTML = `
    <div class="msg-content">${formattedText}</div>
    <div class="msg-time">${time}</div>
  `;
  
  messagesContainer.appendChild(bubble);
}

// Insere balão do sistema (centralizado)
function appendSystemBubble(texto, isDanger = false) {
  const bubble = document.createElement('div');
  bubble.className = `message-system ${isDanger ? 'danger' : ''}`;
  bubble.textContent = texto;
  messagesContainer.appendChild(bubble);
}

// Controla a animação de digitando
function exibirDigitando(mostrar) {
  typingIndicator.style.display = mostrar ? 'flex' : 'none';
  if (mostrar) scrollChatBottom();
}

// Rola o chat para baixo
function scrollChatBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Filtra a lista de contatos na barra lateral
function filtrarContatos(termo) {
  const itens = document.querySelectorAll('.contact-item');
  itens.forEach(item => {
    const nome = item.querySelector('.contact-name').textContent.toLowerCase();
    const cargo = item.querySelector('.contact-role').textContent.toLowerCase();
    if (nome.includes(termo) || cargo.includes(termo)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

// Helpers Utilitários
function getInitials(name) {
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function getAvatarBgColor(name) {
  const colors = [
    '#53bdeb', // Azul claro
    '#e07a5f', // Coral
    '#81b29a', // Verde pastel
    '#f2cc8f', // Amarelo
    '#9ab3f5', // Azul royal
    '#a2d2ff', // Céu
    '#ffafcc', // Rosa
    '#bde0fe', // Gelo
    '#00a884', // Verde zap
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// Formata Markdown básico do WhatsApp (como *negrito*, _itálico_, ~tachado~)
function formatWhatsAppText(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/~([^~]+)~/g, '<del>$1</del>')
    .replace(/\n/g, '<br>');
}
