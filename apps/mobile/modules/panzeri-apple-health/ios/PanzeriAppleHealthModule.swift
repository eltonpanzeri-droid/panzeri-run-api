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
          let formatter = ISO8601DateFormatter()
          var items: [[String: Any]] = []
          for workout in workouts {
            // Distancia: o HealthKit pode nao ter estatistica de distancia para o treino (registro manual, outro app). Nesse caso NAO e' zero: e' indisponivel na origem, e o app diz isso
            // (distanceStatus) em vez de inventar um valor. Um 0 informado pelo HealthKit segue como 0.
            let distanceMeters = workout
              .statistics(for: HKQuantityType(.distanceWalkingRunning))?
              .sumQuantity()?
              .doubleValue(for: .meter())
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
            items.append(item)
          }
          promise.resolve(items)
        }
      }
      self.healthStore.execute(query)
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
