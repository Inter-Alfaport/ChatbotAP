// src/routes/webhook.controller.ts
import { Request, Response } from 'express';
import { sessaoService } from '../services/sessao.service';
import { solidesService } from '../services/solides.service';
import { evolutionService } from '../services/evolution.service';
import { llmService } from '../services/llm.service';
import { Colaborador, EvolutionWebhookPayload } from '../types';

const GRUPO_RH_ID       = process.env.GRUPO_RH_ID || '';
const COMANDO_LIBERAR   = process.env.COMANDO_LIBERAR || '/liberar';
const TRANSBORDO_TTL_MS = (parseInt(process.env.TRANSBORDO_TTL_HORAS || '2')) * 60 * 60 * 1000;

// Colaboradores de teste (Mockups)
const COLABORADORES_MOCK: Colaborador[] = [
  {
    id: 'mock-1',
    nome: 'Ana Souza',
    telefone: '5521982963974',
    cargo: 'Analista de RH',
    departamento: 'Recursos Humanos',
    dataAdmissao: '12/03/2021',
    email: 'ana.souza@empresa.com'
  },
  {
    id: 'mock-2',
    nome: 'Bruno Lima',
    telefone: '5511999999999',
    cargo: 'Desenvolvedor Pleno',
    departamento: 'Tecnologia',
    dataAdmissao: '05/08/2022',
    email: 'bruno.lima@empresa.com'
  },
  {
    id: 'mock-3',
    nome: 'Carla Silva',
    telefone: '5521988888888',
    cargo: 'Coordenadora de DP',
    departamento: 'Departamento Pessoal',
    dataAdmissao: '17/01/2020',
    email: 'carla.silva@empresa.com'
  }
];

// Palavras que disparam transbordo imediato, antes da LLM
const PALAVRAS_TRANSBORDO = [
  'falar com atendente',
  'falar com humano',
  'falar com o rh',
  'falar com ana',
  'atendente humano',
  'pessoa real',
  'quero falar com alguém',
  'urgente',
  'emergência',
  'emergencia',
];

function detectarTransbordoKeyword(mensagem: string): boolean {
  const lower = mensagem.toLowerCase();
  return PALAVRAS_TRANSBORDO.some((kw) => lower.includes(kw));
}

function montarNotificacaoRH(
  nome: string,
  telefone: string,
  motivo: string,
  ultimaMensagem: string
): string {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return (
    `⚠️ *Solicitação de atendimento humano*\n\n` +
    `👤 *Colaborador:* ${nome}\n` +
    `📱 *Telefone:* ${telefone}\n` +
    `🕐 *Horário:* ${agora}\n` +
    `❓ *Motivo:* ${motivo}\n` +
    `💬 *Última mensagem:* "${ultimaMensagem}"\n\n` +
    `Para liberar o bot após atender, envie:\n` +
    `*${COMANDO_LIBERAR} ${telefone}*`
  );
}

function transbordoExpirou(transbordoInicio: number): boolean {
  return Date.now() - transbordoInicio > TRANSBORDO_TTL_MS;
}

// Busca colaborador na base real (Solides) com fallback nos mocks
async function buscarColaborador(telefone: string): Promise<Colaborador | null> {
  const norm = evolutionService.formatarTelefone(telefone);

  // Busca na API Solides
  const colaborador = await solidesService.buscarPorTelefone(norm);
  if (colaborador) return colaborador;

  // Busca na lista mockup
  return COLABORADORES_MOCK.find((c) => {
    const cNorm = evolutionService.formatarTelefone(c.telefone);
    return cNorm === norm || cNorm.slice(-9) === norm.slice(-9);
  }) || null;
}

// ─── Handler principal (Evolution API Webhook) ─────────────────────────────────
export async function webhookHandler(req: Request, res: Response): Promise<void> {
  res.status(200).json({ ok: true });

  const payload = req.body as EvolutionWebhookPayload;

  // Evolution API envia vários eventos. Filtramos apenas para mensagens criadas/recebidas
  if (payload.event !== 'messages.upsert') return;
  if (!payload.data) return;

  const { key, message } = payload.data;
  if (!key || key.fromMe) return; // Evita loop com mensagens do próprio bot
  if (!message) return;

  const remoteJid = key.remoteJid;
  if (!remoteJid) return;

  const isGrupo = remoteJid.endsWith('@g.us');
  // Se JID termina em @lid, utiliza o alternativo se disponível
  const finalJid = (remoteJid.endsWith('@lid') && key.remoteJidAlt) ? key.remoteJidAlt : remoteJid;
  const telefone = isGrupo ? '' : evolutionService.formatarTelefone(finalJid.split('@')[0]);

  // Extrai mensagem de texto
  const mensagem = (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();

  if (!mensagem) return;

  // Mensagens do grupo do RH: só processa comandos
  if (isGrupo) {
    await processarComandoGrupo(mensagem);
    return;
  }

  try {
    let sessao = await sessaoService.buscar(telefone);

    // ─── 1. Em transbordo ──────────────────────────────────────────────────
    if (sessao?.emTransbordo) {
      if (sessao.transbordoInicio && transbordoExpirou(sessao.transbordoInicio)) {
        // TTL expirou: libera automaticamente
        sessao.emTransbordo      = false;
        sessao.transbordoInicio  = undefined;
        await sessaoService.salvar(sessao);
        await evolutionService.enviarTexto(
          telefone,
          `Olá novamente! 👋 Estou de volta para te ajudar. Como posso te ajudar?`
        );
        // Deixa a mensagem atual ser processada normalmente abaixo
      } else {
        // Atendente humano ainda está ativo — ignora
        return;
      }
    }

    // ─── 2. Autenticação ───────────────────────────────────────────────────
    if (!sessao || !sessao.autenticado) {
      const colaborador = await buscarColaborador(telefone);

      if (!colaborador) {
        await evolutionService.enviarTexto(
          telefone,
          `Olá! 👋 Este canal é exclusivo para colaboradores da empresa.\n\n` +
          `Seu número não foi encontrado em nosso sistema. ` +
          `Caso acredite que isso seja um erro, entre em contato com o RH.`
        );
        return;
      }

      sessao = await sessaoService.criar(telefone);
      sessao.colaborador = colaborador;
      sessao.autenticado = true;
      await sessaoService.salvar(sessao);

      await evolutionService.enviarTexto(
        telefone,
        `Olá, *${colaborador.nome}*! 😊\n\n` +
        `Sou o assistente virtual do RH. Posso te ajudar com:\n\n` +
        `🏖️ *Férias* – saldo e período\n` +
        `⏱️ *Ponto* – registros do mês\n` +
        `📋 *Legislação* – CLT, FGTS e mais\n` +
        `👤 *Atendente* – falar com o RH\n\n` +
        `Como posso te ajudar hoje?`
      );
      return;
    }

    // ─── 3. Transbordo por palavra-chave ───────────────────────────────────
    if (detectarTransbordoKeyword(mensagem)) {
      await executarTransbordo(
        telefone, sessao, mensagem,
        'Colaborador solicitou atendimento humano'
      );
      return;
    }

    // ─── 4. Processa com a LLM ────────────────────────────────────────────
    const colaborador = sessao.colaborador!;
    await sessaoService.adicionarAoHistorico(telefone, 'user', mensagem);
    sessao = (await sessaoService.buscar(telefone))!;

    const resultado = await llmService.processar(
      mensagem,
      sessao.historico.slice(0, -1),
      colaborador
    );

    // ─── 5. Transbordo pela LLM ───────────────────────────────────────────
    if (resultado.transbordo) {
      await executarTransbordo(
        telefone, sessao, mensagem,
        resultado.motivoTransbordo || 'Identificado pela IA'
      );
      return;
    }

    // ─── 6. Resposta normal ───────────────────────────────────────────────
    await evolutionService.enviarTexto(telefone, resultado.texto);
    await sessaoService.adicionarAoHistorico(telefone, 'assistant', resultado.texto);

  } catch (err) {
    console.error('[Webhook] Erro:', err);
    try {
      await evolutionService.enviarTexto(
        telefone,
        `Ops! Tive um problema. Tente novamente em instantes. 🙏`
      );
    } catch { /* silencia */ }
  }
}

// ─── Executa o fluxo completo de transbordo ──────────────────────────────────
async function executarTransbordo(
  telefone: string,
  sessao: any,
  ultimaMensagem: string,
  motivo: string
): Promise<void> {
  sessao.emTransbordo     = true;
  sessao.transbordoInicio = Date.now();
  await sessaoService.salvar(sessao);

  const respostaHandoff = `Entendido! Vou te conectar com nossa equipe de RH. 🔄\n\nEm breve alguém entrará em contato com você. 😊`;
  
  if (sessao.isTest) {
    await sessaoService.adicionarAoHistorico(telefone, 'assistant', respostaHandoff);
  } else {
    await evolutionService.enviarTexto(telefone, respostaHandoff);
    if (GRUPO_RH_ID) {
      await evolutionService.enviarTexto(
        GRUPO_RH_ID,
        montarNotificacaoRH(
          sessao.colaborador?.nome ?? 'Desconhecido',
          telefone,
          motivo,
          ultimaMensagem
        )
      );
    }
  }
}

// ─── Processa comandos enviados no grupo do RH ───────────────────────────────
async function processarComandoGrupo(mensagem: string): Promise<void> {
  if (!mensagem.trim().toLowerCase().startsWith(COMANDO_LIBERAR.toLowerCase())) return;

  const partes   = mensagem.trim().split(/\s+/);
  const telefone = partes[1]?.replace(/\D/g, '');

  if (!telefone) {
    await evolutionService.enviarTexto(
      GRUPO_RH_ID,
      `⚠️ Formato inválido. Use:\n*${COMANDO_LIBERAR} 5521999999999*`
    );
    return;
  }

  const sessao = await sessaoService.buscar(telefone);

  if (!sessao) {
    await evolutionService.enviarTexto(
      GRUPO_RH_ID,
      `⚠️ Nenhuma sessão encontrada para *${telefone}*.`
    );
    return;
  }

  if (!sessao.emTransbordo) {
    await evolutionService.enviarTexto(
      GRUPO_RH_ID,
      `ℹ️ *${sessao.colaborador?.nome}* (${telefone}) não está em transbordo.`
    );
    return;
  }

  sessao.emTransbordo     = false;
  sessao.transbordoInicio = undefined;
  await sessaoService.salvar(sessao);

  await evolutionService.enviarTexto(
    GRUPO_RH_ID,
    `✅ Bot liberado para *${sessao.colaborador?.nome}* (${telefone}).`
  );

  await evolutionService.enviarTexto(
    telefone,
    `Olá! 👋 Seu atendimento foi concluído.\n\nEstou de volta caso precise de mais alguma coisa. Como posso te ajudar?`
  );
}

// ─── API DE TESTE (FRONT-END MOCKUP) ──────────────────────────────────────────

// Retorna lista de colaboradores para o painel de testes
export async function testColaboradoresHandler(req: Request, res: Response): Promise<void> {
  try {
    const colaboradoresReais = await solidesService.listarTodosParaTeste();
    
    // Se a API Solides retornou registros, junta com os mocks para demonstração, senão envia só mocks
    if (colaboradoresReais && colaboradoresReais.length > 0) {
      // Evita duplicatas por telefone
      const telefonesMocks = COLABORADORES_MOCK.map((m) => evolutionService.formatarTelefone(m.telefone));
      const filtradosReais = colaboradoresReais.filter(
        (c) => !telefonesMocks.includes(evolutionService.formatarTelefone(c.telefone))
      );
      res.json([...COLABORADORES_MOCK, ...filtradosReais]);
    } else {
      res.json(COLABORADORES_MOCK);
    }
  } catch (err) {
    res.json(COLABORADORES_MOCK);
  }
}

// Retorna histórico de mensagens de um colaborador
export async function testHistoricoHandler(req: Request, res: Response): Promise<void> {
  const { telefone } = req.params;
  if (!telefone) {
    res.status(400).json({ error: 'Telefone é obrigatório.' });
    return;
  }

  const norm = evolutionService.formatarTelefone(telefone);
  const sessao = await sessaoService.buscar(norm);
  if (!sessao) {
    res.json({ historico: [], emTransbordo: false });
    return;
  }

  res.json({
    historico: sessao.historico,
    emTransbordo: sessao.emTransbordo,
    colaborador: sessao.colaborador
  });
}

// Processa mensagens simuladas via Web Chat
export async function testChatHandler(req: Request, res: Response): Promise<void> {
  const { telefone, mensagem } = req.body;
  if (!telefone || !mensagem) {
    res.status(400).json({ error: 'Telefone e mensagem são obrigatórios.' });
    return;
  }

  const norm = evolutionService.formatarTelefone(telefone);

  try {
    let sessao = await sessaoService.buscar(norm);

    // 1. Verifica se está em transbordo
    if (sessao?.emTransbordo) {
      if (sessao.transbordoInicio && transbordoExpirou(sessao.transbordoInicio)) {
        sessao.emTransbordo = false;
        sessao.transbordoInicio = undefined;
        await sessaoService.salvar(sessao);
        
        const retornoTexto = 'Olá novamente! 👋 Estou de volta para te ajudar. Como posso te ajudar?';
        await sessaoService.adicionarAoHistorico(norm, 'assistant', retornoTexto);
      } else {
        res.json({
          texto: `[Sessão sob atendimento de RH Humano]\nO chatbot está pausado. Você pode liberar o bot clicando em "Concluir Atendimento".`,
          emTransbordo: true
        });
        return;
      }
    }

    // 2. Verifica se a sessão é nova ou não autenticada
    if (!sessao || !sessao.autenticado) {
      const colaborador = await buscarColaborador(norm);

      if (!colaborador) {
        res.json({
          texto: `Olá! 👋 Este canal é exclusivo para colaboradores da empresa.\n\nSeu número não foi encontrado em nosso sistema.`,
          autenticado: false
        });
        return;
      }

      sessao = await sessaoService.criar(norm);
      sessao.colaborador = colaborador;
      sessao.autenticado = true;
      sessao.isTest = true;
      await sessaoService.salvar(sessao);

      const textoBoasVindas = `Olá, *${colaborador.nome}*! 😊\n\nSou o assistente virtual do RH. Posso te ajudar com:\n\n🏖️ *Férias* – saldo e período\n⏱️ *Ponto* – registros do mês\n📋 *Legislação* – CLT, FGTS e mais\n👤 *Atendente* – falar com o RH\n\nComo posso te ajudar hoje?`;
      await sessaoService.adicionarAoHistorico(norm, 'assistant', textoBoasVindas);

      res.json({
        texto: textoBoasVindas,
        emTransbordo: false,
        colaborador
      });
      return;
    }

    // Marca como sessão de teste para evitar envios reais de WhatsApp no fluxo de transbordo
    sessao.isTest = true;
    await sessaoService.salvar(sessao);

    // 3. Transbordo por palavra-chave
    if (detectarTransbordoKeyword(mensagem)) {
      await executarTransbordo(norm, sessao, mensagem, 'Palavra-chave acionada no chat de teste');
      res.json({
        texto: `Entendido! Vou te conectar com nossa equipe de RH. 🔄\n\nEm breve alguém entrará em contato com você. 😊`,
        emTransbordo: true
      });
      return;
    }

    // 4. Processa com a LLM (Gemini)
    const colaborador = sessao.colaborador!;
    await sessaoService.adicionarAoHistorico(norm, 'user', mensagem);
    sessao = (await sessaoService.buscar(norm))!;

    const resultado = await llmService.processar(
      mensagem,
      sessao.historico.slice(0, -1),
      colaborador
    );

    // 5. Transbordo identificado pela IA
    if (resultado.transbordo) {
      await executarTransbordo(
        norm,
        sessao,
        mensagem,
        resultado.motivoTransbordo || 'Identificado pela IA no chat de teste'
      );
      res.json({
        texto: resultado.texto,
        emTransbordo: true
      });
      return;
    }

    // 6. Resposta normal do assistente
    await sessaoService.adicionarAoHistorico(norm, 'assistant', resultado.texto);
    res.json({
      texto: resultado.texto,
      emTransbordo: false
    });

  } catch (err: any) {
    console.error('[Test Chat Error]:', err);
    res.status(500).json({ error: 'Erro ao processar mensagem no chat simulado.' });
  }
}

// Conclui transbordo e reativa o bot
export async function testLiberarHandler(req: Request, res: Response): Promise<void> {
  const { telefone } = req.body;
  if (!telefone) {
    res.status(400).json({ error: 'Telefone é obrigatório.' });
    return;
  }

  const norm = evolutionService.formatarTelefone(telefone);
  const sessao = await sessaoService.buscar(norm);

  if (!sessao) {
    res.status(404).json({ error: 'Sessão não encontrada.' });
    return;
  }

  sessao.emTransbordo = false;
  sessao.transbordoInicio = undefined;
  await sessaoService.salvar(sessao);

  const msgRetorno = `Olá! 👋 Seu atendimento foi concluído.\n\nEstou de volta caso precise de mais alguma coisa. Como posso te ajudar?`;
  await sessaoService.adicionarAoHistorico(norm, 'assistant', msgRetorno);

  res.json({ ok: true, texto: msgRetorno });
}

// Limpa histórico de um colaborador para reiniciar testes
export async function testLimparHistoricoHandler(req: Request, res: Response): Promise<void> {
  const { telefone } = req.body;
  if (!telefone) {
    res.status(400).json({ error: 'Telefone é obrigatório.' });
    return;
  }

  const norm = evolutionService.formatarTelefone(telefone);
  const sessao = await sessaoService.buscar(norm);

  if (sessao) {
    // Apaga sessao recriando-a zerada
    await sessaoService.criar(norm); // recria limpa
  }

  res.json({ ok: true });
}
