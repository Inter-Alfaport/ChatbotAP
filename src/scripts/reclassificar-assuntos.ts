import 'dotenv/config';
import { pool, dbService } from '../services/db.service';
import { classificadorAssuntoService } from '../services/classificador-assunto.service';

async function reclassificar() {
  console.log('🔄 Iniciando reclassificação de assuntos dos atendimentos...');

  try {
    const res = await pool.query(`
      SELECT id, telefone, categoria, motivo_transbordo, motivo_nao_identificacao
      FROM atendimentos
      WHERE categoria_assunto IS NULL OR categoria_assunto = 'Outros' OR categoria_assunto = ''
      ORDER BY data_inicio DESC
    `);

    console.log(`📋 Encontrados ${res.rows.length} atendimentos para reclassificar.`);

    let atualizados = 0;
    for (const atd of res.rows) {
      try {
        const historico = await dbService.buscarHistoricoConversa(atd.id);
        const cat = await classificadorAssuntoService.classificar({
          atendimentoId: atd.id,
          categoriaMenu: atd.categoria,
          motivoTransbordo: atd.motivo_transbordo,
          diagnostico: atd.motivo_nao_identificacao,
          historico,
        });

        if (cat) {
          await dbService.atualizarAtendimento(atd.id, {
            categoria_assunto: cat,
          });
          atualizados++;
          console.log(`[${atualizados}/${res.rows.length}] Atendimento ${atd.id} -> ${cat}`);
        }
      } catch (err: any) {
        console.error(`Erro ao classificar ${atd.id}:`, err?.message ?? err);
      }
    }

    console.log(`✅ Concluído! ${atualizados} atendimentos foram reclassificados com sucesso.`);
  } catch (e: any) {
    console.error('Erro no script de reclassificação:', e);
  } finally {
    await pool.end();
  }
}

reclassificar();
