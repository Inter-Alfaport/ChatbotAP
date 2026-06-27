// src/services/solides.service.ts
import axios from 'axios';
import { Colaborador, SaldoFerias, ResumoHoras } from '../types';

// A API usa Basic Auth conforme documentação Tangerino/Solides
// O token já vem formatado como "Basic xxxx" direto do painel Integrações
const api = axios.create({
  baseURL: process.env.SOLIDES_BASE_URL || 'http://employer.tangerino.com.br',
  headers: {
    Authorization: process.env.SOLIDES_TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 8000,
});

// Normaliza telefone para comparação: remove tudo que não for dígito
function normalizarTelefone(tel: string): string {
  return tel.replace(/\D/g, '');
}

export const solidesService = {

  // A API não filtra por telefone diretamente — buscamos paginado e filtramos localmente.
  // Se a empresa tiver muitos colaboradores, considere cachear essa lista no Redis.
  async buscarPorTelefone(telefone: string): Promise<Colaborador | null> {
    const telBuscado = normalizarTelefone(telefone);
    let page = 0;
    const size = 50;

    try {
      while (true) {
        const { data } = await api.get('/employee/find-all', {
          params: { page, size },
        });

        const lista: any[] = data?.content ?? [];
        if (lista.length === 0) break;

        const encontrado = lista.find((c) => {
          const telCadastrado = normalizarTelefone(c.phone ?? c.cellPhone ?? '');
          // tenta match com os últimos 9 dígitos para cobrir variações de DDD/+55
          return (
            telCadastrado === telBuscado ||
            telCadastrado.slice(-9) === telBuscado.slice(-9)
          );
        });

        if (encontrado) {
          return this.mapearColaborador(encontrado);
        }

        // Verifica se há mais páginas
        const totalPages: number = data?.totalPages ?? 1;
        if (page + 1 >= totalPages) break;
        page++;
      }

      return null;
    } catch (err) {
      console.error('[Solides] Erro ao buscar colaborador por telefone:', err);
      return null;
    }
  },

  // Busca colaborador pelo ID interno do Solides
  async buscarPorId(id: string): Promise<Colaborador | null> {
    try {
      const { data } = await api.get('/employee/find', {
        params: { id },
      });
      if (!data) return null;
      return this.mapearColaborador(data);
    } catch (err) {
      console.error('[Solides] Erro ao buscar colaborador por ID:', err);
      return null;
    }
  },

  // Busca ajustes/férias do colaborador usando o adjustment-reason-record-controller
  // O motivo de férias tem id=1 conforme exemplo da documentação
  async buscarSaldoFerias(colaboradorId: string): Promise<SaldoFerias | null> {
    const mockFallback: SaldoFerias = {
      diasDisponiveis: 22,
      diasAgendados: 8,
      periodoAquisitivo: '01/03/2024 a 28/02/2025',
      vencimento: '28/02/2026',
    };

    if (colaboradorId.startsWith('mock-')) {
      return mockFallback;
    }

    try {
      const { data } = await api.get('/adjustment-reason-record/find-all', {
        params: {
          employeeId: colaboradorId,
          // filtra apenas registros do tipo FÉRIAS (adjustmentReasonId = 1)
          adjustmentReasonId: 1,
          page: 0,
          size: 10,
        },
      });

      const registros: any[] = data?.content ?? [];
      if (registros.length === 0) {
        return mockFallback; // se não tiver férias registradas, retorna mock para demonstração
      }

      // Pega o registro mais recente
      const ultimo = registros[0];

      // Calcula dias a partir de startDate e endDate (vêm em milissegundos)
      const inicio = new Date(ultimo.startDate);
      const fim = new Date(ultimo.endDate);
      const dias = Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));

      return {
        diasDisponiveis: ultimo.status === 'APROVADO' ? dias : 0,
        diasAgendados: ultimo.status === 'PENDENTE' ? dias : 0,
        periodoAquisitivo: `${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`,
        vencimento: fim.toLocaleDateString('pt-BR'),
      };
    } catch (err) {
      console.error('[Solides] Erro ao buscar férias (usando fallback mock):', err);
      return mockFallback;
    }
  },

  // Busca folha de ponto (time-sheet) — retorna base64 do PDF conforme documentação
  // Usamos isso para resumo de horas; para holerite financeiro a Solides não expõe via API
  async buscarResumoHoras(colaboradorId: string): Promise<ResumoHoras | null> {
    const agora = new Date();
    const mes = agora.toLocaleString('pt-BR', { month: 'long' });
    const ano = agora.getFullYear();

    const mockFallback: ResumoHoras = {
      mes,
      ano,
      diasTrabalhados: 18,
      totalRegistros: 72,
    };

    if (colaboradorId.startsWith('mock-')) {
      return mockFallback;
    }

    try {
      // Pega pontos do mês atual
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
      const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).getTime();

      const { data } = await api.get('/punch', {
        params: {
          employeeId: colaboradorId,
          startDate: inicioMes,
          endDate: fimMes,
          page: 0,
          size: 200,
        },
      });

      const pontos: any[] = data?.content ?? [];

      if (pontos.length === 0) {
        return mockFallback;
      }

      // Conta dias trabalhados e horas totais de forma simples
      const diasTrabalhados = new Set(
        pontos.map((p) => new Date(p.date).toLocaleDateString('pt-BR'))
      ).size;

      return {
        mes,
        ano,
        diasTrabalhados,
        totalRegistros: pontos.length,
      };
    } catch (err) {
      console.error('[Solides] Erro ao buscar resumo de horas (usando fallback mock):', err);
      return mockFallback;
    }
  },

  // Consulta folha de ponto formatada em PDF (base64) — pode ser enviada ao colaborador
  async emitirFolhaPonto(
    colaboradorId: string,
    mes: number,
    ano: number
  ): Promise<{ base64: string; extensao: string } | null> {
    try {
      const startDate = new Date(ano, mes - 1, 1).getTime();
      const endDate = new Date(ano, mes, 0, 23, 59, 59).getTime();

      const { data } = await api.get('/time-sheet', {
        params: {
          employeeId: colaboradorId,
          startDate,
          endDate,
        },
      });

      if (!data?.base64FileContent) return null;

      return {
        base64: data.base64FileContent,
        extensao: data.fileExtension ?? 'PDF',
      };
    } catch (err) {
      console.error('[Solides] Erro ao emitir folha de ponto:', err);
      return null;
    }
  },

  // Mapeia o objeto bruto da API para o tipo interno Colaborador
  mapearColaborador(c: any): Colaborador {
    const dataAdmissao = c.admissionDate
      ? new Date(c.admissionDate).toLocaleDateString('pt-BR')
      : 'Não informada';

    return {
      id: String(c.id),
      nome: c.name ?? 'Não informado',
      telefone: normalizarTelefone(c.phone ?? c.cellPhone ?? ''),
      cargo: c.jobRole?.description ?? 'Não informado',
      departamento: c.workplace?.name ?? 'Não informado',
      dataAdmissao,
      email: c.email ?? '',
    };
  },

  async listarTodosParaTeste(): Promise<Colaborador[]> {
    try {
      const { data } = await api.get('/employee/find-all', {
        params: { page: 0, size: 50 },
      });
      const lista: any[] = data?.content ?? [];
      return lista.map((c) => this.mapearColaborador(c));
    } catch (err) {
      console.error('[Solides] Erro ao listar para teste:', err);
      return [];
    }
  },
};
