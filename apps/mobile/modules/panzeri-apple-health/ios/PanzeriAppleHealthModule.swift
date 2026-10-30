import ExpoModulesCore
import HealthKit
import CoreLocation
import WorkoutKit

// Apple Watch via HealthKit + WorkoutKit, isolado neste modulo. As funcoes daqui so' leem/agendam NO aparelho; o envio de treinos lidos para a API
// (sincronizacao com o Panzeri Run) e' feito pelo app, com autorizacao do usuario.
//
// HealthKit: so' LEITURA. Treinos (HKWorkout de corrida) e TUDO o que o app Saude guarda associado a eles: distancia, frequencia cardiaca (media e maxima), energia ativa, passos
// (base da cadencia), potencia, velocidade, passada, tempo de contato com o solo, oscilacao vertical, ganho de elevacao e o percurso (rota GPS). Nada e' escrito no Saude.
// WorkoutKit: agenda UM treino de corrida simples (distancia definida) no app Treino do Apple Watch,
// com o identificador do Panzeri Run (UUID) preservado em WorkoutPlan.id.
public class PanzeriAppleHealthModule: Module {
  private let healthStore = HKHealthStore()

  // Tudo o que o app pede ao iOS (28/10/2026, ordem do Elton: o app deve tentar pegar tudo o que puder). O iOS mostra uma folha unica; o aluno escolhe o que compartilhar e o
  // app nunca sabe o que foi negado (dado ausente continua ausente).
  private var readTypes: Set<HKObjectType> {
    [
      HKObjectType.workoutType(),
      HKSeriesType.workoutRoute(),
      HKQuantityType(.distanceWalkingRunning),
      HKQuantityType(.heartRate),
      HKQuantityType(.activeEnergyBurned),
      HKQuantityType(.stepCount),
      HKQuantityType(.runningPower),
      HKQuantityType(.runningSpeed),
      HKQuantityType(.runningStrideLength),
      HKQuantityType(.runningGroundContactTime),
      HKQuantityType(.runningVerticalOscillation),
    ]
  }

  public func definition() -> ModuleDefinition {
    Name("PanzeriAppleHealth")

    // --- HealthKit ---------------------------------------------------------------------------

    Function("isHealthDataAvailable") { () -> Bool in
      HKHealthStore.isHealthDataAvailable()
    }

    // "shouldRequest" = o iOS ainda vai mostrar a folha de permissao; "unnecessary" = ja foi respondida.
    AsyncFunction("getHealthAuthorizationRequestStatus") { (promise: Promise) in
      self.healthStore.getRequestStatusForAuthorization(toShare: [], read: self.readTypes) { status, error in
        if let error = error {
          promise.reject("E_HEALTH_STATUS", error.localizedDescription)
          return
        }
        switch status {
        case .shouldRequest: promise.resolve("shouldRequest")
        case .unnecessary: promise.resolve("unnecessary")
        default: promise.resolve("unknown")
        }
      }
    }

    // Pede somente leitura de treinos e distancia. O iOS nunca informa se a leitura foi negada
    // (privacidade): negar e' indistinguivel de "nao ha dados" — por isso a prova real e' ler um treino.
    AsyncFunction("requestHealthAuthorization") { (promise: Promise) in
      Task {
        do {
          try await self.healthStore.requestAuthorization(toShare: [], read: self.readTypes)
          promise.resolve(["requested": true])
        } catch {
          promise.reject("E_HEALTH_AUTH", error.localizedDescription)
        }
      }
    }

    AsyncFunction("readRecentRunningWorkouts") { (limit: Int, promise: Promise) in
      let predicate = HKQuery.predicateForWorkouts(with: .running)
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(
        sampleType: HKObjectType.workoutType(),
        predicate: predicate,
        limit: max(1, min(limit, 200)),
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error = error {
          promise.reject("E_HEALTH_QUERY", error.localizedDescription)
          return
        }
        let workouts = (samples as? [HKWorkout]) ?? []
        Task {
          promise.resolve(await self.workoutItems(workouts))
        }
      }
      self.healthStore.execute(query)
    }

    // Treinos de TODOS os tipos num periodo (corrida, caminhada, ciclismo, forca, natacao...), do mais recente ao mais antigo. O tipo bruto (activityTypeRaw) segue preservado.
    AsyncFunction("readWorkoutsInRange") { (startIso: String, endIso: String, limit: Int, promise: Promise) in
      guard let start = Self.parseDate(startIso), let end = Self.parseDate(endIso), start < end else {
        promise.reject("E_INVALID_DATE", "Periodo invalido (use ISO 8601, inicio antes do fim).")
        return
      }
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: max(1, min(limit, 500)), sortDescriptors: [sort]) { _, samples, error in
        if let error = error {
          promise.reject("E_HEALTH_QUERY", error.localizedDescription)
          return
        }
        let workouts = (samples as? [HKWorkout]) ?? []
        Task {
          promise.resolve(await self.workoutItems(workouts))
        }
      }
      self.healthStore.execute(query)
    }

    // Pede a leitura dos tipos de saude do dia a dia (identificadores HealthKit) ALEM dos de treino. Nunca pede escrita. Identificador desconhecido neste iOS e' ignorado. O iOS nunca informa o
    // que foi negado: negar e' indistinguivel de "sem dados".
    AsyncFunction("requestHealthAuthorizationFor") { (quantityIds: [String], categoryIds: [String], promise: Promise) in
      Task {
        var types = self.readTypes
        for id in quantityIds {
          if let type = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: id)) { types.insert(type) }
        }
        for id in categoryIds {
          if let type = HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: id)) { types.insert(type) }
        }
        do {
          try await self.healthStore.requestAuthorization(toShare: [], read: types)
          promise.resolve(["requested": true, "typeCount": types.count])
        } catch {
          promise.reject("E_HEALTH_AUTH", error.localizedDescription)
        }
      }
    }

    // Estatisticas POR DIA (fuso do aparelho) de tipos quantitativos. specsJson = [{ identifier, unit }] (unit = ficha de unidade conhecida, ver unit(for:)). Tipos cumulativos devolvem a soma do
    // dia (o HealthKit ja' desduplica fontes); os demais, media/minimo/maximo/ultimo valor. Dia sem amostra NAO gera linha (ausencia nunca vira zero). Tipo indisponivel neste iOS, unidade
    // incompativel ou consulta com erro entram em "failed" e nao derrubam os demais.
    AsyncFunction("readDailyStatistics") { (specsJson: String, startIso: String, endIso: String, promise: Promise) in
      guard let start = Self.parseDate(startIso), let end = Self.parseDate(endIso), start < end else {
        promise.reject("E_INVALID_DATE", "Periodo invalido (use ISO 8601, inicio antes do fim).")
        return
      }
      guard let data = specsJson.data(using: .utf8), let specs = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
        promise.reject("E_INVALID_SPECS", "specsJson invalido.")
        return
      }
      Task {
        var rows: [[String: Any]] = []
        var failed: [String] = []
        for spec in specs {
          guard let identifier = spec["identifier"] as? String, let unitToken = spec["unit"] as? String else { continue }
          do {
            rows.append(contentsOf: try await self.dailyStatistics(identifier: identifier, unitToken: unitToken, start: start, end: end))
          } catch {
            failed.append(identifier)
          }
        }
        promise.resolve(["rows": rows, "failed": failed])
      }
    }

    // Amostras de tipos de CATEGORIA (sono, ciclo menstrual, eventos cardiacos, atencao plena...) num periodo: valor inteiro bruto do HealthKit, inicio, fim e origem. Quem monta sessoes/dias
    // e' o aplicativo (logica testada em TypeScript); aqui so' se le.
    AsyncFunction("readCategorySamples") { (identifiers: [String], startIso: String, endIso: String, promise: Promise) in
      guard let start = Self.parseDate(startIso), let end = Self.parseDate(endIso), start < end else {
        promise.reject("E_INVALID_DATE", "Periodo invalido (use ISO 8601, inicio antes do fim).")
        return
      }
      Task {
        let formatter = ISO8601DateFormatter()
        var rows: [[String: Any]] = []
        var failed: [String] = []
        for identifier in identifiers {
          guard let type = HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: identifier)) else {
            failed.append(identifier)
            continue
          }
          do {
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            let samples = try await self.fetchSamples(type: type, predicate: predicate)
            for case let sample as HKCategorySample in samples {
              rows.append([
                "identifier": identifier,
                "value": sample.value,
                "startTime": formatter.string(from: sample.startDate),
                "endTime": formatter.string(from: sample.endDate),
                "offsetSeconds": TimeZone.current.secondsFromGMT(for: sample.startDate),
                "sourceBundleId": sample.sourceRevision.source.bundleIdentifier,
                "sourceName": sample.sourceRevision.source.name,
                "deviceName": Self.orNull(sample.device?.name)
              ])
            }
          } catch {
            failed.append(identifier)
          }
        }
        promise.resolve(["rows": rows, "failed": failed])
      }
    }

    // Percurso (rota GPS) de um treino, em pontos compactos [deslocamentoSeg, latitude, longitude, altitude|null], amostrados uniformemente quando passam de maxPoints. Sem
    // autorizacao da rota, ou treino sem rota, devolve lista vazia (o iOS nao diferencia).
    AsyncFunction("readWorkoutRoute") { (uuid: String, maxPoints: Int, promise: Promise) in
      guard let id = UUID(uuidString: uuid) else {
        promise.reject("E_INVALID_ID", "uuid invalido.")
        return
      }
      Task {
        do {
          promise.resolve(try await self.routePoints(workoutId: id, maxPoints: max(2, min(maxPoints, 2500))))
        } catch {
          promise.reject("E_HEALTH_ROUTE", error.localizedDescription)
        }
      }
    }

    // --- WorkoutKit --------------------------------------------------------------------------

    // Devolve authorized | denied | notDetermined | restricted. Chamar de novo e' seguro (so' mostra a folha uma vez).
    AsyncFunction("requestWorkoutAuthorization") { (promise: Promise) in
      Task {
        let state = await WorkoutScheduler.shared.requestAuthorization()
        promise.resolve(Self.describe(state))
      }
    }

    // Agenda UMA corrida continua com distancia definida. planId precisa ser um UUID (WorkoutPlan.id).
    AsyncFunction("scheduleRunWorkout") { (planId: String, distanceKm: Double, startIso: String, promise: Promise) in
      guard let uuid = UUID(uuidString: planId) else {
        promise.reject("E_INVALID_PLAN_ID", "planId precisa ser um UUID.")
        return
      }
      guard distanceKm > 0, distanceKm <= 100 else {
        promise.reject("E_INVALID_DISTANCE", "Distancia fora do intervalo aceito (0 a 100 km).")
        return
      }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let start = formatter.date(from: startIso) ?? ISO8601DateFormatter().date(from: startIso) else {
        promise.reject("E_INVALID_DATE", "Data invalida (use ISO 8601).")
        return
      }
      let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: start)

      Task {
        let state = await WorkoutScheduler.shared.requestAuthorization()
        guard state == .authorized else {
          promise.reject("E_NOT_AUTHORIZED", "WorkoutKit nao autorizado (estado: \(Self.describe(state))).")
          return
        }
        let workout = SingleGoalWorkout(
          activity: .running,
          location: .outdoor,
          goal: .distance(distanceKm, .kilometers)
        )
        let plan = WorkoutPlan(.goal(workout), id: uuid)
        await WorkoutScheduler.shared.schedule(plan, at: components)
        promise.resolve([
          "scheduled": true,
          "planId": uuid.uuidString,
          "distanceKm": distanceKm,
          "scheduledFor": formatter.string(from: start)
        ])
      }
    }

    // Agenda um CustomWorkout construido a partir do AppleCustomWorkoutSpec ja' validado pela API (Etapa 7). Usa o MESMO builder da sonda
    // (CustomWorkoutSpecBuilder.construct): spec invalido NAO agenda e devolve os erros identificaveis. planId (UUID) vira WorkoutPlan.id — a
    // identidade estavel da entrega, devolvida depois pelo HealthKit. Falha de autorizacao/agendamento rejeita com o erro real (codigo + mensagem).
    AsyncFunction("scheduleCustomWorkoutSpec") { (planId: String, specJson: String, startIso: String, promise: Promise) in
      guard let uuid = UUID(uuidString: planId) else {
        promise.reject("E_INVALID_PLAN_ID", "planId precisa ser um UUID.")
        return
      }
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      guard let start = formatter.date(from: startIso) ?? ISO8601DateFormatter().date(from: startIso) else {
        promise.reject("E_INVALID_DATE", "Data invalida (use ISO 8601).")
        return
      }
      let construction = CustomWorkoutSpecBuilder.construct(specJson: specJson)
      guard let workout = construction.workout else {
        // Spec invalido: nada e' agendado; os erros estruturados voltam para o app registrar e mostrar.
        promise.resolve(["scheduled": false, "planId": uuid.uuidString, "errors": construction.result["errors"] ?? [[String: Any]]()])
        return
      }
      let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: start)

      Task {
        let state = await WorkoutScheduler.shared.requestAuthorization()
        guard state == .authorized else {
          promise.reject("E_NOT_AUTHORIZED", "WorkoutKit nao autorizado (estado: \(Self.describe(state))).")
          return
        }
        let plan = WorkoutPlan(.custom(workout), id: uuid)
        await WorkoutScheduler.shared.schedule(plan, at: components)
        promise.resolve([
          "scheduled": true,
          "planId": uuid.uuidString,
          "scheduledFor": formatter.string(from: start)
        ])
      }
    }

    // Constroi e VALIDA (sem agendar) um CustomWorkout a partir do AppleCustomWorkoutSpec ja' validado pela API. Traducao mecanica: ver
    // CustomWorkoutSpecBuilder.swift. Devolve { valid, errors[{code,message,path}], summary? } — rejeicoes sao identificaveis, nunca genericas.
    Function("validateCustomWorkoutSpec") { (specJson: String) -> [String: Any] in
      CustomWorkoutSpecBuilder.validate(specJson: specJson)
    }

    // Treinos agendados por ESTE app (WorkoutKit so' mostra os do proprio app).
    AsyncFunction("listScheduledWorkouts") { (promise: Promise) in
      Task {
        let scheduled = await WorkoutScheduler.shared.scheduledWorkouts
        let formatter = ISO8601DateFormatter()
        let items: [[String: Any]] = scheduled.map { item in
          let date = Calendar.current.date(from: item.date)
          return [
            "planId": item.plan.id.uuidString,
            "date": Self.orNull(date.map { formatter.string(from: $0) }),
            "complete": item.complete
          ]
        }
        promise.resolve(items)
      }
    }

    // Limpeza entre testes: remove apenas os treinos agendados por este app.
    AsyncFunction("removeAllScheduledWorkouts") { (promise: Promise) in
      Task {
        await WorkoutScheduler.shared.removeAllWorkouts()
        promise.resolve(["removed": true])
      }
    }
  }

  // Item serializavel de UM treino (todos os tipos). Distancia ausente nao e' zero; medidas so' entram quando o iOS as entrega.
  private func workoutItem(_ workout: HKWorkout) async -> [String: Any] {
    let formatter = ISO8601DateFormatter()

    // Distancia: o HealthKit pode nao ter estatistica de distancia para o treino (registro manual, outro app). Nesse caso NAO e' zero: e' indisponivel na origem, e o app diz isso
    // (distanceStatus) em vez de inventar um valor. Um 0 informado pelo HealthKit segue como 0.
    // Treinos que nao sao de corrida/caminhada guardam a distancia em outro tipo (ciclismo, natacao, cadeira de rodas): usa o primeiro que existir.
    var distanceMeters: Double? = nil
    for identifier in [HKQuantityTypeIdentifier.distanceWalkingRunning, .distanceCycling, .distanceSwimming, .distanceWheelchair] {
      if let value = workout.statistics(for: HKQuantityType(identifier))?.sumQuantity()?.doubleValue(for: HKUnit.meter()) {
        distanceMeters = value
        break
      }
    }
    // Round trip futuro: se o treino foi executado a partir de um plano agendado por nos,
    // workoutPlan.id devolve o UUID do Panzeri Run. Nulo para treinos iniciados no relogio.
    let plan = try? await workout.workoutPlan
    var item: [String: Any] = [
      "uuid": workout.uuid.uuidString,
      "sourceName": workout.sourceRevision.source.name,
      "sourceBundleId": workout.sourceRevision.source.bundleIdentifier,
      "sourceProductType": Self.orNull(workout.sourceRevision.productType),
      "deviceName": Self.orNull(workout.device?.name),
      "deviceManufacturer": Self.orNull(workout.device?.manufacturer),
      "deviceModel": Self.orNull(workout.device?.model),
      "deviceHardwareVersion": Self.orNull(workout.device?.hardwareVersion),
      "deviceSoftwareVersion": Self.orNull(workout.device?.softwareVersion),
      "activityType": workout.workoutActivityType == .running ? "running" : "other",
      "activityTypeRaw": Int(workout.workoutActivityType.rawValue),
      "isIndoor": Self.orNull(workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool),
      "timeZone": Self.orNull(workout.metadata?[HKMetadataKeyTimeZone] as? String),
      "startDate": formatter.string(from: workout.startDate),
      "endDate": formatter.string(from: workout.endDate),
      "durationSeconds": workout.duration,
      "distanceMeters": Self.orNull(distanceMeters),
      "distanceStatus": distanceMeters == nil ? "unavailable" : "reported",
      "workoutPlanId": Self.orNull(plan?.id.uuidString)
    ]
    // Medidas associadas ao treino (so' as que o iOS entregar: sem autorizacao ou sem dado, a chave simplesmente nao existe).
    item.merge(Self.workoutMeasures(workout)) { _, new in new }
    // Frequencia cardiaca: treinos gravados por aplicativos de terceiros (ex.: Garmin Connect) muitas vezes NAO trazem a estatistica propria, embora as medicoes de FC existam no app Saude no mesmo
    // intervalo. Nesse caso le as medicoes REAIS dentro do intervalo do treino (media e maxima) e marca a base, para nunca confundir com a estatistica do proprio treino. Sem medicao: nada e' enviado.
    if item["avgHeartRateBpm"] != nil {
      item["heartRateBasis"] = "workout_statistics"
    } else if let window = await self.heartRateInWorkoutWindow(workout) {
      item["avgHeartRateBpm"] = window.avg
      item["maxHeartRateBpm"] = window.max
      item["heartRateBasis"] = "time_window"
    }
    return item
  }

  private func heartRateInWorkoutWindow(_ workout: HKWorkout) async -> (avg: Double, max: Double)? {
    guard let type = HKObjectType.quantityType(forIdentifier: .heartRate) else { return nil }
    let predicate = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: [.strictStartDate, .strictEndDate])
    let unit = HKUnit.count().unitDivided(by: HKUnit.minute())
    return await withCheckedContinuation { (continuation: CheckedContinuation<(avg: Double, max: Double)?, Never>) in
      let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: [.discreteAverage, .discreteMax]) { _, statistics, _ in
        guard let avg = statistics?.averageQuantity()?.doubleValue(for: unit), let max = statistics?.maximumQuantity()?.doubleValue(for: unit) else {
          continuation.resume(returning: nil)
          return
        }
        continuation.resume(returning: (avg: avg, max: max))
      }
      self.healthStore.execute(query)
    }
  }

  private func workoutItems(_ workouts: [HKWorkout]) async -> [[String: Any]] {
    var items: [[String: Any]] = []
    for workout in workouts { items.append(await workoutItem(workout)) }
    return items
  }

  // Estatisticas do proprio HKWorkout (iOS 16+). So' entram as que existem; nada e' estimado nem calculado aqui.
  private static func workoutMeasures(_ workout: HKWorkout) -> [String: Any] {
    var out: [String: Any] = [:]
    let bpm = HKUnit.count().unitDivided(by: .minute())
    if let stats = workout.statistics(for: HKQuantityType(.heartRate)) {
      if let value = stats.averageQuantity()?.doubleValue(for: bpm) { out["avgHeartRateBpm"] = value }
      if let value = stats.maximumQuantity()?.doubleValue(for: bpm) { out["maxHeartRateBpm"] = value }
    }
    if let value = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()) { out["activeEnergyKcal"] = value }
    if let value = workout.statistics(for: HKQuantityType(.stepCount))?.sumQuantity()?.doubleValue(for: .count()) { out["stepCount"] = value }
    if let value = workout.statistics(for: HKQuantityType(.runningPower))?.averageQuantity()?.doubleValue(for: .watt()) { out["powerAvgWatts"] = value }
    if let value = workout.statistics(for: HKQuantityType(.runningSpeed))?.averageQuantity()?.doubleValue(for: HKUnit.meter().unitDivided(by: .second())) { out["avgSpeedMetersPerSecond"] = value }
    if let value = workout.statistics(for: HKQuantityType(.runningStrideLength))?.averageQuantity()?.doubleValue(for: .meter()) { out["avgStrideLengthMeters"] = value }
    if let value = workout.statistics(for: HKQuantityType(.runningGroundContactTime))?.averageQuantity()?.doubleValue(for: HKUnit.secondUnit(with: .milli)) { out["avgGroundContactTimeMs"] = value }
    if let value = workout.statistics(for: HKQuantityType(.runningVerticalOscillation))?.averageQuantity()?.doubleValue(for: HKUnit.meterUnit(with: .centi)) { out["avgVerticalOscillationCm"] = value }
    if let ascended = workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity { out["elevationGainMeters"] = ascended.doubleValue(for: .meter()) }
    return out
  }

  private func fetchSamples(type: HKSampleType, predicate: NSPredicate?) async throws -> [HKSample] {
    try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
        if let error = error { continuation.resume(throwing: error) } else { continuation.resume(returning: samples ?? []) }
      }
      self.healthStore.execute(query)
    }
  }

  private func locations(of route: HKWorkoutRoute) async throws -> [CLLocation] {
    try await withCheckedThrowingContinuation { continuation in
      var all: [CLLocation] = []
      let query = HKWorkoutRouteQuery(route: route) { _, batch, done, error in
        if let error = error {
          continuation.resume(throwing: error)
          return
        }
        if let batch = batch { all.append(contentsOf: batch) }
        if done { continuation.resume(returning: all) }
      }
      self.healthStore.execute(query)
    }
  }

  private func routePoints(workoutId: UUID, maxPoints: Int) async throws -> [[Any]] {
    let workouts = try await fetchSamples(type: HKObjectType.workoutType(), predicate: HKQuery.predicateForObject(with: workoutId))
    guard let workout = workouts.first as? HKWorkout else { return [] }
    let routes = try await fetchSamples(type: HKSeriesType.workoutRoute(), predicate: HKQuery.predicateForObjects(from: workout))
    var all: [CLLocation] = []
    for case let route as HKWorkoutRoute in routes { all.append(contentsOf: try await locations(of: route)) }
    all = all.filter { $0.horizontalAccuracy >= 0 }.sorted { $0.timestamp < $1.timestamp }
    if all.count < 2 { return [] }
    let step = max(1, Int((Double(all.count) / Double(maxPoints)).rounded(.up)))
    var points: [[Any]] = []
    var lastOffset = -1
    for index in stride(from: 0, to: all.count, by: step) {
      let location = all[index]
      let offset = Int(location.timestamp.timeIntervalSince(workout.startDate))
      if offset < 0 || offset <= lastOffset { continue }
      lastOffset = offset
      let altitude: Any = location.verticalAccuracy >= 0 ? location.altitude : NSNull()
      points.append([offset, location.coordinate.latitude, location.coordinate.longitude, altitude])
    }
    return points
  }

  private static func parseDate(_ text: String) -> Date? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return withFraction.date(from: text) ?? ISO8601DateFormatter().date(from: text)
  }

  // Fichas de unidade aceitas (so' unidades construidas pela API do HealthKit, nunca texto livre). Ficha desconhecida = tipo ignorado.
  private static func unit(for token: String) -> HKUnit? {
    switch token {
    case "count": return HKUnit.count()
    case "bpm": return HKUnit.count().unitDivided(by: HKUnit.minute())
    case "m": return HKUnit.meter()
    case "kcal": return HKUnit.kilocalorie()
    case "ms": return HKUnit.secondUnit(with: .milli)
    case "s": return HKUnit.second()
    case "min": return HKUnit.minute()
    case "mps": return HKUnit.meter().unitDivided(by: HKUnit.second())
    case "kg": return HKUnit.gramUnit(with: .kilo)
    case "g": return HKUnit.gram()
    case "mg": return HKUnit.gramUnit(with: .milli)
    case "ml": return HKUnit.literUnit(with: .milli)
    case "percent": return HKUnit.percent()
    case "degC": return HKUnit.degreeCelsius()
    case "mmHg": return HKUnit.millimeterOfMercury()
    case "mgdl": return HKUnit.gramUnit(with: .milli).unitDivided(by: HKUnit.literUnit(with: .deci))
    case "dbaspl": return HKUnit.decibelAWeightedSoundPressureLevel()
    case "vo2": return HKUnit.literUnit(with: .milli).unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.minute()))
    default: return nil
    }
  }

  // Uma linha por dia COM amostra. Cumulativo: sum. Demais: avg, min, max e latest (ultimo valor do dia). Lanca erro se o tipo/unidade nao servem (o chamador registra em "failed").
  private func dailyStatistics(identifier: String, unitToken: String, start: Date, end: Date) async throws -> [[String: Any]] {
    guard let type = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: identifier)),
          let unit = Self.unit(for: unitToken),
          type.is(compatibleWith: unit) else {
      throw NSError(domain: "PanzeriAppleHealth", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tipo ou unidade indisponivel: \(identifier)"])
    }
    let cumulative = type.aggregationStyle == .cumulative
    let options: HKStatisticsOptions = cumulative ? [.cumulativeSum] : [.discreteAverage, .discreteMin, .discreteMax, .mostRecent]
    let calendar = Calendar.current
    let anchor = calendar.startOfDay(for: start)
    var interval = DateComponents()
    interval.day = 1
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
    let dayFormatter = DateFormatter()
    dayFormatter.locale = Locale(identifier: "en_US_POSIX")
    dayFormatter.timeZone = TimeZone.current
    dayFormatter.dateFormat = "yyyy-MM-dd"
    let isoFormatter = ISO8601DateFormatter()
    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[[String: Any]], Error>) in
      let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate, options: options, anchorDate: anchor, intervalComponents: interval)
      query.initialResultsHandler = { _, collection, error in
        if let error = error {
          continuation.resume(throwing: error)
          return
        }
        var out: [[String: Any]] = []
        collection?.enumerateStatistics(from: anchor, to: end) { statistics, _ in
          var row: [String: Any] = [
            "identifier": identifier,
            "day": dayFormatter.string(from: statistics.startDate),
            "startTime": isoFormatter.string(from: statistics.startDate),
            "offsetSeconds": TimeZone.current.secondsFromGMT(for: statistics.startDate)
          ]
          var any = false
          if cumulative {
            if let value = statistics.sumQuantity()?.doubleValue(for: unit) { row["sum"] = value; any = true }
          } else {
            if let value = statistics.averageQuantity()?.doubleValue(for: unit) { row["avg"] = value; any = true }
            if let value = statistics.minimumQuantity()?.doubleValue(for: unit) { row["min"] = value }
            if let value = statistics.maximumQuantity()?.doubleValue(for: unit) { row["max"] = value }
            if let value = statistics.mostRecentQuantity()?.doubleValue(for: unit) { row["latest"] = value }
          }
          if any { out.append(row) }
        }
        continuation.resume(returning: out)
      }
      self.healthStore.execute(query)
    }
  }

  // Optional -> valor serializavel (nulo vira NSNull, nunca zero: ausencia continua ausencia).
  private static func orNull(_ value: Any?) -> Any {
    value ?? NSNull()
  }

  private static func describe(_ state: WorkoutScheduler.AuthorizationState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }
}
