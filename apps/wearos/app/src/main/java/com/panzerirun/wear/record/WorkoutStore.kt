package com.panzerirun.wear.record

import android.content.Context
import org.json.JSONObject
import java.io.File

// Treinos gravados ficam em arquivos privados do app no relogio (nenhum outro app le). Fase 3: so' guardar; o envio ao Panzeri Run entra com a autorizacao da aluna na etapa seguinte.
// - pending/<clientId>.json : treino encerrado, esperando envio
// - in-progress.json        : copia periodica (a cada 15 s) do treino em andamento, para recuperar se o app for fechado no meio

class WorkoutStore(context: Context) {
    private val dir = File(context.filesDir, "workouts").apply { mkdirs() }
    private val pendingDir = File(dir, "pending").apply { mkdirs() }
    private val inProgress = File(dir, "in-progress.json") // formato antigo (0.2.0): so' limpado
    private val journalMeta = File(dir, "in-progress-meta.json")
    private val journalPoints = File(dir, "in-progress-points.jsonl")

    fun savePending(clientId: String, json: JSONObject) {
        val tmp = File(pendingDir, "$clientId.tmp")
        tmp.writeText(json.toString())
        tmp.renameTo(File(pendingDir, "$clientId.json")) // gravacao atomica: nunca fica arquivo pela metade
    }

    fun pending(): List<JSONObject> = (pendingDir.listFiles { f -> f.extension == "json" } ?: emptyArray())
        .sortedBy { it.lastModified() }
        .mapNotNull { runCatching { JSONObject(it.readText()) }.getOrNull() }

    // treino + id (nome do arquivo), do mais antigo ao mais novo, para o envio
    fun pendingEntries(): List<Pair<String, JSONObject>> = (pendingDir.listFiles { f -> f.extension == "json" } ?: emptyArray())
        .sortedBy { it.lastModified() }
        .mapNotNull { file -> runCatching { file.nameWithoutExtension to JSONObject(file.readText()) }.getOrNull() }

    // treino que o servidor recusou para sempre: sai da fila de envio (fica guardado em rejected/ para conferencia)
    fun rejectPending(id: String) {
        val source = File(pendingDir, "$id.json")
        if (!source.exists()) return
        val rejected = File(dir, "rejected").apply { mkdirs() }
        if (!source.renameTo(File(rejected, "$id.json"))) source.delete()
    }

    fun pendingCount(): Int = pendingDir.listFiles { f -> f.extension == "json" }?.size ?: 0

    fun deletePending(clientId: String) { File(pendingDir, "$clientId.json").delete() }

    // Diario do treino em andamento (a cada 5 s): resumo reescrito (pequeno) + so' os pontos novos acrescentados, para o custo nao crescer com a duracao da corrida.
    fun appendJournal(meta: JSONObject, newPoints: List<JSONObject>) {
        val tmp = File(dir, "in-progress-meta.tmp")
        tmp.writeText(meta.toString())
        tmp.renameTo(journalMeta)
        if (newPoints.isNotEmpty()) journalPoints.appendText(newPoints.joinToString(separator = "\n", postfix = "\n") { it.toString() })
    }

    fun clearInProgress() {
        journalMeta.delete()
        journalPoints.delete()
        inProgress.delete() // formato antigo (versao 0.2.0), se existir
    }

    // Treino que o sistema encerrou no meio (bateria, app fechado): vira "interrompido" e entra na fila como os demais. Menos de 10 pontos (10 s) nao vale guardar.
    fun recoverInterrupted(): Boolean {
        val legacy = inProgress.takeIf { it.exists() }?.let { file -> runCatching { JSONObject(file.readText()) }.getOrNull() }
        val journaled = journalMeta.takeIf { it.exists() }?.let { metaFile ->
            runCatching { Journal.assemble(JSONObject(metaFile.readText()), journalPoints.takeIf { it.exists() }?.readLines() ?: emptyList()) }.getOrNull()
        }
        clearInProgress()
        val json = journaled ?: legacy ?: return false
        val points = json.optJSONArray("points")
        if (points == null || points.length() < 10) return false
        json.put("interrupted", true)
        savePending(json.getString("clientId"), json)
        return true
    }
}
