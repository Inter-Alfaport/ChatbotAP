// src/routes/webhook.controller.ts
import { Request, Response } from 'express';
import { sessaoService } from '../services/sessao.service';
import { solidesService } from '../services/solides.service';
import { evolutionService } from '../services/evolution.service';
import { llmService } from '../services/llm.service';
import { dbService } from '../services/db.service';
import { atendimentoService } from '../services/atendimento.service';
import { validarFormatoCPF } from '../utils/cpf';
import { log } from '../utils/logger';
import { dentroDoHorarioAtendimento } from '../utils/horario';
import { Colaborador, EvolutionWebhookPayload, Sessao } from '../types';

const GRUPO_RH_ID        = process.env.GRUPO_RH_ID || '';
const COMANDO_LIBERAR    = process.env.COMANDO_LIBERAR || '/liberar';
const COMANDO_SILENCIAR  = process.env.COMANDO_SILENCIAR || '/silenciar';
const TRANSBORDO_TTL_MS  = (parseInt(process.env.TRANSBORDO_TTL_HORAS || '2')) * 60 * 60 * 1000;
const ATENDENTE_TTL_MS   = (parseInt(process.env.ATENDENTE_TTL_HORAS  || '2')) * 60 * 60 * 1000;
const MAX_TENTATIVAS_CPF = 3;

// ─── Deduplicação de mensagens ─────────────────────────────────────────────────
// A Evolution API pode enviar o mesmo webhook mais de uma vez.
// Guardamos os IDs recentes para ignorar duplicatas.
const MSG_IDS_RECENTES = new Set<string>();
const MAX_MSG_IDS = 500;

// Limpa o set a cada 10 minutos para evitar crescimento indefinido
setInterval(() => {
  MSG_IDS_RECENTES.clear();
}, 10 * 60 * 1000);

function jaProcessada(messageId: string): boolean {
  if (MSG_IDS_RECENTES.has(messageId)) return true;
  if (MSG_IDS_RECENTES.size >= MAX_MSG_IDS) {
    const primeiro = MSG_IDS_RECENTES.values().next().value;
    if (primeiro) MSG_IDS_RECENTES.delete(primeiro);
  }
  MSG_IDS_RECENTES.add(messageId);
  return false;
}

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
  ultimaMensagem: string,
  cargo?: string,
  departamento?: string,
  diagnostico?: string
): string {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  let msg = 
    `⚠️ *Solicitação de atendimento humano*\n\n` +
    `👤 *Colaborador:* ${nome}\n` +
    `💼 *Cargo:* ${cargo ?? 'Não informado'}\n` +
    `🏢 *Departamento:* ${departamento ?? 'Não informado'}\n` +
    `📱 *Telefone:* ${telefone}\n` +
    `🕐 *Horário:* ${agora}\n` +
    `❓ *Motivo:* ${motivo}\n` +
    `💬 *Última mensagem:* "${ultimaMensagem}"\n`;

  if (diagnostico) {
    msg += `🔍 *Diagnóstico:* ${diagnostico}\n`;
  }

  msg += `\nPara liberar o bot após atender, envie:\n` +
    `*${COMANDO_LIBERAR} ${telefone}*`;

  return msg;
}

function montarNotificacaoColaboradorNaoIdentificado(
  nomeInformado: string,
  unidadeInformada: string,
  telefone: string
): string {
  return (
    `🔔 *Atendimento — colaborador não identificado no sistema*\n\n` +
    `📋 Nome informado: ${nomeInformado}\n` +
    `🏢 Unidade informada: ${unidadeInformada}\n` +
    `📱 Telefone: ${telefone}\n` +
    `ℹ️ Situação: telefone e CPF não constam no banco local.\n\n` +
    `Por favor, verifique no Solides e atualize o cadastro se necessário.\n\n` +
    `Para liberar o bot após atender, envie:\n` +
    `*${COMANDO_LIBERAR} ${telefone}*`
  );
}

function transbordoExpirou(transbordoInicio: number): boolean {
  return Date.now() - transbordoInicio > TRANSBORDO_TTL_MS;
}

// ─── Busca colaborador por telefone ──────────────────────────────────────────
async function buscarColaboradorPorTelefone(telefone: string): Promise<Colaborador | null> {
  const norm = evolutionService.formatarTelefone(telefone);

  const dbRow = await dbService.buscarPorTelefone(norm);
  if (dbRow) {
    console.log(`[Auth] Colaborador encontrado no banco local: ${dbRow.nome} (telefone: ${norm})`);
    return {
      id: String(dbRow.tangerino_id ?? dbRow.id),
      nome: dbRow.nome,
      telefone: dbRow.phone ?? norm,
      cargo: dbRow.cargo ?? 'Não informado',
      departamento: dbRow.departamento ?? 'Não informado',
      dataAdmissao: dbRow.data_admissao ?? 'Não informada',
      email: dbRow.email ?? '',
    };
  }

  try {
    const colaborador = await solidesService.buscarPorTelefone(norm);
    if (colaborador) {
      console.log(`[Auth] Colaborador encontrado na API Solides: ${colaborador.nome} (telefone: ${norm}). Sincronizando banco local.`);
      await dbService.upsert({
        id: parseInt(colaborador.id) || 0,
        nome: colaborador.nome,
        phone: norm,
        cpf: null,
        email: colaborador.email ?? null,
        cargo: colaborador.cargo ?? null,
        departamento: colaborador.departamento ?? null,
        dataAdmissao: colaborador.dataAdmissao ?? null,
        ativo: true,
      });
      return colaborador;
    }
  } catch (err) {
    console.warn('[Auth] Falha ao consultar API Solides:', err);
  }

  log('auth_failure', { telefone: norm });
  console.warn(`[Auth] Colaborador NÃO encontrado para telefone: ${norm}`);
  return null;
}

// ─── Handler principal (Evolution API Webhook) ─────────────────────────────────
export async function webhookHandler(req: Request, res: Response): Promise<void> {
  res.status(200).json({ ok: true });

  const payload = req.body as EvolutionWebhookPayload;

  if (payload.event !== 'messages.upsert') return;
  if (!payload.data) return;

  const { key, message } = payload.data;
  if (!key) return;

  if (key.id && jaProcessada(key.id)) return;

  // Mensagem enviada pelo próprio número (atendente usando WhatsApp Web)
  if (key.fromMe) {
    const jidFromMe = key.remoteJid;
    if (jidFromMe && !jidFromMe.endsWith('@g.us')) {
      const telFromMe = evolutionService.formatarTelefone(jidFromMe.split('@')[0]);
      
      const mensagemFromMe = (
        message?.conversation ||
        message?.extendedTextMessage?.text ||
        message?.imageMessage?.caption ||
        message?.videoMessage?.caption ||
        ''
      ).trim();

      await ativarModoAtendente(telFromMe, 'fromMe');

      const sessaoColab = await sessaoService.buscar(telFromMe);
      if (sessaoColab?.atendimentoId && mensagemFromMe) {
        await atendimentoService.registrarPrimeiraRespostaAtendente(sessaoColab.atendimentoId, mensagemFromMe);
      }
    }
    return;
  }

  if (!message) return;

  const remoteJid = key.remoteJid;
  if (!remoteJid) return;

  const isGrupo = remoteJid.endsWith('@g.us');
  const finalJid = (remoteJid.endsWith('@lid') && key.remoteJidAlt) ? key.remoteJidAlt : remoteJid;
  const telefone = isGrupo ? '' : evolutionService.formatarTelefone(finalJid.split('@')[0]);

  const mensagem = (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();

  if (!mensagem) return;

  if (isGrupo) {
    const participant = payload.data.participant || payload.data.key.participant;
    await processarComandoGrupo(mensagem, participant);
    return;
  }

  try {
    let sessao = await sessaoService.buscar(telefone);
    if (!sessao) {
      sessao = await sessaoService.criar(telefone);
    }

    // Cria atendimento de analytics se não existir
    if (!sessao.atendimentoId) {
      const aberto = await dbService.buscarAtendimentoAberto(telefone);
      if (aberto) {
        sessao.atendimentoId = aberto.id;
        await sessaoService.salvar(sessao);
      } else {
        const colaborador = await buscarColaboradorPorTelefone(telefone);
        const atendimentoId = await atendimentoService.iniciar(
          telefone,
          colaborador ? parseInt(colaborador.id) : undefined,
          colaborador ? colaborador.nome : undefined,
          !!colaborador,
          colaborador ? undefined : 'Aguardando identificação'
        );
        sessao.atendimentoId = atendimentoId;
        if (colaborador) {
          sessao.colaborador = colaborador;
          sessao.autenticado = true;
        }
        await sessaoService.salvar(sessao);
      }
    }

    // ─── 0. Pesquisa de Satisfação ─────────────────────────────────────────
    if (sessao.estado === 'aguardando_avaliacao') {
      await processarAvaliacao(telefone, mensagem, sessao);
      return;
    }

    // ─── 0b. Processamento de Menu de Assunto (Roteamento / Transbordo) ───
    if (sessao.estado === 'aguardando_assunto_transbordo') {
      if (sessao.atendimentoId) {
        await atendimentoService.registrarMensagemUsuario(sessao.atendimentoId, mensagem);
      }
      await processarMenuAssunto(telefone, mensagem, sessao);
      return;
    }

    // ─── 1. Modo atendente ────────────────────────────────────────────────
    if (sessao.modoAtendente) {
      if (sessao.modoAtendenteTTL && (Date.now() - sessao.modoAtendenteTTL > ATENDENTE_TTL_MS)) {
        sessao.modoAtendente    = false;
        sessao.modoAtendenteTTL = undefined;
        if (sessao.atendimentoId) {
          await atendimentoService.encerrar(sessao.atendimentoId);
          sessao.atendimentoId = undefined;
        }
        await sessaoService.salvar(sessao);
        log('modo_atendente_expirou', { telefone });
      } else {
        if (sessao.atendimentoId) {
          await atendimentoService.registrarMensagemUsuario(sessao.atendimentoId, mensagem);
        }
        return;
      }
    }

    // ─── 2. Em transbordo ──────────────────────────────────────────────────
    if (sessao.emTransbordo) {
      if (sessao.transbordoInicio && transbordoExpirou(sessao.transbordoInicio)) {
        sessao.emTransbordo      = false;
        sessao.transbordoInicio  = undefined;

        if (sessao.atendimentoId) {
          await atendimentoService.encerrar(sessao.atendimentoId);
          const colaborador = sessao.colaborador;
          const novoId = await atendimentoService.iniciar(
            telefone,
            colaborador ? parseInt(colaborador.id) : undefined,
            colaborador ? colaborador.nome : undefined,
            !!colaborador
          );
          sessao.atendimentoId = novoId;
        }
        await sessaoService.salvar(sessao);
        await evolutionService.enviarTexto(
          telefone,
          `Olá novamente! 👋 Estou de volta para te ajudar. Como posso te ajudar?`
        );
      } else {
        if (sessao.atendimentoId) {
          await atendimentoService.registrarMensagemUsuario(sessao.atendimentoId, mensagem);
        }
        return;
      }
    }

    // ─── 3. Triagem de entrada ─────────────────────────────────────────────
    if (!sessao.autenticado) {
      if (sessao.atendimentoId) {
        await atendimentoService.registrarMensagemUsuario(sessao.atendimentoId, mensagem);
      }
      await processarTriagem(telefone, mensagem, sessao);
      return;
    }

    // ─── 4. Transbordo por palavra-chave ou Mensagens Curtas ───────────────
    if (sessao.atendimentoId) {
      await atendimentoService.registrarMensagemUsuario(sessao.atendimentoId, mensagem);
    }

    const categoriaCurta = obterCategoriaMensagemCurta(mensagem);
    const querHumano = detectarTransbordoKeyword(mensagem);

    if (categoriaCurta || querHumano) {
      await enviarMenuAssuntoTransbordo(telefone, sessao);
      return;
    }

    // Controle de tentativas de diagnóstico
    if (sessao.fluxoAtivo) {
      sessao.tentativasDiagnostico = (sessao.tentativasDiagnostico ?? 0) + 1;
      await sessaoService.salvar(sessao);

      if (sessao.tentativasDiagnostico > 3) {
        await executarTransbordo(
          telefone,
          sessao,
          mensagem,
          'Limite de tentativas de diagnóstico excedido',
          'usuario',
          `O colaborador excedeu o limite de 3 interações no autoatendimento do fluxo de ${sessao.categoria || 'ponto'}.`
        );
        return;
      }
    }

    // ─── 5. Processa com a LLM ────────────────────────────────────────────
    const colaborador = sessao.colaborador!;
    await sessaoService.adicionarAoHistorico(telefone, 'user', mensagem);
    sessao = (await sessaoService.buscar(telefone))!;

    const resultado = await llmService.processar(
      mensagem,
      sessao.historico.slice(0, -1),
      colaborador,
      sessao.fluxoAtivo
    );

    // ─── 6. Transbordo pela LLM ───────────────────────────────────────────
    if (resultado.transbordo) {
      await executarTransbordo(
        telefone, sessao, mensagem,
        resultado.motivoTransbordo || 'Identificado pela IA',
        'llm',
        resultado.diagnostico
      );
      return;
    }

    // ─── 7. Resposta normal ───────────────────────────────────────────────
    await evolutionService.enviarTexto(telefone, resultado.texto);
    await sessaoService.adicionarAoHistorico(telefone, 'assistant', resultado.texto);

    if (sessao.atendimentoId) {
      await atendimentoService.registrarRespostaBot(sessao.atendimentoId, resultado.texto);
    }

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

// ─── Triagem de entrada ───────────────────────────────────────────────────────
async function processarTriagem(
  telefone: string,
  mensagem: string,
  sessao: Sessao
): Promise<void> {

  // ── Caminho 1: telefone encontrado em alguma fonte ─────────────────────────
  if (!sessao.estado) {
    const colaborador = await buscarColaboradorPorTelefone(telefone);

    if (colaborador) {
      sessao.colaborador = colaborador;
      sessao.autenticado = true;
      sessao.estado      = undefined;

      if (sessao.atendimentoId) {
        await dbService.atualizarAtendimento(sessao.atendimentoId, {
          colaborador_id: parseInt(colaborador.id),
          nome_colaborador: colaborador.nome,
          colaborador_identificado: true,
          motivo_nao_identificacao: null
        });
      }

      await sessaoService.salvar(sessao);
      log('auth_success', { telefone, fonte: 'telefone' });

      await evolutionService.enviarTexto(
        telefone,
        `Olá, *${colaborador.nome}*! 👋 Eu sou a Alice, assistente virtual de RH.\n\n` +
        `Pode me perguntar sobre férias, ponto, benefícios, dúvidas sobre a CLT — ou se preferir, te conecto com a equipe.\n\n` +
        `Como posso ajudar?`
      );
      return;
    }

    sessao.estado         = 'aguardando_cpf';
    sessao.tentativas_cpf = 0;
    await sessaoService.salvar(sessao);

    log('triage_state_change', { telefone, estado: 'aguardando_cpf' });

    await evolutionService.enviarTexto(
      telefone,
      `Olá! Percebi que seu telefone não consta no nosso sistema. Poderia informar seu CPF?`
    );
    return;
  }

  // ── Caminho 2: aguardando CPF ──────────────────────────────────────────────
  if (sessao.estado === 'aguardando_cpf') {
    const cpfLimpo = validarFormatoCPF(mensagem);

    if (!cpfLimpo) {
      const tentativas = (sessao.tentativas_cpf ?? 0) + 1;

      if (tentativas >= MAX_TENTATIVAS_CPF) {
        console.log(`[Triagem] CPF inválido após ${tentativas} tentativas para ${telefone}. Encaminhando para transbordo.`);
        log('auth_cpf_tentativa', { telefone, tentativa: tentativas, resultado: 'transbordo' });
        
        sessao.emTransbordo     = true;
        sessao.transbordoInicio = Date.now();
        sessao.estado           = undefined;
        sessao.tentativas_cpf   = 0;
        await sessaoService.salvar(sessao);

        if (sessao.atendimentoId) {
          await dbService.atualizarAtendimento(sessao.atendimentoId, {
            motivo_nao_identificacao: 'Falha na validação de CPF após 3 tentativas'
          });
          await atendimentoService.registrarTransbordo(sessao.atendimentoId, 'Falha na validação de CPF após 3 tentativas', 'sistema');
        }

        await evolutionService.enviarTexto(
          telefone,
          `Não consegui identificar seu cadastro. Vou transferir para nossa equipe. Um momento! 🙂`
        );
        if (GRUPO_RH_ID) {
          await evolutionService.enviarTexto(
            GRUPO_RH_ID,
            montarNotificacaoRH('Não identificado', telefone, 'Falha na validação de CPF após 3 tentativas', mensagem)
          );
        }
        return;
      }

      sessao.tentativas_cpf = tentativas;
      await sessaoService.salvar(sessao);

      log('auth_cpf_tentativa', { telefone, tentativa: tentativas, resultado: 'formato_invalido' });

      await evolutionService.enviarTexto(
        telefone,
        `Não consegui identificar esse CPF. Por favor, digite apenas os 11 números, sem pontos ou traços.`
      );
      return;
    }

    const dbRow = await dbService.buscarPorCpf(cpfLimpo);

    if (dbRow) {
      console.log(`[Triagem] CPF ${cpfLimpo} encontrado. Atualizando telefone para ${telefone}.`);
      await dbService.atualizarTelefoneColaborador(cpfLimpo, telefone);

      const colaborador: Colaborador = {
        id: String(dbRow.tangerino_id ?? dbRow.id),
        nome: dbRow.nome,
        telefone: telefone,
        cargo: dbRow.cargo ?? 'Não informado',
        departamento: dbRow.departamento ?? 'Não informado',
        dataAdmissao: dbRow.data_admissao ?? 'Não informada',
        email: dbRow.email ?? '',
      };

      sessao.colaborador    = colaborador;
      sessao.autenticado    = true;
      sessao.estado         = undefined;
      sessao.tentativas_cpf = 0;

      if (sessao.atendimentoId) {
        await dbService.atualizarAtendimento(sessao.atendimentoId, {
          colaborador_id: parseInt(colaborador.id),
          nome_colaborador: colaborador.nome,
          colaborador_identificado: true,
          motivo_nao_identificacao: null
        });
      }

      await sessaoService.salvar(sessao);
      log('auth_success', { telefone, fonte: 'cpf' });

      await evolutionService.enviarTexto(
        telefone,
        `Olá, *${colaborador.nome}*! 👋 Eu sou a Alice, assistente virtual de RH.\n\n` +
        `Pode me perguntar sobre férias, ponto, benefícios, dúvidas sobre a CLT — ou se preferir, te conecto com a equipe.\n\n` +
        `Como posso ajudar?`
      );
      return;
    }

    console.log(`[Triagem] CPF ${cpfLimpo} não encontrado. Encaminhando para menu de triagem.`);
    log('triage_state_change', { telefone, estado: 'aguardando_motivo' });
    sessao.estado         = 'aguardando_motivo';
    sessao.tentativas_cpf = 0;
    await sessaoService.salvar(sessao);

    await evolutionService.enviarTexto(
      telefone,
      `Olá! Como posso ajudar?\n\n` +
      `1️⃣ Quero enviar meu currículo\n` +
      `2️⃣ Sou colaborador da empresa e preciso de ajuda`
    );
    return;
  }

  // ── Caminho 3a: aguardando escolha do menu ─────────────────────────────────
  if (sessao.estado === 'aguardando_motivo') {
    const lower = mensagem.toLowerCase();
    const querCurriculo = lower.includes('1') || lower.includes('currículo') ||
                          lower.includes('curriculo') || lower.includes('vaga');
    const eColaborador  = lower.includes('2') || lower.includes('colaborador') ||
                          lower.includes('funcionário') || lower.includes('funcionario') ||
                          lower.includes('trabalho aqui');

    if (querCurriculo) {
      sessao.estado = undefined;
      await sessaoService.salvar(sessao);

      // Analytics: currículo é uma ação externa, encerra o atendimento
      if (sessao.atendimentoId) {
        await dbService.atualizarAtendimento(sessao.atendimentoId, {
          motivo_nao_identificacao: 'Envio de currículo'
        });
        await atendimentoService.encerrar(sessao.atendimentoId);
        sessao.atendimentoId = undefined;
        await sessaoService.salvar(sessao);
      }

      await evolutionService.enviarTexto(
        telefone,
        `Olá! Tudo bem?\n\n` +
        `Para dar continuidade ao processo, pedimos que envie seu currículo diretamente para este número: (21) 95900-1075.\n\n` +
        `Assim que recebermos, a equipe responsável irá realizar a análise. 🙂`
      );
      return;
    }

    if (eColaborador) {
      sessao.estado = 'aguardando_dados_colaborador';
      await sessaoService.salvar(sessao);

      await evolutionService.enviarTexto(
        telefone,
        `Tudo bem! Para que nossa equipe possa te ajudar, vou precisar de algumas informações.\n\n` +
        `Qual é o seu nome completo e em qual unidade ou filial você trabalha?`
      );
      return;
    }

    await evolutionService.enviarTexto(
      telefone,
      `Desculpe, não entendi. Por favor, escolha uma das opções:\n\n` +
      `1️⃣ Quero enviar meu currículo\n` +
      `2️⃣ Sou colaborador da empresa e preciso de ajuda`
    );
    return;
  }

  // ── Caminho 3b: aguardando nome e filial ──────────────────────────────────
  if (sessao.estado === 'aguardando_dados_colaborador') {
    const dadosInformados = mensagem.trim();

    if (GRUPO_RH_ID) {
      await evolutionService.enviarTexto(
        GRUPO_RH_ID,
        montarNotificacaoColaboradorNaoIdentificado(dadosInformados, '—', telefone)
      );
    }

    sessao.emTransbordo     = true;
    sessao.transbordoInicio = Date.now();
    sessao.estado           = undefined;
    await sessaoService.salvar(sessao);

    if (sessao.atendimentoId) {
      await dbService.atualizarAtendimento(sessao.atendimentoId, {
        nome_colaborador: dadosInformados,
        motivo_nao_identificacao: 'Colaborador não cadastrado, informou dados'
      });
      await atendimentoService.registrarTransbordo(sessao.atendimentoId, `Não identificado: ${dadosInformados}`, 'usuario');
    }

    await evolutionService.enviarTexto(
      telefone,
      `Pronto! Transferi seu atendimento para nossa equipe de RH. Em breve alguém vai entrar em contato. 🙂`
    );
    return;
  }
}

// ─── Executa o fluxo completo de transbordo ──────────────────────────────────
async function executarTransbordo(
  telefone: string,
  sessao: Sessao,
  ultimaMensagem: string,
  motivo: string,
  origem: 'keyword' | 'llm' | 'usuario' | 'erro_tecnico',
  diagnostico?: string
): Promise<void> {
  sessao.emTransbordo     = true;
  sessao.transbordoInicio = Date.now();
  await sessaoService.salvar(sessao);

  log('transbordo', { telefone, motivo, autenticado: sessao.autenticado });

  if (sessao.atendimentoId) {
    await atendimentoService.registrarTransbordo(sessao.atendimentoId, motivo, origem);
  }

  const fora = !dentroDoHorarioAtendimento();
  const respostaHandoff = fora
    ? `Recebi sua mensagem! Nossa equipe está disponível de segunda a sexta, das 8h às 18h.\n\nVou registrar e alguém retorna assim que possível. 🙂`
    : `Entendido! Vou te conectar com nossa equipe de RH. 🔄\n\nEm breve alguém entrará em contato com você. 😊`;

  await evolutionService.enviarTexto(telefone, respostaHandoff);
  if (GRUPO_RH_ID) {
    await evolutionService.enviarTexto(
      GRUPO_RH_ID,
      montarNotificacaoRH(
        sessao.colaborador?.nome ?? 'Desconhecido',
        telefone,
        motivo,
        ultimaMensagem,
        sessao.colaborador?.cargo,
        sessao.colaborador?.departamento,
        diagnostico
      )
    );
  }
}

// ─── Ativa o modo atendente (silencia o bot) para um número ─────────────────
async function ativarModoAtendente(
  telefone: string,
  origem: 'fromMe' | 'comando',
  atendenteTelefone?: string
): Promise<void> {
  let sessao = await sessaoService.buscar(telefone);
  if (!sessao) sessao = await sessaoService.criar(telefone);
  if (sessao.modoAtendente) return;

  sessao.modoAtendente    = true;
  sessao.modoAtendenteTTL = Date.now();
  await sessaoService.salvar(sessao);
  log('modo_atendente_ativado', { telefone, origem });

  if (sessao.atendimentoId) {
    await atendimentoService.registrarAtendenteAssumiu(sessao.atendimentoId, atendenteTelefone ?? 'fromMe');
  }
}

// ─── Processa comandos enviados no grupo do RH ───────────────────────────────
async function processarComandoGrupo(mensagem: string, participantJid?: string): Promise<void> {
  const lower  = mensagem.trim().toLowerCase();
  const partes = mensagem.trim().split(/\s+/);
  const atendenteTelefone = participantJid ? participantJid.split('@')[0] : undefined;

  // ── /silenciar NUMERO ────────────────────────────────────────────────────
  if (lower.startsWith(COMANDO_SILENCIAR.toLowerCase())) {
    const telefone = partes[1]?.replace(/\D/g, '');

    if (!telefone) {
      await evolutionService.enviarTexto(
        GRUPO_RH_ID,
        `⚠️ Formato inválido. Use:\n*${COMANDO_SILENCIAR} 5521999999999*`
      );
      return;
    }

    await ativarModoAtendente(telefone, 'comando', atendenteTelefone);

    const sessaoSil = await sessaoService.buscar(telefone);
    await evolutionService.enviarTexto(
      GRUPO_RH_ID,
      `🔇 Bot silenciado para *${sessaoSil?.colaborador?.nome ?? telefone}* (${telefone}) por ${process.env.ATENDENTE_TTL_HORAS ?? '2'}h.\n` +
      `Para reativar, use:\n*${COMANDO_LIBERAR} ${telefone}*`
    );
    return;
  }

  // ── /liberar NUMERO ──────────────────────────────────────────────────────
  if (!lower.startsWith(COMANDO_LIBERAR.toLowerCase())) return;

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

  const emAlgumModo = sessao.emTransbordo || sessao.modoAtendente;

  if (!emAlgumModo) {
    await evolutionService.enviarTexto(
      GRUPO_RH_ID,
      `ℹ️ *${sessao.colaborador?.nome ?? 'Usuário'}* (${telefone}) não está em modo silenciado ou transbordo.`
    );
    return;
  }

  // Encerra atendimento no analytics, marcando quem liberou
  if (sessao.atendimentoId) {
    await atendimentoService.encerrar(sessao.atendimentoId, atendenteTelefone ?? 'liberar');
  }

  // Limpa ambos os modos e entra no estado de aguardando avaliação
  sessao.emTransbordo     = false;
  sessao.transbordoInicio = undefined;
  sessao.modoAtendente    = false;
  sessao.modoAtendenteTTL = undefined;
  sessao.estado           = 'aguardando_avaliacao';
  sessao.fluxoAtivo       = undefined;
  sessao.categoria        = undefined;
  sessao.tentativasDiagnostico = undefined;
  await sessaoService.salvar(sessao);

  await evolutionService.enviarTexto(
    GRUPO_RH_ID,
    `✅ Bot reativado para *${sessao.colaborador?.nome ?? telefone}* (${telefone}) e enviada pesquisa de satisfação.`
  );

  // Envia CSAT (escala 1-5) ao colaborador
  await evolutionService.enviarTexto(
    telefone,
    `Agradecemos seu contato! 😊\n\n` +
    `Como você avalia o nosso atendimento hoje?\n\n` +
    `1️⃣ Péssimo\n` +
    `2️⃣ Ruim\n` +
    `3️⃣ Regular\n` +
    `4️⃣ Bom\n` +
    `5️⃣ Excelente\n\n` +
    `Caso necessite de mais alguma coisa, basta retornar que estaremos aqui para te ajudar. 🙂`
  );
}

// ─── Processa a avaliação de satisfação (escala 1-5) ────────────────────────────────────
async function processarAvaliacao(
  telefone: string,
  mensagem: string,
  sessao: Sessao
): Promise<void> {
  const nota = parseInt(mensagem.replace(/\D/g, ''), 10);

  if (isNaN(nota) || nota < 1 || nota > 5) {
    await evolutionService.enviarTexto(
      telefone,
      `Por favor, responda com um número de 1 a 5:\n\n` +
      `1️⃣ Péssimo  2️⃣ Ruim  3️⃣ Regular  4️⃣ Bom  5️⃣ Excelente`
    );
    return;
  }

  if (sessao.atendimentoId) {
    await atendimentoService.registrarAvaliacao(sessao.atendimentoId, nota);
  }

  sessao.estado = undefined;
  sessao.atendimentoId = undefined;
  sessao.fluxoAtivo = undefined;
  sessao.categoria = undefined;
  sessao.tentativasDiagnostico = undefined;
  await sessaoService.salvar(sessao);

  const etiquetas: Record<number, string> = {
    1: 'Péssimo 😞', 2: 'Ruim 😕', 3: 'Regular 😐', 4: 'Bom 🙂', 5: 'Excelente 😊'
  };
  await evolutionService.enviarTexto(
    telefone,
    `Obrigado pela sua avaliação! Você escolheu *${etiquetas[nota]}*. Qualquer dúvida, estou por aqui. 👋`
  );
}

// ─── Auxiliares para nova lógica de atendimento (Fase 7) ─────────────────────────

function obterCategoriaMensagemCurta(mensagem: string): string | null {
  const clean = mensagem.trim().toLowerCase().replace(/[?.]/g, '');
  if (clean === 'ponto' || clean === 'tangerino' || clean === 'solides ponto') {
    return 'Ponto';
  }
  if (clean === 'salário' || clean === 'salario' || clean === 'pagamento' || clean === 'holerite' || clean === 'contracheque') {
    return 'Pagamento';
  }
  if (clean === 'férias' || clean === 'ferias') {
    return 'Férias';
  }
  if (clean === 'benefícios' || clean === 'beneficios' || clean === 'vr' || clean === 'vt' || clean === 'vale') {
    return 'Benefícios';
  }
  return null;
}

async function enviarMenuAssuntoTransbordo(telefone: string, sessao: Sessao): Promise<void> {
  sessao.estado = 'aguardando_assunto_transbordo';
  await sessaoService.salvar(sessao);
  
  await evolutionService.enviarTexto(
    telefone,
    `Claro! Para eu te ajudar ou te direcionar para a pessoa certa no RH, selecione o assunto principal:\n\n` +
    `1️⃣ *Ponto Eletrônico* (ajustes, erros, registros)\n` +
    `2️⃣ *Pagamento / Salário / Holerite*\n` +
    `3️⃣ *Benefícios* (Vale Refeição, Vale Transporte)\n` +
    `4️⃣ *Férias*\n` +
    `5️⃣ *Cadastro ou Dados Pessoais*\n` +
    `6️⃣ *Outro assunto / Falar com Atendente*`
  );
}

async function processarMenuAssunto(
  telefone: string,
  mensagem: string,
  sessao: Sessao
): Promise<void> {
  const lower = mensagem.trim().toLowerCase();
  const escolha = parseInt(lower.replace(/\D/g, ''), 10);

  if (isNaN(escolha) || escolha < 1 || escolha > 6) {
    await evolutionService.enviarTexto(
      telefone,
      `Por favor, escolha uma opção válida de 1 a 6:\n\n` +
      `1️⃣ Ponto Eletrônico\n` +
      `2️⃣ Pagamento / Salário / Holerite\n` +
      `3️⃣ Benefícios (VR, VT)\n` +
      `4️⃣ Férias\n` +
      `5️⃣ Cadastro ou Dados Pessoais\n` +
      `6️⃣ Outro assunto / Falar com Atendente`
    );
    return;
  }

  const categoriasMap: Record<number, string> = {
    1: 'Ponto',
    2: 'Pagamento',
    3: 'Benefícios',
    4: 'Férias',
    5: 'Cadastro',
    6: 'Outro assunto'
  };

  const categoriaEscolhida = categoriasMap[escolha];
  sessao.categoria = categoriaEscolhida;
  sessao.estado = undefined; // sai do estado de menu

  if (sessao.atendimentoId) {
    await dbService.atualizarAtendimento(sessao.atendimentoId, {
      categoria: categoriaEscolhida
    });
  }

  if (escolha === 1) {
    // Ativa o fluxo de ponto
    sessao.fluxoAtivo = 'ponto';
    sessao.tentativasDiagnostico = 0;
    await sessaoService.salvar(sessao);
    
    await evolutionService.enviarTexto(
      telefone,
      `Entendido! Vamos verificar seu caso sobre *Ponto Eletrônico*.\n\n` +
      `Me diga em detalhes: qual problema ou dúvida você está enfrentando?`
    );
  } else if (escolha === 6) {
    // Transbordo direto (Outro assunto)
    await executarTransbordo(
      telefone,
      sessao,
      mensagem,
      'Solicitação explícita de humano',
      'usuario',
      `O colaborador escolheu falar diretamente com o RH (Outro assunto).`
    );
  } else {
    // Outras categorias sem fluxo especializado ainda: LLM geral
    sessao.fluxoAtivo = 'geral';
    await sessaoService.salvar(sessao);
    
    await evolutionService.enviarTexto(
      telefone,
      `Certo, vou te ajudar com o assunto *${categoriaEscolhida}*. Me conte mais sobre o que está ocorrendo.`
    );
  }
}
