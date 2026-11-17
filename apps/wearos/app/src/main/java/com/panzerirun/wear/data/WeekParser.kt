package com.panzerirun.wear.data

import org.json.JSONArray
import org.json.JSONObject

// JSON do servidor -> modelos. Tolerante: campo ausente vira nulo; treino ilegivel e' ignorado (nunca derruba a lista inteira).
object WeekParser {
    fun parse(json: String): Week {
        val root = JSONObject(json)
        val sessions = mutableListOf<Session>()
        val array = root.optJSONArray("sessions") ?: JSONArray()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            runCatching { sessions.add(session(obj)) }
        }
        return Week(generatedAt = root.optString("generatedAt", ""), sessions = sessions)
    }

    private fun session(obj: JSONObject): Session = Session(
        id = obj.getString("id"),
        date = obj.getString("date"),
        weekday = obj.optInt("weekday", 0),
        kind = obj.optString("kind", "outra"),
        title = obj.optString("title", "Treino"),
        durationMin = obj.intOrNull("durationMin"),
        distanceKm = obj.doubleOrNull("distanceKm"),
        done = obj.optBoolean("done", false),
        items = items(obj.optJSONArray("steps") ?: JSONArray()),
    )

    private fun items(array: JSONArray): List<Item> {
        val out = mutableListOf<Item>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            if (obj.optString("kind") == "repeat") {
                val steps = obj.optJSONArray("steps") ?: JSONArray()
                out.add(Item(repeatCount = obj.optInt("repeatCount", 1), steps = (0 until steps.length()).mapNotNull { steps.optJSONObject(it)?.let(::step) }))
            } else {
                out.add(Item(repeatCount = null, steps = listOf(step(obj))))
            }
        }
        return out
    }

    private fun step(obj: JSONObject): Step {
        val goal = obj.optJSONObject("goal")
        val pace = obj.optJSONObject("pace")
        val goalType = goal?.optString("type", "open") ?: "open"
        return Step(
            label = obj.optString("label").takeIf { it.isNotBlank() && it != "null" },
            role = obj.optString("role", "main"),
            goalType = goalType,
            goalMeters = if (goalType == "distance") goal?.doubleOrNull("meters")?.let { Math.round(it).toInt() } else null,
            goalSeconds = if (goalType == "time") goal?.intOrNull("seconds") else null,
            paceFast = pace?.intOrNull("fastSecPerKm"),
            paceSlow = pace?.intOrNull("slowSecPerKm"),
        )
    }

    private fun JSONObject.intOrNull(key: String): Int? = if (has(key) && !isNull(key)) optDouble(key).takeIf { !it.isNaN() }?.toInt() else null
    private fun JSONObject.doubleOrNull(key: String): Double? = if (has(key) && !isNull(key)) optDouble(key).takeIf { !it.isNaN() } else null
}
