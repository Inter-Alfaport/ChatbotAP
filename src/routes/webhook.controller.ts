// src/routes/webhook.controller.ts
import { Request, Response } from 'express';
import { sessaoService } from '../services/sessao.service';
import { solidesService } from '../services/solides.service';
import { evolutionService } from '../services/evolution.service';
import { llmService } from '../services/llm.service';
import { dbService } from '../services/db.service';
import { Colaborador, EvolutionWebhookPayload } from '../types';

const GRUPO_RH_ID       = process.env.GRUPO_RH_ID || '';
const COMANDO_LIBERAR   = process.env.COMANDO_LIBERAR || '/liberar';
const TRANSBORDO_TTL_MS = (parseInt(process.env.TRANSBORDO_TTL_HORAS || '2')) * 60 * 60 * 1000;



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

// Busca colaborador: 1) banco SQLite local (fonte primária), 2) API Solides (fallback), 3) mocks
async function buscarColaborador(telefone: string): Promise<Colaborador | null> {
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
      console.log(`[Auth] Colaborador encontrado na API Solides: ${colaborador.nome} (telefone: ${norm})`);
      return colaborador;
    }
  } catch (err) {
    console.warn('[Auth] Falha ao consultar API Solides, usando apenas banco local:', err);
  }

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


