// src/services/atendimento.service.ts
import { dbService } from './db.service';

export const atendimentoService = {
  async iniciar(
    telefone: string,
    colaboradorId?: number,
    nomeColaborador?: string,
    colaboradorIdentificado: boolean = false,
    motivoNaoIdentificacao?: string
  ): Promise<string> {
    try {
      const id = await dbService.criarAtendimento(
        telefone,
        colaboradorId,
        nomeColaborador,
        colaboradorIdentificado,
        motivoNaoIdentificacao
      );
      return id;
    } catch (err) {
      console.error('[AtendimentoService] Erro ao iniciar atendimento:', err);
      throw err;
    }
  },

  async registrarMensagemUsuario(atendimentoId: string, mensagem: string): Promise<void> {
    try {
      const { pool } = require('./db.service');
      const query = `
        UPDATE atendimentos 
        SET qtd_mensagens_usuario = qtd_mensagens_usuario + 1,
            data_ultima_interacao = NOW()
        WHERE id = $1
      `;
      await pool.query(query, [atendimentoId]);

      await dbService.registrarEvento(atendimentoId, 'msg_usuario', 'usuario', { texto: mensagem });
    } catch (err) {
      console.error('[AtendimentoService] Erro ao registrar mensagem do usuario:', err);
    }
  },

  async registrarRespostaBot(atendimentoId: string, resposta: string): Promise<void> {
    try {
      const { pool } = require('./db.service');
      const query = `
        UPDATE atendimentos 
        SET qtd_respostas_bot = qtd_respostas_bot + 1,
            data_ultima_interacao = NOW()
        WHERE id = $1
      `;
      await pool.query(query, [atendimentoId]);

      await dbService.registrarEvento(atendimentoId, 'msg_bot', 'bot', { texto: resposta });
    } catch (err) {
      console.error('[AtendimentoService] Erro ao registrar resposta do bot:', err);
    }
  },

  async registrarTransbordo(
    atendimentoId: string,
    motivo: string,
    origem: string
  ): Promise<void> {
    try {
      await dbService.atualizarAtendimento(atendimentoId, {
        status: 'em_transbordo',
        houve_transbordo: true,
        data_transbordo: new Date(),
        motivo_transbordo: motivo,
        origem_transbordo: origem,
      });

      await dbService.registrarEvento(atendimentoId, 'transbordo', 'sistema', { motivo, origem });

      // Classifica o assunto em segundo plano
      const { classificadorAssuntoService } = require('./classificador-assunto.service');
      classificadorAssuntoService.classificarEPersistir({
        atendimentoId,
        motivoTransbordo: motivo,
        persistir: true
      }).catch((e: any) => console.error('[AtendimentoService] Erro ao classificar transbordo:', e));
    } catch (err) {
      console.error('[AtendimentoService] Erro ao registrar transbordo:', err);
    }
  },

  async registrarAtendenteAssumiu(atendimentoId: string, telefoneAtendente: string): Promise<void> {
    try {
      const agora = new Date();
      const { pool } = require('./db.service');
      const res = await pool.query('SELECT data_assumido FROM atendimentos WHERE id = $1', [
        atendimentoId,
      ]);
      const atd = res.rows[0];

      const campos: Record<string, any> = {
        status: 'em_atendimento',
        atendente_telefone: telefoneAtendente,
      };

      if (atd && !atd.data_assumido) {
        campos.data_assumido = agora;
      }

      await dbService.atualizarAtendimento(atendimentoId, campos);
      await dbService.registrarEvento(atendimentoId, 'atendente_assumiu', telefoneAtendente);
    } catch (err) {
      console.error('[AtendimentoService] Erro ao registrar atendente assumiu:', err);
    }
  },

  async registrarPrimeiraRespostaAtendente(atendimentoId: string, mensagem: string): Promise<void> {
    try {
      const agora = new Date();
      const { pool } = require('./db.service');

      const res = await pool.query('SELECT data_primeira_resposta FROM atendimentos WHERE id = $1', [
        atendimentoId,
      ]);
      const atd = res.rows[0];

      const clauses = ['qtd_mensagens_atendente = qtd_mensagens_atendente + 1', 'data_ultima_interacao = $1'];
      const params: any[] = [agora, atendimentoId];

      if (atd && !atd.data_primeira_resposta) {
        clauses.push('data_primeira_resposta = $1');
      }

      const query = `UPDATE atendimentos SET ${clauses.join(', ')} WHERE id = $${params.length}`;
      await pool.query(query, params);

      await dbService.registrarEvento(atendimentoId, 'msg_atendente', 'atendente', { texto: mensagem });
    } catch (err) {
      console.error('[AtendimentoService] Erro ao registrar primeira resposta do atendente:', err);
    }
  },

  async encerrar(atendimentoId: string, encerradoPor?: string): Promise<void> {
    try {
      await dbService.encerrarAtendimento(atendimentoId, encerradoPor);

      // Classifica o assunto em segundo plano ao encerrar
      const { classificadorAssuntoService } = require('./classificador-assunto.service');
      classificadorAssuntoService.classificarEPersistir({
        atendimentoId,
        persistir: true
      }).catch((e: any) => console.error('[AtendimentoService] Erro ao classificar atendimento ao encerrar:', e));
    } catch (err) {
      console.error('[AtendimentoService] Erro ao encerrar atendimento:', err);
    }
  },

  async registrarAvaliacao(atendimentoId: string, nota: number): Promise<void> {
    try {
      await dbService.atualizarAtendimento(atendimentoId, {
        avaliacao_nota: nota,
        avaliacao_respondida: true,
      });

      await dbService.registrarEvento(atendimentoId, 'avaliacao', 'usuario', { nota });
    } catch (err) {
      console.error('[AtendimentoService] Erro ao registrar avaliacao:', err);
    }
  },
};
