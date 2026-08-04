// src/routes/webhook.controller.ts
import { Request, Response } from 'express';
import { sessaoService } from '../services/sessao.service';
import { solidesService } from '../services/solides.service';
import { evolutionService } from '../services/evolution.service';
import { llmService } from '../services/llm.service';
import { dbService } from '../services/db.service';
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
  departamento?: string
): string {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return (
    `⚠️ *Solicitação de atendimento humano*\n\n` +
    `👤 *Colaborador:* ${nome}\n` +
    `💼 *Cargo:* ${cargo ?? 'Não informado'}\n` +
    `🏢 *Departamento:* ${departamento ?? 'Não informado'}\n` +
    `📱 *Telefone:* ${telefone}\n` +
    `🕐 *Horário:* ${agora}\n` +
    `❓ *Motivo:* ${motivo}\n` +
    `💬 *Última mensagem:* "${ultimaMensagem}"\n\n` +
    `Para liberar o bot após atender, envie:\n` +
    `*${COMANDO_LIBERAR} ${telefone}*`
  );
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
// 1) Banco SQLite local (fonte primária)
// 2) API Solides (fallback) — se encontrado, sincroniza no banco local
async function buscarColaboradorPorTelefone(telefone: string): Promise<Colaborador | null> {
  const norm = evolutionService.formatarTelefone(telefone);

  // 1. Banco SQLite local — mais rápido e sem dependência de rede
  const dbRow = dbService.buscarPorTelefone(norm);
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

  // 2. API Solides (fallback online — pode falhar se não houver conectividade)
  try {
    const colaborador = await solidesService.buscarPorTelefone(norm);
    if (colaborador) {
      console.log(`[Auth] Colaborador encontrado na API Solides: ${colaborador.nome} (telefone: ${norm}). Sincronizando banco local.`);
      // Sincroniza o banco local para evitar consulta remota nas próximas mensagens
      dbService.upsert({
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

  // Evolution API envia vários eventos. Filtramos apenas para mensagens criadas/recebidas
  if (payload.event !== 'messages.upsert') return;
  if (!payload.data) return;

  const { key, message } = payload.data;
  if (!key) return;

  // Mensagem enviada pelo próprio número (atendente usando WhatsApp Web)
  // Ativa modo atendente silenciosamente sem processar como mensagem de colaborador
  if (key.fromMe) {
    const jidFromMe = key.remoteJid;
    if (jidFromMe && !jidFromMe.endsWith('@g.us')) {
      const telFromMe = evolutionService.formatarTelefone(jidFromMe.split('@')[0]);
      await ativarModoAtendente(telFromMe, 'fromMe');
    }
    return;
  }

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

    // ─── 1. Modo atendente ────────────────────────────────────────────────
    if (sessao?.modoAtendente) {
      if (sessao.modoAtendenteTTL && (Date.now() - sessao.modoAtendenteTTL > ATENDENTE_TTL_MS)) {
        // TTL expirou: retoma silenciosamente (sem mensagem ao colaborador)
        sessao.modoAtendente    = false;
        sessao.modoAtendenteTTL = undefined;
        await sessaoService.salvar(sessao);
        log('modo_atendente_expirou', { telefone });
        // Deixa a mensagem atual ser processada normalmente abaixo
      } else {
        // Atendente ainda está na conversa — bot silenciado
        return;
      }
    }

    // ─── 2. Em transbordo ──────────────────────────────────────────────────
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

    // ─── 3. Triagem de entrada ─────────────────────────────────────────────
    if (!sessao || !sessao.autenticado) {
      await processarTriagem(telefone, mensagem, sessao);
      return;
    }

    // ─── 4. Transbordo por palavra-chave ───────────────────────────────────
    if (detectarTransbordoKeyword(mensagem)) {
      await executarTransbordo(
        telefone, sessao, mensagem,
        'Colaborador solicitou atendimento humano'
      );
      return;
    }

    // ─── 5. Processa com a LLM ────────────────────────────────────────────
    const colaborador = sessao.colaborador!;
    await sessaoService.adicionarAoHistorico(telefone, 'user', mensagem);
    sessao = (await sessaoService.buscar(telefone))!;

    const resultado = await llmService.processar(
      mensagem,
      sessao.historico.slice(0, -1),
      colaborador
    );

    // ─── 6. Transbordo pela LLM ───────────────────────────────────────────
    if (resultado.transbordo) {
      await executarTransbordo(
        telefone, sessao, mensagem,
        resultado.motivoTransbordo || 'Identificado pela IA'
      );
      return;
    }

    // ─── 7. Resposta normal ───────────────────────────────────────────────
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

// ─── Triagem de entrada ───────────────────────────────────────────────────────
// Gerencia os 3 caminhos antes da autenticação confirmada.
async function processarTriagem(
  telefone: string,
  mensagem: string,
  sessao: Sessao | null
): Promise<void> {

  // ── Caminho 1: telefone encontrado em alguma fonte ─────────────────────────
  if (!sessao || !sessao.estado) {
    const colaborador = await buscarColaboradorPorTelefone(telefone);

    if (colaborador) {
      // Autenticação bem-sucedida pelo telefone
      const novaSessao = sessao ?? await sessaoService.criar(telefone);
      novaSessao.colaborador = colaborador;
      novaSessao.autenticado = true;
      novaSessao.estado      = undefined;
      await sessaoService.salvar(novaSessao);

      log('auth_success', { telefone, fonte: 'telefone' });

      await evolutionService.enviarTexto(
        telefone,
        `Olá, *${colaborador.nome}*! 👋 Eu sou a Alice, assistente virtual de RH.\n\n` +
        `Pode me perguntar sobre férias, ponto, benefícios, dúvidas sobre a CLT — ou se preferir, te conecto com a equipe.\n\n` +
        `Como posso ajudar?`
      );
      return;
    }

    // Telefone não encontrado — inicia coleta de CPF (Caminho 2)
    const novaSessao = sessao ?? await sessaoService.criar(telefone);
    novaSessao.estado         = 'aguardando_cpf';
    novaSessao.tentativas_cpf = 0;
    await sessaoService.salvar(novaSessao);

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
      // Formato inválido
      const tentativas = (sessao.tentativas_cpf ?? 0) + 1;

      if (tentativas >= MAX_TENTATIVAS_CPF) {
        // Limite de tentativas atingido — transbordo humano
        console.log(`[Triagem] CPF inválido após ${tentativas} tentativas para ${telefone}. Encaminhando para transbordo.`);
        log('auth_cpf_tentativa', { telefone, tentativa: tentativas, resultado: 'transbordo' });
        sessao.emTransbordo     = true;
        sessao.transbordoInicio = Date.now();
        sessao.estado           = undefined;
        sessao.tentativas_cpf   = 0;
        await sessaoService.salvar(sessao);

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

    // CPF com formato válido — busca no banco local
    const dbRow = dbService.buscarPorCpf(cpfLimpo);

    if (dbRow) {
      // CPF encontrado: atualiza telefone e autentica
      console.log(`[Triagem] CPF ${cpfLimpo} encontrado. Atualizando telefone para ${telefone}.`);
      dbService.atualizarTelefoneColaborador(cpfLimpo, telefone);

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

    // CPF não encontrado no banco local — Caminho 3 (sem expor que o CPF não existe)
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
      // Encerra com instruções de currículo
      sessao.estado = undefined;
      await sessaoService.salvar(sessao);

      await evolutionService.enviarTexto(
        telefone,
        `Olá! Tudo bem?\n\n` +
        `Para dar continuidade ao processo, pedimos que envie seu currículo diretamente para este número: (21) 95900-1075.\n\n` +
        `Assim que recebermos, a equipe responsável irá realizar a análise. 🙂`
      );
      return;
    }

    if (eColaborador) {
      // Pede nome e filial para acionar transbordo identificado
      sessao.estado = 'aguardando_dados_colaborador';
      await sessaoService.salvar(sessao);

      await evolutionService.enviarTexto(
        telefone,
        `Tudo bem! Para que nossa equipe possa te ajudar, vou precisar de algumas informações.\n\n` +
        `Qual é o seu nome completo e em qual unidade ou filial você trabalha?`
      );
      return;
    }

    // Resposta não reconhecida — reenvia o menu
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
    // Trata a mensagem inteira como "nome + filial" informados pelo usuário
    const dadosInformados = mensagem.trim();

    // Monta notificação para o grupo do RH
    if (GRUPO_RH_ID) {
      await evolutionService.enviarTexto(
        GRUPO_RH_ID,
        montarNotificacaoColaboradorNaoIdentificado(dadosInformados, '—', telefone)
      );
    }

    // Ativa transbordo
    sessao.emTransbordo     = true;
    sessao.transbordoInicio = Date.now();
    sessao.estado           = undefined;
    await sessaoService.salvar(sessao);

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
  sessao: any,
  ultimaMensagem: string,
  motivo: string
): Promise<void> {
  sessao.emTransbordo     = true;
  sessao.transbordoInicio = Date.now();
  await sessaoService.salvar(sessao);

  log('transbordo', { telefone, motivo, autenticado: sessao.autenticado ?? false });

  // Ajusta mensagem ao colaborador conforme o horário de atendimento
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
        sessao.colaborador?.departamento
      )
    );
  }
}

// ─── Ativa o modo atendente (silencia o bot) para um número ─────────────────
async function ativarModoAtendente(
  telefone: string,
  origem: 'fromMe' | 'comando'
): Promise<void> {
  let sessao = await sessaoService.buscar(telefone);
  if (!sessao) sessao = await sessaoService.criar(telefone);
  if (sessao.modoAtendente) return; // já ativo — não reseta o TTL

  sessao.modoAtendente    = true;
  sessao.modoAtendenteTTL = Date.now();
  await sessaoService.salvar(sessao);
  log('modo_atendente_ativado', { telefone, origem });
}

// ─── Processa comandos enviados no grupo do RH ───────────────────────────────
async function processarComandoGrupo(mensagem: string): Promise<void> {
  const lower  = mensagem.trim().toLowerCase();
  const partes = mensagem.trim().split(/\s+/);

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

    await ativarModoAtendente(telefone, 'comando');

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

  // Limpa ambos os modos
  sessao.emTransbordo     = false;
  sessao.transbordoInicio = undefined;
  sessao.modoAtendente    = false;
  sessao.modoAtendenteTTL = undefined;
  await sessaoService.salvar(sessao);

  await evolutionService.enviarTexto(
    GRUPO_RH_ID,
    `✅ Bot reativado para *${sessao.colaborador?.nome ?? telefone}* (${telefone}).`
  );
}


